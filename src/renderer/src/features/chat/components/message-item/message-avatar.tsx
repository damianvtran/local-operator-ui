import { faRobot, faUser } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Avatar } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
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
 */
export const MessageAvatar: FC<MessageAvatarProps> = ({ isUser }) => {
	return (
		<StyledAvatar isUser={isUser}>
			<FontAwesomeIcon icon={isUser ? faUser : faRobot} size="sm" />
		</StyledAvatar>
	);
};
