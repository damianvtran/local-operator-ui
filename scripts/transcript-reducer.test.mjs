import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { build } from "esbuild";

// The reducer is pure TypeScript with no React or DOM imports, so it bundles
// the same way the desktop transport does and runs under node --test. This
// guards the invariants the transcript view depends on: stable identity for
// unchanged records (the equality gate), replay-then-snapshot ordering, and
// idempotent reconnect replay.
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/transcript-reducer";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const reducer = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	EMPTY_TRANSCRIPT,
	applyEvent,
	applyHistoryPage,
	applyLiveSeed,
	clearTranscript,
	dropLiveRecords,
	labelGapCandidates,
	reconcileLimit,
	seedCallsMissingLabels,
	withRecoveredOutcome,
	appendPendingUser,
	removeRecord,
} = reducer;

/** A fresh empty transcript, so each echo test starts from a known state. */
const state0 = () => EMPTY_TRANSCRIPT;

const assistant = (id, text) => ({
	role: "assistant",
	content: text ? [{ type: "text", text }] : [],
	tool_calls: [],
	id,
});
const user = (id, text) => ({
	role: "user",
	content: [{ type: "text", text }],
	tool_calls: [],
	id,
});

test("streaming deltas coalesce into one record with stable identity", () => {
	let state = EMPTY_TRANSCRIPT;
	state = applyEvent(
		state,
		{ type: "message_start", message: user("u1", "hi") },
		1,
	);
	state = applyEvent(state, { type: "agent_start", generation: "1" }, 2);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistant("a1", "") },
		3,
	);
	const before = state.records.find((r) => r.id === "u1");
	const deltas = 200;
	for (let i = 0; i < deltas; i++) {
		state = applyEvent(
			state,
			{
				type: "message_update",
				delta: `tok${i} `,
				message: assistant("a1", ""),
			},
			4 + i,
		);
	}
	const after = state.records.find((r) => r.id === "u1");
	// The equality gate: a record untouched by the delta stream is the SAME
	// object, so a memoised row sees no prop change and does not re-render.
	assert.equal(
		before,
		after,
		"unchanged record identity preserved across deltas",
	);
	const a1 = state.records.find((r) => r.id === "a1");
	assert.equal(a1.kind, "assistant");
	assert.equal(a1.streaming, true);
	assert.equal(a1.text.split(" ").filter(Boolean).length, deltas);
	assert.equal(state.records.length, 2, "no per-delta rows");
});

test("message_end is authoritative over accumulated deltas", () => {
	let state = EMPTY_TRANSCRIPT;
	state = applyEvent(
		state,
		{ type: "message_start", message: assistant("a1", "") },
		1,
	);
	state = applyEvent(
		state,
		{ type: "message_update", delta: "Hel", message: assistant("a1", "") },
		2,
	);
	state = applyEvent(
		state,
		{ type: "message_end", message: assistant("a1", "Hello!") },
		3,
	);
	const a1 = state.records.find((r) => r.id === "a1");
	assert.equal(a1.text, "Hello!");
	assert.equal(a1.streaming, false);
});

test("durable history wins over live projections and replay never regresses it", () => {
	let state = EMPTY_TRANSCRIPT;
	// Live projection from an old replay (partial text).
	state = applyEvent(
		state,
		{ type: "message_start", message: assistant("a1", "") },
		1,
	);
	state = applyEvent(
		state,
		{ type: "message_update", delta: "part", message: assistant("a1", "") },
		2,
	);
	// Snapshot's durable page carries the full row.
	const page = {
		entries: [
			{
				id: "u1",
				ts: 10,
				type: "message",
				payload: { kind: "message", ...user("u1", "hi") },
			},
			{
				id: "a1",
				ts: 11,
				type: "message",
				payload: { kind: "message", ...assistant("a1", "partial then full") },
			},
		],
		has_more: false,
		cursor_missing: false,
	};
	state = applyHistoryPage(state, page);
	let a1 = state.records.find((r) => r.id === "a1");
	assert.equal(a1.text, "partial then full");
	assert.equal(a1.streaming, false);
	// A late replayed delta for the same id must not reopen or regress it.
	const again = applyEvent(
		state,
		{ type: "message_update", delta: "stale", message: assistant("a1", "") },
		3,
	);
	a1 = again.records.find((r) => r.id === "a1");
	assert.equal(a1.text, "partial then full");
	assert.equal(
		again,
		state,
		"stale replay is a no-op returning the same state",
	);
	// Re-applying the same page is idempotent (reconnect replay).
	assert.equal(applyHistoryPage(state, page), state);
	assert.deepEqual(
		state.records.map((r) => r.id),
		["u1", "a1"],
		"ordered by durable timestamp",
	);
});

test("live seed after snapshot does not duplicate durable rows", () => {
	let state = EMPTY_TRANSCRIPT;
	const page = {
		entries: [
			{
				id: "u1",
				ts: 10,
				type: "message",
				payload: { kind: "message", ...user("u1", "hi") },
			},
		],
		has_more: false,
		cursor_missing: false,
	};
	state = applyHistoryPage(state, page);
	state = applyLiveSeed(
		state,
		{
			streaming: true,
			generation: "2",
			live_events: [
				{ type: "message_start", message: user("u1", "hi") },
				{ type: "message_start", message: assistant("a2", "") },
				{
					type: "message_update",
					delta: "in flight",
					message: assistant("a2", ""),
				},
			],
		},
		20,
	);
	assert.deepEqual(
		state.records.map((r) => r.id),
		["u1", "a2"],
	);
	assert.equal(state.records[1].text, "in flight");
	assert.equal(state.records[1].streaming, true);
});

test("tool call lifecycle collapses to one row with output behind it", () => {
	let state = EMPTY_TRANSCRIPT;
	state = applyEvent(
		state,
		{
			type: "tool_call_compose",
			tool_call_id: "c1",
			tool_name: "read",
			argument_bytes: 0,
		},
		1,
	);
	state = applyEvent(
		state,
		{
			type: "tool_execution_start",
			tool_call_id: "c1",
			tool_name: "read",
			args: { path: "a.txt" },
		},
		2,
	);
	state = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: "c1",
			tool_name: "read",
			result: { content: [{ type: "text", text: "file body" }] },
			is_error: false,
			duration_s: 0.2,
		},
		3,
	);
	const tools = state.records.filter((r) => r.kind === "tool");
	assert.equal(tools.length, 1);
	assert.equal(tools[0].phase, "done");
	assert.equal(tools[0].output, "file body");
	assert.equal(tools[0].args.path, "a.txt");
});

