/**
 * The body of one turn.
 *
 * Assistant messages have no paper boundary at all — full reading weight on
 * the canvas, which is the chat-app look the old version already aimed at.
 * User messages are a right-aligned bubble on `surface` with a hairline edge;
 * the old bubble pulled its colour from the MUI `userMessage` palette slot
 * and a shadow, and both are gone: a surface ground with a hairline edge is
 * the designed pairing, and § 5 reserves the shadow for objects leaving the
 * flow.
 *
 * ## Measure
 *
 * Prose is capped at `MEASURE`, not at the width of the column. The column is
 * 900px; at the size this used to render — a hardcoded `1.05rem`, the only
 * 16.8px text anywhere in the app and not a step on the § 4 ramp — a
 * paragraph ran to about 104 characters per line, well past the 60-80 that
 * reading research and every reading pane worth copying (Superhuman, Notion,
 * Things) settle on. Both halves of that are fixed here: the size is the
 * ramp's `text-body`, and the measure is what buys the comfort back. The user
 * bubble gets a narrower cap again, which is what makes a user turn read as
 * an aside and the agent's answer read as the document.
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
import { StreamingMessage } from "./streaming-message";

/** Opts the prose elements into the ~72-character cap defined in `markdown.css`. */
const MEASURE = "lo-measured";

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

		// Both values are § 4 steps rather than the former hardcoded rems: the
		// compact column drops one step, exactly like every other dense surface
		// in the app.
		const markdownStyleProps = useMemo(
			() => ({
				fontSize: isSmallView ? "var(--text-body-sm)" : "var(--text-body)",
				lineHeight: 1.6,
			}),
			[isSmallView],
		);
		const resolvedConversationId = message?.conversation_id ?? agentId;

		// User messages keep the paper boundary.
		if (isUser) {
			return (
				<div className="group relative flex w-full justify-end">
					<div
						className={cn(
							"relative rounded-frame border border-hairline bg-surface text-ink break-words",
							isSmallView ? "max-w-[92%] px-3 py-2" : "max-w-[75%] px-4 py-3",
						)}
					>
						<div ref={messageContentRef} className={cn("relative", MEASURE)}>
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
							timestamp={message.timestamp}
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
				className={cn("relative w-full break-words text-ink", MEASURE)}
			/>
		);

		const regularMessageComponents =
			!shouldShowStreaming && message ? (
				<div
					className={cn("relative w-full break-words text-ink", MEASURE)}
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
			<div className="group relative w-full">
				{streamingMessageComponent}
				{regularMessageComponents}
				{/* One hover affordance carrying copy, speak and the exact time.
				 * The streaming state hides it with `invisible`, which wins over the
				 * group-hover opacity rule regardless of utility order. */}
				{message && shouldRenderDefaultMetadata && (
					<MessageControls
						isUser={isUser}
						content={content}
						messageId={message.id}
						agentId={agentId}
						timestamp={message.timestamp}
						className={isStreamable ? "invisible" : undefined}
					/>
				)}
			</div>
		);
	},
);
