/**
 * THE CREDENTIAL CHIP'S SURFACE (operator, 2026-11-27: "remove the border, maybe
 * have it have the same subtle gradient fill with sheen that the composer has, but
 * subtler sheen ... subtle drop shadow").
 *
 *  S-1  The stylesheet's `.lo-chip-surface` is one low contact shadow and a sheen
 *       in the `components` layer (so the composer's mirror can switch it off with
 *       a utility), draws no border or outline, and forced colours drops the sheen
 *       and the shadow.
 *  S-2  The two roles draw NO edge (no border, no outline) and only the live one
 *       wears the raised surface; the not-stored one stays flat. The live fill is
 *       the surface class's (per scheme), never a `bg-*` utility that would beat it.
 *  S-3  No ink loses its floor on the worst point of the sheen, in any palette.
 *       Computed the way the browser paints it (a translucent stop composited over
 *       the opaque fill, in sRGB bytes), as `dialog-surface.test.mjs` does. The
 *       fill and the sheen alphas are READ FROM THE STYLESHEET, so a stronger sheen
 *       or a different mix fails this row itself rather than a stale literal.
 *  S-4  With the edge gone the fill's step off the ground IS the boundary, so the
 *       step is held here in every palette, on each ground the chip is painted on,
 *       and the dark fill is LIGHTER than its ground (the composer's raised
 *       material, not a hole in it).
 *  S-5  The contrast contract's dark-fill rows measure the share the stylesheet
 *       actually mixes.
 *
 * WHAT THIS CANNOT SEE: the shadow's spill over neighbouring text and the corner
 * cover over the marker's bracket glyphs. Those are properties of a rendered frame
 * (the PR's zoomed stills), not of a palette.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	deltaE,
	lum,
	mixOklab,
	over,
	ratio,
} from "../src/shared/theme-engine/color.mjs";
import {
	FLOOR,
	MIXED_FILLS,
} from "../src/shared/theme-engine/contract-tables.mjs";
import { loadPalettes } from "./palette-source.mjs";

const css = readFileSync("src/renderer/src/styles/index.css", "utf8");
const chip = readFileSync(
	"src/renderer/src/features/chat/components/credential-chip.tsx",
	"utf8",
);

const block = (() => {
	const start = css.indexOf(".lo-chip-surface {");
	assert.ok(start > 0, "`.lo-chip-surface` is missing from index.css");
	const layerStart = css.lastIndexOf("@layer components", start);
	assert.ok(
		layerStart > 0 && start - layerStart < 40,
		"the rule sits directly inside `@layer components`",
	);
	return css.slice(start, css.indexOf("\n}\n", start));
})();
const forced = (() => {
	const start = css.indexOf(
		"@media (forced-colors: active) {\n\t.lo-chip-surface",
	);
	assert.ok(start > 0, "the forced-colours branch is missing");
	return css.slice(start, css.indexOf("\n}\n", start));
})();

test("S-1 one contact shadow and a half-strength sheen, no stroke, forced colours drops both", () => {
	// ONE layer, `0 1px 2px`: the palette's contact colour in light, the scrim at 70% in dark
	// (design D2: the contact colour is 1.09:1 off a dark bubble). No second layer, no halo.
	const shadow = /box-shadow:\s*([^;]+);/.exec(block)?.[1] ?? "";
	assert.match(
		shadow,
		/^0 1px 2px\s+light-dark\(\s*var\(--lo-shadow-contact\),\s*color-mix\(in srgb, var\(--lo-scrim\) 70%, transparent\)\s*\)$/,
	);
	// A top-level comma (outside every parenthesis) would be a second layer.
	let depth = 0;
	let topLevelCommas = 0;
	for (const ch of shadow) {
		if (ch === "(") depth++;
		else if (ch === ")") depth--;
		else if (ch === "," && depth === 0) topLevelCommas++;
	}
	assert.equal(topLevelCommas, 0, "one shadow layer, not a stack");
	// The composer's gleam is 60% / 17% and its dark wash 4%; the chip is about half.
	assert.match(block, /rgb\(255 255 255 \/ 20%\)/);
	assert.match(block, /rgb\(255 255 255 \/ 2%\)/);
	assert.match(block, /rgb\(255 255 255 \/ 30%\)/);
	assert.match(block, /rgb\(255 255 255 \/ 8\.5%\)/);
	// The fill: `sunken` in light, the composer's lit step in dark (ink over elevated).
	assert.match(
		block,
		/background-color:\s*light-dark\(\s*var\(--lo-sunken\),\s*color-mix\(in oklab, var\(--lo-ink\) [\d.]+%, var\(--lo-elevated\)\)\s*\);/,
	);
	assert.doesNotMatch(block, /(^|[\s;{])(border|outline)(-[a-z]+)?\s*:/);
	assert.match(forced, /background-image:\s*none/);
	assert.match(forced, /box-shadow:\s*none/);
});

test("S-2 neither role draws an edge, and only the live chip is raised", () => {
	const role = (name) =>
		new RegExp(`export const ${name} = cn\\(([\\s\\S]*?)\\n\\);`).exec(
			chip,
		)?.[1] ?? "";
	const live = role("CREDENTIAL_CHIP_ROLE");
	const warn = role("CREDENTIAL_NOT_STORED_ROLE");
	for (const [name, classes] of [
		["live", live],
		["not-stored", warn],
	]) {
		const code = classes.replace(/\/\/.*$/gm, "");
		assert.doesNotMatch(code, /\boutline-|\bborder\b|\bborder-|\bring-/, name);
	}
	assert.match(live, /lo-chip-surface/);
	// The fill is the surface class's, per scheme: a `bg-*` utility on the role is in
	// a later layer and would paint one fill in both (the dark hole of design D1).
	assert.doesNotMatch(
		live.replace(/\/\/.*$/gm, ""),
		/\bbg-/,
		"the live role carries no background utility",
	);
	assert.match(warn, /bg-warning-wash/);
	assert.doesNotMatch(
		warn.replace(/\/\/.*$/gm, ""),
		/lo-chip-surface/,
		"flat is one of the two non-colour channels that separate it from a live chip",
	);
});

/*
 * The fill and the sheen's worst point per scheme, READ FROM the stylesheet's block (code
 * review round 1, R1-2): a dark palette gets white at the wash's dark alpha over the fill (and
 * at the gleam's on the 1px line), a light one the light alphas. The gleam is a single pixel
 * line, but it is held to the same floor so the bound does not depend on where text lands.
 * Parsing them here is what lets a raised alpha fail THIS row, instead of leaving it green on
 * numbers the CSS no longer carries.
 */