test("gap drops only live projections; clear is view-only", () => {
	let state = EMPTY_TRANSCRIPT;
	state = applyHistoryPage(state, {
		entries: [
			{
				id: "u1",
				ts: 10,
				type: "message",
				payload: { kind: "message", ...user("u1", "hi") },
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	state = applyEvent(
		state,
		{ type: "message_start", message: assistant("a9", "") },
		1,
	);
	const dropped = dropLiveRecords(state);
	assert.deepEqual(
		dropped.records.map((r) => r.id),
		["u1"],
	);
	const cleared = clearTranscript(state);
	assert.equal(cleared.records.length, 0);
	/*
	 * And it bumps the view's epoch, which is the only way a read scheduled
	 * before the clear can know its page would repaint what `/clear` removed
	 * (`refreshTail`'s cleared-view guard; round 3, U11/Q7/R3-7).
	 */
	assert.equal(cleared.viewEpoch, state.viewEpoch + 1);
	// Clearing is a renderer concern: the reducer holds nothing that would
	// tell a backend to delete, and re-applying the page repaints it.
	assert.equal(
		applyHistoryPage(cleared, {
			entries: [
				{
					id: "u1",
					ts: 10,
					type: "message",
					payload: { kind: "message", ...user("u1", "hi") },
				},
			],
			has_more: false,
			cursor_missing: false,
		}).records.length,
		1,
	);
});

test("throughput: 5000 deltas over a 400-row transcript stays sub-millisecond per delta", () => {
	let state = EMPTY_TRANSCRIPT;
	const entries = [];
	for (let i = 0; i < 200; i++) {
		entries.push({
			id: `u${i}`,
			ts: i * 2,
			type: "message",
			payload: { kind: "message", ...user(`u${i}`, `q${i}`) },
		});
		entries.push({
			id: `a${i}`,
			ts: i * 2 + 1,
			type: "message",
			payload: { kind: "message", ...assistant(`a${i}`, `answer ${i}`) },
		});
	}
	state = applyHistoryPage(state, {
		entries,
		has_more: false,
		cursor_missing: false,
	});
	state = applyEvent(
		state,
		{ type: "message_start", message: assistant("live", "") },
		1000,
	);
	const t0 = performance.now();
	const n = 5000;
	for (let i = 0; i < n; i++) {
		state = applyEvent(
			state,
			{ type: "message_update", delta: "x", message: assistant("live", "") },
			1001 + i,
		);
	}
	const perDelta = (performance.now() - t0) / n;
	console.log(
		`reducer: ${perDelta.toFixed(4)} ms per delta over ${state.records.length} rows`,
	);
	assert.ok(perDelta < 1, `per-delta cost ${perDelta}ms`);
	assert.equal(state.records.at(-1).text.length, n);
});

// --- crash-recovered outcomes -------------------------------------------------
//
// `withRecoveredOutcome` is the only producer of the row for an outcome that
// crash recovery republished without a durable `completion_attention` entry.
// It fixes an unclearable unread badge, so it is exactly the function that must
// not itself be untested.

const ANCHOR = "completion-1f8f5be8-0000-4000-8000-00000000000a";
const seeded = () =>
	applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			{
				id: "u1",
				ts: 1,
				type: "message",
				payload: { role: "user", message: "hi" },
			},
		],
		has_more: false,
		cursor_missing: false,
	});
const attention = (overrides = {}) => ({
	anchor_id: ANCHOR,
	kind: "interrupted",
	unseen: true,
	conversation_id: "session/123456abcdef",
	...overrides,
});
const rowFor = (state) => state.records.find((record) => record.id === ANCHOR);

test("a crash-recovered outcome is rendered at its own anchor, and is ackable", () => {
	const state = withRecoveredOutcome(seeded(), attention(), false, new Set());
	const row = rowFor(state);
	assert.equal(row.kind, "notice");
	assert.equal(row.text, "Interrupted");
	assert.equal(row.level, "warning");
	// Without this the view has nothing to hit-test and the badge never clears.
	assert.equal(row.complete, true);
	assert.equal(
		rowFor(
			withRecoveredOutcome(
				seeded(),
				attention({ kind: "error" }),
				false,
				new Set(),
			),
		).text,
		"Stopped with an error",
	);
});

test("the recovered row survives its own acknowledgement", () => {
	// The row is ackable, so it acknowledges itself within ~500 ms, and the
	// receipt writes only to the store -- no durable row ever replaces it.
	// Deriving its existence from `unseen` made "Interrupted" vanish under the
	// user and stay gone, disagreeing with the TUI, whose notice persists.
	const remembered = new Set();
	assert.ok(
		rowFor(withRecoveredOutcome(seeded(), attention(), false, remembered)),
	);
	const afterAck = withRecoveredOutcome(
		seeded(),
		attention({ unseen: false }),
		false,
		remembered,
	);
	assert.ok(rowFor(afterAck), "the outcome disappeared once it was read");
});

test("an outcome already read elsewhere does not appear in a conversation that never showed it", () => {
	// Opening a conversation whose outcome was acknowledged on the phone must
	// not resurrect a notice this surface never displayed.
	const state = withRecoveredOutcome(
		seeded(),
		attention({ unseen: false }),
		false,
		new Set(),
	);
	assert.equal(rowFor(state), undefined);
});

test("a historical failure is not inserted at the tail of a running retry", () => {
	// The TUI's own guard: while a retry is streaming, an older outcome must not
	// be painted as though it were the current one.
	assert.equal(
		rowFor(withRecoveredOutcome(seeded(), attention(), true, new Set())),
		undefined,
	);
});

test("synthesis is idempotent and never overwrites a real durable row", () => {
	const remembered = new Set();
	const once = withRecoveredOutcome(seeded(), attention(), false, remembered);
	const twice = withRecoveredOutcome(once, attention(), false, remembered);
	assert.equal(
		twice.records.filter((record) => record.id === ANCHOR).length,
		1,
	);
	assert.equal(twice, once, "a second apply must not rebuild the state");

	// An anchor colliding with a durable id leaves that row untouched.
	const collides = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			{
				id: ANCHOR,
				ts: 1,
				type: "message",
				payload: { role: "user", message: "real" },
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	assert.equal(
		rowFor(withRecoveredOutcome(collides, attention(), false, new Set())).kind,
		"user",
	);
});

test("only error and interrupted outcomes are synthesized", () => {
	for (const kind of ["complete", null, undefined, "weird"]) {
		assert.equal(
			rowFor(
				withRecoveredOutcome(seeded(), attention({ kind }), false, new Set()),
			),
			undefined,
			String(kind),
		);
	}
	for (const missing of [null, undefined, {}, { anchor_id: null }]) {
		assert.equal(
			rowFor(withRecoveredOutcome(seeded(), missing, false, new Set())),
			undefined,
		);
	}
});

/* ---------------------------------------------------------------------- *
 * Images on the wire.
 *
 * Two shapes, because two producers dump differently: a LIVE event is dumped
 * whole and carries `type` plus the full base64, while a DURABLE row is dumped
 * with `exclude_defaults=True` — where `type` IS the pydantic default, so it is
 * absent — and has its payload externalised to the attachment store above 1 KiB
 * of base64. The fixtures below are the REAL shapes, taken from
 * ~/.local-operator/sessions/*\/transcript.jsonl rather than invented.
 * ---------------------------------------------------------------------- */

const DIGEST = "7310e3e79e5eafd8fb21f1dcfed39c17";
/** A durable image block exactly as it appears on disk: no `type`, no `data`. */
const durableImage = { attachment: DIGEST, mime_type: "image/png" };
/** A live image block, dumped without exclude_defaults. */
const liveImage = { type: "image", data: "aGVsbG8=", mime_type: "image/png" };

test("a durable image row is recognised without a `type` discriminant", () => {
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			{
				id: "u-img",
				ts: 1,
				type: "message",
				payload: {
					role: "user",
					content: [{ text: "look at this" }, durableImage],
				},
			},
			{
				id: "t-img",
				ts: 2,
				type: "message",
				payload: {
					role: "tool",
					tool_call_id: "c-shot",
					tool_name: "browser",
					content: [durableImage],
					provider_payload: { duration_s: 1.5, details: {} },
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	const user = state.records.find((r) => r.kind === "user");
	const tool = state.records.find((r) => r.kind === "tool");
	// The old predicate tested `type === "image"` and returned 0 for both of
	// these, which is why "N images attached" never appeared after a reload.
	assert.equal(user.images.length, 1);
	assert.equal(user.images[0].attachment, DIGEST);
	assert.equal(user.images[0].data, null);
	assert.equal(user.images[0].mimeType, "image/png");
	// A tool row carries them in `content` the same way, which is the reload
	// half of a browser screenshot.
	assert.equal(tool.images.length, 1);
	assert.equal(tool.images[0].attachment, DIGEST);
	// And the image block must not leak into the row's text.
	assert.equal(user.text, "look at this");
});

test("a live tool result carries its screenshot bytes onto the row", () => {
	let state = EMPTY_TRANSCRIPT;
	state = applyEvent(
		state,
		{
			type: "tool_execution_start",
			tool_call_id: "c-shot",
			tool_name: "browser",
			args: { action: "screenshot" },
		},
		1,
	);
	let tool = state.records.find((r) => r.kind === "tool");
	assert.equal(tool.images.length, 0);
	state = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: "c-shot",
			tool_name: "browser",
			result: {
				content: [{ type: "text", text: "captured" }, liveImage],
				details: {},
			},
			is_error: false,
			duration_s: 2.9,
		},
		2,
	);
	tool = state.records.find((r) => r.kind === "tool");
	// This is the operator's actual complaint, and it needs no backend at all:
	// the bytes were already on the wire and the reducer dropped them.
	assert.equal(tool.images.length, 1);
	assert.equal(tool.images[0].data, "aGVsbG8=");
	assert.equal(tool.images[0].attachment, null);
	assert.equal(tool.output, "captured");
});

test("a durable row replacing a live one keeps the bytes it already had", () => {
	let state = EMPTY_TRANSCRIPT;
	state = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: "c-shot",
			tool_name: "browser",
			result: { content: [liveImage], details: {} },
			duration_s: 2.9,
		},
		1,
	);
	const live = state.records.find((r) => r.kind === "tool");
	assert.equal(live.images[0].data, "aGVsbG8=");
	// The same call, now durable: a digest and no payload.
	state = applyHistoryPage(state, {
		entries: [
			{
				id: "t-durable",
				ts: 1,
				type: "message",
				payload: {
					role: "tool",
					tool_call_id: "c-shot",
					tool_name: "browser",
					content: [durableImage],
					provider_payload: { duration_s: 2.9, details: {} },
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	const merged = state.records.filter((r) => r.kind === "tool");
	assert.equal(merged.length, 1, "the durable row replaces, never duplicates");
	// The live bytes win over the durable digest: they are already decoded in
	// this renderer, so preferring them spares the row the reader is looking at
	// a round trip at the exact moment the turn settles.
	assert.equal(merged[0].images.length, 1);
	assert.equal(merged[0].images[0].data, "aGVsbG8=");
});

test("an unchanged row keeps its record identity, images and all", () => {
	const page = {
		entries: [
			{
				id: "u-img",
				ts: 1,
				type: "message",
				payload: { role: "user", content: [{ text: "hi" }, durableImage] },
			},
		],
		has_more: false,
		cursor_missing: false,
	};
	const first = applyHistoryPage(EMPTY_TRANSCRIPT, page);
	const second = applyHistoryPage(first, page);
	// The identity gate is load-bearing on a surface that repaints per token:
	// `shallowEqual` compares by reference, so a freshly built images array
	// would report every replayed row as changed and re-render every image in
	// the transcript on every delta.
	assert.equal(second, first, "state identity");
	assert.equal(second.records[0], first.records[0], "record identity");
	assert.equal(
		second.records[0].images,
		first.records[0].images,
		"images array identity",
	);
});

test("diff counters ride the row, and only as positive integers", () => {
	const entry = (details) => ({
		id: `t-${JSON.stringify(details)}`,
		ts: 1,
		type: "message",
		payload: {
			role: "tool",
			tool_call_id: `c-${JSON.stringify(details)}`,
			tool_name: "edit",
			content: [{ text: "done", type: "text" }],
			provider_payload: { duration_s: 0.1, details },
		},
	});
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			entry({ added: 42, removed: 11 }),
			// Anything that is not a positive integer is unknown, and unknown
			// renders nothing — `+0` claims that nothing was added, which is a
			// different statement.
			entry({ added: 0, removed: -3 }),
			entry({ added: true, removed: "7" }),
			entry({}),
		],
		has_more: false,
		cursor_missing: false,
	});
	const counts = state.records
		.filter((r) => r.kind === "tool")
		.map((r) => [r.added, r.removed]);
	assert.deepEqual(counts, [
		[42, 11],
		[0, 0],
		[0, 0],
		[0, 0],
	]);
});

test("a call still running when the turn aborts is interrupted, not failed", () => {
	let state = EMPTY_TRANSCRIPT;
	state = applyEvent(
		state,
		{
			type: "tool_execution_start",
			tool_call_id: "c-long",
			tool_name: "bash",
			args: { command: "sleep 600" },
		},
		1,
	);
	state = applyEvent(state, { type: "agent_end", aborted: true }, 2);
	const tool = state.records.find((r) => r.kind === "tool");
	assert.equal(tool.phase, "done");
	// A call the USER stopped did not fail. Reporting an interrupt as an error
	// blames the agent for the user's own decision, which is why the TUI draws
	// it with a third glyph rather than the cross.
	assert.equal(tool.stopped, true);
	assert.equal(tool.isError, false);
});

test("a tool row keeps its arguments when they arrive on a different page", () => {
	// D1: the object column is the row's identity, and a durable tool entry
	// carries the RESULT without the arguments — those live on the paired
	// assistant row's `tool_calls`. When a page boundary (or a reconnect that
	// evicted the live start) separates the two, the row used to settle with
	// `args: null` and render as an unlabelled duplicate of every other row for
	// the same tool. The lookup window is the session, not the page.
	const toolEntry = (id, callId, name) => ({
		id,
		ts: 20,
		type: "message",
		payload: {
			kind: "message",
			role: "tool",
			tool_call_id: callId,
			tool_name: name,
			content: [{ type: "text", text: "ok" }],
		},
	});
	// The results arrive FIRST and alone: no assistant row on this page.
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [toolEntry("t1", "c1", "bash"), toolEntry("t2", "c2", "bash")],
		has_more: true,
		cursor_missing: false,
	});
	let rows = state.records.filter((r) => r.kind === "tool");
	assert.equal(rows.length, 2);
	assert.equal(rows[0].args, null, "nothing has taught the args yet");

	// The page carrying the assistant row lands afterwards.
	const withCalls = applyHistoryPage(state, {
		entries: [
			{
				id: "a1",
				ts: 19,
				type: "message",
				payload: {
					kind: "message",
					role: "assistant",
					content: [],
					tool_calls: [
						{ id: "c1", arguments: { command: "pnpm lint" } },
						{ id: "c2", arguments: { command: "pnpm build", i: "Building" } },
					],
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	rows = withCalls.records.filter((r) => r.kind === "tool");
	assert.equal(
		rows.find((r) => r.toolCallId === "c1").args.command,
		"pnpm lint",
		"an earlier row is backfilled by a later page",
	);
	assert.equal(rows.find((r) => r.toolCallId === "c2").intent, "Building");

	// The identity gate must survive the backfill. Replaying a page that teaches
	// nothing new must reuse every record object, or `TranscriptRow`'s memo
	// breaks and the transcript re-renders on every poll. (The page's own
	// `has_more` legitimately rides along, so the RECORDS are what is compared.)
	const replayed = applyHistoryPage(withCalls, {
		entries: [toolEntry("t1", "c1", "bash"), toolEntry("t2", "c2", "bash")],
		has_more: false,
		cursor_missing: false,
	});
	assert.equal(replayed, withCalls, "a replayed page is a no-op");
});

test("a live start teaches args that the durable row does not carry", () => {
	// The reconnect case: the live `tool_execution_start` is the only carrier of
	// arguments, and the durable entry that replaces it has none.
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "tool_execution_start",
			tool_call_id: "c9",
			tool_name: "bash",
			args: { command: "git status" },
		},
		1,
	);
	state = applyHistoryPage(state, {
		entries: [
			{
				id: "t9",
				ts: 30,
				type: "message",
				payload: {
					kind: "message",
					role: "tool",
					tool_call_id: "c9",
					tool_name: "bash",
					content: [{ type: "text", text: "clean" }],
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	const tool = state.records.find((r) => r.kind === "tool");
	assert.equal(tool.phase, "done");
	assert.equal(tool.args.command, "git status");

	// And it survives a view-only clear followed by a repaint, which is the
	// path whose own events no longer carry the arguments.
	const repainted = applyHistoryPage(clearTranscript(state), {
		entries: [
			{
				id: "t9",
				ts: 30,
				type: "message",
				payload: {
					kind: "message",
					role: "tool",
					tool_call_id: "c9",
					tool_name: "bash",
					content: [{ type: "text", text: "clean" }],
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	assert.equal(
		repainted.records.find((r) => r.kind === "tool").args.command,
		"git status",
		"a clear does not unlearn the arguments",
	);
});

test("a reconnect seed never wipes a durable row's resolvable digest", () => {
	/*
	 * R7. The backend strips image bytes out of `live_events` before it replays
	 * them: `_bound_live_result_in_place` gives each retained result a share of
	 * `max(200, 60_000 // len(results))`, and a block with no `text` key that
	 * exceeds its share is not emptied but REPLACED by a text placeholder
	 * (`frontend_state.py`). A ~1.4 MB base64 screenshot always blows that
	 * budget, so a mid-turn reconnect ALWAYS takes this path — the seed for a
	 * call carries no image blocks at all, by design, because the durable path
	 * is supposed to supply them.
	 *
	 * `use-canonical-session.ts` applies the durable history page FIRST and then
	 * the live seed on top, so the seeded `tool_execution_end` lands on a row
	 * that has already resolved its digest. Letting an empty extraction win
	 * there discards a resolvable digest in favour of the one frame that was
	 * stripped precisely because it could not carry the bytes, and the user
	 * watches the screenshot vanish from a row that had it a moment earlier.
	 */
	let state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			{
				id: "t-durable",
				ts: 1,
				type: "message",
				payload: {
					role: "tool",
					tool_call_id: "c-shot",
					tool_name: "browser",
					content: [durableImage],
					provider_payload: { duration_s: 2.9, details: {} },
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	const durable = state.records.find((r) => r.kind === "tool");
	assert.equal(durable.images.length, 1, "the durable page resolved a digest");
	assert.equal(durable.images[0].attachment, DIGEST);

	// The seed, in the exact shape the backend produces for an over-budget
	// image block: the placeholder text, and no image block anywhere.
	state = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: "c-shot",
			tool_name: "browser",
			result: {
				content: [
					{ type: "text", text: "captured" },
					{
						type: "text",
						text: "[dropped from the reconnect snapshot — see the transcript]",
					},
				],
				details: {},
			},
			duration_s: 2.9,
		},
		2,
	);
	const seeded = state.records.find((r) => r.kind === "tool");
	assert.equal(
		seeded.images.length,
		1,
		"the digest survives the seed — it was 0 before the fix",
	);
	assert.equal(seeded.images[0].attachment, DIGEST);
	// By REFERENCE, so the identity gate still reports the row unchanged and the
	// memoised row does not re-render every image on a reconnect.
	assert.equal(seeded.images, durable.images, "and the array is not rebuilt");
});

test("a genuinely image-free call is not given images it never had", () => {
	// The other side of R7's guard: "this event carried no image blocks" and
	// "this call produced no images" must stay different claims, or a `bash` row
	// would inherit whatever the record happened to hold.
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "tool_execution_start",
			tool_call_id: "c-bash",
			tool_name: "bash",
			args: { command: "ls" },
		},
		1,
	);
	state = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: "c-bash",
			tool_name: "bash",
			result: { content: [{ type: "text", text: "ok" }], details: {} },
			duration_s: 0.4,
		},
		2,
	);
	const row = state.records.find((r) => r.kind === "tool");
	assert.equal(row.images.length, 0, "no images, and none invented");
});

test("a running row with no stated start carries the clock its duration cannot", () => {
	/*
	 * R4/Q-06. `durationS` is null for the whole life of a running call — it
	 * only arrives on `tool_execution_end` — so the row rendered `0s` from start
	 * to finish and a four-minute `bash` looked identical to an instant one.
	 * The row needs a start timestamp of its own to count from.
	 *
	 * THIS FIXTURE STATES NO START, which is the LEGACY-PRODUCER arm and is
	 * asserted here rather than dropped: a frame with no `started_at_epoch` still
	 * falls back to the arrival instant. That is a deliberate asymmetry with the
	 * TUI, which refuses to paint a number it cannot justify
	 * (`tool_card.py:1437-1441`); keeping it means a stated-nothing frame behaves
	 * exactly as it did before the resumed-clock fix, and the fix is confined to
	 * frames that DO state when the call began.
	 */
	const state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "tool_execution_start",
			tool_call_id: "c-run",
			tool_name: "bash",
			args: { command: "sleep 60" },
		},
		1_000,
	);
	const running = state.records.find((r) => r.kind === "tool");
	assert.equal(running.phase, "running");
	assert.equal(running.durationS, null, "the backend has not reported one yet");
	assert.equal(running.startedAt, 1_000, "so the row counts from here instead");

	// A replayed `_start` (the reconnect cursor sends them again) must not
	// restart a clock that is already running, or the row's number jumps
	// backwards in front of the reader.
	const replayed = applyEvent(
		state,
		{
			type: "tool_execution_start",
			tool_call_id: "c-run",
			tool_name: "bash",
			args: { command: "sleep 60" },
		},
		9_999,
	);
	assert.equal(
		replayed.records.find((r) => r.kind === "tool").startedAt,
		1_000,
		"the replay keeps the original start, not 9999",
	);

	// Settling stops the clock and hands over the measured duration.
	const settled = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: "c-run",
			tool_name: "bash",
			result: { content: [{ type: "text", text: "done" }], details: {} },
			duration_s: 60.2,
		},
		61_200,
	);
	const done = settled.records.find((r) => r.kind === "tool");
	assert.equal(done.startedAt, null, "the row stops counting");
	assert.equal(done.durationS, 60.2, "and reports what the backend measured");
});

/*
 * THE OPERATOR REPORT THIS FILE'S NEXT CASES EXIST FOR. Resuming (or
 * attaching to) a session whose call is CURRENTLY RUNNING restarted the elapsed
 * counter from the moment the view loaded: "each time I resume it says it's
 * been waiting for 0s regardless of how long".
 *
 * The caller's arrival instant is what every arrival-stamping path hands
 * `applyEvent` — the reconnect replay applied before the snapshot lands, the
 * live seed applied after it, and the ordinary live frame — so the fix is not
 * in any one of those callers: the frame's OWN clock has to win. These four
 * cases are the four shapes a resumed call arrives in.
 */

/** The producer's stamp, in the epoch SECONDS the wire states it in. */
const START_EPOCH = 1_700_000_000;
/** How long the call had already been running when the viewer attached. */
const RESUMED_AFTER_MS = 137_000;
const ARRIVAL = START_EPOCH * 1000 + RESUMED_AFTER_MS;
const startedFrame = (callId, over = {}) => ({
	type: "tool_execution_start",
	tool_call_id: callId,
	tool_name: "bash",
	args: { command: "sleep 300" },
	started_at_epoch: START_EPOCH,
	...over,
});

const ranRow = (state, callId) =>
	state.records.find((r) => r.kind === "tool" && r.toolCallId === callId);

const expectedStart = START_EPOCH * 1000;
const showsAge = (row) =>
	Math.floor((ARRIVAL - row.startedAt) / 1000) === RESUMED_AFTER_MS / 1000;

test("a live frame's own start stamp beats the viewer's arrival instant", () => {
	const state = applyEvent(
		EMPTY_TRANSCRIPT,
		startedFrame("c-live-clock"),
		ARRIVAL,
	);
	const row = ranRow(state, "c-live-clock");
	assert.equal(
		row.startedAt,
		expectedStart,
		"the frame stated when the call began, so the caller's `now` is not it",
	);
	assert.ok(showsAge(row), "so the row resumes at 137s, not 0s");
});

test("a start frame replayed onto an already-painted row still states the start", () => {
	/*
	 * The seed-applied-after-the-snapshot path, which is the one the operator
	 * hits on every resume: the row is already painted (by the durable page, or
	 * by an earlier replay) when the `_start` frame arrives. The existing-value
	 * rule is the fallback for a frame that states nothing, NOT a rule that lets
	 * a painted arrival instant outrank a stated start.
	 */
	const painted = applyEvent(
		EMPTY_TRANSCRIPT,
		// The legacy arm first: no stamp, so this paints the arrival instant.
		{ ...startedFrame("c-painted"), started_at_epoch: undefined },
		ARRIVAL,
	);
	assert.equal(
		ranRow(painted, "c-painted").startedAt,
		ARRIVAL,
		"the unstamped frame is the arrival instant, as before",
	);
	const corrected = applyEvent(painted, startedFrame("c-painted"), ARRIVAL);
	assert.equal(
		ranRow(corrected, "c-painted").startedAt,
		expectedStart,
		"the stated stamp corrects the arrival instant rather than losing to it",
	);
});

test("a live seed resumes the true age instead of the seed's own arrival", () => {
	/*
	 * `applyLiveSeed` smuggles the stated clock in through its `now` parameter
	 * ONLY for a frame that would CREATE the row, so a compose-then-start seed —
	 * a call the snapshot announces while it is still being dictated, then the
	 * start that replaces it — is the shape where the row already exists and the
	 * seed's arrival instant used to stick. Asserted for the whole seed rather
	 * than for the reducer arm, because that is what a resumed viewer runs.
	 */
	const seeded = applyLiveSeed(
		EMPTY_TRANSCRIPT,
		{
			streaming: true,
			generation: 1,
			live_events: [
				{
					type: "tool_call_compose",
					tool_call_id: "c-seed",
					tool_name: "bash",
					argument_bytes: 24,
				},
				startedFrame("c-seed"),
			],
		},
		ARRIVAL,
	);
	const row = ranRow(seeded, "c-seed");
	assert.equal(row.phase, "running", "the start replaced the composing row");
	assert.equal(
		row.startedAt,
		expectedStart,
		"the stated start survived the seed",
	);
	assert.ok(showsAge(row), "so the resumed row reads 2m17s, not 0s");
});

test("a replay folded before the snapshot does not freeze the arrival instant", () => {
	/*
	 * The path the operator actually hits (`use-canonical-session.ts`): replayed
	 * `event` frames are applied with `now = Date.now()` BEFORE the snapshot's
	 * seed lands, so the row exists by the time the seed arrives. The pre-fix
	 * reducer made that first arrival instant STICKY, and the resumed call read
	 * `0s` for the whole life of the view — no later frame could correct it.
	 */
	let state = applyEvent(EMPTY_TRANSCRIPT, startedFrame("c-replay"), ARRIVAL);
	state = applyLiveSeed(
		state,
		{
			streaming: true,
			generation: 1,
			live_events: [startedFrame("c-replay")],
		},
		ARRIVAL + 1_500,
	);
	const row = ranRow(state, "c-replay");
	assert.equal(
		row.startedAt,
		expectedStart,
		"the row counts from the call's start, not from either arrival",
	);
});

test("a frame stating nothing still refuses to move a running clock", () => {
	// The existing-value arm, kept honest by the fix: a replayed `_start` with no
	// stamp must not restart a clock that is already counting. Preserved rather
	// than replaced, because a reconnect cursor can replay an older frame shape.
	const started = applyEvent(EMPTY_TRANSCRIPT, startedFrame("c-keep"), ARRIVAL);
	const replayed = applyEvent(
		started,
		{ ...startedFrame("c-keep"), started_at_epoch: undefined },
		ARRIVAL + 9_999,
	);
	assert.equal(
		ranRow(replayed, "c-keep").startedAt,
		expectedStart,
		"the unpainted clock keeps the original start, not the replay's arrival",
	);
});

/* ---------------------------------------------------------------------- *
 * The write/edit diff body.
 *
 * `details = {path, added, removed, diff}` is the producer's own payload
 * (`_diff_details`, tools/builtin.py:4863-4888), and this reducer is the only
 * thing between it and the row that paints it. Two duties: get it off BOTH
 * wire shapes, and never let a later frame take away a diff a row already
 * showed — the live-event budget strips `details` from a later frame when a row
 * exceeds its share, and an absent diff is not a claim that nothing changed.
 * ---------------------------------------------------------------------- */

/** The durable shape, taken verbatim from a real transcript row. */
const REAL_EDIT_DIFF = [
	"--- ",
	"+++ ",
	"@@ -5736,5 +5736,7 @@",
	'             "ambiguous recipient rather than resolved."',
	'-            "running. By default the message lands in the peer\'s mailbox",',
	'+            "running; `lop sessions --all` also lists stored ones, and",',
	'+            "`target` also matches stored sessions by name.",',
	'             "is idle, so an idle peer responds right away.",',
];

test("a write's diff rides the live result onto the row", () => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "tool_execution_start",
			tool_call_id: "c-edit",
			tool_name: "edit",
			args: { path: "notes.md" },
		},
		1,
	);
	// Running: no result yet, so no diff. The row shows its arguments.
	assert.equal(state.records[0].diff, null);
	state = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: "c-edit",
			tool_name: "edit",
			result: {
				content: [{ type: "text", text: "Edited notes.md" }],
				details: {
					path: "notes.md",
					added: 2,
					removed: 1,
					diff: REAL_EDIT_DIFF,
				},
			},
			duration_s: 0.12,
		},
		2,
	);
	const row = state.records.find((r) => r.kind === "tool");
	assert.deepEqual(row.diff, REAL_EDIT_DIFF, "the live body is the payload");
	assert.deepEqual([row.added, row.removed], [2, 1], "counters untouched");
});

