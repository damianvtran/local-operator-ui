/**
 * Harness page for the child reader's scroll behaviour.
 *
 * See `child-reader-scroll-evidence.html` for why the page exists and
 * `child-reader-scroll-evidence.vite.mjs` for where the scripted child lives.
 * This module mounts the SHIPPED `RunChildReader`, in the pane the app mounts
 * it in, with the four things the pane supplies that a harness must stand in
 * for: a row, a session id, a pulse counter and a clock.
 *
 * NOTHING about the reader is stubbed. `previewPage` is deliberately NOT passed
 * — supplying it makes the reader read no page at all (that seam nulls the
 * hook's `childId`), which is the opposite of what is measured here. The pane
 * therefore travels the shipped path: `useChildTranscript`'s tail read and its
 * pulse cadence, `desktopResult`, `desktopRequest`'s `/__desktop` branch, and
 * the route's envelope back.
 *
 * THE PULSE IS THE DRIVER'S. In the app the counter is bumped by the canonical
 * stream when the child relays `subagent_progress`; here the driver bumps it
 * through `window.__childScroll.pulse()`, so an arrival is a real tail read of a
 * page that really changed rather than a push into the component's state.
 */
import { RunChildReader } from "@features/chat/components/run-details/run-child-reader";
import type { SubagentRow } from "@features/chat/components/run-details/run-detail-model";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./child-reader-scroll-evidence.css";

/** The child this page reads, and its parent conversation. */
const CHILD_SESSION_ID = "abcdefabcdef";
const SESSION_ID = "1234567890ab";
/** The pane's own width — the value the run panel draws the reader at. */
const PANE_WIDTH = 420;
/**
 * The instant this run pretends it is, for the reader's one clock figure.
 *
 * The reader's elapsed label ticks against the REAL clock (`useChildRowClock`
 * anchors its tick on the instants the pane hands it and then advances them from
 * now), so a row whose `startSeconds` is a fixed epoch in the past renders an
 * elapsed label of months — a frame a reviewer would rightly read as a fixture
 * defect, and the one number in the pane that would then be a lie. So both ends
 * of the interval are taken from this run's own instant: the child started 469
 * seconds before it, which is the `7m49s` the pane draws.
 */
const MEASURED_AT_MS = Date.now();
const STARTED_SECONDS_AGO = 469;

/**
 * The row the pane would derive for this child, built directly.
 *
 * `deriveRunDetails` assembles this from the session's raw wire rows and the
 * reader reads only these fields. Building it here rather than running the
 * deriver keeps the harness's synthetic input to ONE object whose every field
 * is in this file. A row is also the one input this harness cannot get from the
 * route it does use: the roster is the PARENT's, and the parent has no backend
 * in this rig.
 */
const runningRow: SubagentRow = {
	id: "job-child-0001",
	label: "Reconcile the March invoices against the ledger",
	role: "reviewer",
	status: "running",
	elapsedLabel: "7m49s",
	startSeconds: Math.round(MEASURED_AT_MS / 1000) - STARTED_SECONDS_AGO,
	settledSeconds: null,
	contextLabel: "46%",
	costLabel: "$0.31",
	activity: "checking the ledger export",
	errorLine: null,
	errorText: null,
	resultText: null,
	childSessionId: CHILD_SESSION_ID,
	parentJobId: null,
	childCount: 0,
	modelLabel: "claude-sonnet-4-5",
	brief:
		"Reconcile the March invoices against the ledger and tell me which ones are actually outstanding.",
	launchMessageId: "entry-launch",
	launchPrompts: {
		"entry-launch":
			"Reconcile the March invoices against the ledger and tell me which ones are actually outstanding.",
	},
	stateWord: "running",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Everything the driver reads about the pane, measured from the DOM.
 *
 * The two facts the operator's complaint is made of are HERE rather than
 * inferred: `fromBottom` is the reader's distance from the tail (the scroller
 * is `column-reverse`, so its bottom edge is `scrollTop === 0`), and
 * `newestVisible` answers "are the rows that just arrived on screen" directly.
 */
