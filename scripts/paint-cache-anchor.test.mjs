import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The paint cache's two new passengers: the reader's place and the turn's
 * liveness.
 *
 * WHY THIS FILE EXISTS (operator report, 2026-11-12). A return to a
 * conversation this window had already shown painted the rows in the first
 * frame and then lost the reader's scroll position (QA: 0 of 12 scrolled
 * returns kept their place) and painted a RUNNING session as idle for the whole
 * revalidate (no working line, no stop affordance), because the panel unmounts
 * on the route change and the cache carried only rows.
 *
 * WHAT IS ASSERTED is the store's own contract, in the store's own terms - no
 * DOM, no React:
 *
 * - the anchor round-trips, as an id + offset rather than a `scrollTop`;
 * - the anchor survives `writePaint` when the scroller wrote it FIRST, which is
 *   the real order (`writePaintScroll` runs in a layout cleanup, `writePaint`
 *   in the passive one that follows it);
 * - the in-flight drop still holds, because "carry the liveness flag" must not
 *   become "carry the live rows" - a cached streaming row can never advance;
 * - `busy` is not carried forward by omission: absent means settled, so a stale
 *   claim cannot outlive the paint that made it.
 *
 * The module reaches `transcript-reducer` and therefore this app's i18n core;
 * that is why the bundle below aliases the renderer's path aliases rather than
 * importing the source directly.
 */

const bundle = await build({
	stdin: {
		contents: 'export * from "./src/renderer/src/shared/store/paint-cache";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	loader: { ".css": "empty" },
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
});
const paintCache = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const TS = 1_760_000_000_000;
const session = "s1";

const user = (id) => ({
	kind: "user",
	id,
	ts: TS,
	text: "Which invoices were late last month?",
	images: [],
});
const answer = (id) => ({
	kind: "assistant",
	id,
	ts: TS,
	text: "Four invoices were late.",
	streaming: false,
	stopReason: null,
	error: false,
});
const streaming = (id) => ({ ...answer(id), streaming: true });
const runningTool = (id) => ({
	kind: "tool",
	id,
	ts: TS,
	toolCallId: id,
	toolName: "bash",
	intent: null,
	args: { command: "pnpm test:desktop" },
	phase: "running",
	argumentBytes: 0,
	output: null,
	isError: false,
	durationS: null,
	startedAt: null,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
});
const transcriptOf = (records) => ({
	records,
	index: new Map(records.map((record, position) => [record.id, position])),
	generation: 1,
	oldestId: null,
	oldestTs: 0,
	hasMore: false,
	argsByCall: new Map(),
	compacting: false,
	compactingSince: 0,
	viewEpoch: 0,
});

const reset = () => paintCache.__resetPaintCache();

test("the reader's place round-trips as the row they were looking at", () => {
	reset();
	paintCache.writePaint(session, {
		transcript: transcriptOf([user("u1"), answer("a1")]),
		busy: false,
	});
	paintCache.writePaintScroll(session, {
		pinned: false,
		id: "a1",
		offsetPx: 42,
	});
	const paint = paintCache.readPaint(session);
	assert.deepEqual(paint?.scroll, { pinned: false, id: "a1", offsetPx: 42 });
});

test("an anchor written first survives the paint write that follows it", () => {
	// THE REAL ORDER: the transcript's layout cleanup measures and records the
	// place, then the session hook's passive cleanup writes the rows and replaces
	// the entry. The rows are the newer write; the anchor is the later event, and
	// `writePaint` must carry it rather than reset the entry to the tail.
	reset();
	paintCache.writePaint(session, {
		transcript: transcriptOf([user("u1")]),
		busy: false,
	});
	paintCache.writePaintScroll(session, {
		pinned: false,
		id: "u1",
		offsetPx: 12,
	});
	paintCache.writePaint(session, {
		transcript: transcriptOf([user("u1"), answer("a1")]),
		busy: true,
	});
	const paint = paintCache.readPaint(session);
	assert.deepEqual(paint?.scroll, { pinned: false, id: "u1", offsetPx: 12 });
	assert.equal(paint?.busy, true);
});

test("a fresh paint is pinned and settled", () => {
	// The defaults matter: every existing write path (a notification click, a
	// cold mount) leaves the reader at the tail, and a conversation must not be
	// announced as running unless the hook said so.
	reset();
	paintCache.writePaint(session, {
		transcript: transcriptOf([user("u1")]),
	});
	const paint = paintCache.readPaint(session);
	assert.deepEqual(paint?.scroll, { pinned: true });
	assert.equal(paint?.busy, false);
});

test("the liveness flag is not carried forward by omission", () => {
	// Absent means SETTLED. A carried-forward flag would resurrect "a turn is
	// running" for a paint whose own instant had no evidence of one.
	reset();
	paintCache.writePaint(session, {
		transcript: transcriptOf([user("u1")]),
		busy: true,
	});
	paintCache.writePaint(session, {
		transcript: transcriptOf([user("u1"), answer("a1")]),
	});
	assert.equal(paintCache.readPaint(session)?.busy, false);
});

test("in-flight rows are still dropped, and the flag does not smuggle them in", () => {
	// THE INVARIANT THIS CACHE HAS ALWAYS HAD, restated because the new flag is
	// about a running turn and it would be easy to "fix" the idle paint by
	// caching the running row: a cached streaming row is a line that can never
	// advance, so the flag is the only thing that may travel.
	reset();
	paintCache.writePaint(session, {
		transcript: transcriptOf([
			user("u1"),
			streaming("a1"),
			runningTool("tool1"),
		]),
		busy: true,
	});
	const paint = paintCache.readPaint(session);
	assert.deepEqual(
		paint?.transcript.records.map((record) => record.id),
		["u1"],
		"the streaming answer and the running tool are not cached rows",
	);
	assert.deepEqual(paint?.transcript.index.get("u1"), 0);
	assert.equal(paint?.busy, true, "but the turn's liveness is");
});

test("recording a place without a paint is a no-op", () => {
	// A conversation this window never painted has no rows to restore into; the
	// write must not mint an entry with rows the store never saw.
	reset();
	paintCache.writePaintScroll(session, {
		pinned: false,
		id: "a1",
		offsetPx: 4,
	});
	assert.equal(paintCache.readPaint(session), null);
});
