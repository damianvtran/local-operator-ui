/**
 * Contract tests for the address-completion model: intent, ranking, the inline
 * suffix's eligibility, and the list's small keyboard arithmetic.
 *
 * WHAT THESE ARE: the pure rules, driven against the shipped TypeScript bundled
 * in memory with esbuild. WHAT THEY ARE NOT: proof that the controlled input's
 * selection behaves — that is Chromium's behaviour, and the built-app proof is
 * the run that measures `selectionStart`/`selectionEnd` on the real element.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/browser/model/address-autocomplete";',
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	logLevel: "silent",
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	ADDRESS_SEARCH_URL_PREFIX,
	MAX_ADDRESS_ALTERNATIVES,
	addressIntent,
	canInlineComplete,
	inlineFor,
	rowTarget,
	isGeneratedSuffixSelected,
	moveActive,
	suggestAddresses,
	usableRawAddress,
} = mod;

function entry(url, over = {}) {
	return {
		url,
		title: "",
		visitCount: 0,
		lastVisitedAt: 0,
		source: "tab",
		sourceTabId: 1,
		sourceIndex: 0,
		activeTab: true,
		distanceFromCurrent: 0,
		...over,
	};
}

// ---- intent ---------------------------------------------------------------

test("intent: every navigate row the operator's table settles", () => {
	assert.equal(addressIntent(""), "empty");
	assert.equal(addressIntent("example.com"), "url");
	assert.equal(addressIntent("example.com/path?q=1"), "url");
	assert.equal(addressIntent("https://example.com"), "url");
	assert.equal(addressIntent("http://example.com"), "url");
	assert.equal(
		addressIntent("file:///tmp/a.txt"),
		"url",
		"file: is URL intent and must never be searched; the host still refuses to navigate it",
	);
	assert.equal(addressIntent("localhost:3000"), "url");
	assert.equal(addressIntent("localhost"), "url");
	assert.equal(addressIntent("127.0.0.1:8080"), "url");
	assert.equal(addressIntent("192.168.1.1"), "url");
	assert.equal(addressIntent("[::1]:3000"), "url");
	assert.equal(addressIntent("example.com/A?Q=X#Y"), "url");
	assert.equal(addressIntent("example.com:8080/a"), "url");
	assert.equal(addressIntent("host:8080/a"), "url");
	assert.equal(
		addressIntent("intranet/wiki"),
		"url",
		"a no-whitespace host/path is a site path, not a single-word search (UX U1)",
	);
	assert.equal(addressIntent("nas/d/1"), "url");
});

test("intent: every search row the operator's table settles", () => {
	assert.equal(addressIntent("foo bar"), "search");
	assert.equal(addressIntent("what is a vpn"), "search");
	assert.equal(addressIntent("how to cook rice"), "search");
	assert.equal(
		addressIntent("github"),
		"search",
		"a single word with no dot is a word, not a host",
	);
	assert.equal(
		addressIntent("1.2"),
		"search",
		"a dotted numeric last label is a version, not a TLD",
	);
	assert.equal(addressIntent(" hello"), "search");
	assert.equal(addressIntent("?how do i"), "search");
	assert.equal(addressIntent("#section"), "search");
});

test("intent: executable, embedded and browser-internal schemes stay blocked", () => {
	assert.equal(addressIntent("about:blank"), "blocked");
	assert.equal(addressIntent("javascript:alert(1)"), "blocked");
	assert.equal(addressIntent("data:text/html,x"), "blocked");
	assert.equal(addressIntent("mailto:a@b.example"), "blocked");
	assert.equal(addressIntent("localhost:99999"), "blocked");
	assert.equal(addressIntent("example.com:99999"), "blocked");
});

// ---- ranking --------------------------------------------------------------

const sample = [
	entry("https://example.com/", {
		title: "Example",
		sourceTabId: 1,
		activeTab: true,
		distanceFromCurrent: 0,
	}),
	entry("https://example.com/account", {
		title: "Account",
		sourceTabId: 1,
		activeTab: true,
		distanceFromCurrent: 1,
	}),
	entry("https://other.example/extra", {
		title: "Extra",
		sourceTabId: 2,
		activeTab: false,
		distanceFromCurrent: 4,
	}),
	entry("https://unrelated.test/", {
		title: "Example reference",
		sourceTabId: 2,
		activeTab: false,
		distanceFromCurrent: 9,
	}),
];

test("host prefix ranks before path prefix; title-only never inlines", () => {
	const withTitleMatch = [
		...sample,
		entry("https://notes.test/", {
			title: "example.com reading list",
			sourceTabId: 3,
			activeTab: false,
			distanceFromCurrent: 2,
		}),
	];
	const result = suggestAddresses(withTitleMatch, "example.com");
	assert.equal(result.inline?.text, "example.com/");
	assert.equal(result.inline?.targetUrl, "https://example.com/");
	assert.deepEqual(
		result.candidates.map((row) => [row.url, row.rank]),
		[
			["https://example.com/account", 0],
			["https://notes.test/", 2],
		],
		"the exact host prefix wins; the title-only row is list-only and last",
	);
});

test("a query with a path prefix ranks below the host prefix but can inline", () => {
	const result = suggestAddresses(sample, "example.com/acc");
	assert.equal(result.inline?.text, "example.com/account");
	assert.equal(result.inline?.targetUrl, "https://example.com/account");
});

test("an explicit scheme constrains the destination's scheme", () => {
	const mixed = [
		entry("http://example.com/a", { sourceTabId: 1 }),
		entry("https://example.com/a", { sourceTabId: 2 }),
	];
	const http = suggestAddresses(mixed, "http://example");
	assert.equal(http.inline?.targetUrl, "http://example.com/a");
	const https = suggestAddresses(mixed, "https://example");
	assert.equal(https.inline?.targetUrl, "https://example.com/a");
});

test("a scheme-less query keeps the exact canonical target it was matched from", () => {
	const result = suggestAddresses(
		[entry("http://localhost:3000/a")],
		"localhost:3000",
	);
	assert.equal(result.inline?.text, "localhost:3000/a");
	assert.equal(result.inline?.targetUrl, "http://localhost:3000/a");
});

test("www is optional for a prefix-preserving candidate, never for dedup", () => {
	const result = suggestAddresses(
		[entry("https://www.example.com/path")],
		"example.com",
	);
	assert.equal(result.inline?.text, "example.com/path");
	assert.equal(result.inline?.targetUrl, "https://www.example.com/path");
});

test("path case is preserved: /A does not inline-complete /a", () => {
	const result = suggestAddresses(
		[entry("https://example.com/a")],
		"example.com/A",
	);
	assert.equal(result.inline, null);
});

test("host case folds for matching but cannot inline an unfolded prefix", () => {
	const result = suggestAddresses(
		[entry("https://example.com/")],
		"EXAMPLE.com",
	);
	assert.equal(
		result.inline,
		null,
		"the field cannot display the typed case exactly",
	);
	assert.equal(result.candidates.length, 1);
	assert.equal(result.candidates[0].displayText, "example.com/");
});

test("the current tab wins an equal rank before another tab's equal candidate", () => {
	const active = entry("https://a.example/x", {
		sourceTabId: 1,
		activeTab: true,
		distanceFromCurrent: 30,
	});
	const other = entry("https://a.example/y", {
		sourceTabId: 2,
		activeTab: false,
		distanceFromCurrent: 0,
	});
	const result = suggestAddresses([other, active], "a.example");
	assert.equal(
		result.inline?.targetUrl,
		"https://a.example/x",
		"the active tab's candidate wins the inline completion despite the larger distance",
	);
	assert.deepEqual(
		result.candidates.map((row) => row.sourceTabId),
		[2],
	);
});

test("the list is capped at five rows and the search row takes one slot", () => {
	const entries = Array.from({ length: 12 }, (_, index) =>
		entry(`https://site${index}.example/`, {
			sourceTabId: index + 1,
			sourceIndex: index,
			activeTab: index === 0,
			distanceFromCurrent: index,
		}),
	);
	const result = suggestAddresses(entries, "site");
	assert.equal(
		result.inline,
		null,
		"`site` is search intent, so nothing may be shown as selected text",
	);
	assert.equal(result.rows.length, 5, "the search row takes one of the five");
	assert.equal(result.rows[0].kind, "search");
	assert.equal(result.candidates.length, MAX_ADDRESS_ALTERNATIVES - 1);
});

test("the inline target is excluded only when the suffix is actually shown", () => {
	const entries = [
		entry("https://github.com/", { source: "history", visitCount: 40 }),
		entry("https://github.com/damianvtran", { source: "history" }),
	];
	const shown = suggestAddresses(entries, "github.co", { inlineShown: true });
	assert.equal(shown.inline?.targetUrl, "https://github.com/");
	assert.deepEqual(
		shown.candidates.map((row) => row.url),
		["https://github.com/damianvtran"],
		"the destination shown as selected text is not repeated as a row",
	);
	const hidden = suggestAddresses(entries, "github.co", {
		inlineShown: false,
	});
	assert.equal(
		hidden.inline?.targetUrl,
		"https://github.com/",
		"the model still computes the candidate",
	);
	assert.deepEqual(
		hidden.candidates.map((row) => row.url),
		["https://github.com/", "https://github.com/damianvtran"],
		"with no suffix on screen the best prefix match must stay a row (UX U2)",
	);
});

test("the empty query offers nearby history entries, active tab first, with no inline", () => {
	const result = suggestAddresses(sample, "");
	assert.equal(result.inline, null);
	assert.deepEqual(
		result.candidates.map((row) => row.url),
		[
			"https://example.com/",
			"https://example.com/account",
			"https://other.example/extra",
			"https://unrelated.test/",
		],
	);
});

test("duplicate destinations collapse to the best-ranked occurrence", () => {
	const result = suggestAddresses(
		[
			entry("https://dup.example/", {
				title: "Other",
				sourceTabId: 2,
				activeTab: false,
			}),
			entry("https://dup.example/", {
				title: "Active",
				sourceTabId: 1,
				activeTab: true,
			}),
		],
		"dup",
	);
	assert.equal(result.candidates.length + (result.inline ? 1 : 0), 1);
});

test("a blocked input offers nothing at all", () => {
	const result = suggestAddresses(sample, "javascript:alert(1)");
	assert.equal(result.intent, "blocked");
	assert.equal(result.inline, null);
	assert.deepEqual(result.rows, []);
});

test("a searched input puts the DuckDuckGo row first and highlighted", () => {
	const result = suggestAddresses(sample, "what is a vpn");
	assert.equal(result.intent, "search");
	assert.equal(result.rows[0].kind, "search");
	assert.equal(
		result.rows[0].targetUrl,
		`${ADDRESS_SEARCH_URL_PREFIX}what%20is%20a%20vpn`,
	);
	assert.equal(result.search?.query, "what is a vpn");
});

test("history rows precede open-tab rows and keep main's score order", () => {
	const history = [
		entry("https://daily.example/", {
			source: "history",
			visitCount: 20,
			lastVisitedAt: 1,
			sourceTabId: undefined,
			sourceIndex: undefined,
			activeTab: undefined,
			distanceFromCurrent: undefined,
		}),
		entry("https://once.example/", {
			source: "history",
			visitCount: 1,
			lastVisitedAt: 1,
			sourceTabId: undefined,
			sourceIndex: undefined,
			activeTab: undefined,
			distanceFromCurrent: undefined,
		}),
	];
	const tab = entry("https://daily.example/", {
		title: "An open tab",
		sourceTabId: 9,
	});
	const result = suggestAddresses([...history, tab], "");
	assert.deepEqual(
		result.candidates.map((row) => [row.url, row.source]),
		[
			["https://daily.example/", "history"],
			["https://once.example/", "history"],
		],
		"history keeps its order, the open-tab duplicate is deduped behind it",
	);
});

// ---- eligibility and key arithmetic ---------------------------------------

test("inline completion requires a collapsed caret at the end", () => {
	const base = {
		raw: "exa",
		composing: false,
		dismissedForText: null,
		completionText: null,
	};
	assert.equal(
		canInlineComplete({ ...base, selectionStart: 3, selectionEnd: 3 }),
		true,
	);
	assert.equal(
		canInlineComplete({ ...base, selectionStart: 1, selectionEnd: 1 }),
		false,
		"mid-string edits do not complete",
	);
	assert.equal(
		canInlineComplete({ ...base, selectionStart: 0, selectionEnd: 3 }),
		false,
		"an arbitrary selection does not complete",
	);
});

test("the field's own selected suffix is eligible; composition and dismissal are not", () => {
	const suffix = {
		raw: "exa",
		selectionStart: 3,
		selectionEnd: "example.com/a".length,
		completionText: "example.com/a",
		dismissedForText: null,
		composing: false,
	};
	assert.equal(canInlineComplete(suffix), true);
	assert.equal(canInlineComplete({ ...suffix, composing: true }), false);
	assert.equal(
		canInlineComplete({ ...suffix, dismissedForText: "exa" }),
		false,
	);
	assert.equal(
		canInlineComplete({
			...suffix,
			selectionStart: 2,
			selectionEnd: "example.com/a".length,
		}),
		false,
	);
});

test("isGeneratedSuffixSelected is exact about both offsets", () => {
	assert.equal(
		isGeneratedSuffixSelected({
			raw: "exa",
			selectionStart: 3,
			selectionEnd: "example.com/a".length,
			completionText: "example.com/a",
		}),
		true,
	);
	assert.equal(
		isGeneratedSuffixSelected({
			raw: "exa",
			selectionStart: 2,
			selectionEnd: "example.com/a".length,
			completionText: "example.com/a",
		}),
		false,
	);
	assert.equal(
		isGeneratedSuffixSelected({
			raw: "exa",
			selectionStart: 3,
			selectionEnd: "example.com/a".length,
			completionText: null,
		}),
		false,
	);
});

test("moveActive wraps and starts from either end", () => {
	assert.equal(moveActive(-1, 1, 3), 0);
	assert.equal(moveActive(-1, -1, 3), 2);
	assert.equal(moveActive(2, 1, 3), 0);
	assert.equal(moveActive(0, -1, 3), 2);
	assert.equal(moveActive(1, 1, 0), -1);
});

test("Enter's target is the active row, else the inline completion, else null", () => {
	const suggestions = {
		inline: {
			text: "example.com/",
			suffix: "mple.com/",
			targetUrl: "https://example.com/",
			raw: "exa",
		},
		candidates: [
			{
				...entry("https://example.com/account"),
				displayText: "example.com/account",
				rank: 1,
				prefixExact: true,
			},
		],
		rows: [
			{
				kind: "candidate",
				candidate: {
					...entry("https://example.com/account"),
					displayText: "example.com/account",
					rank: 1,
					prefixExact: true,
				},
			},
		],
		search: null,
		intent: "url",
	};
	assert.equal(rowTarget(suggestions, 0), "https://example.com/account");
	assert.equal(rowTarget(suggestions, -1), "https://example.com/");
	assert.equal(rowTarget({ ...suggestions, inline: null }, -1), null);
});

test("inlineFor honours the eligibility flag rather than re-deriving it", () => {
	const suggestions = {
		inline: {
			text: "example.com/",
			suffix: "mple.com/",
			targetUrl: "https://example.com/",
			raw: "exa",
		},
		candidates: [],
		intent: "url",
	};
	assert.equal(inlineFor(suggestions, false), null);
	assert.deepEqual(inlineFor(suggestions, true), suggestions.inline);
});

test("usableRawAddress rejects blank and control-laden input, trims otherwise", () => {
	assert.equal(usableRawAddress("  "), null);
	assert.equal(usableRawAddress("exa\u0000mple"), null);
	assert.equal(usableRawAddress("  example.com  "), "example.com");
});

test("embedValue locates the substituted value from the argument position", () => {
	const { embedValue } = mod;
	// The ICU argument position, not a search for the user's text: the value
	// itself may contain the surrounding punctuation or repeat a word of the copy.
	const open = (value) =>
		`\u201C${value}\u201D \u06A9\u06BE\u0648\u0644\u06CC\u06BA`;
	const out = embedValue(open, "192.168.1.1/");
	assert.equal(out.text, open("192.168.1.1/"));
	assert.deepEqual(out.isolate, { start: 1, end: 13 });
	assert.equal(
		out.text.slice(out.isolate.start, out.isolate.end),
		"192.168.1.1/",
	);
	const tricky = embedValue((v) => `Open "${v}" Open`, 'Open "x');
	assert.equal(
		tricky.text.slice(tricky.isolate.start, tricky.isolate.end),
		'Open "x',
	);
	// A message that does not carry the argument (a failed lookup returns its
	// key) has nothing to isolate: no range, and the formatted text is unchanged.
	assert.deepEqual(
		embedValue(() => "no argument here", "v"),
		{
			text: "no argument here",
			isolate: null,
		},
	);
	for (const sentence of [open("[::1]:3000/"), open("127.0.0.1:8080/")]) {
		assert.equal(/[\u2066-\u2069]/.test(sentence), false);
	}
});
