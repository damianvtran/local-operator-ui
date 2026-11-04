/**
 * Contrast, the second layer of a composed appearance (theme -> contrast -> accent).
 *
 * WHAT IT IS. One integer per mode, -100..100, that moves a palette's GROUNDS
 * toward an anchor lightness and keeps every ink legible on them. +100 (High) is
 * the darkest canvas a dark theme can carry under its own text - Obsidian at High
 * is near-black under near-white - and the lightest paper for a light theme; -100
 * (Soft) is a stony, lower-chroma ground (grey/stone/slate on dark, a duller paper
 * on light) with quieter text. The named presets are snap points on that line:
 * Soft -100, Gentle -50, Standard 0, Strong +50, High +100 (`CONTRAST_PRESETS`).
 *
 * THE GUARANTEE, and why it is a search rather than a formula. A translated ground
 * family keeps every L* step the contract asserts, but ΔE00 compresses near L* 0
 * and as chroma drops, and several shipped palettes sit within hundredths of a ΔE00
 * floor - so no closed-form move is safe on all 59. `applyContrast` therefore
 * builds a candidate, REPAIRS it, and then asks the contract's own per-palette
 * assertions (`evaluate.mjs`, the code `pnpm check-themes` runs) whether it holds.
 * When it does not, it pulls the requested value toward 0 until it does and
 * reports what it reached as `effectiveContrast` ("limited to Strong on this
 * theme"). The repair heuristics only decide how OFTEN a palette is capped; they
 * cannot make the engine return a failing palette, because the verdict is the
 * gate's, never the heuristic's. Floors are never relaxed - the only things that
 * move inward are the anchors and the requested value.
 *
 * WHAT A COMPOSED RUN DOES NOT ASSERT: the authored L* band (`LIFT`), the §5b
 * fleet rules, pin/ledger staleness and the design-kit pins. Those are claims
 * about the AUTHORED palettes; a preset leaves the band on purpose and is nobody's
 * fleet member. See `createRun({ composed: true })`.
 *
 * CONSTRAINTS. Pure and deterministic (the mini-view popout recomposes locally and
 * has to reach the same palette); never mutates its input; `c === 0` returns the
 * input object itself, so Standard is the built-in, by reference.
 */

import { deltaE, labToHex, ratio, toLab } from "./color.mjs";
import {
	ALT_ACCENT_CHROMA_FLOOR,
	CHART_HOVER_SEPARATION_FLOOR,
	FIELD_SEPARATION_FLOOR,
	GROUNDS6,
	INKS,
	INK_CANVAS_FLOOR,
	INK_STEP_DELTA_E,
	INK_STEP_FLOOR,
	MESSAGE_SURFACE_LIGHTNESS_STEP,
	ROW_HOVER_CAST_FLOOR_SHARE,
	ROW_HOVER_CHROMA_FLOOR,
	ROW_SELECTED_CHROMA_FLOOR,
	ROW_SELECTED_CHROMA_RISE,
	ROW_SELECTED_STEP_CEILING,
	ROW_STATE_ACCENTLESS,
	ROW_STATE_CHROMA_CAP,
	ROW_STATE_CHROMA_RANK,
	ROW_STATE_NEUTRAL_PANEL,
	SEPARATION_FLOOR,
	STEP,
} from "./contract-tables.mjs";
import { createRun, evaluatePalette } from "./evaluate.mjs";

/** The named snap points on the slider. Standard is the authored palette. */
export const CONTRAST_PRESETS = Object.freeze({
	soft: -100,
	gentle: -50,
	standard: 0,
	strong: 50,
	high: 100,
});

/**
 * Canvas L* each mode reaches at |c| = 100.
 *
 * Starting values were the architect's (dark 5 / 20, light 97 / 89). They are
 * where the canvas is ASKED to go; the gamut guard and the verifying search below
 * decide where it lands, per palette. Recorded here because moving one inward is
 * the sanctioned response to a preset a palette cannot reach - relaxing a floor is
 * not.
 */
export const CONTRAST_ANCHORS = Object.freeze({
	dark: Object.freeze({ high: 5, soft: 20 }),
	light: Object.freeze({ high: 97, soft: 89 }),
});

/*
 * The roles that MOVE WITH THE CANVAS. Every `STEP` and `LIFT`-offset rule in the
 * contract is an L* DIFFERENCE between members of this family, so translating the
 * whole family by one ΔL* preserves them exactly up to 8-bit rounding.
 * `inkDisabled` is here, not with the inks: it is held BELOW `inkDim` by a ceiling
 * relative to the ground, so it has to travel with the grounds.
 */
const GROUND_FAMILY = [
	"canvas",
	"surface",
	"elevated",
	"sunken",
	"messageSurface",
	"mediaSurface",
	"rowHover",
	"rowSelected",
	"accentWash",
	"accentAltWash",
	"successWash",
	"warningWash",
	"dangerWash",
	"infoWash",
	"hairline",
	"hairlineStrong",
	"inkDisabled",
];

/* Row states and washes keep their chroma on Soft: the row-state cast floors and
   the wash-vs-row separations are read in C*, so draining them would fail rules
   that have nothing to do with how stony the panels look. */
const KEEPS_CHROMA = new Set([
	"rowHover",
	"rowSelected",
	"accentWash",
	"accentAltWash",
	"successWash",
	"warningWash",
	"dangerWash",
	"infoWash",
]);

/* Grounds every foreground is first solved against. This is a FAST pre-solve, not
   the verdict: it gets a candidate close enough that the contract's own pass (the
   verdict) usually holds at the requested value. */
const G8 = [
	"canvas",
	"surface",
	"elevated",
	"sunken",
	"accentWash",
	"rowHover",
	"rowSelected",
	"messageSurface",
];
const G4 = G8.slice(0, 4);
const TONE = [...G4, "accentWash", "messageSurface"];
/** role -> [grounds, floor]: the floors from `contract-tables.mjs`, by role. */
const FOREGROUND = {
	ink: [G8, 7],
	inkMuted: [G8, 5.5],
	inkDim: [G8, 5],
	borderControl: [G4, 3],
	accent: [[...TONE, "warningWash"], 4.5],
	accentHover: [G4, 4.5],
	accentActive: [G4, 4.5],
	tokenCommand: [["surface", "elevated", "messageSurface"], 4.5],
	accentAlt: [G4, 4.5],
	success: [TONE, 4.5],
	warning: [[...TONE, "rowSelected", "rowHover"], 4.5],
	danger: [TONE, 4.5],
	info: [TONE, 4.5],
	successBorder: [G4, 3],
	warningBorder: [G4, 3],
	dangerBorder: [G4, 3],
	infoBorder: [G4, 3],
	chartBarHover: [["surface"], 3],
};
/* Headroom over a floor for the pre-solve, so an 8-bit rounding of the solved
   value cannot land it a thousandth under. */
