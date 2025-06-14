/**
 * Checks if a file is a spreadsheet file based on its extension.
 * @param path - The file path or name.
 * @returns True if the file is a spreadsheet file, false otherwise.
 */
export const isSpreadsheetFile = (path: string): boolean => {
	const spreadsheetExtensions = [
		".xlsx",
		".xls",
		".csv",
		".ods",
		// Add other spreadsheet extensions if needed
	];
	const lowerPath = path.toLowerCase();
	return spreadsheetExtensions.some((ext) => lowerPath.endsWith(ext));
};
