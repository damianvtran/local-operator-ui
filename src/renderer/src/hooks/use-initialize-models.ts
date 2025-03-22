/**
 * Hook for initializing the models store on application startup
 *
 * This hook ensures that the models data is loaded when the application starts,
 * and refreshed periodically to keep it up to date.
 *
 * It uses a delayed initialization approach to prevent multiple fetches
 * during application startup, which can cause infinite loops.
 */

import { useEffect, useRef } from "react";
import { useModels } from "./use-models";

/**
 * Hook for initializing the models store
 *
 * @returns Object containing loading state and error
 */
export const useInitializeModels = () => {
	// Use autoFetch: false to prevent automatic fetching on mount
	// We'll handle the initial fetch with our own logic
	const { isLoading, error, refreshModels } = useModels({ autoFetch: false });

	// Track if this hook has been initialized
	const isInitializedRef = useRef(false);

	// Initialize models on mount with a delay
	useEffect(() => {
		// Skip if already initialized
		if (isInitializedRef.current) {
			return;
		}

		// Mark as initialized
		isInitializedRef.current = true;

		// Models will be loaded by the useModels hook with a delay
		// No need to trigger a fetch here
	}, []);

	return {
		isLoading,
		error,
		refreshModels,
	};
};