function reading() {
	const scroller = document.querySelector<HTMLElement>(
		"[data-lo-canonical-transcript]",
	);
	if (!scroller) return null;
	const box = scroller.getBoundingClientRect();
	const rows = Array.from(
		scroller.querySelectorAll<HTMLElement>("[data-record-id]"),
	);
	let anchorId: string | null = null;
	let anchorOffset: number | null = null;
	for (const row of rows) {
		const rect = row.getBoundingClientRect();
		if (rect.bottom > box.top) {
			anchorId = row.dataset.recordId ?? null;
			/*
			 * The anchored row's offset from the viewport's top edge — the number that
			 * describes what the READER sees. `scrollTop` alone cannot answer it: the
			 * extent grows under a pinned reader, so a constant `scrollTop` and a
			 * constant viewport are different claims (`scroll-paging.ts` says so on
			 * `travelledPx`). Sampled exactly as `use-scroll-paging.ts`'s
			 * `sampleAnchor` samples it, so the two are comparable.
			 */
			anchorOffset = rect.top - box.top;
			break;
		}
	}
	const newest = rows.at(-1) ?? null;
	const newestRect = newest?.getBoundingClientRect() ?? null;
	const visible = rows.filter((row) => {
		const rect = row.getBoundingClientRect();
		return rect.top < box.bottom && rect.bottom > box.top;
	});
	/*
	 * The affordance, by its own accessible name. `visible` and `hitTestable`
	 * are read from the computed style rather than from the prop, because the
	 * trap this component documents is a hidden control that is still a real
	 * hit target (`scroll-to-bottom-button.tsx`).
	 */
	const button = document.querySelector<HTMLElement>(
		'[aria-label="Scroll to bottom"]',
	);
	const wrap = button?.parentElement ?? null;
	return {
		scrollTop: scroller.scrollTop,
		fromBottom: Math.abs(scroller.scrollTop),
		extent: scroller.scrollHeight,
		client: scroller.clientHeight,
		canScroll: scroller.scrollHeight > scroller.clientHeight,
		paintedRows: rows.length,
		anchorId,
		anchorOffset,
		newestId: newest?.dataset.recordId ?? null,
		/*
		 * How many pixels of the newest row fall below the viewport's bottom edge.
		 *
		 * This, not `newestVisible`, is the operator's complaint stated as a number: a
		 * row that landed below the fold reads `newestVisible: false` only when it is
		 * ENTIRELY outside, so a batch half-off-screen would pass that test. A reader
		 * who is following the tail has a cut of zero (or of their own drift, if they
		 * are a few pixels off the origin); a reader who has been left behind has a cut
		 * of the whole arrival.
		 */
		newestCutPx:
			newestRect === null ? null : Math.max(0, newestRect.bottom - box.bottom),
		newestVisible:
			newestRect !== null &&
			newestRect.top < box.bottom + 1 &&
			newestRect.bottom > box.top - 1,
		visibleRows: visible.length,
		bottomId: visible.at(-1)?.dataset.recordId ?? null,
		button: button
			? {
					visible: wrap ? getComputedStyle(wrap).opacity !== "0" : false,
					hitTestable: getComputedStyle(button).pointerEvents !== "none",
					label: button.getAttribute("aria-label"),
				}
			: null,
	};
}

async function waitFor(check: () => boolean, timeoutMs: number) {
	const until = Date.now() + timeoutMs;
	while (Date.now() < until) {
		if (check()) return true;
		await sleep(50);
	}
	return false;
}

