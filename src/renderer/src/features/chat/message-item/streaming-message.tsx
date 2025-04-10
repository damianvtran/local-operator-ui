import { Box, CircularProgress, Typography, styled } from "@mui/material";
/**
 * Component for displaying a streaming message
 *
 * @module StreamingMessage
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AgentExecutionRecord } from "../../../api/local-operator/types";
import { useStreamingMessage } from "../../../hooks/use-streaming-message";
import { useStreamingMessagesStore } from "../../../store/streaming-messages-store";
import { MessageContent } from "./message-content";

// Styled components
const StreamingContainer = styled(Box)(() => ({
	position: "relative",
	overflow: "hidden",
	borderRadius: 8,
	wordBreak: "break-word",
	overflowWrap: "break-word",
}));

const StatusIndicator = styled(Box)(({ theme }) => ({
	position: "absolute",
	top: 0,
	right: 0,
	display: "flex",
	alignItems: "center",
	gap: theme.spacing(0.5),
	padding: theme.spacing(0.5),
	borderRadius: theme.shape.borderRadius,
	backgroundColor: theme.palette.background.paper,
	boxShadow: theme.shadows[1],
	zIndex: 1,
}));

const OutputSection = styled(Box)(({ theme }) => ({
	marginTop: theme.spacing(1),
	padding: theme.spacing(1),
	backgroundColor:
		theme.palette.mode === "dark"
			? theme.palette.grey[900]
			: theme.palette.grey[100],
	borderRadius: theme.shape.borderRadius,
	whiteSpace: "pre-wrap",
	fontFamily: "monospace",
	fontSize: "0.875rem",
}));

/**
 * Props for the StreamingMessage component
 */
type StreamingMessageProps = {
	/** Message ID to subscribe to */
	messageId: string;
	/** Whether to automatically connect to the WebSocket */
	autoConnect?: boolean;
	/** Callback when the message is complete */
	onComplete?: (message: AgentExecutionRecord) => void;
	/** Callback when the message is updated */
	onUpdate?: (message: AgentExecutionRecord) => void;
	/** Whether to show the status indicator */
	showStatus?: boolean;
	/** Whether to show the output sections */
	showOutput?: boolean;
	/** Children to render */
	children?: React.ReactNode;
	/** Callback to get connection controls */
	onConnectionControls?: (controls: {
		connect: () => void;
		disconnect: () => void;
		refetch: () => void;
	}) => void;
	/** Whether to keep the connection alive even after component unmounts */
	keepAlive?: boolean;
	/** Custom styles to apply to the container */
	sx?: React.CSSProperties | Record<string, unknown>;
	/** Custom class name to apply to the container */
	className?: string;
	/** Conversation ID this message belongs to (for updating the chat store) */
	conversationId?: string;
	/** Whether to refetch the message when complete */
	refetchOnComplete?: boolean;
};

/**
 * Component for displaying a streaming message
 *
 * This component uses the useStreamingMessage hook to subscribe to updates
 * for a specific message ID and display the streaming updates.
 * It also integrates with the streaming messages store to provide a seamless
 * transition between streaming and completed messages.
 */
