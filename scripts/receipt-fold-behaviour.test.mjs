/**
 * THE RECEIPT FOLD, driven through the SHIPPED reducer and transcript.
 *
 * `trace-fold-model.test.mjs` asserts the arithmetic: which runs fold, what the
 * header counts, and that a receipt never enters the action arithmetic. This
 * file asserts what only a mount can: that a journal page with the operator's
 * wall of `job result` rows replays through `applyHistoryPage` into ONE fold
 * whose header's numbers match the rows it reveals, and that the receipts are
 * really unmounted while condensed.
 *
 * THE ANSWER-OUTSIDE PROPERTY IS THE SYNTHETIC PAGE'S, not the real-journal
 * slice's: that fixture carries no painted assistant answer to assert it
 * against, so #1190's rule is checked on the synthetic page, which does.
 *
 * WHY THE FIXTURE IS THE REAL SESSION. `scripts/fixtures/receipt-fold-8c2ff1914f44.json`
 * is journal lines 600-830 of the operator's reported session with ids, paths,
 * commands and prose neutralised. The hand-authored page beside it exists to
 * state exact counts (13 calls, 12 receipts, 4 job results) that the real slice
 * cannot - the slice has whatever the session had. Both go through
 * `applyHistoryPage`: hand-built `TranscriptRecord[]` would skip the reducer,
 * which is the half that decides `custom/job_result` is a receipt at all.
 *
 * The harness is `turn-collapse-behaviour.test.mjs`'s (jsdom, the real
 * `CanonicalTranscript`, rAF drained inside `act`); jsdom has no layout engine,
 * so nothing here is geometry evidence.
 */
import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";

