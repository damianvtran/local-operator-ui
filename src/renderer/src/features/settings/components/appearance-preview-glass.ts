import type { ThemePalette } from "@shared/themes/palette-contract";
import { glassFloorsForPalette } from "../../../../../shared/glass-derivation.mjs";
import {
	type GlassPaint,
	type WindowGlassState,
	glassPaintFor,
} from "../../../../../shared/window-glass";

/** The eight roles the floor table measures; all are painted `--lo-*` values. */
export type PreviewPaletteRoles = Pick<
	ThemePalette,
	| "canvas"
	| "surface"
	| "elevated"
	| "sunken"
	| "ink"
	| "inkMuted"
	| "inkDim"
	| "borderControl"
>;

const ROLES: ReadonlyArray<readonly [keyof PreviewPaletteRoles, string]> = [
	["canvas", "canvas"],
	["surface", "surface"],
	["elevated", "elevated"],
	["sunken", "sunken"],
	["ink", "ink"],
	["inkMuted", "ink-muted"],
	["inkDim", "ink-dim"],
	["borderControl", "border-control"],
];

/**
 * The sample's OWN painted palette. Reading the element rather than the document
 * matters during a contrast drag: the strip paints an unverified candidate under
 * its scoped `[data-theme]`, and the document's alphas were derived from the last
 * verified composition, so copying them would describe a palette that is no
 * longer on screen. A role that does not resolve (a test host, not Electron)
 * reports `null` and the sample stays solid instead of guessing a colour.
 */
export const readPreviewPaletteRoles = (
	element: Element | null,
): PreviewPaletteRoles | null => {
	if (!element) return null;
	const style = getComputedStyle(element);
	const roles: Record<string, string> = {};
	for (const [role, variable] of ROLES) {
		const value = style.getPropertyValue(`--lo-${variable}`).trim();
		if (value === "") return null;
		roles[role] = value;
	}
	return roles as PreviewPaletteRoles;
};

/**
 * Apply main's EFFECTIVE glass to the sample, never the saved preference: a
 * capability drop or a restart-pending flip leaves the window opaque, and a
 * translucent sample over an opaque window is the half-applied state the restart
 * notice exists to prevent. Production floor and solver helpers own the numbers.
 */
export const previewGlassPaint = (
	state: WindowGlassState | null | undefined,
	roles: PreviewPaletteRoles | null,
	scheme: "dark" | "light",
): GlassPaint | null => {
	if (
		!roles ||
		!state?.active ||
		!state.capability.supported ||
		state.capability.mechanism === "none" ||
		state.restartRequired
	)
		return null;
	return glassPaintFor({
		...state.settings,
		mechanism: state.capability.mechanism,
		scheme,
		floors: glassFloorsForPalette(roles),
	});
};
