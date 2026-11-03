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
import { deltaE } from "./color.mjs";
import { isEntryPoint } from "./entry-point.mjs";
import { loadPalettes } from "./palette-source.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FLOORS_PATH = join(ROOT, "src/shared/window-glass-floors.json");

/** Measured composite grey of each macOS material tier over its worst backdrop. */
export const BACKDROP_GRAY = {
	"under-window": { dark: 81, light: 199 },
	menu: { dark: 102, light: 171 },
	popover: { dark: 122, light: 143 },
};

/** The roles that may go translucent. The rest stay opaque by design. */
export const GLASS_ROLES = ["canvas", "surface", "elevated"];

/** Every body ink is held to AA over glass; the system's own 7/5.5/5.0 floors apply to the flat roles. */
export const GLASS_INKS = ["ink", "inkMuted", "inkDim"];
export const GLASS_INK_FLOOR = 4.5;
/**
 * The structural edge keeps its 3:1 floor over glass (docs/branding.md § 3: the
 * sole boundary of an input or an outlined button), held against the ground
 * COMPOSITE - the role at its alpha over the worst measured backdrop - because
 * that is what the border is actually drawn against.
 *
 * IT IS NOT HELD BY RAISING THE GROUND ALPHA. Measured: it would force the dark
 * `elevated` ground to alpha 1.0 (`autumn`'s `borderControl` sits exactly on the
 * flat 3:1 floor, so ANY translucency under it breaks the floor), which switches
 * glass off for every dark pane. Instead, inside a glass region the border colour
 * itself is mixed toward `ink` by `controlMix` - the smallest constant, per
 * material tier and scheme, at which every palette's edge clears 3:1 against every
 * glass ground at ITS floor alpha over the worst backdrop. A border that is a
 * little stronger on glass costs nothing; a pane that is never translucent costs
 * the whole feature.
 */
export const GLASS_EDGE_FLOOR = 3;

/**
 * STATES AND FIELDS ARE AN INK OVERLAY ON THE GLASS, not the palette's opaque tint.
 *
 * The palette's `rowHover` / `rowSelected` are flat tints authored to sit on an
 * OPAQUE `surface` or `canvas`. Painted opaque inside a see-through column they are
 * holes (the cream "New chat" pill); painted at the alpha that keeps the stack AA
 * they are either solid again (derived: 0.96-1.0 on dark palettes) or invisible.
 * So on glass a state is the palette's own `ink` at a small fixed alpha OVER the
 * glass: a step that reads on every backdrop because it is relative to whatever
 * the ground already is (lighter on a dark theme, darker on a light one), the way
 * the OS itself draws a selection on a vibrant sidebar.
 *
 * The three alphas are chosen so the step clears `GLASS_STATE_STEP` (ΔE00) off the
 * ground on every palette, and the ground floors below are derived WITH the
 * overlay in the stack (an overlay of ink lowers ink's own contrast, so the grounds
 * must be a little more opaque than text alone needs). Hover is the quietest step;
 * selected is deliberately about 1.7x it so the two never read as one; a field's
 * fill matches hover, with its `border-control` carrying the boundary.
 */
export const GLASS_STATE_ALPHA = {
	hover: 0.05,
	selected: 0.08,
	field: 0.05,
	/*
	 * A RUNNING TOOL ROW is the row that is the subject right now, which is the
	 * same claim a selected row makes; the two cannot co-occur, and asserting a
	 * second, separately-tuned alpha would be two constants for one idea. The
	 * alias is printed into the floors table so the renderer paints it from the
	 * same published value, and a future divergence is a one-line derivation here
	 * rather than a hand-tuned CSS number.
	 */
	work: 0.08,
};
/**
 * The block veil's step off the canvas glass.
 *
 * A BLOCK is text-bearing content whose fill was its ONLY boundary on the flat
 * system (the user message bubble: `messageSurface`, floored at ΔE00 4.0 off
 * canvas; project cards, hub cards). On glass the flat role has no usable
 * answer: `messageSurface` itself measures 0.77 dark / 0.46 light as an alpha
 * floor and collapses to ΔE00 0.9-1.2 off the canvas on rosewood/oneLight/
 * iceberg - a bubble that vanishes. So the block's fill becomes a RELATIVE
 * overlay: the palette's `ink` at the smallest alpha that still steps ΔE00 4.0
 * off the canvas glass at ITS floor, over the worst measured backdrop. Like a
 * state overlay it does not scale with the slider (the ground beneath moves, the
 * step stays >= 4.0), and it is painted once: a well never sits under a veiled
 * block (`docs/branding.md`, the alpha-owning law).
 */
