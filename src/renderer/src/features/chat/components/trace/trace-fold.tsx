/**
 * The aggregation tier's line (§E2, amendment A3).
 *
 * A run of three or more consecutive actions in one turn folds under ONE summary
 * line, so a forty-call turn stops being forty lines and starts being a sentence
 * a reader can act on: `Explored 4 files, 1 search`, `3 shell · 1 python`.
 *
 * ## What this component owns, and what it does not
 *
 * The copy, the counts, the run's span and the live clause are `trace-fold-model.ts`,
 * which is pure and unit-tested. This file owns the row, the disclosure, and the
 * two things a pure model cannot own: WHAT a reader's own press may change, and
 * WHEN a finished section condenses.
 *
 * ## Condensed by default, and the one event that condenses
 *
 * The fold opens on NOTHING but the reader's own press: a group must not arrive
 * open (operator report, 2026-09-26 - groups auto-opened for the newest turn and
 * then never closed, "which defeats the purpose"). It closes on exactly ONE
 * event, encoded below where it cannot be mistaken for a timer: the moment the
 * fold's section stops being the live one, and only while nothing inside it is
 * still running.
 *
 * ## What the condensed header says
 *
 * Three facts, in the order a reader needs them while the group is collapsed:
 * what is running RIGHT NOW (the in-flight call's own label - the operator's
 * sharpest point: `wait` holds a turn for minutes and a bare count hides it),
 * what the run has done (the counts by class or kind), and how long it has been
 * going (the run's wall-clock span, ticking while it runs). The running clause
 * is dropped while the fold is OPEN: the live row is right there, and two
 * elements for one fact is the redundancy this transcript keeps removing.
 *
 * ## The disclosure is the app's own
 *
 * `Disclosure` rather than a fold of its own, for the reason the design system
 * gives: a tool row, a section header and this line are the same gesture (a
 * leading chevron, one row height, a full-row ground), and a second folding
 * implementation beside the first is how one of them ends up with a different
 * hover, a different chevron or a different hit area. It is also what keeps the
 * fold's row at the ledger's own 24px pitch, so folding a run moves nothing
 * below it by more than the rows it hides. The one thing this change asks of
 * the primitive is its CONTROLLED mode: the condense belongs to the app as well
 * as the reader, and a second open-state owner beside the disclosure's own is
 * exactly how the two end up disagreeing about whether the fold is open.
 *
 * WHAT THE SHARED PRIMITIVE STILL DOES NOT GIVE THIS LINE, stated rather than
 * quietly skipped: §B7's named 180ms transition. `Disclosure` UNMOUNTS its
 * children (`isOpen && children`), so the fold appears and disappears rather
 * than growing and shrinking — and making it animate means keeping children
 * mounted for every caller, including every tool row in the transcript, where
 * an unmounted body is what keeps a forty-row turn cheap to scroll. That is a
 * change to a shared primitive with a real regression surface, so it is not
 * this commit's: the two states are legible in the frames, and the transition
 * is named as deferred on the PR rather than half-done here.
 *
 * ## The fold never reorders anything
 *
 * Folding hides rows; each keeps its record id and its position, and the fold
 * itself is keyed by its FIRST row's id, so it cannot claim a place ahead of the
 * action that opens it. That is branding §7's placement rule, and the transcript
 * order guard (`applyLiveSeed`/`withTimeOrder`) depends on it.
 */

import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import { type ReactNode, useEffect, useState } from "react";
import type { FoldLive, FoldSpan } from "../../canonical/trace-fold-model";
import { formatSettledDuration } from "./tool-row-model";

/**
 * The ledger's own row height, and the reason it is spelled here rather than
 * imported: `tool-row.tsx` keeps its copy private on purpose (a consumer that
 * captured it by name could keep a stale pitch after the row moved), and
 * `scripts/tool-row.test.mjs` asserts the two stay equal.
 */
const ROW_HEIGHT = "min-h-5 py-0";

/** The fold's clock ticks at 1Hz, the interval the row's own clock uses. */
const FOLD_CLOCK_MS = 1000;

