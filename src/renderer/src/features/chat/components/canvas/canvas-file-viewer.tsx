import {
	Archive,
	AudioLines,
	Code,
	File,
	FileImage,
	FileSpreadsheet,
	FileText,
	FileVideo,
	Presentation,
	ScrollText,
} from "lucide-react";
import {
	Box,
	Card,
	CardActionArea,
	CardContent,
	Grid,
	Tooltip,
	Typography,
	alpha,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import type {
	CanvasDocument,
	CanvasDocumentType,
} from "@features/chat/types/canvas";
import { useCanvasStore } from "@shared/store/canvas-store";
import type { FC } from "react";
import { useCallback, useMemo } from "react";
import { isCanvasSupported } from "@features/chat/utils/is-canvas-supported";
import { getFileName } from "@features/chat/utils/get-file-name";
import { createLocalOperatorClient } from "@shared/api/local-operator";
import { apiConfig } from "@shared/config";

type CanvasFileViewerProps = {
	conversationId: string;
	// Callback to switch view in parent component
	onSwitchToDocumentView: (documentId: string) => void;
};

const defaultFiles: CanvasDocument[] = [];

const StyledCard = styled(Card)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	height: "100%",
	backgroundColor: alpha(theme.palette.background.paper, 0.8),
  backgroundImage: "none",
	transition: "box-shadow 0.2s ease-in-out",
	"&:hover": {
		boxShadow: theme.shadows[6],
	},
  borderRadius: 8,
}));

const StyledImage = styled("img")({
	height: 140,
	width: "100%",
	objectFit: "contain",
	backgroundColor: alpha("#000", 0.1),
});

const StyledVideo = styled("video")({
	height: 140,
	width: "100%",
	objectFit: "contain",
	backgroundColor: alpha("#000", 0.1),
});

const IconBox = styled(Box)({
	height: 140,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
});

const FileNameTypography = styled(Typography)(({ theme }) => ({
	fontWeight: 400,
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
  fontSize: "0.7rem",
	padding: theme.spacing(0, 0),
}));

/**
 * Checks if a file is an image based on its extension
 */
const isImage = (path: string): boolean => {
	const imageExtensions = [
		".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg",
		".tiff", ".tif", ".ico", ".heic", ".heif", ".avif",
		".jfif", ".pjpeg", ".pjp"
	];
	const lowerPath = path.toLowerCase();
	return imageExtensions.some((ext) => lowerPath.endsWith(ext));
};

/**
 * Checks if a file is a video based on its extension
 */
const isVideo = (path: string): boolean => {
	const videoExtensions = [
		".mp4", ".webm", ".ogg", ".mov", ".avi", ".wmv",
		".flv", ".mkv", ".m4v", ".3gp", ".3g2"
	];
	const lowerPath = path.toLowerCase();
	return videoExtensions.some((ext) => lowerPath.endsWith(ext));
};

/**
 * Gets the appropriate URL for an attachment using the static API
 */
const getAttachmentUrl = (
	client: ReturnType<typeof createLocalOperatorClient>,
	path: string,
): string => {
	// If it's a web URL, return it as is
	if (path.startsWith("http")) {
		return path;
	}

	// For data URIs, return as is
	if (path.startsWith("data:")) {
		return path;
	}

	// For local files, normalize the path and use appropriate endpoint
	const normalizedPath = path.startsWith("file://") ? path : `file://${path}`;

	if (isImage(path)) {
		return client.static.getImageUrl(normalizedPath);
	}

	if (isVideo(path)) {
		return client.static.getVideoUrl(normalizedPath);
	}

	// For other file types, return the original path
	return path;
};

const getIconForFileType = (type?: CanvasDocumentType) => {
	switch (type) {
		case "image":
			return FileImage;
		case "video":
			return FileVideo;
		case "pdf":
			return ScrollText;
		case "markdown":
		case "text": // Grouping text-like types
			return FileText;
		case "html":
		case "code": // Grouping code-like types
			return Code;
		case "archive":
			return Archive;
		case "document": // Word, ODT etc.
			return FileText;
		case "spreadsheet": // Excel, ODS etc.
			return FileSpreadsheet;
		case "presentation": // PowerPoint, ODP etc.
			return Presentation;
		case "audio":
			return AudioLines;
		default:
			return File; // Generic file icon
	}
};

