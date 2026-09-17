import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The UI's half of the tool-compose lifecycle, asserted against the REAL frames.
 *
 * `ToolCallComposeEvent` (local-operator, `harness/types.py`) announces a call
 * the model is still writing and then gives it one of THREE endings: it starts
 * (a `tool_execution_start` carries the real id), it finishes its dictation and
 * waits (`dictation_complete`), or it never runs at all (`not_run_reason`) —
 * and the last two deliberately get no start and no end, because the API server
 * pairs tool records by id and a synthetic start would claim the tool ran. The
 * TUI (`app.py`'s compose handler, `ToolCard.mark_queued`/`mark_not_run`) and
 * the phone (`projection.py`) both read all three; this transport read only the
 * id, the name and the byte count, so it painted every terminal frame as a live
 * `composing` row that nothing could ever settle.
 *
 * The frames in `scripts/fixtures/phantom-compose-rows.json` are the reported
 * ones, copied verbatim from the read-only snapshot of session `8f8660fb8e64`
 * (`/v1/desktop/sessions/8f8660fb8e64`, captured 1789652393): four never-run
 * calls — `hub 2.0 KB`, `wait 82 B`, `wait 77 B`, `wait 87 B` — riding the
 * persisted in-flight seed into every conversation switch while ONE `wait` call
 * was genuinely in flight, stuck for the whole multi-hour wait. The fixture's
 * own note says which parts are verbatim and which are constructions, and the
 * first test here pins that shape so the rest cannot drift from it.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/canonical/transcript-reducer";',
			'export { deriveWorkingLine } from "./src/renderer/src/features/chat/canonical/working-line-model";',
		].join("\n"),
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
	deriveWorkingLine,
	seedCallsMissingLabels,
} = reducer;

const FIXTURE = JSON.parse(
	readFileSync("scripts/fixtures/phantom-compose-rows.json", "utf8"),
);
const PAGE = FIXTURE.page.entries;
const TWIN_PAGE = FIXTURE.pageWithTwin.entries;
const SEED = FIXTURE.seed.liveEvents;
const QUEUED_FRAME = FIXTURE.queuedSeed.liveEvents[0];
const LAST_TS = FIXTURE.historyWindow.lastTs;
const ARRIVAL_MS = Math.round((LAST_TS + 3 * 3600) * 1000);

const pageOf = (entries) => ({
	entries,
	has_more: true,
	cursor_missing: false,
});
const withPage = (entries = PAGE) =>
	applyHistoryPage(EMPTY_TRANSCRIPT, pageOf(entries));
/** The snapshot's own three fields: the only ones the fold reads. */
const frontendOf = (events, streaming) => ({
	streaming,
	generation: FIXTURE.seed.generation,
	live_events: events,
});
const rowFor = (state, id) => state.records.find((record) => record.id === id);
const ids = (state) => state.records.map((record) => record.id);

const NEVER_RUN = SEED.filter(
	(event) => event.type === "tool_call_compose" && event.not_run_reason,
);
const CALL_IDS = NEVER_RUN.map((event) => event.tool_call_id);
const HUB = { id: "tool:call_00_afo3u0z5uqDNFWXRUYo83358", bytes: 2004 };
const IN_FLIGHT = SEED.find((event) => event.type === "tool_execution_start");
const IN_FLIGHT_ROW = `tool:${IN_FLIGHT.tool_call_id}`;
const IN_FLIGHT_TS = Math.round(IN_FLIGHT.started_at_epoch * 1000);

test("the fixture is the terminal shape: four never-run frames, one real start", () => {
	// The evidence pack's own facts, pinned here because every assertion below
	// reads from them. If a runtime ever starts synthesising a start/end for a
	// never-run call, this fails rather than the suite quietly testing a shape
	// production does not send.
	assert.equal(NEVER_RUN.length, 4);
	for (const frame of NEVER_RUN) {
		assert.equal(frame.dictation_complete, true);
		assert.match(
			frame.not_run_reason,
			/^Invalid arguments: arguments are not valid JSON/,
		);
	}
	const all = SEED.map((event) => event.type);
	assert.equal(all.filter((type) => type === "tool_call_compose").length, 4);
	assert.equal(all.filter((type) => type === "tool_execution_start").length, 1);
	for (const id of CALL_IDS) {
		assert.ok(
			!SEED.some((event) => event.tool_execution_end?.tool_call_id === id),
			"a never-run call gets no end event — the API server pairs by id",
		);
	}
	assert.equal(IN_FLIGHT.tool_call_id, "call_00_RurxNeugxLBuwuWcplj62934");
});

