import type { GlassFloorTable } from "./window-glass";
export const BACKDROP_GRAY: Record<string, { dark: number; light: number }>;
/** Existing pure helpers also used by terminal-only glass contrast adaptation. */
export function composite(
	foreground: string,
	alpha: number,
	backdrop: string,
): string;
export function ratio(first: string, second: string): number;
/**
 * Derive from actual composed colours, using the authored-theme material model.
 *
 * The role list is the table's real input contract (the same one the runtime
 * enforces): the neutral ramp and inks, `borderControl`, the panel `hairline`
 * that the overlay edge is measured against, and the four semantic inks the
 * overlay role imports for the sample's floor table. Typing it short let a
 * caller that reads only some roles compile clean and fail at runtime.
 */
export function glassFloorsForPalette(palette: {
	canvas: string;
	surface: string;
	elevated: string;
	sunken: string;
	ink: string;
	inkMuted: string;
	inkDim: string;
	borderControl: string;
	hairline: string;
	danger: string;
	success: string;
	warning: string;
	info: string;
}): GlassFloorTable;
