import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
 * expansion survives a remount AND the head arriving later (the properties the
 * per-session store and the head-independent run key exist for) and follows the
 * CONVERSATION rather than the component; that the failure tally never renders
 * and the failed row stays one press away; that a live run renders exactly as
 * it did before the feature; that a run whose head the FETCHED rows cut off
 * condenses from its loaded span (the end-loaded rule, operator report
 * 2026-09-29) with no fabricated `Took`; that a settle does not fold the row
 * the reader's focus is in; that a bar's appearance is stated politely — and
 * that a WIDEN's revealed bars are not, because a reveal is not a settle
 * (review round 1, MAJOR-1); and (operator report, 2026-09-29) that the row
 * under the bar's rule renders at the block step with the bar's chevron
 * landing on the rule's end.
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
	/*
	 * jsdom implements neither. The bar's press path mounts the transcript's own
	 * rows, and one of those (the cross-session receipt row) observes mutations -
	 * the same shim every other harness in `scripts/` carries.
	 */
	MutationObserver: window.MutationObserver,
	/*
	 * The focus manager the bar's press path reaches for walks tabbables with
	 * `NodeFilter`; jsdom implements it on the window.
	 */
	NodeFilter: window.NodeFilter,
	HTMLInputElement: window.HTMLInputElement,
	IntersectionObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
		takeRecords() {
			return [];
		}
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
			/* The gap tiers as VALUES, so the report's spacing asserts against the shipped table rather than a retyped class. */
			'export { GAP } from "./src/renderer/src/features/chat/canonical/transcript-rows";',
			/* The walk's bound, so the assertion below names the shipped number. */
			'export { ALIGN_WALK_MAX_PAGES } from "./src/renderer/src/features/chat/canonical/turn-collapse-model";',
			/* The settle cadence the walk's wake arms on, so the counter below reads the
			 * module's own number rather than a retyped one. */
			'export { SETTLE_MS } from "./src/renderer/src/features/chat/canonical/scroll-paging";',
			/*
			 * The two query keys the transcript's own hook reads, so the hide case
			 * below seeds the SAME entries the app resolves - a second spelling of
			 * either key would pass here while the product read another cache entry.
			 */
			'export { backendSettingsKeys } from "./src/renderer/src/features/settings/components/backend-settings-section";',
			'export { desktopKeys } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";',
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
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		/*
		 * EXTERNAL, so the provider below and the hook inside the bundle resolve
		 * to ONE copy: a bundled second copy carries a different React context
		 * object and `useQuery` would not find the client this file seeds.
		 */
		"@tanstack/react-query",
	],
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
	GAP,
	ALIGN_WALK_MAX_PAGES,
	SETTLE_MS,
	backendSettingsKeys,
	desktopKeys,
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

/**
 * The memory statement: the pin list's first member, and the row the operator's
 * 2026-09-29 report is about. Durable (no settled sentence of its own), so the
 * text is the reader's `COMPACTED_LINE`.
 */
