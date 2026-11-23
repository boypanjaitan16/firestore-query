import type {
	Query as CachedQuery,
	QueryClient,
	QueryFunctionContext,
} from "@tanstack/react-query";
import {
	type DocumentData,
	type DocumentSnapshot,
	type FirestoreError,
	onSnapshot,
	type QuerySnapshot,
} from "firebase/firestore";
import { FirestoreQueryError } from "./errors";
import {
	type FirestoreSource,
	isDocumentSource,
	sameSource,
	sourceOf,
} from "./source";

export type AttachFirestoreListenersOptions = {
	/**
	 * How long a listener keeps running after its last observer unmounts, in
	 * milliseconds. Long enough to survive a StrictMode double mount or a quick
	 * list → detail → list navigation. Default 2000.
	 */
	unsubscribeDelay?: number;
	/**
	 * Warn when one query key is used for two different Firestore sources.
	 * Defaults to `process.env.NODE_ENV !== "production"` when `process` exists;
	 * Vite apps pass `import.meta.env.DEV`.
	 */
	devWarnings?: boolean;
};

type Entry = {
	source: FirestoreSource;
	received: boolean;
	first: Promise<unknown>;
	unsubscribe: () => void;
	timer?: ReturnType<typeof setTimeout>;
};

type Registry = {
	entries: Map<CachedQuery, Entry>;
	unsubscribeDelay: number;
	devWarnings: boolean;
	detach: () => void;
};

const registries = new WeakMap<QueryClient, Registry>();

function defaultDevWarnings(): boolean {
	const env = (
		globalThis as { process?: { env?: Record<string, string | undefined> } }
	).process?.env;
	return env !== undefined && env.NODE_ENV !== "production";
}

function warnOnMismatch(
	registry: Registry,
	entry: Entry,
	source: FirestoreSource | undefined,
	query: CachedQuery,
) {
	if (!registry.devWarnings || !source || sameSource(entry.source, source))
		return;
	// biome-ignore lint/suspicious/noConsole: development-only diagnostic
	console.warn(
		`[firestore-query] The key ${JSON.stringify(query.queryKey)} is used for two different Firestore sources. Put every filter of the query in its key.`,
	);
}

function stop(
	registry: Registry,
	query: CachedQuery,
	entry: Entry,
	invalidate: boolean,
) {
	clearTimeout(entry.timer);
	entry.unsubscribe();
	if (registry.entries.get(query) === entry) registry.entries.delete(query);
	// Without a listener the cached data can fall behind, so the next mount
	// refetches, which starts a new listener, while it shows the cached data.
	if (invalidate) query.invalidate();
}

function scheduleStop(registry: Registry, query: CachedQuery, entry: Entry) {
	clearTimeout(entry.timer);
	entry.timer = setTimeout(() => {
		if (query.getObserversCount() === 0) stop(registry, query, entry, true);
	}, registry.unsubscribeDelay);
}

/**
 * Lets realtime queries (`subscribe: true`) keep their data in sync with
 * `onSnapshot`. Call it once per `QueryClient`; it returns a function that
 * detaches and stops every listener.
 */
export function attachFirestoreListeners(
	client: QueryClient,
	options: AttachFirestoreListenersOptions = {},
): () => void {
	const existing = registries.get(client);
	if (existing) return existing.detach;

	const registry: Registry = {
		entries: new Map(),
		unsubscribeDelay: options.unsubscribeDelay ?? 2000,
		devWarnings: options.devWarnings ?? defaultDevWarnings(),
		detach: () => {},
	};
	const unsubscribeCache = client.getQueryCache().subscribe((event) => {
		const entry = registry.entries.get(event.query);
		if (!entry) return;
		switch (event.type) {
			case "observerAdded":
				clearTimeout(entry.timer);
				entry.timer = undefined;
				warnOnMismatch(
					registry,
					entry,
					sourceOf(event.observer.options.meta),
					event.query,
				);
				break;
			case "observerRemoved":
				if (event.query.getObserversCount() === 0)
					scheduleStop(registry, event.query, entry);
				break;
			case "removed":
				stop(registry, event.query, entry, false);
				break;
		}
	});
	registry.detach = () => {
		unsubscribeCache();
		for (const [query, entry] of registry.entries)
			stop(registry, query, entry, false);
		registries.delete(client);
	};
	registries.set(client, registry);
	return registry.detach;
}

function start<T>(
	registry: Registry,
	client: QueryClient,
	query: CachedQuery,
	source: FirestoreSource,
	read: (snapshot: DocumentSnapshot | QuerySnapshot) => T,
): Promise<T> {
	let resolveFirst: (value: T) => void = () => {};
	let rejectFirst: (error: unknown) => void = () => {};
	const first = new Promise<T>((resolve, reject) => {
		resolveFirst = resolve;
		rejectFirst = reject;
	});
	const entry: Entry = {
		source,
		received: false,
		first,
		unsubscribe: () => {},
	};
	registry.entries.set(query, entry);

	const onNext = (snapshot: DocumentSnapshot | QuerySnapshot) => {
		const data = read(snapshot);
		if (!entry.received) {
			entry.received = true;
			resolveFirst(data);
		} else {
			client.setQueryData(query.queryKey, data);
		}
	};
	// The SDK does not retry a listener that failed (for example
	// `permission-denied`), so the entry is dropped and the next `refetch()`
	// or mount starts a new one.
	const onError = (error: FirestoreError) => {
		stop(registry, query, entry, false);
		if (!entry.received) {
			rejectFirst(error);
		} else {
			query.setState({
				...query.state,
				status: "error",
				error,
				errorUpdateCount: query.state.errorUpdateCount + 1,
				errorUpdatedAt: Date.now(),
				fetchStatus: "idle",
			});
		}
		query.invalidate();
	};
	const listenOptions = { includeMetadataChanges: false };
	entry.unsubscribe = isDocumentSource(source)
		? onSnapshot(
				source,
				listenOptions,
				onNext as (snapshot: DocumentSnapshot<unknown, DocumentData>) => void,
				onError,
			)
		: onSnapshot(
				source,
				listenOptions,
				onNext as (snapshot: QuerySnapshot<unknown, DocumentData>) => void,
				onError,
			);
	// Started without an observer (prefetch, fetchQuery): stop it unless one
	// mounts in time.
	if (query.getObserversCount() === 0) scheduleStop(registry, query, entry);
	return first;
}

/**
 * The `queryFn` of a realtime query. It resolves with the first snapshot and
 * later snapshots go straight into the cache. While the listener runs, a
 * refetch or invalidation returns the cached data instead of reading again.
 */
export function realtimeQueryFn<T>(
	source: FirestoreSource,
	read: (snapshot: DocumentSnapshot | QuerySnapshot) => T,
) {
	return (context: QueryFunctionContext): Promise<T> => {
		const { client, queryKey } = context;
		const registry = registries.get(client);
		if (!registry) {
			throw new FirestoreQueryError(
				"listeners-not-attached",
				"Realtime queries need attachFirestoreListeners(queryClient) once at startup.",
			);
		}
		const query = client.getQueryCache().find({ queryKey, exact: true });
		if (!query) {
			throw new Error(`No cached query for ${JSON.stringify(queryKey)}.`);
		}
		const entry = registry.entries.get(query);
		if (!entry) return start(registry, client, query, source, read);
		warnOnMismatch(registry, entry, source, query);
		return entry.received
			? Promise.resolve(query.state.data as T)
			: (entry.first as Promise<T>);
	};
}

/** Number of running listeners, for tests. */
export function activeListenerCount(client: QueryClient): number {
	return registries.get(client)?.entries.size ?? 0;
}
