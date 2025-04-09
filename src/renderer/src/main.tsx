import CssBaseline from "@mui/material/CssBaseline";
import { QueryClientProvider } from "@tanstack/react-query";
import { PostHogProvider } from "posthog-js/react";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "react-toastify/dist/ReactToastify.css";
import { ThemedToastContainer } from "./components/common";
import "./assets/fonts/fonts.css";
import { queryClient } from "./api/query-client";
import App from "./app";
import { ErrorBoundary } from "./components/common/error-boundary";
import { ThemeProvider } from "./themes/theme-provider";
import { isDevelopmentMode } from "./utils/env-utils";
import { config } from "./config";
import type { PostHogConfig } from "posthog-js";

const posthogOptions: Partial<PostHogConfig> = {
	api_host: config.VITE_PUBLIC_POSTHOG_HOST,
	capture_exceptions: true,
};

document.addEventListener("DOMContentLoaded", () => {
	const root = ReactDOM.createRoot(
		document.getElementById("app") as HTMLElement,
	);
	root.render(
		<React.StrictMode>
			<PostHogProvider
				apiKey={config.VITE_PUBLIC_POSTHOG_KEY}
				options={posthogOptions}
			>
				<QueryClientProvider client={queryClient}>
					<ThemeProvider>
						<CssBaseline />
						<ErrorBoundary>
							<HashRouter>
								<App />
							</HashRouter>
						</ErrorBoundary>
						<ThemedToastContainer />
						{/* React Query DevTools - only in development (positioned at bottom left) */}
						{isDevelopmentMode() && (
							<ReactQueryDevtools
								initialIsOpen={false}
								position="left"
								buttonPosition="top-left"
							/>
						)}
					</ThemeProvider>
				</QueryClientProvider>
			</PostHogProvider>
		</React.StrictMode>,
	);
});
