import type { CanvasDocument } from "@features/chat/types/canvas";
import { fileKind } from "@features/chat/utils/file-kind";

/**
 * Determines the CanvasDocument type based on the file path or data URI.
 *
 * A thin wrapper over `fileKind`, which owns the extension lists. The data-URI
 * branch stays here because it is about a URI's MIME type rather than a path's
 * extension, and both spellings of an inline image (`data:image/png;base64,…`
 * and a name that ends `.png`) must land on the same type.
 *
 * @param filePath - The path or data URI of the file.
 * @returns The determined CanvasDocument type.
 */
export const getFileTypeFromPath = (
	filePath: string,
): CanvasDocument["type"] => {
	if (filePath.startsWith("data:image/")) return "image";
	if (filePath.startsWith("data:video/")) return "video";
	if (filePath.startsWith("data:audio/")) return "audio";
	if (filePath.startsWith("data:application/pdf")) return "pdf";

	return fileKind(filePath);
};
