import { ThemeProvider } from "@mui/material";
import CssBaseline from "@mui/material/CssBaseline";
import React from "react";
import ReactDOM from "react-dom/client";
import "./assets/fonts/fonts.css";
import { DEFAULT_THEME, getTheme } from "@shared/themes";
import { InstallerApp } from "./installer-app";
import { ErrorBoundary } from "./shared/components/common/error-boundary";

const defaultTheme = getTheme(DEFAULT_THEME);
const defaultMuiTheme = defaultTheme.theme;

document.addEventListener("DOMContentLoaded", () => {
	const root = ReactDOM.createRoot(
		document.getElementById("app") as HTMLElement,
	);
	root.render(
		<React.StrictMode>
			<ThemeProvider theme={defaultMuiTheme}>
				<CssBaseline />
				<ErrorBoundary>
					<InstallerApp />
				</ErrorBoundary>
			</ThemeProvider>
		</React.StrictMode>,
	);
});
