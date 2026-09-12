/**
 * React Query Client Configuration
 *
 * This file sets up the React Query client with default configuration
 * for the application.
 */

import { type DefaultOptions, QueryClient } from "@tanstack/react-query";

/**
 * The defaults every query in the app runs under.
 *
 * Exported separately from the client itself because a verification surface
 * has to be able to CONSTRUCT this policy rather than approximate it. A test
 * or harness that builds its own `QueryClient` with `retry: false` is testing
 * a policy the app does not ship: a failure settles in one tick there and
 * after a retry delay here, so the entire in-between state — one attempt
 * spent, `errorUpdatedAt` still 0, the query neither loading nor settled — is
 * unreachable in the test and routine in the app. That gap is how a failed
 * `/usage` ask shipped with no receipt and a dead re-ask button (PR #110,
 * UX U8): every check of that wiring ran under `retry: false`.
 *
 * So the object is the single source of truth, imported by the client below
 * and by `scripts/usage-interaction.tsx` and `scripts/usage-container.test.mjs`.
 * Drift between the app and its tests is now impossible by construction rather
 * than by review.
 */
export const defaultQueryOptions: DefaultOptions = {
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
};

/**
 * Default query client configuration
 *
 * We use a more aggressive configuration for authentication-related queries
 * to ensure that the authentication state is always up-to-date.
 */
export const queryClient = new QueryClient({
	defaultOptions: defaultQueryOptions,
});

/**
 * Reset the query client's cache
 * This is useful for clearing all cached data, for example when signing out
 */
export const resetQueryCache = () => {
	queryClient.clear();
};
