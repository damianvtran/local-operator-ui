import type { ThemePalette } from "@shared/themes/palette-contract";
import { glassFloorsForPalette } from "../../../../../shared/glass-derivation.mjs";
import {
	type GlassPaint,
	type WindowGlassState,
	glassPaintFor,
} from "../../../../../shared/window-glass";

/**
 * The sample owns a palette scope, so document alphas may describe a DIFFERENT
 * contrast draft. Reuse the production solver with these exact palette values.
 * Main's capability/active state outranks the saved enabled preference. Pending
 * native reconstruction is deliberately solid, never a promise of applied blur.
 */
export const previewGlassPaint = (
	state: WindowGlassState | null | undefined,
	palette: ThemePalette,
): GlassPaint | null => {
	if (
		!state?.active ||
		!state.capability.supported ||
		state.capability.mechanism === "none" ||
		state.restartRequired
	)
		return null;
	return glassPaintFor({
		...state.settings,
		mechanism: state.capability.mechanism,
		scheme: palette.mode,
		floors: glassFloorsForPalette(palette),
	});
};