test("a never-run frame the page cannot date is refused, so nothing lands at the tail", () => {
	/*
	 * THE REPORTED DEFECT. The turn is in flight (`streaming: true`) and the
	 * four calls' durable rows are hours older than the snapshot's 100-row
	 * window, so nothing in the seed states a time for them. The old fold handed
	 * every clockless frame that would CREATE a row the reader's own arrival —
	 * which is how four never-run calls from the small hours were painted as
	 * live `composing` rows under the conversation's newest message.
	 */
	const state = applyLiveSeed(withPage(), frontendOf(SEED, true), ARRIVAL_MS);
	assert.deepEqual(
		ids(state),
		[...PAGE.map((entry) => entry.id), IN_FLIGHT_ROW],
		"the page's rows, then the one call that really is running",
	);
	for (const id of CALL_IDS) {
		assert.equal(rowFor(state, `tool:${id}`), undefined);
	}
	const painted = rowFor(state, IN_FLIGHT_ROW);
	assert.equal(painted.phase, "running");
	assert.equal(painted.startedAt, IN_FLIGHT_TS);
	assert.equal(
		painted.ts,
		IN_FLIGHT_TS,
		"placed at the instant the producer stamped, not the reader's arrival",
	);
	assert.notEqual(
		ARRIVAL_MS,
		IN_FLIGHT_TS,
		"the two clocks are distinguishable",
	);
});

test("a never-run frame settles the row its own announcement left, in place", () => {
	// The live shape: the announcement painted the row, and the verdict arrives
	// afterwards. It settles THAT row — same id, same position, same `ts` — and
	// never opens a second one.
	const callId = CALL_IDS[0];
	const announced = applyEvent(
		withPage(),
		{
			type: "tool_call_compose",
			tool_call_id: callId,
			tool_name: "hub",
			argument_bytes: 1900,
			dictation_complete: false,
			not_run_reason: null,
		},
		ARRIVAL_MS,
	);
	assert.equal(rowFor(announced, `tool:${callId}`).phase, "composing");
	const settled = applyEvent(announced, NEVER_RUN[0], ARRIVAL_MS + 500);
	assert.equal(
		settled.records.filter((r) => r.id === `tool:${callId}`).length,
		1,
	);
	const row = rowFor(settled, `tool:${callId}`);
	assert.equal(row.phase, "done", "it is over");
	assert.equal(
		row.notRunReason,
		NEVER_RUN[0].not_run_reason,
		"the harness's own words, unedited",
	);
	assert.equal(
		row.argumentBytes,
		HUB.bytes,
		"the terminal frame's final count",
	);
	assert.equal(row.startedAt, null, "nothing executed, so no clock");
	assert.equal(row.durationS, null);
	assert.equal(
		row.isError,
		false,
		"no tool reported a failure — the call was never sent to one",
	);
	assert.equal(
		row.neverSent,
		true,
		"the fact a turn-death settlement shares with this one",
	);
	assert.equal(
		row.ts,
		ARRIVAL_MS,
		"the row keeps the instant its announcement was painted at",
	);
	// A second replay of the same verdict is the same state, not a second settle.
	assert.equal(applyEvent(settled, NEVER_RUN[0], ARRIVAL_MS + 900), settled);
});

test("a never-run frame cannot walk a settled durable row back to composing", () => {
	/*
	 * The durable twin case: the page DOES carry the call's own `role: "tool"`
	 * row (the real session's transcript has one, with `is_error` and the same
	 * Invalid-arguments text). A settled row has outgrown the announcement, so
	 * the frame folds onto it and changes nothing — the mirror of the TUI's
	 * running-registry early return and the phone's `started` guard.
	 */
	const twin = TWIN_PAGE.find((entry) => entry.payload.role === "tool");
	const durable = applyLiveSeed(
		withPage(TWIN_PAGE),
		frontendOf(SEED, true),
		ARRIVAL_MS,
	);
	const row = rowFor(durable, `tool:${twin.payload.tool_call_id}`);
	assert.equal(row.phase, "done");
	assert.equal(row.isError, true, "the durable row's own verdict stands");
	assert.equal(row.notRunReason, null);
	assert.equal(row.ts, Math.round(twin.ts * 1000));
});

