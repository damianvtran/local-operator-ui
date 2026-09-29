/**
 * The mini view's entry document (quick-send design §D.1), a fourth renderer
 * document for the console capture's own reason: a hotkey-summoned window must
 * mount the composer and NOTHING that reaches the app's shell, so a route
 * inside the app would boot the session store, the feed subscription and the
 * sidebar on every summon.
 *
 * WHAT IT DELIBERATELY DOES NOT MOUNT: `installDevDriver` (the driver is for
 * the main window; the mini scene drives over CDP directly), the PostHog
 * provider (a hotkey-summoned window must not emit a pageview per summon),
 * the feed subscription, the chat shell, the sidebar, the canvas, the
 * QueryClient provider (this surface calls `desktopResult` imperatively). What
 * it DOES mount is the theme, published from the persisted preference before
 * the first render — the store is zustand-persist and readable synchronously —
 * and the mini composer itself.
 */

import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { applyThemeToDocument } from "@shared/themes";
import React from "react";
import ReactDOM from "react-dom/client";
import "../assets/fonts/fonts.css";
import "@renderer/styles/index.css";
import { MiniComposer } from "./mini-composer";

/*
 * Published BEFORE `createRoot`: the palette lives in localStorage and the
 * store hydrates synchronously at import, so this is the same value the main
 * window would paint — while deferring it to an effect would paint one frame
 * with no `data-theme` and every role utility resolving to nothing.
 *
 * The NAME goes straight in; `applyThemeToDocument` resolves the theme itself
 * (it maps an unknown name to the default), so wrapping it in `getTheme` here
 * would hand the resolver a resolved option.
 */
applyThemeToDocument(useUiPreferencesStore.getState().themeName);

document.addEventListener("DOMContentLoaded", () => {
	const container = document.getElementById("mini-view");
	if (!container) return;
	ReactDOM.createRoot(container).render(
		<React.StrictMode>
			<MiniComposer />
		</React.StrictMode>,
	);
});
