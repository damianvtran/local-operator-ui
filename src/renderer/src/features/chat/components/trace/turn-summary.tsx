/**
 * The collapsed turn's line (§4.3 of the frozen design): one full-width bar
 * standing in for a completed turn's pre-answer rows.
 *
 * The operator's reference is dsh's `Took 1m 19s` line, deliberately improved
 * on in three app-native ways: the counts and the failure control survive the
 * collapse (the failure control is the foot's U14 jump, generalised to open
 * this bar first), the turn's one timestamp re-homes here from the foot it
 * suppresses (`turn-timestamp.tsx`'s contract: one stamp per turn), and the
 * gesture is the app's single disclosure idiom, so the bar opens the way every
 * tool row already taught.
 *
 * WHAT THIS COMPONENT OWNS, and what it does not. The copy, the numbers, the
 * span and the hidden/pinned partition are `turn-collapse-model.ts` (pure and
 * unit-tested). This file owns the row, the disclosure, the stamp's placement,
 * and the failure control's press. The OPEN STATE is the caller's — the
 * transcript keeps the reader's expansion per conversation for the renderer's
 * lifetime (`shared/store/turn-collapse-open.ts`) — so the component is
 * controlled in the React sense, exactly like `TraceFold`.
 *
 * THE LAYOUT IS THE LEDGER'S OWN: `min-h-5 py-0` is the dense row height the
 * fold and the tool rows share (`tool-row.test.mjs` pins the pitch), the
 * trigger bleeds `-mx-2 px-2` so the hover ground covers the row's gutters,
 * and the chevron is `trailing` because the sentence reads from the left and
 * the reader's eye leaves at the right. The chevron's ink is `text-ink-muted`
 * rather than the primitive's `ink-disabled` default: this bar's chevron is
 * the surface's ONLY affordance, and `ink-disabled` is exempt from the 3:1
 * non-text floor (the primitive's own docstring measured 2.70:1 — the case
 * `chevronClassName` exists for).
 *
 * THE FAILURE CONTROL IS A REAL BUTTON, in the disclosure's `trailing` slot
 * (UX round 1, U1). It used to be a span inside the trigger watched by an
 * `onClickCapture`, which left the foot's own control — a real `<button>`
 * (`canonical-transcript.tsx`'s closing line) — with a keyboard route the bar
 * lost exactly when the turn collapsed: a parity regression, not a symmetric
 * trade, because the jump's auto-open and centre-scroll is the part a keyboard
 * reader could no longer reach. A control that belongs beside the trigger
 * cannot be a child of it (a `<button>` inside a `<button>` is invalid markup),
 * and the primitive ships the slot for exactly this pairing — so the clause's
 * press is the primitive's own trailing control now, with the SAME copy and
 * the SAME classes as the foot's button. The layout note the move carries:
 * the clause now sits at the row's trailing edge, past the chevron, rather
 * than inside the left sentence; the design round verifies that placement from
 * the re-shot frames.
 *
 * The trade, stated rather than hidden: the control renders only when the run
 * has a first failed row, so a passing turn's row is byte-identical to before.
 */

import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import type { FC, ReactNode } from "react";
import { jumpToFailedRow } from "../../canonical/failed-row-jump";
import { TurnTimestamp } from "../message-item/turn-timestamp";
import { formatDuration } from "./tool-row-model";

/**
 * The dense ledger height the fold and tool rows share (see `trace-fold.tsx`:
 * the bar moves nothing below it by more than the rows it hides).
 */
const ROW_HEIGHT = "min-h-5 py-0";

export type TurnSummaryProps = {
	/**
	 * Every record id of the run, in order — `data-run-ids`, the fold's
	 * `data-fold-ids` contract, so the failure jump and a rig can address the
	 * bar by the row they are looking for.
	 */
	recordIds: readonly string[];
	/**
	 * The FIRST hidden row's id: the bar occupies that row's slot, and carries
	 * its identity so a lookup for the row finds the bar that replaced it.
	 */
	anchorRecordId: string;
	/** The bar's margin: the first hidden row's gap tier. */
	className?: string;
	/** The run's wall span in seconds (§4.4), or null to omit the clause. */
	durationS: number | null;
	/** Tool rows in the run; zero omits the clause. */
	actionCount: number;
	/** Tool rows whose outcome is a genuine error; zero omits the clause. */
	failedCount: number;
	/** The first failed row, for the failure control's jump. */
	firstFailedId: string | null;
	/**
	 * The fold-style class sentence (`foldSummary`, e.g. "Explored 4 files, 1
	 * search"), one hover away at zero line weight; null when the run has no
	 * actions to phrase.
	 */
	title: string | null;
	/**
	 * The closing answer's instant, for the turn's one stamp; null renders no
	 * stamp (a run that never handed an answer has no time to state — the same
	 * rule the foot's stamp follows).
	 */
	stampTs: number | null;
	/** Controlled open state — the transcript owns the reader's expansion. */
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The hidden rows' groups, mounted only while open (the fold's contract). */
	children: ReactNode;
};

