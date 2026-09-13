import type {
	CanvasDocument,
	CanvasDocumentType,
} from "@features/chat/types/canvas";
import {
	canvasDocumentForPath,
	stripFileUrl,
} from "@features/chat/utils/canvas-document";
import {
	imageExtensions,
	videoExtensions,
} from "@features/chat/utils/file-kind";
import { getFileTypeFromPath } from "@features/chat/utils/file-types";
import { READ_ENCODING, viewerFor } from "@features/chat/utils/viewer-routing";
import {
	type LocalOperatorClient,
	createLocalOperatorClient,
} from "@shared/api/local-operator";
import { FileActionsMenu } from "@shared/components/common/file-actions-menu";
import { Card, Tooltip } from "@shared/components/ui";
import { apiConfig } from "@shared/config";
import { cn } from "@shared/lib/utils";
import { useCanvasStore } from "@shared/store/canvas-store";
import { showErrorToast } from "@shared/utils/toast-manager";
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
import type { FC } from "react";
import { memo, useCallback, useMemo } from "react";
import { buildFileTiles } from "./file-tiles";

type CanvasFileViewerProps = {
	conversationId: string;
	// Callback to switch view in parent component
	onSwitchToDocumentView: (documentId: string) => void;
};

const defaultFiles: CanvasDocument[] = [];

/**
 * Thumbnail band height, shared by the image, video and icon tiles.
 *
 * Was 140px, which in a three-column 720px panel made each tile taller than it
 * was wide and pushed the file name — the only thing anyone reads here — below
 * the fold of the first row. 96px is enough to recognise an image by.
 */
const THUMBNAIL = "h-24 w-full";

/**
 * Checks if a file is an image based on its extension.
 *
 * The list lives in `utils/file-kind.ts`, shared with `getFileTypeFromPath` and
 * the viewers. It used to be spelled here as well, and the two disagreed:
 * `.tiff .ico .heic .heif .avif .jfif` were images to this grid and `"other"` to
 * the classifier, so a HEIC tile painted a thumbnail under a type that said the
 * app did not know the format.
 */
const isImage = (path: string): boolean => {
	const lowerPath = path.toLowerCase();
	return imageExtensions.some((ext) => lowerPath.endsWith(`.${ext}`));
};

/**
 * Checks if a file is a video based on its extension. Shares the list above.
 */
const isVideo = (path: string): boolean => {
	const lowerPath = path.toLowerCase();
	return videoExtensions.some((ext) => lowerPath.endsWith(`.${ext}`));
};

/**
 * Gets the appropriate URL for an attachment using the static API
 */
