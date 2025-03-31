/**
 * Hook for managing WebSocket connections to stream message updates
 */
import { useEffect, useState, useCallback, useRef } from "react";
import {
	WebSocketClient,
	type WebSocketConnectionStatus,
	type UpdateMessage,
} from "../api/local-operator/websocket-api";
import { createLocalOperatorClient } from "../api/local-operator";
import type {
	AgentExecutionRecord,
	JobDetails,
} from "../api/local-operator/types";
import { useQuery } from "@tanstack/react-query";

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

	// Use React Query to poll for job status
	const {
		data: jobData,
		isLoading: isJobLoading,
		error: jobError,
	} = useQuery({
		queryKey: ["websocket-job", messageId],
		queryFn: async () => {
			if (!messageId || !baseUrl) return null;

			const client = createLocalOperatorClient(baseUrl);
			const response = await client.jobs.getJobStatus(messageId);
			return response.result as JobDetails | null;
		},
		enabled: !!messageId && !!baseUrl,
		refetchInterval: 5000, // Poll every 5 seconds until the message is complete
		refetchIntervalInBackground: true,
		refetchOnWindowFocus: true,
		retry: true,
		retryDelay: 1000,
	});

	// Connect to the WebSocket
	const connect = useCallback(async () => {
		if (!messageId || !baseUrl) {
			return;
		}

		try {
			setIsLoading(true);
			setError(null);

			// Create a new WebSocket client if one doesn't exist
			if (!clientRef.current) {
				clientRef.current = new WebSocketClient(baseUrl, messageId, {
					autoReconnect,
					reconnectInterval,
					maxReconnectAttempts,
					pingInterval,
				});

				// Set up event listeners
				clientRef.current.on("status", (newStatus: unknown) => {
					const typedStatus = newStatus as WebSocketConnectionStatus;
					setStatus(typedStatus);
					onStatusChange?.(typedStatus);
				});

				clientRef.current.on(`update:${messageId}`, (update: unknown) => {
					const typedUpdate = update as UpdateMessage;
					// Update the message data
					setMessage((prev) => {
						if (!prev) return typedUpdate as unknown as AgentExecutionRecord;
						return {
							...prev,
							...typedUpdate,
						} as AgentExecutionRecord;
					});

					// Check if the message is complete
					if (typedUpdate.is_complete) {
						setIsComplete(true);
					}

					// Check if the message is streamable
					if (typedUpdate.is_streamable) {
						setIsStreamable(true);
					}

					// Call the onUpdate callback
					onUpdate?.(typedUpdate);
				});

				clientRef.current.on("error", (wsError: unknown) => {
					const typedError =
						wsError instanceof Error ? wsError : new Error(String(wsError));
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
		} catch (err) {
			setError(err instanceof Error ? err : new Error(String(err)));
			setIsLoading(false);
			onError?.(err instanceof Error ? err : new Error(String(err)));
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

	// Process job data when it changes
	useEffect(() => {
		if (jobData?.current_execution) {
			setMessage(jobData.current_execution);

			// Check if the message is complete or streamable
			const isComplete = jobData.status === "completed";
			const isStreamable = jobData.current_execution?.id === messageId;

			setIsComplete(isComplete);
			setIsStreamable(isStreamable);

			// If the message is streamable and not complete, connect to the WebSocket
			if (isStreamable && !isComplete && autoConnect && connectRef.current) {
				connectRef.current();
			}
		}
	}, [jobData, messageId, autoConnect]);

	// Disconnect from the WebSocket
	const disconnect = useCallback(() => {
		if (clientRef.current) {
			clientRef.current.disconnect();
			clientRef.current = null;
		}
		setStatus("disconnected");
	}, []);

	// Connect to the WebSocket when the component mounts
	useEffect(() => {
		if (
			autoConnect &&
			messageId &&
			baseUrl &&
			isStreamable &&
			!isComplete &&
			connectRef.current
		) {
			connectRef.current();
		}

		// Cleanup when the component unmounts
		return () => {
			if (cleanupRef.current) {
				cleanupRef.current();
			}
		};
	}, [autoConnect, messageId, baseUrl, isStreamable, isComplete]);

	// Update loading state based on job loading and WebSocket status
	useEffect(() => {
		setIsLoading(
			isJobLoading || status === "connecting" || status === "reconnecting",
		);
	}, [isJobLoading, status]);

	// Update error state based on job error
	useEffect(() => {
		if (jobError) {
			const typedError =
				jobError instanceof Error ? jobError : new Error(String(jobError));
			setError(typedError);
		}
	}, [jobError]);

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
