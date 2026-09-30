import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import {
	FakeJournal,
	PAGE_LIMIT,
	Reader,
	kindOf,
	loadModules,
	pruneHeavyShape,
	rng,
	shape,
	tokenOf,
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
const {
	SETTLE_MS,
	decide,
	initialPagingState,
	noteFailed,
	noteInput,
	noteSettled,
} = paging;
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

	/**
	 * A reader GESTURE rather than a deliberate act: the automatic path's own door,
	 * and the only door `MAX_AUTO_ATTEMPTS` can close - `decide` spends a
	 * deliberate demand unconditionally, so a lockout is visible here and nowhere
	 * else. A gesture has to clear the settle debounce before it may be spent, so
	 * the notch and the dispatch are two instants rather than one.
	 */
	async gesture({ travelledPx = 200, atHardTop = false, during = null } = {}) {
		this.now += 5_000;
		const armed = noteInput(this.state, {
			direction: "up",
			continuous: true,
			deliberate: false,
			atHardTop,
			travelledPx,
			at: this.now,
		});
		const decision = decide(armed, this.geometry(), this.now + SETTLE_MS);
		this.state = decision.state;
		if (decision.action !== "fetch")
			return { asked: false, action: decision.action };
		this.asks += 1;
		const pending = this.reader.loadOlder();
		during?.();
		const outcome = await pending;
		this.settle(outcome);
		return { asked: true, action: "fetch", outcome };
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
			await pump.act({
				during: () => {
					reader.key = "session-b";
				},
			});
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
		// The previous ask must have been APPLIED for a repeat to be a defect: a
		// failed request, or a stale page dropped after a session switch, leaves the
		// page unread and asking for it again is the right thing to do.
		if (
			all[i].before === all[i - 1].before &&
			!all[i - 1].threw &&
			all[i - 1].outcome === "applied"
		)
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
	const result = await pump.act({
		during: () => {
			reader.key = "session-b";
		},
	});
	assert.equal(result.outcome.kind, "stale");
	assert.equal(pump.state.failures, 0);
	assert.equal(
		reader.transcript.records.length,
		heldBefore,
		"a foreign page must never reach the transcript",
	);
});

test("I4 (contract pin, not a regression): a returning visit is handed its own page, never the first visit's", async () => {
	/*
	 * WHAT THIS PINS. The loader is single-flight keyed by whatever identity its
	 * HOST passes (`load-older.ts` `load(key, deps)` / `flight.key === key`), so two
	 * different keys share no flight and no verdict: the page still out for the
	 * first visit resolves `stale` and never lands on the returning view's reset
	 * transcript, and the returning visit gets its own page.
	 *
	 * WHY THE NAME SAYS CONTRACT. It is deliberately NOT a fresh regression pin,
	 * and the round-2 review (R2-2) is right about why: the defect it describes was
	 * the HOST's key - `use-canonical-session.ts` passed a bare session id, so the
	 * returning visit compared equal and was handed the first visit's promise
	 * (round 1, R1-3) - while `load-older.ts`, which honours whatever key it is
	 * given, is BYTE-IDENTICAL between the pre-fix tree and this head (`git diff
	 * 0ce62bad54 HEAD -- .../canonical/load-older.ts` is empty). No loader-level
	 * assertion can therefore discriminate against that tree: measured, this whole
	 * file is 5 pass / 0 fail against `0ce62bad54`'s src. The regression itself is
	 * pinned where the key lived - `reconnect-page-gap.test.mjs`, 23 pass / 1 fail
	 * pre-fix.
	 *
	 * WHY IT IS STILL WORTH KEEPING. It is the loader's half of that contract, and
	 * it fails first if a later change moves the key comparison back into the
	 * loader or keys the flight on something coarser than the visit.
	 */
	const journal = FakeJournal.fromShape();
	const reader = new Reader(m, journal, { key: "session-a#0" }).open();
	const first = reader.loadOlder();
	reader.key = "session-b#1";
	reader.key = "session-a#2";
	const second = reader.loadOlder();
	assert.equal((await first).kind, "stale");
	assert.notEqual(
		second,
		first,
		"the returning visit is not handed the first visit's promise",
	);
	assert.equal((await second).kind, "applied");
});

