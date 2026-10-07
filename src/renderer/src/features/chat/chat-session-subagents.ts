/**
 * The sidebar row's subagent indicator: whether a row owns live subagents, and
 * the one sentence that says so.
 *
 * WHY THIS EXISTS (the operator's report, 2026-09-29): a session "not displaying
 * the icon where they're done but they still have running subagents, so it just
 * looks like they're inactive in the sidebar". The frame that came with it is the
 * shape of the defect - session 8f304a321926 selected, its own pane reading "1
 * subagent running", its sidebar row wearing nothing but a quiet `MessageSquare`.
 *
 * THE CAUSE IS PRECEDENCE, not a missing field. The catalogue serves
 * `subagents_running` / `subagents_queued` on every row, and its status ladder
 * ranks a live turn, a wedged beat, an unseen completion, an attached session and
 * an armed wake ABOVE `delegating` - so `delegating` is the code a row carries
 * only when nothing louder is true, and it is the one code whose `status.label`
 * the backend folds the counts INTO. Every louder rung therefore draws a mark of
 * its own and said nothing at all about the children still at work: a busy
 * session running eight of them drew one spinner, and a session that had finished
 * its own turn while its children worked drew one green check and read as done.
 *
 * WHAT THIS IS: one derivation and one sentence, both pure, so the mark's rules
 * can be driven by `scripts/*.test.mjs` without a renderer. The glyphs, the ink
 * and the slot belong to the row that paints them (`components/chat-sidebar.tsx`).
 *
 * THE TWO MARKS ARE INDEPENDENT CHANNELS, not two arms of one switch: a row can
 * own both a child at work and a child waiting for capacity, and each is its own
 * fact. `delegating` is the one place they interact, and the rule there is
 * suppression rather than addition - see `subagentMarks`.
 */

import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";

/**
 * The one code whose `status.label` the backend already folds the counts into.
 *
 * Core's `delegating_label` composes it from these very numbers ("2 subagents
 * running · 1 queued"), the status span renders that label into the accessible
 * name, and the row's tooltip reads it too. So on a `delegating` row the counts
 * are already announced, and the clause below must stay empty there rather than
 * say the same numbers a second time.
 *
 * The test is on the CODE rather than on a re-derivation of the label string:
 * whether a given label happens to contain a count is the backend's spelling, and
 * parsing it here would make this module fail open into a repeat announcement the
 * day that label is reworded.
 */
const COUNTS_RIDE_THE_LABEL = "delegating";

/**
 * A count as this module reads it: a number greater than zero, or nothing.
 *
 * `null` is the wire's "this build does not report" and is deliberately NOT zero
 * - the contract (`shared/desktop-session-contract.ts`) is explicit that a
 * session nobody could ask must never be drawn as one with no subagents, and the
 * store's own note is written against exactly the fold this refuses. Both answers
 * land on "no mark" here, and that is the same failure direction rather than a
 * fold: a mark is drawn only from a count that POSITIVELY says the work exists.
 *
 * The check is `typeof === "number" && Number.isFinite(value) && value > 0`, which
 * is the treatment spec's rule plus the one refinement it cannot state on its own:
 * `Number.isFinite` refuses `Infinity`, which passes a bare `> 0` while being
 * nonsense as a count. A fractional value (0.5) DOES draw, and that is the
 * spec's rule read literally - a count that is not a whole number is a defect
 * upstream, and the safe direction for one is to show the work rather than to
 * hide it. `whole` below keeps the sentence from reading "0 subagents running"
 * about a mark that is on the screen.
 */
const hasWork = (value: number | null | undefined): boolean =>
	typeof value === "number" && Number.isFinite(value) && value > 0;

/** The counts as the sentence spells them, and never as a zero while a mark is drawn. */
const whole = (value: number): number => Math.max(1, Math.floor(value));

/** `1 subagent`, `2 subagents` - the wire label's own spelling. */
const mentioned = (n: number): string => `${n} subagent${n === 1 ? "" : "s"}`;

