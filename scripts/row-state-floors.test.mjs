import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The row states' floors, executable in the direction that FAILS.
 *
 * Why this file exists, and it is not a formality: `ROW_HOVER_CHROMA_FLOOR` and
 * `ROW_SELECTED_CHROMA_FLOOR` sat in `contrast-contract.mjs` DECLARED AND
 * ASSERTED NOWHERE - they were consumed by two failure-message strings and
 * compared against nothing - so a row state could desaturate to zero and pass
 * every check in the file. That is how 39 of the 59 themes shipped a hover
 * 60-77% less saturated than the panel it sits on, which is the operator's
 * report. The refinement round asserts them, and a bound asserted is still not a
 * bound proven: a floor whose comparison has a typo, or whose tolerance swallows
 * every reachable value, reads exactly like a floor that holds.
 *
 * So each case below lowers or widens a real palette value and requires the real
 * gate to FAIL with the message that names the bound. A case that stops failing
 * - because the assertion was deleted, inverted, or given slack that swallows
 * the mutation - fails THIS file, which is the property the previous round's
 * wiring did not have: it proved the constant was consumed, not that it could
 * fire.
 *
 * THE GATE IS RUN AGAINST A TEMPORARY COPY OF THE TWO TREES IT READS, and the
 * copy is the point rather than an implementation detail: `palettes/` is shared
 * with every parallel test in this suite (`palette-contract`,
 * `theme-registry-exhaustiveness`, `chat-sidebar-selection` all read it), and
 * mutating it in place for the length of a subprocess run is a race. The copy
 * costs under a second, and it is torn down in `after`.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PALETTES = join("src", "renderer", "src", "shared", "themes", "palettes");

const probeRoot = mkdtempSync(join(tmpdir(), "lo-row-state-floors-"));
cpSync(join(ROOT, "scripts"), join(probeRoot, "scripts"), { recursive: true });
cpSync(join(ROOT, "src"), join(probeRoot, "src"), { recursive: true });
after(() => rmSync(probeRoot, { recursive: true, force: true }));

/** The gate's own verdict, as text. */
function runGate() {
	const run = spawnSync(
		process.execPath,
		[join(probeRoot, "scripts", "contrast-contract.mjs")],
		{ encoding: "utf8" },
	);
	return `${run.stdout ?? ""}${run.stderr ?? ""}`;
}

/**
 * Rewrite one role's literal in one palette of the COPY, and hand back the
 * original text so a case's mutations do not leak into the next one.
 */
function setHex(file, role, hex) {
	const path = join(probeRoot, PALETTES, file);
	const before = readFileSync(path, "utf8");
	const literal = new RegExp(`(\\n\\t\\t${role}: ")([#0-9A-Fa-f]+)(",)`);
	assert.ok(literal.test(before), `${file} does not declare \`${role}\``);
	writeFileSync(path, before.replace(literal, `$1${hex}$3`));
	return () => writeFileSync(path, before);
}

/** One mutated role, one expected failure: the whole shape of a case. */
function fires(file, role, hex, expected) {
	const restore = setHex(file, role, hex);
	try {
		return runGate();
	} finally {
		restore();
	}
}

const TOKYO_NIGHT = "tokyo-night.ts";

test("the unmutated tree passes the gate this file mutates", () => {
	/*
	 * The control, and it is what makes every case below a reading rather than an
	 * assumption: if the copy were broken - a missing sibling module, a palette
	 * the parser cannot read - every case would "fail" and prove nothing.
	 */
	const out = runGate();
	assert.match(out, /Contrast contract holds: \d+ assertions across 59 themes/);
});

test("the cast floor fires when a hover desaturates below its panel's half", () => {
	/*
	 * `tokyoNight` is the palette the defect was measured on: its panel carries
	 * C* 13.44, so the hover's floor is 0.5 x 13.44 = 6.72, and the value below
	 * carries C* 1.97 at the SAME `L*` step - the exact shape of the shipped
	 * value that started this round (C* 4.79 against 13.44, with the ΔE00 band it
	 * was scored on *being* that removal).
	 */
	const out = fires(TOKYO_NIGHT, "rowHover", "#3C3C3F", "cast floor");
	assert.match(
		out,
		/tokyoNight: `rowHover` #3C3C3F carries C\* 1\.97, under the cast floor 6\.72/,
	);
});

