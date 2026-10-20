/**
 * The preview's per-kind viewers.
 *
 * WHAT IS REUSED AND WHAT IS NOT. The canvas viewers (`image-preview.tsx`,
 * `pdf-preview.tsx`, ...) are bound to a session's `CanvasDocument` and its
 * static-route path; a Library asset is addressed by an opaque asset id and may
 * be a digest-only artifact with no path at all. Reusing those components would
 * mean synthesising a path for rows that have none, which is exactly the
 * caller-path coupling the content route refuses. So this module keeps the same
 * primitives the canvas viewers draw (`<img>`, `<audio>`, `<video>`, an iframe
 * for PDF/HTML) and the same visual chrome, while the bytes come from the
 * asset-id route through the media relay.
 *
 * EVERY VIEWER IS READ-ONLY. The Library is a catalog, not the Canvas: editing
 * a document happens in the session that owns it, through the source-
 * conversation link. That is also why the spreadsheet view renders a table
 * instead of mounting ag-grid - an editable grid in a read-only surface would
 * offer writes the route cannot accept.
 */

import { probeLocalFile } from "@features/chat/components/canvas/file-freshness";
import { WysiwygMarkdownEditor } from "@features/chat/components/canvas/wysiwyg-markdown-editor";
import type { CanvasDocument } from "@features/chat/types/canvas";
import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { showErrorToast } from "@shared/utils/toast-manager";
import { Download, LoaderCircle, Maximize2 } from "lucide-react";
import type { FC } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import * as XLSX from "xlsx";
import type { DesktopLibraryAsset } from "../../../../../shared/desktop-control-contract";
import { useLibraryBytes, useObjectUrl } from "../hooks/use-library-queries";
import { saveAssetCopy } from "../library-download";
import { libraryMarkdownDocument } from "../library-markdown";
import { assetDisplayName } from "../library-model";
import { KindGlyph } from "./library-glyph";
import { LibraryMediaLightbox } from "./library-media-lightbox";
import { PptxViewer } from "./pptx-viewer";

const Loading: FC<{ label?: string }> = ({ label }) => (
	<div className="flex flex-1 items-center justify-center gap-2 py-10 text-body-sm text-ink-muted">
		<LoaderCircle
			size={16}
			aria-hidden="true"
			className="motion-safe:animate-spin"
		/>
		{label ?? t("ui.library.preview.loading")}
	</div>
);

const Failure: FC<{ detail: string; asset: DesktopLibraryAsset }> = ({
	detail,
	asset,
}) => {
	const [saving, setSaving] = useState(false);
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
			<KindGlyph kind={asset.kind} size={28} className="text-ink-dim" />
			<p className="text-body text-ink">
				{t("ui.library.preview.could_not_load")}
			</p>
			<p className="max-w-90 text-body-sm text-ink-muted">{detail}</p>
			<Button
				variant="secondary"
				size="sm"
				disabled={saving}
				onClick={() => {
					setSaving(true);
					void saveAssetCopy(asset)
						.catch((error: unknown) =>
							showErrorToast(
								error instanceof Error && error.message
									? error.message
									: t("ui.library.menu.save_failed"),
							),
						)
						.finally(() => setSaving(false));
				}}
			>
				<Download aria-hidden="true" />
				{t("ui.library.menu.download")}
			</Button>
		</div>
	);
};

const Unsupported: FC<{ asset: DesktopLibraryAsset }> = ({ asset }) => (
	<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
		<KindGlyph kind={asset.kind} size={28} className="text-ink-dim" />
		<p className="max-w-90 text-body text-ink">
			{t("ui.library.preview.unsupported", {
				kind: asset.kind,
			})}
		</p>
		<div className="flex items-center gap-2">
			{asset.ref.type === "path" && asset.ref.path ? (
				<Button
					variant="secondary"
					size="sm"
					onClick={() => {
						if (asset.ref.path) window.api.openFile(asset.ref.path);
					}}
				>
					{t("ui.library.preview.open_externally")}
				</Button>
			) : null}
			<Button
				variant="secondary"
				size="sm"
				onClick={() => void saveAssetCopy(asset)}
			>
				<Download aria-hidden="true" />
				{t("ui.library.menu.download")}
			</Button>
		</div>
	</div>
);

