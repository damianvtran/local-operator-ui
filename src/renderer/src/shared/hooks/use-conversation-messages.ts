/**
 * Hook for fetching and managing conversation messages with pagination
 * Optimized for performance with virtualization and better scroll handling
 *
 * This hook is gated by connectivity checks to ensure the server is online
 * and the user has internet connectivity if required by the hosting provider.
 */

import type { Message } from "@features/chat/types";
import { createLocalOperatorClient } from "@shared/api/local-operator";
import type { AgentExecutionRecord } from "@shared/api/local-operator/types";
import { apiConfig } from "@shared/config";
import { useChatStore } from "@shared/store/chat-store";
import { showErrorToast } from "@shared/utils/toast-manager";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnectivityGate } from "./use-connectivity-gate";

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
export const convertToMessage = (
	record: AgentExecutionRecord,
	conversationId?: string,
): Message => {
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
		files: record.files,
		action: record.action,
		execution_type: record.execution_type,
		task_classification: record.task_classification,
		is_complete: record.is_complete,
		is_streamable: record.is_streamable,
		conversation_id: conversationId, // Add the conversation ID
		content: record.content,
		file_path: record.file_path,
		replacements: record.replacements,
		agent: record.agent,
		learnings: record.learnings,
		thinking: record.thinking,
	};
};

