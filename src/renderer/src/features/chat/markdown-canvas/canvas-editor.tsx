import { faFolderOpen, faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	Drawer,
	IconButton,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FC } from "react";
import { MarkdownCanvasFileBrowser } from "./markdown-canvas-file-browser";
import { MarkdownCanvasReactContent } from "./markdown-canvas-react-content";
import { MarkdownCanvasTabs } from "./markdown-canvas-tabs";
import { MarkdownCanvasToolbar } from "./markdown-canvas-toolbar";
import type { MarkdownDocument } from "./types";

type CanvasEditorProps = {
	/**
	 * Function to close the canvas
	 */
	onClose: () => void;

	/**
	 * Initial markdown documents to display
	 */
	initialDocuments?: MarkdownDocument[];

	/**
	 * ID of the active document
	 */
	activeDocumentId?: string | null;

	/**
	 * Callback when a document tab is selected
	 */
	onChangeActiveDocument?: (documentId: string) => void;
};

/**
 * Styled container for the markdown canvas
 */
const CanvasContainer = styled(Box)(({ theme }) => ({
	// width: 600,
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
 * Styled button for opening the file browser
 */
const FileBrowserButton = styled(IconButton)(({ theme }) => ({
	color: theme.palette.text.secondary,
	width: 36,
	height: 36,
	marginRight: 8,
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
export const CanvasEditor: FC<CanvasEditorProps> = ({
	onClose,
	initialDocuments = [],
	activeDocumentId: externalActiveDocumentId,
	onChangeActiveDocument: externalChangeActiveDocument,
}) => {
	// State for managing open documents
	const [documents, setDocuments] =
		useState<MarkdownDocument[]>(initialDocuments);
	const [internalActiveDocumentId, setInternalActiveDocumentId] = useState<
		string | null
	>(initialDocuments.length > 0 ? initialDocuments[0].id : null);

	// Use external active document ID if provided, otherwise use internal state
	const activeDocumentId = externalActiveDocumentId ?? internalActiveDocumentId;

	// Update documents when initialDocuments changes
	useEffect(() => {
		setDocuments(initialDocuments);
	}, [initialDocuments]);

	// State for file browser
	const [isFileBrowserOpen, setIsFileBrowserOpen] = useState(false);
	const [fileBrowserPath, setFileBrowserPath] = useState("");

	// Get the active document
	const activeDocument =
		documents.find((doc) => doc.id === activeDocumentId) || null;

	// Get the directory of the active document for the file browser
	const activeDocumentDirectory = useMemo(() => {
		if (activeDocument?.path) {
			// Get the directory part of the path
			const pathParts = activeDocument.path.split(/[/\\]/);
			pathParts.pop(); // Remove the filename
			return pathParts.join("/");
		}
		return "";
	}, [activeDocument]);

	// Handle closing a document
	const handleCloseDocument = useCallback(
		(documentId: string) => {
			// Remove the document
			setDocuments((prev) => prev.filter((doc) => doc.id !== documentId));

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
		[documents, activeDocumentId, externalChangeActiveDocument],
	);

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

	// Handle opening the file browser
	const handleOpenFileBrowser = useCallback(() => {
		if (activeDocumentDirectory) {
			setFileBrowserPath(activeDocumentDirectory);
			setIsFileBrowserOpen(true);
		}
	}, [activeDocumentDirectory]);

	// Handle file selection in the file browser
	const handleFileSelect = useCallback(
		async (filePath: string) => {
			try {
				const result = await window.api.readFile(filePath);
				if (result.success) {
					// Get the filename from the path
					const pathParts = filePath.split(/[/\\]/);
					const fileName = pathParts[pathParts.length - 1];

					// Create a new document
					const newDocument: MarkdownDocument = {
						id: crypto.randomUUID(),
						title: fileName,
						content: result.data,
						path: filePath,
						lastModified: new Date(),
					};

					// Add the document
					setDocuments((prev) => [...prev, newDocument]);

					// Set it as active
					if (externalChangeActiveDocument) {
						externalChangeActiveDocument(newDocument.id);
					} else {
						setInternalActiveDocumentId(newDocument.id);
					}

					// Close the file browser
					setIsFileBrowserOpen(false);
				}
			} catch (error) {
				console.error("Error reading file:", error);
			}
		},
		[externalChangeActiveDocument],
	);

	return (
		<CanvasContainer>
			<CanvasHeader>
				<HeaderTitle>
					<Typography variant="h6" fontWeight={600}>
						Markdown Canvas
					</Typography>
					<Typography variant="body2" color="text.secondary">
						View and manage markdown documents
					</Typography>
				</HeaderTitle>
				<Box sx={{ display: "flex", alignItems: "center" }}>
					{activeDocument && (
						<FileBrowserButton
							onClick={handleOpenFileBrowser}
							size="large"
							title="Browse files"
						>
							<FontAwesomeIcon icon={faFolderOpen} size="xs" />
						</FileBrowserButton>
					)}
					<CloseButton onClick={onClose} size="large">
						<FontAwesomeIcon icon={faTimes} size="xs" />
					</CloseButton>
				</Box>
			</CanvasHeader>

			{/* Tabs for document navigation */}
			<MarkdownCanvasTabs
				documents={documents}
				activeDocumentId={activeDocumentId}
				onChangeActiveDocument={handleChangeActiveDocument}
				onCloseDocument={handleCloseDocument}
			/>

			{/* Document content area */}
			{activeDocument && (
				<>
					<MarkdownCanvasToolbar document={activeDocument} />
					{
						// <MarkdownCanvasContent document={activeDocument} />
					}
					<MarkdownCanvasReactContent document={activeDocument} />
				</>
			)}

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
						Click on a markdown file in chat to open it here.
					</Typography>
				</Box>
			)}

			{/* File browser drawer */}
			<Drawer
				anchor="right"
				open={isFileBrowserOpen}
				onClose={() => setIsFileBrowserOpen(false)}
				PaperProps={{
					sx: {
						width: 350,
						border: "none",
					},
				}}
			>
				{fileBrowserPath && (
					<MarkdownCanvasFileBrowser
						initialPath={fileBrowserPath}
						onFileSelect={handleFileSelect}
					/>
				)}
			</Drawer>
		</CanvasContainer>
	);
};
