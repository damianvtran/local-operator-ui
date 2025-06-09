/**
 * Conversation Input Store
 *
 * Manages the current input draft, a log of last submitted messages, and the current history navigation index per conversation.
 * Used to persist input state and provide robust up-arrow navigation for message input.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Represents a reply to a message
 */
export type Reply = {
	id: string;
	text: string;
};

/**
 * State for a single conversation's input
 */
type ConversationInputState = {
	/**
	 * The current in-progress message in the input box
	 */
	currentInput: string;
	/**
	 * The log of last submitted messages (most recent last)
	 */
	submittedMessages: string[];
	/**
	 * The current index for up/down navigation in the submittedMessages log (null = not navigating)
	 */
	currentHistoryIndex: number | null;
	/**
	 * A list of replies to be sent with the next message
	 */
	replies: Reply[];
};

/**
 * Store state interface
 */
type ConversationInputStoreState = {
	/**
	 * State by conversation ID
	 */
	inputByConversation: Record<string, ConversationInputState>;

	/**
	 * Adds a reply to the list of replies for a conversation
	 * @param conversationId - The ID of the conversation
	 * @param reply - The reply to add
	 */
	addReply: (conversationId: string, reply: Reply) => void;

	/**
	 * Removes a reply from the list of replies for a conversation
	 * @param conversationId - The ID of the conversation
	 * @param replyId - The ID of the reply to remove
	 */
	removeReply: (conversationId: string, replyId: string) => void;

	/**
	 * Clears all replies for a conversation
	 * @param conversationId - The ID of the conversation
	 */
	clearReplies: (conversationId: string) => void;

	/**
	 * Set the current input value for a conversation
	 * @param conversationId - The ID of the conversation
	 * @param value - The input value to set
	 */
	setCurrentInput: (conversationId: string, value: string) => void;

	/**
	 * Get the current input value for a conversation
	 * @param conversationId - The ID of the conversation
	 * @returns The current input value or empty string if none exists
	 */
	getCurrentInput: (conversationId: string) => string;

	/**
	 * Add a submitted message to the log for a conversation
	 * @param conversationId - The ID of the conversation
	 * @param message - The submitted message to add
	 */
	addSubmittedMessage: (conversationId: string, message: string) => void;

	/**
	 * Get the log of submitted messages for a conversation
	 * @param conversationId - The ID of the conversation
	 * @returns The array of submitted messages (most recent last)
	 */
	getSubmittedMessages: (conversationId: string) => string[];

	/**
	 * Clear the submitted message log for a conversation
	 * @param conversationId - The ID of the conversation
	 */
	clearSubmittedMessages: (conversationId: string) => void;

	/**
	 * Get the current history navigation index for a conversation
	 * @param conversationId - The ID of the conversation
	 * @returns The current history index or null if not navigating
	 */
	getCurrentHistoryIndex: (conversationId: string) => number | null;

	/**
	 * Set the current history navigation index for a conversation
	 * @param conversationId - The ID of the conversation
	 * @param index - The index to set (null = not navigating)
	 */
	setCurrentHistoryIndex: (
		conversationId: string,
		index: number | null,
	) => void;

	/**
	 * Reset the history navigation index for a conversation (set to null)
	 * @param conversationId - The ID of the conversation
	 */
	resetCurrentHistoryIndex: (conversationId: string) => void;

	/**
	 * Clear all input state for a conversation
	 * @param conversationId - The ID of the conversation
	 */
	clearAll: (conversationId: string) => void;
};

/**
 * Maximum number of submitted messages to keep in the log per conversation
 */
const MAX_SUBMITTED_MESSAGES = 20;

/**
 * Zustand store implementation
 */
export const useConversationInputStore = create<ConversationInputStoreState>()(
	persist(
		(set, get) => ({
			inputByConversation: {},

			addReply: (conversationId, reply) => {
				const existing = get().inputByConversation[conversationId] || {
					currentInput: "",
					submittedMessages: [],
					currentHistoryIndex: null,
					replies: [],
				};
				const existingReplies = Array.isArray(existing.replies)
					? existing.replies
					: [];
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							replies: [...existingReplies, reply],
						},
					},
				});
			},

			removeReply: (conversationId, replyId) => {
				const existing = get().inputByConversation[conversationId];
				if (!existing) return;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							replies: existing.replies.filter((r) => r.id !== replyId),
						},
					},
				});
			},

			clearReplies: (conversationId) => {
				const existing = get().inputByConversation[conversationId];
				if (!existing) return;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							replies: [],
						},
					},
				});
			},

			setCurrentInput: (conversationId, value) => {
				const existing = get().inputByConversation[conversationId] || {
					currentInput: "",
					submittedMessages: [],
					currentHistoryIndex: null,
					replies: [],
				};
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							currentInput: value,
						},
					},
				});
			},

			getCurrentInput: (conversationId) => {
				return get().inputByConversation[conversationId]?.currentInput || "";
			},

			addSubmittedMessage: (conversationId, message) => {
				const existing = get().inputByConversation[conversationId] || {
					currentInput: "",
					submittedMessages: [],
					currentHistoryIndex: null,
					replies: [],
				};
				// Avoid duplicate consecutive entries
				const last =
					existing.submittedMessages[existing.submittedMessages.length - 1];
				const newMessages =
					message && message !== last
						? [
								...existing.submittedMessages.slice(
									-MAX_SUBMITTED_MESSAGES + 1,
								),
								message,
							]
						: existing.submittedMessages;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							submittedMessages: newMessages,
						},
					},
				});
			},

			getSubmittedMessages: (conversationId) => {
				return (
					get().inputByConversation[conversationId]?.submittedMessages || []
				);
			},

			clearSubmittedMessages: (conversationId) => {
				const existing = get().inputByConversation[conversationId];
				if (!existing) return;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							submittedMessages: [],
						},
					},
				});
			},

			getCurrentHistoryIndex: (conversationId) => {
				return (
					get().inputByConversation[conversationId]?.currentHistoryIndex ?? null
				);
			},

			/**
			 * Set the current history navigation index for a conversation, clamped to valid range.
			 * @param conversationId - The ID of the conversation
			 * @param index - The index to set (null = not navigating)
			 */
			setCurrentHistoryIndex: (conversationId, index) => {
				const existing = get().inputByConversation[conversationId] || {
					currentInput: "",
					submittedMessages: [],
					currentHistoryIndex: null,
					replies: [],
				};
				const messages = existing.submittedMessages;
				let clampedIndex: number | null = null;
				if (typeof index === "number" && messages.length > 0) {
					clampedIndex = Math.max(0, Math.min(index, messages.length - 1));
				}
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							currentHistoryIndex: clampedIndex,
						},
					},
				});
			},

			resetCurrentHistoryIndex: (conversationId) => {
				const existing = get().inputByConversation[conversationId];
				if (!existing) return;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							currentHistoryIndex: null,
						},
					},
				});
			},

			clearAll: (conversationId) => {
				const { [conversationId]: _, ...rest } = get().inputByConversation;
				set({
					inputByConversation: rest,
				});
			},
		}),
		{
			name: "conversation-input-store",
			partialize: (state) => ({
				inputByConversation: state.inputByConversation,
			}),
		},
	),
);
