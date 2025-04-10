/**
 * Message History Store
 *
 * Manages user message history for navigation with arrow keys.
 * Stores the current message draft and history position for each conversation.
 */

import type { Message } from "@renderer/features/chat/types";
import { create } from "zustand";

/**
 * Type for storing message history state for a specific conversation
 */
type ConversationHistoryState = {
	/**
	 * The current message draft being edited
	 */
	currentMessage: string;

	/**
	 * The ID of the last accessed message in history
	 * Used for navigating through history with arrow keys
	 */
	currentSequenceId: string | null;
};

/**
 * Message history store state interface
 */
type MessageHistoryState = {
	/**
	 * History state by conversation ID
	 */
	historyByConversation: Record<string, ConversationHistoryState>;

	/**
	 * Set the current message draft for a conversation
	 * @param conversationId - The ID of the conversation
	 * @param message - The current message draft
	 */
	setCurrentMessage: (conversationId: string, message: string) => void;

	/**
	 * Get the current message draft for a conversation
	 * @param conversationId - The ID of the conversation
	 * @returns The current message draft or empty string if none exists
	 */
	getCurrentMessage: (conversationId: string) => string;

	/**
	 * Set the current sequence ID for a conversation
	 * @param conversationId - The ID of the conversation
	 * @param sequenceId - The ID of the current message in history
	 */
	setCurrentSequenceId: (
		conversationId: string,
		sequenceId: string | null,
	) => void;

	/**
	 * Get the current sequence ID for a conversation
	 * @param conversationId - The ID of the conversation
	 * @returns The current sequence ID or null if none exists
	 */
	getCurrentSequenceId: (conversationId: string) => string | null;

	/**
	 * Reset the history state for a conversation
	 * @param conversationId - The ID of the conversation to reset
	 */
	resetHistory: (conversationId: string) => void;

	/**
	 * Clear history for a specific conversation
	 * @param conversationId - The ID of the conversation to clear
	 */
	clearConversationHistory: (conversationId: string) => void;
};

/**
 * Message history store implementation using Zustand
 */
export const useMessageHistoryStore = create<MessageHistoryState>(
	(set, get) => ({
		historyByConversation: {},

		setCurrentMessage: (conversationId, message) => {
			set((state) => {
				const existingState = state.historyByConversation[conversationId] || {
					currentMessage: "",
					currentSequenceId: null,
				};

				return {
					historyByConversation: {
						...state.historyByConversation,
						[conversationId]: {
							...existingState,
							currentMessage: message,
						},
					},
				};
			});
		},

		getCurrentMessage: (conversationId) => {
			return get().historyByConversation[conversationId]?.currentMessage || "";
		},

		setCurrentSequenceId: (conversationId, sequenceId) => {
			set((state) => {
				const existingState = state.historyByConversation[conversationId] || {
					currentMessage: "",
					currentSequenceId: null,
				};

				return {
					historyByConversation: {
						...state.historyByConversation,
						[conversationId]: {
							...existingState,
							currentSequenceId: sequenceId,
						},
					},
				};
			});
		},

		getCurrentSequenceId: (conversationId) => {
			return (
				get().historyByConversation[conversationId]?.currentSequenceId || null
			);
		},

		resetHistory: (conversationId) => {
			set((state) => {
				const existingState = state.historyByConversation[conversationId];

				if (!existingState) return state;

				return {
					historyByConversation: {
						...state.historyByConversation,
						[conversationId]: {
							...existingState,
							currentSequenceId: null,
						},
					},
				};
			});
		},

		clearConversationHistory: (conversationId) => {
			set((state) => {
				const { [conversationId]: _, ...rest } = state.historyByConversation;

				return {
					historyByConversation: rest,
				};
			});
		},
	}),
);

/**
 * Hook to get user messages from history for a specific conversation
 *
 * @param conversationId - The ID of the conversation
 * @param messages - All messages in the conversation
 * @returns Object with functions to navigate through user message history
 */
