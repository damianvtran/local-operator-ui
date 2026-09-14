import { apiConfig } from "@shared/config";
import { useCallback, useEffect, useRef, useState } from "react";
import { createLocalOperatorClient } from "../api/local-operator";
import type { AgentExecutionRecord } from "../api/local-operator/types";
import { useChatStore } from "../store/chat-store";
import { useStreamingMessagesStore } from "../store/streaming-messages-store";
import { convertToMessage } from "./use-conversation-messages";
import { useWebSocketMessage } from "./use-websocket-message";

const CONNECTION_THROTTLE_MS = 1500;
const CHAT_STORE_FLUSH_MS = 80;
const COMPLETE_REFETCH_DELAY_MS = 180;

type TimeoutHandle = ReturnType<typeof setTimeout>;

/**
 * What we need to know about an in-flight message, shared across every
 * component instance pointed at it.
 *
 * The entry is deleted the moment the last instance unmounts. It used to
 * survive, gated on a `keepAlive` flag that the only call site always passed as
 * true, so every streamed message left its full `AgentExecutionRecord` in this
 * map for the life of the session. The flag was not buying anything in
 * exchange: the socket lives in `useWebSocketMessage`, whose cleanup closes it
 * unconditionally, so nothing was being kept alive except the memory.
 */
type RegistryEntry = {
	connected: boolean;
	connecting: boolean;
	connectionPromise: Promise<void> | null;
	instanceCount: number;
	messageData: AgentExecutionRecord | null;
	isComplete: boolean;
	isStreamable: boolean;
	conversationId?: string;
	/**
	 * Closes the socket for this message. Published by the mounted hook so that
	 * a cancellation arriving from outside the component tree — the stop button
	 * in the composer — can tear the connection down instead of waiting for a
	 * render to notice.
	 */
	disconnect: (() => void) | null;
};

const globalConnectionRegistry = new Map<string, RegistryEntry>();

const ensureRegistryEntry = (
	messageId: string,
	conversationId?: string,
): RegistryEntry => {
	const existing = globalConnectionRegistry.get(messageId);
	if (existing) {
		if (conversationId) {
			existing.conversationId = conversationId;
		}
		return existing;
	}

	const created: RegistryEntry = {
		connected: false,
		connecting: false,
		connectionPromise: null,
		instanceCount: 0,
		messageData: null,
		isComplete: false,
		isStreamable: false,
		conversationId,
		disconnect: null,
	};
	globalConnectionRegistry.set(messageId, created);
	return created;
};

/**
 * End every stream belonging to a conversation, as though the backend had sent
 * a final frame.
 *
 * Cancelling a job used to clear the job id and nothing else. The socket stayed
 * open, the store never learned the message was finished, and the reconnect
 * effect below — which only stands down once `isComplete` is true — re-armed
 * itself every 1600ms for the rest of the session, against a job that no longer
 * existed. Marking the stream complete is what actually stops it: it unblocks
 * the reconnect guard, and it lets the message unmount its streaming view.
 *
 * @param conversationId - Agent conversation whose streams should be stopped
 * @returns The message ids that were terminated
 */
export const terminateStreamingMessages = (
	conversationId: string,
): string[] => {
	const { streamingMessages, completeStreamingMessage } =
		useStreamingMessagesStore.getState();

	const terminated: string[] = [];

	for (const [messageId, entry] of globalConnectionRegistry) {
		if (entry.conversationId !== conversationId) continue;

		const known = entry.messageData ?? streamingMessages[messageId]?.content;
		if (known) {
			completeStreamingMessage(messageId, { ...known, is_complete: true });
		}

		entry.disconnect?.();
		globalConnectionRegistry.delete(messageId);
		terminated.push(messageId);
	}

	return terminated;
};

/**
 * Read-only view of the connection registry, for tests and fixtures.
 *
 * The registry's size is what the leak this module fixed is measured in: one
 * entry per message that ever streamed, retained until the process ends. The
 * fixture stories read this to prove entries now disappear when their last
 * listener unmounts or the stream terminates.
 */
