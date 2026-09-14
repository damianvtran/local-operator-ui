/**
 * Models Initializer Component
 *
 * This component initializes the models store on application startup.
 * It doesn't render anything visible, but ensures models data is loaded.
 *
 * The initialization is done with a delay to prevent multiple fetches
 * during application startup, which can cause infinite loops.
 */

import { useInitializeModels } from "@shared/hooks/use-initialize-models";
import type { FC } from "react";
import { memo } from "react";

/**
 * Models Initializer Component
 *
 * Initializes the models store on application startup.
 * Memoized to prevent unnecessary re-renders.
 */
export const ModelsInitializer: FC = memo(() => {
	// Initialize models store
	useInitializeModels();

	// This component doesn't render anything
	return null;
});

// Display name for debugging
ModelsInitializer.displayName = "ModelsInitializer";
