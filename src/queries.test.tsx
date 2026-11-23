import {
	useQueryClient,
	useSuspenseInfiniteQuery,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import * as firestore from "firebase/firestore";
import { collection, doc, where } from "firebase/firestore";
import { type ReactNode, Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectionKeys, docKey } from "./keys";
import { activeListenerCount, attachFirestoreListeners } from "./listeners";
import {
	firestoreAggregateOptions,
	firestoreDocOptions,
	firestoreInfiniteQueryOptions,
	firestoreQueryOptions,
} from "./options";
import { useFirestoreDoc, useFirestoreQuery } from "./react";
import {
	fakeDocSnapshot,
	fakeQuerySnapshot,
	testClient,
	testDb,
	wrapper,
} from "./testing";

vi.mock("firebase/firestore", async (importOriginal) => {
	const actual = await importOriginal<typeof import("firebase/firestore")>();
	return {
		...actual,
		onSnapshot: vi.fn(),
		getDoc: vi.fn(),
		getDocs: vi.fn(),
	};
});

type Listener = {
	next: (snapshot: unknown) => void;
	error: (error: unknown) => void;
	unsubscribe: ReturnType<typeof vi.fn>;
};

const onSnapshot = vi.mocked(firestore.onSnapshot);
let listeners: Listener[];

beforeEach(() => {
	listeners = [];
	onSnapshot.mockImplementation(((
		_source: unknown,
		_options: unknown,
		next: Listener["next"],
		error: Listener["error"],
	) => {
		const unsubscribe = vi.fn();
		listeners.push({ next, error, unsubscribe });
		return unsubscribe;
	}) as unknown as typeof firestore.onSnapshot);
});

afterEach(() => {
	vi.clearAllMocks();
});

const db = testDb();
const messageKeys = collectionKeys("contactMessages");

function setup(options: { unsubscribeDelay?: number } = {}) {
	const client = testClient();
	const detach = attachFirestoreListeners(client, {
		unsubscribeDelay: options.unsubscribeDelay ?? 20,
		devWarnings: true,
	});
	return { client, detach };
}

function useMessages(subscribe = true) {
	return useFirestoreQuery({
		queryKey: messageKeys.list(),
		query: collection(db, "contactMessages"),
		subscribe,
	});
}

const emit = (listener: Listener | undefined, ...titles: string[]) =>
	act(() =>
		listener?.next(
			fakeQuerySnapshot(
				titles.map((title) => ({
					path: `contactMessages/${title}`,
					data: { title },
				})),
			),
		),
	);

describe("realtime queries", () => {
	it("shares one listener between observers and streams snapshots", async () => {
		const { client, detach } = setup();
		const first = renderHook(() => useMessages(), {
			wrapper: wrapper(client),
		});
		const second = renderHook(() => useMessages(), {
			wrapper: wrapper(client),
		});
		await waitFor(() => expect(listeners).toHaveLength(1));

		await emit(listeners[0], "a");
		await waitFor(() =>
			expect(first.result.current.data).toEqual([{ title: "a" }]),
		);
		expect(second.result.current.data).toEqual([{ title: "a" }]);

		await emit(listeners[0], "a", "b");
		await waitFor(() => expect(first.result.current.data).toHaveLength(2));
		expect(onSnapshot).toHaveBeenCalledTimes(1);
		detach();
	});

	it("stops the listener after the delay and refetches on the next mount", async () => {
		const { client, detach } = setup();
		const view = renderHook(() => useMessages(), { wrapper: wrapper(client) });
		await waitFor(() => expect(listeners).toHaveLength(1));
		await emit(listeners[0], "a");
		await waitFor(() => expect(view.result.current.isSuccess).toBe(true));

		view.unmount();
		expect(listeners[0]?.unsubscribe).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(listeners[0]?.unsubscribe).toHaveBeenCalledTimes(1),
		);
		expect(client.getQueryState(messageKeys.list())?.isInvalidated).toBe(true);

		const again = renderHook(() => useMessages(), {
			wrapper: wrapper(client),
		});
		expect(again.result.current.data).toEqual([{ title: "a" }]);
		await waitFor(() => expect(listeners).toHaveLength(2));
		detach();
	});

	it("keeps one listener through a StrictMode double mount", async () => {
		const { client, detach } = setup();
		renderHook(() => useMessages(), { wrapper: wrapper(client, true) });
		await waitFor(() => expect(listeners).toHaveLength(1));
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(listeners[0]?.unsubscribe).not.toHaveBeenCalled();
		expect(activeListenerCount(client)).toBe(1);
		detach();
	});

	it("stops at once when the query is removed", async () => {
		const { client, detach } = setup({ unsubscribeDelay: 10_000 });
		renderHook(() => useMessages(), { wrapper: wrapper(client) });
		await waitFor(() => expect(listeners).toHaveLength(1));
		client.removeQueries({ queryKey: ["firestore"] });
		expect(listeners[0]?.unsubscribe).toHaveBeenCalledTimes(1);
		expect(activeListenerCount(client)).toBe(0);
		detach();
	});

	it("ignores invalidation while the listener runs", async () => {
		const { client, detach } = setup();
		const view = renderHook(() => useMessages(), { wrapper: wrapper(client) });
		await waitFor(() => expect(listeners).toHaveLength(1));
		await emit(listeners[0], "a");
		await waitFor(() => expect(view.result.current.isSuccess).toBe(true));

		await act(() => client.invalidateQueries({ queryKey: messageKeys.all() }));
		expect(onSnapshot).toHaveBeenCalledTimes(1);
		expect(view.result.current.data).toEqual([{ title: "a" }]);
		detach();
	});

	it("surfaces a stream error, keeps the data, and restarts on refetch", async () => {
		const { client, detach } = setup();
		const view = renderHook(() => useMessages(), { wrapper: wrapper(client) });
		await waitFor(() => expect(listeners).toHaveLength(1));
		await emit(listeners[0], "a");
		await waitFor(() => expect(view.result.current.isSuccess).toBe(true));

		const denied = Object.assign(
			new Error("Missing or insufficient permissions."),
			{ code: "permission-denied", name: "FirebaseError" },
		);
		act(() => listeners[0]?.error(denied));
		await waitFor(() => expect(view.result.current.error).toBe(denied));
		expect(view.result.current.data).toEqual([{ title: "a" }]);
		expect(onSnapshot).toHaveBeenCalledTimes(1);

		await act(async () => {
			void view.result.current.refetch();
		});
		await waitFor(() => expect(listeners).toHaveLength(2));
		await emit(listeners[1], "a", "b");
		await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
		expect(view.result.current.data).toHaveLength(2);
		detach();
	});

	it("fails clearly without attachFirestoreListeners", async () => {
		const client = testClient();
		const view = renderHook(() => useMessages(), { wrapper: wrapper(client) });
		await waitFor(() => expect(view.result.current.isError).toBe(true));
		expect(view.result.current.error).toMatchObject({
			code: "listeners-not-attached",
		});
	});

	it("warns when one key is used for two different queries", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { client, detach } = setup();
		renderHook(() => useMessages(), { wrapper: wrapper(client) });
		await waitFor(() => expect(listeners).toHaveLength(1));
		renderHook(
			() =>
				useFirestoreQuery({
					queryKey: messageKeys.list(),
					query: firestore.query(
						collection(db, "contactMessages"),
						where("status", "==", "NEW"),
					),
					subscribe: true,
				}),
			{ wrapper: wrapper(client) },
		);
		await waitFor(() => expect(warn).toHaveBeenCalled());
		expect(String(warn.mock.calls[0]?.[0])).toMatch(/two different/);
		warn.mockRestore();
		detach();
	});

	it("reads a realtime document and maps a missing one to null", async () => {
		const { client, detach } = setup();
		const ref = doc(db, "contactMessages", "m1");
		const view = renderHook(() => useFirestoreDoc(ref, { subscribe: true }), {
			wrapper: wrapper(client),
		});
		await waitFor(() => expect(listeners).toHaveLength(1));
		act(() =>
			listeners[0]?.next(
				fakeDocSnapshot({ path: ref.path, data: { title: "a" } }),
			),
		);
		await waitFor(() =>
			expect(view.result.current.data).toEqual({ title: "a" }),
		);
		act(() => listeners[0]?.next(fakeDocSnapshot({ path: ref.path })));
		await waitFor(() => expect(view.result.current.data).toBeNull());
		detach();
	});
});

