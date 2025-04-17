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

const MessagesContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "collapsed",
})<{ collapsed?: boolean }>(({ theme, collapsed }) => ({
	flexGrow: collapsed ? 0 : 1,
	height: collapsed ? 0 : "100%",
	overflow: collapsed ? "hidden" : "auto",
	padding: collapsed ? 0 : 16,
	display: "flex",
	flexDirection: "column",
	gap: 16,
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
	conversationId,
}) => {
	const collapsed =
		messages.length === 0 && !isLoadingMessages && !isFetchingMore;

	return (
		<MessagesContainer ref={messagesContainerRef} collapsed={collapsed}>
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

							{/* Loading indicator for new message - now inside CenteredMessagesContainer */}
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

					{/* Constant anchor element at the bottom for scroll targeting */}
					<div
						ref={messagesEndRef}
						style={{
							height: 1,
							width: "100%",
							opacity: 0,
							position: "relative",
							marginTop: 8,
							pointerEvents: "none",
						}}
						id="messages-end-anchor"
					/>
				</>
			)}
		</MessagesContainer>
	);
};
