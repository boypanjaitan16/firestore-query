import type { QueryClient } from "@tanstack/react-query";
import {
	type AggregateSpec,
	type AggregateSpecData,
	type DocumentData,
	type DocumentReference,
	type DocumentSnapshot,
	doc,
	getAggregateFromServer,
	getDoc,
	getDocs,
	limit,
	type Query,
	query,
	startAfter,
} from "firebase/firestore";
import { FirestoreQueryError } from "./errors";
import { readDoc, readDocs, type ServerTimestampBehavior } from "./source";

export async function fetchDoc<T, D extends DocumentData>(
	ref: DocumentReference<T, D>,
	serverTimestamps: ServerTimestampBehavior,
): Promise<T | null> {
	return readDoc(
		(await getDoc(ref)) as DocumentSnapshot<T, DocumentData>,
		serverTimestamps,
	);
}

export async function fetchDocs<T, D extends DocumentData>(
	source: Query<T, D>,
	serverTimestamps: ServerTimestampBehavior,
): Promise<T[]> {
	const snapshot = await getDocs(source);
	return snapshot.docs.map((item) => item.data({ serverTimestamps }));
}

export async function fetchAggregate<
	S extends AggregateSpec,
	T,
	D extends DocumentData,
>(source: Query<T, D>, spec: S): Promise<AggregateSpecData<S>> {
	return (await getAggregateFromServer(source, spec)).data();
}

/** One page of an infinite query. `cursor` is the path of its last document. */
export type FirestorePage<T> = { items: T[]; cursor: string | null };

// Snapshots of the last document of each page, kept in memory only: the page
// param is the document path, so it survives a persisted cache, and a missing
// snapshot costs one `getDoc`.
const cursors = new WeakMap<QueryClient, Map<string, DocumentSnapshot>>();

function cursorStore(client: QueryClient) {
	let store = cursors.get(client);
	if (!store) {
		store = new Map();
		cursors.set(client, store);
	}
	return store;
}

export function clearCursorSnapshots(client: QueryClient) {
	cursors.get(client)?.clear();
}

export async function fetchPage<T, D extends DocumentData>(
	client: QueryClient,
	source: Query<T, D>,
	pageSize: number,
	cursor: string | null,
	serverTimestamps: ServerTimestampBehavior,
): Promise<FirestorePage<T>> {
	const store = cursorStore(client);
	let page = query(source, limit(pageSize));
	if (cursor) {
		let after = store.get(cursor);
		if (!after) {
			after = await getDoc(doc(source.firestore, cursor));
			if (!after.exists()) {
				throw new FirestoreQueryError(
					"cursor-missing",
					`The page cursor ${cursor} no longer exists. Refetch the query from its first page.`,
				);
			}
		}
		page = query(source, startAfter(after), limit(pageSize));
	}
	const snapshot = await getDocs(page);
	const last = snapshot.docs.at(-1);
	if (last) store.set(last.ref.path, last as DocumentSnapshot);
	return {
		items: readDocs(snapshot, serverTimestamps),
		cursor: last && snapshot.docs.length === pageSize ? last.ref.path : null,
	};
}
