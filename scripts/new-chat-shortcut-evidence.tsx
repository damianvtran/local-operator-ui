/**
 * Evidence harness: the shipped chat sidebar, on the real desktop transport.
 *
 * See `new-chat-shortcut-evidence.html` for why this exists. The short version:
 * the claim under test is that the New chat row prints the `⌘N` / `Ctrl+N` cap
 * the shortcut answers to, in the trailing column the All chats count sits in,
 * and that it is legible on the sidebar's own ground in both brand palettes.
 * Every one of those is a fact about a rendered row.
 *
 * WHAT IS REAL HERE: `ChatPage` and everything under it, the canonical sessions
 * store, `desktopRequest`'s same-origin `/__desktop` branch, the dev desktop
 * proxy, and a real isolated backend. The sidebar's readiness gate — the thing
 * that decides whether the row is rendered at all — is the backend's own
 * capability answer, not a fixture's.
 *
 * WHAT IS NOT: there is no Electron main process, so no IPC hop and no packaged
 * build. `desktopRequest` reaches the same backend by its OTHER shipped branch —
 * the one browser development already uses — rather than through `ipcRenderer`.
 * The transport module, the store and the components are byte-identical to what
 * ships either way; what differs is which of two existing branches carries the
 * bytes. Stated on the PR and in `docs/evidence/new-chat-shortcut/README.md` so
 * no reader over-reads these frames.
 */

import { ChatPage } from "@features/chat/components/chat-page";
import { queryClient } from "@shared/api/query-client";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { ThemeName } from "@shared/themes";
import { DEFAULT_THEME } from "@shared/themes";
import { ThemeProvider } from "@shared/themes/theme-provider";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "./new-chat-shortcut-evidence.css";

/*
 * Surface a mount failure where a driver can read it, instead of leaving an
 * empty body whose only diagnosis is "did not render".
 */
window.addEventListener("error", (event) => {
	(window as unknown as { __HARNESS_ERROR__?: string }).__HARNESS_ERROR__ =
		String(event.error?.stack ?? event.message);
});

/**
 * The working directory the composer's chip shows.
 *
 * A scratch path rather than the operator's own home, and that is not cosmetic:
 * these frames are committed and pasted into a PR, and a chip reading
 * `/Users/<their login>` publishes something the run has no reason to publish.
 * `DirectoryIndicator` only ever displays it and asks whether it exists, so a
 * real-looking scratch path is the whole requirement.
 */
const HARNESS_HOME = "/tmp/lo-new-chat-shortcut-evidence";

/*
 * HARNESS-ONLY `window.api` SHIM. Deliberately the smallest thing that lets the
 * real components mount, and deliberately HERE rather than in product code:
 * shipping a browser fallback for these would mean the app silently degrades
 * instead of failing where a preload is genuinely missing.
 *
 * It is three read-only methods, and none of them is on the path this harness
 * photographs: `getHomeDirectory` / `directoryExists` answer the cwd chip, and
 * `selectDirectory` resolves null — the same thing a cancelled native dialog
 * returns — so the picker is inert rather than broken.
 *
 * `desktop` is POINTEDLY ABSENT. `desktopRequest` checks `window.api?.desktop`
 * first and falls through to the same-origin `/__desktop` fetch when it is
 * missing, which is the branch the dev proxy serves. Defining it here would
 * route the transport into an IPC bridge that does not exist in a browser, and
 * the sidebar's catalogue — the reason the row is on screen at all — would never
 * load.
 */
(window as unknown as { api: Record<string, unknown> }).api = {
	getHomeDirectory: async () => HARNESS_HOME,
	directoryExists: async () => true,
	selectDirectory: async () => null,
};

