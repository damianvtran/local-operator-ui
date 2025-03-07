/**
 * Hook for fetching and managing conversation messages with pagination
 */

import { createLocalOperatorClient } from "@renderer/api/local-operator";
import type { AgentExecutionRecord } from "@renderer/api/local-operator/types";
import type { Message } from "@renderer/components/chat/types";
import { apiConfig } from "@renderer/config";
import { useChatStore } from "@renderer/store/chat-store";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";

/**
 * Query key for conversation messages
 */
export const conversationMessagesQueryKey = ["conversation-messages"];

/**
 * Type for the paginated messages response
 */
type PaginatedMessagesResponse = {
	messages: Message[];
	page: number;
	totalPages: number;
	hasMore: boolean;
};

/**
 * Convert a AgentExecutionRecord from the API to a Message for the UI
 *
 * @param record - The agent execution record from the API
 * @returns The converted message for the UI
 */
export const convertToMessage = (record: AgentExecutionRecord): Message => {
	// Determine the role based on the API role
	const role: "user" | "assistant" =
		record.role === "user" || record.role === "human" ? "user" : "assistant";

	return {
		id: record.id,
		role,
		message: record.message,
		code: record.code,
		stdout: record.stdout,
		stderr: record.stderr,
		logging: record.logging,
		timestamp: record.timestamp ? new Date(record.timestamp) : new Date(),
	};
};

/**
 * Hook for fetching and managing conversation messages with pagination
 *
 * @param conversationId - The ID of the conversation to fetch messages for
 * @param pageSize - The number of messages to fetch per page (default: 20)
 * @returns Object containing messages, loading state, error state, and functions to fetch more messages
 */
