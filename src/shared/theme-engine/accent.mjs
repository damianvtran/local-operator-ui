/**
 * Accent, the third layer of a composed appearance (theme -> contrast -> accent).
 *
 * WHAT IS STORED IS A REFERENCE, NOT A COLOUR (`AccentRef`):
 *   { kind: "theme" }                 the palette's own accent (identity)
 *   { kind: "theme-alt" }             the palette's second hue as the accent; the
 *                                     two swap, so two accents stay two
 *   { kind: "palette", id }           another built-in's accent - it follows that
 *                                     palette if it is ever retuned
 *   { kind: "custom", hex }           the user's raw value, never rewritten by a
 *                                     re-solve; the SOLVED colour is derived each
 *                                     time from it and the grounds it lands on
 *
 * HOW IT IS APPLIED (`applyAccent`):
 *   1. `accent` takes the referenced colour.
 *   2. `accentHover`, `accentActive`, `accentWash` and `chartBarHover` are
 *      re-derived by the BASE theme's own LCh offsets from its authored accent, so
 *      Dracula's hover step stays Dracula's whatever the hue.
 *   3. The accent is L*-solved (hue and chroma kept) over its text floors on the
 *      composed grounds; the derived roles move with it.
 *   4. If the new accent lands on the second hue (ΔE00 < the separation floor),
 *      `accentAlt` takes the theme's ORIGINAL accent, so the displaced hue becomes
 *      the second accent.
 *   5. The contract's per-palette assertions decide, after the same oracle repair
 *      contrast uses. `onAccent` - text on the accent - is re-picked on every
 *      candidate (`pickOnAccent`), so it is inside the verdict.
 *
 * THE GUARANTEE. `applyAccent` never returns a palette the contract rejects. If
 * the reference cannot be made legible on these grounds it returns the input
 * unchanged with `applied: false`, and the UI says the accent could not be used
 * on this theme - a silent swap to a different colour would be the worse lie.
 * `adjusted` reports how far (ΔE00) the solved accent sits from the requested
 * colour, for the "adjusted for legibility" hint (the architect's bar is ΔE00 5).
 */

import { deltaE, toLab } from "./color.mjs";
import {
	ALT_ACCENT_CHROMA_FLOOR,
	ROW_STATE_NEUTRAL_PANEL,
	SEPARATION_FLOOR,
} from "./contract-tables.mjs";
import {
	labAtLightness,
	pickOnAccent,
	repairPalette,
	solveLightness,
} from "./contrast.mjs";

const HEX = /^#[0-9A-Fa-f]{6}$/;
const SHORT_HEX = /^#[0-9A-Fa-f]{3}$/;

/** Normalise a user hex (`#abc`, `#AABBCC`, `aabbcc`) to `#AABBCC`, or null. */
export const normalizeHex = (value) => {
	if (typeof value !== "string") return null;
	let v = value.trim();
	if (!v.startsWith("#")) v = `#${v}`;
	if (SHORT_HEX.test(v)) v = `#${[...v.slice(1)].map((c) => c + c).join("")}`;
	return HEX.test(v) ? v.toUpperCase() : null;
};

/** The roles derived from the accent, each by the base theme's own offset. */
const DERIVED = ["accentHover", "accentActive", "accentWash", "chartBarHover"];

const lch = (hex) => {
	const [l, a, b] = toLab(hex);
	return [l, Math.hypot(a, b), Math.atan2(b, a)];
};
const chromaOf = (hex) => lch(hex)[1];
const fromLch = (l, c, h) =>
	labAtLightness(l, Math.max(0, c) * Math.cos(h), Math.max(0, c) * Math.sin(h));

/*
 * The base's relation from its authored accent to a derived role, re-applied to a
 * new accent. Chroma is a RATIO (a desaturated wash stays proportionally
 * desaturated), lightness and hue are DIFFERENCES. A near-neutral authored accent
 * (Obsidian's white) has no hue to take an offset from, so a role derived from it
 * takes the new accent's hue with the authored role's own chroma.
 */
const NEUTRAL_C = 4;
const reDerive = (authoredAccent, authoredRole, accent) => {
	const [la, ca, ha] = lch(authoredAccent);
	const [lr, cr, hr] = lch(authoredRole);
	const [ln, cn, hn] = lch(accent);
	if (ca < NEUTRAL_C) return fromLch(ln + (lr - la), cr, hn);
	return fromLch(ln + (lr - la), cn * (cr / ca), hn + (hr - ha));
};

/** The colour an `AccentRef` names on `base`, or null for an unusable ref. */
export const resolveAccentRef = (ref, base, paletteAccent) => {
	if (!ref || ref.kind === "theme") return null;
	if (ref.kind === "theme-alt") return normalizeHex(base.accentAlt);
	if (ref.kind === "palette") {
		const hex =
			typeof paletteAccent === "function" ? paletteAccent(ref.id) : null;
		return normalizeHex(hex);
	}
	if (ref.kind === "custom") return normalizeHex(ref.hex);
	return null;
};

