import { t } from "../../../../../i18n/messages";

const RESOURCE_NAME_REGEX = /name=([^;,]+)/;
const PATH_SEPARATOR_REGEX = /[/\\]/;
const DATA_URI_REGEX = /^data:([^;,]+)/;

/**
 * The real name a data URI carries in its own metadata, decoded, or `null`.
 *
 * Shared by the model name and the display name so a `name=` that fails to
 * decode cannot give the two halves different answers.
 */
const resourceName = (path: string): string | null => {
	const match = path.match(RESOURCE_NAME_REGEX);
	if (!match?.[1]) return null;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return null;
	}
};

/** The media type's major half (`image`, `audio`, ...), or `null`. */
const dataUriType = (path: string): string | null => {
	const match = path.match(DATA_URI_REGEX);
	return match?.[1]?.split("/")[0] || null;
};

const hasPastedFallback = (path: string): boolean =>
	path.startsWith("data:") && resourceName(path) === null;

/**
 * The filename for a path or data URI, LOCALE-NEUTRAL.
 *
 * WHY THE FALLBACKS ARE FIXED ENGLISH AND NOT `t()`: this value is a MODEL
 * name, not a label. `canvasDocumentForPath` writes it into
 * `CanvasDocument.title` and `CanvasFileViewer` copies it into the persisted
 * `openTabs`, so a translated fallback would freeze the language of the moment
 * a picture was pasted into stored state — reopening the canvas in another
 * language would show a tab in the old one, and switching back would leave two
 * spellings of the same document across sessions. The displayed name comes
 * from `fileNameForDisplay` at render time instead (see `documentNameForDisplay`
 * for stored documents), which is where the active locale is read.
 *
 * The neutral spellings are the ones this function shipped before the
 * translation lane, so stored titles from older builds keep matching.
 *
 * @param path - The file path or URL.
 * @returns The extracted filename.
 */
export const getFileName = (path: string): string => {
	const named = resourceName(path);
	if (named !== null) return named;
	if (path.startsWith("data:image/")) return "Pasted image";
	if (path.startsWith("data:")) {
		const simpleType = dataUriType(path);
		if (simpleType) return `Pasted ${simpleType} file`;
		return "Pasted file";
	}
	// Handle both local paths and URLs
	const parts = path.split(PATH_SEPARATOR_REGEX);
	return parts[parts.length - 1];
};

/**
 * The same name, for DISPLAY.
 *
 * `t()` is read when this is called, so a rendered label follows the active
 * locale and a language switch re-labels without touching stored state.
 */
export const fileNameForDisplay = (path: string): string => {
	const named = resourceName(path);
	if (named !== null) return named;
	if (path.startsWith("data:image/")) {
		return t("ui.chat.get_file_name.pasted_image");
	}
	if (path.startsWith("data:")) {
		const simpleType = dataUriType(path);
		if (simpleType) {
			return t("ui.chat.get_file_name.pasted_simpletype_file", { simpleType });
		}
		return t("ui.chat.get_file_name.pasted_file");
	}
	const parts = path.split(PATH_SEPARATOR_REGEX);
	return parts[parts.length - 1];
};

/**
 * A canvas document's on-screen name.
 *
 * A pasted document has no filename of its own, so its display name is derived
 * from the PATH on every render rather than read from `title`: titles stored by
 * older builds hold whatever language was active on the day the picture was
 * pasted, and a stored string cannot be re-translated. Everything with a real
 * name (a file, an artifact) keeps its stored title, which is neutral or was
 * produced by the model.
 */
export const documentNameForDisplay = (document: {
	path: string;
	title: string;
}): string =>
	hasPastedFallback(document.path)
		? fileNameForDisplay(document.path)
		: document.title;