const HEADROOM = 0.05;
/* L* kept clear of the white wall by light High's ladder compression, so an
   8-bit round of the top rung cannot clip to #FFFFFF and merge two planes. */
const CEILING_HEADROOM = 0.3;
/* The ΔE00 every pair in light High's compressed upper ladder keeps (or its
   authored value, if smaller): the contract's ladder floors top out at 4.0
   (canvas/elevated, the message block), plus 8-bit headroom. */
const LADDER_KEEP_DELTA_E = 4.1;
/* How far under the authored ink-side spread Soft draws its ladder at t = 1. */
const SOFT_SPREAD_EASE = 0.06;

const FLAT_HEX = /^#[0-9A-Fa-f]{6}$/;
const isFlatHex = (v) => typeof v === "string" && FLAT_HEX.test(v);
const norm = (h) => h.slice(0, 7).toUpperCase();

/**
 * A Lab triple as an in-gamut hex at THAT lightness, giving up chroma (never hue,
 * never lightness) until it fits. The contract's own re-solves take the same
 * order: lightness is what the floors are written in, hue is the theme's identity.
 */
export const labAtLightness = (L, a, b) => {
	const l = Math.max(0, Math.min(100, L));
	for (let k = 1; k >= 0; k -= 0.02) {
		const hex = labToHex([l, a * k, b * k]);
		if (hex) return hex;
	}
	return labToHex([l, 0, 0]);
};

const worstRatio = (p, hex, grounds) =>
	Math.min(
		...grounds.filter((g) => isFlatHex(p[g])).map((g) => ratio(hex, p[g])),
	);

/**
 * Move `role` along L* only (hue and chroma kept), AWAY from the grounds, until it
 * clears `floor` on every listed ground. Leaves an already-passing value alone, so
 * a palette whose text still clears at the preset keeps its authored text.
 */
export const solveLightness = (p, role, grounds, floor) => {
	const value = p[role];
	if (!isFlatHex(value) || worstRatio(p, value, grounds) >= floor + HEADROOM)
		return value;
	const [l, a, b] = toLab(value);
	const dir = p.mode === "dark" ? 1 : -1;
	for (let s = 0.25; s <= 100; s += 0.25) {
		const hex = labAtLightness(l + dir * s, a, b);
		if (worstRatio(p, hex, grounds) >= floor + HEADROOM) return hex;
	}
	return value;
};

/**
 * Text on accent: the first candidate that clears 4.5:1, preferring the AUTHORED
 * `onAccent` so today's look survives wherever it still passes, then the theme's
 * own ink and canvas, then pure white/black. Falls back to the strongest of them.
 */
export const pickOnAccent = (accent, candidates) => {
	const list = candidates.filter(isFlatHex).map(norm);
	const pass = list.find((h) => ratio(h, accent) >= 4.5);
	if (pass) return pass;
	return [...list].sort((x, y) => ratio(y, accent) - ratio(x, accent))[0];
};

/* Sl, CIEDE2000's lightness weight. A fixed L* step reads as a SMALLER ΔE00 the
   further it sits from L* 50, which is why a translation that keeps every L* step
   still loses ΔE00 at High (L* ~5) and on light Soft. `ladderSpread` uses it to
   widen the ground ladder by exactly the compression the move introduced. */
const sl = (L) => 1 + (0.015 * (L - 50) ** 2) / Math.sqrt(20 + (L - 50) ** 2);

/** C* of a hex. */
const chromaOf = (hex) => {
	const [, a, b] = toLab(hex);
	return Math.hypot(a, b);
};

/** `hex` at the same L* and hue, at chroma `c` (gamut permitting). */
const withChroma = (hex, c) => {
	const [l, a, b] = toLab(hex);
	const now = Math.hypot(a, b);
	if (now < 1e-6) return hex;
	return labAtLightness(l, (a / now) * c, (b / now) * c);
};

/*
 * The row states' chroma, re-placed inside the window the contract's row-state
 * rules define AGAINST THE COMPOSED PANEL. Those rules (cast floor, cast ceiling,
 * the selection's rank over the hover) are all relative to `surface`'s C*, so when
 * Soft drains the panel the rows have to move with it - or a selection authored
 * at panel+4 sits at panel+8 against the stonier panel and reads as a coloured
 * plane, which is what the ceiling forbids. The offsets from the panel are kept
 * where the window allows; the constants are the contract's own.
 */
const placeRowChroma = (out) => {
	if (!isFlatHex(out.rowHover) || !isFlatHex(out.rowSelected)) return;
	snapRowHue(out);
	const panel = chromaOf(out.surface);
	const hoverLo = Math.max(
		ROW_HOVER_CHROMA_FLOOR,
		ROW_HOVER_CAST_FLOOR_SHARE * panel,
	);
	const hoverHi = Math.max(panel, ROW_HOVER_CHROMA_FLOOR);
	const selLo = Math.max(ROW_SELECTED_CHROMA_FLOOR, panel);
	const selHi = Math.min(
		Math.max(panel + ROW_SELECTED_CHROMA_RISE, ROW_SELECTED_CHROMA_FLOOR),
		ROW_STATE_CHROMA_CAP,
	);
	const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
	const hover = chromaOf(out.rowHover);
	const sel = chromaOf(out.rowSelected);
	/* Already inside the window: leave the authored value alone. */
	if (
		hover >= hoverLo &&
		hover <= hoverHi &&
		sel >= selLo &&
		sel <= selHi &&
		sel >= hover + ROW_STATE_CHROMA_RANK
	)
		return;
	const h = clamp(hover, hoverLo + 0.1, hoverHi - 0.1);
	const sNew = clamp(
		Math.max(sel, h + ROW_STATE_CHROMA_RANK + 0.2),
		selLo + 0.1,
		selHi - 0.1,
	);
	out.rowHover = withChroma(out.rowHover, h);
	out.rowSelected = withChroma(out.rowSelected, sNew);
};

