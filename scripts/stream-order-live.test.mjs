import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Live text must never HOP across its own tool rows while a turn streams, and
 * the order painted live must be the order the journal later commits.
 *
 * THE REPORT (operator, four screenshots of one running turn): text A, the
 * `git grep` call, text B (`InfoList` in backticks), the `sed` call - and then
 * text B JUMPED below `sed` and a second `sed`, while the calls grouped above it.
 * Later text C appeared in its correct slot.
 *
 * ROOT CAUSE, reproduced below through the PRODUCTION reducer (no fixture
 * rewriting, no ts): in journal mode `journalOrderedRecords` places a row that
 * has no `journal_seq` yet by `sourceAdmissionAnchor`, and that anchor was
 * "the nearest PLACED predecessor at the moment of derivation", re-derived
 * every time a rebuild (`message_end`, `tool_execution_*`, `tool_call_compose`)
 * dropped it. Placement state moves as the `journal_order_ready` wakes arrive
 * (they trail the live frames), so two sibling unplaced rows - an assistant row
 * and its own call - were anchored to DIFFERENT predecessors and re-sorted
 * against each other. A row's place is a fact of ARRIVAL, not of whichever
 * rows happen to be placed when the wake lands.
 *
 * THE EVENT SEQUENCE is the harness's real one (local-operator
 * `harness/loop.py`): message_start, message_update deltas, tool_call_compose,
 * message_end carrying `tool_calls`, tool_execution_start/end per call, the
 * next message_start - and the journal's `journal_order_ready` wakes, which
 * name each committed row's `journal_seq` some frames AFTER it was painted
 * (`session/runtime/serving.py::emit_order`). The committed order they
 * describe is read from the real journal of the reported session
 * (62480a153ced, lines 6846-6862): each assistant row, then its tool results.
 */

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
const R = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const text = (id, body, calls = []) => ({
	id,
	role: "assistant",
	content: [{ type: "text", text: body }],
	tool_calls: calls,
});
const call = (id) => ({ id, function: { name: "bash", arguments: "{}" } });
const result = { content: [{ type: "text", text: "ok" }] };

/** One live frame at a time on a single clock, with a real `(epoch, seq)`. */
function session({ journal }) {
	let clock = 1_000_000;
	let seq = 0;
	let state = R.applyHistoryPage(
		R.EMPTY_TRANSCRIPT,
		{
			entries: [
				{
					id: "u1",
					type: "message",
					ts: 1000,
					payload: {
						id: "u1",
						role: "user",
						content: [{ type: "text", text: "go" }],
						tool_calls: [],
					},
					...(journal ? { journal_seq: 0 } : {}),
				},
			],
			has_more: false,
			cursor_missing: false,
			...(journal
				? { journal_generation: "g", journal_order_state: "ready" }
				: {}),
		},
		{ authoritative: true },
	);
	return {
		get state() {
			return state;
		},
		emit(event) {
			clock += 50;
			seq += 1;
			state = R.applyEvent(state, event, clock, { frame: { epoch: "e", seq } });
		},
		ready(...rows) {
			this.emit({ type: "journal_order_ready", journal_generation: "g", rows });
		},
		order() {
			return state.records.map((record) => record.id);
		},
	};
}

const assistantRow = (id, seq) => ({
	id,
	type: "message",
	role: "assistant",
	journal_seq: seq,
});
const toolRow = (id, callId, seq) => ({
	id,
	type: "message",
	role: "tool",
	tool_call_id: callId,
	journal_seq: seq,
});

/** The whole turn as frames, in the harness's emission order. */
function frames(s) {
	const f = [];
	const step = (event) => f.push(() => s.emit(event));
	step({ type: "message_start", message: text("m1", "") });
	step({ type: "message_update", message: text("m1", ""), delta: "A" });
	step({
		type: "tool_call_compose",
		tool_call_id: "c1",
		tool_name: "bash",
		argument_bytes: 5,
	});
	step({ type: "message_end", message: text("m1", "A", [call("c1")]) });
	step({
		type: "tool_execution_start",
		tool_call_id: "c1",
		tool_name: "bash",
		args: { command: "grep" },
	});
	step({
		type: "tool_execution_end",
		tool_call_id: "c1",
		tool_name: "bash",
		result,
		duration_s: 0.7,
	});
	step({ type: "message_start", message: text("m2", "") });
	step({ type: "message_update", message: text("m2", ""), delta: "B" });
	step({
		type: "tool_call_compose",
		tool_call_id: "c2",
		tool_name: "bash",
		argument_bytes: 5,
	});
	step({ type: "message_end", message: text("m2", "B", [call("c2")]) });
	step({
		type: "tool_execution_start",
		tool_call_id: "c2",
		tool_name: "bash",
		args: { command: "sed" },
	});
	step({
		type: "tool_execution_end",
		tool_call_id: "c2",
		tool_name: "bash",
		result,
		duration_s: 0.3,
	});
	step({ type: "message_start", message: text("m3", "") });
	step({ type: "message_update", message: text("m3", ""), delta: "C" });
	step({ type: "message_end", message: text("m3", "C") });
	return f;
}
const COMMITTED = [
	["m1", assistantRow("m1", 1)],
	["r1", toolRow("r1", "c1", 2)],
	["m2", assistantRow("m2", 3)],
	["r2", toolRow("r2", "c2", 4)],
	["m3", assistantRow("m3", 5)],
];
/** Frame index after which each committed row becomes announce-able. */
const READY_AFTER = { m1: 3, r1: 5, m2: 9, r2: 11, m3: 14 };
const SETTLED = ["u1", "m1", "tool:c1", "m2", "tool:c2", "m3"];

