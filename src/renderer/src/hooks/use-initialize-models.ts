/**
 * Hook for initializing the models store on application startup
 *
 * This hook ensures that the models data is loaded when the application starts,
 * and refreshed periodically to keep it up to date.
 */

import { useEffect } from "react";
import { useModels } from "./use-models";

/**
 * Hook for initializing the models store
 *
 * @returns Object containing loading state and error
 */
export const useInitializeModels = () => {
	const { isLoading, error, refreshModels } = useModels();

	// Initialize models on mount
	useEffect(() => {
		// Models will be loaded automatically by the useModels hook
	}, []);

	return {
		isLoading,
		error,
		refreshModels,
	};
};
