/* Types for `roles.mjs` - see appearance.d.mts for why these exist. */
export declare const PALETTE_ROLES: readonly string[];
export declare function sanitizePaletteVars(
	value: unknown,
): Record<string, string> | null;
