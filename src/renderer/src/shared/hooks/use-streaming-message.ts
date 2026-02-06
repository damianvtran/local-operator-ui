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

type RegistryEntry = {
	connected: boolean;
	connecting: boolean;
	connectionPromise: Promise<void> | null;
	keepAlive: boolean;
	instanceCount: number;
	messageData: AgentExecutionRecord | null;
	isComplete: boolean;
	isStreamable: boolean;
	conversationId?: string;
};

const globalConnectionRegistry = new Map<string, RegistryEntry>();

const ensureRegistryEntry = (
	messageId: string,
	keepAlive: boolean,
	conversationId?: string,
): RegistryEntry => {
	const existing = globalConnectionRegistry.get(messageId);
	if (existing) {
		existing.keepAlive = keepAlive;
		if (conversationId) {
			existing.conversationId = conversationId;
		}
		return existing;
	}

	const created: RegistryEntry = {
		connected: false,
		connecting: false,
		connectionPromise: null,
		keepAlive,
		instanceCount: 0,
		messageData: null,
		isComplete: false,
		isStreamable: false,
		conversationId,
	};
	globalConnectionRegistry.set(messageId, created);
	return created;
};

export type UseStreamingMessageOptions = {
	messageId: string;
	autoConnect?: boolean;
	onComplete?: (message: AgentExecutionRecord) => void;
	onUpdate?: (message: AgentExecutionRecord) => void;
	keepAlive?: boolean;
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
	keepAlive = true,
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
				const entry = ensureRegistryEntry(messageId, keepAlive, conversationId);
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
		keepAlive,
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
		autoConnect: false,
		onUpdate: (update) => {
			if (onUpdate && mountedRef.current) {
				onUpdate(update as AgentExecutionRecord);
			}

			const entry = ensureRegistryEntry(messageId, keepAlive, conversationId);
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

		const entry = ensureRegistryEntry(messageId, keepAlive, conversationId);
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
		keepAlive,
		conversationId,
		wsConnect,
	]);

	const safeDisconnect = useCallback(() => {
		const entry = globalConnectionRegistry.get(messageId);
		if (entry) {
			entry.keepAlive = false;
			entry.connected = false;
			entry.connecting = false;
			entry.connectionPromise = null;
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

		const entry = ensureRegistryEntry(messageId, keepAlive, conversationId);
		if (!isRegisteredInstanceRef.current) {
			entry.instanceCount += 1;
			isRegisteredInstanceRef.current = true;
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

						if (!currentEntry.keepAlive) {
							globalConnectionRegistry.delete(messageId);
							wsDisconnect();
						}
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
		keepAlive,
		conversationId,
		flushPendingChatUpdate,
		pruneStreamingMessages,
		wsDisconnect,
	]);

	useEffect(() => {
		const entry = ensureRegistryEntry(messageId, keepAlive, conversationId);
		entry.keepAlive = keepAlive;
		if (conversationId) {
			entry.conversationId = conversationId;
		}
	}, [messageId, keepAlive, conversationId]);

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

		const entry = ensureRegistryEntry(messageId, keepAlive, conversationId);
		entry.isComplete = true;
		entry.messageData = message;
		entry.isStreamable = !!message.is_streamable;

		completeStreamingMessage(messageId, message);
		pendingChatUpdateRef.current = message;
		flushPendingChatUpdate();
		notifyCompleteOnce(message);
		scheduleCompletionRefetch();

		if (!keepAlive && entry.instanceCount <= 1) {
			safeDisconnect();
		}
	}, [
		isComplete,
		message,
		messageId,
		keepAlive,
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
