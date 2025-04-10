import { alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import type { VideoAttachmentProps } from "./types";

/**
 * Styled component for video attachments
 * Includes hover effects and styling
 */
const AttachmentVideo = styled("video")(({ theme }) => ({
	maxWidth: "100%",
	maxHeight: 300,
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
 * @param path - The file path or URL to check
 * @returns The extracted filename
 */
const getFileName = (path: string): string => {
	// Handle both local paths and URLs
	const parts = path.split(/[/\\]/);
	return parts[parts.length - 1];
};

/**
 * Component for displaying video attachments
 * Renders a video player with controls and preview functionality
 */
export const VideoAttachment: FC<VideoAttachmentProps> = ({
	file,
	src,
	onClick,
}) => {
	const handleClick = () => {
		onClick(file);
	};

	return (
		<AttachmentVideo
			src={src}
			controls
			preload="metadata"
			onClick={handleClick}
			title={`Click to open ${getFileName(file)}`}
		/>
	);
};
