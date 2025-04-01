import { Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import type { MessageTimestampProps } from "./types";

/**
 * Styled component for message timestamps
 * Positioned differently based on whether the message is from the user or assistant
 * For assistant messages, width is set to match the content width (100% - 52px for avatar space)
 */
const StyledTimestamp = styled(Typography, {
	shouldForwardProp: (prop) => prop !== "isUser",
})<{ isUser: boolean }>(({ isUser, theme }) => ({
	display: "block",
	marginTop: 8,
	textAlign: isUser ? "left" : "right",
	color: theme.palette.text.secondary,
	fontSize: "0.7rem",
	width: isUser ? "auto" : "calc(100% - 52px)",
}));

/**
 * Component for displaying message timestamps
 * Shows the time the message was sent
 */
export const MessageTimestamp: FC<MessageTimestampProps> = ({
	timestamp,
	isUser,
}) => {
	// Format the timestamp to show only hours and minutes
	const formattedTime = timestamp.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});

	return (
		<StyledTimestamp variant="caption" isUser={isUser}>
			{formattedTime}
		</StyledTimestamp>
	);
};
