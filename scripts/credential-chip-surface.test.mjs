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
 *       wears the raised surface; the not-stored one stays flat.
 *  S-3  No ink loses its floor on the worst point of the sheen, in any palette.
 *       Computed the way the browser paints it (a translucent stop composited over
 *       the opaque fill, in sRGB bytes), as `dialog-surface.test.mjs` does.
 *  S-4  With the edge gone the fill's step off the ground IS the boundary, so the
 *       step is held here in every palette, on each ground the chip is painted on.
 *
 * WHAT THIS CANNOT SEE: the shadow's spill over neighbouring text and the corner
 * cover over the marker's bracket glyphs. Those are properties of a rendered frame
 * (the PR's zoomed stills), not of a palette.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { deltaE, over, ratio } from "../src/shared/theme-engine/color.mjs";
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
	assert.match(block, /box-shadow:\s*0 1px 2px var\(--lo-shadow-contact\);/);
	// The composer's gleam is 60% / 17% and its dark wash 4%; the chip is about half.
	assert.match(block, /rgb\(255 255 255 \/ 20%\)/);
	assert.match(block, /rgb\(255 255 255 \/ 2%\)/);
	assert.match(block, /rgb\(255 255 255 \/ 30%\)/);
	assert.match(block, /rgb\(255 255 255 \/ 8\.5%\)/);
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
	assert.match(live, /bg-sunken/);
	assert.match(live, /lo-chip-surface/);
	assert.match(warn, /bg-warning-wash/);
	assert.doesNotMatch(
		warn.replace(/\/\/.*$/gm, ""),
		/lo-chip-surface/,
		"flat is one of the two non-colour channels that separate it from a live chip",
	);
});

/*
 * The sheen's worst point per scheme, as the CSS writes it: a dark palette gets
 * white at 2% over the fill (and at 8.5% on the 1px gleam), a light one gets 20%
 * white (and 30% white on the gleam). The gleam is a single pixel line, but it
 * is held to the same floor so the bound does not depend on where text lands.
 */
const stops = ({ mode, sunken }) =>
	mode === "dark"
		? [over("#ffffff", sunken, 0.02), over("#ffffff", sunken, 0.085)]
		: [over("#ffffff", sunken, 0.2), over("#ffffff", sunken, 0.3)];

test("S-3 every ink the chip paints keeps its floor on the worst sheen stop, in every palette", () => {
	const palettes = loadPalettes();
	assert.ok(palettes.length >= 50, `only ${palettes.length} palettes parsed`);
	const failures = [];
	let worst = { value: Number.POSITIVE_INFINITY };
	for (const { id, palette } of palettes) {
		for (const stop of stops(palette)) {
			// ink: the name; ink-muted: the count and the clear control; accent: the key.
			for (const ink of ["ink", "inkMuted", "accent"]) {
				const plain = ratio(palette[ink], palette.sunken);
				const graded = ratio(palette[ink], stop);
				if (graded < worst.value) worst = { value: graded, id, ink };
				if (plain >= 4.5 && graded < 4.5)
					failures.push(
						`${id} ${ink}: ${plain.toFixed(2)} -> ${graded.toFixed(2)}`,
					);
			}
		}
	}
	assert.deepEqual(failures, [], "the sheen dropped an ink below 4.5:1");
	console.log(
		`worst chip ink on a sheen stop: ${worst.value.toFixed(2)} (${worst.id}, ${worst.ink})`,
	);
});

test("S-4 the fill's step off each ground is the boundary, in every palette", () => {
	// Floors are the measured minima over the 59 palettes, rounded down.
	const FLOORS = {
		sunken: { surface: 3.9, messageSurface: 5.0, elevated: 6.0 },
		warningWash: { surface: 2.3, messageSurface: 3.5, elevated: 3.7 },
	};
	const failures = [];
	for (const { id, palette } of loadPalettes()) {
		for (const [fill, grounds] of Object.entries(FLOORS)) {
			for (const [ground, floor] of Object.entries(grounds)) {
				const step = deltaE(palette[fill], palette[ground]);
				if (step < floor)
					failures.push(
						`${id}: ${fill} off ${ground} = ΔE00 ${step.toFixed(2)}, need ${floor}`,
					);
			}
		}
	}
	assert.deepEqual(failures, []);
});
