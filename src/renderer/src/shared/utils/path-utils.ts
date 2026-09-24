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
 * The home-abbreviated form of a directory: `/Users/you/src/project` renders as
 * `~/src/project`.
 *
 * HOISTED OUT OF THE COMPOSER'S DIRECTORY CHIP (`directory-indicator.tsx`) when
 * the chat header started printing the same fact, because one fact with two
 * spellings three inches apart is the drift this file exists to prevent: the
 * chip printed the `~` form, the header printed the raw absolute path, and the
 * 12 characters they differed by (`/Users/<account>`) are exactly the ones that
 * decide whether the segment identifying a directory survives in a row that is
 * routinely truncated. The chip's rule is the one the app already shipped, so
 * the header takes it rather than a second implementation.
 *
 * `homeDirectory` is a parameter rather than a fetch because this module is
 * pure and the renderer has no `homedir()` to ask - it runs with
 * `contextIsolation` and no node, so the value comes from the bridge
 * (`useHomeDirectory`). A null home directory (the bridge's answer before it
 * has answered, or a harness without it) leaves the path unshortened rather than
 * guessing.
 *
 * A string that is not a path at all is returned unchanged: the header is also
 * handed prose (`The session starts when you send your first message.`) and an
 * agent name, and neither is a path to shorten.
 *
 * @param dir - The path to render
 * @param homeDirectory - The account's home directory, or null while unknown
 * @returns The `~` form when `dir` sits under the home directory, else `dir`
 *   with backslashes normalised
 */
export const formatDirectory = (
	dir: string,
	homeDirectory: string | null,
): string => {
	if (homeDirectory && dir.startsWith(homeDirectory)) {
		// Ensure consistent path separators (especially for Windows)
		const relativePath = dir.substring(homeDirectory.length);
		// Add separator if needed, handle both '/' and '\'
		if (
			relativePath.startsWith("/") ||
			relativePath.startsWith("\\") ||
			relativePath === ""
		) {
			return `~${relativePath.replace(/\\/g, "/")}`;
		}
		return `~/${relativePath.replace(/\\/g, "/")}`;
	}
	// Handle the case where the path is exactly the home directory
	if (homeDirectory && dir === homeDirectory) {
		return "~";
	}
	// Handle explicit '~' path from default directories
	if (dir === "~") {
		return "~";
	}
	return dir.replace(/\\/g, "/"); // Always use forward slashes for display
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
