// Test helpers for the unit tests; not exported from the package.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { type ReactNode, StrictMode } from "react";

/** A Firestore instance that never connects: tests mock every read and write. */
export function testDb() {
	const app =
		getApps().find((item) => item.name === "firestore-query-test") ??
		initializeApp(
			{ projectId: "demo-firestore-query", apiKey: "test", appId: "test" },
			"firestore-query-test",
		);
	return getFirestore(app);
}

export function testClient() {
	return new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 60_000 } },
	});
}

export function wrapper(client: QueryClient, strict = false) {
	return ({ children }: { children: ReactNode }) => {
		const tree = (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		);
		return strict ? <StrictMode>{tree}</StrictMode> : tree;
	};
}

type FakeDoc = { path: string; data?: Record<string, unknown> };

export function fakeDocSnapshot({ path, data }: FakeDoc) {
	return {
		id: path.split("/").at(-1),
		ref: { path },
		exists: () => data !== undefined,
		data: () => data,
	};
}

export function fakeQuerySnapshot(docs: FakeDoc[]) {
	return { docs: docs.map(fakeDocSnapshot) };
}
