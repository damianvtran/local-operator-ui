/**
 * Evidence harness: the shipped chat surface on the real submit path.
 *
 * See `submit-latency-evidence.html` for why this exists. The short version:
 * the claim under test is "the user's text reaches the transcript in one frame
 * and the composer is already empty", which is a claim about a rendered frame,
 * and the round trip it overlaps is the thing that used to cost ~1.15s. So
 * nothing on that path may be stubbed — this mounts the real `ChatPage`, which
 * drives the real store, the real `admitChatDraft`, the real `desktopRequest`
 * and a real SSE subscription.
 *
 * WHAT IS REAL HERE: `ChatPage` and everything under it, the canonical sessions
 * store, `desktopRequest`'s same-origin `/__desktop` branch, the dev desktop
 * proxy, the backend, and the event stream. A human types, presses Enter, and
 * watches the actual code run.
 *
 * WHAT IS NOT: there is no Electron main process, so no IPC hop and no packaged
 * build. `desktopRequest` reaches the same backend by its OTHER shipped branch
 * — the one browser development already uses — rather than through `ipcRenderer`.
 * The transport module, the store and the components are byte-identical to what
 * ships either way; what differs is which of two existing branches carries the
 * bytes. Stated on the PR and in docs/evidence/submit-latency/README.md so no
 * reader over-reads these frames.
 */

import { ChatPage } from "@features/chat/components/chat-page";
import { queryClient } from "@shared/api/query-client";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { ThemeProvider } from "@shared/themes/theme-provider";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "./submit-latency-evidence.css";

/*
 * Surface a mount failure where a driver can read it, instead of leaving an
 * empty body whose only diagnosis is "did not render".
 */
window.addEventListener("error", (event) => {
	(window as unknown as { __HARNESS_ERROR__?: string }).__HARNESS_ERROR__ =
		String(event.error?.stack ?? event.message);
});

/*
 * HARNESS-ONLY `window.api` SHIM. Deliberately the smallest thing that lets the
 * real components mount, and deliberately HERE rather than in product code:
 * shipping a browser fallback for these would mean the app silently degrades
 * instead of failing where a preload is genuinely missing.
 *
 * It is three read-only methods, and none of them is on the submit path:
 *
 *  - `getHomeDirectory` / `directoryExists` — `DirectoryIndicator` calls these
 *    on mount to render and validate the cwd chip. Answered from a constant so
 *    the chip paints; nothing about the send depends on the answer.
 *  - `selectDirectory` — the picker a human cannot use in a browser. It resolves
 *    null (the same thing a cancelled native dialog returns), so the control is
 *    inert rather than broken. The harness pins a durable cwd below precisely so
 *    no frame ever needs this.
 *
 * `desktop` is POINTEDLY ABSENT. `desktopRequest` checks `window.api?.desktop`
 * first and falls through to the same-origin `/__desktop` fetch when it is
 * missing (desktop-api.ts:37,62). Defining it here would route the transport
 * into an IPC bridge that does not exist in a browser and break the very path
 * these frames are about. The same absence sends `useDesktopWatchLease` down
 * its documented JSON-transport branch, which is correct: there is no native
 * notification delivery to claim.
 */
const HARNESS_HOME = "/Users/damian";
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
 * That is pre-existing — it is byte-identical on `origin/main` — and it is the
 * SECOND reason the app cannot be driven in a plain browser, after the one in
 * `app.tsx:91` that this harness already avoids by not booting `app.tsx`. It
 * matters here because the composer is the surface under the camera: without
 * this, the mount effect throws and the transcript never paints.
 *
 * Answered, not implemented: `get-platform-info` returns this machine's real
 * platform so the composer's modifier-key hints are the ones a reader of the
 * frame would see, and `show-open-dialog` reports a cancelled dialog, which is
 * the honest answer for a browser with no native file picker.
 *
 * The method list is not guesswork: `invoke`, `on` and `removeListener` are
 * every `electron.ipcRenderer.*` member the renderer tree calls. Note that
 * `removeListener` is NOT in the preload's own declared surface
 * (`src/preload/index.d.ts:140`) even though `use-speech-to-text-manager.ts`
 * calls it on unmount — a real gap between the declared bridge and its use,
 * and the third thing that breaks a browser mount. All three are pre-existing
 * and byte-identical on `origin/main`.
 *
 * Fixing the product to guard these is deliberately NOT done here: it is
 * unrelated to the submit path and would expand this slice into a change the
 * delegator has to review without having asked for it. Reported instead.
 */
(window as unknown as { electron: Record<string, unknown> }).electron = {
	ipcRenderer: {
		invoke: async (channel: string) => {
			if (channel === "get-platform-info") return { platform: "darwin" };
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
 * A durable cwd, so a draft can be sent without touching the directory picker.
 *
 * The store defaults to `"~"` and persists to localStorage, so a capture run
 * could otherwise inherit whatever a previous run left behind — and a frame
 * whose cwd depends on capture order is not reproducible evidence. Pinning it
 * before the first render also keeps the composer's chip stable across the
 * before/after pair, so the two frames differ only in the behaviour under test.
 */
useCanonicalSessionsStore.setState({ cwd: HARNESS_HOME });

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			{/*
			 * `ThemeProvider` is the app's own; the chat surface reads MUI theme
			 * values in the files not yet ported to Tailwind, and without it those
			 * throw on first paint.
			 *
			 * `MemoryRouter` rather than the app's `HashRouter`: `ChatPage` reads
			 * `useParams`/`useNavigate`, and a memory router starts at a known route
			 * with no address bar to photograph and no way for a stray navigation to
			 * survive a reload into the next capture.
			 */}
			<ThemeProvider>
				<MemoryRouter initialEntries={["/chat"]}>
					<ChatPage />
				</MemoryRouter>
			</ThemeProvider>
		</QueryClientProvider>
	</StrictMode>,
);
