import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
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
/*
 * Patterns the assertions below match against, hoisted to module scope so each
 * is compiled once (`lint/performance/useTopLevelRegex`). None carries the `g`
 * or `y` flag, so reusing one across calls has no `lastIndex` state to leak.
 */
const BORDER_HAIRLINE_RE = /\bborder-hairline\b/;
const BORDER_L_RE = /\bborder-l\b/;
const FAILED_I_RE = /failed/i;
const IMAGE_COUNT_RE = /\d+ images?/;
const MORE_IMAGES_RE = /more images?/;
const NEGATIVE_MARGIN_13PX_RE = /-ml-\[13px\]/;
const ONE_ACTION_RE = /1 action/;
const PEER_MESSAGE_RE = /Peer message/;
const PEER_NOTE_RE = /Peer note/;
const PLUS_ACTIONS_RE = /\+ actions/;
const PL_3_RE = /\bpl-3\b/;
const RETIRED_RULE_CLASSES_RE = /border-l-2|border-ink-dim|pl-1\.5/;
const THREE_IMAGES_RE = /3 images/;
const TOOK_3S_RE = /Took 3s/;
const TOOK_4S_RE = /Took 4s/;
const TOOK_6S_RE = /Took 6s/;
const TOOK_RE = /Took/;
const TURN_CONDENSED_RE = /Turn condensed: took 3s, 1 action\./;
const TWO_IMAGES_RE = /2 images/;
const TWO_PLUS_ACTIONS_RE = /2\+ actions/;
const WORKED_RE = /Worked/;

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
			'export { applyEvent, applyHistoryPage, EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";',
			'export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";',
			'export { __resetTurnCollapseOpen, writeRunExpanded, expandedRunsOf, forgetTurnCollapseOpen, __turnCollapseOpenStats } from "./src/renderer/src/shared/store/turn-collapse-open";',
			/* The settle latch's store: the per-test reset the latch cases below owe, exactly as the expansions' is owed. */
			'export { __resetWatchedRuns, watchedRunOf, writeWatchedRun } from "./src/renderer/src/shared/store/turn-collapse-watched";',
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
	applyEvent,
	applyHistoryPage,
	EMPTY_TRANSCRIPT,
	CanonicalTranscript,
	__resetTurnCollapseOpen,
	writeRunExpanded,
	expandedRunsOf,
	forgetTurnCollapseOpen,
	__turnCollapseOpenStats,
	__resetWatchedRuns,
	watchedRunOf,
	writeWatchedRun,
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
						attachmentScope: nextOver.attachmentScope,
						transcript: {
							...transcriptOf(next),
							hasMore: nextOver.hasMore ?? false,
							viewEpoch: nextOver.viewEpoch,
						},
						openFrame: nextOver.openFrame,
						gate: nextOver.gate ?? null,
						waiting: nextOver.waiting ?? false,
						workingLine: nextOver.workingLine,
						loadingOlder: false,
						onLoadOlder: nextOver.onLoadOlder ?? (async () => true),
						containerRef: { current: mounted.container },
						isSmallView: nextOver.isSmallView ?? false,
						status: nextOver.status ?? "live",
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
		TOOK_3S_RE,
		"the call's own reported seconds - the foot's quantity, not a wall span",
	);
	assert.match(summary.textContent, ONE_ACTION_RE);
	assert.ok(
		rowBox(mounted, "tool:1") === null,
		"the hidden row is unmounted, not merely hidden",
	);
	assert.ok(rowBox(mounted, "user:1"), "the opening message stays put");
	assert.ok(rowBox(mounted, "answer:1"), "and so does the answer");
	assert.doesNotMatch(
		mounted.container.textContent,
		WORKED_RE,
		"the foot line yields to the bar: one summary per turn",
	);
	/*
	 * TWO STAMPS, per message (operator, 2026-10-20): the reader's own message
	 * keeps its time on its action line, and the closing answer's re-homes to the
	 * bar with the foot it replaces. The answer-side count is what this test is
	 * about - one per turn, on the bar - and the reader's stamp is a different
	 * carrier with a different name.
	 */
	const userStamps = mounted.container.querySelectorAll(
		'time[data-stamp="turn"]',
	);
	assert.equal(userStamps.length, 1, "the user message states its own time");
	const answerStamps = mounted.container.querySelectorAll(
		'time[data-stamp="answer"]',
	);
	assert.equal(answerStamps.length, 1, "one answer stamp for the turn");
	assert.ok(
		summary.contains(answerStamps[0]),
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
	assert.ok(rowBox(mounted, "tool:1") === null, "collapsed by default");
	await click(barTrigger(mounted));
	assert.ok(rowBox(mounted, "tool:1"), "the press reveals the work");
	assert.ok(rowBox(mounted, "tool:2"), "all of it");
	assert.ok(bar(mounted), "the bar stays as the toggle");
	assert.doesNotMatch(
		mounted.container.textContent,
		WORKED_RE,
		"and the foot stays suppressed while open: the bar is still the summary",
	);
	await click(barTrigger(mounted));
	assert.ok(
		rowBox(mounted, "tool:1") === null,
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
	assert.ok(
		rowBox(other, "tool:1") === null,
		"another conversation arrives collapsed: the store is keyed by conversation",
	);

	__resetTurnCollapseOpen();
	const fresh = await mount(t, records, { frontend: { session_id: "chat-a" } });
	assert.ok(
		rowBox(fresh, "tool:1") === null,
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
		FAILED_I_RE,
		"the tally is gone from the bar",
	);
	assert.ok(
		summary.querySelector("[data-failed-clause]") === null,
		"and with it the failure control",
	);
	await click(barTrigger(mounted));
	await flushFrames();
	const failedRow = rowBox(mounted, "tool:1");
	assert.ok(failedRow, "the failed row mounts on the press");
	assert.match(
		failedRow.textContent ?? "",
		FAILED_I_RE,
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
	assert.ok(
		rowBox(mounted, "tool:2") ===
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
	assert.ok(
		bar(mounted) !== null,
		"the aligned window holds the opening row, so the run condenses",
	);
	assert.doesNotMatch(
		mounted.container.textContent,
		WORKED_RE,
		"the bar replaces the foot line, as on any completed run",
	);
	assert.doesNotMatch(
		bar(mounted)?.textContent ?? "",
		PLUS_ACTIONS_RE,
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
		TWO_PLUS_ACTIONS_RE,
		"a partial count is marked: `2+ actions`",
	);
	assert.doesNotMatch(
		summary.textContent ?? "",
		TOOK_RE,
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
		WORKED_RE,
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
	assert.ok(
		document.activeElement === trigger,
		"the reader's focus is in the row",
	);
	const settled = [
		...running,
		answerRecord("answer:1", { ts: TS + 3_000, settledAt: TS + 3_000 }),
	];
	await mounted.render(settled, {});
	assert.ok(
		bar(mounted) === null,
		"the settle does not fold the run out from under the focus",
	);
	assert.ok(rowBox(mounted, "tool:1"), "the focused row stays mounted");
	assert.ok(document.activeElement === trigger, "and the focus is intact");
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
		TURN_CONDENSED_RE,
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
	assert.ok(
		rowBox(mounted, "tool:1") === null,
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
	assert.ok(
		rowBox(mounted, "peer:1") === null,
		"the peer receipt hides while collapsed",
	);
	assert.ok(
		rowBox(mounted, "wake:1") === null,
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
	assert.ok(
		rowBox(mounted, "tool:1") === null,
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
		TWO_IMAGES_RE,
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
	assert.ok(
		bar(mounted)?.querySelector("[data-fold-media]") === null,
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
	assert.ok(
		bar(mounted)?.querySelector("[data-fold-media]") === null,
		"no pictures, no strip",
	);
	assert.doesNotMatch(
		bar(mounted)?.textContent ?? "",
		IMAGE_COUNT_RE,
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
		MORE_IMAGES_RE.test(control.getAttribute("aria-label") ?? ""),
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
	assert.ok(document.activeElement === count, "the reader is on the count");
	await click(count);
	assert.ok(
		bar(mounted)?.querySelector("[data-fold-media]") === null,
		"the press opened the block and the strip - with the control - unmounted",
	);
	const trigger = barTrigger(mounted);
	assert.equal(trigger.getAttribute("aria-expanded"), "true");
	assert.ok(
		document.activeElement === trigger,
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
		THREE_IMAGES_RE,
		"the bar states the span's count",
	);
	assert.doesNotMatch(
		group.textContent ?? "",
		IMAGE_COUNT_RE,
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
		groups.map((node) => (node.textContent ?? "").match(IMAGE_COUNT_RE)?.[0]),
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
		MORE_IMAGES_RE.test(control.getAttribute("aria-label") ?? ""),
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
			MORE_IMAGES_RE.test(control.getAttribute("aria-label") ?? ""),
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
	 * composition, in two halves: nothing condenses while the gate is set, and
	 * the cleared gate alone does not fold the run either - the flip moves
	 * nothing for a run the pane has watched (the settle latch, operator report
	 * 2026-10-16; the assertion that used to sit here pinned the pre-latch
	 * reading, a bare flip folding the run and the resume unfolding it again).
	 * A structural end - the stopped notice - still condenses it, which is what
	 * keeps the latch from meaning "never fold".
	 */
	__resetTurnCollapseOpen();
	__resetWatchedRuns();
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
	assert.ok(
		bar(mounted) === null,
		"nothing condenses while the turn waits on the gate",
	);
	await mounted.render(parked, { gate: null });
	/*
	 * THE GATE-CLEAR BEAT IS THE SAME TRANSIENT CLASS (operator report,
	 * 2026-10-16). The assertion this replaces pinned a bare liveness flip as
	 * enough to condense - gate cleared, nothing running - and the resume then
	 * unfolded the run again: exactly the "condensed a parked turn and
	 * un-condensed it when the call resumed, with no reader action" pair D3's own
	 * story describes, minus the parked half. The settle latch (the model's
	 * `watchedRunId`) refuses that pair for a run the pane has watched being
	 * written, so the flip now moves nothing and only a STRUCTURAL end folds the
	 * run - here the stopped notice a gate abandonment actually lands with.
	 */
	assert.equal(
		bar(mounted),
		null,
		"the cleared gate alone does not fold a run the pane has watched",
	);
	assert.ok(
		rowBox(mounted, "tool:1"),
		"and its running row stays on screen through the beat",
	);
	await mounted.render(
		[...parked, noticeRecord("notice:1", { text: "Interrupted" })],
		{ gate: null },
	);
	assert.ok(
		bar(mounted),
		"a real end (the stopped notice) still condenses the run",
	);
});

test("the settle latch: a steering re-entry cannot move a watched run's hides (operator report, 2026-10-16)", async (t) => {
	/*
	 * THE MOUNTED REPRO. The operator: "when I send a steering message, it
	 * alternates between condensing the messages before it and expanding them".
	 * The model half is pinned in `turn-collapse-model.test.mjs`; this is the
	 * shipped transcript, driven through the real render path, standing in for
	 * the live send the mock backend cannot hold.
	 *
	 * THE SEQUENCE: a turn whose first cycle settled (`answer:1`), mid-work
	 * after it, the reader's steer on screen, more work after it - the shape a
	 * steer actually lands in (`steering is NOT marked on the durable wire`,
	 * `transcript-rows.ts`): the steer folds INTO the run while its tail is
	 * mid-work, and it is visible at its arrival slot (V3, `partitionRun`).
	 * Then the liveness flag dips - the runtime's `frontend.streaming` reads
	 * false for a beat at a tool-segment boundary (`scripts/stt-dictation-proof.mjs`
	 * sampled exactly that through a real steer send) - and comes back, twice.
	 * No reader action, no row change: the plan must not move, and the same
	 * sequence without the latch is what the fix removes (the dip used to bar
	 * t2/t3 and the re-entry handed them back).
	 */
	__resetTurnCollapseOpen();
	__resetWatchedRuns();
	const frontend = { session_id: "chat-steer" };
	const steered = [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000, durationS: 3 }),
		answerRecord("answer:1", {
			ts: TS + 3_000,
			settledAt: TS + 3_000,
			stopReason: "stop",
		}),
		toolRecord("tool:2", { ts: TS + 4_000, durationS: 4 }),
		userRecord("user:2", { ts: TS + 5_000, text: "also check the ledger" }),
		toolRecord("tool:3", { ts: TS + 6_000, durationS: 5 }),
	];
	const mounted = await mount(t, steered, { frontend, waiting: true });
	const barIds = () =>
		barsOf(mounted).map((element) => element.getAttribute("data-record-id"));
	assert.deepEqual(
		barIds(),
		["tool:1"],
		"the settled span wears its bar; the work around the steer draws in place",
	);
	assert.ok(
		rowBox(mounted, "tool:2"),
		"the work before the steer is on screen",
	);
	assert.ok(rowBox(mounted, "user:2"), "the steer itself is on screen");
	assert.ok(rowBox(mounted, "tool:3"), "and the work after it");
	/*
	 * The latch's own write, pinned where it is owed: the live pass armed the
	 * latch for THIS conversation, naming the watched run by its opening row id.
	 */
	assert.equal(
		watchedRunOf("chat-steer"),
		"user:1",
		"the live pass latched the watched run, by its opening row id",
	);
	// THE DIP, THE RE-ENTRY, A SECOND DIP: one plan throughout.
	await mounted.render(steered, { frontend, waiting: false });
	assert.deepEqual(
		barIds(),
		["tool:1"],
		"the dip adds no bar: nothing the reader was watching folds",
	);
	assert.ok(rowBox(mounted, "tool:2"), "t2 stays mounted through the dip");
	assert.ok(rowBox(mounted, "tool:3"), "t3 stays mounted through the dip");
	await mounted.render(steered, { frontend, waiting: true });
	await mounted.render(steered, { frontend, waiting: false });
	assert.deepEqual(barIds(), ["tool:1"], "a second dip reaches the same plan");
	assert.ok(rowBox(mounted, "tool:2"), "and nothing was handed back or taken");
	// A STRUCTURAL END STILL FOLDS: the turn's answer lands.
	const delivered = [
		...steered,
		answerRecord("answer:2", {
			ts: TS + 8_000,
			settledAt: TS + 8_000,
			stopReason: "stop",
		}),
	];
	await mounted.render(delivered, { frontend, waiting: false });
	assert.deepEqual(
		barIds(),
		["tool:1", "tool:2", "tool:3"],
		"the answer - a row the run itself states - condenses the work it settles",
	);
	assert.equal(
		rowBox(mounted, "tool:2"),
		null,
		"and the rows move behind their bars once",
	);
});

test("a fresh pane's first pass cannot fold a run whose rows say it is still writing (operator report, 2026-10-21)", async (t) => {
	/*
	 * THE OTHER HALF OF THE SAME FLICKER. The latch above is written by a LIVE
	 * pass, in an effect, after a paint. A pane whose first pass is not live -
	 * a first open before the runtime publishes `streaming`, or the reconnect
	 * arm's `frontend: null`, which drops `working` AND the latch's own store
	 * key - has no latch to protect it, and the 2026-10-16 fix could not reach
	 * it. What is left is the rows, and they state it plainly: a streaming
	 * assistant row and an unfinished call cannot be a finished turn's last
	 * word.
	 *
	 * THE SEQUENCE: the dip FIRST (the state the flicker is painted in), then
	 * the live flag arriving. The plan must already be the correct one on the
	 * dip, so the live pass adds nothing and takes nothing.
	 */
	__resetTurnCollapseOpen();
	__resetWatchedRuns();
	const frontend = { session_id: "chat-fresh-dip" };
	const rows = [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000, durationS: 3 }),
		answerRecord("answer:1", {
			ts: TS + 3_000,
			settledAt: TS + 3_000,
			stopReason: "stop",
		}),
		toolRecord("tool:2", { ts: TS + 4_000, phase: "running" }),
		answerRecord("answer:2", {
			ts: TS + 5_000,
			text: "Streaming the rest",
			streaming: true,
		}),
	];
	const mounted = await mount(t, rows, { frontend, waiting: false });
	const barIds = () =>
		barsOf(mounted).map((element) => element.getAttribute("data-record-id"));
	assert.equal(
		watchedRunOf("chat-fresh-dip"),
		null,
		"this pane has no latch: the first pass is not live",
	);
	assert.deepEqual(
		barIds(),
		["tool:1"],
		"only the settled span is barred; the run in flight draws in place",
	);
	assert.ok(rowBox(mounted, "tool:2"), "the running call is on screen");
	assert.ok(rowBox(mounted, "answer:2"), "and so is the text being written");
	// The live flag arrives: the same plan, so nothing repaints.
	await mounted.render(rows, { frontend, waiting: true });
	assert.deepEqual(barIds(), ["tool:1"], "the live pass moves nothing");
	assert.ok(rowBox(mounted, "tool:2"), "t2 was never handed to a bar");
	assert.ok(
		rowBox(mounted, "answer:2"),
		"and the streaming row never vanished",
	);
	// THE ROWS SETTLE: the turn condenses once, because its data changed.
	const settled = rows.map((record) =>
		record.id === "answer:2"
			? { ...record, streaming: false }
			: record.id === "tool:2"
				? { ...record, phase: "done", endedAt: TS + 6_000 }
				: record,
	);
	await mounted.render(settled, { frontend, waiting: false });
	assert.deepEqual(
		barIds(),
		["tool:1", "tool:2"],
		"the settled run condenses once, on the pass that settles it",
	);
});

test("a reconnect frame cannot collapse the reader's opened bar (operator report, 2026-10-21)", async (t) => {
	/*
	 * THE OTHER VISIBLE FRAME OF THE SAME REPAINT. A reconnect sets
	 * `frontend: null` for the whole gap (`use-canonical-session`'s gap arm), and
	 * the reader's stores used to be keyed off that raw id: every opened bar
	 * snapped shut, and opened again when the snapshot repopulated - text the
	 * reader had just chosen to see, replaced for a frame or two and handed back.
	 * The key is sticky now (`conversationKey`), the rule the fold registry in the
	 * same file has always used.
	 */
	__resetTurnCollapseOpen();
	__resetWatchedRuns();
	const frontend = { session_id: "chat-gap" };
	const rows = [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000, durationS: 3 }),
		answerRecord("answer:1", {
			ts: TS + 3_000,
			settledAt: TS + 3_000,
			stopReason: "stop",
		}),
	];
	const mounted = await mount(t, rows, { frontend });
	const trigger = barTrigger(mounted);
	await click(trigger);
	assert.equal(
		trigger.getAttribute("aria-expanded"),
		"true",
		"the reader opened the bar",
	);
	assert.ok(rowBox(mounted, "tool:1"), "and its rows are on screen");
	// THE GAP: frontend goes away entirely, exactly as the reconnect arm writes it.
	await mounted.render(rows, { frontend: null, waiting: false });
	assert.equal(
		barTrigger(mounted).getAttribute("aria-expanded"),
		"true",
		"the gap does not close a bar the reader opened",
	);
	assert.ok(
		rowBox(mounted, "tool:1"),
		"and does not take the rows back behind it",
	);
	// The snapshot returns on the same conversation: still open, still one press.
	await mounted.render(rows, { frontend, waiting: false });
	assert.equal(
		barTrigger(mounted)?.getAttribute("aria-expanded"),
		"true",
		"the re-entry reads the same bucket",
	);
});

test("a turn that GROWS while the live flag is down stops condensing (operator frames, 2026-10-21)", async (t) => {
	/*
	 * THE SECOND MECHANISM BEHIND THE FRAMES. Captured from a live turn: the
	 * turn's rows out (the working line saying it is thinking), then the same
	 * turn painted as its bar a frame later, then out again.
	 *
	 * The plan's `anchored` falls back to the pane's instantaneous `live` in the
	 * gap between two calls, where no row is streaming and no call is in flight.
	 * A pane that never caught a live pass for this run holds no latch, so every
	 * dip alternates the whole turn. Growth of the newest run is the fact that
	 * does not dip: rows are appended only while the turn is being written.
	 *
	 * Prose between the calls keeps the TOOL-GROUP tier out of this fixture
	 * (`foldRuns` only folds a run of three or more adjacent actions), so the bar
	 * these assertions are about is the turn's own.
	 *
	 * WHAT THIS PROVES, EXACTLY (agent review round 1, M2): the assertion is the
	 * state after the arming pass has committed - the growth pass renders once
	 * unarmed and the effect's setState re-renders it armed - so it proves the
	 * turn does not STAY condensed once growth is observed, not that the very first
	 * frame of the append is already expanded. The frame between the two is the
	 * pass the effect cannot preempt.
	 */
	const prose = (id) => ({
		kind: "assistant",
		id,
		ts: TS,
		text: "Working through it.",
		streaming: false,
		stopReason: null,
	});
	const records = [
		userRecord("grow-user"),
		toolRecord("grow-t0"),
		prose("grow-p0"),
		toolRecord("grow-t1"),
		prose("grow-p1"),
	];
	const over = { frontend: { session_id: "synthetic-grow" }, waiting: false };
	__resetWatchedRuns();
	const mounted = await mount(t, records, over);
	assert.ok(
		bar(mounted) !== null,
		"the baseline pass paints the turn's bar (no latch before growth)",
	);
	await mounted.render(
		[...records, prose("grow-p2"), toolRecord("grow-t2")],
		over,
	);
	assert.ok(
		bar(mounted) === null,
		"a run that gained a row is being written: no bar while the flag is down",
	);
	assert.ok(
		rowBox(mounted, "grow-t2") !== null,
		"the new row is painted in place",
	);

	/*
	 * AND A PAGE LANDING ABOVE IS NOT GROWTH (QA round 1, Q-F1). Loading older
	 * history lengthens a head-cut run too, but the reader asked for it and no
	 * turn is being written; only a row appended at the TAIL moves the run's last
	 * id, which is the append this arm is about.
	 */
	__resetWatchedRuns();
	const page = await mount(
		t,
		[
			userRecord("page-old"),
			toolRecord("page-t0"),
			prose("page-p0"),
			toolRecord("page-t1"),
		],
		{ frontend: { session_id: "synthetic-page" }, waiting: false },
	);
	assert.ok(bar(page) !== null, "the page fixture starts collapsed");
	await page.render(
		[
			userRecord("page-cut"),
			toolRecord("page-t-1"),
			userRecord("page-old"),
			toolRecord("page-t0"),
			prose("page-p0"),
			toolRecord("page-t1"),
		],
		{ frontend: { session_id: "synthetic-page" }, waiting: false },
	);
	assert.ok(
		bar(page) !== null,
		"older rows landing above a finished run do not arm the latch",
	);
});

test("a job response cannot reopen a tool group the pane has already folded (operator report, 2026-10-21)", async (t) => {
	/*
	 * THE REPORT: "some of the job messages/responses will alternate between
	 * forcing the tool group open and then closing it back again".
	 *
	 * The licensing rule is positional - a run folds on its TRAILING receipt
	 * stretch - so one continuous run changed shape on every job response:
	 * `[t1, j1, j2]` folds, the next call ends the stretch and the rows paint
	 * loose, two more receipts fold it again. This drives the SHIPPED transcript
	 * and asserts the reader-visible consequence: the tool rows stay unmounted
	 * while the turn is live, and the group's header carries the new call.
	 */
	__resetTurnCollapseOpen();
	__resetWatchedRuns();
	const job = (id) => ({
		kind: "custom",
		id,
		ts: TS + 1_000,
		customType: "job_result",
		text: "job finished",
		attribution: "job",
	});
	const frontend = { session_id: "chat-job-fold" };
	const first = [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000, durationS: 3 }),
		job("job:1"),
		job("job:2"),
	];
	const mounted = await mount(t, first, { frontend, waiting: true });
	const folded = () =>
		rowBox(mounted, "tool:1") === null && rowBox(mounted, "tool:2") === null;
	assert.equal(
		rowBox(mounted, "tool:1"),
		null,
		"the wall folds on its trailing receipts",
	);
	// The next call arrives: the run's trailing stretch ends, and the group used
	// to open here.
	const withCall = [
		...first,
		toolRecord("tool:2", { ts: TS + 2_000, durationS: 4 }),
	];
	await mounted.render(withCall, { frontend, waiting: true });
	assert.ok(folded(), "the new call did not reopen the fold");
	assert.ok(
		mounted.container.textContent?.includes("2 shell"),
		"and the header counts it instead",
	);
	// Two more job responses: still one group, still closed.
	await mounted.render([...withCall, job("job:3"), job("job:4")], {
		frontend,
		waiting: true,
	});
	assert.ok(folded(), "a further receipt pair did not refold from scratch");
	/*
	 * A RECONNECT GAP IS NOT A SETTLE (design review round 1, U1). With no
	 * snapshot the pane has observed nothing about the turn, so the latch is
	 * retained and the group stays closed; the clear used to run here and the
	 * return pass folded it again - the same open/close for a reader who only
	 * watched the connection blink.
	 */
	await mounted.render(withCall, {
		frontend: null,
		waiting: false,
		status: "reconnecting",
	});
	assert.ok(folded(), "the group stayed folded through the gap");
	await mounted.render([...withCall, job("job:5")], {
		frontend,
		waiting: true,
	});
	assert.ok(folded(), "and the return pass did not refold from scratch");
	// THE LATCH IS LIVE-ONLY: on the settled list the final rows decide, so the
	// run with no trailing receipts paints its rows again - one transition, at
	// the turn's end, not on every response.
	await mounted.render(withCall, { frontend, waiting: false });
	assert.ok(
		rowBox(mounted, "tool:1") !== null,
		"settled, the same rows paint as ordinary rows",
	);
});

test("a child reader's null snapshot is not a gap: its settle releases the fold (agent review round 4)", async (t) => {
	/*
	 * THE RUN PANEL'S CHILD READER passes `frontend: null` for its whole life
	 * with `status: "live"`. Reading the gap off the SNAPSHOT therefore held its
	 * fold across the settle, and a finished child turn never painted its rows;
	 * the pane's own `status` is the signal. This case mounts the reader's exact
	 * prop shape and drives its live frame and its settle, so a revert of the
	 * status reading fails HERE - the earlier assertion in the job-fold case runs
	 * after a connected settle has already spent the latch and cannot see it.
	 */
	__resetTurnCollapseOpen();
	__resetWatchedRuns();
	const job = (id) => ({
		kind: "custom",
		id,
		ts: TS + 1_000,
		customType: "job_result",
		text: "job finished",
		attribution: "job",
	});
	const records = [
		userRecord("child:u"),
		toolRecord("child:1"),
		job("child:j1"),
		job("child:j2"),
	];
	const live = {
		frontend: null,
		status: "live",
		workingLine: { activity: "running", phase: "running" },
	};
	const child = await mount(t, records, live);
	assert.ok(
		rowBox(child, "child:1") === null,
		"the child's live frame folds the wall",
	);
	/*
	 * The settle frame ends the receipt stretch with a call (`[t1, j1, j2, t2]`):
	 * two actions, no trailing receipt pair, so the rows only stay folded if the
	 * latch is still consulted - which is what a snapshot-derived gap did.
	 */
	await child.render([...records, toolRecord("child:2", { ts: TS + 2_000 })], {
		frontend: null,
		status: "live",
	});
	assert.ok(
		rowBox(child, "child:1") !== null,
		"and its settle paints the rows",
	);
});

test("a reconnect gap cannot fold a run the pane was watching (operator report, 2026-10-21)", async (t) => {
	/*
	 * THE LATCH HALF, MEASURED WHERE IT IS PAINTED (review round 2, M1). The
	 * previous case proves the reader's EXPANSIONS survive a `frontend: null`
	 * pass - which the store held even on the base, so it does not discriminate.
	 * This one does: a run mid-flight after its first settled cycle has no
	 * live-phase row (every call reported, no answer yet), so only the settle
	 * latch can keep it open. The pane arms it on the live pass; the gap must not
	 * drop it, or the work after the settled answer folds behind a bar and comes
	 * back with the snapshot.
	 */
	__resetTurnCollapseOpen();
	__resetWatchedRuns();
	const frontend = { session_id: "chat-gap-latch" };
	const rows = [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000, durationS: 3 }),
		answerRecord("answer:1", {
			ts: TS + 3_000,
			settledAt: TS + 3_000,
			stopReason: "stop",
		}),
		toolRecord("tool:2", { ts: TS + 4_000, durationS: 4 }),
	];
	const mounted = await mount(t, rows, { frontend, waiting: true });
	const barIds = () =>
		barsOf(mounted).map((element) => element.getAttribute("data-record-id"));
	assert.equal(
		watchedRunOf("chat-gap-latch"),
		"user:1",
		"the live pass latched the run it is watching",
	);
	assert.deepEqual(barIds(), ["tool:1"], "only the settled span is barred");
	assert.ok(rowBox(mounted, "tool:2"), "the work after the answer is in place");
	// THE GAP: frontend goes away, so the pane reads not-live.
	await mounted.render(rows, { frontend: null, waiting: false });
	assert.deepEqual(
		barIds(),
		["tool:1"],
		"the dip does not add a bar over the work being watched",
	);
	assert.ok(
		rowBox(mounted, "tool:2"),
		"and the work after the answer stays on screen through the gap",
	);
	// The snapshot returns: same plan, nothing handed back or taken.
	await mounted.render(rows, { frontend, waiting: false });
	assert.deepEqual(barIds(), ["tool:1"], "the re-entry reaches the same plan");
});

