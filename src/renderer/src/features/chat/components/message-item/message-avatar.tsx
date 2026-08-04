/**
 * Avatar component for message items.
 *
 * User messages use the accent triple (the same measured combination as the
 * accent badge); the assistant avatar is quiet sunken ground. `rounded-full`
 * here is one of the three places the radius ramp permits it.
 */

import { cn } from "@shared/lib/utils";
import { Bot, User } from "lucide-react";
import type { FC } from "react";

/**
 * Props for the MessageAvatar component
 */
export type MessageAvatarProps = {
	isUser: boolean;
	compact?: boolean;
};

export const MessageAvatar: FC<MessageAvatarProps> = ({ isUser, compact }) => {
	return (
		<div
			className={cn(
				"flex shrink-0 items-center justify-center rounded-full",
				compact ? "size-[34px]" : "size-10",
				isUser
					? "border border-accent bg-accent-wash text-accent"
					: "bg-sunken text-ink-muted",
			)}
		>
			{isUser ? (
				<User size={compact ? 18 : 22} aria-label="User" />
			) : (
				<Bot size={compact ? 18 : 22} aria-label="Assistant" />
			)}
		</div>
	);
};
