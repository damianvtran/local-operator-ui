/**
 * Checks if a file is a markdown file based on its extension
 * @param path - The file path to check
 * @returns True if the file is a markdown file, false otherwise
 */
export const isMarkdownFile = (path: string): boolean => {
	const markdownExtensions = [
		".markdown",
		".md",
		".mdown",
		".mdx",
		".mkd",
		".mkdn",
	];
	const lowerPath = path.toLowerCase();
	return markdownExtensions.some((ext) => lowerPath.endsWith(ext));
};