/**
 * How much of the clip's bottom edge the click target must leave to the player.
 *
 * Chromium draws the media control bar inside the element, 32 CSS pixels tall at
 * this app's scale — measured on the story fixture's 320x180 clip: the bar's top
 * edge sits 32px above the element's bottom, and a press inside that band reaches
 * the native play/scrubber controls while a press above it reaches the preview.
 * The number is stated once here rather than recomputed per render because it is
 * a property of the player, not of the asset.
 */
const VIDEO_CONTROL_BAND_PX = 32;

/**
 * Image, audio and video share one byte fetch and one media element.
 *
 * THE PICTURE AND THE CLIP OPEN THE FULL-SCREEN VIEWER. The preview's media was
 * inert: clicking the picture did nothing, and the only way to see the pixels
 * larger was the full-window details view, which is a different surface rather
 * than a bigger picture (operator item 7: "click the image or video in the
 * details view to see it full screen, without opening the full-screen details
 * view"). So the image is a button and the clip is covered by a click target
 * over its picture; both mount `LibraryMediaLightbox`, the shared
 * `ImageLightbox` over the listing's media rows, and neither touches the page's
 * selection route.
 *
 * THE VIDEO'S CONTROL BAND IS THE ONE LANE THE TARGET LEAVES ALONE, and that is
 * a measurement, not a preference: play/pause, the scrubber and volume live
 * INSIDE the element, so a target that covered its whole box would take those
 * presses before the player saw them. The target is sized from the CLIP's own box
 * (not the pane's, which is larger whenever the clip letterboxes) and stops
 * `VIDEO_CONTROL_BAND_PX` above its bottom edge; `ResizeObserver` keeps those
 * numbers true across a pane resize or the clip's aspect settling after
 * metadata. Measured on the story fixture: the band's presses hit-test to the
 * `<video>`, its native play button starts the clip, and a press above the band
 * opens the viewer. The expand control in the corner stays as the keyboard and
 * first-run affordance, painted above the target.
 */
