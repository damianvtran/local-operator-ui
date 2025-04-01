/**
 * Component for displaying a streaming message
 *
 * @module StreamingMessage
 */
import { useEffect, useRef, useCallback, useState } from "react";
import { Box, Typography, CircularProgress, styled } from "@mui/material";
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
	// Track if we should use the store data
	const [useStoreData, setUseStoreData] = useState(true);

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

			// Switch to using the WebSocket data after completion
			setUseStoreData(false);
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

	// Determine which message to use - store or WebSocket
	const message =
		useStoreData && storeMessage?.content ? storeMessage.content : wsMessage;

	// Stable reference to the connection controls
	const connectionControlsRef = useRef({
		connect,
		disconnect,
		refetch,
	});

	// Update the connection controls ref when the functions change
	useEffect(() => {
		connectionControlsRef.current = {
			connect,
			disconnect,
			refetch,
		};
	}, [connect, disconnect, refetch]);

	// Provide connection controls to parent component if needed
	useEffect(() => {
		if (onConnectionControls) {
			onConnectionControls(connectionControlsRef.current);
		}
	}, [onConnectionControls]);

	// Refetch the message when it's complete
	useEffect(() => {
		if (isStoreMessageComplete && refetchOnComplete) {
			// Refetch the message to get the final state
			refetch().catch((error) => {
				console.error(`Error refetching message ${messageId}:`, error);
			});
		}
	}, [isStoreMessageComplete, refetchOnComplete, refetch, messageId]);

	// Memoized status indicator renderer
	const renderStatusIndicator = useCallback(() => {
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

	return (
		<StreamingContainer
			className={`${isStreamable ? "streamable-message" : ""} ${className || ""}`}
			sx={sx}
		>
			{renderStatusIndicator()}

			{children}

			{(isLoading || isRefetching) && (
				<Box sx={{ display: "flex", alignItems: "center", mt: 1 }}>
					<CircularProgress size={16} sx={{ mr: 1 }} />
					<Typography variant="body2">
						{isRefetching
							? "Refreshing message data..."
							: "Loading message data..."}
					</Typography>
				</Box>
			)}

			{message?.message && (
				<MessageContent content={message.message} isUser={false} />
			)}

			{showOutput && message && (
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
			)}

			{error && (
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
			)}
		</StreamingContainer>
	);
};

// Add display name for debugging
StreamingMessage.displayName = "StreamingMessage";
