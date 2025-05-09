import { faFile } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { FC } from "react";
import { useCallback } from "react";
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
	// Removed files and openTabs subscriptions to prevent unnecessary re-renders and update loops

	// Handle click on the file attachment
	const handleClick = useCallback(async () => {
		const normalizedPath = file.startsWith("file://")
			? file.substring(7)
			: file;

		const title = getFileName(file);

		const fallbackAction = (err?: string) => {
			if (err) console.error("Error reading file:", err);
			onClick(file);
		};

		try {
			const result = await window.api.readFile(normalizedPath);

			if (result.success && isCanvasSupported(title)) {
				const docId = normalizedPath;
				const newDoc = {
					id: docId,
					title,
					path: normalizedPath,
					content: result.data,
				};
				// Always get the latest files and openTabs from the store to avoid stale closure and update loops
				const state = useCanvasStore.getState();
				const files = state.conversations[conversationId]?.files ?? [];
				const openTabs = state.conversations[conversationId]?.openTabs ?? [];

				// Always update the file content if it exists, or add it if not
				const updatedFiles = (() => {
					const idx = files.findIndex((d) => d.id === docId);
					if (idx !== -1) {
						// Replace the file with the new content
						return [
							...files.slice(0, idx),
							newDoc,
							...files.slice(idx + 1),
						];
					}
					// Add new file
					return [...files, newDoc];
				})();
				setFiles(conversationId, updatedFiles);

				const existsTab = openTabs.some((t) => t.id === docId);
				const updatedTabs = existsTab
					? openTabs
					: [...openTabs, { id: docId, title }];
				setOpenTabs(conversationId, updatedTabs);
				setSelectedTab(conversationId, docId);
				setCanvasOpen(true);
				return;
			}

			// If we get here, result.success must be false
			const errorMessage =
				!result.success && result.error
					? result.error instanceof Error
						? result.error.message
						: String(result.error)
					: "Unknown error";

			return fallbackAction(errorMessage);
		} catch (error: unknown) {
			const message =
				error instanceof Error
					? error.message
					: String(error ?? "Unknown error");
			return fallbackAction(message);
		}
	}, [
		file,
		onClick,
		setFiles,
		setOpenTabs,
		setSelectedTab,
		setCanvasOpen,
		conversationId,
	]);

	return (
		<FileAttachmentContainer
			onClick={handleClick}
			title={`Click to open ${getFileName(file)}`}
		>
			<FileIcon>
				<FontAwesomeIcon icon={faFile} size="sm" />
			</FileIcon>
			<FileName variant="body2">{getFileName(file)}</FileName>
		</FileAttachmentContainer>
	);
};
