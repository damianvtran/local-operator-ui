/**
 * Hook for fetching system prompt from the Local Operator API
 */

import { useQuery } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import type { SystemPromptResponse } from '@renderer/api/local-operator/types';
import { createLocalOperatorClient } from '@renderer/api/local-operator';
import { apiConfig } from '@renderer/config';

/**
 * Query key for system prompt
 */
export const systemPromptQueryKey = ['system-prompt'];

/**
 * Hook for fetching system prompt from the Local Operator API
 * 
 * @returns Query result with system prompt data, loading state, error state, and refetch function
 */
export const useSystemPrompt = () => {
  return useQuery({
    queryKey: systemPromptQueryKey,
    queryFn: async (): Promise<SystemPromptResponse | null> => {
      try {
        // Use the properly typed client
        const client = createLocalOperatorClient(apiConfig.baseUrl);
        const response = await client.config.getSystemPrompt();
        
        if (response.status >= 400) {
          throw new Error(response.message || 'Failed to fetch system prompt');
        }
        
        return response.result as SystemPromptResponse;
      } catch (error) {
        const errorMessage = error instanceof Error 
          ? error.message 
          : 'An unknown error occurred while fetching system prompt';
        
        toast.error(errorMessage);
        throw error;
      }
    },
    // Prevent automatic refetches on window focus
    refetchOnWindowFocus: false,
    // Prevent stale time to avoid unnecessary refetches
    staleTime: 5000,
  });
};