const sheen = (() => {
	const pairs = [
		...block.matchAll(
			/light-dark\(\s*rgb\(255 255 255 \/ ([\d.]+)%\)\s*,\s*rgb\(255 255 255 \/ ([\d.]+)%\)\s*\)/g,
		),
	].map((m) => ({ light: Number(m[1]) / 100, dark: Number(m[2]) / 100 }));
	assert.equal(pairs.length, 2, "one gleam pair and one wash pair, in the CSS");
	// Source order: the 1px gleam first, then the vertical wash.
	return { gleam: pairs[0], wash: pairs[1] };
})();
const darkShare = (() => {
	const m =
		/color-mix\(in oklab, var\(--lo-ink\) ([\d.]+)%, var\(--lo-elevated\)\)/.exec(
			block,
		);
	assert.ok(m, "the dark fill is ink over elevated, in the stylesheet");
	return Number(m[1]) / 100;
})();
/** The fill the chip paints, as the browser resolves `light-dark(sunken, ink mix)`. */
const fillOf = (palette) =>
	palette.mode === "dark"
		? mixOklab(palette.ink, palette.elevated, darkShare)
		: palette.sunken;
const stops = (palette) => {
	const scheme = palette.mode === "dark" ? "dark" : "light";
	const fill = fillOf(palette);
	return [
		over("#ffffff", fill, sheen.wash[scheme]),
		over("#ffffff", fill, sheen.gleam[scheme]),
	];
};
/*
 * The floor each ink answers to. The key glyph is an ICON (WCAG 1.4.11, `aria-hidden`, its
 * sentence in the title and the screen-reader text), so on the raised dark fill it is held to
 * the 3:1 non-text floor: four dark palettes (duskfox 3.95, nightfox 4.49, outrun 4.48, synth
 * 4.46) fall under 4.5 there, and the 4.5 text floor stays for the light fill and for both
 * text inks. See the contract's "credential chip (dark fill) key glyph" row.
 */
const floorOf = (ink, palette) =>
	ink === "accent" && palette.mode === "dark" ? FLOOR.nonText : FLOOR.text;

