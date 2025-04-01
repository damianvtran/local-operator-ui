/**
 * Hook for integrating WebSocket message streaming with the message list
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useWebSocketMessage } from "./use-websocket-message";
import { apiConfig } from "../config";
import type { AgentExecutionRecord } from "../api/local-operator/types";
import type { UpdateMessage } from "../api/local-operator/websocket-api";

type UseMessageStreamingOptions = {
	/** Agent ID to get messages for */
	agentId?: string;
	/** Whether to automatically connect to the WebSocket */
	autoConnect?: boolean;
	/** Callback when a message is updated */
	onMessageUpdate?: (messageId: string, message: AgentExecutionRecord) => void;
};

type UseMessageStreamingResult = {
	/** Map of message IDs to streaming status */
	streamingMessages: Map<string, boolean>;
	/** Start streaming updates for a message */
	startStreaming: (messageId: string) => void;
	/** Stop streaming updates for a message */
	stopStreaming: (messageId: string) => void;
	/** Check if a message is being streamed */
	isStreaming: (messageId: string) => boolean;
	/** Get the current message data */
	getMessage: (messageId: string) => AgentExecutionRecord | null;
	/** Check if a message is complete */
	isComplete: (messageId: string) => boolean;
	/** Check if a message is streamable */
	isStreamable: (messageId: string) => boolean;
	/** Check if a message is loading */
	isLoading: (messageId: string) => boolean;
	/** Get the error for a message */
	getError: (messageId: string) => Error | null;
};

/**
 * Hook for integrating WebSocket message streaming with the message list
 *
 * This hook manages WebSocket connections for multiple messages and provides
 * a unified interface for streaming updates.
 *
 * @param options - Options for the hook
 * @returns The message streaming result
 */
