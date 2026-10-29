import {
	fetchAttachmentBlob,
	useAttachmentSource,
} from "@features/chat/canonical/use-attachment-url";
import { rowCurrent } from "@features/chat/components/chat-sidebar";
import type {
	CanvasDocument,
	CanvasDocumentType,
} from "@features/chat/types/canvas";
import {
	artifactFileName,
	artifactTooltip,
} from "@features/chat/utils/artifact-identity";
import { stripFileUrl } from "@features/chat/utils/canvas-document";
import { mimeTypeForPath } from "@features/chat/utils/file-kind";
import { FileActionsMenu } from "@shared/components/common/file-actions-menu";
import { Tooltip } from "@shared/components/ui";
import { useEverInView } from "@shared/hooks/use-ever-in-view";
import { useFileBlobUrl } from "@shared/hooks/use-file-blob-url";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
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
import { type FC, memo, useEffect, useState } from "react";
import type { Ref } from "react";
import { ImageActionsMenu } from "../image-actions-menu";
import type { FileRow } from "./file-rows";

/**
 * One file, as a row.
 *
 * A row is a line of a list, not a card: no elevation, no `border-control` (that
 * role is the sole boundary of a CONTROL, and a row is not one), no second line.
 * The name is the content — the thing the tile grid pushed under a 96px
 * thumbnail band — and the directory appears beside it only where identity needs
 * it (a basename two rows share). Everything else the row can say lives in one
 * right-hand slot: the size the probe answered, or the receipt for a file that
 * is gone.
 *
 * WHY THE ROW CARRIES NO `aria-label`. Its accessible name is its own text —
 * name, directory, size or receipt — and that is the whole design: an
 * `aria-label` would REPLACE that text, so a missing file would stop announcing
 * "No longer on disk" and a clashing basename would stop announcing the
 * directory that tells the two apart. What the label would have added is the
 * full path, which is the tooltip's job and stays there.
 *
 * THE MENU COMES AFTER THE BUTTON IN THE DOM, which is the grid's own keyboard
 * fix kept: the row's first Tab stop must be the file, not a menu. Absolute
 * positioning keeps the visual order (trailing) while the focus order moves onto
 * the control the row is for, and the row reserves the menu's 28px with its own
 * right padding so revealing it covers nothing.
 */

/**
 * The type glyph for a row's leading visual.
 *
 * The extension lists in `utils/file-kind.ts` are deliberately not consulted:
 * they once disagreed with the classifier, so a HEIC row painted a thumbnail
 * under a type that said the app did not know the format. The type is the one
 * answer.
 */
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

/**
 * The size slot, hidden when the list is too narrow to show three columns.
 *
 * `@max-[34rem]/fileslist:hidden` is a container query on the list rather than a
 * viewport breakpoint, for the reason the grid's own comment records: the dock
 * resizes 400–1200px independently of the window, so `sm:` was once true at a
 * 1440px window while the panel was 400px wide. Below the threshold the name
 * gets the width instead; the RECEIPT in this slot is never hidden, because
 * "this file is not there" is the fact that decides what the user does next.
 */
const SIZE_META = "@max-[34rem]/fileslist:hidden";

export type FileRowItemProps = {
	row: FileRow;
	/** This file is the one open in the Documents view. */
	current: boolean;
	onOpen: (document: CanvasDocument) => void;
	/**
	 * Set on the FIRST row only, so the search field can hand the keyboard to the
	 * list (Escape on an empty field, ArrowDown from the field). A ref rather than
	 * a DOM query: the rows are React's, and asking the document for the first
	 * button is a second opinion about which one it is.
	 */
	buttonRef?: Ref<HTMLButtonElement>;
};

/**
 * The type glyph a row shows when it has no thumbnail to show.
 *
 * No `bg-sunken` tile behind the glyph. A ground step that measures ΔE00
 * 1.23–1.89 against its neighbour in four palettes is a box that is not there,
 * and `ink-dim` is the caption and placeholder ink — a row's type marker is not
 * a caption.
 */
