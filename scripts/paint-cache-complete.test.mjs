import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE PAINT CACHE'S `complete` FLAG: are the cached rows the WHOLE
 * conversation, or only the newest suffix of it?
 *
 * WHY THE CACHE HAS TO SAY (P2 of the session-switch plan, probe evidence in
 * `short-cache-probe.md`). The cache keeps at most `PAINT_CACHE_MAX_ROWS` rows
 * and `PAINT_CACHE_SESSION_BYTES` bytes, newest-first, so a cached return to a
 * heavy conversation paints a SUFFIX. The transcript column top-anchors a
 * conversation that is shorter than the pane (`mb-auto`, canonical-transcript
 * .tsx), which is right for a genuinely short conversation and wrong for a
 * suffix: at snapshot landing the page makes the column overflow, the auto
 * margin resolves to zero, and the rows bottom-pack - measured on a built
 * renderer at 500/700 KB tool results, the last row moved 212.6 px and the
 * first visible row 200.6 px in ONE frame (26/26 and 16/16 runs).
 *
 * WHAT IS ASSERTED HERE is the store's own contract, in the store's own terms -
 * no DOM, no React:
 *
 * - complete ONLY when nothing was trimmed AND no older rows are owed;
 * - owed means: the page said so (`hasMore`), no page named a start at all
 *   (`oldestId` null - a live-only or cache-seeded pane), or a settings prune
 *   is waiting on its older native target (`profileHistoryPending`);
 * - a trim by either ceiling makes it incomplete, because a suffix that
 *   dropped rows is the exact shape the jump was measured on;
 * - a paint trimmed to nothing still leaves no entry - the flag must not
 *   resurrect a cache hit.
 *
 * The module reaches `transcript-reducer` and therefore this app's i18n core;
 * that is why the bundle below aliases the renderer's path aliases rather than
 * importing the source directly, as `paint-cache-anchor.test.mjs` does.
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

const user = (id, over = {}) => ({
	kind: "user",
	id,
	ts: TS,
	text: "Which invoices were late last month?",
	images: [],
	...over,
});
const answer = (id, over = {}) => ({
	kind: "assistant",
	id,
	ts: TS,
	text: "Four invoices were late.",
	streaming: false,
	stopReason: null,
	error: false,
	...over,
});
const streaming = (id) => ({ ...answer(id), streaming: true });

/*
 * A pane whose page named the cursor at its first row and said there is
 * nothing older: the shape a fully loaded short conversation has. Every case
 * that wants a different page knowledge overrides the three fields.
 */
const transcriptOf = (records, over = {}) => ({
	records,
	index: new Map(records.map((record, position) => [record.id, position])),
	generation: 1,
	oldestId: records.length > 0 ? records[0].id : null,
	oldestTs: records.length > 0 ? TS : 0,
	hasMore: false,
	argsByCall: new Map(),
	compacting: false,
	compactingSince: 0,
	viewEpoch: 0,
	...over,
});

const reset = () => paintCache.__resetPaintCache();

test("a conversation the page loaded whole is cached complete", () => {
	reset();
	paintCache.writePaint(session, {
		transcript: transcriptOf([user("u1"), answer("a1")]),
	});
	const paint = paintCache.readPaint(session);
	assert.ok(paint, "the paint was written");
	assert.equal(
		paint.complete,
		true,
		"nothing was trimmed and the page named the conversation's start: these rows are all of it, so the pane may top-anchor them",
	);
	// The completion flag does not undo the cursor's own rule: the cache still
	// stores no paging cursor, because a trimmed or re-fetched set would make it
	// answer for rows this paint does not hold.
	assert.equal(paint.transcript.hasMore, false);
	assert.equal(paint.transcript.oldestId, null);
});

test("a page that owes older rows is cached incomplete", () => {
	reset();
	paintCache.writePaint(session, {
		transcript: transcriptOf([user("u2"), answer("a2")], { hasMore: true }),
	});
	assert.equal(
		paintCache.readPaint(session)?.complete,
		false,
		"the backend said more rows exist above these, so this paint is a suffix whatever its size",
	);
});

test("a pane no page named a start for is cached incomplete", () => {
	reset();
	// A seeded mount (the cache clears `oldestId`) or a pane that has so far
	// seen only live rows: nothing here says the conversation begins at u3, and
	// an absent cursor is not a statement that the transcript is whole.
	paintCache.writePaint(session, {
		transcript: transcriptOf([user("u3")], { oldestId: null, oldestTs: 0 }),
	});
	assert.equal(
		paintCache.readPaint(session)?.complete,
		false,
		"no page named the start, so completeness is unknown and is not claimed",
	);
});

test("a row-cap trim is cached incomplete", () => {
	reset();
	const rows = Array.from({ length: 205 }, (_, index) => user(`u${index}`));
	paintCache.writePaint(session, { transcript: transcriptOf(rows) });
	const paint = paintCache.readPaint(session);
	assert.equal(paint?.transcript.records.length, 200, "the row ceiling");
	assert.equal(
		paint?.complete,
		false,
		"five rows were dropped from the front, so the retained rows are a suffix even though the page said there was nothing older",
	);
});

test("a byte-cap trim is cached incomplete", () => {
	reset();
	// 40 rows of ~40 KB: 1.6 MB against the 1 MiB per-conversation ceiling, so
	// the trim is by bytes rather than by count - the measured jump's shape.
	const heavy = "x".repeat(40 * 1024);
	const rows = Array.from({ length: 40 }, (_, index) =>
		answer(`a${index}`, { text: heavy }),
	);
	paintCache.writePaint(session, { transcript: transcriptOf(rows) });
	const paint = paintCache.readPaint(session);
	assert.ok(
		paint && paint.transcript.records.length < rows.length,
		"the byte ceiling dropped rows",
	);
	assert.equal(
		paint.complete,
		false,
		"the retained rows are the newest suffix, so the pane must not top-anchor them",
	);
});

test("a settings prune still waiting on its older target is cached incomplete", () => {
	reset();
	paintCache.writePaint(session, {
		transcript: transcriptOf([user("u4"), answer("a4")], {
			profileHistoryPending: [{ id: "u4" }],
		}),
	});
	assert.equal(
		paintCache.readPaint(session)?.complete,
		false,
		"a pruned history has older rows this pane will re-read, so what it holds is not the whole conversation",
	);
});

test("a paint trimmed to nothing is still no entry at all", () => {
	reset();
	paintCache.writePaint(session, {
		transcript: transcriptOf([streaming("a1")]),
		busy: true,
	});
	assert.equal(
		paintCache.readPaint(session),
		null,
		"only in-flight rows: dropping them all leaves nothing to paint, and a completeness flag cannot make that a hit",
	);
	assert.equal(paintCache.paintMissReason(session), "empty-after-trim");
});