/**
 * Hook for fetching and managing conversation messages with pagination
 * Includes optimizations for better scroll performance
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

	// Track if we're near the top of the messages container (which is now the bottom visually with column-reverse)
	const [isNearTop, setIsNearTop] = useState(false);

	// Track if we're preserving scroll position during loading
	const [preserveScroll, setPreserveScroll] = useState(false);

	// Track if we're currently loading more messages to prevent multiple consecutive loads
	const isLoadingMoreRef = useRef(false);

	// Store the scroll position before loading more messages
	const scrollPositionBeforeLoadRef = useRef<number>(0);

	// Debounce scroll handling to improve performance
	const scrollTimeoutRef = useRef<number | null>(null);

	// Track the last scroll position to avoid unnecessary updates
	const lastScrollPositionRef = useRef<number>(0);

	// Get store functions
	const {
		getMessages,
		addMessages,
		setMessages,
		lastUpdated,
		updatePagination,
		getPagination,
		updateScrollPosition,
		getScrollPosition,
	} = useChatStore();

	// Use the connectivity gate to check if the query should be enabled
	const { shouldEnableQuery, getConnectivityError } = useConnectivityGate();

	// Get the connectivity error if any
	const connectivityError = getConnectivityError();

	// Log connectivity error if present
	useEffect(() => {
		if (connectivityError) {
			console.error(
				"Conversation messages connectivity error:",
				connectivityError.message,
			);
		}
	}, [connectivityError]);

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
		// Only enable the query if server is online (bypass internet check)
		enabled:
			shouldEnableQuery({ bypassInternetCheck: true }) && !!conversationId,
		queryKey: [...conversationMessagesQueryKey, conversationId],
		// Set stale time to 0 to ensure refetch always gets fresh data
		staleTime: 0,
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
				const messages = (result.history || []).map((record) =>
					convertToMessage(record, conversationId),
				);

				// Calculate total pages
				const totalPages = Math.ceil(result.total / pageSize);

				// Update pagination state in the store
				updatePagination(
					conversationId,
					result.page,
					totalPages,
					result.page < totalPages,
				);

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

				showErrorToast(errorMessage);
				throw error;
			}
		},
		initialPageParam: 1,
		getNextPageParam: (lastPage: PaginatedMessagesResponse) => {
			if (!lastPage.hasMore) return undefined;
			return lastPage.page + 1;
		},
	});

	// Optimized scroll handler with debouncing to reduce performance impact
	// Adapted for column-reverse layout
	const handleScroll = useCallback(() => {
		if (!messagesContainerRef.current || !conversationId) return;

		// Clear any pending timeout
		if (scrollTimeoutRef.current !== null) {
			window.clearTimeout(scrollTimeoutRef.current);
		}

		// Debounce the scroll event to reduce calculations
		scrollTimeoutRef.current = window.setTimeout(() => {
			if (!messagesContainerRef.current) return;

			const { scrollTop, scrollHeight, clientHeight } =
				messagesContainerRef.current;

			// Only update if scroll position has changed significantly
			if (Math.abs(lastScrollPositionRef.current - scrollTop) > 20) {
				// Save current scroll position to the store
				updateScrollPosition(conversationId, scrollTop);
				lastScrollPositionRef.current = scrollTop;

				// Get current pagination state
				const paginationState = getPagination(conversationId);

				// In column-reverse layout:
				// - scrollTop can be 0 or negative at the bottom (newest messages)
				// - As you scroll up (towards older messages), scrollTop becomes more negative
				// - When you reach the top (oldest messages), scrollTop will be at its most negative value

				// Handle both positive and negative scrollTop values
				// For negative scrollTop (which happens in some browsers with column-reverse):
				// - The most negative value is at the top (oldest messages)
				// - 0 is at the bottom (newest messages)

				// Calculate the maximum possible scroll value (most negative when scrollTop is negative)
				const maxScrollValue = Math.abs(scrollHeight - clientHeight);

				// Calculate how close we are to the top (oldest messages)
				// For negative scrollTop: we're at the top when scrollTop is close to -maxScrollValue
				// For positive scrollTop: we're at the top when scrollTop is close to maxScrollValue
				const absScrollTop = Math.abs(scrollTop);
				const distanceFromTop =
					scrollTop < 0
						? maxScrollValue - absScrollTop // For negative scrollTop
						: maxScrollValue - scrollTop; // For positive scrollTop

				// Consider "near top" if within 100px of the top edge
				const isNearTopEdge = distanceFromTop < 100;

				if (isNearTopEdge && paginationState.hasMore) {
					// Save the current scroll position before loading more messages
					scrollPositionBeforeLoadRef.current = scrollTop;
					setPreserveScroll(true);
					setIsNearTop(true);
				} else if (!isNearTopEdge) {
					setIsNearTop(false);
				}
			}

			scrollTimeoutRef.current = null;
		}, 100); // 100ms debounce
	}, [conversationId, updateScrollPosition, getPagination]);

	// Set up scroll event listener with passive option for better performance
	useEffect(() => {
		const container = messagesContainerRef.current;
		if (!container) return;

		// Use passive: true for better scroll performance
		container.addEventListener("scroll", handleScroll, { passive: true });

		return () => {
			if (scrollTimeoutRef.current !== null) {
				window.clearTimeout(scrollTimeoutRef.current);
			}
			container.removeEventListener("scroll", handleScroll);
		};
	}, [handleScroll]);

	// Load more messages when user scrolls to the bottom (which is the top in DOM terms with column-reverse)
	useEffect(() => {
		if (
			isNearTop &&
			hasNextPage &&
			!isFetchingNextPage &&
			!isLoadingMoreRef.current
		) {
			// Set loading lock to prevent multiple consecutive loads
			isLoadingMoreRef.current = true;

			// Reset isNearTop to prevent continuous loading
			setIsNearTop(false);

			// Fetch the next page of messages
			fetchNextPage().finally(() => {
				// Release the loading lock after fetching completes (success or error)
				setTimeout(() => {
					isLoadingMoreRef.current = false;
				}, 500); // Add a small delay to ensure DOM has updated
			});
		}
	}, [isNearTop, hasNextPage, isFetchingNextPage, fetchNextPage]);

	// Optimized scroll position restoration after loading more messages
	// Adapted for column-reverse layout with support for negative scrollTop values
	useEffect(() => {
		if (preserveScroll && !isFetchingNextPage && messagesContainerRef.current) {
			// Use requestAnimationFrame for smoother updates
			requestAnimationFrame(() => {
				if (messagesContainerRef.current) {
					// In column-reverse, we want to maintain the same absolute scroll position
					// when new content is added at the top (which is the bottom in DOM terms)
					// This keeps the user looking at the same messages after loading more history

					// Get the current scroll dimensions
					const originalScrollTop = scrollPositionBeforeLoadRef.current;

					// For negative scrollTop values:
					// - When more content is loaded, scrollHeight increases
					// - To maintain the same view, we need to adjust the scrollTop to be more negative
					// - The adjustment should be proportional to the change in scrollHeight

					// Calculate the new scroll position - add a small offset to ensure we're not right at the edge
					const newScrollTop = originalScrollTop + 20; // Add a small offset to prevent immediate re-triggering

					// Set the scroll position
					messagesContainerRef.current.scrollTop = newScrollTop;

					// Reset the preserve scroll flag
					setPreserveScroll(false);
				}
			});
		}
	}, [preserveScroll, isFetchingNextPage]);

	// Restore saved scroll position when switching back to a conversation
	// Works with both positive and negative scrollTop values
	useEffect(() => {
		if (conversationId && messagesContainerRef.current && !isLoading) {
			const savedPosition = getScrollPosition(conversationId);

			if (savedPosition !== undefined) {
				// Wait for the DOM to update
				setTimeout(() => {
					if (messagesContainerRef.current) {
						// Restore the saved position
						messagesContainerRef.current.scrollTop = savedPosition;
					}
				}, 50);
			} else {
				// If no saved position, scroll to bottom
				// For column-reverse, this means scrollTop = 0
				setTimeout(() => {
					if (messagesContainerRef.current) {
						messagesContainerRef.current.scrollTop = 0;
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
		for (const page of data.pages) {
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
		}
	}, [data, conversationId, addMessages, setMessages, getMessages]);

	// Get messages from the store with memoization to prevent unnecessary re-renders
	// Include lastUpdated in dependencies to trigger re-renders when the store is updated
	// biome-ignore lint/correctness/useExhaustiveDependencies: lastUpdated is needed to trigger re-renders
	const messages = useMemo(() => {
		return conversationId ? getMessages(conversationId) : [];
	}, [conversationId, getMessages, lastUpdated]);

	// Get pagination info from the store
	const pagination = useMemo(() => {
		return conversationId
			? getPagination(conversationId)
			: { currentPage: 1, totalPages: 1, hasMore: false };
	}, [conversationId, getPagination]);

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