test("a steer before its lead-in's calls report does not condense the turn (operator report, 2026-10-21)", async (t) => {
	/*
	 * THE MOUNTED HALF OF THE LEAD-IN FIX (agent review round 1, U3): the model
	 * test says the run does not split, this says what the reader sees - the turn
	 * stays whole and drawn in place while it is being steered, and its steer row
	 * survives the condense when the closing answer lands.
	 */
	__resetTurnCollapseOpen();
	__resetWatchedRuns();
	const frontend = { session_id: "chat-lead-in" };
	const rows = [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000, durationS: 3 }),
		answerRecord("answer:1", {
			ts: TS + 3_000,
			text: "Reading the ledger first.",
			settledAt: TS + 3_000,
			stopReason: "toolUse",
			callsTools: true,
		}),
		userRecord("user:2", { ts: TS + 4_000, text: "also check the ledger" }),
		toolRecord("tool:2", { ts: TS + 5_000, durationS: 4 }),
	];
	const mounted = await mount(t, rows, { frontend, waiting: true });
	const barIds = () =>
		barsOf(mounted).map((element) => element.getAttribute("data-record-id"));
	assert.deepEqual(
		barIds(),
		[],
		"the steer did not condense the turn it interrupted",
	);
	assert.ok(
		rowBox(mounted, "tool:1"),
		"the work before the steer is on screen",
	);
	assert.ok(rowBox(mounted, "user:2"), "and the steer itself");
	assert.ok(rowBox(mounted, "tool:2"), "and the work after it");
	// The closing answer lands: the turn condenses ONCE, and keeps its steer.
	await mounted.render(
		[
			...rows,
			answerRecord("answer:2", {
				ts: TS + 7_000,
				settledAt: TS + 7_000,
				stopReason: "stop",
			}),
		],
		{ frontend, waiting: false },
	);
	assert.ok(barIds().length > 0, "the finished turn wears its bar");
	assert.ok(
		rowBox(mounted, "user:2"),
		"and the steer stays on screen under it (V3)",
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
	assert.ok(
		document.activeElement === trigger,
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
	assert.ok(rowBox(mounted, "peer:1") === null, "the receipt is hidden");
	assert.ok(rowBox(mounted, "tool:2") === null, "the send row is hidden");
	assert.equal(
		bar(mounted)?.getAttribute("data-run-ids"),
		"user:1 tool:1 answer:1",
		"the bar's ids name only what the pane keeps",
	);
	// Expand: the work comes back, and the hidden send does NOT — the filter
	// sits above the collapse, so no interaction can reveal it.
	await click(barTrigger(mounted));
	assert.ok(rowBox(mounted, "tool:1"), "the ordinary call is revealed");
	assert.ok(rowBox(mounted, "tool:2") === null, "the send row stays gone");
	assert.ok(rowBox(mounted, "peer:1") === null, "the receipt stays gone");

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
	assert.ok(
		rowBox(mounted, "tool:1") === null,
		"the first span is still condensed",
	);
	assert.equal(
		barsOf(mounted)[0].querySelector("button").getAttribute("aria-expanded"),
		"false",
	);
});