const compactionRecord = (id, over = {}) => ({
	kind: "compaction",
	id,
	ts: TS + 6_000,
	text: "Context compacted",
	before: 41_000,
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

/** One picture on a tool record, the shape `transcript-reducer.ts` composes. */
const shotImage = (recordId, index, data = "iVBORw0KGgo=") => ({
	recordId,
	id: `${recordId}:${index}`,
	data,
	attachment: null,
	mimeType: "image/png",
});

/** The reason a turn died: an error-level custom statement, pinned below the bar. */
const incidentRecord = (id, over = {}) => ({
	kind: "custom",
	id,
	ts: TS + 8_000,
	customType: "session_incident",
	text: "[session incident (anthropic/claude-opus-5)] mcp: MCP server 'notion': MCP authorization failed; run /mcp reauth notion",
	level: "error",
	category: "mcp",
	headline:
		"MCP server 'notion': MCP authorization failed; run /mcp reauth notion",
	detail: null,
	provider: "anthropic/claude-opus-5",
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
	/*
	 * A fresh client per mount, or the one the caller seeded: the transcript now
	 * reads its cross-session visibility through react-query, so every mount
	 * needs a provider - and the unseeded default is exactly the fail-closed
	 * path (no capabilities answer ⇒ nothing hidden).
	 */
	const client =
		over.client ??
		new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const render = async (next, nextOver = over) => {
		await act(async () => {
			mounted.root.render(
				h(
					QueryClientProvider,
					{ client },
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
				),
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
		toolRecord("tool:1", {
			ts: TS + 1_000,
			endedAt: TS + 2_000,
			durationS: 3,
		}),
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
		"the call's own reported seconds - the foot's quantity, not a wall span",
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
	assert.doesNotMatch(
		bar(mounted)?.textContent ?? "",
		/\+ actions/,
		"and a COMPLETE run carries no marker: its count is a total",
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
	/*
	 * LOADER-CONTINUITY 1b, ROUND 1's RETARGET: the walk is armed by the CONDENSED,
	 * head-cut BAR (see `alignWalkRunKey`), so the fixture has to carry the thing
	 * that paints one — a closing answer. Without it the run is either the live
	 * turn or a turn whose answer is prose-free, and neither paints a partial
	 * statement; the first cut of this fixture omitted the answer and got a fetch
	 * anyway, because the trigger was the window edge rather than the bar.
	 */
	const records = [
		...Array.from({ length: 420 }, (_, index) =>
			toolRecord(`tool:${index + 1}`, { ts: TS + 1_000 + index }),
		),
		answerRecord("answer:1", { ts: TS + 500_000, settledAt: TS + 500_000 }),
	];
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
	 * AGENT REVIEW ROUND 2, MINOR-2 pinned the flat two-page budget with a
	 * "one re-render adds at most one align ask" delta. LOADER-CONTINUITY 1b
	 * replaced that budget with the bounded WALK, and the delta is no longer the
	 * property: the walk's whole point is that ONE open may spend several pages
	 * (the operator's bar could not state its own action count otherwise), so a
	 * harness that re-creates the transcript object on every render legitimately
	 * re-runs the effect once per commit. What must still hold, and is asserted
	 * here NET of the control's own paging-arm asks, is the BOUND — a dropped
	 * bound would blow past it — while the bound's exact arithmetic stays in the
	 * model suite, where a strict-mode remount cannot muddle the reading.
	 */
	assert.ok(afterMount >= 1 && afterRender1 >= 1 && afterRender2 >= 1);

	/* The control: the enclosing run's head IS loaded, so the effect stands down. */
	let idleFetches = 0;
	const headed = [
		userRecord("user:1"),
		...Array.from({ length: 419 }, (_, index) =>
			toolRecord(`headed:${index + 1}`, { ts: TS + 1_000 + index }),
		),
		answerRecord("answer:1", { ts: TS + 500_000, settledAt: TS + 500_000 }),
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
	assert.ok(
		afterRender2 - idleFetches <= ALIGN_WALK_MAX_PAGES,
		`the walk stays inside its bound (cut=${afterRender2} control=${idleFetches})`,
	);
});

test("a run the STORE holds whole is never walked, however tall it is (round 1, R1)", async (t) => {
	/*
	 * R1's counterexample, at the mount level. A settled run TALLER than the snap's
	 * completed-run allowance (720) with its opening user row loaded: the ordinary
	 * snap cannot reach that row, so the raw window edge sits INSIDE the run. The
	 * render's plan, built over `visible`, then reads the run as head-cut — and
	 * before the store confirmation that keyed a walk that fetched up to
	 * `ALIGN_WALK_MAX_PAGES` pages it could never help (a prepend shifts the edge
	 * and the run's opening row equally, so the snap still refuses).
	 *
	 * The control is the SAME row count with the head genuinely missing, so the two
	 * mounts differ only in the fact the walk is supposed to read: the store.
	 */
	const TALL = 800;
	const tall = (headLoaded) => [
		...(headLoaded ? [userRecord("user:1")] : []),
		...Array.from({ length: TALL }, (_, index) =>
			toolRecord(`tall:${index + 1}`, { ts: TS + 1_000 + index }),
		),
		answerRecord("answer:1", { ts: TS + 900_000, settledAt: TS + 900_000 }),
	];
	const run = async (records) => {
		let fetches = 0;
		const load = async () => {
			fetches += 1;
			return true;
		};
		const mounted = await mount(t, records, {
			hasMore: true,
			onLoadOlder: load,
		});
		await flushFrames();
		await mounted.render(records, { hasMore: true, onLoadOlder: load });
		await flushFrames();
		return fetches;
	};
	const loaded = await run(tall(true));
	const cut = await run(tall(false));
	t.diagnostic(
		`R1 control: fetches with the store holding the run whole = ${loaded}; with the head genuinely cut = ${cut}`,
	);
	/*
	 * The head-cut list spends its walk; the loaded-head list must not spend one on
	 * top of whatever the pump asks for on its own (the baseline jsdom geometry
	 * gives it). The DIRECTION is the claim, and the model case above pins that the
	 * confirmation is what draws the line.
	 */
	assert.ok(
		cut > loaded,
		`a genuinely cut store asks more than one the store holds whole (loaded=${loaded} cut=${cut})`,
	);
});

test("the walk's settle wake arms only when the clock is the only missing clause (round 2, R2-1)", async (t) => {
	/*
	 * R2-1's counterexample. `mayWalk` is false for TWO reasons — the input debounce
	 * is still running, or the reader is off the tail — and the wake exists for the
	 * first alone. Arming on `!mayWalk` therefore re-armed the timer forever for an
	 * off-tail reader while a cut bar was painted: nothing could satisfy the clause
	 * and `spent` never grew (no fetch), so the loop could not bound itself.
	 *
	 * The count is `window.setTimeout` at the settle delay, which is the wake's own
	 * cadence (the paging pump's timers share the delay but only arm on reader input,
	 * and these mounts send none).
	 */
	const cutRecords = [
		...Array.from({ length: 420 }, (_, index) =>
			toolRecord(`wake:${index + 1}`, { ts: TS + 1_000 + index }),
		),
		answerRecord("answer:1", { ts: TS + 500_000, settledAt: TS + 500_000 }),
	];
	/* The control for the KEY: a headed store paints no cut bar, so it arms nothing
	 * whatever the geometry — the wake is not simply always-off. */
	const headedRecords = [
		userRecord("user:1"),
		...Array.from({ length: 419 }, (_, index) =>
			toolRecord(`wh:${index + 1}`, { ts: TS + 1_000 + index }),
		),
		answerRecord("answer:1", { ts: TS + 500_000, settledAt: TS + 500_000 }),
	];
	/*
	 * The SCROLLER, not the harness's wrapper: the transcript attaches its own
	 * `containerRef` to the `[data-lo-canonical-transcript]` node it renders, and
	 * that is the element the paging hook measures.
	 */
	const stubGeometry = (mounted, scrollTop) => {
		const scroller =
			mounted.container.querySelector("[data-lo-canonical-transcript]") ??
			mounted.container;
		Object.defineProperty(scroller, "scrollTop", {
			configurable: true,
			writable: true,
			value: scrollTop,
		});
		Object.defineProperty(scroller, "scrollHeight", {
			configurable: true,
			value: 6_000,
		});
		Object.defineProperty(scroller, "clientHeight", {
			configurable: true,
			value: 800,
		});
		return scroller;
	};
	const armsOffTail = async (records, scrollTop) => {
		const load = async () => true;
		/*
		 * `hasMore: false` at the mount, flipped inside the measured window: the walk
		 * cannot spend a page before the geometry under test is in place, so the
		 * counter sees the wake's whole behaviour rather than a budget already
		 * exhausted by the mount.
		 */
		const mounted = await mount(t, records, {
			hasMore: false,
			onLoadOlder: load,
		});
		stubGeometry(mounted, scrollTop);
		await flushFrames();
		let count = 0;
		const original = window.setTimeout;
		window.setTimeout = (fn, delay, ...rest) => {
			if (delay === SETTLE_MS) count += 1;
			return original.call(window, fn, delay, ...rest);
		};
		try {
			/* A fresh loader identity, so the effect re-runs under this geometry. */
			await mounted.render(records, {
				hasMore: true,
				onLoadOlder: async () => true,
			});
			await flushFrames();
			/*
			 * A real settle window, so a wake that re-arms itself is counted again: that
			 * is the reviewer's 650 ms reading, and the loop is the symptom (an off-tail
			 * reader whose budget can never grow). The wait uses the runtime's own timer
			 * under a delay the counter ignores.
			 */
			await act(async () => {
				await new Promise((resolve) => original.call(window, resolve, 650));
			});
			await flushFrames();
		} finally {
			window.setTimeout = original;
		}
		return count;
	};
	const cutOffTail = await armsOffTail(cutRecords, -5_000);
	const headedOffTail = await armsOffTail(headedRecords, -5_000);
	const cutAtTail = await armsOffTail(cutRecords, 0);
	t.diagnostic(
		`R2-1 control: settle arms — cut+off-tail=${cutOffTail}, headed+off-tail=${headedOffTail}, cut+at-tail=${cutAtTail}`,
	);
	assert.equal(
		cutOffTail,
		0,
		"off the tail the wake arms nothing, however cut the painted bar is",
	);
	assert.equal(
		headedOffTail,
		0,
		"and a headed store has no cut to arm for in the first place",
	);
});

test("a run whose head the LOADED rows cut off condenses from the loaded span: counts, no Took", async (t) => {
	__resetTurnCollapseOpen();
	/*
	 * END-LOADED ELIGIBILITY (operator report, 2026-09-29). The row list itself
	 * starts mid-run (the leading tool rows — the state after a deep jump or a
	 * long tail turn), so no window can be snapped to a boundary that is not
	 * loaded. The bar may only ever describe rows on hand, and that is what it
	 * does: the loaded calls, and no `Took` (the span would have to start at the
	 * first loaded row, a number the turn never had).
	 */
	const records = [
		toolRecord("tool:0", { ts: TS + 500 }),
		toolRecord("tool:1", { ts: TS + 1_000 }),
		answerRecord("answer:1", { ts: TS + 70_000, settledAt: TS + 70_000 }),
	];
	const mounted = await mount(t, records);
	const summary = bar(mounted);
	assert.ok(summary, "the cut run condenses from its loaded span");
	assert.equal(
		summary.getAttribute("data-run-ids"),
		"tool:0 tool:1 answer:1",
		"every loaded row stays addressable through the bar",
	);
	/*
	 * THE HONEST MARKER (design round 1, D1). The count is a MINIMUM - two loaded
	 * calls of a turn whose earlier rows are not in the store - and the bar says so
	 * in its own vocabulary rather than stating `2 actions`, which reads exactly
	 * like a settled total. The same claim is in words for assistive tech, and the
	 * complete-run case below asserts the marker is ABSENT there, so the two
	 * statements cannot collapse into one.
	 */
	assert.match(
		summary.textContent ?? "",
		/2\+ actions/,
		"a partial count is marked: `2+ actions`",
	);
	assert.doesNotMatch(
		summary.textContent ?? "",
		/Took/,
		"no duration: it would be fabricated from the first loaded row",
	);
	const partialLabel = [...summary.querySelectorAll("*")]
		.map((node) => node.getAttribute("aria-label"))
		.find((label) => label?.startsWith("At least"));
	assert.equal(
		partialLabel,
		"At least 2 actions — earlier rows of this turn are not loaded",
		"and the same claim is stated in words",
	);
	assert.doesNotMatch(
		mounted.container.textContent ?? "",
		/Worked/,
		"the bar replaces the foot line, as on any completed run",
	);
});

test("the head arriving later keeps the cut run's expansion: its key does not move", async (t) => {
	__resetTurnCollapseOpen();
	const cut = [
		toolRecord("tool:0", { ts: TS + 500 }),
		toolRecord("tool:1", { ts: TS + 1_000 }),
		answerRecord("answer:1", { ts: TS + 70_000, settledAt: TS + 70_000 }),
	];
	const mounted = await mount(t, cut, {
		frontend: { session_id: "chat-head" },
	});
	assert.ok(bar(mounted), "the cut run condenses on arrival");
	await click(barTrigger(mounted));
	assert.ok(rowBox(mounted, "tool:0"), "the reader opened it");
	/*
	 * A page lands and brings the opening user row: the pre-fix key (the run's
	 * first row) would have changed right here and the reader's expansion would
	 * have silently reverted.
	 */
	await mounted.render([userRecord("user:0", { ts: TS + 100 }), ...cut], {
		frontend: { session_id: "chat-head" },
	});
	assert.ok(
		rowBox(mounted, "tool:0"),
		"the reader's expansion survives the head arriving",
	);
	assert.ok(bar(mounted), "the bar is still the run's summary");
});

test("a settle does not fold the run out from under the reader's focus", async (t) => {
	__resetTurnCollapseOpen();
	/*
	 * The collapse UNMOUNTS rows; a reader whose keyboard focus sits in one of
	 * them would lose focus to the body. The guard holds that run open until the
	 * focus moves on — and it is invisible to a reader who is not focused in a
	 * row (the pointer case: no focus event, no hold).
	 */
	const running = [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000 }),
	];
	const mounted = await mount(t, running, { waiting: true });
	const trigger = rowBox(mounted, "tool:1")?.querySelector("button");
	assert.ok(trigger, "the running row has a focusable control");
	await act(async () => {
		trigger.focus();
	});
	assert.equal(
		document.activeElement,
		trigger,
		"the reader's focus is in the row",
	);
	const settled = [
		...running,
		answerRecord("answer:1", { ts: TS + 3_000, settledAt: TS + 3_000 }),
	];
	await mounted.render(settled, {});
	assert.equal(
		bar(mounted),
		null,
		"the settle does not fold the run out from under the focus",
	);
	assert.ok(rowBox(mounted, "tool:1"), "the focused row stays mounted");
	assert.equal(document.activeElement, trigger, "and the focus is intact");
	await act(async () => {
		trigger.blur();
	});
	assert.ok(bar(mounted), "once the focus leaves, the run folds");
});

test("a widen announces nothing: a reveal is not a settle", async (t) => {
	__resetTurnCollapseOpen();
	/*
	 * AGENT REVIEW ROUND 1, MAJOR-1. The window only ever GROWS, so a widen
	 * (the reader's scroll-up, the open's snap, a jump's mount) presents bars
	 * for runs the previous pass never held. The pre-fix effect — a
	 * set-difference against the previous pass's collapsed keys — announced
	 * every one of them: measured on this fixture, ten "Turn condensed"
	 * sentences on a widen and zero settles (the reviewer's
	 * `probe-widen-announce.test.mjs`). Nothing was unmounted out from under
	 * the reader — those runs were folded before the reader ever saw them
	 * unfold — so the fix requires an utterance to ALSO find the run present
	 * in the previous pass (sharing a row with it), which window-entered bars
	 * fail.
	 */
	const records = [];
	for (let i = 1; i <= 30; i += 1) {
		records.push(userRecord(`user:${i}`, { ts: TS + i * 60_000 }));
		records.push(toolRecord(`tool:${i}`, { ts: TS + i * 60_000 + 1_000 }));
		records.push(answerRecord(`answer:${i}`, { ts: TS + i * 60_000 + 5_000 }));
	}
	const mounted = await mount(t, records, { hasMore: false });
	const region = () =>
		mounted.container.querySelector("[data-condense-announcement]")
			?.textContent ?? "";
	const bars = () =>
		mounted.container.querySelectorAll("[data-turn-summary]").length;
	assert.ok(bars() > 0, "the loaded window arrives folded");
	assert.equal(region(), "", "a load announces nothing");
	const before = bars();
	await flushFrames();
	assert.ok(
		bars() > before,
		`the frames widened the window (before=${before} after=${bars()})`,
	);
	assert.equal(
		region(),
		"",
		"the revealed bars are window-entered, not settled",
	);
});

test("a settle announces the new bar politely, in the bar's own words", async (t) => {
	__resetTurnCollapseOpen();
	/*
	 * A bar appearing is a transition the reader did not initiate — rows
	 * readable a moment ago are unmounted — and the live region is where it is
	 * said out loud: the bar's own facts, no more. A load's bars are not a
	 * settle and stay silent (the running turn below is the whole initial
	 * transcript).
	 */
	const running = [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000, durationS: 3 }),
	];
	const mounted = await mount(t, running, { waiting: true });
	const region = () =>
		mounted.container.querySelector("[data-condense-announcement]")
			?.textContent ?? "";
	assert.equal(region(), "", "a running turn announces nothing");
	await mounted.render(
		[
			...running,
			answerRecord("answer:1", { ts: TS + 3_000, settledAt: TS + 3_000 }),
		],
		{},
	);
	assert.match(
		region(),
		/Turn condensed: took 3s, 1 action\./,
		"the settle states the bar's own facts",
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

test("the row under the bar takes the block step, and the chevron reaches the rule (operator report, 2026-09-29)", async (t) => {
	/*
	 * THE REPORTED STATE: "the condensed row ('Context compacted') hugs the
	 * summary row's rule too closely ... wants more breathing room between the
	 * horizontal line and the row beneath it" and "the chevron ('>') doesn't
	 * reach the right end of the rule". jsdom has no layout engine, so this pins
	 * the MECHANISM per class - the pixels are the frames' claim
	 * (`docs/evidence/chat-turn-collapse/pinned-compaction/`, and the pair in
	 * `docs/evidence/condensed-bar-spacing/`).
	 *
	 * The row's gap: a pinned statement is BUILT against its original neighbour -
	 * here a hidden tool row, which gives it the trace tier's 2px - so when the
	 * collapse leaves it directly under the bar, the render pass re-tiers the
	 * row to the item step: the same 12px the closing answer already sits below
	 * the rule. The chevron: the trigger ends 16px short of the row on the right
	 * (the disclosure's documented left-only bleed) and the slot's `-mr-4`
	 * reclaims exactly that, so the row's right edge lands on the rule's end.
	 */
	__resetTurnCollapseOpen();
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1"),
		compactionRecord("compaction:1"),
		toolRecord("tool:2"),
		answerRecord("answer:1", { settledAt: TS + 70_000 }),
	]);
	assert.ok(bar(mounted), "the run collapsed");
	const row = rowBox(mounted, "compaction:1");
	assert.ok(row, "the compaction row is pinned below the bar");
	assert.ok(
		row.classList.contains(GAP.item[0]),
		`the first row under the bar renders at the item tier (${GAP.item[0]}), not the trace tier it was built with`,
	);
	assert.ok(
		!row.classList.contains(GAP.trace[0]),
		"the 2px ledger hug is not painted on the row beneath the rule",
	);
	const chevron = barTrigger(mounted)?.querySelector("svg")?.closest("span");
	assert.ok(chevron, "the bar's chevron slot exists");
	assert.ok(
		chevron.classList.contains("-mr-6"),
		"the chevron slot's 24px pull lands the glyph's leading edge on the rule's endpoint (the alignment datum)",
	);
	/*
	 * The rule's own two sides (second round): the bar block carries 12px of air
	 * above the rule (`pb-3`) - the SAME step the row below sits at, so the rule
	 * divides 12px of box either side - and the row below keeps the item step the
	 * walk re-tiers it to. jsdom has no layout engine; the pair the frames show
	 * is 17px of ink above against 15px below (ink-edge to rule-edge, text
	 * register, both palettes - the settled reading after the first 16px pass
	 * measured 21 against 15 and the design round flagged it).
	 */
	const summary = bar(mounted);
	assert.ok(
		summary.classList.contains("border-b") &&
			summary.className.includes("pb-3"),
		"the bar block carries its own 12px of air above the rule",
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

test("a collapsed span that produced pictures keeps them under the bar", async (t) => {
	/*
	 * THE OPERATOR REPORT, as a behaviour, one fold level up from
	 * `trace-fold-behaviour.test.mjs`'s case: the turned condensation unmounts
	 * the rows a hidden span holds, so the pictures those rows would have
	 * drawn have to ride the bar - and the strip is the bar's own, under its
	 * line, gone the moment the reader presses it open (open, the rows draw
	 * their own media and the strip would double it).
	 */
	__resetTurnCollapseOpen();
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1", {
			images: [shotImage("tool:1", 0), shotImage("tool:1", 1)],
		}),
		answerRecord("answer:1", { settledAt: TS + 70_000 }),
	]);
	assert.ok(bar(mounted), "the run collapsed");
	assert.equal(
		rowBox(mounted, "tool:1"),
		null,
		"the row that would draw them is unmounted",
	);
	const strip = bar(mounted)?.querySelector("[data-fold-media]");
	assert.ok(strip, "and the pictures are on screen anyway");
	assert.equal(
		strip.getAttribute("aria-label"),
		"2 images from this run",
		"the strip names its set and its size",
	);
	assert.equal(
		strip.querySelectorAll("li").length,
		2,
		"one tile per picture, no count clause at two",
	);
	assert.match(
		bar(mounted)?.textContent ?? "",
		/2 images/,
		"and the count is a clause on the bar's own line",
	);
	assert.equal(
		bar(mounted)?.childElementCount,
		2,
		"the bar is its disclosure plus the strip",
	);

	/* Pressing is what trades the strip for the rows that draw their own media. */
	await click(barTrigger(mounted));
	await flushFrames();
	assert.equal(
		bar(mounted)?.querySelector("[data-fold-media]"),
		null,
		"open, the strip goes",
	);
	assert.ok(rowBox(mounted, "tool:1"), "the press mounts the row again");
});

test("a span with no pictures is the bar it was: no strip, no clause", async (t) => {
	/*
	 * The overwhelmingly common case, pinned for the bar the way
	 * `trace-fold-behaviour.test.mjs` pins it for the fold: an image-less run
	 * must not grow a slot, a rule, an empty row or a count - the wrapper's
	 * child count is the claim.
	 */
	__resetTurnCollapseOpen();
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1"),
		answerRecord("answer:1", { settledAt: TS + 70_000 }),
	]);
	assert.ok(bar(mounted), "the run collapsed");
	assert.equal(
		bar(mounted)?.querySelector("[data-fold-media]"),
		null,
		"no pictures, no strip",
	);
	assert.doesNotMatch(
		bar(mounted)?.textContent ?? "",
		/\d+ images?/,
		"and no count clause either",
	);
	assert.equal(
		bar(mounted)?.childElementCount,
		1,
		"the bar is its disclosure and nothing else",
	);
});

test("the strip caps at four tiles and counts the rest", async (t) => {
	/*
	 * The pathological span: eight pictures cost one capped row - four tiles
	 * and a `+4` (named `+4 more images`) - which is the height bound `FOLD_MEDIA_LIMIT`
	 * exists for, and the count is what keeps the row from pretending
	 * otherwise. The count slot is also the ONLY route to the pictures past
	 * the cap, so it is a control (U1), and that is asserted here against the
	 * real bar.
	 */
	__resetTurnCollapseOpen();
	const images = Array.from({ length: 8 }, (_, index) =>
		shotImage("tool:1", index),
	);
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1", { images }),
		answerRecord("answer:1", { settledAt: TS + 70_000 }),
	]);
	const strip = bar(mounted)?.querySelector("[data-fold-media]");
	assert.ok(strip, "the strip renders");
	assert.equal(
		strip.querySelectorAll("li").length,
		5,
		"four tiles and the count's own slot",
	);
	const count = strip.querySelector("li:last-child button");
	assert.equal(
		count?.textContent,
		"+4",
		"the count is COMPACT on screen: the row it funds is the larger tile",
	);
	assert.equal(
		count?.getAttribute("aria-label"),
		"+4 more images",
		"and its accessible name carries the count and the noun in full",
	);
	/*
	 * U1: it OPENS the bar rather than standing as text - the same toggle the
	 * bar's own trigger runs, so pressing it reveals the rows (and with them
	 * the pictures past the cap, at the row level where each is drawn in full).
	 * The match is on the count's own words: the tiles inside the strip are
	 * buttons too, and pointing at one of those would expand a picture instead
	 * of opening the run.
	 */
	const more = [...strip.querySelectorAll("button")].find((control) =>
		/more images?/.test(control.getAttribute("aria-label") ?? ""),
	);
	assert.ok(more, "the count slot is a button, not inert text");
	await click(more);
	assert.ok(
		rowBox(mounted, "tool:1"),
		"pressing the count opens the run, putting the rows it stood for back",
	);
	assert.equal(
		strip.getAttribute("aria-label"),
		"8 images from this run",
		"the set's size is still stated in full",
	);
});

test("pressing the bar's count hands focus to the bar's trigger, not to <body> (U2)", async (t) => {
	/*
	 * UX round 1, U2's SECOND CALLER (agent review round 1, R1-3): the press
	 * unmounts the strip and the control with it, so a keyboard reader's focus
	 * would land on `<body>` and the next Tab would restart at the document's
	 * first stop. `TurnSummary.revealFromStrip` hands it to the bar's own trigger,
	 * which stays mounted and closes the block again - and this drives that
	 * through the REAL transcript, not through a host that plays the caller.
	 *
	 * The pre-fix WIRING is exercised in `chat-image-expand.test.mjs`'s own
	 * CONTROL ARM (the same mechanism, mounted with the old `() => open(true)`
	 * shape): this file's bundle entry pulls a module that MEASURES a console
	 * width at import time, and jsdom has no canvas - so a hand-mounted bar here
	 * fails to load rather than failing to hand over focus, which is a worse
	 * instrument than the one that already exists there.
	 */
	__resetTurnCollapseOpen();
	const images = Array.from({ length: 8 }, (_, index) =>
		shotImage("tool:1", index),
	);
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1", { images }),
		answerRecord("answer:1", { settledAt: TS + 70_000 }),
	]);
	const strip = bar(mounted)?.querySelector("[data-fold-media]");
	assert.ok(strip, "the strip renders on the collapsed bar");
	const count = strip.querySelector("li:last-child button");
	await act(async () => {
		count.focus();
	});
	assert.equal(document.activeElement, count, "the reader is on the count");
	await click(count);
	assert.equal(
		bar(mounted)?.querySelector("[data-fold-media]"),
		null,
		"the press opened the block and the strip - with the control - unmounted",
	);
	const trigger = barTrigger(mounted);
	assert.equal(trigger.getAttribute("aria-expanded"), "true");
	assert.equal(
		document.activeElement,
		trigger,
		"focus continues from where the reader pressed: the bar's trigger, not <body>",
	);
});