export type TraceFoldProps = {
	/** §E2's generated copy: `Explored 4 files, 1 search`, `3 shell · 1 python`. */
	summary: string;
	actionCount: number;
	failedCount: number;
	/**
	 * The run's wall-clock span (`foldSpan`), or null when it cannot date itself -
	 * an older row restored from history carries durations but no stamps, and the
	 * header then renders NOTHING rather than a `0s` claim nothing supports.
	 */
	span: FoldSpan | null;
	/**
	 * The call being watched (`foldLive`), or null when every call has settled.
	 * Names the header while the fold is collapsed AND blocks the condense while
	 * anything is still running - the same value carries both, so the two cannot
	 * disagree about whether the run is over.
	 */
	live: FoldLive | null;
	/**
	 * The fold's section is the live one: the newest turn, while that turn is in
	 * flight. While this is true nothing the app does may touch an open fold; the
	 * condense fires on the transition out of it.
	 */
	sectionLive: boolean;
	/** The fold's own margin: the gap tier its first row arrived with (D8). */
	className?: string;
	/**
	 * The record ids the fold holds. Stamped on the wrapper (`data-fold-ids`)
	 * because a collapsed fold UNMOUNTS its rows, so the turn foot's `1 failed`
	 * jump cannot find the failed row by its `data-record-id` until the fold
	 * that holds it is opened - this is how it finds that fold.
	 */
	recordIds: readonly string[];
	children: ReactNode;
};

/**
 * Ms now, ticking once a second while `active`.
 *
 * A local copy of the row's clock idiom (`tool-row.tsx`'s `useRunningElapsed`)
 * rather than an export of it: the row's hook answers "how long has ONE call
 * been running" from its start, while this answers "what time is it" for the
 * fold's span - `foldSpan` owns the arithmetic and this owns only the tick. It
 * shares the row's interval because the fold's number is whole seconds or tenths
 * (`formatSettledDuration`), so a faster clock would repaint without a change.
 */
function useNowMs(active: boolean): number {
	const [nowMs, setNowMs] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		const read = () => setNowMs(Date.now());
		read();
		const timer = window.setInterval(read, FOLD_CLOCK_MS);
		return () => window.clearInterval(timer);
	}, [active]);
	return nowMs;
}

