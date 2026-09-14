/**
 * Store for managing recently selected directories
 *
 * This store keeps track of directories that have been recently selected by the user
 * and provides methods to add, retrieve, and clear the recent directories.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Maximum number of recent directories to store
 */
const MAX_RECENT_DIRECTORIES = 5;

/**
 * Type definition for the recent directories store state
 */
type RecentDirectoriesState = {
	/**
	 * List of recently selected directory paths
	 */
	recentDirectories: string[];

	/**
	 * Add a directory to the recent directories list
	 * @param path - The directory path to add
	 */
	addRecentDirectory: (path: string) => void;

	/**
	 * Remove a single directory from the list.
	 *
	 * The list is a suggestion surface, so a bad entry costs something every
	 * time the menu opens rather than once when it was added. Without a way to
	 * prune it, one typo is permanent.
	 *
	 * @param path - The directory path to forget
	 */
	removeRecentDirectory: (path: string) => void;

	/**
	 * Clear all recent directories
	 */
	clearRecentDirectories: () => void;
};

/**
 * Store for managing recently selected directories
 *
 * Uses zustand's persist middleware to save the state to localStorage
 */
export const useRecentDirectoriesStore = create<RecentDirectoriesState>()(
	persist(
		(set, get) => ({
			recentDirectories: [],

			addRecentDirectory: (path: string) => {
				// Don't add if it's already the most recent one
				if (get().recentDirectories[0] === path) {
					return;
				}

				set((state) => {
					// Filter out the path if it already exists to avoid duplicates
					const filteredDirectories = state.recentDirectories.filter(
						(dir) => dir !== path,
					);

					// Add the new path to the beginning of the array and limit the size
					const newRecentDirectories = [path, ...filteredDirectories].slice(
						0,
						MAX_RECENT_DIRECTORIES,
					);

					return {
						recentDirectories: newRecentDirectories,
					};
				});
			},

			removeRecentDirectory: (path: string) => {
				set((state) => ({
					recentDirectories: state.recentDirectories.filter(
						(dir) => dir !== path,
					),
				}));
			},

			clearRecentDirectories: () => {
				set({ recentDirectories: [] });
			},
		}),
		{
			name: "recent-directories-storage",
		},
	),
);
