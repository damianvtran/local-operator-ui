/**
 * Container component for message items.
 * Handles the layout direction based on whether the message is from the user
 * or assistant. Assistant messages get the wider gap so the content clears
 * the avatar column.
 */

import { cn } from "@shared/lib/utils";
import type { FC, ReactNode } from "react";

/**
 * Props for the MessageContainer component
 */
export type MessageContainerProps = {
	isUser: boolean;
	children: ReactNode;
	isSmallView?: boolean;
	compact?: boolean;
};

export const MessageContainer: FC<MessageContainerProps> = ({
	isUser,
	children,
	isSmallView,
	compact,
}) => {
	return (
		<div
			className={cn(
				"flex items-start",
				isUser ? "flex-row-reverse" : "flex-row",
				compact
					? isSmallView
						? "mb-1.5 gap-1.5"
						: "mb-2 gap-2.5"
					: isSmallView
						? "mb-2 gap-2"
						: "mb-3 gap-4",
			)}
		>
			{children}
		</div>
	);
};
