import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * A session read WHILE ITS TURN RUNS must not paint rows the turn never had.
 *
 * The operator opened "Optimize local session load times" (session
 * `c1c7072b735c`, its runtime mid-turn) and saw a wall of extra `bash` rows after
 * the call the turn was inside, each showing a snippet of the tool's OUTPUT where
 * the command that ran belongs — the opening turn's eight calls, an hour and
 * several completed turns earlier. The TUI, reading the same session, ended at
 * that row.
 *
 * WHERE THE ROWS CAME FROM, settled with the wire rather than with reasoning:
 *
 *   - the snapshot's page cannot produce them. `GET
 *     /v1/desktop/sessions/c1c7072b735c` on the session's own backend returns
 *     `frontend.snapshot.streaming: true` and a `live_events` of 102 frames, 100
 *     of them `tool_execution_end` — the runtime's `LIVE_EVENT_END_ROWS_MAX` cap
 *     — and not one end states `started_at_epoch` or carries `args`. The page
 *     names 41 calls, and it carries `arguments.command` on every `bash` call it
 *     names (25 of 41; the other 16 are `hub`/`task`/`wait`/`read`), so a
 *     page-painted `bash` row names what ran;
 *   - a fresh subscription of the same session (`GET …/events`, 14 frames:
 *     `open`, `snapshot`, `frontend.update`, `event`) carries no
 *     `history_delta`, so the arm that stamps whole histories at the reader's
 *     arrival never runs on this join;
 *   - what is left is `applyLiveSeed` folding a settled end that would CREATE a
 *     row with no clock to place it by. `knownArgs` can only recover a command
 *     from a painted row or from `argsByCall`, which the durable assistant row
 *     fills, so a row painted from such a frame falls through to the output's
 *     first line — the reported preview — and `upsert` appends it after the
 *     turn's tail.
 *
 * THE SEED REACHES THAT FAR BACK because `frontend_state._fold_live_event` empties
 * `live_events` on `agent_start`/`agent_end` — the RUN's boundaries, not a turn's
 * — and caps it at the newest 100 settled calls, so a run that has been going for
 * an hour hands a joiner a window across every turn it has taken. The injected
 * count is therefore the page/seed gap, never a constant: 100 seed ends against a
 * 100-ENTRY page leaves 59 unnamed at harvest time, and it was exactly the opening
 * turn's eight at the instant the operator looked (the fixture derives that
 * moment: journal records 122..126).
 *
 * THE FIXTURE IS THE REAL SESSION, harvested by
 * `scripts/harvest-trace-order-fixture.mjs` — its header carries the commands and
 * every transform — and the story beside this file renders the pair
 * (`docs/evidence/chat-trace-order-while-live/`). The reducer and the shape of
 * the page are the shipped modules; only React, the transport and the clock are
 * absent, and nothing here asserts on a frame.
 *
 * WHAT THIS PROVES: that a settled, clockless seed frame can no longer create a
 * row, on both real moments, while the join it exists for still paints what it is
 * for (the in-flight call's row with its arguments, the settled siblings the page
 * names, and the assistant text) — and that the producer's own clock, when a
 * runtime states one, is admitted and placed. WHAT IT DOES NOT PROVE: that the
 * runtime still serves that seed at the moment the operator clicked (it is his
 * live session and was read, never attached to), or anything about the pixels the
 * runtime's older build served.
 */

const fixture = JSON.parse(
	readFileSync(new URL("./fixtures/trace-order.json", import.meta.url), "utf8"),
);

/** The result text the settle case writes, and the rule that it arrives. */
const DONE = /done/;

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
const {
	EMPTY_TRANSCRIPT,
	applyEvent,
	applyHistoryPage,
	applyLiveSeed,
	reconcileLimit,
	seedCallsMissingLabels,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const pageOf = (entries) => ({
	entries,
	has_more: true,
	cursor_missing: false,
});
const frontendOf = (streaming, live_events) => ({
	streaming,
	generation: fixture.seed.generation,
	live_events,
});

/** The reader's arrival, derived from the moment's own in-flight call. */
const arrivalOf = (frames) => {
	const start = frames.find((frame) => frame.type === "tool_execution_start");
	return Math.round(Number(start?.started_at_epoch ?? 0) * 1000) + 40_000;
};

/** The shipped fold, exactly as the hook calls it: page, then seed. */
const shipped = (entries, seed, streaming, arrival) =>
	applyLiveSeed(
		applyHistoryPage(EMPTY_TRANSCRIPT, pageOf(entries)),
		frontendOf(streaming, seed),
		arrival,
	);

/**
 * The PRE-FIX fold, spelled out: every frame applied, nothing refused.
 *
 * The state it produces no longer exists in the shipped code, which is what makes
 * a before/after pair from one tree possible: a loop handing `applyEvent` the
 * clock a frame states or the reader's arrival, which is the pre-fix body of
 * `applyLiveSeed`, followed by the time order that body applied when any frame
 * stated a clock (a stable sort by `ts`, the rule the reducer shares with the
 * durable page).
 */
const preFix = (entries, seed, arrival) => {
	let state = applyHistoryPage(EMPTY_TRANSCRIPT, pageOf(entries));
	let placed = false;
	for (const event of seed) {
		const stated = Number(event.started_at_epoch);
		if (stated > 0) placed = true;
		state = applyEvent(
			state,
			event,
			stated > 0 ? Math.round(stated * 1000) : arrival,
		);
	}
	if (!placed) return state;
	const records = state.records
		.map((record, position) => ({ record, position }))
		.sort((a, b) =>
			a.record.ts !== b.record.ts
				? a.record.ts - b.record.ts
				: a.position - b.position,
		)
		.map((entry) => entry.record);
	return {
		...state,
		records,
		index: new Map(records.map((record, at) => [record.id, at])),
	};
};

/** Every call id the page names, in either direction (assistant row or result). */
const namedCalls = (entries) => {
	const named = new Set();
	for (const entry of entries) {
		for (const call of entry.payload?.tool_calls ?? []) named.add(call.id);
		if (entry.payload?.tool_call_id) named.add(entry.payload.tool_call_id);
	}
	return named;
};

const stamps = (state, arrival) =>
	state.records.filter((record) => record.ts === arrival);

/** The real moments: the operator's own load, and the harvest an hour later. */
const MOMENTS = [
	{
		name: "the reported load",
		entries: fixture.reported.page.entries,
		seed: fixture.reported.seed.live_events,
		unlabelled: fixture.reported.ghosts,
	},
	{
		name: "the harvest an hour on",
		entries: fixture.page.entries,
		seed: fixture.seed.live_events,
		unlabelled: fixture.derivation.unlabelled_ids,
	},
];

test("the harvested seed is the shape the report describes", () => {
	const ends = fixture.seed.live_events.filter(
		(frame) => frame.type === "tool_execution_end",
	);
	assert.equal(ends.length, 100, "the seed keeps the runtime's 100-end cap");
	for (const end of ends) {
		assert.equal(
			"started_at_epoch" in end,
			false,
			`${end.tool_call_id}: a settled end states no time`,
		);
		assert.equal(
			"args" in end,
			false,
			`${end.tool_call_id}: a settled end carries no arguments`,
		);
		assert.equal(
			typeof end.result,
			"object",
			`${end.tool_call_id}: carries its result`,
		);
		assert.equal(
			typeof end.duration_s,
			"number",
			`${end.tool_call_id}: carries a duration`,
		);
	}
	assert.equal(fixture.derivation.seed_ends, ends.length);
	assert.equal(fixture.derivation.unlabelled_ends, 59);
	assert.deepEqual(fixture.derivation.unlabelled_ids.length, 59);
	assert.equal(
		fixture.page.entries.length,
		100,
		"the page is the newest 100 entries the snapshot served",
	);
	// The page can label a bash row: every bash call it names carries its arguments,
	// so the row's object column comes from the page rather than from the result.
	// (The fixture's own transform nulls an over-long command VALUE — 60 characters,
	// the convention its header states — while the wire's page carries
	// `arguments.command` on 25 of its 41 calls; the harvest and the PR record that
	// measurement. What matters here is that the arguments object is present.)
	const bashCalls = fixture.page.entries.flatMap((entry) =>
		(entry.payload?.tool_calls ?? []).filter((call) => call.name === "bash"),
	);
	assert.ok(bashCalls.length > 0);
	for (const call of bashCalls) {
		assert.equal(
			typeof call.arguments,
			"object",
			`${call.id}: the page hands the row its arguments, so it does not fall through to the output`,
		);
	}
});

test("pre-fix: a settled row the page cannot name is painted at the arrival, naming nothing", () => {
	for (const moment of MOMENTS) {
		const arrival = arrivalOf(moment.seed);
		const state = preFix(moment.entries, moment.seed, arrival);
		const painted = stamps(state, arrival);
		const named = namedCalls(moment.entries);
		const compose = moment.seed.filter(
			(frame) => frame.type === "tool_call_compose",
		);
		// The count is the page/seed gap: one row per unnamed settled end, plus the
		// seed's compose frames (which #312's rule owns), and none of them may be a
		// call the page names. Derived, never pinned.
		assert.equal(painted.length, moment.unlabelled.length + compose.length);
		for (const record of painted) {
			const callId = record.id.slice("tool:".length);
			assert.equal(
				named.has(callId),
				false,
				`${moment.name}: ${callId} is named by the page and must not be injected`,
			);
			assert.equal(record.args, null, `${record.id}: names no command`);
			if (record.phase === "composing") {
				assert.ok(
					compose.some((frame) => frame.tool_call_id === callId),
					`${moment.name}: only a compose frame may paint a composing row`,
				);
				continue;
			}
			assert.equal(record.phase, "done");
			assert.equal(
				typeof record.durationS,
				"number",
				`${record.id}: keeps its duration`,
			);
			assert.ok(record.output, `${record.id}: falls through to the output`);
		}
		// And they land after the turn's tail, which is the reported symptom.
		const inFlight = moment.seed.find(
			(frame) => frame.type === "tool_execution_start",
		);
		const inFlightIndex = state.index.get(`tool:${inFlight.tool_call_id}`);
		assert.ok(
			inFlightIndex >= 0,
			`${moment.name}: the in-flight call has a row`,
		);
		for (const record of painted) {
			assert.ok(
				state.index.get(record.id) > inFlightIndex,
				`${moment.name}: ${record.id} is painted after the in-flight call`,
			);
		}
	}
});

test("the fix: no settled call is painted at the arrival, on either moment", () => {
	for (const moment of MOMENTS) {
		const arrival = arrivalOf(moment.seed);
		const state = shipped(moment.entries, moment.seed, true, arrival);
		const named = namedCalls(moment.entries);
		const painted = stamps(state, arrival);
		// Composing rows are #312's rule, not this one: a compose frame is dictation
		// that never ran, and the seed carries one here. Everything else must be
		// placed by a source that states a time.
		for (const record of painted) {
			assert.equal(
				record.phase,
				"composing",
				`${moment.name}: ${record.id} was painted at the reader's arrival`,
			);
			assert.equal(named.has(record.id.slice("tool:".length)), false);
		}
		const settled = painted.filter((record) => record.phase !== "composing");
		assert.equal(
			settled.length,
			0,
			`${moment.name}: ${settled.length} settled rows stamped with the arrival (was ${moment.unlabelled.length} before the fix)`,
		);
		assert.equal(
			stamps(state, arrival).length,
			moment.seed.filter((frame) => frame.type === "tool_call_compose").length,
			`${moment.name}: only the seed's compose frames may keep the arrival`,
		);
	}
});

