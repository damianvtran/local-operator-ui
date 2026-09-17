/*
 * The appearance picker's arrow model, executable.
 *
 *     node --test scripts/theme-grid-navigation.test.mjs
 *
 * WHY THIS FILE EXISTS. The picker renders two grids — the Dark group and the
 * Light group — and the Dark group's tile count is not a multiple of the column
 * count, so its last row is SHORT and the Light group begins a new row. The
 * arrow rule used to be a flat offset (`index ± columns`), which is column-exact
 * inside a group and wrong at that one seam: measured in the app, `ArrowDown`
 * from `rosewood` landed on `rosePineDawn` 685px away instead of on
 * `localOperatorLight` directly beneath it, and `ArrowUp` from
 * `localOperatorLight` skipped `rosewood` entirely — deterministically, at both
 * column counts (UX round 2, U1). Round 1's remediation had asserted the
 * opposite in prose, and nothing could contradict it, because the rule only
 * existed inside a React handler and could only be exercised by driving the app.
 *
 * So the rule is now `theme-grid-navigation.ts` — pure, no React and no DOM
 * types — and this file is the instrument that can be re-run. The bundle below
 * imports the SHIPPED module, so a second implementation cannot pass here while
 * the product disagrees, and it imports the SHIPPED registry so the boundary
 * under test is the real one: `rosewood` is the Dark group's last tile and
 * `localOperatorLight` the Light group's first, and if a palette changes mode
 * that assertion fails here rather than quietly moving what "the boundary" means.
 *
 * WHAT IT PINS, and why each case needs to be here:
 *
 *   1. the Dark→Light crossing at 3, 4 and 5 columns, in both directions, on the
 *      tile the eye reads as directly beneath — the finding, and the reason the
 *      module exists. The column counts are the three the app renders
 *      (measured from the DOM in the app; nothing here is hardcoded into the
 *      product, and the module takes the count as an input);
 *   2. the ordinary in-group move, so a fix for the seam cannot quietly break
 *      the arithmetic that was already right;
 *   3. the short destination row: where the row below has no tile in the current
 *      column, the nearest tile of that row is the answer, which is what a user
 *      expects from a row that ends early;
 *   4. the clamps at both ends, and Home/End, which the round-1 walk measured
 *      and which must not change;
 *   5. a three-group, mixed-column layout, so the rule is visibly a walk over
 *      row bands rather than a special case for the two groups this picker
 *      happens to render;
 *   6. that the component actually consumes the module, read as source text —
 *      the rule being right in a file nobody imports is not a product fix.
 *
 * WHAT IT CANNOT PROVE: that the pixels agree. The rule decides an index; that
 * the index is the tile the eye reads as beneath it is a property of the layout,
 * and the answer for the real app is the UX round's DOM walk and the QA round's
 * delta pass. It also cannot prove that `Tab` lands where the user left off —
 * the roving tab stop is component state — only that the movement it feeds is
 * right.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();
const COMPONENT =
	"src/renderer/src/features/settings/components/theme-selector.tsx";

const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/features/settings/theme-grid-navigation";
			export { themes } from "./src/renderer/src/shared/themes";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { isTileNavKey, nextTileIndex, TILE_NAV_KEYS, themes } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/*
 * The tiles in the order the component renders them: the registry's dark
 * palettes, then its light ones, each in registry order. Deriving it from the
 * shipped registry rather than writing twenty tile names here keeps this file
 * honest about which tiles it is talking about.
 */
const all = Object.values(themes);
const dark = all.filter((entry) => entry.theme.palette.mode === "dark");
const light = all.filter((entry) => entry.theme.palette.mode === "light");
const order = [...dark, ...light].map((entry) => entry.id);

/** The two group grids as the component measures them, one column count for both. */
const layout = (columns) => [
	{ count: dark.length, columns },
	{ count: light.length, columns },
];

const move = (index, key, columns) =>
	nextTileIndex({ index, key, groups: layout(columns) });

/* ------------------------------------------------------------------ *
 * The registry this file is asserting about
 * ------------------------------------------------------------------ */

test("the set is the one the boundary finding is about", () => {
	assert.equal(all.length, 59);
	assert.equal(dark.length, 41);
	assert.equal(light.length, 18);
	/* The finding names these two by hand; if the registry moves them, the
	 * boundary cases below would still pass while meaning something else. */
	assert.equal(order[40], "rosewood");
	assert.equal(order[41], "localOperatorLight");
});

