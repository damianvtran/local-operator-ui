import type { CanvasDocument } from "@features/chat/types/canvas";

/**
 * Determines the CanvasDocument type based on the file path or data URI.
 * @param filePath - The path or data URI of the file.
 * @returns The determined CanvasDocument type.
 */
export const getFileTypeFromPath = (
	filePath: string,
): CanvasDocument["type"] => {
	if (filePath.startsWith("data:image/")) return "image";
	if (filePath.startsWith("data:video/")) return "video";
	if (filePath.startsWith("data:application/pdf")) return "pdf";
	// Add more specific data URI checks if necessary for other types like audio, text etc.

	const extension = filePath.split(".").pop()?.toLowerCase();
	if (!extension) return "other";

	if (["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"].includes(extension))
		return "image";
	if (["mp4", "webm", "ogg", "mov", "avi", "mkv"].includes(extension))
		return "video";
	if (["pdf"].includes(extension)) return "pdf";
	if (["md", "markdown"].includes(extension)) return "markdown";
	if (["html", "htm"].includes(extension)) return "html";
	if (["zip", "tar", "gz", "rar", "7z"].includes(extension)) return "archive";
	if (["txt", "log"].includes(extension)) return "text"; // Grouping common text-based formats
	if (
		[
			"js",
			"ts",
			"jsx",
			"tsx",
			"py",
			"java",
			"c",
			"cpp",
			"cs",
			"go",
			"rb",
			"php",
			"sh",
			"css",
			"scss",
			"less",
			"json",
			"xml",
			"yaml",
			"yml",
		].includes(extension)
	)
		return "code";
	if (["doc", "docx", "odt"].includes(extension)) return "document";
	if (["xls", "xlsx", "ods", "csv", "tsv"].includes(extension))
		return "spreadsheet";
	if (["ppt", "pptx", "odp"].includes(extension)) return "presentation";
	if (["mp3", "wav", "aac", "flac"].includes(extension)) return "audio";

	return "other";
};
