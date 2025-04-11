/**
 * @file use-radient-auth.ts
 * @description
 * React hook for accessing Radient authentication state and user information.
 * Integrates with the user store to provide a unified interface for user data.
 * Uses React Query for stable, cached, and automatically refreshing data.
 */

import { useEffect, useRef } from "react";
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

	// Use a ref to track if we've already synced the profile to prevent infinite loops
	const hasSyncedProfileRef = useRef(false);
	// Use a ref to store the last account data we've seen to prevent unnecessary updates
	const lastAccountDataRef = useRef<{id?: string; name?: string; email?: string}>({});

	// Sync the Radient user information with the user store
	useEffect(() => {
		// Skip if we've already synced or if there's no user data
		if (!radientUser?.account) {
			return;
		}

		const { account } = radientUser;

		// Skip if no name or email is provided
		if (!account.name && !account.email) {
			return;
		}

		// Skip if we've already processed this exact account data
		if (
			lastAccountDataRef.current.id === account.id &&
			lastAccountDataRef.current.name === account.name &&
			lastAccountDataRef.current.email === account.email &&
			hasSyncedProfileRef.current
		) {
			return;
		}

		// Get current values from the store
		const { name: currentName, email: currentEmail } = userStore.profile;

		// Only update if the data is different from what's in the store
		if (
			(account.name && account.name !== currentName) ||
			(account.email && account.email !== currentEmail)
		) {
			// Update our refs to track what we've processed
			lastAccountDataRef.current = {
				id: account.id,
				name: account.name,
				email: account.email
			};
			
			// Mark that we've synced the profile
			hasSyncedProfileRef.current = true;

			// Update the store with the new values
			userStore.updateProfile({
				name: account.name || currentName,
				email: account.email || currentEmail,
			});

			console.log("Profile synced with Radient account data");
		} else {
			// Even if we didn't need to update, mark that we've checked this account
			hasSyncedProfileRef.current = true;
			lastAccountDataRef.current = {
				id: account.id,
				name: account.name,
				email: account.email
			};
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [radientUser]);

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
