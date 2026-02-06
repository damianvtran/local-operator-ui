import { Avatar } from "@mui/material";
import { styled } from "@mui/material/styles";
import { Bot, User } from "lucide-react";
import type { FC } from "react";

/**
 * Props for the MessageAvatar component
 */
export type MessageAvatarProps = {
	isUser: boolean;
	compact?: boolean;
};

/**
 * Styled avatar component for user or assistant messages
 * Changes appearance based on whether the message is from the user or assistant
 */
const StyledAvatar = styled(Avatar, {
	shouldForwardProp: (prop) => prop !== "isUser" && prop !== "compact",
})<{ isUser: boolean; compact?: boolean }>(({ isUser, compact, theme }) => ({
	backgroundColor: isUser
		? theme.palette.userMessage.background
		: theme.palette.icon.background,
	color: isUser ? "white" : theme.palette.icon.text,
	boxShadow: isUser ? theme.palette.userMessage.shadow : "none",
	border: isUser ? `1px solid ${theme.palette.userMessage.border}` : "none",
	width: compact ? 34 : 40,
	height: compact ? 34 : 40,
}));

/**
 * Avatar component for message items
 * Displays different icons for user and assistant messages
 *
 * @param isUser - Whether the message is from the user
 * @returns The avatar component with the appropriate icon
 */
export const MessageAvatar: FC<MessageAvatarProps> = ({ isUser, compact }) => {
	const iconSize = compact ? 18 : 22;

	return (
		<StyledAvatar isUser={isUser} compact={compact}>
			{isUser ? (
				<User size={iconSize} aria-label="User" />
			) : (
				<Bot size={iconSize} aria-label="Assistant" />
			)}
		</StyledAvatar>
	);
};
