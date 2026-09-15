import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The composer band's suggestion stack: how tall it may grow before it outgrows
 * the pane it is in (design round 1, D1).
 *
 * WHY THIS IS ITS OWN FILE, and not a third section of `draft-splash.test.mjs`.
 * That file's four cases are the hydration claim and they are red on the tree
 * before this branch - which is the property that makes them a guard. These
 * cases are about a rule THIS BRANCH adds, so on that tree the module they
 * import does not exist and the file as a whole stops at resolution. Keeping
 * them apart is what keeps "the guard fails before the fix, on its assertions"
 * true of the file whose job that is.
 *
 * The rule is pure - rows in, a cap out - so this is where the ROW-BOUNDARY
 * property can be pinned, which is the part of D1 that is a claim rather than a
 * photograph: a cap that lands inside a row cuts the chips' glyphs (the defect),
 * and a cap that lands past the room the band has is a cap that does nothing.
 * The geometry the rule is fed comes from the live layout, and the frames under
 * `docs/evidence/draft-splash/` are where that geometry is photographed at the
 * sizes the defect was measured at.
 *
 * The module is TypeScript, so it is bundled the way the sibling guards bundle
 * theirs. It imports nothing, so the bundle is one file and no React is involved.
 */

const bundle = await build({
	stdin: {
		contents: `export { suggestionStackCapFor } from "./src/renderer/src/features/chat/components/suggestion-stack";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	write: false,
});

const bundlePath = new URL("./_suggestion-stack.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { suggestionStackCapFor } = await import(bundlePath.href);
await unlink(bundlePath);

const rowOf = (top, height) => ({ top, bottom: top + height });

test("the suggestion stack is only capped when it does not fit", () => {
	const rows = [rowOf(0, 28), rowOf(36, 28), rowOf(72, 28)];

	assert.equal(
		suggestionStackCapFor(rows, 0, 200),
		null,
		"a stack with room to spare is not capped at all, which is what keeps the default window's approved frame untouched",
	);
	assert.equal(
		suggestionStackCapFor(rows, 0, 80),
		64,
		"capped at the bottom edge of the last row that fits, so the boundary sits in the gap below it rather than through its glyphs",
	);
});

test("a chip whose label wraps inside itself moves the boundary past its whole row", () => {
	// Row two is a two-line chip - 28px of chip plus a second line - so a cap
	// measured by the row PITCH would cut it; one measured by the rows on screen
	// does not.
	const rows = [rowOf(0, 28), rowOf(36, 46), rowOf(90, 28)];

	assert.equal(
		suggestionStackCapFor(rows, 0, 60),
		28,
		"the tall row is dropped whole rather than cut in half",
	);
	assert.equal(
		suggestionStackCapFor(rows, 0, 82),
		82,
		"and its own bottom is the boundary as soon as its room is there",
	);
});

test("a stack is never capped away entirely, and page coordinates do not leak in", () => {
	const rows = [rowOf(400, 28), rowOf(436, 28)];

	assert.equal(
		suggestionStackCapFor(rows, 400, 4),
		28,
		"a pane with no room for even one row still shows the first: the alternative is a band that lost its suggestions rather than one that bounds them",
	);
	assert.equal(
		suggestionStackCapFor([], 400, 0),
		null,
		"no chips is not a containment problem",
	);
});