const App = () => {
	const [pulse, setPulse] = useState(0);
	const [live, setLive] = useState(true);
	/*
	 * The reader is keyed by this, which is how `reset()` gives each theme the same
	 * starting state: the child's scripted transcript goes back to its launch turn
	 * on the server, and remounting is what makes the pane read it from scratch
	 * instead of keeping the rows the previous theme left on screen.
	 */
	const [mount, setMount] = useState(0);

	useEffect(() => {
		(window as unknown as { __childScroll?: unknown }).__childScroll = {
			/**
			 * One tool batch lands on the child and the child beats.
			 *
			 * The order is the wire's: the batch is written first, then
			 * `subagent_progress` bumps this pane's counter. The wait is on
			 * `paintedRows`, which is the DOM, so the driver never samples a frame
			 * the reader has not committed.
			 */
			async batch(n = 1) {
				for (let i = 0; i < n; i++) {
					const response = await fetch("/__child/batch", { method: "POST" });
					const { rows } = (await response.json()) as { rows: number };
					setPulse((value) => value + 1);
					await waitFor(() => (reading()?.paintedRows ?? 0) >= rows, 8000);
				}
				return reading();
			},
			/** A beat with nothing new on disk: the pump must move nothing. */
			async pulseOnly() {
				setPulse((value) => value + 1);
				await sleep(1600);
				return reading();
			},
			/** The child settles, which is the state with no cadence at all. */
			async settle() {
				setLive(false);
				await sleep(150);
				return reading();
			},
			/** Back to the launch turn alone, then a fresh mount. */
			async reset() {
				await fetch("/__child/reset", { method: "POST" });
				setPulse(0);
				setLive(true);
				setMount((value) => value + 1);
				await sleep(900);
				return reading();
			},
			measure: reading,
			/**
			 * Place the offset a few pixels off the tail — the state the cliff needs.
			 *
			 * `column-reverse` puts the newest row at `scrollTop === 0`, and the browser
			 * pins a reader only while the offset is EXACTLY there. A few pixels of
			 * trackpad momentum, a bounce or a late image leaves the offset just off the
			 * origin, and this step reproduces that state.
			 *
			 * The write is deliberate and simulates no gesture: this step asks the paging
			 * policy for nothing, it places the viewport where a real reader is routinely
			 * left. The claim under test is that the re-assert treats that reader the same
			 * as one whose offset is exactly at the origin — which is why the offset is
			 * set here rather than scrolled to, a small wheel delta being subject to the
			 * browser's own snap.
			 */
			drift(px: number) {
				const el = document.querySelector<HTMLElement>(
					"[data-lo-canonical-transcript]",
				);
				if (!el) return null;
				el.scrollTop = -px;
				return reading();
			},
			/**
			 * The scroll-anchoring-relevant computed styles, and the ancestor chain.
			 *
			 * A diagnostic, not a claim: the rig reproduces the operator's state but not
			 * every symptom, and the first thing to rule out is that something in this
			 * tree turns anchoring off (`overflow-anchor: none` on any ancestor of the
			 * rows suppresses it for the whole scroller).
			 */
			styles() {
				const scroller = document.querySelector<HTMLElement>(
					"[data-lo-canonical-transcript]",
				);
				if (!scroller) return null;
				const describe = (el: HTMLElement) => ({
					selector:
						el.tagName.toLowerCase() +
						(el.dataset.recordId ? `[${el.dataset.recordId}]` : ""),
					overflowAnchor: getComputedStyle(el).overflowAnchor,
					overflow: getComputedStyle(el).overflow,
					display: getComputedStyle(el).display,
					flexDirection: getComputedStyle(el).flexDirection,
					willChange: getComputedStyle(el).willChange,
					position: getComputedStyle(el).position,
				});
				const chain: unknown[] = [];
				for (let el: HTMLElement | null = scroller; el; el = el.parentElement)
					chain.push(describe(el));
				const content = scroller.querySelector<HTMLElement>(
					"[data-lo-transcript-content]",
				);
				return {
					chain,
					content: content ? describe(content) : null,
					children: content
						? Array.from(content.children as HTMLCollectionOf<HTMLElement>)
								.slice(0, 3)
								.map(describe)
						: [],
				};
			},
			/** The scroller's box, for a real wheel event's coordinates. */
			scrollerBox() {
				const scroller = document.querySelector<HTMLElement>(
					"[data-lo-canonical-transcript]",
				);
				if (!scroller) return null;
				const box = scroller.getBoundingClientRect();
				return {
					x: box.left + box.width / 2,
					y: box.top + box.height / 2,
					width: box.width,
					height: box.height,
				};
			},
		};
	}, []);

	return (
		<div className="flex h-full w-full items-start justify-center bg-sunken p-4">
			<div
				data-child-pane=""
				className="flex flex-col overflow-hidden rounded-lg border-hairline border bg-canvas"
				style={{ width: PANE_WIDTH, height: 820 }}
			>
				<RunChildReader
					key={mount}
					row={runningRow}
					childRows={[]}
					childrenOpenable
					onOpenChild={() => {}}
					sessionId={SESSION_ID}
					pulse={pulse}
					live={live}
					attachmentScope={{ sessionId: SESSION_ID, childId: CHILD_SESSION_ID }}
					measuredAtMs={MEASURED_AT_MS}
					measuredAtRealMs={MEASURED_AT_MS}
					onUnopenable={() => {}}
					paneWidth={PANE_WIDTH}
				/>
			</div>
		</div>
	);
};

/*
 * The palette comes from the query so one run can frame both brand themes. Set
 * before the first render rather than inside it: the theme is a document
 * attribute, and a frame captured between two commits would otherwise carry the
 * wrong ground (`diff-body-evidence.tsx` sets its own the same way).
 */
const theme = new URLSearchParams(window.location.search).get("theme");
if (theme) document.documentElement.dataset.theme = theme;
document.documentElement.style.height = "100%";
document.body.style.height = "100%";

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
requestAnimationFrame(() =>
	requestAnimationFrame(() => {
		(window as unknown as { __childScrollReady?: boolean }).__childScrollReady =
			true;
	}),
);
