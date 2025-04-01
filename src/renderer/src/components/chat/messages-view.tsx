import { faCommentDots } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, CircularProgress, Typography, styled } from "@mui/material";
import type {
	AgentExecutionRecord,
	JobStatus,
} from "@renderer/api/local-operator/types";
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
	currentExecution?: AgentExecutionRecord | null;
	messagesContainerRef: RefObject<HTMLDivElement>;
	messagesEndRef: RefObject<HTMLDivElement>;
	scrollToBottom?: () => void;
	refetch?: () => void;
};

const MessagesContainer = styled(Box)(({ theme }) => ({
	flexGrow: 1,
	overflow: "auto",
	padding: 16,
	display: "flex",
	flexDirection: "column",
	gap: 16,
	backgroundColor: theme.palette.messagesView.background,
	position: "relative", // Add position relative for absolute positioning of children
	"&::-webkit-scrollbar": {
		width: "8px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor:
			theme.palette.mode === "dark"
				? "rgba(255, 255, 255, 0.1)"
				: "rgba(0, 0, 0, 0.2)",
		borderRadius: "4px",
	},
	// Improve GPU acceleration for smoother scrolling
	transform: "translateZ(0)",
	willChange: "scroll-position",
}));

/**
 * Container for centering and constraining message width
 * Creates a modern chat app layout with centered content
 */
const CenteredMessagesContainer = styled(Box)(({ theme }) => ({
	width: "100%",
	maxWidth: "900px",
	margin: "0 auto",
	display: "flex",
	flexDirection: "column",
	gap: 16,
	[theme.breakpoints.down("sm")]: {
		maxWidth: "100%",
	},
	[theme.breakpoints.between("sm", "md")]: {
		maxWidth: "90%",
	},
	[theme.breakpoints.up("md")]: {
		maxWidth: "900px",
	},
}));

const LoadingMoreIndicator = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: 16,
	color: theme.palette.text.secondary,
}));

const LoadingBox = styled(Box)({
	display: "flex",
	justifyContent: "center",
	padding: 32,
});

const EmptyMessagesBox = styled(Box)(({ theme }) => ({
	textAlign: "center",
	color: theme.palette.text.secondary,
	padding: 32,
	fontSize: "0.9rem",
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
}));

const EmptyMessagesIcon = styled(FontAwesomeIcon)(({ theme }) => ({
	fontSize: "2rem",
	opacity: 0.5,
	marginBottom: "1rem",
	color: theme.palette.text.secondary,
}));

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
	currentExecution,
	messagesContainerRef,
	messagesEndRef,
	scrollToBottom,
	refetch,
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
						<CenteredMessagesContainer>
							{messages.map((message) => (
								<MessageItem
									key={message.id}
									message={message}
									onMessageComplete={() => {
										if (refetch) {
											refetch();
										}
									}}
								/>
							))}

							{/* Loading indicator for new message - now inside CenteredMessagesContainer */}
							{isLoading && (
								<LoadingIndicator
									status={jobStatus}
									agentName={agentName}
									currentExecution={currentExecution}
									scrollToBottom={scrollToBottom}
								/>
							)}
						</CenteredMessagesContainer>
					) : (
						<>
							<EmptyMessagesBox>
								<EmptyMessagesIcon icon={faCommentDots} />
								<Typography variant="body1">
									No messages yet. Start a conversation!
								</Typography>
							</EmptyMessagesBox>

							{/* Loading indicator when no messages */}
							{isLoading && (
								<CenteredMessagesContainer>
									<LoadingIndicator
										status={jobStatus}
										agentName={agentName}
										currentExecution={currentExecution}
										scrollToBottom={scrollToBottom}
									/>
								</CenteredMessagesContainer>
							)}
						</>
					)}

					{/* Invisible element to scroll to */}
					<div ref={messagesEndRef} />
				</>
			)}
		</MessagesContainer>
	);
};
