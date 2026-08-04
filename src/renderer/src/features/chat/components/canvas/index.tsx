import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
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
import type { FC, ReactNode } from "react";
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
 * Canvas view toggle button
 *
 * One ghost button with two states: the active view is an accent-wash colour
 * step, the rest are plain ghost. No border, no underline, nothing that moves.
 */
const ViewToggleButton: FC<{
	label: string;
	isActive: boolean;
	onClick: () => void;
	tourTag?: string;
	icon: ReactNode;
}> = ({ label, isActive, onClick, tourTag, icon }) => (
	<Tooltip content={label}>
		<Button
			variant="ghost"
			size="icon"
			aria-label={label}
			aria-pressed={isActive}
			onClick={onClick}
			data-tour-tag={tourTag}
			className={cn(
				isActive &&
					"bg-accent-wash text-accent hover:bg-accent-wash hover:text-accent",
			)}
		>
			{icon}
		</Button>
	</Tooltip>
);

/**
 * Empty state panel for the canvas
 */
const EmptyState: FC<{ title: string; description: string }> = ({
	title,
	description,
}) => (
	<div
		className={cn(
			"flex h-full flex-col items-center justify-center gap-1 bg-canvas p-6 text-center",
		)}
	>
		<h3 className={cn("text-heading text-ink")}>{title}</h3>
		<p className={cn("text-body-sm text-ink-muted")}>{description}</p>
	</div>
);

/**
 * Markdown Canvas Component
 *
 * A sidebar component that displays markdown documents in tabs
 * Replaces the agent options sidebar with a markdown canvas
 *
 * The shell is one surface with ground steps, not a stack of bordered
 * panels: the header sits on `surface`, the tab strip and empty states sit on
 * `sunken`/`canvas`, and regions separate by that lightness step alone.
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

	const { addFileAndSelect, setViewMode, addMentionedFile } = useCanvasStore();
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
				addMentionedFile(conversationId, newFile);
				setViewMode(conversationId, "documents");
			}
		}
	}, [addFileAndSelect, addMentionedFile, conversationId, setViewMode]);

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
				addMentionedFile(conversationId, newFile);
			}
			setCreateFileDialogOpen(false);
		} catch {
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
		<div
			data-tour-tag="canvas-container"
			className={cn("flex h-full flex-col bg-surface")}
		>
			<div
				className={cn(
					"flex h-[84px] shrink-0 items-center justify-between gap-2 px-6",
				)}
			>
				<div className={cn("flex min-w-0 flex-col")}>
					<h2 className={cn("text-heading text-ink")}>Canvas</h2>
					<p className={cn("text-meta text-ink-muted")}>
						Your visual workspace
					</p>
				</div>
				<div className={cn("flex shrink-0 items-center gap-1")}>
					<Tooltip content={`Create new file (${modifierKey} + N)`}>
						<Button
							variant="ghost"
							size="icon"
							aria-label={`Create new file (${modifierKey} + N)`}
							onClick={() => setCreateFileDialogOpen(true)}
							data-tour-tag="canvas-create-file-button"
						>
							<FilePlus aria-hidden="true" />
						</Button>
					</Tooltip>
					<Tooltip content={`Open file (${modifierKey} + O)`}>
						<Button
							variant="ghost"
							size="icon"
							aria-label={`Open file (${modifierKey} + O)`}
							onClick={handleOpenFile}
						>
							<FileUp aria-hidden="true" />
						</Button>
					</Tooltip>
					<ViewToggleButton
						label="Documents view"
						isActive={currentView === "documents"}
						onClick={() => setCurrentView("documents")}
						tourTag="canvas-documents-view-button"
						icon={<FileText aria-hidden="true" />}
					/>
					<ViewToggleButton
						label="Files view"
						isActive={currentView === "files"}
						onClick={() => setCurrentView("files")}
						tourTag="canvas-files-view-button"
						icon={<FolderOpen aria-hidden="true" />}
					/>
					<ViewToggleButton
						label="Variables view"
						isActive={currentView === "variables"}
						onClick={() => setCurrentView("variables")}
						tourTag="canvas-variables-view-button"
						icon={<ListTree aria-hidden="true" />}
					/>
					<Tooltip content="Close canvas">
						<Button
							variant="ghost"
							size="icon"
							aria-label="Close canvas"
							onClick={onClose}
							data-tour-tag="close-canvas-button"
						>
							<X aria-hidden="true" />
						</Button>
					</Tooltip>
				</div>
			</div>

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
						<EmptyState
							title="No documents open"
							description="Click on a file in chat or use the files view to open a file."
						/>
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
					<EmptyState
						title="File viewer"
						description="No active conversation context to display files."
					/>
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
		</div>
	);
};

export const Canvas = memo(CanvasComponent);