/*
 * Row states take their hue from the panel (or, on a neutral panel, the accent),
 * within ROW_STATE_HUE_LIMIT degrees. At High a low-chroma row near L* 5 is
 * re-quantised to 8 bits and its hue drifts by tens of degrees, so a row that was
 * 6 degrees off its panel when authored can land 15 off. Rows further than
 * `ROW_HUE_SNAP` off are rotated onto the source hue (C* and L* kept); rows inside
 * it are left as authored.
 */
const ROW_HUE_SNAP = 6;
const hueOf = (hex) => {
	const [, a, b] = toLab(hex);
	return Math.atan2(b, a);
};
const snapRowHue = (out) => {
	const panelC = chromaOf(out.surface);
	const source =
		panelC >= ROW_STATE_NEUTRAL_PANEL
			? out.surface
			: chromaOf(out.accent) >= ROW_STATE_ACCENTLESS
				? out.accent
				: out.surface;
	const target = hueOf(source);
	for (const role of ["rowHover", "rowSelected"]) {
		const [l, a, b] = toLab(out[role]);
		const c = Math.hypot(a, b);
		if (c < ROW_STATE_NEUTRAL_PANEL) continue;
		const off = Math.abs(
			((((Math.atan2(b, a) - target) * 180) / Math.PI + 540) % 360) - 180,
		);
		if (off <= ROW_HUE_SNAP) continue;
		out[role] = labAtLightness(l, c * Math.cos(target), c * Math.sin(target));
	}
};

/*
 * The ink ladder, solved as a LADDER rather than three independent roles. Each
 * weight has its own floor on every ground, and the weights have floors BETWEEN
 * them (`inkDim` -> `inkMuted` ΔE00 >= INK_STEP_FLOOR, `inkMuted` -> `ink` >=
 * INK_STEP_DELTA_E). Solving each alone can push `inkDim` up into `inkMuted`, so
 * the order is bottom-up and every rung is pushed (L* only, away from the
 * grounds) until it clears both its ground floors and its rung below.
 */
const solveInkLadder = (out) => {
	const dir = out.mode === "dark" ? 1 : -1;
	const rung = (role, grounds, floor, below, apart) => {
		const v = out[role];
		if (!isFlatHex(v)) return;
		const ok = (hex) =>
			worstRatio(out, hex, grounds) >= floor + HEADROOM &&
			(!below || deltaE(hex, out[below]) >= apart + HEADROOM) &&
			(role !== "ink" || ratio(hex, out.canvas) >= INK_CANVAS_FLOOR + HEADROOM);
		if (ok(v)) return;
		const [l, a, b] = toLab(v);
		for (let s = 0.25; s <= 100; s += 0.25) {
			const hex = labAtLightness(l + dir * s, a, b);
			if (ok(hex)) {
				out[role] = hex;
				return;
			}
		}
	};
	rung("inkDim", GROUNDS6, inkFloor("inkDim"), null, 0);
	rung("inkMuted", GROUNDS6, inkFloor("inkMuted"), "inkDim", INK_STEP_FLOOR);
	rung("ink", GROUNDS6, inkFloor("ink"), "inkMuted", INK_STEP_DELTA_E);
};
const inkFloor = (role) => INKS.find(([r]) => r === role)[1];

/*
 * BODY INK FOLLOWS THE SLIDER (QA round 1, Q1/Q2 on #1674). "Reached" has to
 * mean the effect happened, not only that no floor failed: ink on the canvas
 * must not fall from Standard to High, nor rise from Standard to Soft. The ground
 * ladder alone cannot promise that - light High is pinned under the white wall
 * (several palettes author `elevated` at L* 100), and on Soft the ink is pushed
 * by its floor on the farthest ground, whose luminance ratio to the canvas grows
 * as the ladder moves toward mid-grey. So after the ladder is solved, `ink` is
 * moved along L* (hue and chroma kept) toward the target ratio on the canvas:
 *   High side: AWAY from the canvas until ink/canvas >= R0 * (1 + INK_GAIN * t),
 *              the extreme of the gamut at most - more ink, never less.
 *   Soft side: TOWARD the canvas until ink/canvas <= R0 * (1 - INK_RELEASE * t),
 *              never past a floor `solveInkLadder` enforces (so a floor-bound
 *              palette stays where its floor puts it).
 * R0 is the AUTHORED ink/canvas ratio, so the targets are monotone in t and the
 * presets order themselves; the contrast-presets gate asserts that order.
 */
const INK_GAIN = 0.15;
const INK_RELEASE = 0.12;
const tensionInk = (out, r0, c) => {
	if (!isFlatHex(out.ink) || !isFlatHex(out.canvas)) return;
	const t = Math.abs(c) / 100;
	const away = out.mode === "dark" ? 1 : -1;
	if (c > 0) {
		const [l, a, b] = toLab(out.ink);
		const target = r0 * (1 + INK_GAIN * t);
		if (ratio(out.ink, out.canvas) >= target) return;
		for (let s = 0.25; s <= 100; s += 0.25) {
			const L = l + away * s;
			if (L < 0 || L > 100) break;
			const hex = labAtLightness(L, a, b);
			out.ink = hex;
			if (ratio(hex, out.canvas) >= target) return;
		}
		return;
	}
	/* Soft moves the ink LADDER toward the canvas: all three rungs together
	   first, then the top two, then `ink` alone - `ink` is usually pinned by
	   `inkMuted` sitting INK_STEP_DELTA_E under it (catppuccinLatte 2.06), and
	   `inkMuted` by `inkDim` at its own floor, so moving one rung alone moves
	   nothing. Each stage goes as far as every floor allows, then hands on. */
	const target = r0 * (1 - INK_RELEASE * t);
	const all = ["ink", "inkMuted", "inkDim"].filter((r) => isFlatHex(out[r]));
	const legal = (next) =>
		all.every(
			(r) => worstRatio(out, next[r], GROUNDS6) >= inkFloor(r) + HEADROOM,
		) &&
		/* No headroom on the canvas floor: `ink` is a final hex here, and the
		   authored palettes sit within hundredths of 8.0 (rosePineDawn 8.01), so
		   headroom would hold Soft ABOVE Standard. */
		ratio(next.ink, out.canvas) >= INK_CANVAS_FLOOR &&
		(!next.inkMuted ||
			deltaE(next.ink, next.inkMuted) >= INK_STEP_DELTA_E + HEADROOM) &&
		(!next.inkMuted ||
			!next.inkDim ||
			deltaE(next.inkMuted, next.inkDim) >= INK_STEP_FLOOR + HEADROOM);
	for (const moving of [all, all.slice(0, 2), all.slice(0, 1)]) {
		const start = Object.fromEntries(moving.map((r) => [r, toLab(out[r])]));
		for (let s = 0.25; s <= 60; s += 0.25) {
			if (ratio(out.ink, out.canvas) <= target) return;
			const next = { ...out };
			for (const r of moving) {
				const [L, A, B] = start[r];
				next[r] = labAtLightness(L - away * s, A, B);
			}
			if (!legal(next)) break;
			for (const r of moving) out[r] = next[r];
		}
	}
};

