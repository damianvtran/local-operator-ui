/**
 * React Query Client Configuration
 *
 * This file sets up the React Query client with default configuration
 * for the application.
 */

import { QueryClient } from "@tanstack/react-query";

/**
 * Default query client configuration
 * 
 * We use a more aggressive configuration for authentication-related queries
 * to ensure that the authentication state is always up-to-date.
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
			// Don't wait for reconnect to refetch - we handle offline status separately
			refetchOnReconnect: false,
			// Continue to run queries even when offline
			networkMode: "always",
		},
		mutations: {
			// Retry mutations once by default
			retry: 1,
			// Continue to run mutations even when offline
			networkMode: "always",
		},
	},
});

/**
 * Reset the query client's cache
 * This is useful for clearing all cached data, for example when signing out
 */
export const resetQueryCache = () => {
	queryClient.clear();
};
