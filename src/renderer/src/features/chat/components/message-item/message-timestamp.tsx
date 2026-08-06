/**
 * The exact time of one message.
 *
 * It used to print under every single turn, so a nine-row conversation carried
 * nine copies of "2026-03-14" — the same fact, nine times, in the position the
 * eye lands on after finishing a paragraph. Ambient time is now carried by the
 * dividers the message list inserts on a day change or a long pause, and this
 * component appears only inside the hover meta row, next to copy and speak.
 * That is Slack's model: one visible stamp per block, the rest on hover, the
 * full date in the title.
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
