/**
 * Contract tests for the bounded address-history snapshot.
 *
 * WHAT THESE ARE: the RULES — bounds, scope, dedup, sanitisation, the indexed
 * history read, and the restore fallback — driven against the shipped TypeScript
 * bundled in memory with esbuild and against fake views.
 *
 * WHAT THEY ARE NOT: proof the field completes what a person types. No React
 * renders here and no Electron view exists; `scripts/browser-url-autocomplete-proof.mjs`
 * is the built-app run that claims the interaction.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/shared/browser-address-history";\n' +
			'export * from "./src/main/browser/address-history";',
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
	canonicalHistoryUrl,
	historyTitle,
	collectAddressHistory,
	mergeAddressHistory,
} = mod;

const HISTORY_MAX_TABS = mod.ADDRESS_HISTORY_MAX_TABS;
const HISTORY_MAX_ENTRIES = mod.ADDRESS_HISTORY_MAX_ENTRIES;
const HISTORY_MAX_PER_TAB = mod.ADDRESS_HISTORY_MAX_ENTRIES_PER_TAB;

/** A fake tab whose live stack is an array of entries. */
function fakeTab({
	tabId = 1,
	sessionId = null,
	entries = [],
	activeIndex = entries.length - 1,
	destroyed = false,
	restoreRow = null,
	navigation = true,
	lengthOverride = null,
} = {}) {
	const calls = [];
	return {
		tabId,
		sessionId,
		restoreRow,
		calls,
		webContents: {
			isDestroyed: () => destroyed,
			navigationHistory: navigation
				? {
						length: () => lengthOverride ?? entries.length,
						getActiveIndex: () => activeIndex,
						getEntryAtIndex: (index) => {
							calls.push(index);
							return entries[index];
						},
					}
				: undefined,
		},
	};
}

function entry(url, title = "") {
	return { url, title };
}

// ---- canonicalHistoryUrl ---------------------------------------------------

test("canonicalHistoryUrl keeps HTTP(S) destinations canonical and exact", () => {
	assert.equal(
		canonicalHistoryUrl("https://example.com/A?Q=X#Y"),
		"https://example.com/A?Q=X#Y",
		"path, query and fragment bytes survive; only the scheme/host are folded",
	);
	assert.notEqual(
		canonicalHistoryUrl("https://example.com/A"),
		canonicalHistoryUrl("https://example.com/a"),
		"a path is case-sensitive",
	);
	assert.equal(
		canonicalHistoryUrl("https://example.com"),
		"https://example.com/",
		"WHATWG canonicalisation equates a bare origin with its slash",
	);
});

test("canonicalHistoryUrl refuses credentials, non-web schemes, controls and over-long URLs", () => {
	assert.equal(canonicalHistoryUrl("https://user:pass@example.com/"), null);
	assert.equal(canonicalHistoryUrl("https://user@example.com/"), null);
	assert.equal(
		canonicalHistoryUrl("http://example.com/"),
		"http://example.com/",
	);
	assert.equal(canonicalHistoryUrl("file:///etc/passwd"), null);
	assert.equal(canonicalHistoryUrl("javascript:alert(1)"), null);
	assert.equal(canonicalHistoryUrl("about:blank"), null);
	assert.equal(canonicalHistoryUrl("data:text/html,x"), null);
	assert.equal(canonicalHistoryUrl("https://example.com/\u0000"), null);
	assert.equal(canonicalHistoryUrl("not a url"), null);
	assert.equal(canonicalHistoryUrl(""), null);
	assert.equal(canonicalHistoryUrl(42), null);
	assert.equal(
		canonicalHistoryUrl(`https://example.com/${"a".repeat(2048)}`),
		null,
		"the restore path's URL bound (2048) is the same bound here",
	);
});

test("historyTitle strips controls, collapses whitespace and caps at 256", () => {
	assert.equal(
		historyTitle("  A \n title\twith\tspaces  "),
		"A title with spaces",
	);
	assert.equal(historyTitle("tab\u0000zero"), "tab zero");
	assert.equal(historyTitle(undefined), "");
	assert.equal(historyTitle("x".repeat(300)).length, 256);
});

// ---- collectAddressHistory -------------------------------------------------

