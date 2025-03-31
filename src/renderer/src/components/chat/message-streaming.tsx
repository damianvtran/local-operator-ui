/**
 * Component for streaming message updates via WebSocket
 */
import { useEffect, useState } from "react";
import {
	Box,
	Typography,
	Paper,
	CircularProgress,
	styled,
} from "@mui/material";
import { useWebSocketMessage } from "../../hooks/use-websocket-message";
import { apiConfig } from "../../config";
import type { AgentExecutionRecord } from "../../api/local-operator/types";
import type {
	UpdateMessage,
	WebSocketConnectionStatus,
} from "../../api/local-operator/websocket-api";

// Styled components
const StreamingContainer = styled(Paper)(({ theme }) => ({
	padding: theme.spacing(2),
	marginBottom: theme.spacing(2),
	backgroundColor: theme.palette.background.paper,
	borderRadius: theme.shape.borderRadius,
	position: "relative",
	overflow: "hidden",
}));

const StatusIndicator = styled(Box)(({ theme }) => ({
	position: "absolute",
	top: theme.spacing(1),
	right: theme.spacing(1),
	display: "flex",
	alignItems: "center",
	gap: theme.spacing(1),
}));

const MessageContent = styled(Box)(({ theme }) => ({
	marginTop: theme.spacing(1),
	whiteSpace: "pre-wrap",
	wordBreak: "break-word",
}));

const OutputSection = styled(Box)(({ theme }) => ({
	marginTop: theme.spacing(2),
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

const ErrorSection = styled(Box)(({ theme }) => ({
	marginTop: theme.spacing(2),
	padding: theme.spacing(1),
	backgroundColor: theme.palette.error.main,
	color: theme.palette.error.contrastText,
	borderRadius: theme.shape.borderRadius,
}));

interface MessageStreamingProps {
	/** Message ID to subscribe to */
	messageId: string;
	/** Whether to automatically connect to the WebSocket */
	autoConnect?: boolean;
	/** Callback when the message is complete */
	onComplete?: (message: AgentExecutionRecord) => void;
}

/**
 * Component for streaming message updates via WebSocket
 *
 * This component uses the useWebSocketMessage hook to subscribe to updates
 * for a specific message ID and display the streaming updates.
 */
export const MessageStreaming = ({
	messageId,
	autoConnect = true,
	onComplete,
}: MessageStreamingProps) => {
	const [updates, setUpdates] = useState<string[]>([]);

	// Use the WebSocket hook to subscribe to message updates
	const {
		message,
		isComplete,
		isStreamable,
		status,
		connect,
		disconnect,
		isLoading,
		error,
	} = useWebSocketMessage({
		baseUrl: apiConfig.baseUrl,
		messageId,
		autoConnect,
		onUpdate: (update: UpdateMessage) => {
			// Add the update to the list of updates
			if (update.message) {
				setUpdates((prev) => [...prev, `Update: ${update.message}`]);
			}
			if (update.stdout) {
				setUpdates((prev) => [...prev, `Output: ${update.stdout}`]);
			}
			if (update.stderr) {
				setUpdates((prev) => [...prev, `Error: ${update.stderr}`]);
			}
		},
		onStatusChange: (newStatus: WebSocketConnectionStatus) => {
			console.log(`WebSocket status changed: ${newStatus}`);
		},
		onError: (err: Error) => {
			console.error("WebSocket error:", err);
		},
	});

	// Call the onComplete callback when the message is complete
	useEffect(() => {
		if (isComplete && message && onComplete) {
			onComplete(message);
		}
	}, [isComplete, message, onComplete]);

	// Render the status indicator based on the current status
	const renderStatusIndicator = () => {
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
	};

	return (
		<StreamingContainer elevation={1}>
			{renderStatusIndicator()}

			<Typography variant="h6">
				Message Streaming: {messageId}
				{isComplete && " (Complete)"}
				{isStreamable && " (Streamable)"}
			</Typography>

			{isLoading && (
				<Box sx={{ display: "flex", alignItems: "center", mt: 1 }}>
					<CircularProgress size={16} sx={{ mr: 1 }} />
					<Typography variant="body2">Loading message data...</Typography>
				</Box>
			)}

			{message && (
				<MessageContent>
					<Typography variant="body1">{message.message}</Typography>

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

					{updates.length > 0 && (
						<Box sx={{ mt: 2 }}>
							<Typography variant="subtitle2">Updates:</Typography>
							{updates.map((update, index) => (
								<Typography
									key={`update-${messageId}-${index}-${update.substring(0, 10)}`}
									variant="body2"
								>
									{update}
								</Typography>
							))}
						</Box>
					)}
				</MessageContent>
			)}

			{error && (
				<ErrorSection>
					<Typography variant="subtitle2">Error:</Typography>
					<Typography variant="body2">{error.message}</Typography>
				</ErrorSection>
			)}

			{!isComplete && status === "disconnected" && (
				<Box sx={{ mt: 2 }}>
					<button type="button" onClick={() => connect()}>
						Reconnect
					</button>
				</Box>
			)}

			{status === "connected" && (
				<Box sx={{ mt: 2 }}>
					<button type="button" onClick={() => disconnect()}>
						Disconnect
					</button>
				</Box>
			)}
		</StreamingContainer>
	);
};