describe("one-shot reads", () => {
	it("reads documents and maps a missing document to null", async () => {
		const client = testClient();
		vi.mocked(firestore.getDoc).mockResolvedValueOnce(
			fakeDocSnapshot({ path: "contactMessages/m1" }) as never,
		);
		const view = renderHook(
			() => useFirestoreDoc(doc(db, "contactMessages", "m1")),
			{ wrapper: wrapper(client) },
		);
		await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
		expect(view.result.current.data).toBeNull();
		expect(onSnapshot).not.toHaveBeenCalled();
	});

	it("reads queries with getDocs and the estimate option", async () => {
		const client = testClient();
		const data = vi.fn(() => ({ title: "a" }));
		vi.mocked(firestore.getDocs).mockResolvedValueOnce({
			docs: [{ data }],
		} as never);
		const view = renderHook(() => useMessages(false), {
			wrapper: wrapper(client),
		});
		await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
		expect(view.result.current.data).toEqual([{ title: "a" }]);
		expect(data).toHaveBeenCalledWith({ serverTimestamps: "estimate" });
	});

	it("does nothing for a null reference", async () => {
		const client = testClient();
		const view = renderHook(
			() => {
				useQueryClient();
				return useFirestoreDoc(null, { subscribe: true });
			},
			{ wrapper: wrapper(client) },
		);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(view.result.current.fetchStatus).toBe("idle");
		expect(view.result.current.data).toBeUndefined();
		expect(firestore.getDoc).not.toHaveBeenCalled();
		expect(onSnapshot).not.toHaveBeenCalled();
		expect(
			client.getQueryCache().find({ queryKey: docKey(null) }),
		).toBeDefined();
	});
});