test("a durable history row carries its diff, from provider_payload.details", () => {
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			{
				id: "t-edit",
				ts: 2,
				type: "message",
				payload: {
					role: "tool",
					tool_call_id: "c-edit",
					tool_name: "edit",
					content: [{ text: "Edited notes.md", type: "text" }],
					provider_payload: {
						duration_s: 0.12,
						details: {
							path: "notes.md",
							added: 2,
							removed: 1,
							diff: REAL_EDIT_DIFF,
						},
					},
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	const row = state.records.find((r) => r.kind === "tool");
	// The reload half. Without it a conversation read back from disk renders a
	// write as its arguments — the whole new file content — while the same row
	// showed the diff a moment before.
	assert.deepEqual(row.diff, REAL_EDIT_DIFF);
	assert.deepEqual([row.added, row.removed], [2, 1]);
});

test("an unchanged replay is the same state object, diff and all", () => {
	const event = {
		type: "tool_execution_end",
		tool_call_id: "c-edit",
		tool_name: "edit",
		result: {
			content: [{ type: "text", text: "Edited notes.md" }],
			details: { path: "notes.md", added: 2, removed: 1, diff: REAL_EDIT_DIFF },
		},
		duration_s: 0.12,
	};
	const first = applyEvent(EMPTY_TRANSCRIPT, event, 1);
	const before = first.records.find((r) => r.kind === "tool");
	const second = applyEvent(first, event, 2);
	// The callback re-sends the same event on every poll. `shallowEqual` compares
	// by `!==`, so a per-frame array would report the row as changed and re-render
	// it — and its 200-line body — on a surface that repaints per token.
	assert.equal(second, first, "an identical replay is the same state object");
	assert.equal(
		second.records.find((r) => r.kind === "tool").diff,
		before.diff,
		"and the body keeps its reference",
	);
});

test("a replayed frame without details does not erase a diff already shown", () => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "tool_execution_end",
			tool_call_id: "c-edit",
			tool_name: "edit",
			result: {
				content: [{ type: "text", text: "Edited notes.md" }],
				details: {
					path: "notes.md",
					added: 2,
					removed: 1,
					diff: REAL_EDIT_DIFF,
				},
			},
			duration_s: 0.12,
		},
		1,
	);
	const before = state.records.find((r) => r.kind === "tool");
	// The reconnect seed: the backend drops `details` from a live result whose
	// row exceeds its share of the frame (`_bound_live_result_in_place`), so the
	// same call arrives again with the whole payload stripped.
	state = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: "c-edit",
			tool_name: "edit",
			result: { content: [{ type: "text", text: "Edited notes.md" }] },
			duration_s: 0.12,
		},
		2,
	);
	const row = state.records.find((r) => r.kind === "tool");
	assert.equal(row.diff, before.diff, "the body survives by reference");
	// The COUNTERS do not, and that is this frame's pre-existing behaviour rather
	// than something the body introduced: they are read straight from `details`
	// (`diffCounts`), so a frame carrying no `details` reports zero — which the
	// durable row that does carry them restores on the next history read. Pinned
	// here so the asymmetry is visible instead of assumed away.
	assert.deepEqual([row.added, row.removed], [0, 0]);
});

