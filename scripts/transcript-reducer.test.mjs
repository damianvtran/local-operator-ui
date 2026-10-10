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
	loadOlderStep,
	reanchorAfterCursorMiss,
	reanchorCandidate,
	applyLiveSeed,
	streamDiagnostics,
	clearTranscript,
	dropLiveRecords,
	labelGapCandidates,
	reconcileLimit,
	seedCallsMissingLabels,
	withRecoveredOutcome,
	appendPendingUser,
	appendLocalNote,
	removeRecord,
	queuedAskEngineLive,
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

test("a live settle carries the same completion mark the durable read writes", () => {
	/*
	 * The receipt's anchor gate asks for `data-completion-complete`, which the
	 * view renders from `record.complete`; the durable `history` arm sets it for
	 * a text-bearing answer, and the live `message_end` is the same fact by the
	 * other path. Without it a completion that arrived while its conversation
	 * was open could not be acknowledged until a re-read replaced the record
	 * (QA round 1, Q1; measured in `docs/evidence/chat-sidebar-ack-and-selection/`).
	 */
	let live = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: assistant("a1", "") },
		1,
	);
	live = applyEvent(
		live,
		{ type: "message_update", delta: "Hel", message: assistant("a1", "") },
		2,
	);
	assert.equal(
		live.records[0].complete,
		undefined,
		"a streaming row states no completion",
	);
	live = applyEvent(
		live,
		{ type: "message_end", message: assistant("a1", "Hello!") },
		3,
	);
	assert.equal(
		live.records[0].complete,
		true,
		"the settled answer is complete",
	);
	// The mark a replay carries is the same one, not a restamp.
	assert.equal(
		applyEvent(
			live,
			{ type: "message_end", message: assistant("a1", "Hello!") },
			9,
		).records[0].complete,
		true,
	);
	/*
	 * A turn whose only output was tool calls states no completion, on either
	 * path: its answer is the paired tool rows, not prose (the durable arm's own
	 * rule, mirrored here so the two cannot drift).
	 */
	const toolOnly = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "message_end",
			message: {
				role: "assistant",
				content: [],
				tool_calls: [{ id: "t1" }],
				id: "a2",
			},
		},
		4,
	);
	assert.equal(
		toolOnly.records.find((r) => r.id === "a2").complete,
		undefined,
		"a tool-call-only end is not a completion",
	);
});

test("a settled assistant is stamped with the instant it settled, once", () => {
	/*
	 * `settledAt` is the live half of a wall-clock span: a live assistant record's
	 * `ts` is its stream START, so a `Took` built from `ts` would read short by
	 * the answer's whole streaming time and jump when the reconcile swaps in the
	 * durable twin. The stamp is written when the record SETTLES and kept on a
	 * replay — a restamped completion would move a span the reader is watching.
	 */
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
	assert.equal(
		state.records[0].settledAt,
		undefined,
		"a streaming row has not settled and states no completion",
	);
	state = applyEvent(
		state,
		{ type: "message_end", message: assistant("a1", "Hello!") },
		3,
	);
	assert.equal(state.records[0].settledAt, 3, "stamped at the settle frame");

	// A replayed `message_end` (receipt replay, a flush from a dead stream) must
	// not restamp it, and its text (the authoritative whole) still lands.
	const replayed = applyEvent(
		state,
		{ type: "message_end", message: assistant("a1", "Hello!") },
		9,
	);
	assert.equal(
		replayed.records[0].settledAt,
		3,
		"the first settle instant wins",
	);
	assert.equal(replayed.records[0].text, "Hello!");
});

test("the turn end stamps whatever it settles, aborted or not", () => {
	// The sweep that clears `streaming` at `agent_end` is the one that catches a
	// stream whose `message_end` never came — an abort, and a lost end event on a
	// clean turn. Both settle at the turn end's own frame.
	const stream = () => {
		let state = applyEvent(
			EMPTY_TRANSCRIPT,
			{ type: "message_start", message: assistant("a1", "") },
			1,
		);
		state = applyEvent(
			state,
			{ type: "message_update", delta: "half", message: assistant("a1", "") },
			2,
		);
		return state;
	};
	const aborted = applyEvent(stream(), { type: "agent_end", aborted: true }, 5);
	assert.equal(aborted.records[0].streaming, false);
	assert.equal(aborted.records[0].stopReason, "aborted");
	assert.equal(aborted.records[0].settledAt, 5);
	assert.equal(
		applyEvent(stream(), { type: "agent_end", aborted: false }, 7).records[0]
			.settledAt,
		7,
		"a clean end that lost its `message_end` settles the same way",
	);
});

test("durable rows carry no settle stamp: their `ts` is the commit", () => {
	// A page states a completion it did not witness, so it must not stamp one;
	// and when the durable row replaces a live stamped one, the page wins with
	// its own `ts` — the same rule `ts` already followed.
	const page = {
		entries: [
			{
				id: "a1",
				ts: 11,
				type: "message",
				payload: { kind: "message", ...assistant("a1", "the whole answer") },
			},
		],
		has_more: false,
		cursor_missing: false,
	};
	const durable = applyHistoryPage(EMPTY_TRANSCRIPT, page);
	assert.equal(durable.records[0].settledAt, undefined);
	assert.equal(
		applyHistoryPage(durable, page),
		durable,
		"and a replay stays a no-op",
	);

	let live = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: assistant("a1", "") },
		1,
	);
	live = applyEvent(
		live,
		{ type: "message_end", message: assistant("a1", "the whole answer") },
		3,
	);
	assert.equal(live.records[0].settledAt, 3);
	const reconciled = applyHistoryPage(live, page);
	assert.equal(
		reconciled.records[0].settledAt,
		undefined,
		"the durable twin has no stamp; its commit `ts` is the end instant",
	);
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

