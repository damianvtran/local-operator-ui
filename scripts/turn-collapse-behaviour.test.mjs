import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";

/*
 * THE TURN COLLAPSE'S BEHAVIOURS, driven through the SHIPPED transcript.
 *
 * `turn-collapse-model.test.mjs` asserts the plan's arithmetic (what collapses,
 * what the bar says, which rows hide). This file asserts what only a mount can:
 * that a completed run ARRIVES collapsed and its hidden rows are really
 * unmounted; that the reader's press opens it and puts it back; that the
 * expansion survives a remount (the property the per-session store exists for)
 * and follows the CONVERSATION rather than the component; that the failure
 * failure tally never renders and the failed row stays one press away; and
 * that a live run, and a run the window has cut, render exactly as they did
 * before the feature.
 *
 * WHY A MOUNT AND NOT A FRAME. A frame says what the collapsed and expanded
 * states look like; it cannot say that the collapsed state unmounts the rows
 * (`Disclosure` renders `isOpen && children`), that the bar keeps the reader's
 * expansion across a remount, or that the failure press opens three layers in
 * order. jsdom has no layout engine, so nothing here is geometry evidence: the
 * frames in `docs/evidence/chat-turn-collapse/` carry the pixels and this file
 * carries the transitions. The harness is `turn-timestamp.test.mjs`'s (it mounts
 * the same component, for the same reason), with one difference: rAF is a QUEUE
 * this file drains, because the failure jump is a chain of frames and a no-op
 * rAF would assert half of it.
 */
const bootstrapDOM = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = bootstrapDOM;
const originals = new Map();
/** The frames the app queued but the test has not run yet. */
const rafQueue = [];
const scrollCalls = [];
const shims = {
	window,
	document: window.document,
	HTMLElement: window.HTMLElement,
	Node: window.Node,
	Element: window.Element,
	SVGElement: window.SVGElement,
	MouseEvent: window.MouseEvent,
	KeyboardEvent: window.KeyboardEvent,
	FocusEvent: window.FocusEvent,
	Event: window.Event,
	CustomEvent: window.CustomEvent,
	localStorage: window.localStorage,
	navigator: window.navigator,
	getComputedStyle: window.getComputedStyle.bind(window),
	requestAnimationFrame: (callback) => {
		rafQueue.push(callback);
		return rafQueue.length;
	},
	cancelAnimationFrame: () => {},
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	matchMedia: (query) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
		dispatchEvent: () => false,
	}),
};
for (const [key, value] of Object.entries(shims)) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
window.matchMedia ??= shims.matchMedia;
/*
 * THE QUEUE ON THE JSDOM WINDOW AS WELL AS ON `globalThis`. The two are not the
 * same object here, and which one a caller reaches for depends on how it was
 * written: the transcript reads the global, while `failed-row-jump.ts` calls
 * `window.requestAnimationFrame` explicitly — and jsdom's own rAF (real, via
 * `pretendToBeVisual`) never fires inside a synchronous test. Without this the
 * failure jump's chain is queued to a frame loop that does not run.
 */
