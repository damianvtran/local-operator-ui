import type { CanvasDocument } from "@features/chat/types/canvas";
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
import {
	Button,
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Input,
} from "@shared/components/ui";
import { apiConfig } from "@shared/config";
import { cn } from "@shared/lib/utils";
import { useCanvasStore } from "@shared/store/canvas-store";
import { showErrorToast } from "@shared/utils/toast-manager";
import { Funnel, Search, X } from "lucide-react";
import type { FC } from "react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import type { MentionScanHandle } from "../../canonical/use-mentioned-files";
import { clearSearch } from "../../clear-search";
import { FileRowItem } from "./file-row";
import {
	FILE_KIND_GROUPS,
	type FileKindGroup,
	buildFileRows,
	countLabel,
	filterAndSearchRows,
} from "./file-rows";

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
const defaultKinds: FileKindGroup[] = [];

/**
 * The kind filter: ONE control over the nine file groups.
 *
 * One trigger rather than a row of chips, because the dock is 400px wide at its
 * narrow end and nine chips are not: a menu states the choice without spending
 * the row, and the primitive brings its own focus trap, Escape-to-close and
 * `aria-expanded`. The groups are derived from the document type in the view
 * model, so no call site re-decides what "code" means.
 *
 * The trigger reads `Filter` at rest and the first selected group plus `+N` when
 * narrowed (`Images +1`), while its ACCESSIBLE name always names every selected
 * group (`Filter: Images, Documents`): a visible label may be short, a name read
 * aloud may not be. An applied filter is an ACTIVE state, so the trigger keeps
 * its `outline` boundary and takes the accent wash — the accent the app spends
 * on an active state, low-chroma by construction and not a fill a user is meant
 * to press. The count beside it is the second, legible statement that rows are
 * hidden.
 */
