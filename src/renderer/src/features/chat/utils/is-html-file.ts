import { htmlExtensions } from "./file-kind";

/**
 * Checks if a file is an HTML file based on its extension
 *
 * The list lives in `file-kind.ts` with every other extension set, so
 * `.xhtml` is an HTML file here exactly when `getFileTypeFromPath` says so.
 *
 * @param path - The file path to check
 * @returns True if the file is an HTML file, false otherwise
 */
export const isHtmlFile = (path: string): boolean => {
	const lowerPath = path.toLowerCase();
	return htmlExtensions.some((ext) => lowerPath.endsWith(`.${ext}`));
};
