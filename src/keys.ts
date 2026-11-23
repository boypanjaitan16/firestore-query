import type {
	CollectionReference,
	DocumentData,
	DocumentReference,
} from "firebase/firestore";

/** The first element of every key this package builds or invalidates. */
export const FIRESTORE_ROOT = "firestore";

export type FirestoreKeyKind = "doc" | "list" | "infinite" | "aggregate";

/** Kinds that read many documents and go stale when any of them changes. */
export const COLLECTION_KINDS = ["list", "infinite", "aggregate"] as const;

/**
 * `["firestore", collectionPath, kind, ...]`. The collection path is one
 * string, so a document ID such as `"doc"` can never collide with a kind.
 */
export type FirestoreQueryKey = readonly [
	typeof FIRESTORE_ROOT,
	string | null,
	...unknown[],
];

type PathParams<P extends string> =
	P extends `${string}{${infer Name}}${infer Rest}`
		? { [Key in Name]: string } & PathParams<Rest>
		: unknown;

type Filters = Record<string, unknown>;

type KeyArgs<P extends string> = keyof PathParams<P> extends never
	? [params?: Filters]
	: [params: PathParams<P> & Filters];

type DocArgs<P extends string> = keyof PathParams<P> extends never
	? [params: { id: string }]
	: [params: PathParams<P> & { id: string }];

const placeholder = /^\{([A-Za-z_$][\w$]*)\}$/;

function assertSegment(value: unknown, name: string): string {
	if (typeof value !== "string" || value === "" || value.includes("/")) {
		throw new Error(
			`Path parameter "${name}" must be a non-empty string without "/".`,
		);
	}
	return value;
}

/** Splits key params into the path placeholders and the remaining filters. */
function resolve(segments: string[], params: Filters = {}) {
	const filters: Filters = { ...params };
	const path = segments
		.map((segment) => {
			const match = placeholder.exec(segment);
			if (!match) return segment;
			const name = match[1] as string;
			const value = assertSegment(params[name], name);
			delete filters[name];
			return value;
		})
		.join("/");
	return { path, filters };
}

/** The key of one document, the same one `collectionKeys(...).doc()` builds. */
export function docKey(
	ref: DocumentReference<unknown, DocumentData> | null,
): FirestoreQueryKey {
	if (!ref) return [FIRESTORE_ROOT, null, "doc", null];
	return [FIRESTORE_ROOT, ref.parent.path, "doc", ref.id];
}

/** The path of a collection group key: `"*" + "/" + collectionId`. */
export function groupPath(collectionId: string): string {
	return `*/${collectionId}`;
}

/** The collection a reference lives in (a collection is its own). */
export function collectionOf(
	ref:
		| DocumentReference<unknown, DocumentData>
		| CollectionReference<unknown, DocumentData>,
): { path: string; id: string } {
	const collection = ref.type === "document" ? ref.parent : ref;
	return { path: collection.path, id: collection.id };
}

/**
 * Typed keys for one collection path. Placeholders in braces are filled from
 * the params; every other param becomes part of the key as a filter.
 *
 * ```ts
 * const activityKeys = collectionKeys("leads/{leadId}/activities");
 * activityKeys.infinite({ leadId }); // ["firestore", "leads/x/activities", "infinite", {}]
 * ```
 */
export function collectionKeys<P extends string>(pattern: P) {
	const segments = pattern.split("/");
	if (segments.length % 2 === 0 || segments.some((segment) => !segment)) {
		throw new Error(`"${pattern}" is not a collection path.`);
	}
	const build =
		(kind: Exclude<FirestoreKeyKind, "doc">) =>
		(...[params]: KeyArgs<P>): FirestoreQueryKey => {
			const { path, filters } = resolve(segments, params as Filters);
			return [FIRESTORE_ROOT, path, kind, filters];
		};
	return {
		/** The resolved collection path. */
		path: (...[params]: KeyArgs<P>): string =>
			resolve(segments, params as Filters).path,
		/** Prefix of every key under this collection path. */
		all: (...[params]: KeyArgs<P>): FirestoreQueryKey => [
			FIRESTORE_ROOT,
			resolve(segments, params as Filters).path,
		],
		list: build("list"),
		infinite: build("infinite"),
		aggregate: build("aggregate"),
		doc: (...[params]: DocArgs<P>): FirestoreQueryKey => {
			const { path } = resolve(segments, params as Filters);
			return [FIRESTORE_ROOT, path, "doc", assertSegment(params.id, "id")];
		},
	};
}

/**
 * Keys for a collection group query. Writes to any collection with this ID
 * invalidate them.
 */
export function collectionGroupKeys(collectionId: string) {
	const path = groupPath(assertSegment(collectionId, "collectionId"));
	const build =
		(kind: Exclude<FirestoreKeyKind, "doc">) =>
		(filters: Filters = {}): FirestoreQueryKey => [
			FIRESTORE_ROOT,
			path,
			kind,
			filters,
		];
	return {
		path: () => path,
		all: (): FirestoreQueryKey => [FIRESTORE_ROOT, path],
		list: build("list"),
		infinite: build("infinite"),
		aggregate: build("aggregate"),
	};
}