test("one answer stamp per turn with several bars: the answer's foot keeps it", async (t) => {
	__resetTurnCollapseOpen();
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000 }),
		compactionRecord("compaction:1", { ts: TS + 2_000 }),
		toolRecord("tool:2", { ts: TS + 3_000 }),
		answerRecord("answer:1", { ts: TS + 4_000, settledAt: TS + 4_000 }),
	]);
	assert.equal(
		mounted.container.querySelectorAll('time[data-stamp="answer"]').length,
		1,
	);
	assert.equal(
		mounted.container.querySelectorAll('time[data-stamp="turn"]').length,
		1,
	);
	assert.ok(
		rowBox(mounted, "answer:1").querySelector('time[data-stamp="answer"]'),
		"the stamp is on the answer's own foot, since no single bar states the turn",
	);
	assert.match(rowBox(mounted, "answer:1").textContent, WORKED_RE);
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
	assert.match(bars[1].textContent, PEER_MESSAGE_RE);
	assert.doesNotMatch(bars[1].textContent, PEER_NOTE_RE, "the retired word");
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
	assert.match(on, BORDER_HAIRLINE_RE);
	assert.match(on, BORDER_L_RE);
	assert.match(on, PL_3_RE);
	assert.match(
		on,
		NEGATIVE_MARGIN_13PX_RE,
		"margin nets rule + padding to zero",
	);
	assert.doesNotMatch(on, RETIRED_RULE_CLASSES_RE, "not #708's");
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
		BORDER_HAIRLINE_RE,
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
	assert.match(bars[0].textContent, TOOK_4S_RE);
	assert.match(bars[1].textContent, TOOK_6S_RE);
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

/* ----- liveness is the in-flight cycle's: a wake does not un-condense (PR-4) ---- */

/*
 * THE OPERATOR'S JITTER REPORT (2026-10-01), mounted: "messages are condensed,
 * and then if a peer message or job completes and the agent goes into thinking,
 * the last condensed sequence suddenly un-condenses". A wake does not open a run
 * (only a user row does), so it re-opens the run that had just settled, and the
 * pane's `waiting` used to expand the whole of it.
 */
const settledTurn = [
	userRecord("user:1"),
	toolRecord("tool:1", { ts: TS + 1_000, durationS: 3 }),
	answerRecord("answer:1", {
		ts: TS + 3_000,
		settledAt: TS + 3_000,
		stopReason: "stop",
	}),
];
const wakeCycle = (extra = []) => [
	wakeRecord("wake:1", { ts: TS + 10_000 }),
	...extra,
];

test("PR-4: a wake re-opening a settled turn keeps its bar - the same element, still condensed - while the agent thinks", async (t) => {
	__resetTurnCollapseOpen();
	const mounted = await mount(t, settledTurn);
	const first = bar(mounted);
	assert.ok(first, "the settled turn arrives condensed");
	const region = () =>
		mounted.container.querySelector("[data-condense-announcement]")
			?.textContent ?? "";
	const states = [
		[...settledTurn, ...wakeCycle()],
		[
			...settledTurn,
			...wakeCycle([
				answerRecord("answer:2", {
					ts: TS + 11_000,
					streaming: true,
					text: "Checking the stag",
				}),
			]),
		],
		[
			...settledTurn,
			...wakeCycle([
				toolRecord("tool:2", {
					ts: TS + 11_000,
					phase: "running",
					output: null,
				}),
			]),
		],
	];
	for (const [i, records] of states.entries()) {
		await mounted.render(records, { waiting: true });
		assert.ok(
			bar(mounted) === first,
			`state ${i}: the bar is the same element`,
		);
		assert.ok(
			rowBox(mounted, "tool:1") === null,
			`state ${i}: its work is still unmounted`,
		);
		assert.equal(
			region(),
			"",
			`state ${i}: nothing is announced while the cycle runs`,
		);
	}
	// The in-flight cycle's own rows draw in place, below the bar.
	assert.ok(rowBox(mounted, "tool:2"), "the running call draws in place");
});

test("PR-4: the cycle settling adds ONE bar at the tail, announces once, and moves nothing above it", async (t) => {
	__resetTurnCollapseOpen();
	const mounted = await mount(t, settledTurn);
	const first = bar(mounted);
	const running = [
		...settledTurn,
		...wakeCycle([toolRecord("tool:2", { ts: TS + 11_000, durationS: 4 })]),
	];
	await mounted.render(running, { waiting: true });
	const region = () =>
		mounted.container.querySelector("[data-condense-announcement]")
			?.textContent ?? "";
	assert.equal(barsOf(mounted).length, 1, "one bar while the cycle runs");
	const settled = [
		...running,
		answerRecord("answer:2", {
			ts: TS + 15_000,
			settledAt: TS + 15_000,
			stopReason: "stop",
		}),
	];
	await mounted.render(settled, { waiting: false });
	assert.equal(barsOf(mounted).length, 2, "the settled cycle is now a bar");
	assert.ok(barsOf(mounted)[0] === first, "the first bar is the same element");
	assert.equal(
		barsOf(mounted)[1].getAttribute("data-record-id"),
		"wake:1",
		"the new bar sits at the tail, in the cycle's own first slot",
	);
	assert.equal(
		region(),
		"Wake: took 4s, 1 action.",
		"exactly one sentence, for the one new bar, in its own words (a labelled bar does not say 'Turn condensed' again)",
	);
	// Another token-less commit changes nothing.
	await mounted.render([...settled], { waiting: false });
	assert.equal(barsOf(mounted).length, 2);
});

