import { UndoToasts } from "@features/chat/components/undo-toasts";
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
import { installScrollbarActivity } from "@shared/lib/scrollbar-activity";
import type { PostHogConfig } from "posthog-js";
import App from "./app";
import { installDevDriver } from "./dev-driver/install";
import { RegistrationToasts } from "./mini-view/registration-toasts";
import { queryClient } from "./shared/api/query-client";
import { ErrorBoundary } from "./shared/components/common/error-boundary";
import { GlobalScrollbarStyles } from "./shared/components/common/global-scrollbar-styles";
import { AuthProviders } from "./shared/providers/auth";
import { FeatureFlagProvider } from "./shared/providers/feature-flags";
import { installConversationInputSync } from "./shared/store/conversation-input-sync";
import { installRightSlotMemoryFollower } from "./shared/store/right-slot-follower";
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

/*
 * THE SCROLLBAR FADE'S DOM HALF, installed once for the whole app. Its CSS half
 * is `<GlobalScrollbarStyles />` below, and the pair is deliberately split: the
 * paint keys on an attribute this module writes, so no component has to know
 * anything about activity and a theme switch never re-renders either of them.
 *
 * At module scope rather than in the render tree for the same reason as the
 * driver above: the listeners belong to the document, not to a mounted
 * component, and they must cover the first screen — a render-triggered install
 * would miss a scroll that happens before the effect runs.
 *
 * THE UNINSTALL IS KEPT ON `window` RATHER THAN DISCARDED (review round 1, Min4).
 * A hot reload that REPLACES this module re-runs the line once and the old
 * listeners belong to a document that outlives the module, so without the handle
 * the document accumulates a second set of them. The module cannot see the
 * first set; the global is the only place it can be found from. This is a
 * development-time ring, not a product decision — a launch still installs once,
 * and nothing else reads the key.
 */
declare global {
	interface Window {
		/** The outstanding install, so a hot-reloaded entry can take it back off. */
		__loSbUninstall?: () => void;
	}
}
window.__loSbUninstall?.();
window.__loSbUninstall = installScrollbarActivity();

/*
 * The draft store's cross-document sync (risk R5): the mini view's document is
 * the second writer of `conversation-input-store`, and this listener is how the
 * two copies converge. Module scope for the same reason `installDevDriver` is:
 * it must outlive every render, and it must exist even if React fails to mount.
 */
installConversationInputSync();

/*
 * THE RIGHT SLOT'S MEMORY IS PROJECTED BEFORE THE FIRST RENDER (issue #894).
 *
 * Installed here rather than in a component, on the same argument as the sync
 * above: the bind must be a subscriber that outlives every render, and it must be
 * in place BEFORE the first one. `localStorage` hydrates synchronously, so
 * `installRightSlotMemoryFollower` reads the restored memory and writes the four
 * flags during this line - which is what makes frame one the active
 * conversation's own panel rather than an empty slot that fills in a frame later.
 * `right-slot-follower.ts` carries the rest.
 */
installRightSlotMemoryFollower();

document.addEventListener("DOMContentLoaded", () => {
	/*
	 * THE CHROME FACTS LAND ON THE DOCUMENT ELEMENT HERE, BEFORE THE FIRST RENDER.
	 *
	 * `data-chrome-platform` decides whether every column's first row starts 32px
	 * lower (the macOS lane) and `data-chrome-mode` decides whether the app reserves
	 * the OS controls' corners at all, so a value that arrived after the first paint
	 * would be a visible jump on EVERY launch - which is why it is read
	 * synchronously from the preload rather than over an IPC round trip, and why it
	 * is written here rather than by a hook inside `App`.
	 *
	 * It replaces #477's `data-titlebar-platform`, which `App` computed from
	 * `navigator.platform`. That source cannot express the native fallback (it knows
	 * the OS, not the mode), it cannot know where the OS put its controls (a Linux
	 * WM may put them leading), and it only exists after React mounts.
	 *
	 * `data-chrome-fullscreen` starts at "false" and is kept up to date by
	 * `useWindowChrome`, which subscribes to main's state pushes - full screen is not
	 * something the renderer can observe, and it is what collapses the lane to 0.
	 */
	const chromeFacts = window.api?.windowChrome?.facts?.();
	if (chromeFacts) {
		const root = document.documentElement;
		root.dataset.chromePlatform = chromeFacts.platform;
		root.dataset.chromeMode = chromeFacts.mode;
		root.dataset.chromeFullscreen = "false";
	}

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
						{/*
						 * THE UNDO OFFERS AND THE ARCHIVE REFUSAL ARE RAISED FROM HERE (2026-09-27).
						 * They used to be drawn by the chat sidebar, into a lane of its own; the
						 * sidebar collapses to a 56px strip (unmounting the panel) while the acts
						 * that raise the messages stay reachable from the chat pane, the composer and
						 * the slash command - so a surface that lives for the app's whole life owns
						 * them now, and this is that surface. It renders nothing: the messages land in
						 * the ONE global container above, where every other toast goes.
						 */}
						<UndoToasts />
						{/*
						 * THE QUICK-SEND REGISTRATION TOASTS (design §G.3; UX round 1, U1),
						 * mounted here for the same reason `UndoToasts` is: this surface
						 * lives for the app's whole life, and what it raises lands in the ONE
						 * global container above rather than in a lane of its own. A
						 * registration failure is otherwise visible only to a reader already
						 * on Settings → Hotkeys.
						 */}
						<RegistrationToasts />
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