test("the group's clause drops only when it repeats the bar's number (D3/U6)", async (t) => {
	/*
	 * The drop branch of `soleImageGroup`, pinned rather than left to the
	 * re-shot frame alone: a span whose ONLY image-bearing run is the whole
	 * story (its count equals the bar's) does not print the same number twice
	 * one line apart - the bar keeps the aggregate, the group row omits the
	 * duplicate.
	 */
	__resetTurnCollapseOpen();
	const images = Array.from({ length: 3 }, (_, index) =>
		shotImage("tool:1", index),
	);
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1", { images }),
		toolRecord("tool:2"),
		toolRecord("tool:3"),
		answerRecord("answer:1", { settledAt: TS + 70_000 }),
	]);
	await click(barTrigger(mounted));
	const group = bar(mounted)?.querySelector("[data-fold-ids]");
	assert.ok(group, "the run's own fold mounts under the bar");
	assert.match(
		bar(mounted)?.textContent ?? "",
		/3 images/,
		"the bar states the span's count",
	);
	assert.doesNotMatch(
		group.textContent ?? "",
		/\d+ images?/,
		"and the group does not repeat the same number one line below",
	);
});

test("a group holding only part of the span keeps its own clause (D3/U6, keep branch)", async (t) => {
	/*
	 * The keep branch: two image-bearing folds under one bar, neither carrying
	 * the whole set - the numbers differ, so both levels state their own and
	 * the suppression must NOT fire. The notice between the two runs is what
	 * splits them (`foldRuns`: a non-call row breaks a run).
	 *
	 * THE SPLITTER IS AN UNPINNED (info) NOTICE, since the segments change: a
	 * `complete` marker is pinned, so it now ends one bar and opens another
	 * instead of sitting between two runs of the same bar - which is the reorder
	 * fix, and is asserted where it belongs (the segments suite). This test is
	 * about the D3/U6 clause rule inside ONE bar, so its fixture must keep the
	 * two folds in one.
	 */
	__resetTurnCollapseOpen();
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1", {
			images: [shotImage("tool:1", 0), shotImage("tool:1", 1)],
		}),
		toolRecord("tool:2"),
		toolRecord("tool:3"),
		noticeRecord("notice:1", { complete: false, level: "info" }),
		toolRecord("tool:4"),
		toolRecord("tool:5", {
			images: [shotImage("tool:5", 0), shotImage("tool:5", 1)],
		}),
		toolRecord("tool:6"),
		answerRecord("answer:1", { settledAt: TS + 70_000 }),
	]);
	await click(barTrigger(mounted));
	const groups = [...(bar(mounted)?.querySelectorAll("[data-fold-ids]") ?? [])];
	assert.equal(groups.length, 2, "two runs sit under the bar");
	assert.deepEqual(
		groups.map((node) => (node.textContent ?? "").match(/\d+ images?/)?.[0]),
		["2 images", "2 images"],
		"each group keeps its own count: neither repeats the bar's 4",
	);
});

