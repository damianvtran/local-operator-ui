#!/usr/bin/env node
/*
 * THE PER-FLUSH COST BENCH (UI perf audit A2/A3/A4/A6).
 *
 * A measuring instrument, not a correctness test. It drives the SHIPPED modules
 * through the flush cadence streaming produces — the same content handed back
 * with fresh array identities, which is what a socket flush does — and prints
 * the per-flush work each fix removed. Correctness is pinned elsewhere
 * (`use-active-checkpoint.test.mjs`, `turn-collapse-behaviour.test.mjs`,
 * `transcript-paging.test.mjs`, `checkpoint-rail.test.mjs`); this file exists so
 * the PR's numbers are reproducible rather than asserted.
 *
 * FOUR BENCHES:
 *   A2  the real `useActiveCheckpoint` over R rows / C checkpoints: cue scans
 *       and per-checkpoint DOM reads across F flushes.
 *   A3  the real `CanonicalTranscript`: `collapsePlan` calls across F flushes.
 *   A4  the real `decide` in the DOM half's own re-arm loop: wakeups over a
 *       simulated idle window (the loop body is transcribed from
 *       `use-scroll-paging.ts`'s `schedule`; the policy is the shipped one).
 *   A6  the real `CheckpointRail`: body renders across F flushes, with the
 *       pre-fix call site (a fresh `onJump` per flush) as its falsifier arm.
 *   A7  the real `CanonicalTranscript` again, over a scripted TOKEN STREAM
 *       (PR-6): `collapsePlan` calls, foot-map rebuilds and chat-entry
 *       rebuilds on the tokens that only lengthen an answer's text.
 *
 * BEFORE/AFTER: the counters live in the modules, so the same file runs against
 * two trees — this branch (after) and a counter-patched copy of the parent
 * commit (before) — swapped in over the five modules the change touches:
 * `git show HEAD^:src/.../<file> > src/.../<file>` plus the counter declarations,
 * run, then `git checkout -- src/renderer/src/features/chat/canonical`. Same file,
 * same machine, same process shape, so the only variable is the code under test.
 *
 * Usage: PERF_BENCH_ARM=after node --test scripts/transcript-perflush-perf.test.mjs
 * `PERF_BENCH_ARM` only labels the output; report JSON goes to stderr as
 * `PERF_BENCH_REPORT <json>` on the last test, and the fixed-contract asserts run
 * on the `after` arm alone (the `before` numbers are the finding).
 */
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";

const ARM = process.env.PERF_BENCH_ARM ?? "after";
const FLUSHES = Number(process.env.PERF_BENCH_FLUSHES ?? 120);
const CHECKPOINTS = Number(process.env.PERF_BENCH_CHECKPOINTS ?? 40);
const ROWS = Number(process.env.PERF_BENCH_ROWS ?? 200);
const TS = 1_000_000;

/* ------------------------- the jsdom bootstrap --------------------------- */
/* Mirrors `turn-collapse-behaviour.test.mjs`'s harness; local so that file's
 * tests do not run a second time. */

const bootstrapDOM = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = bootstrapDOM;
const originals = new Map();
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
	/*
	 * jsdom this repo runs ships no `CSS.escape`, and the cue's scan escapes each
	 * checkpoint id into its selector. The ids these benches use are
	 * attribute-safe, so an identity escape is enough (same shim as
	 * `use-active-checkpoint.test.mjs`).
	 */
	CSS: globalThis.CSS?.escape ? globalThis.CSS : { escape: (v) => String(v) },
	requestAnimationFrame: (callback) => window.setTimeout(callback, 0),
	cancelAnimationFrame: (id) => window.clearTimeout(id),
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	MutationObserver: window.MutationObserver,
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
window.requestAnimationFrame = shims.requestAnimationFrame;
window.cancelAnimationFrame = shims.cancelAnimationFrame;
window.Element.prototype.scrollIntoView = function scrollIntoView() {};
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");

