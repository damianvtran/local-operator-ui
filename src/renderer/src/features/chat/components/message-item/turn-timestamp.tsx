/**
 * The always-visible stamp: when this turn was sent, or when this tool call ran.
 *
 * BESIDE `message-timestamp.tsx`, not a variant of it, because the two answer
 * different questions and are seen at different moments. That one is the hover
 * meta row's stamp: it appears among copy and speak, only while the reader is
 * hovering the row, and it is formatted for someone already looking at the
 * message. This one is on screen for every user turn and inside every expanded
 * tool call, so it has to name the day itself (`formatTurnTimestamp`) rather
 * than a bare clock time.
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
 * lines.
 *
 * GEOMETRY, because the frame is the whole of what a stamp is: it is a
 * sibling of the bubble in a column (`UserRow`), so it sits under the bubble
 * and shares the bubble's own right edge rather than the row content box's —
 * the bubble's narrower box is what makes a user turn read as an aside
 * (docs/branding.md § 7), and a stamp on the shared edge would hang in space to
 * the right of the thing it belongs to.
 *
 * A real `<time>` with a machine-readable `dateTime`, because the text is a
 * friendly spelling of a fact the DOM should still be able to answer for a
 * screen reader, a test, or anything that reads the transcript semantically.
 * The `title` carries `formatCalendarDateTime`'s full date and time, which is
 * where the year, the full month name and the seconds-free clock come from when
 * the stamp's own four-word shape has had to abbreviate.
 */

import { cn } from "@shared/lib/utils";
import {
	formatCalendarDateTime,
	formatTurnTimestamp,
} from "@shared/utils/date-utils";
import type { FC } from "react";

export type TurnTimestampProps = {
	/** The moment itself: epoch ms from a record, or a `Date`. */
	timestamp: number | Date;
	className?: string;
};

export const TurnTimestamp: FC<TurnTimestampProps> = ({
	timestamp,
	className,
}) => {
	const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
	/*
	 * A stamp that cannot be computed paints nothing rather than `Invalid Date`
	 * or an empty `<time>`: a record with an unparseable `ts` is a row with no
	 * time to state, and a placeholder would be a claim about when it happened.
	 * `dateTime` is what forces the guard — `toISOString()` throws on an invalid
	 * date, and a throw here would take the whole transcript down over one bad
	 * row.
	 */
	if (Number.isNaN(date.getTime())) return null;

	return (
		<time
			dateTime={date.toISOString()}
			title={formatCalendarDateTime(date)}
			/*
			 * `text-ink-dim` + `text-meta` is the contract's own pair for a
			 * caption (§ 4: `text-meta` is "captions, timestamps, counts"; § 2:
			 * `ink-dim` is the caption ink, 4.5:1 on every ground). `select-none`
			 * because a stamp is not part of the turn's words: a selection drag
			 * that sweeps it must not put a time into a quote.
			 */
			className={cn(
				"shrink-0 select-none whitespace-nowrap text-ink-dim text-meta",
				className,
			)}
		>
			{formatTurnTimestamp(date)}
		</time>
	);
};
