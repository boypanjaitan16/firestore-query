import { act, renderHook, waitFor } from "@testing-library/react";
import * as firestore from "firebase/firestore";
import { collection, doc } from "firebase/firestore";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCursorSnapshots } from "./fetchers";
import { removeFirestoreQueries } from "./invalidation";
import { collectionGroupKeys, collectionKeys, docKey } from "./keys";
import {
	useAddDoc,
	useDeleteDoc,
	useFirestoreInfiniteQuery,
	useFirestoreMutation,
	useUpdateDoc,
} from "./react";
import { fakeDocSnapshot, testClient, testDb, wrapper } from "./testing";

vi.mock("firebase/firestore", async (importOriginal) => {
	const actual = await importOriginal<typeof import("firebase/firestore")>();
	return {
		...actual,
		getDoc: vi.fn(),
		getDocs: vi.fn(),
		query: vi.fn(actual.query),
		limit: vi.fn(actual.limit),
		startAfter: vi.fn(actual.startAfter),
		updateDoc: vi.fn(async () => {}),
		deleteDoc: vi.fn(async () => {}),
		addDoc: vi.fn(),
	};
});

afterEach(() => {
	vi.clearAllMocks();
});

const db = testDb();
const leadKeys = collectionKeys("leads");
const activityKeys = collectionKeys("leads/{leadId}/activities");
const groupKeys = collectionGroupKeys("activities");

/** A client with data under every key a lead write can touch. */
function seeded() {
	const client = testClient();
	const keys = {
		lead: leadKeys.doc({ id: "x" }),
		otherLead: leadKeys.doc({ id: "y" }),
		list: leadKeys.list({ status: "NEW" }),
		count: leadKeys.aggregate(),
		activities: activityKeys.infinite({ leadId: "x" }),
		otherActivities: activityKeys.infinite({ leadId: "y" }),
		group: groupKeys.list(),
		unrelated: ["admin", "spend"],
	};
	for (const key of Object.values(keys)) client.setQueryData(key, "cached");
	const invalidated = (key: readonly unknown[]) =>
		client.getQueryState(key)?.isInvalidated ?? false;
	return { client, keys, invalidated };
}

describe("write hooks", () => {
	it("updateDoc invalidates the document and its collection, not its parent or siblings", async () => {
		const { client, keys, invalidated } = seeded();
		const view = renderHook(() => useUpdateDoc(), {
			wrapper: wrapper(client),
		});
		await act(() =>
			view.result.current.mutateAsync({
				ref: doc(db, "leads", "x"),
				data: { note: "hi" },
			}),
		);
		expect(firestore.updateDoc).toHaveBeenCalledTimes(1);
		expect(invalidated(keys.lead)).toBe(true);
		expect(invalidated(keys.list)).toBe(true);
		expect(invalidated(keys.count)).toBe(true);
		expect(invalidated(keys.otherLead)).toBe(false);
		expect(invalidated(keys.activities)).toBe(false);
		expect(invalidated(keys.unrelated)).toBe(false);
	});

	it("deleteDoc sets the document to null", async () => {
		const { client, keys, invalidated } = seeded();
		const view = renderHook(() => useDeleteDoc(), {
			wrapper: wrapper(client),
		});
		await act(() =>
			view.result.current.mutateAsync({ ref: doc(db, "leads", "x") }),
		);
		expect(client.getQueryData(keys.lead)).toBeNull();
		expect(invalidated(keys.list)).toBe(true);
	});

	it("addDoc to a subcollection invalidates that subcollection and its group", async () => {
		const { client, keys, invalidated } = seeded();
		const created = doc(db, "leads", "x", "activities", "a9");
		vi.mocked(firestore.addDoc).mockResolvedValueOnce(created);
		const view = renderHook(() => useAddDoc(), { wrapper: wrapper(client) });
		const result = await act(() =>
			view.result.current.mutateAsync({
				ref: collection(db, "leads", "x", "activities"),
				data: { type: "NOTE" },
			}),
		);
		expect(result).toBe(created);
		expect(invalidated(keys.activities)).toBe(true);
		expect(invalidated(keys.group)).toBe(true);
		expect(invalidated(keys.otherActivities)).toBe(false);
		expect(invalidated(keys.list)).toBe(false);
	});

	it("useFirestoreMutation invalidates what touches declares, then runs onSuccess", async () => {
		const { client, keys, invalidated } = seeded();
		const order: string[] = [];
		const view = renderHook(
			() =>
				useFirestoreMutation({
					mutationFn: async (leadId: string) => leadId,
					touches: (leadId) => [
						doc(db, "leads", leadId),
						collection(db, "leads", leadId, "activities"),
					],
					onSuccess: () => {
						order.push(invalidated(keys.lead) ? "after" : "before");
					},
				}),
			{ wrapper: wrapper(client) },
		);
		await act(() => view.result.current.mutateAsync("x"));
		expect(order).toEqual(["after"]);
		expect(invalidated(keys.activities)).toBe(true);
		expect(invalidated(keys.otherActivities)).toBe(false);
	});

	it("skips invalidation with invalidate: false", async () => {
		const { client, keys, invalidated } = seeded();
		const view = renderHook(() => useUpdateDoc({ invalidate: false }), {
			wrapper: wrapper(client),
		});
		await act(() =>
			view.result.current.mutateAsync({
				ref: doc(db, "leads", "x"),
				data: { note: "hi" },
			}),
		);
		expect(invalidated(keys.lead)).toBe(false);
	});

	it("removeFirestoreQueries removes only Firestore keys", () => {
		const { client, keys } = seeded();
		removeFirestoreQueries(client);
		expect(client.getQueryData(keys.lead)).toBeUndefined();
		expect(client.getQueryData(keys.unrelated)).toBe("cached");
		expect(client.getQueryData(docKey(null))).toBeUndefined();
	});
});

