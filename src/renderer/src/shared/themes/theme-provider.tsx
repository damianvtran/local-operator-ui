import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import { reportWindowChromeColors } from "@shared/hooks/use-window-chrome";
import { syncGlassScheme } from "@shared/hooks/use-window-glass";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { FC, ReactNode } from "react";
import { useLayoutEffect, useMemo } from "react";
import { applyAppearance, resolveAppearance } from "./appearance";

/**
 * Props for the ThemeProvider component
 */
type ThemeProviderProps = {
	/**
	 * Children to render within the theme provider
	 */
	children: ReactNode;
};

/**
 * Theme provider component.
 *
 * Provides the selected theme from the UI preferences store to the
 * application, on both halves of the migration at once: MUI reads the theme
 * object through context, and Tailwind reads `data-theme` off the document
 * element.
 */
export const ThemeProvider: FC<ThemeProviderProps> = ({ children }) => {
	// Get the selected theme and its appearance layers from the UI preferences store
	const themeName = useUiPreferencesStore((state) => state.themeName);
	const contrast = useUiPreferencesStore((state) => state.contrast);
	const accent = useUiPreferencesStore((state) => state.accent);

	/*
	 * The palette the app paints: the built-in at Standard contrast with its own
	 * accent - the IDENTITY path, which is every profile today because no setting
	 * writes the v5 fields yet - or a composition over it (see `appearance.ts`).
	 * On the identity path `resolved.muiTheme` is the prebuilt `getTheme(...)`
	 * object and `resolved.id` the built-in id, so this provider renders exactly
	 * what it rendered before the engine existed.
	 */
	const resolved = useMemo(
		() => resolveAppearance({ themeName, contrast, accent }),
		[themeName, contrast, accent],
	);

	/*
	 * Publish the theme id to the document element on mount and on every
	 * switch. Without it the Tailwind half of a half-migrated screen resolves
	 * every `--lo-*` variable to nothing.
	 *
	 * `useLayoutEffect` so the attribute lands in the same frame as the first
	 * paint of the new theme; a `useEffect` here shows one frame of the previous
	 * palette's variables under the new MUI theme on every switch.
	 */
	useLayoutEffect(() => {
		/* Injects the composed block (if any) BEFORE setting `data-theme`, so no
		   frame names a block that does not exist yet. */
		applyAppearance({ themeName, contrast, accent });
		/*
		 * THE SAME FRAME INFORMS THE WINDOW CHROME. On Windows and Linux the OS's
		 * caption glyphs are drawn by Electron over the renderer, and on Linux the box
		 * behind them is a colour we supply - so a theme switch that stopped at
		 * `applyThemeToDocument` would leave the app's ink and the OS's glyphs one
		 * palette apart, with the caption buttons the last thing on screen to catch up.
		 * Reported from the variables the document paints (see the function's note) and
		 * in THIS effect rather than a second one, so the two cannot disagree.
		 */
		reportWindowChromeColors(resolved.id);
		/* The glass alphas and the OS material's tone follow the palette's scheme. */
		syncGlassScheme();
	}, [themeName, contrast, accent, resolved.id]);

	return (
		<MuiThemeProvider theme={resolved.muiTheme}>{children}</MuiThemeProvider>
	);
};
