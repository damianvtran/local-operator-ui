/**
 * Categorical chart colours, DERIVED from a composed palette.
 *
 * WHY DERIVED, NOT AUTHORED. Inline charts used to paint every series and pie
 * slice as a shade of `accent` (`color-mix(accent N%, canvas)`), which the
 * operator reported as slices that "just differ by shades". Fifty-nine themes,
 * five contrast presets and any custom accent multiply into far more palettes
 * than anyone could author seven chart colours for, so the slots are computed
 * from the palette's own grounds and accent by ONE algorithm (inline chart spec
 * section 4). The same function runs in the theme build
 * (`scripts/generate-theme-css.mjs`, through `paletteBlock`) and at runtime for
 * a composed palette, and its relay-web and React Native copies must reproduce
 * the golden vectors pinned in `scripts/chart-palette.test.mjs` byte for byte.
 *
 * WHAT IT GUARANTEES.
 *   - Slot 1 is always the accent, untouched (the theme's identity colour).
 *   - Slots 2..7 are distinct HUES, not shades: one per base hue, the hue
 *     nearest a chromatic accent dropped so no slot reads as the accent's twin.
 *   - Every derived slot clears 3.05:1 (WCAG) against every ground the chart can
 *     sit on (canvas, surface, message surface) - the 3:1 non-text floor with
 *     the same small headroom the contract keeps elsewhere.
 *   - The greedy order puts the most distinguishable colours first, measured as
 *     the minimum of CIEDE2000 under normal vision, deuteranopia and protanopia
 *     (Machado 2009, severity 1), so a 2-4 series chart uses the safest slots.
 *
 * CONSTRAINTS. Pure and deterministic; hex in, uppercase 6-digit hex out. No
 * slot is added to `PALETTE_ROLES` or the custom-theme editor: these are not
 * user-authored roles.
 */

import { deltaELab, linearToLab, ratio } from "./color.mjs";
import { hexToOklch } from "./oklch.mjs";

/** Base hues in OKLCH degrees, priority order: blue, orange, teal, magenta,
 * yellow, violet, green, red. The order breaks greedy ties. */
export const CHART_BASE_HUES = Object.freeze([
	255, 60, 185, 345, 95, 300, 145, 25,
]);
/** Number of categorical slots (series max 4, pie max 6 + "Other"). */
export const CHART_SLOTS = 7;

const CHROMA = 0.15;
const CHROMA_STEP = 0.005;
const L_STEP = 0.01;
/* 3:1 is the WCAG non-text floor; 0.05 of headroom keeps a rounded hex from
   landing a hair under it on some ground. */
const FLOOR = 3.05;
/* A chromatic accent already owns its hue; a base hue within this many degrees
   would read as a second accent. Below 0.04 chroma the accent is effectively
   grey and owns no hue. */
const ACCENT_HUE_WINDOW = 40;
const ACCENT_MIN_CHROMA = 0.04;

/* Machado, Oliveira & Fernandes (2009), severity 1.0, applied to LINEAR sRGB. */
const PROTANOPIA = [
	[0.152286, 1.052583, -0.204868],
	[0.114503, 0.786281, 0.099216],
	[-0.003882, -0.048116, 1.051998],
];
const DEUTERANOPIA = [
	[0.367322, 0.860646, -0.227968],
	[0.280085, 0.672501, 0.047413],
	[-0.01182, 0.04294, 0.968881],
];

const toLinear = (v) =>
	v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const toSrgb = (v) =>
	v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
const byte = (v) =>
	Math.round(Math.min(1, Math.max(0, v)) * 255)
		.toString(16)
		.padStart(2, "0")
		.toUpperCase();

/** OKLCH -> linear sRGB (Ottosson's published matrices, as oklch.mjs). */
const oklchLinear = (l, c, h) => {
	const a = c * Math.cos((h * Math.PI) / 180);
	const b = c * Math.sin((h * Math.PI) / 180);
	const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
		-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
		-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
	];
};
const inGamut = (rgb) => rgb.every((v) => v >= 0 && v <= 1);

/** The colour at (l, h): C starts at 0.15 and drops in 0.005 steps until the
 * colour is inside sRGB, so a hue never shifts the way a channel clip would. */
const colourAt = (l, h) => {
	let c = CHROMA;
	let rgb = oklchLinear(l, c, h);
	while (!inGamut(rgb) && c > 0) {
		c = Math.max(0, Math.round((c - CHROMA_STEP) * 1000) / 1000);
		rgb = oklchLinear(l, c, h);
	}
	return `#${rgb.map((v) => byte(toSrgb(v))).join("")}`;
};

const linearOf = (hex) =>
	[1, 3, 5].map((i) =>
		toLinear(Number.parseInt(hex.slice(i, i + 2), 16) / 255),
	);
