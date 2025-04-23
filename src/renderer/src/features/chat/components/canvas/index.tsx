import { faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	IconButton,
	Tooltip,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import { useCallback, useState } from "react";
import type { FC } from "react";
import type { CanvasDocument } from "../../types/canvas";
import { CanvasContent } from "./canvas-content";
import { CanvasTabs } from "./canvas-tabs";

type CanvasProps = {
	/**
	 * ID of the active document
	 */
	activeDocumentId?: string | null;

	/**
	 * Initial markdown documents to display
	 */
	initialDocuments?: CanvasDocument[];

	/**
	 * Callback when a document tab is selected
	 */
	onChangeActiveDocument?: (documentId: string) => void;

	/**
	 * Function to close the canvas
	 */
	onClose: () => void;

	onCloseDocument: (docId: string) => void;
};

/**
 * Styled container for the markdown canvas
 */
const CanvasContainer = styled(Box)(({ theme }) => ({
	height: "100%",
	display: "flex",
	flexDirection: "column",
	backgroundColor: theme.palette.background.paper,
	boxShadow:
		theme.palette.mode === "light"
			? `-4px 0 20px ${alpha(theme.palette.common.black, 0.15)}`
			: `-4px 0 20px ${alpha(theme.palette.common.black, 0.2)}`,
	border:
		theme.palette.mode === "light"
			? `1px solid ${alpha(theme.palette.grey[300], 0.5)}`
			: "none",
}));

/**
 * Styled header for the markdown canvas
 */
const CanvasHeader = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: theme.spacing(2, 3),
	height: "84px",
	borderBottom: `1px solid ${alpha(
		theme.palette.divider,
		theme.palette.mode === "light" ? 0.2 : 0.1,
	)}`,
	backgroundColor:
		theme.palette.mode === "light"
			? alpha(theme.palette.grey[100], 0.5)
			: "transparent",
}));

/**
 * Styled title container for the markdown canvas
 */
const HeaderTitle = styled(Box)({
	display: "flex",
	flexDirection: "column",
});

/**
 * Styled close button for the markdown canvas
 */
const CloseButton = styled(IconButton)(({ theme }) => ({
	color: theme.palette.text.secondary,
	width: 36,
	height: 36,
	"&:hover": {
		backgroundColor: alpha(theme.palette.primary.main, 0.08),
	},
}));

/**
 * Markdown Canvas Component
 *
 * A sidebar component that displays markdown documents in tabs
 * Replaces the agent options sidebar with a markdown canvas
 */
export const Canvas: FC<CanvasProps> = ({
	activeDocumentId: externalActiveDocumentId,
	initialDocuments = [],
	onChangeActiveDocument: externalChangeActiveDocument,
	onClose,
	onCloseDocument,
}) => {
	// Use the documents prop directly instead of local state
	const documents = initialDocuments;
	const [internalActiveDocumentId, setInternalActiveDocumentId] = useState<
		string | null
	>(documents.length > 0 ? documents[0].id : null);

	// Use external active document ID if provided, otherwise use internal state
	const activeDocumentId = externalActiveDocumentId ?? internalActiveDocumentId;

	// Get the active document
	const activeDocument =
		documents.find((doc) => doc.id === activeDocumentId) || null;

	// Handle changing the active document
	const handleChangeActiveDocument = useCallback(
		(documentId: string) => {
			if (externalChangeActiveDocument) {
				externalChangeActiveDocument(documentId);
			} else {
				setInternalActiveDocumentId(documentId);
			}
		},
		[externalChangeActiveDocument],
	);

	// Handle closing a document
	const handleCloseDocument = useCallback(
		(documentId: string) => {
			// Remove the document
			onCloseDocument(documentId);

			// If we're closing the active document, set the active document to the first remaining document
			if (activeDocumentId === documentId) {
				const remainingDocs = documents.filter((doc) => doc.id !== documentId);
				const newActiveId =
					remainingDocs.length > 0 ? remainingDocs[0].id : null;

				if (externalChangeActiveDocument) {
					externalChangeActiveDocument(newActiveId as string);
				} else {
					setInternalActiveDocumentId(newActiveId);
				}
			}
		},
		[
			documents,
			activeDocumentId,
			externalChangeActiveDocument,
			onCloseDocument,
		],
	);

	return (
		<CanvasContainer>
			<CanvasHeader>
				<HeaderTitle>
					<Typography variant="h6" fontWeight={600}>
						Canvas
					</Typography>
					<Typography variant="caption" color="text.secondary">
						View and manage documents
					</Typography>
				</HeaderTitle>
				<Box sx={{ display: "flex", alignItems: "center" }}>
					<Tooltip title="Close Canvas" arrow placement="top">
						<CloseButton onClick={onClose} size="large">
							<FontAwesomeIcon icon={faTimes} size="xs" />
						</CloseButton>
					</Tooltip>
				</Box>
			</CanvasHeader>

			{/* Tabs for document navigation */}
			<CanvasTabs
				documents={documents}
				activeDocumentId={activeDocumentId}
				onChangeActiveDocument={handleChangeActiveDocument}
				onCloseDocument={handleCloseDocument}
			/>

			{/* Document content area */}
			{activeDocument && <CanvasContent document={activeDocument} />}

			{/* Empty state when no documents are open */}
			{!activeDocument && (
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
						No Documents Open
					</Typography>
					<Typography variant="body2" color="text.secondary">
						Click on a file in chat to open it here.
					</Typography>
				</Box>
			)}
		</CanvasContainer>
	);
};