const TypeGlyph: FC<{ row: FileRow }> = ({ row }) => {
	const Icon = getIconForFileType(row.document.type);
	return (
		<Icon
			size={16}
			aria-hidden="true"
			className={cn(row.missing ? "text-ink-disabled" : "text-ink-muted")}
		/>
	);
};

/**
 * The largest file a 28px thumbnail may pull across IPC.
 *
 * `MAX_FILE_READ_BYTES` (64 MiB) is the VIEWER's ceiling, where the whole file
 * is the content. A thumbnail shows a few hundred pixels of it, so the same read
 * is mostly waste: a row for a 60 MiB screen recording would hold 60 MiB of blob
 * in the renderer to paint a still. Over this, the row wears its type glyph -
 * the same fallback a failed read gets - and the viewer (a click away) still
 * opens the file in full (agent review round 1, R2).
 */
const ROW_THUMBNAIL_MAX_BYTES = 16 * 1024 * 1024;

/**
 * A media row's leading visual, and where its pixels come from.
 *
 * The bytes come over the app's own file bridge (`use-file-blob-url`) — the
 * same door the viewers use — NOT the backend's static route this used to ask.
 * That route serves only the daemon's configured roots, so a file the agent
 * wrote to a scratch directory, or one the user named outside the workspace,
 * painted nothing while the row claimed it was a picture. The bridge reads by
 * path regardless of the roots, and needs no backend at all.
 *
 * THE READ WAITS FOR THE ROW TO BE NEAR THE VIEWPORT (`useEverInView`), because
 * the grid maps every row and has no virtualisation: the `loading="lazy"` that
 * used to defer an image's request defers nothing once the bytes are fetched by
 * a hook, so without the gate N media rows read N files at mount. The wrapper
 * is split from the reader below because a hook cannot be called conditionally;
 * until the row has been seen, the slot holds its ground exactly as it does
 * while a read is in flight.
 *
 * Loading keeps the established shape: the slot holds its ground until the
 * bytes land. A read that cannot land - or lands and cannot be DECODED (a
 * truncated file, or a format Chromium has no decoder for such as `.heic`,
 * which the route used to convert to PNG) - falls back to the row's own type
 * glyph, which is what every non-media row already shows: an unreadable
 * thumbnail must not look like an unreadable row (design round 1, D1).
 *
 * The plate's classes arrive from the ROW, not from this component, so
 * `chat-sidebar-selection.test.mjs` reads them at the call site — that scan is
 * what keeps the slot's ground and its `object-cover` exemption in step with
 * the palette contract (`PLATES_INSIDE_ROW_STATES`).
 */
const RowThumbnail: FC<{ row: FileRow; className: string }> = ({
	row,
	className,
}) => {
	const [ref, seen] = useEverInView();
	return (
		<span ref={ref} className={cn("flex size-7 items-center justify-center")}>
			{seen ? (
				<RowThumbnailReader row={row} className={className} />
			) : (
				<span className={cn("size-7 rounded-sm bg-sunken")} />
			)}
		</span>
	);
};

/**
 * A generated picture's thumbnail: the attachment store's bytes, by digest.
 *
 * The same resolver the transcript's own pictures use (`useAttachmentSource`):
 * refcounted blob URLs shared module-wide by digest, so a picture already on
 * screen in the chat costs this row no second fetch and an unmounted row gives
 * its reference back. NOT `useFileBlobUrl`: that reads a path over the file
 * bridge, and an artifact has no path - handing it `artifact:<digest>` would
 * answer `not-found` and paint a glyph for a picture that is fine.
 *
 * The decode latch mirrors the path reader's: a blob the element cannot paint
 * (a truncated write, a format Chromium lacks) falls back to the type glyph
 * rather than a broken-image icon.
 */