test("the settle latch: a dip in a watched episode's cycle moves nothing, and the settle still adds its one bar and sentence", async (t) => {
	/*
	 * THE F2 DIP, MOUNTED (convergence round, 2026-10-17; the model half is
	 * `turn-collapse-model.test.mjs`'s dip-invariance case). Mid-cycle the
	 * runtime's `frontend.streaming` dips - measured through a real steer send,
	 * `scripts/stt-dictation-proof.mjs` - and the one-bar gate used to pause on
	 * the dip: a second bar flashed in and the re-entry took it back. The run is
	 * one the pane has WATCHED (the latch arms on the live pass below), so the
	 * dip must reach the plan the reader already has; the settle - a row that
	 * lands, not a flag that flaps - still adds the bar and its one sentence.
	 */
	__resetTurnCollapseOpen();
	__resetWatchedRuns();
	const frontend = { session_id: "chat-f2-dip" };
	const running = [
		...settledTurn,
		...wakeCycle([toolRecord("tool:2", { ts: TS + 11_000, durationS: 4 })]),
	];
	const mounted = await mount(t, running, { frontend, waiting: true });
	const first = bar(mounted);
	assert.equal(barsOf(mounted).length, 1, "one bar while the cycle runs");
	assert.equal(
		watchedRunOf("chat-f2-dip"),
		"user:1",
		"the live pass armed the latch for this conversation, by its opening row",
	);
	const region = () =>
		mounted.container.querySelector("[data-condense-announcement]")
			?.textContent ?? "";
	// THE DIP: one bar, the same element, the episode's row in place, silence.
	await mounted.render(running, { frontend, waiting: false });
	assert.equal(barsOf(mounted).length, 1, "the dip adds no bar");
	assert.ok(bar(mounted) === first, "the standing bar is the same element");
	assert.ok(rowBox(mounted, "tool:2"), "the episode's row stays in place");
	assert.equal(region(), "", "nothing is announced while the cycle runs");
	// THE RE-ENTRY reaches the same plan again.
	await mounted.render(running, { frontend, waiting: true });
	assert.equal(barsOf(mounted).length, 1, "the re-entry reaches the same bar");
	assert.ok(bar(mounted) === first);
	// THE SETTLE: the row that ends the cycle adds the second bar, and the one
	// sentence lands HERE, not at a dip.
	const settled = [
		...running,
		answerRecord("answer:2", {
			ts: TS + 15_000,
			settledAt: TS + 15_000,
			stopReason: "stop",
		}),
	];
	await mounted.render(settled, { frontend, waiting: false });
	assert.equal(barsOf(mounted).length, 2, "the settled cycle is now a bar");
	assert.ok(
		barsOf(mounted)[0] === first,
		"the standing bar is still the same element",
	);
	assert.equal(
		barsOf(mounted)[1].getAttribute("data-record-id"),
		"wake:1",
		"the new bar sits at the tail, in the cycle's own first slot",
	);
	assert.equal(
		region(),
		"Wake: took 4s, 1 action.",
		"exactly one sentence, and it arrives at the settle",
	);
});

test("the settle latch: a dip cannot speak a watched episode's sentence early - the sentence waits for the close", async (t) => {
	/*
	 * THE ANNOUNCE SEAM OF THE DIP (convergence round, 2026-10-17; the F2 case
	 * covers the gate). The announce effect read the pane's RAW quiet flag beside
	 * the episode's own settledness; on a dip the pane reads not-live for a beat,
	 * so an episode STILL BEING WRITTEN passed as settled: the sentence landed at
	 * the dip, its key was recorded, and the real settle went silent. The watched
	 * run's half now anchors like everything else in `planRun`: silence follows
	 * `internal.unsettled`, and only a landed close flips it.
	 */
	__resetTurnCollapseOpen();
	__resetWatchedRuns();
	const frontend = { session_id: "chat-f1-dip" };
	const rows = [
		userRecord("f1d-u"),
		answerRecord("f1d-a", {
			ts: TS + 2_000,
			settledAt: TS + 2_000,
			stopReason: "stop",
		}),
		peerRecord("f1d-p", { ts: TS + 3_000 }),
		toolRecord("f1d-t", { ts: TS + 4_000, durationS: 4 }),
	];
	const mounted = await mount(t, rows, { frontend, waiting: true });
	const first = bar(mounted);
	assert.equal(barsOf(mounted).length, 1, "the live episode is the one bar");
	assert.equal(
		watchedRunOf("chat-f1-dip"),
		"f1d-u",
		"the live pass armed the latch for this conversation",
	);
	const region = () =>
		mounted.container.querySelector("[data-condense-announcement]")
			?.textContent ?? "";
	assert.equal(region(), "", "nothing is announced while the cycle runs");
	assert.equal(
		first.getAttribute("data-segment-active"),
		"true",
		"while live it reads active",
	);
	// THE DIP: silent, same bar, same element, still active.
	await mounted.render(rows, { frontend, waiting: false });
	assert.equal(
		region(),
		"",
		"a dip does not speak the sentence early - no close has landed",
	);
	assert.equal(barsOf(mounted).length, 1, "the dip adds no bar");
	assert.ok(bar(mounted) === first, "the bar is the same element");
	assert.equal(
		bar(mounted).getAttribute("data-segment-active"),
		"true",
		"and it still reads active: the cycle still runs",
	);
	// THE RE-ENTRY: silent again.
	await mounted.render(rows, { frontend, waiting: true });
	assert.equal(region(), "", "nor the re-entry");
	// THE CLOSE LANDS: the one sentence, here.
	const settled = [
		...rows,
		answerRecord("f1d-a2", {
			ts: TS + 15_000,
			settledAt: TS + 15_000,
			stopReason: "stop",
		}),
	];
	await mounted.render(settled, { frontend, waiting: false });
	assert.equal(
		region(),
		"Peer message: took 4s, 1 action.",
		"the sentence lands once, at the close",
	);
	// AND NOT AGAIN: a further pass holds the same one sentence.
	await mounted.render(settled, { frontend, waiting: false });
	assert.equal(
		region(),
		"Peer message: took 4s, 1 action.",
		"the sentence does not repeat",
	);
	assert.equal(
		barsOf(mounted).length,
		1,
		"the settled episode keeps its one bar",
	);
});

test("PR-4: a bar the reader opened stays that bar, and open, across the wake and the settle", async (t) => {
	__resetTurnCollapseOpen();
	const mounted = await mount(t, settledTurn);
	await click(barTrigger(mounted));
	const opened = bar(mounted);
	assert.ok(rowBox(mounted, "tool:1"), "the reader opened the first bar");
	const running = [
		...settledTurn,
		...wakeCycle([toolRecord("tool:2", { ts: TS + 11_000, durationS: 4 })]),
	];
	await mounted.render(running, { waiting: true });
	assert.ok(bar(mounted) === opened, "the wake keeps the SAME bar element");
	assert.ok(rowBox(mounted, "tool:1"), "and it is still the one that is open");
	await mounted.render(
		[
			...running,
			answerRecord("answer:2", {
				ts: TS + 15_000,
				settledAt: TS + 15_000,
				stopReason: "stop",
			}),
		],
		{ waiting: false },
	);
	const bars = barsOf(mounted);
	assert.equal(bars.length, 2);
	assert.ok(bars[0] === opened, "the settle keeps it too");
	assert.equal(
		bars[0].querySelector("button").getAttribute("aria-expanded"),
		"true",
	);
	assert.equal(
		bars[1].querySelector("button").getAttribute("aria-expanded"),
		"false",
		"the NEW bar is not the open one: no stored key names a different span",
	);
	assert.ok(
		rowBox(mounted, "tool:1"),
		"the first span's row is still on screen",
	);
	assert.ok(rowBox(mounted, "tool:2") === null, "the new span is condensed");
});

test("PR-4: a stale expansion key of an older shape renders collapsed and does not throw", async (t) => {
	__resetTurnCollapseOpen();
	// What the in-memory store could still hold from the previous key shape: the
	// run's bare key (the answer's id) and a `<run key>#<row>` pair.
	writeRunExpanded("chat-stale", "answer:1", true);
	writeRunExpanded("chat-stale", "answer:1#tool:1", true);
	writeRunExpanded("chat-stale", "seg:no-such-row", true);
	const mounted = await mount(t, settledTurn, {
		frontend: { session_id: "chat-stale" },
	});
	assert.ok(bar(mounted), "the bar renders");
	assert.equal(
		bar(mounted).querySelector("button").getAttribute("aria-expanded"),
		"false",
		"a key that names nothing opens nothing",
	);
	assert.ok(rowBox(mounted, "tool:1") === null);
});

/* -------- reconciliation of #744 and #745: a bar keeps its identity (PR-4/PR-5) -------- */

/*
 * A bar's identity is DOM identity, so these tests tag the element the reader
 * pressed with an expando and look for the tag afterwards: a remount builds a new
 * element, so the tag is gone and the test fails, which a key-text assertion
 * cannot do (the review that prompted this found the earlier "same element"
 * assertion was never reached on base). `data-mount-tag` is an own property of the
 * jsdom element, never an attribute React could re-render.
 */
const tagged = (mounted) => {
	const element = bar(mounted);
	element.__mountTag = "pressed";
	return element;
};
const pressedBar = (mounted) =>
	barsOf(mounted).find((element) => element.__mountTag === "pressed") ?? null;

/*
 * Answers are declared `stop`, as every text-bearing assistant row in a journal is
 * (`transcript-reducer.ts` keeps the provider's stop_reason). That is not
 * decoration: an answer with NO declaration that a later step follows (no trigger
 * between them) is demoted to narration and absorbed into its span, which moves
 * the span's end and so its key - a hand-built-fixture-only shape, named as a
 * residual in `turn-segments.test.mjs`. #744's own tests used undeclared answers
 * and expected the later work to fold into the SAME bar; with a declared `stop` the
 * first answer stays on screen, so the later work is a SECOND bar after it.
 */
const stopAnswer = (id, ts) =>
	answerRecord(id, { ts, settledAt: ts, stopReason: "stop" });

test("RECONCILE (a): the bar the reader pressed is the SAME element - not a remount - after a wake and after the wake settles, and it is the one that is open", async (t) => {
	__resetTurnCollapseOpen();
	const first = [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000 }),
		toolRecord("tool:2", { ts: TS + 2_000 }),
		stopAnswer("answer:1", TS + 3_000),
	];
	const frontend = { session_id: "chat-reconcile-a" };
	const mounted = await mount(t, first, { frontend });
	await click(barTrigger(mounted));
	await flushFrames();
	assert.ok(rowBox(mounted, "tool:1"), "the reader opened it");
	const pressed = tagged(mounted);
	const wakeStates = [
		[...first, wakeRecord("wake:1", { ts: TS + 10_000 })],
		[
			...first,
			wakeRecord("wake:1", { ts: TS + 10_000 }),
			toolRecord("tool:3", { ts: TS + 11_000, phase: "running", output: null }),
		],
		[
			...first,
			wakeRecord("wake:1", { ts: TS + 10_000 }),
			toolRecord("tool:3", { ts: TS + 11_000 }),
			stopAnswer("answer:2", TS + 12_000),
		],
	];
	for (const [i, records] of wakeStates.entries()) {
		await mounted.render(records, { frontend, waiting: i < 2 });
		await flushFrames();
		assert.ok(
			pressedBar(mounted) === pressed,
			`state ${i}: the pressed bar is the element that was mounted (no remount)`,
		);
		assert.equal(
			pressed.querySelector("button").getAttribute("aria-expanded"),
			"true",
			`state ${i}: and it is still the open one`,
		);
		assert.ok(rowBox(mounted, "tool:1"), `state ${i}: its rows are shown`);
	}
	const bars = barsOf(mounted);
	assert.equal(bars.length, 2, "the settled wake cycle is a second bar");
	assert.equal(
		bars[1].querySelector("button").getAttribute("aria-expanded"),
		"false",
		"the stored key names the FIRST bar only; the wake's bar is not opened by it",
	);
	assert.ok(rowBox(mounted, "tool:3") === null, "the wake's work is condensed");
});

