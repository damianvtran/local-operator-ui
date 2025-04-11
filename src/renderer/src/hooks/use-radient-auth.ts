/**
 * @file use-radient-auth.ts
 * @description
 * React hook for accessing Radient authentication state and user information.
 * Integrates with the user store to provide a unified interface for user data.
 */

import { useCallback, useEffect } from "react";
import {
	useRadientUser,
	type RadientAuthContextType,
} from "@renderer/providers/auth";
import { useUserStore } from "@renderer/store/user-store";
import { useFeatureFlags } from "@renderer/providers/feature-flags";
import { clearSession } from "@renderer/utils/session-store";

/**
 * Hook for accessing Radient authentication state and user information
 *
 * This hook:
 * 1. Checks if the Radient Pass feature flag is enabled
 * 2. Attempts to access the Radient auth context if available
 * 3. Updates the user store with Radient user information when authenticated
 * 4. Falls back to the user store if Radient auth is not available
 *
 * @returns An object containing authentication state and user information
 */
export const useRadientAuth = () => {
	const { isEnabled } = useFeatureFlags();
	const isRadientPassEnabled = isEnabled("radient-pass-onboarding");

	// Access the user store
	const userStore = useUserStore();

	// Try to access the Radient auth context, but handle the case where it's not available
	let radientAuth: RadientAuthContextType | null = null;
	let radientAuthError: string | null = null;

	try {
		if (isRadientPassEnabled) {
			radientAuth = useRadientUser();
		}
	} catch (error) {
		radientAuthError = error instanceof Error ? error.message : String(error);
		console.debug("Radient auth context not available:", radientAuthError);
	}

	// Update the user store with Radient user information when authenticated
	useEffect(() => {
		if (radientAuth?.user?.account) {
			const { account } = radientAuth.user;

			// Only update if we have valid data
			if (account.name || account.email) {
				userStore.updateProfile({
					name: account.name || userStore.profile.name,
					email: account.email || userStore.profile.email,
				});
			}
		}
	}, [radientAuth?.user, userStore]);

	// Sign out function to clear the session and refresh the user state
	const signOut = useCallback(async () => {
		// Clear the session token
		clearSession();

		// If we have a refreshUser function from Radient auth, call it to update the state
		if (radientAuth?.refreshUser) {
			await radientAuth.refreshUser();
		}

		return true;
	}, [radientAuth]);

	return {
		// Authentication state
		isAuthenticated: !!radientAuth?.user,
		isLoading: radientAuth?.loading || false,
		error: radientAuth?.error || radientAuthError,

		// User information (from Radient or fallback to user store)
		user: {
			name: radientAuth?.user?.account?.name || userStore.profile.name,
			email: radientAuth?.user?.account?.email || userStore.profile.email,
			// Include the full Radient user object if available
			radientUser: radientAuth?.user || null,
		},

		// Session token for API calls
		sessionToken: radientAuth?.sessionToken || null,

		// Actions
		refreshUser: radientAuth?.refreshUser || (() => Promise.resolve()),
		signOut,

		// Store actions for direct user store updates
		updateProfile: userStore.updateProfile,
		updateName: userStore.updateName,
		updateEmail: userStore.updateEmail,
	};
};