const ArtifactThumbnail: FC<{ row: FileRow; className: string }> = ({
	row,
	className,
}) => {
	// A failed fetch latches inside `useAttachmentSource` until the row remounts,
	// and "the daemon was unreachable for a few seconds" is indistinguishable there
	// from "the bytes are gone" (design D3: a 12 s outage left every thumbnail on
	// its glyph for the visit). So a miss is retried a bounded number of times by
	// REMOUNTING the reader under a new key - the one reset the hook offers, and
	// the same thing a view toggle did by hand. A genuinely gone digest costs two
	// extra 404s and then settles on the glyph.
	const [attempt, setAttempt] = useState(0);
	return (
		<ArtifactThumbnailAttempt
			key={attempt}
			row={row}
			className={className}
			onMiss={
				attempt < ARTIFACT_THUMBNAIL_RETRY_DELAYS_MS.length
					? () => setAttempt((count) => count + 1)
					: null
			}
			delayMs={ARTIFACT_THUMBNAIL_RETRY_DELAYS_MS[attempt] ?? 0}
		/>
	);
};

/** Waits before the 2nd and 3rd attempt: long enough to ride out a restart. */
const ARTIFACT_THUMBNAIL_RETRY_DELAYS_MS = [2000, 6000] as const;

const ArtifactThumbnailAttempt: FC<{
	row: FileRow;
	className: string;
	onMiss: (() => void) | null;
	delayMs: number;
}> = ({ row, className, onMiss, delayMs }) => {
	const artifact = row.artifact;
	const source = useAttachmentSource(
		{
			data: null,
			attachment: artifact?.digest ?? null,
			mimeType: artifact?.contentType ?? "image/png",
		},
		artifact
			? { sessionId: artifact.sessionId, childId: artifact.childId ?? null }
			: null,
	);
	const missing = source.state === "missing";
	useEffect(() => {
		if (!missing || onMiss === null) return;
		const timer = window.setTimeout(onMiss, delayMs);
		return () => window.clearTimeout(timer);
	}, [missing, onMiss, delayMs]);
	const url = source.state === "ready" ? source.url : null;
	const [undecodableUrl, setUndecodableUrl] = useState<string | null>(null);
	if (url !== null && url !== undecodableUrl) {
		return (
			<img
				src={url}
				alt=""
				decoding="async"
				onError={() => setUndecodableUrl(url)}
				className={className}
			/>
		);
	}
	if (source.state === "resolving" || (missing && onMiss !== null)) {
		return <span className={cn("size-7 rounded-sm bg-sunken")} />;
	}
	return <TypeGlyph row={row} />;
};

const RowThumbnailReader: FC<{ row: FileRow; className: string }> = ({
	row,
	className,
}) => {
	if (row.artifact)
		return <ArtifactThumbnail row={row} className={className} />;
	return <PathThumbnailReader row={row} className={className} />;
};

const PathThumbnailReader: FC<{ row: FileRow; className: string }> = ({
	row,
	className,
}) => {
	const { document } = row;
	const state = useFileBlobUrl(document.path, {
		mtimeMs: document.lastAgentModified,
		mimeType: mimeTypeForPath(document.path),
		sizeBytes: document.sizeBytes,
		maxBytes: ROW_THUMBNAIL_MAX_BYTES,
	});
	const url = state.status === "ready" ? state.url : null;
	// Keyed on the URL it describes: a rewritten file is a new blob, and a decode
	// failure of the OLD bytes must not condemn the new ones.
	const [undecodableUrl, setUndecodableUrl] = useState<string | null>(null);
	const decodable = url !== null && url !== undecodableUrl;

	if (decodable && row.media === "image") {
		return (
			<img
				src={url}
				// The row's own text already names the file, so the thumbnail is
				// decorative here: an alt of the name would announce it twice.
				alt=""
				loading="lazy"
				decoding="async"
				onError={() => setUndecodableUrl(url)}
				className={className}
			/>
		);
	}
	if (decodable && row.media === "video") {
		return (
			// biome-ignore lint/a11y/useMediaCaption: a user's own attached video has no caption track to offer.
			<video
				src={url}
				preload="metadata"
				onError={() => setUndecodableUrl(url)}
				className={className}
			/>
		);
	}
	if (state.status === "loading") {
		return <span className={cn("size-7 rounded-sm bg-sunken")} />;
	}
	return <TypeGlyph row={row} />;
};

