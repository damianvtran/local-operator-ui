/**
 * Hook for managing WebSocket connections to stream message updates
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentExecutionRecord } from "../api/local-operator/types";
import {
	type UpdateMessage,
	WebSocketClient,
	type WebSocketConnectionStatus,
	WebsocketConnectionType,
} from "../api/local-operator/websocket-api";

/**
 * Options for the useWebSocketMessage hook
 */
export type UseWebSocketMessageOptions = {
	/** Base URL of the Local Operator API */
	baseUrl: string;
	/** Message ID to subscribe to */
	messageId: string;
	/** Whether to automatically connect to the WebSocket */
	autoConnect?: boolean;
	/** Whether to automatically reconnect on connection loss */
	autoReconnect?: boolean;
	/** Reconnect interval in milliseconds */
	reconnectInterval?: number;
	/** Maximum number of reconnect attempts */
	maxReconnectAttempts?: number;
	/** Ping interval in milliseconds to keep connection alive */
	pingInterval?: number;
	/** Callback when a message update is received */
	onUpdate?: (update: UpdateMessage) => void;
	/** Callback when the connection status changes */
	onStatusChange?: (status: WebSocketConnectionStatus) => void;
	/** Callback when an error occurs */
	onError?: (error: Error) => void;
};

/**
 * Result of the useWebSocketMessage hook
 */
export type UseWebSocketMessageResult = {
	/** Current message data */
	message: AgentExecutionRecord | null;
	/** Whether the message is complete */
	isComplete: boolean;
	/** Whether the message is streamable */
	isStreamable: boolean;
	/** Current connection status */
	status: WebSocketConnectionStatus;
	/** Connect to the WebSocket */
	connect: () => Promise<void>;
	/** Disconnect from the WebSocket */
	disconnect: () => void;
	/** Whether the message is currently loading */
	isLoading: boolean;
	/** Error that occurred during WebSocket connection or message processing */
	error: Error | null;
};

/**
 * Hook for managing WebSocket connections to stream message updates
 *
 * This hook combines job polling with WebSocket updates to provide a seamless
 * experience for streaming message updates. It handles the following scenarios:
 *
 * 1. Initial job polling to get the message data
 * 2. WebSocket connection to stream updates for the message
 * 3. Reconnection logic if the WebSocket connection is lost
 * 4. Cleanup when the component unmounts
 *
 * @param options - Options for the WebSocket connection
 * @returns The current message data and connection status
 */
