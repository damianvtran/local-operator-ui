const RESOURCE_NAME_REGEX = /name=([^;,]+)/;
const PATH_SEPARATOR_REGEX = /[/\\]/;
const DATA_URI_REGEX = /^data:([^;,]+)/;

/**
 * Extracts the filename from a path or data URI.
 * @param path - The file path or URL.
 * @returns The extracted filename.
 */
export const getFileName = (path: string): string => {
	if (path.startsWith("data:image/")) {
		const nameMatch = path.match(RESOURCE_NAME_REGEX);
		if (nameMatch?.[1]) {
			try {
				return decodeURIComponent(nameMatch[1]);
			} catch (_) {
				return "Pasted image";
			}
		}
		return "Pasted image";
	}
	if (path.startsWith("data:")) {
		// Generic data URI
		const nameMatch = path.match(RESOURCE_NAME_REGEX);
		if (nameMatch?.[1]) {
			try {
				return decodeURIComponent(nameMatch[1]);
			} catch (_) {
				return "Pasted file";
			}
		}
		// Try to infer from mime type if no name is present
		const mimeTypeMatch = path.match(DATA_URI_REGEX);
		if (mimeTypeMatch?.[1]) {
			const simpleType = mimeTypeMatch[1].split("/")[0];
			if (simpleType) {
				return `Pasted ${simpleType} file`;
			}
		}
		return "Pasted file";
	}
	// Handle both local paths and URLs
	const parts = path.split(PATH_SEPARATOR_REGEX);
	return parts[parts.length - 1];
};
