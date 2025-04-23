import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { DEFAULT_THEME, getTheme } from "@shared/themes";
import type React from "react";
import { InstallerContent } from "./features/installer/components/installer-content";
import { AppContainer } from "./features/installer/components/installer-styled";

const defaultThemeOption = getTheme(DEFAULT_THEME);
const defaultMuiTheme = defaultThemeOption.theme;

/**
 * InstallerApp component
 *
 * Container component that wraps the installer content with theme provider
 */
export const InstallerApp: React.FC = () => {
	return (
		<ThemeProvider theme={defaultMuiTheme}>
			<CssBaseline />
			<AppContainer>
				<InstallerContent />
			</AppContainer>
		</ThemeProvider>
	);
};