/**
 * Apply `ref` to `palette` (already contrast-composed), verified.
 *
 * `authored` is the BUILT-IN the composition started from: the offsets in step 2
 * are its authored relations, and the second hue it donates in step 4 is its
 * original accent. `id` is that built-in's id, for the contract's pins.
 * `paletteAccent(id)` resolves a `{kind:"palette"}` ref to that palette's accent.
 *
 * Returns `{ palette, applied, adjusted, requested }`.
 */
export const applyAccent = (
	palette,
	ref,
	{ authored = palette, id = "custom", paletteAccent } = {},
) => {
	const requested = resolveAccentRef(ref, authored, paletteAccent);
	if (!requested) return { palette, applied: false, adjusted: 0, requested };
	const out = { ...palette, accent: requested };
	for (const role of DERIVED) {
		if (!HEX.test(authored[role] ?? "") || !HEX.test(authored.accent ?? ""))
			continue;
		out[role] = reDerive(authored.accent, authored[role], requested);
	}
	/* The wash is a GROUND, not an accent step: contrast already placed its L* on
	   the composed ladder, and an L* offset from a new, lighter accent would push
	   it off the end of the ramp (GitHub Light's wash sits 53 L* above its accent).
	   So it keeps its composed L* and takes only hue and chroma from the accent -
	   at least the authored wash's chroma, since it is measured by ΔE00 off every
	   ground it lights (HOVER_DELTA_E) and a low-chroma accent would otherwise
	   leave it the colour of the ground. */
	if (
		HEX.test(palette.accentWash ?? "") &&
		HEX.test(authored.accentWash ?? "")
	) {
		const l = lch(palette.accentWash)[0];
		const [, c, h] = lch(out.accentWash);
		out.accentWash = fromLch(l, Math.max(c, lch(authored.accentWash)[1]), h);
	}
	/* On a NEUTRAL panel (C* < 2) the contract takes the row states' hue from the
	   accent, so a new accent re-hues them - at their authored L* and C*, which
	   is everything else the row-state rules read. */
	if (chromaOf(out.surface) < ROW_STATE_NEUTRAL_PANEL) {
		const h = lch(out.accent)[2];
		for (const role of ["rowHover", "rowSelected"]) {
			if (!HEX.test(out[role] ?? "")) continue;
			const [l, c] = lch(out[role]);
			if (c >= ROW_STATE_NEUTRAL_PANEL) out[role] = fromLch(l, c, h);
		}
	}
	if (ref.kind === "theme-alt") {
		/* A swap: the second hue becomes the accent and the accent the second hue
		   - unless the authored accent has no hue to give (Obsidian's white), in
		   which case the second accent keeps its own colour and the contract's
		   accent/second-hue separation decides whether the swap can stand. */
		if (lch(authored.accent)[1] >= ALT_ACCENT_CHROMA_FLOOR)
			out.accentAlt = normalizeHex(authored.accent);
	} else if (
		deltaE(out.accent, out.accentAlt) < SEPARATION_FLOOR &&
		lch(authored.accent)[1] >= ALT_ACCENT_CHROMA_FLOOR
	) {
		out.accentAlt = normalizeHex(authored.accent);
	}
	/* Step 3: the accent's own text floors on the composed grounds, the derived
	   steps riding along by the same L* so their offsets survive. */
	const before = toLab(out.accent)[0];
	out.accent = solveLightness(out, "accent", ACCENT_GROUNDS, 4.5);
	const moved = toLab(out.accent)[0] - before;
	if (moved !== 0)
		for (const role of ["accentHover", "accentActive", "chartBarHover"]) {
			if (!HEX.test(out[role] ?? "")) continue;
			const [l, a, b] = toLab(out[role]);
			out[role] = labAtLightness(l + moved, a, b);
		}
	out.onAccent = pickOnAccent(out.accent, [
		authored.onAccent,
		out.ink,
		out.canvas,
		"#FFFFFF",
		"#000000",
	]);
	const repaired = repairPalette(out, id, authored);
	if (repaired.findings.length > 0)
		return { palette, applied: false, adjusted: 0, requested };
	return {
		palette: repaired.palette,
		applied: true,
		adjusted: deltaE(requested, repaired.palette.accent),
		requested,
	};
};

/* Every ground the contract reads `accent` on as text (AS_TEXT's tone grounds and
   the model-access band's warning wash). */
const ACCENT_GROUNDS = [
	"canvas",
	"surface",
	"elevated",
	"sunken",
	"accentWash",
	"messageSurface",
	"warningWash",
];
