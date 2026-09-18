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
import { Button, Card, Tooltip } from "@shared/components/ui";
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
import type { MentionScanHandle } from "../../canonical/use-mentioned-files";
import { buildFileTiles } from "./file-tiles";

type CanvasFileViewerProps = {
	conversationId: string;
	// Callback to switch view in parent component
	onSwitchToDocumentView: (documentId: string) => void;
	/**
	 * The completeness state of the scan that produced this list, plus the action
	 * that fetches the messages it has not read yet.
	 *
	 * Optional because the panel is also rendered from Storybook fixtures and from
	 * a draft with no session, where there is no transcript to page and therefore
	 * nothing to say.
	 */
	scan?: MentionScanHandle | null;
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
	scan = null,
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

			/*
			 * Availability BEFORE the kind test.
			 *
			 * The two checks were in the other order, and that turned a click on a
			 * missing file whose type has no viewer into nothing at all: `kind ===
			 * null` handed it to the OS first, so a missing tile that said `Open
			 * in default app` to nobody swallowed the click. A click must always
			 * produce something - a viewer, the OS, or a sentence.
			 *
			 * The probe is unconditional now, where it used to run only for a tile
			 * that already knew its file was gone, and the extra `stat` buys three
			 * facts the document it opens needs: the mtime its bytes are being read
			 * at (both the freshness baseline the canvas checks against later and
			 * the blob cache's key), the size the viewers state "too large" from,
			 * and `availability`. The tile's own copy of those is a reading taken
			 * when the tile was scanned, and the interval between that and this
			 * click is exactly when an agent writes the file.
			 */
			const normalizedPath = stripFileUrl(fileDoc.path);
			/*
			 * The bridge is absent in a browser build, and a click must still open what
			 * it can there: no probe answer is "nothing is known", which leaves the
			 * document without a freshness baseline rather than failing the click. The
			 * same shape `use-mentioned-files` asks its own probes with.
			 */
			const probe =
				typeof window.api?.probeFiles === "function"
					? ((await window.api.probeFiles([normalizedPath]))[0] ?? null)
					: null;
			const onDisk = Boolean(probe?.exists && probe.isFile);
			if (fileDoc.availability === "missing" && !onDisk) {
				showErrorToast(
					`File no longer exists at ${probe?.resolved ?? normalizedPath}`,
					{
						// What to do next, not only what happened: the path alone leaves
						// the reader with a three-line wrap and nowhere to go.
						description:
							"Copy its path from the tile's ⋯ menu to look for it, or check whether the agent wrote it somewhere else.",
					},
				);
				return;
			}

			if (kind === null) return fallbackAction();

			/*
			 * `lastAgentModified` and `sizeBytes` are threaded through both branches
			 * below, and each is the difference between a promise and a fact:
			 *
			 * - `lastAgentModified` is the blob cache's key (`file:<path>:<mtime>`).
			 *   Both builders used to omit it, so every viewer key was
			 *   `file:<path>:0` and a re-opened tile kept serving the bytes from before
			 *   the agent rewrote the file.
			 * - `sizeBytes` lets a viewer state "too large to preview" from the probe's
			 *   own answer, before an IPC read the main process is going to refuse
			 *   anyway.
			 */
			const carried = {
				title,
				type: getFileTypeFromPath(normalizedPath),
				lastAgentModified: probe?.mtimeMs ?? fileDoc.lastAgentModified,
				/*
				 * The freshness baseline: the mtime these bytes are being read at. Only
				 * ever a probe answer - never `fileDoc.lastAgentModified`, which is
				 * also set to `Date.now()` by the attachment path, and a baseline in
				 * the future is a file that never looks new.
				 */
				readMtimeMs: probe?.mtimeMs ?? undefined,
				availability: onDisk ? ("present" as const) : undefined,
				sizeBytes: probe?.sizeBytes ?? fileDoc.sizeBytes,
			};

			const encoding = READ_ENCODING[kind];
			if (encoding === "bytes" || encoding === "range") {
				/*
				 * The viewer reads its own bytes (`pdf-preview`, `image-preview`,
				 * `audio-preview`, `video-preview`). Reading them here would put a
				 * whole document into the store - which is persisted to
				 * localStorage - for a file the user may close without ever seeing.
				 */
				openDocument(canvasDocumentForPath(normalizedPath, carried));
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
						...carried,
						content: result.data,
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

	/*
	 * The static empty state, and the one state that must not wear it.
	 *
	 * `stopped` is not "nothing here": the scan ran out of budget with earlier
	 * messages still unread. The head below is the only thing that says so - it
	 * carries the count of what was searched and the only `Search earlier
	 * messages` action in the app - so a stopped scan has to reach it even with
	 * nothing found. Left out of this guard, that state read "No files yet" over a
	 * conversation whose earlier messages were never searched, which is the same
	 * silent omission the head exists to remove, in the one branch where the
	 * escape hatch lives (round 2, R2-1).
	 */
	if (files.length === 0 && !scan?.paging && !scan?.stopped) {
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

	const countLabel = `${tiles.length} ${tiles.length === 1 ? "file" : "files"}`;
	/*
	 * The two things an empty grid can be, in the panel's own words.
	 *
	 * An empty grid under a STOPPED scan is not a scan in progress, so it cannot
	 * borrow the line that says one is: the head above already states which
	 * messages were searched, and this body states the finding instead of a search
	 * that is no longer running.
	 */
	const emptyGrid = scan?.stopped
		? {
				title: "No files in the messages searched",
				detail:
					"Files named earlier in the conversation appear here once those messages are read.",
			}
		: {
				title: "Searching earlier messages…",
				detail:
					"Files named before the part of the conversation already loaded appear here as they are read.",
			};
	/*
	 * The panel head, and why it is not optional chrome.
	 *
	 * The grid is only as complete as the transcript the producer has read, and the
	 * transcript is paged. A list without a count and without a word about what has
	 * been searched is a list that cannot be trusted: a reader has no way to tell a
	 * two-file conversation from a two-hundred-file one whose earlier messages have
	 * not been loaded. So the head states the number, states that a scan is running
	 * while one is, and - when the scan stopped short - states exactly which
	 * messages were searched and offers the action that searches the rest. Nothing
	 * here is ever a silent omission.
	 */
	return (
		<div className={cn("flex h-full flex-col")}>
			{(tiles.length > 0 || scan?.paging || scan?.stopped) && (
				<div
					data-tour-tag="files-scanner-head"
					className={cn(
						"flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-1",
						"border-hairline border-b bg-surface px-6 py-2",
					)}
				>
					{tiles.length > 0 && (
						<span className={cn("text-body-sm text-ink")}>{countLabel}</span>
					)}
					{scan?.paging && (
						<span className={cn("text-meta text-ink-dim")}>
							Searching earlier messages… {scan.scanned} messages scanned
						</span>
					)}
					{/*
					 * The stop and the action that answers it, as ONE row.
					 *
					 * Two things were wrong with leaving them in the head's own flex row.
					 * The action was a `ghost` button — no fill, no edge, no underline, one
					 * ink step above the `ink-dim` sentence beside it — so the only action
					 * this state offers was marked as a control by contrast alone; it is
					 * `outline` now, which carries the same `border-control` a control
					 * boundary is, at rest. And its POSITION was chosen by whether the count
					 * happened to leave room: with tiles the pair wrapped to a second line
					 * starting at the head's content edge, with nothing found it sat at the
					 * end of the sentence instead. Wrapping the pair in a `w-full` row puts
					 * it on its own line in both states, so the panel's one action is in one
					 * place whichever stop produced it (design round 1, D4).
					 */}
					{scan?.stopped && (
						<div
							className={cn(
								"flex w-full flex-wrap items-center gap-x-3 gap-y-1",
							)}
						>
							<span className={cn("text-meta text-ink-dim")}>
								Searched the most recent {scan.scanned} messages; earlier
								messages are not searched yet.
							</span>
							<Button variant="outline" size="sm" onClick={scan.resume}>
								Search earlier messages
							</Button>
						</div>
					)}
				</div>
			)}
			{tiles.length === 0 ? (
				<div
					className={cn(
						"flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center",
					)}
				>
					{/* The finding, per `emptyGrid` above: this is an empty grid, not a scan in flight. */}
					<h2 className={cn("text-heading text-ink")}>{emptyGrid.title}</h2>
					<p className={cn("max-w-80 text-body-sm text-ink-muted")}>
						{emptyGrid.detail}
					</p>
				</div>
			) : (
				<div
					className={cn("min-h-0 flex-1 overflow-y-auto p-6")}
					data-tour-tag="files-scroller"
				>
					{/*
					 * `auto-fill` rather than `sm:grid-cols-3`. A viewport breakpoint is
					 * meaningless inside a resizable dock: `sm:` was true at a 1440px
					 * window while the panel itself was 400px wide, so the grid drew three
					 * 120px columns. Tracks sized against the panel cannot lie.
					 *
					 * `data-tour-tag` so the geometry probe
					 * (`scripts/mentioned-files-app-proof.mjs --geometry`) measures this box
					 * rather than guessing at `.grid`.
					 */}
					<div
						data-tour-tag="files-grid"
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
							/*
							 * The tile's tooltip carries the FULL PATH, not the name. The name is
							 * already on the tile, and where two tiles share one the path is the
							 * only thing that tells them apart — so the tooltip has to be the
							 * thing that resolves the collision rather than a second copy of the
							 * name (design round 1, D1). A `data:` document has no path to show,
							 * and pasting a whole data URI into a tooltip would be worse than
							 * useless, so it keeps its name.
							 */
							const tooltip = fileDoc.path.startsWith("data:")
								? fileDoc.title
								: fileDoc.path;
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
									<Tooltip content={tooltip}>
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
														className={cn(
															"block w-full text-meta text-ink-dim",
														)}
													>
														No longer on disk
													</span>
												)}
											</span>
										</button>
									</Tooltip>
									{/*
									 * The overflow menu comes AFTER the tile in DOM order, and that is
									 * the whole of the keyboard fix: the card's first Tab stop used to be
									 * this `⋯`, so a keyboard user who tabbed into the grid and pressed
									 * Enter got a menu instead of the file. Absolute positioning means
									 * the visual order is unchanged; only the focus order moves, and it
									 * moves onto the control the tile is for.
									 */}
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
								</Card>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
};

export const CanvasFileViewer = memo(CanvasFileViewerComponent);
