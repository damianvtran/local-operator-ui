/**
 * The always-visible stamp: when this turn was sent, when an answer was written,
 * or when this tool call ran.
 *
 * BESIDE `message-timestamp.tsx`, not a variant of it, because the two answer
 * different questions and are seen at different moments. That one is the hover
 * meta row's stamp: it appears among copy and speak, only while the reader is
 * hovering the row, and it is formatted for someone already looking at the
 * message. This one is on screen for every user turn, under every settled agent
 * answer and inside every expanded tool call, so it has to name the day itself
 * (`formatTurnTimestamp`) rather than a bare clock time.
 *
 * THIS REVERSES A DELIBERATE DECISION, and the record of the old one is in that
 * file's header, so the reason it was reversed belongs here. The hover-only
 * model removed a stamp printed under EVERY row of the legacy list, where a
 * nine-row conversation carried the same date nine times. What the operator
 * asked for back is narrower than what was removed: ONE stamp per user turn,
 * under the bubble, plus one inside a tool call the reader has chosen to open.
 * A user turn is one block on the page and it is the reader's own words, so a
 * single stamp under it is the anchor the hover model was missing — and the
 * collapsed ledger rows keep the quiet they were given, because their stamp
 * lives inside the disclosure and a run of twenty calls therefore stays twenty
 * lines. The agent's answer was added to that list a report later (the operator,
 * 2026-09-17: "the agent responses (just the final responses, not the in-progress
 * tool intent/response) don't have a time displayed on them"), which is why the
 * in-progress half of that sentence is a rule here rather than a detail.
 * *
 * IT SITS IN EXACTLY TWO PLACES, and the operator's report of 2026-09-17 is why
 * that is two rather than three. `scope="turn"` under a user turn's bubble: one
 * per turn, the anchor the hover model was missing. `scope="turn"` at the foot
 * of an OPEN tool disclosure: the collapsed ledger keeps the quiet it was given,
 * so a run of twenty calls stays twenty lines.
 *
 * THE FOOTER LINE IS GONE, and it was a THIRD PLACE only in the sense that it
 * was the third one this component owned. It stated when the last thing in the
 * conversation happened, gated so it stayed away when the last row painted a
 * stamp of its own (a user turn, or a ledger row the reader had opened). The
 * transcript is bottom-pinned and the aggregate working line sits at its foot, so
 * during a live turn that stamp landed directly under the thinking indicator — a
 * clock beneath a liveness row, which is the state the operator screenshotted.
 * The line was
 * removed rather than gated because every gate it had asked WHICH row came last,
 * and the row that comes last during a turn is the working line: not a record,
 * and not something the gate could name. The trade is deliberate and worth
 * stating: a transcript ending on assistant prose, or on a settled tool row
 * nobody opened, now shows no time at its foot. Both ends on a row whose own
 * affordance is a disclosure, and an always-present clock at the foot was the
 * thing the operator asked to remove.
 *
 * GEOMETRY, because the frame is the whole of what a stamp is: it is a sibling
 * of the bubble in a column (`UserRow`), so it sits under the bubble and shares
 * the bubble's own right edge. THAT EDGE IS ALSO THE ROW CONTENT BOX'S, and
 * saying otherwise would be false: a user row is `flex w-full justify-end` with
 * no right inset (`message-container.tsx`), so the bubble is justified to the
 * row's right edge and the two are the same line — measured at 0.0px delta on
 * every width in the review round (`columnRight - bubbleRight`, 420/1024/1440).
 * What `docs/branding.md` § 7 actually distinguishes on a user row is the
 * bubble's LEFT inset, which is what makes a turn read as an aside; the stamp
 * follows the bubble because it is a caption to it, not because the two right
 * edges differ (review round 1, R2/D3).
 *
 * ONE RIGHT EDGE PER LEDGER ROW, and that one is the row's own meta column. An
 * open tool row's stamp is inset 16px (`mr-4` where the transcript composes it)
 * so it lines up with the header's duration slot, because the disclosure's
 * trigger is `w-full` inside a box carrying `-mx-2 px-2` (`trace/tool-row.tsx`),
 * which bleeds on the left only and so ends 16px short of the row on the right
 * (design round 1, D2). Without the inset the same row carried two right edges
 * one line apart.
 *
 * THE AIR IS 4px UNDER A BUBBLE AND 8px UNDER A DISCLOSURE, and that is the two
 * idioms rather than drift: `UserRow`'s column is `gap-1` because a stamp is a
 * caption to the bubble above it, while the disclosure content's own `gap-2`
 * (`shared/components/ui/disclosure.tsx`) puts the same 8px under an expanded
 * pane as between any two of its blocks, and a stamp that took a margin of its
 * own would be a second spacing rule beside the shared one (design round 1, D6).
 *
 * A real `<time>` with a machine-readable `dateTime`, because the text is a
 * friendly spelling of a fact the DOM should still be able to answer for a
 * screen reader, a test, or anything that reads the transcript semantically.
 * THE VISIBLE TEXT IS NOT WHAT A SCREEN READER READS: `aria-label` carries the
 * same full instant the tooltip does, because "3:42 PM" alone loses the day for
 * a reader who cannot see which card it sits under (review round 1, R7). The
 * tooltip is POINTER-ONLY, though - the shared `Tooltip`'s trigger takes no
 * `tabIndex`, so it cannot be reached from the keyboard - which is why the
 * `aria-label` above is the accessible path rather than a second way to the same
 * panel (design round 2, D2-4). The
 * full date and time come from `formatCalendarDateTime` with `hour12` forced,
 * so the tooltip and the label agree with the 12-hour text the operator asked
 * for rather than taking the locale's own clock — on a 24-hour machine the two
 * halves of one element used to state the same instant in two conventions
 * (review round 1, R3).
 */