test("one press on the bar's count reaches the whole set (U8)", async (t) => {
	/*
	 * The round-2 UX finding: pressing the bar's `+N` on the bar opened the
	 * bar, but the sole run inside drew the SAME capped strip, so pictures 5-8
	 * cost a second press. The group that IS the span's whole image story now
	 * renders `uncapped`, so the one press the reader made reaches every
	 * picture - and no second count control is left to press.
	 */
	__resetTurnCollapseOpen();
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1", {
			images: Array.from({ length: 4 }, (_, index) =>
				shotImage("tool:1", index),
			),
		}),
		toolRecord("tool:2", {
			images: Array.from({ length: 4 }, (_, index) =>
				shotImage("tool:2", index),
			),
		}),
		toolRecord("tool:3"),
		answerRecord("answer:1", { settledAt: TS + 70_000 }),
	]);
	const strip = bar(mounted)?.querySelector("[data-fold-media]");
	const more = [...(strip?.querySelectorAll("button") ?? [])].find((control) =>
		/more images?/.test(control.getAttribute("aria-label") ?? ""),
	);
	assert.ok(more, "the collapsed bar shows four tiles and the count control");
	await click(more);
	const groupStrip = bar(mounted)?.querySelector("[data-fold-media]");
	assert.ok(groupStrip, "the press opened the bar onto its group's strip");
	assert.equal(
		groupStrip.querySelectorAll("li").length,
		8,
		"and the group shows its WHOLE set: one press reached the rest",
	);
	assert.equal(
		[...groupStrip.querySelectorAll("button")].filter((control) =>
			/more images?/.test(control.getAttribute("aria-label") ?? ""),
		).length,
		0,
		"with no second count control left to press",
	);
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