export const useConversationMessages = (
	conversationId?: string,
	pageSize = 20,
) => {
	// Reference to the messages container for scroll detection
	const messagesContainerRef = useRef<HTMLDivElement | null>(null);

	// Track if we're at the top of the messages container
	const [isAtTop, setIsAtTop] = useState(false);
	
	// Track if we're preserving scroll position during loading
	const [preserveScroll, setPreserveScroll] = useState(false);
	
	// Store the scroll position before loading more messages
	const scrollPositionBeforeLoadRef = useRef<number>(0);

	// Get store functions
	const { 
		getMessages, 
		addMessages, 
		setMessages, 
		lastUpdated,
		updatePagination,
		getPagination,
		updateScrollPosition,
		getScrollPosition
	} = useChatStore();

	// Infinite query for fetching messages with pagination
	const {
		data,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		isLoading,
		isError,
		error,
		refetch,
	} = useInfiniteQuery<PaginatedMessagesResponse, Error>({
		queryKey: [...conversationMessagesQueryKey, conversationId],
		queryFn: async ({ pageParam }) => {
			try {
				// If no conversation ID, return empty result
				if (!conversationId) {
					return {
						messages: [],
						page: 1,
						totalPages: 0,
						hasMore: false,
					};
				}

				const page = pageParam as number;

				// Use the properly typed client
				const client = createLocalOperatorClient(apiConfig.baseUrl);
				const response = await client.agents.getAgentExecutionHistory(
					conversationId,
					page,
					pageSize,
				);

				if (response.status >= 400) {
					throw new Error(
						response.message || "Failed to fetch conversation messages",
					);
				}

				const result = response.result;

				if (!result) {
					return {
						messages: [],
						page: 1,
						totalPages: 0,
						hasMore: false,
					};
				}

				// Convert API messages to UI messages
				const messages = (result.history || []).map(convertToMessage);

				// Calculate total pages
				const totalPages = Math.ceil(result.total / pageSize);
				
				// Update pagination state in the store
				updatePagination(conversationId, result.page, totalPages, result.page < totalPages);

				return {
					messages,
					page: result.page,
					totalPages,
					hasMore: result.page < totalPages,
				};
			} catch (error) {
				const errorMessage =
					error instanceof Error
						? error.message
						: "An unknown error occurred while fetching conversation messages";

				toast.error(errorMessage);
				throw error;
			}
		},
		initialPageParam: 1,
		getNextPageParam: (lastPage: PaginatedMessagesResponse) => {
			if (!lastPage.hasMore) return undefined;
			return lastPage.page + 1;
		},
		// Only enable the query if we have a conversation ID
		enabled: !!conversationId,
	});

	// Handle scroll events to detect when user scrolls to the top
	const handleScroll = useCallback(() => {
		if (!messagesContainerRef.current || !conversationId) return;

		const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
		
		// Save current scroll position to the store
		updateScrollPosition(conversationId, scrollTop);

		// Get current pagination state
		const paginationState = getPagination(conversationId);
		
		// Check if we're at the top of the container and there are more pages to load
		if (scrollTop === 0 && paginationState.hasMore) {
			// Save the current scroll position before loading more messages
			scrollPositionBeforeLoadRef.current = scrollHeight - clientHeight;
			setPreserveScroll(true);
			setIsAtTop(true);
		} else {
			setIsAtTop(false);
		}
	}, [conversationId, updateScrollPosition, getPagination]);

	// Set up scroll event listener
	useEffect(() => {
		const container = messagesContainerRef.current;
		if (!container) return;

		container.addEventListener("scroll", handleScroll);

		return () => {
			container.removeEventListener("scroll", handleScroll);
		};
	}, [handleScroll]);

	// Load more messages when user scrolls to the top
	useEffect(() => {
		if (isAtTop && hasNextPage && !isFetchingNextPage) {
			fetchNextPage();
		}
	}, [isAtTop, hasNextPage, isFetchingNextPage, fetchNextPage]);

	// Restore scroll position after loading more messages
	useEffect(() => {
		if (preserveScroll && !isFetchingNextPage && messagesContainerRef.current) {
			// Wait for the DOM to update
			setTimeout(() => {
				if (messagesContainerRef.current) {
					// Calculate new position - we want to maintain the same relative position
					// after new messages are loaded at the top
					const newScrollTop = messagesContainerRef.current.scrollHeight - scrollPositionBeforeLoadRef.current;
					
					// Set the scroll position
					messagesContainerRef.current.scrollTop = newScrollTop > 0 ? newScrollTop : 0;
					
					// Reset the preserve scroll flag
					setPreserveScroll(false);
				}
			}, 50);
		}
	}, [preserveScroll, isFetchingNextPage]);

	// Restore saved scroll position when switching back to a conversation
	useEffect(() => {
		if (conversationId && messagesContainerRef.current && !isLoading) {
			const savedPosition = getScrollPosition(conversationId);
			
			if (savedPosition !== undefined) {
				// Wait for the DOM to update
				setTimeout(() => {
					if (messagesContainerRef.current) {
						messagesContainerRef.current.scrollTop = savedPosition;
					}
				}, 50);
			}
		}
	}, [conversationId, isLoading, getScrollPosition]);

	// Clear the store when the conversation ID changes
	const previousConversationIdRef = useRef<string | undefined>(conversationId);

	useEffect(() => {
		// If the conversation ID has changed, clear the store
		if (
			conversationId !== previousConversationIdRef.current &&
			previousConversationIdRef.current
		) {
			// We don't need to clear messages anymore since we want to preserve them
			// when switching between conversations
		}

		// Update the ref
		previousConversationIdRef.current = conversationId;
	}, [conversationId]);

	// Update the store with fetched messages
	useEffect(() => {
		// Skip if no conversation ID or no data
		if (!conversationId || !data?.pages) return;

		// Process each page of messages
		data.pages.forEach((page) => {
			// If this is a new page (not the first page), prepend the messages
			if (page.page > 1) {
				addMessages(conversationId, page.messages, true); // prepend = true
			} else {
				// For the first page, we might need to set the messages if they don't exist
				const existingMessages = getMessages(conversationId);
				if (existingMessages.length === 0) {
					setMessages(conversationId, page.messages);
				} else {
					// Otherwise, merge with existing messages
					addMessages(conversationId, page.messages, false); // append = false
				}
			}
		});
	}, [data, conversationId, addMessages, setMessages, getMessages]);

	// Get messages from the store
	// Include lastUpdated in dependencies to trigger re-renders when the store is updated
	// biome-ignore lint/correctness/useExhaustiveDependencies: lastUpdated is needed to trigger re-renders
	const storeMessages = useMemo(() => {
		return conversationId ? getMessages(conversationId) : [];
	}, [conversationId, getMessages, lastUpdated]);

	// Use messages from the store (which will be populated from API data)
	const messages = useMemo(() => {
		return storeMessages;
	}, [storeMessages]);

	// Get pagination info from the store
	const pagination = useMemo(() => {
		return conversationId ? getPagination(conversationId) : { currentPage: 1, totalPages: 1, hasMore: false };
	}, [conversationId, getPagination, lastUpdated]);

	return {
		messages,
		isLoading,
		isError,
		error,
		isFetchingMore: isFetchingNextPage,
		hasMoreMessages: pagination.hasMore,
		fetchMoreMessages: fetchNextPage,
		messagesContainerRef,
		refetch,
		currentPage: pagination.currentPage,
		totalPages: pagination.totalPages,
	};
};
