import { faFile } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useMarkdownCanvasStore } from "@renderer/store/markdown-canvas-store";
import type { FC } from "react";
import { useCallback } from "react";
import type { FileAttachmentProps } from "./types";

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
const getFileName = (path: string): string => {
	// Handle both local paths and URLs
	const parts = path.split(/[/\\]/);
	return parts[parts.length - 1];
};

const markdownRegex = new RegExp(/\.md$/);

/**
 * Component for displaying non-image file attachments
 */
export const FileAttachment: FC<FileAttachmentProps> = ({ file, onClick }) => {
	const { openDocument } = useMarkdownCanvasStore();

	// Handle click on the file attachment
	const handleClick = useCallback(async () => {
		const isMarkdown = markdownRegex.test(file);

		if (isMarkdown) {
			try {
				const normalizedPath = file.startsWith("file://")
					? file.substring(7)
					: file;
				const title = getFileName(file);
				const result = await window.api.readFile(normalizedPath);

				if (result.success) {
					openDocument(title, result.data, normalizedPath);
				} else {
					console.error("Error reading file:", result.error);
					onClick(file);
				}
			} catch (error) {
				console.error("Error opening markdown file:", error);
				onClick(file);
			}
			return;
		}

		// For non-markdown files, use the default handler
		onClick(file);
	}, [file, onClick, openDocument]);

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