/*
 * HARNESS-ONLY `window.electron` SHIM, for the same reason and with the same
 * boundary as the one above.
 *
 * `MessageInput` calls `window.electron.ipcRenderer.invoke` UNGUARDED at mount
 * (`get-platform-info`) and on the attach-file control (`show-open-dialog`).
 * That is pre-existing and byte-identical on `origin/main`, and it is the second
 * reason the app cannot be driven in a plain browser, after the one in `app.tsx`
 * this harness already avoids by not booting `app.tsx`. It matters here because
 * the composer is what the row sits above: without this the mount effect throws
 * and the sidebar column never paints.
 *
 * Answered, not implemented: `get-platform-info` reports THIS machine's own
 * platform, so nothing in the frame claims a platform the run is not on, and
 * `show-open-dialog` reports a cancelled dialog, which is the honest answer for
 * a browser with no native file picker.
 *
 * The method list is not guesswork: `invoke`, `on` and `removeListener` are
 * every `electron.ipcRenderer.*` member the renderer tree calls. `removeListener`
 * is NOT in the preload's own declared surface even though the speech-to-text
 * manager calls it on unmount — a real gap between the declared bridge and its
 * use, and the third thing that breaks a browser mount. All three are
 * pre-existing and byte-identical on `origin/main`.
 */
const PLATFORM = /mac/i.test(navigator.platform) ? "darwin" : "linux";
(window as unknown as { electron: Record<string, unknown> }).electron = {
	ipcRenderer: {
		invoke: async (channel: string) => {
			if (channel === "get-platform-info")
				return { platform: PLATFORM, arch: "arm64" };
			if (channel === "show-open-dialog")
				return { canceled: true, filePaths: [] };
			return undefined;
		},
		// Returns an unsubscribe, as the preload's `on` does, so a caller that
		// tears down through the RETURN VALUE works; `removeListener` is the
		// other teardown style and has to exist for the speech manager.
		on: () => () => undefined,
		removeListener: () => undefined,
		send: () => undefined,
	},
};

/*
 * A durable cwd, and a clean draft, so a frame cannot depend on capture order.
 *
 * The store persists `activeDraftKey` and `drafts` to localStorage, so a run
 * that staged a draft — which is the state one of these frames IS — would
 * otherwise rehydrate into the next load and the "at rest" frame would come back
 * already marked `aria-current="page"`. `draft-pick-evidence.tsx` pins the cwd
 * for the same reason: what the harness drives has to be the only difference
 * between two frames.
 */
useCanonicalSessionsStore.setState({
	cwd: HARNESS_HOME,
	activeDraftKey: null,
	activeSessionId: null,
	drafts: {},
});

/*
 * The palette, chosen from the URL so ONE page can be photographed twice.
 *
 * Both brand palettes are captured — dark and light — because a key cap is a
 * colour step on a ground, and light is where a visibly-too-faint cap hides.
 * `?theme=localOperatorLight` is the second half; the app's own default is the
 * first, and the store's `setTheme` is the action the settings picker calls, so
 * the harness drives the app's own path rather than writing `data-theme` itself.
 *
 * A BARE URL IS PINNED TO THE DEFAULT, not left to whatever the profile holds:
 * the theme persists to localStorage, so a run that had just photographed the
 * light palette would otherwise come back light on the next load and the file
 * named for the default palette would not be one. `DEFAULT_THEME` is the app's
 * own constant rather than a literal here.
 */
const requestedTheme = new URLSearchParams(window.location.search).get("theme");
useUiPreferencesStore.setState({
	themeName: (requestedTheme as ThemeName) ?? DEFAULT_THEME,
});

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			{/*
			 * `ThemeProvider` is the app's own; it publishes the theme id to the
			 * document element, which is what the Tailwind half of the app resolves
			 * `--lo-*` variables from — the caps' `sunken` ground among them.
			 *
			 * `MemoryRouter` rather than the app's `HashRouter`: `ChatPage` reads
			 * `useNavigate` and `useParams`, and a memory router starts at a known
			 * route with no address bar to photograph.
			 */}
			<ThemeProvider>
				<MemoryRouter initialEntries={["/chat"]}>
					<ChatPage />
				</MemoryRouter>
			</ThemeProvider>
		</QueryClientProvider>
	</StrictMode>,
);
