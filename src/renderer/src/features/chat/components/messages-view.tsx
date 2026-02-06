import { Box, CircularProgress, Typography, styled } from "@mui/material";
import type {
	AgentExecutionRecord,
	JobStatus,
} from "@shared/api/local-operator/types";
import { RingLoadingIndicator } from "@shared/components/common/ring-loading-indicator";
import { useStreamingMessagesStore } from "@shared/store/streaming-messages-store";
import React, {
	type FC,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { Message } from "../types/message";
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
	isSmallView: boolean;
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
	shouldForwardProp: (prop) => prop !== "collapsed" && prop !== "isSmallView",
})<{ collapsed?: boolean; isSmallView?: boolean }>(({ collapsed }) => ({
	flexGrow: collapsed ? 0 : 1,
	height: collapsed ? 0 : "100%",
	overflow: collapsed ? "hidden" : "auto",
	padding: collapsed ? 0 : 16,
	width: "100%",
	display: "flex",
	flexDirection: "column-reverse", // Key change: reverse column direction for auto-bottom scrolling
	position: "relative",
	transform: "translateZ(0)",
	willChange: "scroll-position",
	overflowAnchor: "auto", // Ensures browser maintains scroll position when content changes
}));

/**
 * Styled component for displaying informational messages as a divider
 */
const InfoMessageDivider = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isSmallView",
})<{ isSmallView?: boolean }>(({ theme, isSmallView }) => ({
	display: "flex",
	alignItems: "center",
	textAlign: "center",
	margin: theme.spacing(isSmallView ? 1 : 2, 0),
	"&::before, &::after": {
		content: '""',
		flex: 1,
		borderBottom: `1px solid ${theme.palette.divider}`,
	},
	"& > .MuiTypography-root": {
		// Target Typography directly for specificity
		padding: theme.spacing(0, isSmallView ? 1 : 2), // Increased padding for better spacing around text
		color: theme.palette.text.secondary,
		fontSize: isSmallView ? "0.75rem" : "0.875rem",
		maxWidth: "720px",
	},
}));

/**
 * Container for centering and constraining message width
 * Creates a modern chat app layout with centered content
 * The messages are displayed in normal order within this container
 */
const CenteredMessagesContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isSmallView",
})<{ isSmallView?: boolean }>(({ theme, isSmallView }) => ({
	width: "100%",
	maxWidth: "900px",
	margin: "0 auto",
	display: "flex",
	flexDirection: "column", // Normal column direction to display messages in correct order
	gap: isSmallView ? 8 : 16,
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

const LoadingMoreIndicator = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isSmallView",
})<{ isSmallView?: boolean }>(({ theme, isSmallView }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "flex-start",
	padding: isSmallView ? "4px 8px" : "8px 12px",
	color: theme.palette.text.secondary,
	position: "absolute",
	top: isSmallView ? 8 : 16,
	left: isSmallView ? 8 : 16,
	zIndex: 10,
	fontSize: isSmallView ? "0.75rem" : "0.85rem",
	maxWidth: "fit-content",
}));