test("tool progress frames land on the record's details carrier", () => {
	let state = EMPTY_TRANSCRIPT;
	state = applyEvent(
		state,
		{
			type: "tool_execution_start",
			tool_call_id: "g1",
			tool_name: "generate_image",
			args: { prompt: "a cat" },
		},
		1,
	);
	const canonical = {
		tool_name: "generate_image",
		stage: "queued",
		queue_position: 2,
		progress_fraction: null,
		log_lines: null,
		error: null,
		error_type: null,
	};
	state = applyEvent(
		state,
		{
			type: "tool_execution_update",
			tool_call_id: "g1",
			tool_name: "generate_image",
			partial_result: {
				content: [
					{ type: "text", text: "Generating via Radient: queued, #2 — 3s" },
				],
				details: canonical,
			},
		},
		2,
	);
	let row = state.records.find((r) => r.id === "tool:g1");
	assert.equal(row.details.queue_position, 2);
	// An equal replay returns the same reference, so the equality gate sees no
	// change: a fresh decode of a frame that states nothing new must not
	// re-render the row.
	const before = row;
	state = applyEvent(
		state,
		{
			type: "tool_execution_update",
			tool_call_id: "g1",
			tool_name: "generate_image",
			partial_result: { content: [], details: { ...canonical } },
		},
		3,
	);
	row = state.records.find((r) => r.id === "tool:g1");
	assert.equal(row, before, "an equal frame keeps the record identity");
	// A frame whose details the live-event budget stripped says nothing and
	// keeps what the row held.
	state = applyEvent(
		state,
		{
			type: "tool_execution_update",
			tool_call_id: "g1",
			tool_name: "generate_image",
			partial_result: { content: [] },
		},
		4,
	);
	assert.equal(
		state.records.find((r) => r.id === "tool:g1").details.queue_position,
		2,
	);
	// The settling result's own details land the same way — the conflict pair
	// included, which is what the card's receipt reads.
	state = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: "g1",
			tool_name: "generate_image",
			is_error: true,
			result: {
				content: [
					{ type: "text", text: "not cancelled — it had already completed" },
				],
				is_error: true,
				details: {
					stage: "cancelled",
					error:
						"The generation had already completed when the cancel arrived; its result was discarded.",
					error_type: "media_already_completed",
				},
			},
		},
		5,
	);
	assert.equal(
		state.records.find((r) => r.id === "tool:g1").details.error_type,
		"media_already_completed",
	);
	// The durable half: the same facts off a stored row's provider_payload, so
	// a reload reads the conflict the live frame painted.
	const stored = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			{
				id: "t-g2",
				ts: 10,
				type: "message",
				payload: {
					role: "tool",
					tool_call_id: "g2",
					tool_name: "generate_image",
					content: [
						{ type: "text", text: "not cancelled — it had already completed" },
					],
					is_error: true,
					provider_payload: {
						details: {
							stage: "cancelled",
							error_type: "media_already_completed",
						},
					},
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	const durableRow = stored.records.find((r) => r.kind === "tool");
	assert.equal(durableRow.details.error_type, "media_already_completed");
	// THE NON-IMAGEGEN NO-OP (agent review round 1, F1): a frame outside the
	// contract's vocabulary leaves the transcript state IDENTICAL — the gate
	// returns before any upsert, so the common non-imagegen case is a true
	// no-op, not a merely-equal rebuild. (A non-imagegen payload that happens
	// to carry the gate key IS stored and is inert; the gate's scope comment
	// carries the boundary.)
	let plain = EMPTY_TRANSCRIPT;
	plain = applyEvent(
		plain,
		{
			type: "tool_execution_start",
			tool_call_id: "b1",
			tool_name: "bash",
			args: { command: "ls" },
		},
		1,
	);
	const before2 = plain;
	plain = applyEvent(
		plain,
		{
			type: "tool_execution_update",
			tool_call_id: "b1",
			tool_name: "bash",
			partial_result: {
				content: [{ type: "text", text: "chunk" }],
				details: { pid: 42, chunk: "out" },
			},
		},
		2,
	);
	assert.equal(
		plain,
		before2,
		"an un-gated non-imagegen frame is a true no-op",
	);
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

test("a durable completion marker paints error, interrupted and closed rows", () => {
	// The OTHER producer of outcome rows: a `completion_attention` entry
	// replayed from the journal (the shape the core actually writes — `type:
	// "custom"`, details under `payload`, checked against the frozen 664a
	// transcript). v2 (2026-09-29) adds the neutral `closed` closure beside the
	// two incident kinds, and a `complete` marker must still project to nothing.
	const marker = (kind) => ({
		id: `m-${kind}`,
		ts: 2,
		type: "custom",
		payload: {
			custom_type: "completion_attention",
			details: {
				conversation_id: "session/123456abcdef",
				token: "t1",
				anchor: `completion-${kind}-anchor`,
				kind,
			},
		},
	});
	const records = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			marker("error"),
			marker("interrupted"),
			marker("closed"),
			marker("complete"),
		],
		has_more: false,
		cursor_missing: false,
	}).records;
	const byId = new Map(records.map((record) => [record.id, record]));
	assert.equal(
		byId.get("completion-error-anchor").text,
		"Stopped with an error",
	);
	assert.equal(byId.get("completion-error-anchor").level, "error");
	assert.equal(byId.get("completion-interrupted-anchor").text, "Interrupted");
	assert.equal(byId.get("completion-interrupted-anchor").level, "warning");
	const closed = byId.get("completion-closed-anchor");
	assert.equal(closed.kind, "notice");
	assert.equal(closed.text, "Completed — runtime retired/disposed");
	assert.equal(closed.level, "info", "the closure never wears danger ink");
	assert.equal(
		closed.complete,
		true,
		"the marker retires the working-line wait",
	);
	assert.equal(
		byId.get("completion-complete-anchor"),
		undefined,
		"a completion marker projects to nothing",
	);
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

test("a closed outcome synthesizes as an info receipt and retires like a stop", () => {
	// v2 (2026-09-29): a disposal that caught a zero-work run publishes
	// `closed`. The desktop must paint the receipt — never "Stopped with an
	// error" — and the row keeps `complete` so the working-line ladder ends a
	// wait for a runtime that has been disposed.
	const state = withRecoveredOutcome(
		seeded(),
		attention({ kind: "closed" }),
		false,
		new Set(),
	);
	const row = rowFor(state);
	assert.equal(row.kind, "notice");
	assert.equal(row.text, "Completed — runtime retired/disposed");
	assert.equal(row.level, "info");
	assert.equal(row.complete, true);
});

test("a durable retired marker paints the warning row", () => {
	// The retire-for-build arm (2026-09-29; core kind `retired`, seed
	// 7e797aaaf6e7): the same durable shape as the closure cell above, one tier
	// apart — warning, never danger — and `complete: true` so the working-line
	// wait retires beside the row.
	const records = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			{
				id: "m-retired",
				ts: 2,
				type: "custom",
				payload: {
					custom_type: "completion_attention",
					details: {
						conversation_id: "session/7e797aaaf6e7",
						token: "t3",
						anchor: "completion-retired-anchor",
						kind: "retired",
						cause: "runtime-retired",
						reason:
							"the runtime retired so the next engage would run a newer build",
					},
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	}).records;
	assert.equal(records.length, 1);
	assert.equal(records[0].kind, "notice");
	assert.equal(
		records[0].text,
		"Retired for an update — a turn was in flight and was cut; its earlier output is kept",
	);
	assert.equal(records[0].level, "warning", "a cut for an update is warning");
	assert.equal(records[0].complete, true, "the marker retires the wait");
});

test("a retired outcome synthesizes as a warning receipt", () => {
	// Same synthesis path as the closure cell above; the retired arm must paint
	// the warning tier — never danger, never the closure's info whisper.
	const state = withRecoveredOutcome(
		seeded(),
		attention({ kind: "retired" }),
		false,
		new Set(),
	);
	const row = rowFor(state);
	assert.equal(row.kind, "notice");
	assert.equal(
		row.text,
		"Retired for an update — a turn was in flight and was cut; its earlier output is kept",
	);
	assert.equal(row.level, "warning");
	assert.equal(row.complete, true);
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

test("only error, interrupted and closed outcomes are synthesized", () => {
	// `closed` joined the synthesizable set in v2 (2026-09-29): a disposal's
	// neutral closure is an outcome the transcript keeps a row for, exactly as
	// it keeps one for an incident. `complete` still synthesizes nothing — a
	// finished turn has its own rows.
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

/* ---------------------------------------------------------------------- *
 * Output artifacts (AttachmentContent).
 *
 * The block a tool produces for the USER: `kind` + metadata + a store digest
 * instead of bytes. Detection is `kind` + a media fact, NEVER `type` — the
 * encoder drops defaults, so `kind` is present precisely BECAUSE the contract
 * makes it required (a defaulted kind would vanish from durable rows and make
 * an image artifact indistinguishable from a legacy image reference).
 * ---------------------------------------------------------------------- */

/** A durable artifact block: no `type`, metadata set, digest reference. */
const durableArtifact = {
	kind: "image",
	content_type: "image/png",
	attachment: DIGEST,
	source_url: "https://provider.example/img/01.png",
	size_bytes: 41233,
	width: 1024,
	height: 1024,
	name: "flux-dev-01.png",
};

test("an artifact row coerces with its metadata on the durable shape", () => {
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			{
				id: "t-art",
				ts: 1,
				type: "message",
				payload: {
					role: "tool",
					tool_call_id: "c-gen",
					tool_name: "generate_image",
					content: [{ text: "Generated one image" }, durableArtifact],
					provider_payload: { duration_s: 4.2, details: {} },
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	const tool = state.records.find((r) => r.kind === "tool");
	assert.equal(tool.images.length, 1);
	const img = tool.images[0];
	assert.equal(img.attachment, DIGEST);
	assert.equal(img.data, null);
	assert.equal(img.mimeType, "image/png");
	assert.equal(img.kind, "image");
	assert.equal(img.width, 1024);
	assert.equal(img.height, 1024);
	assert.equal(img.sizeBytes, 41233);
	assert.equal(img.name, "flux-dev-01.png");
	assert.equal(img.sourceUrl, "https://provider.example/img/01.png");
	// The artifact must not leak into the row's text either.
	assert.equal(tool.output, "Generated one image");
});

test("a live artifact frame maps the same way as the durable row", () => {
	const state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "tool_execution_end",
			tool_call_id: "c-gen",
			tool_name: "generate_image",
			result: {
				content: [
					{ type: "text", text: "Generated" },
					{
						type: "attachment",
						kind: "image",
						content_type: "image/webp",
						attachment: DIGEST,
					},
				],
				details: {},
			},
			duration_s: 1,
		},
		1,
	);
	const tool = state.records.find((r) => r.kind === "tool");
	assert.equal(tool.images.length, 1);
	assert.equal(tool.images[0].kind, "image");
	assert.equal(tool.images[0].mimeType, "image/webp");
	assert.equal(tool.images[0].sourceUrl, null);
});

test("video artifacts do not enter the view array yet", () => {
	// The render path is kind-blind: a video entry would be fetched by the
	// image pipeline and fail `<img>` decode into a false "unavailable"
	// receipt (review round 1, F2). The model still carries the block — this
	// array mounts PICTURES only until players land, the same call the
	// harness/TUI half makes.
	const video = {
		kind: "video",
		content_type: "video/mp4",
		attachment: DIGEST,
		duration_s: 6.5,
		width: 1920,
		height: 1080,
	};
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			{
				id: "t-vid",
				ts: 1,
				type: "message",
				payload: {
					role: "tool",
					tool_call_id: "c-vid",
					tool_name: "generate_video",
					content: [video],
					provider_payload: { details: {} },
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	const tool = state.records.find((r) => r.kind === "tool");
	assert.equal(tool.images.length, 0);
});

test("a durable row's metadata lands over a bare live frame", () => {
	// Review round 1, F1: the coalesce pinned ANY non-empty live array, so a
	// producer that only knew kind + digest at emit time never had its
	// durable dimensions/name arrive — the enrichment must win when it lands.
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "tool_execution_end",
			tool_call_id: "c-gen",
			tool_name: "generate_image",
			result: {
				content: [
					{
						kind: "image",
						content_type: "image/png",
						attachment: DIGEST,
					},
				],
				details: {},
			},
			duration_s: 1,
		},
		1,
	);
	const live = state.records.find((r) => r.kind === "tool");
	assert.equal(live.images.length, 1);
	assert.equal(live.images[0].width, null, "the live frame knew no dimensions");

	state = applyHistoryPage(state, {
		entries: [
			{
				id: "t-art-durable",
				ts: 1,
				type: "message",
				payload: {
					role: "tool",
					tool_call_id: "c-gen",
					tool_name: "generate_image",
					content: [durableArtifact],
					provider_payload: { details: {} },
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	const merged = state.records.filter((r) => r.kind === "tool");
	assert.equal(merged.length, 1, "the durable row replaces, never duplicates");
	assert.equal(merged[0].images[0].width, 1024, "the durable metadata landed");
	assert.equal(merged[0].images[0].name, "flux-dev-01.png");
});

test("a bare replay never demotes a metadata-carrying row", () => {
	// The other direction of the same rule (F1): a replayed end whose fields
	// the relay dropped must not strip what the row already shows.
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "tool_execution_end",
			tool_call_id: "c-gen",
			tool_name: "generate_image",
			result: {
				content: [
					{
						kind: "image",
						content_type: "image/png",
						attachment: DIGEST,
						width: 640,
						height: 360,
						name: "rich.png",
					},
				],
				details: {},
			},
			duration_s: 1,
		},
		1,
	);
	const rich = state.records.find((r) => r.kind === "tool");
	assert.equal(rich.images[0].name, "rich.png");

	// The same call settles again from a relay that lost the metadata.
	state = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: "c-gen",
			tool_name: "generate_image",
			result: {
				content: [
					{ kind: "image", content_type: "image/png", attachment: DIGEST },
				],
				details: {},
			},
			duration_s: 1,
		},
		2,
	);
	const after = state.records.find((r) => r.kind === "tool");
	assert.equal(
		after.images[0].name,
		"rich.png",
		"metadata must not be demoted",
	);
	assert.equal(after.images[0].width, 640);
});

test("a bare `kind` with no media fact is not an artifact", () => {
	// Tool arguments and details payloads are free-form JSON: a stray `kind`
	// key must not conjure a phantom picture or eat the row's text.
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			{
				id: "t-stray",
				ts: 1,
				type: "message",
				payload: {
					role: "tool",
					tool_call_id: "c-stray",
					tool_name: "x",
					content: [{ text: "hello", kind: "image" }],
					provider_payload: { details: {} },
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	const tool = state.records.find((r) => r.kind === "tool");
	assert.equal(tool.images.length, 0);
	assert.equal(tool.output, "hello");
});

test("an artifact row keeps its images-array identity across replays", () => {
	const page = {
		entries: [
			{
				id: "t-art",
				ts: 1,
				type: "message",
				payload: {
					role: "tool",
					tool_call_id: "c-gen",
					tool_name: "generate_image",
					content: [durableArtifact],
					provider_payload: { details: {} },
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	};
	const first = applyHistoryPage(EMPTY_TRANSCRIPT, page);
	const second = applyHistoryPage(first, page);
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
	assert.equal(
		done.endedAt,
		61_200,
		"and keeps the completion the fold's span is built from",
	);
});

test("a settled row dates its completion in the producer's own clock", () => {
	/*
	 * The fold's span (first start to last completion) is built from the two
	 * stamps this asserts, and the completion is `startedAt + duration_s` — the
	 * producer's own numbers — rather than this viewer's arrival instant: a seed
	 * replayed to a viewer that was away would otherwise date a completion that
	 * never happened then, stretching a run's span by however long they were
	 * gone. The arrival below is deliberately far from the true completion so
	 * the two cannot be confused.
	 */
	const started = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "tool_execution_start",
			tool_call_id: "c-span",
			tool_name: "bash",
			args: { command: "true" },
			started_at_epoch: 5,
		},
		5_000,
	);
	const running = started.records.find((r) => r.kind === "tool");
	assert.equal(running.startedAt, 5_000);
	assert.equal(running.endedAt, null, "nothing completed yet");

	const settled = applyEvent(
		started,
		{
			type: "tool_execution_end",
			tool_call_id: "c-span",
			tool_name: "bash",
			result: { content: [{ type: "text", text: "ok" }], details: {} },
			duration_s: 3,
		},
		999_999,
	);
	const done = settled.records.find((r) => r.kind === "tool");
	assert.equal(
		done.endedAt,
		8_000,
		"5s + 3s in the producer's clock, not the arriving frame's instant",
	);

	// An end frame that states no duration leaves NO completion: the fold's span
	// renders nothing for a run it cannot date rather than a `0s` claim.
	const quiet = applyEvent(
		started,
		{
			type: "tool_execution_end",
			tool_call_id: "c-span",
			tool_name: "bash",
			result: { content: [] },
		},
		999_999,
	);
	assert.equal(quiet.records.find((r) => r.kind === "tool").endedAt, null);
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
 * The user's own stop, in the ledger (UX round 2's U7 and U15).
 *
 * `Esc` kills the call in flight, and the process that died reports a REAL
 * error - so classifying that row is a client decision over a client-held
 * fact (`stoppedTurns`), consumed when the end event arrives
 * (`transcript-reducer.ts`'s `killedByUserStop`). Three shapes of row reach
 * the test, and they need different evidence: one this viewer watched run (a
 * clock to compare against the press); and two it never watched start - the
 * row it only ever met as it SETTLED (born from the end event, no clock on
 * any layer), which is the shape U15 was filed on; and the row it saw
 * ANNOUNCED but never started, which is what the press actually kills on this
 * daemon: a `[bash:N]` call PARKS at the approval gate, so no
 * `tool_execution_start` precedes an `Esc` (agent review round 4's Q5, where
 * the rig's three failing runs met UX's measurement). Both no-clock shapes
 * used to paint `failed` in danger beside the turn's own Stopped line; the
 * stop fact now speaks for both.
 * ---------------------------------------------------------------------- */

/** The press, one minute into a call that started at `expectedStart`. */
const STOP_PRESSED_AT = expectedStart + 60_000;

const endFrame = (callId, over = {}) => ({
	type: "tool_execution_end",
	tool_call_id: callId,
	tool_name: "bash",
	// The killing process dies mid-call, so the end event carries a genuine
	// failure claim - the wire fact the classification has to overrule.
	result: { content: [{ type: "text", text: "killed" }], is_error: true },
	is_error: true,
	duration_s: 0.8,
	...over,
});

test("an end event that seeds the row during a stopped turn reads stopped, not failed (U15)", () => {
	/*
	 * THE SHAPE THE FIX EXISTS FOR, reproduced as the reducer sees it: no
	 * `tool_execution_start` ever reached this viewer for the killed call (the
	 * interrupt rig measures exactly that lag), so the end event CREATES the
	 * row, `startedAt` is null, and the clock arm of the guard cannot answer.
	 * Before the fix this row painted `failed` in danger - the same turn's
	 * Stopped line standing beside it - blaming the agent for the press.
	 */
	const state = applyEvent(EMPTY_TRANSCRIPT, endFrame("c-killed"), ARRIVAL, {
		userStoppedAt: STOP_PRESSED_AT,
	});
	const row = ranRow(state, "c-killed");
	assert.equal(row.startedAt, null, "the row was born settled, like the rig's");
	assert.equal(row.stopped, true, "the stop is the row's verdict");
	assert.equal(
		row.isError,
		false,
		"and the danger ink is cleared, because the outcome ladder reads this first",
	);
});

test("a row announced but never started, killed by the stop, reads stopped (the parked call)", () => {
	/*
	 * THE THIRD SHAPE (agent review round 4's Q5, reconciling the interrupt rig's
	 * three failing runs with UX's measurement). On this daemon a `[bash:N]` call
	 * PARKS at the approval gate: the viewer sees the announced row, no
	 * `tool_execution_start` (the call has not run), and the press kills it before
	 * it ever starts. `current` EXISTS with `startedAt === null` and the end event
	 * does not seed it - the case both of U15's arms refused, which painted
	 * `failed` in danger beneath the turn's own Stopped line, the same accusation
	 * U15 exists to remove.
	 */
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "tool_call_compose",
			tool_call_id: "c-parked",
			tool_name: "bash",
			argument_bytes: 28,
		},
		ARRIVAL,
	);
	assert.equal(
		ranRow(state, "c-parked").startedAt,
		null,
		"the parked row has no clock: nothing has run yet",
	);
	state = applyEvent(state, endFrame("c-parked"), ARRIVAL + 1_000, {
		userStoppedAt: STOP_PRESSED_AT,
	});
	const row = ranRow(state, "c-parked");
	assert.equal(row.stopped, true, "the stop is the parked row's verdict too");
	assert.equal(row.isError, false, "and the danger ink is cleared with it");
});

test("the accepted mirror: an own-fault no-clock failure inside the standing window also reads stopped (R21)", () => {
	/*
	 * THE COST Q5 TOOK, PINNED WHERE IT WAS TAKEN - as a cost, not as approval.
	 * The inputs are identical to the two pins above, and they have to be: the
	 * reducer cannot tell the reading the widened arm is FOR (a call the press
	 * killed before it started, or one born settled by the killing end event)
	 * from the reading it ACCEPTS (a call whose failure was its own, settled
	 * before the press, whose end event reached a lagging viewer inside the
	 * standing window). One story has to win for both, and the standing stop
	 * fact is the story taken. This test is a deliberate companion to U15's pin
	 * rather than a duplicate: a future edit that re-tightens the arm must
	 * consciously move THIS assertion, whose name says what it is.
	 *
	 * WHAT WOULD MAKE THE MIRROR REAL (agent review round 5, R21): a
	 * daemon-produced end frame for an announced-but-unstarted call carrying a
	 * fault other than the abort, inside the standing window. None was
	 * constructed - a parked call does not execute, so its endings inside the
	 * window are the stop's kill or a gate resolution that would have started
	 * it - and the window is bounded (`chat-page.tsx`: the press's receipt
	 * clears the fact on any answer that is not `interrupted`, and the next turn
	 * clears it again), with the durable page correcting a genuine failure back
	 * to danger when its fault is not `aborted`.
	 */
	const state = applyEvent(EMPTY_TRANSCRIPT, endFrame("c-own-fault"), ARRIVAL, {
		userStoppedAt: STOP_PRESSED_AT,
	});
	const row = ranRow(state, "c-own-fault");
	assert.equal(
		row.startedAt,
		null,
		"no clock: nothing this viewer ever watched start",
	);
	assert.equal(
		row.stopped,
		true,
		"the standing stop fact is the reading taken",
	);
	assert.equal(
		row.isError,
		false,
		"and the danger ink yields to it - the accepted cost, asserted rather than assumed",
	);
});

test("the same birth with no standing stop fact keeps its danger row", () => {
	// The classification is the FACT's work, not the shape's: without a
	// standing stop there is no better story than the event's own - so the
	// danger row is what ships, and the fix cannot have softened it.
	const state = applyEvent(EMPTY_TRANSCRIPT, endFrame("c-honest"), ARRIVAL, {
		userStoppedAt: null,
	});
	const row = ranRow(state, "c-honest");
	assert.equal(row.stopped, false);
	assert.equal(
		row.isError,
		true,
		"a failure with no stop to answer it stays danger",
	);
});

test("a born row whose event reports success keeps its own outcome", () => {
	// The second arm's other half: the accusation it answers exists only when
	// the event would paint danger, so a success is never overwritten by a
	// stop fact that is standing only because of SOME call in the window.
	const state = applyEvent(
		EMPTY_TRANSCRIPT,
		endFrame("c-finished", {
			result: { content: [{ type: "text", text: "done" }], is_error: false },
			is_error: false,
		}),
		ARRIVAL,
		{ userStoppedAt: STOP_PRESSED_AT },
	);
	const row = ranRow(state, "c-finished");
	assert.equal(row.stopped, false, "a reported result is not an interruption");
	assert.equal(row.isError, false);
});

test("a row that was running at the press is still classified by its clock", () => {
	// ARM ONE, preserved: a call this viewer watched start, whose start is not
	// after the press, is the call the interrupt killed.
	let state = applyEvent(EMPTY_TRANSCRIPT, startedFrame("c-watched"), ARRIVAL);
	assert.equal(ranRow(state, "c-watched").startedAt, expectedStart);
	state = applyEvent(state, endFrame("c-watched"), ARRIVAL + 1_000, {
		userStoppedAt: STOP_PRESSED_AT,
	});
	const row = ranRow(state, "c-watched");
	assert.equal(row.stopped, true);
	assert.equal(row.isError, false);
});

test("a clock AFTER the press is not a stop's doing, and keeps its danger", () => {
	// ARM ONE'S DIRECTION, pinned so a future edit cannot widen it: a call
	// that started after the press (it cannot in a real turn, but the guard is
	// a comparison) is not the killed call, and its failure is its own.
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		startedFrame("c-late", { started_at_epoch: START_EPOCH + 120 }),
		ARRIVAL,
	);
	state = applyEvent(state, endFrame("c-late"), ARRIVAL + 1_000, {
		userStoppedAt: STOP_PRESSED_AT,
	});
	const row = ranRow(state, "c-late");
	assert.equal(row.stopped, false);
	assert.equal(row.isError, true);
});

/* ---------------------------------------------------------------------- *
 * The durable row's own half of the same decision (UX round 2, U15).
 *
 * Durable rows WIN over the live record with the same id, and this app
 * reconciles a page after a turn ends - so the live classification above is
 * overwritten within the same second unless the page's projection can read the
 * same fact. It can: the runtime classifies WHY a call ended badly and stores
 * `provider_payload.details.__fault` with the result (`harness/types.py`'s
 * `FAULT_KEY`; `aborted` beside `execution` and the model faults), measured on
 * the branch's rig session as `{"__fault": "aborted", "__synthetic": true}`
 * on an Esc-killed call's stored entry. These three cases pin the mapping and
 * the composed order the app actually takes (live event, then the page).
 * ---------------------------------------------------------------------- */

/** The durable entry for a killed call, in the shape the route stores it. */
const durableToolEntry = (over = {}) => ({
	id: "7944f05143004a23bd5c71d4359c509b",
	ts: START_EPOCH + 2,
	type: "message",
	payload: {
		kind: "message",
		role: "tool",
		content: [{ text: "aborted" }],
		tool_call_id: "c-killed",
		tool_name: "bash",
		is_error: true,
		provider_payload: {
			details: { __fault: "aborted", __synthetic: true },
			duration_s: 0.49940745800267905,
		},
		...over,
	},
});

test("a durable row the runtime marked aborted reads stopped, not failed", () => {
	const state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf([durableToolEntry()]),
	);
	const row = ranRow(state, "c-killed");
	assert.equal(
		row.stopped,
		true,
		"the runtime's own `aborted` fault is the durable half of the stop fact",
	);
	assert.equal(row.isError, false);
	assert.equal(
		row.durationS,
		0.49940745800267905,
		"the duration beside the marker is still the backend's own measurement",
	);
});

test("a durable failure without the abort marker keeps its danger", () => {
	// The override is ONE fault class, not "is_error is never trusted": an
	// execution fault is the tool's own failure and keeps the loud ink.
	const state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf([
			durableToolEntry({
				is_error: true,
				provider_payload: { details: { __fault: "execution" } },
			}),
		]),
	);
	const row = ranRow(state, "c-killed");
	assert.equal(row.stopped, false);
	assert.equal(row.isError, true);
});

test("the live classification survives the reconcile that follows it", () => {
	// THE ORDER THE APP TAKES, composed: the end event lands first (with the
	// press's fact standing) and the page reconciles right after. Before the
	// durable half of the fix, the second step flipped the row back to
	// `failed` - the reading the rig reproduced on the built app.
	let state = applyEvent(EMPTY_TRANSCRIPT, endFrame("c-killed"), ARRIVAL, {
		userStoppedAt: STOP_PRESSED_AT,
	});
	assert.equal(ranRow(state, "c-killed").stopped, true);
	state = applyHistoryPage(state, pageOf([durableToolEntry()]));
	const row = ranRow(state, "c-killed");
	assert.equal(
		row.stopped,
		true,
		"the page must not re-accuse the stopped call",
	);
	assert.equal(row.isError, false);
});

/* ---------------------------------------------------------------------- *
 * `skipped` joins `aborted`: the interrupted class is TWO kinds (interrupted
 * vs failed workstream, and the operator's own case).
 *
 * The steering skip stores a synthetic result marked `details.__fault:
 * "skipped"` (`loop.py`'s `_synthetic_result(... details={FAULT_KEY:
 * FAULT_SKIPPED})`), and the live compose path announces the same class as
 * `not_run_kind` on the terminal never-run frame. Both readings share ONE rule
 * (`isInterruptedFault`), and these cases pin the rule and its BOUNDARY: every
 * other fault class - the tool's own `execution` failure and the model's
 * planning faults - keeps the danger row, because those ARE failures.
 * ---------------------------------------------------------------------- */

test("a durable row the runtime marked skipped reads interrupted, not failed", () => {
	// THE OPERATOR'S CASE, from the wire fact rather than from the words: before
	// this half of the fix the row kept `isError`, painted the `failed` word and
	// expanded under an `Error` label - what the report photographed.
	const state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf([
			durableToolEntry({
				tool_call_id: "c-skipped",
				content: [{ text: "Tool call skipped: interrupted by steering." }],
				provider_payload: {
					details: { __fault: "skipped", __synthetic: true },
					duration_s: 0.5,
				},
			}),
		]),
	);
	const row = ranRow(state, "c-skipped");
	assert.equal(row.stopped, true, "an interrupt, not a result");
	assert.equal(row.isError, false, "and the danger ink is cleared with it");
	assert.equal(
		row.durationS,
		0.5,
		"the backend's own measurement is kept, as for an abort",
	);
	assert.equal(
		row.output,
		"Tool call skipped: interrupted by steering.",
		"the harness's words stay one expansion away",
	);
});

test("only the two interrupted kinds flip: every other fault class keeps its danger", () => {
	// The boundary is a CONSCIOUS LIST, not "any fault": pinned as a loop so an
	// edit that widens `isInterruptedFault` moves this list rather than one
	// example, and a future core's new value defaults to the failure treatment
	// (the safe direction) until it is added here.
	for (const fault of [
		"execution",
		"unknown_tool",
		"invalid_arguments",
		"duplicate_id",
		"denied",
		"gate_failed",
	]) {
		const state = applyHistoryPage(
			EMPTY_TRANSCRIPT,
			pageOf([
				durableToolEntry({
					tool_call_id: `c-${fault}`,
					provider_payload: { details: { __fault: fault } },
				}),
			]),
		);
		const row = ranRow(state, `c-${fault}`);
		assert.equal(row.stopped, false, `${fault} is not an interrupt`);
		assert.equal(row.isError, true, `${fault} keeps the danger row`);
	}
});

test("the end event's own fault marker classifies the row with no stop press", () => {
	/*
	 * THE WIRE'S OWN STATEMENT, for a viewer that never saw the press: the
	 * runtime writes WHY the call ended into `result.details.__fault` - the same
	 * marker the durable row reads - and `userStoppedAt` is null here, so the
	 * client-side stop window is nowhere in this test. The duration the backend
	 * measured is kept beside the classification.
	 */
	const endedWith = (callId, fault) =>
		endFrame(callId, {
			result: {
				content: [{ type: "text", text: "aborted" }],
				is_error: true,
				details: { __fault: fault, __synthetic: true },
			},
		});
	for (const fault of ["aborted", "skipped"]) {
		let state = applyEvent(
			EMPTY_TRANSCRIPT,
			startedFrame(`c-wire-${fault}`),
			ARRIVAL,
		);
		state = applyEvent(
			state,
			endedWith(`c-wire-${fault}`, fault),
			ARRIVAL + 1_000,
		);
		const row = ranRow(state, `c-wire-${fault}`);
		assert.equal(
			row.stopped,
			true,
			`the end frame's \`${fault}\` marker is the verdict`,
		);
		assert.equal(row.isError, false, "and the danger ink yields to it");
		assert.equal(row.durationS, 0.8, "the measured duration is kept");
	}
	// And a genuine execution fault is NOT: the danger row stays.
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		startedFrame("c-wire-fail"),
		ARRIVAL,
	);
	state = applyEvent(
		state,
		endFrame("c-wire-fail", {
			result: {
				content: [{ type: "text", text: "boom" }],
				is_error: true,
				details: { __fault: "execution" },
			},
		}),
		ARRIVAL + 1_000,
	);
	const failed = ranRow(state, "c-wire-fail");
	assert.equal(failed.stopped, false);
	assert.equal(failed.isError, true);
});

test("a compose verdict's kind rides the record, and an absent kind changes nothing", () => {
	/*
	 * THE NEW FIELD'S CONTRACT. The terminal never-run frame states the class
	 * (`skipped`, the operator's case, or `aborted`); a frame from a core that
	 * predates the field states nothing, and that has to mean TODAY'S not-run
	 * row rather than a new class - the tolerance the UI ships both ways.
	 */
	const settle = (over) =>
		applyEvent(
			EMPTY_TRANSCRIPT,
			{
				type: "tool_call_compose",
				tool_call_id: "c-kind",
				tool_name: "bash",
				argument_bytes: 64,
				...over,
			},
			1,
		);
	const skipped = settle({
		dictation_complete: true,
		not_run_reason: "Tool call skipped: interrupted by steering.",
		not_run_kind: "skipped",
	});
	assert.equal(ranRow(skipped, "c-kind").notRunKind, "skipped");
	assert.equal(
		ranRow(skipped, "c-kind").notRunReason,
		"Tool call skipped: interrupted by steering.",
		"the reason is still the harness's own words",
	);
	const abortedKind = settle({
		dictation_complete: true,
		not_run_reason: "The turn ended before this call ran.",
		not_run_kind: "aborted",
	});
	assert.equal(ranRow(abortedKind, "c-kind").notRunKind, "aborted");
	// A legacy producer states no kind at all, and a dictation frame never does.
	const legacy = settle({
		dictation_complete: true,
		not_run_reason: "The turn ended before this call ran.",
	});
	assert.equal(ranRow(legacy, "c-kind").notRunKind, null);
	assert.equal(
		ranRow(legacy, "c-kind").notRunReason,
		"The turn ended before this call ran.",
	);
	const dictating = settle({ dictation_complete: false });
	assert.equal(ranRow(dictating, "c-kind").notRunKind, null);
	assert.equal(ranRow(dictating, "c-kind").notRunReason, null);
});

test("a winning twin's start clears the kind with the reason", () => {
	// The two-calls-one-id case: the parked row carried a verdict (here
	// `skipped`), then the twin's start revives the same id. The execution
	// retires the verdict, and the kind must go with it - a row that kept
	// classifying as interrupted while a tool is visibly running would be the
	// same two-readings-one-call defect the fix removes.
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "tool_call_compose",
			tool_call_id: "c-twin",
			tool_name: "bash",
			argument_bytes: 8,
			dictation_complete: true,
			not_run_reason: "Tool call skipped: interrupted by steering.",
			not_run_kind: "skipped",
		},
		1,
	);
	assert.equal(ranRow(state, "c-twin").notRunKind, "skipped");
	state = applyEvent(
		state,
		{
			type: "tool_execution_start",
			tool_call_id: "c-twin",
			tool_name: "bash",
			args: { command: "echo hi" },
		},
		2,
	);
	const row = ranRow(state, "c-twin");
	assert.equal(row.phase, "running", "the twin's execution revives the row");
	assert.equal(row.notRunReason, null, "and retires the verdict's reason");
	assert.equal(row.notRunKind, null, "with its class");
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
	// And so do the COUNTERS. This used to pin `[0, 0]` as known behaviour — the
	// counts were read straight out of `details`, so a stripped frame zeroed them
	// while the body beside them survived — and that asymmetry is exactly the
	// reported `edit` row with a diff and no `+N -M`. One guard now covers both
	// (`preferDiffCounts`).
	assert.deepEqual([row.added, row.removed], [2, 1]);
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

	// The ordinary tail when there is no gap, and 3.25 entries per named call
	// above it, rounded UP to the integer the route takes. The ratio is measured
	// rather than derived (see `RECONCILE_ENTRIES_PER_CALL`): a real round writes
	// an assistant row, a result AND a `session_spend.v1` row, plus the odd
	// state row, so 2 per call reached the oldest missing call on 15.7% of
	// simulated joins and 3.25 reaches it on 96.4%.
	assert.equal(reconcileLimit(0), 100);
	assert.equal(reconcileLimit(1), 104);
	assert.equal(reconcileLimit(50), 263);
	assert.equal(reconcileLimit(68), 321);
	// Clamped to the backend's own ceiling, where asking for more is a 422.
	assert.equal(reconcileLimit(100), 425);
	assert.equal(reconcileLimit(124), 500);
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

/* ------------------------------- a pending echo against the load window */

/*
 * The operator's report (2026-09-26): "sometimes after sending a message,
 * additional messages will load and my message ends up out of order", caught
 * in a screenshot as the just-sent bubble ABOVE assistant content that
 * preceded it.
 *
 * #534's `monotonicStamp` bounds an echo against rows painted AT STAMP TIME.
 * These pin the residual the load window adds: the page (or seed) is still
 * OWED when the message is sent — over nothing, over a painted cache, over a
 * notice-only transcript alike — and it lands AFTER the echo carrying rows
 * whose stamps sit ahead of the echo's. #534's own comment names that clock
 * ("a remote owner, or any client whose clock trails"); what it cannot bound
 * is a row that arrives after the stamp and states a later time while
 * chronologically preceding the send.
 *
 * The rule these pin, and the reason it is the right one (review round 1, F1
 * through F3): while the owner has stated no position for the row, no client
 * clock comparison can decide it — the two stamps come from different clocks,
 * and a row landing later can exceed any cap the echo borrowed. So EVERY
 * echo holds the tail position it was admitted at (admission is not "empty
 * transcript": a few cached rows or a notice-only transcript state no owner
 * time either), rows admitted while it holds keep its tail block, and only
 * an owner-stamped row naming the id — the durable page row, not a live
 * `message_start` merely restating the message — ends the hold and returns
 * the row to the canonical order.
 */
const CLIENT_NOW = 1_790_000_000_000;
// The owner's clock, ahead of the client's: the skew condition itself.
const OWNER_AHEAD_MS = 20_000;

/** One durable page entry, stamped on the owner's clock. */
const aheadEntry = (id, tsMs, text) => ({
	id,
	ts: tsMs / 1000,
	type: "message",
	payload: { kind: "message", ...assistant(id, text) },
});

/** One durable page entry for a USER row, stamped on the owner's clock. */
const aheadUserEntry = (id, tsMs, text) => ({
	id,
	ts: tsMs / 1000,
	type: "message",
	payload: { kind: "message", ...user(id, text) },
});

test("a locally stamped echo cannot be displaced by a page that lands after the send", () => {
	const requestId = "b2b1f0d4-0a3a-4b1e-9c1d-7f5a2e6c9a10";
	// The send happens while the page is still owed, so the echo is stamped
	// with the client's own clock and nothing else is painted.
	let state = appendPendingUser(
		state0(),
		requestId,
		"first message",
		[],
		CLIENT_NOW,
	);
	// The owed page lands: a row the owner stamps ahead of the client's clock,
	// written before the send.
	state = applyHistoryPage(state, {
		entries: [aheadEntry("a1", CLIENT_NOW + OWNER_AHEAD_MS, "an older answer")],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		state.records.map((r) => r.id),
		["a1", requestId],
		"the echo stays after the row that preceded it",
	);
	// And the reconcile page that follows must not move it either.
	state = applyHistoryPage(state, {
		entries: [aheadEntry("a2", CLIENT_NOW + OWNER_AHEAD_MS * 2, "later still")],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		state.records.map((r) => r.id),
		["a1", "a2", requestId],
		"no page that lands later can place the echo above rows it followed",
	);
});

test("a snapshot seed's raw start joins the block under a held send", () => {
	const requestId = "0c9f1e2a-6d4b-4a7e-8f3c-2b5d9e1a4c70";
	let state = appendPendingUser(
		state0(),
		requestId,
		"sent while loading",
		[],
		CLIENT_NOW,
	);
	/*
	 * The snapshot's seed lands after the echo and dates a call the turn in
	 * flight had already made — stamped on the owner's ahead clock. Under the
	 * closure rule a RAW start cannot claim which side of the held send it is
	 * on: its own instant is not a row the echo follows, so it is admitted at
	 * that instant and JOINS THE BLOCK — the echo leads, and the call sits under
	 * it until a page states it.
	 */
	state = applyLiveSeed(
		state,
		{
			streaming: true,
			generation: 1,
			live_events: [
				{
					type: "tool_execution_start",
					tool_call_id: "c-seed",
					started_at_epoch: (CLIENT_NOW + OWNER_AHEAD_MS) / 1000,
				},
			],
		},
		CLIENT_NOW + 10_000,
	);
	const ids = state.records.map((r) => r.id);
	assert.deepEqual(
		ids,
		[requestId, "tool:c-seed"],
		"the echo leads; the raw start joins the block instead of claiming a time",
	);
	assert.equal(
		ids.filter((id) => id === "tool:c-seed").length,
		1,
		"the seeded row painted once",
	);
});

test("a restating message_start does not end the hold; the durable row returns the echo to order", () => {
	const requestId = "7f3a2c1e-8b5d-4e6f-9a0b-1c2d3e4f5a6b";
	let state = appendPendingUser(
		state0(),
		requestId,
		"first message",
		[],
		CLIENT_NOW,
	);
	state = applyHistoryPage(state, {
		entries: [aheadEntry("a1", CLIENT_NOW + OWNER_AHEAD_MS, "an older answer")],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		state.records.map((r) => r.id),
		["a1", requestId],
	);
	/*
	 * The owner echoes the message back on its own stream (a reconnect's
	 * replay folds these frames BEFORE the snapshot's page - review round 1,
	 * F2). Delivery is now the owner's, so `local` clears - that flag is the
	 * store's own delivered read (`peekLocalEcho`) - but the POSITION is
	 * still unstated: the swap must not re-stamp the row onto the client
	 * clock and must not end the hold, or the page that follows would sort
	 * the echo above its pre-send rows (the retired case asserted exactly
	 * that lifted order as correct).
	 */
	state = applyEvent(
		state,
		{ type: "message_start", message: user(requestId, "first message") },
		CLIENT_NOW + 3_000,
	);
	const restated = state.records.find((r) => r.id === requestId);
	assert.equal(
		restated.local,
		undefined,
		"the live echo is the owner's for delivery",
	);
	assert.equal(
		restated.provisional,
		true,
		"but its position is still the owner's to state",
	);
	assert.deepEqual(
		state.records.map((r) => r.id),
		["a1", requestId],
		"the restating frame does not lift the echo onto the client clock",
	);
	state = applyHistoryPage(state, {
		entries: [aheadEntry("a2", CLIENT_NOW + OWNER_AHEAD_MS * 2, "later still")],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		state.records.map((r) => r.id),
		["a1", "a2", requestId],
		"rows that land after the send never displace it",
	);
	// The owner states the position in the end: the durable row carries its
	// own stamp (between a1's and a2's) and replaces the echo, which sorts
	// there like any canonical row.
	state = applyHistoryPage(state, {
		entries: [
			aheadUserEntry(
				requestId,
				CLIENT_NOW + OWNER_AHEAD_MS + 5_000,
				"first message",
			),
		],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		state.records.map((r) => r.id),
		["a1", requestId, "a2"],
		"the durable row returns it to the canonical order",
	);
});

test("two echoes admitted in the load window both hold, in arrival order", () => {
	let state = appendPendingUser(state0(), "req-A", "first", [], CLIENT_NOW);
	state = appendPendingUser(state, "req-B", "second", [], CLIENT_NOW + 500);
	state = applyHistoryPage(state, {
		entries: [aheadEntry("a1", CLIENT_NOW + OWNER_AHEAD_MS, "older")],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		state.records.map((r) => r.id),
		["a1", "req-A", "req-B"],
		"no later row may place either echo above a row that preceded it",
	);
	state = applyHistoryPage(state, {
		entries: [aheadEntry("a2", CLIENT_NOW + OWNER_AHEAD_MS * 2, "later")],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		state.records.map((r) => r.id),
		["a1", "a2", "req-A", "req-B"],
		"and the second page cannot either",
	);
});

test("an echo admitted over a painted cache is held against the owed page (+2s)", () => {
	// The QA cell-2 residual: the cache gives the echo a borrowed slot, but
	// the owed page's row is journaled before the send and dated past any cap
	// the echo could take — a cap cannot bound a row that lands after it
	// (review round 1, F1) — so the echo holds instead.
	let state = applyHistoryPage(state0(), {
		entries: [aheadEntry("c1", CLIENT_NOW - 300_000, "cached")],
		has_more: false,
		cursor_missing: false,
	});
	state = appendPendingUser(state, "req-cache", "hello", [], CLIENT_NOW);
	state = applyHistoryPage(state, {
		entries: [
			aheadEntry("o1", CLIENT_NOW + 2_000, "row journaled before the send"),
		],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		state.records.map((r) => r.id),
		["c1", "o1", "req-cache"],
		"the owed row holds above the echo, not below it",
	);
	// And the merges after it must not show the correction jump QA cell 2
	// logged: the live echo states delivery only, and the next page keeps
	// the order.
	state = applyEvent(
		state,
		{ type: "message_start", message: user("req-cache", "hello") },
		CLIENT_NOW + 3_000,
	);
	state = applyHistoryPage(state, {
		entries: [aheadEntry("n1", CLIENT_NOW - 500, "a later landing row")],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		state.records.map((r) => r.id),
		["c1", "n1", "o1", "req-cache"],
		"no correction jump: the echo was never above the owed row",
	);
});

test("an echo admitted over a painted cache is held against the owed page (+40s)", () => {
	let state = applyHistoryPage(state0(), {
		entries: [aheadEntry("c1", CLIENT_NOW - 300_000, "cached")],
		has_more: false,
		cursor_missing: false,
	});
	state = appendPendingUser(state, "req-cache2", "hello", [], CLIENT_NOW);
	state = applyHistoryPage(state, {
		entries: [
			aheadEntry("o1", CLIENT_NOW + 40_000, "row journaled before the send"),
		],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		state.records.map((r) => r.id),
		["c1", "o1", "req-cache2"],
		"the wider the skew, the further past any borrowed cap the owed row sits",
	);
});

test("a seed's raw start cannot cross a held send; the page that states it returns it to its time", () => {
	let state = applyHistoryPage(state0(), {
		entries: [aheadEntry("c1", CLIENT_NOW - 300_000, "cached")],
		has_more: false,
		cursor_missing: false,
	});
	state = appendPendingUser(state, "req-cache3", "hello", [], CLIENT_NOW);
	state = applyLiveSeed(
		state,
		{
			streaming: true,
			generation: 1,
			live_events: [
				{
					type: "tool_execution_start",
					tool_call_id: "c-seed",
					started_at_epoch: (CLIENT_NOW + OWNER_AHEAD_MS) / 1000,
				},
			],
		},
		CLIENT_NOW + 1_000,
	);
	assert.deepEqual(
		state.records.map((r) => r.id),
		["c1", "req-cache3", "tool:c-seed"],
		"a raw start joins the block under the echo — the same compromise a replay frame takes",
	);
	/*
	 * THE HOLD'S END RETURNS IT TO ITS STATED TIME. The durable row for the
	 * send ends the hold (carriage), the block dissolves, and the call's own
	 * instant — journaled BEFORE the send, as F1's original read had it — sorts
	 * it back above the echo. The under-echo stay was the block being honest
	 * about an unprovable position, not a re-dating.
	 */
	state = applyHistoryPage(state, {
		entries: [
			aheadUserEntry(
				"req-cache3",
				CLIENT_NOW + OWNER_AHEAD_MS + 5_000,
				"hello",
			),
		],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		state.records.map((r) => r.id),
		["c1", "tool:c-seed", "req-cache3"],
		"the send's own row ends the hold and the call returns to its stated time",
	);
});

test("a notice-only transcript does not anchor the owner clock, so the echo still holds", () => {
	// A renderer-local notice (a move receipt, a recovery line) is minted from
	// the CLIENT clock: it is non-empty, but it states no owner time for a
	// later page to sort against (review round 1, F3).
	let state = appendLocalNote(
		state0(),
		"a first local notice",
		"info",
		CLIENT_NOW,
	);
	const noticeId = state.records[0].id;
	state = appendPendingUser(state, "req-7", "hello", [], CLIENT_NOW + 1);
	state = applyHistoryPage(state, {
		entries: [
			aheadEntry("g1", CLIENT_NOW + 15_000, "row journaled before the send"),
		],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		state.records.map((r) => r.id),
		[noticeId, "g1", "req-7"],
		"the owed row holds above the echo",
	);
});

test("a live answer arriving while the echo holds does not land above it", () => {
	// The symmetric arm of review round 1's F2: a genuinely post-send row
	// admitted while the echo is unresolved must stay under it (base's
	// [req-1, ans-1] may not regress to [ans-1, req-1]), and the page that
	// follows keeps it there: [...pre-send, req, ans].
	let state = appendPendingUser(state0(), "req-1", "sent now", [], CLIENT_NOW);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistant("ans-1", "") },
		CLIENT_NOW + 3_000,
	);
	assert.deepEqual(
		state.records.map((r) => r.id),
		["req-1", "ans-1"],
		"the answer arrives under the question",
	);
	state = applyHistoryPage(state, {
		entries: [
			aheadEntry("a-old", CLIENT_NOW + OWNER_AHEAD_MS, "an older answer"),
		],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		state.records.map((r) => r.id),
		["a-old", "req-1", "ans-1"],
		"pre-send rows hold above the echo, and the answer holds under it",
	);
});

test("a page that carries the echo's own row settles it into the canonical order", () => {
	let state = appendPendingUser(
		state0(),
		"req-9",
		"first message",
		[],
		CLIENT_NOW,
	);
	state = applyHistoryPage(state, {
		entries: [aheadEntry("a1", CLIENT_NOW + OWNER_AHEAD_MS, "older")],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		state.records.map((r) => r.id),
		["a1", "req-9"],
	);
	state = applyHistoryPage(state, {
		entries: [aheadEntry("a2", CLIENT_NOW + OWNER_AHEAD_MS * 2, "later still")],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		state.records.map((r) => r.id),
		["a1", "a2", "req-9"],
	);
	// The owner's own row for the echo arrives: it replaces the record (no
	// duplication) and takes its place by its own stamp, between the rows the
	// pages brought.
	state = applyHistoryPage(state, {
		entries: [
			aheadUserEntry(
				"req-9",
				CLIENT_NOW + OWNER_AHEAD_MS + 5_000,
				"first message",
			),
		],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		state.records.map((r) => r.id),
		["a1", "req-9", "a2"],
		"the echo's own durable row settles it where the owner put it",
	);
	const settled = state.records.find((r) => r.id === "req-9");
	assert.equal(settled.local, undefined);
	assert.equal(settled.provisional, undefined);
});

/*
 * THE CLOSURE RULE (operator report, 2026-10-06). A merge may place a row on
 * the owner's side of a held send only when the merge itself is closed over
 * the send: it carries the echo's own durable row (CARRIAGE), or it is a
 * CONTIGUOUS owner window (a page read). A `history_delta` is neither — it is
 * a set FILTERED by "rows that were never streamed here", so it can carry the
 * answer of the send's own turn while the send's row (streamed live, and so
 * excluded from the filter) is absent. Before the rule its rows were lifted
 * above the echo and the whole answer rendered above its question, live-only,
 * healed by a remount. These pin the block, the carriage path that ends it,
 * the convergence, and the seed's anchor split.
 */

test("a history_delta's answer cannot stand above the held send that prompted it", () => {
	/*
	 * THE OPERATOR'S OWN SHAPE, as the reducer sees it: a remote create/attach
	 * joins the peer's turn MID-FLIGHT, so the send was streamed live (a
	 * `message_start`) and the answer was not — and when the delta arrives, the
	 * FILTER excludes the send's row and carries the answer. Base lifted the
	 * delta's rows above the echo (`ownerIds`), rendering [answer, user,
	 * tool] — the photographed inversion. The closure rule forfeits the lift,
	 * so the answer joins the block and the order is the arrival the viewer
	 * watched: user, tool, answer.
	 */
	let state = appendPendingUser(
		state0(),
		"req-1",
		"what is your OS?",
		[],
		CLIENT_NOW,
	);
	state = applyEvent(
		state,
		{ type: "message_start", message: user("req-1", "what is your OS?") },
		CLIENT_NOW + 1_000,
	);
	state = applyEvent(
		state,
		startedFrame("call-1", { started_at_epoch: (CLIENT_NOW + 2_000) / 1000 }),
		CLIENT_NOW + 2_000,
	);
	state = applyEvent(
		state,
		{ type: "history_delta", messages: [assistant("ans-1", "Amazon Linux")] },
		CLIENT_NOW + 8_000,
	);
	assert.deepEqual(
		state.records.map((r) => r.id),
		["req-1", "tool:call-1", "ans-1"],
		"the answer stays under the question it answers",
	);
});

test("a delta that names the echo's own id ends the hold in the same merge", () => {
	let state = appendPendingUser(state0(), "req-2", "sent now", [], CLIENT_NOW);
	state = applyEvent(
		state,
		{
			type: "history_delta",
			messages: [user("req-2", "sent now"), assistant("ans-2", "the answer")],
		},
		CLIENT_NOW + 8_000,
	);
	const held = state.records.find((r) => r.id === "req-2");
	assert.equal(
		held.provisional,
		undefined,
		"the durable row ended the hold in the merge that carried it (carriage)",
	);
	assert.deepEqual(
		state.records.map((r) => r.id),
		["req-2", "ans-2"],
		"and the rows keep the order the reader first admitted them in",
	);
});

test("the page that states the send converges a blocked answer to the owner's order", () => {
	let state = appendPendingUser(state0(), "req-3", "sent now", [], CLIENT_NOW);
	state = applyEvent(
		state,
		{ type: "history_delta", messages: [assistant("ans-3", "the answer")] },
		CLIENT_NOW + 8_000,
	);
	assert.deepEqual(
		state.records.map((r) => r.id),
		["req-3", "ans-3"],
		"the answer is blocked under the echo, not lifted above it",
	);
	/*
	 * The contiguous window that carries the send — the snapshot's history, a
	 * tail or reconcile read — states both rows at one serve instant, which
	 * ends the hold and sorts them by the order the reader first admitted
	 * them.
	 */
	state = applyHistoryPage(state, {
		entries: [
			aheadUserEntry("req-3", CLIENT_NOW + 9_000, "sent now"),
			aheadEntry("ans-3", CLIENT_NOW + 9_000, "the answer"),
		],
		has_more: false,
		cursor_missing: false,
	});
	assert.equal(
		state.records.find((r) => r.id === "req-3").provisional,
		undefined,
	);
	assert.deepEqual(
		state.records.map((r) => r.id),
		["req-3", "ans-3"],
		"the window restores the order the filter could not state",
	);
});

test("a seeded settle anchored to a pre-echo composing row holds above a held send", () => {
	const composer = assistant("composer-A", "");
	composer.tool_calls = [
		{ id: "call-A", name: "bash", arguments: { command: "uname" } },
	];
	let state = applyHistoryPage(state0(), {
		entries: [
			messageEntry("composer-A", (CLIENT_NOW + OWNER_AHEAD_MS) / 1000, {
				kind: "message",
				...composer,
			}),
		],
		has_more: false,
		cursor_missing: false,
	});
	state = appendPendingUser(state, "req-A", "sent now", [], CLIENT_NOW + 1_000);
	state = applyLiveSeed(
		state,
		{
			streaming: true,
			generation: 1,
			live_events: [
				{
					type: "tool_execution_end",
					tool_call_id: "call-A",
					tool_name: "bash",
					result: {
						content: [{ type: "text", text: "Linux" }],
						is_error: false,
					},
					is_error: false,
					duration_s: 1.2,
				},
			],
		},
		CLIENT_NOW + 5_000,
	);
	assert.deepEqual(
		state.records.map((r) => r.id),
		["composer-A", "tool:call-A", "req-A"],
		"the anchor sits in the journal in front of the send, so the settle keeps the owner's side",
	);
});

test("a seeded settle whose composing row sits past the frontier joins the block", () => {
	const composer = assistant("composer-B", "");
	composer.tool_calls = [
		{ id: "call-B", name: "bash", arguments: { command: "uname" } },
	];
	let state = appendPendingUser(state0(), "req-B", "sent now", [], CLIENT_NOW);
	state = applyEvent(
		state,
		// The composing row arrives through the FILTERED door, so it stands
		// inside the block while the echo holds.
		{ type: "history_delta", messages: [composer] },
		CLIENT_NOW + 3_000,
	);
	state = applyLiveSeed(
		state,
		{
			streaming: true,
			generation: 1,
			live_events: [
				{
					type: "tool_execution_end",
					tool_call_id: "call-B",
					tool_name: "bash",
					result: {
						content: [{ type: "text", text: "Linux" }],
						is_error: false,
					},
					is_error: false,
					duration_s: 1.2,
				},
			],
		},
		CLIENT_NOW + 5_000,
	);
	assert.deepEqual(
		state.records.map((r) => r.id),
		["req-B", "composer-B", "tool:call-B"],
		"a settle may not stand on a claim its anchor cannot make",
	);
});

test("re-applying any closure merge changes no order", () => {
	let state = appendPendingUser(state0(), "req-5", "sent now", [], CLIENT_NOW);
	const delta = {
		type: "history_delta",
		messages: [assistant("ans-5", "the answer")],
	};
	state = applyEvent(state, delta, CLIENT_NOW + 8_000);
	const once = state.records.map((r) => r.id);
	state = applyEvent(state, delta, CLIENT_NOW + 8_100);
	assert.deepEqual(
		state.records.map((r) => r.id),
		once,
		"the same delta twice is the same order",
	);
	const page = {
		entries: [aheadEntry("a-5", CLIENT_NOW - 100_000, "older")],
		has_more: false,
		cursor_missing: false,
	};
	state = applyHistoryPage(state, page);
	const twice = state.records.map((r) => r.id);
	state = applyHistoryPage(state, page);
	assert.deepEqual(
		state.records.map((r) => r.id),
		twice,
		"the same page twice is the same order",
	);
	const seed = {
		streaming: true,
		generation: 1,
		live_events: [
			startedFrame("call-5", { started_at_epoch: (CLIENT_NOW + 1_000) / 1000 }),
		],
	};
	state = applyLiveSeed(state, seed, CLIENT_NOW + 2_000);
	const thrice = state.records.map((r) => r.id);
	state = applyLiveSeed(state, seed, CLIENT_NOW + 2_100);
	assert.deepEqual(
		state.records.map((r) => r.id),
		thrice,
		"the same seed twice is the same order",
	);
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

test("a send tool call projects to a tool row the filter can name by its tool", () => {
	/*
	 * `cross-session-visibility.ts` keys its hidden set on the RECORD fields the
	 * reducer mints, so both halves of that key are pinned here — the filter's
	 * literal cannot drift from its producer:
	 *
	 *  - a durable page entry whose `tool_name` is `send` (role "tool") reads
	 *    back as `kind: "tool"` with `toolName` exactly `send`;
	 *  - the live `tool_execution_start` for the same call mints the same
	 *    fields.
	 *
	 * `send` is the registry's own literal (`local_operator/tools/registry.py`),
	 * and the desktop side spells it outside the filter in exactly one place
	 * besides this test: the TUI/mobile contract carries the identical string.
	 */
	const durable = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf([
			{
				id: "t1",
				ts: 20,
				type: "message",
				payload: {
					kind: "message",
					role: "tool",
					tool_call_id: "c-send",
					tool_name: "send",
					content: [{ type: "text", text: "delivered" }],
				},
			},
		]),
	);
	const [record] = durable.records;
	assert.equal(record.kind, "tool");
	assert.equal(record.toolName, "send");

	const live = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "tool_execution_start",
			tool_call_id: "c-send",
			tool_name: "send",
			args: { conversation: "other" },
		},
		21,
	);
	const liveRecord = live.records.find((row) => row.kind === "tool");
	assert.ok(liveRecord, "the live start mints a tool row");
	assert.equal(liveRecord.toolName, "send");
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

/*
 * A HIDDEN wake delivery paints nothing, on either door (first-run onboarding,
 * A4). Aida's greeting is triggered by a hidden wake whose text is addressed to
 * her; the operator's rule is that her conversation OPENS on her own message, so
 * neither a receipt nor a user row may stand above it. History load is
 * `applyHistoryPage`; the live arrival of a custom row is a `history_delta`
 * frame, which the core sends for it because a wake is never announced as a
 * user `message_start`. Her reply must still paint, first.
 */
test("a hidden wake delivery paints no row on history load or live, and her reply is first", () => {
	const trigger = {
		kind: "custom",
		custom_type: "wake_prompt",
		attribution: "user",
		details: {
			wake_id: "aida-greeting",
			hidden: true,
			text: "[first-run] surface=desktop; signed_in_with=radient",
		},
	};
	const reply = {
		role: "assistant",
		content: [{ type: "text", text: "Hi, I'm Aida." }],
	};
	const loaded = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf([
			messageEntry("w-hidden", 5, trigger),
			messageEntry("a-1", 6, reply),
		]),
	);
	assert.deepEqual(
		loaded.records.map((record) => [record.id, record.kind]),
		[["a-1", "assistant"]],
	);

	const live = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "history_delta",
			messages: [
				{ id: "w-hidden", ...trigger },
				{ id: "a-1", ...reply },
			],
		},
		10_000,
	);
	assert.deepEqual(
		live.records.map((record) => [record.id, record.kind]),
		[["a-1", "assistant"]],
	);

	// Fail-safe direction: only a JSON `true` hides. A truthy string is a
	// producer this build does not know, and a row it did not mean to hide shows.
	const shown = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf([
			messageEntry("w-2", 5, {
				...trigger,
				details: { ...trigger.details, hidden: "yes" },
			}),
		]),
	);
	assert.equal(shown.records.length, 1);
	assert.equal(shown.records[0].kind, "wake");
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

test("the MCP-unavailable warning puts the operator's remedy on the row, and discloses only the model's tail", () => {
	// The harness gives this its own record type instead of routing it through
	// `session_incident`: the classifier's `mcp` rule matches the row's own
	// subject, and the incident renderer's tail claims the previous TURN ended —
	// false for a server that failed to connect or whose grant expired, neither
	// of which ends a turn. The row has its own builder rather than membership of
	// INLINE_CUSTOM_TYPES, because it is the one statement whose second line is
	// addressed to the OPERATOR.
	const FIXTURE =
		"[session warning] MCP server 'minerva-qa' is unavailable: its tools are gone for now.\nReason: /mcp reauth minerva-qa — sign-in expired\nIts tools are not callable until the user restores it, and the agent should not retry them in a loop.";
	const TAIL =
		"Its tools are not callable until the user restores it, and the agent should not retry them in a loop.";
	const SENTENCE =
		"MCP server 'minerva-qa' is unavailable: its tools are gone for now.";
	const [row] = replay([
		custom("mcp-unavailable", "session_mcp_unavailable", { text: FIXTURE }),
	]);
	assert.equal(row.kind, "custom");
	assert.equal(
		row.level,
		"info",
		"a missing capability is not a failed turn, so it never takes the danger ink",
	);
	assert.equal(row.category, null, "only an incident carries a classification");
	assert.equal(row.provider, null, "and only an incident names a provider");
	// The leading bracket tag is a register marker, not content — the row's own
	// label already says what kind of row this is — so the headline starts at
	// the sentence. The remedy follows it: the fact alone says the tools are gone
	// and nothing about what brings them back, and `/mcp reauth <server>` is the
	// only clause anyone can act on (design round 1, D1). The harness writes that
	// clause COMMAND-FIRST so it cannot wrap away from its own command.
	assert.equal(
		row.headline,
		`${SENTENCE} Reason: /mcp reauth minerva-qa — sign-in expired`,
	);
	// What is behind the chevron is the MODEL's half and nothing else.
	assert.equal(row.detail, TAIL);
	// Nothing on the row may claim a turn ended. That false tail is the whole
	// reason the harness stopped emitting a `session_incident` here.
	assert.ok(!/previous turn ended/i.test(row.headline + (row.detail ?? "")));

	// A blank reason is OMITTED by the formatter, not printed empty: the row is
	// the sentence again, and it keeps its disclosure for the model's half.
	const [noReason] = replay([
		custom("mcp-unavailable-bare", "session_mcp_unavailable", {
			text: `[session warning] ${SENTENCE}\n${TAIL}`,
		}),
	]);
	assert.equal(noReason.headline, SENTENCE);
	assert.equal(noReason.detail, TAIL);

	// A reason the row cannot fit is HOISTED to its `/mcp …` clause — a plain
	// tail-cut would take the command off the line, which is the one thing the
	// hoist exists to keep. What the cut leaves out is disclosed, not dropped.
	const longReason =
		"Reason: /mcp reauth minerva-qa — sign-in expired; the credential store answered ECONNREFUSED 127.0.0.1:8787 and the token refresh loop gave up";
	const [hoisted] = replay([
		custom("mcp-unavailable-long", "session_mcp_unavailable", {
			text: `[session warning] ${SENTENCE}\n${longReason}\n${TAIL}`,
		}),
	]);
	assert.equal(hoisted.headline, `${SENTENCE} Reason: /mcp reauth minerva-qa`);
	assert.ok(
		hoisted.headline.length <= 160,
		`hoisted headline was ${hoisted.headline.length}`,
	);
	assert.match(
		hoisted.detail,
		/^— sign-in expired; the credential store answered/,
	);
	assert.ok(
		hoisted.detail.endsWith(TAIL),
		"the model's half survives the hoist",
	);

	// THE SHAPE THE HOIST EXISTS FOR, pinned (round 2, R5). The shipping reasons
	// are command-first, so for them a tail-cut costs the diagnostics — but a reason
	// whose LEADING CLAUSE runs long puts the command itself past the bound, and
	// there a tail-cut leaves the row quoting a cause and drops the only clause
	// anyone can run. Composed, this line runs 258 characters with the command at
	// char 237, so the two halves of that hazard are asserted as well as its repair:
	// the cut really would take the command, and the row does not cut it.
	const lateCommandReason =
		"Reason: the transport refused every attempt after the grant lapsed — ECONNREFUSED 127.0.0.1:8787, then a timeout, then a closed stream, and the store answered nothing. /mcp reauth minerva-qa";
	assert.equal(
		`${SENTENCE} ${lateCommandReason}`.slice(0, 160).includes("/mcp"),
		false,
		"this case must not be one the tail-cut would keep the command in",
	);
	const [lateCommand] = replay([
		custom("mcp-unavailable-late-command", "session_mcp_unavailable", {
			text: `[session warning] ${SENTENCE}\n${lateCommandReason}\n${TAIL}`,
		}),
	]);
	assert.equal(
		lateCommand.headline,
		`${SENTENCE} Reason: /mcp reauth minerva-qa`,
		"the command survives the bound even when everything before it does not",
	);
	assert.ok(
		lateCommand.headline.length <= 160,
		`late-command headline was ${lateCommand.headline.length}`,
	);
	assert.match(
		lateCommand.detail,
		/^the transport refused every attempt/,
		"the clause the cut dropped is disclosed, not dropped",
	);
	assert.ok(lateCommand.detail.endsWith(TAIL));

	// A reason that names no command has nothing to hoist, so the composed line
	// is bounded and the WHOLE reason is disclosed — the direction that hides
	// nothing, which is the one `firstSentenceEnd` errs in too.
	const [unhoistable] = replay([
		custom("mcp-unavailable-nocmd", "session_mcp_unavailable", {
			text: `[session warning] ${SENTENCE}\nReason: the transport refused every attempt — ECONNREFUSED 127.0.0.1:8787, then a timeout, then a closed stream, and no capabilities since\n${TAIL}`,
		}),
	]);
	assert.ok(unhoistable.headline.endsWith("…"));
	assert.match(
		unhoistable.detail,
		/^Reason: the transport refused every attempt/,
	);
	assert.ok(unhoistable.detail.endsWith(TAIL));
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
	/*
	 * CHANGED BY THE LOADER-CONTINUITY FIX (design spec 1.1 rule 4), and this is
	 * the one sanctioned change to a caller that passes no option. An ordinary
	 * (tail-type) read used to adopt the page's `has_more` unconditionally, which
	 * is how a re-applied newest page flipped a fully loaded conversation back to
	 * "load earlier". It now believes the page only when the page reaches
	 * STRICTLY OLDER than the stored cursor - a genuinely wider read.
	 */
	const ordinary = applyHistoryPage(loaded, page);
	assert.equal(
		ordinary.hasMore,
		false,
		"an ordinary read of a NEWER page leaves the paging state alone",
	);
	const wider = applyHistoryPage(loaded, {
		...pageOf([
			{
				id: "u-1",
				ts: at / 1000 - 5,
				type: "message",
				payload: { role: "user", content: "oldest" },
			},
		]),
		has_more: true,
	});
	assert.equal(
		wider.hasMore,
		true,
		"an ordinary read that reaches strictly older still believes the page",
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

/* ------------------------------------------------ the mid-stream join and gap */

/*
 * A1 AND THE SEED, ON THE PRODUCER THAT SHIPS.
 *
 * The desktop plane's one streamed token is one `message_update` whose `delta`
 * is the increment and whose `message.content` is EMPTY: the harness assembles
 * the text once, at the END of the call, for a measured memory reason
 * (`harness/loop.py`). Every UI that paints a turn therefore has to APPEND the
 * delta, and a viewer that joins a turn in flight has no prefix in hand at all —
 * neither from the frame nor from a start it never saw. The old join branch
 * built the row as `messageText(message) + delta`, which against this producer
 * is the last chunk presented as the whole answer: the reported "the message
 * starts mid-sentence". These cases pin the frame's own text, the honest mark
 * that goes with a prefix we do not have, and what clears it.
 */

test("a join paints the frame's own text, and marks the prefix it does not have", () => {
	// The producer's real shape, verbatim: `content: []`, one delta.
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "message_update",
			delta: "final-chunk",
			message: assistant("a1", ""),
		},
		1,
	);
	const joined = state.records.find((record) => record.id === "a1");
	assert.equal(joined.text, "final-chunk", "the frame's delta is the text");
	assert.equal(joined.streaming, true);
	assert.equal(
		joined.truncated,
		"prefix",
		"one chunk is not presented as the whole answer: the prefix is unknown",
	);

	// Deltas that follow still append, one per arrival, with no throttling.
	state = applyEvent(
		state,
		{ type: "message_update", delta: " more", message: assistant("a1", "") },
		2,
	);
	assert.equal(
		state.records.find((record) => record.id === "a1").text,
		"final-chunk more",
	);
	assert.equal(
		state.records.find((record) => record.id === "a1").truncated,
		"prefix",
		"and it stays marked until the whole text arrives",
	);

	// `message_end` carries the assembled text and is the one thing that ends the
	// claim: the row is now the whole message and says nothing about missing text.
	state = applyEvent(
		state,
		{ type: "message_end", message: assistant("a1", "the whole answer") },
		3,
	);
	const settled = state.records.find((record) => record.id === "a1");
	assert.equal(settled.text, "the whole answer");
	assert.equal(settled.streaming, false);
	assert.ok(
		!settled.truncated,
		"the authoritative end clears the mark rather than keeping a stale claim",
	);
});

test("a join against a producer that accumulates keeps the body, and marks nothing missing", () => {
	// The shape the old branch was written against: a producer that sends the
	// running text in the message. `body + delta` is the authoritative text and
	// the row is whole — the fix must not turn this into a truncation.
	const state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "message_update",
			delta: " tail",
			message: assistant("a1", "accumulated answer"),
		},
		1,
	);
	const row = state.records.find((record) => record.id === "a1");
	assert.equal(row.text, "accumulated answer tail");
	assert.ok(!row.truncated);
});

test("a frame that carries a body clears the mark it supplied the text for", () => {
	// R1-2 (code review round 1): the append path kept `truncated` when a frame
	// carried a body, so a row marked by an earlier gap kept its caption AFTER a
	// later frame supplied the whole running text — a claim that outlives the text
	// it qualifies, and false for as long as it lasts. The shipped producer sends
	// empty bodies mid-stream, so only the accumulating shape reaches this, which
	// is exactly the producer the branch is written to support.
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_update", delta: "chunk", message: assistant("a1", "") },
		1,
	);
	assert.equal(
		state.records.find((record) => record.id === "a1").truncated,
		"prefix",
		"the delta-only frame leaves the row claiming a prefix it does not have",
	);
	state = applyEvent(
		state,
		{
			type: "message_update",
			delta: " and more",
			message: assistant("a1", "the running whole text"),
		},
		2,
	);
	const healed = state.records.find((record) => record.id === "a1");
	assert.equal(healed.text, "the running whole text and more");
	assert.ok(
		!healed.truncated,
		"a body is the running whole text, so the mark goes on the frame that supplies it",
	);
});

test("a settled row drops a later delta, and the drop is COUNTED", () => {
	// The freeze gate: deltas for a painted, settled id change nothing. The
	// counter is the measurement the audit asked for — whether the gate ever
	// fires on this machine is a question for data, not for argument.
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "message_update",
			delta: "part",
			message: assistant("a1", ""),
		},
		1,
	);
	state = applyEvent(
		state,
		{ type: "message_end", message: assistant("a1", "durable answer") },
		2,
	);
	// Read through the optional chain so the ASSERTION below is where the absence
	// of the instrument shows, not an early throw: the behaviour it counts is the
	// finding, and the counter is the measurement.
	const before = streamDiagnostics?.settledAssistantUpdate ?? 0;
	const after = applyEvent(
		state,
		{ type: "message_update", delta: " late", message: assistant("a1", "") },
		3,
	);
	assert.equal(after, state, "no paint, and no re-arm: the row is settled");
	assert.equal(
		streamDiagnostics?.settledAssistantUpdate,
		before + 1,
		"the condition is counted where it happens",
	);
});

test("a message_start for an already painted id is not a re-arm", () => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: assistant("a1", "") },
		1,
	);
	state = applyEvent(
		state,
		{ type: "message_end", message: assistant("a1", "answered") },
		2,
	);
	const restarted = applyEvent(
		state,
		{ type: "message_start", message: assistant("a1", "") },
		3,
	);
	assert.equal(
		restarted,
		state,
		"a replayed start cannot resurrect a settled row",
	);
});

test("a seeded delta extends only a row with no text, and marks the row incomplete", () => {
	// (i) A row that already held text — one that survived a receipt gap — KEEPS
	// it. Appending the seed's delta would duplicate the tail whenever that frame
	// was one this viewer had already applied, and nothing in the frame says which
	// of the two it is, so the unplaceable delta is withheld and the row says its
	// continuity is broken instead.
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "message_update",
			delta: "the answer so far",
			message: assistant("a1", ""),
		},
		10,
	);
	const withheld = streamDiagnostics?.seededDeltaWithheld ?? 0;
	state = applyLiveSeed(
		state,
		{
			streaming: true,
			generation: "2",
			live_events: [
				{
					type: "message_update",
					delta: " so far",
					message: assistant("a1", ""),
				},
			],
		},
		20,
	);
	let row = state.records.find((record) => record.id === "a1");
	assert.equal(
		row.text,
		"the answer so far",
		"the seed's delta is not applied a second time",
	);
	assert.equal(
		row.truncated,
		"interrupted",
		"the row says its continuity broke",
	);
	assert.equal(streamDiagnostics?.seededDeltaWithheld, withheld + 1);

	// (ii) The row this seed's own `message_start` mints: the delta is its first
	// text, so it cannot duplicate anything, and the row is a tail by definition —
	// the seed is the owner's projection of a turn already in flight.
	state = applyLiveSeed(
		EMPTY_TRANSCRIPT,
		{
			streaming: true,
			generation: "2",
			live_events: [
				{ type: "message_start", message: assistant("a2", "") },
				{
					type: "message_update",
					delta: "last chunk",
					message: assistant("a2", ""),
				},
			],
		},
		20,
	);
	row = state.records.find((record) => record.id === "a2");
	assert.equal(
		row.text,
		"last chunk",
		"a minted row's first text is the seed's chunk",
	);
	assert.equal(row.streaming, true);
	assert.equal(row.truncated, "prefix", "and a seeded tail says it is a tail");
	// R1-3 (code review round 1): the counter counts WITHHELD deltas, and this
	// outcome withheld nothing — the row had no text, so the seed's chunk was
	// placed as its first. The counter's doc used to claim every marked row was
	// counted, which made `seededDeltaWithheld=0` read as "no seed marked a row".
	assert.equal(
		streamDiagnostics?.seededDeltaWithheld,
		withheld + 1,
		"a placed seed delta is not counted as a withheld one",
	);
});

test("a gap marks a row it cannot vouch for, and leaves a joined row's own claim alone", () => {
	/*
	 * D2 (design round 1), on the reducer rather than on the sentence: the mark a
	 * receipt gap sets is its OWN value, because the caption for it is a different
	 * claim. A row minted by a join states that no text before its first chunk
	 * reached this viewer:
	 * that is true when it is written and still true across a gap, so the gap
	 * leaves it alone. A row the gap reached holds its own earlier text on screen,
	 * so it says part of the answer may be missing — QA round 1's Q2 observed the
	 * old single wording denying exactly that, live.
	 *
	 * Settled rows are not marked at all: a durable row or an assembled
	 * `message_end` text is whole, and the gap cannot have taken anything from it.
	 */
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: assistant("a2", "") },
		1,
	);
	state = applyEvent(
		state,
		{
			type: "message_update",
			delta: "written before the gap",
			message: assistant("a2", ""),
		},
		2,
	);
	state = applyEvent(
		state,
		{ type: "message_update", delta: "chunk", message: assistant("a1", "") },
		3,
	);
	state = applyEvent(
		state,
		{ type: "message_end", message: assistant("a3", "the whole answer") },
		4,
	);
	const marked = reducer.markLiveRecordsTruncated(state);
	const rowOf = (id) => marked.records.find((record) => record.id === id);
	assert.equal(
		rowOf("a2").truncated,
		"interrupted",
		"a streaming row the gap reached may have a hole in it",
	);
	assert.equal(
		rowOf("a1").truncated,
		"prefix",
		"a joined row keeps its own claim: its first chunk is still all it has",
	);
	assert.ok(
		!rowOf("a3").truncated,
		"a settled row is whole, and the gap marks nothing on it",
	);
});

test("a locally stamped echo cannot sort above a row already on screen", () => {
	/*
	 * THE OPERATOR'S REPORT (2026-09-26): "when sending a user message, it seems
	 * to end up in an inconsistent place within the conversation history - it
	 * shows up above an older message and then corrects after some time to its
	 * proper position, and this only happened in this design release".
	 *
	 * The mechanism, pinned here with both clocks KNOWN rather than hoped for:
	 * `appendPendingUser` stamps the echo with the CLIENT's `Date.now()`, and
	 * every merge re-sorts the whole list by `ts` through `withTimeOrder`. A
	 * session whose owner stamps from a clock even a second AHEAD of the
	 * client's therefore sorts the fresh echo BEFORE the newest row - above an
	 * older message - until the owner's durable row (the same id, its own,
	 * server-stamped ts) replaces it: the visible "corrects after some time".
	 *
	 * THE TWO CLOCKS ARE IN THE SAME UNITS, and that is checked rather than
	 * assumed: the page's `ts` arrive in SECONDS and the reducer converts them
	 * (`Math.round(entry.ts * 1000)`), while `appendPendingUser` consumes `now`
	 * in MILLISECONDS - so `clientNow` here is `(serverNow - 1) * 1_000`, a
	 * client one second behind the owner on a real epoch. The first version of
	 * this fixture was ms-as-small-numbers, which pinned the echo about three
	 * orders of magnitude below every row it ordered against, not the one
	 * second behind the docstring claims (agent review round 1, R6; re-run at
	 * this scale, the pre-fix code still fails and the fix still passes).
	 *
	 * The echo goes through the real entry point and the re-sort is provoked by
	 * the next merge, which is the sequence the live path runs.
	 */
	const serverNow = 1_760_000_000; // seconds, the wire's unit - a real epoch
	const clientNow = serverNow * 1_000 - 1_000; // ms, one second behind
	let state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			{
				id: "u1",
				ts: serverNow - 5,
				type: "message",
				payload: { kind: "message", ...user("u1", "older") },
			},
			{
				id: "a1",
				ts: serverNow,
				type: "message",
				payload: { kind: "message", ...assistant("a1", "older answer") },
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	state = appendPendingUser(state, "req-1", "sent now", [], clientNow);
	assert.deepEqual(
		state.records.map((r) => r.id),
		["u1", "a1", "req-1"],
		"the echo is appended at the tail before any merge runs",
	);
	/*
	 * THE FIRST HALF, IN ONE ASSERTION: the echo's stamp is the MAXIMUM already
	 * painted (a tie with `a1`, kept after it by insertion order), not the raw
	 * client stamp - so no merge can sort the echo above a painted row. The
	 * SECOND half moved with review round 1 (F1): a row that lands AFTER the
	 * stamp is exactly what the cap cannot bound - `a2` here is dated past the
	 * cap, and so is any row written within the skew window before the send -
	 * so `a2` holds above the echo and the durable row below returns it to
	 * canonical order. What this case pins (the echo never sorts above the
	 * newest painted row; the owner's row lands canonically) is unchanged.
	 */
	assert.equal(
		state.records.find((r) => r.id === "req-1").ts,
		serverNow * 1_000,
		"the echo takes the newest painted stamp, not the raw client clock",
	);
	const merged = applyHistoryPage(state, {
		entries: [
			{
				id: "a2",
				ts: serverNow + 1,
				type: "message",
				payload: { kind: "message", ...assistant("a2", "next") },
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		merged.records.map((r) => r.id),
		["u1", "a1", "a2", "req-1"],
		"a client clock behind the server's must not sort the echo above the newest painted row, and a row landing after it takes its place above the hold",
	);
	/*
	 * AND THE DURABLE ROW STAYS AUTHORITATIVE WHERE IT LANDS: the owner's own
	 * row for the same id arrives with its real stamp - here STRICTLY between
	 * the client's clock and the stamp the echo took (`serverNow - 0.5` seconds
	 * is `serverNow * 1_000 - 500` ms, inside
	 * (1_759_999_999_000, 1_760_000_000_000), which no whole second can land
	 * in) - and it replaces the echo AND takes its own canonical place: after
	 * `u1`, before `a1`, BELOW the position the capped echo was sitting at.
	 * The cap must never outrank the owner (agent review round 1, R6).
	 */
	const replaced = applyHistoryPage(merged, {
		entries: [
			{
				id: "req-1",
				ts: serverNow - 0.5,
				type: "message",
				payload: { kind: "message", ...user("req-1", "sent now") },
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		replaced.records.map((r) => r.id),
		["u1", "req-1", "a1", "a2"],
		"the durable row replaces the echo and sorts to its own stamp",
	);
});

test("a local notice is stamped monotonic too, and never sorts above a painted row", () => {
	/*
	 * `monotonicStamp` is shared with `appendLocalNote`, and the notice path had
	 * no test when the echo's fix landed (agent review round 1, R6): a
	 * renderer-local notice - a refused send's sentence, "Interrupted" - is
	 * minted from the CLIENT's clock too, so on an owner whose clock runs ahead
	 * it could open a conversation ABOVE every painted row. Same clamp, same
	 * claim.
	 */
	let state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			{
				id: "u1",
				ts: 1_760_000_000 - 5,
				type: "message",
				payload: { kind: "message", ...user("u1", "older") },
			},
			{
				id: "a1",
				ts: 1_760_000_000,
				type: "message",
				payload: { kind: "message", ...assistant("a1", "older answer") },
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	state = appendLocalNote(
		state,
		"a local notice",
		"info",
		1_760_000_000 * 1_000 - 1_000,
	);
	const notice = state.records.find((r) => r.kind === "notice");
	assert.ok(notice, "the notice is painted");
	assert.equal(
		notice.ts,
		1_760_000_000 * 1_000,
		"the notice takes the newest painted stamp, not the raw client clock",
	);
	assert.deepEqual(
		state.records.map((r) => r.id),
		["u1", "a1", notice.id],
		"the notice sits at the tail, not above the rows already on screen",
	);
	/*
	 * AND THE CLAMP ONLY EVER RAISES: a caller whose clock is AHEAD keeps its
	 * own stamp - the function is `max(now, painted)`, not "the newest painted".
	 */
	const ahead = appendLocalNote(
		state,
		"a notice from a clock ahead",
		"info",
		1_760_000_000 * 1_000 + 5_000,
	);
	assert.ok(
		ahead.records.some(
			(r) => r.kind === "notice" && r.ts === 1_760_000_005_000,
		),
		"a clock ahead of the painted rows keeps its own stamp",
	);
});

/*
 * The re-delivery class, pinned on the wire's own cursor.
 *
 * WHY THE CURSOR IS THE RULE, rather than a content comparison: deltas are
 * fragments of a token stream, and a legitimate stream repeats short runs
 * freely ("the the", a doubled word, a quoted prompt), so "does this text
 * already appear" has no right answer from content alone — the append path
 * documents that and refuses content dedupe. The frame's `(epoch, seq)` is
 * assigned once at publish, and a re-delivery (a receipt replay after a
 * reconnect, a flush from a dead stream interleaved with its successor's)
 * carries the ORIGINAL cursor — so a row that recorded the last frame it
 * folded can refuse a frame at or behind it without guessing. Rows painted
 * without a frame in hand (a seed folded with no snapshot cursor, a direct
 * caller) keep the old behaviour unchanged.
 */
test("a re-delivered frame is refused: the text is the deltas in order, once", () => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: assistant("a1", "") },
		1,
		{ frame: { epoch: "e1", seq: 1 } },
	);
	state = applyEvent(
		state,
		{ type: "message_update", delta: "abc", message: assistant("a1", "") },
		2,
		{ frame: { epoch: "e1", seq: 2 } },
	);
	const dropped = streamDiagnostics?.staleUpdateFrameDropped ?? 0;
	// The stale frame: the same window re-sent, an earlier offset on the wire.
	state = applyEvent(
		state,
		{ type: "message_update", delta: "b", message: assistant("a1", "") },
		3,
		{ frame: { epoch: "e1", seq: 2 } },
	);
	state = applyEvent(
		state,
		{ type: "message_update", delta: "def", message: assistant("a1", "") },
		4,
		{ frame: { epoch: "e1", seq: 3 } },
	);
	const row = state.records.find((record) => record.id === "a1");
	assert.equal(row.text, "abcdef", "each delta lands once, in order");
	assert.equal(
		streamDiagnostics?.staleUpdateFrameDropped,
		dropped + 1,
		"the refusal is counted",
	);
});

test("a replayed window leaves the painted text untouched, and the stream continues after it", () => {
	const chunks = ["The lane ", "has dia", "gnosed"];
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: assistant("a1", "") },
		1,
		{ frame: { epoch: "e1", seq: 1 } },
	);
	for (let i = 0; i < chunks.length; i++) {
		state = applyEvent(
			state,
			{
				type: "message_update",
				delta: chunks[i],
				message: assistant("a1", ""),
			},
			2 + i,
			{ frame: { epoch: "e1", seq: 2 + i } },
		);
	}
	// A reconnect replays the same window over the painted row. Old code
	// appended every re-sent fragment a second time — the operator's "chunks
	// are not in the proper overlap/order".
	let replayed = state;
	for (let i = 0; i < chunks.length; i++) {
		replayed = applyEvent(
			replayed,
			{
				type: "message_update",
				delta: chunks[i],
				message: assistant("a1", ""),
			},
			10 + i,
			{ frame: { epoch: "e1", seq: 2 + i } },
		);
	}
	let row = replayed.records.find((record) => record.id === "a1");
	assert.equal(
		row.text,
		"The lane has diagnosed",
		"a replayed window does not double the text",
	);
	// The live stream continues from the frame after the window.
	const live = applyEvent(
		replayed,
		{
			type: "message_update",
			delta: " item ten",
			message: assistant("a1", ""),
		},
		20,
		{ frame: { epoch: "e1", seq: 5 } },
	);
	row = live.records.find((record) => record.id === "a1");
	assert.equal(row.text, "The lane has diagnosed item ten");
});

test("a new message identity starts from zero while the previous buffer stays put", () => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: assistant("m1", "") },
		1,
		{ frame: { epoch: "e1", seq: 1 } },
	);
	state = applyEvent(
		state,
		{ type: "message_update", delta: "diagn", message: assistant("m1", "") },
		2,
		{ frame: { epoch: "e1", seq: 2 } },
	);
	// The stream moves on under a new id.
	state = applyEvent(
		state,
		{ type: "message_start", message: assistant("m2", "") },
		3,
		{ frame: { epoch: "e1", seq: 3 } },
	);
	state = applyEvent(
		state,
		{
			type: "message_update",
			delta: "The lane has ",
			message: assistant("m2", ""),
		},
		4,
		{ frame: { epoch: "e1", seq: 4 } },
	);
	// A late re-delivery for the FIRST message must be refused rather than
	// appended to a buffer that never reset.
	state = applyEvent(
		state,
		{ type: "message_update", delta: "gnosed", message: assistant("m1", "") },
		5,
		{ frame: { epoch: "e1", seq: 2 } },
	);
	const m1 = state.records.find((record) => record.id === "m1");
	const m2 = state.records.find((record) => record.id === "m2");
	assert.equal(m1.text, "diagn", "the old buffer did not grow");
	assert.equal(m2.text, "The lane has ", "the new identity starts from zero");
});

/* ------------------------------------------------ one id per update (#671) */

/*
 * #671: an assistant-only turn (a background job's auto-delivery, a scheduled
 * wake) mis-rendered while the journal was clean — a later message SPLICED
 * into an earlier assistant block and also DUPLICATED it. The reachable route
 * at this layer is the id itself: the three live guards tested the TYPE of
 * `message.id` alone, so `id: ""` was admitted, and every id-less frame —
 * whatever turn it belonged to — resolved to ONE record. Overlapping streams
 * then merged through the append-only contract (a frame that cannot be told
 * apart from the row it names is the same message's next chunk), painting a
 * paragraph that exists in no record; and because the durable entry carries
 * the id the journal gave the message, the same message painted a second
 * block beside the first. The contract these cells pin: ONE ID PER UPDATE — a
 * frame that states no usable id paints nothing and fuses with nothing, and a
 * durable row with no id is dropped rather than synthesised under "".
 */

test("an id-less live frame paints nothing, so two of them cannot fuse (#671)", () => {
	// The reproduced input (triage, issue #671): two assistant-only streams,
	// both id-less, overlapping — one delivery lands while the previous row is
	// still being written. Pre-fix the second row's chunks append to the first
	// row's buffer (id `""`), and the record on screen is a paragraph no
	// producer ever wrote: "PARA-ONE-BODY. PARA-TWO-LEAD. PARA-TWO-MORE."
	const refused = streamDiagnostics.idlessFrameRefused;
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: assistant("", "") },
		1,
	);
	state = applyEvent(
		state,
		{
			type: "message_update",
			delta: "PARA-ONE-BODY. ",
			message: assistant("", ""),
		},
		2,
	);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistant("", "") },
		3,
	);
	state = applyEvent(
		state,
		{
			type: "message_update",
			delta: "PARA-TWO-LEAD. ",
			message: assistant("", ""),
		},
		4,
	);
	state = applyEvent(
		state,
		{
			type: "message_update",
			delta: "PARA-TWO-MORE.",
			message: assistant("", ""),
		},
		5,
	);
	state = applyEvent(
		state,
		{
			type: "message_end",
			message: assistant("", "PARA-TWO-LEAD. PARA-TWO-MORE."),
		},
		6,
	);
	assert.equal(state.records.length, 0, "no usable id, no record");
	assert.equal(
		state.index.has(""),
		false,
		"the empty string is never a record id",
	);
	// The instrument, so the field can answer "did a frame arrive with no id"
	// by data rather than by the absence of a symptom (the reason every other
	// counter here exists). Six frames in the sequence stated no id.
	assert.equal(
		streamDiagnostics.idlessFrameRefused,
		refused + 6,
		"every id-less frame was counted",
	);
});

test("an id-less live stream does not double the block its durable entry paints (#671)", () => {
	// The other half of the report: the same message painted twice. The live
	// frames name no id while the journal's entry carries the message's own
	// id, so pre-fix the text painted under `""` AND under `delivery-1`. Only
	// a frame with a usable id may create a row; the durable page is where the
	// message paints, under the id it actually has.
	let state = EMPTY_TRANSCRIPT;
	state = applyEvent(
		state,
		{ type: "message_start", message: assistant("", "") },
		1,
	);
	state = applyEvent(
		state,
		{ type: "message_update", delta: "Job done. ", message: assistant("", "") },
		2,
	);
	state = applyEvent(
		state,
		{ type: "message_end", message: assistant("", "Job done. ") },
		3,
	);
	state = applyHistoryPage(
		state,
		pageOf([
			messageEntry("delivery-1", 40, {
				kind: "message",
				...assistant("delivery-1", "Job done. "),
			}),
		]),
	);
	assert.equal(state.records.length, 1, "one block, not two");
	assert.equal(state.records[0].id, "delivery-1");
	assert.equal(state.records[0].text, "Job done. ");
});

test("a history_delta row with no id is dropped, never synthesised under ''", () => {
	// The durable door into the same class: the frame's rows used to be given
	// `String(row.id ?? "")`, so id-less rows collided with themselves and with
	// every live frame that stated none. A row that names no id names no
	// record; it is refused exactly as the live guards refuse one.
	const state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "history_delta",
			messages: [
				assistant("", "ROW-ONE-BODY. "),
				assistant("", "ROW-TWO-BODY. "),
			],
		},
		10,
	);
	assert.equal(state.records.length, 0, "no id, no row");
	assert.equal(state.index.has(""), false);
});