const MediaViewer: FC<{
	asset: DesktopLibraryAsset;
	/**
	 * The listing's image and video rows, in display order, threaded from the
	 * page. The lightbox's set; omitted means this asset stands alone.
	 */
	mediaSiblings?: readonly DesktopLibraryAsset[];
}> = ({ asset, mediaSiblings }) => {
	const { bytes, mimeType, error, loading } = useLibraryBytes(
		asset.id,
		"content",
		true,
	);
	const source = useObjectUrl(bytes, mimeType || asset.ref.content_type);
	const imageTriggerRef = useRef<HTMLButtonElement>(null);
	const videoTriggerRef = useRef<HTMLButtonElement>(null);
	const videoPaneRef = useRef<HTMLDivElement>(null);
	const videoRef = useRef<HTMLVideoElement>(null);
	/*
	 * The clip's box inside its pane, for the click target. Null until the video
	 * has been measured; the target renders only then, so it is never painted at
	 * a guessed size (the first frame before metadata is a 0x0 box).
	 */
	const [videoSurface, setVideoSurface] = useState<{
		top: number;
		left: number;
		width: number;
		height: number;
	} | null>(null);
	/*
	 * Local to the viewer: the slide the lightbox shows is the overlay's state,
	 * not the page's selection. A strip tile press stays in the lightbox — the
	 * viewer must not move where the reader is — so the preview underneath keeps
	 * showing the asset the route selected.
	 */
	const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
	/*
	 * The set is the LISTING's media in display order, filtered to what the
	 * lightbox can show (`mediaKind` is image or video). If the selected asset
	 * is not in the loaded pages — a deep link into a filtered listing, or a
	 * detail row the cursor has since paged past — it stands alone rather than
	 * dropping into a group it is not a member of.
	 */
	const siblings = useMemo(() => {
		const media = (mediaSiblings ?? []).filter(
			(row) => row.kind === "image" || row.kind === "video",
		);
		return media.some((row) => row.id === asset.id) ? [...media] : [asset];
	}, [mediaSiblings, asset]);
	const position = Math.max(
		0,
		siblings.findIndex((row) => row.id === asset.id),
	);
	/*
	 * The accessible name is the asset's own name. A written-out "view full
	 * screen" sentence would be new English copy, which this repository prices at
	 * a translation tranche: `locale-parity` requires all seven shipped locales to
	 * carry every new key and `ledger-check` requires audited receipts for the
	 * rewritten source, so copy is not added in a wiring change.
	 */
	const fullScreenLabel = assetDisplayName(asset);
	/*
	 * MEASURE THE CLIP, NOT THE PANE. The pane is larger than a letterboxed clip,
	 * so a pane-sized target would either miss the picture or cover the native bar;
	 * the target's box is the video element's own rect relative to the pane, minus
	 * the control band at its bottom edge. `ResizeObserver` covers pane resizes
	 * and the aspect settling after metadata; jsdom has no observer, and there the
	 * geometry is not what the suite is testing, so the measurement is simply
	 * skipped.
	 */
	useEffect(() => {
		if (asset.kind !== "video" || !source) return;
		const pane = videoPaneRef.current;
		const video = videoRef.current;
		if (!pane || !video) return;
		const measure = () => {
			const paneBox = pane.getBoundingClientRect();
			const videoBox = video.getBoundingClientRect();
			const next = {
				top: videoBox.top - paneBox.top,
				left: videoBox.left - paneBox.left,
				width: videoBox.width,
				height: Math.max(0, videoBox.height - VIDEO_CONTROL_BAND_PX),
			};
			setVideoSurface((current) =>
				current &&
				current.top === next.top &&
				current.left === next.left &&
				current.width === next.width &&
				current.height === next.height
					? current
					: next,
			);
		};
		measure();
		video.addEventListener("loadedmetadata", measure);
		const observer =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(measure);
		observer?.observe(video);
		observer?.observe(pane);
		return () => {
			observer?.disconnect();
			video.removeEventListener("loadedmetadata", measure);
		};
	}, [asset.kind, source]);
	if (loading) return <Loading />;
	if (error || !source)
		return <Failure detail={error || "The bytes were empty."} asset={asset} />;
	/*
	 * ALWAYS MOUNTED, opened and closed through `open`. See
	 * `LibraryMediaLightboxProps.open`: unmounting the dialog from the close
	 * callback skips Radix's close-auto-focus and loses the focus return.
	 */
	const lightbox = (
		<LibraryMediaLightbox
			open={lightboxIndex !== null}
			siblings={siblings}
			index={lightboxIndex ?? position}
			onIndexChange={setLightboxIndex}
			onClose={() => setLightboxIndex(null)}
			/* The bytes this viewer already resolved, so opening costs no read. */
			resolved={{ assetId: asset.id, url: source }}
			restoreFocusTo={
				asset.kind === "video" ? videoTriggerRef : imageTriggerRef
			}
		/>
	);
	switch (asset.kind) {
		case "image":
			return (
				<>
					<button
						type="button"
						ref={imageTriggerRef}
						aria-label={fullScreenLabel}
						title={fullScreenLabel}
						onClick={() => setLightboxIndex(position)}
						data-library-media-trigger="image"
						className="flex h-full min-h-0 w-full min-w-0 flex-1 cursor-zoom-in items-center justify-center overflow-hidden bg-canvas p-3"
					>
						<img
							src={source}
							alt={asset.name || asset.derived_name}
							className="block h-auto max-h-full w-auto max-w-full object-contain"
						/>
					</button>
					{lightbox}
				</>
			);
		case "audio":
			return (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
					<KindGlyph kind="audio" size={32} className="text-ink-dim" />
					<audio src={source} controls className="w-full max-w-100">
						<track kind="captions" />
					</audio>
				</div>
			);
		default:
			return (
				<>
					<div
						ref={videoPaneRef}
						className="relative flex h-full min-h-0 w-full min-w-0 flex-1 items-center justify-center overflow-hidden bg-canvas p-3"
					>
						<video
							ref={videoRef}
							src={source}
							controls
							className="max-h-full max-w-full rounded-sm"
						>
							<track kind="captions" />
						</video>
						{/*
						 * The clip's click target. `bg-transparent` and a pointer cursor, sized
						 * to the picture above the native control band; out of the tab order
						 * because the corner expand control is the keyboard affordance and two
						 * identically named stops would be noise, not access.
						 */}
						{videoSurface ? (
							<button
								type="button"
								tabIndex={-1}
								aria-label={fullScreenLabel}
								title={fullScreenLabel}
								onClick={() => setLightboxIndex(position)}
								data-library-media-trigger="video-surface"
								className="absolute z-[1] cursor-zoom-in bg-transparent"
								style={{
									top: videoSurface.top,
									left: videoSurface.left,
									width: videoSurface.width,
									height: videoSurface.height,
								}}
							/>
						) : null}
						<Button
							variant="ghost"
							size="icon-sm"
							ref={videoTriggerRef}
							aria-label={fullScreenLabel}
							title={fullScreenLabel}
							onClick={() => setLightboxIndex(position)}
							data-library-media-trigger="video"
							className="absolute top-2 right-2 z-[2]"
						>
							<Maximize2 aria-hidden="true" />
						</Button>
					</div>
					{lightbox}
				</>
			);
	}
};

