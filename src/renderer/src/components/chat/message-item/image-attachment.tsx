import { styled } from "@mui/material/styles";
import type { FC } from "react";
import type { ImageAttachmentProps } from "./types";

/**
 * Styled component for image attachments
 * Includes hover effects and styling
 */
const AttachmentImage = styled("img")({
	maxWidth: "100%",
	maxHeight: 200,
	borderRadius: 8,
	marginBottom: 8,
	boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
	cursor: "pointer",
	transition: "transform 0.2s ease, box-shadow 0.2s ease",
	"&:hover": {
		transform: "scale(1.02)",
		boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
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
 * Component for displaying image attachments
 */
export const ImageAttachment: FC<ImageAttachmentProps> = ({
	file,
	src,
	onClick,
}) => {
	const handleClick = () => {
		onClick(file);
	};

	return (
		<AttachmentImage
			src={src}
			alt={getFileName(file)}
			onClick={handleClick}
			title={`Click to open ${getFileName(file)}`}
		/>
	);
};
