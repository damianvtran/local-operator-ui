import { faExclamationCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import type { InvalidAttachmentProps } from "./types";

/**
 * Styled component for invalid file attachments
 * Displays an exclamation icon and error message in a container
 */
const InvalidAttachmentContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	padding: "8px 12px",
	marginTop: 8,
	backgroundColor: alpha(
		theme.palette.mode === "dark"
			? theme.palette.warning.dark
			: theme.palette.warning.light,
		theme.palette.mode === "dark" ? 0.05 : 0.05,
	),
	borderRadius: 8,
	boxShadow: `0 1px 4px ${alpha(theme.palette.common.black, theme.palette.mode === "dark" ? 0.1 : 0.05)}`,
	width: "fit-content",
	maxWidth: "100%",
}));

const ErrorIcon = styled(Box)(({ theme }) => ({
	marginRight: 8,
	color: theme.palette.warning.main,
	display: "flex",
	alignItems: "center",
}));

const ErrorText = styled(Typography)({
	fontSize: "0.85rem",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
	maxWidth: "100%",
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
 * Component for displaying invalid file attachments
 */
export const InvalidAttachment: FC<InvalidAttachmentProps> = ({ file }) => {
	return (
		<InvalidAttachmentContainer
			title={`File not viewable: ${getFileName(file)}`}
		>
			<ErrorIcon>
				<FontAwesomeIcon icon={faExclamationCircle} size="sm" />
			</ErrorIcon>
			<ErrorText variant="body2">
				{getFileName(file)} is not viewable (file may be incomplete, deleted, or
				moved)
			</ErrorText>
		</InvalidAttachmentContainer>
	);
};
