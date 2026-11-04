/* Types for `accent.mjs` - see appearance.d.mts for why these exist. */
export type AccentRef =
	| { kind: "theme" }
	| { kind: "theme-alt" }
	| { kind: "palette"; id: string }
	| { kind: "custom"; hex: string };

export type PaletteRecord = Record<string, string> & { mode: "dark" | "light" };

export declare function normalizeHex(value: unknown): string | null;
export declare function resolveAccentRef(
	ref: AccentRef,
	base: PaletteRecord,
	paletteAccent?: (id: string) => string | undefined,
): string | null;
export declare function applyAccent(
	palette: PaletteRecord,
	ref: AccentRef,
	opts?: {
		authored?: PaletteRecord;
		id?: string;
		paletteAccent?: (id: string) => string | undefined;
	},
): {
	palette: PaletteRecord;
	applied: boolean;
	adjusted: number;
	requested: string | null;
};
