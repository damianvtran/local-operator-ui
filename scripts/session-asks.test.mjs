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
const { resolveSessionAskFrame, askQueueView } = mod;

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
 * The frame a resumed conversation's durable checkpoint produces: `asks` and
 * `asks_open` both present-but-null, which `askQueuePublished` reads as "no
 * claim" (the state the pre-fix UI worded as an unsupported runtime).
 */
const CLAIMLESS = { asks: null, asks_open: null, asks_truncated: null };
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