export const StreamingMessage = ({
	messageId,
	autoConnect = true,
	onComplete,
	onUpdate,
	showStatus = true,
	showOutput = true,
	children,
	onConnectionControls,
	keepAlive = true, // Default to keeping connection alive
	sx,
	className,
	conversationId,
	refetchOnComplete = true,
}: StreamingMessageProps) => {
	// Get streaming messages store functions
	const { getStreamingMessage, isMessageStreamingComplete } =
		useStreamingMessagesStore();

	// Get the streaming message from the store
	const storeMessage = getStreamingMessage(messageId);
	const isStoreMessageComplete = isMessageStreamingComplete(messageId);

	// Custom onComplete handler that will trigger a refetch
	const handleComplete = useCallback(
		(completedMessage: AgentExecutionRecord) => {
			// Call the original onComplete callback
			if (onComplete) {
				onComplete(completedMessage);
			}
		},
		[onComplete],
	);

	// Use our streaming message hook to handle WebSocket connections
	const {
		message: wsMessage,
		isStreamable,
		status,
		isLoading,
		isRefetching,
		error,
		connect,
		disconnect,
		refetch,
	} = useStreamingMessage({
		messageId,
		autoConnect,
		onComplete: handleComplete,
		onUpdate,
		keepAlive,
		conversationId,
		refetchOnComplete,
	});

	// Debug logging to help diagnose issues - but throttled to reduce console spam
	const lastLogTimeRef = useRef(0);

	useEffect(() => {
		if (wsMessage) {
			const now = Date.now();
			// Only log every 500ms to avoid excessive logging
			if (now - lastLogTimeRef.current > 500) {
				lastLogTimeRef.current = now;
			}
		}
	}, [wsMessage]);

	// Determine which message to use - store or WebSocket
	// CRITICAL: During active streaming, ALWAYS prioritize the WebSocket message
	// for real-time updates, regardless of what's in the store
	const isActivelyStreaming = useMemo(
		() => status === "connected" && !isStoreMessageComplete,
		[status, isStoreMessageComplete],
	);

	// Always use the WebSocket message when actively streaming
	// This is the key change - we're not checking if wsMessage exists
	// because we want to show real-time updates even if they're empty at first
	// Use a ref to track the last valid message to prevent flickering
	const lastValidMessageRef = useRef<AgentExecutionRecord | null>(null);

	const message = useMemo(() => {
		// If we're actively streaming, ALWAYS use the WebSocket message
		if (isActivelyStreaming && wsMessage) {
			lastValidMessageRef.current = wsMessage;
			return wsMessage;
		}

		// If we're not streaming or the WebSocket message is null,
		// fall back to the store message or the last valid message
		const result =
			storeMessage?.content || wsMessage || lastValidMessageRef.current;

		// Update the last valid message ref if we have a result
		if (result) {
			lastValidMessageRef.current = result;
		}

		return result;
	}, [isActivelyStreaming, wsMessage, storeMessage]);

	// Stable reference to the connection controls - memoized to prevent unnecessary re-renders
	const connectionControls = useMemo(
		() => ({
			connect,
			disconnect,
			refetch,
		}),
		[connect, disconnect, refetch],
	);

	// Provide connection controls to parent component if needed
	useEffect(() => {
		if (onConnectionControls) {
			onConnectionControls(connectionControls);
		}
	}, [onConnectionControls, connectionControls]);

	// Memoized status indicator renderer - only re-render when status or showStatus changes
	const statusIndicator = useMemo(() => {
		if (!showStatus) return null;

		switch (status) {
			case "connecting":
			case "reconnecting":
				return (
					<StatusIndicator>
						<CircularProgress size={16} />
						<Typography variant="caption">
							{status === "connecting" ? "Connecting..." : "Reconnecting..."}
						</Typography>
					</StatusIndicator>
				);
			case "connected":
				return (
					<StatusIndicator>
						<Box
							sx={{
								width: 8,
								height: 8,
								borderRadius: "50%",
								backgroundColor: "success.main",
							}}
						/>
						<Typography variant="caption">Connected</Typography>
					</StatusIndicator>
				);
			case "disconnected":
				return (
					<StatusIndicator>
						<Box
							sx={{
								width: 8,
								height: 8,
								borderRadius: "50%",
								backgroundColor: "text.disabled",
							}}
						/>
						<Typography variant="caption">Disconnected</Typography>
					</StatusIndicator>
				);
			case "error":
				return (
					<StatusIndicator>
						<Box
							sx={{
								width: 8,
								height: 8,
								borderRadius: "50%",
								backgroundColor: "error.main",
							}}
						/>
						<Typography variant="caption">Error</Typography>
					</StatusIndicator>
				);
			default:
				return null;
		}
	}, [status, showStatus]);

	// Memoize the loading indicator to prevent unnecessary re-renders
	const loadingIndicator = useMemo(() => {
		if (!isLoading && !isRefetching) return null;

		return (
			<Box sx={{ display: "flex", alignItems: "center", mt: 1 }}>
				<CircularProgress size={16} sx={{ mr: 1 }} />
				<Typography variant="body2">
					{isRefetching
						? "Refreshing message data..."
						: "Loading message data..."}
				</Typography>
			</Box>
		);
	}, [isLoading, isRefetching]);

	// Memoize the message content to prevent unnecessary re-renders
	const messageContent = useMemo(() => {
		if (!message?.message) return null;
		return <MessageContent content={message.message} isUser={false} />;
	}, [message?.message]);

	// Skeleton loader for when we're connected but waiting for first token
	const skeletonLoader = useMemo(() => {
		// Only show skeleton when we're connected but don't have a message yet
		if (status === "connected" && !message?.message) {
			return (
				<Box sx={{ mt: 1, mb: 1 }}>
					<Box
						sx={{
							height: 16,
							width: "90%",
							backgroundColor: (theme) =>
								theme.palette.mode === "dark"
									? "rgba(255, 255, 255, 0.1)"
									: "rgba(0, 0, 0, 0.1)",
							borderRadius: 1,
							mb: 1,
							animation: "pulse 1.5s ease-in-out infinite",
							"@keyframes pulse": {
								"0%": { opacity: 0.6 },
								"50%": { opacity: 1 },
								"100%": { opacity: 0.6 },
							},
						}}
					/>
					<Box
						sx={{
							height: 16,
							width: "75%",
							backgroundColor: (theme) =>
								theme.palette.mode === "dark"
									? "rgba(255, 255, 255, 0.1)"
									: "rgba(0, 0, 0, 0.1)",
							borderRadius: 1,
							mb: 1,
							animation: "pulse 1.5s ease-in-out 0.2s infinite",
							"@keyframes pulse": {
								"0%": { opacity: 0.6 },
								"50%": { opacity: 1 },
								"100%": { opacity: 0.6 },
							},
						}}
					/>
					<Box
						sx={{
							height: 16,
							width: "60%",
							backgroundColor: (theme) =>
								theme.palette.mode === "dark"
									? "rgba(255, 255, 255, 0.1)"
									: "rgba(0, 0, 0, 0.1)",
							borderRadius: 1,
							animation: "pulse 1.5s ease-in-out 0.4s infinite",
							"@keyframes pulse": {
								"0%": { opacity: 0.6 },
								"50%": { opacity: 1 },
								"100%": { opacity: 0.6 },
							},
						}}
					/>
				</Box>
			);
		}
		return null;
	}, [status, message?.message]);

	// Memoize the output sections to prevent unnecessary re-renders
	const outputSections = useMemo(() => {
		if (!showOutput || !message) return null;

		return (
			<>
				{message.stdout && (
					<OutputSection>
						<Typography variant="caption" sx={{ fontWeight: "bold" }}>
							Output:
						</Typography>
						<Box component="pre" sx={{ mt: 0.5, mb: 0 }}>
							{message.stdout}
						</Box>
					</OutputSection>
				)}

				{message.stderr && (
					<OutputSection
						sx={{
							backgroundColor: "error.main",
							color: "error.contrastText",
						}}
					>
						<Typography variant="caption" sx={{ fontWeight: "bold" }}>
							Error:
						</Typography>
						<Box component="pre" sx={{ mt: 0.5, mb: 0 }}>
							{message.stderr}
						</Box>
					</OutputSection>
				)}
			</>
		);
	}, [showOutput, message]);

	// Memoize the error display to prevent unnecessary re-renders
	const errorDisplay = useMemo(() => {
		if (!error) return null;

		return (
			<Box
				sx={{
					mt: 1,
					p: 1,
					backgroundColor: "error.main",
					color: "error.contrastText",
					borderRadius: 1,
				}}
			>
				<Typography variant="subtitle2">Error:</Typography>
				<Typography variant="body2">{error.message}</Typography>
			</Box>
		);
	}, [error]);

	return (
		<StreamingContainer
			className={`${isStreamable ? "streamable-message" : ""} ${className || ""}`}
			sx={sx}
			data-streaming={isActivelyStreaming ? "true" : "false"}
		>
			{statusIndicator}
			{children}
			{loadingIndicator}
			{messageContent}
			{skeletonLoader}
			{outputSections}
			{errorDisplay}
		</StreamingContainer>
	);
};

// Add display name for debugging
StreamingMessage.displayName = "StreamingMessage";
