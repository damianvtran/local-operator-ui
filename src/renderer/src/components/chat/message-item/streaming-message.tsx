/**
 * Component for displaying a streaming message
 *
 * @module StreamingMessage
 */
import { useEffect, useRef, useCallback, useState } from "react";
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

/**
 * Global registry to track WebSocket connections across component instances
 * This prevents duplicate connections and handles component remounting
 */
const globalConnectionRegistry = new Map<
	string,
	{
		connected: boolean;
		connecting: boolean;
		timestamp: number;
		instanceCount: number;
		connectionPromise: Promise<void> | null;
		keepAlive: boolean; // New flag to indicate if connection should persist
		wsClient: {
			connect: () => Promise<void>;
			disconnect: () => void;
		} | null; // Store the actual WebSocket client
		messageData: AgentExecutionRecord | null; // Store the message data
		isComplete: boolean; // Store the complete status
		isStreamable: boolean; // Store the streamable status
	}
>();

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
	}) => void;
	/** Whether to keep the connection alive even after component unmounts */
	keepAlive?: boolean;
};

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
	keepAlive = true, // Default to keeping connection alive
}: StreamingMessageProps) => {
	// Generate a stable component ID for logging
	const componentIdRef = useRef(
		`stream-${Math.random().toString(36).substring(2, 9)}`,
	);

	// Track component mount state
	const mountedRef = useRef(false);

	// Track if we've already attempted to connect
	const [hasAttemptedConnection, setHasAttemptedConnection] = useState(false);

	// Helper function for consistent logging with component ID
	const logWithId = useCallback(
		(message: string, level: "log" | "warn" | "error" = "log") => {
			const timestamp = new Date().toISOString().substring(11, 23);
			const prefix = `[${timestamp}][${componentIdRef.current}][${messageId}]`;
			if (level === "warn") {
				console.warn(`${prefix} ${message}`);
			} else if (level === "error") {
				console.error(`${prefix} ${message}`);
			} else {
				console.log(`${prefix} ${message}`);
			}
		},
		[messageId],
	);

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
		autoConnect: false, // We'll handle connection manually
		onUpdate: (update) => {
			// Call the onUpdate callback if component is still mounted
			if (onUpdate && mountedRef.current) {
				onUpdate(update);
			}

			// Also update the global registry
			const registryEntry = globalConnectionRegistry.get(messageId);
			if (registryEntry) {
				registryEntry.messageData = {
					...registryEntry.messageData,
					...update,
				} as AgentExecutionRecord;

				if (update.is_complete) {
					registryEntry.isComplete = true;
				}
				if (update.is_streamable) {
					registryEntry.isStreamable = true;
				}
			}
		},
	});

	/**
	 * Attempt to connect to the WebSocket
	 * This function handles connection state tracking and retries
	 */

	// biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
	const attemptConnection = useCallback(async () => {
		// Skip if message is already complete
		if (isComplete) {
			logWithId("Message is already complete, skipping connection");
			return;
		}

		// Mark that we've attempted a connection
		setHasAttemptedConnection(true);

		// Get or create the registry entry for this message ID
		if (!globalConnectionRegistry.has(messageId)) {
			globalConnectionRegistry.set(messageId, {
				connected: false,
				connecting: false,
				timestamp: Date.now(),
				instanceCount: 0,
				connectionPromise: null,
				keepAlive: keepAlive, // Set the keepAlive flag
				wsClient: null,
				messageData: null,
				isComplete: false,
				isStreamable: false,
			});
		} else {
			// Update the keepAlive flag if it exists
			const entry = globalConnectionRegistry.get(messageId);
			if (entry) {
				entry.keepAlive = keepAlive;
			}
		}

		const registryEntry = globalConnectionRegistry.get(messageId);
		if (!registryEntry) {
			logWithId(
				"Failed to get registry entry, aborting connection attempt",
				"error",
			);
			return;
		}

		// Increment the instance count for this message ID
		registryEntry.instanceCount++;

		// If we're already connected, no need to connect again
		if (registryEntry.connected) {
			logWithId("Already connected to WebSocket, skipping connection attempt");
			return;
		}

		// If we're already connecting, wait for that connection to complete
		if (registryEntry.connecting && registryEntry.connectionPromise) {
			logWithId("Connection already in progress, waiting for it to complete");
			try {
				await registryEntry.connectionPromise;
				logWithId("Existing connection completed successfully");
			} catch (error) {
				logWithId(
					"Existing connection failed, will attempt a new connection",
					"warn",
				);
			}
			return;
		}

		// Start a new connection attempt
		logWithId("Starting new WebSocket connection attempt");
		registryEntry.connecting = true;

		// Create a connection promise that can be shared across instances
		const connectionPromise: Promise<void> = (async () => {
			try {
				logWithId("Connecting to WebSocket");
				await connect();
				logWithId("WebSocket connected successfully");

				// Update registry
				if (globalConnectionRegistry.has(messageId)) {
					const entry = globalConnectionRegistry.get(messageId);
					if (entry) {
						entry.connected = true;
						entry.connecting = false;
						entry.timestamp = Date.now();
						entry.wsClient = { connect, disconnect }; // Store the WebSocket client
					}
				}

				return Promise.resolve();
			} catch (error) {
				// Create a proper error message
				const errorMessage =
					error instanceof Error
						? error.message
						: "Unknown error connecting to WebSocket";

				logWithId(`WebSocket connection failed: ${errorMessage}`, "error");

				// Update registry
				if (globalConnectionRegistry.has(messageId)) {
					const entry = globalConnectionRegistry.get(messageId);
					if (entry) {
						entry.connected = false;
						entry.connecting = false;
						entry.timestamp = Date.now();
					}
				}

				return Promise.reject(error);
			}
		})();

		// Store the connection promise in the registry
		registryEntry.connectionPromise = connectionPromise;

		// Wait for the connection to complete
		try {
			await connectionPromise;
		} catch (error) {
			// Error already logged above
		} finally {
			// Clear the connection promise
			if (globalConnectionRegistry.has(messageId)) {
				const entry = globalConnectionRegistry.get(messageId);
				if (entry) {
					entry.connectionPromise = null;
				}
			}
		}
	}, [connect, isComplete, logWithId, messageId, keepAlive]);

	/**
	 * Safely disconnect from the WebSocket
	 * This function ensures we only disconnect when no instances need the connection
	 */
	const safeDisconnect = useCallback(() => {
		if (!globalConnectionRegistry.has(messageId)) {
			return;
		}

		const registryEntry = globalConnectionRegistry.get(messageId);
		if (!registryEntry) {
			return;
		}

		// Decrement the instance count
		registryEntry.instanceCount = Math.max(0, registryEntry.instanceCount - 1);

		// Only disconnect if this is the last instance and keepAlive is false
		if (registryEntry.instanceCount === 0 && !registryEntry.keepAlive) {
			logWithId(
				"Last instance disconnecting, cleaning up WebSocket connection",
			);

			try {
				disconnect();

				// Update registry
				registryEntry.connected = false;
				registryEntry.connecting = false;
				registryEntry.connectionPromise = null;
				registryEntry.wsClient = null;
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				logWithId(`Error disconnecting WebSocket: ${errorMessage}`, "error");
			}
		} else if (registryEntry.instanceCount === 0 && registryEntry.keepAlive) {
			logWithId(
				"Last instance disconnecting, but keeping WebSocket connection alive due to keepAlive flag",
			);
		} else {
			logWithId(
				`Not disconnecting, ${registryEntry.instanceCount} instances still active`,
			);
		}
	}, [disconnect, logWithId, messageId]);

	// Stable reference to the connection controls
	const connectionControlsRef = useRef({
		connect: attemptConnection,
		disconnect: safeDisconnect,
	});

	// Update the connection controls ref when the functions change
	useEffect(() => {
		connectionControlsRef.current = {
			connect: attemptConnection,
			disconnect: safeDisconnect,
		};
	}, [attemptConnection, safeDisconnect]);

	// Connect to the WebSocket when the component mounts
	// Use a stable dependency array to prevent unnecessary remounts
	// biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
	useEffect(() => {
		// Mark component as mounted
		mountedRef.current = true;
		logWithId(
			`Component mounted with autoConnect=${autoConnect}, isComplete=${isComplete}, keepAlive=${keepAlive}`,
		);

		// Connect immediately if autoConnect is true and message is not complete
		if (autoConnect && !isComplete && !hasAttemptedConnection) {
			// Connect immediately without delay
			attemptConnection().catch((error) => {
				logWithId(`Initial connection attempt failed: ${error}`, "error");
			});
		}

		// Provide connection controls to parent component if needed
		if (onConnectionControls) {
			onConnectionControls(connectionControlsRef.current);
		}

		// Cleanup function that runs when component unmounts
		return () => {
			logWithId("Component unmounting - cleaning up resources");
			mountedRef.current = false;

			// Only disconnect if keepAlive is false
			if (!keepAlive) {
				safeDisconnect();
			} else {
				logWithId(
					"Keeping WebSocket connection alive after unmount due to keepAlive flag",
				);
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [messageId]);

	// Call the onComplete callback when the message is complete
	// biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
	useEffect(() => {
		if (isComplete && message && onComplete && mountedRef.current) {
			logWithId("Message complete, calling onComplete callback");
			onComplete(message);

			// Don't disconnect when complete if keepAlive is true
			if (!keepAlive) {
				logWithId("Message complete, disconnecting WebSocket");
				safeDisconnect();
			} else {
				logWithId(
					"Message complete, but keeping WebSocket connection alive due to keepAlive flag",
				);
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isComplete, message]);

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
		<StreamingContainer className={isStreamable ? "streamable-message" : ""}>
			{renderStatusIndicator()}

			{children}

			{isLoading && (
				<Box sx={{ display: "flex", alignItems: "center", mt: 1 }}>
					<CircularProgress size={16} sx={{ mr: 1 }} />
					<Typography variant="body2">Loading message data...</Typography>
				</Box>
			)}

			{message?.message && (
				<Box component="pre" sx={{ mt: 0.5, mb: 0 }}>
					{message.message}
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

// Add display name for debugging
StreamingMessage.displayName = "StreamingMessage";
