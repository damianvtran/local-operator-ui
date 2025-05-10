/**
 * Store for managing deferred application updates (UI and backend separately)
 *
 * This store keeps track of updates that have been deferred by the user
 * for both the UI and backend, and provides methods to check if an update
 * should be shown based on deferral status and timeline.
 */

import { create } from "zustand";
import type { StoreApi } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Default defer timeline in milliseconds (48 hours)
 */
export const DEFAULT_DEFER_TIMELINE_MS = 48 * 60 * 60 * 1000;

/**
 * Enum for update kind
 */
export enum UpdateType {
	UI = "ui",
	BACKEND = "backend",
}

/**
 * Type definition for the deferred updates store state
 */
type DeferredUpdatesState = {
	/**
	 * The UI version that was deferred
	 */
	uiDeferredVersion: string | null;
	/**
	 * The timestamp when the UI update was deferred
	 */
	uiDeferredAt: number | null;

	/**
	 * The backend version that was deferred
	 */
	backendDeferredVersion: string | null;
	/**
	 * The timestamp when the backend update was deferred
	 */
	backendDeferredAt: number | null;

	/**
	 * Whether the store has been hydrated from persistent storage
	 */
	hydrated: boolean;

	/**
	 * Defer an update to be shown later
	 * @param type - "ui" or "backend"
	 * @param version - The version being deferred
	 */
	deferUpdate: (type: UpdateType, version: string) => void;

	/**
	 * Check if an update should be shown based on deferral status and timeline
	 * @param type - "ui" or "backend"
	 * @param version - The version to check
	 * @returns Whether the update should be shown
	 */
	shouldShowUpdate: (type: UpdateType, version: string) => boolean;

	/**
	 * Clear deferred update information
	 * @param type - "ui" or "backend" (if omitted, clear both)
	 */
	clearDeferredUpdate: (type: UpdateType) => void;
};

/**
 * Store for managing deferred updates
 *
 * Uses zustand's persist middleware to save the state to localStorage
 */
export const useDeferredUpdatesStore = create<DeferredUpdatesState>()(
	persist(
		(set, get) => ({
			uiDeferredVersion: null,
			uiDeferredAt: null,
			backendDeferredVersion: null,
			backendDeferredAt: null,
			hydrated: false,

			deferUpdate: (type: UpdateType, version: string) => {
				if (type === UpdateType.UI) {
					set({
						uiDeferredVersion: version,
						uiDeferredAt: Date.now(),
					});
				} else {
					set({
						backendDeferredVersion: version,
						backendDeferredAt: Date.now(),
					});
				}
			},

			shouldShowUpdate: (type: UpdateType, version: string) => {
				const {
					uiDeferredVersion,
					uiDeferredAt,
					backendDeferredVersion,
					backendDeferredAt,
				} = get();

				let deferredVersion: string | null;
				let deferredAt: number | null;
				if (type === UpdateType.UI) {
					deferredVersion = uiDeferredVersion;
					deferredAt = uiDeferredAt;
				} else {
					deferredVersion = backendDeferredVersion;
					deferredAt = backendDeferredAt;
				}

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

			clearDeferredUpdate: (type: UpdateType) => {
				if (type === UpdateType.UI) {
					set({
						uiDeferredVersion: null,
						uiDeferredAt: null,
					});
				} else if (type === UpdateType.BACKEND) {
					set({
						backendDeferredVersion: null,
						backendDeferredAt: null,
					});
				} else {
					throw new Error(`Invalid update type: ${type}`);
				}
			},
		}),
		{
			name: "deferred-updates-storage",
			onRehydrateStorage: () => (store) => {
				if (
					store &&
					typeof store === "object" &&
					"setState" in store &&
					typeof (store as unknown as StoreApi<DeferredUpdatesState>)
						.setState === "function"
				) {
					(store as unknown as StoreApi<DeferredUpdatesState>).setState({
						hydrated: true,
					});
				}
			},
		},
	),
);