test("RECONCILE (a'): a later answer with no wake row between leaves the pressed bar mounted and open, and the later work is its own bar", async (t) => {
	__resetTurnCollapseOpen();
	const first = [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000 }),
		toolRecord("tool:2", { ts: TS + 2_000 }),
		stopAnswer("answer:1", TS + 3_000),
	];
	const frontend = { session_id: "chat-reconcile-a2" };
	const mounted = await mount(t, first, { frontend });
	await click(barTrigger(mounted));
	await flushFrames();
	const pressed = tagged(mounted);
	await mounted.render(
		[
			...first,
			toolRecord("tool:3", { ts: TS + 4_000 }),
			stopAnswer("answer:2", TS + 5_000),
		],
		{ frontend },
	);
	await flushFrames();
	assert.ok(
		pressedBar(mounted) === pressed,
		"the pressed bar was not remounted",
	);
	assert.ok(
		rowBox(mounted, "tool:1") && rowBox(mounted, "tool:2"),
		"still open",
	);
	assert.ok(
		rowBox(mounted, "tool:3") === null,
		"the later work is its own, condensed bar",
	);
	assert.equal(barsOf(mounted).length, 2);
});

test("RECONCILE (b)+(a): a head-cut bar the reader opened stays open and mounted when the head lands, and again when a later answer arrives", async (t) => {
	__resetTurnCollapseOpen();
	const frontend = { session_id: "chat-reconcile-b" };
	const cut = [
		toolRecord("tool:0", { ts: TS + 500 }),
		toolRecord("tool:1", { ts: TS + 1_000 }),
		stopAnswer("answer:1", TS + 2_000),
	];
	const mounted = await mount(t, cut, { frontend });
	await click(barTrigger(mounted));
	await flushFrames();
	assert.ok(rowBox(mounted, "tool:0"), "the reader opened the cut bar");
	const pressed = tagged(mounted);
	const headed = [userRecord("user:0", { ts: TS + 100 }), ...cut];
	await mounted.render(headed, { frontend });
	await flushFrames();
	assert.ok(
		pressedBar(mounted) === pressed,
		"the head landing did not remount it",
	);
	assert.ok(rowBox(mounted, "tool:0"), "and it is still open");
	await mounted.render(
		[
			...headed,
			toolRecord("tool:2", { ts: TS + 3_000 }),
			stopAnswer("answer:2", TS + 4_000),
		],
		{ frontend },
	);
	await flushFrames();
	assert.ok(pressedBar(mounted) === pressed, "nor did the later answer");
	assert.ok(
		rowBox(mounted, "tool:0") && rowBox(mounted, "tool:1"),
		"still open",
	);
});

test("RECONCILE (d): keys of an older shape, a gone run and a neighbour's row render collapsed and open nothing - the bare run key of the PREVIOUS shape never names the wake's bar", async (t) => {
	__resetTurnCollapseOpen();
	const frontend = { session_id: "chat-reconcile-d" };
	/* Under the old shape `answer:1` / `answer:2` named bars; under this one they
	 * are visible rows, never bars, and `seg:answer:2` names the bar ENDING at
	 * answer:2 - which a stored `answer:2#...` must not reach. */
	for (const key of [
		"answer:1",
		"answer:2",
		"answer:1#tool:1",
		"answer:2#wake:1",
		"user:1",
		"gone:1",
		"gone:1#tool:9",
		"seg:",
		"seg:no-such-row",
	]) {
		writeRunExpanded("chat-reconcile-d", key, true);
	}
	const mounted = await mount(
		t,
		[
			userRecord("user:1"),
			toolRecord("tool:1", { ts: TS + 1_000 }),
			stopAnswer("answer:1", TS + 3_000),
			wakeRecord("wake:1", { ts: TS + 10_000 }),
			toolRecord("tool:3", { ts: TS + 11_000 }),
			stopAnswer("answer:2", TS + 12_000),
		],
		{ frontend },
	);
	const bars = barsOf(mounted);
	assert.equal(bars.length, 2, "both spans condense");
	for (const element of bars) {
		assert.equal(
			element.querySelector("button").getAttribute("aria-expanded"),
			"false",
			"no stale key opens either bar",
		);
	}
	assert.ok(rowBox(mounted, "tool:1") === null);
	assert.ok(rowBox(mounted, "tool:3") === null);
	await click(barTrigger(mounted));
	await flushFrames();
	assert.ok(rowBox(mounted, "tool:1"), "the reader can still open one");
	assert.ok(rowBox(mounted, "tool:3") === null, "and only that one");
});

test("PR-4: a turn closed by a terminal marker stays condensed when a wake re-opens it (no assistant close to settle on)", async (t) => {
	__resetTurnCollapseOpen();
	const closed = [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000 }),
		toolRecord("tool:2", { ts: TS + 2_000 }),
		noticeRecord("marker:1", { ts: TS + 3_000 }),
	];
	const mounted = await mount(t, closed);
	const first = bar(mounted);
	assert.ok(first, "the interrupted turn condenses on arrival");
	await mounted.render(
		[
			...closed,
			wakeRecord("wake:1", { ts: TS + 10_000 }),
			toolRecord("tool:3", { ts: TS + 11_000, phase: "running", output: null }),
		],
		{ waiting: true },
	);
	assert.ok(bar(mounted) === first, "the same bar element");
	assert.ok(rowBox(mounted, "tool:1") === null, "still condensed");
	assert.ok(
		rowBox(mounted, "tool:3"),
		"only the cycle being written draws in place",
	);
});

test("PR-4: a lead-in (stopReason toolUse) is not a settle: nothing condenses while it waits for its call, nor when the call arrives", async (t) => {
	__resetTurnCollapseOpen();
	const turn = [
		userRecord("user:1"),
		toolRecord("tool:1", { ts: TS + 1_000 }),
		toolRecord("tool:2", { ts: TS + 2_000 }),
		answerRecord("lead:1", {
			ts: TS + 3_000,
			settledAt: TS + 3_000,
			stopReason: "toolUse",
			text: "Let me check the staging table.",
		}),
	];
	const mounted = await mount(t, turn, { waiting: true });
	assert.ok(bar(mounted) === null, "no bar around a lead-in");
	assert.ok(rowBox(mounted, "tool:1"), "the work is drawn in place");
	await mounted.render(
		[
			...turn,
			toolRecord("tool:3", { ts: TS + 4_000, phase: "running", output: null }),
		],
		{ waiting: true },
	);
	assert.ok(bar(mounted) === null, "and the call's arrival changes nothing");
	assert.ok(rowBox(mounted, "tool:1"), "the work never flipped");
});

/* -------- case 2: the expanded bar survives a wake re-closing the run ------- */

test("case 2: a wake's reply re-closes the run, and the expanded bar stays the same element", async (t) => {
	/*
	 * The lane's case-2 remount through the shipped transcript: the wake lands, its
	 * reply cycle re-closes the run, the elected answer moves - and under the old
	 * rule the bar the reader had expanded was RENAMED, so React unmounted it and
	 * the press was lost. The span's own anchor does not move, so the same element
	 * stays, still open. (The pane's liveness while the reply streams is covered by
	 * PR-4's mounted cases; this test isolates the identity across the same settle
	 * the reader sees.)
	 */
	__resetTurnCollapseOpen();
	const before = [
		userRecord("user:1"),
		toolRecord("tool:1"),
		answerRecord("answer:1"),
	];
	const after = [
		...before,
		wakeRecord("wake:1"),
		toolRecord("tool:2", { ts: TS + 5_000 }),
		answerRecord("answer:2", { ts: TS + 6_000 }),
	];
	const mounted = await mount(t, before);
	const bars = () => [
		...mounted.container.querySelectorAll("[data-turn-summary]"),
	];
	assert.equal(bars().length, 1, "the settled run condenses on load");
	await click(barTrigger(mounted));
	await flushFrames();
	assert.ok(rowBox(mounted, "tool:1"), "the press opens the run");
	/* Tagged by IDENTITY, not by key text: a remount is a new element. */
	bars()[0].__caseTwoProbe = "kept";
	await mounted.render(after);
	await flushFrames();
	assert.equal(bars().length, 2, "the wake's reply cycle adds its own bar");
	assert.ok(
		rowBox(mounted, "tool:1"),
		"the reader's expansion is still open on the first bar",
	);
	assert.equal(
		bars()[0].__caseTwoProbe,
		"kept",
		"and it is the same element, not a remount",
	);
	assert.ok(
		expandedRunsOf(null).has("seg:answer:1"),
		"the stored expansion still names the first bar",
	);
});

/* ---------------------- the quiet turn on screen (S2) ---------------------- */

/** The quiet turn's closing call: an ordinary tool row the UI never paints. */
const quietRecord = (id, over = {}) =>
	toolRecord(id, {
		toolName: "no_reply",
		output: "Quiet.",
		durationS: 0.01,
		...over,
	});

test("the quiet close: the bar stands in, the row never paints, and the copy is the facts without a caption or foot", async (t) => {
	__resetTurnCollapseOpen();
	/*
	 * THE R1 PIN'S SHAPE (`[peer][tool][no_reply]`, head-cut: no opening user
	 * row). The bar must carry the turn - a completed mark, the count with only
	 * the work tool in it - while the quiet row itself is never on screen, at
	 * either state, and no caption or foot exists anywhere.
	 */
	const mounted = await mount(t, [
		peerRecord("peer:1"),
		toolRecord("tool:1", { durationS: 3 }),
		quietRecord("quiet:1"),
	]);
	const summary = bar(mounted);
	assert.ok(
		summary,
		"the bar is present (the quiet close is the gate's anchor)",
	);
	assert.equal(
		summary.getAttribute("data-segment-complete"),
		"true",
		"the completed mark is on the bar",
	);
	assert.match(
		summary.textContent,
		/Peer message/,
		"the opener's label survives below the group minimum",
	);
	assert.match(
		summary.textContent,
		/1\+ action/,
		"actions=1: only the work tool; head-cut states the minimum",
	);
	assert.doesNotMatch(
		summary.textContent,
		/Took/,
		"no fabricated duration for a head-cut span",
	);
	assert.ok(
		rowBox(mounted, "quiet:1") === null,
		"the quiet row paints nothing (hidden at paint, not by the bar)",
	);
	assert.doesNotMatch(
		mounted.container.textContent,
		/Worked/,
		"no foot: nothing carries closesTurn on a quiet turn",
	);
	await click(barTrigger(mounted));
	await flushFrames();
	assert.ok(rowBox(mounted, "peer:1"), "the press brings the receipt back");
	assert.ok(rowBox(mounted, "tool:1"), "and the work tool");
	assert.ok(
		rowBox(mounted, "quiet:1") === null,
		"the quiet row is STILL not painted when the bar is open",
	);
});

test("a run of receipts bars as ONE group line — family, count, receipt span — and the press lists the receipts", async (t) => {
	__resetTurnCollapseOpen();
	/* Twelve receipts over 2h14m, each with its quiet close: the design's copy. */
	const rows = [userRecord("user:1")];
	for (let i = 0; i < 12; i += 1) {
		const at = TS + Math.round((i * 8_040_000) / 11);
		rows.push(peerRecord(`peer:${i}`, { ts: at }));
		rows.push(toolRecord(`tool:${i}`, { ts: at + 1_000 }));
		rows.push(quietRecord(`quiet:${i}`, { ts: at + 2_000 }));
	}
	const mounted = await mount(t, rows);
	const summary = bar(mounted);
	assert.ok(summary, "one bar stands over the whole group");
	assert.match(
		summary.textContent,
		/Peer messages/,
		"the family word is plural",
	);
	assert.match(summary.textContent, /12/, "the count is the receipts");
	assert.match(summary.textContent, /2h14m/, "the span is the receipt time");
	assert.doesNotMatch(
		summary.textContent,
		/action|Took/,
		"a group bar speaks in receipts, not in the action clauses",
	);
	assert.ok(
		rowBox(mounted, "peer:0") === null,
		"collapsed: no receipt is mounted",
	);
	await click(barTrigger(mounted));
	await flushFrames();
	assert.ok(rowBox(mounted, "peer:0"), "the press mounts the first receipt");
	assert.ok(rowBox(mounted, "peer:11"), "and the last");
	assert.ok(
		rowBox(mounted, "quiet:0") === null,
		"the quiet rows still paint nothing inside the open bar",
	);
});

