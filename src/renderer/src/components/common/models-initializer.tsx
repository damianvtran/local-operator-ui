/**
 * Models Initializer Component
 * 
 * This component initializes the models store on application startup.
 * It doesn't render anything visible, but ensures models data is loaded.
 */

import { useInitializeModels } from "@renderer/hooks/use-initialize-models";
import type { FC } from "react";

/**
 * Models Initializer Component
 * 
 * Initializes the models store on application startup.
 */
export const ModelsInitializer: FC = () => {
	// Initialize models store
	useInitializeModels();
	
	// This component doesn't render anything
	return null;
};
