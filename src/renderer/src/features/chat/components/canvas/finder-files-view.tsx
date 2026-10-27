import { rowCurrent } from "@features/chat/components/chat-sidebar";
import { ImageLightbox } from "@shared/components/common/image-lightbox";
import {
	Button,
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Input,
	Tooltip,
} from "@shared/components/ui";
import { fold } from "@shared/components/ui/searchable-select";
import { useEverInView } from "@shared/hooks/use-ever-in-view";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { createBlobUrl, revokeBlobUrl } from "@shared/lib/blob-url-cache";
import { cn } from "@shared/lib/utils";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import {
	ArrowUpDown,
	ChevronDown,
	ChevronRight,
	File,
	FileVideo,
	FolderOpen,
	Funnel,
	Maximize2,
	X,
} from "lucide-react";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { t } from "../../../../../../i18n";
import {
	formatDate,
	formatDateTime,
	formatNumber,
} from "../../../../../../i18n/format";
import type { FileIndexState } from "../../canonical/use-session-files";
import type { CanvasDocument } from "../../types/canvas";
import { ARTIFACT_HEAD_LENGTH } from "../../utils/artifact-identity";
import {
	artifactFileName,
	artifactTooltip,
} from "../../utils/artifact-identity";
import { revealLocalTarget } from "../../utils/link-open";
import { viewerFor } from "../../utils/viewer-routing";
import { ImageActionsMenu } from "../image-actions-menu";
import { AudioDocumentPlayer } from "./audio-document-player";
import { FILE_KIND_GROUPS, filterAndSearchRows } from "./file-rows";
import {
	ATTACHMENTS_SECTION,
	FINDER_HEADER_BAND,
	FOCUS_RING_GAP,
	type FinderBand,
	type FinderItem,
	finderNeighbor,
	finderSections,
	finderWindow,
	layoutFinder,
	sortFinder,
} from "./finder-layout";
import { finderOriginal, useFinderThumbnail } from "./finder-thumbnails";

const sortLabels = {
	recent: () => t("ui.canvas.files.recent"),
	name: () => t("ui.canvas.files.name"),
	kind: () => t("ui.canvas.files.kind"),
	modified: () => t("ui.canvas.files.modified"),
	created: () => t("ui.canvas.files.created"),
	size: () => t("ui.canvas.files.size"),
};
const sectionLabels: Record<string, () => string> = {
	Highlights: () => t("ui.canvas.files.highlights"),
	"Working files": () => t("ui.canvas.files.working"),
	Images: () => t("ui.canvas.files.images"),
	Videos: () => t("ui.canvas.files.videos"),
	/*
	 * The Sounds section reads the same catalogue word the filter menu's group
	 * and the sort-by-kind column use (`ui.canvas.files.audio`, whose en value is
	 * "Sounds"): one group, one word, three surfaces (file-rows.ts's comment).
	 */
	Sounds: () => t("ui.canvas.files.audio"),
	Documents: () => t("ui.canvas.files.documents"),
	Spreadsheets: () => t("ui.canvas.files.spreadsheets"),
	Other: () => t("ui.canvas.files.other"),
	Files: () => t("ui.canvas.files.files"),
	Attachments: () => t("ui.canvas.files.attachments"),
};
const kindLabel = (kind: string): string => {
	switch (kind) {
		case "images":
			return t("ui.canvas.files.images");
		case "video":
			return t("ui.canvas.files.videos");
		case "documents":
			return t("ui.canvas.files.documents");
		case "spreadsheets":
			return t("ui.canvas.files.spreadsheets");
		case "audio":
			return t("ui.canvas.files.audio");
		case "code":
			return t("ui.canvas.files.code");
		case "presentations":
			return t("ui.canvas.files.presentations");
		case "archives":
			return t("ui.canvas.files.archives");
		default:
			return t("ui.canvas.files.other");
	}
};
/** A path has a separator; a bare attachment name does not. */
const PATH_SEPARATOR = /[/\\]/;
const REVEAL =
	"pointer-events-none absolute top-1 end-1 flex gap-1 opacity-0 transition-opacity duration-fast ease-out-quart group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100";

type Props = {
	conversationId: string;
	legacyScan?:
		| import("../../canonical/use-mentioned-files").MentionScanHandle
		| null;
	items: FinderItem[];
	index: FileIndexState & { refresh: () => void; localReadAllowed?: boolean };
	cwd?: string;
	onOpen: (document: CanvasDocument) => void;
	materialise: (document: CanvasDocument) => Promise<string>;
	/**
	 * The person's attachments, already projected (`attachment-items.ts`) and
	 * pinned above the agent's files. `complete: false` = only loaded rows were
	 * available, which the section header says rather than hides.
	 */
	attachments?: {
		items: FinderItem[];
		complete: boolean;
		state: "loading" | "ready" | "error";
		retry: () => void;
	};
};

const NO_ATTACHMENTS = {
	items: [] as FinderItem[],
	complete: true,
	state: "ready" as const,
	retry: () => {},
};

