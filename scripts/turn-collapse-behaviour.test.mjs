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
 * control is one press from the failed row, across the bar and the fold; and
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
			'export { __resetTurnCollapseOpen } from "./src/renderer/src/shared/store/turn-collapse-open";',
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
const { CanonicalTranscript, __resetTurnCollapseOpen } = await import(
	bundlePath.href
);
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
					transcript: transcriptOf(next),
					gate: null,
					waiting: nextOver.waiting ?? false,
					loadingOlder: false,
					onLoadOlder: async () => true,
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

test("the failure control is one press from the failed row: bar, fold, disclosure, scroll", async (t) => {
	__resetTurnCollapseOpen();
	scrollCalls.length = 0;
	const mounted = await mount(t, [
		userRecord("user:1"),
		toolRecord("tool:1", {
			isError: true,
			output: "Error: command failed with exit code 1",
		}),
		toolRecord("tool:2", { args: { command: "git status --short" } }),
		toolRecord("tool:3", { args: { command: "git push origin fix" } }),
		answerRecord("answer:1"),
	]);
	const summary = bar(mounted);
	assert.match(summary.textContent, /1 failed/, "the failure is stated");
	const failedControl = [...summary.querySelectorAll("span")].find(
		(span) => span.textContent === "1 failed",
	);
	await click(failedControl);
	await flushFrames();

	assert.ok(rowBox(mounted, "tool:1"), "the bar opened");
	assert.equal(
		barTrigger(mounted).getAttribute("aria-expanded"),
		"true",
		"and stays open",
	);
	const fold = [...mounted.container.querySelectorAll("[data-fold-ids]")].find(
		(node) => (node.getAttribute("data-fold-ids") ?? "").includes("tool:1"),
	);
	assert.ok(fold, "the fold holding the failed row is mounted");
	assert.equal(
		fold.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded"),
		"true",
		"the fold opened too",
	);
	const failedRow = rowBox(mounted, "tool:1");
	assert.equal(
		failedRow
			?.querySelector("button[aria-expanded]")
			?.getAttribute("aria-expanded"),
		"true",
		"and the failed row's own detail is open",
	);
	assert.ok(
		scrollCalls.some(
			(call) => call.element === failedRow && call.options?.block === "center",
		),
		"the walk ends where the foot's jump does: the failed row at the centre",
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

test("a run the window has cut renders as today: no bar, and the foot as it was", async (t) => {
	__resetTurnCollapseOpen();
	/*
	 * 61 rows, one over the mount window: the leading edge cuts the first row,
	 * the opening user message, so the single run that survives is headless —
	 * and a summary may only ever describe rows that are on hand (§5 case 12).
	 */
	const records = [
		userRecord("user:1"),
		...Array.from({ length: 59 }, (_, index) =>
			toolRecord(`tool:${index + 1}`, { ts: TS + 1_000 + index }),
		),
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
