/* Types for `picker.mjs` - see appearance.d.mts for why these exist. */
import type { PaletteRecord } from "./accent.mjs";

export type PresetName = "soft" | "gentle" | "standard" | "strong" | "high";
export type HueName =
	| "red"
	| "orange"
	| "amber"
	| "yellow"
	| "lime"
	| "green"
	| "teal"
	| "cyan"
	| "blue"
	| "indigo"
	| "violet"
	| "pink"
	| "neutral";

export declare const PRESET_ORDER: ReadonlyArray<
	Readonly<{ name: PresetName; value: number }>
>;
export declare const CONTRAST_STEP: 5;
export declare const CONTRAST_SNAP_ZONE: 8;
export declare function snapContrast(
	value: number,
	opts?: { snap?: boolean },
): number;
export declare function presetAt(value: number): PresetName | null;
export declare function nearestPreset(value: number): PresetName;
export declare function presetsAround(
	value: number,
): [PresetName, PresetName] | null;
export declare function nextPreset(value: number, direction: 1 | -1): number;

export declare const NEUTRAL_CHROMA: number;
export declare function hueName(hex: string): HueName;

export type AccentSwatch = { id: string; hex: string };
export declare function curatedAccents(
	palettes: ReadonlyArray<{ id: string; palette: PaletteRecord }>,
	mode: "dark" | "light",
	excludeId?: string,
): AccentSwatch[];
export declare function allAccents(
	palettes: ReadonlyArray<{ id: string; palette: PaletteRecord }>,
	mode: "dark" | "light",
): AccentSwatch[];

export declare const CUSTOM_ACCENT_NAME_MAX: 40;
export declare function sanitizeCustomAccentNames(
	value: unknown,
	accents: unknown,
): Record<string, string>;

export declare const PREVIEW_IDS: Readonly<{
	strip: "lo-preview";
	chip: (name: PresetName) => string;
}>;
export declare function previewCss(
	base: PaletteRecord,
	entries: ReadonlyArray<{ id: string; contrast: number }>,
	overlay?: Record<string, string> | null,
): string;
export declare const ACCENT_ROLES: readonly string[];

export type Lch = { l: number; c: number; h: number };
export declare function hexToLch(hex: string): Lch;
export declare function lchToHex(lch: Lch): string;
export declare function onAccentPreview(hex: string): {
	ink: "#FFFFFF" | "#000000";
	ratio: number;
};
