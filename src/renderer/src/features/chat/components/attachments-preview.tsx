import { dataUrlHeader, mimeTypeForPath } from "@features/chat/utils/file-kind";
import { Button, Tooltip } from "@shared/components/ui";
import {
	previewFailureReason,
	useFileBlobUrl,
} from "@shared/hooks/use-file-blob-url";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import type { Attachment } from "@shared/store/conversation-input-store";
import { X } from "lucide-react";
import type { FC } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AttachmentKindIcon, attachmentMetaLine } from "./attachment-file-card";

/**
 * Props for the AttachmentsPreview component
 *
 * The list is the composer's own `Attachment[]` rather than bare paths: a chip's
 * KEY is the attachment id (contract §6), so removing one must not renumber and
 * therefore remount every chip after it.
 */
type AttachmentsPreviewProps = {
	/** The staged attachments, in the order the user attached them. */
	attachments: readonly Attachment[];
	/** Callback when an attachment is removed, by id. */
	onRemoveAttachment: (id: string) => void;
	/** Whether the component is disabled. */
	disabled?: boolean;
	/**
	 * Sizes by path, for a caller that already knows them. The live composer does
	 * not (a renderer cannot stat), so its cards probe `probeFiles`; a Storybook
	 * frame has no bridge at all, and a frame that never states `TYPE · size` would
	 * photograph a loading state as the design.
	 */
	byteSizes?: Readonly<Record<string, number>>;
};

// Regex for splitting file paths (moved to top-level for performance)
const PATH_SEPARATOR_REGEX = /[/\\]/;
// Regex for extracting the resource name from a data URI
const RESOURCE_NAME_REGEX = /name=([^;,]+)/;
// Regex for extracting the MIME type from a data URI
const MIME_TYPE_REGEX = /^data:([^;,]+)/;

/**
 * The 100px media tile. One sunken ground and a radius, no border: the ground
 * step already separates it from the composer, so a hairline would only add a
 * line that carries nothing.
 */
const TILE = cn(
	"relative flex size-25 flex-col items-center justify-center",
	"overflow-hidden rounded-md bg-sunken",
);

/**
 * A non-image file's card (contract §6): wider than the tile because a filename
 * is the content, and a 100px square truncates the one fact a person reads.
 *
 * The remove control sits in the same reserved top-right corner as the tile's,
 * always rendered, so neither hover nor focus moves the name or the meta line.
 */
const FILE_CARD = cn(
	"relative flex h-25 w-60 flex-col justify-between",
	"overflow-hidden rounded-md bg-sunken p-3 pr-9",
);

/**
 * The dwell preview that appears above the tile after a deliberate hover. A
 * true floating overlay, so this is one of the few places `shadow-overlay`
 * belongs. It fades in place — no translate, because hover never moves
 * anything.
 */
const LARGE_PREVIEW = cn(
	"invisible absolute -top-80 left-0 z-50 size-75 p-2",
	"rounded-lg bg-elevated shadow-overlay",
	"opacity-0 transition-[opacity,visibility] duration-base ease-out-quart",
	"group-hover:visible group-hover:opacity-100 group-hover:delay-[1500ms]",
);

/**
 * The overlay corner the remove control reserves on every chip.
 *
 * One class for both shapes: the two chips differ in width, and a control that
 * moved between them would read as two different affordances.
 */
const REMOVE_CORNER = cn(
	"absolute top-1 right-1 z-10",
	"bg-surface/85 text-danger hover:bg-danger-wash hover:text-danger",
	"disabled:bg-sunken disabled:text-ink-disabled",
);

/**
 * Check if a file is an image based on its path/URL
 *
 * BOUNDED ON PURPOSE (perf, QA round 1 on PR #1773). This ran per attachment on
 * every composer render — and the composer re-renders on every KEYSTROKE —
 * against a path that can be a 1.5 MB `data:` URL. Two things were paid there:
 * a fresh extension array per call, and `path.toLowerCase()` over the whole
 * string (~0.25 ms at 1.5 MB, measured). The lists are constants now and the
 * lowercase reads the TAIL only: `endsWith` can observe nothing else, the
 * longest extension here is five characters, and a real path is ~1 KB at most.
 */
