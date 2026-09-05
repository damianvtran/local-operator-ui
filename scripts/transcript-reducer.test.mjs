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
} = reducer;

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
	state = applyEvent(state, { type: "message_start", message: user("u1", "hi") }, 1);
	state = applyEvent(state, { type: "agent_start", generation: "1" }, 2);
	state = applyEvent(state, { type: "message_start", message: assistant("a1", "") }, 3);
	const before = state.records.find((r) => r.id === "u1");
	const deltas = 200;
	for (let i = 0; i < deltas; i++) {
		state = applyEvent(
			state,
			{ type: "message_update", delta: `tok${i} `, message: assistant("a1", "") },
			4 + i,
		);
	}
	const after = state.records.find((r) => r.id === "u1");
	// The equality gate: a record untouched by the delta stream is the SAME
	// object, so a memoised row sees no prop change and does not re-render.
	assert.equal(before, after, "unchanged record identity preserved across deltas");
	const a1 = state.records.find((r) => r.id === "a1");
	assert.equal(a1.kind, "assistant");
	assert.equal(a1.streaming, true);
	assert.equal(a1.text.split(" ").filter(Boolean).length, deltas);
	assert.equal(state.records.length, 2, "no per-delta rows");
});

test("message_end is authoritative over accumulated deltas", () => {
	let state = EMPTY_TRANSCRIPT;
	state = applyEvent(state, { type: "message_start", message: assistant("a1", "") }, 1);
	state = applyEvent(state, { type: "message_update", delta: "Hel", message: assistant("a1", "") }, 2);
	state = applyEvent(state, { type: "message_end", message: assistant("a1", "Hello!") }, 3);
	const a1 = state.records.find((r) => r.id === "a1");
	assert.equal(a1.text, "Hello!");
	assert.equal(a1.streaming, false);
});

test("durable history wins over live projections and replay never regresses it", () => {
	let state = EMPTY_TRANSCRIPT;
	// Live projection from an old replay (partial text).
	state = applyEvent(state, { type: "message_start", message: assistant("a1", "") }, 1);
	state = applyEvent(state, { type: "message_update", delta: "part", message: assistant("a1", "") }, 2);
	// Snapshot's durable page carries the full row.
	const page = {
		entries: [
			{ id: "u1", ts: 10, type: "message", payload: { kind: "message", ...user("u1", "hi") } },
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
	assert.equal(again, state, "stale replay is a no-op returning the same state");
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
			{ id: "u1", ts: 10, type: "message", payload: { kind: "message", ...user("u1", "hi") } },
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
				{ type: "message_update", delta: "in flight", message: assistant("a2", "") },
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
		{ type: "tool_call_compose", tool_call_id: "c1", tool_name: "read", argument_bytes: 0 },
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
			{ id: "u1", ts: 10, type: "message", payload: { kind: "message", ...user("u1", "hi") } },
		],
		has_more: false,
		cursor_missing: false,
	});
	state = applyEvent(state, { type: "message_start", message: assistant("a9", "") }, 1);
	const dropped = dropLiveRecords(state);
	assert.deepEqual(
		dropped.records.map((r) => r.id),
		["u1"],
	);
	const cleared = clearTranscript(state);
	assert.equal(cleared.records.length, 0);
	// Clearing is a renderer concern: the reducer holds nothing that would
	// tell a backend to delete, and re-applying the page repaints it.
	assert.equal(applyHistoryPage(cleared, {
		entries: [
			{ id: "u1", ts: 10, type: "message", payload: { kind: "message", ...user("u1", "hi") } },
		],
		has_more: false,
		cursor_missing: false,
	}).records.length, 1);
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
	state = applyHistoryPage(state, { entries, has_more: false, cursor_missing: false });
	state = applyEvent(state, { type: "message_start", message: assistant("live", "") }, 1000);
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
	console.log(`reducer: ${perDelta.toFixed(4)} ms per delta over ${state.records.length} rows`);
	assert.ok(perDelta < 1, `per-delta cost ${perDelta}ms`);
	assert.equal(state.records.at(-1).text.length, n);
});