test("a settled dictation says queued, and keeps the size the frame reached", () => {
	/*
	 * The second ending: the model stopped writing and the call has NOT started.
	 * It may wait behind a sibling's execution group for a long time — a
	 * `wait(wait_ms=1800000)` ahead of an `exclusive` sibling is the case the
	 * contract's docstring names — and a row that went on saying `composing`
	 * claimed work the model had finished, with a clock counting from a dictation
	 * that had ended.
	 */
	const callId = QUEUED_FRAME.tool_call_id;
	let state = applyEvent(
		withPage(),
		{
			type: "tool_call_compose",
			tool_call_id: callId,
			tool_name: "wait",
			argument_bytes: 40,
			dictation_complete: false,
			not_run_reason: null,
		},
		ARRIVAL_MS,
	);
	assert.equal(rowFor(state, `tool:${callId}`).phase, "composing");
	state = applyEvent(state, QUEUED_FRAME, ARRIVAL_MS + 1_000);
	let row = rowFor(state, `tool:${callId}`);
	assert.equal(row.phase, "queued");
	assert.equal(
		row.argumentBytes,
		QUEUED_FRAME.argument_bytes,
		"the terminal frame's own final count replaces the running one",
	);
	assert.equal(row.startedAt, null, "queued is not running: no clock");

	// The rung that names it, split from `composing` so the band stops claiming
	// the model is still writing.
	const rung = deriveWorkingLine({
		waiting: true,
		compacting: false,
		starting: false,
		gate: false,
		unavailable: false,
		records: state.records,
	});
	assert.equal(rung.activity, "waiting to run a call");
	assert.equal(rung.phase, "queued");
	assert.equal(
		rung.startedAt,
		undefined,
		"a queued call has no zero to count from",
	);
	// The band WITHHOLDS the number rather than counting from the label's own
	// change: `WorkingLine` draws no clock for this rung, and the state says so.
	// Without it the line read `waiting to run a call 1s`, ticking from the phase
	// edge — and after a seed, from the viewer's own mount.
	assert.equal(rung.clock, false);

	// And the call starting later ADOPTS that row rather than mounting a second.
	state = applyEvent(
		state,
		{
			type: "tool_execution_start",
			tool_call_id: callId,
			tool_name: "wait",
			args: { job_id: ["634ea772fe1a"], wait_ms: 3_000_000 },
			started_at_epoch: 1789652393.4988,
		},
		ARRIVAL_MS + 2_000,
	);
	assert.equal(
		state.records.filter((r) => r.id === `tool:${callId}`).length,
		1,
	);
	row = rowFor(state, `tool:${callId}`);
	assert.equal(row.phase, "running");
	assert.equal(row.notRunReason, null);
	assert.equal(row.args.job_id[0], "634ea772fe1a");
});