test("a durable row that dropped its diff leaves the live one in place", () => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "tool_execution_end",
			tool_call_id: "c-edit",
			tool_name: "edit",
			result: {
				content: [{ type: "text", text: "Edited notes.md" }],
				details: {
					path: "notes.md",
					added: 2,
					removed: 1,
					diff: REAL_EDIT_DIFF,
				},
			},
			duration_s: 0.12,
		},
		1,
	);
	const live = state.records.find((r) => r.kind === "tool");
	// The durable row of the same call, with no diff in its details — which is
	// exactly what a *changed* diff would look like too, so the rule is about
	// what an absent payload means rather than about which side wins.
	state = applyHistoryPage(state, {
		entries: [
			{
				id: "t-edit",
				ts: 1,
				type: "message",
				payload: {
					role: "tool",
					tool_call_id: "c-edit",
					tool_name: "edit",
					content: [{ text: "Edited notes.md", type: "text" }],
					provider_payload: {
						duration_s: 0.12,
						details: { added: 2, removed: 1 },
					},
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	const rows = state.records.filter((r) => r.kind === "tool");
	assert.equal(rows.length, 1, "the durable row replaces, never duplicates");
	assert.equal(rows[0].diff, live.diff, "still the live array, by reference");
});

test("a replayed page keeps the diff array's identity", () => {
	const page = {
		entries: [
			{
				id: "t-edit",
				ts: 2,
				type: "message",
				payload: {
					role: "tool",
					tool_call_id: "c-edit",
					tool_name: "edit",
					content: [{ text: "Edited notes.md", type: "text" }],
					provider_payload: {
						duration_s: 0.12,
						details: {
							path: "notes.md",
							added: 2,
							removed: 1,
							diff: REAL_EDIT_DIFF,
						},
					},
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	};
	const first = applyHistoryPage(EMPTY_TRANSCRIPT, page);
	const before = first.records.find((r) => r.kind === "tool");
	// The poll replays the same page. `shallowEqual` compares by `!==`, so a
	// freshly built array of identical lines would report the row as changed and
	// re-render it — and its 200-line body — on every delta of a surface that
	// repaints per token.
	const second = applyHistoryPage(first, page);
	const after = second.records.find((r) => r.kind === "tool");
	assert.equal(after.diff, before.diff, "the array is reused, not rebuilt");
});

test("a malformed diff payload degrades to no diff, never to a broken row", () => {
	const durable = (details) => ({
		entries: [
			{
				id: `t-${JSON.stringify(details)}`,
				ts: 1,
				type: "message",
				payload: {
					role: "tool",
					tool_call_id: `c-${JSON.stringify(details)}`,
					tool_name: "write",
					content: [{ text: "ok", type: "text" }],
					provider_payload: { duration_s: 0.1, details },
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	const shapes = [
		// A string payload is TOLERATED at an untyped boundary, and it is not a
		// shape any producer emits: all 9,501 real `details.diff` values found
		// across the 1,166 stored transcripts this machine held on 2026-09-12 (a
		// dated snapshot of a live store) are lists of strings, and the fold this
		// used to credit with joining them copies each key through untouched
		// (mobile/projection.py:284-288).
		[{ added: 1, removed: 1, diff: "+a\n-b" }, ["+a", "-b"], [1, 1]],
		// Members that are not strings are DROPPED, not stringified: `String({})`
		// is "[object Object]", a line no producer ever wrote.
		[{ added: 1, removed: 0, diff: [1, "+a", null, { b: 1 }] }, ["+a"], [1, 0]],
		// All-malformed is the same statement as absent.
		[{ added: 1, removed: 0, diff: [1, 2] }, null, [1, 0]],
		[{ added: 1, removed: 0, diff: [] }, null, [1, 0]],
		[{ added: 1, removed: 0, diff: "" }, null, [1, 0]],
		[{ added: 0, removed: 0 }, null, [0, 0]],
		[{ added: 1, removed: 0, diff: 42 }, null, [1, 0]],
		[null, null, [0, 0]],
	];
	const counts = [];
	for (const [details, expected] of shapes) {
		const state = applyHistoryPage(EMPTY_TRANSCRIPT, durable(details));
		const row = state.records.find((r) => r.kind === "tool");
		assert.deepEqual(
			row.diff,
			expected,
			`${JSON.stringify(details)} -> ${JSON.stringify(expected)}`,
		);
		counts.push([row.added, row.removed]);
	}
	// The counters keep their own contract while the body degrades: a malformed
	// OR absent diff must not take the `+N/-N` pill down with it, and the pill
	// must read the COUNTS rather than the diff's presence or absence. Compared
	// against a literal pair per shape — an assertion that can fail, which the
	// `counts.map((c) => c[0] >= 0)` this replaced could not (a non-negative
	// number by construction, against a freshly built all-true array).
	assert.deepEqual(
		counts,
		shapes.map(([, , pill]) => pill),
	);
});

/*
 * The mid-turn join, which is the reported bug: a viewer that opens a session
 * while a turn is RUNNING is handed a snapshot whose live seed is a list of
 * `tool_execution_end` frames — the owner keeps the settling frame and drops
 * the start it replaces (`frontend_state._fold_live_event`), and the start is
 * the only frame that carries `args`. A row painted from one of those ends had
 * no object column at all, so it fell through to the output's first line, which
 * for `bash` is the literal string `exit code: 0`.
 *
 * Two mechanisms close it, and they are exercised here in the order they
 * matter: recovering the arguments the transcript already knows, then naming
 * (and sizing a page for) the calls only a deeper durable read can label.
 */
test("a settling frame with no arguments keeps the ones the session already learned", () => {
	// The row was painted from the live start, which is the frame that carries
	// the command. The end that replaces it carries none, so the row must keep
	// the ones on the record rather than blanking its own object column.
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "tool_execution_start",
			tool_call_id: "c-bash",
			tool_name: "bash",
			args: { command: "pnpm check-types", i: "Typechecking" },
		},
		1_000,
	);
	state = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: "c-bash",
			tool_name: "bash",
			result: {
				content: [{ type: "text", text: "exit code: 0" }],
				details: {},
			},
			duration_s: 4.2,
		},
		5_200,
	);
	const row = state.records.find((r) => r.kind === "tool");
	assert.equal(row.phase, "done");
	assert.equal(
		row.args.command,
		"pnpm check-types",
		"the object column survives the settling frame",
	);

	// The case the frame-order independence exists for: the row the start
	// painted was DROPPED (a receipt gap, or a replayed snapshot), and the row
	// the seed then paints comes from the settling frame alone. `applyHistoryPage`
	// alone does not heal this one: its backfill only runs when a page TEACHES
	// new arguments, and the map already held them, so the page is a no-op and
	// the row would settle with no object column at all.
	let dropped = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "tool_execution_start",
			tool_call_id: "c-gap",
			tool_name: "bash",
			args: { command: "sed -n '1130,1230p' src/main/update-service.ts" },
		},
		10,
	);
	dropped = dropLiveRecords(dropped);
	assert.equal(dropped.records.length, 0, "the gap dropped the live row");
	const page = {
		entries: [
			{
				id: "a-gap",
				ts: 0,
				type: "message",
				payload: {
					kind: "message",
					role: "assistant",
					content: [],
					tool_calls: [
						{
							id: "c-gap",
							name: "bash",
							arguments: {
								command: "sed -n '1130,1230p' src/main/update-service.ts",
							},
						},
					],
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	};
	const reconciled = applyHistoryPage(dropped, page);
	const reseeded = applyLiveSeed(reconciled, {
		live_events: [
			{
				type: "tool_execution_end",
				tool_call_id: "c-gap",
				tool_name: "bash",
				result: {
					content: [{ type: "text", text: "exit code: 0" }],
					details: {},
				},
				duration_s: 0.9,
			},
		],
	});
	const recreated = reseeded.records.find((r) => r.kind === "tool");
	assert.equal(recreated.phase, "done");
	assert.equal(
		recreated.args.command,
		"sed -n '1130,1230p' src/main/update-service.ts",
		"the settling frame recovers the command the session already learned",
	);
});

test("the seed names the calls nothing in hand can label, and the page is sized for them", () => {
	const seed = [
		{ type: "tool_execution_end", tool_call_id: "c1", tool_name: "bash" },
		{ type: "tool_execution_end", tool_call_id: "c2", tool_name: "bash" },
		{ type: "tool_execution_end", tool_call_id: "c2", tool_name: "bash" },
		{
			type: "tool_execution_start",
			tool_call_id: "c3",
			tool_name: "bash",
			args: {},
		},
	];
	// `c2` is known (a durable page in the same batch, or a live start earlier),
	// so only `c1` justifies reading further back. The running call is never in
	// the list: its own start frame carries its arguments.
	assert.deepEqual(seedCallsMissingLabels(seed, new Set(["c2"])), ["c1"]);
	assert.deepEqual(seedCallsMissingLabels(seed, new Set(["c1", "c2"])), []);
	assert.deepEqual(seedCallsMissingLabels([], new Set()), []);
	assert.deepEqual(seedCallsMissingLabels(undefined, new Set()), []);

	// The ordinary tail when there is no gap, and two entries per named call
	// above it — the seed keeps at most 100 settled calls and the durable
	// transcript spends one assistant row plus one result on each.
	assert.equal(reconcileLimit(0), 100);
	assert.equal(reconcileLimit(1), 102);
	assert.equal(reconcileLimit(50), 200);
	// Clamped to the backend's own ceiling, where asking for more is a 422.
	assert.equal(reconcileLimit(100), 300);
	assert.equal(reconcileLimit(1_000), 500);
});

test("an unlabelable call costs a bounded number of read-backs", () => {
	// The seed names its gap once; close to half of it is labelled by the first
	// read. What is left belongs to the round still running, so the retries are
	// driven by turn ends — and this is the rule that stops that from becoming a
	// poll of the history endpoint for the rest of the conversation.
	const outstanding = new Map([
		["labelled-since", 1],
		["spent", 2],
		["one-left", 1],
		["fresh", 0],
	]);
	const labelled = new Set(["labelled-since"]);
	assert.deepEqual(
		labelGapCandidates(outstanding, outstanding.keys(), labelled, 2),
		["one-left", "fresh"],
		"a labelled call and an exhausted one are both dropped",
	);
	// Nothing outstanding means no request at all, which is the common case on
	// every flush after the gap closes.
	assert.deepEqual(labelGapCandidates(new Map(), [], new Set(), 2), []);
	// And an id that is ALREADY labelled never earns a read even at zero
	// attempts: a durable page may have answered for it before the retry ran.
	assert.deepEqual(
		labelGapCandidates(new Map([["x", 0]]), ["x"], new Set(["x"]), 2),
		[],
	);
	// A later snapshot's seed must not re-admit a call that has spent its
	// budget: the map still holds it, and that is the whole reason the hook
	// keeps an exhausted id instead of deleting it.
	assert.deepEqual(
		labelGapCandidates(new Map([["spent", 2]]), ["spent", "new"], new Set(), 2),
		["new"],
		"an exhausted call cannot be re-admitted by a fresh seed",
	);
	// The seed and the retry path ask the same question about different
	// candidate sets, and a candidate named twice is asked about once.
	assert.deepEqual(
		labelGapCandidates(new Map(), ["a", "a", "b"], new Set(), 2),
		["a", "b"],
	);
});

test("an optimistic echo coalesces with the owner's own row instead of painting twice", () => {
	// The admission request UUID: the renderer sends it as `requestId`, and the
	// owner carries it through `command_id` -> `message_id` -> `Message.user(id=)`
	// -> the durable `TranscriptEntry` id. That identity is the entire reason an
	// echo is safe, so this test asserts it across all three sources of truth.
	const requestId = "b2b1f0d4-0a3a-4b1e-9c1d-7f5a2e6c9a10";
	let state = appendPendingUser(state0(), requestId, "warm the runtime", []);
	assert.equal(state.records.length, 1);
	assert.equal(state.records[0].kind, "user");
	assert.equal(state.records[0].text, "warm the runtime");

	// 1. The live frame for the same turn.
	state = applyEvent(
		state,
		{ type: "message_start", message: user(requestId, "warm the runtime") },
		2,
	);
	assert.equal(
		state.records.length,
		1,
		"message_start replaces the echo in place rather than appending beside it",
	);

	// 2. The durable row, which is what a reconnect or a history page delivers.
	state = applyHistoryPage(state, {
		entries: [
			{
				id: requestId,
				ts: 3,
				type: "message",
				payload: { kind: "message", ...user(requestId, "warm the runtime") },
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	assert.equal(
		state.records.length,
		1,
		"the durable row is the same record, so history cannot duplicate the echo",
	);
	assert.equal(state.records[0].text, "warm the runtime");

	// 3. A second echo for an id already painted must not overwrite reconciled
	// content with the composer's original text.
	const after = appendPendingUser(state, requestId, "different text", []);
	assert.equal(after, state, "re-echoing a painted id is a no-op");

	// A gap drops live records; user rows deliberately survive it, which is what
	// makes leaving an echo painted on an ambiguous failure safe.
	assert.equal(dropLiveRecords(state).records.length, 1);
});

test("removeRecord retracts exactly the echo it names", () => {
	let state = appendPendingUser(state0(), "req-1", "first", []);
	state = appendPendingUser(state, "req-2", "second", []);
	assert.deepEqual(
		removeRecord(state, "req-1").records.map((r) => r.id),
		["req-2"],
	);
	assert.equal(
		removeRecord(state, "absent"),
		state,
		"removing an id that was never painted is a no-op returning the same state",
	);
	// The index must be rebuilt, or a later upsert writes at a stale position.
	const pruned = removeRecord(state, "req-1");
	assert.equal(pruned.index.get("req-2"), 0);
});

/* ------------------------------------------------------- receipt rows */

/*
 * A peer message and a wake delivery are `CustomMessage` rows whose
 * `details.text` is markup addressed to the MODEL — a `<peer-session-message …>`
 * provenance envelope, and `(alarm) Scheduled wake w-9 … — cancel with
 * wake({op:"cancel",id:"w-9"})` — and the generic custom branch paints
 * `details.text`, which is how both reached the screen verbatim.
 *
 * These assert the PROJECTION rather than the row: that the record a page
 * produces carries the human fields and not the envelope, that the live
 * `history_delta` path produces the SAME record as the durable page (they share
 * `durableRecord`, and "they share it" is exactly the assumption worth testing
 * rather than trusting), and that a replayed page does not rebuild a record it
 * already has.
 */

const PEER_ENVELOPE =
	"<peer-session-message from_pid=92064 conversation='review-agent' model='deepseek/deepseek-flash'>\n" +
	"the tool row needs the same treatment\n" +
	"</peer-session-message>";

const PEER_SENDER = {
	pid: 92064,
	conversation_name: "review-agent",
	cwd: "/Users/damian/local-operator-ui",
	session_id: "01J8ZQ4K7XABCDEF",
	model_label: "deepseek/deepseek-flash",
};

const peerMessage = (details) => ({
	id: "p1",
	custom_type: "peer_message",
	attribution: "user",
	details,
});

const pageOf = (entries) => ({
	entries,
	has_more: false,
	cursor_missing: false,
});

const messageEntry = (id, ts, payload) => ({
	id,
	ts,
	type: "message",
	payload,
});

test("a peer message projects to its body and sender, never the envelope", () => {
	const state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf([
			messageEntry("p1", 5, {
				kind: "custom",
				...peerMessage({
					text: PEER_ENVELOPE,
					body: "the tool row needs the same treatment",
					sender: PEER_SENDER,
				}),
			}),
		]),
	);
	const [record] = state.records;
	assert.equal(record.kind, "peer");
	assert.equal(record.body, "the tool row needs the same treatment");
	assert.equal(record.sender.pid, "92064");
	assert.equal(record.sender.conversationName, "review-agent");
	assert.equal(record.sender.cwd, "/Users/damian/local-operator-ui");
	assert.equal(record.sender.sessionId, "01J8ZQ4K7XABCDEF");
	assert.equal(record.sender.modelLabel, "deepseek/deepseek-flash");
	// The rule the whole projection exists for. Asserted over the serialised
	// record so it covers any field a later edit might add.
	assert.ok(
		!JSON.stringify(record).includes("peer-session-message"),
		"the model-facing envelope must not reach the view",
	);
	assert.ok(!JSON.stringify(record).includes("from_pid"), "nor its attributes");
});

test("a peer row that carries only the envelope still names its sender", () => {
	// The fallback path: a row written before `body`/`sender` existed, or by a
	// delivery path that never learned about them. It still has to name the
	// sender and still has to have something to say.
	const state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf([
			messageEntry("p1", 5, {
				kind: "custom",
				...peerMessage({ text: PEER_ENVELOPE }),
			}),
		]),
	);
	const [record] = state.records;
	assert.equal(record.kind, "peer");
	assert.equal(record.body, "the tool row needs the same treatment");
	assert.equal(record.sender.pid, "92064");
	assert.equal(record.sender.conversationName, "review-agent");
	assert.equal(record.sender.modelLabel, "deepseek/deepseek-flash");
	// The two the envelope has no field for stay empty rather than invented.
	assert.equal(record.sender.cwd, "");
	assert.equal(record.sender.sessionId, "");
});

test("a peer row with an empty body is still a row", () => {
	// An empty message is not an invisible record: the row still paints its
	// sender, and the TUI's `can_expand()` returns True unconditionally on the
	// same ground. Whether the DISCLOSURE is offered is a separate question, and
	// `peerHasDetail` answers it false when the expansion would only restate the
	// collapsed row (`{ pid: 42 }` with no body is exactly that case).
	const state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf([
			messageEntry("p1", 5, {
				kind: "custom",
				...peerMessage({
					text: "",
					body: "",
					sender: { pid: 42, session_id: "01J8ZQ4K7X" },
				}),
			}),
		]),
	);
	assert.equal(state.records.length, 1);
	assert.equal(state.records[0].kind, "peer");
	assert.equal(state.records[0].body, "");
	assert.equal(state.records[0].sender.pid, "42");
});

test("the live path and the durable page produce the same receipt", () => {
	const row = peerMessage({
		text: PEER_ENVELOPE,
		body: "the tool row needs the same treatment",
		sender: PEER_SENDER,
	});
	const durable = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf([messageEntry("p1", 5, { kind: "custom", ...row })]),
	);
	const live = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "history_delta", messages: [row] },
		5000,
	);
	assert.deepEqual(live.records, durable.records);

	// And a replayed page that teaches nothing new returns the SAME state object,
	// which is only true if the sender object is reused: the equality gate
	// compares fields by reference, and a freshly built sender would report this
	// row as changed on every reconnect (the bargain `extractImages` strikes).
	const again = applyHistoryPage(
		durable,
		pageOf([messageEntry("p1", 5, { kind: "custom", ...row })]),
	);
	assert.equal(again, durable);
});

test("a wake delivery is a receipt, and the catch-up is not one", () => {
	const delivery =
		'(alarm) Scheduled wake w-9 (1, every 6h) — cancel with wake({op:"cancel",id:"w-9"})\n\ncheck the deploy';
	let state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf([
			messageEntry("w1", 5, {
				kind: "custom",
				custom_type: "wake_prompt",
				attribution: "user",
				details: { wake_id: "w-9", occurrence: 1, text: delivery },
			}),
		]),
	);
	assert.equal(state.records.length, 1);
	assert.equal(state.records[0].kind, "wake");
	// The record holds what ARRIVED: the headline and the prompt are derived at
	// paint time by the pure receipt model, so the state carries no rendering of
	// its own.
	assert.equal(state.records[0].text, delivery);

	// The resume catch-up is not a receipt. It is user-attributed, and both
	// shipping surfaces skip it on replay for that reason — replaying it "would
	// put a raw '(alarm) The session resumed…' line in the transcript as if the
	// user had typed it" — so a receipt row must not be minted from it either.
	state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf([
			messageEntry("w2", 5, {
				kind: "custom",
				custom_type: "wake_prompt",
				attribution: "user",
				details: {
					wake_catchup: true,
					text: "(alarm) The session resumed after being closed; the following scheduled wake(s) came due while it was down.\n\n- w1 (due 12:00): missed while the session was down.",
				},
			}),
		]),
	);
	assert.equal(state.records.length, 0);

	// A wake row with no text at all is nothing to show, so it stays dropped —
	// the generic custom branch's own rule.
	state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf([
			messageEntry("w3", 5, {
				kind: "custom",
				custom_type: "wake_prompt",
				details: { wake_id: "w-3", text: "   " },
			}),
		]),
	);
	assert.equal(state.records.length, 0);
});

test("the new kinds do not change how other custom rows project", () => {
	// The regression guard for the branch this change inserted in front of: a
	// custom row that is neither a peer nor a wake still paints `details.text`,
	// and the two kinds that were already silent stay silent.
	const state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf([
			messageEntry("c1", 5, {
				kind: "custom",
				custom_type: "subagent_progress",
				attribution: "agent",
				details: { text: "the reviewer started" },
			}),
			messageEntry("c2", 6, {
				kind: "custom",
				custom_type: "hub_communication",
				attribution: "agent",
				details: { text: "parent words" },
			}),
			messageEntry("c3", 7, {
				kind: "custom",
				custom_type: "peer_message_summary",
				attribution: "system",
				details: { text: "1 peer message, 40 bytes" },
			}),
		]),
	);
	assert.deepEqual(
		state.records.map((record) => [
			record.id,
			record.kind,
			record.text ?? record.customType,
		]),
		[
			["c1", "custom", "the reviewer started"],
			["c3", "custom", "1 peer message, 40 bytes"],
		],
	);
});
// ---------------------------------------------------------------------------
// Custom rows: the harness's own statements in the conversation.
//
// The operator's report was that an error row read only `session incident` and
// the message that explained it was behind the chevron — 946 of his own rows,
// i.e. the normal shape rather than an edge case. The row is now a projection of
// the RECORD, so these tests pin the record: the level, the label, the message
// and what is left for the disclosure.
// ---------------------------------------------------------------------------

/** A persisted `session_incident` row, exactly as the store writes one. */
const incident = (id, { text, raw, token, ...rest }) => ({
	id,
	ts: 1_789_000_000,
	type: "message",
	payload: {
		kind: "custom",
		custom_type: "session_incident",
		details: {
			text,
			...(raw === undefined ? {} : { raw }),
			...(token ? { token } : {}),
		},
		...rest,
	},
});

const custom = (id, custom_type, details) => ({
	id,
	ts: 1_789_000_000,
	type: "message",
	payload: { kind: "custom", custom_type, details },
});

const replay = (entries) =>
	applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries,
		has_more: false,
		cursor_missing: false,
	}).records;

