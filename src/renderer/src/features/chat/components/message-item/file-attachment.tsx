import { faFile } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useCanvasStore } from "@shared/store/canvas-store";
import type { CanvasDocument } from "@features/chat/types/canvas";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { FC } from "react";
import { useCallback, useEffect } from "react";
import { isCanvasSupported } from "../../utils/is-canvas-supported";
/**
 * Props for the FileAttachment component (base)
 */
type BaseFileAttachmentProps = {
	file: string;
	onClick: (file: string) => void;
};

type FileAttachmentProps = BaseFileAttachmentProps & {
	conversationId: string;
};

const RESOURCE_NAME_REGEX = /name=([^;,]+)/;

const getFileTypeFromPath = (filePath: string): CanvasDocument["type"] => {
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
	if (["txt", "log", "csv", "json", "xml", "yaml", "yml"].includes(extension))
		return "text"; // Grouping common text-based formats
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
 * Styled component for non-image file attachments
 * Displays a file icon and filename in a container
 * Includes interactive styling to indicate clickability
 */
const FileAttachmentContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	padding: "8px 12px",
	marginTop: 8,
	backgroundColor: alpha(
		theme.palette.mode === "dark"
			? theme.palette.common.black
			: theme.palette.grey[200],
		theme.palette.mode === "dark" ? 0.1 : 0.5,
	),
	borderRadius: 8,
	boxShadow: `0 1px 4px ${alpha(theme.palette.common.black, theme.palette.mode === "dark" ? 0.1 : 0.05)}`,
	width: "fit-content",
	maxWidth: "100%",
	cursor: "pointer",
	transition: "all 0.2s ease",
	"&:hover": {
		backgroundColor: alpha(
			theme.palette.mode === "dark"
				? theme.palette.common.black
				: theme.palette.grey[300],
			theme.palette.mode === "dark" ? 0.15 : 0.5,
		),
		transform: "translateY(-1px)",
		boxShadow: `0 2px 5px ${alpha(theme.palette.common.black, theme.palette.mode === "dark" ? 0.15 : 0.1)}`,
	},
	"&:active": {
		transform: "translateY(0)",
		boxShadow: `0 1px 3px ${alpha(theme.palette.common.black, theme.palette.mode === "dark" ? 0.1 : 0.05)}`,
	},
}));

const FileIcon = styled(Box)(({ theme }) => ({
	marginRight: 8,
	color: theme.palette.primary.main,
	display: "flex",
	alignItems: "center",
}));

const FileName = styled(Typography)({
	fontSize: "0.85rem",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
	maxWidth: "100%",
	textDecoration: "none",
	"&:hover": {
		textDecoration: "underline",
	},
});

/**
 * Extracts the filename from a path
 * @param path - The file path or URL
 * @returns The extracted filename
 */
const PATH_SEPARATOR_REGEX = /[/\\]/;
const getFileName = (path: string): string => {
	if (path.startsWith("data:image/")) {
		// Attempt to get a name from the data URI if it's there (e.g., from a download attribute)
		// This is a basic heuristic and might not always work.
		const nameMatch = path.match(RESOURCE_NAME_REGEX);
		if (nameMatch?.[1]) {
			try {
				return decodeURIComponent(nameMatch[1]);
			} catch (_) {
				// Fallback if decoding fails
				return "Pasted Image";
			}
		}
		return "Pasted Image";
	}
	if (path.startsWith("data:")) {
		const nameMatch = path.match(RESOURCE_NAME_REGEX);
		if (nameMatch?.[1]) {
			try {
				return decodeURIComponent(nameMatch[1]);
			} catch (_) {
				return "Pasted File";
			}
		}
		return "Pasted File";
	}
	// Handle both local paths and URLs
	const parts = path.split(PATH_SEPARATOR_REGEX);
	return parts[parts.length - 1];
};

/**
 * Component for displaying non-image file attachments
 */