test("the fix: the pane ends at the call the turn is inside", () => {
	for (const moment of MOMENTS) {
		const arrival = arrivalOf(moment.seed);
		const state = shipped(moment.entries, moment.seed, true, arrival);
		const inFlight = moment.seed.find(
			(frame) => frame.type === "tool_execution_start",
		);
		const id = `tool:${inFlight.tool_call_id}`;
		const record = state.records[state.index.get(id)];
		assert.ok(record, `${moment.name}: the in-flight call keeps its row`);
		assert.equal(
			record.phase,
			"running",
			`${moment.name}: it is still running`,
		);
		assert.deepEqual(
			Object.keys(record.args ?? {}).sort(),
			Object.keys(inFlight.args ?? {}).sort(),
			`${moment.name}: the page named it, so it is painted with its arguments`,
		);
		// Nothing SETTLED is painted after it. A compose frame that never ran is
		// #312's rule rather than this one, so it is named here instead of asserted
		// away: it is the only row that may still land at the arrival.
		const named = namedCalls(moment.entries);
		for (const tail of state.records.slice(state.index.get(id) + 1)) {
			assert.equal(
				tail.phase,
				"composing",
				`${moment.name}: ${tail.id} is painted after the running call`,
			);
			assert.equal(
				named.has(tail.id.slice("tool:".length)),
				false,
				`${moment.name}: and it names no call the page knows`,
			);
		}
	}
});

