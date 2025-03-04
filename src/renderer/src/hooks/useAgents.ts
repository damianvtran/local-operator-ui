/**
 * Hook for fetching and managing agents from the Local Operator API
 */

import { useQuery } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import type { AgentDetails, AgentListResult, CRUDResponse } from '@renderer/api/local-operator/types';
import { AgentsApi, createLocalOperatorClient } from '@renderer/api/local-operator';
import { apiConfig } from '@renderer/config';

/**
 * Query key for agents
 */
export const agentsQueryKey = ['agents'];

/**
 * Hook for fetching agents from the Local Operator API
 * 
 * @param page - Page number (default: 1)
 * @param perPage - Number of agents per page (default: 10)
 * @returns Query result with agents data, loading state, error state, and refetch function
 */
export const useAgents = (page = 1, perPage = 10) => {
  return useQuery({
    queryKey: [...agentsQueryKey, page, perPage],
    queryFn: async () => {
      try {
        // Call the API directly to avoid type issues with the client wrapper
        const response = await AgentsApi.listAgents(
          apiConfig.baseUrl,
          page,
          perPage
        );
        
        if (response.status >= 400) {
          throw new Error(response.message || 'Failed to fetch agents');
        }
        
        return response.result?.agents || [];
      } catch (error) {
        const errorMessage = error instanceof Error 
          ? error.message 
          : 'An unknown error occurred while fetching agents';
        
        toast.error(errorMessage);
        throw error;
      }
    },
  });
};

/**
 * Hook for fetching a single agent by ID
 * 
 * @param agentId - ID of the agent to fetch
 * @returns Query result with agent data, loading state, error state, and refetch function
 */
export const useAgent = (agentId: string | undefined) => {
  return useQuery({
    queryKey: [...agentsQueryKey, agentId],
    queryFn: async (): Promise<AgentDetails | null> => {
      if (!agentId) return null;
      
      try {
        // Call the API directly to avoid type issues with the client wrapper
        const response = await AgentsApi.getAgent(
          apiConfig.baseUrl,
          agentId
        );
        
        if (response.status >= 400) {
          throw new Error(response.message || `Failed to fetch agent ${agentId}`);
        }
        
        return response.result as AgentDetails;
      } catch (error) {
        const errorMessage = error instanceof Error 
          ? error.message 
          : `An unknown error occurred while fetching agent ${agentId}`;
        
        toast.error(errorMessage);
        throw error;
      }
    },
    enabled: !!agentId,
  });
};
