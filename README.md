# @boyboni/firestore-query

Firestore bindings for TanStack Query v5: typed query keys, realtime listeners that live in the query cache, cursor pagination, server-side aggregates, and write hooks that invalidate the right keys.

[![npm](https://img.shields.io/npm/v/@boyboni/firestore-query)](https://www.npmjs.com/package/@boyboni/firestore-query) [![CI](https://github.com/boypanjaitan16/firestore-query/actions/workflows/ci.yml/badge.svg)](https://github.com/boypanjaitan16/firestore-query/actions/workflows/ci.yml)

## Install

```sh
pnpm add @boyboni/firestore-query firebase @tanstack/react-query react
```

The package is ESM only and ships its own type declarations.

## Compatibility

| Peer                    | Range      | Tested in CI       |
| ----------------------- | ---------- | ------------------ |
| `firebase`              | `>=10 <14` | 10, 11, 12, 13     |
| `@tanstack/react-query` | `^5.101.0` | 5.101.0 and latest |
| `react`                 | `>=18`     | 18, 19             |

Each combination runs the unit tests and the Firestore emulator suite. 5.101.0 is the oldest TanStack Query release whose types accept these options everywhere (`useInfiniteQuery`, `fetchQuery`, the suspense hooks). Realtime queries need the client in the query function context, which arrived in 5.66.0, so older 5.x releases run but fail to type-check.

## Setup

```ts
import { QueryClient } from "@tanstack/react-query";
import { attachFirestoreListeners } from "@boyboni/firestore-query";

export const queryClient = new QueryClient();
// Once per client. Realtime queries fail with `listeners-not-attached` without it.
attachFirestoreListeners(queryClient, { devWarnings: import.meta.env.DEV });
```

## Usage

```ts
import {
  collectionKeys,
  defineConverter,
  timestampToIso,
  useDeleteDoc,
  useFirestoreAggregate,
  useFirestoreDoc,
  useFirestoreInfiniteQuery,
  useFirestoreMutation,
  useFirestoreQuery,
  useUpdateDoc,
} from "@boyboni/firestore-query";
import {
  collection,
  count,
  doc,
  orderBy,
  query,
  where,
} from "firebase/firestore";

const messageConverter = defineConverter<Message>({
  fromFirestore: (data, id) => ({
    id,
    text: data.text,
    createdAt: timestampToIso(data.createdAt),
  }),
});
const messageKeys = collectionKeys("messages");
const messages = () =>
  query(collection(db, "messages"), orderBy("createdAt", "desc")).withConverter(
    messageConverter,
  );

// Realtime list: one onSnapshot per key, shared by every component.
useFirestoreQuery({
  queryKey: messageKeys.list(),
  query: messages(),
  subscribe: true,
});

// One document; the key comes from the path. `null` disables the query.
useFirestoreDoc(
  id ? doc(db, "messages", id).withConverter(messageConverter) : null,
);

// Server-side count, invalidated by writes to the collection.
useFirestoreAggregate({
  queryKey: messageKeys.aggregate({ status: "NEW" }),
  query: query(collection(db, "messages"), where("status", "==", "NEW")),
  aggregate: { total: count() },
});

// Pages of 20; `data.pages[n].items`, `fetchNextPage()`.
const activityKeys = collectionKeys("leads/{leadId}/activities");
useFirestoreInfiniteQuery({
  queryKey: activityKeys.infinite({ leadId }),
  query: query(
    collection(db, "leads", leadId, "activities"),
    orderBy("at", "desc"),
  ),
  pageSize: 20,
});

// Writes take the reference as a variable and invalidate what they touch.
const update = useUpdateDoc();
update.mutate({ ref: doc(db, "messages", id), data: { status: "DONE" } });
const remove = useDeleteDoc();

// Anything else (batches, transactions, several writes) declares its targets.
useFirestoreMutation({
  mutationFn: (lead: Lead) => markSent(lead),
  touches: (lead) => [
    doc(db, "leads", lead.id),
    collection(db, "leads", lead.id, "activities"),
  ],
});
```

Every hook has a matching options factory (`firestoreDocOptions`, `firestoreQueryOptions`, `firestoreInfiniteQueryOptions`, `firestoreAggregateOptions`) for `useQueries`, `prefetchQuery`, `fetchQuery`, or router loaders. Realtime still works there, because the listener is driven by the query cache rather than by the hook. Built from a non-null reference or query, a factory returns `EnabledQueryOptions` (or `EnabledInfiniteQueryOptions`), whose `queryFn` is never `skipToken`, so `useSuspenseQuery` and `useSuspenseInfiniteQuery` accept it; a possibly-null source is a type error there.

Before signing out, call `removeFirestoreQueries(queryClient)`. It removes every Firestore query and stops their listeners before the session ends, so none fails with `permission-denied`.

References and queries may be created on every render: keys come from paths and key factories, so they stay stable and the listener is not recreated.

## Keys

`["firestore", collectionPath, kind, ...]`, where `kind` is `"doc"`, `"list"`, `"infinite"`, or `"aggregate"`.

- `docKey(ref)` → `["firestore", "leads", "doc", "abc"]`, the same key `collectionKeys("leads").doc({ id: "abc" })` builds.
- `collectionKeys("leads/{leadId}/activities").list({ leadId, type })` → `["firestore", "leads/x/activities", "list", { type }]`. Placeholders fill the path; other params are filters.
- `collectionGroupKeys("activities")` → path `"*/activities"`.
- Put every filter of a query in its key. In development, a key used for two different queries logs a warning.

## Writes and the cache

| Write                       | Document key                              | Invalidated                                                                                           |
| --------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `useSetDoc`, `useUpdateDoc` | invalidated                               | `list`, `infinite`, `aggregate` of the collection and its collection group                            |
| `useDeleteDoc`              | set to `null`                             | same                                                                                                  |
| `useAddDoc`                 | —                                         | same                                                                                                  |
| `useFirestoreMutation`      | each document in `touches` is invalidated | same, per target; a collection reference invalidates only its lists, infinite queries, and aggregates |

The built-in invalidation runs before your `onSuccess`; `invalidate: false` turns it off. Parent documents are never invalidated (Firestore has no cascade); add them to `touches` when needed. Realtime queries ignore the invalidation while their listener runs, and the SDK shows local writes in them right away.

## Design decisions

- **React only, logic on `QueryClient`.** Hooks are thin wrappers; key building, listeners, and invalidation work on the client, so other adapters can come later without a rewrite.
- **Firestore SDK objects as input.** A declarative query description would have to mirror the whole SDK and always lag behind it. References carry their Firestore instance, so no provider is needed.
- **Key factories instead of hashing queries.** A `Query` cannot be serialized through the public SDK API. Document keys come from `ref.path`; query keys come from `collectionKeys`, whose shared prefix makes automatic invalidation possible. The collection path is one string, so an ID such as `"doc"` cannot collide with a kind.
- **Plain data in the cache.** No `DocumentSnapshot`s: plain data survives persistence and structural sharing. A missing document is `null`. IDs and timestamps are the converter's job (`defineConverter`, `timestampToIso`); nothing is converted automatically.
- **`serverTimestamps: "estimate"` by default.** Otherwise a list ordered by `updatedAt` reads `null` after every local write until the server confirms it. `defineConverter` always forwards that option, which hand-written converters often forget.
- **Listeners follow observers.** One `onSnapshot` per query hash. It stops `unsubscribeDelay` (default 2 s) after the last observer unmounts, which is enough for a StrictMode double mount or a quick back navigation. It stops at once when the query is removed. A stopped query is marked stale, so the next mount shows the cached data and starts a new listener.
- **Realtime queries own their freshness.** `staleTime: Infinity`, no retries, no focus or reconnect refetch, and those options are type errors on `subscribe: true`. A refetch or invalidation while the listener runs returns the cached data.
- **Stream errors stop the listener.** The SDK does not retry a failed listener. The query shows the error and keeps its last data, and `refetch()` or the next mount starts a new listener.
- **Cursors are document paths.** The page param is the last document's path, which can be serialized. Its snapshot is kept in memory, with one `getDoc` as the fallback. A deleted cursor document fails with `FirestoreQueryError("cursor-missing")`.
- **`networkMode: "always"`.** The SDK queues offline writes itself and resolves them once the server confirms. A second queue in TanStack would be lost on reload. So `await mutateAsync()` can wait for a long time offline: do not block navigation on it.
- **`touches` is required.** A forgotten write target is a type error, not a silently stale cache.
- **ESM only.** Listener and cursor registries live at module level. A dual ESM and CommonJS build could load two copies, and listeners attached through one copy would be invisible to the other.
- **Errors:** `TError` is `FirestoreError | FirestoreQueryError`; `isFirestoreQueryError` narrows it.

### Billing

Each listener start reads its whole result. Without offline persistence (the default memory cache), every stop and restart is billed as a new query. With persistence, only a restart after more than 30 minutes is billed that way ([Firestore billing](https://firebase.google.com/docs/firestore/pricing)). Raise `unsubscribeDelay` for screens users leave and return to often.

## Non-goals for v1

- Adapters for Vue, Solid, or Svelte.
- `firebase/firestore/lite` and React Native Firebase.
- Realtime infinite queries. Use a realtime `useFirestoreQuery` with a growing `limit(n)` instead; a packaged version is on the roadmap.
- Snapshot metadata (`fromCache`, `hasPendingWrites`).
- Built-in optimistic updates for one-shot queries.
- Tests for SSR and `persistQueryClient`. Both should work because cached data is plain and keys serialize, but neither is tested.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the test suites (the emulator suite needs Java 21), and how releases work. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
