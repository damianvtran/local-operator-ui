import CssBaseline from "@mui/material/CssBaseline";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { PostHogProvider } from "posthog-js/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { ThemedToastContainer } from "./shared/components/common";
import "@assets/fonts/fonts.css";
import { config } from "@shared/config";
import type { PostHogConfig } from "posthog-js";
import App from "./app";
import { queryClient } from "./shared/api/query-client";
import { ErrorBoundary } from "./shared/components/common/error-boundary";
import { RadientTokenRefresherRunner } from "./shared/components/system/RadientTokenRefresherRunner";
import { AuthProviders } from "./shared/providers/auth";
import { FeatureFlagProvider } from "./shared/providers/feature-flags";
import { ThemeProvider } from "./shared/themes/theme-provider";
import { GlobalScrollbarStyles } from "./shared/components/common/global-scrollbar-styles";
import { isDevelopmentMode } from "./shared/utils/env-utils";

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
								<GlobalScrollbarStyles />
								<ErrorBoundary>
									<HashRouter>
										<App />
										{/* Run the token refresher hook independently */}
										<RadientTokenRefresherRunner />
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