/**
 * Whether this row's own `status.label` already spells the counts.
 *
 * True on `delegating` and nowhere else, and it gates BOTH halves of this
 * module - the running mark (suppressed there, because the primary mark already
 * IS it) and the sentence (empty there, because the label already says it). The
 * queued GLYPH is deliberately not gated: it is the one fact the delegating
 * rung's primary mark cannot carry.
 */
const speaksForItself = (code: string | undefined): boolean =>
	code === COUNTS_RIDE_THE_LABEL;

/**
 * Which marks a row draws, one flag per fact.
 *
 * ```
 * running ⇔ typeof r === "number" && r > 0 && code !== "delegating"
 * queued  ⇔ typeof q === "number" && q > 0
 * ```
 *
 * THE SUPPRESSION, and it is the only interaction between the two. `delegating`'s
 * primary mark IS the running mark - the three-bead trio in the accent
 * (`SubagentRunningMark`, the app's own "a thing is at work" shape), static - so
 * drawing this module's running mark beside it would put the same mark, twice,
 * in one row to say one thing. The row is not made silent by that: the presence
 * is on it, in the primary mark.
 *
 * The QUEUED mark is NOT suppressed there, and that is a decision rather than an
 * oversight: the trio carries "subagents are at work", not "none of them has
 * started", so a delegating row whose whole queue is still waiting is the one
 * case where the primary mark cannot speak for the second fact. It is also the
 * one case a row legitimately shows two marks.
 *
 * A code this build does not know still draws: the indicator is an independent
 * channel, not an arm of the status switch.
 */
export function subagentMarks(
	row: Pick<
		CanonicalSessionRow,
		"status" | "subagents_running" | "subagents_queued"
	>,
): { running: boolean; queued: boolean } {
	return {
		running:
			hasWork(row.subagents_running) && !speaksForItself(row.status?.code),
		queued: hasWork(row.subagents_queued),
	};
}

/**
 * The clause a reader hears - the accessible name's tail and the row tooltip's
 * line - or `""` when there is nothing new to say.
 *
 * Empty in two cases, and both are the "never announce the same thing twice"
 * rule rather than an omission:
 *  - no count is positive (including both `null`), so there is no mark either;
 *  - the row's code is `delegating`, whose `status.label` already spells the
 *    counts and whose accessible name carries that label verbatim.
 *
 * The three spellings are core's own (`catalog.py::delegating_label`), so the
 * row's sentence and the wire's label describe the same numbers the same way:
 *
 * ```
 * , 2 subagents running
 * , 2 subagents running · 1 queued
 * , 2 subagents queued
 * ```
 *
 * The `·` is the wire's separator and the noun is elided after it exactly as the
 * label elides it; one count on its own spells the noun (`1 subagent queued`),
 * because a clause with no noun reads as a fragment. Note that this holds the
 * counts from the row FIELDS even on a `delegating` row's label - the gating is
 * the code, so the sentence never re-derives the backend's spelling.
 */
export function subagentClause(
	row: Pick<
		CanonicalSessionRow,
		"status" | "subagents_running" | "subagents_queued"
	>,
): string {
	if (speaksForItself(row.status?.code)) {
		return "";
	}
	const { running, queued } = subagentMarks(row);
	if (!running && !queued) {
		return "";
	}
	const parts: string[] = [];
	if (running) {
		parts.push(`${mentioned(whole(row.subagents_running as number))} running`);
	}
	if (queued) {
		/*
		 * The second clause elides its noun only when the first one already
		 * carried it, which is where the wire label does the same thing. On its
		 * own it spells it: ", 2 queued" is a fragment, ", 2 subagents queued" is
		 * a sentence.
		 */
		parts.push(
			running
				? `${whole(row.subagents_queued as number)} queued`
				: `${mentioned(whole(row.subagents_queued as number))} queued`,
		);
	}
	return `, ${parts.join(" · ")}`;
}