/*
 * A follower that has to stay a MEASURED distance from its leader after the
 * leader was solved: `accentHover`/`accentActive` keep the accent's own steps
 * (ΔE00 >= FIELD_SEPARATION_FLOOR pairwise), `chartBarHover` stays
 * CHART_HOVER_SEPARATION_FLOOR off `accent` and no quieter on `surface`. Moved by
 * L* only, away from the grounds.
 */
const separateFrom = (out, role, from, apart, extra = () => true) => {
	const v = out[role];
	if (!isFlatHex(v) || !from.split(",").every((f) => isFlatHex(out[f]))) return;
	const ok = (hex) =>
		from.split(",").every((f) => deltaE(hex, out[f]) >= apart + HEADROOM) &&
		extra(hex);
	if (ok(v)) return;
	const [l, a, b] = toLab(v);
	const dir = out.mode === "dark" ? 1 : -1;
	for (const sgn of [dir, -dir]) {
		for (let s = 0.25; s <= 40; s += 0.25) {
			const hex = labAtLightness(l + sgn * s, a, b);
			if (ok(hex)) {
				out[role] = hex;
				return;
			}
		}
	}
};

/**
 * The candidate palette at `c`, BEFORE verification. Exported for the tests and
 * the solver comparisons; callers that need the guarantee use `applyContrast`.
 *
 * `spread` widens every family member's L* offset from the canvas (1 = the
 * Sl-compensated ladder, larger = more separated rungs). `applyContrast` searches
 * it; nothing else should need to pass it.
 */
