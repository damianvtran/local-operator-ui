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
 * QueryClient provider (this surface calls `desktopResult` imperatively).
 * What it DOES mount is the theme, published from the persisted preference
 * before the first render — the store is zustand-persist and readable
 * synchronously — the mini frame (the shared composer's host), and, since the
 * restyle, the app's own toast container: the shared composer carries toast
 * paths (credential-store receipts), and a document with no container is a
 * document where those receipts silently no-op (risk R4).
 */

import { ThemedToastContainer } from "@shared/components/common";
import {
	applyGlassFacts,
	subscribeGlassPaint,
	syncGlassScheme,
} from "@shared/hooks/use-window-glass";
import { installExternalOpenRefusalToasts } from "@shared/lib/external-open-refusal";
import { installConversationInputSync } from "@shared/store/conversation-input-sync";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { type ThemeName, applyThemeToDocument } from "@shared/themes";
import React from "react";
import ReactDOM from "react-dom/client";
import "../assets/fonts/fonts.css";
import "@renderer/styles/index.css";
import { MiniComposer } from "./mini-composer";
import { themeNameFromPreferencesWrite } from "./mini-state";

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

/*
 * THE POPOUT'S GLASS, from the same two channels the main document reads: the
 * synchronous argv fact for the FIRST frame (a window that opens opaque and then
 * turns translucent is a visible jump on every summon) and main's pushes for
 * every later state (the Settings row, the OS reduce-transparency switch). Main
 * forwards its state to this window too; before this the popout had no glass
 * wiring at all.
 */
applyGlassFacts(window.api?.windowGlass?.facts?.() ?? null);
subscribeGlassPaint();

/*
 * THE THEME SYNC, and it is the operator's bug rather than a nicety. This
 * document hydrates the preferences store once at import; a theme chosen in the
 * main window afterwards wrote the persisted blob but never reached this store
 * or this document, so the popout painted the theme it booted with. The
 * `storage` event is the platform's own cross-document broadcast (the draft
 * store's sync uses it for the same pair of windows): adopt the written theme,
 * publish it, and re-derive the glass alphas because `blockVeil` differs by
 * scheme. `setTheme` keeps the store copy current so the summon path, which
 * re-applies `getState().themeName`, cannot put the stale palette back.
 */
const preferencesStoreKey =
	useUiPreferencesStore.persist?.getOptions?.()?.name ??
	"ui-preferences-storage";
window.addEventListener("storage", (event) => {
	const themeName = themeNameFromPreferencesWrite({
		eventKey: event.key,
		storeKey: preferencesStoreKey,
		newValue: event.newValue,
	});
	if (!themeName) return;
	useUiPreferencesStore.getState().setTheme(themeName as ThemeName);
	applyThemeToDocument(themeName as ThemeName);
	syncGlassScheme();
});

/*
 * The draft store's cross-document sync (risk R5). This document is the second
 * writer of `conversation-input-store` now, and the listener must outlive every
 * render — module scope, like the theme publication above.
 */
installConversationInputSync();

/*
 * The refused-link toast's pushed half (round-2 R-4): this window is guarded by
 * the same door, and it carries the app's toast container (risk R4 above), so a
 * refusal of a link it holds gets the same sentence the main window shows.
 */
installExternalOpenRefusalToasts();

document.addEventListener("DOMContentLoaded", () => {
	const container = document.getElementById("mini-view");
	if (!container) return;
	ReactDOM.createRoot(container).render(
		<React.StrictMode>
			<MiniComposer />
			<ThemedToastContainer />
		</React.StrictMode>,
	);
});
