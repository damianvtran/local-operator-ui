import type { ThemePalette } from "@shared/themes/palette-contract";
import {
	BACKDROP_GRAY,
	glassFloorsForPalette,
} from "../../../../../shared/glass-derivation.mjs";
import {
	type GlassPaint,
	type WindowGlassState,
	glassPaintFor,
} from "../../../../../shared/window-glass";

/**
 * The roles the sample's floor table measures, read as the `--lo-*` values the
 * sample's own block paints.
 *
 * The list is NOT "the eight neutral roles": the table also measures the panel
 * hairline (the overlay edge is stepped off it) and the four semantic inks (glass
 * quiets them toward `ink` so a destructive or error label still clears the ink
 * floor on the panel). Feeding the sample fewer roles than the table reads made
 * it derive a different table at best and throw through React at worst, so this
 * list tracks `FLOOR_ROLES` in `shared/glass-derivation.mjs` - the sample then
 * publishes the same floor numbers the window paints with, which is the whole
 * point of showing it.
 */
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
	| "hairline"
	| "danger"
	| "success"
	| "warning"
	| "info"
>;

/**
 * The roles the sample's floor table measures, as `role -> --lo-* suffix`. EXPORTED
 * because it is one half of a hand-kept pair: `FLOOR_ROLES` in
 * `shared/glass-derivation.mjs` is the other, and the contract test drives its
 * expectation from THIS list so the table cannot grow past the reader.
 */
export const ROLES: ReadonlyArray<
	readonly [keyof PreviewPaletteRoles, string]
> = [
	["canvas", "canvas"],
	["surface", "surface"],
	["elevated", "elevated"],
	["sunken", "sunken"],
	["ink", "ink"],
	["inkMuted", "ink-muted"],
	["inkDim", "ink-dim"],
	["borderControl", "border-control"],
	["hairline", "hairline"],
	["danger", "danger"],
	["success", "success"],
	["warning", "warning"],
	["info", "info"],
];

export type GlassScheme = "dark" | "light";

export type PreviewPaletteRead = {
	roles: PreviewPaletteRoles;
	/** The scoped block's OWN `color-scheme`, when the host resolves it. */
	scheme: GlassScheme | null;
};

/**
 * The sample's OWN painted palette AND scheme, read from the same element.
 *
 * Reading the element rather than the document matters during a contrast drag:
 * the strip paints an unverified candidate under its scoped `[data-theme]`, and
 * the document's alphas were derived from the last verified composition, so
 * copying them would describe a palette that is no longer on screen. The scheme
 * comes off that same block (`paletteBlock` writes `color-scheme: <mode>` there)
 * because a caller previewing a light theme inside a dark document must not get
 * the document's tier - see the strip's `fallbackScheme` for the host that
 * cannot resolve the property. A role that does not resolve (a test host, not
 * Electron) reports `null` and the sample stays solid instead of guessing.
 */
export const readPreviewPalette = (
	element: Element | null,
): PreviewPaletteRead | null => {
	if (!element) return null;
	const style = getComputedStyle(element);
	const roles: Record<string, string> = {};
	for (const [role, variable] of ROLES) {
		const value = style.getPropertyValue(`--lo-${variable}`).trim();
		if (value === "") return null;
		roles[role] = value;
	}
	const declared = style.getPropertyValue("color-scheme").trim();
	return {
		roles: roles as PreviewPaletteRoles,
		scheme: declared === "dark" || declared === "light" ? declared : null,
	};
};

/** Either the glass the sample must paint, or the solid window production draws
 * when it cannot paint glass at all - in which case the sample has no backdrop,
 * and says nothing about one (design D1). */
export type PreviewGlass =
	| { kind: "glass"; paint: GlassPaint; scheme: GlassScheme }
	| { kind: "solid" };

/**
 * Apply main's EFFECTIVE glass to the sample, never the saved preference: a
 * capability drop or a restart-pending flip leaves the window opaque, and a
 * translucent sample over an opaque window is the half-applied state the restart
 * notice exists to prevent. Production floor and solver helpers own the numbers.
 *
 * The reasons are checked in the order that names the state the user can act on:
 * a pending restart outranks the currently-launched capability, which outranks
 * the saved toggle, because the window is solid for the pending reason until it
 * restarts.
 */
export const previewGlassState = (
	state: WindowGlassState | null | undefined,
	read: PreviewPaletteRead | null,
	fallbackScheme: GlassScheme,
): PreviewGlass => {
	if (!state) return { kind: "solid" };
	if (state.restartRequired) return { kind: "solid" };
	if (!state.capability.supported || state.capability.mechanism === "none")
		return { kind: "solid" };
	if (!state.active) return { kind: "solid" };
	if (!read) return { kind: "solid" };
	const scheme = read.scheme ?? fallbackScheme;
	return {
		kind: "glass",
		scheme,
		paint: glassPaintFor({
			...state.settings,
			mechanism: state.capability.mechanism,
			scheme,
			floors: glassFloorsForPalette(read.roles),
		}),
	};
};

/**
 * How far the neutral ramp travels from the measured material tone, and in which
 * direction: AWAY from the ink's side of the ground.
 *
 * The floors promise every body ink at AA over the material grey, and the worst
 * of the 59 palettes sits within 0.05 of that floor at the transparent end of
 * the slider - so a ramp that went LIGHTER on a dark theme (or darker on a light
 * one) would show the sample's own text worse than the real window can. Moving
 * only toward the ink's own side can only gain contrast, which is what lets the
 * sample be visibly a window over something and still be a promise: measured
 * over a 101-point sweep of this ramp, all three inks clear 4.5:1 on 59/59
 * palettes at intensity 80 and 100 (floor 4.65 / 4.51, `rosePineDawn` and
 * `catppuccinLatte`, `inkDim` on the canvas). Those two digits are the sweep's
 * own floor, and the suite asserts them - a column sample lands higher because
 * the 125deg gradient never reaches a stop inside a column.
 */
const BACKDROP_SHIFT = 32;

const greyHex = (value: number): string =>
	`#${Math.max(0, Math.min(255, Math.round(value)))
		.toString(16)
		.padStart(2, "0")
		.repeat(3)}`;

/**
 * THE SAMPLE'S BACKDROP IS NEUTRAL AND FIXED - NOT THE USER'S PALETTE.
 *
 * It used to ramp `accent -> surface -> accent-alt`, so the ground the sample is
 * judged on moved with the accent being judged, and the comparison was muddled
 * (design D2). Worse, the alphas drawn over it are the alphas production derives
 * against *this* grey ramp: an accent-lit backdrop pushed the sample's own
 * secondary ink under AA on 22 of 59 palettes at the shipped intensity (code R2,
 * design D3). A backdrop is the one part of the picture that must hold still
 * while the user changes theme, contrast and accent - and it must sit inside the
 * tone envelope the floors were measured for.
 *
 * So: three neutral greys, per scheme, starting at the measured material tone
 * and travelling away from the ink's side (`BACKDROP_SHIFT`). Emitted as CSS
 * variables by the strip rather than typed into the sheet, and used ONLY while
 * glass paints - the solid states have no backdrop at all, which is why the
 * caption changes with the state.
 */
export const previewBackdropVars = (
	scheme: GlassScheme,
): Record<string, string> => {
	const material = BACKDROP_GRAY["under-window"][scheme];
	const away = scheme === "dark" ? -BACKDROP_SHIFT : BACKDROP_SHIFT;
	return {
		"--lo-preview-backdrop-a": greyHex(material),
		"--lo-preview-backdrop-b": greyHex(material + away / 2),
		"--lo-preview-backdrop-c": greyHex(material + away),
	};
};