test("a receipt appended to the open group's tail updates the count without remounting the bar (no jitter)", async (t) => {
	__resetTurnCollapseOpen();
	const base = [
		userRecord("user:1"),
		peerRecord("peer:1"),
		quietRecord("quiet:1"),
		peerRecord("peer:2"),
		quietRecord("quiet:2"),
	];
	const mounted = await mount(t, base);
	const before = bar(mounted);
	assert.ok(before, "the group bar draws");
	assert.match(before.textContent, /2/, "two receipts");
	const beforeText = before.textContent;
	/*
	 * The third receipt arrives. Its append must change the COUNT and nothing
	 * structural: the same bar element (same React key - the group's own
	 * `qg:<first row>`), no remount, no second bar, no re-expansion.
	 */
	await mounted.render([...base, peerRecord("peer:3"), quietRecord("quiet:3")]);
	await flushFrames();
	const after = bar(mounted);
	assert.ok(after === before, "the very same element, updated in place");
	assert.notEqual(after.textContent, beforeText, "the copy updated");
	assert.match(after.textContent, /3/, "three receipts");
	assert.equal(
		mounted.container.querySelectorAll("[data-turn-summary]").length,
		1,
		"still one bar",
	);
});

test("F3: the receipt that forms the group neither re-collapses the bar nor re-announces it", async (t) => {
	__resetTurnCollapseOpen();
	/*
	 * The design-round finding at the operator's requirement: the below-minimum
	 * quiet bar and the group it grows into are ONE bar to the reader. The second
	 * receipt must land inside the reader's open expansion (same key -> same
	 * element) and the settle announcement must not fire again for it.
	 */
	const settled = [
		userRecord("user:1"),
		peerRecord("peer:1"),
		toolRecord("tool:1", { ts: TS + 1_000, durationS: 3 }),
		quietRecord("quiet:1", { ts: TS + 2_000 }),
	];
	const mounted = await mount(t, settled);
	const region = () =>
		mounted.container.querySelector("[data-condense-announcement]")
			?.textContent ?? "";
	const summary = bar(mounted);
	assert.ok(summary, "the bar draws");
	await click(barTrigger(mounted));
	await flushFrames();
	assert.ok(rowBox(mounted, "peer:1"), "the reader expanded it");
	const announced = region();
	await mounted.render([...settled, peerRecord("peer:2", { ts: TS + 4_000 })]);
	await flushFrames();
	assert.ok(
		bar(mounted) === summary,
		"the very same bar element, not a remount",
	);
	assert.ok(
		rowBox(mounted, "peer:2"),
		"the new receipt mounts inside the open expansion",
	);
	assert.equal(
		region(),
		announced,
		"no second announcement: the bar is the same bar",
	);
	assert.equal(
		bar(mounted).getAttribute("data-segment-ids"),
		"peer:1 tool:1 quiet:1 peer:2",
		"the bar now hides the grown span, row for row",
	);
});

const activeSourceRows = () => [
	userRecord("active-u"),
	answerRecord("active-final", { stopReason: "stop" }),
	peerRecord("active-p"),
	toolRecord("active-t", {
		toolName: "eval",
		phase: "running",
		output: "Full original synthetic result",
	}),
];
for (const isSmallView of [false, true])
	test(`active receipt disclosure preserves append, actual phase clock, and every material answer (${isSmallView ? "small" : "wide"})`, async (t) => {
		__resetTurnCollapseOpen();
		const frontend = { session_id: `synthetic-active-${isSmallView}` };
		const phase = {
			phase: "thinking",
			activity: "thinking",
			startedAt: Date.now() - 8000,
			clock: true,
		};
		const options = {
			frontend,
			waiting: true,
			workingLine: phase,
			isSmallView,
		};
		const rows = activeSourceRows();
		const mounted = await mount(t, rows, options);
		const first = bar(mounted);
		assert.ok(first);
		assert.ok(rowBox(mounted, "active-p") === null);
		assert.ok(rowBox(mounted, "active-final"));
		assert.equal(first.getAttribute("data-segment-active"), "true");
		assert.equal(first.getAttribute("data-segment-complete"), null);
		assert.doesNotMatch(first.textContent, /Took/);
		assert.match(first.textContent, /thinking/);
		assert.equal(
			mounted.container.querySelectorAll("[data-lo-working-line]").length,
			1,
		);
		await click(first.querySelector("button"));
		assert.ok(rowBox(mounted, "active-p"));
		assert.ok(rowBox(mounted, "active-t"));
		await mounted.render([...rows, peerRecord("active-p2")], options);
		assert.ok(bar(mounted) === first);
		assert.equal(
			first.querySelector("button").getAttribute("aria-expanded"),
			"true",
		);
		assert.ok(rowBox(mounted, "active-p2"));
		const stopped = [
			...rows.map((r) => (r.id === "active-t" ? { ...r, phase: "done" } : r)),
			peerRecord("active-p2"),
			quietRecord("active-q"),
		];
		await mounted.render(stopped, {
			...options,
			waiting: false,
			workingLine: null,
		});
		assert.ok(bar(mounted) === first);
		assert.equal(
			first.querySelector("button").getAttribute("aria-expanded"),
			"true",
		);
		await mounted.render(
			[...stopped, answerRecord("active-material", { stopReason: "stop" })],
			{ ...options, waiting: false, workingLine: null },
		);
		assert.ok(bar(mounted) === first);
		assert.ok(rowBox(mounted, "active-final"));
		assert.ok(rowBox(mounted, "active-material"));
	});

test("active summary keeps legacy unanchored clock at footer; known current phase survives a head cut", async (t) => {
	__resetTurnCollapseOpen();
	const rows = activeSourceRows();
	const mounted = await mount(t, rows, {
		waiting: true,
		workingLine: { phase: "thinking", activity: "thinking", clock: true },
	});
	assert.ok(bar(mounted).querySelector("[data-lo-working-line]") === null);
	assert.ok(
		mounted.container.querySelector(
			"[data-lo-transcript-foot] [data-lo-working-line]",
		),
	);
	const since = Date.now() - 8000;
	/*
	 * `hasMore: true` is the FIXTURE's honest statement of what a head cut is: an
	 * older page exists and has not landed, so the dropped answer is off-page, not
	 * absent. Without it `rows.slice(2)` is a conversation that genuinely OPENS
	 * with a receipt, which paints loose (QA Q1/Q2) - and the original fixture,
	 * which never said older rows existed, failed with `bar(mounted)` null for
	 * exactly that reason. The expectations below are unchanged.
	 */
	await mounted.render(rows.slice(2), {
		waiting: true,
		hasMore: true,
		workingLine: {
			phase: "thinking",
			activity: "thinking",
			clock: true,
			startedAt: since,
		},
	});
	assert.ok(bar(mounted).querySelector("[data-lo-working-line]"));
	assert.equal(
		mounted.container.querySelectorAll("[data-lo-working-line]").length,
		1,
	);
	assert.doesNotMatch(bar(mounted).textContent, /Took/);
});

for (const frontend of [null, { session_id: "synthetic-main-transition" }]) {
	test(`closed future-token disclosure keeps visible anchors and announces once (${frontend ? "main" : "embedded"})`, async (t) => {
		__resetTurnCollapseOpen();
		const rows = activeSourceRows();
		const mounted = await mount(t, rows, { waiting: true, frontend });
		const output = mounted.container.querySelector(
			"[data-condense-announcement]",
		);
		assert.ok(output !== null);
		const utterances = [];
		const observer = new window.MutationObserver(() => {
			if (output.textContent) utterances.push(output.textContent);
		});
		observer.observe(output, {
			childList: true,
			characterData: true,
			subtree: true,
		});
		t.after(() => observer.disconnect());
		const updates = [
			{ text: "", streaming: true },
			{ text: "Actual material progress", streaming: true },
			{ text: "Actual material answer", streaming: false, stopReason: "stop" },
		];
		for (const shape of updates) {
			await mounted.render([...rows, answerRecord("future-answer", shape)], {
				waiting: true,
				frontend,
			});
			/* R3 restores default CLOSED keys to seg:<visible-final>. Unlike a
			 * reader-open disclosure, this closed bar has no qg ownership to retain.
			 * Pin visible-final exclusion and exact children, not its DOM node. */
			const current = bar(mounted);
			assert.ok(current !== null);
			assert.equal(
				current.querySelector("button").getAttribute("aria-expanded"),
				"false",
			);
			assert.deepEqual(
				(current.getAttribute("data-segment-ids") ?? "").split(" "),
				["active-p", "active-t"],
			);
			assert.ok(
				rowBox(mounted, "active-final") !== null,
				"prior final remains visible",
			);
			if (shape.text)
				assert.ok(
					rowBox(mounted, "future-answer") !== null,
					"real first token remains visible",
				);
			if (shape.streaming)
				assert.equal(utterances.length, 0, "no announcement while thinking");
		}
		assert.equal(utterances.length, 1, "exactly one settlement sentence");
		await mounted.render(
			[...rows, answerRecord("future-answer", updates.at(-1))],
			{ waiting: false, frontend },
		);
		assert.equal(
			utterances.length,
			1,
			"same settled episode does not announce twice",
		);
	});

	test(`OPEN future-token disclosure retains its element and focused child (${frontend ? "main" : "embedded"})`, async (t) => {
		__resetTurnCollapseOpen();
		const rows = activeSourceRows();
		const mounted = await mount(t, rows, { waiting: true, frontend });
		await click(barTrigger(mounted));
		const opened = bar(mounted);
		const child = rowBox(mounted, "active-t")?.querySelector("button");
		assert.ok(
			child != null,
			"the real expanded child exposes a focusable control",
		);
		await act(async () => child.focus());
		assert.ok(document.activeElement === child);
		for (const shape of [
			{ text: "", streaming: true },
			{ text: "Actual material progress", streaming: true },
			{ text: "Actual material answer", streaming: false, stopReason: "stop" },
		]) {
			await mounted.render([...rows, answerRecord("future-answer", shape)], {
				waiting: true,
				frontend,
			});
			assert.ok(
				bar(mounted) === opened,
				"proved overlap retains the OPEN qg component",
			);
			assert.equal(barTrigger(mounted).getAttribute("aria-expanded"), "true");
			assert.ok(
				document.activeElement === child,
				"focused child survives the visible boundary",
			);
			assert.ok(rowBox(mounted, "active-final") !== null);
			if (shape.text) assert.ok(rowBox(mounted, "future-answer") !== null);
		}
	});
}

/* V2 rendered SOURCE controls; JSX/focus still requires actual later execution. */
test("v2 expanded disclosure counts exactly its own receipt and spawn, never wire totals", async (t) => {
	const records = [
		peerRecord("count-peer"),
		toolRecord("count-tool", { toolName: "task", durationS: 2.6 }),
		answerRecord("count-final", { stopReason: "stop" }),
	];
	const fixture = (n) => ({
		runs: new Map([
			[
				"count-final",
				{
					actions: n,
					workedSeconds: n === 113319 ? 50340 : 100680,
					failed: 0,
					complete: true,
					openingUserId: "offpage",
					closingAnswerId: "count-final",
					crossSessionActions: 0,
					crossSessionWorkedSeconds: 0,
				},
			],
		]),
		page: { ids: new Set(records.map((r) => r.id)) },
	});
	const mounted = await mount(t, records, { openFrame: fixture(113319) });
	// This file's real helpers: ONE bar per fixture, so `bar`/`barTrigger`.
	const theBar = bar(mounted);
	assert.ok(theBar);
	const button = barTrigger(mounted);
	assert.match(button.textContent, /1\+? action/);
	assert.doesNotMatch(button.textContent, /113319|13h59|Took/);
	await click(button);
	assert.ok(rowBox(mounted, "count-peer"));
	assert.ok(rowBox(mounted, "count-tool"));
	assert.equal(theBar.contains(rowBox(mounted, "count-final")), false);
	await mounted.render(records, { openFrame: fixture(226638) });
	assert.ok(bar(mounted) === theBar);
	assert.equal(button.getAttribute("aria-expanded"), "true");
	assert.doesNotMatch(button.textContent, /226638|113319|Took/);
});
test("v2 one open bar survives 129 unrelated complete owners without opening neighbors", async (t) => {
	__resetTurnCollapseOpen();
	const records = [
		userRecord("alias-user"),
		answerRecord("alias-final", { stopReason: "stop" }),
	];
	for (let i = 0; i < 129; i++)
		records.push(
			peerRecord(`alias-peer-${i}`),
			toolRecord(`alias-tool-${i}`),
			answerRecord(`alias-answer-${i}`, { stopReason: "stop" }),
		);
	const over = {
		frontend: { session_id: "synthetic-alias-129" },
		viewEpoch: 1,
	};
	const mounted = await mount(t, records, over);
	assert.ok(bar(mounted) !== null);
	await click(barTrigger(mounted));
	assert.equal(barTrigger(mounted).getAttribute("aria-expanded"), "true");
	const prepended = [
		...records.slice(0, 2),
		peerRecord("alias-prefix"),
		...records.slice(2),
	];
	await mounted.render(prepended, over);
	/*
	 * WHAT THIS PINS, and what it no longer does. The key is retained across the
	 * prepend (the plan hands the SAME `qg:alias-peer-0` back, measured), so the
	 * reader's open state follows it. The bar's DOM NODE is replaced anyway:
	 * upstream's transcript slots (#1021, `candidateSlots`) key a bar's wrapper on
	 * its FIRST RECORD ID, and a prepend into the bar changes that id. The same
	 * assertion fails on base `4ec2dd1` production code, so it is not this
	 * change's regression; what the reader sees is pinned instead: exactly ONE
	 * bar open, it is the bar that was opened, its rows are mounted, and no
	 * neighbour opened. Node identity is deliberately not asserted.
	 */
	const bars = [...mounted.container.querySelectorAll("[data-turn-summary]")];
	const openBars = bars.filter(
		(el) =>
			el.querySelector("button")?.getAttribute("aria-expanded") === "true",
	);
	assert.ok(
		openBars.length === 1,
		`one bar open after the prepend, found ${openBars.length} of ${bars.length}`,
	);
	assert.ok(
		(openBars[0].getAttribute("data-segment-ids") ?? "")
			.split(" ")
			.includes("alias-tool-0"),
		"the open bar is the one the reader opened",
	);
	assert.ok(rowBox(mounted, "alias-tool-0") !== null, "its rows are mounted");
	// Explicit clear invalidates alias evidence without treating unchanged
	// owner/view epochs as a positive source-transition certificate.
	await mounted.render([], { ...over, viewEpoch: 2 });
	await mounted.render(prepended, { ...over, viewEpoch: 2 });
	/*
	 * The collapsed half of the pair belongs HERE, not beside the open half:
	 * the 129-owner prepend is not a source transition, so it leaves the
	 * reader's bar open, and only the explicit epoch clear above is one, so
	 * only now does the bar stand collapsed again.
	 */
	assert.equal(barTrigger(mounted).getAttribute("aria-expanded"), "false");
	__resetTurnCollapseOpen();
});

