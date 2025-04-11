/**
 * @file use-radient-auth.ts
 * @description
 * React hook for accessing Radient authentication state and user information.
 * Integrates with the user store to provide a unified interface for user data.
 * Uses React Query for stable, cached, and automatically refreshing data.
 */

import { useEffect } from "react";
import { useUserStore } from "@renderer/store/user-store";
import { useRadientUserQuery } from "./use-radient-user-query";

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
		sessionToken,
		isLoading,
		error,
		isAuthenticated,
		signOut,
		refreshUser,
	} = useRadientUserQuery();

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

			console.log("Profile synced with Radient account data");
		}
	}, [radientUser, userStore]);

	return {
		// Authentication state
		isAuthenticated,
		isLoading,
		error,

		// User information (from Radient or fallback to user store)
		user: {
			name: radientUser?.account?.name || userStore.profile.name,
			email: radientUser?.account?.email || userStore.profile.email,
			// Include the full Radient user object if available
			radientUser,
		},

		// Session token for API calls
		sessionToken,

		// Actions
		refreshUser,
		signOut,

		// Store actions for direct user store updates
		updateProfile: userStore.updateProfile,
		updateName: userStore.updateName,
		updateEmail: userStore.updateEmail,
	};
};
