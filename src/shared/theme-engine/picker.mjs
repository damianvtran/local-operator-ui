/**
 * The pure half of the layered appearance picker (Settings -> Appearance): the
 * slider's snapping, preset naming, the curated accent row, hue names and the
 * scoped drag preview. Kept here, beside the engine and free of React, so the
 * desktop suite drives every rule without a window.
 *
 * WHY A SEPARATE PREVIEW FROM THE ENGINE'S `composeTheme`. A verified
 * composition runs the contract's evaluator inside a repair search: measured on
 * the M-series dev host it costs ~1 ms on the identity path, 20-300 ms at Strong
 * and High, and 400-1100 ms at Soft (cold, per palette). A slider that recomposed
 * per pointer move would freeze the window for most of a drag. So the drag paints
 * `contrastCandidate` - the engine's own UNVERIFIED first move, ~1 ms - into a
 * SCOPED subtree (the preview strip and the chip swatches), and only the release
 * commits the value, which the provider composes once, verified. The candidate
 * is never published to the document root and never persisted: what the app
 * paints is always a palette the contract accepted.
 */

import { labToHex, ratio, toLab } from "./color.mjs";
import { CONTRAST_PRESETS, contrastCandidate } from "./contrast.mjs";
import { isSafePaletteValue, isSafeThemeId, paletteBlock } from "./css.mjs";

/** The presets in slider order, Soft -> High. */
export const PRESET_ORDER = Object.freeze(
	Object.entries(CONTRAST_PRESETS)
		.sort(([, a], [, b]) => a - b)
		.map(([name, value]) => Object.freeze({ name, value })),
);

/** The slider's keyboard and drag step (designer spec 5.1). */
export const CONTRAST_STEP = 5;

/**
 * How close (in slider units) a POINTER drag must come to a preset to land on
 * it. Keyboard steps never snap: ±5 from a preset must be reachable by keys,
 * which is what the fine-tuning half of the control is for.
 */
export const CONTRAST_SNAP_ZONE = 8;

const clamp = (v) => Math.max(-100, Math.min(100, v));

/** Round to the step and clamp; pull into a preset within the snap zone. */
export const snapContrast = (value, { snap = true } = {}) => {
	if (!Number.isFinite(value)) return 0;
	const stepped = clamp(Math.round(value / CONTRAST_STEP) * CONTRAST_STEP);
	if (!snap) return stepped;
	for (const { value: preset } of PRESET_ORDER) {
		if (Math.abs(value - preset) <= CONTRAST_SNAP_ZONE) return preset;
	}
	return stepped;
};

/** The preset `value` sits on exactly, or null between presets. */
export const presetAt = (value) =>
	PRESET_ORDER.find((p) => p.value === value)?.name ?? null;

/** The preset nearest `value` (ties go toward Standard). */
export const nearestPreset = (value) => {
	let best = PRESET_ORDER[2];
	for (const p of PRESET_ORDER) {
		const d = Math.abs(p.value - value);
		const bd = Math.abs(best.value - value);
		if (d < bd || (d === bd && Math.abs(p.value) < Math.abs(best.value)))
			best = p;
	}
	return best.name;
};

/**
 * The two presets `value` lies between (for "Between Standard and Strong, +25"),
 * or null when it sits on one.
 */
export const presetsAround = (value) => {
	if (presetAt(value)) return null;
	for (let i = 1; i < PRESET_ORDER.length; i++) {
		if (value < PRESET_ORDER[i].value)
			return [PRESET_ORDER[i - 1].name, PRESET_ORDER[i].name];
	}
	return null;
};

/** PageUp/PageDown: the next preset strictly beyond `value` in `direction`. */
export const nextPreset = (value, direction) => {
	const list = direction > 0 ? PRESET_ORDER : [...PRESET_ORDER].reverse();
	const hit = list.find((p) =>
		direction > 0 ? p.value > value : p.value < value,
	);
	return hit ? hit.value : value;
};

/* ------------------------------------------------------------------ hues */

/**
 * The twelve hue names the accent tooltips use ("Tokyo Night blue"), as CIELAB
 * LCh hue-angle bins. Lab rather than OKLCH because the engine's colour module
 * is Lab throughout, and a name is a word, not a measurement: the bins only
 * need to agree with what a reader calls the colour.
 */