export const contrastCandidate = (
	p,
	c,
	{ spread = 1, narrow = false, ease = SOFT_SPREAD_EASE, travel = 1 } = {},
) => {
	if (c === 0) return p;
	const side = c > 0 ? "high" : "soft";
	const t = Math.abs(c) / 100;
	const out = { ...p };
	const lab = (r) => toLab(norm(p[r]));
	const lc = lab("canvas")[0];
	const anchor = CONTRAST_ANCHORS[p.mode][side];
	const family = GROUND_FAMILY.filter((r) => isFlatHex(p[r]));
	/* A preset never moves the canvas AGAINST its own direction (QA round 1, Q1
	   on #1674). Light palettes authored darker than the Soft anchor
	   (kanagawaLotus L* 85.6, linen 88.9) would otherwise be LIFTED by Soft -
	   more ink contrast for the setting that promises less. Such a palette keeps
	   its paper at Soft; its chroma still drains. */
	const towardSide = (side === "high") === (p.mode === "light") ? 1 : -1;
	let d = Math.max(0, (anchor - lc) * towardSide) * towardSide * t * travel;
	let lcNew = lc + d;
	/* Widen the ladder by the ΔE00 compression the move introduced (Sl at the new
	   canvas over Sl at the old), and by the chroma Soft takes away - never narrow
	   it, which would spend headroom the authored palette had. */
	const chroma = side === "soft" ? 1 - 0.4 * t : 1;
	/* Soft MAY narrow the ladder, by exactly the Sl ratio (QA round 1, Q1/Q2 on
	   #1674). Soft moves the canvas toward L* 50, where the same L* step is both a
	   LARGER ΔE00 (Sl falls) and a larger luminance RATIO (the 0.05 flare term
	   and the cube both weigh less there). Keeping the authored L* offsets then
	   widened every ground's ratio to the canvas, so the ink - held at its floor
	   on the farthest ground - rose on the canvas: Soft read sharper than Gentle
	   (ayuDark 9.70 vs 9.34). Scaling the offsets by Sl keeps each step's ΔE00
	   and gives back that ratio. High keeps "never narrow". */
	const slRatio = sl(lcNew) / sl(lc);
	const k = (side === "soft" ? slRatio : Math.max(1, slRatio)) * spread;
	const placed = Object.fromEntries(
		family.map((r) => [r, lcNew + (lab(r)[0] - lc) * k]),
	);
	/* Widening is capped by the contract's own L* STEP ceilings: a canvas ->
	   surface step past 5 L* "eats the room the ink ladder needs". Each ladder
	   ground keeps at least its authored step and at most the ceiling (less 8-bit
	   headroom); the roles placed relative to it ride along by the same amount. */
	const dirL = p.mode === "dark" ? 1 : -1;
	const capStep = (role, [, hi], sign) => {
		const authored = (lab(role)[0] - lc) * sign;
		const want = (placed[role] - lcNew) * sign;
		const max = Math.max(authored, hi - 0.15);
		if (want > max) placed[role] = lcNew + sign * max;
	};
	capStep("surface", STEP.canvasSurface, dirL);
	capStep("sunken", STEP.canvasSunken, -dirL);
	{
		const authored = (lab("elevated")[0] - lab("surface")[0]) * dirL;
		const want = (placed.elevated - placed.surface) * dirL;
		const max = Math.max(authored, STEP.surfaceElevated[1] - 0.15);
		if (want > max) placed.elevated = placed.surface + dirL * max;
	}
	/* The row states are measured from `surface`, not the canvas, and the
	   selection has a CEILING on that step (ROW_SELECTED_STEP_CEILING): every L*
	   it rises is ink headroom spent on the caps drawn inside it. So they keep
	   their authored offset from the placed panel, widened by the same factor only
	   as far as that ceiling, with the hover kept at its authored share of it. */
	const ls0 = lab("surface")[0];
	const dirUp = p.mode === "dark" ? 1 : -1;
	const selStep = (lab("rowSelected")[0] - ls0) * dirUp;
	const hovStep = (lab("rowHover")[0] - ls0) * dirUp;
	const kRow =
		selStep > 0 ? Math.min(k, ROW_SELECTED_STEP_CEILING / selStep) : k;
	/* Soft narrows the row offsets by the same Sl ratio as the ladder (see `k`);
	   High still never narrows them. */
	const kRowUsed = side === "soft" ? kRow : Math.max(1, kRow);
	placed.rowSelected = placed.surface + dirUp * selStep * kRowUsed;
	placed.rowHover = placed.surface + dirUp * hovStep * kRowUsed;
	/* The gamut guard: no family member may leave [0.5, 100], so the whole ladder
	   is shifted back by the member nearest the wall - a ladder squashed against
	   black keeps its L* steps on paper and loses them on screen. */
	/*
	 * LIGHT HIGH COMPRESSES THE UPPER LADDER INSTEAD OF SINKING IT (QA round 1,
	 * Q1 on #1674). On light, `surface`/`elevated`/`messageSurface` sit 3-9 L*
	 * ABOVE the canvas, and several palettes author `elevated` at L* 100 already.
	 * Translating the family toward the 97 anchor and then shifting it back under
	 * the white wall cancelled the move - or reversed it: githubLight,
	 * highContrastLight, oneLight and ayuLight landed DARKER at High than at
	 * Standard, with less ink contrast, while reporting a full reach. So the
	 * rungs above the canvas are scaled into the room left under L* 100 (the
	 * paper rises; the planes on it close up), never below the contract's own
	 * minimum steps (`STEP.canvasSurface`, `STEP.surfaceElevated`, plus the
	 * 8-bit headroom the step caps above use). Where even the minimum ladder
	 * does not fit, the canvas stops short of the anchor - the furthest lift
	 * that keeps the steps - rather than the whole ladder sliding down.
	 */
	if (p.mode === "light" && side === "high") {
		const base = lc + d;
		/* The AUTHORED offsets, not the Sl-widened ones: the widening grows
		   with t, and measuring the trial on it made the highest canvas that
		   holds FALL as t rose (kanagawaLotus High below Strong). On the
		   authored ladder the answer is min(anchor move, one ceiling), which
		   is monotone in t by construction. */
		const above = Object.keys(placed).filter((r) => lab(r)[0] > lc);
		const span = Math.max(0, ...above.map((r) => lab(r)[0] - lc));
		if (span > 0) {
			/* The rungs at a trial canvas L* `at`, compressed into the room under
			   the wall, as the hexes the browser would paint. */
			const trial = (at) => {
				const s = Math.min(1, (100 - CEILING_HEADROOM - at) / span);
				const hex = { canvas: labAtLightness(at, ...lab("canvas").slice(1)) };
				for (const r of above)
					hex[r] = labAtLightness(
						at + (lab(r)[0] - lc) * s,
						...lab(r).slice(1),
					);
				return hex;
			};
			/* A trial holds when the contract's ladder floors survive near the
			   wall, in ΔE00 (L* steps are not enough there - Sl is ~1.7, so the
			   2.5 L* STEP floor is ΔE00 ~1.5): every adjacent pair of the three
			   planes at FIELD_SEPARATION_FLOOR, canvas -> elevated and the message
			   block at LADDER_KEEP_DELTA_E, plus headroom. The criterion depends
			   on `at` alone and only gets harder as `at` rises, so the highest
			   canvas that holds is monotone in t: High never lands below Strong. */
			const pairs = [
				["canvas", "surface", FIELD_SEPARATION_FLOOR],
				["surface", "elevated", FIELD_SEPARATION_FLOOR],
				["canvas", "elevated", LADDER_KEEP_DELTA_E],
				["canvas", "messageSurface", LADDER_KEEP_DELTA_E],
			].filter(
				([x, y]) => (x === "canvas" || above.includes(x)) && above.includes(y),
			);
			/* And the L* floors, which on a low-chroma ladder bind before ΔE00
			   does (gruvboxLight: 1.4 L* canvas -> surface at ΔE00 ~2). */
			const lPairs = [
				["canvas", "surface", STEP.canvasSurface[0]],
				["surface", "elevated", STEP.surfaceElevated[0]],
				["canvas", "messageSurface", MESSAGE_SURFACE_LIGHTNESS_STEP],
			].filter(
				([x, y]) => (x === "canvas" || above.includes(x)) && above.includes(y),
			);
			const holds = (hex) =>
				pairs.every(
					([x, y, floor]) => deltaE(hex[x], hex[y]) >= floor + HEADROOM * 2,
				) &&
				lPairs.every(
					([x, y, floor]) =>
						toLab(hex[y])[0] - toLab(hex[x])[0] >= floor + 0.15,
				);
			/* The highest canvas whose compressed ladder holds, searched down
			   from the anchor and never below Standard's paper. */
			let at = base;
			while (at > lc && !holds(trial(at))) at = Math.max(lc, at - 0.25);
			/* At Standard's own paper the authored ladder is in gamut by
			   definition: nothing to compress. */
			const s =
				at <= lc ? 1 : Math.min(1, (100 - CEILING_HEADROOM - at) / span);
			/* Rungs below the canvas are re-placed from the FINAL canvas with the
			   widening that canvas implies - computed from the anchor they would
			   carry the anchor's widening down to a canvas that never got there
			   (highContrastLight High: sunken 6.02 L* under, past the 6.0 cap). */
			const kAt = Math.max(1, sl(at) / sl(lc)) * spread;
			/* Row states are measured from `surface`, not the canvas, and were
			   placed from it above (with the selection's step ceiling): they
			   follow the compressed panel at that same offset, or a hover
			   authored a hair above the canvas lands on top of the panel
			   (catppuccinLatte Strong, ΔE00 1.66 hover/surface). */
			const rowOff = {
				rowHover: placed.rowHover - placed.surface,
				rowSelected: placed.rowSelected - placed.surface,
			};
			for (const r of Object.keys(placed))
				placed[r] = above.includes(r)
					? at + (lab(r)[0] - lc) * s
					: at + (placed[r] - base) * (kAt / k);
			for (const r of ["rowHover", "rowSelected"])
				if (r in placed && Number.isFinite(rowOff[r]))
					placed[r] = placed.surface + rowOff[r];
			lcNew = at;
			d = at - lc;
		}
	}
	/*
	 * SOFT DOES NOT WIDEN THE INK'S WORST GROUND (QA round 1, Q2 on #1674).
	 * Body ink is held at its floor on the ground NEAREST it in luminance (the
	 * lightest rung on dark, the darkest well on light), so ink/canvas is at
	 * least that floor times ratio(that ground, canvas). Toward mid-grey the same
	 * L* offset is a larger luminance ratio, so a translated ladder forced the
	 * ink UP on the canvas as Soft deepened (ayuDark Soft 9.70 > Gentle 9.34;
	 * ayuLight Soft above Standard). So on Soft the ink-side rungs are drawn in
	 * toward the canvas until the widest of those ratios is no more than the
	 * authored one, eased by SOFT_SPREAD_EASE * t so Soft sits strictly under
	 * Gentle. Only offsets shrink, never the order; where that breaks a ground
	 * floor the contract's verdict rejects the candidate, as for any other move.
	 */
	if (side === "soft" && narrow) {
		const inkSide = (L) => (p.mode === "dark" ? L > lcNew : L < lcNew);
		const lumL = (L) =>
			L > 8 ? ((L + 16) / 116) ** 3 : Math.max(0, L) / 903.3;
		const spreadAt = (Lc, L) => {
			const [x, y] = [lumL(Lc), lumL(L)];
			return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
		};
		const near = GROUNDS6.filter((r) => r in placed && inkSide(placed[r]));
		const authoredMax = Math.max(
			1,
			...GROUNDS6.filter(
				(r) =>
					r in placed && (p.mode === "dark" ? lab(r)[0] > lc : lab(r)[0] < lc),
			).map((r) => spreadAt(lc, lab(r)[0])),
		);
		const cap = authoredMax * (1 - ease * t);
		const worst = (s) =>
			Math.max(
				1,
				...near.map((r) => spreadAt(lcNew, lcNew + (placed[r] - lcNew) * s)),
			);
		if (near.length > 0 && worst(1) > cap) {
			let s = 1;
			while (s > 0.3 && worst(s) > cap) s -= 0.01;
			for (const r of Object.keys(placed))
				if (inkSide(placed[r])) placed[r] = lcNew + (placed[r] - lcNew) * s;
		}
	}
	const lo = Math.min(...Object.values(placed));
	const hi = Math.max(...Object.values(placed));
	const shift = lo < 0.5 ? 0.5 - lo : hi > 100 ? 100 - hi : 0;
	/* The row-state rules take their hue from `surface` while it carries C* >= 2
	   and from the ACCENT below that - so a Soft drain that took a tinted panel
	   under 2 would silently switch every row's hue reference to the accent and
	   fail the rows for following the panel. The panel keeps just enough cast to
	   stay the reference. */
	const surfaceC = chromaOf(norm(p.surface));
	const surfaceK =
		surfaceC >= ROW_STATE_NEUTRAL_PANEL
			? Math.max(
					chroma,
					Math.min(1, (ROW_STATE_NEUTRAL_PANEL + 0.4) / surfaceC),
				)
			: chroma;
	for (const r of family) {
		const [, a, b] = lab(r);
		const kc = KEEPS_CHROMA.has(r) ? 1 : r === "surface" ? surfaceK : chroma;
		out[r] = labAtLightness(placed[r] + shift, a * kc, b * kc);
	}
	placeRowChroma(out);
	d = lcNew + shift - lc;
	/* Foregrounds keep their AUTHORED values and are solved back over their floors
	   on the moved grounds - High's darker ground only raises an ink's ratio, and
	   Soft's lifted ground is what makes the text quieter. The accent family moves
	   together so its own steps survive. */
	for (const r of Object.keys(FOREGROUND))
		if (isFlatHex(p[r])) out[r] = norm(p[r]);
	solveInkLadder(out);
	tensionInk(out, ratio(norm(p.ink), norm(p.canvas)), c);
	/* On Soft the lifted grounds push the hue roles UP in L* (dark) to keep their
	   text floors, and two hues pushed toward white converge in ΔE00 - the accent
	   and its second hue lose the 15 that makes them two accents. The pair is
	   solved together: move the second hue first (its own floors are fewer), and
	   only as far as it has to. */
	const accentBefore = toLab(out.accent)[0];
	out.accent = solveLightness(out, "accent", ...FOREGROUND.accent);
	const accentMove = toLab(out.accent)[0] - accentBefore;
	for (const r of ["accentHover", "accentActive"]) {
		if (!isFlatHex(out[r]) || accentMove === 0) continue;
		const [l, a, b] = toLab(out[r]);
		out[r] = labAtLightness(l + accentMove, a, b);
	}
	for (const [r, [grounds, floor]] of Object.entries(FOREGROUND)) {
		if (r.startsWith("ink") || r === "accent") continue;
		out[r] = solveLightness(out, r, grounds, floor);
	}
	separateFrom(
		out,
		"accentHover",
		"accent",
		FIELD_SEPARATION_FLOOR,
		(h) => worstRatio(out, h, G4) >= 4.5 + HEADROOM,
	);
	separateFrom(
		out,
		"accentActive",
		"accent,accentHover",
		FIELD_SEPARATION_FLOOR,
		(h) => worstRatio(out, h, G4) >= 4.5 + HEADROOM,
	);
	separateFrom(
		out,
		"accentAlt",
		"accent",
		SEPARATION_FLOOR,
		(h) =>
			worstRatio(out, h, G4) >= 4.5 + HEADROOM &&
			chromaOf(h) >= ALT_ACCENT_CHROMA_FLOOR,
	);
	separateFrom(
		out,
		"chartBarHover",
		"accent",
		CHART_HOVER_SEPARATION_FLOOR,
		(h) => ratio(h, out.surface) >= ratio(out.accent, out.surface),
	);
	out.onAccent = pickOnAccent(out.accent, [
		p.onAccent,
		out.ink,
		out.canvas,
		"#FFFFFF",
		"#000000",
	]);
	return out;
};

