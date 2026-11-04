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

const isFlatHex = (v) => typeof v === "string" && /^#[0-9A-Fa-f]{6}$/.test(v);
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
export const contrastCandidate = (p, c, { spread = 1 } = {}) => {
	if (c === 0) return p;
	const side = c > 0 ? "high" : "soft";
	const t = Math.abs(c) / 100;
	const out = { ...p };
	const lab = (r) => toLab(norm(p[r]));
	const lc = lab("canvas")[0];
	const anchor = CONTRAST_ANCHORS[p.mode][side];
	const family = GROUND_FAMILY.filter((r) => isFlatHex(p[r]));
	let d = (anchor - lc) * t;
	const lcNew = lc + d;
	/* Widen the ladder by the ΔE00 compression the move introduced (Sl at the new
	   canvas over Sl at the old), and by the chroma Soft takes away - never narrow
	   it, which would spend headroom the authored palette had. */
	const chroma = side === "soft" ? 1 - 0.4 * t : 1;
	const k = Math.max(1, sl(lcNew) / sl(lc)) * spread;
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
	placed.rowSelected = placed.surface + dirUp * selStep * Math.max(1, kRow);
	placed.rowHover = placed.surface + dirUp * hovStep * Math.max(1, kRow);
	/* The gamut guard: no family member may leave [0.5, 100], so the whole ladder
	   is shifted back by the member nearest the wall - a ladder squashed against
	   black keeps its L* steps on paper and loses them on screen. */
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
		for (const spread of LADDER_SPREADS) {
			const candidate = contrastCandidate(palette, v, { spread });
			const repaired = repairPalette(candidate, id, palette);
			if (repaired.findings.length === 0)
				return { palette: repaired.palette, effectiveContrast: v };
		}
	}
	return { palette, effectiveContrast: 0 };
};
