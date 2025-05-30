import { alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import { type FC, useState, useCallback, useEffect } from "react";
import { useCanvasStore } from "@shared/store/canvas-store";
import type { CanvasDocument } from "@features/chat/types/canvas";
import { InvalidAttachment } from "./invalid-attachment";

/**
 * Props for the ImageAttachment component (base)
 */
type BaseImageAttachmentProps = {
	file: string;
	src: string;
	onClick: (file: string) => void;
};

export type ImageAttachmentProps = BaseImageAttachmentProps & {
	conversationId: string;
};

/**
 * Styled component for image attachments
 * Includes hover effects and styling
 */
const AttachmentImage = styled("img")(({ theme }) => ({
	maxWidth: "100%",
	maxHeight: 200,
	borderRadius: 8,
	marginBottom: 8,
	boxShadow: `0 2px 8px ${alpha(theme.palette.common.black, theme.palette.mode === "dark" ? 0.15 : 0.1)}`,
	cursor: "pointer",
	transition: "transform 0.2s ease, box-shadow 0.2s ease",
	"&:hover": {
		transform: "scale(1.02)",
		boxShadow: `0 4px 12px ${alpha(theme.palette.common.black, theme.palette.mode === "dark" ? 0.25 : 0.15)}`,
	},
}));

/**
 * Extracts the filename from a path
 * @param path - The file path or URL
 * @returns The extracted filename
 */
const PATH_SEPARATOR_REGEX = /[/\\]/;
const getFileName = (path: string): string => {
	// Handle both local paths and URLs
	const parts = path.split(PATH_SEPARATOR_REGEX);
	return parts[parts.length - 1];
};

const getFileTypeFromPath = (filePath: string): CanvasDocument["type"] => {
	if (filePath.startsWith("data:image/")) return "image";
	if (filePath.startsWith("data:video/")) return "video";
	if (filePath.startsWith("data:application/pdf")) return "pdf";

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
	if (["txt", "log", "csv", "json", "xml", "yaml", "yml"].includes(extension))
		return "text";
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
		].includes(extension)
	)
		return "code";
	if (["doc", "docx", "odt"].includes(extension)) return "document";
	if (["xls", "xlsx", "ods"].includes(extension)) return "spreadsheet";
	if (["ppt", "pptx", "odp"].includes(extension)) return "presentation";
	if (["mp3", "wav", "aac", "flac"].includes(extension)) return "audio";

	return "other";
};

/**
 * Component for displaying image attachments
 * Handles image loading errors and displays an InvalidAttachment component if the image fails to load
 */
export const ImageAttachment: FC<ImageAttachmentProps> = ({
	file,
	src,
	onClick,
	conversationId,
}) => {
	// State to track if the image has failed to load
	const [hasError, setHasError] = useState(false);
	const addMentionedFile = useCanvasStore((s) => s.addMentionedFile);

	const storeFileInCanvas = useCallback(
		async (fileToStore: string, convId: string) => {
			const title = getFileName(fileToStore);
			const fileType = getFileTypeFromPath(fileToStore);

			let docId: string;
			let newDocData: Omit<CanvasDocument, "id" | "type"> & {
				type: CanvasDocument["type"];
			};

			if (fileToStore.startsWith("data:")) {
				docId = fileToStore;
				newDocData = {
					title,
					path: docId,
					content: fileToStore,
					type: fileType,
				};
			} else {
				const normalizedPath = fileToStore.startsWith("file://")
					? fileToStore.substring(7)
					: fileToStore;
				docId = normalizedPath;
				newDocData = {
					title,
					path: normalizedPath,
					content: normalizedPath,
					type: fileType,
				};
			}

			const finalNewDoc: CanvasDocument = { id: docId, ...newDocData };
			addMentionedFile(convId, finalNewDoc);
		},
		[addMentionedFile],
	);

	useEffect(() => {
		storeFileInCanvas(file, conversationId);
	}, [file, conversationId, storeFileInCanvas]);

	const handleClick = () => {
		onClick(file);
	};

	const handleError = () => {
		// Set error state when image fails to load
		setHasError(true);
	};

	// If the image failed to load, show the InvalidAttachment component
	if (hasError) {
		return <InvalidAttachment file={file} />;
	}

	// Otherwise, render the image with an error handler
	return (
		<AttachmentImage
			src={src}
			alt={getFileName(file)}
			onClick={handleClick}
			onError={handleError}
			title={`Click to open ${getFileName(file)}`}
		/>
	);
};
