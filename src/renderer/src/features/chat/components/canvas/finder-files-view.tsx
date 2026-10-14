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
import { formatDate, formatDateTime } from "../../../../../../i18n/format";
import type { FileIndexState } from "../../canonical/use-session-files";
import type { CanvasDocument } from "../../types/canvas";
import {
	artifactFileName,
	artifactTooltip,
} from "../../utils/artifact-identity";
import { revealLocalTarget } from "../../utils/link-open";
import { viewerFor } from "../../utils/viewer-routing";
import { ImageActionsMenu } from "../image-actions-menu";
import { FILE_KIND_GROUPS, filterAndSearchRows } from "./file-rows";
import {
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
	Documents: () => t("ui.canvas.files.documents"),
	Spreadsheets: () => t("ui.canvas.files.spreadsheets"),
	Other: () => t("ui.canvas.files.other"),
	Files: () => t("ui.canvas.files.files"),
};
const REVEAL =
	"pointer-events-none absolute top-1 right-1 flex gap-1 opacity-0 transition-opacity duration-fast ease-out-quart group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100";

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
}: Props) {
	const selectedId = useCanvasStore(
		(state) => state.conversations[conversationId]?.selectedTabId,
	);
	const [settledItems, setSettledItems] = useState(items);
	const [engaged, setEngaged] = useState(false);

	const prefs = useUiPreferencesStore((state) => state.finderFiles);
	const setPrefs = useUiPreferencesStore((state) => state.setFinderFiles);
	const [query, setQuery] = useState("");
	const [closed, setClosed] = useState(new Set<string>());
	const [focused, setFocused] = useState<string | null>(null);
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
		} else if (!engaged && lightbox === null) setSettledItems(items);
	}, [items, engaged, lightbox, index.localReadAllowed]);
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
	const sections = useMemo(
		() => finderSections(narrowed, prefs, narrowing, closed),
		[narrowed, prefs, narrowing, closed],
	);
	const layout = useMemo(
		() => layoutFinder(sections, viewport.width, prefs.group),
		[sections, viewport.width, prefs.group],
	);
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
	const images = useMemo(
		() => narrowed.filter((item) => item.row.media === "image"),
		[narrowed],
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
			if (band.top < node.scrollTop) node.scrollTop = band.top;
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
				if (fold(candidate.row.name).startsWith(fold(text))) {
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
		setClosed((old) => {
			const next = new Set(old);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
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
						placeholder={t("ui.canvas.files.search")}
						aria-label={t("ui.canvas.files.search")}
						className={cn("min-w-0 flex-1")}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (
								event.key === "ArrowDown" ||
								(event.key === "Escape" && !query)
							) {
								event.preventDefault();
								if (first) focusItem(first);
							} else if (event.key === "Escape") {
								setQuery("");
							}
						}}
					/>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="outline"
								size="sm"
								aria-label={`Sort: ${sortLabels[prefs.sort]()}, ${prefs.order}`}
							>
								<ArrowUpDown aria-hidden="true" />
								<span className="hidden @min-[340px]/fileslist:inline">
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
								size="sm"
								className={cn(prefs.kinds.length > 0 && "bg-accent-wash")}
								aria-label={`Filter: ${prefs.kinds.join(", ") || "All types"}`}
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
									{group.id === "video"
										? t("ui.canvas.files.videos")
										: group.label}
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
						{narrowing
							? t("ui.canvas.files.narrowCount", {
									shown: String(narrowed.length),
									total: String(items.length),
								})
							: t("ui.canvas.files.count", {
									count: index.mode === "index" ? index.total : items.length,
								})}
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
						<span>{prefs.kinds.join(", ")}</span>
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
				{index.error && (
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
				className={cn("min-h-0 flex-1 overflow-auto bg-surface p-2")}
				onScroll={readScroll}
				onPointerEnter={() => setEngaged(true)}
				onPointerLeave={() => {
					if (!scroller.current?.contains(document.activeElement))
						setEngaged(false);
				}}
				onFocusCapture={() => setEngaged(true)}
				onBlurCapture={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget))
						setEngaged(false);
				}}
			>
				{!narrowed.length ? (
					<div
						className={cn(
							"flex min-h-40 flex-col items-center justify-center gap-2 p-4 text-center",
						)}
					>
						<p className={cn("text-heading text-ink")}>
							{index.state === "error"
								? t("ui.canvas.files.error")
								: index.state === "unsupported"
									? t("ui.canvas.files.remote")
									: index.state === "loading"
										? t("ui.canvas.files.loading")
										: index.state === "building"
											? t("ui.canvas.files.building")
											: narrowing
												? t("ui.canvas.files.noMatch")
												: t("ui.canvas.files.empty")}
						</p>
						<p className={cn("max-w-80 text-body-sm text-ink-muted")}>
							{t("ui.canvas.files.emptyDetail")}
						</p>
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
							lastBand.top + lastBand.height - firstBand.top - 32;
						return (
							<section key={section.id} style={{ height: bodyHeight + 32 }}>
								<h3 className={cn("sticky top-0 z-10 h-8 bg-surface")}>
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
										aria-disabled={section.id === "Working files" && narrowing}
										onClick={() => toggle(section.id)}
										className={cn(
											"flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left font-medium text-body-sm text-ink hover:bg-row-hover",
										)}
									>
										{section.open ? (
											<ChevronDown size={14} aria-hidden="true" />
										) : (
											<ChevronRight size={14} aria-hidden="true" />
										)}
										{sectionLabels[section.id]?.() ?? section.label}
										<span className={cn("text-meta text-ink-dim")}>
											{section.items.length ||
												(section.id === "Working files"
													? narrowed.filter((item) => !item.highlighted).length
													: 0)}
										</span>
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
														top: band.top - firstBand.top - 32,
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
					Search earlier messages
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
	const doc = item.row.document;
	const [nearRef, near] = useEverInView("200px");
	const thumb = useFinderThumbnail(
		doc,
		near && item.row.media === "image" && !item.row.missing,
	);
	const [menuOpen, setMenuOpen] = useState(false);
	const tiled = band.kind === "tiles" || band.kind === "video";
	const height = tiled ? band.height - 32 : band.kind === "highlight" ? 40 : 28;
	const tooltip = doc.artifact
		? artifactTooltip({ ...doc.artifact, title: doc.title })
		: doc.path;
	const sort = useUiPreferencesStore((state) => state.finderFiles.sort);
	const timestamp = sort === "created" ? item.created : item.modified;
	const dateMetric =
		timestamp === null
			? ""
			: formatDate(timestamp * 1000, { month: "short", day: "numeric" });
	const meta = item.row.missing
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
				ref={buttonRef}
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
					"w-full min-w-0 rounded-sm p-1 text-left",
					!tiled && "flex items-center gap-2 pr-8",
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
						className={cn("flex min-w-0 items-center justify-between gap-2")}
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
								className={cn("shrink-0 text-meta text-ink-dim")}
							>
								{tiled && doc.artifact ? t("ui.canvas.files.inSession") : meta}
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
				<ImageActionsMenu
					file={doc.path}
					tooltip={
						item.row.media === "image" ? "Image actions" : "File actions"
					}
					label={doc.title}
					open={menuOpen}
					onOpenChange={setMenuOpen}
					triggerTabIndex={-1}
					mediaKind={item.row.media === "image" ? "image" : "video"}
					onShowInCanvas={
						viewerFor(doc.path, doc.type) === null ? undefined : onOpen
					}
					onExpand={item.row.media === "image" ? onExpand : undefined}
					resolveBytes={() => finderOriginal(doc)}
					saveName={doc.artifact ? artifactFileName(doc.artifact) : undefined}
					resolvePath={
						doc.artifact && !item.row.missing ? materialise : undefined
					}
					missing={item.row.missing && !doc.artifact}
				/>
			</div>
		</div>
	);
}