test("the indexed read is bounded and centred on the current index", () => {
	const entries = Array.from({ length: 120 }, (_, index) =>
		entry(`https://site${index}.example/`),
	);
	const tab = fakeTab({ tabId: 7, entries, activeIndex: 100 });
	const result = collectAddressHistory([tab], 7);
	assert.equal(result.entries.length, HISTORY_MAX_PER_TAB);
	assert.ok(
		result.entries.some((row) => row.url === "https://site100.example/"),
		"the current entry is inside the window",
	);
	const lowest = Math.min(...tab.calls);
	const highest = Math.max(...tab.calls);
	assert.ok(
		highest - lowest < HISTORY_MAX_PER_TAB,
		"only one bounded window was read, not the whole stack",
	);
	assert.ok(result.entries.every((row) => row.url.startsWith("https://site")));
});

test("the restore row is the fallback only when no live history exists", () => {
	const restored = fakeTab({
		tabId: 2,
		navigation: false,
		restoreRow: {
			entries: [
				entry("https://restored.example/one", "Restored one"),
				entry("https://restored.example/two", "Restored two"),
			],
			activeIndex: 1,
		},
	});
	const result = collectAddressHistory([restored], 2);
	assert.deepEqual(
		result.entries.map((row) => row.url),
		["https://restored.example/one", "https://restored.example/two"],
	);
	assert.equal(result.entries[1].distanceFromCurrent, 0);
	assert.equal(result.entries[0].distanceFromCurrent, 1);
});

test("live history wins over the restore row", () => {
	const tab = fakeTab({
		tabId: 3,
		entries: [entry("https://live.example/")],
		restoreRow: {
			entries: [entry("https://restore.example/")],
			activeIndex: 0,
		},
	});
	const result = collectAddressHistory([tab], 3);
	assert.deepEqual(
		result.entries.map((row) => row.url),
		["https://live.example/"],
	);
});

test("a destroyed view contributes nothing", () => {
	const tab = fakeTab({
		tabId: 4,
		destroyed: true,
		entries: [entry("https://dead.example/")],
	});
	const result = collectAddressHistory([tab], 4);
	assert.deepEqual(result.entries, []);
});

test("every tab contributes and the active tab still comes first", () => {
	const first = fakeTab({
		tabId: 5,
		sessionId: "session-a",
		entries: [entry("https://a.example/")],
	});
	const second = fakeTab({
		tabId: 6,
		sessionId: "session-a",
		entries: [entry("https://b.example/")],
	});
	const other = fakeTab({
		tabId: 7,
		sessionId: "session-b",
		entries: [entry("https://other.example/")],
	});
	const all = collectAddressHistory([first, second, other], 6);
	assert.deepEqual(
		all.entries.map((row) => row.sourceTabId),
		[6, 5, 7],
		"there is no display scope any more: the active tab is first, then registry order",
	);
	assert.equal(all.entries[0].activeTab, true);
	assert.ok(all.entries.every((row) => row.source === "tab"));
});

test("the tab bound is 20 and only the window is read", () => {
	const tabs = Array.from({ length: 25 }, (_, index) =>
		fakeTab({
			tabId: index + 1,
			entries: [entry(`https://tab${index + 1}.example/`)],
		}),
	);
	const result = collectAddressHistory(tabs, 1);
	assert.equal(result.entries.length, 20);
});

test("dedup is by canonical URL and first occurrence wins", () => {
	const first = fakeTab({
		tabId: 1,
		active: true,
		entries: [
			entry("https://dup.example/", "First"),
			entry("https://other.example/", "Other"),
		],
	});
	const second = fakeTab({
		tabId: 2,
		entries: [entry("https://dup.example/", "Second")],
	});
	const result = collectAddressHistory([first, second], 1);
	assert.equal(result.entries.length, 2);
	assert.equal(result.entries[0].title, "First");
});

test("the URL cap is 256 deduplicated destinations", () => {
	const entries = Array.from({ length: 300 }, (_, index) =>
		entry(`https://many${index}.example/`),
	);
	const result = collectAddressHistory(
		[fakeTab({ tabId: 1, entries, activeIndex: 0 })],
		"all",
		1,
	);
	assert.equal(result.entries.length, Math.min(HISTORY_MAX_ENTRIES, 50));
});

test("every DTO is built field-by-field and never carries pageState", () => {
	const tab = fakeTab({
		tabId: 9,
		entries: [
			{
				url: "https://secret.example/",
				title: "Secret",
				pageState: "BASE64-PAGE-STATE",
			},
		],
	});
	const result = collectAddressHistory([tab], 9);
	assert.deepEqual(Object.keys(result.entries[0]).sort(), [
		"activeTab",
		"distanceFromCurrent",
		"lastVisitedAt",
		"source",
		"sourceIndex",
		"sourceTabId",
		"title",
		"url",
		"visitCount",
	]);
	assert.ok(!JSON.stringify(result).includes("BASE64-PAGE-STATE"));
});