/* ------------------------------------------------------------------ *
 * 1. The seam
 * ------------------------------------------------------------------ */

test("ArrowDown from the last dark tile lands on the tile beneath it, at 3, 4 and 5 columns", () => {
	for (const columns of [3, 4, 5]) {
		const column = 40 % columns;
		const expected = 41 + column;
		const landed = move(40, "ArrowDown", columns);
		assert.equal(
			landed,
			expected,
			`${columns} columns: expected the Light group's first row at column ${column}`,
		);
		/*
		 * Stated the other way round as well, because the index is only right if
		 * it is the same COLUMN one row down: the landed tile must be in the Light
		 * group's first row, and its column in that row must be rosewood's column
		 * in the Dark group's last row.
		 */
		assert.ok(landed >= 41 && landed < 41 + columns);
		assert.equal((landed - 41) % columns, column);
	}
});

test("ArrowUp from the Light group's first tile lands on the dark tile above it, at 3, 4 and 5 columns", () => {
	for (const columns of [3, 4, 5]) {
		/* The Dark group's last row starts at the last multiple of `columns`
		 * at or below its own last index: only its first tile is in column 0. */
		const expected = 40 - (40 % columns);
		assert.equal(
			move(41, "ArrowUp", columns),
			expected,
			`${columns} columns: expected column 0 of the Dark group's last row`,
		);
	}
});

test("the seam is not the flat offset it used to be", () => {
	/* The two flat answers the defect produced, asserted as NOT the answer, so
	 * this file fails if the old arithmetic comes back by any route. */
	for (const columns of [3, 4, 5]) {
		assert.notEqual(move(40, "ArrowDown", columns), 40 + columns);
	}
	assert.notEqual(move(41, "ArrowUp", 5), 41 - 5);
});

/* ------------------------------------------------------------------ *
 * 2. Inside a group, unchanged
 * ------------------------------------------------------------------ */

test("inside a group the vertical move is one row and the horizontal one is one tile", () => {
	for (const columns of [3, 4, 5]) {
		assert.equal(move(1, "ArrowDown", columns), 1 + columns);
		assert.equal(move(1 + columns, "ArrowUp", columns), 1);
		assert.equal(move(1, "ArrowRight", columns), 2);
		assert.equal(move(2, "ArrowLeft", columns), 1);
		assert.equal(move(0, "ArrowDown", columns), columns);
	}
});

test("ArrowLeft and ArrowRight cross the seam in DOM order", () => {
	/* DOM order is visual order across the seam, which the round-1 walk measured
	 * and which the vertical fix must not disturb. */
	for (const columns of [3, 4, 5]) {
		assert.equal(move(40, "ArrowRight", columns), 41);
		assert.equal(move(41, "ArrowLeft", columns), 40);
	}
});

/* ------------------------------------------------------------------ *
 * 3. A short destination row
 * ------------------------------------------------------------------ */

test("a short row answers with its nearest tile rather than stepping off it", () => {
	/* At 5 columns the Dark group's last row holds one tile, so a column that
	 * does not exist there clamps to that tile. */
	assert.equal(move(39, "ArrowDown", 5), 40);
	assert.equal(move(44, "ArrowUp", 5), 40);
	/* At 3 columns it holds two, so column 2 clamps to its second tile. */
	assert.equal(move(38, "ArrowDown", 3), 40);
	assert.equal(move(43, "ArrowUp", 3), 40);
});

/* ------------------------------------------------------------------ *
 * 4. Clamps, Home and End
 * ------------------------------------------------------------------ */

test("the first and last tile are clamps, not wraps", () => {
	for (const columns of [3, 4, 5]) {
		assert.equal(move(0, "ArrowLeft", columns), 0);
		assert.equal(move(0, "ArrowUp", columns), 0);
		assert.equal(move(58, "ArrowRight", columns), 58);
		assert.equal(move(58, "ArrowDown", columns), 58);
	}
});

test("Home and End reach the ends of the whole set", () => {
	assert.equal(move(30, "Home", 5), 0);
	assert.equal(move(30, "End", 5), 58);
	assert.equal(move(0, "End", 3), 58);
	assert.equal(move(58, "Home", 3), 0);
});

/* ------------------------------------------------------------------ *
 * 5. The shape it is a rule about, not the instance it was written for
 * ------------------------------------------------------------------ */