const IMAGE_EXTENSIONS = [
	".jpg",
	".jpeg",
	".png",
	".gif",
	".webp",
	".bmp",
	".svg",
];

/**
 * Check if a file is a video based on its path/URL
 */
const VIDEO_EXTENSIONS = [
	".mp4",
	".webm",
	".ogg",
	".mov",
	".avi",
	".wmv",
	".flv",
	".mkv",
	".m4v",
	".3gp",
	".3g2",
];

/**
 * How much of a path an extension check may read: enough for the longest
 * extension plus slack, and no more.
 */
const EXTENSION_TAIL_CHARS = 12;

/**
 * The characters an `endsWith` on a lowercased path can ever observe.
 *
 * Case mapping is per character apart from length changes at the extreme
 * (`"İ".toLowerCase()` is two units), which twelve characters absorb, so this
 * answers exactly what lowercasing the whole string did.
 */
const lowerTail = (path: string): string =>
	(path.length <= EXTENSION_TAIL_CHARS
		? path
		: path.slice(-EXTENSION_TAIL_CHARS)
	).toLowerCase();

const isImage = (path: string): boolean => {
	if (path.startsWith("data:image/")) {
		return true;
	}
	const tail = lowerTail(path);
	return IMAGE_EXTENSIONS.some((ext) => tail.endsWith(ext));
};

const isVideo = (path: string): boolean => {
	if (path.startsWith("data:video/")) {
		return true;
	}
	const tail = lowerTail(path);
	return VIDEO_EXTENSIONS.some((ext) => tail.endsWith(ext));
};

/**
 * Extract filename from path
 *
 * A `data:` URL is read from its HEADER (`dataUrlHeader`): the payload cannot
 * name the file, and both regexes below used to walk megabytes of base64 on
 * every render to discover that.
 */
const getFileName = (path: string): string => {
	if (path.startsWith("data:image/")) {
		return ""; // No name for pasted images
	}
	if (path.startsWith("data:")) {
		// For other pasted files (non-image)
		const header = dataUrlHeader(path);
		const nameMatch = header.match(RESOURCE_NAME_REGEX);
		if (nameMatch?.[1]) {
			try {
				return decodeURIComponent(nameMatch[1]);
			} catch {
				// Fallback if decoding fails, continue to MIME type extraction
			}
		}
		const mimeTypeMatch = header.match(MIME_TYPE_REGEX);
		if (mimeTypeMatch?.[1]) {
			return t("ui.chat.composer_media.pasted_type", {
				mimeType: mimeTypeMatch[1],
			});
		}
		return t("ui.chat.composer_media.pasted_file");
	}
	const parts = path.split(PATH_SEPARATOR_REGEX);
	return parts[parts.length - 1] || path;
};

/**
 * A staged file's byte size, for the `TYPE · size` line.
 *
 * The composer stores a path, and a renderer cannot `stat`; `probeFiles` is the
 * app's own batched read for exactly that question (the Files panel's identity
 * call). One probe per card, not per row: a paste has no path and gets its size
 * from the data URL itself, and a probe that cannot answer leaves the line at
 * the type alone rather than inventing a number.
 */
function useAttachmentSize(attachment: string): number | null {
	const [size, setSize] = useState<number | null>(null);
	useEffect(() => {
		let cancelled = false;
		if (attachment.startsWith("data:")) {
			const comma = attachment.indexOf(",");
			if (comma < 0) return;
			const header = attachment.slice(5, comma);
			const payload = attachment.slice(comma + 1);
			const bytes = header.endsWith(";base64")
				? Math.floor((payload.length * 3) / 4) -
					(payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0)
				: payload.length;
			setSize(bytes);
			return;
		}
		const probe = window.api?.probeFiles;
		if (!probe) return;
		void probe([attachment]).then((rows) => {
			if (cancelled) return;
			setSize(rows[0]?.sizeBytes ?? null);
		});
		return () => {
			cancelled = true;
		};
	}, [attachment]);
	return size;
}