test("the mid-turn join still paints what the seed exists for", () => {
	const moment = MOMENTS[1];
	const arrival = arrivalOf(moment.seed);
	const page = applyHistoryPage(EMPTY_TRANSCRIPT, pageOf(moment.entries));
	const state = shipped(moment.entries, moment.seed, true, arrival);
	const named = namedCalls(moment.entries);
	for (const callId of named) {
		assert.ok(
			state.index.get(`tool:${callId}`) >= 0,
			`${callId}: a call the page names keeps its row`,
		);
	}
	assert.ok(
		state.records.some((record) => record.kind === "assistant"),
		"the assistant text is painted",
	);
	assert.equal(
		state.records.filter((record) => record.kind === "assistant").length,
		page.records.filter((record) => record.kind === "assistant").length,
		"and the seed adds no assistant rows of its own",
	);
});

test("a settled end for a call the page names still settles its row", () => {
	const moment = MOMENTS[0];
	const arrival = arrivalOf(moment.seed);
	const inFlight = moment.seed.find(
		(frame) => frame.type === "tool_execution_start",
	);
	const settled = shipped(moment.entries, moment.seed, true, arrival);
	const settledAgain = applyLiveSeed(
		settled,
		frontendOf(true, [
			{
				type: "tool_execution_end",
				tool_call_id: inFlight.tool_call_id,
				tool_name: inFlight.tool_name,
				result: {
					tool_call_id: inFlight.tool_call_id,
					tool_name: inFlight.tool_name,
					is_error: false,
					content: [
						{ type: "text", text: "exit code: 0\n--- stdout ---\ndone" },
					],
				},
				duration_s: 12.5,
				is_error: false,
			},
		]),
		arrival,
	);
	const id = `tool:${inFlight.tool_call_id}`;
	const record = settledAgain.records[settledAgain.index.get(id)];
	assert.equal(record.phase, "done", "the settle lands on the painted row");
	assert.equal(record.durationS, 12.5);
	assert.match(record.output, DONE);
	assert.equal(
		settledAgain.records.length,
		settled.records.length,
		"and it costs no second row",
	);
	assert.equal(
		stamps(settledAgain, arrival).length,
		stamps(settled, arrival).length,
	);
});

