/**
 * Component for displaying a streaming message
 */
import { useEffect } from "react";
import { Box, Typography, CircularProgress, styled } from "@mui/material";
import type { AgentExecutionRecord } from "../../../api/local-operator/types";
import { useWebSocketMessage } from "../../../hooks/use-websocket-message";
import { apiConfig } from "../../../config";

// Styled components
const StreamingContainer = styled(Box)(() => ({
	position: "relative",
	overflow: "hidden",
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

interface StreamingMessageProps {
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
	}) => void;
}

/**
 * Component for displaying a streaming message
 *
 * This component uses the useWebSocketMessage hook to subscribe to updates
 * for a specific message ID and display the streaming updates.
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
}: StreamingMessageProps) => {
	// Use the WebSocket hook to subscribe to message updates
	const {
		message,
		isComplete,
		isStreamable,
		status,
		isLoading,
		error,
		connect,
		disconnect,
	} = useWebSocketMessage({
		baseUrl: apiConfig.baseUrl,
		messageId,
		autoConnect,
		onUpdate: (_update) => {
			// Call the onUpdate callback
			if (onUpdate && message) {
				onUpdate(message);
			}
		},
	});

	// Provide connection controls to parent component if needed
	useEffect(() => {
		if (onConnectionControls) {
			onConnectionControls({ connect, disconnect });
		}
	}, [connect, disconnect, onConnectionControls]);

	// Call the onComplete callback when the message is complete
	useEffect(() => {
		if (isComplete && message && onComplete) {
			onComplete(message);
		}
	}, [isComplete, message, onComplete]);

	// Render the status indicator based on the current status
	const renderStatusIndicator = () => {
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
	};

	return (
		<StreamingContainer className={isStreamable ? "streamable-message" : ""}>
			{renderStatusIndicator()}

			{children}

			{isLoading && (
				<Box sx={{ display: "flex", alignItems: "center", mt: 1 }}>
					<CircularProgress size={16} sx={{ mr: 1 }} />
					<Typography variant="body2">Loading message data...</Typography>
				</Box>
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