/**
 * One media tile, and where its pixels come from.
 *
 * The bytes come over the app's own file bridge (`use-file-blob-url`) — the
 * same door the canvas viewers and the canonical transcript use — NOT the
 * backend's `/v1/static/images` route this used to ask. That route serves only
 * the daemon's configured roots, and a thumbnail is requested at PICK time,
 * before any message references the file, so a file chosen from `~/Downloads`
 * or a scratch directory painted nothing but a broken-image glyph. The bridge
 * reads by path whether or not a root covers it, and whether or not the backend
 * is running at all; `data:`/`http(s):` attachments are used as they are.
 *
 * A read that cannot land — over the 64 MiB preview cap, a file that moved —
 * or lands and cannot be DECODED (a truncated image, a codec Chromium lacks)
 * falls back to the same name-and-icon body a non-media file gets, and the
 * hover preview is not rendered at all. The tile says WHY in its `title`
 * rather than looking the same for every cause. Both degrades are stated
 * rather than dressed as a picture that is still coming.
 *
 * MEMOISED, AND IT TAKES ITS ID RATHER THAN A CLOSURE (perf, QA round 1 on PR
 * #1773). The composer re-renders on every keystroke and this row is inside that
 * render, so every chip re-rendered too - re-running its classifiers and its
 * `mimeTypeForPath` over a 1.5 MB payload. `onRemove` used to arrive as
 * `handleRemove(id)`, a fresh closure per render, which defeats `memo` by
 * construction: the callback is stable now and the id is already a prop.
 */
const AttachmentTile = memo(function AttachmentTile({
	attachment,
	id,
	fileName,
	mimeType,
	image,
	video,
	disabled,
	onRemove,
}: {
	attachment: string;
	id: string;
	fileName: string;
	/** Resolved once per row change by the parent, not twice per tile per render. */
	mimeType: string;
	image: boolean;
	video: boolean;
	disabled: boolean;
	onRemove: (id: string) => void;
}) {
	useI18nLocale();
	const state = useFileBlobUrl(attachment, { mimeType });
	const readyUrl = state.status === "ready" ? state.url : null;
	// Keyed on the URL it describes, so a rewritten file (a new blob) is judged
	// afresh rather than condemned by the old bytes' failure.
	const [undecodableUrl, setUndecodableUrl] = useState<string | null>(null);
	const url =
		readyUrl !== null && readyUrl !== undecodableUrl ? readyUrl : null;
	const degraded =
		state.status === "unavailable" ||
		(readyUrl !== null && readyUrl === undecodableUrl);
	const reason =
		state.status === "unavailable"
			? previewFailureReason(state.code)
			: degraded
				? t("ui.chat.composer_media.preview_failed")
				: null;

	/*
	 * A non-media file has nothing to show but its name, so the name is the tile
	 * body and the caption strip is skipped rather than printing it twice. A
	 * media file whose bytes did not arrive wears that same body: "which file is
	 * this" is the fact that survives the missing preview.
	 */
	const fileBody = (
		<div
			className={cn(
				"flex size-full flex-col items-center justify-center gap-1.5",
				"bg-accent-wash p-2 text-center text-accent",
			)}
		>
			<AttachmentKindIcon
				name={fileName}
				mimeType={mimeType}
				className="size-4.5"
			/>
			<span className={cn("line-clamp-2 break-all font-medium text-meta")}>
				{fileName}
			</span>
		</div>
	);

	return (
		<div className={cn("group relative")} data-attachment-id={id}>
			<div className={TILE} title={reason ?? undefined}>
				{url && image ? (
					<img
						src={url}
						alt={fileName}
						onError={() => setUndecodableUrl(url)}
						className={cn("size-full object-cover")}
					/>
				) : url && video ? (
					<video
						src={url}
						preload="metadata"
						muted
						onError={() => setUndecodableUrl(url)}
						className={cn("size-full object-cover")}
					/>
				) : !image && !video ? (
					fileBody
				) : degraded ? (
					fileBody
				) : null}
				{/* Pasted images have no name, so the strip would be an empty bar. */}
				{(image || video) && fileName && !degraded && (
					<span
						className={cn(
							"absolute inset-x-0 bottom-0 truncate",
							"bg-surface/85 px-1.5 py-0.5",
							"text-center text-ink text-meta",
						)}
					>
						{fileName}
					</span>
				)}
				<Tooltip
					content={t("ui.chat.composer_media.remove_attachment")}
					disabled={disabled}
				>
					<Button
						variant="ghost"
						size="icon-sm"
						className={REMOVE_CORNER}
						onClick={(event) => {
							event.stopPropagation();
							onRemove(id);
						}}
						disabled={disabled}
						aria-label={t("ui.chat.composer_media.remove_attachment")}
					>
						<X aria-hidden="true" />
					</Button>
				</Tooltip>
			</div>
			{(image || video) && url && (
				<div data-lo-floating="" className={LARGE_PREVIEW}>
					{url && image ? (
						<img
							src={url}
							alt={fileName}
							className={cn("size-full object-contain")}
						/>
					) : url && video ? (
						<video
							src={url}
							controls
							preload="metadata"
							muted
							className={cn("size-full object-contain")}
						/>
					) : null}
				</div>
			)}
		</div>
	);
});

