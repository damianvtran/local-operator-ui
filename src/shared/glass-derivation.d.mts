import type { GlassFloorTable } from "./window-glass";
export const BACKDROP_GRAY: Record<string, { dark: number; light: number }>;
/** Derive from actual composed colours, using the authored-theme material model. */
export function glassFloorsForPalette(palette: {
	canvas: string;
	surface: string;
	elevated: string;
	sunken: string;
	ink: string;
	inkMuted: string;
	inkDim: string;
	borderControl: string;
}): GlassFloorTable;
