import { spreadsheetExtensions } from "./file-kind";

/**
 * Checks if a file is a spreadsheet file based on its extension.
 *
 * The list lives in `file-kind.ts`, which the panel, the type classifier and
 * the viewer router all read. It used to be spelled here as well, and the two
 * spellings disagreed: this one omitted `.tsv`, so a tab-separated export
 * routed to the code editor while `getFileTypeFromPath` called it a
 * spreadsheet.
 *
 * @param path - The file path or name.
 * @returns True if the file is a spreadsheet file, false otherwise.
 */
export const isSpreadsheetFile = (path: string): boolean => {
	const lowerPath = path.toLowerCase();
	return spreadsheetExtensions.some((ext) => lowerPath.endsWith(`.${ext}`));
};
