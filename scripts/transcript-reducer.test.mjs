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

test("a running row carries the clock its duration cannot", () => {
	/*
	 * R4/Q-06. `durationS` is null for the whole life of a running call — it
	 * only arrives on `tool_execution_end` — so the row rendered `0s` from start
	 * to finish and a four-minute `bash` looked identical to an instant one.
	 * The row needs a start timestamp of its own to count from.
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
