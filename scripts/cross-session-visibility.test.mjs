/*
 * The renderer filter behind `display.hide_cross_session`, exercised through
 * the SHIPPED module (the bundle below imports the same
 * `cross-session-visibility.ts` the transcript does, so a second
 * implementation cannot pass here while the product disagrees with it).
 *
 * Three properties, and the second two are the ones a future edit breaks by
 * accident:
 *
 * 1. THE HIDDEN SET. `kind: "peer"` receipts and tool rows whose tool name is
 *    EXACTLY `send` are dropped; wake receipts, hub-derived customs and every
 *    other tool stay. The literal is the frozen cross-repo contract — the TUI
 *    and phone enforce the identical set from the identical key.
 * 2. IDENTITY AT THE DEFAULT. `hide === false` returns the SAME array
 *    reference, so every downstream memo (`buildRows`' reuse pass, the
 *    working line, the collapse plan) keeps its identity and the default-off
 *    render stays byte-identical. A test asserts reference equality because a
 *    fresh-but-equal array would pass a deep comparison while re-rendering
 *    the whole transcript.
 * 3. IDENTITY WHEN NOTHING WAS DROPPED. A session holding no cross-session
 *    traffic gets the same reference under `hide === true` — otherwise
 *    turning the option on would rebuild every transcript that has nothing to
 *    hide.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export { visibleRecords } from "./src/renderer/src/features/chat/canonical/cross-session-visibility";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const module = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const { visibleRecords } = module;

/* ------------------------------- fixtures ------------------------------- */

const TS = 1_000_000;

const user = (id) => ({ kind: "user", id, ts: TS, text: "go" });
const answer = (id) => ({
	kind: "assistant",
	id,
	ts: TS + 6_000,
	text: "done",
	streaming: false,
});
/** A tool row; only `toolName` matters to the filter, the rest is the shape. */
const tool = (id, toolName) => ({
	kind: "tool",
	id,
	ts: TS + 1_000,
	toolCallId: id,
	toolName,
	phase: "done",
	isError: false,
});
const peer = (id) => ({
	kind: "peer",
	id,
	ts: TS + 2_000,
	body: "from a peer",
	sender: { pid: "42", conversationName: "other", cwd: "" },
});
const wake = (id) => ({ kind: "wake", id, ts: TS + 3_000, text: "wake" });
/** A hub-derived custom row — delegation traffic, not cross-session traffic. */
const hub = (id) => ({
	kind: "custom",
	id,
	ts: TS + 4_000,
	customType: "hub_message",
	level: "info",
	category: null,
	provider: null,
	headline: "From the hub.",
	detail: null,
	text: "From the hub.",
});

const ids = (records) => records.map((record) => record.id);

/* ------------------------------ the hidden set --------------------------- */

test("drops the peer receipt and the send tool row, keeps everything else in order", () => {
	const records = [
		user("u1"),
		peer("p1"),
		tool("t1", "bash"),
		tool("t2", "send"),
		tool("t3", "task"),
		wake("w1"),
		hub("h1"),
		answer("a1"),
	];
	const shown = visibleRecords(records, true);
	assert.notEqual(shown, records, "a drop mints a new list");
	assert.deepEqual(
		ids(shown),
		["u1", "t1", "t3", "w1", "h1", "a1"],
		"only the peer receipt and the send row are gone",
	);
});

test("the tool name is matched exactly: case and padding are different names", () => {
	// The registry serves the tool as the literal `send`; a predicate loosened
	// to a fold or a trim would change the frozen contract's meaning.
	const records = [
		tool("t1", "send"),
		tool("t2", "Send"),
		tool("t3", "SEND"),
		tool("t4", "send "),
	];
	assert.deepEqual(ids(visibleRecords(records, true)), ["t2", "t3", "t4"]);
});

/* -------------------------------- identity ------------------------------- */

test("the default returns the same reference, hidden content present or not", () => {
	const records = [user("u1"), peer("p1"), tool("t1", "send"), answer("a1")];
	assert.equal(
		visibleRecords(records, false),
		records,
		"hide=false must hand back the bare reference - the memos downstream key on it",
	);
});

test("nothing dropped returns the same reference even when hiding", () => {
	const records = [user("u1"), tool("t1", "bash"), wake("w1"), hub("h1")];
	assert.equal(
		visibleRecords(records, true),
		records,
		"a session with no cross-session traffic must not rebuild its list",
	);
});

test("an empty list is identity in both modes", () => {
	const empty = [];
	assert.equal(visibleRecords(empty, true), empty);
	assert.equal(visibleRecords(empty, false), empty);
});