/** The `·` the line joins its facts with — a flex child, never nested text. */
const Dot: FC = () => (
	<span aria-hidden={true} className={cn("text-ink-dim text-meta")}>
		·
	</span>
);

export const TurnSummary: FC<TurnSummaryProps> = ({
	recordIds,
	anchorRecordId,
	className,
	durationS,
	actionCount,
	failedCount,
	firstFailedId,
	title,
	stampTs,
	open,
	onOpenChange,
	children,
}) => {
	return (
		<div
			/*
			 * The "there is more below" rule (design spec D1, operator feedback
			 * 2026-09-28, after dsh's bottom rule): a hairline under the bar says the
			 * block continues into hidden rows, where a bare row read as everything
			 * having disappeared. It is the app-wide separator idiom (`border-hairline`,
			 * no new ink), spans the block's content box with no inset, and sits at the
			 * block's own bottom so it mounts and moves with the collapse — decorative,
			 * never a hover surface, no animation, and none of the bar's numbers, stamp,
			 * chevron or failure control change.
			 */
			className={cn("border-b border-hairline", className)}
			data-turn-summary=""
			data-run-ids={recordIds.join(" ")}
			data-record-id={anchorRecordId}
		>
			<Disclosure
				/*
				 * CONTROLLED, because the transcript owns this state as well as the
				 * reader (`turn-collapse-open.ts`): a second open-state owner beside
				 * the disclosure's own is exactly how the two end up disagreeing about
				 * whether the bar is open (the `TraceFold` precedent).
				 */
				open={open}
				onOpenChange={onOpenChange}
				chevron="trailing"
				rowClassName={ROW_HEIGHT}
				triggerClassName={cn("-mx-2 rounded-sm px-2", "hover:bg-row-hover")}
				chevronClassName={cn("text-ink-muted")}
				summary={
					/*
					 * FOUR FLEX ITEMS AND THE GAP THAT SPACES THEM, not one truncating
					 * sentence: the `·` separators take their breathing room from this
					 * row's `gap-2` (the fold's own rule — nested in a clause they lose
					 * the row's gap and print as `1 action·1 failed`).
					 */
					<span
						className={cn("flex min-w-0 flex-1 items-center gap-2")}
						title={title ?? undefined}
					>
						{durationS !== null && (
							<span className={cn("shrink-0 text-body-sm text-ink-muted")}>
								Took {formatDuration(durationS)}
							</span>
						)}
						{durationS !== null && actionCount > 0 && <Dot />}
						{actionCount > 0 && (
							<span className={cn("shrink-0 text-body-sm text-ink-muted")}>
								{actionCount === 1 ? "1 action" : `${actionCount} actions`}
							</span>
						)}
						{stampTs !== null && (
							/*
							 * THE TURN'S ONE STAMP, re-homed from the foot this bar suppresses
							 * (`answer` scope because the instant is the closing answer's — the same
							 * fact the foot stated, moved one row up). Its box sits ahead of the
							 * trailing chevron, so the row's rightmost ink is the chevron (or the
							 * failure control, when one renders) — which groups with the ledger's
							 * value edge, not with the foot stamp's own right edge (design review
							 * round 1, D6 measured the two: foot 1043 vs bar 1007; the value edge is
							 * the one the design round judged better).
							 */
							<span className={cn("ml-auto")}>
								<TurnTimestamp timestamp={stampTs} scope="answer" />
							</span>
						)}
					</span>
				}
				// A real control, outside the trigger: the same one the foot renders,
				// with keyboard parity lost nowhere (UX round 1, U1).
				trailing={
					failedCount > 0 && firstFailedId ? (
						<button
							type="button"
							data-failed-clause=""
							onClick={(event) => {
								const root =
									event.currentTarget.closest("[data-lo-transcript-content]") ??
									document;
								jumpToFailedRow(root, firstFailedId);
							}}
							className={cn(
								"-mr-2 shrink-0 px-2 font-medium text-danger text-meta hover:underline",
							)}
						>
							{failedCount === 1 ? "1 failed" : `${failedCount} failed`}
						</button>
					) : undefined
				}
			>
				{/*
				 * ONE CHILD, SO THE BODY'S OWN `gap-2` NEVER SITS BETWEEN ROWS — the
				 * exact mechanism `TraceFold` documents at its own body (design review
				 * round 1, D2 measured the regression this closes: 30px pitch against
				 * the ledger's 22px because the body's 8px step landed between every
				 * child). Passing the groups as ONE flex child keeps the body's 4px
				 * padding and takes its gap out of the run, so the expansion measures
				 * what the same run measures unfolded: N x 20px + (N-1) x 2px.
				 */}
				<div className={cn("flex flex-col")}>{children}</div>
			</Disclosure>
		</div>
	);
};