/** The mcp row from session `32cc6288b38f`, quoted from the store. */
const MCP_ROW = incident("801c032e12604b478ab44b3bedcbd503", {
	text: "[session incident (openrouter/deepseek/deepseek-v4.1-flash)] mcp: MCP server 'notion': MCP authorization failed; run /mcp reauth notion — authorization expired\nsuggested action: An MCP server is unavailable: its tools are gone until it reconnects. Do not call its tools in a tight loop; say which server is down.\nThis is why the previous turn ended. Take it into account before repeating the same request.",
	raw: "MCP server 'notion': MCP authorization failed; run /mcp reauth notion — authorization expired",
});

test("an incident row is an error row whose message is inline, not its type name", () => {
	const [row] = replay([MCP_ROW]);
	assert.equal(row.kind, "custom");
	assert.equal(row.customType, "session_incident");
	// The tier, which the view used to pin to `info` for every custom row.
	assert.equal(row.level, "error", "an incident is a failure, not information");
	// The label: what KIND of failure, so the row scans.
	assert.equal(row.category, "mcp");
	// The message: the vendor's own error, in place. The regression is that this
	// was the literal string `session incident`.
	assert.equal(
		row.headline,
		"MCP server 'notion': MCP authorization failed; run /mcp reauth notion — authorization expired",
	);
	assert.notEqual(row.headline, "session incident");
	// The supporting half — the harness's advice and its tail sentence — is what
	// the disclosure is for now, rather than the whole message.
	assert.match(row.detail, /^suggested action: An MCP server is unavailable/);
	assert.match(
		row.detail,
		/This is why the previous turn ended\. Take it into account before repeating the same request\.$/,
	);
});

test("the message is `details.raw`, not the head line the renderer built from it", () => {
	// The producer truncates the head at 500 characters and keeps the
	// untruncated original in `raw`; the row must paint the original.
	const long = "x".repeat(700);
	const [row] = replay([
		incident("truncated", {
			text: `[session incident (p/m)] provider: ${long.slice(0, 500)}`,
			raw: long,
		}),
	]);
	assert.equal(row.headline, long, "the untruncated raw is the message");
});

test("the category is read off the head, and a `raw`-less row falls back to it", () => {
	// Every row in the store carries a `raw`; a row persisted without one still
	// has to say what happened, so the head line's remainder is the message.
	const [older] = replay([
		incident("older", {
			text: "[session incident] cut-off: the runtime was terminated while this turn was running\nThis is why the previous turn ended.",
		}),
	]);
	assert.equal(older.level, "error");
	assert.equal(older.category, "cut-off");
	assert.equal(
		older.headline,
		"the runtime was terminated while this turn was running",
	);
	assert.equal(older.detail, "This is why the previous turn ended.");

	// A payload that is not a rendered incident is not given a category, and its
	// own first line is the message rather than nothing at all.
	const [opaque] = replay([
		incident("opaque", { text: "something the classifier never rendered" }),
	]);
	assert.equal(opaque.category, null);
	assert.equal(opaque.headline, "something the classifier never rendered");
	assert.equal(opaque.detail, null, "nothing to disclose is a static row");
});

test("a harness statement paints its fact, and puts its instruction to the model behind the disclosure", () => {
	// Both halves measured over the store: all 231 real model-switch rows carry
	// the agent-directed tail in the same string, so painting the text whole put
	// a 3-4 line instruction block in a one-line ledger.
	const rows = replay([
		custom("switch", "session_model_switch", {
			text: "[model switch] You are now running as openrouter/deepseek/deepseek-v4.1-flash (was anthropic/claude-opus-5).\nThis applies from now on. Capabilities, context window, and tone may differ from the previous model; act as the model you now are.",
		}),
		custom("recovery", "session_mcp_recovery", {
			text: "[mcp recovery] MCP server 'gitlab' is connected again and 12 tools are available again. This supersedes the earlier session incident about this server: its tools are usable now, so call them normally and stop reporting it as unavailable.",
		}),
		custom("credential", "session_credential", {
			text: "[session credential] DEPLOY_KEY was just stored by the operator. Its value is held in session memory and injected as the environment variable $DEPLOY_KEY into every bash command — use it there (a child process reads it), never echo, print, or write it.",
		}),
	]);
	for (const row of rows) {
		assert.equal(row.level, "info", `${row.customType} is not a failure`);
		assert.notEqual(row.headline, row.customType.replace(/_/g, " "));
		// The bracket repeats the row's own label, so the headline starts at the
		// sentence: "session model switch: You are now running as …".
		assert.ok(
			!row.headline.includes("This applies from now on"),
			`${row.customType}: the instruction to the model is not the headline`,
		);
		assert.match(row.detail, /^(This applies|This supersedes|Its value)/);
	}
	assert.equal(
		rows[0].headline,
		"You are now running as openrouter/deepseek/deepseek-v4.1-flash (was anthropic/claude-opus-5).",
	);
	assert.equal(
		rows[1].headline,
		"MCP server 'gitlab' is connected again and 12 tools are available again.",
	);
	assert.equal(rows[2].headline, "DEPLOY_KEY was just stored by the operator.");
	// The tokeniser is a version, not a sentence end: `deepseek-v4.1-flash` must
	// not split the headline in half.
	assert.ok(rows[0].headline.includes("deepseek-v4.1-flash (was"));
});

test("a relayed payload keeps its body behind the disclosure but is not reduced to its type name", () => {
	// Measured over the operator's store, these run to 18,259 characters, so the
	// body stays one click away — and the first line that says something is on
	// the row, stepping over the envelope tag both relays open with.
	const body =
		"<parent-message>\nThis is a note, not a question.\n\nCorrection: rebase onto the current origin/main.";
	const [row] = replay([custom("hub", "hub_message", { text: body })]);
	assert.equal(row.level, "info");
	assert.equal(
		row.headline,
		"This is a note, not a question.",
		"the envelope tag is not the headline",
	);
	assert.equal(row.detail, body, "the whole body is what the disclosure holds");
});

test("a long headline is bounded and cut on a word, so the column cannot be pushed out", () => {
	const sentence = "word ".repeat(80).trim();
	const [row] = replay([custom("long", "job_result", { text: sentence })]);
	assert.ok(row.headline.length <= 161, `headline was ${row.headline.length}`);
	assert.ok(row.headline.endsWith("…"));
	assert.ok(
		!row.headline.includes("wor…"),
		"cut on a word boundary, not mid-word",
	);
	assert.equal(row.detail, sentence, "the payload itself is untouched");
});

test("an incident row that has said everything it has to say is a static line", () => {
	// The classifier's hint is optional, so a category can arrive with no
	// `suggested action` and no tail. `detail: null` is what makes the row a
	// static line rather than a trigger that reveals nothing.
	const [row] = replay([
		incident("bare", {
			text: "[session incident (p/m)] unknown: [Errno 28]",
			raw: "[Errno 28]",
		}),
	]);
	assert.equal(row.level, "error");
	assert.equal(row.category, "unknown");
	assert.equal(row.headline, "[Errno 28]");
	assert.equal(row.detail, null);
});

test("a relayed payload's headline steps over both instruction lines the channel prepends", () => {
	// Measured over the store: 411 hub rows open with the `note` line verbatim,
	// so quoting it inline made every one of those rows read the same while the
	// parent's actual words stayed behind the chevron. All three lines come from
	// `harness/comms.py::TO_CHILD_INSTRUCTIONS`.
	const instructions = [
		"This is a note, not a question. No reply is needed unless it changes what you should do.",
		"This changes your instructions. Apply it from now on, and drop work it makes pointless.",
		"Answer it now with the `hub` tool — a short, direct reply — then carry on with what you were doing. Do not restructure your work around the question.",
	];
	const rows = replay(
		instructions.map((instruction, index) =>
			custom(`hub-${index}`, "hub_message", {
				text: `<parent-message>\n${instruction}\n\nWhat the parent actually said ${index}.\n</parent-message>`,
			}),
		),
	);
	for (const [index, row] of rows.entries()) {
		assert.equal(row.headline, `What the parent actually said ${index}.`);
		// The instruction is not lost: it is the first thing the reader meets
		// once the row is open, and the label already says the row is a relay.
		assert.ok(row.detail.includes(instructions[index]));
	}
});