export const useWebSocketMessage = (
	options: UseWebSocketMessageOptions,
): UseWebSocketMessageResult => {
	const {
		baseUrl,
		messageId,
		autoConnect = true,
		autoReconnect = true,
		reconnectInterval = 2000,
		maxReconnectAttempts = 5,
		pingInterval = 30000,
		onUpdate,
		onStatusChange,
		onError,
	} = options;

	// State for the message data
	const [message, setMessage] = useState<AgentExecutionRecord | null>(null);
	const [isComplete, setIsComplete] = useState<boolean>(false);
	const [isStreamable, setIsStreamable] = useState<boolean>(false);
	const [status, setStatus] =
		useState<WebSocketConnectionStatus>("disconnected");
	const [error, setError] = useState<Error | null>(null);
	const [isLoading, setIsLoading] = useState<boolean>(false);

	// Refs for the WebSocket client and cleanup function
	const clientRef = useRef<WebSocketClient | null>(null);
	const cleanupRef = useRef<(() => void) | null>(null);
	const connectRef = useRef<(() => Promise<void>) | null>(null);
	// Store the current message in a ref to avoid dependency issues
	const messageRef = useRef<AgentExecutionRecord | null>(null);

	// Keep messageRef in sync with message state
	useEffect(() => {
		messageRef.current = message;
	}, [message]);

	// Connect to the WebSocket
	const connect = useCallback(async () => {
		if (!messageId || !baseUrl) {
			return Promise.reject(new Error("Missing messageId or baseUrl"));
		}

		try {
			setIsLoading(true);
			setError(null);

			// Create a new WebSocket client if one doesn't exist
			if (!clientRef.current) {
				// Use a longer message delay to ensure the connection is fully established
				clientRef.current = new WebSocketClient(
					baseUrl,
					messageId,
					{
						autoReconnect,
						reconnectInterval,
						maxReconnectAttempts,
						pingInterval,
						messageDelay: 350,
					},
					WebsocketConnectionType.MESSAGE,
				);

				// Set up event listeners
				clientRef.current.on("status", (newStatus: unknown) => {
					const typedStatus = newStatus as WebSocketConnectionStatus;
					setStatus(typedStatus);
					onStatusChange?.(typedStatus);
				});

				clientRef.current.on(`update:${messageId}`, (update: unknown) => {
					const typedUpdate = update as UpdateMessage;

					// Use the ref to avoid dependency on message state
					setMessage((prevMessage) => {
						const updatedMessage = !prevMessage
							? (typedUpdate as unknown as AgentExecutionRecord)
							: ({
									...prevMessage,
									...typedUpdate,
								} as AgentExecutionRecord);
						return updatedMessage;
					});

					// Batch state updates to avoid excessive renders
					const isMessageComplete = typedUpdate.is_complete || false;
					const isMessageStreamable = typedUpdate.is_streamable || false;

					if (isMessageComplete) {
						setIsComplete(true);
					}

					if (isMessageStreamable) {
						setIsStreamable(true);
					}

					// Call the onUpdate callback with the updated message
					onUpdate?.(typedUpdate);
				});

				clientRef.current.on("error", (wsError: unknown) => {
					// Ensure we have a proper Error object with a meaningful message
					let typedError: Error;
					if (wsError instanceof Error) {
						typedError = wsError;
					} else if (typeof wsError === "string") {
						typedError = new Error(wsError);
					} else {
						typedError = new Error(`WebSocket error for ${messageId}`);
					}

					console.error(`WebSocket error for ${messageId}:`, typedError);
					setError(typedError);
					onError?.(typedError);
				});

				// Set up cleanup function
				cleanupRef.current = () => {
					if (clientRef.current) {
						clientRef.current.disconnect();
						clientRef.current = null;
					}
				};
			}

			// Connect to the WebSocket
			await clientRef.current.connect();
			setIsLoading(false);
			return Promise.resolve();
		} catch (err) {
			const formattedError =
				err instanceof Error ? err : new Error(String(err));
			console.error(
				`Error connecting to WebSocket for ${messageId}:`,
				formattedError,
			);
			setError(formattedError);
			setIsLoading(false);
			onError?.(formattedError);
			return Promise.reject(formattedError);
		}
	}, [
		messageId,
		baseUrl,
		autoReconnect,
		reconnectInterval,
		maxReconnectAttempts,
		pingInterval,
		onUpdate,
		onStatusChange,
		onError,
	]);

	// Store the connect function in a ref to avoid circular dependencies
	useEffect(() => {
		connectRef.current = connect;
	}, [connect]);

	// Global registry of active WebSocket clients to prevent duplicate connections
	// This is a static variable shared across all instances of the hook
	const globalClientsRef = useRef<Record<string, boolean>>({});

	// Connect to the WebSocket when the component mounts if autoConnect is true
	// This is a separate effect from the cleanup effect to avoid reconnection loops
	useEffect(() => {
		// Skip auto-connect if:
		// 1. autoConnect is false
		// 2. We don't have a messageId or baseUrl
		// 3. We don't have a connect function
		// 4. We already have a client for this messageId
		// 5. There's already a global client for this messageId
		if (
			autoConnect &&
			messageId &&
			baseUrl &&
			connectRef.current &&
			!clientRef.current &&
			!globalClientsRef.current[messageId]
		) {
			const timestamp = new Date().toISOString().substring(11, 23);
			console.log(`[${timestamp}] Auto-connecting WebSocket for ${messageId}`);

			// Mark this messageId as having an active client
			globalClientsRef.current[messageId] = true;

			// Connect with a delay to allow for component stabilization
			setTimeout(() => {
				if (connectRef.current) {
					connectRef.current().catch((err) => {
						console.error(
							`[${timestamp}] Error auto-connecting WebSocket for ${messageId}:`,
							err,
						);
						// Remove from global registry if connection failed
						globalClientsRef.current[messageId] = false;
					});
				}
			}, 500);
		}
	}, [autoConnect, messageId, baseUrl]);

	// Disconnect from the WebSocket
	const disconnect = useCallback(() => {
		if (clientRef.current) {
			clientRef.current.disconnect();
			clientRef.current = null;
		}
		setStatus("disconnected");
	}, []);

	// Connect to the WebSocket when the component mounts
	// This effect only runs once on mount and handles cleanup on unmount
	useEffect(() => {
		// Store a reference to the current cleanup function and messageId
		const currentCleanup = cleanupRef.current;
		const currentMessageId = messageId;

		// Return cleanup function that will be called when component unmounts
		return () => {
			// Set a small delay before cleanup to allow for component re-mounting
			setTimeout(() => {
				// Only run cleanup if we have a cleanup function
				if (currentCleanup) {
					const timestamp = new Date().toISOString().substring(11, 23);
					console.log(
						`[${timestamp}] Running delayed cleanup for WebSocket ${currentMessageId}`,
					);

					// Remove from global registry
					if (globalClientsRef.current[currentMessageId]) {
						globalClientsRef.current[currentMessageId] = false;
					}

					currentCleanup();
				}
			}, 200);
		};
	}, [messageId]); // Empty dependency array ensures this only runs on mount/unmount

	// Update loading state based on WebSocket status
	useEffect(() => {
		setIsLoading(status === "connecting" || status === "reconnecting");
	}, [status]);

	return {
		message,
		isComplete,
		isStreamable,
		status,
		connect,
		disconnect,
		isLoading,
		error,
	};
};
