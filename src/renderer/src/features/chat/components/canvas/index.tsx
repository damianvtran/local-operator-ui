import { Button, TabPanel, Tooltip } from "@shared/components/ui";
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
	PanelRightClose,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { FC, ReactNode } from "react";
import type { CanvasDocument } from "../../types/canvas";
import { createFile } from "../../utils/file-creation";
import { getFileTypeFromPath } from "../../utils/file-types";
import { CanvasContent } from "./canvas-content";
import { CanvasFileViewer } from "./canvas-file-viewer";
import {
	CANVAS_DOCUMENT_PANEL_ID,
	CANVAS_SELECTED_TAB_ID,
	CanvasTabs,
} from "./canvas-tabs";
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
 * The three canvas views, as a segmented control.
 *
 * Previously three independent ghost buttons sitting in the same row as two
 * unrelated actions and the close control — six identical 32px icon squares in
 * which nothing said that exactly one of the middle three was always on. A
 * segmented control on a `sunken` track says "pick one of these" before a
 * single label is read; it is the idiom the app already uses for the sheet
 * switcher and for `Tabs`, so this is not a new pattern, only a correctly
 * applied one.
 *
 * Hand-rolled against the `Tabs` visual contract rather than built on the
 * primitive because the views are not panels in one accessible tab set: the
 * variables view is a different data source, not a panel of this widget.
 * `role="radiogroup"` is what "one of three, always one" actually means.
 */
const VIEWS: {
	value: CanvasViewMode;
	label: string;
	tourTag: string;
	Icon: typeof FileText;
}[] = [
	{
		value: "documents",
		label: "Documents",
		tourTag: "canvas-documents-view-button",
		Icon: FileText,
	},
	{
		value: "files",
		label: "Files",
		tourTag: "canvas-files-view-button",
		Icon: FolderOpen,
	},
	{
		value: "variables",
		label: "Variables",
		tourTag: "canvas-variables-view-button",
		Icon: ListTree,
	},
];

const ViewSwitcher: FC<{
	current: CanvasViewMode;
	onChange: (view: CanvasViewMode) => void;
}> = ({ current, onChange }) => (
	// A `fieldset` rather than a div with `role="group"`: the element already
	// means "these controls belong together", and it is the only way the group
	// gets an accessible name without inventing ARIA for it. Its UA border and
	// margin are reset by the utilities below.
	//
	// No track behind it. Selection is the same `sunken`-strip-with-a-`surface`
	// -chip step the tab row six pixels below already uses, so a second recessed
	// well would be a box drawn around a pattern the panel has already taught.
	<fieldset
		className={cn("inline-flex h-7 shrink-0 items-center gap-0.5 border-0 p-0")}
	>
		<legend className={cn("sr-only")}>Canvas view</legend>
		{VIEWS.map(({ value, label, tourTag, Icon }) => {
			const isActive = current === value;
			return (
				<Tooltip key={value} content={`${label} view`}>
					<button
						type="button"
						aria-pressed={isActive}
						aria-label={`${label} view`}
						data-tour-tag={tourTag}
						onClick={() => onChange(value)}
						className={cn(
							"inline-flex h-6 items-center justify-center rounded-sm px-2",
							"transition-colors duration-fast ease-out-quart",
							"[&_svg]:size-3.5",
							isActive
								? "bg-surface text-ink"
								: "text-ink-muted hover:text-ink",
						)}
					>
						<Icon aria-hidden="true" />
					</button>
				</Tooltip>
			);
		})}
	</fieldset>
);

/**
 * Empty state panel for the canvas.
 *
 * An empty state that only reports emptiness is a dead end, so this one takes
 * the actions that would resolve it. The copy names what the user does next
 * rather than what is absent.
 */
const EmptyState: FC<{
	title: string;
	description: string;
	children?: ReactNode;
}> = ({ title, description, children }) => (
	<div
		className={cn(
			"flex h-full flex-col items-center justify-center gap-2 bg-canvas p-6 text-center",
		)}
	>
		<h3 className={cn("text-heading text-ink")}>{title}</h3>
		<p className={cn("max-w-72 text-body-sm text-ink-muted")}>{description}</p>
		{children ? (
			<div className={cn("mt-2 flex items-center gap-2")}>{children}</div>
		) : null}
	</div>
);

