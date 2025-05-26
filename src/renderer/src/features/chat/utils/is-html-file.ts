/**
 * Checks if a file is an HTML file based on its extension
 * @param path - The file path to check
 * @returns True if the file is an HTML file, false otherwise
 */
export const isHtmlFile = (path: string): boolean => {
	const htmlExtensions = [".html", ".htm"];
	const lowerPath = path.toLowerCase();
	return htmlExtensions.some((ext) => lowerPath.endsWith(ext));
};
