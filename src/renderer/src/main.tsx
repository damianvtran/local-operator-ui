import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { PostHogProvider } from "posthog-js/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { ThemedToastContainer } from "./shared/components/common";
import "@assets/fonts/fonts.css";
import "@renderer/styles/index.css";
import { config } from "@shared/config";
import type { PostHogConfig } from "posthog-js";
import App from "./app";
import { installDevDriver } from "./dev-driver/install";
import { queryClient } from "./shared/api/query-client";
import { ErrorBoundary } from "./shared/components/common/error-boundary";
import { GlobalScrollbarStyles } from "./shared/components/common/global-scrollbar-styles";
import { AuthProviders } from "./shared/providers/auth";
import { FeatureFlagProvider } from "./shared/providers/feature-flags";
import { ThemeProvider } from "./shared/themes/theme-provider";
import { isDevelopmentMode } from "./shared/utils/env-utils";

const posthogOptions: Partial<PostHogConfig> = {
	api_host: config.VITE_PUBLIC_POSTHOG_HOST,
	capture_exceptions: true,
};

/*
 * Register the dev driver's verbs, if this launch armed it.
 *
 * At module scope rather than inside the render tree: the driver must be
 * answerable before React has mounted (a scene's first call can arrive while the
 * page is still painting), and it must survive a render error — a driver that
 * exists only when a component mounted cannot report why the app did not mount.
 * A no-op in every normal launch; `docs/agent-driver.md` is the contract.
 */
installDevDriver();

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
								<GlobalScrollbarStyles />
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