export const GLASS_BLOCK_VEIL_STEP = 4.0;
export const GLASS_STATE_STEP = { hover: 1.5, selected: 2.5, field: 1.5 };

/**
 * A LANE IS A WELL THAT MUST READ ON A TRANSLUCENT PAGE, and it cannot be an ink
 * overlay the way a field or a track is.
 *
 * WHY NOT INK. A lane sits UNDER text-bearing blocks (the Projects board's cards),
 * and the block veil is already an ink layer over the ground. Ink 5% under a veil
 * measured `inkMuted` 4.03:1 on synthwave (the stack the veil's note forbids) - the
 * card's own text is the thing a lane would spend. So a lane is a palette ROLE at an
 * alpha over the page's canvas glass. It composes and leaves the veil as the only
 * ink layer under the card.
 *
 * THE ALPHA TRACKS THE SLIDER. Review round 1 (F2) measured the failure of a fixed
 * wash: the page moved `0.66 -> 0.96` with intensity while the lane stayed at one
 * alpha, and the step fell to ΔE00 0.59 on dark at 25 and 0.99 on light at 0 - the
 * lane vanished exactly where the window was most opaque. The lane therefore takes a
 * SCALE of the page's own alpha (`pageAlpha * scale`), so it converges on the flat
 * role at the opaque end and keeps the same share of the ground's translucency at
 * the clear end. ONE constant per scheme, but the family is derived at EVERY slider
 * position (0..100) and every material tier, and the committed scale is the max the
 * worst position needs.
 *
 * THE ROLE IS DERIVED TOO, because a single role cannot carry both schemes: at the
 * opaque end the page is nearly the canvas colour, so the lane can only step as far
 * as the role's own distance from `canvas` allows. Dark `surface` is ΔE00 1.3-1.6
 * off `canvas` on several palettes and cannot clear at any alpha; dark `sunken`
 * can. Light `sunken` is equally close to `canvas`; light `surface` can. The wash
 * therefore recesses on dark and lifts on light - the direction that moves AWAY from
 * the material tone the page composites toward. Derived, never hand-picked.
 */
export const GLASS_LANE_STEP = 1.5;
/**
 * Mirrors `GLASS_ALPHA_CEILING` in `src/shared/window-glass.ts`. This script has no
 * build step and cannot import the TypeScript module, so `window-glass.test.mjs`
 * (G-7c) asserts the mirror: a change that is not carried here fails the suite
 * rather than silently moving the derivation.
 */
export const LANE_ALPHA_CEILING = 0.96;
/** The roles the derivation may choose between, in preference order. */
export const LANE_ROLES = ["sunken", "surface"];

/**
 * THE ONE RELAXATION, stated: `inkDim` (captions, metadata, placeholders) is held to
 * 3.5:1, not 4.5:1, on a hovered or selected row and on a field's fill over glass.
 * `ink` and `inkMuted` keep AA. Measured: no ink-overlay state can keep `inkDim` at
 * 4.5:1 - the flat system already ships `inkDim` at its 5.0 floor on `rowSelected`,
 * and ANY lightening of a dark ground (or darkening of a light one) spends that
 * margin - so holding it would force every dark ground to alpha 1.0 and switch glass
 * off. 3.5:1 clears the 3:1 non-text floor with headroom and costs ~0.07 of ground
 * alpha, which is the price of states that are visible instead of holes.
 */
export const GLASS_STATE_DIM_FLOOR = 3.5;

