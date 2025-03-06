/**
 * Chat Store
 *
 * Manages chat messages across conversations using Zustand.
 * Provides a persistent store for messages during the user's session.
 */

import type { Message } from "@renderer/components/chat/types";
import { create } from "zustand";

/**
 * Chat store state interface
 */
type ChatState = {
	/**
	 * Messages organized by conversation ID
	 */
	messagesByConversation: Record<string, Message[]>;

	/**
	 * Last updated timestamp
	 * Used to trigger re-renders when the store is updated
	 */
	lastUpdated: number;

	/**
	 * Add messages to a specific conversation
	 * @param conversationId - The ID of the conversation
	 * @param messages - The messages to add
	 * @param prepend - Whether to prepend (true) or append (false) the messages
	 */
	addMessages: (
		conversationId: string,
		messages: Message[],
		prepend?: boolean,
	) => void;

	/**
	 * Set all messages for a specific conversation
	 * @param conversationId - The ID of the conversation
	 * @param messages - The messages to set
	 */
	setMessages: (conversationId: string, messages: Message[]) => void;

	/**
	 * Add a single message to a specific conversation
	 * @param conversationId - The ID of the conversation
	 * @param message - The message to add
	 */
	addMessage: (conversationId: string, message: Message) => void;

	/**
	 * Clear all messages for a specific conversation
	 * @param conversationId - The ID of the conversation to clear
	 */
	clearConversation: (conversationId: string) => void;

	/**
	 * Get messages for a specific conversation
	 * @param conversationId - The ID of the conversation
	 * @returns The messages for the conversation or an empty array if none exist
	 */
	getMessages: (conversationId: string) => Message[];
};

/**
 * Chat store implementation using Zustand
 */
export const useChatStore = create<ChatState>((set, get) => ({
	messagesByConversation: {},
	lastUpdated: Date.now(),

	addMessages: (conversationId, messages, prepend = false) => {
		set((state) => {
			const existingMessages =
				state.messagesByConversation[conversationId] || [];

			return {
				messagesByConversation: {
					...state.messagesByConversation,
					[conversationId]: prepend
						? [...messages, ...existingMessages]
						: [...existingMessages, ...messages],
				},
				lastUpdated: Date.now(),
			};
		});
	},

	setMessages: (conversationId, messages) => {
		set((state) => ({
			messagesByConversation: {
				...state.messagesByConversation,
				[conversationId]: messages,
			},
			lastUpdated: Date.now(),
		}));
	},

	addMessage: (conversationId, message) => {
		set((state) => {
			const existingMessages =
				state.messagesByConversation[conversationId] || [];

			return {
				messagesByConversation: {
					...state.messagesByConversation,
					[conversationId]: [...existingMessages, message],
				},
				lastUpdated: Date.now(),
			};
		});
	},

	clearConversation: (conversationId) => {
		set((state) => {
			const { [conversationId]: _, ...rest } = state.messagesByConversation;

			return {
				messagesByConversation: rest,
				lastUpdated: Date.now(),
			};
		});
	},

	getMessages: (conversationId) => {
		return get().messagesByConversation[conversationId] || [];
	},
}));