/* The simulated colour stays in linear light (clamped to the displayable cube)
   and is measured unrounded: rounding it to a hex first moves near-tied scores
   by ~0.2 and changes which hue the greedy order picks. */
const simulate = (linear, matrix) =>
	matrix.map((row) =>
		Math.min(
			1,
			Math.max(
				0,
				row.reduce((sum, k, i) => sum + k * linear[i], 0),
			),
		),
	);

/** The colour-vision-safe distance the greedy order maximises. */
export const chartDistance = (a, b) => {
	const [x, y] = [linearOf(a), linearOf(b)];
	return Math.min(
		deltaELab(linearToLab(x), linearToLab(y)),
		deltaELab(
			linearToLab(simulate(x, DEUTERANOPIA)),
			linearToLab(simulate(y, DEUTERANOPIA)),
		),
		deltaELab(
			linearToLab(simulate(x, PROTANOPIA)),
			linearToLab(simulate(y, PROTANOPIA)),
		),
	);
};

const hueGap = (a, b) => {
	const d = Math.abs(a - b) % 360;
	return d > 180 ? 360 - d : d;
};

/**
 * `chartPalette({ grounds, accent })` -> seven uppercase hex colours.
 *
 * `grounds` are the opaque grounds a chart can sit on (canvas first; it alone
 * decides dark vs light). `accent` becomes slot 1 verbatim.
 */
export const chartPalette = ({ grounds, accent }) => {
	const canvas = grounds[0];
	const dark = hexToOklch(canvas).l < 0.5;
	const tone = hexToOklch(accent);
	const hues = [...CHART_BASE_HUES];
	if (tone.c >= ACCENT_MIN_CHROMA) {
		let nearest = -1;
		for (let i = 0; i < hues.length; i++) {
			if (
				hueGap(hues[i], tone.h) <= ACCENT_HUE_WINDOW &&
				(nearest < 0 || hueGap(hues[i], tone.h) < hueGap(hues[nearest], tone.h))
			)
				nearest = i;
		}
		if (nearest >= 0) hues.splice(nearest, 1);
	}
	const starts = dark ? [0.8, 0.7] : [0.5, 0.6];
	const direction = dark ? L_STEP : -L_STEP;
	/* Lightness belongs to the SLOT, not the hue: derived slot k starts at
	   starts[k % 2], so adjacent slots alternate light/dark and stay apart in
	   lightness as well as hue (which is what survives greyscale and CVD). */
	const solve = (h, k) => {
		let l = starts[k % 2];
		let hex = colourAt(l, h);
		/* Step lightness AWAY from the ground until every ground clears the
		   floor; the 0..1 bound keeps a pathological ground from looping. */
		while (
			grounds.some((ground) => ratio(hex, ground) < FLOOR) &&
			l > 0 &&
			l < 1
		) {
			l = Math.round((l + direction) * 100) / 100;
			hex = colourAt(l, h);
		}
		return hex;
	};
	const chosen = [accent.slice(0, 7).toUpperCase()];
	const remaining = [...hues];
	while (chosen.length < CHART_SLOTS && remaining.length) {
		const k = chosen.length - 1;
		let best = 0;
		let bestHex = "";
		let bestScore = -1;
		for (let i = 0; i < remaining.length; i++) {
			const hex = solve(remaining[i], k);
			const score = Math.min(
				...chosen.map((other) => chartDistance(other, hex)),
			);
			/* Strictly greater: a tie keeps the earlier base hue. */
			if (score > bestScore) {
				best = i;
				bestHex = hex;
				bestScore = score;
			}
		}
		remaining.splice(best, 1);
		chosen.push(bestHex);
	}
	return chosen;
};

const FLAT_HEX = /^#[0-9A-Fa-f]{6}$/;

/** The grounds a palette's charts sit on, in `chartPalette`'s order. */
export const chartGrounds = (palette) =>
	[palette.canvas, palette.surface, palette.messageSurface].filter(
		(v) => typeof v === "string" && FLAT_HEX.test(v),
	);

/**
 * `--lo-chart-N` custom property lines for a palette, or [] when the palette
 * does not carry the flat-hex canvas and accent the algorithm needs (a partial
 * capture palette, for example) - the stylesheet's fallbacks then apply.
 */
export const chartPaletteLines = (palette) => {
	const grounds = chartGrounds(palette);
	if (
		!grounds.length ||
		grounds[0] !== palette.canvas ||
		typeof palette.accent !== "string" ||
		!FLAT_HEX.test(palette.accent)
	)
		return [];
	return chartPalette({ grounds, accent: palette.accent }).map(
		(hex, i) => `\t--lo-chart-${i + 1}: ${hex};`,
	);
};