test("hiding cross-session rows: the receipt and the send row leave, the bar's ids follow, and clearing the key restores them", async (t) => {
	__resetTurnCollapseOpen();
	/*
	 * The component's own seam, end to end: `useCrossSessionHidden` reads the
	 * settings query, `shownRecords` filters, and the rows plus the bar's ids
	 * are downstream of BOTH. The query client is SEEDED with the two cache
	 * entries the app resolves rather than mocking the hook, which is what
	 * makes the toggle below meaningful: one `setQueryData` in each direction
	 * under the same mount is "turning it off restores them", exactly as the
	 * operator experiences it (no remount, no refetch).
	 */
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(desktopKeys.capabilities, {
		desktop_available: true,
		features: { settings: 1 },
	});
	const settings = (hide) => ({
		sections: [],
		settings: [{ key: "display.hide_cross_session", value: hide }],
	});
	client.setQueryData(backendSettingsKeys.all, settings(true));
	const mounted = await mount(
		t,
		[
			userRecord("user:1"),
			peerRecord("peer:1"),
			toolRecord("tool:1"),
			toolRecord("tool:2", {
				toolName: "send",
				args: { conversation: "other" },
			}),
			answerRecord("answer:1"),
		],
		{ client },
	);

	// On: the receipt and the send row are not mounted; the ordinary call is
	// only behind the bar (collapsed), not gone.
	assert.equal(rowBox(mounted, "peer:1"), null, "the receipt is hidden");
	assert.equal(rowBox(mounted, "tool:2"), null, "the send row is hidden");
	assert.equal(
		bar(mounted)?.getAttribute("data-run-ids"),
		"user:1 tool:1 answer:1",
		"the bar's ids name only what the pane keeps",
	);
	// Expand: the work comes back, and the hidden send does NOT — the filter
	// sits above the collapse, so no interaction can reveal it.
	await click(barTrigger(mounted));
	assert.ok(rowBox(mounted, "tool:1"), "the ordinary call is revealed");
	assert.equal(rowBox(mounted, "tool:2"), null, "the send row stays gone");
	assert.equal(rowBox(mounted, "peer:1"), null, "the receipt stays gone");

	// Off, under the same mount: both come back where they belong. The drain is
	// two ticks rather than one: the query's notification is applied on a TASK
	// and the row repaint then queues a FRAME, and the harness's own
	// `flushFrames` no-ops when nothing has queued a frame yet - exactly this
	// case's race. Both ticks are explicit, so the assert reads a settled tree.
	await act(async () => {
		client.setQueryData(backendSettingsKeys.all, settings(false));
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	await flushFrames();
	assert.ok(rowBox(mounted, "peer:1"), "the receipt returns");
	assert.ok(rowBox(mounted, "tool:2"), "the send row returns");
	assert.equal(
		bar(mounted)?.getAttribute("data-run-ids"),
		"user:1 peer:1 tool:1 tool:2 answer:1",
		"the run is whole again",
	);
});

test("settings enabled but WITHOUT the key hide nothing: the absent-key fallback", async (t) => {
	/*
	 * The frozen contract's absent-key skew (an old backend behind a new app),
	 * at the seam that reads it: capabilities answer `settings: 1` while the
	 * registry carries no `display.hide_cross_session`. `setting?.value ===
	 * true` is the whole read, so absence resolves false - nothing is hidden,
	 * and no row is dropped by a key the backend never sent. Pinned because
	 * this is the one fallback direction the seeded toggle test cannot reach.
	 */
	__resetTurnCollapseOpen();
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(desktopKeys.capabilities, {
		desktop_available: true,
		features: { settings: 1 },
	});
	client.setQueryData(backendSettingsKeys.all, {
		sections: [],
		settings: [{ key: "display.shimmer", value: true }],
	});
	const mounted = await mount(
		t,
		[
			userRecord("user:1"),
			peerRecord("peer:1"),
			toolRecord("tool:1"),
			toolRecord("tool:2", {
				toolName: "send",
				args: { conversation: "other" },
			}),
			answerRecord("answer:1"),
		],
		{ client },
	);
	assert.equal(
		bar(mounted)?.getAttribute("data-run-ids"),
		"user:1 peer:1 tool:1 tool:2 answer:1",
		"the bar's ids keep every row the run holds",
	);
	await click(barTrigger(mounted));
	assert.ok(rowBox(mounted, "peer:1"), "the receipt mounts with the run");
	assert.ok(rowBox(mounted, "tool:2"), "the send row mounts with the run");
});

test("the incident row under the bar takes the block step too (operator report, 2026-09-29, second round)", async (t) => {
	/*
	 * THE REPORTED STATE: "the 'session incident: …' row beneath sits too tight
	 * to the line - the below-line gap fix must cover the incident-row class
	 * (like the compaction row)". The first round's re-tier marked only the
	 * FIRST group after a bar, so an incident behind the memory statement kept
	 * the trace tier its original neighbour gave it and hugged the statement by
	 * 2px (measured: `mt-0.5` against the compaction's `mt-3`). The walk now
	 * re-tiers every group a bar leaves visible.
	 *
	 * jsdom has no layout engine, so this pins the mechanism per class - the
	 * pixels are the frames' claim
	 * (`docs/evidence/chat-turn-collapse/pinned-incident/`, and the pair in
	 * `docs/evidence/condensed-bar-spacing/`).
	 */
	__resetTurnCollapseOpen();
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1"),
		compactionRecord("compaction:1"),
		toolRecord("tool:2"),
		incidentRecord("incident:1"),
	]);
	assert.ok(bar(mounted), "the run collapsed");
	const statement = rowBox(mounted, "compaction:1");
	assert.ok(statement, "the memory statement is pinned below the bar");
	assert.ok(
		statement.classList.contains(GAP.item[0]),
		`the memory statement renders at the item tier (${GAP.item[0]})`,
	);
	const incident = rowBox(mounted, "incident:1");
	assert.ok(incident, "the incident reason is pinned below the bar");
	assert.ok(
		incident.classList.contains(GAP.item[0]),
		`the incident behind the statement takes the same block step (${GAP.item[0]}), not the trace tier its neighbour gave it`,
	);
	assert.ok(
		!incident.classList.contains(GAP.trace[0]),
		"the 2px ledger hug is not painted on the incident row beneath the rule",
	);
});

