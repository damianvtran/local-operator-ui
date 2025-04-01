import { Box, Paper, useTheme } from "@mui/material";
import { styled } from "@mui/material/styles";
import { type FC, useMemo } from "react";
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

	// Determine if the message is currently streaming - memoized to prevent unnecessary recalculations
	const isStreamable = useMemo(
		() =>
			message?.is_streamable === true &&
			message?.is_complete === false &&
			!isUser,
		[message?.is_streamable, message?.is_complete, isUser],
	);

	// Memoize the message styles to prevent unnecessary object creation on each render
	const messageStyles = useMemo(
		() => ({
			borderRadius: 2,
			color: theme.palette.text.primary,
			width: "calc(100% - 52px)", // Take full width minus padding
			wordBreak: "break-word",
			overflowWrap: "break-word",
			position: "relative",
		}),
		[theme.palette.text.primary],
	);

	// Filter out the timestamp from children for assistant messages - memoized to prevent unnecessary recalculations
	const filteredChildren = useMemo(() => {
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
	}, [children]);

	// Memoize the streaming message component to prevent unnecessary re-renders
	const streamingMessageComponent = useMemo(() => {
		if (!isStreamable || !message) return null;

		return (
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
					if (onMessageComplete) {
						onMessageComplete();
					}
				}}
			/>
		);
	}, [isStreamable, message, messageStyles, onMessageComplete]);

	// Memoize the regular message components to prevent unnecessary re-renders
	const regularMessageComponents = useMemo(() => {
		if (isStreamable) return null;

		return (
			<>
				<Box sx={messageStyles}>{filteredChildren}</Box>
				{message && (
					<MessageTimestamp timestamp={message.timestamp} isUser={isUser} />
				)}
				<MessageControls isUser={isUser} content={content} />
			</>
		);
	}, [isStreamable, messageStyles, filteredChildren, message, isUser, content]);

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
			{streamingMessageComponent}
			{regularMessageComponents}
		</Box>
	);
};
