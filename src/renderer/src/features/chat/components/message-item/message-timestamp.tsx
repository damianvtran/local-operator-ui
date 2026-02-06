import { Tooltip, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { styled } from "@mui/material/styles";
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
	sx?: SxProps<Theme>;
	inline?: boolean;
};

/**
 * Styled component for message timestamps
 * Positioned differently based on whether the message is from the user or assistant
 * For assistant messages, width is set to match the content width (100% - 52px for avatar space)
 */
const StyledTimestamp = styled(Typography, {
	shouldForwardProp: (prop) => prop !== "isUser" && prop !== "inline",
})<{ isUser: boolean; isSmallView?: boolean; inline?: boolean }>(
	({ isUser, theme, isSmallView, inline }) => ({
		display: "block",
		marginTop: inline ? 0 : 8,
		textAlign: isUser ? "left" : "right",
		color: theme.palette.text.secondary,
		fontSize: "0.7rem",
		width: inline
			? "auto"
			: isUser
				? "auto"
				: isSmallView
					? "100%"
					: "calc(100% - 52px)",
		cursor: "help", // Indicate that hovering will show more information
	}),
);

/**
 * Component for displaying message timestamps
 * Shows a smart formatted time based on when the message was sent
 * Includes a tooltip with the full date and time on hover
 */
export const MessageTimestamp: FC<MessageTimestampProps> = ({
	timestamp,
	isUser,
	sx,
	isSmallView,
	inline = false,
}) => {
	// Format the timestamp using our utility function
	const formattedTime = formatMessageDateTime(timestamp);
	// Get the full date and time for the tooltip
	const fullDateTime = getFullDateTime(timestamp);

	return (
		<Tooltip
			title={fullDateTime}
			arrow
			placement="bottom"
			enterDelay={1200}
			enterNextDelay={1200}
			sx={sx}
		>
			{/* @ts-ignore - MUI Tooltip type issue */}
			<StyledTimestamp
				variant="caption"
				isUser={isUser}
				isSmallView={isSmallView}
				inline={inline}
			>
				{formattedTime}
			</StyledTimestamp>
		</Tooltip>
	);
};
