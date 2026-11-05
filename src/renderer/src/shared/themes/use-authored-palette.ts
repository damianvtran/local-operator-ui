import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useMemo } from "react";
import { deriveCustomPalette } from "../../../../shared/theme-engine/custom.mjs";
import { useCustomThemes } from "./custom-theme-store";
import { definitionOf, themes } from "./index";

/** Layer controls need the AUTHORED custom base, not the composed result and not
 * its built-in fallback. Using either would double contrast or show the wrong
 * theme-accent swatch after saving a custom colour. */
export const useAuthoredPalette = () => {
	const themeName = useUiPreferencesStore((s) => s.themeName);
	const customThemeId = useUiPreferencesStore((s) => s.customThemeId);
	const library = useCustomThemes();
	return useMemo(() => {
		const custom = library.themes.find((theme) => theme.id === customThemeId);
		const base = definitionOf(custom?.base ?? themeName)?.palette;
		return {
			palette: base && custom ? deriveCustomPalette(base, custom) : base,
			name: custom?.name ?? themes[themeName].name,
		};
	}, [themeName, customThemeId, library]);
};
