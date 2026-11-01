import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build, stop } from "esbuild";
import { importScratchBundle } from "./scratch-esm-bundle.mjs";

const BUILD_FAILED = /Build failed/;
const TEST_FAILED = /synthetic test-body failure/;

const root =
	process.env.LOCAL_OPERATOR_SCRATCHPAD ??
	process.env.RUNNER_TEMP ??
	join(homedir(), ".cache", "local-operator-ui", "test-scratch");
await mkdir(root, { recursive: true });
const scratchRoot = await mkdtemp(join(root, "bundle-cleanup-control-"));
after(async () => {
	stop();
	await rm(scratchRoot, { recursive: true, force: true });
});
const options = { repoRoot: process.cwd(), scratchRoot };
const result = (text) => ({ outputFiles: [{ text }] });

// The dependency identity assertion detects a scratch bundle accidentally using
// another React install, rather than merely proving that some import resolves.
test("scratch bundle imports the existing React identity and removes its directory", async () => {
	const actualReact = await import("react");
	let writtenPath;
	const module = await importScratchBundle(
		async () =>
			result(
				'export { createElement } from "react"; export const source = "synthetic";',
			),
		{
			...options,
			load: async (url) => {
				writtenPath = fileURLToPath(url);
				assert.ok(writtenPath.startsWith(scratchRoot));
				assert.equal(
					await readFile(writtenPath, "utf8"),
					'export { createElement } from "react"; export const source = "synthetic";',
				);
				return import(url);
			},
		},
	);
	assert.equal(module.createElement, actualReact.createElement);
	assert.equal(module.source, "synthetic");
	assert.deepEqual(await readdir(scratchRoot), []);
});

test("failed real esbuild compilation removes its scratch directory", async () => {
	await assert.rejects(
		importScratchBundle(
			() =>
				build({
					stdin: { contents: "export const = ;" },
					write: false,
					logLevel: "silent",
				}),
			options,
		),
		BUILD_FAILED,
	);
	assert.deepEqual(await readdir(scratchRoot), []);
});

test("failed real ESM import removes the already-written scratch bundle", async () => {
	await assert.rejects(
		importScratchBundle(async () => result("export const = ;"), options),
		SyntaxError,
	);
	assert.deepEqual(await readdir(scratchRoot), []);
});

// A later assertion cannot strand the module: cleanup completes before the
// imported exports reach a test, rather than waiting for an after hook.
test("a test-body failure after import has no remaining bundle", async () => {
	await assert.rejects(async () => {
		await importScratchBundle(
			async () => result("export const ready = true;"),
			options,
		);
		throw new Error("synthetic test-body failure");
	}, TEST_FAILED);
	assert.deepEqual(await readdir(scratchRoot), []);
});