const bundle = await build({
	stdin: {
		contents: [
			'import { createElement, useRef } from "react";',
			'import { useActiveCheckpoint } from "./src/renderer/src/features/chat/canonical/use-active-checkpoint";',
			'export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";',
			'export { CheckpointRail } from "./src/renderer/src/features/chat/canonical/checkpoint-rail";',
			'export { useActiveCheckpoint } from "./src/renderer/src/features/chat/canonical/use-active-checkpoint";',
			'export { dbgActiveCueScans } from "./src/renderer/src/features/chat/canonical/use-active-checkpoint";',
			'export { dbgCollapsePlanCalls } from "./src/renderer/src/features/chat/canonical/turn-collapse-model";',
			'export { dbgChatEntriesRebuilds, dbgFeetRebuilds } from "./src/renderer/src/features/chat/canonical/canonical-transcript";',
			'export { dbgRailRenders } from "./src/renderer/src/features/chat/canonical/checkpoint-rail";',
			'export { decide, initialPagingState, noteInput, SETTLE_MS } from "./src/renderer/src/features/chat/canonical/scroll-paging";',
			/*
			 * The hook needs a host: a region div carrying one element per row, so
			 * the scan's `querySelector` has something to find.
			 */
			"export function CueHarness({ rows, checkpoints }) {",
			"  const ref = useRef(null);",
			"  useActiveCheckpoint(ref, rows, checkpoints);",
			"  return createElement('div', { ref, 'data-region': '' },",
			"    rows.map((row) => createElement('div', { key: row.record.id, 'data-record-id': row.record.id })));",
			"}",
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
		"@tanstack/react-query",
	],
});
const bundlePath = new URL(`./_perf-bench-${process.pid}.mjs`, import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	CanonicalTranscript,
	CheckpointRail,
	CueHarness,
	dbgActiveCueScans,
	dbgChatEntriesRebuilds,
	dbgCollapsePlanCalls,
	dbgFeetRebuilds,
	dbgRailRenders,
	decide,
	initialPagingState,
	noteInput,
	SETTLE_MS,
} = await import(bundlePath.href);
await unlink(bundlePath);

const report = {
	arm: ARM,
	flushes: FLUSHES,
	checkpoints: CHECKPOINTS,
	rows: ROWS,
};

const transcriptOf = (records) => ({
	records,
	index: new Map(records.map((record, position) => [record.id, position])),
	generation: 1,
	oldestId: null,
	hasMore: false,
	argsByCall: new Map(),
});
const userRecord = (id) => ({
	kind: "user",
	id,
	ts: TS,
	text: "a question",
	images: [],
});
const toolRecord = (id) => ({
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
});
const answerRecord = (id) => ({
	kind: "assistant",
	id,
	ts: TS,
	text: "Four invoices were late.",
	streaming: false,
	stopReason: null,
	error: false,
});

/* --------------------------------- A2 ----------------------------------- */

test(`${ARM} A2: cue scans and DOM reads across flushes`, async () => {
	const rows = Array.from({ length: ROWS }, (_, i) => ({
		record: { id: `r${i}` },
	}));
	const checkpoints = Array.from({ length: CHECKPOINTS }, (_, i) => ({
		id: `r${i}`,
		kind: "user",
		turn: i,
		ts: 1_780_000_000 + i,
		seq: i,
		text: "a message",
	}));
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const render = (next) =>
		act(async () => {
			root.render(h(CueHarness, { rows: next, checkpoints }));
		});
	await render(rows);
	const region = container.querySelector("[data-region]");
	assert.ok(region, "the cue's region mounted");
	/* Count the scan's DOM reads: one `querySelector` per loaded checkpoint. */
	let querySelectorCalls = 0;
	const realQuerySelector = region.querySelector.bind(region);
	region.querySelector = (selector) => {
		querySelectorCalls += 1;
		return realQuerySelector(selector);
	};
	region.getBoundingClientRect = () => ({
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		width: 0,
		height: 0,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	});

	dbgActiveCueScans.count = 0;
	querySelectorCalls = 0;
	/* The flush: the SAME content, handed back with a fresh array identity. */
	for (let i = 0; i < FLUSHES; i += 1) {
		await render(rows.map((row) => ({ ...row })));
	}
	report.A2 = {
		scans: dbgActiveCueScans.count,
		scansPerFlush: dbgActiveCueScans.count / FLUSHES,
		querySelectorCalls,
		querySelectorPerFlush: querySelectorCalls / FLUSHES,
	};
	await act(async () => {
		root.unmount();
	});
	container.remove();
	/*
	 * The fixed-contract asserts run on the `after` arm only: the `before` arm is
	 * the counter-patched `origin/main`, whose numbers are the FINDING (the cost
	 * these fixes removed), so failing them there is the instrument working
	 * rather than a defect. The A6 falsifier assert is unconditional.
	 */
	if (ARM === "after") {
		assert.ok(
			report.A2.scansPerFlush < 0.05,
			`a content-identical flush does not re-scan (got ${report.A2.scansPerFlush})`,
		);
	}
});

/* --------------------------------- A3 ----------------------------------- */

test(`${ARM} A3: collapsePlan calls across transcript flushes`, async () => {
	const records = [
		userRecord("user:1"),
		...Array.from({ length: 60 }, (_, i) => toolRecord(`tool:${i + 1}`)),
		answerRecord("answer:1"),
	];
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const render = (next) =>
		act(async () => {
			root.render(
				h(
					QueryClientProvider,
					{ client },
					h(CanonicalTranscript, {
						frontend: null,
						transcript: transcriptOf(next),
						gate: null,
						waiting: false,
						loadingOlder: false,
						onLoadOlder: async () => true,
						containerRef: { current: container },
						isSmallView: false,
						status: "live",
						failure: null,
						awaitingHydration: false,
						onReconnect: () => {},
					}),
				),
			);
		});
	dbgCollapsePlanCalls.count = 0;
	await render(records);
	const afterMount = dbgCollapsePlanCalls.count;
	for (let i = 0; i < FLUSHES; i += 1) {
		/* A flush: same content, fresh record identities (the socket's shape). */
		await render(records.map((record) => ({ ...record })));
	}
	report.A3 = {
		afterMount,
		total: dbgCollapsePlanCalls.count,
		perFlush: (dbgCollapsePlanCalls.count - afterMount) / FLUSHES,
	};
	await act(async () => {
		root.unmount();
	});
	container.remove();
	if (ARM === "after") {
		/*
		 * 0, not 1.05 (PR-6): a flush whose CONTENT is unchanged now moves no
		 * plan input at all, because the memo keys on the input signature rather
		 * than on the row array. The bound moved with the fix - see A7 for the
		 * streaming case (a text delta, which is the same shape).
		 */
		assert.ok(
			report.A3.perFlush <= 0.05,
			`a content-identical update buys no plan (got ${report.A3.perFlush})`,
		);
	}
});

/* --------------------------------- A7 ----------------------------------- */

test(`${ARM} A7: plans, feet and entries across a token stream`, async () => {
	/*
	 * THE TOKEN THE PERF PASS IS FOR (UI perf audit P1/P4; PR-6). Streaming
	 * hands back the same conversation with one more character in the answer -
	 * and, on a socket flush, fresh copies of everything. Nothing about the
	 * PARTITION moves, so neither the plan nor the foot map may be rebuilt; the
	 * chat-entry list MUST still rebuild, because it carries the rows the text
	 * has to travel through to reach the DOM (its lower bound is asserted too,
	 * so a future change that "optimises" the entries by freezing them fails
	 * here instead of shipping a transcript that stops writing).
	 */
	const records = [
		userRecord("user:1"),
		...Array.from({ length: 60 }, (_, i) => toolRecord(`tool:${i + 1}`)),
		{ ...answerRecord("answer:1"), text: "Four", streaming: true },
	];
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const render = (next) =>
		act(async () => {
			root.render(
				h(
					QueryClientProvider,
					{ client },
					h(CanonicalTranscript, {
						frontend: null,
						transcript: transcriptOf(next),
						gate: null,
						waiting: false,
						loadingOlder: false,
						onLoadOlder: async () => true,
						containerRef: { current: container },
						isSmallView: false,
						status: "live",
						failure: null,
						awaitingHydration: false,
						onReconnect: () => {},
					}),
				),
			);
		});
	let current = records;
	dbgCollapsePlanCalls.count = 0;
	dbgFeetRebuilds.count = 0;
	dbgChatEntriesRebuilds.count = 0;
	await render(current);
	const mounted = {
		plans: dbgCollapsePlanCalls.count,
		feet: dbgFeetRebuilds.count,
		entries: dbgChatEntriesRebuilds.count,
	};
	for (let i = 0; i < FLUSHES; i += 1) {
		current = current.map((record) =>
			record.id === "answer:1"
				? { ...record, text: `${record.text} x` }
				: { ...record },
		);
		await render(current);
	}
	report.A7 = {
		mounted,
		plans: dbgCollapsePlanCalls.count - mounted.plans,
		feet: dbgFeetRebuilds.count - mounted.feet,
		entries: dbgChatEntriesRebuilds.count - mounted.entries,
		plansPerToken: (dbgCollapsePlanCalls.count - mounted.plans) / FLUSHES,
		feetPerToken: (dbgFeetRebuilds.count - mounted.feet) / FLUSHES,
		entriesPerToken: (dbgChatEntriesRebuilds.count - mounted.entries) / FLUSHES,
	};
	await act(async () => {
		root.unmount();
	});
	container.remove();
	if (ARM === "after") {
		assert.ok(
			report.A7.plansPerToken <= 0.05,
			`a text-only token buys no plan (got ${report.A7.plansPerToken})`,
		);
		assert.ok(
			report.A7.feetPerToken <= 0.05,
			`a text-only token rebuilds no foot (got ${report.A7.feetPerToken})`,
		);
		assert.ok(
			report.A7.entriesPerToken >= 0.95,
			`the text still travels through the entries (got ${report.A7.entriesPerToken})`,
		);
	}
});

/* --------------------------------- A4 ----------------------------------- */

test(`${ARM} A4: idle wakeups for an armed-at-tail demand`, () => {
	/*
	 * The DOM half's re-arm, transcribed from `use-scroll-paging.ts`'s
	 * `schedule()`:
	 *     if (action === "none" && (next.armed || next.pageWidenOwed) && !timer)
	 *         timer = setTimeout(schedule, SETTLE_MS)
	 * The policy is the shipped `decide`; only the timer bookkeeping is local.
	 */
	const geo = {
		distanceFromTopPx: 6000,
		clientHeight: 800,
		hiddenRows: 0,
		hasMore: true,
		scrollable: true,
		followingTail: true,
	};
	let state = noteInput(initialPagingState(), {
		direction: "up",
		continuous: true,
		deliberate: false,
		atHardTop: false,
		at: 0,
		travelledPx: 30,
	});
	assert.equal(state.armed, true, "the notch arms a demand");
	const IDLE_WINDOW_MS = 5_000;
	let now = 0;
	let wakeups = 0;
	while (now < IDLE_WINDOW_MS) {
		const { action, state: next } = decide(state, geo, now);
		state = next;
		if (action === "none" && (next.armed || next.pageWidenOwed)) {
			wakeups += 1;
			now += SETTLE_MS;
			continue;
		}
		break;
	}
	report.A4 = { wakeups, settleMs: SETTLE_MS, idleWindowMs: IDLE_WINDOW_MS };
	if (ARM === "after") {
		assert.ok(
			wakeups <= 1,
			`the tail does not re-arm the settle timer forever (got ${wakeups})`,
		);
	}
});

/* --------------------------------- A6 ----------------------------------- */

test(`${ARM} A6: rail renders per flush (fixed vs pre-fix call site)`, async () => {
	const checkpoints = Array.from({ length: CHECKPOINTS }, (_, i) => ({
		id: `c${i}`,
		kind: "user",
		turn: i,
		ts: 1_780_000_000 + i,
		seq: i,
		text: "a message",
	}));
	const loadedIds = new Set(checkpoints.map((c) => c.id));
	const stableJump = () => {};
	const stableHover = () => {};
	const stableSession = "s";
	const measure = async (freshJump) => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const render = (jump) =>
			act(async () => {
				root.render(
					h(CheckpointRail, {
						sessionId: stableSession,
						checkpoints,
						onJump: jump,
						onHover: stableHover,
						building: false,
						loadedIds,
						activeId: null,
					}),
				);
			});
		dbgRailRenders.count = 0;
		await render(freshJump ? () => {} : stableJump);
		const afterMount = dbgRailRenders.count;
		for (let i = 0; i < FLUSHES; i += 1) {
			await render(freshJump ? () => {} : stableJump);
		}
		const renders = dbgRailRenders.count - afterMount;
		await act(async () => {
			root.unmount();
		});
		container.remove();
		return renders / FLUSHES;
	};
	report.A6 = {
		fixedPerFlush: await measure(false),
		falsifierPerFlush: await measure(true),
	};
	if (ARM === "after") {
		assert.ok(
			report.A6.fixedPerFlush < 0.05,
			`a flush that moves nothing the rail paints does not run it (got ${report.A6.fixedPerFlush})`,
		);
	}
	assert.ok(
		report.A6.falsifierPerFlush > 0.5,
		`the pre-fix call site really defeats the boundary (got ${report.A6.falsifierPerFlush})`,
	);
});

test(`${ARM} report`, () => {
	process.stderr.write(`PERF_BENCH_REPORT ${JSON.stringify(report)}\n`);
	bootstrapDOM.window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});
