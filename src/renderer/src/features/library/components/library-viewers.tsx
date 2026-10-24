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

import { SoundPlayer } from "@features/chat/canonical/sound-player";
import { probeLocalFile } from "@features/chat/components/canvas/file-freshness";
import { WysiwygMarkdownEditor } from "@features/chat/components/canvas/wysiwyg-markdown-editor";
import type { CanvasDocument } from "@features/chat/types/canvas";
import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { showErrorToast } from "@shared/utils/toast-manager";
import { Download, LoaderCircle, Maximize2 } from "lucide-react";
import type { FC } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import * as XLSX from "xlsx";
import type { DesktopLibraryAsset } from "../../../../../shared/desktop-control-contract";
import { isPathBacked } from "../hooks/use-library-file-watch";
import {
	useLibraryBytes,
	useLibraryWaveform,
	useObjectUrl,
} from "../hooks/use-library-queries";
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
 * Chromium draws the media control panel INSIDE the element, and at this app's
 * preview size (the story fixture's 320x180 clip) it is two rows: the scrubber
 * sits ~21 CSS pixels above the element's bottom edge and the play/pause row's
 * glyph centre ~48px above it, inside a panel that reaches ~64px up. A press at
 * the visible play icon's centre must reach the player - a 32px band left the
 * icon under the target, so pressing it opened the viewer instead of playing
 * (QA round 2, Q5). The band is the panel's full height plus the few pixels of
 * its own padding, so every native control row belongs to the player and the
 * picture above the band still opens the viewer.
 *
 * The number is stated once here rather than recomputed per render because it
 * is a property of the player, not of the asset. Measured at the fixture's
 * 320x180 and re-measured with the element stretched to 800x450, the panel
 * stays around 64px tall; it shrinks only for very small elements (200x112 put
 * the play row about 30px up), where this band is conservative rather than
 * short — the picture above it still takes the press. Re-measure it if Chromium
 * changes its media controls; the story's play asserts a point in the panel's
 * middle and a point in the picture.
 */
export const VIDEO_CONTROL_BAND_PX = 72;

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
 * INSIDE the element, so a target that covered their rows would take those
 * presses before the player saw them. The target is sized from the CLIP's own
 * box (not the pane's, which is larger whenever the clip letterboxes) and stops
 * `VIDEO_CONTROL_BAND_PX` above its bottom edge - the measured full height of
 * the native panel, not just the scrubber row (QA round 2, Q5); `ResizeObserver`
 * keeps those numbers true across a pane resize or the clip's aspect settling
 * after metadata. Measured on the story fixture: a press on the visible play
 * icon's centre starts the clip, a press on the scrubber seeks, and a press on
 * the picture above the band opens the viewer. The expand control in the corner
 * stays as the keyboard and first-run affordance, painted above the target.
 */
/**
 * The asset's bytes, from the LIVE PATH when it has one.
 *
 * WHY THE PATH AND NOT THE CONTENT ROUTE. A path-backed asset is a file on this
 * machine, and the Library is a window onto it, not a copy: an agent that just
 * rewrote the file must appear in the preview. The content route answers from
 * the index's digest, which cannot see that write. Reading the path means the
 * viewer's own bytes and the freshness probe are looking at the same file.
 *
 * `revision` is the probe's own key: it moves when the mtime moves, and this
 * hook re-reads under it. A digest-only asset has no path to read and keeps the
 * library's bytes unchanged.
 */
function useAssetContent(asset: DesktopLibraryAsset, revision: number) {
	const path = isPathBacked(asset) ? asset.ref.path : null;
	/*
	 * Both hooks are called unconditionally; the route read is simply disabled
	 * for a path-backed row, which is what keeps a single call order across the
	 * asset switch (a conditional hook would be a remount of the whole viewer).
	 */
	/*
	 * THE ROUTED READ IS THE FALLBACK, NOT THE OLD PATH. The bridge refuses a file
	 * over its own byte cap and can fail on a permission or a broken mount; the
	 * library route can still answer from the digest, so a viewer that used to
	 * load must not turn into a failure because the path read was tried first.
	 * The route read is enabled from the start when there is no path, and from the
	 * moment the path read fails.
	 */
	const [pathFailed, setPathFailed] = useState(false);
	const routed = useLibraryBytes(asset.id, "content", !path || pathFailed);
	const [fromPath, setFromPath] = useState<{
		bytes: Uint8Array | null;
		mimeType: string;
		error: string | null;
		loading: boolean;
	}>({ bytes: null, mimeType: "", error: null, loading: Boolean(path) });
	const contentType = asset.ref.content_type;
	// biome-ignore lint/correctness/useExhaustiveDependencies: revision is the re-read trigger, not a value the body reads.
	useEffect(() => {
		if (!path) return;
		if (!window.api?.readFileBytes) {
			// No bridge is the same answer as a failed read: take the routed bytes
			// rather than a failure the route could have avoided.
			setPathFailed(true);
			setFromPath({
				bytes: null,
				mimeType: "",
				error: t("ui.library.preview.could_not_load"),
				loading: false,
			});
			return;
		}
		let cancelled = false;
		// A new revision (or a new path) gets the live read another chance.
		setPathFailed(false);
		setFromPath((previous) => ({ ...previous, loading: true }));
		void window.api.readFileBytes(path).then((answer) => {
			if (cancelled) return;
			if (!answer.success) setPathFailed(true);
			setFromPath(
				answer.success
					? {
							bytes: answer.data,
							mimeType: contentType || "",
							error: null,
							loading: false,
						}
					: {
							bytes: null,
							mimeType: "",
							error: answer.error,
							loading: false,
						},
			);
		});
		return () => {
			cancelled = true;
		};
	}, [path, revision, contentType]);
	return path && !pathFailed ? fromPath : routed;
}

const MediaViewer: FC<{
	asset: DesktopLibraryAsset;
	/**
	 * The listing's image and video rows, in display order, threaded from the
	 * page. The lightbox's set; omitted means this asset stands alone.
	 */
	mediaSiblings?: readonly DesktopLibraryAsset[];
	/** The freshness probe's key; see `useAssetContent`. */
	revision: number;
	/** Full-view mode: audio uses the width it is given. */
	expanded: boolean;
}> = ({ asset, mediaSiblings, revision, expanded }) => {
	const { bytes, mimeType, error, loading } = useAssetContent(asset, revision);
	const source = useObjectUrl(bytes, mimeType || asset.ref.content_type);
	/*
	 * THE DRAWER'S AUDIO IS THE SHARED PLAYER, not a native control. The same
	 * asset id is the owner id the grid card uses, so the card and the drawer
	 * are one playback slot: pressing either moves the one you can see, and the
	 * drawer never mounts an `<audio controls>` that would be a second transport
	 * with its own clock, its own position and its own idea of what is playing.
	 * The peaks come from the same asset-scoped sidecar the card reads (one
	 * cached request per id, see `useLibraryWaveform`).
	 */
	const peaks = useLibraryWaveform(asset.id, asset.kind === "audio");
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
			const height = Math.max(0, videoBox.height - VIDEO_CONTROL_BAND_PX);
			/*
			 * NOTHING IS PUBLISHED UNTIL THE CLIP HAS A BOX (UX round 1, U1).
			 * Before `loadedmetadata` arrives the element can measure zero tall,
			 * and a zero-height target cannot be hit: the story's centre press
			 * fell through to the player and the promise "a press on the picture
			 * opens the viewer" was false for the first frames of every clip. The
			 * residual is stated rather than hidden: until the clip has a frame
			 * there is no target over the picture, and the corner expand control
			 * (which needs no geometry) is the affordance in that window.
			 */
			if (height <= 0 || videoBox.width <= 0) {
				setVideoSurface((current) => (current === null ? current : null));
				return;
			}
			const next = {
				top: videoBox.top - paneBox.top,
				left: videoBox.left - paneBox.left,
				width: videoBox.width,
				height,
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
		/*
		 * `loadedmetadata` is the aspect settling, `loadeddata`/`canplay` the
		 * first decoded frame, and the window listener covers a pane resize on
		 * hosts without `ResizeObserver`; the observer below covers the same
		 * ground where it exists.
		 */
		video.addEventListener("loadedmetadata", measure);
		video.addEventListener("loadeddata", measure);
		video.addEventListener("canplay", measure);
		window.addEventListener("resize", measure);
		const observer =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(measure);
		observer?.observe(video);
		observer?.observe(pane);
		return () => {
			observer?.disconnect();
			video.removeEventListener("loadedmetadata", measure);
			video.removeEventListener("loadeddata", measure);
			video.removeEventListener("canplay", measure);
			window.removeEventListener("resize", measure);
		};
	}, [asset.kind, source]);
	if (loading) return <Loading />;
	if (error || !source)
		return (
			<Failure
				detail={error || t("ui.library.errors.empty_bytes")}
				asset={asset}
			/>
		);
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
				<div className="flex w-full max-w-100 flex-1 flex-col items-center justify-center gap-3 p-6">
					<KindGlyph kind="audio" size={32} className="text-ink-dim" />
					{/* The shared player in both drawer widths; main's expanded
					 * viewer keeps the wider box, the docked one stays at max-w-100. */}
					<SoundPlayer
						variant="full"
						ownerId={`sound:library:${asset.id}`}
						src={source}
						label={assetDisplayName(asset)}
						peaks={peaks}
						durationHint={asset.duration_s}
						className={expanded ? undefined : "max-w-100"}
					/>
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
						 * identically named stops would be noise, not access. `aria-hidden` for
						 * the same reason (agent review round 1, N2 / UX U2): it is a pointer
						 * surface for the same action, so it must not appear in the
						 * accessibility tree as a second, identically named button. The
						 * expand control keeps the name.
						 */}
						{videoSurface ? (
							<button
								type="button"
								tabIndex={-1}
								aria-hidden="true"
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
							className="absolute top-2 end-2 z-[2]"
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
const FrameViewer: FC<{ asset: DesktopLibraryAsset; revision: number }> = ({
	asset,
	revision,
}) => {
	const { bytes, mimeType, error, loading } = useAssetContent(asset, revision);
	const source = useObjectUrl(bytes, mimeType || asset.ref.content_type);
	if (loading) return <Loading />;
	if (error || !source)
		return (
			<Failure
				detail={error || t("ui.library.errors.empty_bytes")}
				asset={asset}
			/>
		);
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
	/** Full-view mode: the editor uses the width, not a reading column. */
	expanded: boolean;
	/** The freshness probe's key; a moved mtime rebuilds the document. */
	revision: number;
	/** The watch's mtime, once it has answered. */
	mtimeMs: number | null;
}> = ({ asset, text, expanded, revision, mtimeMs }) => {
	const local =
		asset.ref.type === "path" && Boolean(asset.ref.path) && asset.exists;
	const path = asset.ref.path;
	const [probe, setProbe] = useState<
		{ state: "pending" } | { state: "done"; mtimeMs: number | null }
	>({ state: "pending" });
	/*
	 * The watch has already probed the path; this one answers only while the
	 * watch's first answer is outstanding (and for a story that mounts the view
	 * without the preview's watcher). Re-probed on `revision` so an edit's new
	 * text lands with the mtime that belongs to it.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: revision is the re-probe trigger, not a value the body reads.
	useEffect(() => {
		if (!local || !path || mtimeMs !== null) return;
		let cancelled = false;
		void probeLocalFile(path).then((answer) => {
			if (!cancelled) {
				setProbe({ state: "done", mtimeMs: answer?.mtimeMs ?? null });
			}
		});
		return () => {
			cancelled = true;
		};
	}, [local, path, revision, mtimeMs]);
	const readMtimeMs =
		mtimeMs ?? (probe.state === "done" ? probe.mtimeMs : null);
	const document = useMemo<CanvasDocument | null>(() => {
		if (!local || !path) return null;
		if (mtimeMs === null && probe.state !== "done") return null;
		return libraryMarkdownDocument(asset, text, readMtimeMs);
	}, [asset, local, path, probe, text, mtimeMs, readMtimeMs]);
	if (local && document === null) {
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
				className="min-h-0 flex-1 overflow-y-auto bg-sunken"
			>
				{/* The centered reading column is Library chrome; the shared editor
				    inside it is untouched, so Canvas keeps the same component and
				    save semantics. Expanded, the wrapper gives up its cap AND the
				    editor takes `measure="fill"`: the 640px cap that component
				    carries for the Canvas would otherwise still narrow the file. */}
				<div
					className={cn(
						"mx-auto flex w-full flex-col gap-4 px-6 py-8",
						expanded ? "max-w-none" : "max-w-[760px]",
					)}
				>
					{/*
					 * THE BODY OWNS THE TITLE. A markdown document's first block is
					 * usually its H1, so a second heading here would repeat it. This
					 * line says where the file lives; the editor below renders the
					 * document's own title in its own rhythm.
					 */}
					<p className="text-meta text-ink-dim">
						{t("ui.library.preview.breadcrumb", { name: document.title })}
					</p>
					<WysiwygMarkdownEditor
						document={document}
						measure={expanded ? "fill" : "reading"}
					/>
				</div>
			</div>
		);
	}
	return (
		<div data-lo-pane-edge-cues className="min-h-0 flex-1 overflow-y-auto p-5">
			<div
				className={cn("mx-auto", expanded ? "max-w-[980px]" : "max-w-[720px]")}
			>
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

/** Markdown, plain text and code, decoded from the content bytes. */
const TextViewer: FC<{
	asset: DesktopLibraryAsset;
	expanded: boolean;
	revision: number;
	mtimeMs: number | null;
}> = ({ asset, expanded, revision, mtimeMs }) => {
	const { bytes, error, loading } = useAssetContent(asset, revision);
	if (loading) return <Loading />;
	if (error || !bytes)
		return (
			<Failure
				detail={error || t("ui.library.errors.empty_bytes")}
				asset={asset}
			/>
		);
	const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
	if (asset.kind === "markdown") {
		return (
			<MarkdownAssetView
				asset={asset}
				text={text}
				expanded={expanded}
				revision={revision}
				mtimeMs={mtimeMs}
			/>
		);
	}
	/*
	 * FULL WIDTH, AND THE KIND'S OWN WRAPPING. Prose wraps; code does not — a
	 * wrapped line in a code viewer is a line the reader can no longer count, so
	 * it keeps `pre` and scrolls sideways instead.
	 */
	return (
		<pre
			data-lo-pane-edge-cues
			className={cn(
				"min-h-0 w-full flex-1 overflow-auto p-4 font-mono text-mono-sm text-ink",
				asset.kind === "code"
					? "whitespace-pre"
					: "whitespace-pre-wrap break-words",
			)}
		>
			{text}
		</pre>
	);
};

/** Spreadsheets: a read-only table from the first sheet (CSV/XLSX/ODS). */
const SpreadsheetViewer: FC<{
	asset: DesktopLibraryAsset;
	revision: number;
}> = ({ asset, revision }) => {
	const { bytes, error, loading } = useAssetContent(asset, revision);
	if (loading) return <Loading />;
	if (error || !bytes)
		return (
			<Failure
				detail={error || t("ui.library.errors.empty_bytes")}
				asset={asset}
			/>
		);
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
			{/*
			 * CONTENT-SIZED COLUMNS, AND THE PANE SCROLLS. A `w-full` table with a
			 * `max-w-60 truncate` on every cell squeezed forty columns into the pane
			 * and hid the text behind ellipses (operator: the spreadsheet did not use
			 * the space it had). `w-max min-w-full` lets each column take its
			 * content's width — never narrower than the pane — and the wrapper's
			 * horizontal scroll is where a wide sheet belongs.
			 */}
			<table className="w-max min-w-full border-collapse text-meta">
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
							className="sticky top-0 bg-sunken px-2 py-1 text-start text-ink-muted"
						>
							#
						</th>
						{(rows[0] ?? []).slice(0, MAX_COLS).map((_, index) => (
							<th
								// biome-ignore lint/suspicious/noArrayIndexKey: a column is its index.
								key={index}
								className="sticky top-0 border-b border-hairline bg-sunken px-2 py-1 text-start font-medium text-ink-muted"
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
									className="whitespace-nowrap border-b border-hairline px-2 py-1 font-mono text-ink"
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
	/**
	 * The standalone/full-view route: the reader asked for the whole workspace, so
	 * every kind is allowed to use it. The 448px dock keeps the narrower measures.
	 */
	expanded?: boolean;
	/** The freshness probe's revision; see `useAssetContent`. */
	revision?: number;
	/** The watched path's mtime, once the freshness probe has answered. */
	mtimeMs?: number | null;
	/** The listing's media rows, in display order: the lightbox's set. */
	mediaSiblings?: readonly DesktopLibraryAsset[];
}> = ({
	asset,
	dense = false,
	expanded = false,
	revision = 0,
	mtimeMs = null,
	mediaSiblings,
}) => {
	if (asset.kind === "pptx") {
		return (
			<PptxPreview
				asset={asset}
				dense={dense}
				expanded={expanded}
				revision={revision}
			/>
		);
	}
	if (
		asset.kind === "image" ||
		asset.kind === "audio" ||
		asset.kind === "video"
	)
		return (
			<MediaViewer
				asset={asset}
				mediaSiblings={mediaSiblings}
				revision={revision}
				expanded={expanded}
			/>
		);
	if (asset.kind === "pdf" || asset.kind === "html")
		return <FrameViewer asset={asset} revision={revision} />;
	if (
		asset.kind === "markdown" ||
		asset.kind === "text" ||
		asset.kind === "code"
	)
		return (
			<TextViewer
				asset={asset}
				expanded={expanded}
				revision={revision}
				mtimeMs={mtimeMs}
			/>
		);
	if (asset.kind === "spreadsheet")
		return <SpreadsheetViewer asset={asset} revision={revision} />;
	if (asset.kind === "docx") return <Unsupported asset={asset} />;
	return <Unsupported asset={asset} />;
};

/** PPTX needs its bytes before the viewer can exist; this owns that fetch. */
const PptxPreview: FC<{
	asset: DesktopLibraryAsset;
	dense?: boolean;
	expanded: boolean;
	revision: number;
}> = ({ asset, dense = false, expanded, revision }) => {
	const { bytes, error, loading } = useAssetContent(asset, revision);
	if (loading) return <Loading label={t("ui.library.preview.pptx_opening")} />;
	if (error || !bytes)
		return (
			<Failure
				detail={error || t("ui.library.errors.empty_bytes")}
				asset={asset}
			/>
		);
	return (
		<PptxViewer asset={asset} bytes={bytes} dense={dense} expanded={expanded} />
	);
};
