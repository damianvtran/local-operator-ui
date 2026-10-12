/**
 * The collapsed turn's line (§4.3 of the frozen design): one full-width bar
 * standing in for a completed turn's pre-answer rows.
 *
 * The operator's reference is dsh's `Took 1m 19s` line, deliberately improved
 * on in three app-native ways: the counts survive the collapse (the span and
 * the action count — the failure TALLY was retired on the operator's own call,
 * 2026-09-29: a completed run's failure count is noise at a glance, and the
 * red rows are one press away), the turn's one timestamp re-homes here from
 * the foot it suppresses (`turn-timestamp.tsx`'s contract: one stamp per
 * turn), and the gesture is the app's single disclosure idiom, so the bar
 * opens the way every tool row already taught.
 *
 * WHAT THIS COMPONENT OWNS, and what it does not. The copy, the numbers, the
 * span and the hidden/pinned partition are `turn-collapse-model.ts` (pure and
 * unit-tested). This file owns the row, the disclosure and the stamp's
 * placement. The OPEN STATE is the caller's — the
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
 * NO FAILURE TALLY (operator, 2026-09-29, issue #6). The bar carried a
 * `· N failed` control in the disclosure's `trailing` slot (UX round 1, U1).
 * The operator's call retires it — "remove summaries of failed counts both on
 * the response messages and in the collapsed headers, typically they are not
 * relevant since the action completed anyways, if a user needs to access the
 * failures they can review them by expanding" — so the clause, its jump and
 * this surface's whole failure affordance are gone; the red rows still carry
 * the state, one press away, and nothing here tallies them.
 */

import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import { CircleCheck } from "lucide-react";
import { type FC, type ReactNode, useRef } from "react";
import { foldMediaClause } from "../../canonical/trace-fold-model";
import { TurnTimestamp } from "../message-item/turn-timestamp";
import { formatDuration } from "./tool-row-model";

/**
 * The dense ledger height the fold and tool rows share (see `trace-fold.tsx`:
 * the bar moves nothing below it by more than the rows it hides).
 */