test("the second report: three asks that lose a race are not failures and never switch the automatic path off", async () => {
	/*
	 * WHAT THIS PINS, AND WHERE IT WAS SEEN. The operator's SECOND instance of this
	 * class was a session whose BACKEND paging path was healthy - measured off the
	 * journal: 2228 entries, 6 durable compactions, 23 pages of 100, not one
	 * page-boundary cursor deleted by the prune pass - and whose transcript
	 * nevertheless carried a red "Could not load earlier messages" row. The half of
	 * the class that produced it is the one driven here: an ask that lost a race to
	 * an in-flight page was folded through `noteFailed`, so `failures` walked up to
	 * `MAX_AUTO_ATTEMPTS`, `isExhausted` switched the automatic path off, and the
	 * failed row stayed painted until the reader clicked the affordance.
	 *
	 * WHY `stale` AND NOT "busy". A caller that arrives while a page is out for the
	 * SAME conversation is handed that promise and resolves `applied` (the I4
	 * sharing case above), so the losing ask is the one whose conversation moved
	 * under it - `stale`. Both answers were one `false` before the fix and neither
	 * may count as a failure now.
	 *
	 * THE BACKEND IS HEALTHY THROUGHOUT: every read this test makes is served from
	 * the journal and no request carries `cursor_missing`, which is what makes the
	 * painted row a lie rather than a report.
	 */
	const journal = FakeJournal.fromSpec();
	const reader = new Reader(m, journal).open();
	const pump = new Pump(reader);
	const heldBefore = reader.transcript.records.length;

	const outcomes = [];
	for (let round = 0; round < 3; round++) {
		const home = reader.key;
		/*
		 * A GESTURE, not a deliberate act, and that is the point: a deliberate ask
		 * forgives the failure count on the way in (`noteInput`), so only the
		 * automatic path can be locked out - which is exactly what the operator's red
		 * row did to them. The ask loses its race to the conversation switch while the
		 * page is out; the backend itself answers every one of them.
		 */
		const lost = await pump.gesture({
			during: () => {
				reader.key = "session-b";
			},
		});
		reader.key = home;
		outcomes.push(lost.outcome.kind);
	}
	assert.deepEqual(
		outcomes,
		["stale", "stale", "stale"],
		"the three asks must lose their race, not win it",
	);
	assert.equal(
		reader.requests.filter((request) => request.missing).length,
		0,
		"a healthy backend: no ask may come back cursor_missing",
	);
	assert.equal(
		pump.state.failures,
		0,
		"three lost races are not three failures",
	);
	assert.equal(
		paging.isExhausted(pump.state),
		false,
		"the automatic path must still be on after three lost races",
	);
	assert.equal(
		reader.transcript.records.length,
		heldBefore,
		"a foreign page must never reach the transcript",
	);

	// The reader's own next gesture - the door `MAX_AUTO_ATTEMPTS` closes - still
	// spends, and the page it buys lands.
	const fetched = await pump.gesture();
	assert.equal(
		fetched.asked,
		true,
		"the gesture after three lost races must still spend a fetch",
	);
	assert.equal(fetched.outcome.kind, "applied");
	assert.ok(
		fetched.outcome.newRecords > 0,
		"and the fetch must bring rows back, not a no-op page",
	);
	assert.equal(
		pump.state.failures,
		0,
		"a landing leaves the count where it was",
	);

	/*
	 * THE SAME SEQUENCE UNDER THE PRE-FIX FOLD, DRIVEN RATHER THAN DESCRIBED. On this
	 * tree `noteAborted` exists, so the old fold cannot be reached through the code
	 * under test and has to be stated: `noteFailed` is exactly what the pre-fix pump
	 * called for every non-applied answer (one `false`), and it is present on both
	 * trees. Three non-deliberate asks folded through it are the operator's lockout -
	 * the budget is spent, `isExhausted` is true, and the next honest gesture is
	 * refused. On the tree that had the loader fix WITHOUT the policy fix
	 * (`1d2a27be33`) this is not a counter-case at all: `paging.noteAborted` is
	 * undefined there, the mapping at the top of this file falls back to `noteFailed`,
	 * and the three gestures above reach it - measured, and the failing assertion text
	 * is recorded in this commit's body.
	 */
	let preFix = initialPagingState();
	for (let round = 0; round < 3; round++) {
		const at = (round + 1) * 5_000;
		const armed = noteInput(preFix, {
			direction: "up",
			continuous: true,
			deliberate: false,
			atHardTop: false,
			travelledPx: 200,
			at: round * 5_000,
		});
		const decision = decide(armed, pump.geometry(), at + SETTLE_MS);
		assert.equal(
			decision.action,
			"fetch",
			"the pre-fix policy still owed an ask",
		);
		preFix = noteFailed(decision.state);
	}
	assert.equal(
		preFix.failures,
		3,
		"the pre-fix fold counted a lost race as a failure",
	);
	assert.equal(
		paging.isExhausted(preFix),
		true,
		"and three of them switched the automatic path off",
	);
	assert.equal(
		decide(
			noteInput(preFix, {
				direction: "up",
				continuous: true,
				deliberate: false,
				atHardTop: false,
				travelledPx: 200,
				at: 20_000,
			}),
			pump.geometry(),
			20_000 + SETTLE_MS,
		).action,
		"none",
		"and the reader's next honest gesture is refused - the lockout the operator saw",
	);
});