test("an empty relay paints its envelope rather than its closing tag", () => {
	// 34 real rows in the store are this shape: the description line is empty.
	const [row] = replay([
		custom("empty", "hub_message", {
			text: "<subagent-message label='rollover-template-fix' job='5fb25794e06c'>\n\n</subagent-message>",
		}),
	]);
	assert.equal(
		row.headline,
		"<subagent-message label='rollover-template-fix' job='5fb25794e06c'>",
	);
	assert.ok(!row.headline.startsWith("</"));
	assert.equal(
		row.headline.includes("subagent-message"),
		true,
		"the row still names the relay",
	);
});

test("an incident carries the provider it names, and a row with nothing to say is not painted", () => {
	const [row] = replay([
		incident("with-provider", {
			text: "[session incident (anthropic/claude-opus-5)] rate-limit: rate limit or quota exceeded\nsuggested action: Back off.\nThis is why the previous turn ended.",
			raw: "rate limit or quota exceeded",
		}),
	]);
	// The harness's own advice for a rate limit is "tell the user which provider
	// hit the limit", so the row has to carry it.
	assert.equal(row.provider, "anthropic/claude-opus-5");
	// A no-provider incident says so by omission rather than by an empty string.
	const state = replay([
		incident("no-provider", {
			text: "[session incident] cut-off: the runtime stopped\nThis is why the previous turn ended.",
			raw: "the runtime stopped",
		}),
	]);
	assert.equal(state[0].provider, null);

	// A whitespace-only body is not a row: painting it would produce the empty
	// headline the operator reported (a row that states nothing). No producer
	// emits one; the gate is here so none can.
	for (const blank of ["   ", " \n \n "]) {
		assert.equal(
			replay([custom("blank", "hub_message", { text: blank })]).length,
			0,
		);
	}
});

test("a statement splits at the sentence end, not at an abbreviation or a list marker", () => {
	// Round 2's R7: the bare "terminator followed by whitespace" rule split real
	// text in half. Each case here is one the reviewer measured through the
	// shipped reducer.
	const cases = [
		[
			"You are now running as gpt-6 (approx. 200k ctx).",
			"This applies from now on.",
		],
		[
			"You are now running as gpt-6, e.g. the fast tier.",
			"This applies from now on.",
		],
		["1. You are now running as gpt-6.", "This applies."],
	];
	for (const [fact, instruction] of cases) {
		const [row] = replay([
			custom("s", "session_model_switch", {
				text: `[model switch] ${fact} ${instruction}`,
			}),
		]);
		assert.equal(row.headline, fact);
		assert.equal(row.detail, instruction);
	}
	// And the shapes that must keep splitting exactly as they did: a decimal, a
	// version, a URL with a dotted version in it, and a question.
	for (const [fact, instruction] of [
		["Running at 0.5 units.", "This applies."],
		[
			"You are now running as deepseek/deepseek-v4.1-flash (was x).",
			"This applies.",
		],
		["POST http://1.2.3.4:8000/v2.0 now.", "This applies."],
		["Are you ready?", "This applies."],
	]) {
		const [row] = replay([
			custom("s", "session_model_switch", {
				text: `[model switch] ${fact} ${instruction}`,
			}),
		]);
		assert.equal(row.headline, fact);
	}
});

test("a relayed payload keeps its own words, a quoted wake-arming clause included", () => {
	// Round 2's R9 scoped the wake-arming strip to a wake row so it could not edit
	// a hub message that quoted the phrase. Round 7's R33 deleted the strip
	// outright, because a wake row is upstream's receipt now and nothing this path
	// paints is a wake's own words — so this pins the property the scoping existed
	// for, which is the stronger one: the payload's words survive and the
	// channel's manners above them do not.
	const [hub] = replay([
		custom("h", "hub_message", {
			text: '<parent-message>\nThis is a note, not a question. No reply is needed unless it changes what you should do.\n\nWe cancelled w1 — cancel with wake({op:"cancel",id:"w1"}) once its goal is met.\n</parent-message>',
		}),
	]);
	assert.ok(hub.headline.includes("cancel with wake("));
	assert.ok(!hub.headline.startsWith("This is a note"));
});

test("a relayed row whose headline is its whole payload discloses nothing", () => {
	// U16: once a heading is joined to its outcome, a two-line body IS the
	// headline, and a chevron that reveals the same two lines promises material
	// it does not add. Same rule the notice register needed (U14).
	const [job] = replay([
		custom("j", "job_result", {
			text: "background job 'design849' failed:\n[Errno 28] No space left on device",
		}),
	]);
	assert.equal(
		job.headline,
		"background job 'design849' failed: [Errno 28] No space left on device",
	);
	assert.equal(job.detail, null, "nothing left to disclose");

	// A payload with more to say still keeps its body behind the disclosure.
	const [long] = replay([
		custom("j2", "job_result", {
			text: "background job 'design849' failed:\n[Errno 28] No space left on device\nRetry once the volume is clear.",
		}),
	]);
	assert.ok(long.detail?.includes("Retry once the volume is clear."));
});

test("a page row that ties with a painted row is painted after it", () => {
	// The tie-break the shared rule documents, and the reason extracting
	// `withTimeOrder` is a deliberate one-case behaviour change rather than a pure
	// refactor: the comparator `applyHistoryPage` used to carry read the painted
	// position from `base.records` and fell back to the INCOMING page's position,
	// so for an exact-millisecond tie it compared two different index spaces and
	// could sort the arriving row ABOVE the row already on screen — the opposite
	// of what that sort's own comment promised. On that comparator this sequence
	// produced `a1,a2,b1,a3`; the rule both paths now share produces
	// `a1,a2,a3,b1`.
	const painted = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf([
			messageEntry("a1", 1, assistant("a1", "one")),
			messageEntry("a2", 2, assistant("a2", "two")),
			messageEntry("a3", 3, assistant("a3", "three")),
		]),
	);
	const merged = applyHistoryPage(
		painted,
		pageOf([messageEntry("b1", 3, assistant("b1", "tie"))]),
	);
	assert.deepEqual(
		merged.records.map((record) => record.id),
		["a1", "a2", "a3", "b1"],
		"a painted row is not displaced by an arriving page row at its own instant",
	);
});

test("an anchor of epoch 0 is no anchor, so a settling frame is refused whatever the turn is doing", () => {
	// `applyHistoryPage` anchors a call at the instant of the entry that named it,
	// so an entry whose `ts` is missing or zero would anchor every call it names
	// at EPOCH 0 — a fabricated time rather than a weak one, which `withTimeOrder`
	// would sort to the HEAD of the conversation the moment a settling frame
	// painted it. The guard is `epochMs`' own: a non-positive epoch is not a
	// timestamp, so this falls back to the rule a call nothing states gets.
	const undated = pageOf([
		{
			id: "a0",
			ts: 0,
			type: "message",
			payload: {
				...assistant("a0", "undated"),
				tool_calls: [{ id: "callZ", name: "read", arguments: { path: "a" } }],
			},
		},
		messageEntry("later", 1900, assistant("later", "later")),
	]);
	const settled = {
		type: "tool_execution_end",
		tool_call_id: "callZ",
		tool_name: "read",
		result: { output: "x" },
	};

	// The turn is over, so the row is refused: nothing claims 1970, and the
	// conversation still ends where its own last row put it.
	const refused = applyLiveSeed(
		applyHistoryPage(EMPTY_TRANSCRIPT, undated),
		{ streaming: false, generation: "1", live_events: [settled] },
		2_000_000,
	);
	assert.deepEqual(
		refused.records.map((record) => record.id),
		["a0", "later"],
	);

	// The turn is still running, and the frame is refused all the same: a settled
	// call's position belongs to the durable record, and the in-flight exemption is
	// a claim about WORK rather than about time — nothing is live about a call that
	// has ended. Painted here it would claim the reader's own clock for work that
	// no source dated, which is the row that used to appear after the turn's tail.
	const inFlight = applyLiveSeed(
		applyHistoryPage(EMPTY_TRANSCRIPT, undated),
		{ streaming: true, generation: "1", live_events: [settled] },
		2_000_000,
	);
	assert.deepEqual(
		inFlight.records.map((record) => record.id),
		["a0", "later"],
	);
});

test("a history_delta that states reset replaces the viewport it cannot extend", () => {
	// Two of the three producers send the WHOLE history with `reset=True`
	// (`HistoryDeltaEvent.reset`: "a replay-changing generation cannot be appended
	// to the old viewport"), and merging those rows as a page painted the full
	// transcript at the reader's arrival second AFTER everything already on
	// screen. The genuine reconnect gap leaves `reset` false and still merges,
	// where the arrival stamp is the gap's own time rather than hours of history
	// mistaken for it.
	const painted = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf([messageEntry("old", 1, assistant("old", "old"))]),
	);
	const replaced = applyEvent(
		painted,
		{
			type: "history_delta",
			reset: true,
			messages: [assistant("r1", "replayed")],
		},
		// The arrival clock is ms while the reconstructed page's `ts` is in
		// seconds (`now / 1000`), which is the unit the page contract states.
		5_000,
	);
	assert.deepEqual(
		replaced.records.map((record) => record.id),
		["r1"],
		"the replayed rows stand alone rather than under what was painted",
	);
	const merged = applyEvent(
		painted,
		{ type: "history_delta", messages: [assistant("g1", "gap")] },
		5_000,
	);
	assert.deepEqual(
		merged.records.map((record) => record.id),
		["old", "g1"],
	);
});

test("a compaction pass is claimed from its start and retired by every stop", () => {
	/*
	 * The working line's `compacting context` rung reads exactly one thing, and
	 * it is this flag. It is a TRANSCRIPT fact rather than a latch, so the four
	 * ways a pass can stop are asserted here, where they are decided — a rung
	 * that outlives its pass claims work nobody is doing, which is the defect
	 * class the whole change this tests belongs to.
	 */
	let state = EMPTY_TRANSCRIPT;
	assert.equal(state.compacting, false, "an empty transcript claims nothing");

	// 1. A pass in flight, and a replay of the same start is idempotent.
	state = applyEvent(state, { type: "compaction_start" });
	assert.equal(state.compacting, true);
	const replayed = applyEvent(state, { type: "compaction_start" });
	assert.equal(replayed.compacting, true);
	assert.equal(replayed, state, "a replayed start returns the same state");

	// 2. A success settles it and paints the existing info line.
	const settled = applyEvent(state, {
		type: "compaction_end",
		success: true,
		tokens_before: 41_000,
		tokens_after: 9_000,
	});
	assert.equal(settled.compacting, false);
	const record = settled.records.at(-1);
	assert.equal(record.kind, "compaction");
	assert.equal(
		record.text,
		"Context compacted, 41.0k to 9.0k tokens",
		"the settled line is the LIVE sentence, figures included",
	);

	// 3. A failure and a refusal stop it too: the pass is over either way, so the
	// rung must not stand over the row that says it did not run.
	const failed = applyEvent(
		applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }),
		{ type: "compaction_end", success: false, detail: "nothing to compact" },
	);
	assert.equal(failed.compacting, false);
	assert.equal(
		failed.records.at(-1).text,
		"Compaction did not run: nothing to compact",
	);

	/*
	 * 4. A REPLAYED end whose record is already painted still retires the claim.
	 * This is the reconnect order rather than a hypothetical: the transcript is
	 * re-seeded from a snapshot whose compacted row is already in it, and the
	 * end frame then arrives again. An early return on the idempotence guard
	 * would leave the rung standing over a finished pass forever.
	 */
	const once = applyEvent(
		applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }),
		{
			type: "compaction_end",
			success: true,
			tokens_before: 1_000,
			tokens_after: 900,
		},
	);
	const again = applyEvent(once, {
		type: "compaction_end",
		success: true,
		tokens_before: 1_000,
		tokens_after: 900,
	});
	assert.equal(again.compacting, false);
	assert.equal(
		again.records.length,
		once.records.length,
		"the row is not doubled",
	);

	// 5. A NEW TURN stops it: a session running a pass is not starting a turn, so
	// a turn starting means the claim was never retired.
	const newTurn = applyEvent(
		applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }),
		{ type: "agent_start", generation: 4 },
	);
	assert.equal(newTurn.compacting, false);
	assert.equal(newTurn.generation, 4);

	/*
	 * 6. A LIVE SEED does not carry the claim on its own — the seed's `live_events`
	 * window is a mechanism this case drives directly. The SECOND half below seeds
	 * a `compaction_start` by hand and gets the claim back, which pins
	 * `applyLiveSeed`'s mechanics; it is NOT a promise about reconnects, because
	 * the backend does not put a `compaction_start` in the seed at all
	 * (`frontend_state.py::_fold_live_event` folds agent/message/tool kinds only —
	 * round 1, R4 — which is what `dropLiveRecords`' own docstring now says).
	 */
	const seeded = applyLiveSeed(
		applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }),
		{ streaming: false, generation: 0, live_events: [] },
	);
	assert.equal(seeded.compacting, false);
	const reseeded = applyLiveSeed(EMPTY_TRANSCRIPT, {
		streaming: false,
		generation: 0,
		live_events: [{ type: "compaction_start" }],
	});
	assert.equal(reseeded.compacting, true);

	// 7. A receipt GAP drops it, on the same terms `dropLiveRecords` drops the
	// other live-only claims — and nothing puts it back: since the seed carries no
	// `compaction_start` (R4), this is permanent for the pass, so the rung stays
	// down while the pass runs on. Guessing is what a gap forbids.
	const afterGap = dropLiveRecords(
		applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }),
	);
	assert.equal(afterGap.compacting, false);

	// 8. A VIEW clear keeps it: `/clear` empties the painted transcript and does
	// not stop a backend pass.
	const cleared = applyEvent(EMPTY_TRANSCRIPT, {
		type: "message_start",
		message: user("u1", "hi"),
	});
	assert.equal(
		clearTranscript(applyEvent(cleared, { type: "compaction_start" }))
			.compacting,
		true,
	);
});

