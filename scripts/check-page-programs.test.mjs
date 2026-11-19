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

/** A name bound to a `.toString()` call, with slack for the call wrapping onto the
 * following line: a program can be laundered through a const in another module. */
const BOUND_FROM_TO_STRING =
	/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[\s\S]{0,200}?\.toString\s*\(/g;

/** A `functionDeclaration:` value, read across newlines up to the `,`/`;`/`}`
 * that ends it — the call expression, never a single line. */
const DECLARATION_EXPRESSION =
	/functionDeclaration\s*:\s*([\s\S]{0,240}?)(?=[,;}\n]\s*(?:[A-Za-z_$"']|}|$))/g;

/** Every TypeScript module under the host's browser directory, minus the two
 * places a `functionDeclaration:` is not a page program: the PROVENANCE-pinned
 * vendored driver (its own gate) and the generated constants themselves (they
 * ARE the sanctioned transport, and their text is a page program's body, which
 * may legitimately call `.toString()` on a value). */
function hostSources(dir) {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "vendor") continue;
			out.push(...hostSources(path));
			continue;
		}
		if (entry.name.endsWith(".ts") && !entry.name.endsWith(".gen.ts"))
			out.push(path);
	}
	return out;
}

/**
 * The programs that reached a `functionDeclaration:` through a computed
 * `.toString()`, which is the ONE shape a shipped build cannot carry: the main
 * bundle is V8 bytecode and its loader runs against a dummy source string, so
 * the computed text is that dummy rather than the program (measured — see
 * `page-programs/select-page.ts`).
 *
 * WHY THIS IS A PARSER-ISH SCAN AND NOT A LINE GREP: the defect's two realistic
 * reintroductions are a call that WRAPS (`functionDeclaration:\n\t\t&&\n\t\tfn
 * .toString()`) and a program LAUNDERED through a const that another module
 * defines. A same-line scan sees neither, so the scan reads the whole call
 * expression with slack, and resolves identifiers against a tree-wide set of
 * names assigned from a `.toString()` — including across files, because the
 * const and its use need not share a module.
 *
 * Pure over `[{ path, text }]`, so the test below can prove it has bite on
 * synthetic offenders instead of trusting that it would catch one.
 */
function transportOffenders(files) {
	const offenders = [];
	/** Names bound to a `.toString()` anywhere in the tree, with slack for the
	 * call wrapping onto the next line. */
	const fromToString = new Set();
	const binding = BOUND_FROM_TO_STRING;
	for (const { text } of files)
		for (const match of text.matchAll(binding)) fromToString.add(match[1]);
	for (const { path, text } of files) {
		// The call expression, not the line: up to the first `,`/`;`/`}` that ends
		// the value, across newlines.
		const declaration = DECLARATION_EXPRESSION;
		for (const match of text.matchAll(declaration)) {
			const expression = match[1];
			const line = text.slice(0, match.index).split("\n").length;
			const computed = /\.toString\s*\(/.test(expression);
			const named = expression
				.trim()
				.match(/^(?:as\s+\w+\s*)?([A-Za-z_$][\w$]*)$/);
			if (computed) {
				offenders.push(
					`${path}:${line}: a computed .toString() as a page program`,
				);
				continue;
			}
			if (named && fromToString.has(named[1]))
				offenders.push(
					`${path}:${line}: ${named[1]} is assigned from a .toString() elsewhere`,
				);
		}
	}
	return offenders;
}

test("no page program travels as a computed .toString()", () => {
	const root = join(
		dirname(fileURLToPath(import.meta.url)),
		"..",
		"src",
		"main",
		"browser",
	);
	const files = hostSources(root).map((path) => ({
		path,
		text: readFileSync(path, "utf8"),
	}));
	assert.ok(files.length > 50, "the scan sees the host's source tree");
	assert.deepEqual(
		transportOffenders(files),
		[],
		"a page program must ship as generated source (scripts/generate-page-programs.mjs): " +
			"the packaged main bundle is V8 bytecode, so `.toString()` returns the loader's dummy string in a built app",
	);
	assert.ok(
		readdirSync(PROGRAMS_DIR).length >= 2,
		"the readable programs the generated sources come from are present",
	);
});

test("the transport scan has bite on every shape a revert takes", () => {
	const offenders = transportOffenders([
		{
			path: "a/one.ts",
			text: "functionDeclaration: selectPage.toString(),\n",
		},
		{
			path: "a/wrapped.ts",
			text: "const params = {\n\tobjectId,\n\tfunctionDeclaration:\n\t\tprogram\n\t\t\t.toString(),\n\treturnByValue: true,\n};\n",
		},
		{
			// The const in one module, the call site in another: a same-line scan
			// of the call site sees only an identifier.
			path: "a/declare.ts",
			text: "const PROGRAM_SOURCE = buildProgram().toString();\n",
		},
		{ path: "a/use.ts", text: "functionDeclaration: PROGRAM_SOURCE,\n" },
		{
			// The control: the sanctioned transport, and an inline literal.
			path: "a/clean.ts",
			text: 'functionDeclaration: SETVALUE_PAGE_SOURCE,\nfunctionDeclaration: "function () { return 1; }",\n',
		},
	]);
	assert.equal(offenders.length, 3, offenders.join("\n"));
	assert.ok(offenders.some((line) => line.includes("a/one.ts:1")));
	assert.ok(offenders.some((line) => line.includes("a/wrapped.ts:3")));
	assert.ok(offenders.some((line) => line.includes("a/use.ts:1")));
});
