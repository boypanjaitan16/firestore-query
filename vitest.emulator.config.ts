import { defineConfig } from "vitest/config";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/emulator/**/*.test.ts"],
		fileParallelism: false,
		testTimeout: 20_000,
		hookTimeout: 30_000,
	},
});
