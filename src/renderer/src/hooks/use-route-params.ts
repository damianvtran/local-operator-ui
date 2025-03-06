/**
 * Custom hook for working with route parameters
 * 
 * Provides utilities for accessing and updating URL parameters
 */

import { useParams, useNavigate } from "react-router-dom";

/**
 * Hook for working with agent ID in routes
 * 
 * @returns Object with agent ID and functions to update it
 */
export const useAgentRouteParam = () => {
  const { agentId } = useParams<{ agentId?: string }>();
  const navigate = useNavigate();

  /**
   * Navigate to a specific agent
   * 
   * @param id - Agent ID to navigate to
   * @param path - Base path to use (defaults to current path)
   */
  const navigateToAgent = (id: string, path?: 'chat' | 'agents') => {
    if (!id) return;
    
    const basePath = path || (window.location.pathname.includes('/chat') ? 'chat' : 'agents');
    navigate(`/${basePath}/${id}`);
  };

  /**
   * Clear the agent ID from the URL
   * 
   * @param path - Base path to navigate to
   */
  const clearAgentId = (path?: 'chat' | 'agents') => {
    const basePath = path || (window.location.pathname.includes('/chat') ? 'chat' : 'agents');
    navigate(`/${basePath}`);
  };

  return {
    agentId,
    navigateToAgent,
    clearAgentId,
  };
};

/**
 * Hook for determining the current view from the URL
 * 
 * @returns The current view based on the URL path
 */
export const useCurrentView = () => {
  const path = window.location.pathname;
  
  if (path.startsWith('/chat')) {
    return 'chat';
  } else if (path.startsWith('/agents')) {
    return 'agents';
  } else if (path.startsWith('/settings')) {
    return 'settings';
  }
  
  // Default to chat if no match
  return 'chat';
};
