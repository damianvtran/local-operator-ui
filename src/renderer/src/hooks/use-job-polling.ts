/**
 * Custom hook for polling job status using React Query
 * Handles polling for job status and provides state for tracking job progress
 */
import { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { JobStatus, JobDetails } from '@renderer/api/local-operator/types';
import type { Message } from '@renderer/components/chat/types';
import { createLocalOperatorClient } from '@renderer/api/local-operator';
import { apiConfig } from '@renderer/config';

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
  
  // Handle job completion
  const handleJobCompletion = useCallback((job: JobDetails) => {
    if (!conversationId) return;
    
    // If job is completed, process the result
    if (job.status === 'completed' && job.result) {
      // Create assistant message from response
      const assistantMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        message: job.result.response,
        timestamp: new Date(),
      };
      
      // Add assistant message to chat store
      addMessage(conversationId, assistantMessage);
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
  }, [conversationId, addMessage]);

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
    if (!jobData) return;
    
    // If job is completed or failed, handle it
    if (jobData.status === 'completed' || jobData.status === 'failed') {
      handleJobCompletion(jobData);
    }
  }, [jobData, handleJobCompletion]);

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
