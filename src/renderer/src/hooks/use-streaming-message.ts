/**
 * Hook for managing streaming message connections
 *
 * This hook provides a way to subscribe to streaming message updates from the WebSocket API.
 * It handles connection management, reconnection, and cleanup across component instances.
 *
 * @module useStreamingMessage
 * @example
 * ```tsx
 * const { message, isComplete, isLoading, connect, disconnect } = useStreamingMessage({
 *   messageId: "message-123",
 *   autoConnect: true,
 *   onComplete: (message) => console.log("Message complete", message),
 * });
 *
 * // Use the message data in your component
 * return (
 *   <div>
 *     {isLoading ? <LoadingIndicator /> : <MessageContent content={message?.message} />}
 *   </div>
 * );
 * ```
 */
import { useEffect, useRef, useCallback, useState } from "react";
import type { AgentExecutionRecord } from "../api/local-operator/types";
import { useWebSocketMessage } from "./use-websocket-message";
import { apiConfig } from "../config";

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
		keepAlive: boolean; // Flag to indicate if connection should persist
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
 * Options for the useStreamingMessage hook
 */
export type UseStreamingMessageOptions = {
	/** Message ID to subscribe to */
	messageId: string;
	/** Whether to automatically connect to the WebSocket */
	autoConnect?: boolean;
	/** Callback when the message is complete */
	onComplete?: (message: AgentExecutionRecord) => void;
	/** Callback when the message is updated */
	onUpdate?: (message: AgentExecutionRecord) => void;
	/** Whether to keep the connection alive even after component unmounts */
	keepAlive?: boolean;
	/** Base URL for the WebSocket connection */
	baseUrl?: string;
};

/**
 * Result of the useStreamingMessage hook
 */
export type UseStreamingMessageResult = {
	/** Current message data */
	message: AgentExecutionRecord | null;
	/** Whether the message is complete */
	isComplete: boolean;
	/** Whether the message is streamable */
	isStreamable: boolean;
	/** Current connection status */
	status: string;
	/** Whether the message is currently loading */
	isLoading: boolean;
	/** Error that occurred during WebSocket connection or message processing */
	error: Error | null;
	/** Connect to the WebSocket */
	connect: () => Promise<void>;
	/** Disconnect from the WebSocket */
	disconnect: () => void;
};

/**
 * Hook for managing streaming message connections
 *
 * This hook builds on top of useWebSocketMessage to provide additional functionality:
 * - Global connection registry to prevent duplicate connections
 * - Connection management across component instances
 * - Ability to keep connections alive after component unmounts
 *
 * @param options - Options for the streaming message connection
 * @returns The current message data, connection status, and control functions
 */
export const useStreamingMessage = ({
	messageId,
	autoConnect = true,
	onComplete,
	onUpdate,
	keepAlive = true,
	baseUrl = apiConfig.baseUrl,
}: UseStreamingMessageOptions): UseStreamingMessageResult => {
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
		connect: wsConnect,
		disconnect: wsDisconnect,
	} = useWebSocketMessage({
		baseUrl,
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
				await wsConnect();
				logWithId("WebSocket connected successfully");

				// Update registry
				if (globalConnectionRegistry.has(messageId)) {
					const entry = globalConnectionRegistry.get(messageId);
					if (entry) {
						entry.connected = true;
						entry.connecting = false;
						entry.timestamp = Date.now();
						entry.wsClient = { connect: wsConnect, disconnect: wsDisconnect }; // Store the WebSocket client
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
	}, [wsConnect, wsDisconnect, isComplete, logWithId, messageId, keepAlive]);

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
				wsDisconnect();

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
	}, [wsDisconnect, logWithId, messageId]);

	// Connect to the WebSocket when the component mounts
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
	}, [
		autoConnect,
		isComplete,
		hasAttemptedConnection,
		keepAlive,
		attemptConnection,
		safeDisconnect,
		logWithId,
	]);

	// Call the onComplete callback when the message is complete
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
	}, [isComplete, message, onComplete, keepAlive, safeDisconnect, logWithId]);

	return {
		message,
		isComplete,
		isStreamable,
		status,
		isLoading,
		error,
		connect: attemptConnection,
		disconnect: safeDisconnect,
	};
};
