import { faCommentDots } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, CircularProgress, Typography, styled } from "@mui/material";
import type { JobStatus } from "@renderer/api/local-operator/types";
import type { Message } from "@renderer/components/chat/types";
import type { FC, RefObject } from "react";
import { LoadingIndicator } from "./loading-indicator";
import { MessageItem } from "./message-item";

/**
 * Props for the MessagesView component
 */
type MessagesViewProps = {
	messages: Message[];
	isLoading: boolean;
	isLoadingMessages: boolean;
	isFetchingMore: boolean;
	jobStatus?: JobStatus | null;
	agentName?: string;
	messagesContainerRef: RefObject<HTMLDivElement>;
	messagesEndRef: RefObject<HTMLDivElement>;
};

const MessagesContainer = styled(Box)({
	flexGrow: 1,
	overflow: "auto",
	padding: 16,
	display: "flex",
	flexDirection: "column",
	gap: 16,
	backgroundColor: "rgba(0, 0, 0, 0.2)",
	position: "relative", // Add position relative for absolute positioning of children
	"&::-webkit-scrollbar": {
		width: "8px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor: "rgba(255, 255, 255, 0.1)",
		borderRadius: "4px",
	},
	// Improve GPU acceleration for smoother scrolling
	transform: "translateZ(0)",
	willChange: "scroll-position",
});

const LoadingMoreIndicator = styled(Box)({
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: 16,
	color: "rgba(255, 255, 255, 0.7)",
});

const LoadingBox = styled(Box)({
	display: "flex",
	justifyContent: "center",
	padding: 32,
});

const EmptyMessagesBox = styled(Box)({
	textAlign: "center",
	color: "rgba(255, 255, 255, 0.7)",
	padding: 32,
	fontSize: "0.9rem",
});

/**
 * MessagesView Component
 *
 * Displays the list of messages in a conversation
 */
export const MessagesView: FC<MessagesViewProps> = ({
	messages,
	isLoading,
	isLoadingMessages,
	isFetchingMore,
	jobStatus,
	agentName,
	messagesContainerRef,
	messagesEndRef,
}) => {
	return (
		<MessagesContainer ref={messagesContainerRef}>
			{/* Loading more messages indicator */}
			{isFetchingMore && (
				<LoadingMoreIndicator>
					<CircularProgress size={20} sx={{ mr: 1 }} />
					Loading more messages...
				</LoadingMoreIndicator>
			)}

			{/* Show loading indicator when initially loading messages */}
			{isLoadingMessages && !messages.length ? (
				<LoadingBox>
					<CircularProgress />
				</LoadingBox>
			) : (
				<>
					{/* Render messages with windowing for better performance */}
					{messages.length > 0 ? (
						// Only render visible messages plus a buffer
						messages.map((message) => (
							<MessageItem key={message.id} message={message} />
						))
					) : (
						<EmptyMessagesBox>
							<FontAwesomeIcon
								icon={faCommentDots}
								style={{
									fontSize: "2rem",
									opacity: 0.5,
									marginBottom: "1rem",
								}}
							/>
							<Typography variant="body1">
								No messages yet. Start a conversation!
							</Typography>
						</EmptyMessagesBox>
					)}

					{/* Loading indicator for new message */}
					{isLoading && (
						<LoadingIndicator status={jobStatus} agentName={agentName} />
					)}

					{/* Invisible element to scroll to */}
					<div ref={messagesEndRef} />
				</>
			)}
		</MessagesContainer>
	);
};