/** PDF and HTML: an iframe over the asset's own bytes. */
const FrameViewer: FC<{ asset: DesktopLibraryAsset }> = ({ asset }) => {
	const { bytes, mimeType, error, loading } = useLibraryBytes(
		asset.id,
		"content",
		true,
	);
	const source = useObjectUrl(bytes, mimeType || asset.ref.content_type);
	if (loading) return <Loading />;
	if (error || !source)
		return <Failure detail={error || "The bytes were empty."} asset={asset} />;
	return (
		<iframe
			title={asset.name || asset.derived_name}
			src={source}
			className="size-full flex-1 border-0 bg-surface"
			/* HTML from a catalog is untrusted content: scripts run in the frame
			   but get no same-origin access to the app, and no navigation. */
			sandbox={asset.kind === "html" ? "allow-scripts" : undefined}
		/>
	);
};

/**
 * A markdown asset in the preview.
 *
 * A REAL LOCAL PATH MOUNTS THE SHARED WYSIWYG, not a second editor: the canvas
 * editor already owns markdown save/autosave through `document-buffers`, and a
 * Library copy would be two writers of one file. The document id is
 * `library:<asset id>`, so its buffer cannot collide with a Canvas document
 * that happens to share the path; `readMtimeMs` is the indexed modification
 * time, which is the autosave baseline the buffer owner compares against (an
 * absent baseline would make every autosave read the file as having moved).
 *
 * DIGEST-ONLY OR NON-LOCAL MARKDOWN STAYS READ-ONLY, with the reason stated:
 * there is no writable path to hand the buffer owner, and pretending otherwise
 * would offer edits that cannot be saved.
 */