const KindFilterMenu: FC<{
	kinds: FileKindGroup[];
	onChange: (kinds: FileKindGroup[]) => void;
}> = ({ kinds, onChange }) => {
	const toggle = (id: FileKindGroup, next: boolean) => {
		onChange(
			next
				? FILE_KIND_GROUPS.map((group) => group.id).filter(
						(group) => group === id || kinds.includes(group),
					)
				: kinds.filter((group) => group !== id),
		);
	};

	const selected = FILE_KIND_GROUPS.filter((group) =>
		kinds.includes(group.id),
	).map((group) => group.label);
	const narrowed = selected.length > 0;
	const triggerLabel = narrowed
		? `${selected[0]}${selected.length > 1 ? ` +${selected.length - 1}` : ""}`
		: "Filter";

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					aria-label={
						narrowed ? `Filter: ${selected.join(", ")}` : "Filter by file type"
					}
					className={cn(narrowed && "bg-accent-wash")}
				>
					<Funnel aria-hidden="true" />
					{triggerLabel}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>File types</DropdownMenuLabel>
				{FILE_KIND_GROUPS.map((group) => (
					<DropdownMenuCheckboxItem
						key={group.id}
						checked={kinds.includes(group.id)}
						onCheckedChange={(next) => toggle(group.id, next === true)}
					>
						{group.label}
					</DropdownMenuCheckboxItem>
				))}
				<DropdownMenuSeparator />
				{/*
				 * `disabled` rather than hidden: the item states what "no filter" is, and a
				 * menu whose last row appears and disappears is a menu that changes height
				 * under the pointer.
				 */}
				<DropdownMenuItem
					disabled={!narrowed}
					onSelect={() => onChange(defaultKinds)}
				>
					Clear filter
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

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

	/*
	 * Which file is already open, so the list can say so: the row for a document the
	 * Documents view is showing takes the current-row ground. Read from the store
	 * rather than from the tab strip, because the two views never render at once.
	 */
	const selectedTabId = useCanvasStore(
		(state) => state.conversations[conversationId]?.selectedTabId ?? null,
	);

	/*
	 * The list's view model: order, the basename-collision line, which rows are
	 * known to be gone, their size and their search text. `buildFileRows` is a pure
	 * function of this list, so the rules are testable without React - they used to
	 * live in this file's own `useMemo`, where the only way to ask what two
	 * `report.pdf`s look like was to render the panel.
	 */
	const rows = useMemo(() => buildFileRows(files), [files]);

	/*
	 * THE QUERY AND THE FILTER ARE COMPONENT STATE, NOT STORE STATE, and that is
	 * the load-bearing half of the decision. The canvas store is persisted to
	 * localStorage, so a stored query would re-open this panel filtered on the next
	 * launch with no visible cause, and a query stored per conversation would
	 * silently change what the panel shows when the user switches sessions. The
	 * repo's own doctrine for exactly this is *a mode of a pane is not a
	 * preference* (`ui-preferences-store.ts`, quoting `docs/run-sidebar.md` § 3.5).
	 *
	 * The cost, stated plainly rather than hidden: switching views unmounts this
	 * component, so the query resets. That is honest and cheap to re-type, where a
	 * stale filter is not - and while either control is narrowing the list, the head
	 * states both numbers, so the hidden rows are never a silent omission.
	 */
	const [query, setQuery] = useState("");
	const [kinds, setKinds] = useState<FileKindGroup[]>(defaultKinds);
	const visibleRows = useMemo(
		() => filterAndSearchRows(rows, { query, kinds }),
		[rows, query, kinds],
	);

	const searchRef = useRef<HTMLInputElement>(null);
	/*
	 * The row the keyboard is handed to when the search field lets go of focus:
	 * `Escape` on an empty field, and `ArrowDown` from the field. Set on the first
	 * row only.
	 */
	const firstRowRef = useRef<HTMLButtonElement>(null);

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
			 * null` handed it to the OS first, so a missing row that said `Open
			 * in default app` to nobody swallowed the click. A click must always
			 * produce something - a viewer, the OS, or a sentence.
			 *
			 * The probe is unconditional now, where it used to run only for a row
			 * that already knew its file was gone, and the extra `stat` buys three
			 * facts the document it opens needs: the mtime its bytes are being read
			 * at (both the freshness baseline the canvas checks against later and
			 * the blob cache's key), the size the viewers state "too large" from,
			 * and `availability`. The document's own copy of those is a reading
			 * taken when the mention was scanned, and the interval between that and
			 * this click is exactly when an agent writes the file.
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
							"Copy its path from the row's ⋯ menu to look for it, or check whether the agent wrote it somewhere else.",
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

	const total = rows.length;
	/*
	 * The count, whose two numbers are the anti-silence mechanism: see
	 * `countLabel`. With neither control active nothing is hidden and one number is
	 * the honest one.
	 */
	const narrowing = query.trim().length > 0 || kinds.length > 0;
	const count = countLabel(visibleRows.length, total, narrowing);
	/*
	 * The two things an empty list can be, in the panel's own words.
	 *
	 * An empty list under a STOPPED scan is not a scan in progress, so it cannot
	 * borrow the line that says one is: the head above already states which
	 * messages were searched, and this body states the finding instead of a search
	 * that is no longer running.
	 */
	const emptyList = scan?.stopped
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
	 * NOTHING FOUND BY A QUERY is a third state, and it may borrow NEITHER of the
	 * two above: "there are no files" is a claim about the conversation, and the
	 * query is what emptied this list. The copy names what the search matches and
	 * states how many files it is hiding, and the way out sits in the BODY as
	 * well as at the field, because the body is where the absence is read: an
	 * empty panel with a field, a count and nothing else leaves the reader to
	 * work out that emptying the field is the way back, and the head's three
	 * controls do not say so in words.
	 *
	 * The two sentences the spec fixes verbatim are the query's; the type-filter
	 * sentence is written here to match them, because a filter can empty the list on
	 * its own and the honest statement of what is hiding the rows is the part that
	 * must not be missing. A round can re-word it; it cannot be absent.
	 */
	const queryText = query.trim();
	const clearNarrowing = () => {
		setQuery("");
		setKinds(defaultKinds);
		/*
		 * Back to the field, not to nothing: the clear control unmounts in the same
		 * commit that empties the query, and the browser drops focus to `<body>` when
		 * the focused element leaves the DOM (`clearSearch`'s own note). The list may
		 * also have gained rows, so leaving the caret in the field is where the next
		 * keystroke goes.
		 */
		searchRef.current?.focus();
	};
	const noMatch = queryText
		? kinds.length > 0
			? {
					title: `No files match “${queryText}”`,
					detail: `Files are matched on their name and folder, and the type filter is hiding the rest. Clear both to see all ${total} ${total === 1 ? "file" : "files"}.`,
					action: "Clear search and filter",
				}
			: {
					title: `No files match “${queryText}”`,
					detail: `Files are matched on their name and folder. Clear the search to see all ${total} ${total === 1 ? "file" : "files"}.`,
					action: "Clear search",
				}
		: {
				title: "No files of those types",
				detail: `The type filter is hiding every file. Clear the filter to see all ${total} ${total === 1 ? "file" : "files"}.`,
				action: "Clear filter",
			};

	/*
	 * The panel head, and why it is not optional chrome.
	 *
	 * The list is only as complete as the transcript the producer has read, and the
	 * transcript is paged. A list without a count and without a word about what has
	 * been searched is a list that cannot be trusted: a reader has no way to tell a
	 * two-file conversation from a two-hundred-file one whose earlier messages have
	 * not been loaded. So the head states the number, states that a scan is running
	 * while one is, and - when the scan stopped short - states exactly which
	 * messages were searched and offers the action that searches the rest. Nothing
	 * here is ever a silent omission.
	 *
	 * IT RENDERS ON `files.length > 0`, NOT ON THE VISIBLE ROW COUNT. That is what
	 * keeps the search field on screen in the one state that most needs an exit: a
	 * query that matches nothing would otherwise take away the field that typed it,
	 * leaving the user with an empty panel and no way back. The scan lines keep their
	 * own condition, so a stopped scan still reaches its action with nothing found.
	 *
	 * One register for all three statements: the count, the paging sentence and the
	 * stop sentence are `text-meta text-ink-dim`. They were two registers for three
	 * statements about one list, which reads as two severities where there is one
	 * subject.
	 */
	return (
		/*
		 * THE ROOT IS `min-h-0 flex-1`, NOT `h-full`, and this class is the fix for the
		 * clipped last rows.
		 *
		 * The box is a sibling of the 40px chrome bar inside the canvas section's
		 * `flex h-full flex-col`, so `h-full` made it 100% of the pane PLUS the bar -
		 * 40px taller than the space it has - and the dock's `overflow-hidden` cut that
		 * strip off. The scroller inside therefore had a viewport 40px taller than what
		 * the user could see, reached its own maximum scroll with the last rows still
		 * under the clip, and left its own bottom padding unreachable. `flex-1` states
		 * what this element is (the rest of the column, not all of a box that also
		 * holds the bar) and `min-h-0` removes the floor that `h-full`'s specified size
		 * was imposing through the content-based minimum (CSS Flexbox § 4.5). Measured
		 * in the running app at 1380x900 before the change: the scroller's bottom 40px
		 * past the window edge, 2 rows clipped, the last row's bottom 15.67px past it;
		 * after: 0, 0, and inside.
		 */
		<div className={cn("flex min-h-0 flex-1 flex-col")}>
			{(files.length > 0 || scan?.paging || scan?.stopped) && (
				<div
					data-tour-tag="files-scanner-head"
					className={cn(
						"flex shrink-0 flex-col gap-2",
						"border-hairline border-b bg-surface px-2 py-2",
					)}
				>
					{files.length > 0 && (
						<div className={cn("flex items-center gap-2")}>
							{/*
							 * `type="text"` and not `type="search"`: the UA cancel button cannot
							 * be themed, and it would be the only unthemed control on the surface.
							 * The search LANDMARK is therefore the `search` element rather than a
							 * hand-spelled `role="search"` on this box: same role, none of the ARIA
							 * to keep in sync, and the repo's lint refuses the hand-spelled form.
							 */}
							<search className={cn("relative min-w-0 flex-1")}>
								<Search
									className={cn(
										"-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 size-3.5 text-ink-dim",
									)}
									aria-hidden="true"
								/>
								<Input
									ref={searchRef}
									inputSize="sm"
									type="text"
									aria-label="Search files by name or folder"
									placeholder="Search files by name or folder"
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									onKeyDown={(event) => {
										/*
										 * Escape: a non-empty query clears and the field keeps the caret,
										 * because the field is the thing the user will retype into; an
										 * empty query lets focus go to the first row, which is the way out
										 * of the field. ArrowDown is the same hand-off, one key earlier.
										 * The canvas's own Escape binding is not in the way: it acts
										 * only in the documents view.
										 */
										if (event.key === "Escape") {
											if (query) {
												event.preventDefault();
												clearSearch(searchRef.current, setQuery);
											} else {
												firstRowRef.current?.focus();
											}
											return;
										}
										if (event.key === "ArrowDown") {
											event.preventDefault();
											firstRowRef.current?.focus();
										}
									}}
									className={cn("pl-7", query ? "pr-8" : undefined)}
									autoComplete="off"
									spellCheck={false}
								/>
								{query ? (
									/*
									 * `clearSearch` rather than two statements, because the pairing is
									 * the whole contract: this control unmounts in the same commit
									 * that empties the query, and the browser drops focus to `<body>`
									 * when the focused element leaves the DOM rather than handing it to
									 * a sibling. The inset ring is the one the sidebar's field needed
									 * for the same reason: `icon-sm`'s own 2px offset needs 3px of
									 * clearance inside a 1px-bordered field and there is only 2px.
									 */
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label="Clear search"
										className={cn(
											"-translate-y-1/2 absolute top-1/2 right-0.5 focus-visible:outline-offset-[-2px]!",
										)}
										onClick={() => clearSearch(searchRef.current, setQuery)}
									>
										<X aria-hidden="true" />
									</Button>
								) : null}
							</search>
							<KindFilterMenu kinds={kinds} onChange={setKinds} />
							{/*
							 * `pr-8` is the row's own trailing gutter, and it is what makes the count
							 * sit over the column it counts: a row reserves 28px for its `⋯`
							 * (`file-row.tsx`), so the size and receipt inks end 32px short of the row's
							 * right edge. Without it the head's two right-ragged text columns sat 32px
							 * apart, and the offset only explains itself while a row happens to be
							 * hovered. The count is directly above the sizes it summarises (design
							 * round 1, D3).
							 */}
							<span className={cn("shrink-0 pr-8 text-meta text-ink-dim")}>
								{count}
							</span>
						</div>
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
					 * happened to leave room: with rows the pair wrapped to a second line
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
							{/*
							 * `min-w-0 flex-1` on the sentence and `ml-auto` on the button, so the
							 * head has ONE trailing edge in both stop states. As plain flow items the
							 * button's x was set by the sentence's width, which is set by the digit
							 * count of `scan.scanned` - the panel's only action moved whenever the
							 * number it describes gained a digit, which is the same class of movement
							 * the row above it was fixed for (design round 1, D2).
							 */}
							<span className={cn("min-w-0 flex-1 text-meta text-ink-dim")}>
								Searched the most recent {scan.scanned} messages; earlier
								messages are not searched yet.
							</span>
							<Button
								variant="outline"
								size="sm"
								className={cn("ml-auto")}
								onClick={scan.resume}
							>
								Search earlier messages
							</Button>
						</div>
					)}
				</div>
			)}
			{visibleRows.length > 0 ? (
				/*
				 * The scroller is the panel's ONLY scroll container, and it is also the
				 * container the rows query: `@container/fileslist` names the box whose
				 * width decides whether a row can carry its size beside its name. A
				 * container query rather than a viewport breakpoint because the dock
				 * resizes 400–1200px inside a window that does not — `sm:` was once true
				 * at a 1440px window while this panel was 400px wide.
				 *
				 * `p-2`, so the row's hover ground starts 8px in and a row's text lands
				 * 16px from the dock edge — the same left edge the chrome bar's switcher
				 * already uses. The grid's `p-6` spent 12% of a 400px dock on margin.
				 */
				<div
					className={cn(
						"@container/fileslist min-h-0 flex-1 overflow-y-auto p-2",
					)}
					data-tour-tag="files-scroller"
				>
					{/*
					 * The rows' container keeps the `files-grid` name deliberately: the
					 * geometry probe and the scratchpad harness both address "the rows'
					 * container" by it, and what they read about it — its rect, its children
					 * in order, its first focusable control — is a property of the container
					 * and not of a grid. A rename would lose that coverage silently.
					 *
					 * `ul`/`li` with a button per row and no `role="listbox"`: there is no
					 * selection model here (the row's action is "open this file"), and a
					 * listbox without one is a lie to a screen reader. The row's accessible
					 * name is its own text, which is what makes a clashing basename
					 * distinguishable by ear and a missing file announce its receipt.
					 */}
					<ul className={cn("flex flex-col")} data-tour-tag="files-grid">
						{visibleRows.map((row, index) => (
							<FileRowItem
								key={row.document.id}
								row={row}
								getUrl={getUrl}
								current={row.document.id === selectedTabId}
								onOpen={handleFileClick}
								buttonRef={index === 0 ? firstRowRef : undefined}
							/>
						))}
					</ul>
				</div>
			) : (
				<div
					className={cn(
						"flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center",
					)}
				>
					{/*
					 * A query or a filter emptied this list, so the body says so and offers the
					 * way out; otherwise it is a genuinely empty list and states the finding
					 * (`emptyList` above — an empty LIST, not a scan in flight).
					 */}
					{narrowing ? (
						<>
							<h2 className={cn("text-heading text-ink")}>{noMatch.title}</h2>
							<p className={cn("max-w-80 text-body-sm text-ink-muted")}>
								{noMatch.detail}
							</p>
							<Button variant="outline" size="sm" onClick={clearNarrowing}>
								{noMatch.action}
							</Button>
						</>
					) : (
						<>
							<h2 className={cn("text-heading text-ink")}>{emptyList.title}</h2>
							<p className={cn("max-w-80 text-body-sm text-ink-muted")}>
								{emptyList.detail}
							</p>
						</>
					)}
				</div>
			)}
		</div>
	);
};

export const CanvasFileViewer = memo(CanvasFileViewerComponent);
