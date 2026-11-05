/* Types for `compose.mjs` - see appearance.d.mts for why these exist. */
import type { AccentRef, PaletteRecord } from "./accent.mjs";

export type Composition<P extends PaletteRecord = PaletteRecord> = {
	/** True when nothing differs from the built-in: `palette === base`. */
	identity: boolean;
	palette: P;
	/** The built-in id on the identity path, `lo-<hash>` otherwise. */
	id: string | undefined;
	effectiveContrast: number;
	requestedContrast: number;
	accentApplied: boolean;
	accentAdjusted: number;
};

export declare function paletteHash(palette: PaletteRecord): string;
export declare function composeTheme<P extends PaletteRecord>(
	base: P,
	opts?: {
		contrast?: number;
		accent?: AccentRef;
		id?: string;
		paletteAccent?: (id: string) => string | undefined;
		/** Custom themes retain secondary identity roles through global accent. */
		preserveSecondary?: boolean;
	},
): Composition<P>;