const MarkdownAssetView: FC<{
	asset: DesktopLibraryAsset;
	text: string;
}> = ({ asset, text }) => {
	const local =
		asset.ref.type === "path" && Boolean(asset.ref.path) && asset.exists;
	const path = asset.ref.path;
	const [probe, setProbe] = useState<
		{ state: "pending" } | { state: "done"; mtimeMs: number | null }
	>({ state: "pending" });
	useEffect(() => {
		if (!local || !path) return;
		let cancelled = false;
		void probeLocalFile(path).then((answer) => {
			if (!cancelled) {
				setProbe({ state: "done", mtimeMs: answer?.mtimeMs ?? null });
			}
		});
		return () => {
			cancelled = true;
		};
	}, [local, path]);
	const document = useMemo<CanvasDocument | null>(() => {
		if (!local || !path || probe.state !== "done") return null;
		return libraryMarkdownDocument(asset, text, probe.mtimeMs);
	}, [asset, local, path, probe, text]);
	if (local && probe.state === "pending") {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center">
				<Loading label={t("ui.library.preview.checking_file")} />
			</div>
		);
	}
	if (document) {
		return (
			<div
				data-lo-pane-edge-cues
				className="min-h-0 flex-1 overflow-y-auto bg-canvas"
			>
				{/* The centered reading column is Library chrome; the shared editor
				    inside it is untouched, so Canvas keeps the same component and
				    save semantics. */}
				<div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-6 py-8">
					{/*
					 * THE BODY OWNS THE TITLE. A markdown document's first block is
					 * usually its H1, so a second heading here would repeat it. This
					 * line says where the file lives; the editor below renders the
					 * document's own title in its own rhythm.
					 */}
					<p className="text-meta text-ink-dim">
						{t("ui.library.preview.breadcrumb", { name: document.title })}
					</p>
					<WysiwygMarkdownEditor document={document} />
				</div>
			</div>
		);
	}
	return (
		<div data-lo-pane-edge-cues className="min-h-0 flex-1 overflow-y-auto p-5">
			<div className="mx-auto max-w-[720px]">
				<p className="mb-4 text-meta text-ink-muted">
					{t("ui.library.preview.read_only_markdown")}
				</p>
				<div className="prose-lo max-w-none text-body text-ink">
					<ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
				</div>
			</div>
		</div>
	);
};

/** Markdown, plain text and code, decoded from the content bytes. */ /** Markdown, plain text and code, decoded from the content bytes. */
const TextViewer: FC<{ asset: DesktopLibraryAsset }> = ({ asset }) => {
	const { bytes, error, loading } = useLibraryBytes(asset.id, "content", true);
	if (loading) return <Loading />;
	if (error || !bytes)
		return <Failure detail={error || "The bytes were empty."} asset={asset} />;
	const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
	if (asset.kind === "markdown") {
		return <MarkdownAssetView asset={asset} text={text} />;
	}
	return (
		<pre
			data-lo-pane-edge-cues
			className="min-h-0 flex-1 overflow-auto p-4 font-mono text-mono-sm whitespace-pre-wrap break-words text-ink"
		>
			{text}
		</pre>
	);
};

/** Spreadsheets: a read-only table from the first sheet (CSV/XLSX/ODS). */
const SpreadsheetViewer: FC<{ asset: DesktopLibraryAsset }> = ({ asset }) => {
	const { bytes, error, loading } = useLibraryBytes(asset.id, "content", true);
	if (loading) return <Loading />;
	if (error || !bytes)
		return <Failure detail={error || "The bytes were empty."} asset={asset} />;
	return <SpreadsheetTable asset={asset} bytes={bytes} />;
};

const MAX_ROWS = 200;
const MAX_COLS = 40;

