/*
 * The real-backend open harness: the SHIPPED chat page, a real sidebar click,
 * and a real `local-operator serve` at the far end of the app's own development
 * desktop proxy.
 *
 *     LOCAL_OPERATOR_DESKTOP_BACKEND_URL=http://127.0.0.1:<port> \
 *     LOCAL_OPERATOR_DESKTOP_TOKEN=<token> \
 *       pnpm vite --config scripts/session-open-live.vite.mjs      # one shell
 *     node scripts/session-open-live.mjs --json                    # another
 *
 * WHY A SECOND HARNESS BESIDE `session-switch.tsx`. That page scripts the owner
 * (`session-switch-bridge.ts`) because its question is how the renderer scales
 * with a slow owner. The question this one answers is the operator's: from a
 * click on a conversation, how long until its latest messages are on screen and
 * the composer will send, against the backend as it actually is - its snapshot
 * page, its `/history`, its locks and its cold facade. So nothing is scripted
 * here: every request goes through `desktopRequest`/`subscribeDesktopStream`'s
 * browser transports to the proxy (`vite-plugins/desktop-proxy.ts`), which is
 * the same `requestDesktop` main uses in Electron.
 *
 * WHAT IS NOT REAL, stated so no number is read as more than it is: the Vite dev
 * bundle in a private headless Chrome rather than the packaged app, so no
 * Electron IPC hop and no minified bundle. That hop is the same on both trees,
 * so the BEFORE/AFTER difference is the number to read.
 *
 * WHAT A RUN RECORDS, all on the page's own `performance.now()` clock:
 * - `paintedAt`: the first frame with transcript content for the target;
 * - `sendableAt`: the first store commit in which the view is on the target and
 *   its validation window is closed - the moment `admitChatDraft` would admit a
 *   send (the gate that the `sessions.get` guard read used to hold);
 * - every desktop op the switch issued, with its start and settle times.
 */

import "./session-switch.css";
import "@renderer/assets/fonts/fonts.css";
import { ChatPage } from "@features/chat/components/chat-page";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { __resetPaintCache } from "@shared/store/paint-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import { DESKTOP_STREAM_DETAIL } from "../src/shared/desktop-stream-notice";
import { installPreloadStubs } from "./session-switch-bridge";

installPreloadStubs();

/*
 * THE STREAM, SHAPED LIKE MAIN'S RELAY. The renderer's browser fallback is an
 * `EventSource`, which cannot see a refusal's HTTP status - so a 404 for a
 * conversation that is gone arrives as a bare "stream ended" and the pane says
 * "Reconnecting", while the packaged app's relay (`src/main/desktop-stream.ts`)
 * carries `status: 404` and the pane lands on the missing-session notice. This
 * page measures the packaged app's behaviour, so it installs the same contract
 * `window.api.desktop.stream` exposes there: a fetch through the SAME dev proxy
 * route (`/__desktop/stream`), SSE `data:` lines out as `data` events, and a
 * refusal as `{kind: "error", status}`. Nothing else on `window.api.desktop` is
 * set, so every non-stream op still takes the browser transport.
 */
type StreamEvent = {
	kind: "data" | "error" | "end";
	data?: string;
	detail?: string;
	status?: number;
};
const w = window as unknown as { api: Record<string, unknown> };
w.api.desktop = {
	/*
	 * Present because `window.api.desktop` existing is what selects the IPC
	 * transport for EVERY op (`desktopRequest`), so a stream-only shim would leave
	 * `request` undefined. It is the dev proxy's `/__desktop` answered in the
	 * relay's `{status, body}` shape - the same bytes the browser transport reads.
	 */
	request: async (request: unknown) => {
		const response = await window.fetch("/__desktop", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(request),
		});
		const envelope = await response.json();
		return envelope && typeof envelope === "object" && "status" in envelope
			? envelope
			: { status: response.status, body: envelope };
	},
	stream: {
		subscribe: (
			args: { sessionId: string; epoch?: string; afterSeq?: number },
			onEvent: (event: StreamEvent) => void,
		) => {
			const controller = new AbortController();
			const query = new URLSearchParams({
				session: args.sessionId,
				frontend_replace: "1",
			});
			if (args.epoch) query.set("epoch", args.epoch);
			if (args.afterSeq !== undefined)
				query.set("after_seq", String(args.afterSeq));
			void (async () => {
				try {
					const response = await nativeFetchForStream(
						`/__desktop/stream?${query}`,
						{
							signal: controller.signal,
						},
					);
					if (!response.ok || !response.body) {
						onEvent({
							kind: "error",
							status: response.status,
							detail: DESKTOP_STREAM_DETAIL.refusedWithoutStatus,
						});
						return;
					}
					const reader = response.body.getReader();
					const decoder = new TextDecoder();
					let buffer = "";
					for (;;) {
						const { value, done } = await reader.read();
						if (done) break;
						buffer += decoder.decode(value, { stream: true });
						let cut = buffer.indexOf("\n\n");
						while (cut >= 0) {
							const block = buffer.slice(0, cut);
							buffer = buffer.slice(cut + 2);
							const data = block
								.split("\n")
								.filter((line) => line.startsWith("data: "))
								.map((line) => line.slice(6))
								.join("\n");
							if (data) onEvent({ kind: "data", data });
							cut = buffer.indexOf("\n\n");
						}
					}
					onEvent({ kind: "error", detail: DESKTOP_STREAM_DETAIL.ended });
				} catch {
					if (!controller.signal.aborted)
						onEvent({ kind: "error", detail: DESKTOP_STREAM_DETAIL.ended });
				}
			})();
			return {
				dispose: () => {
					controller.abort();
					onEvent({ kind: "end" });
				},
			};
		},
	},
};