const FileRowItemComponent = ({
	row,
	current,
	onOpen,
	buttonRef,
}: FileRowItemProps) => {
	useI18nLocale();
	const { document } = row;
	/*
	 * The full path, not the name. The name is already on the row, and where two
	 * rows share one the path is the only thing that tells them apart — so the
	 * tooltip resolves the collision rather than repeating the name (design round
	 * 1, D1). A `data:` document has no path to show and keeps its name.
	 */
	const artifact = row.artifact;
	// An artifact has no path to resolve a name clash or to say where it lives, so
	// its tooltip carries the digest head and the cue instead (UX U2/U4, design D7).
	const tooltip = artifact
		? artifactTooltip({ ...artifact, title: document.title })
		: document.path.startsWith("data:")
			? document.title
			: document.path;
	const isLocalFile =
		!artifact &&
		!document.path.startsWith("data:") &&
		!document.path.startsWith("http");

	return (
		/*
		 * THE GROUND IS ON THE ROW, not on the button inside it (design round 2,
		 * D11). The actions menu is the button's SIBLING — it has to be, because the
		 * button is the row and the menu must not open a link inside it — so a ground
		 * painted by the button dropped the instant the pointer reached the `⋯`: the
		 * row read as un-hovered while one of its own controls was under the pointer.
		 * Hovering anywhere in the row, menu included, now keeps it, which is also
		 * what makes the reveal stop looking like a state of its own.
		 *
		 * `hover:bg-row-hover` and NOT a ground role: `scripts/chat-sidebar-selection.test.mjs`
		 * refuses `hover:bg-elevated` on a row surface, because `elevated` is also
		 * every menu, popover, tooltip and dialog in the app — a ground cannot be a
		 * row's state. This file is on that list now rather than exempt from it (see
		 * `ROW_SURFACES`), which is what the round-2 review asked for: the guard was
		 * passing only because a new surface is not enumerated by default.
		 *
		 * `rowCurrent` goes on the SAME element `hover:bg-row-hover` does, for the
		 * reason the sidebar's own row states: a hover variant outranks a bare
		 * background in the cascade, so without `rowCurrent`'s own
		 * `hover:bg-row-selected` a row the user is IN would be repainted as the row
		 * the pointer is over.
		 */
		<li
			className={cn(
				"group relative rounded-sm",
				"transition-colors duration-fast ease-out-quart hover:bg-row-hover",
				current && rowCurrent,
			)}
			data-tour-tag="file-row"
		>
			<Tooltip content={tooltip}>
				<button
					ref={buttonRef}
					type="button"
					onClick={() => onOpen(document)}
					/*
					 * `pr-8` reserves the trailing 28px the actions menu occupies, so
					 * the two never overlap; the hover ground still spans the whole row,
					 * which is what makes it read as a row rather than as a chip.
					 */
					className={cn(
						"flex h-9 w-full items-center gap-2 rounded-sm py-0 pe-8 ps-2 text-start",
					)}
				>
					<span className={cn("flex w-7 shrink-0 items-center justify-center")}>
						{row.media ? (
							<RowThumbnail
								row={row}
								/*
								 * `outline-1 -outline-offset-1 outline-hairline` is the thumbnail's own edge (design
								 * D2): a picture whose pixels match the list ground (white art on the
								 * light list is 1.09:1, a ground-coloured one 1.0:1) otherwise
								 * disappears and leaves the name offset 36px from nothing. An OUTLINE
								 * pulled inward rather than the `ring-inset` the review suggested: an
								 * inset box-shadow is painted above the element's background but below
								 * its content (CSS Backgrounds 3), and an `<img>`'s content is the
								 * picture, so the edge would sit under the very pixels it frames. An
								 * outline paints over them. (That is the spec's order; a ring variant
								 * was not built and photographed here.) Measured with the outline, on
								 * the white picture in the light palette: edge pixels (217,213,204)
								 * between the list ground (247,245,239) and the picture (252,251,249).
								 * The slot stays 28px so no row moves, and the hairline is a role, not
								 * a colour.
								 */
								className={cn(
									"size-7 rounded-sm bg-sunken object-cover outline-1 -outline-offset-1 outline-hairline",
								)}
							/>
						) : (
							<TypeGlyph row={row} />
						)}
					</span>
					{/*
					 * `flex-1` with a zero basis: the name takes the row's free space and
					 * is the LAST thing to give any up, because the directory beside it has
					 * an automatic basis and absorbs the shrink first. What must not be cut
					 * is the name's head — that is what the reader is scanning.
					 */}
					<span
						className={cn(
							"min-w-0 flex-1 truncate text-body-sm",
							// A file that is gone steps one ink down, because a one-line row
							// has no second line left to say so: at full `ink` the row reads
							// as openable until the reader reaches the receipt.
							row.missing ? "text-ink-muted" : "text-ink",
						)}
					>
						{row.name}
					</span>
					{row.showParent && row.parent ? (
						<span
							className={cn(
								"min-w-0 shrink truncate text-mono-sm text-ink-dim",
							)}
						>
							{row.parent}
						</span>
					) : null}
					{/*
					 * One slot, two facts, and the receipt wins it at every width a size
					 * would otherwise take: a size is a fact the user can get back, "this
					 * file is not there" decides what they do next.
					 */}
					{row.missing ? (
						<span className={cn("shrink-0 text-meta text-ink-dim")}>
							{t("ui.canvas.files.missing")}
						</span>
					) : row.size ? (
						<span
							className={cn(
								"shrink-0 text-meta text-ink-dim tabular-nums",
								SIZE_META,
							)}
						>
							{row.size}
						</span>
					) : null}
				</button>
			</Tooltip>
			{(isLocalFile || artifact) && (
				<div
					className={cn(
						"absolute top-1/2 end-1 z-10 -translate-y-1/2",
						/*
						 * Revealed on hover or keyboard focus, like every other row action
						 * in the app, and `group-focus-within` is what keeps it reachable
						 * by keyboard at all: an element that never appears cannot be
						 * tabbed to.
						 */
						"pointer-events-none opacity-0",
						"group-hover:pointer-events-auto group-hover:opacity-100",
						"group-focus-within:pointer-events-auto group-focus-within:opacity-100",
					)}
				>
					{artifact ? (
						/*
						 * THE SHIPPED PICTURE MENU, not a fork of it (PRs #978/#990): the
						 * `artifact` action set lives in `utils/image-actions.ts`, so this
						 * row offers Show in canvas, Save as... and Copy image from the same
						 * table the transcript's hover controls read. The path-shaped entries
						 * (Open file / Open folder / Copy file path) are absent because an
						 * artifact has no path until the backend can materialise one.
						 * The trigger wears the same "File actions" name as a path row's so
						 * the column of `...` reads as one control down the list.
						 */
						<ImageActionsMenu
							file={document.path}
							label={document.title}
							mediaKind={artifact.kind === "image" ? "image" : "video"}
							saveName={artifactFileName(artifact)}
							resolveBytes={() =>
								fetchAttachmentBlob(
									{
										sessionId: artifact.sessionId,
										childId: artifact.childId ?? null,
									},
									artifact.digest,
								)
							}
							onShowInCanvas={() => onOpen(document)}
							tooltip={t("ui.canvas.file_row.ui_canvas_files_fileactions")}
							aria-label={t("ui.canvas.file_row.ui_canvas_files_fileactions")}
						/>
					) : (
						<FileActionsMenu
							filePath={stripFileUrl(document.path)}
							tooltip={t("ui.canvas.file_row.ui_canvas_files_fileactions")}
							aria-label={t("ui.canvas.file_row.ui_canvas_files_fileactions")}
							onShowInCanvas={() => onOpen(document)}
						/>
					)}
				</div>
			)}
		</li>
	);
};

export const FileRowItem = memo(FileRowItemComponent);
