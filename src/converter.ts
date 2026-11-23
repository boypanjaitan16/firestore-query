import type {
	DocumentData,
	FirestoreDataConverter,
	QueryDocumentSnapshot,
	WithFieldValue,
} from "firebase/firestore";

export type ConverterDefinition<T, DbModel extends DocumentData> = {
	/** Maps stored data to the app model. `data` is already read with the hook's snapshot options. */
	fromFirestore: (
		data: DbModel,
		id: string,
		snapshot: QueryDocumentSnapshot<DocumentData, DocumentData>,
	) => T;
	/** Maps the app model for `setDoc`/`addDoc`. Defaults to passing it through. */
	toFirestore?: (value: WithFieldValue<T>) => WithFieldValue<DbModel>;
};

/**
 * A converter that always forwards the snapshot options, so the
 * `serverTimestamps` behavior a hook asks for reaches the stored data. A
 * hand-written converter that calls `snapshot.data()` without them reads
 * pending server timestamps as `null`.
 */
export function defineConverter<T, DbModel extends DocumentData = DocumentData>(
	definition: ConverterDefinition<T, DbModel>,
): FirestoreDataConverter<T, DbModel> {
	return {
		fromFirestore(snapshot, options) {
			return definition.fromFirestore(
				snapshot.data(options) as DbModel,
				snapshot.id,
				snapshot,
			);
		},
		toFirestore(value: WithFieldValue<T>) {
			return definition.toFirestore
				? definition.toFirestore(value)
				: (value as unknown as WithFieldValue<DbModel>);
		},
	} as FirestoreDataConverter<T, DbModel>;
}

type TimestampLike = { toDate: () => Date };

function isTimestampLike(value: unknown): value is TimestampLike {
	return (
		typeof value === "object" &&
		value !== null &&
		"toDate" in value &&
		typeof value.toDate === "function"
	);
}

/** A Firestore `Timestamp` as a `Date`, or `null` for any other value. */
export function timestampToDate(value: unknown): Date | null {
	return isTimestampLike(value) ? value.toDate() : null;
}

/** A Firestore `Timestamp` as an ISO string, or `null` for any other value. */
export function timestampToIso(value: unknown): string | null {
	return timestampToDate(value)?.toISOString() ?? null;
}