export const useMessageStreaming = (
	options: UseMessageStreamingOptions = {},
): UseMessageStreamingResult => {
	const { autoConnect = true, onMessageUpdate } = options;

	// State for tracking streaming messages
	const [streamingMessages, setStreamingMessages] = useState<
		Map<string, boolean>
	>(new Map());

	// Refs for tracking message data
	const messageDataRef = useRef<Map<string, AgentExecutionRecord | null>>(
		new Map(),
	);
	const completeStatusRef = useRef<Map<string, boolean>>(new Map());
	const streamableStatusRef = useRef<Map<string, boolean>>(new Map());
	const loadingStatusRef = useRef<Map<string, boolean>>(new Map());
	const errorRef = useRef<Map<string, Error | null>>(new Map());
	const clientsRef = useRef<
		Map<string, ReturnType<typeof useWebSocketMessage>>
	>(new Map());

	// Start streaming updates for a message
	const startStreaming = useCallback(
		(messageId: string) => {
			if (!messageId) {
				console.warn("Cannot start streaming for empty messageId");
				return;
			}

			// Check if we're already streaming this message
			if (streamingMessages.has(messageId)) {
				console.log(`Already streaming message ${messageId}`);
				return;
			}

			console.log(`Starting streaming for message ${messageId}`);

			// Add the message to the streaming messages map
			setStreamingMessages((prev) => {
				const newMap = new Map(prev);
				newMap.set(messageId, true);
				return newMap;
			});

			try {
				// Create a WebSocket client for the message
				const client = useWebSocketMessage({
					baseUrl: apiConfig.baseUrl,
					messageId,
					autoConnect,
					// Increase reconnect attempts for more resilience
					maxReconnectAttempts: 5,
					// Add a longer ping interval to keep connection alive
					pingInterval: 20000,
					onUpdate: (update: UpdateMessage) => {
						console.log(`Update for message ${messageId}:`, update.type);

						// Update the message data
						const currentData = messageDataRef.current.get(messageId) || null;
						const newData = {
							...currentData,
							...update,
						} as AgentExecutionRecord;

						// Store the updated message data
						messageDataRef.current.set(messageId, newData);

						// Update the complete and streamable status
						if (update.is_complete) {
							console.log(`Message ${messageId} is complete`);
							completeStatusRef.current.set(messageId, true);
						}
						if (update.is_streamable) {
							console.log(`Message ${messageId} is streamable`);
							streamableStatusRef.current.set(messageId, true);
						}

						// Call the onMessageUpdate callback
						if (onMessageUpdate) {
							onMessageUpdate(messageId, newData);
						}
					},
					onStatusChange: (status) => {
						console.log(`WebSocket status for ${messageId}: ${status}`);

						// Update the loading status
						loadingStatusRef.current.set(
							messageId,
							status === "connecting" || status === "reconnecting",
						);
					},
					onError: (error) => {
						console.error(`WebSocket error for ${messageId}:`, error);

						// Store the error
						errorRef.current.set(messageId, error);
					},
				});

				// Store the client
				clientsRef.current.set(messageId, client);
			} catch (error) {
				console.error(
					`Error creating WebSocket client for ${messageId}:`,
					error,
				);
				errorRef.current.set(
					messageId,
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		},
		[autoConnect, onMessageUpdate, streamingMessages],
	);

	// Stop streaming updates for a message
	const stopStreaming = useCallback((messageId: string) => {
		if (!messageId) return;

		console.log(`Stopping streaming for message ${messageId}`);

		// Remove the message from the streaming messages map
		setStreamingMessages((prev) => {
			const newMap = new Map(prev);
			newMap.delete(messageId);
			return newMap;
		});

		// Get the client for the message
		const client = clientsRef.current.get(messageId);
		if (client) {
			// Disconnect the client
			try {
				client.disconnect();
				console.log(`Disconnected WebSocket client for ${messageId}`);
			} catch (error) {
				console.error(
					`Error disconnecting WebSocket client for ${messageId}:`,
					error,
				);
			}
			clientsRef.current.delete(messageId);
		}

		// Clean up any stored data
		messageDataRef.current.delete(messageId);
		completeStatusRef.current.delete(messageId);
		streamableStatusRef.current.delete(messageId);
		loadingStatusRef.current.delete(messageId);
		errorRef.current.delete(messageId);
	}, []);

	// Check if a message is being streamed
	const isStreaming = useCallback(
		(messageId: string) => {
			return (
				streamingMessages.has(messageId) &&
				streamingMessages.get(messageId) === true
			);
		},
		[streamingMessages],
	);

	// Get the current message data
	const getMessage = useCallback((messageId: string) => {
		return messageDataRef.current.get(messageId) || null;
	}, []);

	// Check if a message is complete
	const isComplete = useCallback((messageId: string) => {
		return completeStatusRef.current.get(messageId) || false;
	}, []);

	// Check if a message is streamable
	const isStreamable = useCallback((messageId: string) => {
		return streamableStatusRef.current.get(messageId) || false;
	}, []);

	// Check if a message is loading
	const isLoading = useCallback((messageId: string) => {
		return loadingStatusRef.current.get(messageId) || false;
	}, []);

	// Get the error for a message
	const getError = useCallback((messageId: string) => {
		return errorRef.current.get(messageId) || null;
	}, []);

	// Clean up when the component unmounts
	useEffect(() => {
		return () => {
			console.log("Cleaning up all WebSocket clients");

			// Disconnect all clients
			for (const [messageId, client] of clientsRef.current.entries()) {
				try {
					client.disconnect();
					console.log(`Disconnected WebSocket client for ${messageId}`);
				} catch (error) {
					console.error(
						`Error disconnecting WebSocket client for ${messageId}:`,
						error,
					);
				}
			}

			// Clear all refs
			clientsRef.current.clear();
			messageDataRef.current.clear();
			completeStatusRef.current.clear();
			streamableStatusRef.current.clear();
			loadingStatusRef.current.clear();
			errorRef.current.clear();
		};
	}, []);

	return {
		streamingMessages,
		startStreaming,
		stopStreaming,
		isStreaming,
		getMessage,
		isComplete,
		isStreamable,
		isLoading,
		getError,
	};
};