/** The contract's per-palette verdict over a composed palette: failure messages. */
export const composedFindings = (palette, id = "custom") => {
	const run = createRun({ composed: true });
	evaluatePalette(run, { id, palette });
	return run.log;
};

/* A repair may move `accent`, so text on it is re-picked on EVERY candidate the
   repair evaluates - the pick is inside the verdict, never applied after it. */
const finishOnAccent = (p, authored) => {
	const onAccent = pickOnAccent(p.accent, [
		authored.onAccent,
		p.ink,
		p.canvas,
		"#FFFFFF",
		"#000000",
	]);
	return onAccent === p.onAccent ? p : { ...p, onAccent };
};

/* Roles a repair never moves: `mode`, the CSS values (`overlayShadow`, `scrim`)
   and `onAccent`, which is re-picked on every candidate. The canvas IS movable:
   the anchor is where it is asked to go, and pulling it a few L* back toward the
   authored value is the sanctioned move when a ladder hits the gamut wall at
   black (arcade at High: its media well has no L* left below the canvas). */
const FIXED = new Set(["mode", "overlayShadow", "scrim", "onAccent"]);
/* The row-state ledger messages ("the wash row ... is stale") name the ledger,
   not the roles; these are the roles those rows measure. */
const LEDGER_ROLES = ["rowHover", "rowSelected", "accentWash", "surface"];
const ROLE_TOKEN = /\b[a-z][A-Za-z]+\b/g;

