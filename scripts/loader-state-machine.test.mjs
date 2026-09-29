import assert from "node:assert/strict";
import { test } from "node:test";
import {
	FakeJournal,
	PAGE_LIMIT,
	Reader,
	loadModules,
	rng,
	shape,
} from "./loader-journal-fixture.mjs";

/*
 * ONE LOADING STATE MACHINE, EXERCISED AS A WHOLE.
 *
 * The regressions in `transcript-cursor-continuity.test.mjs` pin one mechanism
 * each. This file asks the question the operator's report actually was: across
 * ANY interleaving of scroll acts, reconnects re-applying the tail, compactions
 * that delete cursor entries, a second caller colliding with a page in flight, a
 * session switch mid-request and plain request failures, does the reader always
 * reach the start of the conversation, without asking for the same page twice and
 * without ever being told a healthy conversation failed?
 *
 * What is REAL here: the reducer (`applyHistoryPage`), the older-page loader the
 * hook is made of (when the tree has one) and the paging policy
 * (`decide` / `noteInput` / `noteSettled` / `noteFailed` / `noteAborted`). What is
 * FAKE: the journal, which implements the backend reader's contract
 * (`FakeJournal`: `before_id` exclusive, `has_more`, an unknown `before_id`
 * answered with the current tail plus `cursor_missing`). The pump below is the
 * same outcome -> policy mapping `use-scroll-paging.ts` performs, restated over
 * the pure functions because the DOM half has no bearing on these invariants.
 *
 * DETERMINISTIC: every run is a pure function of its seed (`rng`), so a failure
 * message names the seed and the operation trace that reproduces it exactly.
 *
 * INVARIANTS (design spec section 2, item 2; I6 - "an invisible reveal is
 * followed by another ask" - belongs to the next PR and is not asserted here):
 *   I1  reaching the start takes <= ceil(entries / limit) + slack asks
 *   I2  no two consecutive requests carry the same before_id unless the previous
 *       one failed
 *   I3  hasMore === false is terminal (the journal only grows at its NEWEST end)
 *   I4  a busy caller or a stale (session-switched) page never counts as a failure
 *   I5  after any failure a deliberate act still fires an ask
 */

const { reducer: m, paging } = await loadModules();
const { decide, initialPagingState, noteFailed, noteInput, noteSettled } =
	paging;
// The pre-fix tree has no `noteAborted`; falling back to `noteFailed` is exactly
// what that tree's pump did with a `false`, which is why I4 fails there for the
// real reason and not for a missing import.
const noteAborted = paging.noteAborted ?? noteFailed;

const SEEDS = 120;
const OPS_PER_RUN = 28;

/** The pump: one deliberate act, mapped through the policy like the hook does. */
class Pump {
	constructor(reader) {
		this.reader = reader;
		this.state = initialPagingState();
		this.now = 10_000;
		this.asks = 0;
		this.outcomes = [];
	}

	geometry() {
		return {
			distanceFromTopPx: 0,
			clientHeight: 800,
			hiddenRows: 0,
			hasMore: this.reader.transcript.hasMore,
			scrollable: true,
			followingTail: false,
		};
	}

	/** Fold the outcome in exactly as `use-scroll-paging.ts` does. */
	settle(outcome) {
		this.outcomes.push(outcome.kind);
		if (outcome.kind === "failed") this.state = noteFailed(this.state);
		else if (outcome.kind === "applied")
			this.state = noteSettled(this.state, { hiddenRowsAfter: 0 });
		else this.state = noteAborted(this.state);
	}

	/** A deliberate ask (the affordance): input, settle, decide, and maybe fetch. */
	async act({ during } = {}) {
		this.now += 1000;
		this.state = noteInput(this.state, {
			direction: "up",
			continuous: false,
			deliberate: true,
			atHardTop: true,
			travelledPx: 0,
			at: this.now,
		});
		const decision = decide(this.state, this.geometry(), this.now);
		this.state = decision.state;
		if (decision.action !== "fetch") return { asked: false };
		this.asks += 1;
		const pending = this.reader.loadOlder();
		during?.();
		const outcome = await pending;
		this.settle(outcome);
		return { asked: true, outcome };
	}
}

/** A journal of a random length, still following the real boundary mix. */
function journalFor(rand) {
	const length = 150 + Math.floor(rand() * (shape.kinds.length - 150));
	return FakeJournal.fromShape(shape.kinds.slice(0, length));
}

const OPS = [
	["act", 8],
	["reapplyTail", 3],
	["growAndReapply", 3],
	["compact", 2],
	["collide", 2],
	["switchMidFlight", 2],
	["fail", 2],
];
const pickOp = (rand) => {
	let roll = rand() * OPS.reduce((n, [, w]) => n + w, 0);
	for (const [name, weight] of OPS) {
		roll -= weight;
		if (roll < 0) return name;
	}
	return "act";
};

