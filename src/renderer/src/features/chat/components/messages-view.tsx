import type {
	AgentExecutionRecord,
	JobStatus,
} from "@shared/api/local-operator/types";
import { RingLoadingIndicator } from "@shared/components/common/ring-loading-indicator";
import { Spinner } from "@shared/components/common/spinner";
import { cn } from "@shared/lib/utils";
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
 * Renders the list of messages in a conversation, along with loading indicators.
 *
 * The scroll container is `column-reverse`, so scrollTop 0 is the bottom and the
 * browser's overflow anchor keeps the newest content pinned as it grows — which
 * is why nothing in this tree should ever call scrollIntoView on its own; the
 * anchor and any manual scrolling fight, and the anchor is the one that respects
 * a reader who scrolled up.
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
			<div
				className={cn(
					"relative flex items-center justify-center bg-canvas",
					collapsed
						? "h-0 grow-0 overflow-hidden"
						: "h-full grow overflow-auto",
				)}
			>
				{/* Fixed position loading indicator for fetching more messages */}
				{isFetchingMore && (
					<div
						className={cn(
							"absolute z-10 flex w-fit items-center text-ink-muted",
							isSmallView
								? "top-2 left-2 px-2 py-1 text-meta"
								: "top-4 left-4 px-3 py-2 text-body-sm",
						)}
					>
						<Spinner size="sm" className="mr-2" />
						Loading older messages...
					</div>
				)}
				{!isFetchingMore && hiddenMessageCount > 0 && (
					<div
						className={cn(
							"absolute z-10 flex w-fit items-center text-ink-muted",
							isSmallView
								? "top-2 left-2 px-2 py-1 text-meta"
								: "top-4 left-4 px-3 py-2 text-body-sm",
						)}
					>
						Rendering {hiddenMessageCount} earlier messages...
					</div>
				)}

				{/*
				 * Scrollable messages container.
				 *
				 * `column-reverse` is the layout, not a detail: new messages land at
				 * scrollTop 0, and `overflow-anchor: auto` is what keeps the view
				 * pinned there while content above the anchor grows. The translateZ
				 * layer keeps long lists from repainting the whole scrollport.
				 */}
				<div
					ref={messagesContainerRef}
					className={cn(
						"relative flex w-full flex-col-reverse will-change-[scroll-position] [overflow-anchor:auto] [transform:translateZ(0)]",
						collapsed
							? "h-0 grow-0 overflow-hidden p-0"
							: "h-full grow overflow-auto p-4",
					)}
				>
					{isLoadingMessages && !messages.length ? (
						<div className="flex h-full grow items-center justify-center p-8">
							<RingLoadingIndicator size={68} />
						</div>
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

							{renderedMessages.length > 0 ? (
								<div
									className={cn(
										"mx-auto flex w-full max-w-[900px] flex-col sm:max-w-[90%] md:max-w-[900px]",
										isSmallView ? "gap-2" : "gap-4",
									)}
								>
									{renderedMessages.map((message, index) =>
										message.execution_type === "info" ? (
											<div
												key={message.id}
												className={cn(
													"flex items-center text-center",
													isSmallView ? "my-1" : "my-2",
												)}
											>
												<div className="flex-1 border-hairline border-t" />
												<span
													className={cn(
														"max-w-[720px] text-ink-muted",
														isSmallView
															? "px-1 text-meta"
															: "px-2 text-body-sm",
													)}
												>
													{message.message}
												</span>
												<div className="flex-1 border-hairline border-t" />
											</div>
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
								</div>
							) : (
								<>
									{isLoadingMessages && (
										<div className="flex h-full w-full grow items-center justify-center">
											<LoadingIndicator
												status={jobStatus}
												agentName={agentName}
												currentExecution={currentExecution}
												conversationId={conversationId}
												isSmallView={isSmallView}
											/>
										</div>
									)}
								</>
							)}
						</>
					)}
				</div>
			</div>
		);
	},
);

MessagesView.displayName = "MessagesView";