const HUE_BINS = [
	/* Upper edges, measured on reference colours (LCh h): pink #EC407A 6,
	   red #E53935 34, orange #F57C00 60, amber #FFB300 78, yellow #FDD835 92,
	   lime #9CCC65 126, green #43A047 141, teal #009688 183, cyan #00BCD4 217,
	   blue #1E88E5 275 / #2563EB 293 / #7AA2F7 282, indigo #3F51B5 295,
	   violet #BD93F9 308 / #8E24AA 321, magenta-pink #FF79C6 345. Blue and
	   indigo overlap in Lab hue; chroma-free hue alone cannot split them
	   cleanly, so the edge sits where the common "blue" accents fall. */
	[15, "pink"],
	[50, "red"],
	[70, "orange"],
	[85, "amber"],
	[105, "yellow"],
	[133, "lime"],
	[165, "green"],
	[200, "teal"],
	[245, "cyan"],
	[294, "blue"],
	[300, "indigo"],
	[335, "violet"],
	[360, "pink"],
];

/** Chroma under which a colour has no hue worth naming. */
export const NEUTRAL_CHROMA = 8;

const lch = (hex) => {
	const [L, a, b] = toLab(hex);
	const h = (Math.atan2(b, a) * 180) / Math.PI;
	return { L, C: Math.hypot(a, b), h: h < 0 ? h + 360 : h };
};

/** One of the twelve hue names, or `neutral`. */
export const hueName = (hex) => {
	const { C, h } = lch(hex);
	if (C < NEUTRAL_CHROMA) return "neutral";
	for (const [edge, name] of HUE_BINS) if (h < edge) return name;
	return "pink";
};

/* -------------------------------------------------------------- accents */

/**
 * The curated "from other themes" row (designer 7, architect 5.3).
 *
 * SAME MODE ONLY: the architect measured cross-mode accents moving up to 62 L*
 * (ΔE00 49.7) when re-solved for legibility - a dark theme's accent on a light
 * ground stops being the colour the user clicked. Within a mode the worst move
 * is 8 L*.
 *
 * One representative per 36° hue bin - the palette whose accent hue sits nearest
 * the bin's centre - plus one neutral (the most achromatic accent, Obsidian's
 * off-white in the dark set), so ten hues read as a short, distinct row instead
 * of fifty-nine near-duplicates. The active theme's own accent is excluded: it is
 * the row's first swatch already. Deterministic for a given palette set.
 *
 * `palettes`: `[{ id, palette }]`.
 */
export const curatedAccents = (palettes, mode, excludeId) => {
	const own = palettes.find((p) => p.id === excludeId)?.palette.accent;
	const pool = palettes.filter(
		(p) =>
			p.palette.mode === mode &&
			p.id !== excludeId &&
			typeof p.palette.accent === "string" &&
			p.palette.accent.toUpperCase() !== own?.toUpperCase(),
	);
	const bins = new Map();
	let neutral = null;
	for (const entry of pool) {
		const { C, h } = lch(entry.palette.accent);
		if (C < NEUTRAL_CHROMA) {
			if (!neutral || C < neutral.C) neutral = { ...entry, C };
			continue;
		}
		const bin = Math.floor(h / 36);
		const off = Math.abs(h - (bin * 36 + 18));
		const held = bins.get(bin);
		if (!held || off < held.off || (off === held.off && entry.id < held.id))
			bins.set(bin, { ...entry, off });
	}
	const out = [...bins.entries()]
		.sort(([a], [b]) => a - b)
		.map(([, e]) => ({ id: e.id, hex: e.palette.accent.toUpperCase() }));
	if (neutral)
		out.push({ id: neutral.id, hex: neutral.palette.accent.toUpperCase() });
	return out;
};

/**
 * Every same-mode palette accent, de-duplicated by hex and ordered by hue, for
 * the "Show all theme accents" expansion.
 */
export const allAccents = (palettes, mode) => {
	const seen = new Set();
	const out = [];
	for (const p of palettes) {
		if (p.palette.mode !== mode) continue;
		const hex = String(p.palette.accent).toUpperCase();
		if (seen.has(hex)) continue;
		seen.add(hex);
		out.push({ id: p.id, hex });
	}
	const key = (hex) => {
		const { C, h } = lch(hex);
		return C < NEUTRAL_CHROMA ? 1000 : h;
	};
	return out.sort((a, b) => key(a.hex) - key(b.hex));
};

/* -------------------------------------------------------- custom accents */

/** How long a custom accent's name may be. */
export const CUSTOM_ACCENT_NAME_MAX = 40;

/**
 * The user's names for their custom accents, `{ "#RRGGBB": name }`. Re-validated
 * on every load like the rest of the appearance fields: only names of swatches
 * that still exist survive, trimmed, single-line and capped, so a hand-edited
 * blob cannot grow the persisted object or carry markup-shaped text into a
 * tooltip it would be rendered as plain text in anyway.
 */
