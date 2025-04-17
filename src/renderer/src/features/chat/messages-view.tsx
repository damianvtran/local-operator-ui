import { Box, CircularProgress, styled } from "@mui/material";
import type {
	AgentExecutionRecord,
	JobStatus,
} from "@renderer/api/local-operator/types";
import type { Message } from "@renderer/features/chat/types";
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
	conversationId?: string; // Added to support streaming message updates
};

/**
 * Main messages container with column-reverse layout for automatic scroll-to-bottom
 * This container handles scrolling and uses column-reverse to keep new messages at the bottom
 */
const MessagesContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "collapsed",
})<{ collapsed?: boolean }>(({ theme, collapsed }) => ({
	flexGrow: collapsed ? 0 : 1,
	height: collapsed ? 0 : "100%",
	overflow: collapsed ? "hidden" : "auto",
	padding: collapsed ? 0 : 16,
	display: "flex",
	flexDirection: "column-reverse", // Key change: reverse column direction for auto-bottom scrolling
	backgroundColor: theme.palette.messagesView.background,
	position: "relative",
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
	transform: "translateZ(0)",
	willChange: "scroll-position",
	overflowAnchor: "auto", // Ensures browser maintains scroll position when content changes
}));

/**
 * Container for centering and constraining message width
 * Creates a modern chat app layout with centered content
 * The messages are displayed in normal order within this container
 */
const CenteredMessagesContainer = styled(Box)(({ theme }) => ({
	width: "100%",
	maxWidth: "900px",
	margin: "0 auto",
	display: "flex",
	flexDirection: "column", // Normal column direction to display messages in correct order
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

/**
 * Container to center the loading indicator fullscreen when no messages
 */
const FullScreenCenteredContainer = styled(Box)({
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	flexGrow: 1,
	height: "100%",
	width: "100%",
});

/**
 * MessagesView Component
 *
 * Displays the list of messages in a conversation using a column-reverse layout
 * for automatic scroll-to-bottom behavior
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
	conversationId,
}) => {
	const collapsed =
		messages.length === 0 && !isLoadingMessages && !isFetchingMore;

	return (
		<MessagesContainer ref={messagesContainerRef} collapsed={collapsed}>
			{/* Loading more messages indicator at the top (visually at the bottom with column-reverse) */}
			{isFetchingMore && (
				<LoadingMoreIndicator>
					<CircularProgress size={20} sx={{ mr: 1 }} />
					Loading more messages...
				</LoadingMoreIndicator>
			)}

			{/* With column-reverse, the content is flipped, so we need to maintain the correct visual order */}
			{/* The loading indicator and messages are wrapped in a container with normal column direction */}

			{/* Show loading indicator when initially loading messages */}
			{isLoadingMessages && !messages.length ? (
				<LoadingBox>
					<CircularProgress />
				</LoadingBox>
			) : (
				<>
					{/* Reference element for backwards compatibility */}
					<div
						ref={messagesEndRef}
						style={{
							height: 1,
							width: "100%",
							opacity: 0,
							position: "relative",
							pointerEvents: "none",
						}}
						id="messages-end-anchor"
					/>

					{/* Render messages with normal order inside the reversed container */}
					{messages.length > 0 ? (
						<CenteredMessagesContainer>
							{/* Messages are rendered in normal order */}
							{messages.map((message, index) => (
								<MessageItem
									key={message.id}
									message={{
										...message,
										conversation_id: conversationId, // Add conversation ID to message
									}}
									isLastMessage={index === messages.length - 1}
									onMessageComplete={() => {
										if (refetch) {
											refetch();
										}
									}}
								/>
							))}

							{/* Loading indicator for new message at the bottom */}
							{isLoading && (
								<LoadingIndicator
									status={jobStatus}
									agentName={agentName}
									currentExecution={currentExecution}
									scrollToBottom={scrollToBottom}
									conversationId={conversationId}
								/>
							)}
						</CenteredMessagesContainer>
					) : (
						<>
							{/* When no messages, center the loading indicator fullscreen */}
							{isLoadingMessages && (
								<FullScreenCenteredContainer>
									<LoadingIndicator
										status={jobStatus}
										agentName={agentName}
										currentExecution={currentExecution}
										scrollToBottom={scrollToBottom}
										conversationId={conversationId}
									/>
								</FullScreenCenteredContainer>
							)}
						</>
					)}
				</>
			)}
		</MessagesContainer>
	);
};