async function runSeed(seed) {
	const rand = rng(seed);
	const journal = journalFor(rand);
	const reader = new Reader(m, journal).open();
	const pump = new Pump(reader);
	const trace = [];
	const problems = [];
	let sawStart = false;

	const requestsSeen = () => reader.requests.length;
	const check = (label) => {
		// I3: reaching the start is terminal.
		if (sawStart && reader.transcript.hasMore)
			problems.push(
				`I3 hasMore came back after the start was reached (${label})`,
			);
		if (!reader.transcript.hasMore) sawStart = true;
	};

	for (let i = 0; i < OPS_PER_RUN; i++) {
		const op = pickOp(rand);
		trace.push(op);
		const failuresBefore = pump.state.failures;
		if (op === "act") {
			await pump.act();
		} else if (op === "reapplyTail") {
			reader.reapplyTail();
		} else if (op === "growAndReapply") {
			journal.append(["user", "assistant:0:1", "custom:session_spend.v1"]);
			reader.reapplyTail();
		} else if (op === "compact") {
			journal.compact();
		} else if (op === "collide") {
			// A second caller (the open-time align fetch, the mentioned-files scan)
			// has a page out when the reader's act arrives.
			const other = reader.loadOlder();
			await pump.act();
			await other;
			if (pump.state.failures !== failuresBefore)
				problems.push(
					`I4 a busy caller counted as a failure (failures ${failuresBefore} -> ${pump.state.failures})`,
				);
		} else if (op === "switchMidFlight") {
			// The page resolves after the reader moved to another conversation.
			const home = reader.key;
			await pump.act({ during: () => (reader.key = "session-b") });
			reader.key = home;
			if (pump.state.failures !== failuresBefore)
				problems.push(
					`I4 a stale page counted as a failure (failures ${failuresBefore} -> ${pump.state.failures})`,
				);
		} else if (op === "fail") {
			reader.failNext = 1;
			const before = requestsSeen();
			const result = await pump.act();
			if (result.asked && reader.requests.length > before) {
				// I5: whatever the failure budget says, a deliberate act asks again.
				const failed = pump.state.failures;
				assert.ok(failed >= 0);
				const again = await pump.act();
				if (reader.transcript.hasMore && !again.asked)
					problems.push("I5 a deliberate act after a failure fired no ask");
			}
		}
		check(op);
	}

	// Drain: nothing but deliberate acts until the start, bounded by I1.
	const entries = journal.length;
	const budget = Math.ceil(entries / PAGE_LIMIT) + 2;
	const asksBefore = pump.asks;
	const requestsBefore = reader.requests.length;
	let stuck = 0;
	while (reader.transcript.hasMore && pump.asks - asksBefore < budget + 6) {
		const result = await pump.act();
		if (!result.asked) {
			stuck += 1;
			if (stuck > 3) break;
		}
	}
	check("drain");
	const drainAsks = pump.asks - asksBefore;
	if (reader.transcript.hasMore)
		problems.push(
			`I1 never reached the start: ${drainAsks} asks against a budget of ${budget} for ${entries} entries`,
		);
	else if (drainAsks > budget)
		problems.push(
			`I1 ${drainAsks} asks for ${entries} entries (budget ${budget})`,
		);

	// I2 over every request this run made (a failed request may legitimately repeat).
	const all = reader.requests;
	for (let i = 1; i < all.length; i++) {
		if (all[i].before === all[i - 1].before && !all[i - 1].threw)
			problems.push(
				`I2 request ${i} repeated before_id ...${String(all[i].before).slice(-6)} after a request that did not fail`,
			);
	}
	void requestsBefore;

	// Completeness: everything the journal renders was loaded, and none of it lost.
	if (!reader.transcript.hasMore) {
		const held = new Set(reader.transcript.records.map((r) => r.id));
		const missing = reader.fullRecordIds().filter((id) => !held.has(id));
		if (missing.length)
			problems.push(`completeness: ${missing.length} records never loaded`);
	}
	return { seed, problems, trace };
}

test("no interleaving strands the reader, repeats a page, or reports a false failure", async () => {
	const failures = [];
	for (let seed = 1; seed <= SEEDS; seed++) {
		const run = await runSeed(seed);
		if (run.problems.length)
			failures.push(
				`seed ${seed}: ${[...new Set(run.problems)].slice(0, 3).join(" | ")}  [${run.trace.join(",")}]`,
			);
	}
	assert.equal(
		failures.length,
		0,
		`${failures.length}/${SEEDS} seeds violated an invariant. First three:\n${failures.slice(0, 3).join("\n")}`,
	);
});

test("I5: with the automatic budget spent, a deliberate act still asks and success forgives", async () => {
	const journal = FakeJournal.fromShape();
	const reader = new Reader(m, journal).open();
	const pump = new Pump(reader);
	// Three REAL failures from the automatic path (a deliberate act forgives the
	// count on entry, so the exhausted state is built directly from the policy).
	for (let i = 0; i < 3; i++) pump.state = noteFailed(pump.state);
	assert.equal(pump.state.failures, 3);
	const before = reader.requests.length;
	const result = await pump.act();
	assert.equal(
		result.asked,
		true,
		"the deliberate act after the budget is spent",
	);
	assert.equal(reader.requests.length, before + 1);
	assert.equal(result.outcome.kind, "applied");
	assert.equal(pump.state.failures, 0, "and success forgives the count");
});

test("I4: a caller that arrives while a page is out shares it and is never a failure", async () => {
	const journal = FakeJournal.fromShape();
	const reader = new Reader(m, journal).open();
	const pump = new Pump(reader);
	const other = reader.loadOlder();
	const result = await pump.act();
	await other;
	assert.equal(pump.state.failures, 0, "busy is not a failure");
	assert.equal(
		result.outcome.kind,
		"applied",
		"the collider gets the shared page",
	);
	assert.equal(
		reader.requests.length,
		1,
		"one page was fetched for two callers",
	);
});

test("I4: a page that resolves after a session switch is stale, not failed", async () => {
	const journal = FakeJournal.fromShape();
	const reader = new Reader(m, journal).open();
	const pump = new Pump(reader);
	const heldBefore = reader.transcript.records.length;
	const result = await pump.act({ during: () => (reader.key = "session-b") });
	assert.equal(result.outcome.kind, "stale");
	assert.equal(pump.state.failures, 0);
	assert.equal(
		reader.transcript.records.length,
		heldBefore,
		"a foreign page must never reach the transcript",
	);
});