/* ------------- segments: several bars in one run (issue #665) ------------- */

/** The order of the transcript's top-level entries: bars and rows by id. */
const orderOf = (mounted) =>
	[...mounted.container.querySelectorAll("[data-record-id]")]
		.filter(
			(node) =>
				node.hasAttribute("data-turn-summary") ||
				node.closest("[data-turn-summary]") === null,
		)
		.map((node) =>
			node.hasAttribute("data-turn-summary")
				? `bar:${node.getAttribute("data-record-id")}`
				: node.getAttribute("data-record-id"),
		);
const barsOf = (mounted) => [
	...mounted.container.querySelectorAll("[data-turn-summary]"),
];

test("a pinned row between two hidden spans stays BETWEEN their bars, before and after a press", async (t) => {
	/*
	 * The E8 reorder, as a rendered assertion. One bar at the first hidden row's
	 * slot used to put the compaction AFTER a bar that preceded it - and moved it
	 * when the bar opened. Each span is its own bar now, so the order is fixed.
	 */
	__resetTurnCollapseOpen();
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000 }),
		compactionRecord("compaction:1", { ts: TS + 2_000 }),
		toolRecord("tool:2", { ts: TS + 3_000 }),
		answerRecord("answer:1", { ts: TS + 4_000, settledAt: TS + 4_000 }),
	]);
	const expected = [
		"user:1",
		"bar:tool:1",
		"compaction:1",
		"bar:tool:2",
		"answer:1",
	];
	assert.deepEqual(orderOf(mounted), expected, "collapsed order");
	assert.equal(barsOf(mounted).length, 2, "two bars in one run");
	// Pressing the SECOND bar opens only the second span.
	await click(barsOf(mounted)[1].querySelector("button"));
	assert.deepEqual(
		orderOf(mounted).filter((id) => !id.startsWith("tool:")),
		expected,
		"opening a bar reorders nothing that stays visible",
	);
	assert.ok(rowBox(mounted, "tool:2"), "the second span's row is now mounted");
	assert.equal(
		rowBox(mounted, "tool:1"),
		null,
		"the first span is still condensed",
	);
	assert.equal(
		barsOf(mounted)[0].querySelector("button").getAttribute("aria-expanded"),
		"false",
	);
});

test("one stamp per turn with several bars: the answer's foot keeps it", async (t) => {
	__resetTurnCollapseOpen();
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000 }),
		compactionRecord("compaction:1", { ts: TS + 2_000 }),
		toolRecord("tool:2", { ts: TS + 3_000 }),
		answerRecord("answer:1", { ts: TS + 4_000, settledAt: TS + 4_000 }),
	]);
	assert.equal(mounted.container.querySelectorAll("time").length, 1);
	assert.ok(
		rowBox(mounted, "answer:1").querySelector("time"),
		"the stamp is on the answer's own foot, since no single bar states the turn",
	);
	assert.match(rowBox(mounted, "answer:1").textContent, /Worked/);
});