/**
 * The movable roles a finding names - by role name, or by the hex value it printed
 * (the CONTROLS rows print a triple's fill as a colour, not a role).
 */
const rolesNamed = (palette, messages) => {
	const byHex = new Map();
	for (const [r, v] of Object.entries(palette))
		if (!FIXED.has(r) && isFlatHex(v)) byHex.set(v.toUpperCase(), r);
	const out = new Set();
	for (const m of messages) {
		if (m.includes("ROW_STATE_MEASURED_SHORTFALL"))
			for (const r of LEDGER_ROLES) out.add(r);
		for (const [w] of m.matchAll(ROLE_TOKEN))
			if (w in palette && !FIXED.has(w) && isFlatHex(palette[w])) out.add(w);
		for (const [h] of m.matchAll(HEX_TOKEN)) {
			const r = byHex.get(h.toUpperCase());
			if (r) out.add(r);
		}
	}
	return [...out];
};
const HEX_TOKEN = /#[0-9A-Fa-f]{6}\b/g;
const MEASURED =
	/(?:= |ΔE00 )(\d+(?:\.\d+)?)(?::1)?[\s\S]*?need (\d+(?:\.\d+)?)/;

/*
 * How far a finding is from passing, 0..1, as a TIE-BREAK only. Most contract
 * messages print "<got> ... need <floor>"; those report their shortfall, the rest
 * count as a full unit. The repair's acceptance is still "fewer failures, or as
 * many but closer" - the verdict that matters (zero findings) is the contract's.
 */
const shortfall = (messages) => {
	let sum = 0;
	for (const m of messages) {
		const hit = m.match(MEASURED);
		if (!hit) {
			sum += 1;
			continue;
		}
		const got = Number(hit[1]);
		const need = Number(hit[2]);
		sum += need > 0 ? Math.min(1, Math.max(0, (need - got) / need)) : 1;
	}
	return sum;
};
const score = (messages) => messages.length * 1000 + shortfall(messages);

/* The moves tried per named role: L* both ways at growing sizes (a ΔE00 gap of
   two units needs a move of several L* - a single small step would sit on the
   plateau), then chroma both ways (the row-state rules and Soft's drained grounds
   are read in C*). Hue is never moved here - it is the theme's identity. */
const L_MOVES = [0.5, -0.5, 1, -1, 2, -2, 4, -4, 7, -7, 11, -11];
const C_MOVES = [0.7, 0.85, 1.15, 1.35];
const REPAIR_ROUNDS = 60;

/**
 * Oracle-driven repair: the Tier-B (and residual Tier-A) solver.
 *
 * The candidate's ladder is translated and widened analytically, which gets most
 * palettes most of the way; what is left is a handful of PAIRS a few hundredths
 * under a ΔE00 or ratio floor, on palettes that were authored within hundredths
 * of those floors. Rather than re-implement each of the contract's ~200 rules as
 * an inverse, the repair asks the contract itself: for each role a failing
 * assertion names, it tries the small moves above and keeps the one that lowers
 * the contract's failure count the most, until the count is 0 or no move helps.
 * Greedy and deterministic (fixed move order, ties keep the first), so the
 * popout and the main window reach the same palette.
 */
export const repairPalette = (palette, id, authored = palette) => {
	let out = finishOnAccent(palette, authored);
	let findings = composedFindings(out, id);
	let current = score(findings);
	for (let round = 0; round < REPAIR_ROUNDS && findings.length > 0; round++) {
		let best = null;
		for (const role of rolesNamed(out, findings)) {
			const [l, a, b] = toLab(out[role]);
			const tries = [
				...L_MOVES.map((dl) => labAtLightness(l + dl, a, b)),
				...C_MOVES.map((k) => labAtLightness(l, a * k, b * k)),
			];
			for (const hex of tries) {
				if (hex === out[role]) continue;
				const next = finishOnAccent({ ...out, [role]: hex }, authored);
				const f = composedFindings(next, id);
				const sc = score(f);
				if (sc < (best ? best.score : current) - 1e-9)
					best = { next, findings: f, score: sc };
			}
		}
		if (!best) break;
		out = best.next;
		findings = best.findings;
		current = best.score;
	}
	return { palette: out, findings };
};

/* The requested value is pulled toward 0 in steps of this many slider units when
   the candidate does not hold, so a capped palette reports a value the slider can
   show ("limited to +70"). */
const CAP_STEP = 5;

/* The ladder widths tried at each value, narrowest first: the narrowest ladder
   that holds is the one closest to the authored spacing. Wider rungs are how a
   ladder compressed near black (or drained of chroma on Soft) gets its ΔE00
   separations back without touching a floor. */
const LADDER_SPREADS = [1, 1.15];
/* The candidates tried at each value, in order. Soft first tries the ladder
   drawn in on the ink side (`narrow`, so ink/canvas falls with the slider) and
   falls back to the plain ladder where that breaks a ground floor - a palette
   whose Soft cannot be both quieter and legible keeps Soft legible, and the
   presets gate's monotonic leg names it. */
const CANDIDATES = [
	{ spread: 1, narrow: true },
	/* Palettes authored AT a ground floor cannot afford the full ease. */
	{ spread: 1, narrow: true, ease: 0 },
	...LADDER_SPREADS.map((spread) => ({ spread })),
	/* A light palette whose ink sits at its floor on the darkest well
	   (tokyoNightDay, rosePineDawn) has to darken that ink to follow a paper
	   moved toward the Soft anchor - LOUDER text for the quieter setting. Soft
	   then keeps less (or none) of the paper's travel and spends itself on the
	   chroma drain and the ink release instead: a softer theme at the value
	   asked, rather than a cap. High never takes these (`v > 0` skips them). */
	{ spread: 1, travel: 0.5, soft: true },
	{ spread: 1, travel: 0, soft: true },
];