test("a frame with a usable id still coalesces with its durable entry (the #671 control)", () => {
	// The fix must refuse only frames that state NO id. The ordinary shape —
	// live frames and the durable row of the SAME message under the same id —
	// must keep coalescing into one record, or the cure is the disease.
	let state = EMPTY_TRANSCRIPT;
	state = applyEvent(
		state,
		{ type: "message_start", message: assistant("m1", "") },
		1,
	);
	state = applyEvent(
		state,
		{ type: "message_update", delta: "Hi. ", message: assistant("m1", "") },
		2,
	);
	state = applyEvent(
		state,
		{ type: "message_end", message: assistant("m1", "Hi. ") },
		3,
	);
	state = applyHistoryPage(
		state,
		pageOf([
			messageEntry("m1", 40, { kind: "message", ...assistant("m1", "Hi. ") }),
		]),
	);
	assert.equal(state.records.length, 1);
	assert.equal(state.records[0].id, "m1");
	assert.equal(state.records[0].text, "Hi. ");
});

test("an id-less end settles the ONE open assistant row, writing no text (#671 fallback)", () => {
	/*
	 * The bounded fallback agreed with the condense/continuity lane
	 * (2026-09-29; re-bounded by the #671 review round, U3): an id-less end
	 * cannot name its record, so it ends the session's single open assistant
	 * row — settle semantics only. The frame's own text is NOT written (the
	 * record keeps its accumulated text) and nothing is counted as refused.
	 */
	const refused = streamDiagnostics.idlessFrameRefused;
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: assistant("a1", "") },
		1,
	);
	state = applyEvent(
		state,
		{
			type: "message_update",
			delta: "Only answer.",
			message: assistant("a1", ""),
		},
		2,
	);
	state = applyEvent(
		state,
		{
			type: "message_end",
			// No id at all, and a full assembled text the fallback must not adopt.
			message: assistant(undefined, "FRAME-TEXT-THAT-NEVER-RAN"),
		},
		3,
	);
	const a1 = state.records.find((record) => record.id === "a1");
	assert.equal(a1.streaming, false, "the one open row settled");
	assert.equal(a1.complete, true, "an answer that ended is complete");
	assert.equal(typeof a1.settledAt, "number", "the settle instant is stamped");
	assert.equal(a1.text, "Only answer.", "the frame's text was not written");
	assert.equal(
		state.records.length,
		1,
		"no second row appeared for the unnamed frame",
	);
	assert.equal(
		streamDiagnostics.idlessFrameRefused,
		refused,
		"a settled end is not a refusal",
	);
});

