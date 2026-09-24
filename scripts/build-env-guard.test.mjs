/**
 * The build's enum guard: a value the renderer's schema rejects is refused at
 * BUILD time rather than at boot.
 *
 * WHY THIS CELL EXISTS. QA round 1 (§0) measured the failure it prevents: a root
 * `.env` carrying `VITE_DISABLE_BACKEND_MANAGER=1` built a renderer whose window
 * threw `Configuration validation failed` at boot and never mounted — so every
 * capture of the app's window in that round was a single-colour field, and several
 * of the PR's own cells were green against a blank window. The build succeeded and
 * the app was dead, which is the worst ordering of those two facts.
 *
 * The guard is DERIVED from `env-schema.ts` rather than listed here, and this file
 * asserts that too: a fixture schema of its own, so the test fails if the derivation
 * ever stops reading the file it names.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export { readEnumGuards, assertEnumEnv } from "./scripts/vite-plugins/replace-backend-config";',
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	logLevel: "silent",
	/*
	 * BOTH DEPENDENCIES STAY EXTERNAL, and the bundle lands in a FILE rather than in a
	 * `data:` URL because of it: `vite` is a type-only import that erases itself, and
	 * `dotenv` is CJS (`require("fs")` at module scope, which esbuild cannot bundle
	 * for an ESM output). A real module on disk resolves both from `node_modules`;
	 * a `data:` URL resolves neither.
	 */
	external: ["vite", "dotenv"],
});
// INSIDE THE REPO, because the bundle's external `dotenv` has to resolve from this
// project's own `node_modules` — a temp directory outside it cannot see the package.
// `node_modules/.tmp` is where the TypeScript build info already lives, so it is a
// path this repository already treats as scratch.
const harnessDir = join(process.cwd(), "node_modules", ".tmp");
mkdirSync(harnessDir, { recursive: true });
const harnessPath = join(harnessDir, `build-env-guard-${process.pid}.mjs`);
writeFileSync(harnessPath, bundle.outputFiles[0].text);
process.on("exit", () => rmSync(harnessPath, { force: true }));
const { readEnumGuards, assertEnumEnv } = await import(
	pathToFileURL(harnessPath).href
);

test("the shipped schema's enum variables are what the guard reads", () => {
	const guards = readEnumGuards();
	const byName = Object.fromEntries(guards.map((g) => [g.name, g.values]));
	assert.deepEqual(
		byName.VITE_DISABLE_BACKEND_MANAGER,
		["true", "false"],
		"the boolean the round-1 mis-build used is under the guard",
	);
	assert.ok(
		guards.length >= 2,
		"and the derivation found the schema's other enums too rather than one hard-coded name",
	);
	// Every guard must name real accepted values, or `assertEnumEnv` would refuse
	// everything including the defaults the schema documents.
	for (const guard of guards) {
		assert.ok(guard.values.length > 0, `${guard.name} has no accepted values`);
	}
});

test("a value the schema cannot accept is refused, and named", () => {
	assert.throws(
		() =>
			assertEnumEnv(
				[{ name: "VITE_DISABLE_BACKEND_MANAGER", values: ["true", "false"] }],
				{
					VITE_DISABLE_BACKEND_MANAGER: "1",
				},
			),
		(error) => {
			// The message has to carry both halves: the value the caller typed and the
			// set that would have been accepted. A guard that says only "invalid" sends
			// the next person to the schema.
			assert.match(error.message, /VITE_DISABLE_BACKEND_MANAGER/);
			assert.match(error.message, /"1"/);
			assert.match(error.message, /true \| false/);
			return true;
		},
	);
	// The accepted spelling and the absent case both pass: this is a guard against a
	// mis-typed value, not a new requirement that the variable be set.
	assert.doesNotThrow(() =>
		assertEnumEnv(
			[{ name: "VITE_DISABLE_BACKEND_MANAGER", values: ["true", "false"] }],
			{
				VITE_DISABLE_BACKEND_MANAGER: "true",
			},
		),
	);
	assert.doesNotThrow(() =>
		assertEnumEnv(
			[{ name: "VITE_DISABLE_BACKEND_MANAGER", values: ["true", "false"] }],
			{},
		),
	);
});

test("the derivation reads the file it is handed rather than the shipped one", () => {
	// The fixture is the anti-rot half: a guard hard-coded against the real schema
	// would pass the two cells above and fail this one.
	const dir = mkdtempSync(join(tmpdir(), "lo-enum-guard-"));
	try {
		const schema = join(dir, "env-schema.ts");
		writeFileSync(
			schema,
			[
				"const envSchema = z.object({",
				"\tVITE_FIXTURE_BOOL: z",
				'\t\t.enum(["yes", "no"])',
				"\t\t.optional(),",
				"\tVITE_FIXTURE_LEVEL: z",
				'\t\t.enum(["low", "high"])',
				"\t\t.optional(),",
				"});",
			].join("\n"),
		);
		assert.deepEqual(readEnumGuards(schema), [
			{ name: "VITE_FIXTURE_BOOL", values: ["yes", "no"] },
			{ name: "VITE_FIXTURE_LEVEL", values: ["low", "high"] },
		]);
		// A schema path that does not exist is no guards rather than a throw: a caller
		// that has no schema to read must not fail a build over it.
		assert.deepEqual(readEnumGuards(join(dir, "absent.ts")), []);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
