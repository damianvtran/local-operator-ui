/*
 * Types for `appearance.mjs`. The engine is plain `.mjs` because the build-free
 * scripts (`scripts/contrast-contract.mjs`, `generate-theme-css.mjs`) import it
 * too; these declarations are what the TypeScript renderer type-checks against.
 * Keep them in step with the JSDoc in the module.
 */
import type { AccentRef } from "./accent.mjs";

export type Mode = "dark" | "light";
export type PerMode<T> = { dark: T; light: T };

export type CustomThemeV1 = {
	format: "local-operator-theme";
	version: 1;
	id: string;
	name: string;
	base: string;
	seeds: Record<string, string>;
	overrides: Record<string, string>;
	updatedAt: number;
};

export declare const MODES: readonly ["dark", "light"];
export declare const CUSTOM_ACCENTS_LIMIT: 12;
export declare const CUSTOM_THEMES_LIMIT: 50;
export declare const CUSTOM_THEMES_STORAGE_KEY: "custom-themes-storage";
export declare const CUSTOM_THEME_NAME_MAX: 60;
export declare const DEFAULT_CONTRAST: Readonly<PerMode<number>>;
export declare const THEME_ACCENT: Readonly<{ kind: "theme" }>;
export declare const DEFAULT_ACCENT: Readonly<PerMode<AccentRef>>;

export declare function sanitizeContrastValue(value: unknown): number;
export declare function sanitizeContrast(value: unknown): PerMode<number>;
export declare function sanitizeAccentRef(
	value: unknown,
	isThemeName?: (id: string) => boolean,
): AccentRef;
export declare function sanitizeAccent(
	value: unknown,
	isThemeName?: (id: string) => boolean,
): PerMode<AccentRef>;
export declare function sanitizeCustomAccents(value: unknown): string[];
export declare function pushCustomAccent(list: unknown, hex: unknown): string[];
export declare function sanitizeCustomThemeId(value: unknown): string | null;
export declare function sanitizeCustomTheme(
	value: unknown,
	opts: {
		isThemeName: (id: string) => boolean;
		isRole: (role: string) => boolean;
	},
): CustomThemeV1 | null;
export declare function sanitizeCustomThemes(
	value: unknown,
	opts: {
		isThemeName: (id: string) => boolean;
		isRole: (role: string) => boolean;
	},
): CustomThemeV1[];