test("F6: a group bar's printed receipt count and its announcement agree", async (t) => {
	__resetTurnCollapseOpen();
	/*
	 * Reviewer F6. A `subagent:` notice is an episode origin but not a quiet-group
	 * trigger, so `[wake, subagent notice, wake]` has `facts.group.count === 2`
	 * and `internal.receipts === 3`. The bar prints the receipts figure; the live
	 * region announced the group figure, so a screen-reader user was told a
	 * different number from the one on screen. One source for both.
	 */
	const running = [
		userRecord("f6-user", { ts: TS }),
		answerRecord("f6-final", { ts: TS + 1_000, stopReason: "stop" }),
		wakeRecord("f6-w1", { ts: TS + 2_000 }),
		noticeRecord("subagent:f6", {
			ts: TS + 3_000,
			level: "info",
			complete: false,
			text: "Subagent finished",
		}),
		wakeRecord("f6-w2", { ts: TS + 4_000 }),
		toolRecord("f6-tool", { ts: TS + 5_000, durationS: 1 }),
	];
	const mounted = await mount(t, running, { waiting: true });
	const region = () =>
		mounted.container.querySelector("[data-condense-announcement]")
			?.textContent ?? "";
	await mounted.render(
		[
			...running,
			answerRecord("f6-final-2", { ts: TS + 6_000, stopReason: "stop" }),
		],
		{},
	);
	const printed = [...bar(mounted).textContent.matchAll(/\d+/g)].map(
		(m) => m[0],
	);
	assert.ok(printed.includes("3"), `the bar prints 3 receipts: ${printed}`);
	assert.match(region(), /\b3\b/, `the announcement says 3: "${region()}"`);
	assert.doesNotMatch(region(), /\b2\b/, "and never the group-only figure");
});

test("U1: a head-cut group's sentence carries the bar's minimum marker", async (t) => {
	__resetTurnCollapseOpen();
	__resetWatchedRuns();
	/*
	 * Design review round 1, U1. The fixture is a run with NO opening user row
	 * (the loaded edge): every count in it is a minimum, and the bar says so -
	 * `2+` with "At least 2 messages - earlier rows are not loaded" on the count
	 * span. Before the fix the live region said "Peer messages: 2." - a bare
	 * figure more exact than anything on screen.
	 */
	const cut = [
		peerRecord("hc-p1", { ts: TS + 1_000 }),
		peerRecord("hc-p2", { ts: TS + 2_000 }),
		toolRecord("hc-tool", { ts: TS + 3_000, durationS: 1, phase: "running" }),
	];
	const mounted = await mount(t, cut, { waiting: true, hasMore: true });
	assert.match(
		bar(mounted)?.textContent ?? "",
		/2\+/,
		"the bar paints the count with its minimum marker",
	);
	await mounted.render(
		[...cut, answerRecord("hc-final", { ts: TS + 5_000, stopReason: "stop" })],
		{ hasMore: true, waiting: false },
	);
	const region = () =>
		mounted.container.querySelector("[data-condense-announcement]")
			?.textContent ?? "";
	assert.equal(
		region(),
		"Peer messages: at least 2.",
		"the sentence states the same minimum in words",
	);
});

test("a head cut with older rows keeps its live episode condensed; with none it paints", async (t) => {
	__resetTurnCollapseOpen();
	/*
	 * The architect's resolution of the head-cut contradiction, caller arm 1
	 * (`hasMore`). `[peer, running tool]` at the loaded edge: if an older page is
	 * still to come the answer this episode continues is off-page, so it condenses;
	 * if nothing is older the receipt genuinely opens the conversation and paints.
	 */
	const cut = [
		peerRecord("hm-peer"),
		toolRecord("hm-tool", { toolName: "eval", phase: "running" }),
	];
	const more = await mount(t, cut, { waiting: true, hasMore: true });
	assert.ok(bar(more), "older rows exist: the episode condenses");
	const none = await mount(t, cut, { waiting: true, hasMore: false });
	assert.ok(bar(none) === null, "nothing older: the receipt paints loose");
	assert.ok(rowBox(none, "hm-peer"), "and its content is mounted");
});

test("rows hidden by the render window count as older rows (hidden > 0 arm)", async (t) => {
	__resetTurnCollapseOpen();
	/*
	 * Caller arm 2: `hasMore` is FALSE, every row is loaded, but the render window
	 * shows only the newest, so the visible head is a CUT and a peer at its edge
	 * must condense like the `hasMore` case.
	 *
	 * THE FIXTURE MUST EXCEED THE SNAP'S REACH, and an earlier one did not. The
	 * window snaps its top edge onto the run's opening user row when that row is
	 * within `WINDOW_ALIGN_MAX_EXTRA` (300) rows of the edge, so a 62-row run is
	 * mounted whole and `hidden` is 0 - its precondition was false. 300 tools
	 * between the answer and the peer put the edge exactly on the peer (362 rows,
	 * `alignSize` 60, `hidden` 302). The assertions are booleans on purpose: a
	 * failing `assert.equal(<jsdom node>, null)` makes node format the node and
	 * the process balloons past 2 GB, which is how that earlier failure presented
	 * as a kill instead of a message.
	 */
	const records = [
		userRecord("hid-user"),
		answerRecord("hid-final", { stopReason: "stop" }),
	];
	for (let i = 0; i < 300; i += 1)
		records.push(toolRecord(`hid-pre-${i}`, { phase: "done" }));
	records.push(peerRecord("hid-peer"));
	for (let i = 0; i < 58; i += 1)
		records.push(toolRecord(`hid-post-${i}`, { phase: "done" }));
	records.push(toolRecord("hid-live", { phase: "running" }));
	const mounted = await mount(t, records, { waiting: true, hasMore: false });
	assert.ok(rowBox(mounted, "hid-user") === null, "precondition: head hidden");
	assert.ok(
		rowBox(mounted, "hid-final") === null,
		"precondition: answer hidden",
	);
	assert.ok(bar(mounted) !== null, "hidden rows are older rows: it condenses");
	assert.ok(
		rowBox(mounted, "hid-peer") === null,
		"the peer sits behind its bar",
	);
});

test("a settled head-cut bar keeps its key, open state and silence when the head lands", async (t) => {
	__resetTurnCollapseOpen();
	/*
	 * R2-2. `[peer, 4 tools, settled answer]` with `hasMore` is a SETTLED cut bar:
	 * it condenses as an ordinary bar either way, so the older-rows seed must not
	 * turn it into an internal episode keyed `qg:p` - when the head then lands the
	 * span becomes ordinary again (`seg:a`), the key changes and the reader's open
	 * disclosure closes with a false settle announcement. Base stays open and silent.
	 */
	const cut = [
		peerRecord("hl-peer"),
		toolRecord("hl-t1", { ts: TS + 3_000 }),
		toolRecord("hl-t2", { ts: TS + 4_000 }),
		toolRecord("hl-t3", { ts: TS + 5_000 }),
		toolRecord("hl-t4", { ts: TS + 6_000 }),
		answerRecord("hl-final", { ts: TS + 7_000, stopReason: "stop" }),
	];
	const mounted = await mount(t, cut, { hasMore: true });
	assert.ok(bar(mounted) !== null, "the settled cut bar stands");
	await click(barTrigger(mounted));
	assert.equal(barTrigger(mounted).getAttribute("aria-expanded"), "true");
	const region = () =>
		mounted.container.querySelector("[data-condense-announcement]")
			?.textContent ?? "";
	await mounted.render([userRecord("hl-user", { ts: TS + 1_000 }), ...cut], {
		hasMore: false,
	});
	assert.equal(
		barTrigger(mounted).getAttribute("aria-expanded"),
		"true",
		"the reader's open bar survives the head landing",
	);
	assert.equal(region(), "", "and nothing is announced");
});

test("R3: a closed appendable episode announces once - at its close, not at a quiet beat (settle-latch convergence round)", async (t) => {
	__resetTurnCollapseOpen();
	/*
	 * RETIMED EXPRESSION (settle-latch convergence round, 2026-10-17). The
	 * original case read the pane's quiet flag as the episode's arrival:
	 * `waiting: false` with the tool done was treated as the settle, the sentence
	 * was asserted at that beat, and the close was asserted silent. This pane is
	 * one the latch has WATCHED (a session-less mount shares the `""` bucket, and
	 * the live pass below arms it), and a liveness dip reads exactly like that
	 * beat - flag quiet, no settled close landed, the next step re-enters live -
	 * so the sentence may no longer land there. What moved is the dip expression
	 * of (a)+(b): the quiet beat and the re-entry stay silent, and the close that
	 * actually ends the cycle announces once. The intent is unchanged: a live
	 * episode is not recorded as announced, the arrival announces exactly once,
	 * re-entry does not repeat it, and the anchor the closed span gains adds no
	 * second sentence.
	 */
	const head = [
		userRecord("ak-user"),
		answerRecord("ak-final", { stopReason: "stop" }),
	];
	const live = [
		...head,
		peerRecord("ak-peer"),
		toolRecord("ak-tool", { phase: "running" }),
	];
	const mounted = await mount(t, live, { waiting: true });
	assert.equal(
		watchedRunOf(null),
		"ak-user",
		"the live pass armed the latch for this pane's bucket",
	);
	const region = () =>
		mounted.container.querySelector("[data-condense-announcement]")
			?.textContent ?? "";
	assert.equal(region(), "", "live episode is not recorded as announced");
	const settled = [
		...head,
		peerRecord("ak-peer"),
		toolRecord("ak-tool", { phase: "done" }),
	];
	// THE QUIET BEAT: no sentence - the pane is quiet, but nothing has closed.
	await mounted.render(settled, { waiting: false });
	assert.equal(
		region(),
		"",
		"a quiet beat does not announce the still-open episode",
	);
	// Re-entering a live pass must not speak it either.
	await mounted.render(settled, { waiting: true });
	assert.equal(region(), "", "nor does the re-entry");
	// THE CLOSE lands: exactly one sentence, and the span gains its visible anchor.
	const closed = [
		...settled,
		toolRecord("ak-tool2"),
		answerRecord("ak-close", { stopReason: "stop" }),
	];
	await mounted.render(closed, { waiting: false });
	const first = region();
	assert.equal(first, "Peer message: 2 actions.", "the close announces once");
	await mounted.render(closed, { waiting: false });
	assert.equal(region(), first, "and never twice");
	assert.ok(rowBox(mounted, "ak-final") !== null, "first final stays outside");
	assert.ok(
		rowBox(mounted, "ak-close") !== null,
		"new visible anchor stays outside",
	);
});