const SpreadsheetTable: FC<{
	asset: DesktopLibraryAsset;
	bytes: Uint8Array;
}> = ({ asset, bytes }) => {
	// `xlsx` is already a dependency for the canvas spreadsheet viewer, and it
	// reads CSV/TSV/ODS/XLSX from bytes with no path.
	const sheets = (() => {
		try {
			const workbook = XLSX.read(bytes, { type: "array" });
			const first = workbook.SheetNames[0];
			if (!first) return null;
			const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[first], {
				header: 1,
				raw: false,
				defval: "",
			});
			return { name: first, rows: rows as unknown[][] };
		} catch {
			return null;
		}
	})();
	if (!sheets)
		return (
			<Failure
				detail={t("ui.library.preview.sheet_unreadable")}
				asset={asset}
			/>
		);
	const rows = sheets.rows.slice(0, MAX_ROWS);
	const truncated = sheets.rows.length > MAX_ROWS;
	return (
		<div data-lo-pane-edge-cues className="min-h-0 flex-1 overflow-auto p-2">
			<table className="w-full border-collapse text-meta">
				<thead>
					<tr>
						<th
							/*
							 * THE LIBRARY'S COLUMN STRIP IS NOT A BAND, and it must
							 * not be turned into one.
							 *
							 * The Files tab's section headers were a 5% ink wash
							 * over the rows scrolling beneath them, so a file name
							 * read through the `Images 86` label. This header was
							 * never that: it carries `bg-sunken`, an OPAQUE role fill
							 * with no glass opt-in, so the sheet's rows are hidden
							 * behind it outright. Measured on the running app, the
							 * pre-change paint shows no row content through the
							 * strip at all; a translucent band here would show
							 * `row-008` under the `A` column label - text over
							 * text, which is the seam the glass model says a
							 * translucent sticky header creates.
							 *
							 * So the Library keeps its own answer, and the shared
							 * plane (`data-glass-plane="band-backdrop"`) is for the
							 * bands that actually need isolating. The two families
							 * are different cases, and the census measured them
							 * as such.
							 */
							className="sticky top-0 bg-sunken px-2 py-1 text-left text-ink-muted"
						>
							#
						</th>
						{(rows[0] ?? []).slice(0, MAX_COLS).map((_, index) => (
							<th
								// biome-ignore lint/suspicious/noArrayIndexKey: a column is its index.
								key={index}
								className="sticky top-0 border-b border-hairline bg-sunken px-2 py-1 text-left font-medium text-ink-muted"
							>
								{String.fromCharCode(65 + (index % 26))}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, rowIndex) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: a row is its index.
						<tr key={rowIndex} className="odd:bg-canvas">
							<td className="px-2 py-1 text-right tabular-nums text-ink-dim">
								{rowIndex + 1}
							</td>
							{row.slice(0, MAX_COLS).map((cell, cellIndex) => (
								<td
									// biome-ignore lint/suspicious/noArrayIndexKey: a cell is its column index.
									key={cellIndex}
									className="max-w-60 truncate border-b border-hairline px-2 py-1 font-mono text-ink"
								>
									{String(cell ?? "")}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
			{truncated && (
				<p className="px-2 py-2 text-meta text-ink-dim">
					{t("ui.library.preview.sheet_truncated")}
				</p>
			)}
			<p className="px-2 py-2 text-meta text-ink-dim">
				{t("ui.library.preview.sheet_name", { name: sheets.name })}
			</p>
		</div>
	);
};

/** The dispatcher, so the preview pane knows one component. */
export const LibraryViewer: FC<{
	asset: DesktopLibraryAsset;
	dense?: boolean;
	/** The listing's media rows, in display order: the lightbox's set. */
	mediaSiblings?: readonly DesktopLibraryAsset[];
}> = ({ asset, dense = false, mediaSiblings }) => {
	if (asset.kind === "pptx") {
		return <PptxPreview asset={asset} dense={dense} />;
	}
	if (
		asset.kind === "image" ||
		asset.kind === "audio" ||
		asset.kind === "video"
	)
		return <MediaViewer asset={asset} mediaSiblings={mediaSiblings} />;
	if (asset.kind === "pdf" || asset.kind === "html")
		return <FrameViewer asset={asset} />;
	if (
		asset.kind === "markdown" ||
		asset.kind === "text" ||
		asset.kind === "code"
	)
		return <TextViewer asset={asset} />;
	if (asset.kind === "spreadsheet") return <SpreadsheetViewer asset={asset} />;
	if (asset.kind === "docx") return <Unsupported asset={asset} />;
	return <Unsupported asset={asset} />;
};

/** PPTX needs its bytes before the viewer can exist; this owns that fetch. */
const PptxPreview: FC<{ asset: DesktopLibraryAsset; dense?: boolean }> = ({
	asset,
	dense = false,
}) => {
	const { bytes, error, loading } = useLibraryBytes(asset.id, "content", true);
	if (loading) return <Loading label={t("ui.library.preview.pptx_opening")} />;
	if (error || !bytes)
		return <Failure detail={error || "The bytes were empty."} asset={asset} />;
	return <PptxViewer asset={asset} bytes={bytes} dense={dense} />;
};