test("a refused pass paints the runtime's own row, in the tier it derives", () => {
	/*
	 * U1 (UX round 1) = Q2 (QA round 1): a manual `/compact` on a conversation
	 * with nothing to compact painted NOTHING. The refusal emits no
	 * `compaction_start` — the runtime answers the routed command with an
	 * optimistic receipt and the pass declines before the start event — so the
	 * durable `compaction_refused` row is the only record, and it was listed as
	 * bookkeeping. With the dialog gone, that silence was the surface the dialog
	 * used to occupy.
	 */
	/*
	 * The claim's start is stamped (`compactingSince`), so a realistic row is one
	 * written AFTER the pass began: this pins the retirement rule rather than
	 * exploiting a fixed epoch. `NOW` is passed explicitly so the case does not
	 * depend on the wall clock it runs at.
	 */
	const NOW = 1_700_000_000_000;
	const refused = (detail, ts = NOW / 1000 + 2) =>
		applyHistoryPage(
			applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }, NOW),
			pageOf([
				messageEntry("m1", ts, {
					kind: "custom",
					custom_type: "compaction_refused",
					details: { detail },
				}),
			]),
		);
	const decline = refused(
		"nothing to compact: the whole conversation is ~8 tokens and the most recent 20,000 are kept verbatim",
	);
	const row = decline.records.at(-1);
	assert.equal(row.kind, "notice");
	assert.equal(row.id, "m1");
	assert.equal(
		row.text,
		"Compaction did not run — nothing to compact: the whole conversation is ~8 tokens and the most recent 20,000 are kept verbatim",
	);
	assert.equal(
		row.level,
		"warning",
		"a DECLINE is the backend's warning tier, not this file's choice",
	);
	assert.equal(
		decline.compacting,
		false,
		"the row is the pass saying it is over",
	);

	/*
	 * And the other half of the same rule: a FAILED pass is the system saying it
	 * could not, which the runtime's shared helper inks differently from a
	 * decline, so a reader can tell "not worth it" from "I tried and broke".
	 */
	const failure = refused("compaction failed: provider unreachable");
	assert.equal(failure.records.at(-1).level, "error");
});

test("the settled line prints the live figures, and a cold row prints the bare sentence", () => {
	/*
	 * The pair of facts this rule is: the live sentence carries the counts and is
	 * the one the pairing puts on the durable row, and a reader that never saw the
	 * live line gets the bare sentence instead. That asymmetry is LIVE-ONLY BY
	 * NATURE rather than a defect — the durable entry carries `tokens_before` and
	 * no after-figure (`Transcript.append_compaction`) — and it is the same shape
	 * the terminal host has (its receipt carries the figures, its replay is the
	 * bare marker). UX round 1's U4 is kept: the pair is printed only when the two
	 * figures differ, because `52.7k to 52.7k` reads as "changed nothing".
	 */
	const settled = (before, after) =>
		applyEvent(applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }), {
			type: "compaction_end",
			success: true,
			tokens_before: before,
			tokens_after: after,
		}).records.at(-1);
	assert.equal(
		settled(41_000, 9_000).text,
		"Context compacted, 41.0k to 9.0k tokens",
	);
	assert.equal(
		settled(52_700, 52_700).text,
		"Context compacted to 52.7k tokens",
	);
	// A pass that reports no figures at all cannot print a pair.
	assert.equal(
		applyEvent(applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }), {
			type: "compaction_end",
			success: true,
		}).records.at(-1).text,
		"Context compacted",
	);

	// The COLD row: no live sentence to pair with, so the bare sentence.
	const cold = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf([
			{ id: "msg_cold", ts: 1_700_000_001, type: "compaction", payload: {} },
		]),
	);
	assert.equal(cold.records[0].text, "Context compacted");

	// The failed end is a notice so it can carry the tier; the compaction record
	// has no ink of its own and read in the success line's tone (design D2).
	const failed = applyEvent(
		applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }),
		{ type: "compaction_end", success: false, detail: "compaction failed: x" },
	).records.at(-1);
	assert.equal(failed.level, "error");
});

test("a replayed outcome cannot retire a claim made after the pass it carries", () => {
	/*
	 * The retirement U1's fix needed is keyed on NEW ids: a history refresh that
	 * replays an already-painted outcome must not take down a pass that started
	 * since, which is the "a page is not a signal about the present" rule the
	 * transcript's other merges follow.
	 */
	const entry = messageEntry("m1", 10, {
		kind: "custom",
		custom_type: "compaction_refused",
		details: { detail: "nothing to compact" },
	});
	const once = applyHistoryPage(EMPTY_TRANSCRIPT, pageOf([entry]));
	assert.equal(once.records.length, 1);
	const running = applyEvent(once, { type: "compaction_start" });
	assert.equal(running.compacting, true);
	const replayed = applyHistoryPage(running, pageOf([entry]));
	assert.equal(
		replayed.compacting,
		true,
		"the outcome is already painted, so it retires nothing",
	);
});

test("an outcome older than the pass does not retire it", () => {
	/*
	 * Review round 2, NEW-1. The retirement used to ask "has this reader painted
	 * this entry", which is a fact about the INDEX: `load older` merges a page of
	 * history this reader has never seen, and any compaction outcome on it flipped
	 * the claim off mid-pass — silencing the rung and the composer's hint
	 * together, which is the "appears to do nothing" state this change exists to
	 * remove. The rule is now the pass's own start (`compactingSince`): an outcome
	 * older than the claim belongs to an earlier pass.
	 */
	const NOW = 1_700_000_000_000;
	const OLD = NOW / 1000 - 600; // ten minutes before the claim
	const running = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "compaction_start" },
		NOW,
	);
	assert.equal(running.compacting, true);
	assert.equal(running.compactingSince, NOW);

	// A previous pass's settled row, arriving on an older page nobody has loaded.
	const older = applyHistoryPage(
		running,
		pageOf([
			{ id: "msg_old_compaction", ts: OLD, type: "compaction", payload: {} },
		]),
	);
	assert.equal(
		older.compacting,
		true,
		"an old page's outcome is not this pass's outcome",
	);
	assert.equal(older.records.length, 1, "and it still paints its row");

	// The same page's refusal: same old timestamp, same answer.
	const olderRefusal = applyHistoryPage(
		running,
		pageOf([
			messageEntry("msg_old_refusal", OLD, {
				kind: "custom",
				custom_type: "compaction_refused",
				details: { detail: "nothing to compact" },
			}),
		]),
	);
	assert.equal(olderRefusal.compacting, true);

	// And this pass's OWN outcome still retires it, which is what U1 needed.
	const own = applyHistoryPage(
		running,
		pageOf([
			messageEntry("msg_own", NOW / 1000 + 1, {
				kind: "custom",
				custom_type: "compaction_refused",
				details: { detail: "nothing to compact" },
			}),
		]),
	);
	assert.equal(own.compacting, false);
	assert.equal(own.compactingSince, 0);
});

test("a history re-read does not double a settled pass", () => {
	/*
	 * UX round 2, U7: the live end painted a notice keyed by generation carrying
	 * the figures, and the durable row every later read brings back was keyed by
	 * its own entry id and said the same thing WITHOUT them, so neither retired
	 * the other — a switch away and back showed one pass as two lines.
	 */
	const NOW = 1_700_000_000_000;
	const live = applyEvent(
		applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }, NOW),
		{
			type: "compaction_end",
			success: true,
			tokens_before: 1_800,
			tokens_after: 1_800,
		},
		NOW + 400,
	);
	assert.equal(live.records.length, 1);
	assert.equal(live.records[0].text, "Context compacted to 1.8k tokens");

	const after = applyHistoryPage(
		live,
		pageOf([
			{
				id: "msg_durable_compaction",
				// The wire's ordering (QA round 4's Q11, R5-4): the row is appended,
				// then the settle frame is processed ~300 ms later. This one carries no
				// fingerprint, which is why it is the fallback's case at all.
				ts: (NOW + 100) / 1000,
				type: "compaction",
				payload: {},
			},
		]),
	);
	const rows = after.records.filter(
		(row) => row.kind === "compaction" || row.kind === "notice",
	);
	assert.equal(rows.length, 1, "one pass, one row");
	assert.equal(
		rows[0].id,
		"msg_durable_compaction",
		"the durable id survives, because it is what the next read matches",
	);
	assert.equal(
		rows[0].text,
		"Context compacted to 1.8k tokens",
		"and it keeps the live sentence, figures included",
	);
});

test("a tail read never answers the paging question, and never repaints a cleared view", () => {
	/*
	 * R4-2 — the `keepPaging` half of the tail read was pinned by a source regex
	 * and nothing else, so neutering the branch kept the suite green. Driven here
	 * instead: a page whose own `has_more` says "there is more behind me" must not
	 * put the affordance back on a transcript that already held everything (round
	 * 3, R3-5), and the mentioned-files scan's paging must not resume.
	 *
	 * U17 — and the same read must not repaint a view the user cleared. `/clear` is
	 * view-only by contract, so the page's other rows would restore exactly what it
	 * removed: UX round 4 measured `/compact` → `/clear` → `/compact` putting the
	 * conversation back. The tail read exists for the pass's OWN row, which is what
	 * a cleared view is answered with.
	 */
	const rows = (state) => state.records.map((record) => record.kind);
	const at = 1_700_000_000_000;
	const page = {
		...pageOf([
			{
				id: "u1",
				ts: at / 1000,
				type: "message",
				payload: { role: "user", content: "hi" },
			},
			{
				id: "d1",
				ts: (at + 100) / 1000,
				type: "compaction",
				payload: { tokens_before: 41_000 },
			},
		]),
		// The page's own claim, which a tail read must not believe.
		has_more: true,
	};
	assert.equal(
		page.has_more,
		true,
		"the fixture page claims there is more behind it",
	);

	const loaded = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf([
			{
				id: "u0",
				ts: at / 1000 - 1,
				type: "message",
				payload: { role: "user", content: "older" },
			},
		]),
	);
	assert.equal(
		loaded.hasMore,
		false,
		"a first read of the tail has nothing behind it",
	);

	const tail = applyHistoryPage(loaded, page, { keepPaging: true });
	assert.equal(
		tail.hasMore,
		false,
		"the tail read leaves the paging state alone",
	);
	const ordinary = applyHistoryPage(loaded, page);
	assert.equal(
		ordinary.hasMore,
		true,
		"an ordinary read still believes the page",
	);

	/*
	 * U17, its round-5 residual (R5-2/U20) and its round-7 one (Q14): a cleared
	 * view is answered with THE PASS the read exists for, and with nothing else.
	 * Three facts, each of which was a defect on its own:
	 *
	 * - `/clear` is view-only, so a page read afterwards repaints every row it
	 *   removed (U17);
	 * - the test is the EPOCH, not "is the view empty" — the first read painting the
	 *   pass's own row made the view non-empty and the second read landed whole
	 *   (R5-2/U20);
	 * - and the ROW SET is scoped to the pass, by the CLEAR INSTANT rather than by
	 *   the read's own receipt: measured on a real runtime, a refusal of an empty
	 *   conversation is written 24 ms BEFORE the client holds the receipt, because
	 *   it takes no model call — so a receipt-keyed scope refused it and the pane
	 *   stayed silent (Q15). A pass whose receipt was sent after the clear writes
	 *   its row after the clear, whatever that gap is.
	 */
	const clearAt = at + 50;
	const cleared = clearTranscript(loaded, clearAt);
	assert.deepEqual(rows(cleared), []);
	assert.equal(cleared.clearedAt, clearAt, "the clear stamps its own instant");
	const afterTail = applyHistoryPage(cleared, page, { keepPaging: true });
	assert.deepEqual(
		rows(afterTail),
		["compaction"],
		"the pass's row is the only thing a tail read paints into a cleared view",
	);

	// The SECOND read, after that row is on screen: still only the pass's own row.
	const secondRead = applyHistoryPage(afterTail, page, { keepPaging: true });
	assert.deepEqual(
		rows(secondRead),
		["compaction"],
		"a non-empty cleared view is still a cleared view",
	);

	/*
	 * The two-pass page, in the PRODUCTION ordering Q15 measured: the older pass's
	 * row is before the clear, and THIS pass's row is after the clear but BEFORE the
	 * read's receipt instant — which is exactly the shape that made a receipt-keyed
	 * scope silent.
	 */
	const receiptAt = clearAt + 120;
	const twoPasses = {
		...pageOf([
			{
				id: "old_pass",
				ts: (clearAt - 60_000) / 1000,
				type: "compaction",
				payload: { tokens_before: 25 },
			},
			{
				id: "this_pass",
				// After the clear, before the receipt the renderer would hold.
				ts: (receiptAt - 24) / 1000,
				type: "compaction",
				payload: { tokens_before: 41_000 },
			},
			{
				id: "refused_pass",
				// The same ordering for a REFUSAL row, which is the case Q15 filed.
				ts: (receiptAt - 24) / 1000,
				type: "message",
				payload: {
					kind: "custom",
					custom_type: "compaction_refused",
					details: { detail: "the conversation is empty" },
				},
			},
		]),
		has_more: true,
	};
	const scoped = applyHistoryPage(cleared, twoPasses, { keepPaging: true });
	assert.deepEqual(
		scoped.records.map((record) => record.id),
		["this_pass", "refused_pass"],
		"a cleared view keeps this pass's rows — written before the receipt — and no earlier pass's",
	);

	// And the bracket QA ran: `/clear`, a new message, then the pass.
	const afterNewMessage = appendPendingUser(afterTail, "and now compact again");
	assert.deepEqual(rows(afterNewMessage), ["compaction", "user"]);
	const afterSecondPass = applyHistoryPage(afterNewMessage, twoPasses, {
		keepPaging: true,
	});
	assert.ok(
		!afterSecondPass.records.some((record) => record.id === "old_pass"),
		"the pre-clear pass stays gone through a later /compact",
	);

	// The ordinary read is untouched: it still repaints the rows `/clear` removed
	// (parity with `origin/main`, and deliberately not this branch's to change).
	assert.ok(
		applyHistoryPage(cleared, twoPasses).records.length > 1,
		"a non-tail read still repaints",
	);
});

