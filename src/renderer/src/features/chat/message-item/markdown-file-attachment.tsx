import { faFileAlt } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import { createLocalOperatorClient } from "@renderer/api/local-operator";
import { apiConfig } from "@renderer/config";
import { useCanvasStore } from "@renderer/store/canvas-store";
import type { FC } from "react";
import { useCallback, useState } from "react";
import type { FileAttachmentProps } from "./types";

/**
 * Styled component for markdown file attachments
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
	boxShadow: `0 1px 4px ${alpha(
		theme.palette.common.black,
		theme.palette.mode === "dark" ? 0.1 : 0.05,
	)}`,
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
		boxShadow: `0 2px 5px ${alpha(
			theme.palette.common.black,
			theme.palette.mode === "dark" ? 0.15 : 0.1,
		)}`,
	},
	"&:active": {
		transform: "translateY(0)",
		boxShadow: `0 1px 3px ${alpha(
			theme.palette.common.black,
			theme.palette.mode === "dark" ? 0.1 : 0.05,
		)}`,
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
const getFileName = (path: string): string => {
	// Handle both local paths and URLs
	const parts = path.split(/[/\\]/);
	return parts[parts.length - 1];
};

/**
 * Checks if a file is a markdown file based on its extension
 * @param path - The file path to check
 * @returns True if the file is a markdown file, false otherwise
 */
export const isMarkdownFile = (path: string): boolean => {
	const markdownExtensions = [".md", ".markdown", ".mdown", ".mkdn", ".mkd"];
	const lowerPath = path.toLowerCase();
	return markdownExtensions.some((ext) => lowerPath.endsWith(ext));
};

/**
 * Component for displaying markdown file attachments
 * Opens markdown files in the canvas when clicked
 */
export const MarkdownFileAttachment: FC<FileAttachmentProps> = ({
	file,
	onClick,
}) => {
	const [isLoading, setIsLoading] = useState(false);
	const { openDocument } = useCanvasStore();

	// Handle clicking on a markdown file
	const handleClick = useCallback(async () => {
		if (!isMarkdownFile(file)) {
			// If not a markdown file, use the default handler
			onClick(file);
			return;
		}

		setIsLoading(true);

		try {
			// Get the file content
			const normalizedPath = file.startsWith("file://")
				? file.substring(7)
				: file;
			const fileName = getFileName(file);

			// Read the file content using the preload API
			const result = await window.api.readFile(normalizedPath);

			if (result.success) {
				// Open the document in the markdown canvas with the actual file content
				openDocument(fileName, result.data, normalizedPath);
			} else {
				console.error("Error reading file:", result.error);
				// If we can't read the file, fallback to the default handler
				onClick(file);
			}
			setIsLoading(false);
		} catch (error) {
			console.error("Error opening markdown file:", error);
			// Fallback to default handler if there's an error
			onClick(file);
			setIsLoading(false);
		}
	}, [file, onClick, openDocument]);

	return (
		<FileAttachmentContainer
			onClick={handleClick}
			title={`Click to open ${getFileName(file)}`}
		>
			<FileIcon>
				<FontAwesomeIcon icon={faFileAlt} size="sm" spin={isLoading} />
			</FileIcon>
			<FileName variant="body2">{getFileName(file)}</FileName>
		</FileAttachmentContainer>
	);
};
