import { alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import { type FC, useState } from "react";
import { InvalidAttachment } from "./invalid-attachment";
/**
 * Props for the ImageAttachment component
 */
export type ImageAttachmentProps = {
	file: string;
	src: string;
	onClick: (file: string) => void;
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

/**
 * Component for displaying image attachments
 * Handles image loading errors and displays an InvalidAttachment component if the image fails to load
 */
export const ImageAttachment: FC<ImageAttachmentProps> = ({
	file,
	src,
	onClick,
}) => {
	// State to track if the image has failed to load
	const [hasError, setHasError] = useState(false);

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
