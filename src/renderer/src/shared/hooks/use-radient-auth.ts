/**
 * @file use-radient-auth.ts
 * @description
 * React hook for accessing Radient authentication state and user information.
 * Integrates with the user store to provide a unified interface for user data.
 * Uses React Query for stable, cached, and automatically refreshing data.
 */

import type { RadientUser } from "@shared/providers/auth"; // Assuming RadientUser is defined here or import appropriately
import { useUserStore } from "@shared/store/user-store";
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
		isLoading,
		error,
		isAuthenticated,
		hasLocalSession,
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

	// Sync the Radient user information with the user store, but only if authenticated
	useEffect(() => {
		if (!isAuthenticated || !radientUser?.account) {
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
			userStore.updateProfile({
				name: account.name || currentName,
				email: account.email || currentEmail,
			});
		}
	}, [isAuthenticated, radientUser, userStore]);

	return {
		// Authentication state
		authStatus,
		isAuthenticated,
		hasLocalSession,
		isLoading,
		error,

		// User information: only return if authenticated, otherwise null
		user:
			isAuthenticated && radientUser?.account
				? {
						name: radientUser.account.name,
						email: radientUser.account.email,
						radientUser: radientUser as RadientUser,
					}
				: null,

		// Session token for API calls
		sessionToken: session?.accessToken,
		session,
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