/**
 * Run the turn; the wake for row `x` arrives `delay[x]` frames after the row
 * was painted (>= 100: only after the whole turn).
 */
function run(delay, { journal = true } = {}) {
	const s = session({ journal });
	const steps = frames(s);
	const wakes = COMMITTED.map(([name, row]) => ({
		name,
		row,
		at: READY_AFTER[name] + delay[name],
	}));
	const observed = [];
	steps.forEach((play, index) => {
		play();
		observed.push({ at: `frame ${index}`, order: s.order() });
		if (!journal) return;
		for (const w of wakes) {
			if (w.at !== index) continue;
			s.ready(w.row);
			observed.push({ at: `wake ${w.name}`, order: s.order() });
		}
	});
	if (journal)
		for (const w of wakes)
			if (w.at >= steps.length) {
				s.ready(w.row);
				observed.push({ at: `late wake ${w.name}`, order: s.order() });
			}
	return { observed, final: s.order() };
}

/** Rows already painted must keep their relative order on every later frame. */
function hops(observed) {
	const out = [];
	for (let i = 1; i < observed.length; i++) {
		const before = observed[i - 1].order;
		const after = observed[i].order;
		const kept = before.filter((id) => after.includes(id));
		const now = after.filter((id) => kept.includes(id));
		if (kept.join() !== now.join())
			out.push({ at: observed[i].at, before: kept, after: now });
	}
	return out;
}

const DELAYS = [0, 1, 3, 100];
function* everyDelay() {
	for (const m1 of DELAYS)
		for (const r1 of DELAYS)
			for (const m2 of DELAYS)
				for (const r2 of DELAYS)
					for (const m3 of DELAYS) yield { m1, r1, m2, r2, m3 };
}

test("the reported four-frame sequence: B stays between its calls, never below sed", () => {
	// Wakes trail the frames by a few frames, the cadence the operator saw.
	const { observed, final } = run({ m1: 0, r1: 3, m2: 3, r2: 3, m3: 3 });
	assert.deepEqual(hops(observed), []);
	assert.deepEqual(final, SETTLED);
});

test("no wake latency, in any combination, makes a painted row hop", () => {
	let combos = 0;
	for (const delay of everyDelay()) {
		combos += 1;
		const { observed, final } = run(delay);
		assert.deepEqual(hops(observed), [], JSON.stringify(delay));
		assert.deepEqual(final, SETTLED, JSON.stringify(delay));
	}
	assert.equal(combos, 1024);
});

test("older backend (no journal order): arrival order, same answer", () => {
	const { observed, final } = run(
		{ m1: 0, r1: 0, m2: 0, r2: 0, m3: 0 },
		{ journal: false },
	);
	assert.deepEqual(hops(observed), []);
	assert.deepEqual(final, SETTLED);
});

/* ----------------------------------------------- the rest of the case matrix */

const pageOf = (entries, extra = {}) => ({
	entries,
	has_more: false,
	cursor_missing: false,
	journal_generation: "g",
	journal_order_state: "ready",
	...extra,
});
const durable = (id, seq, payload) => ({
	id,
	type: "message",
	ts: 2000 + seq,
	payload,
	journal_seq: seq,
});
const userPayload = (id, body) => ({
	id,
	role: "user",
	content: [{ type: "text", text: body }],
	tool_calls: [],
});
const toolPayload = (id, callId) => ({
	id,
	role: "tool",
	tool_call_id: callId,
	name: "bash",
	content: [{ type: "text", text: "ok" }],
});
const bash = (callId, command) => ({
	type: "tool_execution_start",
	tool_call_id: callId,
	tool_name: "bash",
	args: { command },
});
const done = (callId) => ({
	type: "tool_execution_end",
	tool_call_id: callId,
	tool_name: "bash",
	result,
	duration_s: 0.1,
});