export const getStreamingRegistryStats = (): {
	size: number;
	entries: Array<{
		messageId: string;
		connected: boolean;
		isComplete: boolean;
	}>;
} => ({
	size: globalConnectionRegistry.size,
	entries: [...globalConnectionRegistry.entries()].map(
		([messageId, entry]) => ({
			messageId,
			connected: entry.connected,
			isComplete: entry.isComplete,
		}),
	),
});

export type UseStreamingMessageOptions = {
	messageId: string;
	autoConnect?: boolean;
	onComplete?: (message: AgentExecutionRecord) => void;
	onUpdate?: (message: AgentExecutionRecord) => void;
	baseUrl?: string;
	conversationId?: string;
	refetchOnComplete?: boolean;
};

export type UseStreamingMessageResult = {
	message: AgentExecutionRecord | null;
	isComplete: boolean;
	isStreamable: boolean;
	status: string;
	isLoading: boolean;
	isRefetching: boolean;
	error: Error | null;
	connect: () => Promise<void>;
	disconnect: () => void;
	refetch: () => Promise<void>;
};

export const useStreamingMessage = ({
	messageId,
	autoConnect = true,
	onComplete,
	onUpdate,
	baseUrl = apiConfig.baseUrl,
	conversationId,
	refetchOnComplete = true,
}: UseStreamingMessageOptions): UseStreamingMessageResult => {
	const mountedRef = useRef(false);
	const isRegisteredInstanceRef = useRef(false);
	const lastConnectionAttemptRef = useRef(0);
	const completionNotifiedRef = useRef<string | null>(null);
	const wsCompletionHandledRef = useRef(false);
	const refetchTimeoutRef = useRef<TimeoutHandle | null>(null);
	const chatStoreFlushTimeoutRef = useRef<TimeoutHandle | null>(null);
	const pendingChatUpdateRef = useRef<AgentExecutionRecord | null>(null);

	const [isRefetching, setIsRefetching] = useState(false);

	const updateStreamingMessage = useStreamingMessagesStore(
		(state) => state.updateStreamingMessage,
	);
	const completeStreamingMessage = useStreamingMessagesStore(
		(state) => state.completeStreamingMessage,
	);
	const pruneStreamingMessages = useStreamingMessagesStore(
		(state) => state.pruneStreamingMessages,
	);
	const isStoreMessageComplete = useStreamingMessagesStore(
		(state) => state.streamingMessages[messageId]?.isComplete ?? false,
	);

	const addMessage = useChatStore((state) => state.addMessage);
	const updateMessage = useChatStore((state) => state.updateMessage);

	const pushMessageToChatStore = useCallback(
		(messageData: AgentExecutionRecord) => {
			if (!conversationId || !messageData.id) {
				return;
			}

			const messageForStore = convertToMessage(messageData, conversationId);
			const updated = updateMessage(conversationId, messageForStore);
			if (!updated) {
				addMessage(conversationId, messageForStore);
			}
		},
		[conversationId, updateMessage, addMessage],
	);

	const flushPendingChatUpdate = useCallback(() => {
		if (!pendingChatUpdateRef.current) {
			return;
		}

		pushMessageToChatStore(pendingChatUpdateRef.current);
		pendingChatUpdateRef.current = null;
	}, [pushMessageToChatStore]);

	const notifyCompleteOnce = useCallback(
		(messageData: AgentExecutionRecord) => {
			if (!onComplete || !mountedRef.current) {
				return;
			}

			if (completionNotifiedRef.current === messageId) {
				return;
			}

			completionNotifiedRef.current = messageId;
			onComplete(messageData);
		},
		[onComplete, messageId],
	);

	const refetchMessage = useCallback(async () => {
		if (!messageId) {
			return;
		}

		try {
			setIsRefetching(true);

			const client = createLocalOperatorClient(baseUrl);
			const registryEntry = globalConnectionRegistry.get(messageId);
			const agentId = registryEntry?.conversationId || conversationId;
			if (!agentId) {
				return;
			}

			const response = await client.agents.getAgentExecutionHistory(
				agentId,
				1,
				30,
			);
			if (response.status >= 400 || !response.result) {
				throw new Error(response.message || "Failed to fetch message data");
			}

			const messageData = response.result.history.find(
				(record) => record.id === messageId,
			);

			if (messageData) {
				completeStreamingMessage(messageId, messageData);
				const entry = ensureRegistryEntry(messageId, conversationId);
				entry.messageData = messageData;
				entry.isComplete = true;
				entry.isStreamable = !!messageData.is_streamable;
				pushMessageToChatStore(messageData);
				notifyCompleteOnce(messageData);
				return;
			}

			if (registryEntry?.messageData && registryEntry.isComplete) {
				completeStreamingMessage(messageId, registryEntry.messageData);
				pushMessageToChatStore(registryEntry.messageData);
				notifyCompleteOnce(registryEntry.messageData);
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
		conversationId,
		completeStreamingMessage,
		pushMessageToChatStore,
		notifyCompleteOnce,
	]);

	const scheduleCompletionRefetch = useCallback(() => {
		if (!refetchOnComplete || refetchTimeoutRef.current) {
			return;
		}

		refetchTimeoutRef.current = setTimeout(() => {
			refetchTimeoutRef.current = null;
			if (mountedRef.current) {
				void refetchMessage();
			}
		}, COMPLETE_REFETCH_DELAY_MS);
	}, [refetchOnComplete, refetchMessage]);

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
		onUpdate: (update) => {
			if (onUpdate && mountedRef.current) {
				onUpdate(update as AgentExecutionRecord);
			}

			const entry = ensureRegistryEntry(messageId, conversationId);
			const messageData = {
				...entry.messageData,
				...update,
			} as AgentExecutionRecord;

			entry.messageData = messageData;
			entry.isStreamable = Boolean(update.is_streamable || entry.isStreamable);

			if (update.is_complete) {
				entry.isComplete = true;
				completeStreamingMessage(messageId, messageData);
				pendingChatUpdateRef.current = messageData;
				flushPendingChatUpdate();
				notifyCompleteOnce(messageData);
				scheduleCompletionRefetch();
				return;
			}

			updateStreamingMessage(messageId, messageData);

			if (conversationId && messageData.id) {
				pendingChatUpdateRef.current = messageData;
				if (!chatStoreFlushTimeoutRef.current) {
					chatStoreFlushTimeoutRef.current = setTimeout(() => {
						chatStoreFlushTimeoutRef.current = null;
						flushPendingChatUpdate();
					}, CHAT_STORE_FLUSH_MS);
				}
			}
		},
	});

	const attemptConnection = useCallback(async () => {
		if (isComplete || isStoreMessageComplete) {
			return;
		}

		const now = Date.now();
		if (now - lastConnectionAttemptRef.current < CONNECTION_THROTTLE_MS) {
			return;
		}
		lastConnectionAttemptRef.current = now;

		const entry = ensureRegistryEntry(messageId, conversationId);
		if (entry.connected) {
			return;
		}

		if (entry.connectionPromise) {
			try {
				await entry.connectionPromise;
			} catch {
				// A follow-up attempt will be made by the caller/reconnect effect.
			}
			return;
		}

		entry.connecting = true;
		entry.connectionPromise = wsConnect()
			.then(() => {
				const current = globalConnectionRegistry.get(messageId);
				if (current) {
					current.connected = true;
					current.connecting = false;
				}
			})
			.catch((connectionError) => {
				const current = globalConnectionRegistry.get(messageId);
				if (current) {
					current.connected = false;
					current.connecting = false;
				}
				throw connectionError;
			})
			.finally(() => {
				const current = globalConnectionRegistry.get(messageId);
				if (current) {
					current.connectionPromise = null;
				}
			});

		try {
			await entry.connectionPromise;
		} catch (connectionError) {
			console.error("WebSocket connection failed:", connectionError);
		}
	}, [
		isComplete,
		isStoreMessageComplete,
		messageId,
		conversationId,
		wsConnect,
	]);

	const safeDisconnect = useCallback(() => {
		const entry = globalConnectionRegistry.get(messageId);
		if (entry) {
			entry.connected = false;
			entry.connecting = false;
			entry.connectionPromise = null;
			entry.disconnect = null;
			if (entry.instanceCount <= 1) {
				globalConnectionRegistry.delete(messageId);
			}
		}
		wsDisconnect();
	}, [messageId, wsDisconnect]);

	useEffect(() => {
		mountedRef.current = true;
		wsCompletionHandledRef.current = false;
		completionNotifiedRef.current = null;

		// A stream already marked complete in the store — notably one ended by
		// `terminateStreamingMessages`, which deletes its registry entry — must not
		// be re-registered just because this effect re-runs: doing so resurrects the
		// very entry cancellation removed. The unregistration path below only runs
		// for instances this run registered, so the counting stays balanced.
		if (!isStoreMessageComplete) {
			const entry = ensureRegistryEntry(messageId, conversationId);
			entry.disconnect = wsDisconnect;
			if (!isRegisteredInstanceRef.current) {
				entry.instanceCount += 1;
				isRegisteredInstanceRef.current = true;
			}
		}

		let connectTimer: TimeoutHandle | null = null;
		if (autoConnect && !isComplete && !isStoreMessageComplete) {
			connectTimer = setTimeout(() => {
				if (mountedRef.current) {
					void attemptConnection();
				}
			}, 120);
		}

		return () => {
			mountedRef.current = false;

			if (connectTimer) {
				clearTimeout(connectTimer);
			}
			if (refetchTimeoutRef.current) {
				clearTimeout(refetchTimeoutRef.current);
				refetchTimeoutRef.current = null;
			}
			if (chatStoreFlushTimeoutRef.current) {
				clearTimeout(chatStoreFlushTimeoutRef.current);
				chatStoreFlushTimeoutRef.current = null;
			}

			flushPendingChatUpdate();
			pruneStreamingMessages();

			if (isRegisteredInstanceRef.current) {
				const currentEntry = globalConnectionRegistry.get(messageId);
				if (currentEntry) {
					currentEntry.instanceCount = Math.max(
						0,
						currentEntry.instanceCount - 1,
					);
					if (currentEntry.instanceCount === 0) {
						currentEntry.connected = false;
						currentEntry.connecting = false;
						currentEntry.connectionPromise = null;
						currentEntry.disconnect = null;

						// Nobody is listening any more, so the entry — full record and
						// all — goes with it. The completed content lives in the
						// streaming and chat stores, which are the durable homes.
						globalConnectionRegistry.delete(messageId);
						wsDisconnect();
					}
				}
				isRegisteredInstanceRef.current = false;
			}
		};
	}, [
		autoConnect,
		isComplete,
		isStoreMessageComplete,
		attemptConnection,
		messageId,
		conversationId,
		flushPendingChatUpdate,
		pruneStreamingMessages,
		wsDisconnect,
	]);

	useEffect(() => {
		const entry = globalConnectionRegistry.get(messageId);
		if (!entry) {
			return;
		}

		entry.connected = status === "connected";
		entry.connecting = status === "connecting" || status === "reconnecting";
		if (!entry.connecting) {
			entry.connectionPromise = null;
		}
	}, [messageId, status]);

	useEffect(() => {
		if (
			status !== "disconnected" ||
			isComplete ||
			isStoreMessageComplete ||
			!mountedRef.current
		) {
			return;
		}

		const reconnectTimer = setTimeout(() => {
			if (mountedRef.current) {
				void attemptConnection();
			}
		}, 1600);

		return () => clearTimeout(reconnectTimer);
	}, [status, isComplete, isStoreMessageComplete, attemptConnection]);

	useEffect(() => {
		if (!isComplete || !message) {
			wsCompletionHandledRef.current = false;
			return;
		}

		if (wsCompletionHandledRef.current) {
			return;
		}
		wsCompletionHandledRef.current = true;

		const entry = ensureRegistryEntry(messageId, conversationId);
		entry.isComplete = true;
		entry.messageData = message;
		entry.isStreamable = !!message.is_streamable;

		completeStreamingMessage(messageId, message);
		pendingChatUpdateRef.current = message;
		flushPendingChatUpdate();
		notifyCompleteOnce(message);
		scheduleCompletionRefetch();

		// A completed stream has no further frames to deliver, so the socket's
		// work is done. Leaving it open meant relying on the server to close it,
		// and it made "disconnected, reconnect in 1600ms" a reachable state for a
		// stream that will never produce another byte.
		safeDisconnect();
	}, [
		isComplete,
		message,
		messageId,
		conversationId,
		completeStreamingMessage,
		flushPendingChatUpdate,
		notifyCompleteOnce,
		scheduleCompletionRefetch,
		safeDisconnect,
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
