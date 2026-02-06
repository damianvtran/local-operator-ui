/**
 * Chat Store
 *
 * Manages chat messages across conversations using Zustand.
 * Provides a persistent store for messages during the user's session.
 */

import type { Message } from "@features/chat/types";
import { create } from "zustand";

const areStringArraysEqual = (a?: string[], b?: string[]): boolean => {
	if (a === b) return true;
	if (!a || !b) return !a && !b;
	if (a.length !== b.length) return false;
	return a.every((value, index) => value === b[index]);
};

const areMessagesEqual = (current: Message, next: Message): boolean => {
	const currentTimestamp =
		current.timestamp instanceof Date
			? current.timestamp.getTime()
			: new Date(current.timestamp).getTime();
	const nextTimestamp =
		next.timestamp instanceof Date
			? next.timestamp.getTime()
			: new Date(next.timestamp).getTime();

	return (
		current.id === next.id &&
		current.role === next.role &&
		currentTimestamp === nextTimestamp &&
		current.message === next.message &&
		current.code === next.code &&
		current.stdout === next.stdout &&
		current.stderr === next.stderr &&
		current.logging === next.logging &&
		current.formatted_print === next.formatted_print &&
		current.status === next.status &&
		current.task_classification === next.task_classification &&
		current.action === next.action &&
		current.execution_type === next.execution_type &&
		current.is_streamable === next.is_streamable &&
		current.is_complete === next.is_complete &&
		current.conversation_id === next.conversation_id &&
		current.content === next.content &&
		current.file_path === next.file_path &&
		current.replacements === next.replacements &&
		current.agent === next.agent &&
		current.learnings === next.learnings &&
		current.thinking === next.thinking &&
		areStringArraysEqual(current.files, next.files)
	);
};

const getMessageTimestamp = (message: Message): number => {
	return message.timestamp instanceof Date
		? message.timestamp.getTime()
		: new Date(message.timestamp).getTime();
};

const isSortedByTimestamp = (messages: Message[]): boolean => {
	for (let index = 1; index < messages.length; index += 1) {
		if (
			getMessageTimestamp(messages[index - 1]) >
			getMessageTimestamp(messages[index])
		) {
			return false;
		}
	}

	return true;
};

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

			const sortedNewMessages = isSortedByTimestamp(uniqueNewMessages)
				? uniqueNewMessages
				: [...uniqueNewMessages].sort(
						(a, b) => getMessageTimestamp(a) - getMessageTimestamp(b),
					);

			let mergedMessages = prepend
				? [...sortedNewMessages, ...existingMessages]
				: [...existingMessages, ...sortedNewMessages];

			const canSkipGlobalSort =
				existingMessages.length === 0 ||
				(prepend
					? getMessageTimestamp(
							sortedNewMessages[sortedNewMessages.length - 1],
						) <= getMessageTimestamp(existingMessages[0])
					: getMessageTimestamp(sortedNewMessages[0]) >=
						getMessageTimestamp(existingMessages[existingMessages.length - 1]));

			if (!canSkipGlobalSort) {
				mergedMessages = [...mergedMessages].sort(
					(a, b) => getMessageTimestamp(a) - getMessageTimestamp(b),
				);
			}

			return {
				messagesByConversation: {
					...state.messagesByConversation,
					[conversationId]: mergedMessages,
				},
				lastUpdated: Date.now(),
			};
		});
	},

	setMessages: (conversationId, messages) => {
		set((state) => {
			const sortedMessages = isSortedByTimestamp(messages)
				? messages
				: [...messages].sort(
						(a, b) => getMessageTimestamp(a) - getMessageTimestamp(b),
					);
			const existingMessages =
				state.messagesByConversation[conversationId] || [];

			if (existingMessages.length === sortedMessages.length) {
				let hasChanges = false;
				for (
					let messageIndex = 0;
					messageIndex < existingMessages.length;
					messageIndex += 1
				) {
					if (
						!areMessagesEqual(
							existingMessages[messageIndex],
							sortedMessages[messageIndex],
						)
					) {
						hasChanges = true;
						break;
					}
				}

				if (!hasChanges) {
					return state;
				}
			}

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
					if (areMessagesEqual(msg, message)) {
						return msg;
					}
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

			if (
				existingPagination.currentPage === page &&
				existingPagination.totalPages === totalPages &&
				existingPagination.hasMore === hasMore
			) {
				return state;
			}

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

			if (existingPagination.scrollPosition === scrollPosition) {
				return state;
			}

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
