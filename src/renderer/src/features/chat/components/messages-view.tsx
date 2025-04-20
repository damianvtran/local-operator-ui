import { Box, CircularProgress, styled } from "@mui/material";
import type {
	AgentExecutionRecord,
	JobStatus,
} from "@shared/api/local-operator/types";
import type { Message } from "../types";
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
	conversationId: string;
};

/**
 * Wrapper container that holds both the scrollable messages and the loading indicator
 * This allows the loading indicator to be positioned absolutely relative to this wrapper
 */
const MessagesViewWrapper = styled(Box, {
	shouldForwardProp: (prop) => prop !== "collapsed",
})<{ collapsed?: boolean }>(({ theme, collapsed }) => ({
	height: collapsed ? 0 : "100%",
	flexGrow: collapsed ? 0 : 1,
	overflow: collapsed ? "hidden" : "auto",
	position: "relative",
	backgroundColor: theme.palette.messagesView.background,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
}));

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
	width: "100%",
	display: "flex",
	flexDirection: "column-reverse", // Key change: reverse column direction for auto-bottom scrolling
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
	justifyContent: "flex-start",
	padding: "8px 12px",
	color: theme.palette.text.secondary,
	position: "absolute",
	top: 16,
	left: 16,
	zIndex: 10,
	fontSize: "0.85rem",
	maxWidth: "fit-content",
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
		<MessagesViewWrapper collapsed={collapsed}>
			{/* Fixed position loading indicator for fetching more messages */}
			{isFetchingMore && (
				<LoadingMoreIndicator>
					<CircularProgress size={16} sx={{ mr: 1 }} />
					Loading older messages...
				</LoadingMoreIndicator>
			)}

			{/* Scrollable messages container */}
			<MessagesContainer ref={messagesContainerRef} collapsed={collapsed}>
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
										conversationId={conversationId}
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
		</MessagesViewWrapper>
	);
};
