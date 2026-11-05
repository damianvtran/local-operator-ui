#!/usr/bin/env node
/**
 * Derives the per-role minimum surface alpha the window-glass feature may paint,
 * and prints it as the JSON `src/shared/window-glass-floors.json` carries.
 *
 *     node scripts/derive-glass-floors.mjs            # print the table
 *     node scripts/derive-glass-floors.mjs --check    # fail when the committed table is below it
 *
 * WHY A DERIVATION AND NOT A NUMBER. A translucent ground is not one colour: it is
 * the palette's role colour at alpha A over whatever the OS composites behind the
 * window, and the OS material's own tone moves with the backdrop. The contrast
 * contract (`contrast-contract.mjs`) measures flat hexes and "cannot see an alpha
 * composite", so the alpha floor is the one place a clean `pnpm check-themes` would
 * say nothing about glass at all. This file computes, for every palette and each
 * of the three text inks, the smallest alpha at which the ink still clears AA
 * (4.5:1) against the role composited over the WORST backdrop the material can
 * show, and takes the maximum over the fleet.
 *
 * THE BACKDROP NUMBERS ARE MEASURED, NOT ASSUMED. `backdropGray` is the grey level
 * of an AppKit vibrancy material (macOS 27.0.1, Electron 44.3.0) read back from a
 * composited window capture over a pure white and a pure black desktop, for a dark
 * and a light `nativeTheme.themeSource` (the material's tone follows the source,
 * which is why the app pins it to the palette's scheme while glass is on). The
 * worst case for LIGHT ink on a dark material is the brighter backdrop; the worst
 * case for DARK ink on a light material is the darker one. Windows' `mica`,
 * `tabbed` and `acrylic` could not be measured here and borrow the most
 * demanding measured tier; that is a stated conservative assumption, not a claim.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "./entry-point.mjs";
import { loadPalettes } from "./palette-source.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FLOORS_PATH = join(ROOT, "src/shared/window-glass-floors.json");

import {
	BACKDROP_GRAY,
	GLASS_BLOCK_VEIL_STEP,
	GLASS_EDGE_FLOOR,
	GLASS_INKS,
	GLASS_INK_FLOOR,
	GLASS_LANE_STEP,
	GLASS_ROLES,
	GLASS_STATE_ALPHA,
	GLASS_STATE_DIM_FLOOR,
	GLASS_STATE_STEP,
	LANE_ALPHA_CEILING,
	LANE_ROLES,
	composite,
	glassEdge,
	gray,
	minAlpha,
	minAlphaUnder,
	minEdgeAlpha,
	ratio,
	schemeOf,
	derive as sharedderive,
	deriveBandFloor as sharedderiveBandFloor,
	deriveBlockVeil as sharedderiveBlockVeil,
	deriveControlMix as sharedderiveControlMix,
	deriveLaneWash as sharedderiveLaneWash,
} from "../src/shared/glass-derivation.mjs";
export {
	BACKDROP_GRAY,
	GLASS_ROLES,
	GLASS_INKS,
	GLASS_INK_FLOOR,
	GLASS_EDGE_FLOOR,
	GLASS_STATE_ALPHA,
	GLASS_BLOCK_VEIL_STEP,
	GLASS_STATE_STEP,
	GLASS_LANE_STEP,
	LANE_ALPHA_CEILING,
	LANE_ROLES,
	GLASS_STATE_DIM_FLOOR,
	ratio,
	gray,
	composite,
	schemeOf,
	minAlpha,
	minAlphaUnder,
	minEdgeAlpha,
	glassEdge,
};
export const derive = () => sharedderive(loadPalettes());
export const deriveBlockVeil = (floors) =>
	sharedderiveBlockVeil(floors, loadPalettes());
export const deriveLaneWash = (floors) =>
	sharedderiveLaneWash(floors, loadPalettes());
export const deriveBandFloor = () => sharedderiveBandFloor(loadPalettes());
export const deriveControlMix = (floors) =>
	sharedderiveControlMix(floors, loadPalettes());

/* The shared helper, not a hand-rolled argv compare: a symlinked path (macOS
 * `/tmp`) must answer the same, and `scripts/entry-point.test.mjs` enforces it. */
if (isEntryPoint(import.meta.url)) {
	const derived = derive();
	if (!process.argv.includes("--check")) {
		console.log(
			JSON.stringify(
				{
					alphaFloor: derived,
					blockVeil: deriveBlockVeil(derived),
					laneWash: deriveLaneWash(derived),
					controlMix: deriveControlMix(derived),
					bandFloor: deriveBandFloor(),
					stateAlpha: GLASS_STATE_ALPHA,
				},
				null,
				"\t",
			),
		);
		process.exit(0);
	}
	if (process.argv.includes("--check")) {
		const file = JSON.parse(readFileSync(FLOORS_PATH, "utf8"));
		const committed = file.alphaFloor;
		let bad = 0;
		for (const tier of Object.keys(derived))
			for (const scheme of ["dark", "light"])
				for (const role of GLASS_ROLES)
					if (committed[tier][scheme][role] < derived[tier][scheme][role]) {
						bad++;
						console.error(
							`floor ${tier}/${scheme}/${role} is ${committed[tier][scheme][role]} but the palettes need ${derived[tier][scheme][role]}`,
						);
					}
		const veil = deriveBlockVeil(committed);
		for (const scheme of ["dark", "light"])
			if ((file.blockVeil?.[scheme] ?? 0) < veil[scheme]) {
				bad++;
				console.error(
					`block veil ${scheme} is ${file.blockVeil?.[scheme]} but the palettes need ${veil[scheme]} for a ΔE00 ${GLASS_BLOCK_VEIL_STEP} step off the canvas glass - re-derive, never hand-lower it`,
				);
			}
		const band = deriveBandFloor();
		for (const scheme of ["dark", "light"])
			if ((file.bandFloor?.[scheme] ?? 0) < band[scheme]) {
				bad++;
				console.error(
					`band floor ${scheme} is ${file.bandFloor?.[scheme]} but the palettes need ${band[scheme]} for the count to clear the ${GLASS_INK_FLOOR} text floor over the worst content - re-derive, never hand-lower it`,
				);
			}
		const lane = deriveLaneWash(committed);
		for (const scheme of ["dark", "light"])
			if (
				file.laneWash?.[scheme]?.role !== lane[scheme].role ||
				file.laneWash?.[scheme]?.scale !== lane[scheme].scale
			) {
				bad++;
				console.error(
					`lane wash ${scheme} is ${JSON.stringify(file.laneWash?.[scheme])} but the palettes need ${JSON.stringify(lane[scheme])} for a ΔE00 ${GLASS_LANE_STEP} step off the page at every slider position - re-derive, never hand-lower it`,
				);
			}
		process.exit(bad ? 1 : 0);
	}
}
