import { markdownExtensions } from "./file-kind";

/**
 * Checks if a file is a markdown file based on its extension.
 *
 * The list lives in `file-kind.ts` and is shared with `getFileTypeFromPath` and
 * the viewer router; this module keeps its name because call sites read better
 * as a question.
 *
 * @param path - The file path to check
 * @returns True if the file is a markdown file, false otherwise
 */
export const isMarkdownFile = (path: string): boolean => {
	const lowerPath = path.toLowerCase();
	return markdownExtensions.some((ext) => lowerPath.endsWith(`.${ext}`));
};
