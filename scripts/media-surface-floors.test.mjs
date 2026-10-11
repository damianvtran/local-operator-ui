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
 * The media tile's fill floor, executable in the direction that FAILS.
 *
 * WHY THIS FILE EXISTS, and it is the same argument `message-surface-floors.test.mjs`
 * makes one role over: a bound asserted is still not a bound proven. The borderless
 * tile's extent at rest is its fill, so `MEDIA_SURFACE_DELTA_E` - ΔE00 4.0 off the
 * canvas, with a >= 2.5 L* half - is the whole of what keeps the tile findable on
 * the palettes where the shared `sunken` well measures as low as 2.00. A floor
 * whose comparison has a typo, or whose message names the wrong role, reads exactly
 * like a floor that holds; so each case below lowers a real palette value and
 * requires the real gate to FAIL with the message that names the bound. A case that
 * stops failing - because the assertion was deleted, inverted, or given slack that
 * swallows the mutation - fails THIS file.
 *
 * THE GATE IS RUN AGAINST A TEMPORARY COPY OF THE TWO TREES IT READS, for the
 * reason the sibling file records: `palettes/` is shared with every parallel
 * test in this suite, and mutating it in place for the length of a subprocess
 * run is a race. The copy is torn down in `after`.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PALETTES = join("src", "renderer", "src", "shared", "themes", "palettes");

const probeRoot = mkdtempSync(join(tmpdir(), "lo-media-surface-floors-"));
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

/**
 * Rewrite one role's literal with an arbitrary string, for the malformed-value
 * case `setHex` cannot express (its pattern only matches hex characters).
 */
function setRaw(file, role, value) {
	const path = join(probeRoot, PALETTES, file);
	const before = readFileSync(path, "utf8");
	const literal = new RegExp(`(\\n\\t\\t${role}: ")([^"]+)(",)`);
	assert.ok(literal.test(before), `${file} does not declare \`${role}\``);
	writeFileSync(path, before.replace(literal, `$1${value}$3`));
	return () => writeFileSync(path, before);
}

/** Remove one role's literal entirely, for the completeness case. */
function dropRole(file, role) {
	const path = join(probeRoot, PALETTES, file);
	const before = readFileSync(path, "utf8");
	const literal = new RegExp(`\\n\\t\\t${role}: "[^"]+",`);
	assert.ok(literal.test(before), `${file} does not declare \`${role}\``);
	writeFileSync(path, before.replace(literal, ""));
	return () => writeFileSync(path, before);
}

/** One mutated role, one expected failure: the whole shape of a case. */
function fires(file, role, hex) {
	const restore = setHex(file, role, hex);
	try {
		return runGate();
	} finally {
		restore();
	}
}

const SAGE = "sage.ts";

test("the unmutated tree passes the gate this file mutates", () => {
	/*
	 * The control, and it is what makes every case below a reading rather than an
	 * assumption: if the copy were broken - a missing sibling module, a palette
	 * the parser cannot read - every case would "fail" and prove nothing.
	 */
	const out = runGate();
	assert.match(out, /Contrast contract holds: \d+ assertions across 59 themes/);
});

test("the ΔE00 floor fires when the tile falls back to the shared sunken well", () => {
	/*
	 * `sage` is one of the palettes the deficit was measured on, and its `sunken`
	 * value - the shared well the tile used to wear - measures 3.27 ΔE00 off its
	 * canvas. Writing that value into the role reproduces exactly that reading.
	 */
	const out = fires(SAGE, "mediaSurface", "#E8E1CF");
	assert.match(
		out,
		/sage: the media tile's fill `mediaSurface` #E8E1CF is ΔE00 3\.27 from `canvas` #F2EDE0 \(need 4\) — the fill IS the borderless tile's extent, and below this band it stops being findable/,
	);
});

test("the L* half fires on a chroma-only step that clears the ΔE00 floor", () => {
	/*
	 * A same-lightness hue rotation: ΔE00 9.63 off the canvas - comfortably over
	 * the 4.0 floor - at an `L*` step of 0.27, the exact shape the lightness half
	 * exists to catch (ΔE00 is a budget a chroma-only step can spend while the
	 * fill vanishes in a greyscale render).
	 */
	const out = fires(SAGE, "mediaSurface", "#E0F2ED");
	assert.match(
		out,
		/sage: the media tile's fill sits 0\.27 L\* from `canvas`, under the 2\.5 L\* floor/,
	);
});

test("a palette that omits the role fails the completeness check", () => {
	/*
	 * The role's other half: a palette without it would fall silently through to
	 * a utility that resolves to nothing at all, which is the defect every entry
	 * in `REQUIRED_ROLES` exists to make loud.
	 */
	const restore = dropRole(SAGE, "mediaSurface");
	try {
		const out = runGate();
		assert.match(out, /sage: missing required role `mediaSurface`/);
	} finally {
		restore();
	}
});

test("a present but non-hex value fails rather than switching the floor off", () => {
	/*
	 * The same guard the block one over carries, and the same measured class it
	 * was written for: with a malformed value the 6c block and the completeness
	 * check would both skip, so the role's whole guarantee could be switched off
	 * by a value the palette parser accepts, and the tree looked green. A skip
	 * guard may answer "absent"; "malformed" must fail loudly, and this case
	 * proves it does.
	 */
	const restore = setRaw(SAGE, "mediaSurface", "notahex");
	try {
		const out = runGate();
		assert.match(
			out,
			/sage: the media tile's fill `mediaSurface` "notahex" is present but not a flat hex colour/,
		);
	} finally {
		restore();
	}
});
