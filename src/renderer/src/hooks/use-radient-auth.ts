/**
 * @file use-radient-auth.ts
 * @description
 * React hook for accessing Radient authentication state and user information.
 * Integrates with the user store to provide a unified interface for user data.
 * Uses React Query for stable, cached, and automatically refreshing data.
 */

import type { RadientUser } from "@renderer/providers/auth"; // Assuming RadientUser is defined here or import appropriately
import { useUserStore } from "@renderer/store/user-store";
import { useEffect } from "react";
import { useRadientUserQuery } from "./use-radient-user-query";

// Define a more descriptive status type
export type AuthStatus =
	| "loading" // Initial check or ongoing fetch, no local token hint
	| "authenticated" // Backend validated
	| "unauthenticated" // No local token or backend validation failed
	| "restoring"; // Local token exists, backend validation pending

/**
 * Hook for accessing Radient authentication state and user information
 *
 * This hook:
 * 1. Uses React Query to fetch and manage Radient user information
 * 2. Updates the user store with Radient user information when authenticated
 * 3. Falls back to the user store if Radient auth is not available
 *
 * @returns An object containing authentication state and user information
 */
export const useRadientAuth = () => {
	// Access the user store
	const userStore = useUserStore();

	// Use the React Query-based hook for Radient user information
	const {
		user: radientUser,
		session,
		isLoading, // Combined loading state from useRadientUserQuery
		error,
		isAuthenticated, // Backend validated flag from useRadientUserQuery
		hasLocalSession, // Local token exists flag from useRadientUserQuery
		signOut,
		refreshUser,
		refreshToken,
	} = useRadientUserQuery();

	// Determine the overall authStatus
	let authStatus: AuthStatus;
	if (isLoading) {
		// If loading, check if we have a local session hint to determine if restoring or initial loading
		authStatus = hasLocalSession ? "restoring" : "loading";
	} else if (isAuthenticated) {
		// Not loading, and backend validation succeeded
		authStatus = "authenticated";
	} else {
		// Not loading and not authenticated (could be due to no local session or backend validation failure)
		authStatus = "unauthenticated";
	}

	// Sync the Radient user information with the user store
	useEffect(() => {
		// Skip if there's no user data
		if (!radientUser?.account) {
			return;
		}

		const { account } = radientUser;

		// Skip if no name or email is provided
		if (!account.name && !account.email) {
			return;
		}

		// Get current values from the store
		const { name: currentName, email: currentEmail } = userStore.profile;

		// Only update if the data is different from what's in the store
		if (
			(account.name && account.name !== currentName) ||
			(account.email && account.email !== currentEmail)
		) {
			// Update the store with the new values
			userStore.updateProfile({
				name: account.name || currentName,
				email: account.email || currentEmail,
			});
		}
	}, [radientUser, userStore]);

	return {
		// Authentication state
		authStatus, // Use the new combined status
		isAuthenticated, // Keep backend-validated flag for detailed checks if needed
		hasLocalSession, // Expose this flag
		isLoading, // Keep the combined loading flag
		error,

		// User information (from Radient or fallback to user store)
		user: {
			name: radientUser?.account?.name || userStore.profile.name,
			email: radientUser?.account?.email || userStore.profile.email,
			// Include the full Radient user object if available
			radientUser: radientUser as RadientUser | undefined | null, // Added type assertion for clarity
		},

		// Session token for API calls
		sessionToken: session?.accessToken,
		// Expose the full session for advanced use cases
		session,
		// Token refresh function
		refreshToken,

		// Actions
		refreshUser,
		signOut,

		// Store actions for direct user store updates
		updateProfile: userStore.updateProfile,
		updateName: userStore.updateName,
		updateEmail: userStore.updateEmail,
	};
};