test("a promotion rekeys the placeholder row in place, and twice is once", () => {
	/*
	 * `supersedes_tool_call_id` is the one moment the two id spaces meet: a
	 * provider that sends a call's name before its id makes the loop announce the
	 * row under `compose:{index}`, and every later frame carries the real id. A
	 * client that keys rows by id then holds TWO records for one call — and the
	 * abandoned placeholder is marked interrupted at turn end on a call that
	 * succeeded.
	 *
	 * A SECOND call is announced first so the row's POSITION is observable: the
	 * contract asks for a rekey ("each of those consumers rekey the row it already
	 * has"), which is the same row in the same place, and a row that jumped to the
	 * end of the ledger as its identity arrived would be the same defect the other
	 * way round.
	 */
	const announce = (callId, toolName, bytes) => ({
		type: "tool_call_compose",
		tool_call_id: callId,
		tool_name: toolName,
		argument_bytes: bytes,
		dictation_complete: false,
		not_run_reason: null,
	});
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		announce("compose:0", "write", 1_200),
		1_000,
	);
	state = applyEvent(state, announce("compose:1", "read", 10), 1_010);
	assert.deepEqual(ids(state), ["tool:compose:0", "tool:compose:1"]);
	const promotion = {
		type: "tool_call_compose",
		tool_call_id: "call_real",
		tool_name: "write",
		argument_bytes: 1_300,
		supersedes_tool_call_id: "compose:0",
		dictation_complete: true,
		not_run_reason: null,
	};
	state = applyEvent(state, promotion, 1_050);
	assert.deepEqual(
		ids(state),
		["tool:call_real", "tool:compose:1"],
		"the placeholder is rekeyed where it stood, not closed and reopened",
	);
	assert.equal(rowFor(state, "tool:compose:0"), undefined);
	assert.equal(rowFor(state, "tool:call_real").phase, "queued");
	assert.equal(
		rowFor(state, "tool:call_real").ts,
		1_000,
		"and it keeps the time it was announced at",
	);
	assert.equal(
		applyEvent(state, promotion, 1_060),
		state,
		"the announcement repeats on every later frame; the repeat is a no-op",
	);
	// An announcement with nothing to rekey leaves the state alone too, which is
	// the same rule read from the other side.
	assert.equal(
		applyEvent(
			state,
			{ ...promotion, supersedes_tool_call_id: "compose:7" },
			1_070,
		),
		state,
	);
});

test("a never-run row is revived when the call really runs under the same id", () => {
	/*
	 * TWO CALLS SHARING AN ID: the loser is parked with a verdict while the winner
	 * executes. The TUI's `begin_running` clears that card's error text and tint
	 * for exactly this case, and the phone clears its own `error` on the start; a
	 * row that kept the verdict would say `never sent` over a call that ran, and
	 * would still say it once the call's result arrived.
	 */
	const callId = "call_00_SharedIdExample00";
	let state = applyEvent(
		withPage(),
		{
			type: "tool_call_compose",
			tool_call_id: callId,
			tool_name: "read",
			argument_bytes: 60,
			dictation_complete: false,
			not_run_reason: null,
		},
		ARRIVAL_MS,
	);
	state = applyEvent(
		state,
		{
			...NEVER_RUN[1],
			tool_call_id: callId,
			not_run_reason: "Duplicate call id 'call_00_SharedIdExample00' skipped.",
		},
		ARRIVAL_MS + 10,
	);
	assert.equal(
		rowFor(state, `tool:${callId}`).notRunReason,
		"Duplicate call id 'call_00_SharedIdExample00' skipped.",
	);

	state = applyEvent(
		state,
		{
			type: "tool_execution_start",
			tool_call_id: callId,
			tool_name: "read",
			args: { path: "/tmp/x" },
			started_at_epoch: 1789652393.4988,
		},
		ARRIVAL_MS + 20,
	);
	let row = rowFor(state, `tool:${callId}`);
	assert.equal(row.phase, "running");
	assert.equal(
		row.notRunReason,
		null,
		"the verdict does not outlive the call it was wrong about",
	);
	assert.equal(
		state.records.filter((r) => r.id === `tool:${callId}`).length,
		1,
	);

	state = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: callId,
			tool_name: "read",
			result: { content: [{ type: "text", text: "read fine" }] },
		},
		ARRIVAL_MS + 30,
	);
	row = rowFor(state, `tool:${callId}`);
	assert.equal(row.phase, "done");
	assert.equal(row.notRunReason, null);
	assert.equal(row.output, "read fine");
	assert.equal(
		applyEvent(
			state,
			{
				type: "tool_execution_start",
				tool_call_id: callId,
				tool_name: "read",
				args: { path: "/tmp/x" },
			},
			ARRIVAL_MS + 40,
		),
		state,
		"a replayed start still cannot restart a row that really ran",
	);
});
test("an ordinary composing frame is still painted, and still adopted by its start", () => {
	/*
	 * THE NO-REGRESSION CASE, and it is the one the fix could most easily break:
	 * a LIVE clockless announcement that would create a row is admitted while a
	 * turn is in flight — that frame describes a call being dictated right now,
	 * and refusing it would leave a mid-turn join showing nothing at all.
	 */
	const announced = {
		type: "tool_call_compose",
		tool_call_id: "call_live_dictation",
		tool_name: "write",
		argument_bytes: 512,
		dictation_complete: false,
		not_run_reason: null,
	};
	const inFlight = applyLiveSeed(
		withPage(),
		frontendOf([announced], true),
		ARRIVAL_MS,
	);
	const seeded = rowFor(inFlight, "tool:call_live_dictation");
	assert.equal(seeded.phase, "composing");
	assert.equal(
		seeded.ts,
		ARRIVAL_MS,
		"no clock of its own, so the arrival it is",
	);

	// With no turn in flight the existing rule is unchanged: no row, no claim.
	const finished = applyLiveSeed(
		withPage(),
		frontendOf([announced], false),
		ARRIVAL_MS,
	);
	assert.deepEqual(
		ids(finished),
		PAGE.map((entry) => entry.id),
	);

	// And its start adopts the row rather than mounting a second one.
	const started = applyEvent(
		inFlight,
		{
			type: "tool_execution_start",
			tool_call_id: "call_live_dictation",
			tool_name: "write",
			args: { path: "/tmp/x", content: "y" },
			started_at_epoch: 1789652393.4988,
		},
		ARRIVAL_MS + 400,
	);
	assert.equal(
		started.records.filter((r) => r.id === "tool:call_live_dictation").length,
		1,
	);
	assert.equal(rowFor(started, "tool:call_live_dictation").phase, "running");
});

