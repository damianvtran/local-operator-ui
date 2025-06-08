import { Box, Paper, useTheme } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useScrollToBottom } from "@shared/hooks/use-scroll-to-bottom";
import {
	type FC,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { Message } from "../../types/message";
import { ExpandableThinkingContent } from "./expandable-thinking-content";
import { MessageControls } from "./message-controls";
import { MessageTimestamp } from "./message-timestamp";
import { StreamingMessage } from "./streaming-message";
import { TextSelectionControls } from "./text-selection-controls";

// Create a Paper component with custom styling
const StyledPaper = styled(Paper)(({ theme }) => ({
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
};

/**
 * Paper component for message content
 * Handles styling based on whether the message is from the user or assistant
 * For a modern AI chat app look, assistant messages don't have a paper boundary
 */
export const MessagePaper: FC<MessagePaperProps> = ({
	isUser,
	elevation = isUser ? 2 : 0,
	children,
	content,
	message,
	onMessageComplete,
	isLastMessage,
	isJobRunning,
	agentId,
}) => {
	const theme = useTheme();
	const messageContentRef = useRef<HTMLDivElement>(null);

	// For user messages, we keep the paper boundary
	if (isUser) {
		return (
			<Box
				sx={{
					position: "relative",
					width: "calc(100% - 56px)",
					display: "flex",
					justifyContent: "flex-end",
					"&:hover .message-controls": {
						opacity: 1,
					},
				}}
			>
				<StyledPaper
					elevation={elevation}
					sx={{
						backgroundColor: theme.palette.userMessage.background,
						border: `1px solid ${theme.palette.userMessage.border}`,
						boxShadow: theme.palette.userMessage.shadow,
						color: theme.palette.text.primary,
					}}
				>
					<Box ref={messageContentRef} sx={{ position: "relative" }}>
						{children}
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

	// Memoize the message styles to prevent unnecessary object creation on each render
	const messageStyles = useMemo(
		() => ({
			borderRadius: 2,
			padding: 0,
			color: theme.palette.text.primary,
			width: "calc(100% - 52px)", // Take full width minus padding
			wordBreak: "break-word",
			overflowWrap: "break-word",
			position: "relative",
		}),
		[theme.palette.text.primary],
	);

	// Filter out the timestamp from children for assistant messages - memoized to prevent unnecessary recalculations
	const filteredChildren = useMemo(() => {
		// If children is a React element array, filter out the MessageTimestamp component
		if (Array.isArray(children)) {
			return children.filter(
				(child) =>
					child?.type?.displayName !== "MessageTimestamp" &&
					child?.type?.name !== "MessageTimestamp",
			);
		}

		// Otherwise, just return the children as is
		return children;
	}, [children]);

	// Always call hooks at the top level, regardless of conditions
	// Use the simplified scroll hook to track scroll position and scroll to bottom
	const {
		containerRef: scrollRef,
		scrollToBottom,
		isFarFromBottom,
	} = useScrollToBottom();

	// Invert isFarFromBottom to get isNearBottom for compatibility with existing code
	const isNearBottom = !isFarFromBottom;

	// Track if we should auto-scroll based on user's scroll position
	const shouldAutoScrollRef = useRef(true);

	// Periodically scroll to bottom during streaming if user is near bottom
	useEffect(() => {
		// Only run the effect if this is the last message and it's streamable
		if (!isLastMessage || !isStreamable || !message) return;

		// Initialize auto-scroll state based on current position
		shouldAutoScrollRef.current = isNearBottom;

		// Set up interval to check and scroll if needed during streaming
		const scrollInterval = setInterval(() => {
			// Only scroll if the user is near the bottom (using the ref for performance)
			if (shouldAutoScrollRef.current) {
				scrollToBottom();
			}
		}, 350); // Check every 350ms while streaming

		return () => {
			clearInterval(scrollInterval);
		};
	}, [isStreamable, message, scrollToBottom, isNearBottom, isLastMessage]);

	// Update auto-scroll flag when isNearBottom changes
	// This effect is intentionally simple and only depends on isNearBottom
	// to avoid unnecessary re-renders
	useEffect(() => {
		// Update the ref without causing re-renders
		shouldAutoScrollRef.current = isNearBottom;
	}, [isNearBottom]);

	// Memoize the streaming message component to prevent unnecessary re-renders
	const streamingMessageComponent = useMemo(() => {
		if (!isStreamable || !message || !isJobRunning) return null;

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
			/>
		);
	}, [isStreamable, message, messageStyles, onMessageComplete, isJobRunning]);

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
	const regularMessageComponents = useMemo(() => {
		if ((isStreamable && isJobRunning) || !message) return null;

		return (
			<Box sx={messageStyles} ref={messageContentRef}>
				{message.thinking && !isUser && (
					<ExpandableThinkingContent
						thinking={message.thinking}
						isExpanded={isThinkingExpanded}
						onExpand={handleThinkingExpand}
						onCollapse={handleThinkingCollapse}
					/>
				)}
				{filteredChildren}
				{message && (
					<TextSelectionControls
						messageId={message.id}
						agentId={agentId}
						targetRef={messageContentRef}
						isUser={isUser}
					/>
				)}
			</Box>
		);
	}, [
		isStreamable,
		messageStyles,
		filteredChildren,
		message,
		isUser,
		isJobRunning,
		isThinkingExpanded,
		handleThinkingExpand, // Added
		handleThinkingCollapse, // Added
		agentId,
	]);

	return (
		<Box
			sx={{
				position: "relative",
				width: "calc(100% - 56px)",
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
					sx={{
						opacity: isStreamable ? 0 : 1,
						pointerEvents: isStreamable ? "none" : "auto",
						transition: theme.transitions.create("opacity", {
							duration: theme.transitions.duration.short,
						}),
						// Ensure positioning is consistent with how it was before
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
			{/* Invisible element at the bottom for scroll targeting */}
			<div ref={scrollRef} style={{ height: 1, width: 1, opacity: 0 }} />
		</Box>
	);
};
