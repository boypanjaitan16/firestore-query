import {
	type QueryDocumentSnapshot,
	type SnapshotOptions,
	Timestamp,
} from "firebase/firestore";
import { describe, expect, it, vi } from "vitest";
import { defineConverter, timestampToDate, timestampToIso } from "./converter";

describe("defineConverter", () => {
	it("forwards snapshot options and supplies the id", () => {
		const data = vi.fn(() => ({ title: "Hello" }));
		const snapshot = { id: "a1", data } as unknown as QueryDocumentSnapshot;
		const converter = defineConverter<{ id: string; title: string }>({
			fromFirestore: (stored, id) => ({ id, title: String(stored.title) }),
		});
		const options: SnapshotOptions = { serverTimestamps: "estimate" };

		expect(converter.fromFirestore(snapshot, options)).toEqual({
			id: "a1",
			title: "Hello",
		});
		expect(data).toHaveBeenCalledWith(options);
	});

	it("passes values through toFirestore unless one is given", () => {
		const plain = defineConverter<{ title: string }>({
			fromFirestore: (stored) => ({ title: String(stored.title) }),
		});
		expect(plain.toFirestore({ title: "x" })).toEqual({ title: "x" });

		const mapped = defineConverter<{ title: string }>({
			fromFirestore: (stored) => ({ title: String(stored.title) }),
			toFirestore: (value) => ({ heading: value.title }),
		});
		expect(mapped.toFirestore({ title: "x" })).toEqual({ heading: "x" });
	});
});

describe("timestamp helpers", () => {
	const when = new Date("2026-11-22T10:00:00.000Z");

	it("converts timestamps", () => {
		const timestamp = Timestamp.fromDate(when);
		expect(timestampToIso(timestamp)).toBe("2026-11-22T10:00:00.000Z");
		expect(timestampToDate(timestamp)?.getTime()).toBe(when.getTime());
	});

	it("returns null for anything else", () => {
		for (const value of [null, undefined, "2026-11-22", 0, {}]) {
			expect(timestampToIso(value)).toBeNull();
			expect(timestampToDate(value)).toBeNull();
		}
	});
});