test("the cast ceiling fires when a hover is a more saturated plane than its panel", () => {
	const out = fires(TOKYO_NIGHT, "rowHover", "#353A59", "cast ceiling");
	assert.match(
		out,
		/tokyoNight: `rowHover` #353A59 carries C\* 20\.41, past the/,
	);
});

test("the L* rank floor fires when the selection stops out-ranking the hover", () => {
	const out = fires(TOKYO_NIGHT, "rowSelected", "#373B56", "L* rank");
	assert.match(
		out,
		/tokyoNight: `rowSelected` #373B56 is 3\.38 `L\*` from `surface` where `rowHover` #3A3B48 is 3\.03/,
	);
});

test("the C* rank floor fires when the hover carries as much cast as the selection", () => {
	/*
	 * BOTH roles are mutated, because this is the rank the fleet's own floor
	 * cannot produce from one side: the hover's ceiling IS the panel's cast and
	 * the selection's floor IS the panel's cast, so the pair has to be brought to
	 * the same cast from both ends. It is also the shape of 14 shipped palettes,
	 * whose chroma rank was INVERTED - the hover quieter than the panel, the
	 * selection at it.
	 */
	const restoreHover = setHex(TOKYO_NIGHT, "rowHover", "#383B4F");
	const restoreSelected = setHex(TOKYO_NIGHT, "rowSelected", "#3C3F53");
	try {
		const out = runGate();
		assert.match(
			out,
			/tokyoNight: `rowSelected` #3C3F53 carries C\* 13\.04 where `rowHover` #383B4F carries 13\.18/,
		);
	} finally {
		restoreSelected();
		restoreHover();
	}
});

test("the hover's share of the selection's step fires when the hover stops spending it", () => {
	/*
	 * Clause 2 of the operator's ask - "more should be a brightening against the
	 * backdrop" than the shipped 30% - as the relationship it is. The mutation is
	 * a legal value on every other bound: a 1.55 `L*` step clears the 1.5 floor.
	 */
	const out = fires(TOKYO_NIGHT, "rowHover", "#363844", "the hover's share");
	assert.match(
		out,
		/tokyoNight: `rowHover` #363844 takes 1\.55 `L\*` of the [\d.]+ the selection takes \(\d+%\), under the 50%/,
	);
});

test("the field floor fires on a fill indistinguishable from its own panel", () => {
	/*
	 * The replacement for the withdrawn ΔE00 4.0 band, and the case that says why
	 * it had to be replaced rather than lowered: this value is a legal light step
	 * away from its panel by eye - ΔE00 0.32 - and it is a palette's own colour, so
	 * every other assertion in the file has something to say about it instead.
	 */
	const out = fires(TOKYO_NIGHT, "rowHover", "#323549", "the field floor");
	assert.match(
		out,
		/tokyoNight: `rowHover` #323549 is ΔE00 0\.32 from `surface` #313448 \(the field floor is 2\)/,
	);
});

test("a ledger row that is no longer needed fails the gate", () => {
	/*
	 * `catppuccinMacchiato` is in `ROW_STATE_MEASURED_SHORTFALL` for a pair rank
	 * of 0.94 `L*`, and the row is a CLAIM: this pair ranks 1.22 and the row is
	 * therefore stale. Without this case the ledgers would be the one part of the
	 * change that never fails when it stops being true - which is how the earlier
	 * round's thirteen pins outlived their causes.
	 */
	const restoreHover = setHex("catppuccin-macchiato.ts", "rowHover", "#30313E");
	const restoreSelected = setHex(
		"catppuccin-macchiato.ts",
		"rowSelected",
		"#2E334E",
	);
	try {
		const out = runGate();
		assert.match(
			out,
			/^FAIL\s+the fleet: the rank row for `catppuccinMacchiato`'s `rowSelected` is stale/m,
		);
	} finally {
		restoreSelected();
		restoreHover();
	}
});
