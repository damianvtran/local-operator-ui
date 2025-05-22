/**
 * Store for managing low credits state
 *
 * This store keeps track of whether the user has been notified about low credits.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Type definition for the low credits store state
 */
type LowCreditsState = {
	/**
	 * Whether the user has been notified about low credits
	 */
	hasBeenNotified: boolean;

	/**
	 * Set the notified state
	 * @param notified - Whether the user has been notified
	 */
	setHasBeenNotified: (notified: boolean) => void;
};

/**
 * Store for managing low credits state
 *
 * Uses zustand's persist middleware to save the state to localStorage
 */
export const useLowCreditsStore = create<LowCreditsState>()(
	persist(
		(set) => ({
			hasBeenNotified: false,
			setHasBeenNotified: (notified: boolean) => {
				set({
					hasBeenNotified: notified,
				});
			},
		}),
		{
			name: "low-credits-storage",
		},
	),
);
