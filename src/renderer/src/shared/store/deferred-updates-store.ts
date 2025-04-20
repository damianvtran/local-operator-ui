/**
 * Store for managing deferred application updates
 *
 * This store keeps track of updates that have been deferred by the user
 * and provides methods to check if an update should be shown based on
 * deferral status and timeline.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Default defer timeline in milliseconds (48 hours)
 */
export const DEFAULT_DEFER_TIMELINE_MS = 48 * 60 * 60 * 1000;

/**
 * Type definition for the deferred updates store state
 */
type DeferredUpdatesState = {
	/**
	 * The version that was deferred
	 */
	deferredVersion: string | null;

	/**
	 * The timestamp when the update was deferred
	 */
	deferredAt: number | null;

	/**
	 * Defer an update to be shown later
	 * @param version - The version being deferred
	 */
	deferUpdate: (version: string) => void;

	/**
	 * Check if an update should be shown based on deferral status and timeline
	 * @param version - The version to check
	 * @returns Whether the update should be shown
	 */
	shouldShowUpdate: (version: string) => boolean;

	/**
	 * Clear deferred update information
	 */
	clearDeferredUpdate: () => void;
};

/**
 * Store for managing deferred updates
 *
 * Uses zustand's persist middleware to save the state to localStorage
 */
export const useDeferredUpdatesStore = create<DeferredUpdatesState>()(
	persist(
		(set, get) => ({
			deferredVersion: null,
			deferredAt: null,

			deferUpdate: (version: string) => {
				set({
					deferredVersion: version,
					deferredAt: Date.now(),
				});
			},

			shouldShowUpdate: (version: string) => {
				const { deferredVersion, deferredAt } = get();

				// If no update has been deferred, show the update
				if (!deferredVersion || !deferredAt) {
					return true;
				}

				// If this is a different version than the deferred one, show the update
				if (deferredVersion !== version) {
					return true;
				}

				// Check if the defer timeline has passed
				const now = Date.now();
				const timeElapsed = now - deferredAt;

				return timeElapsed > DEFAULT_DEFER_TIMELINE_MS;
			},

			clearDeferredUpdate: () => {
				set({
					deferredVersion: null,
					deferredAt: null,
				});
			},
		}),
		{
			name: "deferred-updates-storage",
		},
	),
);
