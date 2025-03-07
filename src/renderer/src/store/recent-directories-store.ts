/**
 * Store for managing recently selected directories
 * 
 * This store keeps track of directories that have been recently selected by the user
 * and provides methods to add, retrieve, and clear the recent directories.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
        
        // Log for debugging
        console.log('Adding to recent directories:', path);
        
        set((state) => {
          // Filter out the path if it already exists to avoid duplicates
          const filteredDirectories = state.recentDirectories.filter(
            (dir) => dir !== path
          );
          
          // Add the new path to the beginning of the array and limit the size
          const newRecentDirectories = [
            path,
            ...filteredDirectories,
          ].slice(0, MAX_RECENT_DIRECTORIES);
          
          // Log the updated list
          console.log('Updated recent directories:', newRecentDirectories);
          
          return {
            recentDirectories: newRecentDirectories,
          };
        });
      },
      
      clearRecentDirectories: () => {
        set({ recentDirectories: [] });
      },
    }),
    {
      name: 'recent-directories-storage',
    }
  )
);
