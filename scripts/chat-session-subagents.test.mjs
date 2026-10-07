/**
 * The sidebar's subagent indicator: one derivation, one sentence, executable.
 *
 *     node --test scripts/chat-session-subagents.test.mjs
 *
 * THE OPERATOR'S REPORT (2026-09-29) is what this file pins: a session "not
 * displaying the icon where they're done but they still have running subagents,
 * so it just looks like they're inactive in the sidebar". The counts are on the
 * wire on every row, but the only rung that ever put them on screen is
 * `delegating` - the one the catalogue reaches when nothing louder is true - so a
 * busy session running eight children, or a finished one whose children still
 * work, said nothing about them.
 *
 * WHY THE RULE IS A MODULE AND NOT A JSX CONDITION. This repository's desktop
 * suite is `node:test` over `scripts/*.test.mjs` with no DOM harness, so a
 * decision written as a condition in the sidebar's JSX is a decision no test here
 * can reach - the argument `chat-list-sections.ts` and `sidebar-catalogue-gate.ts`
 * both state at length. `chat-session-subagents.ts` carries the two facts and
 * their one sentence; `components/chat-sidebar.tsx` only paints them.
 *
 * WHAT THIS CANNOT SAY: that the mark LOOKS right, or that it sits where the
 * spec puts it. Those are pixels, and the pixels are the frames' job
 * (`subagent-presence-rows-*` in the status-feed evidence set). The rule is this
 * file's; the placement is the rig's.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/chat-session-subagents";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { subagentMarks, subagentClause } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** A row in the wire's own field names: the code, and the two counts. */
const row = (code, running, queued, label = code) => ({
	session_id: "fixture",
	status: { code, label },
	subagents_running: running,
	subagents_queued: queued,
});

/*
 * THE DERIVATION (§1.3 of the treatment spec), and the point of the whole file:
 * the mark is a function of the COUNTS and the one code that already speaks for
 * them - never of a switch over the status codes, which is the defect (the
 * counts were only ever drawn on one arm of that switch).
 */
test("the marks read the counts, not the code", () => {
	// Every rung the catalogue ranks ABOVE `delegating` draws - that ranking is
	// what made the presence invisible, so each one is asserted.
	for (const code of [
		"busy",
		"attached",
		"complete",
		"scheduled",
		"idle",
		"recent",
		"error",
		"interrupted",
		"wedged",
		"dormant",
		"approval",
		"answer",
		// A code this build does not know still draws: the indicator is an
		// independent channel, not an arm of the status switch.
		"some-future-code",
	]) {
		assert.deepEqual(
			subagentMarks(row(code, 2, 0)),
			{ running: true, queued: false },
			code,
		);
		assert.deepEqual(
			subagentMarks(row(code, 0, 3)),
			{ running: false, queued: true },
			code,
		);
		assert.deepEqual(
			subagentMarks(row(code, 2, 3)),
			{ running: true, queued: true },
			code,
		);
	}
	// A row with counts and no status at all is not a special case: the counts
	// are the fact, and an absent status is `undefined`, which is not
	// `delegating`.
	assert.deepEqual(subagentMarks({ subagents_running: 1 }), {
		running: true,
		queued: false,
	});
});

test("null and absent are NOT zero, and zero draws nothing", () => {
	/*
	 * The forward/backward-compat rule, and it is the store's own
	 * (`canonical-sessions-store.ts`: a `null` {"does not report"} becoming a `0`
	 * {"none"} is the bug to avoid). An older runtime that omits the fields must
	 * render exactly as it does today.
	 */
	for (const [why, r, q] of [
		["both absent", undefined, undefined],
		["both null", null, null],
		["null running, absent queued", null, undefined],
		["a real zero", 0, 0],
		["zero beside null", 0, null],
		// Not counts: refused rather than clamped, because a truthiness test would
		// draw a mark for `"3"` and `NaN` is falsy-but-a-number - the wire's
		// contract is a count and anything else is a defect upstream.
		["a numeric string", "3", "2"],
		["NaN", Number.NaN, Number.NaN],
		["negative", -3, -1],
		// `Infinity` passes a bare `> 0` and is refused on its own guard: it is not
		// a count, and a mark that never clears is worse than none.
		["Infinity", Number.POSITIVE_INFINITY, 0],
	]) {
		assert.deepEqual(
			subagentMarks(row("busy", r, q)),
			{
				running: false,
				queued: false,
			},
			why,
		);
		assert.equal(subagentClause(row("busy", r, q)), "", why);
	}
	/*
	 * A FRACTION BELOW ONE draws, and the sentence says "1" rather than "0".
	 * That is the spec's rule read literally (`> 0`) plus the one place it cannot
	 * be taken literally: a count that is not a whole number is a defect upstream,
	 * and the safe direction is to show the work - so `whole` floors to at least
	 * one while a mark is on the screen. The alternative (a row with a mark and
	 * the words "0 subagents running") is the two-derivations defect this codebase
	 * keeps having to remove.
	 */
	assert.deepEqual(subagentMarks(row("busy", 0.5, 0.25)), {
		running: true,
		queued: true,
	});
	assert.equal(
		subagentClause(row("busy", 0.5, 0.25)),
		", 1 subagent running · 1 queued",
	);
});

