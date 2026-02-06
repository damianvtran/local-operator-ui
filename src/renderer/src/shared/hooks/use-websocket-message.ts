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

const autoConnectLocks = new Set<string>();

type CallbackRefs = {
	onUpdate?: (update: UpdateMessage) => void;
	onStatusChange?: (status: WebSocketConnectionStatus) => void;
	onError?: (error: Error) => void;
};

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

	const [message, setMessage] = useState<AgentExecutionRecord | null>(null);
	const [isComplete, setIsComplete] = useState(false);
	const [isStreamable, setIsStreamable] = useState(false);
	const [status, setStatus] =
		useState<WebSocketConnectionStatus>("disconnected");
	const [error, setError] = useState<Error | null>(null);
	const [isLoading, setIsLoading] = useState(false);

	const clientRef = useRef<WebSocketClient | null>(null);
	const callbackRefs = useRef<CallbackRefs>({
		onUpdate,
		onStatusChange,
		onError,
	});

	useEffect(() => {
		callbackRefs.current = {
			onUpdate,
			onStatusChange,
			onError,
		};
	}, [onUpdate, onStatusChange, onError]);

	const detachClient = useCallback(() => {
		if (!clientRef.current) {
			return;
		}

		clientRef.current.removeAllListeners();
		clientRef.current.disconnect();
		clientRef.current = null;
	}, []);

	const createClient = useCallback(() => {
		if (clientRef.current) {
			return clientRef.current;
		}

		const client = new WebSocketClient(
			baseUrl,
			messageId,
			{
				autoReconnect,
				reconnectInterval,
				maxReconnectAttempts,
				pingInterval,
				messageDelay: 250,
			},
			WebsocketConnectionType.MESSAGE,
		);

		client.on("status", (newStatus: unknown) => {
			const typedStatus = newStatus as WebSocketConnectionStatus;
			setStatus(typedStatus);
			callbackRefs.current.onStatusChange?.(typedStatus);
		});

		client.on(`update:${messageId}`, (update: unknown) => {
			const typedUpdate = update as UpdateMessage;

			setMessage((previous) => {
				if (!previous) {
					return typedUpdate as unknown as AgentExecutionRecord;
				}

				return {
					...previous,
					...typedUpdate,
				} as AgentExecutionRecord;
			});

			if (typeof typedUpdate.is_complete === "boolean") {
				setIsComplete(typedUpdate.is_complete);
			}

			if (typeof typedUpdate.is_streamable === "boolean") {
				setIsStreamable(typedUpdate.is_streamable);
			}

			callbackRefs.current.onUpdate?.(typedUpdate);
		});

		client.on("error", (wsError: unknown) => {
			const typedError =
				wsError instanceof Error
					? wsError
					: new Error(
							typeof wsError === "string"
								? wsError
								: `WebSocket error for ${messageId}`,
						);

			setError(typedError);
			callbackRefs.current.onError?.(typedError);
		});

		clientRef.current = client;
		return client;
	}, [
		baseUrl,
		messageId,
		autoReconnect,
		reconnectInterval,
		maxReconnectAttempts,
		pingInterval,
	]);

	const connect = useCallback(async () => {
		if (!messageId || !baseUrl) {
			throw new Error("Missing messageId or baseUrl");
		}

		setError(null);
		setIsLoading(true);

		const client = createClient();
		const currentStatus = client.getStatus();
		if (
			currentStatus === "connected" ||
			currentStatus === "connecting" ||
			currentStatus === "reconnecting"
		) {
			setIsLoading(false);
			return;
		}

		try {
			await client.connect();
		} catch (connectError) {
			const formattedError =
				connectError instanceof Error
					? connectError
					: new Error(String(connectError));
			setError(formattedError);
			callbackRefs.current.onError?.(formattedError);
			throw formattedError;
		} finally {
			setIsLoading(false);
		}
	}, [messageId, baseUrl, createClient]);

	const disconnect = useCallback(() => {
		detachClient();
		setStatus("disconnected");
		setIsLoading(false);
	}, [detachClient]);

	useEffect(() => {
		if (!autoConnect || !messageId || !baseUrl) {
			return;
		}

		if (autoConnectLocks.has(messageId)) {
			return;
		}

		autoConnectLocks.add(messageId);
		void connect()
			.catch((connectError) => {
				console.warn(
					`Error auto-connecting WebSocket for ${messageId}:`,
					connectError,
				);
			})
			.finally(() => {
				autoConnectLocks.delete(messageId);
			});
	}, [autoConnect, messageId, baseUrl, connect]);

	useEffect(() => {
		return () => {
			autoConnectLocks.delete(messageId);
			disconnect();
		};
	}, [messageId, disconnect]);

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