/*
 * THE TARGET-SIZE EXEMPTION, RECORDED WHERE THE SIZE IS CHOSEN (design round 2, D14).
 *
 * `dom_audit` reports the bar's disclosure at 826x20 px against WCAG 2.5.8's 24 px
 * floor, and it is right about the number. The height is the LEDGER's own dense row
 * (`tool-row.tsx`'s `ROW_HEIGHT`, the same 20 px every condensed ledger row takes),
 * so raising it here alone would move this bar off the rail the transcript is built
 * on, and raising it in the ledger moves every tool row on every turn - a far larger
 * change than the finding, on a surface the design round did not ask to revisit.
 *
 * The exemption is taken deliberately: the target is the WHOLE row (826 px wide),
 * its height is set by the text's own line box rather than by a cramped hit area,
 * and the 24 px floor exists for targets that are small in BOTH dimensions. The
 * receipts bar is neither; it is one line across the column, and the collapsed
 * state is the only way to read them.
 *
 * If the floor is wanted unconditionally, the lever is the ledger's shared row
 * height, not this bar's.
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
	 * The ids THIS bar hides (`data-segment-ids`). A run can carry several bars
	 * once its hidden span is partitioned, and `recordIds` names the whole run on
	 * each, so the reveal walk needs the bar's own set to open the right one.
	 * Optional for the fixtures and stories that draw one bar per run.
	 */
	segmentIds?: readonly string[];
	/**
	 * The FIRST hidden row's id: the bar occupies that row's slot, and carries
	 * its identity so a lookup for the row finds the bar that replaced it.
	 */
	anchorRecordId: string;
	/** The bar's margin: the first hidden row's gap tier. */
	className?: string;
	/**
	 * The span's WORKED seconds (the calls' own reported time, summed - the SAME
	 * quantity the turn's foot states as `Worked for ...`, so a ladder's bars add up
	 * to it), or null to omit the clause.
	 */
	durationS: number | null;
	/** Tool rows in the run; zero omits the clause. */
	actionCount: number;
	/**
	 * Whether `actionCount` is a MINIMUM: the run's opening row is not loaded, so
	 * the turn is known to have at least this many actions and possibly more.
	 *
	 * WHY THE MARKER EXISTS AT ALL (design round 1, D1). `7 actions` over a turn of
	 * 423 is indistinguishable from a true count — the operator's screenshot read
	 * `97 actions` and nothing on the line said otherwise — and the state is
	 * reachable whenever the head cannot be fetched (a run taller than the walk's
	 * allowance, a backend whose earlier pages are gone). The bar is the turn's only
	 * size statement, so the honest shape is the count followed by `+`, with the
	 * duration clause absent (there is no duration to state either) and the same
	 * claim in words for a pointer or a screen reader.
	 */
	partial?: boolean;
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
	/**
	 * The word ahead of the clauses for a bar that is not the ordinary
	 * work-before-the-answer one: what opened the section (`Wake`, `Peer message`,
	 * `Job result`) or that it holds the reader's own message (`Steered`); null or
	 * absent for the ordinary bar, whose copy is unchanged. The set lives in
	 * `turn-segments.ts` (`labelOfSegment`).
	 */
	label?: string | null;
	/**
	 * A section of the turn that ran to a real end: the bar carries a completion
	 * mark after its label - "that finished", the closed-disposal receipt without a
	 * card - and `success` ink because the checkpoint rail already paints `complete`
	 * in the same role. Set on every labelled bar that settled and was not cut off
	 * by a stop marker, on either side of the answer (`segmentIsCompleted`).
	 */
	completed?: boolean;
	/**
	 * The quiet group's clauses, when this bar is one (design §5, rev 2): the
	 * count of delivery receipts and their span, printed INSTEAD of `Took`/`N
	 * actions` - a group counts receipts, not work, and its expansion lists the
	 * work. `spanS` null states no duration (a head-cut group; the count then
	 * carries the minimum marker on the shared `partial` fact). The family word
	 * arrives through `label` - this prop is the arithmetic only.
	 */
	group?: { count: number; spanS: number | null } | null;
	/** Controlled open state — the transcript owns the reader's expansion. */
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The hidden rows' groups, mounted only while open (the fold's contract). */
	children: ReactNode;
	/**
	 * The hidden span's pictures, drawn under the bar while it is collapsed.
	 *
	 * The rows inside a collapsed bar are unmounted (`Disclosure` renders
	 * `isOpen && children`), so a picture a call produced went with them: the
	 * reader had to expand the bar to see the artifact, which is the cost
	 * condensing exists to remove - `TraceFold`'s `condensedMedia` states the
	 * same rule one fold down. The caller composes the node
	 * (`canonical-transcript.tsx` builds a `FoldMedia` from the hidden rows'
	 * images), because the transcript is what knows a record's images; the fold
	 * hands it THIS bar's own toggle so the strip's `+N` slot (named and titled
	 * `N more images`) can open the fold rather than be a dead end (UX round 1,
	 * U1).
	 *
	 * Render it ONLY while collapsed: open, every row draws its own media
	 * (`TranscriptRow`'s `media`) and a strip here as well would put one
	 * picture on screen twice.
	 */
	condensedMedia?: (expand: () => void) => ReactNode;
	/**
	 * How many pictures `condensedMedia` stands for, for the summary's own
	 * clause. A number beside the node rather than something read out of it,
	 * because the node is opaque here (the caller builds it) and because the
	 * count is the part a 64px tile cannot carry - the same reason and the
	 * same mechanism as `TraceFold`'s `mediaCount`. Zero or absent adds no
	 * clause at all, which is what keeps a run with no pictures byte-identical.
	 */
	mediaCount?: number;
};

/** The `·` the line joins its facts with — a flex child, never nested text. */
const Dot: FC = () => (
	<span aria-hidden={true} className={cn("text-ink-dim text-meta")}>
		·
	</span>
);