/*
 * "REACHED" MEANS THE EFFECT HAPPENED (QA round 1, Q1 on #1674). Legible is not
 * enough: light High once returned a canvas DARKER than Standard with LESS ink
 * contrast and reported `effectiveContrast: 100`. A value is only reported when,
 * against the authored palette, ink on the canvas went the slider's way (no
 * lower on the High side, no higher on the Soft side) and the canvas did not
 * move against it. Otherwise the search caps toward 0 like any other miss, so a
 * UI that says "limited to Strong" is telling the truth.
 */
/* One 8-bit step of a dark ink at the 8.0:1 canvas floor moves the ratio by
   ~0.1, so a palette AUTHORED at that floor (rosePineDawn 8.011, tokyoNightDay
   8.031) has no hex between the floor and its own Standard: its Soft ink lands
   a hundredth above Standard or under the floor. That hundredth is
   quantisation, not a direction, and is the only slack either this check or the
   presets gate's monotonic leg allows (`INK_ORDER_TOLERANCE` is exported so the
   gate uses the same number). */
export const INK_ORDER_TOLERANCE = 0.015;
const movedTheRightWay = (authored, composed, c) => {
	const r0 = ratio(norm(authored.ink), norm(authored.canvas));
	const r = ratio(composed.ink, composed.canvas);
	const l0 = toLab(norm(authored.canvas))[0];
	const l = toLab(composed.canvas)[0];
	/* Which way the canvas travels toward this side's anchor. */
	const toward = c > 0 === (authored.mode === "light") ? 1 : -1;
	/* The Soft side tests ink only: a light palette authored under the Soft
	   anchor keeps its paper (see `contrastCandidate`) and the repair may nudge
	   it a fraction of an L*; quieter ink is the effect Soft promises. */
	return c > 0
		? r >= r0 - INK_ORDER_TOLERANCE && (l - l0) * toward >= -0.05
		: r <= r0 + INK_ORDER_TOLERANCE;
};

/*
 * THE SOFT SIDE'S LAST STEP, under the contract's own verdict. The pre-solve
 * (`tensionInk`) moves the ink ladder with fast proxies for its floors; the
 * repair then may move grounds again. So once a Soft candidate HOLDS, the ink
 * rungs are walked toward the canvas in L* (all three, then the top two, then
 * `ink`), keeping each step only while `composedFindings` stays empty, until
 * ink/canvas is at or under the target. A palette authored AT its floors (the
 * light family's ink/canvas sits at 8.0-8.1 in several) stops where the floor
 * is: equal to Standard, never above it - which is what "non-decreasing" in the
 * presets gate allows.
 */
const releaseInk = (composed, authored, c, id) => {
	const r0 = ratio(norm(authored.ink), norm(authored.canvas));
	const target = r0 * (1 - INK_RELEASE * (Math.abs(c) / 100));
	const toward = composed.mode === "dark" ? -1 : 1;
	const all = ["ink", "inkMuted", "inkDim"].filter((r) =>
		isFlatHex(composed[r]),
	);
	let out = composed;
	for (const moving of [all, all.slice(0, 2), all.slice(0, 1)]) {
		const start = Object.fromEntries(moving.map((r) => [r, toLab(out[r])]));
		for (let s = 0.25; s <= 20; s += 0.25) {
			if (ratio(out.ink, out.canvas) <= target) return out;
			const next = { ...out };
			for (const r of moving) {
				const [L, A, B] = start[r];
				next[r] = labAtLightness(L + toward * s, A, B);
			}
			if (composedFindings(finishOnAccent(next, authored), id).length > 0)
				break;
			out = finishOnAccent(next, authored);
		}
	}
	/* Finer than an L* step: one sRGB channel at a time. A dark ink at the 8.0
	   canvas floor moves ~0.1 per whole-grey 8-bit step, so a palette authored
	   a few hundredths over the floor (kanagawaLotus 8.035) has no L* move
	   between "above Standard" and "under the floor"; a single channel moves
	   the ratio by about a third of that. */
	for (let pass = 0; pass < 6 && ratio(out.ink, out.canvas) > target; pass++) {
		let best = null;
		for (const i of [0, 1, 2])
			for (const delta of [1, -1]) {
				const ch = Number.parseInt(out.ink.slice(1 + 2 * i, 3 + 2 * i), 16);
				const v = ch + delta;
				if (v < 0 || v > 255) continue;
				const hex = `#${out.ink.slice(1, 1 + 2 * i)}${v
					.toString(16)
					.padStart(2, "0")
					.toUpperCase()}${out.ink.slice(3 + 2 * i)}`;
				const r = ratio(hex, out.canvas);
				if (r >= ratio(out.ink, out.canvas)) continue;
				const next = finishOnAccent({ ...out, ink: hex }, authored);
				if (composedFindings(next, id).length > 0) continue;
				if (!best || r > best.r) best = { r, next };
			}
		if (!best) break;
		out = best.next;
	}
	return out;
};

/**
 * Apply contrast `c` to `palette`, VERIFIED.
 *
 * Returns `{ palette, effectiveContrast }`. `effectiveContrast === c` when the
 * request was met; otherwise it is the furthest value toward `c` (in `CAP_STEP`
 * units) at which the contract's per-palette assertions hold, and `0` - the
 * authored palette, which the gate already holds - in the worst case.
 *
 * `id` is the BUILT-IN the palette came from. It matters: the contract's pins
 * (`PAIR_PINS`, the ledgers) are keyed by theme id, so a built-in evaluated
 * under any other name loses the exemptions its authored values were granted
 * and is capped for a shortfall it was always allowed. A custom theme passes
 * its own id, which no pin names - it is held to every floor outright.
 */
export const applyContrast = (palette, c, { id = "custom" } = {}) => {
	if (!Number.isInteger(c) || c < -100 || c > 100) {
		throw new RangeError(`contrast must be an integer in -100..100, got ${c}`);
	}
	if (c === 0) return { palette, effectiveContrast: 0 };
	const sign = Math.sign(c);
	for (let v = c; v !== 0; v -= sign * Math.min(CAP_STEP, Math.abs(v))) {
		for (const opts of CANDIDATES) {
			if ((opts.narrow || opts.soft) && v > 0) continue;
			const candidate = contrastCandidate(palette, v, opts);
			const repaired = repairPalette(candidate, id, palette);
			if (v < 0 && repaired.findings.length === 0)
				repaired.palette = releaseInk(repaired.palette, palette, v, id);
			if (
				repaired.findings.length === 0 &&
				movedTheRightWay(palette, repaired.palette, v)
			)
				return { palette: repaired.palette, effectiveContrast: v };
		}
	}
	return { palette, effectiveContrast: 0 };
};
