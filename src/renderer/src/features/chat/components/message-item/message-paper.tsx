import { Box, Paper, useTheme } from "@mui/material";
import { styled } from "@mui/material/styles";
import { TextSelectionControls } from "@shared/components/common/text-selection-controls";
import { useStreamingMessagesStore } from "@shared/store/streaming-messages-store";
import React, {
	type FC,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { Message } from "../../types/message";
import { parseReplies } from "../../utils/reply-utils";
import { ReplyPreview } from "../reply-preview";
import { ExpandableThinkingContent } from "./expandable-thinking-content";
import { MessageControls } from "./message-controls";
import { MessageTimestamp } from "./message-timestamp";
import { StreamingMessage } from "./streaming-message";

// Create a Paper component with custom styling
const StyledPaper = styled(Paper, {
	shouldForwardProp: (prop) => prop !== "isSmallView",
})<{ isSmallView?: boolean }>(({ theme }) => ({
	[theme.breakpoints.down("sm")]: {
		maxWidth: "85%",
	},
	[theme.breakpoints.between("sm", "md")]: {
		maxWidth: "80%",
	},
	[theme.breakpoints.up("md")]: {
		maxWidth: "80%",
	},
	width: "auto",
	padding: 16,
	backgroundImage: "none",
	borderRadius: 16,
	wordBreak: "break-word",
	overflowWrap: "break-word",
	position: "relative",
}));

// Props for the MessagePaper component
type MessagePaperProps = {
	isUser: boolean;
	elevation?: number;
	children: React.ReactNode;
	content?: string;
	message?: Message;
	onMessageComplete?: () => void;
	isLastMessage: boolean;
	isJobRunning: boolean;
	agentId?: string;
	isSmallView?: boolean;
};

/**
 * Paper component for message content
 * Handles styling based on whether the message is from the user or assistant
 * For a modern AI chat app look, assistant messages don't have a paper boundary
 */
export const MessagePaper: FC<MessagePaperProps> = React.memo(
	({
		isUser,
		elevation = isUser ? 2 : 0,
		children,
		content,
		message,
		onMessageComplete,
		agentId,
		isSmallView,
	}) => {
		const theme = useTheme();
		const messageContentRef = useRef<HTMLDivElement>(null);
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

		// For user messages, we keep the paper boundary
		if (isUser) {
			const childrenWithRemainingContent = React.Children.map(
				children,
				(child: React.ReactNode) => {
					if (React.isValidElement(child) && child.props.content) {
						return React.cloneElement(
							child as React.ReactElement<{
								content: string;
								styleProps: Record<string, unknown>;
							}>,
							{ content: remainingContent, styleProps: markdownStyleProps },
						);
					}
					return child;
				},
			);
			return (
				<Box
					sx={{
						position: "relative",
						width: isSmallView ? "100%" : "calc(100% - 56px)",
						display: "flex",
						justifyContent: "flex-end",
						"&:hover .message-controls": {
							opacity: 1,
						},
					}}
				>
					<StyledPaper
						elevation={elevation}
						isSmallView={isSmallView}
						sx={{
							backgroundColor: theme.palette.userMessage.background,
							border: `1px solid ${theme.palette.userMessage.border}`,
							boxShadow: theme.palette.userMessage.shadow,
							color: theme.palette.text.primary,
						}}
					>
						<Box ref={messageContentRef} sx={{ position: "relative" }}>
							{replies.length > 0 && <ReplyPreview replies={replies} />}
							{childrenWithRemainingContent}
						</Box>
					</StyledPaper>
					{message && (
						<MessageControls
							isUser={isUser}
							content={content}
							messageId={message.id}
							agentId={agentId}
						/>
					)}
				</Box>
			);
		}

		// For assistant messages, we remove the paper boundary and just show text on background
		// Take up the full width of the constraint for a modern chat app look

		// Determine if the message is currently streaming - memoized to prevent unnecessary recalculations
		const isStreamable = useMemo(
			() =>
				message?.is_streamable === true &&
				message?.is_complete === false &&
				!isUser,
			[message?.is_streamable, message?.is_complete, isUser],
		);

		// Check if streaming is truly complete by also checking the streaming messages store
		const isStreamingActuallyComplete = useStreamingMessagesStore((state) =>
			message?.id
				? (state.streamingMessages[message.id]?.isComplete ?? false)
				: true,
		);

		// Final determination of whether to show streaming component
		const shouldShowStreaming = useMemo(() => {
			if (!isStreamable) return false;
			if (isStreamingActuallyComplete) return false;
			return true;
		}, [isStreamable, isStreamingActuallyComplete]);

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

		// Memoize the message styles to prevent unnecessary object creation on each render
		const messageStyles = useMemo(
			() => ({
				borderRadius: 2,
				padding: 0,
				color: theme.palette.text.primary,
				width: isSmallView ? "100%" : "calc(100% - 52px)", // Take full width minus padding
				wordBreak: "break-word",
				overflowWrap: "break-word",
				position: "relative",
			}),
			[theme.palette.text.primary, isSmallView],
		);

		// Memoize the streaming message component to prevent unnecessary re-renders
		const streamingMessageComponent = useMemo(() => {
			if (!shouldShowStreaming || !message) return null;

			return (
				<StreamingMessage
					messageId={message.id}
					autoConnect={true}
					showStatus={false}
					keepAlive={true}
					sx={messageStyles}
					// Pass the conversation ID if available
					conversationId={message.conversation_id}
					refetchOnComplete={true}
					onComplete={() => {
						if (onMessageComplete) {
							onMessageComplete();
						}
					}}
					styleProps={markdownStyleProps}
					compactInProgress={true}
				/>
			);
		}, [
			shouldShowStreaming,
			message,
			messageStyles,
			onMessageComplete,
			markdownStyleProps,
		]);

		// State for expanding thinking content in non-streaming messages
		const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
		const handleThinkingExpand = useCallback(
			() => setIsThinkingExpanded(true),
			[],
		);
		const handleThinkingCollapse = useCallback((e: React.MouseEvent) => {
			e.stopPropagation();
			setIsThinkingExpanded(false);
		}, []);

		// Memoize the regular message components to prevent unnecessary re-renders
		const regularMessageComponents =
			useMemo(() => {
				if (shouldShowStreaming || !message) return null;

				const childrenWithRemainingContent = React.Children.map(
					children,
					(child: React.ReactNode) => {
						if (React.isValidElement(child) && child.props.content) {
							return React.cloneElement(
								child as React.ReactElement<{
									content: string;
									styleProps: Record<string, unknown>;
								}>,
								{ content: remainingContent, styleProps: markdownStyleProps },
							);
						}
						return child;
					},
				);

				return (
					<Box sx={messageStyles} ref={messageContentRef}>
						{replies.length > 0 && <ReplyPreview replies={replies} />}
						{message.thinking && !isUser && (
							<ExpandableThinkingContent
								thinking={message.thinking}
								isExpanded={isThinkingExpanded}
								onExpand={handleThinkingExpand}
								onCollapse={handleThinkingCollapse}
							/>
						)}
						{childrenWithRemainingContent}
						{message?.conversation_id && (
							<TextSelectionControls
								agentId={agentId}
								targetRef={messageContentRef}
								isUser={isUser}
								conversationId={message.conversation_id}
								showSpeech
								showCopy
								showReply
							/>
						)}
					</Box>
				);
			}, [
				shouldShowStreaming,
				message,
				messageStyles,
				children,
				isUser,
				isThinkingExpanded,
				handleThinkingExpand,
				handleThinkingCollapse,
				agentId,
				replies,
				remainingContent,
				markdownStyleProps,
			]) || null;

		return (
			<Box
				sx={{
					position: "relative",
					width: isSmallView ? "100%" : "calc(100% - 56px)",
					"&:hover .message-controls": {
						// This hover effect is for when MessageControls is not explicitly hidden by streaming state
						opacity: 1,
					},
				}}
			>
				{streamingMessageComponent}
				{regularMessageComponents}
				{/* MessageTimestamp: always rendered, conditionally visible/interactive */}
				{message && (
					<MessageTimestamp
						timestamp={message.timestamp}
						isUser={isUser}
						isSmallView={isSmallView}
						sx={{
							opacity: isStreamable ? 0 : 1,
							pointerEvents: isStreamable ? "none" : "auto",
							transition: theme.transitions.create("opacity", {
								duration: theme.transitions.duration.short,
							}),
						}}
					/>
				)}
				{/* MessageControls: always rendered, conditionally visible/interactive */}
				{message && (
					<MessageControls
						isUser={isUser}
						content={content}
						messageId={message.id}
						agentId={agentId}
						sx={{
							// When streaming, force opacity 0 and disable pointer events.
							// This inline style for opacity will override the parent's hover rule.
							...(isStreamable && {
								opacity: 0,
								pointerEvents: "none",
							}),
							// Assuming MessageControls has its own transition for opacity changes (e.g., for hover).
							// If not, a transition could be added here for when isStreamable changes.
						}}
					/>
				)}
			</Box>
		);
	},
);
