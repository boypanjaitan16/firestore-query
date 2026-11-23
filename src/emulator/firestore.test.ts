// Runs against the Firestore emulator: `pnpm test:emulator`.
import {
	initializeTestEnvironment,
	type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
	InfiniteQueryObserver,
	QueryClient,
	QueryObserver,
} from "@tanstack/react-query";
import { type FirebaseApp, initializeApp } from "firebase/app";
import {
	addDoc,
	collection,
	connectFirestoreEmulator,
	count,
	deleteDoc,
	doc,
	type Firestore,
	getFirestore,
	orderBy,
	query,
	serverTimestamp,
	setDoc,
	terminate,
	updateDoc,
} from "firebase/firestore";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { defineConverter, timestampToIso } from "../converter";
import { clearCursorSnapshots } from "../fetchers";
import { invalidateForWrites } from "../invalidation";
import { collectionKeys } from "../keys";
import { attachFirestoreListeners } from "../listeners";
import {
	firestoreAggregateOptions,
	firestoreDocOptions,
	firestoreInfiniteQueryOptions,
	firestoreQueryOptions,
} from "../options";

const projectId = "demo-firestore-query";
const [host = "127.0.0.1", port = "18080"] = (
	process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:18080"
).split(":");

const rules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /fq/{document=**} { allow read, write: if true; }
    match /fqDenied/{id} { allow read, write: if false; }
  }
}`;

/** The first listen on a freshly started emulator can take a few seconds. */
const until = (assertion: () => void) =>
	vi.waitFor(assertion, { timeout: 10_000, interval: 50 });

let environment: RulesTestEnvironment;
const apps: FirebaseApp[] = [];
const dbs: Firestore[] = [];

function connect(name: string) {
	const app = initializeApp({ projectId, apiKey: "test", appId: "test" }, name);
	const db = getFirestore(app);
	connectFirestoreEmulator(db, host, Number(port));
	apps.push(app);
	dbs.push(db);
	return db;
}

let db: Firestore;
/** A second client, standing in for another browser. */
let writer: Firestore;
let client: QueryClient;
let run = 0;

beforeAll(async () => {
	environment = await initializeTestEnvironment({
		projectId,
		firestore: { rules, host, port: Number(port) },
	});
	db = connect("reader");
	writer = connect("writer");
});

afterAll(async () => {
	await Promise.all(dbs.map((item) => terminate(item)));
	await environment.cleanup();
});

beforeEach(() => {
	run += 1;
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	attachFirestoreListeners(client, { unsubscribeDelay: 50 });
});

const pathFor = (name: string) => `fq/run${run}-${Date.now()}/${name}`;

type Item = { id: string; n: number; at: string | null };
const itemConverter = defineConverter<Item>({
	fromFirestore: (data, id) => ({
		id,
		n: Number(data.n),
		at: timestampToIso(data.at),
	}),
});

describe("realtime", () => {
	it("receives writes made by another client", async () => {
		const path = pathFor("messages");
		const keys = collectionKeys(path);
		const observer = new QueryObserver(
			client,
			firestoreQueryOptions({
				queryKey: keys.list(),
				query: query(collection(db, path), orderBy("n")).withConverter(
					itemConverter,
				),
				subscribe: true,
			}),
		);
		const stop = observer.subscribe(() => {});
		await until(() => expect(observer.getCurrentResult().data).toEqual([]));

		await addDoc(collection(writer, path), { n: 1 });
		await until(() => expect(observer.getCurrentResult().data).toHaveLength(1));
		await addDoc(collection(writer, path), { n: 2 });
		await until(() =>
			expect(observer.getCurrentResult().data?.map((item) => item.n)).toEqual([
				1, 2,
			]),
		);
		stop();
	});

	it("estimates pending server timestamps instead of reading null", async () => {
		const path = pathFor("stamps");
		const ref = doc(db, path, "one").withConverter(itemConverter);
		await setDoc(doc(writer, path, "one"), { n: 1, at: null });

		const seen = {
			estimate: [] as (string | null)[],
			none: [] as (string | null)[],
		};
		const watch = (behavior: "estimate" | "none") => {
			const observer = new QueryObserver(client, {
				...firestoreDocOptions(ref, {
					subscribe: true,
					serverTimestamps: behavior,
				}),
				queryKey: ["firestore", path, "doc", "one", behavior],
			});
			return observer.subscribe((result) => {
				if (result.data) seen[behavior].push(result.data.at);
			});
		};
		const stops = [watch("estimate"), watch("none")];
		await until(() => expect(seen.estimate.length).toBeGreaterThan(0));
		await until(() => expect(seen.none.length).toBeGreaterThan(0));

		await updateDoc(doc(db, path, "one"), { at: serverTimestamp() });
		await until(() => expect(seen.estimate.at(-1)).not.toBeNull());
		// The first snapshot (before the write) had no timestamp yet; every
		// snapshot after the local write carries one.
		expect(seen.estimate.slice(1).every((value) => value !== null)).toBe(true);
		expect(seen.none.slice(1)).toContain(null);
		for (const stop of stops) stop();
	});

	it("surfaces permission-denied as a FirestoreError", async () => {
		const observer = new QueryObserver(
			client,
			firestoreQueryOptions({
				queryKey: collectionKeys("fqDenied").list(),
				query: collection(db, "fqDenied"),
				subscribe: true,
			}),
		);
		const stop = observer.subscribe(() => {});
		await until(() =>
			expect(observer.getCurrentResult().error).toMatchObject({
				code: "permission-denied",
			}),
		);
		stop();

		await expect(
			client.fetchQuery(
				firestoreQueryOptions({
					queryKey: collectionKeys("fqDenied").list({ oneShot: true }),
					query: collection(db, "fqDenied"),
				}),
			),
		).rejects.toMatchObject({ code: "permission-denied" });
	});
});

describe("one-shot reads and writes", () => {
	async function seed(path: string, total: number) {
		for (let n = 1; n <= total; n += 1) {
			await setDoc(doc(writer, path, `item${n}`), { n });
		}
	}

	it("pages with document cursors and recovers a lost cursor snapshot", async () => {
		const path = pathFor("pages");
		await seed(path, 5);
		const observer = new InfiniteQueryObserver(
			client,
			firestoreInfiniteQueryOptions({
				queryKey: collectionKeys(path).infinite(),
				query: query(collection(db, path), orderBy("n")).withConverter(
					itemConverter,
				),
				pageSize: 2,
			}),
		);
		const stop = observer.subscribe(() => {});
		await until(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
		await observer.fetchNextPage();
		clearCursorSnapshots(client);
		const result = await observer.fetchNextPage();

		expect(
			result.data?.pages.map((page) => page.items.map((item) => item.n)),
		).toEqual([[1, 2], [3, 4], [5]]);
		expect(result.hasNextPage).toBe(false);
		stop();
	});

	it("fails with cursor-missing when the cursor document is deleted", async () => {
		const path = pathFor("deleted");
		await seed(path, 3);
		const observer = new InfiniteQueryObserver(
			client,
			firestoreInfiniteQueryOptions({
				queryKey: collectionKeys(path).infinite(),
				query: query(collection(db, path), orderBy("n")),
				pageSize: 2,
			}),
		);
		const stop = observer.subscribe(() => {});
		await until(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
		await deleteDoc(doc(writer, path, "item2"));
		clearCursorSnapshots(client);
		const result = await observer.fetchNextPage();
		expect(result.error).toMatchObject({ code: "cursor-missing" });
		stop();
	});

	it("counts on the server", async () => {
		const path = pathFor("counted");
		await seed(path, 4);
		const data = await client.fetchQuery(
			firestoreAggregateOptions({
				queryKey: collectionKeys(path).aggregate(),
				query: collection(db, path),
				aggregate: { total: count() },
			}),
		);
		expect(data.total).toBe(4);
	});

	it("refetches an active one-shot list after a write invalidates it", async () => {
		const path = pathFor("written");
		const keys = collectionKeys(path);
		const observer = new QueryObserver(
			client,
			firestoreQueryOptions({
				queryKey: keys.list(),
				query: collection(db, path),
			}),
		);
		const stop = observer.subscribe(() => {});
		await until(() => expect(observer.getCurrentResult().data).toEqual([]));
		const ref = doc(db, path, "new");
		await setDoc(ref, { n: 1 });
		invalidateForWrites(client, [ref], "set");
		await until(() => expect(observer.getCurrentResult().data).toHaveLength(1));
		stop();
	});
});