test("a settled end that states its own clock is admitted, and placed there", () => {
	const moment = MOMENTS[0];
	const arrival = arrivalOf(moment.seed);
	const callId = fixture.reported.ghosts[0];
	const startedAt = moment.entries[0].ts;
	const state = applyLiveSeed(
		applyHistoryPage(EMPTY_TRANSCRIPT, pageOf(moment.entries)),
		frontendOf(true, [
			{
				type: "tool_execution_end",
				tool_call_id: callId,
				tool_name: "bash",
				result: {
					tool_call_id: callId,
					tool_name: "bash",
					is_error: false,
					content: [
						{ type: "text", text: "exit code: 0\n--- stdout ---\nlate" },
					],
				},
				duration_s: 0.5,
				is_error: false,
				// The producer half: a runtime that stamps the retained end with the
				// clock its start declared. The old client already reads this field.
				started_at_epoch: startedAt,
			},
		]),
		arrival,
	);
	const record = state.records[state.index.get(`tool:${callId}`)];
	assert.ok(record, "a dated frame is admissible");
	assert.equal(
		record.ts,
		Math.round(startedAt * 1000),
		"painted at the instant it ran",
	);
	assert.notEqual(record.ts, arrival, "not at the reader's arrival");
	const rowsAtArrival = stamps(state, arrival);
	assert.equal(
		rowsAtArrival.length,
		0,
		"and nothing is stamped with the arrival",
	);
});

test("a clock the runtime does not have is refused rather than invented", () => {
	const moment = MOMENTS[0];
	const arrival = arrivalOf(moment.seed);
	const callId = fixture.reported.ghosts[1];
	const state = applyLiveSeed(
		applyHistoryPage(EMPTY_TRANSCRIPT, pageOf(moment.entries)),
		frontendOf(true, [
			{
				type: "tool_execution_end",
				tool_call_id: callId,
				tool_name: "bash",
				result: { tool_call_id: callId, tool_name: "bash", content: [] },
				duration_s: 0.5,
				is_error: false,
				// A zero epoch is not a time: the reducer refuses a non-positive one,
				// which is what keeps a missing stamp from becoming 1970.
				started_at_epoch: 0,
			},
		]),
		arrival,
	);
	assert.equal(state.index.get(`tool:${callId}`), undefined);
});

test("the gate no longer depends on the flag, and the read-back is still sized for it", () => {
	for (const moment of MOMENTS) {
		const arrival = arrivalOf(moment.seed);
		const live = shipped(moment.entries, moment.seed, true, arrival);
		const finished = shipped(moment.entries, moment.seed, false, arrival);
		// The two folds now agree on every SETTLED row. They still differ by the seed's
		// compose frame, which a finished turn refuses outright and an in-flight one
		// paints at the arrival — #312's half of this clause, not this change's.
		const settledShape = (state) =>
			state.records
				.filter((record) => record.phase !== "composing")
				.map((record) => [record.id, record.ts]);
		assert.deepEqual(
			settledShape(live),
			settledShape(finished),
			`${moment.name}: an in-flight turn and a finished one fold their settled rows identically`,
		);
		assert.equal(
			live.records.some((record) => record.phase === "composing"),
			moment.seed.some((frame) => frame.type === "tool_call_compose"),
			`${moment.name}: the only difference is the compose frame`,
		);
		const named = namedCalls(moment.entries);
		const missing = seedCallsMissingLabels(moment.seed, named);
		assert.equal(
			missing.length,
			moment.unlabelled.length,
			`${moment.name}: every refused call is named for the read-back`,
		);
		assert.equal(
			reconcileLimit(missing.length),
			Math.min(500, 100 + 2 * missing.length),
			`${moment.name}: and the read is sized for exactly those calls`,
		);
	}
});
