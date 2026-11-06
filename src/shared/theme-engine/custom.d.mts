import type { PaletteRecord } from "./accent.mjs";
import type { CustomThemeV1 } from "./appearance.mjs";
export declare const ESSENTIALS: readonly string[];
export declare const COLOUR_ROLES: readonly string[];
export declare const IMPORT_MAX_BYTES: number;
export declare function deriveCustomPalette<P extends PaletteRecord>(
	base: P,
	theme: CustomThemeV1,
): P;
export declare function validateCustomPalette(
	palette: PaletteRecord,
	baseId: string,
): string[];
export declare function suggestCustomAdjustment(
	base: PaletteRecord,
	theme: CustomThemeV1,
): CustomThemeV1 | null;
export declare function parseThemeImport(
	text: string,
	isThemeName: (id: string) => boolean,
	opts?: { id?: string; now?: number },
): CustomThemeV1;
export declare function readCustomThemeStorage(
	text: string | null,
	isThemeName: (id: string) => boolean,
): CustomThemeV1[];
export declare function exportCustomTheme(theme: CustomThemeV1): string;
export declare function uniqueThemeName(
	name: string,
	themes: CustomThemeV1[],
): string;

export declare function customPaletteReadings(
	palette: PaletteRecord,
	id: string,
): {
	findings: string[];
	readings: {
		foreground: string;
		background: string;
		value: number;
		floor: number;
	}[];
};