test("the prune-heavy journal is reachable end to end, on strictly advancing cursors", async () => {
	/*
	 * THE "OPERATOR'S SESSION REACHABLE" PIN. This drives the paging policy AND the
	 * reducer over the second shape from its tail to its first row: the tail page
	 * as the cold open, then repeated continuation asks, and it asserts the two
	 * facts the reader's experience is made of - the cursor moves STRICTLY BACKWARDS
	 * every time (never repeats a page), and the walk terminates at the start rather
	 * than at a page it cannot get behind.
	 *
	 * It also pins WHICH pages the reader stopped on: every `before_id` asked is one
	 * of the shape's 22 page boundaries, in order. That is the thing the original
	 * defect destroyed (a boundary landing on an entry the reducer has no record for
	 * sent the cursor back to the tail), so the boundary sequence is asserted rather
	 * than only the end state.
	 */
	const spec = pruneHeavyShape;
	const journal = FakeJournal.fromSpec(spec);
	const reader = new Reader(m, journal).open();
	const pump = new Pump(reader);
	const indexOf = (id) => journal.entries.findIndex((entry) => entry.id === id);

	const cursorIndex = [indexOf(reader.transcript.oldestId)];
	let asks = 0;
	while (reader.transcript.hasMore && asks < 40) {
		asks += 1;
		const asked = await pump.gesture();
		assert.equal(asked.asked, true, `ask ${asks} must not be refused`);
		assert.equal(
			asked.outcome.kind,
			"applied",
			`ask ${asks} resolved ${asked.outcome.kind}`,
		);
		cursorIndex.push(indexOf(reader.transcript.oldestId));
	}

	assert.equal(
		reader.transcript.hasMore,
		false,
		"the reader reached the start",
	);
	assert.equal(
		asks,
		Math.ceil(journal.length / PAGE_LIMIT) - 1,
		"23 pages need 22 continuation asks",
	);
	for (let i = 1; i < cursorIndex.length; i++) {
		assert.ok(
			cursorIndex[i] < cursorIndex[i - 1],
			`cursor ${i} is not strictly older than the one before it (${cursorIndex[i - 1]} -> ${cursorIndex[i]})`,
		);
	}
	assert.equal(
		new Set(cursorIndex).size,
		cursorIndex.length,
		"no page may be asked for twice",
	);
	assert.equal(
		reader.requests.filter((request) => request.missing).length,
		0,
		"a healthy backend: no ask may come back cursor_missing",
	);

	// Every ask started from one of the shape's page boundaries, in walk order.
	const boundaries = spec.pageBoundaries.kinds.map(
		(_, k) => spec.entries - spec.pageBoundaries.limit * (k + 1),
	);
	assert.deepEqual(
		reader.requests.map((request) => indexOf(request.before)),
		boundaries,
		"the reader must ask from each page boundary once",
	);
	assert.equal(
		cursorIndex.at(-1),
		0,
		"and the walk must end on the journal's own first entry",
	);
});

