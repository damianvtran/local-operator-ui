import { apiConfig } from "@shared/config";
/**
 * Hook for managing streaming message connections
 *
 * This hook provides a way to subscribe to streaming message updates from the WebSocket API.
 * It handles connection management, reconnection, and cleanup across component instances.
 * It also integrates with the streaming messages store to provide a seamless transition
 * between streaming and completed messages.
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
import { useCallback, useEffect, useRef, useState } from "react";
import { createLocalOperatorClient } from "../api/local-operator";
import type { AgentExecutionRecord } from "../api/local-operator/types";
import type { UpdateMessage } from "../api/local-operator/websocket-api";
import { useChatStore } from "../store/chat-store";
import { useStreamingMessagesStore } from "../store/streaming-messages-store";
import { convertToMessage } from "./use-conversation-messages";
import { useWebSocketMessage } from "./use-websocket-message";

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
		conversationId?: string; // Store the conversation ID for this message
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
	/** Conversation ID this message belongs to (for updating the chat store) */
	conversationId?: string;
	/** Whether to refetch the message when complete */
	refetchOnComplete?: boolean;
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
	/** Whether the message is currently being refetched */
	isRefetching: boolean;
	/** Error that occurred during WebSocket connection or message processing */
	error: Error | null;
	/** Connect to the WebSocket */
	connect: () => Promise<void>;
	/** Disconnect from the WebSocket */
	disconnect: () => void;
	/** Refetch the message from the API */
	refetch: () => Promise<void>;
};

