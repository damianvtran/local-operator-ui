/**
 * Custom hook for polling job status using React Query
 * Handles polling for job status and provides state for tracking job progress
 */
import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { JobStatus, JobDetails } from '@renderer/api/local-operator/types';
import type { Message } from '@renderer/components/chat/types';
import { createLocalOperatorClient } from '@renderer/api/local-operator';
import { apiConfig } from '@renderer/config';
import { convertToMessage } from './use-conversation-messages';
import { conversationMessagesQueryKey } from './use-conversation-messages';
import { useChatStore } from '@renderer/store/chat-store';

type UseJobPollingParams = {
  conversationId?: string;
  addMessage: (conversationId: string, message: Message) => void;
};

type UseJobPollingResult = {
  currentJobId: string | null;
  setCurrentJobId: (jobId: string | null) => void;
  jobStatus: JobStatus | null;
  isLoading: boolean;
  setIsLoading: (isLoading: boolean) => void;
};

/**
 * Custom hook for polling job status using React Query
 * 
 * @param params - Parameters for the hook
 * @returns Job polling state and functions
 */
export const useJobPolling = ({
  conversationId,
  addMessage,
}: UseJobPollingParams): UseJobPollingResult => {
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const queryClient = useQueryClient();
  const { getMessages, setMessages } = useChatStore();
  
  /**
   * Update conversation messages from execution history
   * 
   * @param agentId - The agent ID to fetch execution history for
   * @returns Promise that resolves when the update is complete
   */
  const updateConversationMessages = useCallback(async (agentId: string) => {
    if (!agentId) return;
    
    try {
      // Create a client instance to use the properly typed API
      const client = createLocalOperatorClient(apiConfig.baseUrl);
      
      // Fetch the execution history for the agent
      const response = await client.agents.getAgentExecutionHistory(
        agentId,
        1, // First page
        50 // Get a reasonable number of executions
      );
      
      if (response.status >= 400 || !response.result) {
        throw new Error(response.message || 'Failed to fetch execution history');
      }
      
      // Get the execution records from the API response
      const executionRecords = response.result.history || [];
      
      // Get existing messages from the store
      const existingMessages = getMessages(agentId);
      
      // Convert API execution records to UI messages
      const apiMessages = executionRecords.map(convertToMessage);
      
      // Find new messages that don't exist in the store
      // We'll consider a message new if we don't have a message with the same ID
      const existingIds = new Set(existingMessages.map(m => m.id));
      const newMessages = apiMessages.filter(m => !existingIds.has(m.id));
      
      if (newMessages.length > 0) {
        // Add new messages to the store
        const updatedMessages = [...existingMessages, ...newMessages];
        setMessages(agentId, updatedMessages);
        
        // Invalidate the conversation messages query to trigger a refetch
        queryClient.invalidateQueries({
          queryKey: [...conversationMessagesQueryKey, agentId],
        });
      }
      
      return true;
    } catch (error) {
      console.error('Error fetching execution history:', error);
      return false;
    }
  }, [getMessages, setMessages, queryClient]);
  
  // Handle job completion
  const handleJobCompletion = useCallback(async (job: JobDetails) => {
    if (!conversationId) return;
    
    // If job is completed, process the result
    if (job.status === 'completed' && job.result) {
      // Try to update messages from execution history
      const updated = await updateConversationMessages(conversationId);
      
      // If we couldn't update from execution history, fallback to just adding the assistant message
      if (!updated && job.result.response) {
        const assistantMessage: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          message: job.result.response,
          timestamp: new Date(),
        };
        
        // Add assistant message to chat store
        addMessage(conversationId, assistantMessage);
      }
    } 
    // If job failed, show error message
    else if (job.status === 'failed') {
      const errorMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        message: 'Sorry, there was an error processing your request. The job failed.',
        timestamp: new Date(),
      };
      
      addMessage(conversationId, errorMessage);
    }
    
    // Clear job tracking
    setCurrentJobId(null);
    setIsLoading(false);
  }, [conversationId, addMessage, updateConversationMessages]);

  // Use React Query to poll for job status
  const { data: jobData, error } = useQuery({
    queryKey: ['job', currentJobId],
    queryFn: async () => {
      if (!currentJobId) return null;
      
      // Create a client instance to use the properly typed API
      const client = createLocalOperatorClient(apiConfig.baseUrl);
      const response = await client.jobs.getJobStatus(currentJobId);
      return response.result;
    },
    // Only run the query if we have a job ID
    enabled: !!currentJobId,
    // Poll every 2 seconds
    refetchInterval: currentJobId ? 2000 : false,
    // Don't refetch on window focus while polling
    refetchOnWindowFocus: false,
    // Don't cache the result
    gcTime: 0,
    staleTime: 0,
  });

  // Process job data when it changes
  useEffect(() => {
    if (!jobData || !conversationId) return;
    
    // Update messages on each poll to show real-time progress
    if (jobData.status === 'processing') {
      console.log('Processing job:', jobData);
      updateConversationMessages(conversationId);
    }
    
    // If job is completed or failed, handle it
    if (jobData.status === 'completed' || jobData.status === 'failed') {
      handleJobCompletion(jobData);
    }
  }, [jobData, handleJobCompletion, conversationId, updateConversationMessages]);

  // Log any errors
  useEffect(() => {
    if (error) {
      console.error('Error polling job status:', error);
    }
  }, [error]);

  return {
    currentJobId,
    setCurrentJobId,
    jobStatus: jobData?.status || null,
    isLoading,
    setIsLoading,
  };
};
