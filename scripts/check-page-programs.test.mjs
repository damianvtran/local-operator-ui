import assert from "node:assert/strict";
import {
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	OUTPUT_PATH,
	PROGRAMS_DIR,
	renderPrograms,
} from "./generate-page-programs.mjs";

/**
 * The gate over the injected page programs, and the guard that keeps future
 * programs on the same transport.
 *
 * WHY THE FRESHNESS HALF EXISTS: `page-programs.gen.ts` carries the exact text
 * the host injects into a page, and it is DERIVED from `actions/page-programs/`.
 * A program edited without regenerating would mean the host keeps injecting the
 * old text while the source says otherwise — the failure mode is silent and
 * looks like a page-side bug. Measured before the transport was fixed
 * (2026-11-06): `select` could not change a native `<select>` at all in a
 * bytecode build, because the program travelled as `fn.toString()` and the
 * bytecode loader's dummy source string came back instead.
 *
 * WHY THE SCAN HALF EXISTS: a new `functionDeclaration` fed a `.toString()` is
 * the SAME defect reintroduced, and nothing else in the suite would notice — the
 * dev bundle and the test bundle both return real source from `toString()`. So
 * the rule is enforced on the source tree: a page program is committed source,
 * generated from a readable module, or it does not ship.
 */

test("the committed page-program sources are what the generator derives today", async () => {
	const { text, hash } = await renderPrograms();
	const onDisk = readFileSync(OUTPUT_PATH, "utf8");
	assert.equal(
		onDisk,
		text,
		"page-programs.gen.ts is stale: run `node scripts/generate-page-programs.mjs`",
	);
	assert.ok(
		onDisk.includes(hash),
		"the header names the hash of the modules this file was derived from",
	);
});

test("a changed program changes the derived text (the check has bite)", async () => {
	const dir = mkdtempSync(join(tmpdir(), "lo-page-programs-"));
	try {
		// Same export NAMES, different bodies: what a drift would look like.
		writeFileSync(
			join(dir, "select-page.ts"),
			"export function selectPage(mode) { return { status: mode }; }\n",
		);
		writeFileSync(
			join(dir, "setvalue-page.ts"),
			"export function setvaluePage(value) { return { status: value }; }\n",
		);
		const { text } = await renderPrograms({ programsDir: dir });
		const committed = readFileSync(OUTPUT_PATH, "utf8");
		assert.notEqual(
			text,
			committed,
			"a modified program must produce different text, or the freshness check proves nothing",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/** Every TypeScript module under the host's browser directory. */
function hostSources(dir) {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			// The vendored driver is PROVENANCE-pinned and has its own gate.
			if (entry.name === "vendor") continue;
			out.push(...hostSources(path));
			continue;
		}
		if (entry.name.endsWith(".ts")) out.push(path);
	}
	return out;
}

test("no page program travels as a computed .toString()", async () => {
	const root = join(
		dirname(fileURLToPath(import.meta.url)),
		"..",
		"src",
		"main",
		"browser",
	);
	const offenders = [];
	for (const file of hostSources(root)) {
		const lines = readFileSync(file, "utf8").split("\n");
		lines.forEach((line, index) => {
			if (!line.includes("functionDeclaration:")) return;
			if (!line.includes(".toString(")) return;
			offenders.push(`${file}:${index + 1}: ${line.trim()}`);
		});
	}
	assert.deepEqual(
		offenders,
		[],
		"a page program must ship as generated source (scripts/generate-page-programs.mjs): " +
			"the packaged main bundle is V8 bytecode, so `.toString()` returns the loader's dummy string in a built app",
	);
	assert.ok(
		readdirSync(PROGRAMS_DIR).length >= 2,
		"the readable programs the generated sources come from are present",
	);
});