test("the pair is matched by the pass's own figure, in the order production writes it", () => {
	/*
	 * Review round 4's BLOCKER (R4-1, U15/U16). The old rule ordered the pair by
	 * clock and required the durable row to be at-or-after the live line, on the
	 * reasoning that "a durable row is written when a pass ENDS". Production writes
	 * it the other way round: the backend awaits `append_compaction` and only then
	 * emits the settle event, and the renderer stamps the live line when it
	 * processes that frame — so the durable row is ALWAYS the older of the two, in
	 * either arrival order, and one pass painted two rows: one bare, one figured,
	 * side by side.
	 */
	const rows = (state) =>
		state.records
			.filter((record) => record.kind === "compaction")
			.map((record) => `${record.id}|${record.text}`);
	const durable = (id, ts, tokens) => ({
		id,
		ts,
		type: "compaction",
		payload: tokens === undefined ? {} : { tokens_before: tokens },
	});
	const settle = (state, before, after, at) =>
		applyEvent(
			state,
			{
				type: "compaction_end",
				success: true,
				tokens_before: before,
				tokens_after: after,
			},
			at,
		);

	const T = 1_700_000_000_000;
	// S7 — the page read lands AFTER the event (the ordinary `refreshTail` shape):
	// durable at T, live line processed at T + 250 ms.
	const twoOrders = [
		{
			name: "durable first, live line applied after",
			build: () =>
				applyHistoryPage(
					settle(
						applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }, T),
						41_000,
						9_000,
						T + 250,
					),
					pageOf([durable("d1", T / 1000, 41_000)]),
				),
		},
		{
			name: "live line first, durable page after",
			build: () =>
				applyHistoryPage(
					settle(
						applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }, T),
						41_000,
						9_000,
						T + 250,
					),
					pageOf([durable("d1", (T + 100) / 1000, 41_000)]),
				),
		},
	];
	for (const { name, build } of twoOrders) {
		const state = build();
		assert.deepEqual(
			rows(state),
			["d1|Context compacted, 41.0k to 9.0k tokens"],
			`${name}: one pass, one row, and the figures survive`,
		);
	}

	// U16 — two passes inside the window: each keeps its OWN figure on its own row.
	const pass1 = settle(
		applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }, T),
		25,
		25,
		T + 250,
	);
	const both = settle(pass1, 904, 900, T + 30_250);
	const paired = applyHistoryPage(
		both,
		pageOf([
			durable("d2", (T + 30_100) / 1000, 904),
			durable("d1", T / 1000, 25),
		]),
	);
	assert.deepEqual(rows(paired), [
		"d1|Context compacted to 25 tokens",
		"d2|Context compacted, 904 to 900 tokens",
	]);

	// A durable row with NO fingerprint falls back to the nearest within the window,
	// and a live line with no durable row is left exactly as it is.
	const legacy = applyHistoryPage(
		settle(
			applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }, T),
			41_000,
			9_000,
			T + 250,
		),
		pageOf([durable("d1", T / 1000)]),
	);
	assert.deepEqual(rows(legacy), [
		"d1|Context compacted, 41.0k to 9.0k tokens",
	]);
	const alone = settle(EMPTY_TRANSCRIPT, 41_000, 9_000, T + 250);
	assert.equal(rows(alone).length, 1);
	assert.match(rows(alone)[0], /^compaction:/);

	// And a pass whose durable row is minutes away is NOT claimed by the window:
	// distance is a tie-break for a fingerprint-less row, never the key.
	const farApart = applyHistoryPage(
		settle(EMPTY_TRANSCRIPT, 41_000, 9_000, T + 250),
		pageOf([durable("d9", (T + 600_000) / 1000)]),
	);
	assert.equal(
		rows(farApart).length,
		2,
		"two unrelated projections stay two rows",
	);
});

test("one pass, one row: the collapse is pure, total and idempotent, and the figures stay", () => {
	/*
	 * Review round 3 (R3-1 / U12 / Q5), and round 4's revision of the copy. The
	 * pairing is a pure function of the record list, the live sentence is what it
	 * keeps (it is the more informative of the two projections), and the sentence
	 * is carried INTO the row so a later read cannot strip it — which is the fact
	 * that makes the function idempotent rather than merely commutative.
	 */
	const rows = (state) =>
		state.records
			.filter((record) => record.kind === "compaction")
			.map((record) => `${record.id}|${record.text}`);

	// `tokens` is the pass's own figure — the durable projection of it, and the
	// fingerprint the pairing keys on (the entry carries `tokens_before` and no
	// after-figure). Fixtures that handed every row the same number would pass
	// through the window fallback and never exercise the identity rule.
	const durableRow = (id, ts, tokens) => ({
		id,
		ts,
		type: "compaction",
		payload: { tokens_before: tokens },
	});
	const settle = (state, before, after, at) =>
		applyEvent(
			state,
			{
				type: "compaction_end",
				success: true,
				tokens_before: before,
				tokens_after: after,
			},
			at,
		);

	const T0 = 1_700_000_000_000;
	// A pass settles live, then the durable row arrives on a page.
	const live = settle(
		applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }, T0),
		41_000,
		9_000,
		T0 + 250,
	);
	// The wire's own ordering (QA round 4, Q11): the durable row is appended BEFORE
	// the settle event is emitted, so its ts is EARLIER than the live line's.
	const page = pageOf([durableRow("d1", (T0 + 100) / 1000, 41_000)]);
	const once = applyHistoryPage(live, page);
	assert.deepEqual(rows(once), ["d1|Context compacted, 41.0k to 9.0k tokens"]);

	// H — the SAME page read again, and again: the figures are still there.
	assert.deepEqual(rows(applyHistoryPage(once, page)), rows(once));
	assert.deepEqual(
		rows(applyHistoryPage(applyHistoryPage(once, page), page)),
		rows(once),
	);

	// K — a `replace` re-seed of the same page. The re-seed REPAINTS from the page,
	// so the live row is gone; the sentence the row already carries is kept, which
	// is the idempotence fact stated on `durableRecord`, and the view is stable
	// under any further application of that page.
	const reseeded = applyHistoryPage(once, page, { replace: true });
	assert.deepEqual(rows(reseeded), rows(once));
	assert.deepEqual(rows(applyHistoryPage(reseeded, page)), rows(reseeded));
	assert.deepEqual(
		rows(applyHistoryPage(reseeded, page, { replace: true })),
		rows(reseeded),
	);

	// Cold reload: the first thing this reader ever sees is the durable row, with
	// no live sentence to pair and therefore the bare one — correct parity with the
	// terminal host's own replay, not a defect.
	assert.deepEqual(rows(applyHistoryPage(EMPTY_TRANSCRIPT, page)), [
		"d1|Context compacted",
	]);

	// L — two passes 30 s apart, one page carrying both durable rows. Each pass
	// keeps its OWN figures; nothing adopts the other's.
	const both = settle(
		settle(
			applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }, T0),
			41_000,
			9_000,
			T0 + 250,
		),
		9_000,
		3_000,
		T0 + 30_000,
	);
	const twoPages = applyHistoryPage(
		both,
		pageOf([
			durableRow("d2", (T0 + 30_100) / 1000, 9_000),
			durableRow("d1", (T0 + 100) / 1000, 41_000),
		]),
	);
	assert.deepEqual(rows(twoPages), [
		"d1|Context compacted, 41.0k to 9.0k tokens",
		"d2|Context compacted, 9.0k to 3.0k tokens",
	]);
	// And it is stable under the read that follows — the read round 2 rewrote with
	// the newer pass's numbers.
	assert.deepEqual(
		rows(
			applyHistoryPage(
				twoPages,
				pageOf([
					durableRow("d1", (T0 + 100) / 1000, 41_000),
					durableRow("d2", (T0 + 30_100) / 1000, 9_000),
				]),
			),
		),
		rows(twoPages),
	);

	// A durable row arriving BEFORE the live end is one row too: the page lands
	// while the pass runs, and the settle then projects the same event.
	const early = applyHistoryPage(
		applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }, T0),
		page,
	);
	assert.deepEqual(rows(early), ["d1|Context compacted"]);
	const afterEarly = settle(early, 41_000, 9_000, T0 + 900);
	assert.deepEqual(rows(afterEarly), [
		"d1|Context compacted, 41.0k to 9.0k tokens",
	]);

	// One durable row, TWO live lines: a long session's tail window can exclude the
	// older pass's durable row, and then the older pass keeps the live line it has —
	// one durable row may cover only one pass, or a pass disappears entirely.
	const latestOnly = applyHistoryPage(
		both,
		pageOf([durableRow("d2", (T0 + 30_100) / 1000, 9_000)]),
	);
	assert.equal(
		rows(latestOnly).length,
		2,
		"one row per pass, and neither is lost",
	);
	/*
	 * R5-3 / U19's shape: the page carries only the NEWER pass's durable row, so the
	 * older live line has no pair on this page. Each row keeps its own figures.
	 *
	 * WHAT CLOSES IT IS THE IDENTITY PASS, not the fallback's eligibility (review
	 * round 6, R6-3): the newer live line matches `d2` on its fingerprint and claims
	 * it before any distance is consulted, so the older line has nothing left to
	 * take. The eligibility rule is what stops the OTHER shape — a live line with no
	 * row of its own reaching for a neighbour (see the live-path case below).
	 */
	assert.deepEqual(rows(latestOnly), [
		"compaction:0:41000:9000|Context compacted, 41.0k to 9.0k tokens",
		"d2|Context compacted, 9.0k to 3.0k tokens",
	]);

	/*
	 * R6-1: a pass that reports ZERO tokens — the runtime's own spelling for a pass
	 * that failed — is a pass WITH a figure, and both projections say so. The live
	 * path used truthiness (`before ? {before} : {}`) while the durable row used a
	 * type check, so this pass painted two rows: the live line carried no
	 * fingerprint and the durable row's `0` could not match it, and the fallback
	 * would not take it either (it takes only fingerprint-less rows).
	 */
	const zeroDurable = {
		id: "z1",
		ts: (T0 + 100) / 1000,
		type: "compaction",
		payload: { tokens_before: 0 },
	};
	const zeroPass = applyEvent(
		applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }, T0),
		{
			type: "compaction_end",
			success: true,
			tokens_before: 0,
			tokens_after: 0,
		},
		T0 + 250,
	);
	assert.equal(
		zeroPass.records.filter((record) => record.kind === "compaction").length,
		1,
		"a zero figure is still a figure on the live line",
	);
	assert.deepEqual(
		rows(applyHistoryPage(zeroPass, pageOf([zeroDurable]))),
		["z1|Context compacted"],
		"and the durable row of the same pass collapses with it, bare",
	);

	/*
	 * R6-2: the fallback's RANKING, pinned by the only input that distinguishes it.
	 *
	 * THE DISTINGUISHING INPUT: ONE fingerprint-less durable row inside the window of
	 * TWO live lines, placed so that the NEWER line is nearer to it than the older
	 * one is. Global nearest-by-distance gives the row to the newer line; the
	 * oldest-live-first order (the rule this replaced) gives it to the older one.
	 * Round 6 measured that reverting the ranking was 67/67 green after round 5's
	 * fixtures lost this input, so it is stated here explicitly.
	 */
	const rankingDurable = {
		id: "r1",
		ts: (T0 + 30_200) / 1000,
		type: "compaction",
		payload: {},
	};
	const twoLives = settle(
		settle(
			applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }, T0),
			41_000,
			9_000,
			T0 + 250,
		),
		9_000,
		3_000,
		T0 + 30_250,
	);
	assert.deepEqual(
		rows(applyHistoryPage(twoLives, pageOf([rankingDurable]))),
		[
			"compaction:0:41000:9000|Context compacted, 41.0k to 9.0k tokens",
			"r1|Context compacted, 9.0k to 3.0k tokens",
		],
		"the nearest live line claims a fingerprint-less row, not the oldest one",
	);

	/*
	 * The LIVE path, which is where U19 was measured: pass 1's row is already paired
	 * and carries its own figure, and pass 2's settle frame arrives BEFORE pass 2's
	 * durable row does. The window must not hand pass 1's row to pass 2 — with the
	 * fingerprint exclusion removed this case rewrites `41.0k to 9.0k` to
	 * `9.0k to 3.0k` and drops pass 2's own live line, which is exactly the shift UX
	 * read off the screen (`to 3.8k` on pass 1's slot).
	 */
	const onePass = applyHistoryPage(
		settle(
			applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }, T0),
			41_000,
			9_000,
			T0 + 250,
		),
		pageOf([durableRow("d1", (T0 + 100) / 1000, 41_000)]),
	);
	assert.deepEqual(rows(onePass), [
		"d1|Context compacted, 41.0k to 9.0k tokens",
	]);
	assert.deepEqual(
		rows(settle(onePass, 9_000, 3_000, T0 + 30_250)),
		[
			"d1|Context compacted, 41.0k to 9.0k tokens",
			"compaction:0:9000:3000|Context compacted, 9.0k to 3.0k tokens",
		],
		"a later pass's frame never rewrites an earlier pass's row",
	);

	// Three passes, pages arriving one durable row at a time: every slot keeps its
	// OWN figure, and a live line whose durable row is not on the page yet keeps the
	// row it has rather than adopting a neighbour's.
	const three = settle(
		settle(
			settle(
				applyEvent(EMPTY_TRANSCRIPT, { type: "compaction_start" }, T0),
				25,
				25,
				T0 + 250,
			),
			3_781,
			3_100,
			T0 + 20_250,
		),
		5_301,
		4_900,
		T0 + 40_250,
	);
	for (const state of [
		applyHistoryPage(three, pageOf([durableRow("a1", (T0 + 100) / 1000, 25)])),
		applyHistoryPage(
			three,
			pageOf([durableRow("a2", (T0 + 20_100) / 1000, 3_781)]),
		),
		applyHistoryPage(
			three,
			pageOf([durableRow("a3", (T0 + 40_100) / 1000, 5_301)]),
		),
	]) {
		assert.deepEqual(
			state.records
				.filter((record) => record.kind === "compaction")
				.map((record) => record.text),
			[
				"Context compacted to 25 tokens",
				"Context compacted, 3.8k to 3.1k tokens",
				"Context compacted, 5.3k to 4.9k tokens",
			],
			"each pass keeps its own figures whatever page order arrives",
		);
	}

	// A live line whose durable row has not arrived yet still paints: the collapse
	// removes a duplicate, never the only projection of a pass.
	const alone = settle(EMPTY_TRANSCRIPT, 41_000, 9_000, T0 + 250);
	assert.equal(rows(alone).length, 1);
	assert.match(rows(alone)[0], /^compaction:/);
});
