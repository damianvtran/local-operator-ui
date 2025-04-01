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
import { useEffect, useRef, useCallback, useState } from "react";
import { createLocalOperatorClient } from "../api/local-operator";
import type { AgentExecutionRecord } from "../api/local-operator/types";
import { useWebSocketMessage } from "./use-websocket-message";
import { apiConfig } from "../config";
import { useStreamingMessagesStore } from "../store/streaming-messages-store";
import { convertToMessage } from "./use-conversation-messages";
import { useChatStore } from "../store/chat-store";

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

	// Track if we've already attempted to connect
	const [hasAttemptedConnection, setHasAttemptedConnection] = useState(false);

	// Track if we're refetching the message
	const [isRefetching, setIsRefetching] = useState(false);

	// Get streaming messages store functions
	const { updateStreamingMessage, completeStreamingMessage } =
		useStreamingMessagesStore();

	// Get chat store functions for updating conversation messages
	const { addMessage, updateMessage } = useChatStore();

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

			// Create a complete message object by merging with existing data
			const messageData = {
				...registryEntry?.messageData,
				...update,
			} as AgentExecutionRecord;

			// If the message is complete, mark it as complete in the store
			if (update.is_complete) {
				completeStreamingMessage(messageId, messageData);

				// Trigger a refetch to get the final state if needed
				if (refetchOnComplete) {
					// Use setTimeout to ensure this happens after the current execution
					setTimeout(() => {
						if (mountedRef.current) {
							refetchMessage().catch((error) => {
								const errorMessage =
									error instanceof Error ? error.message : String(error);
								console.error(`Error auto-refetching message: ${errorMessage}`);
							});
						}
					}, 100);
				}
			} else {
				// Just update the streaming message store for regular updates
				updateStreamingMessage(messageId, messageData);
			}

			// If we have a conversation ID, update the chat store as well
			if (conversationId && messageData.id) {
				const messageForStore = convertToMessage(messageData, conversationId);
				// Try to update the message first, if it doesn't exist, add it
				const updated = updateMessage(conversationId, messageForStore);
				if (!updated) {
					addMessage(conversationId, messageForStore);
				}
			}
		},
	});

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
			const agentId = registryEntry?.conversationId;

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

	/**
	 * Attempt to connect to the WebSocket
	 * This function handles connection state tracking and retries
	 */
	const attemptConnection = useCallback(async () => {
		// Skip if message is already complete
		if (isComplete) {
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
			} catch (error) {
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
	}, [
		wsConnect,
		wsDisconnect,
		isComplete,
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

	// Connect to the WebSocket when the component mounts
	useEffect(() => {
		// Mark component as mounted
		mountedRef.current = true;

		// Connect immediately if autoConnect is true and message is not complete
		if (autoConnect && !isComplete && !hasAttemptedConnection) {
			// Connect immediately without delay
			attemptConnection().catch((error) => {
				console.error(`Initial connection attempt failed: ${error}`);
			});
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
		hasAttemptedConnection,
		keepAlive,
		attemptConnection,
		safeDisconnect,
	]);

	// Call the onComplete callback when the message is complete
	useEffect(() => {
		if (isComplete && message && mountedRef.current) {
			// Make sure the streaming messages store is updated with the complete status
			if (message) {
				completeStreamingMessage(messageId, message);
			}

			// Call the onComplete callback
			if (onComplete) {
				onComplete(message);
			}

			// Trigger a refetch to get the final state if needed
			if (refetchOnComplete) {
				// Use setTimeout to ensure this happens after the current execution
				setTimeout(() => {
					if (mountedRef.current) {
						refetchMessage().catch((error) => {
							const errorMessage =
								error instanceof Error ? error.message : String(error);
							console.error(`Error auto-refetching message: ${errorMessage}`);
						});
					}
				}, 100);
			}

			// Don't disconnect when complete if keepAlive is true
			if (!keepAlive) {
				safeDisconnect();
			}
		}
	}, [
		isComplete,
		message,
		onComplete,
		keepAlive,
		safeDisconnect,
		messageId,
		completeStreamingMessage,
		refetchMessage,
		refetchOnComplete,
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
