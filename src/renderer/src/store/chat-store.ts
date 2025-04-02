/**
 * Chat Store
 *
 * Manages chat messages across conversations using Zustand.
 * Provides a persistent store for messages during the user's session.
 */

import type { Message } from "@renderer/components/chat/types";
import { create } from "zustand";

/**
 * Pagination state for a conversation
 */
type ConversationPaginationState = {
	/**
	 * Current page number
	 */
	currentPage: number;

	/**
	 * Total number of pages
	 */
	totalPages: number;

	/**
	 * Whether there are more pages to load
	 */
	hasMore: boolean;

	/**
	 * Last scroll position
	 */
	scrollPosition?: number;
};

/**
 * Chat store state interface
 */
type ChatState = {
	/**
	 * Messages organized by conversation ID
	 */
	messagesByConversation: Record<string, Message[]>;

	/**
	 * Pagination state by conversation ID
	 */
	paginationByConversation: Record<string, ConversationPaginationState>;

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
	 * Update an existing message in a specific conversation
	 * @param conversationId - The ID of the conversation
	 * @param message - The updated message
	 * @returns True if the message was updated, false if it wasn't found
	 */
	updateMessage: (conversationId: string, message: Message) => boolean;

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

	/**
	 * Update pagination state for a conversation
	 * @param conversationId - The ID of the conversation
	 * @param page - Current page number
	 * @param totalPages - Total number of pages
	 * @param hasMore - Whether there are more pages to load
	 */
	updatePagination: (
		conversationId: string,
		page: number,
		totalPages: number,
		hasMore: boolean,
	) => void;

	/**
	 * Get pagination state for a conversation
	 * @param conversationId - The ID of the conversation
	 * @returns The pagination state or default values if none exists
	 */
	getPagination: (conversationId: string) => ConversationPaginationState;

	/**
	 * Update scroll position for a conversation
	 * @param conversationId - The ID of the conversation
	 * @param scrollPosition - The scroll position to save
	 */
	updateScrollPosition: (
		conversationId: string,
		scrollPosition: number,
	) => void;

	/**
	 * Get saved scroll position for a conversation
	 * @param conversationId - The ID of the conversation
	 * @returns The saved scroll position or undefined if none exists
	 */
	getScrollPosition: (conversationId: string) => number | undefined;
};

/**
 * Chat store implementation using Zustand
 */
export const useChatStore = create<ChatState>((set, get) => ({
	messagesByConversation: {},
	paginationByConversation: {},
	lastUpdated: Date.now(),

	addMessages: (conversationId, messages, prepend = false) => {
		set((state) => {
			const existingMessages =
				state.messagesByConversation[conversationId] || [];

			// Create a map of existing message IDs for quick lookup
			const existingMessageIds = new Set(existingMessages.map((msg) => msg.id));

			// Filter out duplicate messages
			const uniqueNewMessages = messages.filter(
				(msg) => !existingMessageIds.has(msg.id),
			);

			// If there are no unique new messages, return the current state
			if (uniqueNewMessages.length === 0) {
				return state;
			}

			// Sort messages by timestamp to ensure correct order
			const allMessages = prepend
				? [...uniqueNewMessages, ...existingMessages]
				: [...existingMessages, ...uniqueNewMessages];

			// Sort by timestamp (oldest first)
			const sortedMessages = [...allMessages].sort((a, b) => {
				const timeA =
					a.timestamp instanceof Date
						? a.timestamp.getTime()
						: new Date(a.timestamp).getTime();
				const timeB =
					b.timestamp instanceof Date
						? b.timestamp.getTime()
						: new Date(b.timestamp).getTime();
				return timeA - timeB;
			});

			return {
				messagesByConversation: {
					...state.messagesByConversation,
					[conversationId]: sortedMessages,
				},
				lastUpdated: Date.now(),
			};
		});
	},

	setMessages: (conversationId, messages) => {
		set((state) => {
			// Sort messages by timestamp (oldest first)
			const sortedMessages = [...messages].sort((a, b) => {
				const timeA =
					a.timestamp instanceof Date
						? a.timestamp.getTime()
						: new Date(a.timestamp).getTime();
				const timeB =
					b.timestamp instanceof Date
						? b.timestamp.getTime()
						: new Date(b.timestamp).getTime();
				return timeA - timeB;
			});

			return {
				messagesByConversation: {
					...state.messagesByConversation,
					[conversationId]: sortedMessages,
				},
				lastUpdated: Date.now(),
			};
		});
	},

	addMessage: (conversationId, message) => {
		set((state) => {
			const existingMessages =
				state.messagesByConversation[conversationId] || [];

			// Check if message with this ID already exists
			if (existingMessages.some((msg) => msg.id === message.id)) {
				return state;
			}

			return {
				messagesByConversation: {
					...state.messagesByConversation,
					[conversationId]: [...existingMessages, message],
				},
				lastUpdated: Date.now(),
			};
		});
	},

	updateMessage: (conversationId, message) => {
		let updated = false;

		set((state) => {
			const existingMessages =
				state.messagesByConversation[conversationId] || [];

			// Find the message with the same ID
			const updatedMessages = existingMessages.map((msg) => {
				if (msg.id === message.id) {
					updated = true;
					return message;
				}
				return msg;
			});

			// If no message was updated, return the current state
			if (!updated) {
				return state;
			}

			return {
				messagesByConversation: {
					...state.messagesByConversation,
					[conversationId]: updatedMessages,
				},
				lastUpdated: Date.now(),
			};
		});

		return updated;
	},

	clearConversation: (conversationId) => {
		set((state) => {
			const { [conversationId]: _, ...restMessages } =
				state.messagesByConversation;
			const { [conversationId]: __, ...restPagination } =
				state.paginationByConversation;

			return {
				messagesByConversation: restMessages,
				paginationByConversation: restPagination,
				lastUpdated: Date.now(),
			};
		});
	},

	getMessages: (conversationId) => {
		return get().messagesByConversation[conversationId] || [];
	},

	updatePagination: (conversationId, page, totalPages, hasMore) => {
		set((state) => {
			const existingPagination = state.paginationByConversation[
				conversationId
			] || {
				currentPage: 1,
				totalPages: 1,
				hasMore: false,
			};

			return {
				paginationByConversation: {
					...state.paginationByConversation,
					[conversationId]: {
						...existingPagination,
						currentPage: page,
						totalPages,
						hasMore,
					},
				},
				lastUpdated: Date.now(),
			};
		});
	},

	getPagination: (conversationId) => {
		return (
			get().paginationByConversation[conversationId] || {
				currentPage: 1,
				totalPages: 1,
				hasMore: false,
			}
		);
	},

	updateScrollPosition: (conversationId, scrollPosition) => {
		set((state) => {
			const existingPagination = state.paginationByConversation[
				conversationId
			] || {
				currentPage: 1,
				totalPages: 1,
				hasMore: false,
			};

			return {
				paginationByConversation: {
					...state.paginationByConversation,
					[conversationId]: {
						...existingPagination,
						scrollPosition,
					},
				},
			};
		});
	},

	getScrollPosition: (conversationId) => {
		return get().paginationByConversation[conversationId]?.scrollPosition;
	},
}));
