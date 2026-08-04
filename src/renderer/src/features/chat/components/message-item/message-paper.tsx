/**
 * Paper component for message content.
 *
 * Handles styling based on whether the message is from the user or assistant.
 * Assistant messages have no paper boundary at all — full reading weight on
 * the canvas, which is the chat-app look the old version already aimed at.
 * User messages are a right-aligned bubble on `surface` with a hairline edge;
 * the old bubble pulled its colour from the MUI `userMessage` palette slot
 * and a shadow, and both are gone: a surface ground with a hairline edge is
 * the designed pairing, and § 5 reserves the shadow for objects leaving the
 * flow.
 *
 * The `thinking` field renders through `AgentReasoning`, which honours the
 * `showAgentReasoning` preference (default false, § 7). The word "Thinking"
 * in `loading-indicator.tsx` is unrelated — that is a job status.
 */

import { TextSelectionControls } from "@shared/components/common/text-selection-controls";
import { cn } from "@shared/lib/utils";
import { useStreamingMessagesStore } from "@shared/store/streaming-messages-store";
import React, { type FC, useEffect, useMemo, useRef } from "react";
import type { Message } from "../../types/message";
import { parseReplies } from "../../utils/reply-utils";
import { ReplyPreview } from "../reply-preview";
import { AgentReasoning } from "../trace";
import { MessageControls } from "./message-controls";
import { MessageTimestamp } from "./message-timestamp";
import { StreamingMessage } from "./streaming-message";

// Props for the MessagePaper component
type MessagePaperProps = {
	isUser: boolean;
	children: React.ReactNode;
	content?: string;
	message?: Message;
	onMessageComplete?: () => void;
	isLastMessage: boolean;
	isJobRunning: boolean;
	agentId?: string;
	isSmallView?: boolean;
	metadataMode?: "default" | "custom";
};

/**
 * Clones any child that carries a `content` prop so it receives the markdown
 * with the reply block parsed out of it, plus the current text sizing.
 */
const cloneContentChildren = (
	children: React.ReactNode,
	remainingContent: string,
	styleProps: Record<string, unknown>,
) =>
	React.Children.map(children, (child: React.ReactNode) => {
		if (React.isValidElement(child) && child.props.content) {
			return React.cloneElement(
				child as React.ReactElement<{
					content: string;
					styleProps: Record<string, unknown>;
				}>,
				{ content: remainingContent, styleProps },
			);
		}
		return child;
	});

export const MessagePaper: FC<MessagePaperProps> = React.memo(
	({
		isUser,
		children,
		content,
		message,
		onMessageComplete,
		agentId,
		isSmallView,
		metadataMode = "default",
	}) => {
		const messageContentRef = useRef<HTMLDivElement>(null);
		const shouldRenderDefaultMetadata = metadataMode === "default";
		const { replies, remainingContent } = useMemo(
			() => parseReplies(content || ""),
			[content],
		);

		const markdownStyleProps = useMemo(
			() => ({
				fontSize: isSmallView ? "0.95rem" : "1.05rem",
				lineHeight: isSmallView ? 1.45 : 1.6,
			}),
			[isSmallView],
		);
		const resolvedConversationId = message?.conversation_id ?? agentId;

		// User messages keep the paper boundary.
		if (isUser) {
			return (
				<div
					className={cn(
						"group relative flex justify-end",
						isSmallView ? "w-full" : "w-[calc(100%-56px)]",
					)}
				>
					<div className="relative max-w-[85%] rounded-frame border border-hairline bg-surface p-4 text-ink break-words sm:max-w-[80%]">
						<div ref={messageContentRef} className="relative">
							{replies.length > 0 && <ReplyPreview replies={replies} />}
							{cloneContentChildren(
								children,
								remainingContent,
								markdownStyleProps,
							)}
						</div>
					</div>
					{message && shouldRenderDefaultMetadata && (
						<MessageControls
							isUser={isUser}
							content={content}
							messageId={message.id}
							agentId={agentId}
						/>
					)}
				</div>
			);
		}

		// Determine if the message is currently streaming
		const isStreamable =
			message?.is_streamable === true &&
			message?.is_complete === false &&
			!isUser;

		// Check if streaming is truly complete by also checking the streaming
		// messages store
		const isStreamingActuallyComplete = useStreamingMessagesStore((state) =>
			message?.id
				? (state.streamingMessages[message.id]?.isComplete ?? false)
				: true,
		);

		// Final determination of whether to show streaming component
		const shouldShowStreaming = isStreamable && !isStreamingActuallyComplete;
		const completionNotifiedRef = useRef<string | null>(null);

		useEffect(() => {
			if (!message?.id) return;

			if (shouldShowStreaming) {
				completionNotifiedRef.current = null;
				return;
			}

			if (onMessageComplete && completionNotifiedRef.current !== message.id) {
				completionNotifiedRef.current = message.id;
				onMessageComplete();
			}
		}, [message?.id, onMessageComplete, shouldShowStreaming]);

		const streamingWidthClass = isSmallView ? "w-full" : "w-[calc(100%-52px)]";

		const streamingMessageComponent = shouldShowStreaming && message && (
			<StreamingMessage
				messageId={message.id}
				autoConnect={true}
				conversationId={resolvedConversationId}
				refetchOnComplete={true}
				onComplete={() => {
					if (onMessageComplete) {
						onMessageComplete();
					}
				}}
				styleProps={markdownStyleProps}
				className={cn("relative break-words text-ink", streamingWidthClass)}
			/>
		);

		const regularMessageComponents =
			!shouldShowStreaming && message ? (
				<div
					className={cn("relative break-words text-ink", streamingWidthClass)}
					ref={messageContentRef}
				>
					{replies.length > 0 && <ReplyPreview replies={replies} />}
					{message.thinking && !isUser && (
						<AgentReasoning label="Thinking" content={message.thinking} />
					)}
					{cloneContentChildren(children, remainingContent, markdownStyleProps)}
					{resolvedConversationId && (
						<TextSelectionControls
							agentId={agentId}
							targetRef={messageContentRef}
							isUser={isUser}
							conversationId={resolvedConversationId}
							showSpeech
							showCopy
							showReply
						/>
					)}
				</div>
			) : null;

		return (
			<div
				className={cn(
					"group relative",
					isSmallView ? "w-full" : "w-[calc(100%-56px)]",
				)}
			>
				{streamingMessageComponent}
				{regularMessageComponents}
				{/* Timestamp and controls render always; the streaming state hides
				 * them with `invisible`, which wins over the group-hover opacity
				 * rule regardless of utility order. */}
				{message && shouldRenderDefaultMetadata && (
					<MessageTimestamp
						timestamp={message.timestamp}
						isUser={isUser}
						isSmallView={isSmallView}
						className={isStreamable ? "invisible" : undefined}
					/>
				)}
				{message && shouldRenderDefaultMetadata && (
					<MessageControls
						isUser={isUser}
						content={content}
						messageId={message.id}
						agentId={agentId}
						className={isStreamable ? "invisible" : undefined}
					/>
				)}
			</div>
		);
	},
);