/*
 * ------------------------------------------------------- the third ending
 *
 * A turn that ENDS is the third way a call announced by a compose frame reaches
 * no tool: it was still being dictated, or waiting to run, when the turn died.
 * The harness sends no verdict for it, so nothing in the frames says so — but
 * the row must not claim a result either, which is what the generic turn-end
 * settlement used to do: on a clean end the row read `done` with a green tick on
 * a call that never ran, and on an abort it read `interrupted` on a call that
 * had not begun. The TUI settles both with the compose record and no error text
 * (`_retire_live_tool_cards` -> `ToolCard.mark_interrupted`).
 */

/** One announced call, in the phase the turn will interrupt. */
const announcedCall = (phase) => ({
	type: "tool_call_compose",
	tool_call_id: "call_00_TurnDeathExample00",
	tool_name: "wait",
	argument_bytes: 82,
	dictation_complete: phase === "queued",
	not_run_reason: null,
});
const TURN_DEATH = "tool:call_00_TurnDeathExample00";

for (const phase of ["composing", "queued"]) {
	for (const aborted of [false, true]) {
		test(`a call still ${phase} when the turn ends (aborted=${aborted}) is never sent, not a result`, () => {
			const state = applyEvent(EMPTY_TRANSCRIPT, announcedCall(phase), 1_000);
			assert.equal(rowFor(state, TURN_DEATH).phase, phase);
			const ended = applyEvent(
				state,
				{ type: "agent_end", generation: 1, aborted },
				2_000,
			);
			const row = rowFor(ended, TURN_DEATH);
			assert.equal(row.phase, "done");
			assert.equal(
				row.neverSent,
				true,
				"the call reached no tool, which is what the row has to say",
			);
			assert.equal(row.notRunReason, null, "the turn left no verdict to carry");
			assert.equal(row.output, null);
			assert.equal(row.durationS, null, "nothing measured an interval");
			assert.equal(row.startedAt, null);
			assert.equal(
				row.argumentBytes,
				82,
				"how far the model got is still known",
			);
			// The two arms differ in what the TURN did and in nothing the row paints:
			// a call that never started is not a success on either, which is the
			// state the ladder has to be told (it reads `stopped` after `isError`).
			assert.equal(
				row.stopped,
				true,
				"no tool received the call, so no arm may paint it as a success",
			);
		});
	}
}

test("a call that really RAN is still an interrupt at turn end, not a never-sent", () => {
	// The other side of the same settlement: a call whose start arrived did
	// reach a tool, so the turn's death interrupts it and must not be reported
	// with the compose record.
	const running = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "tool_execution_start",
			tool_call_id: "call_00_RunningAtDeath00",
			tool_name: "bash",
			args: { command: "sleep 300" },
			started_at_epoch: 1789652393.4988,
		},
		1_000,
	);
	const ended = applyEvent(
		running,
		{ type: "agent_end", generation: 1, aborted: true },
		2_000,
	);
	const row = rowFor(ended, "tool:call_00_RunningAtDeath00");
	assert.equal(row.phase, "done");
	assert.equal(row.stopped, true);
	assert.equal(
		row.neverSent,
		false,
		"it was running, so a tool did receive it",
	);
});

