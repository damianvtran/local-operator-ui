/**
 * Hook for fetching and managing conversation messages with pagination
 */

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { AgentsApi } from '@renderer/api/local-operator';
import { apiConfig } from '@renderer/config';
import type { ConversationRecord } from '@renderer/api/local-operator/types';
import type { Message } from '@renderer/components/chat/types';
import { useChatStore } from '@renderer/store/chat-store';

/**
 * Query key for conversation messages
 */
export const conversationMessagesQueryKey = ['conversation-messages'];

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
 * Convert a ConversationRecord from the API to a Message for the UI
 * 
 * @param record - The conversation record from the API
 * @returns The converted message for the UI
 */
const convertToMessage = (record: ConversationRecord): Message => {
  // Determine the role based on the API role
  const role: 'user' | 'assistant' = 
    record.role === 'user' || record.role === 'human' 
      ? 'user' 
      : 'assistant';
  
  return {
    id: record.timestamp || Date.now().toString(),
    role,
    content: record.content,
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
  pageSize = 20
) => {
  // Reference to the messages container for scroll detection
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  
  // Track if we're at the top of the messages container
  const [isAtTop, setIsAtTop] = useState(false);
  
  // Get messages and lastUpdated from the store
  const { 
    getMessages, 
    setMessages,
    lastUpdated 
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
    refetch
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
        console.log(`Fetching messages for conversation ${conversationId}, page ${page}`);
        
        // Call the API to get conversation messages
        const response = await AgentsApi.getAgentConversation(
          apiConfig.baseUrl,
          conversationId,
          page,
          pageSize
        );
        
        if (response.status >= 400) {
          throw new Error(response.message || 'Failed to fetch conversation messages');
        }
        
        const result = response.result;
        
        if (!result) {
          console.log('No result returned from API');
          return {
            messages: [],
            page: 1,
            totalPages: 0,
            hasMore: false,
          };
        }
        
        // Convert API messages to UI messages
        const messages = (result.messages || []).map(convertToMessage);
        console.log(`Fetched ${messages.length} messages for page ${page}`);
        
        // Calculate total pages
        const totalPages = Math.ceil(result.total / pageSize);
        
        return {
          messages,
          page: result.page,
          totalPages,
          hasMore: result.page < totalPages,
        };
      } catch (error) {
        const errorMessage = error instanceof Error 
          ? error.message 
          : 'An unknown error occurred while fetching conversation messages';
        
        console.error('Error fetching messages:', error);
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
    if (!messagesContainerRef.current) return;
    
    const { scrollTop } = messagesContainerRef.current;
    
    // Check if we're at the top of the container
    if (scrollTop === 0) {
      setIsAtTop(true);
    } else {
      setIsAtTop(false);
    }
  }, []);
  
  // Set up scroll event listener
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    
    container.addEventListener('scroll', handleScroll);
    
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [handleScroll]);
  
  // Load more messages when user scrolls to the top
  useEffect(() => {
    if (isAtTop && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [isAtTop, hasNextPage, isFetchingNextPage, fetchNextPage]);
  
  // Update the store with fetched messages
  useEffect(() => {
    // Skip if no conversation ID or no data
    if (!conversationId || !data?.pages) return;
    
    // Collect all messages from all pages
    const allMessages = data.pages.flatMap((page) => page.messages);
    console.log(`Updating store with ${allMessages.length} messages for conversation ${conversationId}`);
    
    // Get existing messages from the store
    const existingMessages = getMessages(conversationId);
    
    // If we have more than one page, we need to merge the messages
    if (data.pages.length > 1) {
      // Get the latest page of messages
      const latestPageMessages = data.pages[data.pages.length - 1].messages;
      
      // Add the new messages to the store (prepend them since they're older)
      if (latestPageMessages.length > 0) {
        // Create a new array with the new messages at the beginning
        const updatedMessages = [...latestPageMessages, ...existingMessages];
        
        // Remove duplicates by ID
        const uniqueMessages = updatedMessages.filter(
          (message, index, self) => 
            index === self.findIndex((m) => m.id === message.id)
        );
        
        // Update the store
        setMessages(conversationId, uniqueMessages);
        console.log(`Updated store with ${uniqueMessages.length} messages (${latestPageMessages.length} new)`);
      }
    } 
    // If this is the first fetch and we have messages, set them in the store
    else if (existingMessages.length === 0 && allMessages.length > 0) {
      setMessages(conversationId, allMessages);
      console.log(`Set ${allMessages.length} messages in store (initial fetch)`);
    }
  }, [data, conversationId, setMessages, getMessages]);
  
  // Get messages from the store
  // Include lastUpdated in dependencies to trigger re-renders when the store is updated
  // biome-ignore lint/correctness/useExhaustiveDependencies: lastUpdated is needed to trigger re-renders
  const storeMessages = useMemo(() => {
    return conversationId ? getMessages(conversationId) : [];
  }, [conversationId, getMessages, lastUpdated]);
  
  // Get messages from the API
  const apiMessages = useMemo(() => {
    return data?.pages.flatMap((page) => page.messages) || [];
  }, [data]);
  
  // Combine messages from store and API
  const messages = useMemo(() => {
    // If we have messages in the store, use those
    if (storeMessages.length > 0) {
      return storeMessages;
    }
    
    // Otherwise, use messages from the API
    return apiMessages;
  }, [storeMessages, apiMessages]);
  
  return {
    messages,
    isLoading,
    isError,
    error,
    isFetchingMore: isFetchingNextPage,
    hasMoreMessages: hasNextPage,
    fetchMoreMessages: fetchNextPage,
    messagesContainerRef,
    refetch
  };
};
