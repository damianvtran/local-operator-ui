/* Types for `contrast.mjs` - see appearance.d.mts for why these exist. */
import type { PaletteRecord } from "./accent.mjs";

export declare const CONTRAST_PRESETS: Readonly<{
	soft: -100;
	gentle: -50;
	standard: 0;
	strong: 50;
	high: 100;
}>;
export declare const CONTRAST_ANCHORS: Readonly<{
	dark: Readonly<{ high: number; soft: number }>;
	light: Readonly<{ high: number; soft: number }>;
}>;
export declare function pickOnAccent(
	accent: string,
	candidates: unknown[],
): string;
export declare function applyContrast<P extends PaletteRecord>(
	palette: P,
	contrast: number,
	opts?: { id?: string },
): { palette: P; effectiveContrast: number };
