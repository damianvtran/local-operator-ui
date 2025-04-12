import CssBaseline from "@mui/material/CssBaseline";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { PostHogProvider } from "posthog-js/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "react-toastify/dist/ReactToastify.css";
import { ThemedToastContainer } from "./shared/components/common";
import "./assets/fonts/fonts.css";
import type { PostHogConfig } from "posthog-js";
import { queryClient } from "./api/query-client";
import App from "./app";
import { config } from "./config";
import { AuthProviders } from "./providers/auth";
import { FeatureFlagProvider } from "./providers/feature-flags";
import { ErrorBoundary } from "./shared/components/common/error-boundary";
import { ThemeProvider } from "./themes/theme-provider";
import { isDevelopmentMode } from "./utils/env-utils";

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
					<FeatureFlagProvider>
						<AuthProviders>
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
						</AuthProviders>
					</FeatureFlagProvider>
				</QueryClientProvider>
			</PostHogProvider>
		</React.StrictMode>,
	);
});
