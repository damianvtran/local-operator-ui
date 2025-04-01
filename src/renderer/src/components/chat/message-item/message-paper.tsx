import { Box, Paper, useTheme } from "@mui/material";
import { styled } from "@mui/material/styles";
import { type FC, useMemo } from "react";
import { StreamingMessage } from "./streaming-message";
import { MessageControls } from "./message-controls";
import type { Message } from "../types";

// Create a Paper component with custom styling
const StyledPaper = styled(Paper)(({ theme }) => ({
	[theme.breakpoints.down("sm")]: {
		maxWidth: "85%",
	},
	[theme.breakpoints.between("sm", "md")]: {
		maxWidth: "80%",
	},
	[theme.breakpoints.up("md")]: {
		maxWidth: "80%",
	},
	width: "auto",
	padding: 16,
	borderRadius: 8,
	wordBreak: "break-word",
	overflowWrap: "break-word",
	position: "relative",
}));

// Props for the MessagePaper component
type MessagePaperProps = {
	isUser: boolean;
	elevation?: number;
	children: React.ReactNode;
	content?: string;
	message?: Message;
};

/**
 * Paper component for message content
 * Handles styling based on whether the message is from the user or assistant
 * For a modern AI chat app look, assistant messages don't have a paper boundary
 */
export const MessagePaper: FC<MessagePaperProps> = ({
	isUser,
	elevation = isUser ? 2 : 0,
	children,
	content,
	message,
}) => {
	const theme = useTheme();

	// For user messages, we keep the paper boundary
	if (isUser) {
		return (
			<Box
				sx={{
					position: "relative",
					width: "100%",
					display: "flex",
					justifyContent: "flex-end",
					"&:hover .message-controls": {
						opacity: 1,
					},
				}}
			>
				<StyledPaper
					elevation={elevation}
					sx={{
						backgroundColor: theme.palette.userMessage.background,
						border: `1px solid ${theme.palette.userMessage.border}`,
						boxShadow: theme.palette.userMessage.shadow,
						color: theme.palette.text.primary,
					}}
				>
					{children}
				</StyledPaper>
				<MessageControls isUser={isUser} content={content} />
			</Box>
		);
	}

	// For assistant messages, we remove the paper boundary and just show text on background
	// Take up the full width of the constraint for a modern chat app look

	// Check if the message is streamable and not complete
	const isStreamable =
		message?.is_streamable && !message?.is_complete && !isUser;

	// Memoize the StreamingMessage component to prevent unnecessary remounts
	const MemoizedStreamingMessage = useMemo(() => {
		if (!isStreamable || !message) return null;

		return (
			<StreamingMessage
				messageId={message.id}
				autoConnect={true}
				showStatus={false}
				keepAlive={true}
			>
				<Box
					sx={{
						borderRadius: 2,
						color: theme.palette.text.primary,
						width: "calc(100% - 52px)", // Take full width minus padding
						wordBreak: "break-word",
						overflowWrap: "break-word",
						position: "relative",
					}}
				>
					{children}
				</Box>
			</StreamingMessage>
		);
	}, [message, isStreamable, theme.palette.text.primary, children]);

	return (
		<Box
			sx={{
				position: "relative",
				width: "100%",
				"&:hover .message-controls": {
					opacity: 1,
				},
			}}
		>
			{MemoizedStreamingMessage || (
				<Box
					sx={{
						borderRadius: 2,
						color: theme.palette.text.primary,
						width: "calc(100% - 52px)", // Take full width minus padding
						wordBreak: "break-word",
						overflowWrap: "break-word",
						position: "relative",
					}}
				>
					{children}
				</Box>
			)}
			<MessageControls isUser={isUser} content={content} />
		</Box>
	);
};
