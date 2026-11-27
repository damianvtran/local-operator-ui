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
	| {
			kind: "glass";
			paint: GlassPaint;
			scheme: GlassScheme;
			backdropVars: Record<string, string>;
	  }
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
		backdropVars: previewBackdropVars(scheme, read.roles.canvas),
		paint: glassPaintFor({
			...state.settings,
			mechanism: state.capability.mechanism,
			scheme,
			floors: glassFloorsForPalette(read.roles),
		}),
	};
};

/** Keep the established shade travel away from the ink side of the ramp. */
const BACKDROP_SHIFT = 32;

/**
 * Give the synthetic material the canvas's channel differences, not its
 * brightness. Accent edits must not recolour the material, and nothing here
 * samples the desktop. The strongest dark channel (weakest light channel)
 * stays on the old grey ramp; the others only darken (lighten). With sRGB
 * interpolation this bound also holds between stops, so the existing glass
 * alphas keep at least their old body-ink contrast.
 */
export const previewBackdropVars = (
	scheme: GlassScheme,
	canvas: PreviewPaletteRoles["canvas"],
): Record<string, string> => {
	const material = BACKDROP_GRAY["under-window"][scheme];
	const dark = scheme === "dark";
	const away = dark ? -BACKDROP_SHIFT : BACKDROP_SHIFT;
	// Authored and custom palette blocks publish six-digit sRGB role values.
	const channels = [1, 3, 5].map((i) =>
		Number.parseInt(canvas.slice(i, i + 2), 16),
	);
	const highest = Math.max(...channels);
	const lowest = Math.min(...channels);
	const anchor = dark ? highest : lowest;
	const headroom = dark ? material + away : 255 - (material + away);
	const spread = highest - lowest;
	// If a custom canvas is strongly saturated, scale the whole offset so it
	// fits even at the far stop. Per-channel clipping would distort the hue
	// there and flatten that channel's shade travel.
	const scale = spread > headroom ? headroom / spread : 1;
	const tint = (grey: number) =>
		`#${channels
			.map((value) =>
				Math.round(grey + (value - anchor) * scale)
					.toString(16)
					.padStart(2, "0"),
			)
			.join("")}`;
	return {
		"--lo-preview-backdrop-a": tint(material),
		"--lo-preview-backdrop-b": tint(material + away / 2),
		"--lo-preview-backdrop-c": tint(material + away),
	};
};
