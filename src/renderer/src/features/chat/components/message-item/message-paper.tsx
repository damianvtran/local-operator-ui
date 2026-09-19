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
 * Neither side carries a reading cap now, and this LEGACY path has to agree
 * with `canonical-transcript.tsx` on that — a cap left here would show up as
 * the same defect on whichever surface still renders through this component.
 *
 * The USER bubble used to carry it: its body took the `lo-measured` class,
 * which capped the prose at 62ch and centred it inside the bubble. The operator
 * report of 2026-09-16 ended that — a card widened by a reply quote or a wide
 * attachment left the message floating as a centre-constrained column with
 * equal slack on each side — so the card's own width is the measure and its
 * prose fills it.
 *
 * The agent's answer takes no cap either: it must share the left edge and the
 * width of the tool rows in the same turn, which is an operator requirement
 * about the seam between the two registers rather than a taste call about line
 * length. `markdown.css`'s measure comment carries both reports and the
 * measured numbers.
 *
 * The type size is separate and unchanged: `text-body` on the § 4 ramp, not
 * the hardcoded `1.05rem` this once used.
 *
 * The `thinking` field renders through `AgentReasoning`, which honours the
 * `showAgentReasoning` preference (default false, § 7).
 */

import { TextSelectionControls } from "@shared/components/common/text-selection-controls";
import { cn } from "@shared/lib/utils";
import React, { type FC, useMemo, useRef } from "react";
import type { Message } from "../../types/message";
import { parseReplies } from "../../utils/reply-utils";
import { ReplyPreview } from "../reply-preview";
import { AgentReasoning } from "../trace";
import { MessageControls } from "./message-controls";

// Props for the MessagePaper component
type MessagePaperProps = {
	isUser: boolean;
	children: React.ReactNode;
	content?: string;
	message?: Message;
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
						<div ref={messageContentRef} className={cn("relative")}>
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

		/*
		 * No streaming branch any more. It existed to hand the row to the socket
		 * transport while an in-flight `is_streamable` message was arriving, and that
		 * transport is gone: an incomplete row now paints whatever text it carries
		 * through the ordinary body below, rather than nothing at all.
		 */
		const messageBody = message ? (
			<div
				className={cn("relative w-full break-words text-ink")}
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
				{messageBody}
				{/* One hover affordance carrying copy, speak and the exact time. */}
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
	},
);