test("an id-less end with TWO open assistant rows guesses nothing and is refused (#671 fallback, U3)", () => {
	/*
	 * Concurrent assistant streams make the unnamed end a guess between rows —
	 * settling either could pick the wrong one and strand the other (review
	 * round 1, U3). Both stay streaming and the frame is counted as refused.
	 */
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: assistant("b1", "") },
		1,
	);
	state = applyEvent(
		state,
		{ type: "message_update", delta: "One ", message: assistant("b1", "") },
		2,
	);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistant("b2", "") },
		3,
	);
	state = applyEvent(
		state,
		{ type: "message_update", delta: "Two ", message: assistant("b2", "") },
		4,
	);
	const refused = streamDiagnostics.idlessFrameRefused;
	state = applyEvent(
		state,
		{ type: "message_end", message: assistant(undefined, "Assembled.") },
		5,
	);
	const b1 = state.records.find((record) => record.id === "b1");
	const b2 = state.records.find((record) => record.id === "b2");
	assert.equal(b1.streaming, true, "neither row settles on a guess");
	assert.equal(b2.streaming, true, "neither row settles on a guess");
	assert.equal(b1.text, "One ");
	assert.equal(b2.text, "Two ");
	assert.equal(
		streamDiagnostics.idlessFrameRefused,
		refused + 1,
		"the ambiguous end was counted as refused",
	);
});

