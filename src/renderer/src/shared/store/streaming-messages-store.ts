/**
 * Streaming Messages Store
 *
 * Manages the state of streaming messages across the application.
 * Provides a persistent store for streaming message content and completion status.
 */

import type { AgentExecutionRecord } from "@shared/api/local-operator/types";
import { create } from "zustand";

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
	 * Get a streaming message
	 * @param messageId - The ID of the message
	 * @returns The streaming message state or null if it doesn't exist
	 */
	getStreamingMessage: (messageId: string) => StreamingMessageState | null;

	/**
	 * Check if a message is streaming
	 * @param messageId - The ID of the message
	 * @returns Whether the message is streaming
	 */
	isMessageStreaming: (messageId: string) => boolean;

	/**
	 * Check if a message streaming is complete
	 * @param messageId - The ID of the message
	 * @returns Whether the message streaming is complete
	 */
	isMessageStreamingComplete: (messageId: string) => boolean;
};

/**
 * Streaming messages store implementation using Zustand
 */
export const useStreamingMessagesStore = create<StreamingMessagesState>(
	(set, get) => ({
		streamingMessages: {},

		updateStreamingMessage: (messageId, content) => {
			set((state) => {
				const existingState = state.streamingMessages[messageId] || {
					content: null,
					isComplete: false,
					lastUpdated: Date.now(),
				};

				return {
					streamingMessages: {
						...state.streamingMessages,
						[messageId]: {
							...existingState,
							content,
							lastUpdated: Date.now(),
						},
					},
				};
			});
		},

		completeStreamingMessage: (messageId, content) => {
			set((state) => {
				return {
					streamingMessages: {
						...state.streamingMessages,
						[messageId]: {
							content,
							isComplete: true,
							lastUpdated: Date.now(),
						},
					},
				};
			});
		},

		getStreamingMessage: (messageId) => {
			return get().streamingMessages[messageId] || null;
		},

		isMessageStreaming: (messageId) => {
			const message = get().streamingMessages[messageId];
			return !!message && !message.isComplete;
		},

		isMessageStreamingComplete: (messageId) => {
			const message = get().streamingMessages[messageId];
			return !!message && message.isComplete;
		},
	}),
);
