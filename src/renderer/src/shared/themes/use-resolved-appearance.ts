import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useMemo } from "react";
import type { PaletteRecord } from "../../../../shared/theme-engine/accent.mjs";
import type { CustomThemeV1 } from "../../../../shared/theme-engine/appearance.mjs";
import { deriveCustomPalette } from "../../../../shared/theme-engine/custom.mjs";
import type { ThemeName } from "../types/theme";
import {
	type Appearance,
	type ResolvedAppearance,
	resolveAppearance,
} from "./appearance";
import { useCustomThemes } from "./custom-theme-store";
import { definitionOf } from "./index";
import type { ThemePalette } from "./palette-contract";

/**
 * The composition the document is painting, for components that need a FACT
 * about it rather than its colours (colours come from `var(--color-*)` and need
 * nothing): Miro's dark mode, CodeMirror's scheme, the pencil previews.
 *
 * WHY NOT `definitionOf(themeName)` ALONE: contrast, accent and a custom theme
 * all move the palette, so a reader keyed on the name misses every layer. This
 * subscribes to all of them, and to the saved-theme LIBRARY (an edit to the
 * active saved theme is a repaint with no preference change at all), and
 * resolves through the same cache the provider fills, so it is a cache hit.
 *
 * Selected field by field (not one object selector) so a write to any other
 * preference does not re-render the caller.
 */
const useAppearanceInput = (): Appearance => {
	const themeName = useUiPreferencesStore((s) => s.themeName);
	const contrast = useUiPreferencesStore((s) => s.contrast);
	const accent = useUiPreferencesStore((s) => s.accent);
	const customThemeId = useUiPreferencesStore((s) => s.customThemeId);
	return useMemo(
		() => ({ themeName, contrast, accent, customThemeId }),
		[themeName, contrast, accent, customThemeId],
	);
};

/** The DERIVED palette of a saved theme, or undefined. Derivation lives here
 * rather than in `appearance.ts` so the composition engine stays free of the
 * theme library and the preferences store, and can be bundled without either. */
export const savedPaletteOf = (
	theme: CustomThemeV1 | undefined,
): ThemePalette | undefined => {
	const base = theme ? definitionOf(theme.base)?.palette : undefined;
	return base && theme
		? (deriveCustomPalette(
				base as unknown as PaletteRecord,
				theme,
			) as unknown as ThemePalette)
		: undefined;
};

/**
 * Everything a caller publishing or reading the appearance needs, resolved
 * once: the persisted tuple, the composition, and the saved theme's derived
 * palette (which the composition was built from, and which `applyAppearance`
 * must see so it does not fall back to the built-in).
 */
export const useSavedAppearance = () => {
	const appearance = useAppearanceInput();
	const library = useCustomThemes();
	return useMemo(() => {
		const saved = library.themes.find(
			(theme) => theme.id === appearance.customThemeId,
		);
		const savedPalette = savedPaletteOf(saved);
		const savedBase = saved?.base as ThemeName | undefined;
		return {
			appearance,
			savedPalette,
			savedBase,
			resolved: resolveAppearance(appearance, savedPalette, savedBase),
		};
		// `library` is a dependency on purpose: an edit to the ACTIVE saved theme
		// changes no preference field, and still has to repaint.
	}, [appearance, library]);
};

/** The composition alone, for components that need only a fact about it. */
export const useResolvedAppearance = (): ResolvedAppearance =>
	useSavedAppearance().resolved;

/** True when the painted palette is a dark one. */
export const useAppearanceIsDark = (): boolean =>
	useResolvedAppearance().palette.mode === "dark";