test("R3: actionable lone peer before a genuine final is a visible negative control", async (t) => {
	const mounted = await mount(
		t,
		[
			peerRecord("negative-peer", {
				body: "Please check the deployment status before proceeding.",
			}),
			answerRecord("negative-final", {
				text: "The deployment is paused pending the requested check.",
				streaming: true,
				stopReason: null,
			}),
		],
		{ waiting: true },
	);
	assert.ok(
		rowBox(mounted, "negative-peer") !== null,
		"actionable receipt stays inline",
	);
	assert.ok(
		rowBox(mounted, "negative-final") !== null,
		"genuine final stays visible",
	);
	assert.ok(
		bar(mounted) === null,
		"no preceding loaded answer or second receipt licenses an internal episode",
	);
});

/** Real operator journal: the answer promises an MP3, and the supplement that
 * follows it must never become the trace disclosure's child. Image/file peers
 * augment this same record to pin the shared mechanism, not an audio exception. */
test("8d652185377c highlights remain answer siblings with the trace closed and open", async (t) => {
	__resetTurnCollapseOpen();
	const fixture = JSON.parse(
		await readFile(
			new URL("./fixtures/turn-highlights-8d652185377c.json", import.meta.url),
			"utf8",
		),
	);
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: fixture.entries,
		has_more: false,
		cursor_missing: false,
	});
	const supplement = state.records.find(
		(record) => record.kind === "supplement",
	);
	assert.ok(
		supplement,
		"actual journal resolves through the production reducer",
	);
	const records = state.records.map((record) =>
		record === supplement
			? {
					...record,
					files: [
						{
							path: "bird.png",
							name: "bird.png",
							kind: "image",
							sizeBytes: 120,
							mtime: 0,
							why: "regression neighbor",
						},
						{
							path: "bird-notes.txt",
							name: "bird-notes.txt",
							kind: "text",
							sizeBytes: 40,
							mtime: 0,
							why: "regression neighbor",
						},
					],
				}
			: record,
	);
	const mounted = await mount(t, state.records);
	const assertDurable = (neighbors = false) => {
		const strip = rowBox(mounted, supplement.id);
		assert.ok(
			strip,
			"here it is must have visible highlights, not just promised prose",
		);
		assert.equal(
			strip.closest("[data-turn-summary]"),
			null,
			"highlight strip is never a descendant of the collapsible trace",
		);
		assert.ok(
			strip.querySelector("[data-supplement-sound-title]"),
			"real MP3 callout",
		);
		if (neighbors) {
			assert.ok(
				strip.querySelector("[data-supplement-images]"),
				"image grid shares durable placement",
			);
			assert.ok(
				strip.querySelector("[data-supplement-file]"),
				"ordinary file shares durable placement",
			);
		}
		return strip;
	};
	assert.ok(bar(mounted), "real session's action group starts closed");
	const strip = assertDurable();
	await click(barTrigger(mounted));
	assert.equal(
		assertDurable(),
		strip,
		"expanding the trace preserves the strip's DOM identity",
	);
	await click(barTrigger(mounted));
	assert.equal(
		assertDurable(),
		strip,
		"collapsing the trace preserves the strip's DOM identity",
	);
	await mounted.render(records);
	assertDurable(true);
	await click(barTrigger(mounted));
	assertDurable(true);
});

// R1-1: an open steering draft must not outlive the job it could still steer.
// Keep a file on the done row so this tests the form guard, not row removal.
test("a condensed Highlights adjustment closes when preparation settles", async (t) => {
	__resetTurnCollapseOpen();
	const supplement = {
		kind: "supplement",
		id: "supplement:answer:adjust",
		ts: TS + 4000,
		anchor: "answer:adjust",
		job: "0123456789ab",
		version: 1,
		state: "running",
		live: true,
		dismissed: false,
		error: "",
		files: [
			{
				path: "notes.txt",
				name: "notes.txt",
				kind: "text",
				sizeBytes: 40,
				mtime: 0,
				why: "regression",
			},
		],
		filesMore: 0,
		more: [],
		components: [],
	};
	const rows = [
		userRecord("user:adjust"),
		toolRecord("tool:adjust"),
		answerRecord("answer:adjust"),
		supplement,
	];
	const options = {
		attachmentScope: { sessionId: "faced00d0001", childId: null },
	};
	const mounted = await mount(t, rows, options);
	await click(mounted.container.querySelector("[data-supplement-adjust]"));
	assert.ok(
		mounted.container.querySelector("[data-supplement-adjust-form]"),
		"preparing job accepts an adjustment",
	);
	await mounted.render(
		rows.map((row) =>
			row === supplement ? { ...row, state: "done", live: false } : row,
		),
		options,
	);
	assert.ok(
		mounted.container.querySelector(
			"[data-supplement-condensed] [data-supplement-file]",
		),
		"the done Highlights row remains present and condensed",
	);
	assert.equal(
		Boolean(mounted.container.querySelector("[data-supplement-adjust-form]")),
		false,
		"a settled job exposes no live steer input",
	);
});

/** A sanitized receipt shape from the inbound producer, never the private body. */
test("Bridge incoming reducer rows condense across quiet cycles without hiding the operator boundaries", async (t) => {
	__resetTurnCollapseOpen();
	const fixture = JSON.parse(
		await readFile(
			new URL("./fixtures/bridge-incoming.json", import.meta.url),
			"utf8",
		),
	);
	const reduced = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: fixture.entries,
		has_more: false,
		cursor_missing: false,
	}).records;
	assert.equal(reduced.length, 2);
	const records = [
		userRecord("bridge-user"),
		answerRecord("bridge-final", { stopReason: "stop" }),
		reduced[0],
		toolRecord("bridge-history", {
			toolName: "bridge",
			args: { op: "channel_history", channel_id: "synthetic-conversation" },
		}),
		toolRecord("bridge-post", {
			toolName: "bridge",
			args: {
				op: "channel_post",
				channel_id: "synthetic-conversation",
				text: "Acknowledged.",
			},
		}),
		toolRecord("bridge-quiet-1", { toolName: "no_reply" }),
		reduced[1],
		toolRecord("bridge-send", {
			toolName: "send",
			args: { target: "synthetic-peer", message: "Received." },
		}),
		toolRecord("bridge-quiet-2", { toolName: "no_reply" }),
	];
	const mounted = await mount(t, records);
	assert.ok(rowBox(mounted, "bridge-user"), "true user remains visible");
	assert.ok(rowBox(mounted, "bridge-final"), "true final remains visible");
	assert.equal(
		mounted.container.querySelectorAll("[data-turn-summary]").length,
		1,
		"one internal episode, not a separate top-level notice per Bridge receipt",
	);
	assert.equal(
		rowBox(mounted, "bridge-receipt-1"),
		null,
		"receipt folds with the work",
	);
	await click(barTrigger(mounted));
	assert.ok(rowBox(mounted, "bridge-receipt-1"));
	assert.ok(rowBox(mounted, "bridge-receipt-2"));
	assert.match(rowBox(mounted, "bridge-receipt-1").textContent, /Received/);
	assert.doesNotMatch(
		rowBox(mounted, "bridge-receipt-1").textContent,
		/team bridge message:/,
	);
	assert.ok(!bar(mounted).contains(rowBox(mounted, "bridge-final")));
});

test("Bridge incoming action fold retains both receipts through live settle and the next activation", async (t) => {
	__resetTurnCollapseOpen();
	const fixture = JSON.parse(
		await readFile(
			new URL("./fixtures/bridge-incoming.json", import.meta.url),
			"utf8",
		),
	);
	const receipts = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: fixture.entries,
		has_more: false,
		cursor_missing: false,
	}).records;
	const records = [
		userRecord("bridge-live-user"),
		receipts[0],
		toolRecord("bridge-live-history", {
			toolName: "bridge",
			args: { op: "channel_history" },
		}),
		receipts[1],
		toolRecord("bridge-live-post", {
			toolName: "bridge",
			args: { op: "channel_post", text: "Acknowledged." },
		}),
		toolRecord("bridge-live-send", {
			toolName: "send",
			args: { target: "synthetic-peer", message: "Received." },
		}),
	];
	const mounted = await mount(t, records, { waiting: true });
	const fold = mounted.container.querySelector("[data-fold-ids]");
	assert.ok(fold, "ordinary action aggregation exists while the turn is live");
	assert.match(fold.dataset.foldIds, /bridge-receipt-1/);
	assert.match(fold.dataset.foldIds, /bridge-receipt-2/);
	assert.match(fold.textContent, /2 incoming messages/);
	assert.equal(rowBox(mounted, "bridge-receipt-1"), null);
	const settled = [
		...records,
		toolRecord("bridge-live-close", { toolName: "no_reply" }),
	];
	await mounted.render(settled, { waiting: false });
	await mounted.render([...settled, { ...receipts[0], id: "bridge-next" }], {
		waiting: true,
	});
	assert.ok(
		rowBox(mounted, "bridge-live-user"),
		"operator boundary survives activation",
	);
	assert.equal(
		rowBox(mounted, "bridge-receipt-1"),
		null,
		"settled episode does not reopen on next activation",
	);
});

test("Bridge current and legacy metadata agree across live delta, lazy history and reload without admitting a body", async (t) => {
	__resetTurnCollapseOpen();
	const fixture = JSON.parse(
		await readFile(
			new URL("./fixtures/bridge-incoming.json", import.meta.url),
			"utf8",
		),
	);
	const entries = structuredClone(fixture.entries);
	entries[0].payload.details.bridge_receipt = {
		v: 1,
		sender: { name: "Example member", kind: "human" },
		conversation: { kind: "dm" },
		attachment_count: 1,
		body: "Never admitted text",
		admission: { state: "admitted" },
	};
	const live = applyEvent(EMPTY_TRANSCRIPT, {
		type: "history_delta",
		messages: entries.map((entry) => ({ id: entry.id, ...entry.payload })),
	});
	const tail = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [entries[1]],
		has_more: true,
		cursor_missing: false,
	});
	const replay = applyHistoryPage(tail, {
		entries: [entries[0]],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		live.records.map((r) => r.bridgeReceipt),
		replay.records.map((r) => r.bridgeReceipt),
	);
	assert.equal(replay.records[0].bridgeReceipt.attachmentCount, 1);
	const mounted = await mount(t, replay.records, {
		frontend: { session_id: "synthetic-bridge-reload" },
	});
	for (
		let depth = 0;
		depth < 2 && !rowBox(mounted, "bridge-receipt-1");
		depth += 1
	) {
		await click(
			mounted.container.querySelector(
				'[data-fold-ids] button[aria-expanded="false"], [data-turn-summary] button[aria-expanded="false"]',
			),
		);
	}
	const receipt = rowBox(mounted, "bridge-receipt-1");
	assert.ok(
		receipt,
		"turn and action disclosures both reveal their original receipt row",
	);
	await click(receipt.querySelector("button"));
	assert.match(receipt.textContent, /Received from Example member/);
	assert.match(receipt.textContent, /Direct message/);
	assert.match(receipt.textContent, /Message body unavailable/);
	assert.doesNotMatch(receipt.textContent, /Never admitted text/);
	assert.equal(
		mounted.container.querySelectorAll("img").length,
		0,
		"attachment counts never manufacture an image ref",
	);
	const reload = await mount(t, replay.records, {
		frontend: { session_id: "synthetic-bridge-reload" },
	});
	assert.equal(
		reload.container.querySelectorAll("[data-turn-summary]").length,
		1,
		"reload preserves one receipt episode rather than splitting notices",
	);
	assert.equal(
		reload.container.querySelectorAll("img").length,
		0,
		"reload does not invent admitted media",
	);
});

test("Bridge admitted history media retains its own row while nearby incoming receipts fold", async (t) => {
	__resetTurnCollapseOpen();
	const fixture = JSON.parse(
		await readFile(
			new URL("./fixtures/bridge-incoming.json", import.meta.url),
			"utf8",
		),
	);
	const receipts = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: fixture.entries,
		has_more: false,
		cursor_missing: false,
	}).records;
	const history = toolRecord("bridge-media-history", {
		toolName: "bridge",
		args: { op: "channel_history", channel_id: "synthetic-conversation" },
		images: [shotImage("bridge-media-history", 0)],
	});
	const mounted = await mount(t, [
		userRecord("bridge-media-user"),
		answerRecord("bridge-media-final", { stopReason: "stop" }),
		receipts[0],
		history,
		receipts[1],
		toolRecord("bridge-media-quiet", { toolName: "no_reply" }),
	]);
	assert.ok(
		rowBox(mounted, "bridge-media-history"),
		"admitted screenshot owner stays inline outside the collapsed episode",
	);
	assert.equal(mounted.container.querySelectorAll("img").length, 1);
	assert.ok(
		rowBox(mounted, "bridge-media-final"),
		"real final answer remains outside receipt condensation",
	);
});