test("a post-terminal reply is a follow-up bar AFTER the answer, with the completion mark", async (t) => {
	/*
	 * The operator's shape, minimal: the answer, the disposal marker and incident,
	 * a peer note, then one more short reply with its work. The answer must stay
	 * mounted with the turn's own foot; the reply's work is a labelled bar below.
	 */
	__resetTurnCollapseOpen();
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000 }),
		answerRecord("answer:1", { ts: TS + 2_000, settledAt: TS + 2_000 }),
		noticeRecord("marker:1", {
			ts: TS + 3_000,
			text: "Stopped with an error",
			level: "error",
		}),
		peerRecord("peer:1", { ts: TS + 4_000 }),
		toolRecord("tool:2", { ts: TS + 5_000 }),
		answerRecord("answer:2", {
			ts: TS + 6_000,
			settledAt: TS + 6_000,
			text: "Status note.",
		}),
	]);
	const bars = barsOf(mounted);
	assert.equal(bars.length, 2, "the turn's bar and the follow-up's");
	assert.equal(bars[0].hasAttribute("data-segment-complete"), false);
	assert.equal(
		bars[1].getAttribute("data-segment-complete"),
		"true",
		"only the follow-up is marked complete",
	);
	assert.match(bars[1].textContent, /Peer message/);
	assert.doesNotMatch(bars[1].textContent, /Peer note/, "the retired word");
	assert.ok(rowBox(mounted, "answer:1"), "the ANSWER stays mounted");
	assert.ok(
		rowBox(mounted, "answer:1").hasAttribute("data-turn-answer") ||
			rowBox(mounted, "answer:1").querySelector("[data-turn-answer]"),
		"and wears the answer mark",
	);
	assert.equal(
		mounted.container.querySelectorAll("[data-turn-answer]").length,
		1,
		"the status note does not",
	);
	const order = orderOf(mounted);
	assert.ok(
		order.indexOf("answer:1") < order.indexOf("marker:1") &&
			order.indexOf("marker:1") < order.indexOf("bar:peer:1"),
		`answer, marker, then the follow-up bar: ${order.join(" ")}`,
	);
});

test("the answer's rail is an opt-in setting: off by default, on under the key, always marked for rigs", async (t) => {
	/*
	 * `display.turn_answer_rail` through the component's own seam, the way the
	 * cross-session toggle above is driven: the query client is seeded with the
	 * two cache entries the app resolves, and one `setQueryData` per direction
	 * under the same mount is the operator flipping the setting in Settings.
	 * `data-turn-answer` is set from the election alone, so it must be present
	 * in every state (rigs read it instead of a class name); only the CLASSES
	 * follow the setting. Operator report 2026-09-30: the always-on 2px rule of
	 * #708 "looks ugly" and "cramped".
	 */
	__resetTurnCollapseOpen();
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const records = [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000 }),
		peerRecord("peer:1", { ts: TS + 2_000 }),
		answerRecord("answer:1", { ts: TS + 3_000, settledAt: TS + 3_000 }),
	];
	const answerEl = (mounted) =>
		mounted.container.querySelector("[data-turn-answer]");
	// No answer to the capabilities query at all: the fail-closed default.
	const mounted = await mount(t, records, { client });
	assert.ok(answerEl(mounted), "the election hook is set with no setting");
	assert.equal(answerEl(mounted).className.includes("border-l"), false);
	assert.equal(answerEl(mounted).className.includes("-ml-"), false);
	assert.ok(answerEl(mounted).className.includes("w-full"));

	const seed = async (settings) => {
		await act(async () => {
			client.setQueryData(desktopKeys.capabilities, {
				desktop_available: true,
				features: { settings: 1 },
			});
			client.setQueryData(backendSettingsKeys.all, { sections: [], settings });
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		await flushFrames();
	};
	await seed([{ key: "display.turn_answer_rail", value: true }]);
	const on = answerEl(mounted).className;
	assert.match(on, /\bborder-hairline\b/);
	assert.match(on, /\bborder-l\b/);
	assert.match(on, /\bpl-3\b/);
	assert.match(on, /-ml-\[13px\]/, "margin nets rule + padding to zero");
	assert.doesNotMatch(on, /border-l-2|border-ink-dim|pl-1\.5/, "not #708's");
	assert.equal(
		mounted.container.querySelectorAll("[data-turn-answer]").length,
		1,
		"one elected answer",
	);

	/*
	 * THE CAPABILITY PLANE IS THE OTHER HALF OF FAIL-CLOSED (agent review round 1,
	 * R3; QA round 1, Q-1). A cached `true` plus a plane that stops advertising
	 * `settings` used to keep the rail on: `enabled: false` stops the query
	 * refetching but leaves the cache in place, and the hook read that cache. The
	 * rail must drop the moment the capability does, without waiting for a reload.
	 */
	await act(async () => {
		client.setQueryData(desktopKeys.capabilities, {
			desktop_available: true,
			features: {},
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	await flushFrames();
	assert.equal(
		answerEl(mounted).className.includes("border-l"),
		false,
		"a plane that stops advertising `settings` draws no rail, cached true or not",
	);
	assert.ok(answerEl(mounted), "the election hook is still set for rigs");

	await seed([{ key: "display.turn_answer_rail", value: true }]);
	/*
	 * TWO ticks, for the reason the cross-session toggle above gives: the query's
	 * notification is applied on a TASK and the row's repaint then queues a FRAME,
	 * and a capability flip re-enables the query, so the settle is one step later
	 * than the seeded-write path.
	 */
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	await flushFrames();
	assert.match(
		answerEl(mounted).className,
		/\bborder-hairline\b/,
		"the rail returns when the plane advertises `settings` again",
	);

	await seed([{ key: "display.turn_answer_rail", value: "true" }]);
	assert.equal(answerEl(mounted).className.includes("border-l"), false);
	assert.ok(answerEl(mounted), "still marked for rigs with the rail off");
	await seed([{ key: "display.shimmer", value: true }]);
	assert.equal(
		answerEl(mounted).className.includes("border-l"),
		false,
		"a backend without the key draws none",
	);
	await seed([{ key: "display.turn_answer_rail", value: false }]);
	assert.equal(answerEl(mounted).className.includes("border-l"), false);
});

test("a reveal names the bar that holds the row: data-segment-ids decides among several", async (t) => {
	__resetTurnCollapseOpen();
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000 }),
		compactionRecord("compaction:1", { ts: TS + 2_000 }),
		toolRecord("tool:2", { ts: TS + 3_000 }),
		answerRecord("answer:1", { ts: TS + 4_000, settledAt: TS + 4_000 }),
	]);
	const [first, second] = barsOf(mounted);
	assert.equal(first.getAttribute("data-segment-ids"), "tool:1");
	assert.equal(second.getAttribute("data-segment-ids"), "tool:2");
	assert.equal(
		first.getAttribute("data-run-ids"),
		second.getAttribute("data-run-ids"),
		"the run's ids stay whole on every bar (the existing contract)",
	);
});

/* ------------- pressing a bar keeps it where it was (UX U1) --------------- */

test("U1: opening a bar moves the scroller by exactly how far the bar moved, and only then", async (t) => {
	__resetTurnCollapseOpen();
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000 }),
		answerRecord("answer:1", { ts: TS + 2_000, settledAt: TS + 2_000 }),
	]);
	/*
	 * The transcript's own scroller: the harness hands `mounted.container` in as
	 * the ref, but React writes the real element over it, so the container itself
	 * is not what the effect scrolls.
	 */
	const region = mounted.container.querySelector(
		"[data-lo-canonical-transcript]",
	);
	assert.ok(region, "the scroller is mounted");
	const summary = bar(mounted);
	/*
	 * jsdom has no layout, so the bar's rect is stated: 300px into the scroller
	 * while shut, and 320px higher (-20) once its span is mounted above the
	 * pinned tail - the measured bottom-of-transcript case, where the browser's
	 * scroll anchoring does not hold the pressed bar.
	 */
	const real = summary.getBoundingClientRect;
	let drift = -320;
	summary.getBoundingClientRect = () => {
		const open =
			summary.querySelector("button")?.getAttribute("aria-expanded") === "true";
		const top = open ? 300 + drift : 300;
		return { top, bottom: top + 33, left: 0, right: 0, width: 0, height: 33 };
	};
	region.scrollTop = 0;
	await click(barTrigger(mounted));
	assert.equal(
		region.scrollTop,
		-320,
		"the scroller follows the bar down by the 320px it moved (reversed axis: negative)",
	);
	// Where the browser already held the bar the delta is zero: no write.
	await click(barTrigger(mounted)); // closes
	region.scrollTop = 0;
	drift = 0;
	await click(barTrigger(mounted));
	assert.equal(region.scrollTop, 0, "an anchored bar is left alone");
	summary.getBoundingClientRect = real;
});