export const TraceFold = ({
	summary,
	actionCount,
	failedCount,
	span,
	live,
	sectionLive,
	className,
	recordIds,
	children,
}: TraceFoldProps) => {
	/*
	 * THE CONDENSE RULE, in one place, because this is exactly the rule someone
	 * will later "simplify" into a bug:
	 *
	 *   finished sections condense; the live section and anything the reader has
	 *   open obey the reader.
	 *
	 * The fold opens on the reader's own press and on nothing else, and it closes
	 * on ONE event: the moment its section stops being the live one. Two guards
	 * keep that event honest:
	 *
	 * - it never fires while the section is STILL live, so a fold the reader
	 *   opened mid-watch is never closed underneath them while they watch it;
	 * - it never fires while a call in the run has not settled (`live` is the
	 *   in-flight call and therefore the fold's own settle predicate), so a fold
	 *   cannot condense while it would hide a live clock.
	 *
	 * `armed` is what makes this an EVENT rather than a state: it is set while the
	 * section is live and cleared when the condense fires once, so a fold restored
	 * already-finished - or one the reader opens AFTER its section ended, like the
	 * failed-row jump does - stays open. Only the transition out of a live section
	 * condenses. Do not turn this into a timer, a hover rule, or a
	 * "close it if nobody is looking" heuristic: the section's own end is the only
	 * event the reader has agreed to.
	 */
	const [open, setOpen] = useState(false);
	const [armed, setArmed] = useState(sectionLive);
	useEffect(() => {
		if (sectionLive) {
			setArmed(true);
			return;
		}
		if (armed && live === null) {
			setArmed(false);
			setOpen(false);
		}
	}, [sectionLive, armed, live]);

	/*
	 * The run's clock. `span.running` ticks it against now; a settled span freezes
	 * at its last completion, and a span that cannot date itself renders nothing
	 * (`formatSettledDuration(null)` is the empty string).
	 */
	const nowMs = useNowMs(span?.running === true);
	const spanS =
		span === null
			? null
			: Math.max(
					0,
					((span.running ? nowMs : (span.endedAtMs ?? nowMs)) -
						span.startedAtMs) /
						1000,
				);
	const durationText = spanS === null ? "" : formatSettledDuration(spanS);

	return (
		<div className={className} data-fold-ids={recordIds.join(" ")}>
			<Disclosure
				/*
				 * CONTROLLED, because the app closes this fold as well as the reader
				 * (`open`/`onOpenChange` above): the alternative is the reader's state
				 * and the app's state disagreeing about whether the fold is open.
				 */
				open={open}
				onOpenChange={setOpen}
				/*
				 * The summary is the aggregate line, so the chevron is what carries "there are
				 * rows in here" — the count alone would read as a statement of fact rather
				 * than as a control.
				 */
				rowClassName={ROW_HEIGHT}
				triggerClassName={cn("-mx-2 rounded-sm px-2", "hover:bg-row-hover")}
				summary={
					<span className={cn("flex min-w-0 flex-1 items-center gap-2")}>
						{/*
						 * Sans, because this is a SENTENCE about the turn rather than an
						 * identifier (§B4): the counts are words. The object's monospace column
						 * belongs to the individual rows inside the fold.
						 *
						 * FOUR FLEX ITEMS AND THE GAP THAT SPACES THEM, not one truncating
						 * sentence: the header's `·` separators take their breathing room from
						 * this row's `gap-2`, exactly as the summary/failure/clock did before the
						 * live clause existed (§E2). Truncation priority is flex's: the live
						 * clause and the summary can both shrink (`min-w-0 truncate`), the
						 * failure count and the clock are `shrink-0`, so a tight column loses
						 * words from the clause's tail before it loses a fact.
						 */}
						{live !== null && !open && (
							<>
								{/*
								 * THE IN-FLIGHT CALL, in the row's own words and its own
								 * typography: the verb the row paints while running (`Running`,
								 * `Reading`, `Calling`) at the row's own liveness ink, then the
								 * object in the machine voice the row gives it. Dropped while the
								 * fold is open - the live row is on screen then, and one fact does
								 * not need two elements. `data-fold-live` is the handle the
								 * behaviour suite drives (`scripts/trace-fold-behaviour.test.mjs`).
								 */}
								<span data-fold-live="" className={cn("min-w-0 truncate")}>
									<span className={cn("text-accent")}>{live.verb}</span>{" "}
									<span className={cn("font-mono text-mono-sm text-ink-muted")}>
										{live.object}
									</span>
								</span>
								{/*
								 * The `·` the header joins its facts with, after the live clause as
								 * after every other. It is a flex child rather than text inside the
								 * clause: nested one level in, it lost the row's `gap-2` and printed
								 * as `Running pnpm vitest run·3 shell` - caught in the first frame of
								 * `docs/evidence/chat-trace-fold/` and confirmed by measuring the
								 * rendered rects (clause 52-213, dot 213-217: zero gap).
								 */}
								<span
									aria-hidden={true}
									className={cn("text-ink-dim text-meta")}
								>
									·
								</span>
							</>
						)}
						<span
							className={cn("min-w-0 truncate text-body-sm text-ink-muted")}
							title={`${actionCount} actions`}
						>
							{/*
							 * What the run has done, by class or by kind (`foldSummary`).
							 */}
							<span>{summary}</span>
						</span>
						{/*
						 * The failure count is the fold's only loud ink, and it is the reader's
						 * only way into the failure without opening the run by hand — which is
						 * why §E3's foot line carries the same number as a control. It names what
						 * it counts (`1 failed`), because a bare red number states that something
						 * went wrong without saying what did.
						 */}
						{failedCount > 0 && (
							<>
								{/*
								 * The `·` the foot line uses between its facts (D8: without it the
								 * summary read as one run-on phrase, `7 actions 1 failed 15s`), in
								 * the summary's own quiet ink so only the count is loud.
								 */}
								<span
									aria-hidden={true}
									className={cn("text-ink-dim text-meta")}
								>
									·
								</span>
								<span
									className={cn("shrink-0 font-medium text-danger text-meta")}
								>
									{failedCount} failed
								</span>
							</>
						)}
						{/*
						 * The run's own clock, as the sentence's last fact (`3 shell · 1
						 * python · 1 failed · 15s`), matching the foot line's register. It is
						 * the WALL-CLOCK SPAN (first start to last completion), rendered in the
						 * rows' own settled format so it can never print a bare `0s` for a run
						 * of fast calls - and omitted entirely when no stamps exist, because
						 * "we do not know" is a different statement from "no time passed".
						 */}
						{durationText !== "" && (
							<>
								<span
									aria-hidden={true}
									className={cn("text-ink-dim text-meta")}
								>
									·
								</span>
								<span
									data-fold-span=""
									className={cn(
										"shrink-0 font-mono text-ink-dim text-mono-sm tabular-nums",
									)}
								>
									{durationText}
								</span>
							</>
						)}
					</span>
				}
			>
				{children}
			</Disclosure>
		</div>
	);
};
