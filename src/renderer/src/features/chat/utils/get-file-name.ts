import { t } from "@shared/i18n";

const RESOURCE_NAME_REGEX = /name=([^;,]+)/;
const PATH_SEPARATOR_REGEX = /[/\\]/;

/**
 * Extracts the filename from a path or data URI.
 * Only synthetic names are localized, on demand so a locale switch cannot
 * leave cached English behind. Real names and path basenames stay verbatim.
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
				return t("ui.chat.composer_media.pasted_image");
			}
		}
		return t("ui.chat.composer_media.pasted_image");
	}
	if (path.startsWith("data:")) {
		// Non-image data deliberately shares one generic fallback, not MIME-derived
		// prose: a technical identifier must not become authored product chrome.
		const nameMatch = path.match(RESOURCE_NAME_REGEX);
		if (nameMatch?.[1]) {
			try {
				return decodeURIComponent(nameMatch[1]);
			} catch (_) {
				return t("ui.chat.composer_media.pasted_file");
			}
		}
		return t("ui.chat.composer_media.pasted_file");
	}
	// Handle both local paths and URLs
	const parts = path.split(PATH_SEPARATOR_REGEX);
	return parts[parts.length - 1];
};