test("the prune-heavy fixture IS the measured journal's structure, not a paraphrase of it", async () => {
	/*
	 * WHY A FIXTURE PIN. The shape is committed as a SPEC - counts, positions and
	 * boundary kinds - because the entries between those positions are not a fact
	 * about the operator's journal and a 2228-token list would pretend they were.
	 * That trade is only honest while the spec still describes the journal, so every
	 * measured fact is restated here as an assertion: a later edit that "tidies" the
	 * spec into a different journal fails here instead of quietly weakening the
	 * regressions above.
	 *
	 * The last assertion is the one that decided the diagnosis: the reader's
	 * page-boundary cursors SURVIVE the prune pass, which is what makes this
	 * session's red row the lost-race half of the class rather than a broken cursor.
	 */
	const spec = pruneHeavyShape;
	const journal = FakeJournal.fromSpec(spec);
	assert.equal(journal.length, 2228, "2228 entries");
	assert.equal(
		Math.ceil(journal.length / PAGE_LIMIT),
		23,
		"23 pages of 100 entries, so 22 boundaries",
	);

	// The six durable compactions, at the measured positions, each naming an entry
	// that is still in the journal (a compaction that points outside it is a
	// different journal - the one `compact_file` leaves behind).
	const compactions = journal.entries
		.map((entry, at) => ({ entry, at }))
		.filter(({ entry }) => entry.type === "compaction");
	assert.deepEqual(
		compactions.map(({ at }) => at),
		spec.compactions.map(({ at }) => at),
	);
	assert.deepEqual(
		compactions.map(({ at }) => at),
		[415, 598, 923, 1274, 1715, 1891],
		"the measured compaction positions",
	);
	const ids = new Set(journal.entries.map((entry) => entry.id));
	const keptAt = compactions.map(({ entry }) =>
		journal.entries.findIndex(
			(candidate) => candidate.id === entry.payload.first_kept_entry_id,
		),
	);
	assert.ok(
		compactions.every(({ entry }) =>
			ids.has(entry.payload.first_kept_entry_id),
		),
		"every first_kept_entry_id must resolve to a live entry",
	);
	assert.deepEqual(keptAt, [173, 513, 705, 1219, 1419, 1785]);

	// The prune-heavy half: a tail run of superseded `session_spend.v1` rows and the
	// one `prune` row.
	const countKind = (kind) =>
		journal.entries.filter((entry) => kindOf(entry) === kind).length;
	assert.equal(countKind("custom:session_spend.v1"), spec.spendRows.length);
	assert.equal(countKind("custom:session_spend.v1"), 74);
	assert.equal(countKind("prune"), 1);

	// Every page boundary the reader walks through carries the kind that was
	// measured at it - a boundary on a silent custom or a `tool` entry is what the
	// cursor rule had to stop looking up among the records.
	const limit = spec.pageBoundaries.limit;
	const boundaryAt = spec.pageBoundaries.kinds.map(
		(_, k) => spec.entries - limit * (k + 1),
	);
	assert.deepEqual(
		boundaryAt.map((at) => tokenOf(journal.entries[at])),
		spec.pageBoundaries.kinds,
		"each boundary must carry its measured kind, shape included",
	);

	// `compact_file` keeps only the newest spend row, and NOT ONE of those boundary
	// cursors is among what it drops.
	const boundaryIds = new Set(boundaryAt.map((at) => journal.entries[at].id));
	const dropped = journal.compact();
	assert.equal(
		dropped.length,
		74 - 1,
		"the fold keeps exactly the newest spend row",
	);
	assert.equal(
		dropped.filter((id) => boundaryIds.has(id)).length,
		0,
		"0 of the 22 page-boundary cursors may be deleted by the prune pass",
	);
	// And the boundary cursors themselves survive it. This is the fact the
	// diagnosis turned on: the reader's cursors are still servable after the prune
	// pass, so this session's red row cannot have been a broken cursor.
	const survivors = new Set(journal.entries.map((entry) => entry.id));
	assert.equal(
		[...boundaryIds].filter((id) => survivors.has(id)).length,
		boundaryIds.size,
		"all 22 page-boundary cursors must survive the prune pass",
	);
	assert.equal(
		journal.length,
		spec.entries - dropped.length,
		"the fold may take spend rows and nothing else",
	);
});

/* ---------- the completion walk: a settled turn completes itself (1b) ---------- */

