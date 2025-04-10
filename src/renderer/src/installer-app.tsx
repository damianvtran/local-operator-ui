import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import type React from "react";
import { InstallerContent } from "./features/installer/installer-content";
import { AppContainer } from "./features/installer/installer-styled";
import theme from "./theme";

/**
 * InstallerApp component
 *
 * Container component that wraps the installer content with theme provider
 */
export const InstallerApp: React.FC = () => {
	return (
		<ThemeProvider theme={theme}>
			<CssBaseline />
			<AppContainer>
				<InstallerContent />
			</AppContainer>
		</ThemeProvider>
	);
};
