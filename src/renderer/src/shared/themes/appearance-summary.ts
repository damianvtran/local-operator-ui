import { t } from "@shared/i18n";
import type { AccentRef } from "../../../../shared/theme-engine/accent.mjs";
import { presetAt } from "../../../../shared/theme-engine/picker.mjs";
import type { ResolvedAppearance } from "./appearance";

/*
 * Preset names for the summary. Kept beside the summary rather than imported
 * from the settings feature, so the command palette (chat feature) does not
 * depend on a settings component file.
 */
const PRESET_KEY = {
	soft: "ui.settings.appearance.contrast.soft",
	gentle: "ui.settings.appearance.contrast.gentle",
	standard: "ui.settings.appearance.contrast.standard",
	strong: "ui.settings.appearance.contrast.strong",
	high: "ui.settings.appearance.contrast.high",
} as const;

/**
 * What the theme lists (`/theme` picker, slash-argument rows) print on the
 * CURRENT row when layers are active: "Strong contrast", "Your accent", or both.
 *
 * WHY. Those lists name built-in themes, and with contrast and accent layers the
 * app paints `compose(theme, contrast, accent)`, not the theme as listed. A
 * "current" mark beside "Dracula" with nothing else would claim the stock
 * Dracula while the app shows Dracula at High with a blue accent. Null on the
 * identity path - the row is then exactly what the app paints. Reports what the
 * engine REACHED (`effectiveContrast`) and whether the accent was actually
 * applied, never what was merely requested.
 */
export const appearanceLayerSummary = (
	resolved: ResolvedAppearance,
	accent: AccentRef | undefined,
): string | null => {
	if (resolved.identity) return null;
	const value = resolved.effectiveContrast;
	const preset = presetAt(value);
	const contrast =
		value === 0
			? null
			: preset
				? t(PRESET_KEY[preset])
				: value > 0
					? `+${value}`
					: String(value);
	const yours =
		accent !== undefined && accent.kind !== "theme" && resolved.accentApplied;
	if (contrast && yours)
		return t("ui.settings.appearance.layers.palette_meta_both", { contrast });
	if (contrast)
		return t("ui.settings.appearance.layers.palette_meta_contrast", {
			contrast,
		});
	if (yours) return t("ui.settings.appearance.layers.palette_meta_accent");
	return null;
};