test("S-3 every ink the chip paints keeps its floor on the worst sheen stop, in every palette", () => {
	const palettes = loadPalettes();
	assert.ok(palettes.length >= 50, `only ${palettes.length} palettes parsed`);
	const failures = [];
	let worst = { value: Number.POSITIVE_INFINITY };
	for (const { id, palette } of palettes) {
		const fill = fillOf(palette);
		for (const stop of stops(palette)) {
			// ink: the name; ink-muted: the count and the clear control; accent: the key.
			for (const ink of ["ink", "inkMuted", "accent"]) {
				const floor = floorOf(ink, palette);
				const plain = ratio(palette[ink], fill);
				const graded = ratio(palette[ink], stop);
				if (graded < worst.value) worst = { value: graded, id, ink };
				if (plain >= floor && graded < floor)
					failures.push(
						`${id} ${ink}: ${plain.toFixed(2)} -> ${graded.toFixed(2)}, floor ${floor}`,
					);
			}
		}
	}
	assert.deepEqual(failures, [], "the sheen dropped an ink below its floor");
	console.log(
		`worst chip ink on a sheen stop: ${worst.value.toFixed(2)} (${worst.id}, ${worst.ink})`,
	);
});

test("S-3b the dark wash reads as a subtle top lift: about half the composer's strength", () => {
	// The composer's own dark wash is 4% white over `elevated` (1.117-1.126:1 over the 41
	// dark palettes); the chip's is half of that ALPHA and, on the raised fill, a 1.059-1.064
	// top-to-bottom ratio - visible, and clearly the quieter of the two. A wash that fades out
	// (design D1: 1.039:1 on the old sunken fill) is below what the eye sees; one at the
	// composer's strength is not "subtler".
	const lifts = [];
	for (const { id, palette } of loadPalettes()) {
		if (palette.mode !== "dark") continue;
		const fill = fillOf(palette);
		lifts.push({
			id,
			lift: ratio(over("#ffffff", fill, sheen.wash.dark), fill),
			composer: ratio(
				over("#ffffff", palette.elevated, 0.04),
				palette.elevated,
			),
		});
	}
	assert.ok(lifts.length >= 40, `only ${lifts.length} dark palettes`);
	const bad = lifts.filter(
		({ lift, composer }) => lift < 1.05 || lift > composer - 0.03,
	);
	assert.deepEqual(
		bad.map(
			({ id, lift, composer }) =>
				`${id} ${lift.toFixed(3)} vs ${composer.toFixed(3)}`,
		),
		[],
		"the chip's dark wash lifts 1.05:1 or more, and stays under the composer's",
	);
});

test("S-4 the fill's step off each ground is the boundary, in every palette", () => {
	// Floors are the measured minima over each scheme's palettes, rounded down. The DARK
	// fill is the raised mix and must also be LIGHTER than every ground it sits on (the
	// composer's lit surface); the LIGHT fill is `sunken`, darker than them, as it always was.
	const FLOORS = {
		dark: { surface: 4.5, messageSurface: 3.0, elevated: 2.5 },
		light: { surface: 3.9, messageSurface: 5.0, elevated: 6.0 },
	};
	const failures = [];
	let darkSeen = 0;
	for (const { id, palette } of loadPalettes()) {
		const fill = fillOf(palette);
		for (const [ground, floor] of Object.entries(FLOORS[palette.mode])) {
			const step = deltaE(fill, palette[ground]);
			if (step < floor)
				failures.push(
					`${id}: chip fill off ${ground} = ΔE00 ${step.toFixed(2)}, need ${floor}`,
				);
			if (palette.mode === "dark" && lum(fill) <= lum(palette[ground]))
				failures.push(`${id}: dark chip fill is not lighter than ${ground}`);
		}
		if (palette.mode === "dark") darkSeen++;
		// The not-stored wash is the same in both schemes.
		for (const [ground, floor] of Object.entries({
			surface: 2.3,
			messageSurface: 3.5,
			elevated: 3.7,
		})) {
			const step = deltaE(palette.warningWash, palette[ground]);
			if (step < floor)
				failures.push(
					`${id}: warningWash off ${ground} = ΔE00 ${step.toFixed(2)}, need ${floor}`,
				);
		}
	}
	assert.ok(darkSeen >= 40, `only ${darkSeen} dark palettes parsed`);
	assert.deepEqual(failures, []);
});

test("S-5 the contract's dark-fill rows measure the share the stylesheet mixes", () => {
	const rows = MIXED_FILLS.filter((row) =>
		row.name.startsWith("credential chip (dark fill)"),
	);
	assert.deepEqual(
		rows.map((row) => row.ink).sort(),
		["accent", "ink", "inkMuted"],
		"the key, the name and the count each have a dark-fill row",
	);
	for (const row of rows) {
		assert.equal(row.mode, "dark", row.name);
		assert.deepEqual(row.mix.slice(0, 2), ["ink", "elevated"], row.name);
		assert.equal(row.mix[2], darkShare, `${row.name}: CSS share vs contract`);
	}
});
