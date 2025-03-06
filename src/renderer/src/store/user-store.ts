/**
 * User Store
 *
 * Manages user profile information using Zustand.
 * Provides a persistent store for user details during the user's session.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * User profile information
 */
type UserProfile = {
	/**
	 * User's display name
	 */
	name: string;

	/**
	 * User's email address
	 */
	email: string;
};

/**
 * User store state interface
 */
type UserState = {
	/**
	 * User profile information
	 */
	profile: UserProfile;

	/**
	 * Update the user's name
	 * @param name - The new name to set
	 */
	updateName: (name: string) => void;

	/**
	 * Update the user's email
	 * @param email - The new email to set
	 */
	updateEmail: (email: string) => void;

	/**
	 * Update the entire user profile
	 * @param profile - The new profile information
	 */
	updateProfile: (profile: Partial<UserProfile>) => void;
};

/**
 * Default user profile values
 */
const DEFAULT_PROFILE: UserProfile = {
	name: "User",
	email: "user@example.com",
};

/**
 * User store implementation using Zustand with persistence
 * Stores user profile information in localStorage
 */
export const useUserStore = create<UserState>()(
	persist(
		(set) => ({
			profile: DEFAULT_PROFILE,

			updateName: (name) => {
				set((state) => ({
					profile: {
						...state.profile,
						name,
					},
				}));
			},

			updateEmail: (email) => {
				set((state) => ({
					profile: {
						...state.profile,
						email,
					},
				}));
			},

			updateProfile: (profile) => {
				set((state) => ({
					profile: {
						...state.profile,
						...profile,
					},
				}));
			},
		}),
		{
			name: "user-profile-storage",
		},
	),
);