test("an id-less end with no open assistant stays a counted refusal", () => {
	// Nothing open: there is no record to end, so the frame keeps the old
	// behaviour — dropped and counted.
	const emptyRefused = streamDiagnostics.idlessFrameRefused;
	const afterEmpty = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_end", message: assistant("", "Anything.") },
		1,
	);
	assert.equal(afterEmpty.records.length, 0);
	assert.equal(
		streamDiagnostics.idlessFrameRefused,
		emptyRefused + 1,
		"an empty transcript counted the refusal",
	);
	// A settled row is not open either: one named end first, then the id-less
	// end — refused, and the settled row's text is untouched.
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: assistant("m1", "") },
		2,
	);
	state = applyEvent(
		state,
		{ type: "message_end", message: assistant("m1", "Done.") },
		3,
	);
	const settledRefused = streamDiagnostics.idlessFrameRefused;
	state = applyEvent(
		state,
		{ type: "message_end", message: assistant("", "Later text.") },
		4,
	);
	assert.equal(state.records.length, 1);
	assert.equal(
		state.records[0].text,
		"Done.",
		"no text merge onto a settled row",
	);
	assert.equal(
		streamDiagnostics.idlessFrameRefused,
		settledRefused + 1,
		"the second id-less end was counted too",
	);
});

