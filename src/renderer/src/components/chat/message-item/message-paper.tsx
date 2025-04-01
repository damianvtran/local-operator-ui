import { Box, Paper, useTheme } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import { StreamingMessage } from "./streaming-message";
import { MessageControls } from "./message-controls";
import { MessageTimestamp } from "./message-timestamp";
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
	onMessageComplete?: () => void;
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
	onMessageComplete,
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

	// Determine if the message is currently streaming
	// Check the message's is_streamable and is_complete properties
	// We need to be careful here - a message might have is_streamable=true
	// but we should only show the streaming component if it's not complete
	const isStreamable =
		message?.is_streamable && !message?.is_complete && !isUser;

	const messageStyles = {
		borderRadius: 2,
		color: theme.palette.text.primary,
		width: "calc(100% - 52px)", // Take full width minus padding
		wordBreak: "break-word",
		overflowWrap: "break-word",
		position: "relative",
	};

	// Filter out the timestamp from children for assistant messages
	// since we add it explicitly below for better alignment
	const filterTimestampFromChildren = () => {
		// If children is a React element array, filter out the MessageTimestamp component
		if (Array.isArray(children)) {
			return children.filter(
				(child) =>
					child?.type?.displayName !== "MessageTimestamp" &&
					child?.type?.name !== "MessageTimestamp",
			);
		}

		// Otherwise, just return the children as is
		return children;
	};

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
			{isStreamable ? (
				// When streaming, show the streaming message without controls or timestamp
				// Don't include any children inside the StreamingMessage component
				// to avoid duplicate content rendering
				<StreamingMessage
					messageId={message.id}
					autoConnect={true}
					showStatus={false}
					keepAlive={true}
					sx={messageStyles}
					// Pass the conversation ID if available
					conversationId={message.conversation_id}
					refetchOnComplete={true}
					onComplete={() => {
						console.log(`StreamingMessage onComplete called for ${message.id}`);
						if (onMessageComplete) {
							console.log(`Calling onMessageComplete for ${message.id}`);
							onMessageComplete();
						}
					}}
				/>
			) : (
				// When not streaming, show the regular message with controls and timestamp
				<>
					<Box sx={messageStyles}>{filterTimestampFromChildren()}</Box>
					{message && (
						<MessageTimestamp timestamp={message.timestamp} isUser={isUser} />
					)}
					<MessageControls isUser={isUser} content={content} />
				</>
			)}
		</Box>
	);
};
