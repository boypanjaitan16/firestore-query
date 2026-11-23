import type { QueryClient } from "@tanstack/react-query";
import type {
	CollectionReference,
	DocumentData,
	DocumentReference,
} from "firebase/firestore";
import { clearCursorSnapshots } from "./fetchers";
import {
	COLLECTION_KINDS,
	collectionOf,
	docKey,
	FIRESTORE_ROOT,
	groupPath,
} from "./keys";

export type WriteKind = "set" | "update" | "delete" | "add" | "touch";

export type WriteTarget =
	| DocumentReference<unknown, DocumentData>
	| CollectionReference<unknown, DocumentData>;

/**
 * Updates the cache after writes succeed:
 *
 * - a written document: its doc key is invalidated, or set to `null` on delete
 *   (the write model cannot stand in for the read model, so data is never
 *   copied into the cache);
 * - its collection and collection group: every list, infinite, and aggregate
 *   key is invalidated;
 * - a collection reference: only its lists, infinite queries, and aggregates.
 *
 * Parent documents are left alone; Firestore has no cascade. Realtime queries
 * ignore the invalidation while their listener runs.
 */
export function invalidateForWrites(
	client: QueryClient,
	targets: readonly WriteTarget[],
	kind: WriteKind,
) {
	const collections = new Set<string>();
	for (const target of targets) {
		if (target.type === "document") {
			const key = docKey(target);
			if (kind === "delete") {
				if (client.getQueryData(key) !== undefined)
					client.setQueryData(key, null);
			} else {
				void client.invalidateQueries({ queryKey: key, exact: true });
			}
		}
		const { path, id } = collectionOf(target);
		collections.add(path);
		collections.add(groupPath(id));
	}
	for (const path of collections) {
		for (const collectionKind of COLLECTION_KINDS) {
			void client.invalidateQueries({
				queryKey: [FIRESTORE_ROOT, path, collectionKind],
			});
		}
	}
}

/**
 * Removes every Firestore query and stops their listeners. Call it before
 * signing out, so no listener outlives the session and fails with
 * `permission-denied`.
 */
export function removeFirestoreQueries(client: QueryClient) {
	client.removeQueries({ queryKey: [FIRESTORE_ROOT] });
	clearCursorSnapshots(client);
}
