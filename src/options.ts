import {
	type InfiniteData,
	type QueryFunction,
	skipToken,
	type UseInfiniteQueryOptions,
	type UseQueryOptions,
} from "@tanstack/react-query";
import type {
	AggregateSpec,
	AggregateSpecData,
	DocumentData,
	DocumentReference,
	DocumentSnapshot,
	Query,
	QuerySnapshot,
} from "firebase/firestore";
import type { FirestoreQueryErrorType } from "./errors";
import {
	type FirestorePage,
	fetchAggregate,
	fetchDoc,
	fetchDocs,
	fetchPage,
} from "./fetchers";
import { docKey, type FirestoreQueryKey } from "./keys";
import { realtimeQueryFn } from "./listeners";
import {
	DEFAULT_SERVER_TIMESTAMPS,
	type FirestoreQueryMeta,
	type FirestoreSource,
	readDoc,
	readDocs,
	type ServerTimestampBehavior,
} from "./source";

type QueryOptions<TQueryFnData, TData> = UseQueryOptions<
	TQueryFnData,
	FirestoreQueryErrorType,
	TData,
	FirestoreQueryKey
>;

/**
 * Options built from a non-null reference or query. Their `queryFn` is never
 * `skipToken`, so `useSuspenseQuery` and `useSuspenseQueries` accept them.
 */
export type EnabledQueryOptions<TQueryFnData, TData> = QueryOptions<
	TQueryFnData,
	TData
> & { queryFn: QueryFunction<TQueryFnData, FirestoreQueryKey> };

/** Options this package always sets. */
type Managed = "queryKey" | "queryFn";

/** Options a realtime query owns: the listener decides freshness and retries. */
type RealtimeManaged =
	| Managed
	| "staleTime"
	| "retry"
	| "retryDelay"
	| "refetchInterval"
	| "refetchIntervalInBackground"
	| "refetchOnWindowFocus"
	| "refetchOnReconnect"
	| "networkMode";

type SnapshotReadOptions = {
	/** How pending `serverTimestamp()` values read. Default `"estimate"`. */
	serverTimestamps?: ServerTimestampBehavior;
};

/**
 * One-shot reads accept every TanStack option. Realtime reads
 * (`subscribe: true`) leave freshness, retries, and network mode to the
 * listener, so those options are not accepted.
 */
export type FirestoreReadOptions<TQueryFnData, TData> =
	| (SnapshotReadOptions & { subscribe?: false } & Omit<
				QueryOptions<TQueryFnData, TData>,
				Managed
			>)
	| (SnapshotReadOptions & { subscribe: true } & Omit<
				QueryOptions<TQueryFnData, TData>,
				RealtimeManaged
			>);

function readOptions<TQueryFnData, TData>(
	queryKey: FirestoreQueryKey,
	source: FirestoreSource | null,
	options: FirestoreReadOptions<TQueryFnData, TData> | undefined,
	oneShot: () => Promise<TQueryFnData>,
	read: (snapshot: DocumentSnapshot | QuerySnapshot) => TQueryFnData,
): QueryOptions<TQueryFnData, TData> {
	const {
		subscribe,
		serverTimestamps: _serverTimestamps,
		meta,
		...rest
	} = options ?? {};
	const shared = {
		...rest,
		queryKey,
		meta: source
			? { ...meta, firestoreQuery: { source } satisfies FirestoreQueryMeta }
			: meta,
	};
	if (!source) {
		return { networkMode: "always", ...shared, queryFn: skipToken };
	}
	if (subscribe) {
		return {
			...shared,
			queryFn: realtimeQueryFn(source, read),
			staleTime: Number.POSITIVE_INFINITY,
			retry: false,
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
			// The SDK queues offline work itself; TanStack must not pause it.
			networkMode: "always",
		};
	}
	return { networkMode: "always", ...shared, queryFn: oneShot };
}

/**
 * Options for one document. The key comes from the reference path; `null`
 * disables the query. A missing document reads as `null`.
 */
export function firestoreDocOptions<
	T,
	TData = T | null,
	D extends DocumentData = DocumentData,
>(
	ref: DocumentReference<T, D>,
	options?: FirestoreReadOptions<T | null, TData>,
): EnabledQueryOptions<T | null, TData>;
export function firestoreDocOptions<
	T,
	TData = T | null,
	D extends DocumentData = DocumentData,
>(
	ref: DocumentReference<T, D> | null,
	options?: FirestoreReadOptions<T | null, TData>,
): QueryOptions<T | null, TData>;
export function firestoreDocOptions<
	T,
	TData = T | null,
	D extends DocumentData = DocumentData,
>(
	ref: DocumentReference<T, D> | null,
	options?: FirestoreReadOptions<T | null, TData>,
): QueryOptions<T | null, TData> {
	const serverTimestamps =
		options?.serverTimestamps ?? DEFAULT_SERVER_TIMESTAMPS;
	return readOptions(
		docKey(ref as DocumentReference<unknown, DocumentData> | null),
		ref as FirestoreSource | null,
		options,
		() => fetchDoc(ref as DocumentReference<T, D>, serverTimestamps),
		(snapshot) =>
			readDoc(snapshot as DocumentSnapshot<T, DocumentData>, serverTimestamps),
	);
}

export type FirestoreQueryArgs<T, TData, D extends DocumentData> = {
	/** Build it with `collectionKeys(...).list(filters)`, every filter included. */
	queryKey: FirestoreQueryKey;
	query: Query<T, D> | null;
} & FirestoreReadOptions<T[], TData>;

