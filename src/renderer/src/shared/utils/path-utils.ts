/**
 * Utility functions for handling paths in a cross-platform way
 */

/**
 * Normalizes a path to use forward slashes regardless of platform
 * This is important for consistent path handling in Electron apps across platforms
 *
 * @param path - The path to normalize
 * @returns The normalized path with forward slashes
 */
export const normalizePath = (path: string): string => {
	return path.replace(/\\/g, "/");
};

/**
 * Gets the current path from the location, handling both hash and browser router formats
 * Works consistently across platforms (Windows, macOS, Linux)
 *
 * @returns The current path
 */
export const getCurrentPath = (): string => {
	// For HashRouter (e.g., /#/chat)
	if (window.location.hash) {
		return normalizePath(window.location.hash.substring(1)); // Remove the # character
	}

	// For BrowserRouter (e.g., /chat)
	return normalizePath(window.location.pathname);
};

/**
 * Determines if a path includes a specific segment
 * Handles platform-specific path separators
 *
 * @param path - The path to check
 * @param segment - The segment to look for
 * @returns True if the path includes the segment
 */
export const pathIncludes = (path: string, segment: string): boolean => {
	return normalizePath(path).includes(segment);
};