export const CanvasFileViewer: FC<CanvasFileViewerProps> = ({
	conversationId,
	onSwitchToDocumentView,
}) => {
	// Get files from the canvas store for this conversation
	const files = useCanvasStore((state): CanvasDocument[] => {
		const conv = state.conversations[conversationId];
		return conv?.mentionedFiles ?? defaultFiles;
	});

	// Memoize files to prevent unnecessary re-renders
	const memoizedFiles = useMemo<CanvasDocument[]>(() => files, [files]);

	// Create a Local Operator client using the API config
	const client = useMemo(() => {
		return createLocalOperatorClient(apiConfig.baseUrl);
	}, []);

	// Get the URL for an attachment
	const getUrl = useCallback(
		(path: string) => getAttachmentUrl(client, path),
		[client],
	);

	const handleFileClick = useCallback(
		async (fileDoc: CanvasDocument) => {
			if (isCanvasSupported(fileDoc.title)) {
				// Let the parent handle all state updates to avoid feedback loops
				console.log("Switching to document view", fileDoc.id);
				onSwitchToDocumentView(fileDoc.id);
			} else {
				// Fallback to OS open for non-canvas supported files
				// Assuming fileDoc.path is the correct path for OS to open
				try {
					if (fileDoc.path.startsWith("data:")) {
						// For data URIs, we might need a different approach if direct opening isn't feasible
						// This might involve downloading the file first or using a specific API
						// For now, log and potentially do nothing or show a message
						console.warn(
							"Opening data URI with OS default is not directly supported here.",
							`${fileDoc.path.substring(0, 50)}...`,
						);
						// Potentially use a download utility if available via window.api
						// Or, if the original onClick from FileAttachment is accessible and handles this, use it.
					} else {
						await window.api.openFile(fileDoc.path);
					}
				} catch (error) {
					console.error("Error opening file natively:", error);
					// Handle error (e.g., show a toast notification)
				}
			}
		},
		[onSwitchToDocumentView],
	);

	if (files.length === 0) {
		return (
			<Box
				sx={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					height: "100%",
					p: 3,
					textAlign: "center",
				}}
			>
				<Typography variant="h6" gutterBottom>
					No Files in Conversation
				</Typography>
				<Typography variant="body2" color="text.secondary">
					Files attached to messages will appear here.
				</Typography>
			</Box>
		);
	}

	return (
		<Box sx={{ p: 2, height: "100%", overflowY: "auto" }}>
			<Grid container spacing={2}>
				{memoizedFiles.map((fileDoc) => {
					const IconComponent = getIconForFileType(fileDoc.type);
					return (
						<Grid item xs={6} sm={4} md={4} key={fileDoc.id}>
							<StyledCard>
								<CardActionArea
									onClick={() => handleFileClick(fileDoc)}
									sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}
								>
									{fileDoc.type === "image" ? (
										<StyledImage
											src={getUrl(fileDoc.path)}
											alt={fileDoc.title}
											title={fileDoc.title}
										/>
									) : fileDoc.type === "video" ? (
										<StyledVideo
											src={getUrl(fileDoc.path)}
											title={fileDoc.title}
											controls={true}
											preload="metadata"
										/>
									) : (
										<IconBox>
											<IconComponent size={48} strokeWidth={1} />
										</IconBox>
									)}
									<CardContent sx={{ width: "100%", pt: 1, pb: "8px !important" }}>
										<Tooltip title={fileDoc.title} placement="bottom" arrow>
											<FileNameTypography variant="caption">
												{getFileName(fileDoc.title)}
											</FileNameTypography>
										</Tooltip>
									</CardContent>
								</CardActionArea>
							</StyledCard>
						</Grid>
					);
				})}
			</Grid>
		</Box>
	);
};