/** Options for a Firestore query. `null` disables it. */
export function firestoreQueryOptions<
	T,
	TData = T[],
	D extends DocumentData = DocumentData,
>(
	args: FirestoreQueryArgs<T, TData, D> & { query: Query<T, D> },
): EnabledQueryOptions<T[], TData>;
export function firestoreQueryOptions<
	T,
	TData = T[],
	D extends DocumentData = DocumentData,
>(args: FirestoreQueryArgs<T, TData, D>): QueryOptions<T[], TData>;
export function firestoreQueryOptions<
	T,
	TData = T[],
	D extends DocumentData = DocumentData,
>({
	queryKey,
	query,
	...options
}: FirestoreQueryArgs<T, TData, D>): QueryOptions<T[], TData> {
	const serverTimestamps =
		options.serverTimestamps ?? DEFAULT_SERVER_TIMESTAMPS;
	return readOptions(
		queryKey,
		query as FirestoreSource | null,
		options as FirestoreReadOptions<T[], TData>,
		() => fetchDocs(query as Query<T, D>, serverTimestamps),
		(snapshot) =>
			readDocs(snapshot as QuerySnapshot<T, DocumentData>, serverTimestamps),
	);
}

type InfiniteOptions<T> = UseInfiniteQueryOptions<
	FirestorePage<T>,
	FirestoreQueryErrorType,
	InfiniteData<FirestorePage<T>, string | null>,
	FirestoreQueryKey,
	string | null
>;

/** Infinite options from a non-null query; see `EnabledQueryOptions`. */
export type EnabledInfiniteQueryOptions<T> = InfiniteOptions<T> & {
	queryFn: QueryFunction<FirestorePage<T>, FirestoreQueryKey, string | null>;
};

export type FirestoreInfiniteQueryArgs<T, D extends DocumentData> = {
	/** Build it with `collectionKeys(...).infinite(filters)`. */
	queryKey: FirestoreQueryKey;
	/** Ordered query without `limit`; the page size is added per page. */
	query: Query<T, D> | null;
	pageSize: number;
} & SnapshotReadOptions &
	Omit<
		InfiniteOptions<T>,
		Managed | "initialPageParam" | "getNextPageParam" | "getPreviousPageParam"
	>;

/**
 * Options for a one-shot paginated query. Pages continue after the last
 * document of the previous page; a page shorter than `pageSize` is the last.
 */
export function firestoreInfiniteQueryOptions<
	T,
	D extends DocumentData = DocumentData,
>(
	args: FirestoreInfiniteQueryArgs<T, D> & { query: Query<T, D> },
): EnabledInfiniteQueryOptions<T>;
export function firestoreInfiniteQueryOptions<
	T,
	D extends DocumentData = DocumentData,
>(args: FirestoreInfiniteQueryArgs<T, D>): InfiniteOptions<T>;
export function firestoreInfiniteQueryOptions<
	T,
	D extends DocumentData = DocumentData,
>({
	queryKey,
	query,
	pageSize,
	serverTimestamps = DEFAULT_SERVER_TIMESTAMPS,
	meta,
	...rest
}: FirestoreInfiniteQueryArgs<T, D>): InfiniteOptions<T> {
	return {
		networkMode: "always",
		...rest,
		queryKey,
		meta: query
			? {
					...meta,
					firestoreQuery: {
						source: query as FirestoreSource,
					} satisfies FirestoreQueryMeta,
				}
			: meta,
		initialPageParam: null,
		getNextPageParam: (page) => page.cursor ?? undefined,
		queryFn: query
			? ({ client, pageParam }) =>
					fetchPage(client, query, pageSize, pageParam, serverTimestamps)
			: skipToken,
	};
}

export type FirestoreAggregateArgs<
	S extends AggregateSpec,
	T,
	TData,
	D extends DocumentData,
> = {
	/** Build it with `collectionKeys(...).aggregate(filters)`. */
	queryKey: FirestoreQueryKey;
	query: Query<T, D> | null;
	/** For example `{ count: count(), total: sum("amount") }`. */
	aggregate: S;
} & Omit<QueryOptions<AggregateSpecData<S>, TData>, Managed>;

/** Options for a one-shot `count`/`sum`/`average` query. */
export function firestoreAggregateOptions<
	S extends AggregateSpec,
	T,
	TData = AggregateSpecData<S>,
	D extends DocumentData = DocumentData,
>(
	args: FirestoreAggregateArgs<S, T, TData, D> & { query: Query<T, D> },
): EnabledQueryOptions<AggregateSpecData<S>, TData>;
export function firestoreAggregateOptions<
	S extends AggregateSpec,
	T,
	TData = AggregateSpecData<S>,
	D extends DocumentData = DocumentData,
>(
	args: FirestoreAggregateArgs<S, T, TData, D>,
): QueryOptions<AggregateSpecData<S>, TData>;
export function firestoreAggregateOptions<
	S extends AggregateSpec,
	T,
	TData = AggregateSpecData<S>,
	D extends DocumentData = DocumentData,
>({
	queryKey,
	query,
	aggregate,
	meta,
	...rest
}: FirestoreAggregateArgs<S, T, TData, D>): QueryOptions<
	AggregateSpecData<S>,
	TData
> {
	return {
		networkMode: "always",
		...rest,
		queryKey,
		meta: query
			? {
					...meta,
					firestoreQuery: {
						source: query as FirestoreSource,
					} satisfies FirestoreQueryMeta,
				}
			: meta,
		queryFn: query ? () => fetchAggregate(query, aggregate) : skipToken,
	};
}