export const sanitizeCustomAccentNames = (value, accents) => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const out = {};
	for (const hex of Array.isArray(accents) ? accents : []) {
		const raw = value[hex];
		if (typeof raw !== "string") continue;
		/* Control characters (newlines, tabs, NUL) become spaces: a name is one
		   line of tooltip text. Filtered by code point rather than a regex class,
		   which the linter rightly flags as easy to get wrong. */
		const name = [...raw]
			.map((ch) => {
				const code = ch.codePointAt(0) ?? 0;
				return code < 0x20 || code === 0x7f ? " " : ch;
			})
			.join("")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, CUSTOM_ACCENT_NAME_MAX);
		if (name) out[hex] = name;
	}
	return out;
};

/* ------------------------------------------------------- scoped preview */

/** The ids the scoped preview blocks are written under. */
export const PREVIEW_IDS = Object.freeze({
	strip: "lo-preview",
	chip: (name) => `lo-preview-${name}`,
});

/**
 * The CSS for the drag preview: one `[data-theme]` block per entry, each the
 * engine's unverified candidate of `base` at that contrast. Entries whose value
 * is 0 use the base itself. Every id and value is checked against the same
 * grammar `applyAppearance` enforces before a block is emitted; a failing entry
 * is skipped rather than written.
 *
 * `entries`: `[{ id, contrast }]`; `overlay`: optional `{ role: value }` laid
 * over each candidate.
 */
export const previewCss = (base, entries, overlay = null) => {
	const blocks = [];
	for (const { id, contrast } of entries) {
		if (!isSafeThemeId(id)) continue;
		const candidate = contrast === 0 ? base : contrastCandidate(base, contrast);
		/* `overlay` carries the committed composition's ACCENT roles, so a drag
		   with a custom accent previews that accent over the new grounds instead
		   of flashing back to the theme's. Re-solving the accent per move is the
		   expensive half of a compose; the release recomposes it verified. */
		const palette = overlay ? { ...candidate, ...overlay } : candidate;
		const ok = Object.entries(palette).every(
			([role, v]) => role === "mode" || isSafePaletteValue(v),
		);
		if (ok) blocks.push(paletteBlock(id, palette));
	}
	return blocks.join("\n");
};

/* ----------------------------------------------------------- basic picker */

/**
 * A hex as CIELAB LCh: lightness 0-100, chroma, hue in degrees. The basic "+"
 * picker steers HUE and LIGHTNESS at the colour's own chroma - two sliders plus
 * a hex field - which is the "basic picker" scope of this slice; the full
 * OKLCH area picker is the custom-theme editor's (PR C). Lab rather than OKLCH
 * because the engine's colour maths is Lab throughout and the accent solver
 * moves L* - a slider in the same space moves the way the solver will.
 */
export const hexToLch = (hex) => {
	const [L, a, b] = toLab(hex);
	const h = (Math.atan2(b, a) * 180) / Math.PI;
	return { l: L, c: Math.hypot(a, b), h: h < 0 ? h + 360 : h };
};

/**
 * LCh -> hex, pulling chroma in until the colour is inside sRGB, so the
 * sliders never land on a colour that cannot be shown (the thumb stays where
 * the user put it; the swatch shows the nearest displayable colour).
 */
export const lchToHex = ({ l, c, h }) => {
	const L = Math.max(0, Math.min(100, l));
	const rad = (h * Math.PI) / 180;
	for (let chroma = Math.max(0, c); chroma >= 0; chroma -= 1) {
		const hex = labToHex([L, chroma * Math.cos(rad), chroma * Math.sin(rad)]);
		if (hex) return hex;
	}
	return labToHex([L, 0, 0]) ?? "#000000";
};

/**
 * The text colour that will sit on `hex` as an accent (black or white, the
 * engine's final candidates), with its ratio - the picker shows this so the
 * user knows before committing that on-accent ink is chosen for them. The
 * engine may still prefer the theme's own `onAccent`/ink when that passes.
 */
export const onAccentPreview = (hex) => {
	const white = ratio("#FFFFFF", hex);
	const black = ratio("#000000", hex);
	return white >= black
		? { ink: "#FFFFFF", ratio: white }
		: { ink: "#000000", ratio: black };
};

/** The roles the accent layer owns: what a drag preview carries over. */
export const ACCENT_ROLES = Object.freeze([
	"accent",
	"accentHover",
	"accentActive",
	"accentWash",
	"onAccent",
	"chartBarHover",
	"accentAlt",
	"accentAltWash",
]);
