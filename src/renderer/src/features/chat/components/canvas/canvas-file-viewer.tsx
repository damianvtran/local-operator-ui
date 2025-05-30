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
	CardMedia,
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
import { useCallback } from "react";
import { isCanvasSupported } from "@features/chat/utils/is-canvas-supported";
import { getFileName } from "@features/chat/utils/get-file-name";

type CanvasFileViewerProps = {
	conversationId: string;
	// Callback to switch view in parent component
	onSwitchToDocumentView: (documentId: string) => void;
};

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

// Allow standard HTML video attributes to be passed when component="video"
const StyledCardMedia = styled(CardMedia, {
	shouldForwardProp: (prop) => prop !== "component" && prop !== "controls" && prop !== "src",
})<{ component?: React.ElementType; controls?: boolean; src?: string }>({
	height: 140,
	objectFit: "contain", // Use 'contain' for previews to avoid cropping
	backgroundColor: alpha("#000", 0.1), // Slight background for non-image media
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
	const files = useCanvasStore((s) => s.conversations[conversationId]?.files ?? []);

	const handleFileClick = useCallback(
		async (fileDoc: CanvasDocument) => {
			if (isCanvasSupported(fileDoc.title)) {
				// Let the parent handle all state updates to avoid feedback loops
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
						await window.api.openFileNatively(fileDoc.path);
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
				{files.map((fileDoc) => {
					const IconComponent = getIconForFileType(fileDoc.type);
					return (
						<Grid item xs={6} sm={4} md={4} key={fileDoc.id}>
							<StyledCard>
								<CardActionArea
									onClick={() => handleFileClick(fileDoc)}
									sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}
								>
									{fileDoc.type === "image" && fileDoc.content.startsWith("data:image") ? (
										<StyledCardMedia image={fileDoc.content} title={fileDoc.title} />
									) : fileDoc.type === "video" && fileDoc.content.startsWith("data:video") ? (
										<StyledCardMedia
											component="video"
											controls
											src={fileDoc.content}
											title={fileDoc.title}
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