/** A button/list keyboard model; no grid/listbox claim without their selection semantics. */
export function FinderFilesView({
	conversationId,
	items,
	index,
	cwd,
	onOpen,
	materialise,
	legacyScan,
	attachments = NO_ATTACHMENTS,
}: Props) {
	const locale = useI18nLocale();
	const selectedId = useCanvasStore(
		(state) => state.conversations[conversationId]?.selectedTabId,
	);
	const [settledItems, setSettledItems] = useState(items);
	const [engaged, setEngaged] = useState(false);

	const prefs = useUiPreferencesStore((state) => state.finderFiles);
	const setPrefs = useUiPreferencesStore((state) => state.setFinderFiles);
	const [query, setQuery] = useState("");
	const closed = useMemo(
		() => new Set(prefs.closedSections),
		[prefs.closedSections],
	);
	const [focused, setFocused] = useState<string | null>(null);
	const rowHadFocus = useRef(false);
	const [viewport, setViewport] = useState({ width: 400, height: 700, top: 0 });
	const scroller = useRef<HTMLDivElement>(null);
	const search = useRef<HTMLInputElement>(null);
	const controls = useRef(new Map<string, HTMLButtonElement>());
	const headerControls = useRef(new Map<string, HTMLButtonElement>());
	const [lightbox, setLightbox] = useState<string | null>(null);
	const lightboxOpener = useRef<HTMLElement | null>(null);
	useEffect(() => {
		if (index.localReadAllowed === false) {
			setSettledItems([]);
			setLightbox(null);
		} else if ((!engaged || settledItems.length === 0) && lightbox === null) {
			// A pending first generation is not a reading snapshot. Never freeze
			// that empty value just because the pointer is parked over the list.
			setSettledItems(items);
		}
	}, [items, engaged, lightbox, index.localReadAllowed, settledItems.length]);
	const [lightboxSource, setLightboxSource] = useState<string | undefined>();
	const [lightboxFailed, setLightboxFailed] = useState(false);
	const typeahead = useRef({ text: "", at: 0 });
	const displayItems = index.localReadAllowed === false ? [] : settledItems;
	const narrowing = Boolean(query.trim() || prefs.kinds.length);
	const narrowed = useMemo(() => {
		const ids = new Set(
			filterAndSearchRows(
				displayItems.map((item) => item.row),
				{ query, kinds: prefs.kinds },
			).map((row) => row.document.id),
		);
		return sortFinder(
			displayItems.filter((item) => ids.has(item.row.document.id)),
			prefs,
		);
	}, [displayItems, query, prefs]);
	/*
	 * Attachments are narrowed by the same search and kind filter as the agent's
	 * files (one query box, one filter), but are NOT held by the hover freeze
	 * above: a new send must appear the moment it lands, and an attachment is
	 * never removed by a turn the way an agent file can be rewritten.
	 */
	const narrowedAttachments = useMemo(() => {
		if (index.localReadAllowed === false && !attachments.items.length)
			return [];
		const ids = new Set(
			filterAndSearchRows(
				attachments.items.map((item) => item.row),
				{ query, kinds: prefs.kinds },
			).map((row) => row.document.id),
		);
		return attachments.items.filter((item) => ids.has(item.row.document.id));
	}, [attachments.items, query, prefs.kinds, index.localReadAllowed]);
	const sections = useMemo(() => {
		// Section labels are translated inside finderSections, not in these inputs.
		void locale;
		return finderSections(
			narrowed,
			prefs,
			narrowing,
			closed,
			narrowedAttachments,
		);
	}, [narrowed, prefs, narrowing, closed, locale, narrowedAttachments]);
	const layout = useMemo(
		() => layoutFinder(sections, viewport.width, prefs.group),
		[sections, viewport.width, prefs.group],
	);
	// Re-sorting can move a keyed tile between virtual bands, which unmounts its
	// old button. Keep its content identity as the focus anchor, but never steal
	// focus from an open Sort/Filter menu or search control.
	useEffect(() => {
		if (
			rowHadFocus.current &&
			focused &&
			layout.positions.has(focused) &&
			document.activeElement === document.body
		) {
			controls.current.get(focused)?.focus({ preventScroll: true });
		}
	}, [layout, focused]);
	const first =
		layout.bands.find((band) => band.items.length)?.items[0]?.row.document.id ??
		null;
	const active =
		focused?.startsWith("header:") || (focused && layout.positions.has(focused))
			? focused
			: (layout.bands.find((band) => band.items.length)?.items[0]?.row.document
					.id ?? (sections[0] ? `header:${sections[0].id}` : null));
	const windowBands = useMemo(
		() => new Set(finderWindow(layout, viewport.top, viewport.height, active)),
		[layout, viewport.top, viewport.height, active],
	);
	// The gallery walks the pictures in on-screen order: attachments first.
	const images = useMemo(
		() =>
			[...narrowedAttachments, ...narrowed].filter(
				(item) =>
					item.row.media === "image" &&
					layout.positions.has(item.row.document.id),
			),
		[narrowed, narrowedAttachments, layout],
	);
	const selectedImage = images.find(
		(item) => item.row.document.id === lightbox,
	);
	useEffect(() => {
		if (!selectedImage) {
			setLightboxSource(undefined);
			setLightboxFailed(false);
			return;
		}
		let live = true;
		let url: string | undefined;
		setLightboxSource(undefined);
		void finderOriginal(selectedImage.row.document)
			.then(async (blob) => {
				if (!live) return;
				url = createBlobUrl(await blob.arrayBuffer(), blob.type);
				if (live) setLightboxSource(url);
				else revokeBlobUrl(url);
			})
			.catch(() => {
				if (live) {
					setLightboxSource(undefined);
					setLightboxFailed(true);
				}
			});
		return () => {
			live = false;
			if (url) revokeBlobUrl(url);
		};
	}, [selectedImage]);
	useEffect(() => {
		const node = scroller.current;
		if (!node) return;
		const measure = () =>
			setViewport((old) => ({
				...old,
				width: node.clientWidth,
				height: node.clientHeight,
			}));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	const focusItem = useCallback(
		(id: string) => {
			const position = layout.positions.get(id);
			const node = scroller.current;
			if (!position || !node) return;
			const band = layout.bands[position.band];
			/*
			 * THE REVEAL MUST CLEAR THE STICKY HEADER.
			 *
			 * The section header is `position: sticky` INSIDE this scroller, so
			 * it occupies the scroller's own top 32 pixels while the list is
			 * scrolled. A reveal that assigns `scrollTop = band.top` lands the
			 * band at the scroller's TOP EDGE — inside the header's band — and
			 * the header paints over the first 32 pixels of the row the user
			 * just navigated to. Measured on the running app before this
			 * change: 12 of 12 upward keyboard landings put the focused row
			 * exactly 32px under the header, and the row's own name and
			 * thumbnail were hidden by it.
			 *
			 * The repo's own scroll helper names this case in advance
			 * ("shared/lib/scroll.ts": "If a sticky header ever appears above
			 * a section a reveal targets, the offset here gains that padding
			 * term rather than the call site going back to scrollIntoView"),
			 * and this list assigns `scrollTop` directly, so the term is added
			 * here: the band is revealed BELOW the header, not under it.
			 *
			 * The DOWNWARD case already landed the row at the scroller's
			 * bottom edge, which is clear of the header, and is unchanged. The
			 * low clamp is the scroller's own: a band near the top cannot be
			 * revealed below the header, because there is no room above it,
			 * and a negative scrollTop is a value no box can hold.
			 */
			if (band.top < node.scrollTop)
				node.scrollTop = Math.max(
					0,
					band.top - FINDER_HEADER_BAND - FOCUS_RING_GAP,
				);
			else if (band.top + band.height > node.scrollTop + node.clientHeight)
				node.scrollTop = band.top + band.height - node.clientHeight;
			setFocused(id);
			setViewport((old) => ({ ...old, top: node.scrollTop }));
			requestAnimationFrame(() => controls.current.get(id)?.focus());
		},
		[layout],
	);
	const key = (event: KeyboardEvent, item: FinderItem) => {
		if (event.target !== event.currentTarget) return;
		if (event.key === "Escape" && (query || prefs.kinds.length)) {
			event.preventDefault();
			event.stopPropagation();
			setQuery("");
			setPrefs({ kinds: [] });
			return;
		}
		if (event.key === "/") {
			event.preventDefault();
			search.current?.focus();
			return;
		}
		if (
			[
				"ArrowUp",
				"ArrowDown",
				"ArrowLeft",
				"ArrowRight",
				"Home",
				"End",
				"PageUp",
				"PageDown",
			].includes(event.key)
		) {
			event.preventDefault();
			const here = layout.positions.get(item.row.document.id);
			if (here && ["ArrowUp", "ArrowDown"].includes(event.key)) {
				const adjacent =
					layout.bands[here.band + (event.key === "ArrowUp" ? -1 : 1)];
				if (adjacent?.kind === "header") {
					event.preventDefault();
					setFocused(`header:${adjacent.section.id}`);
					headerControls.current.get(adjacent.section.id)?.focus();
					return;
				}
			}
			const next = finderNeighbor(
				layout,
				item.row.document.id,
				event.key,
				viewport.height,
			);
			if (next) focusItem(next);
			return;
		}
		if (
			event.key.length === 1 &&
			!event.ctrlKey &&
			!event.metaKey &&
			event.key !== " "
		) {
			const now = Date.now();
			const text =
				(now - typeahead.current.at < 500 ? typeahead.current.text : "") +
				event.key.toLocaleLowerCase();
			typeahead.current = { text, at: now };
			const start = narrowed.findIndex(
				(entry) => entry.row.document.id === item.row.document.id,
			);
			for (let step = 1; step <= narrowed.length; step++) {
				const candidate = narrowed[(start + step) % narrowed.length];
				if (
					layout.positions.has(candidate.row.document.id) &&
					fold(candidate.row.name).startsWith(fold(text))
				) {
					event.preventDefault();
					focusItem(candidate.row.document.id);
					break;
				}
			}
		}
	};
	const toggle = (id: string) => {
		if (id === "Working files") {
			if (!narrowing) setPrefs({ workingOpen: !prefs.workingOpen });
			return;
		}
		if (narrowing) return;
		const next = new Set(closed);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		setPrefs({ closedSections: [...next] });
	};
	const clear = () => {
		setQuery("");
		setPrefs({ kinds: [] });
		search.current?.focus();
	};
	const frame = useRef<number | null>(null);
	useEffect(
		() => () => {
			if (frame.current !== null) cancelAnimationFrame(frame.current);
		},
		[],
	);
	const readScroll = () => {
		if (frame.current !== null) return;
		frame.current = requestAnimationFrame(() => {
			frame.current = null;
			const node = scroller.current;
			if (node) setViewport((old) => ({ ...old, top: node.scrollTop }));
		});
	};
	return (
		<div
			onKeyDownCapture={(event) => {
				const target = event.target;
				if (
					event.key === "/" &&
					!event.ctrlKey &&
					!event.metaKey &&
					target instanceof HTMLElement &&
					!target.closest("input,textarea,[contenteditable=true]")
				) {
					event.preventDefault();
					event.stopPropagation();
					search.current?.focus();
				}
			}}
			className={cn("@container/fileslist flex min-h-0 flex-1 flex-col")}
		>
			<div
				className={cn("shrink-0 space-y-1 px-2 py-2")}
				data-tour-tag="files-scanner-head"
			>
				<div className={cn("flex items-center gap-2")}>
					<Input
						ref={search}
						value={query}
						placeholder={t(
							"ui.canvas.finder_files_view.ui_canvas_files_searchplaceholder",
						)}
						aria-label={t("ui.canvas.files.search")}
						className={cn("min-w-0 flex-1")}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (
								event.key === "ArrowDown" ||
								(event.key === "Escape" && !query && !prefs.kinds.length)
							) {
								event.preventDefault();
								event.stopPropagation();
								if (first) focusItem(first);
							} else if (event.key === "Escape") {
								event.preventDefault();
								event.stopPropagation();
								setQuery("");
								setPrefs({ kinds: [] });
							}
						}}
					/>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="outline"
								size="md"
								aria-label={`${t("ui.canvas.files.sort")}: ${sortLabels[prefs.sort]()}, ${prefs.order === "asc" ? t("ui.canvas.files.asc") : t("ui.canvas.files.desc")}`}
							>
								<ArrowUpDown aria-hidden="true" />
								<span className="hidden @min-[440px]/fileslist:inline">
									{sortLabels[prefs.sort]()}
								</span>
								<span aria-hidden="true">
									{prefs.order === "asc" ? "↑" : "↓"}
								</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{(Object.keys(sortLabels) as Array<keyof typeof sortLabels>).map(
								(sort) => (
									<DropdownMenuCheckboxItem
										key={sort}
										checked={prefs.sort === sort}
										onCheckedChange={() =>
											setPrefs({
												sort,
												order: ["modified", "created", "size"].includes(sort)
													? "desc"
													: "asc",
											})
										}
									>
										{sortLabels[sort]()}
									</DropdownMenuCheckboxItem>
								),
							)}
							<DropdownMenuSeparator />
							<DropdownMenuCheckboxItem
								checked={prefs.order === "asc"}
								onCheckedChange={() => setPrefs({ order: "asc" })}
							>
								{t("ui.canvas.files.asc")}
							</DropdownMenuCheckboxItem>
							<DropdownMenuCheckboxItem
								checked={prefs.order === "desc"}
								onCheckedChange={() => setPrefs({ order: "desc" })}
							>
								{t("ui.canvas.files.desc")}
							</DropdownMenuCheckboxItem>
							<DropdownMenuSeparator />
							<DropdownMenuCheckboxItem
								checked={prefs.group}
								onCheckedChange={(group) => setPrefs({ group })}
							>
								{t("ui.canvas.files.group")}
							</DropdownMenuCheckboxItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="outline"
								size="md"
								className={cn(prefs.kinds.length > 0 && "bg-accent-wash")}
								aria-label={`${t("ui.canvas.files.filter")}: ${prefs.kinds.map(kindLabel).join(", ") || t("ui.canvas.files.files")}`}
							>
								<Funnel aria-hidden="true" />
								{prefs.kinds.length
									? `${prefs.kinds.length}`
									: t("ui.canvas.files.filter")}
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{FILE_KIND_GROUPS.map((group) => (
								<DropdownMenuCheckboxItem
									key={group.id}
									checked={prefs.kinds.includes(group.id)}
									onCheckedChange={(checked) =>
										setPrefs({
											kinds: checked
												? [...prefs.kinds, group.id]
												: prefs.kinds.filter((kind) => kind !== group.id),
										})
									}
								>
									{kindLabel(group.id)}
								</DropdownMenuCheckboxItem>
							))}
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={() => setPrefs({ kinds: [] })}>
								{t("ui.canvas.files.reset")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
				<div
					className={cn(
						"flex min-h-7 items-center justify-between gap-2 text-meta text-ink-dim",
					)}
				>
					<span>
						{index.mode === "index" && index.state !== "ready" && !items.length
							? ""
							: narrowing
								? t("ui.canvas.files.narrowCount", {
										shown: formatNumber(
											narrowed.length + narrowedAttachments.length,
										),
										total: formatNumber(
											items.length + attachments.items.length,
										),
									})
								: attachments.state === "loading" && !items.length
									? t("ui.canvas.files.loading")
									: t("ui.canvas.files.count", {
											count: items.length + attachments.items.length,
										})}
						{index.mode === "index" &&
						(index.state === "loading" || index.state === "building") &&
						index.pendingTotal > 0
							? `${items.length ? " · " : ""}${t("ui.canvas.files.progress", { loaded: formatNumber(index.loadedRows), total: formatNumber(index.pendingTotal) })}`
							: ""}
						{index.state === "loading" && items.length > 0
							? ` · ${t("ui.canvas.files.loading")}`
							: index.state === "building"
								? ` · ${t("ui.canvas.files.building")}`
								: !index.statComplete
									? ` · ${t("ui.canvas.files.readingStats")}`
									: ""}
					</span>
					{cwd && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => void revealLocalTarget(cwd)}
						>
							<FolderOpen aria-hidden="true" />
							{t("ui.canvas.files.folder")}
						</Button>
					)}
				</div>
				{prefs.kinds.length > 0 && (
					<div
						className={cn("flex items-center gap-2 text-meta text-ink-muted")}
					>
						<span>{prefs.kinds.map(kindLabel).join(", ")}</span>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setPrefs({ kinds: [] })}
						>
							<X aria-hidden="true" />
							{t("ui.canvas.files.reset")}
						</Button>
					</div>
				)}
				{attachments.state === "error" && (
					<output
						title={t("ui.canvas.files.attachmentsErrorReason")}
						className={cn("text-body-sm text-ink-muted")}
					>
						{t("ui.canvas.files.attachmentsError")}
						<Button variant="ghost" size="sm" onClick={attachments.retry}>
							{t("ui.canvas.files.retry")}
						</Button>
					</output>
				)}
				{index.error && narrowed.length > 0 && (
					<output className={cn("text-body-sm text-ink-muted")}>
						{index.error}
						<Button variant="ghost" size="sm" onClick={index.refresh}>
							{index.state === "building"
								? t("ui.canvas.files.continue")
								: t("ui.canvas.files.retry")}
						</Button>
					</output>
				)}
			</div>
			<section
				ref={scroller}
				aria-label={t("ui.canvas.files.region")}
				data-tour-tag="files-scroller"
				/*
				 * A PLANE, NOT A GROUND. `surface` was this list's authored plane on the
				 * flat system (its rows' `row-hover`/`row-selected` steps are authored
				 * against it), but on glass a second role fill inside the pane is the
				 * opaque island the operator reported. The pane owns the alpha; the
				 * rows' state overlays are rebound to ink inside a covered pane, so the
				 * list needs no fill of its own (styles/index.css, window glass round 3).
				 */
				data-glass-plane="clear"
				className={cn("min-h-0 flex-1 overflow-auto bg-surface px-2 pb-2")}
				onScroll={readScroll}
				onKeyDown={(event) => {
					if (
						!event.defaultPrevented &&
						event.key === "Escape" &&
						(query || prefs.kinds.length)
					) {
						event.preventDefault();
						event.stopPropagation();
						setQuery("");
						setPrefs({ kinds: [] });
					}
				}}
				onPointerEnter={() => setEngaged(true)}
				onPointerLeave={() => {
					if (!scroller.current?.contains(document.activeElement))
						setEngaged(false);
				}}
				onFocusCapture={() => {
					rowHadFocus.current = true;
					setEngaged(true);
				}}
				onBlurCapture={(event) => {
					if (
						event.relatedTarget &&
						!event.currentTarget.contains(event.relatedTarget)
					) {
						rowHadFocus.current = false;
						setEngaged(false);
					}
				}}
			>
				{!narrowed.length && !narrowedAttachments.length ? (
					<div
						className={cn(
							"flex min-h-40 flex-col items-center justify-center gap-2 p-4 text-center",
						)}
					>
						<p className={cn("text-heading text-ink")}>
							{index.state === "error"
								? (index.error ?? t("ui.canvas.files.error"))
								: index.state === "unsupported"
									? (index.error ?? t("ui.canvas.files.remote"))
									: index.state === "loading" || attachments.state === "loading"
										? t("ui.canvas.files.loading")
										: index.state === "building"
											? t("ui.canvas.files.building")
											: narrowing
												? t("ui.canvas.files.noMatch")
												: t("ui.canvas.files.empty")}
						</p>
						{index.state === "ready" &&
							attachments.state !== "loading" &&
							!narrowing && (
								<p className={cn("max-w-80 text-body-sm text-ink-muted")}>
									{t("ui.canvas.files.emptyDetail")}
								</p>
							)}
						{index.error && (
							<Button variant="outline" size="sm" onClick={index.refresh}>
								{index.state === "building"
									? t("ui.canvas.files.continue")
									: t("ui.canvas.files.retry")}
							</Button>
						)}
						{narrowing && (
							<Button variant="outline" size="sm" onClick={clear}>
								{t("ui.canvas.files.clear")}
							</Button>
						)}
					</div>
				) : (
					sections.map((section) => {
						const indices = layout.bands
							.map((band, i) => (band.section.id === section.id ? i : -1))
							.filter((i) => i >= 0);
						const firstBand = layout.bands[indices[0]];
						const lastBand = layout.bands[indices.at(-1) ?? 0];
						const bodyHeight =
							lastBand.top +
							lastBand.height -
							firstBand.top -
							FINDER_HEADER_BAND;
						return (
							<section
								key={section.id}
								style={{ height: bodyHeight + FINDER_HEADER_BAND }}
							>
								<h3
									/*
									 * A BAND THAT ISOLATES, not a band that tints.
									 *
									 * This header is `position: sticky` INSIDE the scroller, so
									 * the rows scroll UNDER it: measured on the running app, the
									 * header's 32px band lies inside the scroller's own clip
									 * region, so every row that scrolls up passes through those
									 * 32 pixels. The plain band (`data-glass-plane="band"`) painted
									 * 5% ink over them, and a 5% wash over MOVING content does not
									 * hide it - the operator's frame shows a thumbnail's green
									 * filling the band and a file name colliding with the section
									 * label.
									 *
									 * The band that isolates gives this element its own
									 * compositing layer and blurs the content passing under it,
									 * with a tint drawn from the panel's own surface role so the
									 * header still reads as part of the glass the user chose
									 * rather than as a hole in it. The rule, and why the tint is
									 * the surface role and not ink, are in `styles/index.css`
									 * under `data-glass-plane="band-backdrop"`.
									 *
									 * OFF GLASS NOTHING CHANGES: `bg-surface` is opaque there, so
									 * the scroller's content never reached this header in the first
									 * place.
									 */
									data-glass-plane="band-backdrop"
									className={cn("sticky top-0 z-10 h-8 bg-surface")}
								>
									<button
										type="button"
										ref={(node) => {
											if (node) headerControls.current.set(section.id, node);
											else headerControls.current.delete(section.id);
										}}
										tabIndex={active === `header:${section.id}` ? 0 : -1}
										onFocus={() => setFocused(`header:${section.id}`)}
										onKeyDown={(event) => {
											if (
												(event.key === "ArrowRight" && !section.open) ||
												(event.key === "ArrowLeft" && section.open)
											) {
												event.preventDefault();
												toggle(section.id);
											} else if (
												event.key === "ArrowDown" ||
												event.key === "ArrowUp"
											) {
												event.preventDefault();
												if (
													event.key === "ArrowDown" &&
													section.open &&
													section.items.length
												)
													focusItem(section.items[0].row.document.id);
												else {
													const target =
														sections[
															sections.indexOf(section) +
																(event.key === "ArrowDown" ? 1 : -1)
														];
													if (target) {
														setFocused(`header:${target.id}`);
														headerControls.current.get(target.id)?.focus();
													}
												}
											}
										}}
										aria-expanded={section.open}
										aria-disabled={narrowing}
										onClick={() => toggle(section.id)}
										className={cn(
											"flex h-8 w-full items-center gap-2 rounded-sm px-2 text-start font-medium text-body-sm text-ink hover:bg-row-hover",
											narrowing && "cursor-default hover:bg-surface",
											section.id !== "Working files" &&
												!section.highlights &&
												sections.some(
													(entry) => entry.id === "Working files",
												) &&
												"ps-4",
										)}
									>
										{section.open ? (
											<ChevronDown size={14} aria-hidden="true" />
										) : (
											<ChevronRight
												size={14}
												aria-hidden="true"
												className="rtl:-scale-x-100"
											/>
										)}
										{sectionLabels[section.id]?.() ?? section.label}
										<span
											/*
											 * THE COUNT'S INK, and why it is a step STRONGER
											 * than it was.
											 *
											 * The count is `text-ink-muted` and not `text-ink-dim`
											 * because its ground is the section band, and the band
											 * is a ground whose colour is the content passing under
											 * it. Measured on the running app at the default 80% in
											 * the light theme, `inkDim` measured 3.57:1 against that
											 * band - below the app's 4.5 text floor
											 * (`scripts/contrast-contract.mjs`) - and 2.50:1 at the
											 * most transparent end (design round 1's D1, measured
											 * off the captured PNGs' glyph interiors).
											 *
											 * `inkMuted` is the register the app's own section
											 * headers already use for a count beside a label
											 * (`features/projects/components/team-section-header.tsx`:
											 * the label in `text-ink`, the count in the quieter
											 * `text-ink-muted` beside it), so this is the same
											 * grammar the rest of the app speaks.
											 *
											 * THE NUMBERS, and which ones are which. Two different
											 * measurements are easy to conflate here:
											 *
											 *   - THE MODEL, over every palette at the committed
											 *     floor: the tightest is 4.51:1 light and 4.52:1
											 *     dark, and the two default themes sit at 5.18:1
											 *     and 5.46:1. That is the guarantee, and it is what
											 *     `scripts/contrast-contract.mjs` asserts.
											 *   - THE FRAMES, on the seeded grid with a thumbnail
											 *     under the band: 6.78-7.86:1 dark and 6.29-8.26:1
											 *     light, across 80%, 100%, 0% and glass-off. That
											 *     is what the evidence directory records.
											 *
											 * An earlier version of this comment quoted 6.56 and
											 * 4.81, which reproduce at neither: they are a 0.87
											 * alpha applied to both schemes, and 4.81 is below
											 * what the shipped model actually measures. The
											 * numbers above are the ones to quote.
											 */
											className={cn("text-meta text-ink-muted")}
										>
											{formatNumber(
												section.items.length ||
													(section.id === "Working files"
														? narrowed.filter((item) => !item.highlighted)
																.length
														: 0),
											)}
										</span>
										{section.id === ATTACHMENTS_SECTION &&
											!attachments.complete && (
												/* A caption, never a control: this markup sits INSIDE the
												 * section's fold button, and a nested button is invalid
												 * HTML. The retry for a failed read is the banner below. */
												<span
													title={t("ui.canvas.files.attachmentsPartialReason")}
													className={cn("text-meta text-ink-dim")}
												>
													{t("ui.canvas.files.attachmentsPartial")}
												</span>
											)}
									</button>
								</h3>
								<ul
									data-tour-tag="files-grid"
									className={cn("relative")}
									style={{ height: bodyHeight }}
								>
									{indices
										.filter(
											(i) =>
												layout.bands[i].kind !== "header" && windowBands.has(i),
										)
										.map((i) => {
											const band = layout.bands[i];
											return (
												<li
													key={band.items[0].row.document.id}
													style={{
														position: "absolute",
														top: band.top - firstBand.top - FINDER_HEADER_BAND,
														height: band.height,
														left: 0,
														right: 0,
													}}
												>
													<div
														className={cn("grid gap-1")}
														style={{
															gridTemplateColumns: `repeat(${band.cols},minmax(0,1fr))`,
														}}
													>
														{band.items.map((item) => (
															<FinderEntry
																key={item.row.document.id}
																item={item}
																current={
																	selectedId === item.row.document.id ||
																	selectedId === item.row.document.path
																}
																band={band}
																tabIndex={
																	item.row.document.id === active ? 0 : -1
																}
																onFocus={() => setFocused(item.row.document.id)}
																buttonRef={(node) => {
																	if (node)
																		controls.current.set(
																			item.row.document.id,
																			node,
																		);
																	else
																		controls.current.delete(
																			item.row.document.id,
																		);
																}}
																onKeyDown={(event) => key(event, item)}
																onOpen={() => onOpen(item.row.document)}
																onExpand={() => {
																	lightboxOpener.current =
																		controls.current.get(
																			item.row.document.id,
																		) ?? null;
																	setLightbox(item.row.document.id);
																}}
																materialise={() =>
																	materialise(item.row.document)
																}
															/>
														))}
													</div>
												</li>
											);
										})}
								</ul>
							</section>
						);
					})
				)}
			</section>
			{index.mode === "fallback" && legacyScan?.stopped && (
				<Button variant="ghost" size="sm" onClick={legacyScan.resume}>
					{t("ui.canvas.files.earlier")}
				</Button>
			)}

			{selectedImage && (
				<ImageLightbox
					open
					src={lightboxSource}
					pending={!lightboxSource && !lightboxFailed}
					fallback={
						<span className={cn("text-body-sm text-ink-muted")}>
							{t("ui.canvas.files.unreadable")}
						</span>
					}
					label={selectedImage.row.name}
					onOpenChange={(open) => {
						if (!open) setLightbox(null);
					}}
					restoreFocusTo={lightboxOpener}
					group={{
						index: images.indexOf(selectedImage),
						count: images.length,
						onPrev: () =>
							setLightbox(
								images[
									(images.indexOf(selectedImage) + images.length - 1) %
										images.length
								].row.document.id,
							),
						onNext: () =>
							setLightbox(
								images[(images.indexOf(selectedImage) + 1) % images.length].row
									.document.id,
							),
					}}
				/>
			)}
		</div>
	);
}

