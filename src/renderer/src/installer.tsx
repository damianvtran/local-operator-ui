import React from "react";
import ReactDOM from "react-dom/client";
import "./assets/fonts/fonts.css";
import "@renderer/styles/index.css";
import { DEFAULT_THEME, applyThemeToDocument } from "@shared/themes";
import { InstallerApp } from "./installer-app";
import { ErrorBoundary } from "./shared/components/common/error-boundary";

/*
 * The installer window's theme, published once.
 *
 * This entry is its own html document: it never mounts the app's
 * `ThemeProvider`, and there is no picker or persisted preference to read, so
 * the default palette is applied here explicitly. Every Tailwind role utility
 * resolves through the `--lo-*` variables in that `[data-theme]` block, and a
 * document without the attribute renders this window with no colours at all.
 */
applyThemeToDocument(DEFAULT_THEME);

document.addEventListener("DOMContentLoaded", () => {
	const root = ReactDOM.createRoot(
		document.getElementById("app") as HTMLElement,
	);
	root.render(
		<React.StrictMode>
			<ErrorBoundary>
				<InstallerApp />
			</ErrorBoundary>
		</React.StrictMode>,
	);
});
