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
			export { registerCatalogue, clearRegisteredCatalogues, setLocale, t } from "./src/renderer/src/shared/i18n";`,
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
	"ui.chat.sidebar.mark_all_read.scope_chats": "M scope_chats count={count}",
	"ui.chat.sidebar.mark_all_read.scope_chats_elsewhere":
		"M scope_chats_elsewhere count={count} elsewhere={elsewhere}",
	"ui.chat.sidebar.mark_all_read.scope_tokenless":
		"M scope_tokenless count={count}",
	"ui.chat.sidebar.mark_all_read.scope_joined":
		"M scope_joined [{chats}] [{tokenless}]",
	"ui.chat.sidebar.mark_all_read.name_suffix_elsewhere":
		"M name_suffix elsewhere={elsewhere}",
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

/** Words the English tooltip is made of; none may survive in another locale. */
const ENGLISH_TOOLTIP_FRAGMENT =
	/\b(Mark|unread|chats?|including|not active|completion token|cleared)\b/;

test("the bulk control's tooltip and accessible-name suffix are catalogue copy in every locale", () => {
	/*
	 * `scope` is the tooltip and `nameSuffix` the tail of the accessible name; both
	 * were English sentences built by template literal, so a French reader got an
	 * English tooltip and an English screen-reader tail beside a French label. The
	 * marker catalogue makes the claim checkable: a hardcoded sentence cannot
	 * return a marker, and no English fragment may survive around one.
	 */
	useEnglish();
	const row = (id, { active = true, token = `t-${id}` } = {}) => ({
		id,
		session_id: id,
		active,
		attention: { unseen: true, completion_token: token },
		status: { code: "complete" },
	});
	const local = [row("a"), row("b")];
	const elsewhere = [row("a"), row("b", { active: false })];
	const tokenless = [row("a"), row("c", { token: null })];
	const both = [...elsewhere, row("c", { token: null })];

	// The English text the keys must reproduce byte for byte.
	assert.equal(
		mod.markAllReadCopy(local).scope,
		"Mark 2 unread chats as read.",
	);
	assert.equal(mod.markAllReadCopy(local).nameSuffix, "");
	assert.equal(
		mod.markAllReadCopy(elsewhere).scope,
		"Mark 2 unread chats as read, including 1 that is not active.",
	);
	assert.equal(
		mod.markAllReadCopy(elsewhere).nameSuffix,
		", including 1 that is not active",
	);
	assert.equal(
		mod.markAllReadCopy(tokenless).scope,
		"Mark 1 unread chat as read. 1 unread mark with no completion token cannot be cleared.",
	);
	assert.equal(
		mod.markAllReadCopy(both).scope,
		"Mark 2 unread chats as read, including 1 that is not active. 1 unread mark with no completion token cannot be cleared.",
	);

	useMarkers();
	assert.equal(
		mod.markAllReadCopy(local).scope,
		"M scope_chats count=2",
		"the tooltip is the catalogue's sentence",
	);
	assert.equal(
		mod.markAllReadCopy(local).nameSuffix,
		"",
		"no words are spent on nothing, in any language",
	);
	assert.equal(
		mod.markAllReadCopy(elsewhere).scope,
		"M scope_chats_elsewhere count=2 elsewhere=1",
	);
	assert.equal(
		mod.markAllReadCopy(elsewhere).nameSuffix,
		"M name_suffix elsewhere=1",
	);
	assert.equal(
		mod.markAllReadCopy(tokenless).scope,
		"M scope_joined [M scope_chats count=1] [M scope_tokenless count=1]",
		"the two sentences are joined by the catalogue, not by a hardcoded space",
	);
	assert.equal(
		mod.markAllReadCopy(both).scope,
		"M scope_joined [M scope_chats_elsewhere count=2 elsewhere=1] [M scope_tokenless count=1]",
	);
	for (const copy of [elsewhere, tokenless, both].map(mod.markAllReadCopy)) {
		assert.doesNotMatch(
			`${copy.scope}|${copy.nameSuffix}`,
			ENGLISH_TOOLTIP_FRAGMENT,
			"no English fragment survives in a non-English locale",
		);
	}
	useEnglish();
});

test("the shipped tooltip and name-suffix messages format cleanly in every locale", (ctx) => {
	/*
	 * The marker test above proves the WIRING; this one proves the SHIPPED values.
	 * Each locale's five messages go through the production formatter (`t`, over the
	 * bundled catalogue, no marker registered) for the counts that exercise every
	 * CLDR plural category the seven languages use (0, 1, 2, 5, 21, and a number
	 * large enough that grouping would show), and none may leave an ICU brace
	 * behind. A non-English locale may not leak the English fragments either: that
	 * is the operator's acceptance ("no English in fr") applied to this copy.
	 */
	mod.clearRegisteredCatalogues();
	const English =
		/\b(unread|not active|Mark|including|completion token|as read|cannot be cleared)\b/;
	const KEYS = "ui.chat.sidebar.mark_all_read.";
	const render = (count, elsewhere) => {
		const chats = mod.t(`${KEYS}scope_chats_elsewhere`, { count, elsewhere });
		const plain = mod.t(`${KEYS}scope_chats`, { count });
		const tokenless = mod.t(`${KEYS}scope_tokenless`, { count });
		return {
			outputs: [
				plain,
				chats,
				tokenless,
				mod.t(`${KEYS}scope_joined`, { chats, tokenless }),
				mod.t(`${KEYS}name_suffix_elsewhere`, { elsewhere }),
			],
			tooltip: mod.t(`${KEYS}scope_joined`, { chats, tokenless }),
			suffix: mod.t(`${KEYS}name_suffix_elsewhere`, { elsewhere }),
		};
	};
	for (const locale of ["en", "fr", "es", "zh-CN", "ru", "vi", "ur", "hi"]) {
		act(() => mod.setLocale(locale));
		for (const count of [0, 1, 2, 5, 21, 1_000_000]) {
			for (const elsewhere of [1, 2, 5]) {
				for (const [index, out] of render(count, elsewhere).outputs.entries()) {
					assert.ok(out.length > 0, `${locale} ${count}/${elsewhere}: empty`);
					assert.doesNotMatch(
						out,
						/[{}]/,
						`${locale} ${count}/${elsewhere}: ICU brace left in ${out}`,
					);
					/*
					 * `::group-off` must keep the count as plain digits in every locale. The
					 * first guard listed three literal groupings (en, es, de-style) and so
					 * missed fr `1\u202f000\u202f000`, ru `1\u00a0000\u00a0000` and hi
					 * `10,00,000`. Two checks that do not enumerate locales: when the render
					 * carries the count (the name suffix carries `elsewhere`, not `count`),
					 * the plain digits must be present, which already fails for any grouping
					 * since it splits them; and no run of digit groups joined by a comma,
					 * dot, space, NBSP, narrow NBSP or Arabic thousands separator may
					 * appear. The second needs two separators so unrelated punctuation
					 * ("Mark 5 ... 2.") cannot trip it.
					 */
					// outputs[4] is `name_suffix_elsewhere`, which carries `elsewhere` only.
					if (count === 1_000_000 && index < 4)
						assert.ok(
							out.includes("1000000"),
							`${locale}: count not rendered as plain digits in ${out}`,
						);
					assert.doesNotMatch(
						out,
						/\d{1,3}(?:[,.\u00a0\u202f\u066c ]\d{2,3}){2,}/,
						`${locale}: grouped digits in ${out}`,
					);
					if (locale !== "en")
						assert.doesNotMatch(
							out,
							English,
							`${locale} ${count}/${elsewhere}: English in ${out}`,
						);
				}
			}
		}
		for (const [count, elsewhere] of [
			[5, 2],
			[1, 1],
		]) {
			const shown = render(count, elsewhere);
			ctx.diagnostic(
				`${locale} count=${count} elsewhere=${elsewhere} tooltip: ${shown.tooltip} | suffix: ${shown.suffix}`,
			);
		}
	}
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
