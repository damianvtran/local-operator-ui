/*
 * The scroll-shift harness: the SHIPPED chat page on a scripted owner that can
 * play a live turn, with a per-frame sampler for the transcript's scroller.
 *
 * WHAT THIS EXISTS TO MEASURE. A young conversation is short enough that its
 * first message sits at the TOP of the pane; when the assistant's answer keeps
 * streaming, the content eventually outgrows the viewport and the scroller
 * changes from "top-populated, nothing to scroll" to "bottom-anchored, the
 * leading edge pinned". The operator reports that the second phase sometimes
 * shifts the whole conversation - including its leading edge - upward. A claim
 * about what the eye sees must be measured per FRAME: `window.__shift` samples
 * `scrollTop`, `scrollHeight`, `clientHeight`, every mounted row's viewport
 * position and the scroller's own position once per animation frame, and the
 * driver reads the trace back.
 *
 * WHAT IS REAL HERE. `ChatPage` and everything under it: the store, the stream
 * hook, the transcript reducer, `CanonicalTranscript`, `useScrollPaging`, the
 * app stylesheet, and the browser's own scroll anchoring. What is scripted is
 * the owner (see `scroll-shift-bridge.ts`) and nothing on this side of
 * `window.api.desktop`.
 *
 * WHAT IS NOT. A Vite dev bundle in a private headless Chrome, not the packaged
 * app: no Electron IPC hop, no minified bundle. Stated so no number is read as
 * more than it is.
 */

import "./scroll-shift-evidence.css";
import "@renderer/assets/fonts/fonts.css";
import { ChatPage } from "@features/chat/components/chat-page";
import { ChatLayout } from "@shared/components/common/chat-layout";
import { SidebarNavigation } from "@shared/components/navigation/sidebar-navigation";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import {
	type LiveTurnScript,
	installScrollShiftOwner,
} from "./scroll-shift-bridge";
import type { TranscriptStep } from "./session-switch-bridge";

const SESSION_ID = "5c011a33ca11";
const TITLE = "Scroll shift fixture";

/** One row's metrics as the sampler reads them. */
type Sample = {
	/** `performance.now()` at the frame. */
	t: number;
	/** The scroller's own top edge in the window, and its scroll metrics. */
	sy: number;
	st: number;
	sh: number;
	ch: number;
	/** Every mounted row: backend id, top edge relative to the scroller's top. */
	rows: Array<[string, number]>;
	/** The last row's bottom edge relative to the scroller's top (leading edge). */
	lead: number | null;
	/** The content column's box relative to the scroller's top. */
	ct: number | null;
	cb: number | null;
	/** The working line's box relative to the scroller's top, when it is up. */
	wl: [number, number] | null;
	/** The composer band's top edge in the window. */
	band: number | null;
};

type ShiftProbe = {
	ready: boolean;
	samples: Sample[];
	marks: Array<{ name: string; t: number; i: number }>;
	start: () => void;
	stop: () => void;
	mark: (name: string) => void;
	playTurn: (script: LiveTurnScript) => Promise<void>;
	emitted: unknown;
	/** Drive the scroller's own offset, for probes; the sampler reads it back. */
	setScroll: (value: number) => void;
};

/*
 * THE FIXTURE'S OWN SHAPE, from the URL, so one page serves every arm: how many
 * messages the conversation already holds and how long each one is.
 */
const params = new URLSearchParams(window.location.search);
const ROWS = Math.max(1, Number(params.get("rows") ?? "3"));
const WORDS = Math.max(1, Number(params.get("words") ?? "12"));

const WORDS_POOL =
	"the transcript holds every durable row this conversation has written and the reader scrolls back through it while the anchor stays exactly where they left it".split(
		" ",
	);
const prose = (n: number, seed: number) =>
	Array.from(
		{ length: n },
		(_, i) => WORDS_POOL[(seed * 7 + i * 3) % WORDS_POOL.length],
	).join(" ");

const steps: TranscriptStep[] = Array.from({ length: ROWS }, (_, i) =>
	i % 2 === 0
		? { kind: "user" as const, text: `[row ${i}] ${prose(WORDS, i)}` }
		: { kind: "assistant" as const, text: `[row ${i}] ${prose(WORDS, i)}` },
);

const owner = installScrollShiftOwner({
	sessions: [{ id: SESSION_ID, name: TITLE, mtime: Date.now() / 1000 }],
	stepsBySession: { [SESSION_ID]: steps },
});

// ------------------------------------------------------------ the sampler

