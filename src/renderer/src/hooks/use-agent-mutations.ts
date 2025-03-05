/**
 * Hook for creating and deleting agents
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import type { AgentCreate } from '@renderer/api/local-operator/types';
import { createLocalOperatorClient } from '@renderer/api/local-operator';
import { apiConfig } from '@renderer/config';
import { agentsQueryKey } from './use-agents';

/**
 * Hook for creating a new agent
 * 
 * @returns Mutation for creating a new agent
 */
export const useCreateAgent = () => {
  const queryClient = useQueryClient();
  const client = createLocalOperatorClient(apiConfig.baseUrl);

  return useMutation({
    mutationFn: async (newAgent: AgentCreate) => {
      try {
        const response = await client.agents.createAgent(newAgent);
        
        if (response.status >= 400) {
          throw new Error(response.message || 'Failed to create agent');
        }
        
        return response.result;
      } catch (error) {
        const errorMessage = error instanceof Error 
          ? error.message 
          : 'An unknown error occurred while creating the agent';
        
        toast.error(errorMessage);
        throw error;
      }
    },
    onSuccess: () => {
      // Invalidate agents query to refetch the list
      queryClient.invalidateQueries({ queryKey: agentsQueryKey });
      toast.success('Agent created successfully');
    },
    onError: (error) => {
      console.error('Error creating agent:', error);
    }
  });
};

/**
 * Hook for deleting an agent
 * 
 * @returns Mutation for deleting an agent
 */
export const useDeleteAgent = () => {
  const queryClient = useQueryClient();
  const client = createLocalOperatorClient(apiConfig.baseUrl);

  return useMutation({
    mutationFn: async (agentId: string) => {
      try {
        const response = await client.agents.deleteAgent(agentId);
        
        if (response.status >= 400) {
          throw new Error(response.message || `Failed to delete agent ${agentId}`);
        }
        
        return response;
      } catch (error) {
        const errorMessage = error instanceof Error 
          ? error.message 
          : `An unknown error occurred while deleting agent ${agentId}`;
        
        toast.error(errorMessage);
        throw error;
      }
    },
    onSuccess: (_data, agentId) => {
      // Remove cached agent details to clear state before refetch
      queryClient.removeQueries({ queryKey: [...agentsQueryKey, agentId] as QueryKey, exact: true });
      // Invalidate agents query to refetch the list
      queryClient.invalidateQueries({ queryKey: agentsQueryKey });
      toast.success('Agent deleted successfully');
    },
    onError: (error) => {
      console.error('Error deleting agent:', error);
    }
  });
};