export const FileAttachment: FC<FileAttachmentProps> = ({
	file,
	onClick,
	conversationId,
}) => {
	const setCanvasOpen = useUiPreferencesStore((s) => s.setCanvasOpen);
	const setFiles = useCanvasStore((s) => s.setFiles);
	const setOpenTabs = useCanvasStore((s) => s.setOpenTabs);
	const setSelectedTab = useCanvasStore((s) => s.setSelectedTab);
	const addMentionedFile = useCanvasStore((s) => s.addMentionedFile);
	// Removed files and openTabs subscriptions to prevent unnecessary re-renders and update loops

	const storeFileInCanvas = useCallback(
		async (
			fileToStore: string,
			convId: string,
			baseOnClick: (file: string) => void,
			openInCanvas?: boolean, // If true, also manages tabs and selection
		) => {
			const title = getFileName(fileToStore);
			const fileType = getFileTypeFromPath(fileToStore);

			const fallback = (err?: string) => {
				if (err) console.error("Error processing file for store:", err);
				// Only call baseOnClick if not opening in canvas or if it's a true fallback
				if (!openInCanvas) {
					baseOnClick(fileToStore);
				}
			};

			let docId: string;
			let newDocData: Omit<CanvasDocument, "id" | "type"> & {
				type: CanvasDocument["type"];
			};

			if (fileToStore.startsWith("data:")) {
				docId = fileToStore; // Use the data URI itself as a unique ID
				newDocData = {
					title,
					path: docId,
					content: fileToStore, // The content is the data URI itself
					type: fileType,
				};
				if (openInCanvas && !isCanvasSupported(title)) {
					// If trying to open in canvas but not supported, use fallback
					baseOnClick(fileToStore);
					return; // Don't proceed to store or open tab
				}
			} else {
				const normalizedPath = fileToStore.startsWith("file://")
					? fileToStore.substring(7)
					: fileToStore;
				docId = normalizedPath;

				if (openInCanvas && isCanvasSupported(title)) {
					try {
						const result = await window.api.readFile(normalizedPath);
						if (result.success) {
							newDocData = {
								title,
								path: normalizedPath,
								content: result.data,
								type: fileType,
							};
						} else {
							const errorMessage =
								result.error instanceof Error
									? result.error.message
									: String(result.error);
							fallback(errorMessage);
							if (openInCanvas) baseOnClick(fileToStore); // Fallback to OS open
							return;
						}
					} catch (error: unknown) {
						const message =
							error instanceof Error ? error.message : String(error);
						fallback(message);
						if (openInCanvas) baseOnClick(fileToStore); // Fallback to OS open
						return;
					}
				} else {
					// Not opening in canvas or not canvas supported, store metadata only
					newDocData = {
						title,
						path: normalizedPath,
						content: normalizedPath, // Placeholder: content will be loaded if opened in canvas
						type: fileType,
					};
					if (openInCanvas && !isCanvasSupported(title)) {
						// Trying to open in canvas but not supported
						baseOnClick(fileToStore); // Fallback to OS open
						return; // Don't proceed to store or open tab
					}
				}
			}

			const finalNewDoc: CanvasDocument = { id: docId, ...newDocData };

			const state = useCanvasStore.getState();
			const conversationCanvasState = state.conversations?.[convId];
			const filesInState = conversationCanvasState?.files ?? [];

			const updatedFiles = (() => {
				const idx = filesInState.findIndex((d) => d.id === docId);
				if (idx !== -1) {
					const existingDoc = filesInState[idx];
					// Merge, prioritizing new data, but keep existing content if new content is just a placeholder path
					const mergedDoc = { ...existingDoc, ...finalNewDoc };
					if (
						finalNewDoc.content === finalNewDoc.path && // New content is placeholder
						existingDoc.content !== existingDoc.path && // Old content was not placeholder
						finalNewDoc.content !== existingDoc.content // And content actually differs
					) {
						mergedDoc.content = existingDoc.content;
					}
					return [
						...filesInState.slice(0, idx),
						mergedDoc,
						...filesInState.slice(idx + 1),
					];
				}
				return [...filesInState, finalNewDoc];
			})();
			setFiles(convId, updatedFiles);
			// Track all mentioned files for canvas viewer
			addMentionedFile(convId, finalNewDoc);

			if (openInCanvas && isCanvasSupported(title)) {
				const openTabsInState = conversationCanvasState?.openTabs ?? [];
				const existsTab = openTabsInState.some((t) => t.id === docId);
				const updatedTabs = existsTab
					? openTabsInState
					: [...openTabsInState, { id: docId, title }];
				setOpenTabs(convId, updatedTabs);
				setSelectedTab(convId, docId);
				setCanvasOpen(true);
			} else if (openInCanvas && !isCanvasSupported(title)) {
				baseOnClick(fileToStore); // Fallback to OS open if tried to open unsupported in canvas
			}
		},
		[setFiles, setOpenTabs, setSelectedTab, setCanvasOpen, addMentionedFile],
	);

	useEffect(() => {
		storeFileInCanvas(file, conversationId, onClick, false);
	}, [file, conversationId, onClick, storeFileInCanvas]);

	const handleClick = useCallback(async () => {
		storeFileInCanvas(file, conversationId, onClick, true);
	}, [file, conversationId, onClick, storeFileInCanvas]);

	const isPastedImage = file.startsWith("data:image/");
	return (
		<FileAttachmentContainer
			onClick={handleClick}
			title={`Click to open ${getFileName(file)}`}
			sx={{
				// Adjust padding if it's an image to give it more space, or remove padding
				padding: isPastedImage ? 0 : "8px 12px",
				// If it's an image, let it define its own aspect ratio, otherwise fix height for icon/text
				height: isPastedImage ? "auto" : "auto", // Keep auto or set specific for icon
				maxWidth: isPastedImage ? "200px" : "100%", // Allow images to be a bit wider if needed
			}}
		>
			{isPastedImage ? (
				<img
					src={file}
					alt="Pasted content preview"
					style={{
						display: "block",
						maxWidth: "100%",
						maxHeight: "150px", // Max height for the preview in message
						borderRadius: "8px", // Match container's border radius
						objectFit: "contain",
					}}
				/>
			) : (
				<>
					<FileIcon>
						<FontAwesomeIcon icon={faFile} size="sm" />
					</FileIcon>
					<FileName variant="body2">{getFileName(file)}</FileName>
				</>
			)}
		</FileAttachmentContainer>
	);
};
