import type {
	CanvasDocument,
	CanvasDocumentType,
} from "@features/chat/types/canvas";
import { getFileName } from "@features/chat/utils/get-file-name";
import { isCanvasSupported } from "@features/chat/utils/is-canvas-supported";
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
import { createLocalOperatorClient } from "@shared/api/local-operator";
import { apiConfig } from "@shared/config";
import { useCanvasStore } from "@shared/store/canvas-store";
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
import { FileActionsMenu } from "@shared/components/common/file-actions-menu";
import type { FC } from "react";
import { useCallback, useMemo } from "react";

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
		".jpg",
		".jpeg",
		".png",
		".gif",
		".webp",
		".bmp",
		".svg",
		".tiff",
		".tif",
		".ico",
		".heic",
		".heif",
		".avif",
		".jfif",
		".pjpeg",
		".pjp",
	];
	const lowerPath = path.toLowerCase();
	return imageExtensions.some((ext) => lowerPath.endsWith(ext));
};

/**
 * Checks if a file is a video based on its extension
 */
const isVideo = (path: string): boolean => {
	const videoExtensions = [
		".mp4",
		".webm",
		".ogg",
		".mov",
		".avi",
		".wmv",
		".flv",
		".mkv",
		".m4v",
		".3gp",
		".3g2",
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

	// Canvas store actions
	const setFiles = useCanvasStore((s) => s.setFiles);
	const setOpenTabs = useCanvasStore((s) => s.setOpenTabs);
	const setSelectedTab = useCanvasStore((s) => s.setSelectedTab);

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
			const title = fileDoc.title;
			const fallbackAction = (err?: string) => {
				if (err) console.error("Error processing file:", err);
				// Fallback to OS open for non-canvas supported files
				try {
					if (fileDoc.path.startsWith("data:")) {
						console.warn(
							"Opening data URI with OS default is not directly supported here.",
							`${fileDoc.path.substring(0, 50)}...`,
						);
					} else {
						window.api.openFile(fileDoc.path);
					}
				} catch (error) {
					console.error("Error opening file natively:", error);
				}
			};

			if (fileDoc.path.startsWith("data:")) {
				// Handle base64 data URI
				if (isCanvasSupported(title)) {
					const docId = fileDoc.path; // Use the data URI itself as a unique ID
					const newDoc = {
						id: docId,
						title,
						path: docId, // Store data URI as path for consistency if needed
						content: fileDoc.path, // The content is the data URI itself
					};

					const state = useCanvasStore.getState();
					const conversationCanvasState = state.conversations?.[conversationId];
					const filesInState = conversationCanvasState?.files ?? [];
					const openTabsInState = conversationCanvasState?.openTabs ?? [];

					const updatedFiles = (() => {
						const idx = filesInState.findIndex((d) => d.id === docId);
						if (idx !== -1) {
							return [
								...filesInState.slice(0, idx),
								newDoc,
								...filesInState.slice(idx + 1),
							];
						}
						return [...filesInState, newDoc];
					})();
					setFiles(conversationId, updatedFiles);

					const existsTab = openTabsInState.some((t) => t.id === docId);
					const updatedTabs = existsTab
						? openTabsInState
						: [...openTabsInState, { id: docId, title }];
					setOpenTabs(conversationId, updatedTabs);
					setSelectedTab(conversationId, docId);
					onSwitchToDocumentView(docId);
				} else {
					// Not canvas supported, but it's a data URI.
					fallbackAction();
				}
			} else {
				// Handle file path
				const normalizedPath = fileDoc.path.startsWith("file://")
					? fileDoc.path.substring(7)
					: fileDoc.path;
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

						const state = useCanvasStore.getState();
						const conversationCanvasState =
							state.conversations?.[conversationId];
						const filesInState = conversationCanvasState?.files ?? [];
						const openTabsInState = conversationCanvasState?.openTabs ?? [];

						const updatedFiles = (() => {
							const idx = filesInState.findIndex((d) => d.id === docId);
							if (idx !== -1) {
								return [
									...filesInState.slice(0, idx),
									newDoc,
									...filesInState.slice(idx + 1),
								];
							}
							return [...filesInState, newDoc];
						})();
						setFiles(conversationId, updatedFiles);

						const existsTab = openTabsInState.some((t) => t.id === docId);
						const updatedTabs = existsTab
							? openTabsInState
							: [...openTabsInState, { id: docId, title }];
						setOpenTabs(conversationId, updatedTabs);
						setSelectedTab(conversationId, docId);
						onSwitchToDocumentView(docId);
						return;
					}

					const errorMessage =
						!result.success && result.error
							? result.error instanceof Error
								? result.error.message
								: String(result.error)
							: "Unknown error reading file";
					return fallbackAction(errorMessage);
				} catch (error: unknown) {
					const message =
						error instanceof Error
							? error.message
							: String(error ?? "Unknown error reading file");
					return fallbackAction(message);
				}
			}
		},
		[
			conversationId,
			setFiles,
			setOpenTabs,
			setSelectedTab,
			onSwitchToDocumentView,
		],
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
		<Box sx={{ p: 3, height: "100%", overflowY: "auto" }}>
			<Grid container spacing={2}>
				{memoizedFiles.map((fileDoc) => {
					const IconComponent = getIconForFileType(fileDoc.type);
					const isLocalFile =
						!fileDoc.path.startsWith("data:") &&
						!fileDoc.path.startsWith("http");
					const normalizedPath = fileDoc.path.startsWith("file://")
						? fileDoc.path.substring(7)
						: fileDoc.path;
					return (
						<Grid item xs={6} sm={4} md={4} key={fileDoc.id}>
							<StyledCard sx={{ position: "relative" }}>
								{isLocalFile && (
									<Box
										sx={{
											position: "absolute",
											top: 4,
											right: 4,
											zIndex: 2,
										}}
									>
										<FileActionsMenu
											filePath={normalizedPath}
											tooltip="File actions"
											aria-label="File actions"
											onShowInCanvas={() => handleFileClick(fileDoc)}
										/>
									</Box>
								)}
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
									<CardContent
										sx={{ width: "100%", pt: 1, pb: "8px !important" }}
									>
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
