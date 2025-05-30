import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { FC, ReactNode } from "react";
import { getTheme } from "./index";

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
 * Theme provider component
 *
 * Provides the selected theme from the UI preferences store to the application
 */
export const ThemeProvider: FC<ThemeProviderProps> = ({ children }) => {
	// Get the selected theme from the UI preferences store
	const themeName = useUiPreferencesStore((state) => state.themeName);

	// Get the theme object for the selected theme
	const themeOption = getTheme(themeName);

	return (
		<MuiThemeProvider theme={themeOption.theme}>{children}</MuiThemeProvider>
	);
};