test("parallel calls: start order and end order differ, committed slot order wins live and after", () => {
	const s = session({ journal: true });
	s.emit({ type: "message_start", message: text("m1", "") });
	for (const id of ["c1", "c2", "c3"])
		s.emit({
			type: "tool_call_compose",
			tool_call_id: id,
			tool_name: "bash",
			argument_bytes: 5,
		});
	s.emit({
		type: "message_end",
		message: text("m1", "A", [call("c1"), call("c2"), call("c3")]),
	});
	for (const id of ["c1", "c3", "c2"]) s.emit(bash(id, id));
	const before = s.order();
	for (const id of ["c3", "c1", "c2"]) s.emit(done(id));
	assert.deepEqual(s.order(), before);
	assert.deepEqual(s.order(), ["u1", "m1", "tool:c1", "tool:c2", "tool:c3"]);
	// A backend that never announced compose frames: the calls first appear at
	// their START, in start order - the committed slot order still wins.
	const bare = session({ journal: true });
	bare.emit({ type: "message_start", message: text("m1", "") });
	bare.emit({
		type: "message_end",
		message: text("m1", "A", [call("c1"), call("c2"), call("c3")]),
	});
	for (const id of ["c1", "c3", "c2"]) bare.emit(bash(id, id));
	for (const id of ["c3", "c1", "c2"]) bare.emit(done(id));
	assert.deepEqual(bare.order(), ["u1", "m1", "tool:c1", "tool:c2", "tool:c3"]);
	bare.ready(
		assistantRow("m1", 1),
		toolRow("r1", "c1", 2),
		toolRow("r2", "c2", 3),
		toolRow("r3", "c3", 4),
	);
	assert.deepEqual(bare.order(), ["u1", "m1", "tool:c1", "tool:c2", "tool:c3"]);
});

test("steering mid-turn: the steer lands between the rows it arrived between", () => {
	const s = session({ journal: true });
	for (const step of frames(s)) step();
	// The operator steers after the turn's text C; the echo is the owner's own
	// `message_start`, and its wake arrives late. Nothing painted may move.
	const before = s.order();
	s.emit({
		type: "message_start",
		message: userPayload("steer", "also check x"),
	});
	assert.deepEqual(s.order().slice(0, before.length), before);
	assert.equal(s.order().at(-1), "steer");
	s.emit({ type: "message_start", message: text("m4", "") });
	s.emit({ type: "message_update", message: text("m4", ""), delta: "D" });
	s.ready(
		assistantRow("m1", 1),
		toolRow("r1", "c1", 2),
		assistantRow("m2", 3),
		toolRow("r2", "c2", 4),
		assistantRow("m3", 5),
	);
	s.ready({ id: "steer", type: "message", role: "user", journal_seq: 6 });
	assert.deepEqual(s.order(), [...before, "steer", "m4"]);
});

test("interruption: a stopped call and the text around it stay where they arrived", () => {
	const s = session({ journal: true });
	s.emit({ type: "message_start", message: text("m1", "") });
	s.emit({ type: "message_update", message: text("m1", ""), delta: "A" });
	s.emit({ type: "message_end", message: text("m1", "A", [call("c1")]) });
	s.emit(bash("c1", "sleep"));
	s.emit({ type: "message_start", message: text("m2", "") });
	s.emit({ type: "message_update", message: text("m2", ""), delta: "B" });
	const before = s.order();
	s.emit({
		type: "tool_execution_end",
		tool_call_id: "c1",
		tool_name: "bash",
		result: {
			content: [{ type: "text", text: "Tool call skipped: interrupted" }],
			is_error: true,
		},
		is_error: true,
		duration_s: 1,
	});
	s.ready(assistantRow("m1", 1));
	s.emit({
		type: "message_end",
		message: { ...text("m2", "B"), stop_reason: "aborted" },
	});
	s.ready(toolRow("r1", "c1", 2), assistantRow("m2", 3));
	assert.deepEqual(s.order(), before);
	assert.deepEqual(s.order(), ["u1", "m1", "tool:c1", "m2"]);
});