describe("suspense", () => {
	it("accepts options built from non-null sources, realtime included", async () => {
		const { client, detach } = setup();
		const Provider = wrapper(client);
		const view = renderHook(
			() =>
				useSuspenseQuery(
					firestoreQueryOptions({
						queryKey: messageKeys.list(),
						query: collection(db, "contactMessages"),
						subscribe: true,
					}),
				),
			{
				wrapper: ({ children }: { children: ReactNode }) => (
					<Provider>
						<Suspense fallback={null}>{children}</Suspense>
					</Provider>
				),
			},
		);
		await waitFor(() => expect(listeners).toHaveLength(1));
		await emit(listeners[0], "a");
		await waitFor(() =>
			expect(view.result.current?.data).toEqual([{ title: "a" }]),
		);
		await emit(listeners[0], "a", "b");
		await waitFor(() => expect(view.result.current?.data).toHaveLength(2));
		detach();
	});

	it("types every factory for the suspense hooks", () => {
		// Compile-time check: these calls only type-check because a non-null
		// source returns options without `skipToken`.
		const source = collection(db, "contactMessages");
		const check = () => {
			useSuspenseQuery(firestoreDocOptions(doc(db, "contactMessages", "m1")));
			useSuspenseQuery(
				firestoreAggregateOptions({
					queryKey: messageKeys.aggregate(),
					query: source,
					aggregate: { total: firestore.count() },
				}),
			);
			useSuspenseInfiniteQuery(
				firestoreInfiniteQueryOptions({
					queryKey: messageKeys.infinite(),
					query: source,
					pageSize: 10,
				}),
			);
		};
		expect(typeof check).toBe("function");
	});
});
