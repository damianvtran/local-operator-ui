/**
 * Component for displaying message timestamps.
 * Shows a smart formatted time based on when the message was sent, with the
 * full date and time behind a tooltip on hover.
 *
 * The `sx` prop became `className` in the Tailwind port; the two former
 * behaviours it carried (opacity hiding while streaming) are now expressed
 * with `invisible` from the call site.
 */

import { Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	formatMessageDateTime,
	getFullDateTime,
} from "@shared/utils/date-utils";
import type { FC } from "react";

/**
 * Props for the MessageTimestamp component
 */
export type MessageTimestampProps = {
	timestamp: Date;
	isUser: boolean;
	isSmallView?: boolean;
	className?: string;
	inline?: boolean;
};

export const MessageTimestamp: FC<MessageTimestampProps> = ({
	timestamp,
	isUser,
	className,
	isSmallView,
	inline = false,
}) => {
	const formattedTime = formatMessageDateTime(timestamp);
	const fullDateTime = getFullDateTime(timestamp);

	return (
		<Tooltip content={fullDateTime} side="bottom" delayDuration={1200}>
			<span
				className={cn(
					"block cursor-help text-ink-dim text-meta",
					!inline && "mt-2",
					isUser ? "text-left" : "text-right",
					// Assistant timestamps span the content column, which is the full
					// width minus the avatar column (40px avatar + 12px gap).
					!inline &&
						!isUser &&
						(isSmallView ? "w-full" : "w-[calc(100%-52px)]"),
					className,
				)}
			>
				{formattedTime}
			</span>
		</Tooltip>
	);
};