const samples: Sample[] = [];
const marks: Array<{ name: string; t: number; i: number }> = [];
let sampling = false;

const round = (n: number) => Math.round(n * 10) / 10;

const sampleOnce = () => {
	const scroller = document.querySelector<HTMLElement>(
		"[data-lo-canonical-transcript]",
	);
	if (!scroller) return;
	const sr = scroller.getBoundingClientRect();
	const rel = (el: Element | null): [number, number] | null =>
		el
			? (() => {
					const r = el.getBoundingClientRect();
					return [round(r.top - sr.top), round(r.bottom - sr.top)];
				})()
			: null;
	const rows: Array<[string, number]> = [];
	for (const row of scroller.querySelectorAll<HTMLElement>(
		"[data-record-id]",
	)) {
		const id = row.dataset.recordId;
		if (!id) continue;
		rows.push([id, round(row.getBoundingClientRect().top - sr.top)]);
	}
	const last = rows.at(-1);
	const lastEl = last
		? scroller.querySelector<HTMLElement>(
				`[data-record-id="${CSS.escape(last[0])}"]`,
			)
		: null;
	const content = scroller.querySelector<HTMLElement>(
		"[data-lo-transcript-content]",
	);
	const band = document.querySelector<HTMLElement>("[data-lo-composer-band]");
	samples.push({
		t: round(performance.now()),
		sy: round(sr.top),
		st: scroller.scrollTop,
		sh: scroller.scrollHeight,
		ch: scroller.clientHeight,
		rows,
		lead: lastEl ? round(lastEl.getBoundingClientRect().bottom - sr.top) : null,
		ct: content ? round(content.getBoundingClientRect().top - sr.top) : null,
		cb: content ? round(content.getBoundingClientRect().bottom - sr.top) : null,
		wl: rel(scroller.querySelector("[data-lo-working-line]")),
		band: band ? round(band.getBoundingClientRect().top) : null,
	});
};

const tick = () => {
	if (!sampling) return;
	sampleOnce();
	requestAnimationFrame(tick);
};

const probe: ShiftProbe = {
	ready: false,
	samples,
	marks,
	start: () => {
		if (sampling) return;
		sampling = true;
		requestAnimationFrame(tick);
	},
	stop: () => {
		sampling = false;
	},
	mark: (name: string) => {
		marks.push({ name, t: round(performance.now()), i: samples.length });
	},
	playTurn: (script: LiveTurnScript) => owner.play(SESSION_ID, script),
	emitted: owner.emitted,
	setScroll: (value: number) => {
		const el = document.querySelector<HTMLElement>(
			"[data-lo-canonical-transcript]",
		);
		if (el) el.scrollTop = value;
	},
};
(window as unknown as { __shift: ShiftProbe }).__shift = probe;

// ---------------------------------------------------------------- the page

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
});

const ShellFrame = ({ children }: { children: React.ReactNode }) => (
	<div className={cn("flex h-screen overflow-hidden bg-canvas")}>
		<ChatLayout
			sidebar={<SidebarNavigation />}
			content={
				<main className="flex min-w-0 grow flex-col overflow-hidden">
					{children}
				</main>
			}
		/>
	</div>
);

if (!window.location.hash) window.location.hash = "#/chat";

createRoot(document.getElementById("app") as HTMLElement).render(
	<QueryClientProvider client={queryClient}>
		<HashRouter>
			<ShellFrame>
				<Routes>
					<Route path="/chat" element={<ChatPage />} />
					<Route path="/chat/:agentId" element={<ChatPage />} />
				</Routes>
			</ShellFrame>
		</HashRouter>
	</QueryClientProvider>,
);

/*
 * The boot is "the app is open on a conversation", not a measured gesture: the
 * pane opens through the store's own action (the route sync follows it), and
 * `ready` waits until the whole fixture is on screen - every row painted, so
 * the conversation is genuinely the short, top-populated state the arms start
 * from.
 */
const bootUntilPainted = async () => {
	const deadline = performance.now() + 15_000;
	await useCanonicalSessionsStore.getState().openSession(SESSION_ID);
	for (;;) {
		if (performance.now() > deadline) {
			console.error("[scroll-shift] the fixture never painted");
			return;
		}
		const painted = document.querySelectorAll(
			"[data-lo-canonical-transcript] [data-record-id]",
		).length;
		if (painted >= steps.length) break;
		await new Promise((r) => setTimeout(r, 50));
	}
	probe.ready = true;
};
void bootUntilPainted();