test("an id-less end for a user message settles nothing", () => {
	// The fallback is for the ASSISTANT end the producer emits; an unnamed end
	// of any other role must not end a turn it does not belong to.
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: assistant("a1", "") },
		1,
	);
	state = applyEvent(
		state,
		{
			type: "message_update",
			delta: "Still writing.",
			message: assistant("a1", ""),
		},
		2,
	);
	const refused = streamDiagnostics.idlessFrameRefused;
	state = applyEvent(
		state,
		{ type: "message_end", message: user("", "Typed.") },
		3,
	);
	const a1 = state.records.find((record) => record.id === "a1");
	assert.equal(a1.streaming, true, "the assistant row is still open");
	assert.equal(
		streamDiagnostics.idlessFrameRefused,
		refused + 1,
		"the user end was refused",
	);
});

test("a row the seed painted carries the snapshot's cursor; an older replay is refused", () => {
	let state = applyLiveSeed(
		EMPTY_TRANSCRIPT,
		{
			streaming: true,
			generation: "1",
			live_events: [
				{ type: "message_start", message: assistant("a1", "") },
				{
					type: "message_update",
					delta: "chunk two",
					message: assistant("a1", ""),
				},
			],
		},
		10,
		{ epoch: "e1", seq: 7 },
	);
	// A replay frame the snapshot already covers is refused.
	state = applyEvent(
		state,
		{ type: "message_update", delta: "one ", message: assistant("a1", "") },
		11,
		{ frame: { epoch: "e1", seq: 5 } },
	);
	let row = state.records.find((record) => record.id === "a1");
	assert.equal(row.text, "chunk two", "the older replay is not appended");
	// The live stream after the snapshot still appends.
	state = applyEvent(
		state,
		{
			type: "message_update",
			delta: " and three",
			message: assistant("a1", ""),
		},
		12,
		{ frame: { epoch: "e1", seq: 8 } },
	);
	row = state.records.find((record) => record.id === "a1");
	assert.equal(row.text, "chunk two and three");
});

test("re-applying an identical seed at a settled claim keeps the row and the state", () => {
	const frontend = {
		streaming: true,
		generation: "1",
		live_events: [
			{ type: "message_start", message: assistant("a1", "") },
			{
				type: "message_update",
				delta: "chunk two",
				message: assistant("a1", ""),
			},
		],
	};
	// The first seed mints the row; the second re-applies it, settling the claim
	// at "interrupted" (a text-bearing seed delta may have a chunk withheld -
	// pre-existing behavior, identical on origin/main). THAT state is the steady
	// one a degraded reconnect re-delivers roughly every 0.5 s, and it must
	// re-apply as a no-op: the frame stamp had made each re-apply replace the
	// record and the state, because every fold builds a fresh cursor object
	// (agent review round 1, finding 2).
	let state = applyLiveSeed(EMPTY_TRANSCRIPT, frontend, 10, {
		epoch: "e1",
		seq: 7,
	});
	state = applyLiveSeed(state, frontend, 11, { epoch: "e1", seq: 7 });
	const settled = state;
	const settledRow = state.records[0];
	state = applyLiveSeed(state, frontend, 12, { epoch: "e1", seq: 7 });
	assert.equal(
		state,
		settled,
		"an identical seed re-applied is a no-op, not a state replacement",
	);
	assert.equal(
		state.records[0],
		settledRow,
		"and the row's identity survives it",
	);
});

test("a frame from a new epoch is applied even though its numbering restarts", () => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: assistant("a1", "") },
		1,
		{ frame: { epoch: "e1", seq: 40 } },
	);
	state = applyEvent(
		state,
		{
			type: "message_update",
			delta: "after the owner was replaced",
			message: assistant("a1", ""),
		},
		2,
		{ frame: { epoch: "e2", seq: 1 } },
	);
	const row = state.records.find((record) => record.id === "a1");
	assert.equal(row.text, "after the owner was replaced");
});

/* ---------------------------------------------------------------- */
/* Harness chrome on a user row                                      */
/* ---------------------------------------------------------------- */

/*
 * The marker the harness stamps on a row it minted itself, read on BOTH desktop
 * paths. `provider_payload.harness_injected` is `RENDERED_INJECTION_KEY` on the
 * Python side (`local_operator/compaction/cutpoint.py`) and its docblock states the
 * contract: a row carrying it was never typed by a person, so no human-facing
 * surface may paint it as their words. The desktop was the surface that did.
 *
 * Both branches are asserted because they are separate code paths over separate
 * payload shapes, and a session reopened from history reads its turns through the
 * durable one: suppressing only the live path would leave the harness's prompt in
 * the transcript of every reloaded conversation.
 */
const injected = (id, text) => ({
	...user(id, text),
	provider_payload: { harness_injected: true },
});

const durablePage = (entry) => ({
	entries: [entry],
	has_more: false,
	cursor_missing: false,
});

