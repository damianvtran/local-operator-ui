/**
 * Hook for streaming message updates.
 *
 * The transport is chosen at connect time by `StreamingClient`: SSE where the
 * backend offers it, the WebSocket otherwise. Both present the same emitter
 * surface, so everything below this line — the rAF coalescing, the equality
 * gate, the completion handling — is identical on either, and the name is kept
 * so no call site changes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { StreamingClient } from "../api/local-operator/streaming-transport";
import type { AgentExecutionRecord } from "../api/local-operator/types";
import type {
	UpdateMessage,
	WebSocketConnectionStatus,
} from "../api/local-operator/websocket-api";

type CallbackRefs = {
	onUpdate?: (update: UpdateMessage) => void;
	onStatusChange?: (status: WebSocketConnectionStatus) => void;
	onError?: (error: Error) => void;
};

/**
 * Fields whose value decides what is on screen.
 *
 * `timestamp` is deliberately absent. The backend restamps every frame, so
 * including it would make the equality gate below always report a change and
 * the gate would be decorative — which is what it was before it existed: a
 * frame carrying no new text still re-rendered the message.
 */
const RENDERED_FIELDS = [
	"id",
	"message",
	"code",
	"stdout",
	"stderr",
	"logging",
	"content",
	"replacements",
	"thinking",
	"learnings",
	"formatted_print",
	"file_path",
	"agent",
	"action",
	"execution_type",
	"task_classification",
	"role",
	"status",
	"is_complete",
	"is_streamable",
] as const satisfies readonly (keyof AgentExecutionRecord)[];

const hasRenderedChange = (
	previous: AgentExecutionRecord | null,
	next: AgentExecutionRecord,
): boolean => {
	if (!previous) return true;

	for (const field of RENDERED_FIELDS) {
		if (previous[field] !== next[field]) return true;
	}

	const previousFiles = previous.files;
	const nextFiles = next.files;
	if (previousFiles === nextFiles) return false;
	if (!previousFiles || !nextFiles) return true;
	if (previousFiles.length !== nextFiles.length) return true;
	return previousFiles.some((file, index) => file !== nextFiles[index]);
};

/**
 * Options for the useWebSocketMessage hook
 */
export type UseWebSocketMessageOptions = {
	/** Base URL of the Local Operator API */
	baseUrl: string;
	/** Message ID to subscribe to */
	messageId: string;
	/** Whether to automatically reconnect on connection loss */
	autoReconnect?: boolean;
	/** Reconnect interval in milliseconds */
	reconnectInterval?: number;
	/** Maximum number of reconnect attempts */
	maxReconnectAttempts?: number;
	/** Ping interval in milliseconds to keep connection alive */
	pingInterval?: number;
	/** Callback when a coalesced message update is applied */
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
 * Hook for managing WebSocket connections to stream message updates.
 *
 * ## Frame coalescing
 *
 * Every socket frame carries the entire execution record rather than a delta,
 * and frames arrive far faster than the screen refreshes — a 25KB answer at 20
 * chars per chunk is roughly 1,250 of them. Applying each one as state drove a
 * React render per frame for a screen that can only show sixty.
 *
 * So frames merge into a pending record and are applied on the next animation
 * frame: at most one render per frame, whatever the arrival rate. Because the
 * payload is cumulative rather than incremental, dropping intermediate frames
 * loses nothing — the newest one already contains everything the ones before it
 * carried.
 *
 * Two deliberate exceptions to the rAF path:
 *
 * - A completing frame is applied synchronously. rAF does not run in a hidden
 *   window, and a completion parked behind it would leave the message spinning
 *   until the user came back.
 * - `is_complete` and `is_streamable` are set immediately, because the
 *   connection lifecycle reads them and must not lag a frame behind.
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

	const clientRef = useRef<StreamingClient | null>(null);
	const pendingRef = useRef<AgentExecutionRecord | null>(null);
	const appliedRef = useRef<AgentExecutionRecord | null>(null);
	const frameRef = useRef<number | null>(null);
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

	const applyPending = useCallback(() => {
		frameRef.current = null;
		const pending = pendingRef.current;
		if (!pending) return;
		pendingRef.current = null;

		// The gate that makes coalescing worth having: a frame that repeats what
		// is already on screen — a keepalive, a restamped no-op — costs nothing.
		if (
			!pending.is_complete &&
			!hasRenderedChange(appliedRef.current, pending)
		) {
			return;
		}

		appliedRef.current = pending;
		setMessage(pending);
		callbackRefs.current.onUpdate?.(pending as unknown as UpdateMessage);
	}, []);

	const detachClient = useCallback(() => {
		if (frameRef.current !== null) {
			cancelAnimationFrame(frameRef.current);
			frameRef.current = null;
		}
		pendingRef.current = null;

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

		const client = new StreamingClient(baseUrl, messageId, {
			websocket: {
				autoReconnect,
				reconnectInterval,
				maxReconnectAttempts,
				pingInterval,
				messageDelay: 250,
			},
			sse: { autoReconnect, maxReconnectAttempts },
		});

		client.on("status", (newStatus: unknown) => {
			const typedStatus = newStatus as WebSocketConnectionStatus;
			setStatus(typedStatus);
			callbackRefs.current.onStatusChange?.(typedStatus);
		});

		client.on(`update:${messageId}`, (update: unknown) => {
			const typedUpdate = update as UpdateMessage;

			pendingRef.current = {
				...(pendingRef.current ?? appliedRef.current),
				...typedUpdate,
			} as AgentExecutionRecord;

			if (typeof typedUpdate.is_complete === "boolean") {
				setIsComplete(typedUpdate.is_complete);
			}

			if (typeof typedUpdate.is_streamable === "boolean") {
				setIsStreamable(typedUpdate.is_streamable);
			}

			if (typedUpdate.is_complete) {
				if (frameRef.current !== null) {
					cancelAnimationFrame(frameRef.current);
				}
				applyPending();
				return;
			}

			if (frameRef.current === null) {
				frameRef.current = requestAnimationFrame(applyPending);
			}
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
		applyPending,
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

	// `messageId` is in the dependency list even though nothing in the body
	// reads it: the client is built for one message id, so a hook instance
	// pointed at a different message must drop the old socket rather than keep
	// listening on it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: messageId change must tear down the old socket
	useEffect(() => {
		return () => {
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
