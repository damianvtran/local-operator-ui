/**
 * The chat data-object copy follows the language picker: the notice records the
 * reducer builds, the transcript display-mode names, the sidebar's Ungrouped
 * heading, the bulk mark-read label and the link toolbar's accessible name.
 *
 *     node --test scripts/i18n/chat-data-copy.test.mjs
 *
 * WHY THIS SUITE EXISTS. These sentences all lived in data objects
 * (`i18n/literal-allowance.json`, "data-object copy properties hold sentences
 * that reach the screen"), and the recurring defect of that class is a value
 * computed once - at module load, or at reduce time into long-lived state - that
 * never reads the locale again. So every case here SWITCHES LOCALE after the
 * value was produced and asserts the string changed, through the production
 * function or the production component rather than a restatement of the catalogue.
 *
 * HOW A CHANGE IS OBSERVED. A marker catalogue is registered over `fr` so each
 * key resolves to a value that names itself and its arguments; those new keys
 * deliberately ship English-only in `fr` until the translator lane runs, so a
 * comparison against shipped French would not be a test at all. A hardcoded
 * string cannot return a marker, and an argument the call forgot shows up as a
 * blank in the marker.
 *
 * PIXELS ARE OUT OF SCOPE: jsdom proves the live text, not geometry.
 *
 * RETENTIONS (asserted absent from the allowance by `check-strings`, not here):
 * the effort chip's `auto`/`unknown`/`reasoning` tokens (localized at the
 * display seam by `effortDisplay`), the quiet-group `<N> more` parity datum and
 * the `billing` failure-class token carry `i18n: ignore` pragmas with reasons.
 */
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
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
	requestAnimationFrame: () => 0,
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
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
after(() => {
	/* Cancels react-query's gc timers, which would otherwise hold the process open. */
	queryClient.clear();
	bootstrapDOM.window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

const bundle = await build({
	stdin: {
		contents: `
			export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";
			export { applyEvent, applyHistoryPage, withRecoveredOutcome, EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
			export { copyTextForRecord } from "./src/renderer/src/features/chat/canonical/transcript-copy";
			export { noticeText } from "./src/renderer/src/features/chat/canonical/notice-copy";
			export { groupRows } from "./src/renderer/src/features/chat/chat-sidebar-view";
			export { markAllReadCopy } from "./src/renderer/src/features/chat/mark-all-read";
			export { linkToolbarModel } from "./src/renderer/src/features/chat/utils/link-actions";
			export {
				TRANSCRIPT_DISPLAY_MODE_OPTIONS,
				transcriptDisplayModeLabel,
			} from "./src/renderer/src/features/chat/transcript-display-mode";
			export { registerCatalogue, clearRegisteredCatalogues, setLocale } from "./src/renderer/src/shared/i18n";`,
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
	`./_chat-data-copy-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const mod = await import(bundlePath.href);
await unlink(bundlePath);

/** Each value names its key and arguments, so a lost argument is visible. */
const MARKERS = {
	"ui.chat.canonical.notice.interrupted": "M interrupted",
	"ui.chat.canonical.notice.stopped_with_error": "M stopped_with_error",
	"ui.chat.canonical.notice.compaction_not_run": "M not_run detail={detail}",
	"ui.chat.canonical.notice.compaction_not_run_after_colon":
		"M not_run_colon detail={detail}",
	"ui.chat.canonical.link_toolkit.actions_for": "M actions_for name={name}",
	"ui.chat.sidebar_view.ungrouped": "M ungrouped",
	"ui.chat.sidebar.mark_all_read.label": "M mark_all count={count}",
	"ui.settings.appearance.transcript_display_mode_setting.by_turn": "M by_turn",
	"ui.settings.appearance.transcript_display_mode_setting.by_response":
		"M by_response",
};

const useMarkers = () => {
	mod.registerCatalogue("fr", MARKERS);
	act(() => mod.setLocale("fr"));
};
const useEnglish = () => act(() => mod.setLocale("en"));

const TS = 1_760_000_000_000;
const marker = (kind) => ({
	id: `m-${kind}`,
	ts: 2,
	type: "custom",
	payload: {
		custom_type: "completion_attention",
		details: {
			conversation_id: "session/123456abcdef",
			token: "t1",
			anchor: `completion-${kind}-anchor`,
			kind,
		},
	},
});
const historyRecords = (kinds) =>
	mod.applyHistoryPage(mod.EMPTY_TRANSCRIPT, {
		entries: kinds.map(marker),
		has_more: false,
		cursor_missing: false,
	}).records;

test("a reducer-built completion notice re-resolves its sentence after a locale switch", () => {
	useEnglish();
	const [stopped, interrupted] = historyRecords(["error", "interrupted"]);
	assert.equal(mod.noticeText(stopped), "Stopped with an error");
	assert.equal(mod.noticeText(interrupted), "Interrupted");
	useMarkers();
	// Same record objects: state is not rebuilt by a language change.
	assert.equal(mod.noticeText(stopped), "M stopped_with_error");
	assert.equal(mod.noticeText(interrupted), "M interrupted");
	assert.equal(
		mod.copyTextForRecord(interrupted),
		"M interrupted",
		"the clipboard text is what the row currently says",
	);
	useEnglish();
});

test("the recovered outcome row carries a re-resolvable sentence", () => {
	useEnglish();
	const state = mod.withRecoveredOutcome(
		mod.EMPTY_TRANSCRIPT,
		{ anchor_id: "completion-x", kind: "interrupted", unseen: true },
		false,
	);
	const row = state.records.at(-1);
	assert.equal(mod.noticeText(row), "Interrupted");
	useMarkers();
	assert.equal(mod.noticeText(row), "M interrupted");
	useEnglish();
});

test("a refused compaction keeps the runtime's reason verbatim and picks its joiner by locale-free rule", () => {
	useEnglish();
	const refused = (detail) => ({
		id: `c-${detail}`,
		ts: 3,
		type: "message",
		payload: { custom_type: "compaction_refused", details: { detail } },
	});
	const records = mod.applyHistoryPage(mod.EMPTY_TRANSCRIPT, {
		entries: [refused("nothing to compact"), refused("kept: 20,000 tokens")],
		has_more: false,
		cursor_missing: false,
	}).records;
	const plain = records.find((r) => r.id === "c-nothing to compact");
	const coloned = records.find((r) => r.id === "c-kept: 20,000 tokens");
	assert.equal(
		mod.noticeText(plain),
		"Compaction did not run: nothing to compact",
	);
	assert.equal(
		mod.noticeText(coloned),
		"Compaction did not run \u2014 kept: 20,000 tokens",
	);
	useMarkers();
	assert.equal(mod.noticeText(plain), "M not_run detail=nothing to compact");
	assert.equal(
		mod.noticeText(coloned),
		"M not_run_colon detail=kept: 20,000 tokens",
	);
	/* The live compaction_end failure path builds the same record shape. */
	useEnglish();
	const live = mod
		.applyEvent(
			mod.applyEvent(mod.EMPTY_TRANSCRIPT, { type: "compaction_start" }),
			{ type: "compaction_end", success: false, detail: "nothing to compact" },
		)
		.records.at(-1);
	assert.equal(live.kind, "notice");
	useMarkers();
	assert.equal(mod.noticeText(live), "M not_run detail=nothing to compact");
	useEnglish();
});

test("the display-mode names are read at call time, not frozen in the options", () => {
	useEnglish();
	assert.equal(mod.transcriptDisplayModeLabel("by-turn"), "By turn");
	assert.equal(mod.transcriptDisplayModeLabel("by-response"), "By response");
	useMarkers();
	assert.equal(mod.transcriptDisplayModeLabel("by-turn"), "M by_turn");
	assert.equal(mod.transcriptDisplayModeLabel("by-response"), "M by_response");
	for (const option of mod.TRANSCRIPT_DISPLAY_MODE_OPTIONS) {
		assert.equal(
			"label" in option,
			false,
			"a stored label would be the boot language for the whole session",
		);
	}
	useEnglish();
});

test("the sidebar's Ungrouped heading follows the locale; named groups do not", () => {
	useEnglish();
	const rows = [
		{ id: "a", binding: { agent: "Researcher" } },
		{ id: "b", binding: null },
	];
	const labels = () => mod.groupRows(rows, "agent").map((g) => g.label);
	assert.deepEqual(labels(), ["Researcher", "Ungrouped"]);
	useMarkers();
	assert.deepEqual(labels(), ["Researcher", "M ungrouped"]);
	useEnglish();
});

test("the bulk mark-read label carries its count and follows the locale", () => {
	useEnglish();
	const unread = (id) => ({
		id,
		session_id: id,
		active: true,
		attention: { unseen: true, completion_token: `t-${id}` },
		status: { code: "complete" },
	});
	const rows = [unread("a"), unread("b"), unread("c")];
	const label = () => mod.markAllReadCopy(rows);
	const english = label();
	assert.equal(english.label, `Mark all ${english.count} read`);
	assert.ok(english.count > 0, "the fixture must have ackable rows");
	useMarkers();
	assert.equal(label().label, `M mark_all count=${english.count}`);
	useEnglish();
});

test("the link toolbar's accessible name carries the target and follows the locale", () => {
	useEnglish();
	const model = () =>
		mod.linkToolbarModel({
			kind: "url",
			target: "https://example.com/a/paper.pdf",
			probe: null,
			quotable: false,
			canOpenInCanvas: false,
		});
	assert.equal(model().label, "Actions for paper.pdf");
	useMarkers();
	assert.equal(model().label, "M actions_for name=paper.pdf");
	useEnglish();
});

const transcriptOf = (records) => ({
	records,
	index: new Map(records.map((record, position) => [record.id, position])),
	generation: 1,
	oldestId: null,
	hasMore: false,
	argsByCall: new Map(),
});

test("the mounted transcript repaints a stored completion notice when the locale changes", () => {
	useEnglish();
	const [notice] = historyRecords(["interrupted"]);
	const records = [
		{ kind: "user", id: "u1", ts: TS, text: "Run it", images: [] },
		{
			kind: "assistant",
			id: "a1",
			ts: TS,
			text: "Started.",
			streaming: false,
			stopReason: null,
			error: false,
		},
		notice,
	];
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	act(() => {
		root.render(
			h(
				QueryClientProvider,
				{ client: queryClient },
				h(mod.CanonicalTranscript, {
					transcript: transcriptOf(records),
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
	try {
		assert.ok(
			container.textContent.includes("Interrupted"),
			`English notice is painted; got ${JSON.stringify(container.textContent)}`,
		);
		// Same records, same transcript object: only the locale store notifies.
		useMarkers();
		assert.ok(
			container.textContent.includes("M interrupted"),
			`the stored notice repaints in the new language; got ${JSON.stringify(container.textContent)}`,
		);
		assert.ok(!container.textContent.includes("Interrupted"));
	} finally {
		act(() => root.unmount());
		container.remove();
		useEnglish();
	}
});
