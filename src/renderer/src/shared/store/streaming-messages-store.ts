/**
 * Streaming Messages Store
 *
 * Manages the state of streaming messages across the application.
 * Provides a persistent store for streaming message content and completion status.
 */

import type { AgentExecutionRecord } from "@shared/api/local-operator/types";
import { create } from "zustand";

const STREAMING_MESSAGE_MAX_AGE_MS = 15 * 60 * 1000;
const STREAMING_MESSAGE_MAX_ENTRIES = 250;

/**
 * Streaming message state
 */
type StreamingMessageState = {
	/** The content of the streaming message */
	content: AgentExecutionRecord | null;
	/** Whether the streaming is complete */
	isComplete: boolean;
	/** Last updated timestamp */
	lastUpdated: number;
};

/**
 * Streaming messages store state interface
 */
type StreamingMessagesState = {
	/**
	 * Streaming messages organized by message ID
	 */
	streamingMessages: Record<string, StreamingMessageState>;

	/**
	 * Update a streaming message
	 * @param messageId - The ID of the message
	 * @param content - The content of the message
	 */
	updateStreamingMessage: (
		messageId: string,
		content: AgentExecutionRecord,
	) => void;

	/**
	 * Mark a streaming message as complete
	 * @param messageId - The ID of the message
	 * @param content - The final content of the message
	 */
	completeStreamingMessage: (
		messageId: string,
		content: AgentExecutionRecord,
	) => void;

	/**
	 * Prune stale or excessive streaming messages
	 */
	pruneStreamingMessages: () => void;
};

const hasMeaningfulStreamingChange = (
	previous: AgentExecutionRecord | null,
	next: AgentExecutionRecord,
): boolean => {
	if (!previous) return true;

	return (
		previous.is_complete !== next.is_complete ||
		previous.is_streamable !== next.is_streamable ||
		previous.message !== next.message ||
		previous.code !== next.code ||
		previous.stdout !== next.stdout ||
		previous.stderr !== next.stderr ||
		previous.logging !== next.logging ||
		previous.content !== next.content ||
		previous.replacements !== next.replacements ||
		previous.action !== next.action ||
		previous.execution_type !== next.execution_type
	);
};

const pruneMessages = (
	streamingMessages: Record<string, StreamingMessageState>,
	now: number,
): Record<string, StreamingMessageState> => {
	const entries = Object.entries(streamingMessages);

	const activeEntries = entries.filter(
		([_, value]) =>
			!value.isComplete ||
			now - value.lastUpdated < STREAMING_MESSAGE_MAX_AGE_MS,
	);

	if (activeEntries.length <= STREAMING_MESSAGE_MAX_ENTRIES) {
		return Object.fromEntries(activeEntries);
	}

	const sorted = [...activeEntries].sort(
		(a, b) => b[1].lastUpdated - a[1].lastUpdated,
	);
	return Object.fromEntries(sorted.slice(0, STREAMING_MESSAGE_MAX_ENTRIES));
};

/**
 * Streaming messages store implementation using Zustand
 */
export const useStreamingMessagesStore = create<StreamingMessagesState>(
	(set) => ({
		streamingMessages: {},

		updateStreamingMessage: (messageId, content) => {
			set((state) => {
				const now = Date.now();
				const existingState = state.streamingMessages[messageId] || {
					content: null,
					isComplete: false,
					lastUpdated: now,
				};

				if (
					!existingState.isComplete &&
					!hasMeaningfulStreamingChange(existingState.content, content)
				) {
					return state;
				}

				const nextMessages = {
					...state.streamingMessages,
					[messageId]: {
						...existingState,
						content,
						lastUpdated: now,
					},
				};

				return {
					streamingMessages: pruneMessages(nextMessages, now),
				};
			});
		},

		completeStreamingMessage: (messageId, content) => {
			set((state) => {
				const now = Date.now();
				const existingState = state.streamingMessages[messageId];
				if (
					existingState?.isComplete &&
					!hasMeaningfulStreamingChange(existingState.content, content)
				) {
					return state;
				}

				const nextMessages = {
					...state.streamingMessages,
					[messageId]: {
						content,
						isComplete: true,
						lastUpdated: now,
					},
				};

				return {
					streamingMessages: pruneMessages(nextMessages, now),
				};
			});
		},

		pruneStreamingMessages: () => {
			set((state) => {
				const now = Date.now();
				const prunedMessages = pruneMessages(state.streamingMessages, now);
				if (
					Object.keys(prunedMessages).length ===
					Object.keys(state.streamingMessages).length
				) {
					return state;
				}

				return {
					streamingMessages: prunedMessages,
				};
			});
		},
	}),
);
