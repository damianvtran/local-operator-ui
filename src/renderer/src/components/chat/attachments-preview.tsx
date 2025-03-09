import {
	Box,
	IconButton,
	Paper,
	Tooltip,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import { faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { FC } from "react";
import { useCallback, useMemo } from "react";
import { createLocalOperatorClient } from "../../api/local-operator";
import { apiConfig } from "../../config";

/**
 * Props for the AttachmentsPreview component
 */
type AttachmentsPreviewProps = {
	/** List of attachment paths or URLs */
	attachments: string[];
	/** Callback when an attachment is removed */
	onRemoveAttachment: (index: number) => void;
	/** Whether the component is disabled */
	disabled?: boolean;
};

/**
 * Container for the attachments preview
 */
const AttachmentsContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	flexWrap: "wrap",
	gap: theme.spacing(1.5),
	padding: theme.spacing(2),
	borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
	backgroundColor: alpha(theme.palette.background.paper, 0.4),
}));

/**
 * Styled component for each attachment preview
 */
const AttachmentItem = styled(Paper)(({ theme }) => ({
	position: "relative",
	borderRadius: theme.shape.borderRadius,
	overflow: "hidden",
	width: 100,
	height: 100,
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
	backgroundColor: alpha(theme.palette.background.paper, 0.6),
	transition: "all 0.2s ease-in-out",
	"&:hover": {
		transform: "translateY(-2px)",
		boxShadow: theme.shadows[3],
	},
}));

/**
 * Styled component for the attachment image preview
 */
const AttachmentImage = styled("img")({
	width: "100%",
	height: "100%",
	objectFit: "cover",
});

/**
 * Styled component for the attachment filename
 */
const AttachmentName = styled(Typography)(({ theme }) => ({
	position: "absolute",
	bottom: 0,
	left: 0,
	right: 0,
	padding: theme.spacing(0.5),
	backgroundColor: alpha(theme.palette.background.paper, 0.8),
	fontSize: "0.7rem",
	textAlign: "center",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
}));

/**
 * Styled component for the remove button
 */
const RemoveButton = styled(IconButton)(({ theme }) => ({
	position: "absolute",
	top: 2,
	right: -4,
	width: 24,
	height: 24,
	padding: 4,
	backgroundColor: alpha(theme.palette.background.paper, 0.8),
	color: theme.palette.error.main,
	"&:hover": {
		backgroundColor: alpha(theme.palette.background.paper, 0.9),
	},
}));

/**
 * Styled component for the large preview on hover
 */
const LargePreview = styled(Box)(({ theme }) => ({
	position: "absolute",
	top: -320,
	width: 300,
	height: 300,
	backgroundColor: theme.palette.background.paper,
	borderRadius: theme.shape.borderRadius,
	boxShadow: theme.shadows[10],
	padding: theme.spacing(1),
	zIndex: 1000,
	opacity: 0,
	visibility: "hidden",
	transform: "translateY(20px)",
	transition:
		"opacity 0.3s ease-in-out, transform 0.3s ease-in-out, visibility 0s linear 1.5s",
	"& img": {
		width: "100%",
		height: "100%",
		objectFit: "contain",
	},
}));

/**
 * Styled component for the attachment wrapper (includes hover effect)
 */
const AttachmentWrapper = styled(Box)({
	position: "relative",
	"&:hover .large-preview": {
		opacity: 1,
		visibility: "visible",
		transform: "translateY(0)",
		transitionDelay: "1.5s",
	},
});

/**
 * Styled component for non-image attachments
 */
const FileIcon = styled(Box)(({ theme }) => ({
	width: "100%",
	height: "100%",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	backgroundColor: alpha(theme.palette.primary.main, 0.1),
	color: theme.palette.primary.main,
	fontSize: "0.8rem",
	fontWeight: 500,
	padding: theme.spacing(1),
	textAlign: "center",
}));

/**
 * Component to display a preview of attachments
 */
export const AttachmentsPreview: FC<AttachmentsPreviewProps> = ({
	attachments,
	onRemoveAttachment,
	disabled = false,
}) => {
	// Create a Local Operator client using the API config
	const client = useMemo(() => {
		return createLocalOperatorClient(apiConfig.baseUrl);
	}, []);

	/**
	 * Check if a file is an image based on its path/URL
	 */
	const isImage = useCallback((path: string) => {
		const imageExtensions = [
			".jpg",
			".jpeg",
			".png",
			".gif",
			".webp",
			".bmp",
			".svg",
		];
		const lowerPath = path.toLowerCase();
		return imageExtensions.some((ext) => lowerPath.endsWith(ext));
	}, []);

	/**
	 * Extract filename from path
	 */
	const getFileName = useCallback((path: string) => {
		// Handle both local paths and URLs
		const parts = path.split(/[/\\]/);
		return parts[parts.length - 1];
	}, []);

	/**
	 * Get the appropriate URL for an attachment
	 * Uses the static image endpoint for local image files
	 */
	const getAttachmentUrl = useCallback(
		(path: string) => {
			// If it's an image and looks like a local file path
			if (isImage(path) && !path.startsWith("http")) {
				// Check if path already has file:// protocol
				const normalizedPath = path.startsWith("file://")
					? path
					: `file://${path}`;
				// Use the static image endpoint
				return client.static.getImageUrl(normalizedPath);
			}
			// Otherwise return the original path
			return path;
		},
		[client, isImage],
	);

	/**
	 * Handle removing an attachment
	 */
	const handleRemove = useCallback(
		(index: number) => (event: React.MouseEvent) => {
			event.stopPropagation();
			if (!disabled) {
				onRemoveAttachment(index);
			}
		},
		[onRemoveAttachment, disabled],
	);

	// If no attachments, don't render anything
	if (!attachments.length) {
		return null;
	}

	return (
		<AttachmentsContainer>
			{attachments.map((attachment, index) => (
				<AttachmentWrapper key={`${index}-${attachment}`}>
					<AttachmentItem elevation={1}>
						{isImage(attachment) ? (
							<AttachmentImage
								src={getAttachmentUrl(attachment)}
								alt={getFileName(attachment)}
							/>
						) : (
							<FileIcon>{getFileName(attachment)}</FileIcon>
						)}
						<AttachmentName variant="caption" noWrap>
							{getFileName(attachment)}
						</AttachmentName>
						<Tooltip title="Remove attachment">
							<RemoveButton
								size="small"
								onClick={handleRemove(index)}
								disabled={disabled}
							>
								<FontAwesomeIcon icon={faTimes} size="xs" />
							</RemoveButton>
						</Tooltip>
					</AttachmentItem>
					{isImage(attachment) && (
						<LargePreview className="large-preview">
							<img
								src={getAttachmentUrl(attachment)}
								alt={getFileName(attachment)}
							/>
						</LargePreview>
					)}
				</AttachmentWrapper>
			))}
		</AttachmentsContainer>
	);
};
