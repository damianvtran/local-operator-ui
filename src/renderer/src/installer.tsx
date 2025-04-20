import { ThemeProvider } from "@mui/material";
import CssBaseline from "@mui/material/CssBaseline";
import React from "react";
import ReactDOM from "react-dom/client";
import "./assets/fonts/fonts.css";
import { InstallerApp } from "./installer-app";
import { ErrorBoundary } from "./shared/components/common/error-boundary";
import {DEFAULT_THEME, themes} from "@shared/themes";

document.addEventListener("DOMContentLoaded", () => {
	const root = ReactDOM.createRoot(
		document.getElementById("app") as HTMLElement,
	);
	root.render(
		<React.StrictMode>
			<ThemeProvider theme={themes[DEFAULT_THEME]}>
				<CssBaseline />
				<ErrorBoundary>
					<InstallerApp />
				</ErrorBoundary>
			</ThemeProvider>
		</React.StrictMode>,
	);
});
