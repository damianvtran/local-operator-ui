import type { GlassFloorTable } from "./window-glass";
export const BACKDROP_GRAY: Record<string, { dark: number; light: number }>;
/** Existing pure helpers also used by terminal-only glass contrast adaptation. */
export function composite(
	foreground: string,
	alpha: number,
	backdrop: string,
): string;
export function ratio(first: string, second: string): number;
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