/**
 * A non-image file's card: the type glyph, the name, and `TYPE · size`.
 *
 * WHY A CARD AND NOT THE 100px TILE (contract §6). A PDF has no thumbnail, and a
 * square tile left a clamped two-line name as the only thing a person could
 * recognise. The wider row keeps the whole filename readable and states what the
 * tile could not: what kind of file it is and how big.
 */
const AttachmentFileCard = memo(function AttachmentFileCard({
	attachment,
	id,
	fileName,
	mimeType,
	disabled,
	byteSize,
	onRemove,
}: {
	attachment: string;
	id: string;
	fileName: string;
	/** Resolved once per row change by the parent, not once per card per render. */
	mimeType: string;
	disabled: boolean;
	byteSize?: number;
	/** Stable across renders: takes the id, so no card owns a fresh closure. */
	onRemove: (id: string) => void;
}) {
	useI18nLocale();
	const probedSize = useAttachmentSize(attachment);
	const size = byteSize ?? probedSize;
	return (
		<div className={FILE_CARD} data-attachment-id={id}>
			<AttachmentKindIcon
				name={fileName}
				mimeType={mimeType}
				className="size-5 shrink-0 text-ink-muted"
			/>
			<div className={cn("flex min-w-0 flex-col gap-0.5")}>
				<span
					className={cn("line-clamp-2 break-all text-body-sm text-ink")}
					title={fileName}
				>
					{fileName}
				</span>
				<span className={cn("truncate text-ink-muted text-meta")}>
					{attachmentMetaLine(fileName, mimeType, size)}
				</span>
			</div>
			<Tooltip
				content={t("ui.chat.composer_media.remove_attachment")}
				disabled={disabled}
			>
				<Button
					variant="ghost"
					size="icon-sm"
					className={REMOVE_CORNER}
					onClick={(event) => {
						event.stopPropagation();
						onRemove(id);
					}}
					disabled={disabled}
					aria-label={t("ui.chat.composer_media.remove_attachment")}
				>
					<X aria-hidden="true" />
				</Button>
			</Tooltip>
		</div>
	);
});

/**
 * The row of chips, behind a memo boundary.
 *
 * WHY THIS SEAM (perf, QA round 1 on PR #1773). The composer commits on every
 * keystroke, so this subtree re-rendered per keystroke and re-derived every
 * chip's name, kind and MIME type from paths that can be 1.5 MB `data:` URLs —
 * ~10.5 ms of engine-independent JS per keystroke at six pasted images, which is
 * the operator's complaint surviving the store fix. The row's props now change
 * only when the ROW changes: `attachments` keeps its identity across a text
 * keystroke (the store spreads the row, it does not rebuild the array), `disabled`
 * is a boolean, and `onRemove` is stable by construction. So a keystroke costs
 * this subtree nothing at all, and the derivatives below are computed once per
 * row change instead of once per render.
 */