/* -------- a live ladder: bars above, the running turn untouched (D5) ------- */

test("D5: a turn still running keeps every row while the turns above it wear their ladders", async (t) => {
	__resetTurnCollapseOpen();
	const mounted = await mount(
		t,
		[
			userRecord("user:1"),
			toolRecord("tool:1", { ts: TS + 1_000, durationS: 4 }),
			compactionRecord("compaction:1", { ts: TS + 2_000 }),
			toolRecord("tool:2", { ts: TS + 3_000, durationS: 6 }),
			answerRecord("answer:1", { ts: TS + 4_000, settledAt: TS + 4_000 }),
			userRecord("user:2", { ts: TS + 5_000 }),
			toolRecord("tool:3", { ts: TS + 6_000, durationS: 2 }),
			compactionRecord("compaction:2", { ts: TS + 7_000 }),
			toolRecord("tool:4", { ts: TS + 8_000, durationS: 2 }),
		],
		{ waiting: true },
	);
	const bars = barsOf(mounted);
	assert.equal(
		bars.length,
		2,
		"the settled turn's two bars, none for the live one",
	);
	assert.deepEqual(
		bars.map((node) => node.getAttribute("data-segment-ids")),
		["tool:1", "tool:2"],
	);
	assert.match(bars[0].textContent, /Took 4s/);
	assert.match(bars[1].textContent, /Took 6s/);
	for (const id of ["tool:3", "compaction:2", "tool:4"]) {
		assert.ok(rowBox(mounted, id), `${id} stays mounted while the turn runs`);
	}
});

/* --------------- the mark's name, and the close's compensation -------------- */

test("QA-1/QA-3: the completion word ends the bar's accessible name, and only where it is earned", async (t) => {
	/*
	 * The mark itself is an `aria-hidden` glyph, so without words the fact it
	 * states is unavailable to a screen-reader user. The words join the trigger's
	 * own accessible name (the button carries no `aria-label`, so its content IS
	 * its name) - and the ORDER is the claim: they come after the facts, read the
	 * way the row renders, so a marked bar is `Peer message Took 1s 1 action
	 * completed` rather than a word wedged between the label and its count. The
	 * unlabelled marked shape (a resync window's bar) reads `Took 9s 8 actions
	 * completed` by the same rule, which is why the assertion below is on the LAST
	 * part rather than on a full literal alone.
	 *
	 * The name is computed the way an accessibility tree computes it: document
	 * order, `aria-hidden` subtrees dropped, an `aria-label` standing in for its
	 * subtree. jsdom has no AX tree, so this is the closest faithful reading; the
	 * strings were cross-checked against QA round 3's AX read.
	 */
	const nameParts = (node) => {
		const parts = [];
		const walk = (n) => {
			if (n.nodeType === 3) {
				const text = n.textContent.replace(/\s+/g, " ").trim();
				if (text) parts.push(text);
				return;
			}
			if (n.nodeType !== 1) return;
			if (n.getAttribute("aria-hidden") === "true") return;
			const label = n.getAttribute("aria-label");
			if (label) {
				parts.push(label);
				return;
			}
			for (const child of n.childNodes) walk(child);
		};
		walk(node);
		return parts;
	};

	__resetTurnCollapseOpen();
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000, durationS: 1 }),
		compactionRecord("compaction:1", { ts: TS + 2_000 }),
		toolRecord("tool:2", { ts: TS + 3_000, durationS: 2 }),
		answerRecord("answer:1", { ts: TS + 4_000, settledAt: TS + 4_000 }),
		noticeRecord("marker:1", {
			ts: TS + 5_000,
			text: "Stopped with an error",
			level: "error",
		}),
		peerRecord("peer:1", { ts: TS + 6_000 }),
		toolRecord("tool:3", { ts: TS + 7_000, durationS: 1 }),
		answerRecord("answer:2", {
			ts: TS + 8_000,
			settledAt: TS + 8_000,
			text: "Status note.",
		}),
	]);
	const bars = barsOf(mounted);
	assert.equal(bars.length, 3);
	const parts = bars.map((node) => nameParts(node.querySelector("button")));
	/*
	 * Joined with a single space, which is how an accessibility tree renders the
	 * parts: these three strings are the names QA round 3 read off the AX tree of
	 * the real app.
	 */
	const names = parts.map((list) => list.join(" "));
	assert.deepEqual(
		names,
		[
			"Took 1s 1 action",
			"Took 2s 1 action",
			"Peer message Took 1s 1 action completed",
		],
		"the unmarked bars claim nothing; the marked one names its completion last",
	);
	const [first, second, marked] = parts;
	for (const [index, parts] of [first, second, marked].entries()) {
		assert.equal(
			parts.includes("completed"),
			index === 2,
			`bar ${index}: the word appears only where the mark is earned`,
		);
	}
	assert.equal(
		marked.at(-1),
		"completed",
		"and it ends the name, which is what makes an unlabelled marked bar read `Took 9s 8 actions completed`",
	);
	assert.ok(
		marked.indexOf("completed") > marked.indexOf("1 action"),
		"the word follows the facts, not the label",
	);
});

test("QA-2: closing a bar returns the reader's place, one acknowledged write per movement", async (t) => {
	__resetTurnCollapseOpen();
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000 }),
		answerRecord("answer:1", { ts: TS + 2_000, settledAt: TS + 2_000 }),
	]);
	const region = mounted.container.querySelector(
		"[data-lo-canonical-transcript]",
	);
	assert.ok(region, "the scroller is mounted");
	const summary = bar(mounted);
	/*
	 * The measured close: the span's rows unmount and the bar drops back down the
	 * viewport by the span's length (QA round 2 measured ~2.5 span-lengths of
	 * drift on a real press). Stated here as a 320px step, so the compensation is
	 * read as an exact number.
	 */
	/*
	 * The bar's position follows the DISCLOSURE's own state, as it does in the
	 * browser: a press flips `aria-expanded` synchronously, and the commit that
	 * mounts (or unmounts) the span is what moves the bar.
	 */
	const isOpen = () =>
		summary.querySelector("button")?.getAttribute("aria-expanded") === "true";
	summary.getBoundingClientRect = () => {
		const top = isOpen() ? -20 : 300;
		return { top, bottom: top + 33, left: 0, right: 0, width: 0, height: 33 };
	};
	region.scrollTop = 0;
	/*
	 * Counted from here, so the seed above is not a movement: what the assertions
	 * count is what the reader's two presses move, and the values are the offsets
	 * the component assigns (`scrollTop += moved`).
	 */
	const writes = [];
	let held = region.scrollTop;
	Object.defineProperty(region, "scrollTop", {
		configurable: true,
		get: () => held,
		set: (value) => {
			writes.push(value);
			held = value;
		},
	});
	await click(barTrigger(mounted));
	await click(barTrigger(mounted)); // re-press: the same button closes it
	assert.equal(
		writes.length,
		2,
		`one write per movement; got ${JSON.stringify(writes)}`,
	);
	assert.deepEqual(
		writes,
		[-320, 0],
		"the open writes where the bar moved to, the close writes the reader's place back",
	);
	assert.equal(region.scrollTop, 0, "the reader's place is returned to them");
});