test("a harness-minted row is not painted as the user's words, on the live path", () => {
	const state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "message_start",
			message: injected("u9", "Continue toward: ship it"),
		},
		1,
	);
	assert.deepEqual(
		state.records,
		[],
		"a row the harness minted is chrome, and chrome is not the person's own message",
	);
});

test("...and on the durable path, where a reloaded session reads it back", () => {
	const state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		durablePage({
			id: "u9",
			ts: 10,
			type: "message",
			payload: {
				kind: "message",
				...injected("u9", "Continue toward: ship it"),
			},
		}),
	);
	assert.deepEqual(state.records, []);
});

test("a row a person typed is untouched, marker or no marker", () => {
	const typed = user("u1", "hi");
	const live = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: typed },
		1,
	);
	assert.equal(live.records.length, 1);
	assert.equal(live.records[0].text, "hi");
	/*
	 * AND THE MARKER'S OTHER VALUES ARE READ AS ABSENT. The producer writes a JSON
	 * boolean, so `false`, a string and a missing field all mean "someone typed
	 * this": the test fails safe in that direction on purpose, because hiding a row
	 * a person really typed is a worse failure than showing one they did not.
	 */
	for (const marker of [false, "true", 0, null, undefined]) {
		const each = applyEvent(
			EMPTY_TRANSCRIPT,
			{
				type: "message_start",
				message: {
					...user("u2", "typed"),
					provider_payload: { harness_injected: marker },
				},
			},
			1,
		);
		assert.equal(
			each.records.length,
			1,
			`harness_injected: ${String(marker)} must be read as not-injected`,
		);
	}
	/*
	 * A payload with the marker on SOMEBODY ELSE'S key is not a match either: this
	 * is a field read, not a search of the row for the word.
	 */
	const elsewhere = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "message_start",
			message: {
				...user("u3", "typed"),
				provider_payload: { injected_by: "harness" },
			},
		},
		1,
	);
	assert.equal(elsewhere.records.length, 1);
});

/*
 * THE LEGACY HALF. Rows written before the marker existed carry no stamp to
 * read, and core's own contract keeps the recogniser for exactly that
 * (`docs/DESKTOP_API.md`: "An owner on an older build still sends these rows,
 * which is why the marker (and the recogniser) remain the contract"). The
 * operator's stored transcript (2026-09-29) held ten unstamped
 * goal-continuation rows, painted as the user's own words; these pin the
 * fallback that hides them on both arms - and the near-misses it must NOT
 * touch.
 *
 * THE LITERALS BELOW ARE COPIED FROM THE PYTHON PRODUCERS, deliberately as
 * literals rather than imported from `harness-chrome.ts`: the module's copy is
 * a restatement (the renderer cannot import Python), so the day either side's
 * wording moves, THIS is the alarm - an import would move with it and prove
 * nothing. Producers: `session/goal_judge.py` (GOAL_CONTINUATION_HEAD/TAIL,
 * `is_goal_continuation_instruction`) and `session/goal_loop.py`
 * (LOOP_GOAL_PROMPT, LOOP_PROMPT, `is_loop_goal_instruction`), mirrored by
 * `harness/rows.py::is_harness_chrome`.
 */
const goalContinuation = (goal) =>
	`Continue working toward this goal:\n\n${goal}\n\nMake concrete progress with the tools available, then state plainly what advanced and what remains. If the goal is fully met, say so and stop.`;

const loopGoalPrompt = (goal) =>
	`Work toward this goal:\n\n${goal}\n\nMake concrete progress with the tools available, then briefly state what advanced and what remains. If the goal is already fully met, say so plainly.`;

const LOOP_SELF_CONTINUATION =
	"Continue working toward the standing goal. Make concrete progress with the tools available, then briefly state what advanced and what remains. If the goal is already fully met, say so plainly and stop.";

test("an unstamped goal-continuation row is chrome, live - no marker needed", () => {
	const state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "message_start",
			message: user("u10", goalContinuation("ship the goal-chrome fix")),
		},
		1,
	);
	assert.deepEqual(
		state.records,
		[],
		"the fixed head and tail are the whole shape; the row predates the stamp",
	);
});

test("...and on the durable arm, where stored transcripts read it back", () => {
	/*
	 * The row AND the turn it was driving, because the fix's claim is not just
	 * "the row goes" - the conversation it continued must stay whole.
	 */
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			{
				id: "u11",
				ts: 10,
				type: "message",
				payload: {
					kind: "message",
					...user("u11", goalContinuation("ship the goal-chrome fix")),
				},
			},
			{
				id: "a11",
				ts: 11,
				type: "message",
				payload: {
					kind: "message",
					...assistant("a11", "Making concrete progress now."),
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		state.records.map((record) => record.id),
		["a11"],
		"the chrome row goes; the answer it drove stays",
	);
});

test("the loop's fixed prompt and its goal family are recognised too", () => {
	for (const text of [
		LOOP_SELF_CONTINUATION,
		loopGoalPrompt("keep the loop moving"),
	]) {
		const state = applyEvent(
			EMPTY_TRANSCRIPT,
			{ type: "message_start", message: user("u12", text) },
			1,
		);
		assert.deepEqual(
			state.records,
			[],
			`loop chrome must not paint: ${text.slice(0, 32)}...`,
		);
	}
});

test("whitespace around a chrome row does not save it", () => {
	/*
	 * Core strips before matching because "the two hosts do not agree on what
	 * they hand in" - a persisted prompt that gained a trailing newline must
	 * not flip from hidden to painted on one surface only.
	 */
	const state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "message_start",
			message: user("u13", `\n\n  ${goalContinuation("g")} \n`),
		},
		1,
	);
	assert.deepEqual(state.records, []);
});

test("near-misses are the user's own words and still paint", () => {
	const nearMisses = [
		// Opens with the head, never closes with the tail: the user's own words.
		"Continue working toward this goal:\n\nship it",
		// Quotes the tail inside a sentence of their own.
		"I asked it to say \u201cMake concrete progress with the tools available, then state plainly what advanced and what remains. If the goal is fully met, say so and stop.\u201d - does that read like the harness?",
		// The whole continuation shape, then the user speaks.
		`${goalContinuation("ship it")} Also, ping me when it lands.`,
		// The fixed prompt plus one word of theirs is not the fixed prompt.
		`${LOOP_SELF_CONTINUATION} Please.`,
	];
	for (const text of nearMisses) {
		const state = applyEvent(
			EMPTY_TRANSCRIPT,
			{ type: "message_start", message: user("u14", text) },
			1,
		);
		assert.equal(
			state.records.length,
			1,
			`must paint (${text.slice(0, 32)}...)`,
		);
		assert.equal(
			state.records[0].text,
			text,
			"and it paints as typed, not as a recognised shape",
		);
	}
});

test("a cursor_missing page re-anchors the load cursor to its own oldest row", () => {
	/*
	 * The operator report (2026-09-28): after a /compact replaced the journal
	 * under a loaded conversation, "Load earlier messages" loaded nothing,
	 * forever. The backend answers a cursor it cannot locate with the current
	 * tail plus `cursor_missing` (read_transcript_page) so a reader can dedupe
	 * and MOVE; the load path kept the stale id, so every click re-fetched a
	 * page it already had. The move is the page's own oldest id — a row this
	 * journal just served, so the next request can locate it.
	 */
	const tail = {
		entries: [{ id: "row:90" }, { id: "row:91" }],
		has_more: true,
		cursor_missing: true,
	};
	assert.equal(reanchorAfterCursorMiss(tail, "row:pre-compaction"), "row:90");
	// A normal page needs no move, an empty one offers nowhere to move, and a
	// page whose oldest IS the anchor would repeat the same request.
	assert.equal(
		reanchorAfterCursorMiss({ ...tail, cursor_missing: false }, "x"),
		null,
	);
	assert.equal(reanchorAfterCursorMiss({ ...tail, entries: [] }, "x"), null);

	test("a second cursor_missing is the failed state, not another retry", () => {
		/*
		 * AGENT REVIEW ROUND 1, F1. The reviewer's finding: the retried page was
		 * applied and the call resolved true, so a click that loaded nothing in
		 * the second-miss corner still looked like success. This pins the whole
		 * decision table: one re-anchored retry, a failure on the second miss,
		 * and an immediate failure when there is no row to re-anchor at.
		 */
		const tail = {
			cursor_missing: true,
			entries: [{ id: "row:120" }, { id: "row:121" }],
		};
		assert.deepEqual(
			loadOlderStep(tail, "row:pre-compaction", false),
			{ cursor: "row:120", failed: false },
			"the first miss re-anchors to the page's own oldest row",
		);
		assert.deepEqual(
			loadOlderStep(tail, "row:120", true),
			{ cursor: null, failed: true },
			"the second miss is the failed state",
		);
		assert.deepEqual(
			loadOlderStep({ cursor_missing: false, entries: [] }, "row:120", false),
			{ cursor: null, failed: false },
			"a healthy page is a success",
		);
		assert.deepEqual(
			loadOlderStep({ cursor_missing: true, entries: [] }, "row:120", false),
			{ cursor: null, failed: true },
			"a miss with nothing to anchor at fails immediately",
		);
		/*
		 * AGENT REVIEW ROUND 2, MINOR-1: the table must kill a guard-dropped
		 * mutation, so it pins both directions of the equals-anchor refusal and
		 * the retry guard on a page that COULD have been re-anchored.
		 */
		assert.deepEqual(
			loadOlderStep(
				{ cursor_missing: true, entries: [{ id: "row:120" }] },
				"row:120",
				false,
			),
			{ cursor: null, failed: true },
			"a moved tail whose oldest row IS the anchor fails on the first answer (nothing to re-anchor to)",
		);
		assert.deepEqual(
			loadOlderStep(tail, "row:999", true),
			{ cursor: null, failed: true },
			"a re-anchorable page is still a failure once already retried: the guard is the retry, not the page",
		);
	});
	assert.equal(reanchorAfterCursorMiss(tail, "row:90"), null);
});

/*
 * THE PAGER CURSOR (loader-continuity, design spec sections 1.1 and 6).
 *
 * `oldestId`/`oldestTs`/`hasMore` are the reducer's sole statement of "where
 * history stops". The cursor used to be derived by looking the page's first entry
 * up among the RECORDS, which fails for every entry that is not one (silent
 * customs, `tool:`-keyed results); it is now stored, and moved by five rules
 * keyed on what kind of read the page was.
 */
const cursorEntry = (id, ts, type = "custom") => ({
	id,
	ts,
	type,
	payload:
		type === "custom"
			? { custom_type: "session_spend.v1", details: {} }
			: {
					kind: "message",
					role: "assistant",
					content: [{ type: "text", text: id }],
					tool_calls: [],
				},
});
const cursorPage = (entries, hasMore = true) => ({
	entries,
	has_more: hasMore,
	cursor_missing: false,
});

test("the cursor's instant is stored with it, and an empty transcript has none", () => {
	assert.equal(EMPTY_TRANSCRIPT.oldestTs, 0);
	const s = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		cursorPage([cursorEntry("c1", 100), cursorEntry("m1", 101, "message")]),
	);
	assert.equal(s.oldestId, "c1", "the first page's first entry, silent or not");
	assert.equal(
		s.oldestTs,
		100_000,
		"stored in ms, not looked up from a record",
	);
	assert.equal(s.index.has("c1"), false, "the cursor entry is not a record");
});

test("a continuation page moves the cursor even when it adds no record", () => {
	const s = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		cursorPage([cursorEntry("m5", 500, "message")]),
	);
	const silent = cursorPage([cursorEntry("c3", 300), cursorEntry("c4", 400)]);
	const next = applyHistoryPage(s, silent, { pagedBefore: "m5" });
	assert.equal(next.oldestId, "c3");
	assert.equal(next.oldestTs, 300_000);
	assert.equal(next.hasMore, true);
	assert.notEqual(
		next,
		s,
		"a moved cursor is a change, not the no-op early return",
	);
});

test("an empty continuation page ends paging instead of repeating the ask", () => {
	const s = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		cursorPage([cursorEntry("m5", 500, "message")], true),
	);
	const next = applyHistoryPage(s, cursorPage([], true), { pagedBefore: "m5" });
	assert.equal(next.oldestId, "m5", "nothing to move to");
	assert.equal(next.hasMore, false, "a page that cannot advance is the end");
});

test("a tail-type read moves the cursor only to a strictly older instant", () => {
	const s = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		cursorPage([cursorEntry("m5", 500, "message")], true),
	);
	// A newer, changed tail (a live turn): cursor and hasMore are unchanged.
	const newer = applyHistoryPage(
		s,
		cursorPage([cursorEntry("m9", 900, "message")], false),
	);
	assert.equal(newer.oldestId, "m5");
	assert.equal(
		newer.hasMore,
		true,
		"a tail read's has_more is not this reader's",
	);
	// The same instant is not older: the reader keeps the cursor it has.
	const same = applyHistoryPage(
		s,
		cursorPage([cursorEntry("m5b", 500, "message")], false),
	);
	assert.equal(same.oldestId, "m5");
	// A strictly older page (a wider read) does move it, and takes its has_more.
	const older = applyHistoryPage(
		s,
		cursorPage([cursorEntry("m1", 100, "message")], false),
	);
	assert.equal(older.oldestId, "m1");
	assert.equal(older.oldestTs, 100_000);
	assert.equal(older.hasMore, false);
});

test("keepPaging wins over a continuation assertion, and replace reseeds the cursor", () => {
	const s = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		cursorPage([cursorEntry("m5", 500, "message")], true),
	);
	const kept = applyHistoryPage(
		s,
		cursorPage([cursorEntry("m1", 100, "message")], false),
		{ keepPaging: true, pagedBefore: "m5" },
	);
	assert.equal(kept.oldestId, "m5");
	assert.equal(kept.hasMore, true);
	const replaced = applyHistoryPage(
		s,
		cursorPage([cursorEntry("m8", 800, "message")], false),
		{ replace: true },
	);
	assert.equal(replaced.oldestId, "m8");
	assert.equal(replaced.oldestTs, 800_000);
	assert.equal(replaced.hasMore, false);
});

test("reanchorCandidate is the oldest held record that is a real journal entry id", () => {
	const at = (kind, id, ts) => ({ kind, id, ts });
	const held = {
		...EMPTY_TRANSCRIPT,
		records: [
			at("tool", "tool:call-1", 100),
			at("notice", "anchor-1", 110),
			at("user", "u1", 120),
			at("assistant", "a1", 130),
		],
	};
	assert.equal(
		reanchorCandidate(held),
		"u1",
		"tool:<callId> and notice anchors are not journal entry ids",
	);
	for (const kind of ["custom", "peer", "wake", "compaction"])
		assert.equal(
			reanchorCandidate({ ...EMPTY_TRANSCRIPT, records: [at(kind, "x1", 1)] }),
			"x1",
			`${kind} records carry the entry id`,
		);
	assert.equal(reanchorCandidate(EMPTY_TRANSCRIPT), null, "an empty store");
	assert.equal(
		reanchorCandidate({
			...EMPTY_TRANSCRIPT,
			records: [at("tool", "tool:c", 1), at("notice", "n", 2)],
		}),
		null,
		"nothing usable held",
	);
});

test("a send's delivery state rides the row, from both the durable and the live path", () => {
	/*
	 * ONE field with two producers and one frozen rule for each: the state is a
	 * STRUCTURED fact that must survive the read (a reloaded transcript paints
	 * what the live one painted) and must never be invented when the producer
	 * said nothing - an old transcript, an old core, a state this build does not
	 * know, or a tool that has no delivery at all. All four of those read as
	 * "no statement", which is exactly the row that existed before the field.
	 */
	const row = (state, is_error = false) => ({
		id: `t-${state}`,
		ts: 1,
		type: "message",
		payload: {
			role: "tool",
			tool_call_id: `c-${state}`,
			tool_name: "send",
			content: [{ text: "→ release-owner: done", type: "text" }],
			is_error,
			provider_payload: {
				duration_s: 5.1,
				details: state === "none" ? undefined : { delivery: { state } },
			},
		},
	});
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			row("delivered"),
			row("mailbox"),
			row("unconfirmed"),
			// `is_error` is the wire's own claim and the core only sets it for
			// `failed`; the row carries both facts through unaltered.
			row("failed", true),
			// A state this build does not know is treated as absent, never guessed.
			row("queued"),
			// No `delivery` key at all: an old core, or any other tool.
			row("none"),
		],
		has_more: false,
		cursor_missing: false,
	});
	assert.deepEqual(
		state.records
			.filter((record) => record.kind === "tool")
			.map((record) => [record.delivery ?? null, record.isError]),
		[
			["delivered", false],
			["mailbox", false],
			["unconfirmed", false],
			["failed", true],
			[null, false],
			[null, false],
		],
	);

	/*
	 * THE LIVE PATH, and the guard that is the whole reason `preferDeliveryState`
	 * exists: the live-event budget (`_bound_live_result_in_place`) strips a
	 * result's `details` when the row exceeds its share, so a reconnect seed for a
	 * call the durable row already resolved carries NONE - and "said nothing" must
	 * keep the state instead of blanking a mailbox row back to a silent success.
	 */
	let live = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "tool_execution_start",
			tool_call_id: "live-1",
			tool_name: "send",
			args: { target: "night-audit", message: "re-run the shard" },
		},
		1,
	);
	live = applyEvent(
		live,
		{
			type: "tool_execution_end",
			tool_call_id: "live-1",
			tool_name: "send",
			result: {
				content: [
					{ type: "text", text: "→ night-audit: delivered to its mailbox" },
				],
				details: { delivery: { state: "mailbox", attempts: 3 } },
			},
			is_error: false,
			duration_s: 5.1,
		},
		2,
	);
	const [liveRow] = live.records.filter((record) => record.kind === "tool");
	assert.equal(liveRow.delivery, "mailbox");
	assert.equal(liveRow.isError, false);

	const stripped = applyEvent(
		live,
		{
			type: "tool_execution_end",
			tool_call_id: "live-1",
			tool_name: "send",
			result: {
				content: [
					{ type: "text", text: "→ night-audit: delivered to its mailbox" },
				],
			},
			is_error: false,
			duration_s: 5.1,
		},
		3,
	);
	const [resealed] = stripped.records.filter(
		(record) => record.kind === "tool",
	);
	assert.equal(
		resealed.delivery,
		"mailbox",
		"a seed end whose details were stripped keeps the state the row already had",
	);
});