const bootstrapDOM = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = bootstrapDOM;
const originals = new Map();
const rafQueue = [];
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
window.matchMedia ??= shims.matchMedia;
window.requestAnimationFrame = shims.requestAnimationFrame;
window.cancelAnimationFrame = shims.cancelAnimationFrame;
window.Element.prototype.scrollIntoView = function scrollIntoView() {};
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
			'export { applyHistoryPage, EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";',
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
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});
const bundlePath = new URL(
	`./_receipt-fold-behaviour-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	applyHistoryPage,
	EMPTY_TRANSCRIPT,
	CanonicalTranscript,
	__resetTurnCollapseOpen,
} = await import(bundlePath.href);
await unlink(bundlePath);

/* ------------------------------- fixtures ------------------------------- */

const TS = 1_792_000_000;
let sequence = 0;
const id = (prefix) => `${prefix}-${sequence++}`;
const at = () => TS + sequence * 1000;

const entry = (payload) => {
	const next = id("entry");
	return { id: next, ts: at(), type: "message", payload };
};
const userEntry = () =>
	entry({
		kind: "message",
		role: "user",
		content: [{ text: "Fix the transcript fold tier." }],
	});
const callEntry = (callId) =>
	entry({
		kind: "message",
		role: "assistant",
		tool_calls: [
			{
				id: callId,
				name: "bash",
				arguments: { command: "pnpm test", i: "Running the tests" },
			},
		],
		stop_reason: "toolUse",
	});
const resultEntry = (callId, error = false) =>
	entry({
		kind: "message",
		role: "tool",
		tool_call_id: callId,
		tool_name: "bash",
		content: [
			{
				text: error
					? "exit code: 1\n--- stdout ---\nfailed"
					: "exit code: 0\n--- stdout ---\nok",
			},
		],
		is_error: error,
	});
const jobEntry = (index, pinned = true) =>
	entry({
		kind: "custom",
		custom_type: "job_result",
		attribution: "user",
		details: {
			job_id: `job-${index}`,
			text: pinned
				? `background job 'worker-${index}' completed (pinned anthropic/claude-sonnet-5-5, ran on openai/gpt-6.1-sol):\nReviewed the change.`
				: `background job 'worker-${index}' completed:\nReviewed the change.`,
		},
	});
const hubEntry = (label) =>
	entry({
		kind: "custom",
		custom_type: "hub_message",
		attribution: "user",
		details: {
			direction: "to_parent",
			job_id: "job-hub",
			label,
			body: `A note from ${label}.`,
			text: `<subagent-message label='${label}' job='job-hub'>\nA note from ${label}.\n</subagent-message>`,
		},
	});
const peerEntry = () =>
	entry({
		kind: "custom",
		custom_type: "peer_message",
		details: {
			text: "<peer-session-message from_pid='1' conversation='sibling'>\nA note from a sibling session.\n</peer-session-message>",
			sender: { pid: "1", conversation_name: "sibling", model_label: "test" },
		},
	});
const answerEntry = () =>
	entry({
		kind: "message",
		role: "assistant",
		content: [{ text: "The fold tier now counts internal receipts honestly." }],
		stop_reason: "stop",
	});

const transcriptOf = (records) => ({
	records,
	index: new Map(records.map((record, position) => [record.id, position])),
	generation: 1,
	oldestId: null,
	hasMore: false,
	argsByCall: new Map(),
});

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
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	await act(async () => {
		mounted.root = createRoot(mounted.container);
		mounted.root.render(
			h(
				QueryClientProvider,
				{ client },
				h(CanonicalTranscript, {
					frontend: null,
					attachmentScope: undefined,
					transcript: transcriptOf(records),
					openFrame: undefined,
					gate: null,
					waiting: over.waiting ?? false,
					workingLine: over.workingLine,
					loadingOlder: false,
					onLoadOlder: async () => true,
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
	return mounted;
};

const flushFrames = async () => {
	for (let depth = 0; depth < 4 && rafQueue.length > 0; depth += 1) {
		const queued = rafQueue.splice(0);
		await act(async () => {
			for (const callback of queued) callback(0);
		});
	}
};
const click = async (element) => {
	assert.ok(element, "the control exists");
	await act(async () => {
		element.dispatchEvent(
			new window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
	await flushFrames();
};
const foldSummaries = (mounted) => [
	...mounted.container.querySelectorAll("[data-fold-summary]"),
];
const foldFor = (mounted, text) =>
	foldSummaries(mounted).find((node) => node.textContent?.includes(text));
const foldTrigger = (summary) => summary?.closest("button");

const replay = (entries) =>
	applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries,
		has_more: false,
		cursor_missing: false,
	});

/**
 * The operator's page: one call per receipt interleaved, exactly the shape
 * `[bash, job_result, bash, job_result, ...]` that used to leave one standalone
 * `job result` row per chevron.
 */
const syntheticPage = () => {
	sequence = 0;
	const entries = [userEntry()];
	const jobIds = [];
	const receiptIds = [];
	for (let index = 0; index < 13; index++) {
		const callId = `call-${index}`;
		entries.push(callEntry(callId), resultEntry(callId, index === 7));
		if (index < 4) {
			entries.push(jobEntry(index, index !== 3));
			jobIds.push(entries.at(-1).id);
		}
		if (index < 8) {
			entries.push(hubEntry(`worker-${index}`));
			receiptIds.push(entries.at(-1).id);
		}
		if (index < 4) {
			entries.push(peerEntry());
			receiptIds.push(entries.at(-1).id);
		}
	}
	const answer = answerEntry();
	entries.push(answer);
	return { entries, jobIds, receiptIds, answerId: answer.id };
};

/* -------------------------------- the tests -------------------------------- */

test("the operator's wall folds through the reducer into one receipt-aware group", async (t) => {
	__resetTurnCollapseOpen();
	const page = syntheticPage();
	const state = replay(page.entries);
	const mounted = await mount(t, state.records);

	/*
	 * ONE group for the stretch, and its count line names the receipts by family
	 * rather than calling every internal row an incoming message. The action side
	 * is the count vocabulary (`13 shell`), never a sentence glued to the receipt
	 * units; the failed call is still counted as an action and not as a receipt.
	 */
	const summaries = foldSummaries(mounted);
	assert.equal(summaries.length, 1, "exactly one fold group on the page");
	const summary = summaries[0];
	const text = summary.textContent ?? "";
	assert.match(text, /13 shell/);
	assert.match(text, /12 incoming messages/);
	assert.match(text, /4 job results/);
	assert.doesNotMatch(text, /incoming 4|message result/i);
	assert.ok(
		!text.includes("job result:"),
		`the standalone receipt label is gone, got: ${text}`,
	);
	assert.equal(
		summary.getAttribute("title"),
		text,
		"the tooltip states the same units the count line paints",
	);
	for (const jobId of page.jobIds) {
		assert.equal(
			mounted.container.querySelector(`[data-record-id="${jobId}"]`),
			null,
			"a collapsed fold unmounts the job-result row",
		);
	}
	/*
	 * THE ANSWER IS THE READER'S, and outside the fold: #1190's rule that the
	 * agent's final answer is never hidden behind a count still holds.
	 */
	const answer = mounted.container.querySelector(
		`[data-record-id="${page.answerId}"]`,
	);
	assert.ok(answer, "the final answer is rendered");
	assert.equal(
		answer.closest("[data-fold-ids]"),
		null,
		"the answer is not inside the fold",
	);
	assert.match(answer.textContent ?? "", /counts internal receipts honestly/);
});

test("a run ending in two adjacent job results folds with one call", async (t) => {
	/*
	 * The trailing-stretch rule, through the shipped reducer and transcript: one
	 * call followed by two receipts is BELOW §E2's action threshold, and the fold
	 * must still be one group whose counts are the two things it holds. This is
	 * the mixed case a pure-receipt fixture cannot prove.
	 *
	 * The small settled turn may arrive behind its OWN turn-tier bar - a separate
	 * view, existing behaviour, not the fold's - so the case opens that bar if it
	 * is there and asserts the fold the reader then sees. The fold is the
	 * guarantee under test; the turn tier is not re-pinned here.
	 */
	__resetTurnCollapseOpen();
	sequence = 0;
	const entries = [userEntry()];
	const callId = "call-tail";
	entries.push(callEntry(callId), resultEntry(callId));
	const jobIds = [];
	for (let index = 0; index < 2; index++) {
		entries.push(jobEntry(index));
		jobIds.push(entries.at(-1).id);
	}
	entries.push(answerEntry());
	const mounted = await mount(t, replay(entries).records);
	const turnBar = mounted.container.querySelector(
		"[data-turn-summary] button[aria-expanded='false']",
	);
	if (turnBar) await click(turnBar);
	const summaries = foldSummaries(mounted);
	assert.equal(
		summaries.length,
		1,
		"one call + two tail receipts is one group",
	);
	const text = summaries[0].textContent ?? "";
	assert.match(text, /1 shell/);
	assert.match(text, /2 job results/);
	for (const id of jobIds) {
		assert.equal(
			mounted.container.querySelector(`[data-record-id="${id}"]`),
			null,
			"both trailing receipts are inside the condensed fold",
		);
	}
});

test("expanding a receipt-aware fold reveals exactly the rows its header counted", async (t) => {
	__resetTurnCollapseOpen();
	const page = syntheticPage();
	const state = replay(page.entries);
	const mounted = await mount(t, state.records);
	const summary = foldFor(mounted, "job results");
	assert.ok(summary, "the receipt-aware fold is on screen");
	const header = summary.textContent ?? "";
	const trigger = foldTrigger(summary);
	assert.equal(
		trigger.getAttribute("aria-expanded"),
		"false",
		"the fold arrives condensed",
	);
	await click(trigger);
	assert.equal(trigger.getAttribute("aria-expanded"), "true");
	const mountedIds = new Set(
		[...mounted.container.querySelectorAll("[data-record-id]")].map((node) =>
			node.getAttribute("data-record-id"),
		),
	);
	const revealedJobs = page.jobIds.filter((id) => mountedIds.has(id));
	assert.equal(
		revealedJobs.length,
		4,
		`the header said ${header}; expanding mounts that many job-result rows`,
	);
	for (const id of revealedJobs) {
		assert.match(
			mounted.container.querySelector(`[data-record-id="${id}"]`)
				?.textContent ?? "",
			/background job/,
		);
	}
	const headerCount = Number(/(\d+) job results/.exec(header)?.[1]);
	assert.equal(
		headerCount,
		revealedJobs.length,
		"the header's job-result number is the number of rows behind it",
	);
	const incoming = Number(/(\d+) incoming messages/.exec(header)?.[1]);
	const revealedReceipts = page.receiptIds.filter((id) => mountedIds.has(id));
	assert.equal(
		incoming,
		revealedReceipts.length,
		"the header's incoming number is the number of receipt rows behind it",
	);
});

test("the real journal slice (8c2ff1914f44) has no standalone job-result rows", async (t) => {
	__resetTurnCollapseOpen();
	const fixture = JSON.parse(
		await readFile(
			new URL("./fixtures/receipt-fold-8c2ff1914f44.json", import.meta.url),
			"utf8",
		),
	);
	const state = replay(fixture.entries);
	const jobRows = state.records.filter(
		(record) => record.kind === "custom" && record.customType === "job_result",
	);
	assert.equal(
		jobRows.length,
		8,
		"the slice carries the session's job results",
	);
	const mounted = await mount(t, state.records);
	const summary = foldFor(mounted, "job results");
	assert.ok(summary, "the real slice folds its receipts");
	const header = summary.textContent ?? "";
	/*
	 * The transcript renders a WINDOW of the replay (the newest rows), so this
	 * asserts the mounted group's arithmetic, not the whole slice's: the number
	 * the header states must be the number expanding mounts. The full slice's
	 * before/after numbers are the evidence script's.
	 */
	const headerJobs = Number(/(\d+) job results/.exec(header)?.[1]);
	assert.ok(headerJobs > 0, `the header counts job results, got: ${header}`);
	assert.match(header, /\d+ incoming messages/);
	for (const record of jobRows) {
		assert.equal(
			mounted.container.querySelector(`[data-record-id="${record.id}"]`),
			null,
			"no job-result row stands alone while the fold is condensed",
		);
	}
	const trigger = foldTrigger(summary);
	await click(trigger);
	/*
	 * OPENING THE FOLD WIDENS THE RENDER WINDOW to the whole run (the transcript
	 * loads the rows the disclosure is about to show), so the header is re-read
	 * AFTER the press: the collapsed window may have held five of the slice's
	 * eight job results, and the expanded group must count all eight it mounts.
	 * The invariant is agreement at each commit, not a frozen pre-press number.
	 */
	/*
	 * Re-query: the press can remount the fold (its open state reaches the
	 * transcript's registry through a commit), and the pre-press node may be
	 * detached. Read the header the reader now sees.
	 */
	const expandedSummary = foldFor(mounted, "job results");
	assert.ok(expandedSummary, "the opened fold is on screen");
	const expandedHeader = expandedSummary.textContent ?? "";
	const expandedJobs = Number(/(\d+) job results/.exec(expandedHeader)?.[1]);
	assert.ok(
		expandedJobs >= headerJobs,
		"the expanded group counts at least what the collapsed window counted",
	);
	const revealed = jobRows.filter((record) =>
		mounted.container.querySelector(`[data-record-id="${record.id}"]`),
	);
	assert.equal(
		revealed.length,
		expandedJobs,
		`expanding the real slice mounts exactly the job results the header counts (header ${expandedJobs}, mounted ${revealed.length})`,
	);
	for (const record of revealed) {
		assert.match(
			mounted.container.querySelector(`[data-record-id="${record.id}"]`)
				?.textContent ?? "",
			/background job/,
		);
	}
});
