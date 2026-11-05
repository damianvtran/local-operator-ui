/**
 * Bundle a main-process TypeScript module for `node --test`, from the source the
 * app ships.
 *
 * WHY. The units under test live in `src/main/link-preview/*.ts` and are imported
 * by `src/main/index.ts`; a test that re-implemented them in JavaScript would
 * assert on a copy. So the modules are bundled with the repo's own esbuild (no new
 * dependency, no watch, no full build) into `node_modules/.cache`, which is the one
 * directory a generated file is already excluded from the tree's gates - the same
 * technique `scripts/agent-avatar.test.mjs` uses.
 *
 * The bundle name carries the pid so two suites running concurrently cannot
 * clobber each other's file.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";

const BUNDLE_DIR = "node_modules/.cache";

/**
 * Bundle the modules named in `entries` and return the import URL.
 *
 * `entries` are paths relative to the repository root, re-exported from a stub so
 * one bundle serves a whole suite (the cache and the service are exercised
 * together, and they must share one instance of `sniff.ts`).
 */
export async function bundleMainModules(name, entries) {
	await mkdir(BUNDLE_DIR, { recursive: true });
	const file = join(BUNDLE_DIR, `${name}-${process.pid}.mjs`);
	const contents = entries
		.map((entry) => `export * from "./${entry}";`)
		.join("\n");
	const result = await build({
		stdin: { contents, resolveDir: process.cwd(), loader: "ts" },
		bundle: true,
		format: "esm",
		platform: "node",
		packages: "external",
		write: false,
		logLevel: "silent",
	});
	await writeFile(file, result.outputFiles[0].text);
	return new URL(`../${file}`, import.meta.url).href;
}
