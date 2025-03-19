import { faRobot, faUser } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Avatar } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import type { MessageAvatarProps } from "./types";

/**
 * Styled avatar component for user or assistant messages
 * Changes appearance based on whether the message is from the user or assistant
 */
const StyledAvatar = styled(Avatar, {
	shouldForwardProp: (prop) => prop !== "isUser",
})<{ isUser: boolean }>(({ isUser, theme }) => ({
	backgroundColor: isUser
		? "rgba(66, 133, 244, 0.9)"
		: "rgba(56, 201, 106, 0.2)",
	color: isUser ? "white" : theme.palette.primary.main,
	boxShadow: isUser ? "0 2px 8px rgba(66, 133, 244, 0.25)" : "none",
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
