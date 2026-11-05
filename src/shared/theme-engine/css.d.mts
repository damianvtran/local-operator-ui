/* Types for `css.mjs` - see appearance.d.mts for why these exist. */
export declare function kebab(s: string): string;
export declare function paletteBlock(
	id: string,
	palette: Record<string, string>,
): string;
export declare function isSafePaletteValue(value: unknown): boolean;
export declare function isSafeThemeId(id: unknown): boolean;