/*
 * -------------------------------------------------- the sibling ending, seeded
 */

test("a seeded frame whose dictation is over is refused with no row on screen", () => {
	/*
	 * The sibling of the reported shape. A `dictation_complete` frame states that
	 * the model stopped writing this call; with no row on screen the old fold
	 * created one at the reader's own arrival — a live `queued` row claiming the
	 * call was announced NOW, in a turn whose real rows are hours old — and
	 * nothing in that row could say when it happened.
	 */
	const state = applyLiveSeed(
		withPage(),
		frontendOf([QUEUED_FRAME], true),
		ARRIVAL_MS,
	);
	assert.deepEqual(
		ids(state),
		PAGE.map((entry) => entry.id),
		"nothing is painted for a frame that states no time",
	);
	assert.equal(rowFor(state, `tool:${QUEUED_FRAME.tool_call_id}`), undefined);
	// With the row ALREADY on screen it folds, which is the settle path — the
	// rule is about a frame that would CREATE a row.
	const withRow = applyEvent(
		EMPTY_TRANSCRIPT,
		{ ...QUEUED_FRAME, dictation_complete: false, argument_bytes: 40 },
		ARRIVAL_MS - 1_000,
	);
	const folded = applyLiveSeed(withRow, frontendOf([QUEUED_FRAME]), ARRIVAL_MS);
	assert.equal(
		rowFor(folded, `tool:${QUEUED_FRAME.tool_call_id}`).phase,
		"queued",
	);
	assert.equal(folded.records.length, 1, "settled in place, never duplicated");
});

/*
 * --------------------------------------------- the read that paints the truth
 *
 * A refused frame's call is not lost: its durable row is the authority, so the
 * caller's tail read has to be SIZED for these calls — they have no end event to
 * be named by, which is how the first pass of this work left them unreachable.
 * The row then paints at the transcript's own time.
 */

test("a refused call is named for read-back, and its durable row paints at its own time", () => {
	const seed = [...SEED, QUEUED_FRAME];
	const refused = [...CALL_IDS, QUEUED_FRAME.tool_call_id];
	const named = seedCallsMissingLabels(seed, new Set());
	for (const callId of refused) {
		assert.ok(
			named.includes(callId),
			`${callId} must be named so the read is sized for it`,
		);
	}
	// A call the transcript can already answer for is not named: the read is
	// sized for the GAP, not for the seed.
	assert.deepEqual(seedCallsMissingLabels(seed, new Set(refused)), []);
	assert.deepEqual(
		seedCallsMissingLabels(seed, new Set()),
		[...refused],
		"oldest first, deduplicated, and in the seed's own order",
	);

	// The durable row, read back through the page the caller asked for, paints
	// at the transcript's own instant rather than at the reader's arrival.
	const callId = CALL_IDS[0];
	const durableTs = LAST_TS - 600;
	const page = {
		entries: [
			{
				id: "backfill-tool",
				ts: durableTs,
				type: "message",
				payload: {
					kind: "message",
					role: "tool",
					id: "backfill-tool",
					tool_call_id: callId,
					tool_name: "hub",
					is_error: true,
					content: [{ type: "text", text: NEVER_RUN[0].not_run_reason }],
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	};
	const afterRead = applyLiveSeed(
		applyHistoryPage(withPage(), page),
		frontendOf(SEED, true),
		ARRIVAL_MS,
	);
	const row = rowFor(afterRead, `tool:${callId}`);
	assert.equal(row.kind, "tool");
	assert.equal(
		row.ts,
		Math.round(durableTs * 1000),
		"the transcript's own time, not the reader's arrival",
	);
	assert.notEqual(row.ts, ARRIVAL_MS);
	assert.equal(row.isError, true, "the durable row's own verdict stands");
	assert.equal(
		afterRead.records.filter((record) => record.id === `tool:${callId}`).length,
		1,
		"one row for one call, whatever the seed and the page each carry",
	);
});