const lum = (hex) => {
	const h = hex.replace("#", "");
	const full =
		h.length === 3
			? h
					.split("")
					.map((c) => c + c)
					.join("")
			: h.slice(0, 6);
	const [r, g, b] = [0, 2, 4].map((i) => {
		const c = Number.parseInt(full.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a, b) => {
	const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
	return (x + 0.05) / (y + 0.05);
};
const channel = (hex, i) =>
	Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
export const gray = (n) => `#${n.toString(16).padStart(2, "0").repeat(3)}`;
/** `fg` at alpha `a` over `bg`, both opaque hex: the flat colour a reader sees. */
export const composite = (fg, a, bg) =>
	`#${[0, 1, 2]
		.map((i) =>
			Math.round(channel(fg, i) * a + channel(bg, i) * (1 - a))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;

/** A palette is dark when its canvas is: the same split the contract uses. */
export const schemeOf = (palette) =>
	lum(palette.canvas) < 0.18 ? "dark" : "light";

/** The smallest alpha, in 0.01 steps, at which `ink` clears the floor on `role` over `backdrop`. */
export const minAlpha = (palette, role, ink, backdrop) => {
	for (let a = 0.2; a <= 1.0001; a += 0.01) {
		if (
			ratio(palette[ink], composite(palette[role], a, backdrop)) >=
			GLASS_INK_FLOOR
		)
			return Math.round(a * 100) / 100;
	}
	return 1;
};

/** As `minAlpha`, with the ink overlay `state` stacked on the ground composite. */
export const minAlphaUnder = (palette, role, ink, backdrop, state) => {
	for (let a = 0.2; a <= 1.0001; a += 0.01) {
		const ground = composite(palette[role], a, backdrop);
		if (
			ratio(palette[ink], composite(palette.ink, state, ground)) >=
			(ink === "inkDim" ? GLASS_STATE_DIM_FLOOR : GLASS_INK_FLOOR)
		)
			return Math.round(a * 100) / 100;
	}
	return 1;
};

/** The smallest alpha at which the structural edge clears 3:1 against `role` over `backdrop`. */
export const minEdgeAlpha = (palette, role, backdrop) => {
	for (let a = 0.2; a <= 1.0001; a += 0.01) {
		if (
			ratio(palette.borderControl, composite(palette[role], a, backdrop)) >=
			GLASS_EDGE_FLOOR
		)
			return Math.round(a * 100) / 100;
	}
	return 1;
};

/** `ink` at `mix` over `borderControl`: the edge colour the glass regions paint. */
export const glassEdge = (palette, mix) =>
	composite(palette.ink, mix, palette.borderControl);

/**
 * The block veil: the smallest ink alpha clearing `GLASS_BLOCK_VEIL_STEP` off
 * the canvas glass at its committed floor, max over palettes per scheme.
 *
 * ONE CONSTANT PER SCHEME, not per material tier: the veil is relative to the
 * ground it sits on, and the ground already carries the tier's floor. Measured
 * minimum steps at the derived values: dark 4.27 (solarizedDark), light 4.20
 * (ayuLight) - the palettes the note names as binding.
 */
export function deriveBlockVeil(floors) {
	const palettes = loadPalettes();
	const out = {};
	for (const scheme of ["dark", "light"]) {
		let need = 0;
		for (const tier of Object.keys(BACKDROP_GRAY)) {
			for (const { palette } of palettes) {
				if (schemeOf(palette) !== scheme) continue;
				const ground = composite(
					palette.canvas,
					floors[tier][scheme].canvas,
					gray(BACKDROP_GRAY[tier][scheme]),
				);
				let a = 0.01;
				while (
					a < 1 &&
					deltaE(composite(palette.ink, a, ground), ground) <
						GLASS_BLOCK_VEIL_STEP
				)
					a = Math.round((a + 0.01) * 100) / 100;
				need = Math.max(need, a);
			}
		}
		/* The exact smallest clearing alpha, like `minAlpha`: the contract asserts
		 * it at the committed value, so headroom here would be a number nobody
		 * derived. */
		out[scheme] = Math.round(need * 100) / 100;
	}
	return out;
}

/**
 * The lane's role and the scale of the page alpha it is painted at, per scheme.
 *
 * For every candidate role and every slider position and material tier, the
 * smallest alpha that clears `GLASS_LANE_STEP` off the page composite is found; a
 * role is feasible only if such an alpha exists at every position (at the opaque
 * end it may not: see the note above). The committed scale is the largest ratio of
 * the needed alpha to the page's own alpha, rounded UP to 0.01 - the one constant
 * the whole family is multiplied by. Rounding up covers every position; the
 * contract then asserts the exact shipped composite at each one.
 */
export function deriveLaneWash(floors) {
	const palettes = loadPalettes();
	const positions = Array.from({ length: 101 }, (_, i) => i);
	const pageAlpha = (floor, intensity) =>
		Math.round(
			(LANE_ALPHA_CEILING - (intensity / 100) * (LANE_ALPHA_CEILING - floor)) *
				100,
		) / 100;
	/* The smallest alpha clearing the floor on every palette for one tier and
	 * position, or null when no alpha can (the role is too close to the canvas). */
	const needAt = (role, scheme, intensity, tier) => {
		for (let a = 0.05; a <= 1.0001; a = Math.round((a + 0.01) * 100) / 100) {
			let clears = true;
			for (const { palette } of palettes) {
				if (schemeOf(palette) !== scheme) continue;
				const page = composite(
					palette.canvas,
					pageAlpha(floors[tier][scheme].canvas, intensity),
					gray(BACKDROP_GRAY[tier][scheme]),
				);
				if (deltaE(composite(palette[role], a, page), page) < GLASS_LANE_STEP) {
					clears = false;
					break;
				}
			}
			if (clears) return a;
		}
		return null;
	};
	const out = {};
	for (const scheme of ["dark", "light"]) {
		let best = null;
		for (const role of LANE_ROLES) {
			let scale = 0;
			let feasible = true;
			for (const tier of Object.keys(BACKDROP_GRAY)) {
				for (const intensity of positions) {
					const need = needAt(role, scheme, intensity, tier);
					if (need === null) {
						feasible = false;
						break;
					}
					scale = Math.max(
						scale,
						need / pageAlpha(floors[tier][scheme].canvas, intensity),
					);
				}
				if (!feasible) break;
			}
			if (!feasible) continue;
			/* Round up, then bump until the RUNTIME rounding (2dp of `pageAlpha *
			 * scale`, exactly what `glassPaintFor` publishes) clears at every position. */
			let committed = Math.ceil(scale * 100) / 100;
			for (;;) {
				let clears = true;
				for (const tier of Object.keys(BACKDROP_GRAY)) {
					for (const intensity of positions) {
						const a =
							Math.round(
								pageAlpha(floors[tier][scheme].canvas, intensity) *
									committed *
									100,
							) / 100;
						if (a < needAt(role, scheme, intensity, tier)) {
							clears = false;
							break;
						}
					}
					if (!clears) break;
				}
				if (clears) break;
				committed = Math.round((committed + 0.01) * 100) / 100;
			}
			const candidate = { role, scale: committed };
			if (best === null || candidate.scale < best.scale) best = candidate;
		}
		if (best === null)
			throw new Error(
				`no lane role clears ΔE00 ${GLASS_LANE_STEP} on ${scheme} at every slider position`,
			);
		out[scheme] = best;
	}
	return out;
}

export function derive() {
	const palettes = loadPalettes();
	const out = {};
	for (const [tier, byScheme] of Object.entries(BACKDROP_GRAY)) {
		out[tier] = {};
		for (const scheme of ["dark", "light"]) {
			out[tier][scheme] = {};
			for (const role of GLASS_ROLES) {
				let worst = 0;
				for (const { palette } of palettes) {
					if (schemeOf(palette) !== scheme) continue;
					for (const ink of GLASS_INKS)
						worst = Math.max(
							worst,
							minAlpha(palette, role, ink, gray(byScheme[scheme])),
							...Object.values(GLASS_STATE_ALPHA).map((s) =>
								minAlphaUnder(palette, role, ink, gray(byScheme[scheme]), s),
							),
						);
				}
				// Two steps of headroom over the measured worst palette: the backdrop
				// grey is a measurement of three materials over two flat desktops,
				// and a real wallpaper is neither.
				out[tier][scheme][role] = Math.min(
					1,
					Math.round((worst + 0.02) * 100) / 100,
				);
			}
		}
	}
	return out;
}

/**
 * THE ISOLATING BAND'S OWN ALPHA FLOOR, per scheme.
 *
 * A BAND is a strip that masks what scrolls under it, and the ordinary bands
 * (`data-glass-plane="band"`) sit on a STATIC ground - the pane's own fill -
 * so the pane's published alpha is right for them. An ISOLATING BAND
 * (`data-glass-plane="band-backdrop"`) sits over MOVING content, and that
 * changes the question: its ground is whatever happens to be scrolling under
 * it, so the alpha that keeps the band readable is not the ground's alpha but
 * the alpha at which the INK ON IT still clears its floor over the worst
 * content that can pass beneath.
 *
 * THE FLOOR IS DERIVED, NOT CHOSEN. For each palette in the scheme, the
 * smallest alpha at which the band's own role holds the count's ink over the
 * worst content colour clears the 4.5 text floor, and the scheme's floor is
 * the largest of those. The worst content is the extreme the scheme's ink
 * contrasts against: a WHITE thumbnail under a dark band, a BLACK one under a
 * light band. A content colour in between is easier, not harder, so the
 * extremes bound it.
 *
 * The floor is per SCHEME and not per tier because the band is a pane's strip
 * and the pane is under the window; and it is derived against the count's ink
 * (`inkMuted`, the register the app's own section headers use beside a label)
 * rather than the strongest ink, because the count is the band's own text and
 * a band whose count cannot be read is a band that has failed at being one.
 */
export function deriveBandFloor() {
	const palettes = loadPalettes();
	const out = {};
	for (const scheme of ["dark", "light"]) {
		let need = 0;
		for (const { palette } of palettes) {
			if (schemeOf(palette) !== scheme) continue;
			/* The worst content colour: the extreme the ink contrasts against. */
			const backdrop = scheme === "dark" ? "#ffffff" : "#000000";
			const a = minAlpha(palette, "elevated", "inkMuted", backdrop);
			need = Math.max(need, a);
		}
		out[scheme] = Math.round(need * 100) / 100;
	}
	return out;
}

/** The smallest border->ink mix (0.05 steps) that holds 3:1 on every ground at its floor. */
export function deriveControlMix(floors) {
	const palettes = loadPalettes();
	const out = {};
	for (const [tier, byScheme] of Object.entries(BACKDROP_GRAY)) {
		out[tier] = {};
		for (const scheme of ["dark", "light"]) {
			let need = 0;
			for (const { palette } of palettes) {
				if (schemeOf(palette) !== scheme) continue;
				for (const role of GLASS_ROLES) {
					const ground = composite(
						palette[role],
						floors[tier][scheme][role],
						gray(byScheme[scheme]),
					);
					let m = 0;
					while (
						m < 1 &&
						ratio(glassEdge(palette, m), ground) < GLASS_EDGE_FLOOR
					)
						m = Math.round((m + 0.05) * 100) / 100;
					need = Math.max(need, m);
				}
			}
			out[tier][scheme] = Math.min(1, Math.round((need + 0.05) * 100) / 100);
		}
	}
	return out;
}

/**
 * THE GLASS SCALE: how much STRONGER than the thin look the material reads on light.
 *
 * Three tiers, named so a later change has something to point at:
 *
 *   - thin    lift 0, edge 0: the look that shipped. On dark it is still the shipped
 *             look (both numbers below are 0 on dark).
 *   - regular the default: the derived `paneLift` and `edgeMix` below.
 *   - thick   RESERVED, not shipped. It would be a larger pair, not a new mechanism.
 *
 * WHY LIGHT NEEDS IT AND DARK DOES NOT (measured, not assumed). A pane inside
 * `<main>` is painted at the NET alpha, `1 - (1 - target) / (1 - canvasBacking)`,
 * clamped at 0. On dark the pane target (`elevated`, 0.87+) sits well above the
 * canvas backing and the pane steps ΔE00 2.5-5.4 off the canvas. On light the
 * targets run the other way (`surface` 0.59 / `elevated` 0.55 under a 0.68 canvas
 * at 80): the net clamps to 0, the pane paints NOTHING, and canvas -> pane is
 * ΔE00 0.0. The side pane then reads as the same sheet as the conversation, which
 * is the "glass is weaker on light" report.
 *
 * WHAT CANNOT FIX IT, so the derivation does not try: CSS `backdrop-filter` blur
 * and `saturate()` sample the page behind the element, and behind the window's
 * translucent layers there is only the OS desktop, which CSS never sees; a shadow
 * is forbidden as elevation (docs/branding.md, one shadow, for things that leave
 * the flow). The scale therefore moves two things the app owns: the pane's alpha
 * (`paneLift`) and the seam's colour (`edgeMix`).
 *
 * `paneLift` (light, PER MATERIAL TIER like the floors): the smallest lift, added to
 * the canvas alpha to form the pane's target, at which the pane steps
 * `GLASS_PANE_STEP` off the canvas for every light palette, slider 40..100 and the
 * tier's material greys (under-window: 199 and 224; menu 171; popover 143). Below slider 40 the
 * canvas is nearly opaque and the pane is not held to the floor (sliders 5..39 step
 * 1.54+ over grey 199; sliders 0..4 are not lifted enough: net 0 at 0-1, step
 * 0.93-0.99 at 2-4, as before the scale).
 *
 * WHY 1.5: `GLASS_PANE_STEP` reuses `GLASS_LANE_STEP`, the repo's floor for a
 * translucent plane that must read as structure against its neighbour (below it the
 * plane is not structure). With 0.14 the tightest light pane step is 1.53
 * (`tokyoNightDay`, slider 91, grey 224) for the under-window tier. The menu and
 * popover tiers are darker materials, so the same step needs far less lift (0.05 and
 * 0.04; tightest 1.59 and 2.00). One under-window lift applied everywhere (the first
 * version) only added opacity there: menu 0.82 -> 0.96 and popover 0.88 -> 0.96
 * effective alpha at slider 80, for a pane step that was already 3.42 and 2.87.
 * `edgeMix` (light): the smallest `ink` share mixed into `hairline` at which the
 * 75% panel seam steps `GLASS_SEAM_STEP` off each of the three glass grounds at
 * their floors. It recolours the existing seam; it adds no line.
 * Dark is 0 for both: nothing is derived for a scheme that does not need it.
 */
export const GLASS_PANE_STEP = 1.5;
export const GLASS_SEAM_STEP = 3.0;
/** The light material greys the scale is held over: the measured worst (199) and a brighter one. */
export const GLASS_SCALE_GRAYS = { light: [199, 224], dark: [81] };
/**
 * The greys each material tier's pane step is held over. Only the under-window tier
 * has the brighter 224 variant (a window material lifted by a bright wallpaper);
 * menu and popover were measured at one grey per scheme and are held there.
 */
export const GLASS_SCALE_GRAYS_BY_TIER = {
	"under-window": GLASS_SCALE_GRAYS,
	menu: {
		light: [BACKDROP_GRAY.menu.light],
		dark: [BACKDROP_GRAY.menu.dark],
	},
	popover: {
		light: [BACKDROP_GRAY.popover.light],
		dark: [BACKDROP_GRAY.popover.dark],
	},
};
/** The slider range the pane step is held over (see above for why not below 40). */
export const GLASS_PANE_STEP_FROM = 40;
/** The seam's alpha: mirrors `bg-hairline/75` in `panel-edge.tsx` (the contract reads that class back). */
export const GLASS_SEAM_ALPHA = 0.75;

const round2 = (n) => Math.round(n * 100) / 100;

/** Mirrors `glassAlphas` in `src/shared/window-glass.ts`: the role alpha at a slider position. */
export const glassAlphaAt = (floor, intensity) => {
	const t = Math.min(100, Math.max(0, intensity)) / 100;
	const top = Math.max(LANE_ALPHA_CEILING, floor);
	return round2(top - t * (top - floor));
};

/**
 * The lifted pane inside `<main>` and the canvas backing under it, as flat hexes:
 * what `glassPaintFor` paints (`--lo-glass-in-pane` over `--lo-glass-a-canvas`).
 * Mirrors the TypeScript formula; `window-glass.test.mjs` pins the two together.
 */
export function paneOverCanvas(
	palette,
	tierFloors,
	lift,
	intensity,
	grayLevel,
) {
	const aCanvas = glassAlphaAt(tierFloors.canvas, intensity);
	const aElevated = glassAlphaAt(tierFloors.elevated, intensity);
	const target = Math.max(
		aElevated,
		Math.min(LANE_ALPHA_CEILING, aCanvas + lift),
	);
	const net = round2(
		Math.min(1, Math.max(0, 1 - (1 - target) / (1 - aCanvas))),
	);
	const backing = composite(palette.canvas, aCanvas, gray(grayLevel));
	return {
		canvas: backing,
		pane: composite(palette.elevated, net, backing),
		net,
	};
}

/**
 * The smallest pane lift (0.01 steps) per material tier that steps `GLASS_PANE_STEP`
 * off the canvas; dark is 0 on every tier. The lift is derived PER TIER because the
 * tier's own floors and grey decide how much of it is needed: the menu and popover
 * panes already sit a larger step off their canvas at a given lift than the
 * under-window one does (the material is darker), so the one lift that clears the
 * under-window tier would only add opacity there.
 */
export function derivePaneLift(floors) {
	const palettes = loadPalettes();
	const out = {};
	for (const tier of Object.keys(BACKDROP_GRAY)) {
		out[tier] = { dark: 0 };
		const tierFloors = floors[tier].light;
		const grays = GLASS_SCALE_GRAYS_BY_TIER[tier].light;
		for (let lift = 0; lift <= 0.5; lift = round2(lift + 0.01)) {
			let clears = true;
			for (const { palette } of palettes) {
				if (schemeOf(palette) !== "light") continue;
				for (const g of grays)
					for (let i = GLASS_PANE_STEP_FROM; i <= 100; i++) {
						const { canvas, pane } = paneOverCanvas(
							palette,
							tierFloors,
							lift,
							i,
							g,
						);
						if (deltaE(canvas, pane) < GLASS_PANE_STEP) clears = false;
					}
			}
			if (clears) {
				out[tier].light = lift;
				break;
			}
		}
		if (out[tier].light === undefined)
			throw new Error(
				`no pane lift up to 0.5 clears ΔE00 ${GLASS_PANE_STEP} on light (${tier})`,
			);
	}
	return out;
}

/** The seam as painted: `ink` at `mix` over `hairline`, at `GLASS_SEAM_ALPHA`, over `ground`. */
export const seamOver = (palette, mix, ground) =>
	composite(
		composite(palette.ink, mix, palette.hairline),
		GLASS_SEAM_ALPHA,
		ground,
	);

/** The three glass grounds at their floors over a material grey. */
export const glassGrounds = (palette, tierFloors, grayLevel) =>
	GLASS_ROLES.map((role) => ({
		role,
		hex: composite(palette[role], tierFloors[role], gray(grayLevel)),
	}));

/** The smallest ink mix (0.01 steps) the seam needs to step `GLASS_SEAM_STEP`; dark is 0. */
export function deriveEdgeMix(floors) {
	const palettes = loadPalettes();
	const tierFloors = floors["under-window"].light;
	let need = 0;
	for (const { palette } of palettes) {
		if (schemeOf(palette) !== "light") continue;
		for (const g of GLASS_SCALE_GRAYS.light)
			for (const { hex } of glassGrounds(palette, tierFloors, g)) {
				let m = 0;
				while (
					m < 1 &&
					deltaE(seamOver(palette, m, hex), hex) < GLASS_SEAM_STEP
				)
					m = round2(m + 0.01);
				need = Math.max(need, m);
			}
	}
	return { dark: 0, light: need };
}

export const deriveGlassScale = (floors) => ({
	paneLift: derivePaneLift(floors),
	edgeMix: deriveEdgeMix(floors),
});

/**
 * THE TEXT AUDIT over every ground the scale touches. For each palette, ink, ground
 * (raw canvas, raw surface, raw elevated, and the lifted pane inside `<main>), state
 * overlay, slider position (0..100 step 5) and material grey, the ratio is held to
 * `GLASS_INK_FLOOR` (`inkDim` on an overlay: `GLASS_STATE_DIM_FLOOR`). Returns the
 * violations and the single worst pair per scheme, by margin over its own floor.
 */
export function auditGlassText(floors, scale) {
	const palettes = loadPalettes();
	const overlays = [["none", 0], ...Object.entries(GLASS_STATE_ALPHA)];
	const failures = [];
	const worst = {};
	let checked = 0;
	for (const { id, palette } of palettes) {
		const scheme = schemeOf(palette);
		for (const tierName of Object.keys(BACKDROP_GRAY))
			for (const g of GLASS_SCALE_GRAYS_BY_TIER[tierName][scheme])
				for (let i = 0; i <= 100; i += 5) {
					const floorsHere = floors[tierName][scheme];
					const lift = scale.paneLift[tierName][scheme];
					const raw = {
						canvas: composite(
							palette.canvas,
							glassAlphaAt(floorsHere.canvas, i),
							gray(g),
						),
						surface: composite(
							palette.surface,
							glassAlphaAt(floorsHere.surface, i),
							gray(g),
						),
						elevated: composite(
							palette.elevated,
							glassAlphaAt(floorsHere.elevated, i),
							gray(g),
						),
						pane: paneOverCanvas(palette, floorsHere, lift, i, g).pane,
					};
					for (const [ground, base] of Object.entries(raw))
						for (const [overlay, a] of overlays) {
							const fill = a ? composite(palette.ink, a, base) : base;
							for (const ink of GLASS_INKS) {
								const floor =
									ink === "inkDim" && a
										? GLASS_STATE_DIM_FLOOR
										: GLASS_INK_FLOOR;
								const r = ratio(palette[ink], fill);
								checked++;
								const entry = {
									palette: id ?? palette.name,
									scheme,
									tier: tierName,
									ground,
									ink,
									overlay,
									intensity: i,
									gray: g,
									ratio: r,
									floor,
								};
								if (r < floor) failures.push(entry);
								if (
									!worst[scheme] ||
									r - floor < worst[scheme].ratio - worst[scheme].floor
								)
									worst[scheme] = entry;
							}
						}
				}
	}
	return { failures, worst, checked };
}

/* The shared helper, not a hand-rolled argv compare: a symlinked path (macOS
 * `/tmp`) must answer the same, and `scripts/entry-point.test.mjs` enforces it. */
if (isEntryPoint(import.meta.url)) {
	const derived = derive();
	if (process.argv.includes("--report")) {
		/* The AA matrix and the two step minima, at the COMMITTED scale. */
		const file = JSON.parse(readFileSync(FLOORS_PATH, "utf8"));
		const audit = auditGlassText(file.alphaFloor, file.glassScale);
		console.log(
			`text pairs checked: ${audit.checked}; violations: ${audit.failures.length}`,
		);
		for (const [scheme, w] of Object.entries(audit.worst))
			console.log(
				`worst ${scheme}: ${w.palette} ${w.ink} on ${w.ground}${w.overlay === "none" ? "" : ` + ${w.overlay} overlay`} at slider ${w.intensity}, grey ${w.gray}: ${w.ratio.toFixed(2)}:1 (floor ${w.floor})`,
			);
		process.exit(audit.failures.length ? 1 : 0);
	}
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
					glassScale: deriveGlassScale(derived),
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
		const scale = deriveGlassScale(committed);
		/* paneLift is per material tier; edgeMix is one pair. */
		const scaleCells = [
			...Object.keys(BACKDROP_GRAY).flatMap((tier) =>
				["dark", "light"].map((scheme) => ({
					name: `paneLift/${tier}/${scheme}`,
					have: file.glassScale?.paneLift?.[tier]?.[scheme],
					need: scale.paneLift[tier][scheme],
				})),
			),
			...["dark", "light"].map((scheme) => ({
				name: `edgeMix/${scheme}`,
				have: file.glassScale?.edgeMix?.[scheme],
				need: scale.edgeMix[scheme],
			})),
		];
		for (const { name, have, need } of scaleCells)
			if ((have ?? -1) < need) {
				bad++;
				console.error(
					`glass scale ${name} is ${have} but the palettes need ${need} - re-derive, never hand-lower it`,
				);
			}
		const audit = auditGlassText(committed, file.glassScale ?? scale);
		for (const f of audit.failures.slice(0, 10)) {
			bad++;
			console.error(
				`glass text ${f.palette} ${f.ink} on ${f.ground}${f.overlay === "none" ? "" : ` + ${f.overlay}`} at ${f.intensity}/grey ${f.gray} is ${f.ratio.toFixed(2)}:1, floor ${f.floor}`,
			);
		}
		process.exit(bad ? 1 : 0);
	}
}
