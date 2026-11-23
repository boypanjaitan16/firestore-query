import { collection, doc } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import {
	collectionGroupKeys,
	collectionKeys,
	collectionOf,
	docKey,
} from "./keys";
import { testDb } from "./testing";

describe("collectionKeys", () => {
	it("builds keys under the collection path with filters last", () => {
		const keys = collectionKeys("contactMessages");
		expect(keys.all()).toEqual(["firestore", "contactMessages"]);
		expect(keys.list()).toEqual(["firestore", "contactMessages", "list", {}]);
		expect(keys.list({ status: "NEW" })).toEqual([
			"firestore",
			"contactMessages",
			"list",
			{ status: "NEW" },
		]);
		expect(keys.aggregate({ status: "NEW" })[2]).toBe("aggregate");
		expect(keys.infinite()[2]).toBe("infinite");
	});

	it("fills placeholders and keeps them out of the filters", () => {
		const keys = collectionKeys("leads/{leadId}/activities");
		expect(keys.path({ leadId: "abc" })).toBe("leads/abc/activities");
		expect(keys.infinite({ leadId: "abc", type: "SENT" })).toEqual([
			"firestore",
			"leads/abc/activities",
			"infinite",
			{ type: "SENT" },
		]);
	});

	it("builds the same doc key as a document reference", () => {
		const db = testDb();
		expect(collectionKeys("leads").doc({ id: "x" })).toEqual(
			docKey(doc(db, "leads", "x")),
		);
		expect(
			collectionKeys("leads/{leadId}/activities").doc({
				leadId: "x",
				id: "a1",
			}),
		).toEqual(docKey(doc(db, "leads", "x", "activities", "a1")));
	});

	it("never collides when document IDs look like key kinds", () => {
		const subcollection = collectionKeys("leads/{leadId}/activities").all({
			leadId: "list",
		});
		const parentList = collectionKeys("leads").list();
		expect(subcollection[1]).toBe("leads/list/activities");
		expect(parentList.slice(0, subcollection.length)).not.toEqual(
			subcollection,
		);
	});

	it("rejects document paths and unsafe path params", () => {
		expect(() => collectionKeys("leads/x")).toThrow(/not a collection path/);
		const keys = collectionKeys("leads/{leadId}/activities");
		expect(() => keys.path({ leadId: "a/b" })).toThrow(/without "\/"/);
		expect(() => keys.path({ leadId: "" })).toThrow(/non-empty/);
	});
});

describe("collectionGroupKeys and helpers", () => {
	it("keys a collection group under */<id>", () => {
		expect(collectionGroupKeys("activities").list({ type: "SENT" })).toEqual([
			"firestore",
			"*/activities",
			"list",
			{ type: "SENT" },
		]);
	});

	it("gives a null key to a missing reference", () => {
		expect(docKey(null)).toEqual(["firestore", null, "doc", null]);
	});

	it("finds the collection of documents and collections", () => {
		const db = testDb();
		expect(collectionOf(doc(db, "leads", "x", "activities", "a"))).toEqual({
			path: "leads/x/activities",
			id: "activities",
		});
		expect(collectionOf(collection(db, "leads"))).toEqual({
			path: "leads",
			id: "leads",
		});
	});
});