function FinderEntry({
	item,
	current,
	band,
	tabIndex,
	onFocus,
	buttonRef,
	onKeyDown,
	onOpen,
	onExpand,
	materialise,
}: {
	item: FinderItem;
	current: boolean;
	band: FinderBand;
	tabIndex: number;
	onFocus: () => void;
	buttonRef: (node: HTMLButtonElement | null) => void;
	onKeyDown: (event: KeyboardEvent) => void;
	onOpen: () => void;
	onExpand: () => void;
	materialise: () => Promise<string>;
}) {
	useI18nLocale();
	const doc = item.row.document;
	const [nearRef, near] = useEverInView("200px");
	const thumb = useFinderThumbnail(
		doc,
		near && item.row.media === "image" && !item.row.missing,
	);
	const [menuOpen, setMenuOpen] = useState(false);
	const rowControl = useRef<HTMLButtonElement | null>(null);
	const tiled = band.kind === "tiles" || band.kind === "video";
	const height = tiled ? band.height - 32 : band.kind === "highlight" ? 40 : 28;
	const tooltip = doc.artifact
		? item.attachment
			? t("ui.canvas.files.attachmentTooltip", {
					name: doc.title,
					digest: doc.artifact.digest.slice(0, ARTIFACT_HEAD_LENGTH),
				})
			: artifactTooltip({ ...doc.artifact, title: doc.title })
		: doc.path;
	const sort = useUiPreferencesStore((state) => state.finderFiles.sort);
	const timestamp = sort === "created" ? item.created : item.modified;
	const dateMetric =
		timestamp === null
			? ""
			: formatDate(timestamp * 1000, { month: "short", day: "numeric" });
	const meta = item.attachment
		? item.attachment.note
		: item.row.missing
			? doc.artifact
				? t("ui.canvas.files.gone")
				: t("ui.canvas.files.missing")
			: sort === "modified" || sort === "created"
				? dateMetric
				: sort === "size"
					? (item.row.size ?? "")
					: doc.artifact
						? t("ui.canvas.files.sessionOnly")
						: (item.row.size ?? "");

	/*
	 * THE SOUND BAND'S ROW, WHICH IS NOT A BUTTON (sound phase). Every other
	 * band's entry is one `<button>` because the whole row is one action; a
	 * sound's row carries a PLAYER, and a button inside a button is invalid HTML
	 * - so here the row's NAME is the button (open is the same click every other
	 * band's row performs) and the player sits beside it, sharing the row's
	 * hover ground. Focus, keyboard and context-menu behaviour are the button
	 * band's, which is what keeps `controls`, the layout model and the arrow-key
	 * walk one implementation across all six band kinds.
	 */
	if (band.kind === "audio") {
		return (
			<div
				ref={nearRef}
				className={cn(
					"group relative min-w-0 rounded-sm px-1 py-0.5",
					current ? rowCurrent : "hover:bg-row-hover",
				)}
				data-tour-tag="file-row"
				data-file-id={doc.id}
				onContextMenu={(event) => {
					event.preventDefault();
					setMenuOpen(true);
				}}
			>
				<div className={cn("flex min-w-0 items-center gap-2 pe-8")}>
					<button
						type="button"
						ref={(node) => {
							rowControl.current = node;
							buttonRef(node);
						}}
						tabIndex={tabIndex}
						onFocus={onFocus}
						title={tooltip}
						onClick={onOpen}
						onKeyDown={(event) => {
							if (
								(event.shiftKey && event.key === "F10") ||
								event.key === "ContextMenu"
							) {
								event.preventDefault();
								setMenuOpen(true);
							} else onKeyDown(event);
						}}
						className={cn(
							"min-w-0 flex-1 truncate rounded-sm py-1 text-start text-body-sm",
							item.row.missing ? "text-ink-muted" : "text-ink",
						)}
					>
						{item.row.name}
					</button>
					<span
						title={
							timestamp === null ? undefined : formatDateTime(timestamp * 1000)
						}
						className={cn("shrink-0 text-meta text-ink-dim")}
					>
						{meta}
					</span>
				</div>
				<AudioDocumentPlayer doc={doc} label={item.row.name} />
				<div className={REVEAL} onKeyDown={(event) => event.stopPropagation()}>
					<ImageActionsMenu
						file={doc.path}
						tooltip={t(
							"ui.canvas.finder_files_view.ui_canvas_files_fileactions",
						)}
						label={doc.title}
						open={menuOpen}
						onOpenChange={setMenuOpen}
						onCloseAutoFocus={(event) => {
							event.preventDefault();
							rowControl.current?.focus({ preventScroll: true });
						}}
						triggerTabIndex={-1}
						mediaKind="audio"
						onShowInCanvas={
							viewerFor(doc.path, doc.type) === null ? undefined : onOpen
						}
						resolveBytes={() => finderOriginal(doc)}
						saveName={
							doc.artifact && !item.attachment
								? artifactFileName(doc.artifact)
								: undefined
						}
						resolvePath={
							doc.artifact && !item.row.missing ? materialise : undefined
						}
						missing={item.row.missing && !doc.artifact}
					/>
				</div>
			</div>
		);
	}

	return (
		<div
			ref={nearRef}
			className={cn(
				"group relative min-w-0 rounded-sm",
				current ? rowCurrent : "hover:bg-row-hover",
			)}
			data-tour-tag="file-row"
			data-file-id={doc.id}
			onContextMenu={(event) => {
				event.preventDefault();
				setMenuOpen(true);
			}}
		>
			<button
				type="button"
				ref={(node) => {
					rowControl.current = node;
					buttonRef(node);
				}}
				tabIndex={tabIndex}
				onFocus={onFocus}
				title={tooltip}
				onClick={tiled && item.row.media === "image" ? onExpand : onOpen}
				onKeyDown={(event) => {
					if (
						(event.shiftKey && event.key === "F10") ||
						event.key === "ContextMenu"
					) {
						event.preventDefault();
						setMenuOpen(true);
					} else onKeyDown(event);
				}}
				className={cn(
					"w-full min-w-0 rounded-sm p-1 text-start",
					!tiled && "flex items-center gap-2 pe-8",
					item.row.missing && "text-ink-muted",
				)}
				style={{ height: band.height - (tiled ? 4 : 0) }}
			>
				<span
					style={{ height, width: tiled ? "100%" : height }}
					className={cn(
						"flex shrink-0 items-center justify-center overflow-hidden rounded-sm bg-media-surface",
						tiled && "mb-1",
					)}
				>
					{thumb.state === "ready" && item.row.media === "image" ? (
						<img
							src={thumb.url}
							alt=""
							className={cn(
								"h-full w-full object-contain outline-1 -outline-offset-1 outline-hairline",
							)}
						/>
					) : doc.type === "video" ? (
						<span
							className={cn("flex flex-col items-center gap-1 text-ink-muted")}
						>
							<FileVideo aria-hidden="true" />
							{tiled && (
								<span className={cn("text-meta")}>
									{t("ui.canvas.files.play")}
								</span>
							)}
						</span>
					) : thumb.state === "loading" &&
						item.row.media === "image" &&
						!item.row.missing ? null : (
						<File size={16} aria-hidden="true" />
					)}
				</span>
				<span
					className={cn(
						"flex min-w-0 flex-1 flex-col",
						tiled ? "text-meta" : "text-body-sm",
					)}
				>
					<span
						className={cn(
							"flex min-w-0 gap-2",
							tiled && item.attachment
								? "flex-col gap-0"
								: "items-center justify-between",
						)}
					>
						<span
							className={cn(
								"min-w-0 flex-1 truncate",
								item.row.missing ? "text-ink-muted" : "text-ink",
							)}
						>
							{item.row.name}
						</span>
						{!tiled && item.row.showParent && item.row.parent && (
							<span
								className={cn(
									"min-w-0 shrink truncate text-mono-sm text-ink-dim",
								)}
							>
								{item.row.parent}
							</span>
						)}
						{
							<span
								title={
									timestamp === null
										? undefined
										: formatDateTime(timestamp * 1000)
								}
								className={cn(
									"text-meta text-ink-dim",
									tiled && item.attachment ? "min-w-0 truncate" : "shrink-0",
								)}
							>
								{tiled && item.attachment ? (
									<>
										<bdi>{item.attachment.size}</bdi>
										{item.attachment.when ? (
											<span aria-hidden="true"> · </span>
										) : null}
										<bdi>{item.attachment.when}</bdi>
									</>
								) : tiled && doc.artifact && !item.attachment ? (
									t("ui.canvas.files.inSession")
								) : (
									meta
								)}
							</span>
						}
					</span>
					{band.kind === "highlight" && item.why && (
						<span className={cn("line-clamp-2 text-meta text-ink-muted")}>
							{item.why}
						</span>
					)}
				</span>
			</button>
			<div className={REVEAL} onKeyDown={(event) => event.stopPropagation()}>
				{tiled && item.row.media === "image" && (
					<Tooltip content={`${t("ui.canvas.files.expand")}: ${doc.title}`}>
						<Button
							variant="ghost"
							size="icon-sm"
							tabIndex={-1}
							className={cn("bg-accent-wash")}
							aria-label={`${t("ui.canvas.files.expand")}: ${doc.title}`}
							onClick={onExpand}
						>
							<Maximize2 aria-hidden="true" />
						</Button>
					</Tooltip>
				)}
				{!(
					/*
					 * A gone attachment with no origin path (a pasted picture whose
					 * stored copy was pruned) has nothing any action could act on - not
					 * even a path to copy - so it carries no menu rather than a menu of
					 * dead entries. Its meta line already says it is gone.
					 */
					(
						item.attachment &&
						item.row.missing &&
						!PATH_SEPARATOR.test(doc.path)
					)
				) && (
					<ImageActionsMenu
						file={doc.path}
						tooltip={
							item.row.media === "image"
								? t("ui.canvas.finder_files_view.ui_canvas_files_imageactions")
								: t("ui.canvas.finder_files_view.ui_canvas_files_fileactions")
						}
						label={doc.title}
						open={menuOpen}
						onOpenChange={setMenuOpen}
						onCloseAutoFocus={(event) => {
							event.preventDefault();
							rowControl.current?.focus({ preventScroll: true });
						}}
						triggerTabIndex={-1}
						mediaKind={item.row.media === "image" ? "image" : "video"}
						onShowInCanvas={
							viewerFor(doc.path, doc.type) === null ? undefined : onOpen
						}
						onExpand={item.row.media === "image" ? onExpand : undefined}
						resolveBytes={() => finderOriginal(doc)}
						saveName={
							doc.artifact && !item.attachment
								? artifactFileName(doc.artifact)
								: undefined
						}
						resolvePath={
							doc.artifact && !item.row.missing ? materialise : undefined
						}
						missing={item.row.missing && !doc.artifact}
					/>
				)}
			</div>
		</div>
	);
}
