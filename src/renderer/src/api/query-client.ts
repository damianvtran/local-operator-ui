/**
 * React Query Client Configuration
 * 
 * This file sets up the React Query client with default configuration
 * for the application.
 */

import { QueryClient } from '@tanstack/react-query';

/**
 * Default query client configuration
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Default stale time of 5 minutes
      staleTime: 5 * 60 * 1000,
      // Default cache time of 10 minutes
      gcTime: 10 * 60 * 1000,
      // Default retry configuration
      retry: 1,
      // Default refetch configuration
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      refetchOnReconnect: true,
    },
  },
});