const LoadingBox = styled(Box)({
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	padding: 32,
	height: "100%",
	flexGrow: 1,
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

const INITIAL_RENDERED_MESSAGES = 40;
const BACKGROUND_HYDRATION_BATCH_SIZE = 25;
const BACKGROUND_HYDRATION_INTERVAL_MS = 40;
const FAST_SCROLL_HYDRATION_BATCH_SIZE = 120;

const getInitialRenderedCount = (totalMessages: number): number =>
	totalMessages > INITIAL_RENDERED_MESSAGES
		? INITIAL_RENDERED_MESSAGES
		: totalMessages;

/**
 * MessagesView Component
 *
 * Displays the list of messages in a conversation using a column-reverse layout
 * for automatic scroll-to-bottom behavior
 */
export const MessagesView: FC<MessagesViewProps> = React.memo(
	({
		messages,
		isLoading,
		isLoadingMessages,
		isFetchingMore,
		jobStatus,
		agentName,
		currentExecution,
		messagesContainerRef,
		messagesEndRef,
		refetch,
		conversationId,
		isSmallView,
	}) => {
		const [renderedMessageCount, setRenderedMessageCount] = useState(() =>
			getInitialRenderedCount(messages.length),
		);
		const previousConversationIdRef = useRef(conversationId);
		const previousMessageCountRef = useRef(messages.length);

		const collapsed =
			messages.length === 0 && !isLoadingMessages && !isFetchingMore;

		useEffect(() => {
			const previousMessageCount = previousMessageCountRef.current;
			const hasConversationChanged =
				previousConversationIdRef.current !== conversationId;

			if (hasConversationChanged) {
				previousConversationIdRef.current = conversationId;
				setRenderedMessageCount(getInitialRenderedCount(messages.length));
				previousMessageCountRef.current = messages.length;
				return;
			}

			if (messages.length < previousMessageCount) {
				setRenderedMessageCount((current) =>
					Math.min(current, messages.length),
				);
			} else if (messages.length > previousMessageCount) {
				const delta = messages.length - previousMessageCount;
				setRenderedMessageCount((current) => {
					if (current >= previousMessageCount) {
						return messages.length;
					}

					// Keep newest messages visible while progressively hydrating older history.
					return Math.min(messages.length, current + Math.min(delta, 1));
				});
			}

			previousMessageCountRef.current = messages.length;
		}, [conversationId, messages.length]);

		useEffect(() => {
			if (renderedMessageCount >= messages.length) {
				return;
			}

			const timeoutId = window.setTimeout(() => {
				setRenderedMessageCount((current) =>
					Math.min(messages.length, current + BACKGROUND_HYDRATION_BATCH_SIZE),
				);
			}, BACKGROUND_HYDRATION_INTERVAL_MS);

			return () => {
				window.clearTimeout(timeoutId);
			};
		}, [messages.length, renderedMessageCount]);

		useEffect(() => {
			const container = messagesContainerRef.current;
			if (!container || renderedMessageCount >= messages.length) {
				return;
			}

			const handlePrioritizeHistoryHydration = () => {
				const { scrollTop, scrollHeight, clientHeight } = container;
				const maxScrollValue = Math.abs(scrollHeight - clientHeight);
				const absScrollTop = Math.abs(scrollTop);
				const distanceFromTop =
					scrollTop < 0
						? maxScrollValue - absScrollTop
						: maxScrollValue - scrollTop;

				if (distanceFromTop < 260) {
					setRenderedMessageCount((current) =>
						Math.min(
							messages.length,
							current + FAST_SCROLL_HYDRATION_BATCH_SIZE,
						),
					);
				}
			};

			container.addEventListener("scroll", handlePrioritizeHistoryHydration, {
				passive: true,
			});

			return () => {
				container.removeEventListener(
					"scroll",
					handlePrioritizeHistoryHydration,
				);
			};
		}, [messages.length, renderedMessageCount, messagesContainerRef]);

		const renderedMessages = useMemo(() => {
			if (renderedMessageCount >= messages.length) {
				return messages;
			}

			return messages.slice(messages.length - renderedMessageCount);
		}, [messages, renderedMessageCount]);

		const hiddenMessageCount = messages.length - renderedMessages.length;

		const lastMessage = messages[messages.length - 1];
		const lastMessageId = lastMessage?.id ?? "";
		const lastStreamComplete = useStreamingMessagesStore(
			(state) => state.streamingMessages[lastMessageId]?.isComplete ?? false,
		);

		const lastMessageIsStreaming = Boolean(
			lastMessage?.is_streamable &&
				!(lastMessage?.is_complete || lastStreamComplete),
		);

		const handleMessageComplete = useCallback(() => {
			refetch?.();
		}, [refetch]);

		return (
			<MessagesViewWrapper collapsed={collapsed}>
				{/* Fixed position loading indicator for fetching more messages */}
				{isFetchingMore && (
					<LoadingMoreIndicator isSmallView={isSmallView}>
						<CircularProgress size={16} sx={{ mr: 1 }} />
						Loading older messages...
					</LoadingMoreIndicator>
				)}
				{!isFetchingMore && hiddenMessageCount > 0 && (
					<LoadingMoreIndicator isSmallView={isSmallView}>
						Rendering {hiddenMessageCount} earlier messages...
					</LoadingMoreIndicator>
				)}

				{/* Scrollable messages container */}
				<MessagesContainer
					ref={messagesContainerRef}
					collapsed={collapsed}
					isSmallView={isSmallView}
				>
					{/* With column-reverse, the content is flipped, so we need to maintain the correct visual order */}
					{/* The loading indicator and messages are wrapped in a container with normal column direction */}

					{/* Show loading indicator when initially loading messages */}
					{isLoadingMessages && !messages.length ? (
						<LoadingBox>
							<RingLoadingIndicator size={68} />
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
							{renderedMessages.length > 0 ? (
								<CenteredMessagesContainer isSmallView={isSmallView}>
									{/* Messages are rendered in normal order */}
									{renderedMessages.map((message, index) =>
										message.execution_type === "info" ? (
											<InfoMessageDivider
												key={message.id}
												isSmallView={isSmallView}
											>
												<Typography>{message.message}</Typography>
											</InfoMessageDivider>
										) : (
											<MessageItem
												key={message.id}
												message={message}
												conversationId={conversationId}
												currentExecution={
													index === renderedMessages.length - 1 &&
													currentExecution
														? currentExecution
														: undefined
												}
												isLastMessage={index === renderedMessages.length - 1}
												onMessageComplete={handleMessageComplete}
												isSmallView={isSmallView}
											/>
										),
									)}

									{/* Loading indicator for new message at the bottom */}
									{isLoading && !lastMessageIsStreaming && (
										<LoadingIndicator
											status={jobStatus}
											agentName={agentName}
											currentExecution={currentExecution}
											conversationId={conversationId}
											isSmallView={isSmallView}
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
												conversationId={conversationId}
												isSmallView={isSmallView}
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
	},
);
