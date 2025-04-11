/**
 * @file use-radient-user-query.ts
 * @description
 * React Query hook for fetching and managing Radient user information.
 * Provides a stable, cached, and automatically refreshing user data source.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createRadientClient } from "@renderer/api/radient";
import { apiConfig } from "@renderer/config";
import { getSession, hasValidSession, clearSession } from "@renderer/utils/session-store";
import { useFeatureFlags } from "@renderer/providers/feature-flags";
import type { RadientUser } from "@renderer/providers/auth";
import { showErrorToast } from "@renderer/utils/toast-manager";

// Query keys for Radient user data
export const radientUserKeys = {
  all: ['radient-user'] as const,
  user: () => [...radientUserKeys.all, 'user'] as const,
  session: () => [...radientUserKeys.all, 'session'] as const,
};

/**
 * Hook for fetching and managing Radient user information using React Query
 * 
 * @returns Query result with user data, loading state, error state, and utility functions
 */
export const useRadientUserQuery = () => {
  const { isEnabled } = useFeatureFlags();
  const isRadientPassEnabled = isEnabled("radient-pass-onboarding");
  const queryClient = useQueryClient();
  
  // Create the Radient API client
  const radientClient = createRadientClient(apiConfig.radientBaseUrl);

  // Query for the session token
  const sessionQuery = useQuery({
    queryKey: radientUserKeys.session(),
    queryFn: async () => {
      try {
        const hasSession = await hasValidSession();
        if (!hasSession) return null;
        
        return getSession();
      } catch (error) {
        console.error("Failed to get session:", error);
        return null;
      }
    },
    // Don't refetch on window focus to avoid unnecessary token checks
    refetchOnWindowFocus: false,
    // Only enable if the feature flag is enabled
    enabled: isRadientPassEnabled,
    // Keep the session data fresh
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Query for the user information
  const userQuery = useQuery({
    queryKey: radientUserKeys.user(),
    queryFn: async (): Promise<RadientUser | null> => {
      try {
        const token = sessionQuery.data;
        if (!token) return null;
        
        const response = await radientClient.getUserInfo(token);
        
        // The API response is already handled by the client
        // If we get here, the request was successful
        return {
          account: response.result.account,
          identity: response.result.identity,
        };
      } catch (error) {
        // If we get an authentication error, clear the session
        if (error instanceof Error && 
            (error.message.includes("401") || 
             error.message.includes("unauthorized") || 
             error.message.includes("invalid token"))) {
          clearSession();
          // Invalidate the session query to trigger a refetch
          queryClient.invalidateQueries({ queryKey: radientUserKeys.session() });
        }
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("Failed to fetch user info:", errorMessage);
        throw error;
      }
    },
    // Only run this query if we have a session token
    enabled: isRadientPassEnabled && !!sessionQuery.data,
    // Keep the user data fresh
    staleTime: 5 * 60 * 1000, // 5 minutes
    // Don't retry on 401 errors
    retry: (failureCount, error) => {
      if (error instanceof Error && 
          (error.message.includes("401") || 
           error.message.includes("unauthorized") || 
           error.message.includes("invalid token"))) {
        return false;
      }
      return failureCount < 3;
    },
  });

  // Mutation for signing out
  const signOutMutation = useMutation({
    mutationFn: async () => {
      clearSession();
      return true;
    },
    onSuccess: () => {
      // Invalidate the queries to trigger a refetch
      queryClient.invalidateQueries({ queryKey: radientUserKeys.all });
    },
    onError: (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      showErrorToast(`Failed to sign out: ${errorMessage}`);
    },
  });

  // Mutation for refreshing the user data
  const refreshUserMutation = useMutation({
    mutationFn: async () => {
      // Invalidate the queries to trigger a refetch
      queryClient.invalidateQueries({ queryKey: radientUserKeys.all });
      return true;
    },
  });

  return {
    // User data
    user: userQuery.data,
    sessionToken: sessionQuery.data,
    
    // Loading and error states
    isLoading: sessionQuery.isLoading || userQuery.isLoading,
    isRefetching: sessionQuery.isRefetching || userQuery.isRefetching,
    error: sessionQuery.error || userQuery.error,
    
    // Authentication state
    isAuthenticated: !!userQuery.data,
    
    // Actions
    signOut: signOutMutation.mutate,
    refreshUser: refreshUserMutation.mutate,
    
    // Raw query objects for advanced usage
    sessionQuery,
    userQuery,
  };
};