export const useUserMessageHistory = (
	conversationId: string | undefined,
	messages: Message[],
) => {
	const {
		getCurrentMessage,
		setCurrentMessage,
		getCurrentSequenceId,
		setCurrentSequenceId,
		resetHistory,
	} = useMessageHistoryStore();

	/**
	 * Get only user messages from the conversation
	 */
	const userMessages = messages.filter((message) => message.role === "user");

	/**
	 * Get the previous user message from history
	 *
	 * @param currentId - The current message ID in history
	 * @returns The previous message or undefined if at the beginning
	 */
	const getPreviousMessage = (
		currentId: string | null,
	): Message | undefined => {
		if (!userMessages.length) return undefined;

		// If no current ID, return the most recent message
		if (!currentId) {
			return userMessages[userMessages.length - 1];
		}

		// Find the index of the current message
		const currentIndex = userMessages.findIndex((msg) => msg.id === currentId);

		// If not found or at the beginning, return undefined
		if (currentIndex <= 0) return undefined;

		// Return the previous message
		return userMessages[currentIndex - 1];
	};

	/**
	 * Get the next user message from history
	 *
	 * @param currentId - The current message ID in history
	 * @returns The next message or undefined if at the end
	 */
	const getNextMessage = (currentId: string | null): Message | undefined => {
		if (!userMessages.length || !currentId) return undefined;

		// Find the index of the current message
		const currentIndex = userMessages.findIndex((msg) => msg.id === currentId);

		// If not found or at the end, return undefined
		if (currentIndex === -1 || currentIndex >= userMessages.length - 1) {
			return undefined;
		}

		// Return the next message
		return userMessages[currentIndex + 1];
	};

	/**
	 * Navigate to the previous message in history
	 *
	 * @param currentText - The current text in the input field
	 * @returns The text of the previous message or the current text if none
	 */
	const navigateToPreviousMessage = (currentText: string): string => {
		if (!conversationId || !userMessages.length) return currentText;

		// Save the current message if we're starting navigation
		const currentSequenceId = getCurrentSequenceId(conversationId);
		if (!currentSequenceId) {
			// Only save if we're starting navigation and there's something to save
			if (currentText.trim()) {
				setCurrentMessage(conversationId, currentText);
			}
		}

		// Get the previous message
		const previousMessage = getPreviousMessage(currentSequenceId);

		if (previousMessage?.id) {
			// Update the current sequence ID
			setCurrentSequenceId(conversationId, previousMessage.id);

			// Return the message text (or empty string if undefined)
			const messageText = previousMessage.message || "";

			// Return the message text only if it's different from current
			return messageText !== currentText ? messageText : currentText;
		}

		// No previous message, return the current text
		return currentText;
	};

	/**
	 * Navigate to the next message in history
	 *
	 * @param currentText - The current text in the input field
	 * @returns The text of the next message or the saved draft if at the end
	 */
	const navigateToNextMessage = (currentText: string): string => {
		if (!conversationId) return currentText;

		const currentSequenceId = getCurrentSequenceId(conversationId);

		// If not navigating history, return current text
		if (!currentSequenceId) return currentText;

		// Get the next message
		const nextMessage = getNextMessage(currentSequenceId);

		if (nextMessage?.id) {
			// Update the current sequence ID
			setCurrentSequenceId(conversationId, nextMessage.id);

			// Return the message text (or empty string if undefined)
			const messageText = nextMessage.message || "";

			// Return the message text only if it's different from current
			return messageText !== currentText ? messageText : currentText;
		}

		// At the end of history, return to the draft message
		const savedMessage = getCurrentMessage(conversationId);

		// Reset the history navigation
		resetHistory(conversationId);

		// Return the saved draft message only if it's different from current
		return savedMessage !== currentText ? savedMessage : currentText;
	};

	/**
	 * Reset history navigation
	 */
	const resetHistoryNavigation = () => {
		if (conversationId) {
			resetHistory(conversationId);
		}
	};

	return {
		navigateToPreviousMessage,
		navigateToNextMessage,
		resetHistoryNavigation,
	};
};
