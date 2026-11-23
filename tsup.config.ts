import { defineConfig } from "tsup";

// ESM only: the listener and cursor registries are module-level, so a second
// (CommonJS) copy of the package would not see listeners attached by the first.
export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	dts: true,
	target: "es2022",
	sourcemap: true,
	clean: true,
	treeshake: true,
	external: ["firebase", "@tanstack/react-query", "react"],
});
