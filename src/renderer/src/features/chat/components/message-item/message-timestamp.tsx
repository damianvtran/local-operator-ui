/**
 * The hover stamp: the exact time of one message, inside the meta row.
 *
 * It used to print under every single turn and was moved here, so a nine-row
 * conversation stopped carrying nine copies of "2026-03-14" — the same fact,
 * nine times, in the position the eye lands on after finishing a paragraph.
 * That is Slack's model: one visible stamp per block, the rest on hover, the
 * full date in the tooltip.
 *
 * WHAT CHANGED SINCE, and why this paragraph is not the whole story any more.
 * The operator asked for the time back on screen: one stamp per user turn,
 * under the bubble, and one inside a tool call the reader has opened. That
 * arrived as a SECOND component (`turn-timestamp.tsx`) rather than as a change
 * here, because this one is formatted for a reader who is already looking at
 * the message (a bare clock time today, a bare weekday inside the week), and
 * an always-visible stamp has to name the day it belongs to. So the hover model
 * and the on-screen model are now two components with two formats; the quiet
 * that this comment was written to protect survives on the collapsed ledger
 * rows, which still carry no stamp until one is opened.
 *
 * WHAT IS LEFT HERE is the hover meta row alone (`message-item/index.tsx` and
 * `message-controls.tsx`), which is the reader's own controls. The transcript's
 * footer line USED to be a third call site and no longer exists at all: it moved
 * to `TurnTimestamp` because it states the same fact a turn's stamp states, and
 * two spellings of one clock in one column is the defect class `date-utils.ts`
 * documents (the frames showed it as `2025-10-09` under `Oct 9, 2025, 4:53 AM`).
 * The operator then had that line REMOVED rather than gated, because the
 * transcript is bottom-pinned and the stamp landed under the working line
 * during a live turn — `turn-timestamp.tsx`'s header carries that report.
 */

import { Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	formatCalendarDateTime,
	formatMessageDateTime,
} from "@shared/utils/date-utils";
import type { FC } from "react";

export type MessageTimestampProps = {
	timestamp: Date;
	className?: string;
};

export const MessageTimestamp: FC<MessageTimestampProps> = ({
	timestamp,
	className,
}) => (
	<Tooltip
		content={formatCalendarDateTime(timestamp)}
		side="bottom"
		delayDuration={1200}
	>
		<span
			className={cn(
				"shrink-0 cursor-help whitespace-nowrap text-ink-dim text-meta",
				className,
			)}
		>
			{formatMessageDateTime(timestamp)}
		</span>
	</Tooltip>
);
