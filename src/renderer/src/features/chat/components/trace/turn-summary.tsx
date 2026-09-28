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
 * THE FAILED CLAUSE IS A PRESS ON THE BAR, NOT A NESTED BUTTON. The trigger
 * IS a button and a button inside a button is not markup a browser resolves
 * (the disclosure docstring's own rule), so the clause is a span styled as the
 * foot's control (`font-medium text-danger hover:underline`) and the bar
 * watches for a press that lands on it (`onClickCapture`, i.e. before the
 * trigger's toggle). The jump opens the bar itself, so the press stops there —
 * letting the toggle also run would open and shut the bar in one gesture. The
 * trade, stated rather than hidden: the express lane is pointer-only — a
 * keyboard reader opens the bar (Enter/Space on the trigger) and reaches every
 * row's own disclosure from there, one gesture longer.
 */

import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import type { FC, MouseEvent as ReactMouseEvent, ReactNode } from "react";
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
	/**
	 * The failure control's press, caught before it can reach the trigger (see
	 * the header): a press on the clause IS a press with a destination, not a
	 * toggle. `jumpToFailedRow` opens the bar itself when it is still closed, so
	 * the gesture lands the same way from either state.
	 */
	const onFailedPress = (event: ReactMouseEvent<HTMLDivElement>) => {
		const target = event.target instanceof Element ? event.target : null;
		if (!target?.closest("[data-failed-clause]") || !firstFailedId) return;
		event.stopPropagation();
		const root =
			event.currentTarget.closest("[data-lo-transcript-content]") ?? document;
		jumpToFailedRow(root, firstFailedId);
	};
	return (
		<div
			className={className}
			data-turn-summary=""
			data-run-ids={recordIds.join(" ")}
			data-record-id={anchorRecordId}
			onClickCapture={onFailedPress}
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
						{actionCount > 0 && failedCount > 0 && <Dot />}
						{failedCount > 0 && (
							<span
								/*
								 * A span rather than a button: the trigger above it is one, and the
								 * press that lands here is caught by the bar's own capture handler
								 * (see the header). `data-failed-clause` is the marker that handler
								 * looks for — the styled span IS the control's face.
								 */
								data-failed-clause=""
								className={cn(
									"shrink-0 cursor-pointer font-medium text-danger text-meta hover:underline",
								)}
							>
								{failedCount === 1 ? "1 failed" : `${failedCount} failed`}
							</span>
						)}
						{stampTs !== null && (
							/*
							 * THE TURN'S ONE STAMP, re-homed from the foot this bar
							 * suppresses (`ml-auto` like the foot's, so it keeps the same
							 * right edge); `answer` scope because the instant is the closing
							 * answer's — the same fact the foot stated, moved one row up.
							 */
							<span className={cn("ml-auto")}>
								<TurnTimestamp timestamp={stampTs} scope="answer" />
							</span>
						)}
					</span>
				}
			>
				{children}
			</Disclosure>
		</div>
	);
};
