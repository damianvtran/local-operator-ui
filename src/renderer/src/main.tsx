import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { PostHogProvider } from "posthog-js/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { ThemedToastContainer } from "./shared/components/common";
import "@assets/fonts/fonts.css";
import "@renderer/styles/index.css";
import { config, telemetryEnabled } from "@shared/config";
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
	/*
	 * `PostHogProvider` MOUNTS ONLY WHEN THIS LAUNCH MAY REPORT.
	 *
	 * Mounting it is what calls `posthog.init` in the renderer, and initialization
	 * is what brings the whole client with it: pageviews, autocapture, exception
	 * capture (`capture_exceptions` above) and session replay, which is what made
	 * a test run show up in the PostHog project as a user AND as a replay to watch.
	 * The decision is the launch's, read from the preload bridge by
	 * `shared/config/telemetry.ts`, because the renderer's own `VITE_*` values are
	 * inlined at build time and so cannot express a runtime switch at all — the
	 * reason a build that merely omitted the key still reported. That module also
	 * holds the renderer's half of the blank-key rule (`apiKey` below is the
	 * BUILD's key, while main decides from the launch's), so a build with no key
	 * resolves to off here exactly as it constructs no client in main.
	 *
	 * With telemetry off, the provider is not rendered and NOTHING is initialized:
	 * `posthog-js` is still imported (the same import the feature-flag provider
	 * needs), and the measurement is that importing it constructs a client but
	 * sends nothing — no request is made until `init`, so an off launch makes no
	 * PostHog connection at all. The one other place in the renderer that reaches
	 * for `posthog` is the feature-flag provider, and it is gated on the same
	 * decision, so nothing here can re-enable what this skips.
	 */
	const appTree = (
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
	);

	root.render(
		<React.StrictMode>
			{telemetryEnabled ? (
				<PostHogProvider
					apiKey={config.VITE_PUBLIC_POSTHOG_KEY}
					options={posthogOptions}
				>
					{appTree}
				</PostHogProvider>
			) : (
				appTree
			)}
		</React.StrictMode>,
	);
});