/*
 * WHAT THIS PINS. The open-time alignment used to spend a fixed two pages
 * (`ALIGN_FETCH_MAX`) and stop, so a turn whose head lay further up the journal
 * could never state its own action count: the operator's bar read "97 actions"
 * against a run of 423 calls, and the count only grew as pages arrived by hand.
 * The walk replaces the flat budget with a bounded walk that runs only while
 * the window's top run is head-cut, the reader follows the tail and has given no
 * recent input, no page is in flight, and every page so far applied. `bounded`
 * here means `ALIGN_WALK_MAX_PAGES` (pinned equal to `JUMP_MAX_PAGES` so the
 * reader's chain and a rail jump cannot disagree).
 *
 * The rows are the REAL row model (`buildRows` over the reducer's records), so
 * the walk is gated on the same head-cut test the render pass uses.
 */
const bundleModule = async (contents) => {
	const out = await build({
		stdin: { contents, resolveDir: process.cwd() },
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		tsconfig: resolve(process.cwd(), "tsconfig.web.json"),
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`
	);
};

const model = await bundleModule(`
	export * from "./src/renderer/src/features/chat/canonical/turn-collapse-model";
	export { buildRows } from "./src/renderer/src/features/chat/canonical/transcript-rows";
	export { JUMP_MAX_PAGES } from "./src/renderer/src/features/chat/canonical/reveal-record";
`);

test("the reader's chain and a rail jump share one bound", () => {
	assert.equal(
		model.ALIGN_WALK_MAX_PAGES,
		model.JUMP_MAX_PAGES,
		"a rail jump and the open-time walk must not disagree about how far one act may walk",
	);
});

test("the completion walk walks a head-cut run to its head, in one open", async () => {
	const journal = FakeJournal.fromShape(shape.kinds);
	const reader = new Reader(m, journal).open();
	/*
	 * The open's loaded set is ONE head-cut run (54 rows of the journal's long
	 * leading turn), so the window is inside it at any size below that — the
	 * state the walk exists to resolve. The window is 30 rather than the
	 * component's 60 so the case does not silently stop exercising the cut the
	 * day the fixture's tail page gains a few rows.
	 */
	const WINDOW = 30;
	const rows = model.buildRows(reader.transcript.records, []);
	assert.ok(
		model.windowTopRunIsHeadCut(rows, WINDOW),
		"the fixture opens with a cut run's tail - otherwise this case proves nothing",
	);
	let pages = 0;
	let spent = 0;
	let halted = false;
	for (let i = 0; i < 40; i += 1) {
		const cut = model.windowTopRunIsHeadCut(
			model.buildRows(reader.transcript.records, []),
			WINDOW,
		);
		const decision = model.alignWalkDecision(spent, {
			hasMore: reader.transcript.hasMore,
			loadingOlder: false,
			headCut: cut,
			mayWalk: true,
			halted,
		});
		if (!decision.fetch) break;
		spent = decision.spent;
		const outcome = await reader.loadOlder();
		pages += 1;
		if (outcome.kind !== "applied") {
			halted = true;
			break;
		}
	}
	assert.ok(
		pages > 2,
		`the whole head is walked, not two pages (got ${pages})`,
	);
	assert.ok(
		pages <= model.ALIGN_WALK_MAX_PAGES,
		`and never past the bound (${pages} > ${model.ALIGN_WALK_MAX_PAGES})`,
	);
});

test("the completion walk stops on a non-applied page, and never walks off the tail", async () => {
	const journal = FakeJournal.fromShape(shape.kinds);
	const reader = new Reader(m, journal).open();
	let spent = 0;
	let halted = false;
	const step = async (over = {}) => {
		const decision = model.alignWalkDecision(spent, {
			hasMore: reader.transcript.hasMore,
			loadingOlder: false,
			headCut: true,
			mayWalk: true,
			halted,
			...over,
		});
		if (!decision.fetch) return decision;
		spent = decision.spent;
		const outcome = await reader.loadOlder();
		if (outcome.kind !== "applied") halted = true;
		return { ...decision, outcome };
	};
	await step();
	reader.failNext = 1;
	const failed = await step();
	assert.equal(failed.outcome.kind, "failed", "the failing page is asked");
	assert.equal(halted, true, "and the walk is halted by it");
	assert.equal(
		(await step()).fetch,
		false,
		"a halted walk asks for nothing more, however much is left",
	);
	/* The reader is not at the tail: the pages would land off screen. */
	assert.equal(
		model.alignWalkDecision(0, {
			hasMore: true,
			loadingOlder: false,
			headCut: true,
			mayWalk: false,
			halted: false,
		}).fetch,
		false,
		"a reader who scrolled away is never walked on their behalf",
	);
});
