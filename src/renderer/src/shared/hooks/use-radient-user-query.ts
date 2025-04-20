/**
 * @file use-radient-user-query.ts
 * @description
 * React Query hook for fetching and managing Radient user information.
 * Provides a stable, cached, and automatically refreshing user data source.
 * Handles token refresh when access tokens expire.
 */

import { resetQueryCache } from "@shared/api/query-client";
import { createRadientClient } from "@shared/api/radient";
import { apiConfig } from "@shared/config";
import type { RadientUser } from "@shared/providers/auth";
import { useFeatureFlags } from "@shared/providers/feature-flags";
import {
	clearSession,
	getSession,
	updateAccessToken,
} from "@shared/utils/session-store";
import {
	showErrorToast,
	showSuccessToast,
} from "@shared/utils/toast-manager";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// Query keys for Radient user data
export const radientUserKeys = {
	all: ["radient-user"] as const,
	user: () => [...radientUserKeys.all, "user"] as const,
	session: () => [...radientUserKeys.all, "session"] as const,
	tokens: () => [...radientUserKeys.all, "tokens"] as const,
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
	const radientClient = createRadientClient(
		apiConfig.radientBaseUrl,
		apiConfig.radientClientId,
	);

	// Mutation for refreshing the access token
	const refreshTokenMutation = useMutation({
		mutationFn: async (refreshToken: string) => {
			const response = await radientClient.refreshToken(refreshToken);

			// Store the new access token and refresh token (if provided)
			await updateAccessToken(
				response.result.access_token,
				response.result.expires_in,
			);

			// If a new refresh token was provided, update it in the session
			if (response.result.refresh_token) {
				await updateAccessToken(
					response.result.access_token,
					response.result.expires_in,
					response.result.refresh_token,
				);
			}

			return response.result;
		},
		onSuccess: () => {
			// Invalidate the session query to trigger a refetch with the new token
			queryClient.invalidateQueries({
				queryKey: radientUserKeys.session(),
			});
		},
		onError: (error) => {
			// If refresh fails, clear the session and force re-authentication
			clearSession();
			queryClient.invalidateQueries({
				queryKey: radientUserKeys.all,
			});

			const errorMessage =
				error instanceof Error ? error.message : String(error);
			showErrorToast(`Session expired: ${errorMessage}`);
		},
	});

	// Query for the session data
	const sessionQuery = useQuery({
		queryKey: radientUserKeys.session(),
		queryFn: async () => {
			try {
				// Get the session data (access token, refresh token, expiry)
				const session = await getSession();

				// If no session exists, return null
				if (!session) return null;

				// If the access token is expired but we have a refresh token, try to refresh
				if (Date.now() > session.expiry && session.refreshToken) {
					try {
						// Wait for the refresh to complete before returning
						const refreshResult = await refreshTokenMutation.mutateAsync(
							session.refreshToken,
						);

						// Return a new session object with the refreshed token
						return {
							accessToken: refreshResult.access_token,
							refreshToken: refreshResult.refresh_token || session.refreshToken,
							expiry: Date.now() + refreshResult.expires_in * 1000,
						};
					} catch (refreshError) {
						console.error("Token refresh failed:", refreshError);
						// If refresh fails, clear the session and return null
						clearSession();
						return null;
					}
				}

				return session;
			} catch (error) {
				console.error("Failed to get session:", error);
				return null; // Return null on error
			}
		},
		// Refetch on window focus to ensure we have the latest session state
		refetchOnWindowFocus: true,
		// Only enable if the feature flag is enabled
		enabled: isRadientPassEnabled,
		// Keep the session data fresh but not too long
		staleTime: 10 * 1000, // 10 seconds
		// Refetch more frequently
		refetchInterval: 10 * 1000, // 10 seconds
	});

	// Query for the user information
	const userQuery = useQuery({
		queryKey: radientUserKeys.user(),
		queryFn: async (): Promise<RadientUser | null> => {
			try {
				const session = sessionQuery.data;
				if (!session) return null;

				// Use the access token to get user info
				const response = await radientClient.getUserInfo(session.accessToken);

				// The API response is already handled by the client
				// If we get here, the request was successful
				return {
					account: response.result.account,
					identity: response.result.identity,
				};
			} catch (error) {
				// If we get an authentication error, try to refresh the token if we have a refresh token
				if (
					error instanceof Error &&
					(error.message.includes("401") ||
						error.message.includes("unauthorized") ||
						error.message.includes("invalid token"))
				) {
					const session = sessionQuery.data;

					// If we have a refresh token, try to refresh the access token
					if (session?.refreshToken && !refreshTokenMutation.isPending) {
						refreshTokenMutation.mutate(session.refreshToken);
					} else {
						// No refresh token or refresh already in progress, clear the session
						clearSession();
						// Invalidate the session query to trigger a refetch
						queryClient.invalidateQueries({
							queryKey: radientUserKeys.session(),
						});
					}
				}

				const errorMessage =
					error instanceof Error ? error.message : String(error);
				console.error("Failed to fetch user info:", errorMessage);
				throw error;
			}
		},
		// Only run this query if we have a session with an access token
		enabled: isRadientPassEnabled && !!sessionQuery.data?.accessToken,
		// Keep the user data fresh but not too long
		staleTime: 10 * 1000, // 10 seconds
		// Refetch more frequently
		refetchInterval: 10 * 1000, // 10 seconds
		// Don't retry on 401 errors if we don't have a refresh token
		retry: (failureCount, error) => {
			// If we have a refresh token, let the error handler above handle it
			const session = sessionQuery.data;
			const hasRefreshToken = !!session?.refreshToken;

			if (
				!hasRefreshToken &&
				error instanceof Error &&
				(error.message.includes("401") ||
					error.message.includes("unauthorized") ||
					error.message.includes("invalid token"))
			) {
				return false;
			}
			return failureCount < 3;
		},
	});

	// --- Authentication State ---
	// Indicates if a token exists locally (might still be invalid/expired on backend, or backend call pending/failed)
	const hasLocalSession = !!sessionQuery.data && !sessionQuery.isLoading;
	// Indicates if token is validated by backend and user info fetched successfully
	const isAuthenticated = !!userQuery.data && !userQuery.isLoading;
	// --- End Authentication State ---

	// Mutation for signing out
	const signOutMutation = useMutation({
		mutationFn: async () => {
			// If we have a refresh token, try to revoke it
			const session = sessionQuery.data;
			if (session?.refreshToken) {
				try {
					await radientClient.revokeToken(
						session.refreshToken,
						"refresh_token",
					);
				} catch (error) {
					console.error("Failed to revoke refresh token:", error);
					// Continue with sign out even if revoke fails
				}
			}

			// Clear the local session
			clearSession();
			return true;
		},
		onSuccess: () => {
			// Reset the entire query cache to ensure a clean state
			resetQueryCache();
			// Show a success toast
			showSuccessToast("Successfully signed out");
		},
		onError: (error) => {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
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
		session: sessionQuery.data,

		// Loading and error states
		// Loading is true if session is loading, OR if session is loaded but user info is still loading
		isLoading:
			sessionQuery.isLoading ||
			refreshTokenMutation.isPending ||
			(hasLocalSession && userQuery.isLoading),
		isRefetching:
			sessionQuery.isRefetching ||
			userQuery.isRefetching ||
			refreshTokenMutation.isPending,
		error: sessionQuery.error || userQuery.error || refreshTokenMutation.error,

		// Authentication state (defined above)
		hasLocalSession,
		isAuthenticated,

		// Actions
		signOut: signOutMutation.mutate,
		refreshUser: refreshUserMutation.mutate,
		refreshToken: (refreshToken: string) =>
			refreshTokenMutation.mutate(refreshToken),

		// Raw query objects for advanced usage
		sessionQuery,
		userQuery,
		refreshTokenMutation,
	};
};