/**
 * Hook for managing streaming message connections
 *
 * This hook builds on top of useWebSocketMessage to provide additional functionality:
 * - Global connection registry to prevent duplicate connections
 * - Connection management across component instances
 * - Ability to keep connections alive after component unmounts
 * - Integration with streaming messages store
 * - Refetching message when complete
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
	conversationId,
	refetchOnComplete = true,
}: UseStreamingMessageOptions): UseStreamingMessageResult => {
	// Track component mount state
	const mountedRef = useRef(false);
	// Store the last connection attempt timestamp to prevent rapid reconnections
	const lastConnectionAttemptRef = useRef(0);
	// Minimum time between connection attempts in milliseconds
	const CONNECTION_THROTTLE_MS = 2000;

	// Track if we're refetching the message
	const [isRefetching, setIsRefetching] = useState(false);

	// Get streaming messages store functions
	const {
		updateStreamingMessage,
		completeStreamingMessage,
		isMessageStreamingComplete,
	} = useStreamingMessagesStore();

	// Get the streaming message from the store
	const isStoreMessageComplete = isMessageStreamingComplete(messageId);

	// Get chat store functions for updating conversation messages
	const { addMessage, updateMessage } = useChatStore();

	/**
	 * Refetch the message from the API
	 * This is useful when the message is complete and we want to get the final state
	 */
	const refetchMessage = useCallback(async () => {
		if (!messageId) {
			return;
		}

		try {
			setIsRefetching(true);

			const client = createLocalOperatorClient(baseUrl);

			// Find the agent ID from the registry
			const registryEntry = globalConnectionRegistry.get(messageId);
			const agentId = registryEntry?.conversationId || conversationId;

			if (!agentId) {
				return;
			}

			// Get the execution history for this message
			const response = await client.agents.getAgentExecutionHistory(
				agentId,
				1,
				20,
			);

			if (response.status >= 400 || !response.result) {
				throw new Error(response.message || "Failed to fetch message data");
			}

			// Find the message in the history
			const messageData = response.result.history.find(
				(record) => record.id === messageId,
			);

			if (!messageData) {
				return;
			}

			// Update the streaming messages store with the complete message
			completeStreamingMessage(messageId, messageData);

			// Update the global registry
			if (registryEntry) {
				registryEntry.messageData = messageData;
				registryEntry.isComplete = true;
				registryEntry.isStreamable = !!messageData.is_streamable;
			}

			// If we have a conversation ID, update the chat store as well
			if (conversationId) {
				const messageForStore = convertToMessage(messageData, conversationId);
				// Try to update the message first, if it doesn't exist, add it
				const updated = updateMessage(conversationId, messageForStore);
				if (!updated) {
					addMessage(conversationId, messageForStore);
				}
			}

			// Call the onComplete callback if provided
			if (onComplete && mountedRef.current) {
				onComplete(messageData);
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.error(`Error refetching message: ${errorMessage}`);
		} finally {
			setIsRefetching(false);
		}
	}, [
		messageId,
		baseUrl,
		completeStreamingMessage,
		conversationId,
		addMessage,
		updateMessage,
		onComplete,
	]);

	// Memoize the onUpdate callback to prevent unnecessary re-renders
	const handleUpdate = useCallback(
		(update: UpdateMessage) => {
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

			// Create a complete message object by merging with existing data
			const messageData = {
				...registryEntry?.messageData,
				...update,
			} as AgentExecutionRecord;

			// If the message is complete, mark it as complete in the store
			if (update.is_complete) {
				completeStreamingMessage(messageId, messageData);

				// If we have a conversation ID, update the chat store immediately
				if (conversationId && messageData.id) {
					const messageForStore = convertToMessage(messageData, conversationId);
					// Try to update the message first, if it doesn't exist, add it
					const updated = updateMessage(conversationId, messageForStore);
					if (!updated) {
						addMessage(conversationId, messageForStore);
					}
				}

				// Trigger a refetch to get the final state if needed, but only if not already refetching
				if (refetchOnComplete && !isRefetching) {
					// Use setTimeout to ensure this happens after the current execution,
					// giving the backend time to persist the final message state.
					setTimeout(() => {
						if (mountedRef.current) {
							refetchMessage();
						}
					}, 100); // Small delay to ensure immediate updates are processed first
				}
			} else {
				// Just update the streaming message store for regular updates
				updateStreamingMessage(messageId, messageData);

				// If we have a conversation ID, update the chat store as well
				// But throttle these updates to prevent excessive re-renders
				if (conversationId && messageData.id) {
					const messageForStore = convertToMessage(messageData, conversationId);

					// Use a debounced update for chat store to reduce render cycles
					if (!updateChatStoreTimeoutRef.current) {
						updateChatStoreTimeoutRef.current = setTimeout(() => {
							// Try to update the message first, if it doesn't exist, add it
							const updated = updateMessage(conversationId, messageForStore);
							if (!updated) {
								addMessage(conversationId, messageForStore);
							}
							updateChatStoreTimeoutRef.current = null;
						}, 50); // Reduced throttle to 50ms for more responsive updates
					}
				}
			}
		},
		[
			messageId,
			conversationId,
			onUpdate,
			refetchOnComplete,
			updateStreamingMessage,
			completeStreamingMessage,
			updateMessage,
			addMessage,
			isRefetching,
			refetchMessage,
		],
	);

	// Reference to the timeout for throttling chat store updates
	const updateChatStoreTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	// Clean up the timeout on unmount
	useEffect(() => {
		return () => {
			if (updateChatStoreTimeoutRef.current) {
				clearTimeout(updateChatStoreTimeoutRef.current);
				updateChatStoreTimeoutRef.current = null;
			}
		};
	}, []);

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
		onUpdate: handleUpdate,
	});

	/**
	 * Attempt to connect to the WebSocket
	 * This function handles connection state tracking and retries
	 */
	const attemptConnection = useCallback(async () => {
		// Skip if message is already complete
		if (isComplete || isStoreMessageComplete) {
			return;
		}

		// Throttle connection attempts to prevent rapid reconnections
		const now = Date.now();
		if (now - lastConnectionAttemptRef.current < CONNECTION_THROTTLE_MS) {
			return;
		}
		lastConnectionAttemptRef.current = now;

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
				conversationId, // Store the conversation ID
			});
		} else {
			// Update the keepAlive flag if it exists
			const entry = globalConnectionRegistry.get(messageId);
			if (entry) {
				entry.keepAlive = keepAlive;
				if (conversationId) {
					entry.conversationId = conversationId;
				}
			}
		}

		const registryEntry = globalConnectionRegistry.get(messageId);
		if (!registryEntry) {
			console.error(
				"Failed to get registry entry, aborting connection attempt",
			);
			return;
		}

		// Increment the instance count for this message ID
		registryEntry.instanceCount++;

		// If we're already connected, no need to connect again
		if (registryEntry.connected) {
			return;
		}

		// If we're already connecting, wait for that connection to complete
		if (registryEntry.connecting && registryEntry.connectionPromise) {
			try {
				await registryEntry.connectionPromise;
			} catch (_error) {
				console.warn(
					"Existing connection failed, will attempt a new connection",
				);
			}
			return;
		}

		// Start a new connection attempt
		registryEntry.connecting = true;

		// Create a connection promise that can be shared across instances
		const connectionPromise: Promise<void> = (async () => {
			try {
				await wsConnect();

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

				console.error(`WebSocket connection failed: ${errorMessage}`);

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
		} catch (_error) {
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
	}, [
		wsConnect,
		wsDisconnect,
		isComplete,
		isStoreMessageComplete,
		messageId,
		keepAlive,
		conversationId,
	]);

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
				console.error(`Error disconnecting WebSocket: ${errorMessage}`);
			}
		}
	}, [wsDisconnect, messageId]);

	// Connect to the WebSocket when the component mounts or when view is switched back
	useEffect(() => {
		// Mark component as mounted
		mountedRef.current = true;

		// Connect immediately if autoConnect is true and message is not complete
		if (autoConnect && !isComplete && !isStoreMessageComplete) {
			// Use a small delay to avoid connection attempts during rapid renders
			const timer = setTimeout(() => {
				if (mountedRef.current) {
					attemptConnection().catch((error) => {
						console.error(`Initial connection attempt failed: ${error}`);
					});
				}
			}, 100);

			return () => clearTimeout(timer);
		}

		// Cleanup function that runs when component unmounts
		return () => {
			mountedRef.current = false;

			// Only disconnect if keepAlive is false
			if (!keepAlive) {
				safeDisconnect();
			}
		};
	}, [
		autoConnect,
		isComplete,
		isStoreMessageComplete,
		attemptConnection,
		safeDisconnect,
		keepAlive,
	]);

	// Auto-reconnect if disconnected but message is still streamable
	useEffect(() => {
		// If we're disconnected but the message is still streamable and not complete,
		// attempt to reconnect
		if (
			status === "disconnected" &&
			!isComplete &&
			!isStoreMessageComplete &&
			mountedRef.current
		) {
			// Add a delay to avoid immediate reconnection
			const reconnectTimer = setTimeout(() => {
				if (mountedRef.current) {
					attemptConnection().catch((error) => {
						console.error(`Auto-reconnection attempt failed: ${error}`);
					});
				}
			}, 2000);

			return () => clearTimeout(reconnectTimer);
		}

		return undefined;
	}, [status, isComplete, isStoreMessageComplete, attemptConnection]);

	// Call the onComplete callback when the message is complete
	// Note: The primary refetch logic is now handled within handleUpdate
	// This useEffect mainly ensures the store is marked complete and calls the prop callback
	const isCompletePrevRef = useRef(false);

	useEffect(() => {
		// Only trigger if isComplete changed from false to true
		if (
			isComplete &&
			!isCompletePrevRef.current &&
			message &&
			mountedRef.current
		) {
			// Update ref to avoid repeated triggers
			isCompletePrevRef.current = true;

			// Ensure the streaming messages store is updated with the complete status
			// This might be redundant if handleUpdate already did it, but ensures consistency
			completeStreamingMessage(messageId, message);

			// Call the onComplete callback prop if provided
			if (onComplete) {
				onComplete(message);
			}

			// Disconnect if keepAlive is false (refetch is handled in handleUpdate)
			if (!keepAlive) {
				safeDisconnect();
			}
		} else if (!isComplete) {
			isCompletePrevRef.current = false;
		}
	}, [
		isComplete,
		message,
		onComplete,
		keepAlive,
		safeDisconnect,
		messageId,
		completeStreamingMessage,
	]);

	return {
		message,
		isComplete,
		isStreamable,
		status,
		isLoading,
		isRefetching,
		error,
		connect: attemptConnection,
		disconnect: safeDisconnect,
		refetch: refetchMessage,
	};
};
