/**
 * Environment utility functions
 */

/**
 * Check if the application is running in development mode
 * @returns {boolean} True if in development mode, false otherwise
 */
export const isDevelopmentMode = (): boolean => {
	return import.meta.env.DEV === true;
};