type Op = {
	op: string;
	sessionId?: string;
	startedAt: number;
	settledAt: number;
};

/*
 * The page's own request log. The browser transport posts to `/__desktop`, so
 * wrapping `fetch` for that one path is how the log sees every desktop op the
 * shipped code issues without the harness supplying a transport of its own.
 */
const ops: Op[] = [];
const nativeFetch = window.fetch.bind(window);
function nativeFetchForStream(url: string, init: RequestInit) {
	return nativeFetch(url, init);
}
window.fetch = async (input, init) => {
	const url =
		typeof input === "string"
			? input
			: input instanceof URL
				? input.href
				: input.url;
	if (!url.endsWith("/__desktop") || typeof init?.body !== "string")
		return nativeFetch(input, init);
	let parsed: { op?: string; sessionId?: string } = {};
	try {
		parsed = JSON.parse(init.body);
	} catch {
		/* not an op */
	}
	const entry: Op = {
		op: String(parsed.op),
		sessionId: parsed.sessionId,
		startedAt: performance.now(),
		settledAt: 0,
	};
	ops.push(entry);
	try {
		return await nativeFetch(input, init);
	} finally {
		entry.settledAt = performance.now();
	}
};

const transcriptHasContent = () => {
	const content = document.querySelector("[data-lo-transcript-content]");
	if (!(content instanceof HTMLElement)) return false;
	const copy = content.cloneNode(true) as HTMLElement;
	copy.querySelector('[aria-label="Loading conversation"]')?.remove();
	return (copy.textContent ?? "").trim().length > 0;
};

type Run = {
	target: string;
	clickAt: number;
	committedAt: number | null;
	paintedAt: number | null;
	sendableAt: number | null;
	timedOut: boolean;
	ops: Array<{ op: string; start: number; settle: number | null }>;
};

const open = (target: string, deadlineMs = 30_000) =>
	new Promise<Run>((resolve) => {
		const row = document.querySelector<HTMLElement>(
			`[data-session-row="${target}"] [data-chat-row]`,
		);
		const run: Run = {
			target,
			clickAt: performance.now(),
			committedAt: null,
			paintedAt: null,
			sendableAt: null,
			timedOut: false,
			ops: [],
		};
		const before = ops.length;
		const store = useCanonicalSessionsStore;
		const check = () => {
			const state = store.getState();
			const t = performance.now();
			if (run.committedAt === null && state.activeSessionId === target)
				run.committedAt = t;
			if (
				run.sendableAt === null &&
				state.activeSessionId === target &&
				state.validatingSessionId !== target
			)
				run.sendableAt = t;
		};
		const unsubscribe = store.subscribe(check);
		const finish = (timedOut: boolean) => {
			unsubscribe();
			run.timedOut = timedOut;
			run.ops = ops.slice(before).map((entry) => ({
				op: entry.op,
				start: Math.round((entry.startedAt - run.clickAt) * 10) / 10,
				settle:
					entry.settledAt > 0
						? Math.round((entry.settledAt - run.clickAt) * 10) / 10
						: null,
			}));
			resolve(run);
		};
		const tick = () => {
			check();
			if (run.paintedAt === null && transcriptHasContent())
				run.paintedAt = performance.now();
			if (run.paintedAt !== null && run.sendableAt !== null)
				return finish(false);
			if (performance.now() - run.clickAt > deadlineMs) return finish(true);
			requestAnimationFrame(tick);
		};
		/*
		 * A session the sidebar does not list (a deep link to a deleted or unknown
		 * conversation - the ERROR still) is opened the way such a link is: by
		 * route, which `ChatPage`'s route effect turns into `openSession`.
		 */
		if (row) row.click();
		else window.location.hash = `#/chat/${target}`;
		requestAnimationFrame(tick);
	});

(window as unknown as { __lopOpen: unknown }).__lopOpen = {
	ready: false,
	open,
	/** Rows the sidebar has painted, by session id. */
	rows: () =>
		[...document.querySelectorAll("[data-session-row]")].map((row) =>
			row.getAttribute("data-session-row"),
		),
	/**
	 * Back to the landing, so the next click is a real move onto a fresh pane.
	 *
	 * `cold` also empties the in-memory paint cache (`paint-cache.ts`): with it,
	 * a repeat open paints this window's memory of the conversation in its first
	 * frame, which is a real and good path but not the one the operator's "open a
	 * conversation" is - so the driver defaults to cold, and every open paints
	 * from the wire.
	 */
	home: (cold = true) => {
		if (cold) __resetPaintCache();
		useCanonicalSessionsStore.getState().setActiveSession(null);
		window.location.hash = "#/chat";
	},
	state: () => {
		const state = useCanonicalSessionsStore.getState();
		return {
			active: state.activeSessionId,
			validating: state.validatingSessionId,
			painted: transcriptHasContent(),
			composerAlert:
				document
					.querySelector("textarea")
					?.closest("form")
					?.querySelector('[role="alert"]')?.textContent ?? null,
		};
	},
};

if (!window.location.hash) window.location.hash = "#/chat";

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
});

createRoot(document.getElementById("app") as HTMLElement).render(
	<QueryClientProvider client={queryClient}>
		<HashRouter>
			<div className={cn("flex h-screen overflow-hidden bg-canvas")}>
				<main className="flex min-w-0 grow flex-col overflow-hidden">
					<Routes>
						<Route path="/chat" element={<ChatPage />} />
						<Route path="/chat/:agentId" element={<ChatPage />} />
					</Routes>
				</main>
			</div>
		</HashRouter>
	</QueryClientProvider>,
);

(window as unknown as { __lopOpen: { ready: boolean } }).__lopOpen.ready = true;