describe("infinite queries", () => {
	const source = collection(db, "leads", "x", "activities");
	const docs = (ids: string[]) =>
		ids.map((id) => ({
			...fakeDocSnapshot({
				path: `leads/x/activities/${id}`,
				data: { id },
			}),
		}));

	function mockPages() {
		const token = (name: string) => ({ name }) as never;
		vi.mocked(firestore.query).mockImplementation(
			((...parts: unknown[]) => parts) as never,
		);
		vi.mocked(firestore.limit).mockImplementation(
			(size: number) => token(`limit:${size}`) as never,
		);
		vi.mocked(firestore.startAfter).mockImplementation(((snapshot: {
			ref: { path: string };
		}) => token(`after:${snapshot.ref.path}`)) as never);
	}

	it("pages with the last document as cursor and stops on a short page", async () => {
		mockPages();
		const client = testClient();
		vi.mocked(firestore.getDocs)
			.mockResolvedValueOnce({ docs: docs(["a", "b"]) } as never)
			.mockResolvedValueOnce({ docs: docs(["c"]) } as never);
		const view = renderHook(
			() =>
				useFirestoreInfiniteQuery({
					queryKey: activityKeys.infinite({ leadId: "x" }),
					query: source,
					pageSize: 2,
				}),
			{ wrapper: wrapper(client) },
		);
		await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
		expect(view.result.current.hasNextPage).toBe(true);
		await act(() => view.result.current.fetchNextPage());
		await waitFor(() =>
			expect(view.result.current.data?.pages).toHaveLength(2),
		);
		expect(view.result.current.data?.pages[1]).toEqual({
			items: [{ id: "c" }],
			cursor: null,
		});
		expect(view.result.current.hasNextPage).toBe(false);
		expect(firestore.startAfter).toHaveBeenCalledTimes(1);
		expect(firestore.getDoc).not.toHaveBeenCalled();
	});

	it("reads the cursor document again when its snapshot is gone", async () => {
		mockPages();
		const client = testClient();
		vi.mocked(firestore.getDocs)
			.mockResolvedValueOnce({ docs: docs(["a", "b"]) } as never)
			.mockResolvedValueOnce({ docs: docs([]) } as never);
		vi.mocked(firestore.getDoc).mockResolvedValueOnce(
			fakeDocSnapshot({
				path: "leads/x/activities/b",
				data: { id: "b" },
			}) as never,
		);
		const view = renderHook(
			() =>
				useFirestoreInfiniteQuery({
					queryKey: activityKeys.infinite({ leadId: "x" }),
					query: source,
					pageSize: 2,
				}),
			{ wrapper: wrapper(client) },
		);
		await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
		// useQuery re-renders only for props the test has read.
		expect(view.result.current.data?.pages).toHaveLength(1);
		clearCursorSnapshots(client);
		await act(() => view.result.current.fetchNextPage());
		await waitFor(() =>
			expect(view.result.current.data?.pages).toHaveLength(2),
		);
		expect(firestore.getDoc).toHaveBeenCalledTimes(1);
	});

	it("fails with cursor-missing when the cursor document was deleted", async () => {
		mockPages();
		const client = testClient();
		vi.mocked(firestore.getDocs).mockResolvedValueOnce({
			docs: docs(["a", "b"]),
		} as never);
		vi.mocked(firestore.getDoc).mockResolvedValueOnce(
			fakeDocSnapshot({ path: "leads/x/activities/b" }) as never,
		);
		const view = renderHook(
			() =>
				useFirestoreInfiniteQuery({
					queryKey: activityKeys.infinite({ leadId: "x" }),
					query: source,
					pageSize: 2,
				}),
			{ wrapper: wrapper(client) },
		);
		await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
		// useQuery re-renders only for props the test has read.
		expect(view.result.current.data?.pages).toHaveLength(1);
		clearCursorSnapshots(client);
		await act(() => view.result.current.fetchNextPage());
		await waitFor(() =>
			expect(view.result.current.error).toMatchObject({
				code: "cursor-missing",
			}),
		);
	});
});