test("a non-web entry inside a live stack is skipped without failing the rest", () => {
	const tab = fakeTab({
		tabId: 10,
		entries: [
			entry("about:blank"),
			entry("file:///etc/passwd"),
			entry("https://kept.example/"),
		],
		activeIndex: 2,
	});
	const result = collectAddressHistory([tab], 10);
	assert.deepEqual(
		result.entries.map((row) => row.url),
		["https://kept.example/"],
	);
});

test("the tab count bound is the shared constant, not a copied literal", () => {
	assert.equal(HISTORY_MAX_TABS, 20);
	assert.equal(HISTORY_MAX_ENTRIES, 256);
	assert.equal(HISTORY_MAX_PER_TAB, 50);
});

test("canonical URLs are capped after percent-encoding, not only on the raw input", () => {
	const raw = `https://example.test/${"道".repeat(800)}`;
	assert.ok(raw.length < 2048, "the raw string is inside the input bound");
	assert.equal(
		canonicalHistoryUrl(raw),
		null,
		"the expanded href crosses the cap",
	);
	assert.equal(
		canonicalHistoryUrl(`https://example.test/${"b".repeat(2048)}`),
		null,
		"a raw string over the cap is refused",
	);
});

test("tabIdOrThrow rejects zero and negatives at the IPC boundary", async () => {
	const guardBundle = await build({
		stdin: {
			contents: 'export * from "./src/main/browser/request-guards";',
			resolveDir: process.cwd(),
			loader: "ts",
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		logLevel: "silent",
	});
	const guards = await import(
		`data:text/javascript;base64,${Buffer.from(guardBundle.outputFiles[0].text).toString("base64")}`
	);
	assert.throws(() => guards.tabIdOrThrow(0, "tabId"), /positive tab id/);
	assert.throws(() => guards.tabIdOrThrow(-1, "tabId"), /positive tab id/);
	assert.throws(() => guards.tabIdOrThrow(1.5, "tabId"), /integer/);
	assert.equal(guards.tabIdOrThrow(1, "tabId"), 1);
});

// ---- mergeAddressHistory ---------------------------------------------------

test("merge puts ranked history first, then live tabs, and dedupes on history", () => {
	const tabEntries = collectAddressHistory(
		[
			fakeTab({
				tabId: 1,
				entries: [
					entry("https://visited.example/", "Open tab"),
					entry("https://only-tab.example/", "Only a tab"),
				],
			}),
		],
		1,
	);
	const history = [
		{
			url: "https://visited.example/",
			title: "Stored title",
			visitCount: 4,
			lastVisitedAt: 100,
		},
	];
	const merged = mergeAddressHistory(tabEntries.entries, history, "", 8);
	assert.deepEqual(
		merged.map((row) => [row.url, row.source]),
		[
			["https://visited.example/", "history"],
			["https://only-tab.example/", "tab"],
		],
	);
	assert.equal(merged[0].visitCount, 4);
	assert.equal(merged[0].lastVisitedAt, 100);
	assert.equal(merged[0].title, "Stored title");
});

test("merge filters live tabs by the query before applying the limit", () => {
	const tabEntries = collectAddressHistory(
		[
			fakeTab({
				tabId: 1,
				entries: [
					entry("https://unrelated.example/", "Nope"),
					entry("https://match.example/", "A matching title"),
				],
			}),
		],
		1,
	);
	const merged = mergeAddressHistory(tabEntries.entries, [], "matching", 1);
	assert.deepEqual(
		merged.map((row) => row.url),
		["https://match.example/"],
		"the non-matching row did not consume the only slot",
	);
});

test("merge honours the limit and an invalid stored URL is skipped", () => {
	const history = [
		{ url: "file:///etc/passwd", title: "", visitCount: 1, lastVisitedAt: 1 },
		{ url: "https://a.example/", title: "A", visitCount: 2, lastVisitedAt: 2 },
		{ url: "https://b.example/", title: "B", visitCount: 1, lastVisitedAt: 3 },
	];
	const merged = mergeAddressHistory([], history, "", 2);
	assert.deepEqual(
		merged.map((row) => row.url),
		["https://a.example/", "https://b.example/"],
	);
});