test("a delegating row suppresses the running mark and keeps the queued one", () => {
	/*
	 * §3 of the spec, and the reason it is a suppression rather than an addition:
	 * `delegating`'s PRIMARY mark is the running mark - the three-bead trio,
	 * accent, static - so drawing this module's running mark beside it would put
	 * the same mark twice on one row to say one thing. The queued glyph is NOT
	 * suppressed: the trio says "subagents are at work", not "none of them has
	 * started".
	 */
	assert.deepEqual(subagentMarks(row("delegating", 1, 0)), {
		running: false,
		queued: false,
	});
	assert.deepEqual(subagentMarks(row("delegating", 2, 1)), {
		running: false,
		queued: true,
	});
	assert.deepEqual(subagentMarks(row("delegating", 0, 2)), {
		running: false,
		queued: true,
	});
});

test("the clause is core's own three spellings", () => {
	/*
	 * The sentence, spelled the way the wire spells it
	 * (`local_operator/session/catalog.py::delegating_label`), so the row's words
	 * and the label's words describe the same numbers the same way. The noun is
	 * elided after the `·` exactly as the label elides it - and ONLY there, since
	 * a lone ", 2 queued" is a fragment rather than a sentence.
	 */
	assert.equal(subagentClause(row("busy", 2, 0)), ", 2 subagents running");
	assert.equal(
		subagentClause(row("busy", 2, 1)),
		", 2 subagents running · 1 queued",
	);
	assert.equal(subagentClause(row("busy", 0, 2)), ", 2 subagents queued");
	// Singular, both clauses.
	assert.equal(subagentClause(row("busy", 1, 0)), ", 1 subagent running");
	assert.equal(subagentClause(row("busy", 0, 1)), ", 1 subagent queued");
	assert.equal(
		subagentClause(row("busy", 1, 1)),
		", 1 subagent running · 1 queued",
	);
});

test("a delegating row announces no clause at all", () => {
	/*
	 * THE NEVER-TWICE RULE. `status.label` already carries the counts on this rung
	 * ("2 subagents running · 1 queued") and the status span renders that label
	 * verbatim into the row's accessible name - so a clause here would say the
	 * same numbers a second time in the same sentence. Gated on the CODE rather
	 * than on a re-derivation of the label string, because whether a label happens
	 * to contain a count is the backend's spelling: parsing it would make this
	 * module fail open into a repeat announcement the day that label is reworded.
	 */
	assert.equal(
		subagentClause(row("delegating", 2, 1, "2 subagents running · 1 queued")),
		"",
	);
	assert.equal(
		subagentClause(row("delegating", 0, 2, "2 subagents queued")),
		"",
	);
	// And the marks stay independent of the sentence: the queued GLYPH still draws
	// on a delegating row (it is the one fact the primary `Share2` cannot carry),
	// while the SENTENCE is empty there, because the label already spells the
	// counts. Two channels, one announcement.
	assert.deepEqual(subagentMarks(row("delegating", 1, 0)), {
		running: false,
		queued: false,
	});
	assert.deepEqual(subagentMarks(row("delegating", 2, 1)), {
		running: false,
		queued: true,
	});
});

test("the two facts survive a large count without changing shape", () => {
	// The mark is a glyph, never a digit (the spec is explicit), so the sentence
	// is the only place a number lives - and it has to hold the fleet's real
	// numbers without a width change.
	assert.equal(subagentClause(row("busy", 8, 0)), ", 8 subagents running");
	assert.equal(
		subagentClause(row("busy", 163, 12)),
		", 163 subagents running · 12 queued",
	);
	assert.deepEqual(subagentMarks(row("busy", 163, 12)), {
		running: true,
		queued: true,
	});
});