const getAttachmentUrl = (
	client: LocalOperatorClient,
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

const CanvasFileViewerComponent: FC<CanvasFileViewerProps> = ({
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
	const setViewMode = useCanvasStore((s) => s.setViewMode);

	// The grid's view model: order, the basename-collision line, and which tiles
	// are known to be gone. `buildFileTiles` is a pure function of this list, so
	// the rules are testable without React - they used to live in this file's own
	// `useMemo`, where the only way to ask what two `report.pdf`s look like was to
	// render the panel.
	const tiles = useMemo(() => buildFileTiles(files), [files]);

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
			/*
			 * The document view does not have its own file list, it has one `files`
			 * array and one set of tabs, and this is the only place that appends to
			 * both. Both branches below used to carry a copy of this block, which is
			 * how the data-URI branch and the path branch drifted apart.
			 */
			const openDocument = (document: CanvasDocument) => {
				const state = useCanvasStore.getState();
				const conversationCanvasState = state.conversations?.[conversationId];
				const filesInState = conversationCanvasState?.files ?? [];
				const openTabsInState = conversationCanvasState?.openTabs ?? [];

				const index = filesInState.findIndex(
					(entry) => entry.id === document.id,
				);
				// Replace rather than skip: the entry on screen may hold stale bytes
				// from an earlier read of the same file.
				const updatedFiles =
					index !== -1
						? [
								...filesInState.slice(0, index),
								document,
								...filesInState.slice(index + 1),
							]
						: [...filesInState, document];
				setFiles(conversationId, updatedFiles);

				const existsTab = openTabsInState.some((tab) => tab.id === document.id);
				const updatedTabs = existsTab
					? openTabsInState
					: [...openTabsInState, { id: document.id, title: document.title }];
				setOpenTabs(conversationId, updatedTabs);
				setSelectedTab(conversationId, document.id);
				setViewMode(conversationId, "documents");
				onSwitchToDocumentView(document.id);
			};

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

			/*
			 * One predicate for "can this open in-app, and where". It replaces two
			 * clauses asked in two orders - `isCanvasSupported(title) ||
			 * isSpreadsheetFile(title)` at each call site - which both asked the
			 * TITLE rather than the path, so a file whose name merely ended in
			 * `.md` routed on the name while its type came from the path.
			 *
			 * `null` is not an error: it is the documented downgrade to the OS.
			 */
			const kind = viewerFor(fileDoc.path, fileDoc.type);

			if (fileDoc.path.startsWith("data:")) {
				// A data URI's own text IS its content, so it needs no read: the
				// bytes are already in the string.
				if (kind === null) return fallbackAction();
				openDocument(
					canvasDocumentForPath(fileDoc.path, {
						title,
						content: fileDoc.path,
						type: getFileTypeFromPath(title),
					}),
				);
				return;
			}

			const normalizedPath = stripFileUrl(fileDoc.path);
			if (kind === null) return fallbackAction();

			/*
			 * A tile can already know its file is gone - the probe said so. It must
			 * not be handed to the OS, which would either do nothing or open the
			 * wrong thing: the honest answer is a message naming the path, and the
			 * tile's own Copy path action stays available for it.
			 *
			 * One re-probe first, because the interval between the probe and the
			 * click is exactly when an agent writes the file.
			 */
			if (fileDoc.availability === "missing") {
				const [probe] = await window.api.probeFiles([normalizedPath]);
				if (!probe || !probe.exists || !probe.isFile) {
					showErrorToast(
						`File no longer exists at ${probe?.resolved ?? normalizedPath}`,
					);
					return;
				}
			}

			const encoding = READ_ENCODING[kind];
			if (encoding === "bytes" || encoding === "range") {
				/*
				 * The viewer reads its own bytes (`pdf-preview`, `image-preview`,
				 * `audio-preview`, `video-preview`). Reading them here would put a
				 * whole document into the store - which is persisted to
				 * localStorage - for a file the user may close without ever seeing.
				 */
				openDocument(
					canvasDocumentForPath(normalizedPath, {
						title,
						type: getFileTypeFromPath(normalizedPath),
					}),
				);
				return;
			}

			try {
				const result = await window.api.readFile(normalizedPath, encoding);
				if (!result.success) {
					const errorMessage = result.error
						? result.error instanceof Error
							? result.error.message
							: String(result.error)
						: "Unknown error reading file";
					return fallbackAction(errorMessage);
				}
				openDocument(
					canvasDocumentForPath(normalizedPath, {
						title,
						content: result.data,
						type: getFileTypeFromPath(normalizedPath),
					}),
				);
			} catch (error: unknown) {
				const message =
					error instanceof Error
						? error.message
						: String(error ?? "Unknown error reading file");
				return fallbackAction(message);
			}
		},
		[
			conversationId,
			setFiles,
			setOpenTabs,
			setSelectedTab,
			setViewMode,
			onSwitchToDocumentView,
		],
	);

	if (files.length === 0) {
		return (
			<div
				className={cn(
					"flex h-full flex-col items-center justify-center gap-2 p-6 text-center",
				)}
			>
				<h2 className={cn("text-heading text-ink")}>No files yet</h2>
				<p className={cn("max-w-80 text-body-sm text-ink-muted")}>
					Files you attach to a message, and files the agent works on, appear
					here ready to open.
				</p>
			</div>
		);
	}

	return (
		<div className={cn("h-full overflow-y-auto p-6")}>
			{/*
			 * `auto-fill` rather than `sm:grid-cols-3`. A viewport breakpoint is
			 * meaningless inside a resizable dock: `sm:` was true at a 1440px
			 * window while the panel itself was 400px wide, so the grid drew three
			 * 120px columns. Tracks sized against the panel cannot lie.
			 */}
			<div
				className={cn(
					"grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3",
				)}
			>
				{tiles.map((tile) => {
					const fileDoc = tile.document;
					const IconComponent = getIconForFileType(fileDoc.type);
					const isLocalFile =
						!fileDoc.path.startsWith("data:") &&
						!fileDoc.path.startsWith("http");
					const normalizedPath = stripFileUrl(fileDoc.path);
					return (
						<Card
							key={fileDoc.id}
							variant="surface"
							padding="none"
							className={cn(
								"group relative overflow-hidden",
								"transition-colors duration-fast ease-out-quart hover:border-control",
							)}
						>
							{isLocalFile && (
								<div
									className={cn(
										"absolute top-1 right-1 z-10",
										// Revealed on hover or keyboard focus, like every
										// other row/tile action in the app. Nine permanent
										// "…" glyphs over nine thumbnails was chrome
										// competing with the content it sat on.
										"pointer-events-none opacity-0",
										"group-hover:pointer-events-auto group-hover:opacity-100",
										"group-focus-within:pointer-events-auto group-focus-within:opacity-100",
									)}
								>
									<FileActionsMenu
										filePath={normalizedPath}
										tooltip="File actions"
										aria-label="File actions"
										onShowInCanvas={() => handleFileClick(fileDoc)}
									/>
								</div>
							)}
							<Tooltip content={fileDoc.title}>
								<button
									type="button"
									onClick={() => handleFileClick(fileDoc)}
									className={cn(
										"flex w-full flex-1 flex-col text-left",
										"transition-colors duration-fast ease-out-quart",
										"hover:bg-elevated",
									)}
								>
									{fileDoc.type === "image" ? (
										<img
											src={getUrl(fileDoc.path)}
											alt={fileDoc.title}
											className={cn(THUMBNAIL, "bg-sunken object-contain")}
										/>
									) : fileDoc.type === "video" ? (
										// biome-ignore lint/a11y/useMediaCaption: a user's own attached video has no caption track to offer.
										<video
											src={getUrl(fileDoc.path)}
											controls={true}
											preload="metadata"
											className={cn(THUMBNAIL, "bg-sunken object-contain")}
										/>
									) : (
										<span
											className={cn(
												THUMBNAIL,
												"flex items-center justify-center text-ink-muted",
											)}
										>
											<IconComponent size={26} />
										</span>
									)}
									{/*
									 * The file name is the content of the tile, so it is
									 * `ink` at the body step, not a caption. The lines
									 * beneath it exist only when they say something the name
									 * does not: a directory that disambiguates a basename
									 * two tiles share, or the receipt for a file that is
									 * gone. A second line on every tile would be chrome
									 * (branding.md: "a completed action is one line, not a
									 * card").
									 */}
									<span
										className={cn(
											"block w-full border-hairline border-t px-2.5 pt-2",
											tile.showParent || tile.missing ? "pb-1" : "pb-2",
										)}
									>
										<span
											className={cn(
												"block w-full truncate text-body-sm text-ink",
											)}
										>
											{tile.name}
										</span>
										{/*
										 * Monospace is machine voice, and a path is the one
										 * thing this line is. The FULL directory rather than
										 * the immediate parent's name: two clashing
										 * `report.pdf` under `~/work/reports` and
										 * `~/archive/reports` would be as indistinguishable
										 * as they were before the line existed. It truncates
										 * like the name does.
										 */}
										{tile.showParent && (
											<span
												className={cn(
													"block w-full truncate text-mono-sm text-ink-dim",
												)}
											>
												{tile.parent}
											</span>
										)}
										{/*
										 * Missing files stay in the grid, in place, with a
										 * muted receipt: the panel's job is to say what the
										 * agent touched, and a file the user deleted after
										 * the fact was still touched. Hiding it would
										 * recreate the original complaint from the other
										 * side. Copy path keeps working; the click explains
										 * instead of opening nothing.
										 */}
										{tile.missing && (
											<span
												className={cn("block w-full text-meta text-ink-dim")}
											>
												Not found
											</span>
										)}
									</span>
								</button>
							</Tooltip>
						</Card>
					);
				})}
			</div>
		</div>
	);
};

export const CanvasFileViewer = memo(CanvasFileViewerComponent);