window.requestAnimationFrame = shims.requestAnimationFrame;
window.cancelAnimationFrame = shims.cancelAnimationFrame;
// jsdom implements neither; the failure jump uses `scrollIntoView` and the
// disclosure section uses `ResizeObserver` (`shims` above).
window.Element.prototype.scrollIntoView = function scrollIntoView(options) {
	scrollCalls.push({ element: this, options });
};
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
after(() => {
	bootstrapDOM.window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

const bundle = await build({
	stdin: {
		contents: [
			'export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";',
			'export { __resetTurnCollapseOpen, writeRunExpanded, expandedRunsOf, forgetTurnCollapseOpen, __turnCollapseOpenStats } from "./src/renderer/src/shared/store/turn-collapse-open";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
});
const bundlePath = new URL(
	`./_turn-collapse-behaviour-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	CanonicalTranscript,
	__resetTurnCollapseOpen,
	writeRunExpanded,
	expandedRunsOf,
	forgetTurnCollapseOpen,
	__turnCollapseOpenStats,
} = await import(bundlePath.href);
await unlink(bundlePath);

/* ------------------------------- fixtures ------------------------------- */

const TS = 1_000_000;

const userRecord = (id, over = {}) => ({
	kind: "user",
	id,
	ts: TS,
	text: "Which invoices were late last month?",
	images: [],
	...over,
});
const toolRecord = (id, over = {}) => ({
	kind: "tool",
	id,
	ts: TS,
	toolCallId: id,
	toolName: "bash",
	intent: null,
	args: { command: "pnpm test:desktop" },
	phase: "done",
	argumentBytes: 20,
	output: "tests 40\npass 40\n",
	isError: false,
	durationS: 0.4,
	startedAt: null,
	endedAt: null,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
	neverSent: false,
	notRunReason: null,
	...over,
});
const answerRecord = (id, over = {}) => ({
	kind: "assistant",
	id,
	ts: TS,
	text: "Four invoices were late: 1042, 1088, 1103 and 1177.",
	streaming: false,
	stopReason: null,
	error: false,
	...over,
});
/** A peer message receipt: collapsed with the work since 2026-09-29 (issue #5). */
const peerRecord = (id, over = {}) => ({
	kind: "peer",
	id,
	ts: TS + 2_000,
	body: "window-collect: 140 records staged for the next batch.",
	sender: {
		pid: "",
		conversationName: "ingest-rail",
		cwd: "",
		sessionId: "",
		modelLabel: "",
	},
	...over,
});
/** A wake delivery receipt, the same narrowing. */
const wakeRecord = (id, over = {}) => ({
	kind: "wake",
	id,
	ts: TS + 4_000,
	text: "(alarm) Scheduled wake w-9\n\nCollect the staged records.",
	...over,
});
/** A statement the collapse pins in place (a completion marker). */
const noticeRecord = (id, over = {}) => ({
	kind: "notice",
	id,
	ts: TS,
	text: "Interrupted",
	level: "warning",
	complete: true,
	...over,
});

const transcriptOf = (records) => ({
	records,
	index: new Map(records.map((record, position) => [record.id, position])),
	generation: 1,
	oldestId: null,
	hasMore: false,
	argsByCall: new Map(),
});

/* ------------------------------ the mount ------------------------------- */

const mount = async (t, records, over = {}) => {
	const mounted = {};
	t.after(async () => {
		await act(async () => {
			mounted.root?.unmount();
		});
		mounted.container?.remove();
	});
	mounted.container = document.createElement("div");
	document.body.appendChild(mounted.container);
	const render = async (next, nextOver = over) => {
		await act(async () => {
			mounted.root.render(
				h(CanonicalTranscript, {
					frontend: nextOver.frontend ?? null,
					transcript: {
						...transcriptOf(next),
						hasMore: nextOver.hasMore ?? false,
					},
					gate: nextOver.gate ?? null,
					waiting: nextOver.waiting ?? false,
					loadingOlder: false,
					onLoadOlder: nextOver.onLoadOlder ?? (async () => true),
					containerRef: { current: mounted.container },
					isSmallView: false,
					status: "live",
					failure: null,
					awaitingHydration: false,
					onReconnect: () => {},
				}),
			);
		});
	};
	await act(async () => {
		mounted.root = createRoot(mounted.container);
	});
	await render(records);
	/* Re-render is part of the harness: the parked-turn test drives a gate on
	 * and off the same transcript (D3's call-site composition). */
	mounted.render = render;
	return mounted;
};

/** The bar, when one rendered. */
const bar = (mounted) => mounted.container.querySelector("[data-turn-summary]");
/** A rendered ROW with this id — the bar carries one too, so rows are qualified. */
const rowBox = (mounted, id) =>
	mounted.container.querySelector(`[data-record-id="${id}"][data-record-kind]`);
const barTrigger = (mounted) => bar(mounted)?.querySelector("button");
const click = async (element) => {
	assert.ok(element, "the control exists");
	await act(async () => {
		element.dispatchEvent(
			new window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
};
/** Run the queued animation frames, inside `act` so the commits they trigger settle. */
const flushFrames = async () => {
	for (let depth = 0; depth < 4 && rafQueue.length > 0; depth += 1) {
		const queued = rafQueue.splice(0);
		await act(async () => {
			for (const callback of queued) callback(0);
		});
	}
};

test("a completed run arrives collapsed: one bar, the work unmounted, the answer in place", async (t) => {
	__resetTurnCollapseOpen();
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000, endedAt: TS + 2_000 }),
		answerRecord("answer:1", { ts: TS + 3_000, settledAt: TS + 3_000 }),
	]);
	const summary = bar(mounted);
	assert.ok(summary, "the completed run carries a bar on arrival");
	assert.equal(
		summary.getAttribute("data-run-ids"),
		"user:1 tool:1 answer:1",
		"every row of the run is addressable through the bar",
	);
	assert.equal(
		summary.getAttribute("data-record-id"),
		"tool:1",
		"the bar stands in the FIRST hidden row's slot and carries its identity",
	);
	assert.match(
		summary.textContent,
		/Took 3s/,
		"opening user row to the answer",
	);
	assert.match(summary.textContent, /1 action/);
	assert.equal(
		rowBox(mounted, "tool:1"),
		null,
		"the hidden row is unmounted, not merely hidden",
	);
	assert.ok(rowBox(mounted, "user:1"), "the opening message stays put");
	assert.ok(rowBox(mounted, "answer:1"), "and so does the answer");
	assert.doesNotMatch(
		mounted.container.textContent,
		/Worked/,
		"the foot line yields to the bar: one summary per turn",
	);
	const stamps = mounted.container.querySelectorAll("time");
	assert.equal(stamps.length, 1, "one stamp for the turn");
	assert.ok(
		summary.contains(stamps[0]),
		"and it lives on the bar rather than on the answer it closed",
	);
});

test("the press opens the run in place, and puts it back", async (t) => {
	__resetTurnCollapseOpen();
	/*
	 * TWO calls, on purpose: below the fold's own threshold, so the bar's
	 * children are plain rows and the toggle alone decides whether they are in
	 * the DOM. (With three or more, an additional gate stands between the bar and
	 * the rows — the inner fold — and that layer is what the failure-control test
	 * below walks through.)
	 */
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1"),
		toolRecord("tool:2", { args: { command: "git status --short" } }),
		answerRecord("answer:1"),
	]);
	assert.equal(rowBox(mounted, "tool:1"), null, "collapsed by default");
	await click(barTrigger(mounted));
	assert.ok(rowBox(mounted, "tool:1"), "the press reveals the work");
	assert.ok(rowBox(mounted, "tool:2"), "all of it");
	assert.ok(bar(mounted), "the bar stays as the toggle");
	assert.doesNotMatch(
		mounted.container.textContent,
		/Worked/,
		"and the foot stays suppressed while open: the bar is still the summary",
	);
	await click(barTrigger(mounted));
	assert.equal(
		rowBox(mounted, "tool:1"),
		null,
		"the second press puts it back",
	);
});

test("the expansion follows the conversation, survives a remount, and resets with the store", async (t) => {
	__resetTurnCollapseOpen();
	const records = [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000, endedAt: TS + 1_500 }),
		answerRecord("answer:1", { ts: TS + 2_000 }),
	];
	const first = await mount(t, records, { frontend: { session_id: "chat-a" } });
	await click(barTrigger(first));
	assert.ok(rowBox(first, "tool:1"), "the reader opened it");
	await act(async () => {
		first.root.unmount();
	});
	first.container.remove();

	const remounted = await mount(t, records, {
		frontend: { session_id: "chat-a" },
	});
	assert.ok(
		rowBox(remounted, "tool:1"),
		"a remount (the window's walk) re-reads the reader's expansion",
	);
	await act(async () => {
		remounted.root.unmount();
	});
	remounted.container.remove();

	const other = await mount(t, records, { frontend: { session_id: "chat-b" } });
	assert.equal(
		rowBox(other, "tool:1"),
		null,
		"another conversation arrives collapsed: the store is keyed by conversation",
	);

	__resetTurnCollapseOpen();
	const fresh = await mount(t, records, { frontend: { session_id: "chat-a" } });
	assert.equal(
		rowBox(fresh, "tool:1"),
		null,
		"and a reload (a fresh store) returns to the shipped default",
	);
});

test("no failure tally renders: the bar stands in for the failing run, the row is one press away", async (t) => {
	/*
	 * OPERATOR ISSUE #6 (2026-09-29): the failure tally is retired from every
	 * summary - "a completed action's failure count is noise at a glance; if a
	 * user needs the failures they can review them by expanding". This pins
	 * both halves: the bar carries no clause and no control, and the red row
	 * is what still states the failure, behind the press.
	 */
	__resetTurnCollapseOpen();
	const mounted = await mount(t, [
		userRecord("user:1"),
		/*
		 * ONE call, so the span renders as a plain row rather than an inner
		 * fold: with the failure control gone there is no jump to open a fold
		 * on the reader's behalf, and the assertion below is about the row
		 * itself being the surface that keeps stating the failure.
		 */
		toolRecord("tool:1", {
			isError: true,
			output: "Error: command failed with exit code 1",
		}),
		answerRecord("answer:1"),
	]);
	const summary = bar(mounted);
	assert.ok(summary, "the run collapsed");
	assert.doesNotMatch(
		summary.textContent ?? "",
		/failed/i,
		"the tally is gone from the bar",
	);
	assert.equal(
		summary.querySelector("[data-failed-clause]"),
		null,
		"and with it the failure control",
	);
	await click(barTrigger(mounted));
	await flushFrames();
	const failedRow = rowBox(mounted, "tool:1");
	assert.ok(failedRow, "the failed row mounts on the press");
	assert.match(
		failedRow.textContent ?? "",
		/failed/i,
		"the row itself still carries the state",
	);
});

test("a live run renders as today, and the finished run above it still condenses", async (t) => {
	__resetTurnCollapseOpen();
	const mounted = await mount(
		t,
		[
			userRecord("user:1"),
			toolRecord("tool:1", { ts: TS + 1_000, endedAt: TS + 2_000 }),
			answerRecord("answer:1", { ts: TS + 3_000, settledAt: TS + 3_000 }),
			userRecord("user:2", { ts: TS + 4_000 }),
			toolRecord("tool:2", { ts: TS + 5_000 }),
		],
		{ waiting: true },
	);
	assert.ok(bar(mounted), "the finished turn above condenses");
	assert.equal(
		bar(mounted).getAttribute("data-run-ids"),
		"user:1 tool:1 answer:1",
	);
	assert.equal(
		rowBox(mounted, "tool:2"),
		[...mounted.container.querySelectorAll("[data-record-kind]")].find(
			(node) => node.getAttribute("data-record-id") === "tool:2",
		),
		"the running turn keeps every row: nothing condenses while it is in flight",
	);
	assert.equal(
		mounted.container.querySelectorAll("[data-turn-summary]").length,
		1,
		"and it has no bar of its own",
	);
});

test("a run the window edge cut only at its opening row aligns and condenses on open", async (t) => {
	__resetTurnCollapseOpen();
	/*
	 * 61 rows, one over the mount window: the raw leading edge would cut the
	 * first row, the opening user message. THE ON-LOAD FIX (operator report,
	 * 2026-09-28): the window's top edge snaps onto the run boundary it lands
	 * in, so the opening row is inside the list the plan sees, the run is whole,
	 * and it condenses on the first paint — the reader no longer has to scroll
	 * the head in before a bar appears.
	 */
	const records = [
		userRecord("user:1"),
		...Array.from({ length: 59 }, (_, index) =>
			toolRecord(`tool:${index + 1}`, { ts: TS + 1_000 + index }),
		),
		answerRecord("answer:1", { ts: TS + 70_000, settledAt: TS + 70_000 }),
	];
	const mounted = await mount(t, records);
	assert.notEqual(
		bar(mounted),
		null,
		"the aligned window holds the opening row, so the run condenses",
	);
	assert.doesNotMatch(
		mounted.container.textContent,
		/Worked/,
		"the bar replaces the foot line, as on any completed run",
	);
});

test("the snap's fetch half runs when the head is cut off, and is bounded", async (t) => {
	/*
	 * AGENT REVIEW ROUND 1, F2: the window snap's LOAD half — the bounded
	 * follow-up fetch (`ALIGN_FETCH_MAX` pages) — had no test at any level.
	 * This drives the real effect against a row list that starts mid-run (the
	 * head is not loaded at all, so no snap can align), and against the
	 * control: a list whose enclosing run opens with its own user row asks
	 * for nothing. The bound is asserted AFTER further renders, because the
	 * bound is the property — the harness's own settle can account for the
	 * first two asks on its own.
	 */
	__resetTurnCollapseOpen();
	let fetches = 0;
	const load = async () => {
		fetches += 1;
		return true;
	};
	const records = Array.from({ length: 420 }, (_, index) =>
		toolRecord(`tool:${index + 1}`, { ts: TS + 1_000 + index }),
	);
	const mounted = await mount(t, records, {
		hasMore: true,
		onLoadOlder: load,
	});
	await flushFrames();
	const afterMount = fetches;
	await mounted.render(records, { hasMore: true, onLoadOlder: load });
	await flushFrames();
	const afterRender1 = fetches;
	await mounted.render(records, { hasMore: true, onLoadOlder: load });
	await flushFrames();
	const afterRender2 = fetches;
	assert.ok(afterMount >= 1, "the cut head is asked for");
	/*
	 * AGENT REVIEW ROUND 2, MINOR-2: an "asks stop" equality could not see a
	 * dropped bound (a mutated run counted 5 -> 7 -> 7 and passed). The DELTA
	 * is the property a dropped bound breaks — each re-render may add at most
	 * one align ask — while the bound's exact arithmetic stays in the model
	 * suite, where a strict-mode remount cannot muddle the reading.
	 */
	assert.ok(
		afterRender1 - afterMount <= 1,
		`one re-render adds at most one align ask (mount=${afterMount} r1=${afterRender1})`,
	);
	assert.ok(
		afterRender2 - afterRender1 <= 1,
		`and so does the next (r1=${afterRender1} r2=${afterRender2})`,
	);

	/* The control: the enclosing run's head IS loaded, so the effect stands down. */
	let idleFetches = 0;
	const headed = [
		userRecord("user:1"),
		...Array.from({ length: 419 }, (_, index) =>
			toolRecord(`headed:${index + 1}`, { ts: TS + 1_000 + index }),
		),
	];
	const idle = await mount(t, headed, {
		hasMore: true,
		onLoadOlder: async () => {
			idleFetches += 1;
			return true;
		},
	});
	await flushFrames();
	await idle.render(headed, {
		hasMore: true,
		onLoadOlder: async () => {
			idleFetches += 1;
			return true;
		},
	});
	await flushFrames();
	/*
	 * The control's own count is a baseline, not zero: the scroll-paging arm
	 * makes its own demand (jsdom geometry puts the region at its top edge).
	 * What discriminates is the DIRECTION — the cut spends the align asks on
	 * top of that baseline; the head-loaded list never does. The exact bound
	 * is pinned by construction in the model suite, where a strict-mode
	 * remount cannot muddle the reading.
	 */
	assert.ok(
		afterRender2 > idleFetches,
		`the cut asks more than the head-loaded control (cut=${afterRender2} control=${idleFetches})`,
	);
});

test("a run whose head the LOADED rows cut off renders as today: no bar, foot as it was", async (t) => {
	__resetTurnCollapseOpen();
	/*
	 * The other half of §5 case 12: the row list itself starts mid-run (the
	 * leading tool rows), so no window can be snapped to a boundary that is not
	 * loaded — a summary may only ever describe rows that are on hand, and the
	 * foot line stands as it always did.
	 */
	const records = [
		toolRecord("tool:0", { ts: TS + 500 }),
		toolRecord("tool:1", { ts: TS + 1_000 }),
		answerRecord("answer:1", { ts: TS + 70_000, settledAt: TS + 70_000 }),
	];
	const mounted = await mount(t, records);
	assert.equal(
		bar(mounted),
		null,
		"a run whose opening user row is not loaded never condenses",
	);
	assert.match(
		mounted.container.textContent,
		/Worked/,
		"its foot line stands as it always did",
	);
});

test("the store's caps evict and forget clears — the delete path's two halves", () => {
	/*
	 * AGENT REVIEW ROUND 1, R1-2. The store's contract (`turn-collapse-open.ts`)
	 * names caps and a forget path; the forget path was unwired until the 404 /
	 * session-gone arm called it beside `dropPaint`, and neither cap had a test.
	 * This drives the store directly — the same module the transcript imports,
	 * through the bundle's exports.
	 */
	__resetTurnCollapseOpen();
	for (let session = 0; session < 9; session += 1) {
		writeRunExpanded(`session-${session}`, `run-${session}`, true);
	}
	const capped = __turnCollapseOpenStats();
	assert.equal(capped.sessions, 8, "the ninth conversation evicts the first");
	assert.equal(
		expandedRunsOf("session-0").size,
		0,
		"the least recently written conversation arrives collapsed again",
	);
	assert.equal(expandedRunsOf("session-8").size, 1, "the newest survives");

	__resetTurnCollapseOpen();
	for (let run = 0; run < 129; run += 1) {
		writeRunExpanded("one", `run-${run}`, true);
	}
	const runs = __turnCollapseOpenStats();
	assert.equal(runs.sessions, 1, "one conversation");
	assert.equal(runs.runs, 128, "the 129th expansion evicts the oldest");
	assert.equal(expandedRunsOf("one").has("run-0"), false, "oldest gone");
	assert.equal(expandedRunsOf("one").has("run-128"), true, "newest kept");

	forgetTurnCollapseOpen("one");
	assert.equal(
		expandedRunsOf("one").size,
		0,
		"forget clears the conversation, the dropPaint sibling",
	);
	assert.equal(__turnCollapseOpenStats().sessions, 0, "nothing left behind");
});

test("pinned statements never hide: the notice stays mounted, after the bar", async (t) => {
	/*
	 * AGENT REVIEW ROUND 1, R1-4 / design D4b. The pin list is a model fact
	 * (`staysVisibleWhileCollapsed`), and this pins the RENDER half: while the
	 * run is collapsed the pinned notice is mounted with the bar (the tool rows
	 * are not), and opening does not reorder it — the pinned row renders after
	 * the bar in document order, per §4.5's render formula.
	 */
	__resetTurnCollapseOpen();
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1"),
		noticeRecord("notice:1"),
		toolRecord("tool:2"),
		answerRecord("answer:1", { settledAt: TS + 70_000 }),
	]);
	const summary = bar(mounted);
	assert.ok(summary, "the run collapsed");
	const notice = rowBox(mounted, "notice:1");
	assert.ok(notice, "the pinned notice is mounted while collapsed");
	assert.equal(
		rowBox(mounted, "tool:1"),
		null,
		"the hidden tool row is not mounted while collapsed",
	);
	const order = (a, b) =>
		a.compareDocumentPosition(b) & window.Node.DOCUMENT_POSITION_FOLLOWING;
	assert.ok(
		order(summary, notice),
		"the notice renders after the bar, in its own slot",
	);
	await click(barTrigger(mounted));
	await flushFrames();
	assert.ok(rowBox(mounted, "tool:1"), "the hidden row mounts on the press");
	assert.ok(
		order(summary, notice),
		"the pinned row keeps its place relative to the bar when expanded",
	);
});

test("in-turn receipts collapse with the work (operator feedback, 2026-09-29)", async (t) => {
	/*
	 * ISSUE #5. The pin list dropped `peer`/`wake`: in a completed turn the
	 * delivery receipts are the bulk of the visual weight, and the reader who
	 * wants them has the bar's own expansion. Pinned in both directions - the
	 * collapsed run must not mount them, the press must put them back in their
	 * places.
	 */
	__resetTurnCollapseOpen();
	const mounted = await mount(t, [
		userRecord("user:1"),
		peerRecord("peer:1"),
		toolRecord("tool:1"),
		wakeRecord("wake:1"),
		answerRecord("answer:1", { settledAt: TS + 70_000 }),
	]);
	assert.ok(bar(mounted), "the run collapsed");
	assert.equal(
		rowBox(mounted, "peer:1"),
		null,
		"the peer receipt hides while collapsed",
	);
	assert.equal(
		rowBox(mounted, "wake:1"),
		null,
		"the wake receipt hides while collapsed",
	);
	await click(barTrigger(mounted));
	await flushFrames();
	assert.ok(rowBox(mounted, "peer:1"), "the peer receipt mounts on the press");
	assert.ok(rowBox(mounted, "wake:1"), "the wake receipt mounts on the press");
});

test("a parked turn does not condense: the gate is half of the liveness", async (t) => {
	/*
	 * DESIGN ROUND 1, D3. The working line deliberately stands down while a
	 * question holds the stage, so the newest run's unsettledness cannot be
	 * read from the working line alone — the call site composes it from
	 * `working !== null || gate !== null`. This is the transcript half of the
	 * composition: the same parked transcript condenses with no gate pending
	 * (the pre-fix reading) and does not condense once the gate is set.
	 */
	__resetTurnCollapseOpen();
	const parked = [
		userRecord("user:1"),
		toolRecord("tool:1", {
			phase: "running",
			output: null,
			durationS: null,
			endedAt: null,
			startedAt: TS + 2_000,
		}),
	];
	const gate = {
		request_id: "gate-1",
		kind: "approval",
		title: "Run the checks?",
		detail: "bash: pnpm test:desktop",
		options: [{ label: "Approve" }, { label: "Deny" }],
		secret: false,
		question_index: 0,
		question_total: 1,
	};
	const mounted = await mount(t, parked, { gate });
	assert.equal(
		bar(mounted),
		null,
		"nothing condenses while the turn waits on the gate",
	);
	await mounted.render(parked, { gate: null });
	assert.ok(
		bar(mounted),
		"the same transcript with no gate pending condenses — the gate is the difference",
	);
});

test("the trigger is focusable; the only press inside it toggles", async (t) => {
	/*
	 * DESIGN D4d's assertion, in the smallest honest form: the trigger is a
	 * native `<button>` and takes focus (the global ring's reach is CSS, stated
	 * in the remediation round rather than asserted here), and no OTHER
	 * separate control lives inside it — the failure control sits beside it in
	 * the trailing slot.
	 */
	__resetTurnCollapseOpen();
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1", { isError: true }),
		answerRecord("answer:1", { settledAt: TS + 70_000 }),
	]);
	const trigger = barTrigger(mounted);
	trigger.focus();
	assert.equal(
		document.activeElement,
		trigger,
		"the bar's trigger takes keyboard focus",
	);
	const controlsInside = [
		...trigger.querySelectorAll('button, a, input, [role="button"]'),
	];
	assert.deepEqual(
		controlsInside.map((node) => node.tagName),
		[],
		"no separate control lives inside the trigger",
	);
});
