/**
 * Contract tests for the persistent suggestion history.
 *
 * WHAT THESE ARE: the rules the operator asked for — an upsert counted by visit,
 * the recency-and-frequency order, the hard bounds and their eviction, reload,
 * clear and clear-origin — driven against the shipped TypeScript bundled in
 * memory with esbuild and against a real file on disk in a temporary directory.
 *
 * WHAT THEY ARE NOT: proof that the address field shows these rows. That is
 * `scripts/browser-chrome-s4b-probe.mjs` against the built app.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/browser/history-store";',
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
	HISTORY_STORE_MAX_BYTES,
	HISTORY_STORE_MAX_ENTRIES,
	createBrowserHistoryStore,
} = mod;

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 21, 12);

function storeAt(root, name = "browser-history.json", now = () => NOW) {
	return {
		file: join(root, name),
		store: createBrowserHistoryStore(join(root, name), { now }),
	};
}

function tempRoot(t) {
	const root = mkdtempSync(join(tmpdir(), "lo-browser-history-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

test("record upserts by canonical URL, increments the visit and updates a title", (t) => {
	const root = tempRoot(t);
	const { store } = storeAt(root);
	store.record("https://example.com/a#frag", "First", NOW - DAY);
	store.record("https://example.com/a", "Second", NOW);
	store.record("https://other.example/", "", NOW);
	assert.equal(store.size(), 2);
	const [top] = store.suggest("example.com", 1);
	assert.equal(top.url, "https://example.com/a", "the fragment is stripped");
	assert.equal(top.title, "Second");
	assert.equal(top.visitCount, 2);
	assert.equal(top.lastVisitedAt, NOW);
	store.record("https://example.com/a", "", NOW + 1);
	assert.equal(
		store.suggest("example.com", 1)[0].title,
		"Second",
		"an empty title never erases a known one",
	);
});

test("invalid destinations are ignored, never stored", (t) => {
	const root = tempRoot(t);
	const { store } = storeAt(root);
	store.record("file:///etc/passwd", "No", NOW);
	store.record("javascript:alert(1)", "No", NOW);
	store.record("about:blank", "No", NOW);
	store.record("https://user:pass@example.com/", "No", NOW);
	store.record("", "No", NOW);
	assert.equal(store.size(), 0);
});

test("a daily site beat a one-off even when the one-off is newer", (t) => {
	const root = tempRoot(t);
	const { store } = storeAt(root);
	store.record("https://daily.example/", "Daily", NOW - 30 * DAY);
	for (let visit = 0; visit < 9; visit += 1) {
		store.record("https://daily.example/", "Daily", NOW - 30 * DAY);
	}
	store.record("https://once.example/", "Once", NOW);
	const [first] = store.suggest("", 2);
	assert.equal(
		first.url,
		"https://daily.example/",
		"log2(1+10) + a decayed recency term still beats log2(2) + 1",
	);
});

test("equal visits put the fresher visit first, then the URL", (t) => {
	const root = tempRoot(t);
	const { store } = storeAt(root);
	store.record("https://b.example/", "", NOW - DAY);
	store.record("https://a.example/", "", NOW);
	store.record("https://c.example/", "", NOW);
	assert.deepEqual(
		store.suggest("", 3).map((row) => row.url),
		["https://a.example/", "https://c.example/", "https://b.example/"],
	);
});

test("suggest matches a scheme-less prefix and honours the limit", (t) => {
	const root = tempRoot(t);
	const { store } = storeAt(root);
	store.record("https://example.com/one", "", NOW);
	store.record("https://example.com/two", "", NOW);
	store.record("https://elsewhere.test/", "", NOW);
	assert.deepEqual(
		store.suggest("https://example.com", 10).map((row) => row.url),
		["https://example.com/one", "https://example.com/two"],
	);
	assert.equal(store.suggest("example", 1).length, 1);
	assert.deepEqual(
		store.suggest("e", 10).map((row) => row.url),
		[
			"https://elsewhere.test/",
			"https://example.com/one",
			"https://example.com/two",
		],
		"a one-character query spans every bucket that starts with it",
	);
	assert.equal(
		store.suggest("ex", 10).length,
		2,
		"a two-character query is still index-bound",
	);
	assert.deepEqual(store.suggest("nope", 10), []);
	assert.deepEqual(store.suggest("example", 0), []);
});

test("writes are debounced and flush makes them durable", (t) => {
	const root = tempRoot(t);
	const { file, store } = storeAt(root);
	store.record("https://example.com/", "Title", NOW);
	assert.throws(
		() => readFileSync(file),
		"nothing is on disk before the debounce or a flush",
	);
	store.flush();
	const document = JSON.parse(readFileSync(file, "utf8"));
	assert.equal(document.version, 1);
	assert.equal(document.entries.length, 1);
	assert.equal(document.entries[0].url, "https://example.com/");
});

test("a store reloads its own document", (t) => {
	const root = tempRoot(t);
	const first = storeAt(root);
	first.store.record("https://example.com/a", "A", NOW - DAY);
	first.store.record("https://example.com/a", "A", NOW);
	first.store.record("https://other.example/", "Other", NOW);
	first.store.flush();
	const { store } = storeAt(root);
	assert.equal(store.size(), 2);
	const [top] = store.suggest("example.com", 1);
	assert.equal(top.visitCount, 2);
	assert.equal(top.title, "A");
	assert.deepEqual(
		store.suggest("", 2).map((row) => row.url),
		["https://example.com/a", "https://other.example/"],
	);
});

test("a corrupt or missing document starts empty rather than throwing", (t) => {
	const root = tempRoot(t);
	// Missing: a file that was never written.
	assert.equal(storeAt(root, "never-written.json").store.size(), 0);
	// Corrupt: a truncated document at the real path.
	const first = storeAt(root);
	first.store.record("https://example.com/", "", NOW);
	first.store.flush();
	writeFileSync(first.file, "{not json");
	assert.equal(storeAt(root).store.size(), 0);
});

test("clear deletes everything and the deletion is durable", (t) => {
	const root = tempRoot(t);
	const { file, store } = storeAt(root);
	store.record("https://example.com/", "", NOW);
	store.record("https://other.example/", "", NOW);
	store.clear();
	assert.equal(store.size(), 0);
	const document = JSON.parse(readFileSync(file, "utf8"));
	assert.deepEqual(document.entries, []);
	assert.equal(JSON.stringify(document).includes("example.com"), false);
});

test("clearOrigin forgets one origin and leaves the others alone", (t) => {
	const root = tempRoot(t);
	const { file, store } = storeAt(root);
	store.record("https://example.com/a", "", NOW);
	store.record("https://example.com/b", "", NOW);
	store.record("http://example.com/c", "", NOW);
	store.record("https://other.example/", "", NOW);
	store.clearOrigin("https://example.com");
	assert.deepEqual(
		store.suggest("", 10).map((row) => row.url),
		["http://example.com/c", "https://other.example/"],
		"the port/scheme is part of the origin",
	);
	store.clearOrigin("not a url");
	assert.equal(store.size(), 2, "an invalid origin is a no-op");
	const document = JSON.parse(readFileSync(file, "utf8"));
	assert.equal(
		document.entries.some((row) => row.url === "https://example.com/a"),
		false,
	);
});

test("the entry count is capped and the weakest entries are evicted", (t) => {
	const root = tempRoot(t);
	const { store } = storeAt(root);
	for (let index = 0; index < HISTORY_STORE_MAX_ENTRIES + 5; index += 1) {
		store.record(`https://site${index}.example/`, "", NOW - index);
	}
	assert.ok(store.size() <= HISTORY_STORE_MAX_ENTRIES);
	const kept = store.suggest("site0.example", 1);
	assert.equal(
		kept.length,
		1,
		"the first, freshest record is not the one evicted",
	);
});

test("the serialised document is capped at 2 MB", (t) => {
	const root = tempRoot(t);
	const { file, store } = storeAt(root);
	const tail = "p".repeat(400);
	for (let index = 0; index < 5000; index += 1) {
		store.record(`https://bulk${index}.example/${tail}`, "t".repeat(256), NOW);
	}
	store.flush();
	const bytes = readFileSync(file).byteLength;
	assert.ok(
		bytes <= HISTORY_STORE_MAX_BYTES,
		`document is ${bytes} bytes, over the ${HISTORY_STORE_MAX_BYTES} cap`,
	);
	assert.ok(store.size() < 5000, "entries were evicted to get under the cap");
});

test("www and uppercase schemes are recall, not a different page", (t) => {
	const root = tempRoot(t);
	const { store } = storeAt(root);
	store.record("https://www.example.com/", "Www", NOW);
	store.record("https://example.net/", "Plain", NOW);
	assert.deepEqual(
		store.suggest("example.com", 5).map((row) => row.url),
		["https://www.example.com/"],
		"a stored www page answers its bare host",
	);
	assert.deepEqual(
		store.suggest("https://example.com", 5).map((row) => row.url),
		["https://www.example.com/"],
		"and a full HTTPS scheme in the query",
	);
	assert.deepEqual(
		store.suggest("HTTPS://WWW.EXAMPLE.COM", 5).map((row) => row.url),
		["https://www.example.com/"],
		"scheme and host case do not change the match",
	);
	// The other direction: a bare stored page answers a www query.
	store.record("https://bare.example/", "Bare", NOW);
	assert.deepEqual(
		store.suggest("www.bare.example", 5).map((row) => row.url),
		["https://bare.example/"],
	);
	assert.deepEqual(
		store.suggest("stored.example", 5),
		[],
		"a different host must not match either spelling",
	);
	assert.equal(
		store.suggest("example.com", 1)[0].url,
		"https://www.example.com/",
		"the canonical URL is kept for display and navigation",
	);
});

test("a host-only query cannot cross a domain boundary", (t) => {
	const root = tempRoot(t);
	const { store } = storeAt(root);
	store.record("https://www.example.com/", "Real", NOW);
	store.record("https://www.example.com.evil.test/", "Evil", NOW);
	store.record("https://www.example.com/one", "Path", NOW);
	assert.deepEqual(
		store.suggest("example.com", 10).map((row) => row.url),
		["https://www.example.com/", "https://www.example.com/one"],
		"the evil suffix is a different domain, not a prefix of this one",
	);
	assert.deepEqual(
		store.suggest("example.com/one", 10).map((row) => row.url),
		["https://www.example.com/one"],
		"a query that names a path keeps plain prefix matching",
	);
});

test("w, ww, www and www. recall a stored www page", (t) => {
	const root = tempRoot(t);
	const { store } = storeAt(root);
	store.record("https://www.example.com/", "Www", NOW);
	for (const query of ["w", "ww", "www", "www."]) {
		assert.deepEqual(
			store.suggest(query, 5).map((row) => row.url),
			["https://www.example.com/"],
			`the prefix ${JSON.stringify(query)} must not be normalised away`,
		);
	}
});

test("an oversized legacy document is rewritten when it loads", (t) => {
	const root = tempRoot(t);
	const file = join(root, "browser-history.json");
	const tail = "r".repeat(400);
	const title = "t".repeat(200);
	const entries = Array.from(
		{ length: HISTORY_STORE_MAX_ENTRIES },
		(_, index) => ({
			url: `https://oversize${index}.example/${tail}`,
			title,
			host: `oversize${index}.example`,
			visitCount: 1,
			lastVisitedAt: NOW,
		}),
	);
	// The shape the title-flow bug wrote: hand-written here because the fixed
	// mutators now evict as they go, which is the point.
	writeFileSync(file, JSON.stringify({ version: 1, entries }, null, 2));
	const before = readFileSync(file).byteLength;
	assert.ok(before > HISTORY_STORE_MAX_BYTES, "the bug's shape is on disk");
	const second = storeAt(root);
	assert.ok(
		second.store.size() < HISTORY_STORE_MAX_ENTRIES,
		"loading trimmed the table",
	);
	const after = readFileSync(file).byteLength;
	assert.ok(
		after <= HISTORY_STORE_MAX_BYTES,
		`the trimmed document was rewritten immediately (${after} bytes)`,
	);
});

test("the spec'd bounds are 5000 entries and 2 MB, pinned as literals", () => {
	assert.equal(HISTORY_STORE_MAX_ENTRIES, 5000);
	assert.equal(HISTORY_STORE_MAX_BYTES, 2 * 1024 * 1024);
});

test("titles set only through updateTitle still count toward the 2 MB cap", (t) => {
	const root = tempRoot(t);
	const { file, store } = storeAt(root);
	const tail = "q".repeat(400);
	const title = "t".repeat(200);
	// The app's own flow, exactly: the visit records an empty title, then the
	// page-title event supplies the real one. If the estimate skips that
	// mutation, the cap never sees the title bytes.
	for (let index = 0; index < HISTORY_STORE_MAX_ENTRIES; index += 1) {
		const url = `https://title${index}.example/${tail}`;
		store.record(url, "", NOW);
		store.updateTitle(url, title);
	}
	store.flush();
	const bytes = readFileSync(file).byteLength;
	assert.ok(
		bytes <= HISTORY_STORE_MAX_BYTES,
		`document is ${bytes} bytes, over the ${HISTORY_STORE_MAX_BYTES} cap`,
	);
	assert.ok(
		store.size() < HISTORY_STORE_MAX_ENTRIES,
		"entries were evicted once the titles made the document exceed the cap",
	);
});

test("updateTitle changes a title without counting a visit", (t) => {
	const root = tempRoot(t);
	const { store } = storeAt(root);
	store.record("https://example.com/", "", NOW);
	store.updateTitle("https://example.com/", "Real title");
	const [entry] = store.suggest("example.com", 1);
	assert.equal(entry.title, "Real title");
	assert.equal(entry.visitCount, 1);
	store.updateTitle("https://never-visited.example/", "Ignored");
	assert.equal(store.size(), 1);
});
