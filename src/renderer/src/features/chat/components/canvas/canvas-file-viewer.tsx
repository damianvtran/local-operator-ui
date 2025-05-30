import {
	faFile,
	faFileArchive,
	faFileAudio,
	faFileCode,
	faFileExcel,
	faFileImage,
	faFileLines,
	faFilePdf,
	faFilePowerpoint,
	faFileVideo,
	faFileWord,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
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
	backdropFilter: "blur(8px)",
	transition: "transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out",
	"&:hover": {
		transform: "translateY(-4px)",
		boxShadow: theme.shadows[6],
	},
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
	fontSize: "3rem", // Larger icon
});

const FileNameTypography = styled(Typography)(({ theme }) => ({
	fontWeight: 500,
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
	padding: theme.spacing(0, 0.5),
}));

const getIconForFileType = (type?: CanvasDocumentType) => {
	switch (type) {
		case "image":
			return faFileImage;
		case "video":
			return faFileVideo;
		case "pdf":
			return faFilePdf;
		case "markdown":
		case "text": // Grouping text-like types
			return faFileLines;
		case "html":
		case "code": // Grouping code-like types
			return faFileCode;
		case "archive":
			return faFileArchive;
		case "document": // Word, ODT etc.
			return faFileWord;
		case "spreadsheet": // Excel, ODS etc.
			return faFileExcel;
		case "presentation": // PowerPoint, ODP etc.
			return faFilePowerpoint;
		case "audio":
			return faFileAudio;
		default:
			return faFile; // Generic file icon
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
				{files.map((fileDoc) => (
					<Grid item xs={6} sm={4} md={3} key={fileDoc.id}>
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
										<FontAwesomeIcon icon={getIconForFileType(fileDoc.type)} />
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
				))}
			</Grid>
		</Box>
	);
};