/* ---------- the dev-only immutability guard, through the emit path --------- */

/*
 * `record-immutability.ts` freezes a record where the reducer EMITS it - `upsert`
 * (which every live caller, `markLiveRecordsTruncated` and `appendPendingUser`
 * funnel through) and the page/merge paths - in a DEVELOPMENT build only, so an
 * in-place write throws at the write instead of leaving `collapseRowsKey`'s
 * cached per-record signature stale (agent review round 2, M1r2).
 *
 * The bundle above carries no `import.meta.env`, so it takes the
 * production-shaped branch (`DEV` read as false, no freeze) - which is why no
 * existing assertion in this file changes. This second bundle is the same module
 * with `DEV: true`: the branch a Vite dev build takes.
 */
const devBundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/transcript-reducer";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	define: { "import.meta.env": '{"DEV":true}' },
});
const devReducer = await import(
	`data:text/javascript;base64,${Buffer.from(devBundle.outputFiles[0].text).toString("base64")}`
);

test("a development build freezes an emitted record, so an in-place write throws", () => {
	const emitted = devReducer.appendPendingUser(
		devReducer.EMPTY_TRANSCRIPT,
		"u1",
		"hi",
		[],
		1,
	).records[0];
	assert.ok(
		Object.isFrozen(emitted),
		"a record the reducer emits is frozen in a development build",
	);
	assert.throws(
		() => {
			emitted.text = "changed";
		},
		TypeError,
		"a field write throws instead of leaving the plan's cached signature stale",
	);
	assert.throws(
		() => {
			emitted.brandNew = 1;
		},
		TypeError,
		"a new own field throws",
	);
	assert.throws(
		() => {
			emitted.images.push({ id: "i1", mimeType: "image/png", data: "" });
		},
		TypeError,
		"an images.push throws - the record's array is frozen too",
	);

	/*
	 * The production-shaped arm, so the file states the production behaviour out
	 * loud rather than leaving it to the reader: outside a development build the
	 * record is NOT frozen, and the guard costs nothing.
	 */
	const loose = appendPendingUser(EMPTY_TRANSCRIPT, "u2", "hi", [], 1)
		.records[0];
	assert.ok(
		!Object.isFrozen(loose),
		"no freeze outside a development build - the guard is development-only",
	);
});

/*
 * ============================================================================
 * THE ASK GATE, DESKTOP HALF: SETTLE-ONLY ASK ROWS AND THE DIVERT DROP
 * ============================================================================
 *
 * Design `docs/design/ask-gate.md` §3 rows 2/6/7. The gate diverts some queued
 * `ask` calls before they are ever raised, and a diverted ask must leave NO
 * trace on any human surface -- live, on a reconnect seed, or in a subagent's
 * trajectory (whose pages are served VERBATIM and folded through this same
 * reducer). The client's half is two rules:
 *
 *   1. SETTLE-ONLY rows. While the session's queued engine is live (the `asks`
 *      field present on the frontend state -- `queuedAskEngineLive`), an `ask`
 *      call mounts nothing while composing/queued/running; its one row is
 *      created at settle.
 *   2. THE MARKER DROP. At settle, a result whose `details` carry
 *      `ask_gate.hidden: true` paints nothing -- and removes any row an earlier
 *      mode-less frame painted. The durable twin drops the same marker off
 *      `payload.provider_payload.details`.
 *
 * Every arm is DEFENSIVE by contract: with no mode read and no marker the
 * behaviour must be exactly today's, because the core runtime paired with this
 * build may predate the gate entirely.
 */

const ASK_ARGS = {
	questions: [{ question: "Ship it?", options: [{ label: "Yes" }] }],
};
/** The mode read for a session whose owner runs the queued engine. */
const ENGINE_LIVE = { queuedAskEngine: true };
const askCompose = (over = {}) => ({
	type: "tool_call_compose",
	tool_call_id: "c-ask",
	tool_name: "ask",
	argument_bytes: 0,
	...over,
});
const askStart = (over = {}) => ({
	type: "tool_execution_start",
	tool_call_id: "c-ask",
	tool_name: "ask",
	args: ASK_ARGS,
	...over,
});
const askEnd = ({ marked = false, ...over } = {}) => ({
	type: "tool_execution_end",
	tool_call_id: "c-ask",
	tool_name: "ask",
	result: {
		content: [{ type: "text", text: "receipt" }],
		details: marked
			? { ask_gate: { hidden: true, verdict: "clear", reason: "plainly best" } }
			: {},
	},
	is_error: false,
	duration_s: 0.4,
	...over,
});
const toolRows = (state) => state.records.filter((r) => r.kind === "tool");

test("queuedAskEngineLive: a well-formed `asks` or a present `asks_open` is the mode", () => {
	/*
	 * The R1 fix's own case: an empty queue under a live engine publishes
	 * `asks_open: 0` (the field is present whenever the engine is live), and a
	 * gate running on that empty queue — the first-ask case — must read capable.
	 */
	assert.equal(queuedAskEngineLive({ asks_open: 0 }), true);
	assert.equal(queuedAskEngineLive({ asks_open: 2 }), true);
	/*
	 * An older core's only signal: `asks` present iff at least one ask is
	 * outstanding (`ask_wire` publishes an empty list as absence). Presence is
	 * still the rule for a well-formed list, so a present-but-empty list reads
	 * capable — a shape today's core never emits, pinned deliberately rather than
	 * by accident (review round 1, R3).
	 */
	assert.equal(queuedAskEngineLive({ asks: [{ ask_id: "a-1" }] }), true);
	assert.equal(queuedAskEngineLive({ asks: [] }), true);
	/*
	 * The M2 tighten: `asks` keeps the array check the old read had, so a
	 * malformed value reads as "cannot say" (today's mount), never as capable —
	 * the direction that matters when the value cannot come from a publisher.
	 */
	assert.equal(queuedAskEngineLive({ asks: "not-a-list" }), false);
	assert.equal(queuedAskEngineLive({ asks: null }), false);
	assert.equal(queuedAskEngineLive({ asks: null, asks_open: null }), false);
	assert.equal(queuedAskEngineLive({}), false);
	assert.equal(queuedAskEngineLive(null), false);
	assert.equal(queuedAskEngineLive(undefined), false);
});

test("settle-only ask: nothing in flight, the receipt at settle", () => {
	const state = EMPTY_TRANSCRIPT;
	// The compose frame mounts NOTHING -- and the state is untouched, not
	// re-created, so the view's equality gate sees no change.
	const composed = applyEvent(state, askCompose(), 1, ENGINE_LIVE);
	assert.equal(composed, state, "a suppressed compose returns the same state");
	// The start learns the args but paints no row: the object column the
	// settled row will carry is the suppressed start's whole visible effect.
	const started = applyEvent(composed, askStart(), 2, ENGINE_LIVE);
	assert.equal(
		toolRows(started).length,
		0,
		"no running row under the live engine",
	);
	assert.ok(started.argsByCall.has("c-ask"), "the args are still learned");
	// At settle the row APPEARS -- this is the raise arm (no marker) -- with
	// the preserved args and the result's text behind it.
	const settled = applyEvent(started, askEnd(), 3, ENGINE_LIVE);
	const rows = toolRows(settled);
	assert.equal(rows.length, 1, "one row, created at settle");
	assert.equal(rows[0].phase, "done");
	assert.equal(rows[0].output, "receipt");
	assert.deepEqual(
		rows[0].args,
		ASK_ARGS,
		"the suppressed start's args survive",
	);
});

test("settle-only ask: a marked settle leaves no row at all", () => {
	let state = EMPTY_TRANSCRIPT;
	state = applyEvent(state, askCompose(), 1, ENGINE_LIVE);
	state = applyEvent(state, askStart(), 2, ENGINE_LIVE);
	const dropped = applyEvent(state, askEnd({ marked: true }), 3, ENGINE_LIVE);
	assert.equal(toolRows(dropped).length, 0);
	assert.equal(
		dropped,
		state,
		"dropping a row that never existed leaves the state identical",
	);
});

test("unknown mode keeps today's mount; the settle marker still drops the flash", () => {
	// No `queuedAskEngine` option: the mode is unreadable, so the rule falls
	// back to today's mounting -- the flash residual the design accepts (§5).
	let state = EMPTY_TRANSCRIPT;
	state = applyEvent(state, askCompose(), 1);
	state = applyEvent(state, askStart(), 2);
	const running = toolRows(state);
	assert.equal(running.length, 1, "an unreadable mode mounts as today");
	assert.equal(running[0].phase, "running");
	// The divert's own marker still cleans it up at settle, and the drop is
	// idempotent: re-delivering the settling frame changes nothing.
	const dropped = applyEvent(state, askEnd({ marked: true }), 3);
	assert.equal(toolRows(dropped).length, 0, "the flash is dropped at settle");
	assert.equal(applyEvent(dropped, askEnd({ marked: true }), 4), dropped);
});

test("no marker, no mode: an ask behaves exactly as today (the old-core arm)", () => {
	let state = EMPTY_TRANSCRIPT;
	state = applyEvent(state, askCompose(), 1);
	state = applyEvent(state, askStart(), 2);
	state = applyEvent(state, askEnd(), 3);
	const rows = toolRows(state);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].phase, "done");
	assert.equal(rows[0].output, "receipt");
	// An explicit `false` mode is the same statement as an absent one.
	const explicit = applyEvent(EMPTY_TRANSCRIPT, askCompose(), 1, {
		queuedAskEngine: false,
	});
	assert.equal(toolRows(explicit).length, 1);
});

test("a never-run verdict paints under the live engine; an in-flight dictation does not", () => {
	// The verdict is a TERMINAL settle of a call that never ran -- no gate ran,
	// a divert is impossible -- and it renders as today (the contract confirmed
	// with the core's TUI arm, so the two surfaces cannot diverge).
	const state = applyEvent(
		EMPTY_TRANSCRIPT,
		askCompose({
			not_run_reason: "aborted",
			not_run_kind: "aborted",
			argument_bytes: 12,
			dictation_complete: true,
		}),
		1,
		ENGINE_LIVE,
	);
	const rows = toolRows(state);
	assert.equal(rows.length, 1, "the verdict row paints");
	assert.equal(rows[0].neverSent, true);
	assert.equal(rows[0].notRunReason, "aborted");
	// The suppression covers exactly the in-flight shapes: composing, and the
	// finished-dictation `queued` phase.
	const composed = applyEvent(EMPTY_TRANSCRIPT, askCompose(), 1, ENGINE_LIVE);
	assert.equal(composed.records.length, 0);
	const queued = applyEvent(
		composed,
		askCompose({ dictation_complete: true, argument_bytes: 40 }),
		2,
		ENGINE_LIVE,
	);
	assert.equal(queued.records.length, 0, "queued is still in flight");
});

test("the suppression is name-gated: other tools mount as today", () => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "tool_call_compose",
			tool_call_id: "c-bash",
			tool_name: "bash",
			argument_bytes: 0,
		},
		1,
		ENGINE_LIVE,
	);
	state = applyEvent(
		state,
		{
			type: "tool_execution_start",
			tool_call_id: "c-bash",
			tool_name: "bash",
			args: { command: "ls" },
		},
		2,
		ENGINE_LIVE,
	);
	assert.equal(toolRows(state).length, 1, "bash mounts as today");
});

test("a pre-mode row keeps today's handling (the suppression is mount-only)", () => {
	// The row was painted before the mode became readable (a mid-flight
	// frontend update): suppressing the MOUNT must not retract history, so the
	// start transitions it to running as today and the settle resolves it.
	let state = applyEvent(EMPTY_TRANSCRIPT, askCompose(), 1);
	assert.equal(toolRows(state).length, 1);
	state = applyEvent(state, askStart(), 2, ENGINE_LIVE);
	assert.equal(toolRows(state)[0].phase, "running");
	const settled = applyEvent(state, askEnd(), 3, ENGINE_LIVE);
	assert.equal(toolRows(settled)[0].phase, "done");
});

/*
 * The durable half. THE CHILD TRAJECTORY IS WHY THIS HALF IS THE CLIENT'S: a
 * subagent's pages are served verbatim by design, so `applyHistoryPage` -- the
 * child reader's own fold (`use-child-transcript.ts`) -- is the only filter a
 * divert there will ever meet. The entries are the stored shapes:
 * `Message.tool_result` writes the marker into `provider_payload.details`.
 */
const askAssistantEntry = {
	id: "a-ask",
	ts: 10,
	type: "message",
	payload: {
		kind: "message",
		role: "assistant",
		content: [],
		tool_calls: [{ id: "c-ask", name: "ask", arguments: ASK_ARGS }],
		id: "a-ask",
	},
};
const askResultEntry = (details) => ({
	id: "r-ask",
	ts: 11,
	type: "message",
	payload: {
		kind: "message",
		role: "tool",
		tool_call_id: "c-ask",
		tool_name: "ask",
		content: [{ text: "receipt" }],
		provider_payload: { details, duration_s: 0.4 },
		id: "r-ask",
	},
});
const askPage = (details) => ({
	entries: [askAssistantEntry, askResultEntry(details)],
	has_more: false,
	cursor_missing: false,
});

test("the durable fold drops a diverted ask's result row (child trajectories ride this)", () => {
	const dropped = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		askPage({ ask_gate: { hidden: true, verdict: "clear", reason: "x" } }),
	);
	assert.equal(toolRows(dropped).length, 0, "no tool row for a divert");
	// The control: the same page without the marker paints the row, so the drop
	// above is the marker's doing rather than some other refusal.
	const painted = applyHistoryPage(EMPTY_TRANSCRIPT, askPage({}));
	assert.equal(toolRows(painted).length, 1, "an unmarked ask paints");
	// The marker is the ONLY trigger: a false or malformed `ask_gate` is not
	// one, on the same argument the core's predicates make.
	for (const details of [
		{ ask_gate: { hidden: false } },
		{ ask_gate: "hidden" },
		{},
	]) {
		const state = applyHistoryPage(EMPTY_TRANSCRIPT, askPage(details));
		assert.equal(
			toolRows(state).length,
			1,
			`paints for ${JSON.stringify(details)}`,
		);
	}
});

/*
 * The reconnect seed (`applyLiveSeed`): a viewer that attaches mid-turn folds
 * the retained live events through the same `applyEvent`, and the mode comes
 * from the very frontend snapshot the seed carries. The assistant page is
 * folded FIRST because it is the anchor the settling frame is placed by
 * (`seededClock`'s durable-statement rule), exactly as the snapshot flow does.
 */
const seedFrontend = (live_events, asks) => ({
	streaming: true,
	generation: 1,
	live_events,
	...(asks === undefined ? {} : { asks }),
});
const anchored = () =>
	applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [askAssistantEntry],
		has_more: false,
		cursor_missing: false,
	});

test("a reconnect seed drops a diverted ask's retained end and suppresses its compose", () => {
	// The marked end folds (the anchor dates it) and is dropped, so nothing
	// paints -- non-vacuously: the unmarked control below paints the same fold.
	const marked = applyLiveSeed(
		anchored(),
		seedFrontend([askEnd({ marked: true })], [{ ask_id: "a-1" }]),
		100,
		null,
	);
	assert.equal(toolRows(marked).length, 0, "the retained end is dropped");
	const control = applyLiveSeed(
		anchored(),
		seedFrontend([askEnd()], [{ ask_id: "a-1" }]),
		100,
		null,
	);
	assert.equal(toolRows(control).length, 1, "the unmarked end paints");
	// A compose still in the window is suppressed by the seed's own mode read
	// (`asks` present on the frontend), and the marked end after it stays
	// dropped: the pair nets to nothing.
	const window = applyLiveSeed(
		anchored(),
		seedFrontend([askCompose(), askEnd({ marked: true })], [{ ask_id: "a-1" }]),
		100,
		null,
	);
	assert.equal(toolRows(window).length, 0, "compose suppressed, end dropped");
	// Without `asks` the mode is unreadable, and the same compose mounts as
	// today -- which is what makes the arm above the mode's doing.
	const unreadable = applyLiveSeed(
		anchored(),
		seedFrontend([askCompose()]),
		100,
		null,
	);
	const rows = toolRows(unreadable);
	assert.equal(
		rows.length,
		1,
		"an unreadable mode mounts the compose as today",
	);
	assert.equal(rows[0].phase, "composing");
});

/* --------------- the quiet turn arrives as ordinary rows (S2) --------------- */

/*
 * The quiet turn has NO wire kind: core persists `no_reply` as an ordinary
 * assistant tool call and its tool result, and the reducer's contract is that it
 * treats them as exactly that. These cases pin "ordinary" - the pair folds with
 * the same fields any tool row has, live and replayed, and nothing here is
 * special-cased. The UI hides the row at PAINT and reads its name structurally
 * (`turn-segments.ts`'s `isQuietTurnCall`); CORE deliberately keeps the name out
 * of its `HIDDEN_TOOL_NAMES` (rows.py), because history windows subtract that
 * set and the collapse model needs the row as its structural close.
 */
test("a `no_reply` call folds as an ordinary tool row, live and replayed", () => {
	let live = EMPTY_TRANSCRIPT;
	live = applyEvent(
		live,
		{
			type: "tool_execution_start",
			tool_call_id: "c-quiet",
			tool_name: "no_reply",
			args: {},
		},
		10,
	);
	live = applyEvent(
		live,
		{
			type: "tool_execution_end",
			tool_call_id: "c-quiet",
			tool_name: "no_reply",
			result: { content: [{ type: "text", text: "Quiet." }] },
			is_error: false,
			duration_s: 0.01,
		},
		11,
	);
	const [liveRow] = toolRows(live);
	assert.equal(liveRow.toolName, "no_reply");
	assert.equal(liveRow.phase, "done");
	assert.equal(liveRow.isError, false);
	assert.equal(liveRow.durationS, 0.01);
	/*
	 * The durable replay: the same pair read off a history page. The facts the
	 * quiet-close rule reads (name, phase) are identical - the row is the same
	 * row, and a reload does not degrade it.
	 */
	const durable = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			{
				id: "e-quiet",
				ts: 20,
				type: "message",
				payload: {
					kind: "message",
					role: "tool",
					tool_call_id: "c-quiet",
					tool_name: "no_reply",
					content: [{ type: "text", text: "Quiet." }],
					provider_payload: { duration_s: 0.01, details: {} },
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	const [durableRow] = toolRows(durable);
	assert.equal(durableRow.toolName, "no_reply");
	assert.equal(durableRow.phase, "done");
});