import { Tooltip } from "@shared/components/ui";
import { useStampNow } from "@shared/hooks/use-calendar-day";
import { cn } from "@shared/lib/utils";
import {
	formatCalendarDateTime,
	formatTurnTimestamp,
} from "@shared/utils/date-utils";
import type { FC } from "react";

export type TurnTimestampProps = {
	/** The moment itself: epoch ms from a record, or a `Date`. */
	timestamp: number | Date;
	/**
	 * WHICH carrier paints this stamp, in the DOM as `data-stamp`.
	 *
	 * Three placements, three names, because they are different facts on the page
	 * and the render tests have to count each one separately: a user turn's `turn`
	 * (under its bubble), an agent answer's `answer` (under it, against the rail),
	 * and a tool call's `tool` (at the foot of the disclosure the reader opened).
	 * The union used to carry `"footer"` for the transcript's removed footer line,
	 * and it used to make the tool call borrow `"turn"`, which meant two different
	 * carriers shared one value.
	 *
	 * It also picks the accessible name below, which is the reason it is a value
	 * rather than a boolean: "Sent" is true of a user's message and false of an
	 * answer the agent wrote.
	 *
	 * Required rather than defaulted, so a fourth carrier states itself rather
	 * than inheriting whichever value happened to be the default.
	 */
	scope: "turn" | "answer" | "tool";
	className?: string;
};

/**
 * The verb each carrier's accessible name is built from.
 *
 * A stamp's visible text is a bare time, so the NAME is the only place the fact
 * it states is spelled out - and it has to be the right fact. `Sent` was
 * hardcoded while every stamp was a turn's own; it is false on an answer the
 * agent wrote and on a call that ran, which is what the three variants fix.
 */
const STAMP_VERB: Record<TurnTimestampProps["scope"], string> = {
	turn: "Sent",
	answer: "Answered",
	tool: "Ran",
};

export const TurnTimestamp: FC<TurnTimestampProps> = ({
	timestamp,
	scope,
	className,
}) => {
	const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
	/*
	 * ONE `now` FOR THE WHOLE TRANSCRIPT, recomputed at local midnight rather
	 * than read here. Reading `new Date()` at render is what let a window left
	 * open overnight keep calling yesterday's turn "today" (review round 1, R5);
	 * `use-calendar-day` owns the single timer and hands back a value that is
	 * stable between midnights, so a memoised row is not re-rendered for it.
	 */
	const now = useStampNow();
	/*
	 * A stamp that cannot be computed paints nothing rather than `Invalid Date`
	 * or an empty `<time>`: a record with an unparseable `ts` is a row with no
	 * time to state, and a placeholder would be a claim about when it happened.
	 * `dateTime` is what forces the guard — `toISOString()` throws on an invalid
	 * date, and a throw here would take the whole transcript down over one bad
	 * row.
	 */
	if (Number.isNaN(date.getTime())) return null;

	/*
	 * The same string for the tooltip and for the accessible name, built once:
	 * they answer the same question (what instant is this, spelled out) and the
	 * tooltip is the app's shared idiom here rather than a native `title`
	 * (design round 1, D5). `hour12` is forced because the visible text is
	 * 12-hour by the operator's request, and a title in the locale's own cycle
	 * disagreed with it on a 24-hour machine (review round 1, R3).
	 */
	const full = formatCalendarDateTime(date, { hour12: true });
	return (
		<Tooltip content={full} side="bottom" delayDuration={1200}>
			<time
				dateTime={date.toISOString()}
				data-stamp={scope}
				/*
				 * The label rather than the text is what assistive tech reads: the
				 * visible "3:42 PM" is a caption under a card, and out of that
				 * context it states no day at all (review round 1, R7). The verb comes
				 * from `scope`, so the name is truthful per carrier - a turn was sent,
				 * an answer was written, a call ran.
				 */
				aria-label={`${STAMP_VERB[scope]} ${full}`}
				/*
				 * `text-ink-dim` + `text-meta` is the contract's own pair for a
				 * caption (§ 4: `text-meta` is "captions, timestamps, counts"; § 2:
				 * `ink-dim` is the caption ink, 4.5:1 on every ground). `select-none`
				 * because a stamp is not part of the turn's words: a selection drag
				 * that sweeps it must not put a time into a quote. `cursor-help`
				 * matches the hover row's stamp, so one gesture in this app means one
				 * thing.
				 */
				className={cn(
					"shrink-0 cursor-help select-none whitespace-nowrap text-ink-dim text-meta",
					className,
				)}
			>
				{formatTurnTimestamp(date, now)}
			</time>
		</Tooltip>
	);
};
