/**
 * The aggregation tier's line (§E2, amendment A3).
 *
 * A run of three or more consecutive actions in one turn folds under ONE summary
 * line, so a forty-call turn stops being forty lines and starts being a sentence
 * a reader can act on: `Explored 4 files, 1 search`, `Ran 8 actions · 1 failed`.
 *
 * ## What this component owns, and what it does not
 *
 * The copy, the counts and the fold's own arithmetic are `trace-fold-model.ts`,
 * which is pure and unit-tested. This file owns the row and the disclosure.
 *
 * ## The disclosure is the app's own
 *
 * `Disclosure` rather than a fold of its own, for the reason the design system
 * gives: a tool row, a section header and this line are the same gesture (a
 * leading chevron, one row height, a full-row ground), and a second folding
 * implementation beside the first is how one of them ends up with a different
 * hover, a different chevron or a different hit area. It is also what keeps the
 * fold's row at the ledger's own 24px pitch, so folding a run moves nothing
 * below it by more than the rows it hides.
 *
 * WHAT THE SHARED PRIMITIVE DOES NOT GIVE THIS LINE, stated rather than quietly
 * skipped: §B7's named 180ms transition. `Disclosure` UNMOUNTS its children
 * (`isOpen && children`), so the fold appears and disappears rather than growing
 * and shrinking — and making it animate means keeping children mounted for every
 * caller, including every tool row in the transcript, where an unmounted body is
 * what keeps a forty-row turn cheap to scroll. That is a change to a shared
 * primitive with a real regression surface, so it is not this commit's: the two
 * states are legible in the §N frames, and the transition is named as deferred on
 * the PR rather than half-done here.
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
import type { ReactNode } from "react";
import { formatDuration } from "./tool-row-model";

/**
 * The ledger's own row height, and the reason it is spelled here rather than
 * imported: `tool-row.tsx` keeps its copy private on purpose (a consumer that
 * captured it by name could keep a stale pitch after the row moved), and
 * `scripts/tool-row.test.mjs` asserts the two stay equal.
 */
const ROW_HEIGHT = "min-h-5 py-0";

export type TraceFoldProps = {
	/** §E2's generated copy: `Explored 4 files, 1 search`, `8 actions`. */
	summary: string;
	actionCount: number;
	failedCount: number;
	durationS: number | null;
	/**
	 * Expanded by default for the newest turn WHILE IT IS IN FLIGHT, collapsed to
	 * the summary once it settles (§E2): a live turn is the thing being watched, and
	 * a settled one is reference material.
	 */
	openByDefault: boolean;
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

export const TraceFold = ({
	summary,
	actionCount,
	failedCount,
	durationS,
	openByDefault,
	className,
	recordIds,
	children,
}: TraceFoldProps) => (
	<div className={className} data-fold-ids={recordIds.join(" ")}>
		<Disclosure
			/*
			 * The summary is the aggregate line, so the chevron is what carries "there are
			 * rows in here" — the count alone would read as a statement of fact rather
			 * than as a control.
			 */
			defaultOpen={openByDefault}
			rowClassName={ROW_HEIGHT}
			triggerClassName={cn("-mx-2 rounded-sm px-2", "hover:bg-row-hover")}
			summary={
				<span className={cn("flex min-w-0 flex-1 items-center gap-2")}>
					{/*
					 * Sans, because this is a SENTENCE about the turn rather than an
					 * identifier (§B4): the counts are words. The object's monospace column
					 * belongs to the individual rows inside the fold.
					 */}
					<span
						className={cn("min-w-0 truncate text-body-sm text-ink-muted")}
						title={`${actionCount} actions`}
					>
						{summary}
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
							<span aria-hidden={true} className={cn("text-ink-dim text-meta")}>
								·
							</span>
							<span
								className={cn("shrink-0 font-medium text-danger text-meta")}
							>
								{failedCount} failed
							</span>
						</>
					)}
					{/* The run's own clock, as the sentence's last fact (`8 actions · 1
				    failed · 15s`), matching the foot line's register - a clock pinned to
				    the far edge left a gap the eye read as a second, unrelated column. */}
					{durationS !== null && (
						<>
							<span aria-hidden={true} className={cn("text-ink-dim text-meta")}>
								·
							</span>
							<span
								className={cn(
									"shrink-0 font-mono text-ink-dim text-mono-sm tabular-nums",
								)}
							>
								{formatDuration(durationS)}
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
