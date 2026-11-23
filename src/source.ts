import {
	type DocumentData,
	type DocumentReference,
	type DocumentSnapshot,
	type Query,
	type QuerySnapshot,
	queryEqual,
	refEqual,
	type SnapshotOptions,
} from "firebase/firestore";

export type ServerTimestampBehavior = NonNullable<
	SnapshotOptions["serverTimestamps"]
>;

/** What a query reads: one document or a Firestore query. */
export type FirestoreSource =
	| DocumentReference<unknown, DocumentData>
	| Query<unknown, DocumentData>;

/** Stored under `meta.firestoreQuery` of every query this package builds. */
export type FirestoreQueryMeta = { source: FirestoreSource };

export const DEFAULT_SERVER_TIMESTAMPS: ServerTimestampBehavior = "estimate";

export function isDocumentSource(
	source: FirestoreSource,
): source is DocumentReference<unknown, DocumentData> {
	return source.type === "document";
}

export function sameSource(a: FirestoreSource, b: FirestoreSource): boolean {
	if (isDocumentSource(a)) return isDocumentSource(b) && refEqual(a, b);
	return !isDocumentSource(b) && queryEqual(a, b);
}

export function sourceOf(meta: unknown): FirestoreSource | undefined {
	if (typeof meta !== "object" || meta === null) return undefined;
	const value = (meta as { firestoreQuery?: FirestoreQueryMeta })
		.firestoreQuery;
	return value?.source;
}

/** A document as plain data, `null` when it does not exist. */
export function readDoc<T>(
	snapshot: DocumentSnapshot<T, DocumentData>,
	serverTimestamps: ServerTimestampBehavior,
): T | null {
	return snapshot.exists() ? (snapshot.data({ serverTimestamps }) as T) : null;
}

export function readDocs<T>(
	snapshot: QuerySnapshot<T, DocumentData>,
	serverTimestamps: ServerTimestampBehavior,
): T[] {
	return snapshot.docs.map((item) => item.data({ serverTimestamps }));
}
