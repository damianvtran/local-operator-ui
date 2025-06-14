import { faFile } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import { FileActionsMenu } from "@shared/components/common/file-actions-menu";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { FC } from "react";
import { memo, useCallback, useEffect } from "react";
import { getFileTypeFromPath } from "../../utils/file-types";
import { isCanvasSupported } from "../../utils/is-canvas-supported";
import { isSpreadsheetFile } from "../../utils/is-spreadsheet-file";
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
	position: "relative",
	"&:hover": {
		backgroundColor: alpha(
			theme.palette.mode === "dark"
				? theme.palette.common.black
				: theme.palette.grey[300],
			theme.palette.mode === "dark" ? 0.15 : 0.5,
		),
		transform: "translateY(-1px)",
		boxShadow: `0 2px 5px ${alpha(theme.palette.common.black, theme.palette.mode === "dark" ? 0.15 : 0.1)}`,
		"& .file-actions-menu": {
			opacity: 1,
			visibility: "visible",
		},
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

const FileActionsContainer = styled(Box)({
	marginLeft: 8,
	opacity: 0,
	visibility: "hidden",
	transition: "opacity 0.2s ease, visibility 0.2s ease",
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
export const FileAttachment: FC<FileAttachmentProps> = memo(
	({ file, onClick, conversationId }) => {
		const setCanvasOpen = useUiPreferencesStore((s) => s.setCanvasOpen);
		// Access canvas store methods directly via getState() if needed for click, or pass them down if they vary
		// For this refactor, setFiles, setOpenTabs, setSelectedTab are part of the click handler,
		// which is specific to this component's interaction, not the passive metadata collection.
		// addMentionedFile is removed as its functionality is centralized.

		const { setViewMode } = useCanvasStore(); // Add setViewMode from canvas store

		const handleSpreadsheetClick = useCallback(
			async (file: string) => {
				const title = getFileName(file);
				if (isSpreadsheetFile(title)) {
					const { setFiles, setOpenTabs, setSelectedTab } =
						useCanvasStore.getState();
					const normalizedPath = file.startsWith("file://")
						? file.substring(7)
						: file;
					try {
						const result = await window.api.readFile(normalizedPath, "base64");
						if (result.success) {
							const docId = normalizedPath;
							const newDoc = {
								id: docId,
								title,
								path: normalizedPath,
								content: result.data,
								type: getFileTypeFromPath(file),
							};

							const state = useCanvasStore.getState();
							const conversationCanvasState =
								state.conversations?.[conversationId];
							const filesInState = conversationCanvasState?.files ?? [];
							const openTabsInState = conversationCanvasState?.openTabs ?? [];

							const updatedFiles = (() => {
								const idx = filesInState.findIndex((d) => d.id === docId);
								if (idx !== -1) {
									return [
										...filesInState.slice(0, idx),
										newDoc,
										...filesInState.slice(idx + 1),
									];
								}
								return [...filesInState, newDoc];
							})();
							setFiles(conversationId, updatedFiles);

							const existsTab = openTabsInState.some((t) => t.id === docId);
							const updatedTabs = existsTab
								? openTabsInState
								: [...openTabsInState, { id: docId, title }];
							setOpenTabs(conversationId, updatedTabs);
							setSelectedTab(conversationId, docId);
							setCanvasOpen(true);
							setViewMode(conversationId, "documents");
						}
					} catch (error) {
						console.error("Error processing spreadsheet file:", error);
					}
				}
			},
			[conversationId, setCanvasOpen, setViewMode],
		);

		useEffect(() => {
			const autoUpdateOpenFile = async () => {
				const state = useCanvasStore.getState();
				const conversationCanvasState = state.conversations?.[conversationId];
				if (!conversationCanvasState) return;

				const openTabs = conversationCanvasState.openTabs ?? [];
				const filesInState = conversationCanvasState.files ?? [];
				const title = getFileName(file);
				const normalizedPath = file.startsWith("file://")
					? file.substring(7)
					: file;
				const docId = file.startsWith("data:") ? file : normalizedPath;

				const isFileOpen = openTabs.some((tab) => tab.id === docId);
				if (!isFileOpen) return;

				// File is open, so we need to refresh its content
				if (file.startsWith("data:")) {
					const newDoc = {
						id: docId,
						title,
						path: docId,
						content: file,
						type: getFileTypeFromPath(file),
						lastAgentModified: Date.now(),
					};
					const fileIndex = filesInState.findIndex((f) => f.id === docId);
					if (fileIndex !== -1) {
						const updatedFiles = [...filesInState];
						updatedFiles[fileIndex] = newDoc;
						state.setFiles(conversationId, updatedFiles);
					}
				} else {
					try {
						const encoding = isSpreadsheetFile(title) ? "base64" : "utf-8";

						const result = await window.api.readFile(normalizedPath, encoding);
						if (result.success) {
							const newDoc = {
								id: docId,
								title,
								path: normalizedPath,
								content: result.data,
								type: getFileTypeFromPath(file),
								lastAgentModified: Date.now(),
							};
							const fileIndex = filesInState.findIndex((f) => f.id === docId);
							if (fileIndex !== -1) {
								const updatedFiles = [...filesInState];
								updatedFiles[fileIndex] = newDoc;
								state.setFiles(conversationId, updatedFiles);
							}
						}
					} catch (error) {
						console.error(
							`Failed to auto-refresh file in canvas: ${normalizedPath}`,
							error,
						);
					}
				}
			};

			autoUpdateOpenFile();
		}, [file, conversationId]);

		// Handle click on the file attachment
		const handleClick = useCallback(async () => {
			if (isSpreadsheetFile(file)) {
				await handleSpreadsheetClick(file);
				return;
			}
			const title = getFileName(file); // This will be "Pasted Image" for image data URIs
			const fallbackAction = (err?: string) => {
				if (err) console.error("Error processing file:", err);
				onClick(file); // Pass the original file string (path or data URI)
			};

			const { setFiles, setOpenTabs, setSelectedTab } =
				useCanvasStore.getState();

			if (file.startsWith("data:")) {
				// Handle base64 data URI
				if (isCanvasSupported(title)) {
					const docId = file; // Use the data URI itself as a unique ID
					const newDoc = {
						id: docId,
						title,
						path: docId, // Store data URI as path for consistency if needed
						content: file, // The content is the data URI itself
						type: getFileTypeFromPath(file), // Ensure type is included
					};

					const state = useCanvasStore.getState();
					const conversationCanvasState = state.conversations?.[conversationId];
					const filesInState = conversationCanvasState?.files ?? [];
					const openTabsInState = conversationCanvasState?.openTabs ?? [];

					const updatedFiles = (() => {
						const idx = filesInState.findIndex((d) => d.id === docId);
						if (idx !== -1) {
							return [
								...filesInState.slice(0, idx),
								newDoc,
								...filesInState.slice(idx + 1),
							];
						}
						return [...filesInState, newDoc];
					})();
					setFiles(conversationId, updatedFiles);

					const existsTab = openTabsInState.some((t) => t.id === docId);
					const updatedTabs = existsTab
						? openTabsInState
						: [...openTabsInState, { id: docId, title }];
					setOpenTabs(conversationId, updatedTabs);
					setSelectedTab(conversationId, docId);
					setCanvasOpen(true);
					setViewMode(conversationId, "documents"); // Switch canvas view to documents
				} else {
					// Not canvas supported, but it's a data URI.
					// The server will handle it. For client-side, just call onClick.
					onClick(file);
				}
			} else {
				// Handle file path
				const normalizedPath = file.startsWith("file://")
					? file.substring(7)
					: file;
				try {
					const encoding = isSpreadsheetFile(title) ? "base64" : "utf-8";
					const result = await window.api.readFile(normalizedPath, encoding);

					if (result.success && isCanvasSupported(title)) {
						const docId = normalizedPath;
						const newDoc = {
							id: docId,
							title,
							path: normalizedPath,
							content: result.data,
							type: getFileTypeFromPath(file), // Ensure type is included
						};

						const state = useCanvasStore.getState();
						const conversationCanvasState =
							state.conversations?.[conversationId];
						const filesInState = conversationCanvasState?.files ?? [];
						const openTabsInState = conversationCanvasState?.openTabs ?? [];

						const updatedFiles = (() => {
							const idx = filesInState.findIndex((d) => d.id === docId);
							if (idx !== -1) {
								return [
									...filesInState.slice(0, idx),
									newDoc,
									...filesInState.slice(idx + 1),
								];
							}
							return [...filesInState, newDoc];
						})();
						setFiles(conversationId, updatedFiles);

						const existsTab = openTabsInState.some((t) => t.id === docId);
						const updatedTabs = existsTab
							? openTabsInState
							: [...openTabsInState, { id: docId, title }];
						setOpenTabs(conversationId, updatedTabs);
						setSelectedTab(conversationId, docId);
						setCanvasOpen(true);
						setViewMode(conversationId, "documents"); // Switch canvas view to documents
						return;
					}

					const errorMessage =
						!result.success && result.error
							? result.error instanceof Error
								? result.error.message
								: String(result.error)
							: "Unknown error reading file";
					return fallbackAction(errorMessage);
				} catch (error: unknown) {
					const message =
						error instanceof Error
							? error.message
							: String(error ?? "Unknown error reading file");
					return fallbackAction(message);
				}
			}
		}, [
			file,
			onClick,
			setCanvasOpen,
			setViewMode,
			conversationId,
			handleSpreadsheetClick,
		]);

		const isPastedImage = file.startsWith("data:image/");
		const isLocalFile = !file.startsWith("data:") && !file.startsWith("http");
		const normalizedPath = file.startsWith("file://")
			? file.substring(7)
			: file;
		return (
			<FileAttachmentContainer
				onClick={handleClick}
				title={`Click to open ${getFileName(file)}`}
				sx={{
					padding: isPastedImage ? 0 : "8px 12px",
					height: isPastedImage ? "auto" : "auto",
					maxWidth: isPastedImage ? "200px" : "100%",
				}}
			>
				{isPastedImage ? (
					<img
						src={file}
						alt="Pasted content preview"
						style={{
							display: "block",
							maxWidth: "100%",
							maxHeight: "150px",
							borderRadius: "8px",
							objectFit: "contain",
						}}
					/>
				) : (
					<>
						<FileIcon>
							<FontAwesomeIcon icon={faFile} size="sm" />
						</FileIcon>
						<FileName variant="body2">{getFileName(file)}</FileName>
						{isLocalFile && (
							<FileActionsContainer
								className="file-actions-menu"
								onClick={(e) => {
									e.stopPropagation();
								}}
							>
								<FileActionsMenu
									filePath={normalizedPath}
									tooltip="File actions"
									aria-label="File actions"
									onShowInCanvas={handleClick}
								/>
							</FileActionsContainer>
						)}
					</>
				)}
			</FileAttachmentContainer>
		);
	},
);

FileAttachment.displayName = "FileAttachment";