const AttachmentRow: FC<{
	attachments: readonly Attachment[];
	disabled: boolean;
	byteSizes?: Readonly<Record<string, number>>;
	onRemove: (id: string) => void;
}> = memo(function AttachmentRow({
	attachments,
	disabled,
	byteSizes,
	onRemove,
}) {
	// Filename fallbacks are derived here, not cached when the attachment is added.
	const locale = useI18nLocale();
	/* `t()` runs inside `getFileName`, so a locale change must rebuild the copy: */
	/* biome-ignore lint/correctness/useExhaustiveDependencies: `locale` is a deliberate rebuild trigger - `getFileName` resolves translated copy through `t()`, and the callback's parameter list cannot name the language, so the dependency list is the only place it can appear (the same shape as `settings-search.tsx`). */
	const chips = useMemo(
		() =>
			attachments.map(({ id, path }) => ({
				id,
				path,
				fileName: getFileName(path),
				/* Once per chip, not twice per tile per render. */
				mimeType: mimeTypeForPath(path),
				image: isImage(path),
				video: isVideo(path),
			})),
		[attachments, locale],
	);

	return (
		<div className={cn("flex flex-col gap-1 py-2")}>
			<div className={cn("flex flex-wrap gap-3")}>
				{chips.map((chip) =>
					chip.image || chip.video ? (
						<AttachmentTile
							// The attachment id, never the index: removing one must not remount
							// the chips after it (contract §6).
							key={chip.id}
							id={chip.id}
							attachment={chip.path}
							fileName={chip.fileName}
							mimeType={chip.mimeType}
							image={chip.image}
							video={chip.video}
							disabled={disabled}
							onRemove={onRemove}
						/>
					) : (
						<AttachmentFileCard
							key={chip.id}
							id={chip.id}
							attachment={chip.path}
							fileName={chip.fileName}
							mimeType={chip.mimeType}
							disabled={disabled}
							byteSize={byteSizes?.[chip.path]}
							onRemove={onRemove}
						/>
					),
				)}
			</div>
			<span
				className={cn("text-ink-muted text-meta")}
				data-attachment-pending="true"
			>
				{t("ui.chat.attachments.pending_caption")}
			</span>
		</div>
	);
});

/**
 * Component to display a preview of attachments
 *
 * EVERY CHIP HERE IS PENDING (contract §6, "sent vs pending"): it is removable and
 * the row says so. The transcript's file card is the sent shape - flat, no
 * control, with a path line - and a reader moving between the two should never
 * wonder which one they are looking at.
 */
export const AttachmentsPreview: FC<AttachmentsPreviewProps> = ({
	attachments,
	onRemoveAttachment,
	disabled = false,
	byteSizes,
}) => {
	/*
	 * THE STABLE REMOVE. The chips below are memoised, so their props must not
	 * change when this component merely re-renders — and its parent, the composer,
	 * re-renders on every keystroke. `onRemoveAttachment` and `disabled` are read
	 * through a ref so the callback keeps one identity across those renders while
	 * still invoking the newest pair (the previous `handleRemove(id)` minted a
	 * closure per render, which defeats `memo` by construction).
	 */
	const latest = useRef({ onRemoveAttachment, disabled });
	latest.current = { onRemoveAttachment, disabled };
	const remove = useCallback((id: string) => {
		const current = latest.current;
		if (!current.disabled) {
			current.onRemoveAttachment(id);
		}
	}, []);

	// If no attachments, don't render anything
	if (!attachments.length) {
		return null;
	}

	return (
		<AttachmentRow
			attachments={attachments}
			disabled={disabled}
			byteSizes={byteSizes}
			onRemove={remove}
		/>
	);
};
