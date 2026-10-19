import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE SESSION ASK FRAME, pinned.
 *
 * Why this file exists: the operator's screenshot - "This conversation · Asks
 * unavailable" over a conversation with asks in the index - was not a drawer
 * bug. The durable checkpoint of a resumed conversation deliberately carries no
 * ask claim, and the UI read that claimless frame as a capability answer. The
 * fix merges the canonical frame with the aggregate index in one pure function
 * (`session-asks.ts`); this rig drives every arm of that table, including the
 * one the bug lived in: a pending read must resolve to `null` (unread), never to
 * the resolved unavailable frame.
 *
 * What it cannot answer: the render. `ask-open-render.test.mjs` mounts the real
 * drawer over this function's answers for the pixels and the copy.
 */

const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/features/chat/session-asks";
			export { askQueueView } from "./src/renderer/src/features/chat/ask-queue";
		`,
		loader: "tsx",
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	// The renderer's own alias: `ask-queue` reaches the desktop API through `@shared`.
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	write: false,
	logLevel: "silent",
});
const bundlePath = new URL(
	`./_session-asks-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
let mod;
try {
	mod = await import(bundlePath.href);
} finally {
	// Removed even when the import throws: a stray bundle in `scripts/` is repo scratch.
	await unlink(bundlePath).catch(() => {});
}
const { ASK_AGGREGATE_SESSION_CAP, resolveSessionAskFrame, askQueueView } = mod;

/*
 * The page-to-pane wiring, as patterns hoisted to module scope (a regex literal
 * in a test body is rebuilt per call - `ask-open-render.test.mjs` states the same
 * rule).
 */
/*
 * BOTH HALVES: the memo AND the callee it runs. A declaration-only pattern
 * passes if the body is swapped for `canonical.frontend`, which would silently
 * restore the claimless reading the whole PR removes (review R2-2).
 */
