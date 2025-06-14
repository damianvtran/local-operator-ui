import {
	Box,
	IconButton,
	Tooltip,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import type { CanvasViewMode } from "@shared/store/canvas-store";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useUndoManagerStore } from "@shared/store/undo-manager-store";
import {
	FilePlus,
	FileText,
	FileUp,
	FolderOpen,
	ListTree,
	X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { FC } from "react";
import type { CanvasDocument } from "../../types/canvas";
import { createFile } from "../../utils/file-creation";
import { getFileTypeFromPath } from "../../utils/file-types";
import { CanvasContent } from "./canvas-content";
import { CanvasFileViewer } from "./canvas-file-viewer";
import { CanvasTabs } from "./canvas-tabs";
import { CanvasVariablesViewer } from "./canvas-variables-viewer";
import { CreateFileDialog } from "./create-file-dialog";

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

	/**
	 * The agent ID for the current chat context
	 */
	agentId?: string;

	/**
	 * The conversation ID for the current chat context
	 */
	conversationId?: string;
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
const CanvasComponent: FC<CanvasProps> = ({
	activeDocumentId: externalActiveDocumentId,
	initialDocuments = [],
	onChangeActiveDocument: externalChangeActiveDocument,
	onClose,
	onCloseDocument,
	conversationId,
	agentId,
}) => {
	const [isCreateFileDialogOpen, setCreateFileDialogOpen] = useState(false);
	const [isCreatingFile, setIsCreatingFile] = useState(false);
	const [modifierKey, setModifierKey] = useState("Ctrl");

	useEffect(() => {
		const getPlatform = async () => {
			const platformInfo = await window.api.systemInfo.getPlatformInfo();
			setModifierKey(platformInfo.platform === "darwin" ? "⌘" : "Ctrl");
		};
		getPlatform();
	}, []);

	const { addFileAndSelect, setViewMode } = useCanvasStore();
	const { removeManager } = useUndoManagerStore();

	const handleOpenFile = useCallback(async () => {
		if (conversationId) {
			const result = await window.api.selectFile();
			if (result) {
				const newFile: CanvasDocument = {
					id: result.path,
					title: result.path.split("/").pop() || result.path,
					content: result.content,
					path: result.path,
					type: getFileTypeFromPath(result.path),
				};
				addFileAndSelect(conversationId, newFile);
				setViewMode(conversationId, "documents");
			}
		}
	}, [addFileAndSelect, conversationId, setViewMode]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key === "o") {
				event.preventDefault();
				handleOpenFile();
			}
			if ((event.metaKey || event.ctrlKey) && event.key === "n") {
				event.preventDefault();
				setCreateFileDialogOpen(true);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [handleOpenFile]);

	const handleCreateFile = async (
		details: {
			name: string;
			type: string;
			location: string;
		},
		overwrite = false,
	) => {
		setIsCreatingFile(true);
		try {
			await createFile(details.name, details.type, details.location, overwrite);
			if (conversationId) {
				const newFile: CanvasDocument = {
					id: `${details.location}/${details.name}.${details.type}`,
					title: `${details.name}.${details.type}`,
					content: "",
					path: `${details.location}/${details.name}.${details.type}`,
				};
				addFileAndSelect(conversationId, newFile);
			}
			setCreateFileDialogOpen(false);
		} catch (_) {
			// Error is already handled by the toast manager
		} finally {
			setIsCreatingFile(false);
		}
	};
	const canvasState = useCanvasStore((state) =>
		conversationId ? state.conversations[conversationId] : undefined,
	);
	const currentView = canvasState?.viewMode ?? "documents";

	const setCurrentView = useCallback(
		(viewMode: CanvasViewMode) => {
			if (conversationId) {
				setViewMode(conversationId, viewMode);
			}
		},
		[conversationId, setViewMode],
	);

	// Use the documents prop directly instead of local state
	const documents = initialDocuments;
	const [internalActiveDocumentId, setInternalActiveDocumentId] = useState<
		string | null
	>(documents.length > 0 ? documents[0].id : null);

	// Use external active document ID if provided, otherwise use internal state
	const activeDocumentId = externalActiveDocumentId ?? internalActiveDocumentId;

	// Get the active document
	const activeDocument = useMemo(
		() => documents.find((doc) => doc.id === activeDocumentId) || null,
		[documents, activeDocumentId],
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

	const handleSwitchToDocumentView = useCallback(
		(documentId: string) => {
			setCurrentView("documents");
			handleChangeActiveDocument(documentId);
		},
		[handleChangeActiveDocument, setCurrentView],
	);

	// Handle closing a document
	const handleCloseDocument = useCallback(
		(documentId: string) => {
			// Remove the document
			onCloseDocument(documentId);
			removeManager(documentId);

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
			removeManager,
		],
	);

	return (
		<CanvasContainer data-tour-tag="canvas-container">
			<CanvasHeader>
				<HeaderTitle>
					<Typography variant="h6" fontWeight={600}>
						Canvas
					</Typography>
					<Typography variant="caption" color="text.secondary">
						Your visual workspace
					</Typography>
				</HeaderTitle>
				<Box sx={{ display: "flex", alignItems: "center", gap: 0 }}>
					<Tooltip
						title={`Create New File (${modifierKey} + N)`}
						arrow
						placement="top"
					>
						{/* @ts-ignore MUI Tooltip a11y issue */}
						<IconButton
							onClick={() => setCreateFileDialogOpen(true)}
							size="large"
							data-tour-tag="canvas-create-file-button"
							sx={(theme) => ({
								color: theme.palette.text.secondary,
								"&:hover": {
									backgroundColor: alpha(theme.palette.primary.main, 0.12),
								},
								width: 36,
								height: 36,
								padding: 0,
							})}
						>
							<FilePlus size={16} />
						</IconButton>
					</Tooltip>
					<Tooltip
						title={`Open File (${modifierKey} + O)`}
						arrow
						placement="top"
					>
						{/* @ts-ignore MUI Tooltip a11y issue */}
						<IconButton
							onClick={handleOpenFile}
							size="large"
							sx={(theme) => ({
								color: theme.palette.text.secondary,
								"&:hover": {
									backgroundColor: alpha(theme.palette.primary.main, 0.12),
								},
								width: 36,
								height: 36,
								padding: 0,
							})}
						>
							<FileUp size={16} />
						</IconButton>
					</Tooltip>
					<Tooltip title="Documents View" arrow placement="top">
						{/* @ts-ignore MUI Tooltip a11y issue */}
						<IconButton
							onClick={() => setCurrentView("documents")}
							size="large"
							data-tour-tag="canvas-documents-view-button"
							sx={(theme) => ({
								color:
									currentView === "documents"
										? theme.palette.primary.main
										: theme.palette.text.secondary,
								backgroundColor:
									currentView === "documents"
										? alpha(theme.palette.primary.main, 0.08)
										: "transparent",
								"&:hover": {
									backgroundColor: alpha(theme.palette.primary.main, 0.12),
								},
								width: 36,
								height: 36,
								padding: 0,
							})}
						>
							<FileText size={16} />
						</IconButton>
					</Tooltip>
					<Tooltip title="Files View" arrow placement="top">
						{/* @ts-ignore MUI Tooltip a11y issue */}
						<IconButton
							onClick={() => setCurrentView("files")}
							size="large"
							data-tour-tag="canvas-files-view-button"
							sx={(theme) => ({
								color:
									currentView === "files"
										? theme.palette.primary.main
										: theme.palette.text.secondary,
								backgroundColor:
									currentView === "files"
										? alpha(theme.palette.primary.main, 0.08)
										: "transparent",
								"&:hover": {
									backgroundColor: alpha(theme.palette.primary.main, 0.12),
								},
								width: 36,
								height: 36,
								padding: 0,
							})}
						>
							<FolderOpen size={16} />
						</IconButton>
					</Tooltip>
					<Tooltip title="Variables View" arrow placement="top">
						{/* @ts-ignore MUI Tooltip a11y issue */}
						<IconButton
							onClick={() => setCurrentView("variables")}
							size="large"
							data-tour-tag="canvas-variables-view-button"
							sx={(theme) => ({
								color:
									currentView === "variables"
										? theme.palette.primary.main
										: theme.palette.text.secondary,
								backgroundColor:
									currentView === "variables"
										? alpha(theme.palette.primary.main, 0.08)
										: "transparent",
								"&:hover": {
									backgroundColor: alpha(theme.palette.primary.main, 0.12),
								},
								width: 36,
								height: 36,
								padding: 0,
							})}
						>
							<ListTree size={16} />
						</IconButton>
					</Tooltip>
					<Tooltip
						title="Close Canvas"
						arrow
						placement="top"
						sx={{ padding: 0 }}
					>
						{/* @ts-ignore MUI Tooltip a11y issue */}
						<CloseButton
							onClick={onClose}
							size="large"
							data-tour-tag="close-canvas-button"
						>
							<X size={16} />
						</CloseButton>
					</Tooltip>
				</Box>
			</CanvasHeader>

			{currentView === "documents" && (
				<>
					{/* Tabs for document navigation */}
					<CanvasTabs
						documents={documents}
						activeDocumentId={activeDocumentId}
						onChangeActiveDocument={handleChangeActiveDocument}
						onCloseDocument={handleCloseDocument}
					/>

					{/* Document content area */}
					{activeDocument && (
						<CanvasContent
							document={activeDocument}
							conversationId={conversationId}
							agentId={agentId}
						/>
					)}

					{/* Empty state when no documents are open */}
					{!activeDocument && documents.length === 0 && (
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
								Click on a file in chat or use the files view to open a file.
							</Typography>
						</Box>
					)}
				</>
			)}

			{currentView === "files" && conversationId && (
				<CanvasFileViewer
					conversationId={conversationId}
					onSwitchToDocumentView={handleSwitchToDocumentView}
				/>
			)}
			{currentView === "variables" && conversationId && (
				<CanvasVariablesViewer conversationId={conversationId} />
			)}
			{/* Placeholder if no conversation context for files or variables view */}
			{(currentView === "files" || currentView === "variables") &&
				!conversationId && (
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
							File Viewer
						</Typography>
						<Typography variant="body2" color="text.secondary">
							No active conversation context to display files.
						</Typography>
					</Box>
				)}
			{agentId && (
				<CreateFileDialog
					open={isCreateFileDialogOpen}
					onClose={() => setCreateFileDialogOpen(false)}
					onSave={handleCreateFile}
					isSaving={isCreatingFile}
					agentId={agentId}
				/>
			)}
		</CanvasContainer>
	);
};

export const Canvas = memo(CanvasComponent);
