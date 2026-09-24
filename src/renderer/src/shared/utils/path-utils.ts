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
 * A path shortened IN THE MIDDLE to at most `max` characters:
 * `~/.local-operator/sessions/d81d/scratchpad/chat-redesign/workspace/app`
 * becomes `~/.local-operator/…/workspace/app`.
 *
 * WHY THE MIDDLE (chat redesign §B4/§C2, design round 1, D6). The chat header's
 * path is a quiet chip beside the conversation's title, and the two ends are
 * the informative ones: the head says where it is rooted (`~`, a drive, the
 * first directory under home) and the tail says WHICH directory it is. CSS can
 * only ellipsise one end - the header used to cut the head with `dir="rtl"`,
 * which kept the tail but lost every sign of where the path was rooted, and at
 * a narrow width it still took the title's room to show 300px of path. This
 * gives the chip a bounded length, so the title keeps its words.
 *
 * Whole segments are kept from the END until the budget runs out, and the head
 * keeps its first segment (after a leading `~` or `/`, so `~/code` rather than
 * a bare `~`). A last segment that alone overruns the budget is cut from its
 * own start, which is the one case where the head is dropped entirely.
 *
 * @param path - The display form (already `~`-abbreviated by `formatDirectory`)
 * @param max - The character budget, ellipsis included
 */
export const middleTruncatePath = (path: string, max: number): string => {
	if (path.length <= max) return path;
	const parts = path.split("/");
	const last = parts[parts.length - 1] ?? "";
	if (last.length + 1 >= max) return `…${last.slice(-(max - 1))}`;
	// The head: `~/first` or `/first`, the first real segment and its root.
	const rooted = parts[0] === "~" || parts[0] === "";
	const headParts = rooted ? parts.slice(0, 2) : parts.slice(0, 1);
	const rest = parts.slice(headParts.length);
	/** The longest run of whole trailing segments that fits beside `head`. */
	const tailFor = (head: string): string[] => {
		const room = max - head.length - (head ? 3 : 2); // "/…/" or "…/"
		let tail: string[] = [];
		for (let i = rest.length - 1; i >= 0; i -= 1) {
			const next = [rest[i], ...tail];
			if (next.join("/").length > room) break;
			tail = next;
		}
		return tail;
	};
	const join = (head: string, tail: string[]) =>
		head ? `${head}/…/${tail.join("/")}` : `…/${tail.join("/")}`;
	// The full head first; if it leaves no room for even the last segment, keep
	// only the root (`~`, or nothing for a relative path).
	const fullHead = headParts.join("/");
	const tail = tailFor(fullHead);
	if (tail.length > 0) {
		if (tail.length === rest.length) return path;
		return join(fullHead, tail);
	}
	const root = rooted ? parts[0] : "";
	const rootTail = tailFor(root);
	return join(root, rootTail.length > 0 ? rootTail : [last]);
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