const PAGE_RESOLVES_FRAME =
	/const sessionAskFrame = useMemo\(\s*\(\)\s*=>\s*resolveSessionAskFrame\(/;
const CONTENT_FORWARDS_STATUS = /sessionStatus=\{sessionStatus\}/;
const COMPOSER_HANDS_FRAME = /askFrontend=\{sessionStatus\?\.asks\}/;

const TS = 1_760_000_000_000;
const SESSION = "fa1107000001";
const OTHER = "fa1107000002";

/** One ask as the aggregate index publishes it (the fields the readers touch). */
const row = (over = {}) => ({
	ask_id: "a-1",
	session_id: SESSION,
	created_at: TS,
	expires_at: TS + 3_600_000,
	timeout_s: 3600,
	urgent: false,
	status: "open",
	delivered: false,
	questions: [],
	cwd: "/synthetic/ci",
	...over,
});

/**
 * The frame a resumed conversation's durable checkpoint produces ON THE WIRE:
 * the ask keys are ABSENT, not present-null (the core's serializer pops the
 * null fields - `frontend_state.py:3548-3558`), which `askQueuePublished` reads
 * as "no claim" (the state the pre-fix UI worded as an unsupported runtime).
 * The resolver treats null and undefined alike, but the rig models the bytes
 * the app actually receives.
 */
const CLAIMLESS = {};
const PENDING = { rows: null, capability: "unknown" };
const answered = (rows) => ({ rows, capability: "live" });

test("a claimless frame with the aggregate still in flight is LOADING, never unavailable", () => {
	const frame = resolveSessionAskFrame(SESSION, CLAIMLESS, PENDING);
	assert.equal(frame, null);
	assert.equal(
		askQueueView(frame).unread,
		true,
		"the drawer must say it is reading, not that the runtime cannot",
	);
	assert.equal(askQueueView(frame).published, false);
});

test("a claimless frame takes its rows and count from the aggregate, filtered by session", () => {
	const mine = [
		row({ ask_id: "a-1" }),
		row({ ask_id: "a-2" }),
		row({ ask_id: "a-3", session_id: OTHER }),
	];
	const frame = resolveSessionAskFrame(SESSION, CLAIMLESS, answered(mine));
	assert.deepEqual(
		frame.asks.map((entry) => entry.ask_id),
		["a-1", "a-2"],
		"another conversation's row must not leak into this session's drawer",
	);
	assert.equal(frame.asks_open, 2);
	assert.equal(frame.asks_truncated, false);
	const view = askQueueView(frame);
	assert.equal(view.published, true);
	assert.equal(view.unread, false);
	assert.equal(view.rows.length, 2);
});

test("an empty aggregate slice is a RESOLVED empty queue, not an unavailable one", () => {
	const frame = resolveSessionAskFrame(SESSION, CLAIMLESS, answered([]));
	assert.deepEqual(frame, { asks: null, asks_open: 0, asks_truncated: false });
	const view = askQueueView(frame);
	assert.equal(
		view.published,
		true,
		"asks_open: 0 is the live-but-empty wire shape",
	);
	assert.equal(view.unread, false);
	assert.equal(view.rows.length, 0);
});

test("a 404 before the session frame has answered is still LOADING (R1-1)", () => {
	/*
	 * The pre-snapshot window of a conversation switch (or a restart with the
	 * drawer carried open): the aggregate answers in ~6 ms, the stream's first
	 * snapshot is ~1.4 s away. `askQueuePublished(null)` is false for both "no
	 * canonical frame" and "a claimless one", so the absent arm used to fire on
	 * the first and make a terminal claim while the session's own read was
	 * pending. It must wait for the claimless frame.
	 */
	const frame = resolveSessionAskFrame(SESSION, null, {
		rows: null,
		capability: "absent",
	});
	assert.equal(frame, null);
	assert.equal(askQueueView(frame).unread, true);
});

test("only a 404 may become the resolved unavailable frame", () => {
	const frame = resolveSessionAskFrame(SESSION, CLAIMLESS, {
		rows: null,
		capability: "absent",
	});
	assert.deepEqual(frame, {
		asks: null,
		asks_open: null,
		asks_truncated: false,
	});
	const view = askQueueView(frame);
	assert.equal(
		view.unread,
		false,
		"the runtime answered: it does not publish a queue",
	);
	assert.equal(view.published, false);
});

test("a transient failure stays LOADING: no sentence claims the runtime is unsupported", () => {
	for (const capability of ["unknown", "live"]) {
		const frame = resolveSessionAskFrame(SESSION, CLAIMLESS, {
			rows: null,
			capability,
		});
		assert.equal(
			frame,
			null,
			`capability ${capability} with no rows is unread`,
		);
		assert.equal(askQueueView(frame).unread, true);
	}
});

test("a canonical live-but-empty list is not overridden by a stale aggregate", () => {
	const canonical = { asks: [], asks_open: 0, asks_truncated: false };
	const frame = resolveSessionAskFrame(SESSION, canonical, answered([row()]));
	assert.deepEqual(frame.asks, [], "an array is the frame's own table of rows");
	assert.equal(frame.asks_open, 0);
	const view = askQueueView(frame);
	assert.equal(view.published, true);
	assert.equal(view.rows.length, 0);
});

test("a tally-only frame keeps the canonical tally when the index holds fewer rows (R1-2)", () => {
	const canonical = { asks: null, asks_open: 5, asks_truncated: true };
	const frame = resolveSessionAskFrame(
		SESSION,
		canonical,
		answered([
			row({ ask_id: "a-1" }),
			row({ ask_id: "a-2" }),
			row({ ask_id: "a-3" }),
		]),
	);
	assert.equal(
		frame.asks_open,
		5,
		"the frame's own count of record must survive the row fill",
	);
	assert.deepEqual(
		frame.asks.map((entry) => entry.ask_id),
		["a-1", "a-2", "a-3"],
	);
});

test("canonical rows win over the aggregate", () => {
	const canonicalRow = row({ ask_id: "canonical" });
	const canonical = {
		asks: [canonicalRow],
		asks_open: 1,
		asks_truncated: false,
	};
	const frame = resolveSessionAskFrame(
		SESSION,
		canonical,
		answered([row({ ask_id: "aggregate" })]),
	);
	assert.deepEqual(
		frame.asks.map((entry) => entry.ask_id),
		["canonical"],
	);
	assert.equal(frame.asks_open, 1);
});

test("a tally-only frame fills its rows from the aggregate when the bound dropped them", () => {
	const canonical = { asks: null, asks_open: 2, asks_truncated: true };
	const frame = resolveSessionAskFrame(
		SESSION,
		canonical,
		answered([row({ ask_id: "a-1" }), row({ ask_id: "a-2" })]),
	);
	assert.deepEqual(
		frame.asks.map((entry) => entry.ask_id),
		["a-1", "a-2"],
	);
	assert.equal(frame.asks_open, 2);
	assert.equal(
		frame.asks_truncated,
		false,
		"the shown list is the uncapped aggregate's, not the bounded one",
	);
});

test("a tally-only frame with the aggregate in flight is passed through", () => {
	const canonical = { asks: null, asks_open: 2, asks_truncated: true };
	const frame = resolveSessionAskFrame(SESSION, canonical, PENDING);
	assert.deepEqual(frame, canonical);
	const view = askQueueView(frame);
	assert.equal(view.published, true, "the tally is a claim");
	assert.equal(view.open, 2);
});

test("a tally-only zero is the live-but-empty canonical answer", () => {
	const canonical = { asks: null, asks_open: 0, asks_truncated: false };
	const frame = resolveSessionAskFrame(SESSION, canonical, PENDING);
	assert.deepEqual(frame, canonical);
	assert.equal(askQueueView(frame).rows.length, 0);
});

test("a slice at the projection cap is conservatively marked possibly truncated (R1-6)", () => {
	const cap = ASK_AGGREGATE_SESSION_CAP;
	const rows = (count) =>
		Array.from({ length: count }, (_, index) =>
			row({ ask_id: `cap-${index}` }),
		);
	const atCap = resolveSessionAskFrame(SESSION, CLAIMLESS, answered(rows(cap)));
	assert.equal(
		atCap.asks_truncated,
		true,
		"at the cap the prefix may be partial",
	);
	assert.equal(askQueueView(atCap).rows.length, cap);
	const below = resolveSessionAskFrame(
		SESSION,
		CLAIMLESS,
		answered(rows(cap - 1)),
	);
	assert.equal(
		below.asks_truncated,
		false,
		"below the cap the slice is the population",
	);
});

test("the page resolves the frame once and both surfaces receive it (R1-3)", async () => {
	const { readFileSync } = await import("node:fs");
	const page = readFileSync(
		"src/renderer/src/features/chat/components/chat-page.tsx",
		"utf8",
	);
	assert.match(page, PAGE_RESOLVES_FRAME);
	/*
	 * TWO HAND-OFFS, in two windows: `liveSessionStatus` is the composer's
	 * `sessionStatus.asks` (built before the mount), and the `ChatContent`
	 * `canonical` object is the drawer/count/policy frame. A single global count
	 * would still pass if one hand-off moved into the other's place, which is the
	 * drift this pins.
	 */
	const liveAt = page.indexOf("const liveSessionStatus = useMemo(");
	const contentAt = page.indexOf("<ChatContent");
	assert.ok(liveAt !== -1 && contentAt > liveAt, "both anchors must exist");
	assert.ok(
		page.slice(liveAt, contentAt).includes("asks: sessionAskFrame,"),
		"liveSessionStatus must carry the resolved frame as `asks`",
	);
	assert.ok(
		page.slice(contentAt).includes("asks: sessionAskFrame,"),
		"the ChatContent canonical object must carry the resolved frame",
	);
	const content = readFileSync(
		"src/renderer/src/features/chat/components/chat-content.tsx",
		"utf8",
	);
	assert.match(
		content,
		CONTENT_FORWARDS_STATUS,
		"chat-content must forward sessionStatus to the composer",
	);
	const input = readFileSync(
		"src/renderer/src/shared/components/composer/message-input.tsx",
		"utf8",
	);
	assert.match(
		input,
		COMPOSER_HANDS_FRAME,
		"the composer must hand the merged frame to its status row",
	);
});

test("a draft has no queue to resolve, even when the aggregate has rows", () => {
	assert.equal(
		resolveSessionAskFrame(null, CLAIMLESS, answered([row()])),
		null,
	);
	assert.equal(
		resolveSessionAskFrame(undefined, CLAIMLESS, answered([row()])),
		null,
	);
});
