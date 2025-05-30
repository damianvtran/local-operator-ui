import { alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import { type FC, useState, memo } from "react";
import { InvalidAttachment } from "./invalid-attachment";

/**
 * Props for the VideoAttachment component (base)
 */
type BaseVideoAttachmentProps = {
	file: string;
	src: string;
	onClick: (file: string) => void;
};

export type VideoAttachmentProps = BaseVideoAttachmentProps & {
	conversationId: string;
};

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
const PATH_SEPARATOR_REGEX = /[/\\]/;
const getFileName = (path: string): string => {
	// Handle both local paths and URLs
	const parts = path.split(PATH_SEPARATOR_REGEX);
	return parts[parts.length - 1];
};

/**
 * Component for displaying video attachments
 * Renders a video player with controls and preview functionality
 * Handles video loading errors and displays an InvalidAttachment component if the video fails to load
 */
export const VideoAttachment: FC<VideoAttachmentProps> = memo(
	({ file, src, onClick }) => {
		// State to track if the video has failed to load
		const [hasError, setHasError] = useState(false);
		// The conversationId and addMentionedFile logic is removed from here
		// It will be handled by MessageItem

		const handleClick = () => {
			onClick(file);
		};

	const handleError = () => {
		// Set error state when video fails to load
		setHasError(true);
	};

		// If the video failed to load, show the InvalidAttachment component
		if (hasError) {
			return <InvalidAttachment file={file} />;
		}

		// Otherwise, render the video with an error handler
		return (
			<AttachmentVideo
				src={src}
				controls
				preload="metadata"
				onClick={handleClick}
				onError={handleError}
				title={`Click to open ${getFileName(file)}`}
			/>
		);
	},
);

VideoAttachment.displayName = "VideoAttachment";
