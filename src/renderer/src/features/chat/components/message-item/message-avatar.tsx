import { Avatar } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import { User, Bot } from "lucide-react";

/**
 * Props for the MessageAvatar component
 */
export type MessageAvatarProps = {
	isUser: boolean;
};

/**
 * Styled avatar component for user or assistant messages
 * Changes appearance based on whether the message is from the user or assistant
 */
const StyledAvatar = styled(Avatar, {
	shouldForwardProp: (prop) => prop !== "isUser",
})<{ isUser: boolean }>(({ isUser, theme }) => ({
	backgroundColor: isUser
		? theme.palette.userMessage.background
		: theme.palette.icon.background,
	color: isUser ? "white" : theme.palette.icon.text,
	boxShadow: isUser ? theme.palette.userMessage.shadow : "none",
	border: isUser ? `1px solid ${theme.palette.userMessage.border}` : "none",
}));

/**
 * Avatar component for message items
 * Displays different icons for user and assistant messages
 *
 * @param isUser - Whether the message is from the user
 * @returns The avatar component with the appropriate icon
 */
export const MessageAvatar: FC<MessageAvatarProps> = ({ isUser }) => {
	return (
		<StyledAvatar isUser={isUser}>
			{isUser ? (
				<User size={22} aria-label="User" />
			) : (
				<Bot size={22} aria-label="Assistant" />
			)}
		</StyledAvatar>
	);
};