test("mid-turn join: seeded live_events then live frames and late wakes keep one order", () => {
	// A viewer joins with the user row and m1 durable and the rest in the seed.
	let state = R.applyHistoryPage(
		R.EMPTY_TRANSCRIPT,
		pageOf([
			durable("u1", 0, userPayload("u1", "go")),
			durable("m1", 1, { ...text("m1", "A", [call("c1")]) }),
			durable("r1", 2, toolPayload("r1", "c1")),
		]),
		{ authoritative: true },
	);
	const seed = [
		{ type: "message_start", message: text("m2", "") },
		{ type: "message_update", message: text("m2", ""), delta: "B" },
		{
			type: "tool_call_compose",
			tool_call_id: "c2",
			tool_name: "bash",
			argument_bytes: 5,
		},
		{ type: "message_end", message: text("m2", "B", [call("c2")]) },
		bash("c2", "sed"),
	];
	state = R.applyLiveSeed(
		state,
		{ streaming: true, generation: 1, live_events: seed },
		5_000_000,
		{ epoch: "e", seq: 10 },
	);
	const joined = state.records.map((record) => record.id);
	assert.deepEqual(joined, ["u1", "m1", "tool:c1", "m2", "tool:c2"]);
	let at = 11;
	const live = (event) => {
		state = R.applyEvent(state, event, 5_000_000 + at * 50, {
			frame: { epoch: "e", seq: at++ },
		});
	};
	live(done("c2"));
	live({ type: "message_start", message: text("m3", "") });
	live({ type: "message_update", message: text("m3", ""), delta: "C" });
	live({
		type: "journal_order_ready",
		journal_generation: "g",
		rows: [toolRow("r2", "c2", 4)],
	});
	live({
		type: "journal_order_ready",
		journal_generation: "g",
		rows: [assistantRow("m2", 3)],
	});
	assert.deepEqual(
		state.records.map((record) => record.id),
		["u1", "m1", "tool:c1", "m2", "tool:c2", "m3"],
	);
});

test("reconcile: the persisted page replaces the live rows without moving them", () => {
	const s = session({ journal: true });
	for (const step of frames(s)) step();
	const live = s.order();
	// The reconcile read returns the committed journal for the same turn.
	const next = R.applyHistoryPage(
		s.state,
		pageOf([
			durable("u1", 0, userPayload("u1", "go")),
			durable("m1", 1, text("m1", "A", [call("c1")])),
			durable("r1", 2, toolPayload("r1", "c1")),
			durable("m2", 3, text("m2", "B", [call("c2")])),
			durable("r2", 4, toolPayload("r2", "c2")),
			durable("m3", 5, text("m3", "C")),
		]),
		{ authoritative: true },
	);
	assert.deepEqual(
		next.records.map((record) => record.id),
		live,
	);
	assert.deepEqual(live, SETTLED);
});

test("remote / peer-source lane: facts rank, bodies own - the same arrival chain holds", () => {
	let state = R.applyHistoryPage(
		R.EMPTY_TRANSCRIPT,
		pageOf([durable("u1", 0, userPayload("u1", "go"))]),
		{ authoritative: true, peerSource: true },
	);
	let n = 0;
	const emit = (event) => {
		state = R.applyEvent(state, event, 9_000_000 + ++n * 50, {
			frame: { epoch: "e", seq: n },
		});
	};
	const wake = (...rows) =>
		emit({ type: "journal_order_ready", journal_generation: "g", rows });
	emit({ type: "message_start", message: text("m1", "") });
	emit({ type: "message_end", message: text("m1", "A", [call("c1")]) });
	emit(bash("c1", "grep"));
	emit(done("c1"));
	emit({ type: "message_start", message: text("m2", "") });
	emit({ type: "message_update", message: text("m2", ""), delta: "B" });
	emit({
		type: "tool_call_compose",
		tool_call_id: "c2",
		tool_name: "bash",
		argument_bytes: 5,
	});
	wake(assistantRow("m1", 1));
	wake(toolRow("r1", "c1", 2));
	emit({ type: "message_end", message: text("m2", "B", [call("c2")]) });
	emit(bash("c2", "sed"));
	assert.deepEqual(
		state.records.map((record) => record.id),
		["u1", "m1", "tool:c1", "m2", "tool:c2"],
	);
	wake(assistantRow("m2", 3));
	assert.deepEqual(
		state.records.map((record) => record.id),
		["u1", "m1", "tool:c1", "m2", "tool:c2"],
	);
});

test("history_delta rows join at arrival, not at the top", () => {
	const s = session({ journal: true });
	s.emit({ type: "message_start", message: text("m1", "") });
	s.emit({ type: "message_end", message: text("m1", "A") });
	s.emit({
		type: "history_delta",
		messages: [text("gap", "arrived while away")],
	});
	s.emit({ type: "message_start", message: text("m2", "") });
	assert.deepEqual(s.order(), ["u1", "m1", "gap", "m2"]);
	s.ready(assistantRow("m1", 1), assistantRow("gap", 2));
	assert.deepEqual(s.order(), ["u1", "m1", "gap", "m2"]);
});

test("turn end (agent_end) reorders nothing", () => {
	const s = session({ journal: true });
	for (const step of frames(s)) step();
	s.ready(
		assistantRow("m1", 1),
		toolRow("r1", "c1", 2),
		assistantRow("m2", 3),
		toolRow("r2", "c2", 4),
		assistantRow("m3", 5),
	);
	const before = s.order();
	s.emit({ type: "agent_end", generation: 1, messages: [] });
	assert.deepEqual(s.order(), before);
});