test("a layout with three groups, and groups with different column counts", () => {
	/* Group A: 5 tiles at 5 columns = one row. Group B: 4 tiles at 2 columns =
	 * two rows. Group C: 3 tiles at 3 columns = one row. */
	const groups = [
		{ count: 5, columns: 5 },
		{ count: 4, columns: 2 },
		{ count: 3, columns: 3 },
	];
	const at = (index, key) => nextTileIndex({ index, key, groups });
	/* A's single row is followed by B's first row, and B decides its own columns. */
	assert.equal(at(0, "ArrowDown"), 5);
	assert.equal(at(3, "ArrowDown"), 6);
	/* B's first row (5, 6) is followed by B's second (7, 8), then C's first. */
	assert.equal(at(5, "ArrowDown"), 7);
	assert.equal(at(7, "ArrowDown"), 9);
	assert.equal(at(9, "ArrowUp"), 7);
	/* The ends are still the ends. */
	assert.equal(at(0, "ArrowUp"), 0);
	assert.equal(at(11, "ArrowDown"), 11);
	assert.equal(at(0, "End"), 11);
});

test("a group that rendered no tiles cannot make an index resolve to one", () => {
	const groups = [
		{ count: 0, columns: 1 },
		{ count: 3, columns: 3 },
	];
	const at = (index, key) => nextTileIndex({ index, key, groups });
	assert.equal(at(0, "ArrowDown"), 0);
	assert.equal(at(2, "ArrowRight"), 2);
	assert.equal(at(0, "End"), 2);
});

test("an unanswerable press returns the index it was given", () => {
	const groups = [
		{ count: 4, columns: 2 },
		{ count: 4, columns: 2 },
	];
	assert.equal(nextTileIndex({ index: 0, key: "Enter", groups }), 0);
	assert.equal(nextTileIndex({ index: 2, key: "a", groups }), 2);
	assert.equal(nextTileIndex({ index: 8, key: "ArrowDown", groups }), 8);
	assert.equal(nextTileIndex({ index: -1, key: "ArrowUp", groups }), -1);
});

test("the key set is the one the grid answers", () => {
	assert.deepEqual(
		[...TILE_NAV_KEYS],
		["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"],
	);
	for (const key of TILE_NAV_KEYS) assert.equal(isTileNavKey(key), true);
	assert.equal(isTileNavKey("Enter"), false);
	assert.equal(isTileNavKey(""), false);
});

/* ------------------------------------------------------------------ *
 * 6. The component is on the other end of this rule
 * ------------------------------------------------------------------ */

/**
 * Strip `//` and comment-block comments, outside string literals.
 *
 * The scanner is the one `scripts/new-chat-row.test.mjs` carries: a regex cannot
 * tell a `//` inside a quoted string from the start of a comment, and this file
 * reads prose-heavy source.
 */
const stripComments = (text) => {
	let out = "";
	let quote = null;
	for (let i = 0; i < text.length; ) {
		const char = text[i];
		const next = text[i + 1];
		if (quote) {
			if (char === "\\") {
				out += text.slice(i, i + 2);
				i += 2;
				continue;
			}
			if (char === quote) quote = null;
			out += char;
			i += 1;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			out += char;
			i += 1;
			continue;
		}
		if (char === "/" && next === "/") {
			while (i < text.length && text[i] !== "\n") i += 1;
			continue;
		}
		if (char === "/" && next === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/"))
				i += 1;
			i += 2;
			continue;
		}
		out += char;
		i += 1;
	}
	return out;
};

const component = stripComments(readFileSync(join(ROOT, COMPONENT), "utf8"));

test("the component consumes the module rather than keeping its own arithmetic", () => {
	assert.match(component, /nextTileIndex\(/);
	assert.match(component, /isTileNavKey\(/);
	assert.match(component, /data-theme-grid=/);
	/* The defect, asserted as an absence in the shipped source: a flat offset
	 * cannot come back while this holds. */
	assert.doesNotMatch(component, /index\s*[+-]\s*columns/);
	assert.doesNotMatch(component, /GRID_NAV_KEYS/);
});

test("the component groups the tiles by the same rule this file derives them with", () => {
	/* The boundary cases above are about the DARK group's last tile, and they
	 * only mean that if the component still groups on `palette.mode`. */
	assert.match(component, /t\.theme\.palette\.mode === "dark"/);
	assert.match(component, /t\.theme\.palette\.mode === "light"/);
	/* And the tab stop follows focus rather than the selection (round 2, M-6). */
	assert.match(component, /onFocus=\{onFocusTile\}/);
	assert.match(component, /setFocusedId\(/);
});