/**
 * The canvas panel.
 *
 * A dock beside the conversation holding the files the agent is working on.
 *
 * The shell is one surface with ground steps, not a stack of bordered panels:
 * the chrome bar sits on `surface`, the tab strip and empty states sit on
 * `sunken`/`canvas`, and regions separate by that lightness step alone.
 *
 * ## Why there is no visible panel title
 *
 * The header used to be 84px of "Canvas / Your visual workspace" — a panel
 * announcing its own name and then describing itself, above a tab strip that
 * already says what is open. Zed's docks, Notion's side peek and Linear's
 * issue panel all label themselves to the accessibility tree and nowhere
 * else, because the user opened the thing on purpose and every pixel of a
 * side panel is contested. The name now lives on `aria-label`, and the 44px
 * it cost goes to the document.
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
		<section
			aria-label="Canvas"
			data-tour-tag="canvas-container"
			className={cn("flex h-full flex-col bg-surface")}
		>
			{/*
			 * One 40px chrome bar: what you are looking at on the left, what you
			 * can do about it on the right, and the dismiss last. The two file
			 * actions keep `icon-sm` so the whole bar reads as chrome rather than
			 * as content — the same weight relationship Zed and VS Code use
			 * between a dock's title bar and the editor under it.
			 *
			 * `sunken`, the same ground as the tab strip below it, so the two read
			 * as one recessed chrome block rather than two stacked bars. The
			 * document is the only thing on `surface`, and the selected tab takes
			 * `surface` to say it belongs to the document rather than to the
			 * chrome — the tab metaphor doing the job it was invented for.
			 */}
			<div
				className={cn(
					"flex h-10 shrink-0 items-center justify-between gap-2 bg-sunken px-2",
				)}
			>
				<ViewSwitcher current={currentView} onChange={setCurrentView} />
				<div className={cn("flex shrink-0 items-center gap-0.5")}>
					<Tooltip content={`New file (${modifierKey} + N)`}>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`New file (${modifierKey} + N)`}
							onClick={() => setCreateFileDialogOpen(true)}
							data-tour-tag="canvas-create-file-button"
						>
							<FilePlus aria-hidden="true" />
						</Button>
					</Tooltip>
					<Tooltip content={`Open file (${modifierKey} + O)`}>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`Open file (${modifierKey} + O)`}
							onClick={handleOpenFile}
						>
							<FileUp aria-hidden="true" />
						</Button>
					</Tooltip>
					{/*
					 * A panel-collapse glyph, not a generic ✕. The ✕ read as
					 * "close the document" beside a strip of tabs that each carry
					 * their own ✕; this one says which way the panel goes.
					 */}
					<Tooltip content="Close canvas">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Close canvas"
							onClick={onClose}
							data-tour-tag="close-canvas-button"
						>
							<PanelRightClose aria-hidden="true" />
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

					{/*
					 * Document content area, and the panel half of the tab strip
					 * above it. It is only wrapped when a document is actually
					 * mounted, which is the same condition under which the strip
					 * puts `aria-controls` on the selected tab.
					 */}
					{activeDocument && (
						<TabPanel
							id={CANVAS_DOCUMENT_PANEL_ID}
							labelledBy={CANVAS_SELECTED_TAB_ID}
						>
							<CanvasContent
								document={activeDocument}
								conversationId={conversationId}
								agentId={agentId}
							/>
						</TabPanel>
					)}

					{/* Empty state when no documents are open */}
					{!activeDocument && documents.length === 0 && (
						<EmptyState
							title="Nothing open yet"
							description="Open a file to read or edit it here. Files the agent mentions in the conversation open here too."
						>
							<Button
								variant="secondary"
								size="sm"
								onClick={() => setCreateFileDialogOpen(true)}
							>
								<FilePlus aria-hidden="true" />
								New file
							</Button>
							<Button variant="secondary" size="sm" onClick={handleOpenFile}>
								<FileUp aria-hidden="true" />
								Open file
							</Button>
						</EmptyState>
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
						title="No conversation open"
						description="Start a conversation with an agent to see the files and variables it is working with."
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
		</section>
	);
};

export const Canvas = memo(CanvasComponent);