export const TurnSummary: FC<TurnSummaryProps> = ({
	recordIds,
	segmentIds,
	anchorRecordId,
	className,
	durationS,
	actionCount,
	partial = false,
	title,
	stampTs,
	label = null,
	completed = false,
	open,
	onOpenChange,
	children,
	condensedMedia,
	mediaCount = 0,
	group = null,
}) => {
	/*
	 * The count clause and the sentence behind it, derived once: the visible words
	 * carry the marker the model's `partial` fact asks for, and the title/name say
	 * the same thing in full. Kept beside each other so the two cannot drift into
	 * claiming different things about the same number.
	 */
	const actionClause = partial
		? `${actionCount}+ actions`
		: actionCount === 1
			? "1 action"
			: `${actionCount} actions`;
	const actionClauseTitle = `At least ${
		actionCount === 1 ? "1 action" : `${actionCount} actions`
	} — earlier rows of this turn are not loaded`;
	/*
	 * The group count's own words for hover and AT: the visible line carries a
	 * bare number (the copy is `Peer messages · 12 · 2h 14m`), so the "at least"
	 * claim a head-cut group makes lives here, stated the way the action clause
	 * states its own - never a second reading of the same number.
	 */
	const groupClauseTitle =
		group === null
			? null
			: `At least ${group.count} messages — earlier rows are not loaded`;

	/*
	 * The bar's root, held so the strip's `+N` press can hand focus to the bar's
	 * own trigger (UX round 1, U2) - see `TraceFold`'s `revealFromStrip`, the same
	 * rule for the same reason: the press unmounts the control that held focus, and
	 * a removed node leaves it on `<body>`.
	 */
	const rootRef = useRef<HTMLDivElement>(null);
	const revealFromStrip = () => {
		rootRef.current
			?.querySelector<HTMLElement>("button[aria-expanded]")
			?.focus();
		onOpenChange(true);
	};

	return (
		<div
			ref={rootRef}
			/*
			 * The "there is more below" rule (design spec D1, operator feedback
			 * 2026-09-28, after dsh's bottom rule): a hairline under the bar says the
			 * block continues into hidden rows, where a bare row read as everything
			 * having disappeared. It is the app-wide separator idiom (`border-hairline`,
			 * no new ink), spans the block's content box with no inset, and sits at the
			 * block's own bottom so it mounts and moves with the collapse — decorative,
			 * never a hover surface, no animation, and none of the bar's numbers, stamp
			 * or chevron change.
			 *
			 * THE RULE'S TWO SIDES ARE A DELIBERATE PAIR (operator report, 2026-09-29,
			 * second round: "needs proper breathing room on both sides, not just the
			 * row's internal padding"). `pb-3` is the bar block's own 12px of air below
			 * its row — the SAME step the row below it sits at, so the rule divides 12px
			 * of box either side. The ink air, measured on the rendered frames in the
			 * pair's stated convention (INK-EDGE TO RULE-EDGE, text register: the bar
			 * text's ink bottom to the rule's first pixel above; the rule's last pixel to
			 * the row's cap/ascender ink top below), reads 17px above against 15px below
			 * at this size in both palettes — inside the 2-3px spread the three readings
			 * of this geometry produced (design's icon register 14-17, QA's text-register
			 * 19, this pair's 15). The round first shipped 16px, which read 21 above
			 * against 15 below and was the imbalance design r2 flagged; 12px is the
			 * balanced value. Before the round the above side was 5px, all of it the
			 * label's line-box leading. The below side is the walk's re-tier: every
			 * visible group after a bar takes the item step (`canonical-transcript.tsx`).
			 * A pair whose two halves are the same step is the one this file can
			 * defend: box 12/12, ink 17/15.
			 */
			className={cn("border-b border-hairline pb-3", className)}
			data-turn-summary=""
			data-run-ids={recordIds.join(" ")}
			data-segment-ids={segmentIds?.join(" ")}
			data-segment-complete={completed ? "true" : undefined}
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
				triggerClassName={cn(
					/*
					 * THE HOVER GROUND COVERS THE CHEVRON'S BOX (design round 1 D1, then the
					 * second round's D2/MINOR-1). The `-mx-2` ground paints the trigger's
					 * border box: D1 extended it 8px to the rule's end, and the leading-edge
					 * datum then pushed the slot 8px further right, leaving the glyph's
					 * trailing 2-4px on unwashed ground — the same class D1 named. The width
					 * and the right padding move as a PAIR again (+0.5rem each, to `pr-6`),
					 * so the border box grows to the slot's own right edge: the ground is
					 * flush with the glyph's layout box and the rule's end sits 8px inside
					 * it, while the CONTENT box — which the summary, the stamp and the
					 * slot's pull are laid out from — stays exactly where it was; either
					 * half alone would move the chevron 8px.
					 */
					"-ml-2 -mr-2 w-[calc(100%+1rem)] rounded-sm pl-2 pr-6",
					"hover:bg-row-hover",
				)}
				/*
				 * THE CHEVRON'S LEADING EDGE IS THE RULE'S ENDPOINT (operator report,
				 * 2026-09-29, second round: "the chevron's leading edge must align with
				 * the end of the line — treat the rule's endpoint as the alignment datum,
				 * and the time reads to its left"). Round 1 landed the glyph's TRAILING
				 * edge on the rule's end; the datum moved to the leading edge. The
				 * trigger is `w-full` inside the `-mx-2 px-2` box, which bleeds on the
				 * left only and ends 16px short of the row on the right - the
				 * disclosure's documented geometry, the one the tool stamps' `mr-4`
				 * insets line up with - so the slot's pull is measured from there:
				 * `-mr-6` (24px) puts the slot's box right at the rule's end + 8px, and
				 * the glyph's ink starts 9.33px inside the slot's right edge (the lucide
				 * path's bbox at this size), landing the visible leading edge on the
				 * rule's last pixel (1043.7 against 1044 at the 1280 column) — within a
				 * third of a pixel of the terminus. The summary span and the stamp ride
				 * with the slot, so the stamp keeps the row's own `gap-1.5` from the
				 * chevron and still reads to its left.
				 */
				chevronClassName={cn("-mr-6", "text-ink-muted")}
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
						{label !== null && (
							/*
							 * The bar's KIND, ahead of its facts, in the facts' own ink: no
							 * new ground, no icon of its own, no second edge. It exists so
							 * that several bars in one turn read as sections of it (the
							 * follow-up after a disposal says so) instead of as separate
							 * turns.
							 */
							<span
								className={cn("shrink-0 text-body-sm text-ink-muted")}
								data-segment-label=""
							>
								{label}
							</span>
						)}
						{completed && (
							<>
								{/*
								 * THE COMPLETION MARK. `success` on `canvas` is asserted by the
								 * contrast contract's GRAPHICS table (the same pair the checkpoint
								 * rail paints for `complete`). The glyph itself is decoration, so
								 * it is hidden from AT - and the FACT it states is carried by the
								 * word below, because an aria-hidden mark with no name is a state
								 * a screen-reader user cannot learn at all (QA round 2, QA-1).
								 */}
								<CircleCheck
									aria-hidden={true}
									className={cn("size-3.5 shrink-0 text-success")}
								/>
							</>
						)}
						{/*
						 * A GROUP BAR SPEAKS IN RECEIPTS (design §5): count then receipt span,
						 * instead of `Took`/`N actions` - the work inside the group is what the
						 * expansion lists, and the span is RECEIPT time, so it prints bare (no
						 * `Took`, which would claim the bar counts work). A head-cut group
						 * states `N+` and no duration, per the end-loaded rule.
						 */}
						{group !== null ? (
							<>
								{label !== null && <Dot />}
								<span
									className={cn("shrink-0 text-body-sm text-ink-muted")}
									title={partial ? (groupClauseTitle ?? undefined) : undefined}
									aria-label={
										partial ? (groupClauseTitle ?? undefined) : undefined
									}
								>
									{partial ? `${group.count}+` : `${group.count}`}
								</span>
								{group.spanS !== null && (
									<>
										<Dot />
										<span
											className={cn("shrink-0 text-body-sm text-ink-muted")}
										>
											{formatDuration(group.spanS)}
										</span>
									</>
								)}
							</>
						) : (
							<>
								{label !== null && (durationS !== null || actionCount > 0) && (
									<Dot />
								)}
								{durationS !== null && (
									<span className={cn("shrink-0 text-body-sm text-ink-muted")}>
										Took {formatDuration(durationS)}
									</span>
								)}
								{durationS !== null && actionCount > 0 && <Dot />}
								{actionCount > 0 && (
									<span
										className={cn("shrink-0 text-body-sm text-ink-muted")}
										/*
										 * The words carry the marker for AT: `307+ actions` reads as a
										 * range only if the `+` is announced, and a `title` gives the
										 * sighted reader the same sentence on hover. Both are the same
										 * claim the visible glyph makes - a minimum, not a total.
										 */
										title={partial ? actionClauseTitle : undefined}
										aria-label={partial ? actionClauseTitle : undefined}
									>
										{actionClause}
									</span>
								)}
							</>
						)}
						{/*
						 * How many pictures the span produced, as the count the strip cannot
						 * carry at 64px. The strip's accessible name already states it, so
						 * leaving the visible line silent would give a sighted reader strictly
						 * less than a screen-reader user - the inversion design round 1 found
						 * on the condensed group (D3). It costs no height (it joins the facts
						 * the row already prints), and a run with no pictures adds no clause.
						 */}
						{foldMediaClause(mediaCount) !== null && (
							<>
								<Dot />
								<span className={cn("shrink-0 text-body-sm text-ink-muted")}>
									{foldMediaClause(mediaCount)}
								</span>
							</>
						)}
						{completed && (
							/*
							 * The mark's meaning as WORDS, off-screen, and LAST in the row
							 * (QA round 3, QA-3 + agent review R3-2). The trigger has no
							 * `aria-label`, so its accessible name is its content read in document
							 * order with the `aria-hidden` subtrees (the dots, the glyph) dropped,
							 * which is why the position here is the name: `Wake Took 1s 1 action
							 * completed` - one clause after the facts, not a word wedged between
							 * the label and its count. It trails the facts for the unlabelled case
							 * too, where leading with the word read `completed Took 9s 8 actions`
							 * off the AX tree. A second live region would say the same fact twice,
							 * in a surface that already has one voice for the list.
							 */
							<span className={cn("sr-only")}>completed</span>
						)}
						{stampTs !== null && (
							/*
							 * THE TURN'S ONE STAMP, re-homed from the foot this bar suppresses
							 * (`answer` scope because the instant is the closing answer's — the same
							 * fact the foot stated, moved one row up). Its box sits ahead of the
							 * trailing chevron, so the row's rightmost ink is the chevron — which groups with the ledger's
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
			{/*
			 * The hidden span's pictures, while the rows that would draw them are
			 * unmounted.
			 *
			 * OUTSIDE the disclosure and below it, so the bar keeps its own pitch and
			 * the strip is what the reader gains rather than something the bar's line
			 * has to trade against; the block's rule still closes the whole block.
			 * Only while condensed: open, every row draws its own media and rendering
			 * both would show one picture twice.
			 *
			 * The 8px of bottom padding is what the strip's own top gap measures: with
			 * the tiles sitting straight on the block's rule (1px), they read as
			 * standing ON the line rather than inside the bar whose pictures they are
			 * (design round 1, D1 - the same strip in the expanded state clears the
			 * rule by 5-6px, so the rule follows the strip here rather than the old
			 * bar height). A run with no pictures passes no node, so this wrapper
			 * does not exist for it and the no-picture bar stays byte-identical.
			 */}
			{!open && condensedMedia && (
				<div className={cn("pb-2")}>{condensedMedia(revealFromStrip)}</div>
			)}
		</div>
	);
};
