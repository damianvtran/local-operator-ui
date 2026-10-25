import { mimeTypeForPath } from "@features/chat/utils/file-kind";
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
import { useCallback, useEffect, useState } from "react";
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
 */
const isImage = (path: string): boolean => {
	if (path.startsWith("data:image/")) {
		return true;
	}
	const imageExtensions = [
		".jpg",
		".jpeg",
		".png",
		".gif",
		".webp",
		".bmp",
		".svg",
	];
	const lowerPath = path.toLowerCase();
	return imageExtensions.some((ext) => lowerPath.endsWith(ext));
};

/**
 * Check if a file is a video based on its path/URL
 */
const isVideo = (path: string): boolean => {
	if (path.startsWith("data:video/")) {
		return true;
	}
	const videoExtensions = [
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
	const lowerPath = path.toLowerCase();
	return videoExtensions.some((ext) => lowerPath.endsWith(ext));
};

/**
 * Extract filename from path
 */
const getFileName = (path: string): string => {
	if (path.startsWith("data:image/")) {
		return ""; // No name for pasted images
	}
	if (path.startsWith("data:")) {
		// For other pasted files (non-image)
		const nameMatch = path.match(RESOURCE_NAME_REGEX);
		if (nameMatch?.[1]) {
			try {
				return decodeURIComponent(nameMatch[1]);
			} catch {
				// Fallback if decoding fails, continue to MIME type extraction
			}
		}
		const mimeTypeMatch = path.match(MIME_TYPE_REGEX);
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
 */
const AttachmentTile: FC<{
	attachment: string;
	id: string;
	fileName: string;
	image: boolean;
	video: boolean;
	disabled: boolean;
	onRemove: (event: React.MouseEvent) => void;
}> = ({ attachment, id, fileName, image, video, disabled, onRemove }) => {
	useI18nLocale();
	const state = useFileBlobUrl(attachment, {
		mimeType: mimeTypeForPath(attachment),
	});
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
				mimeType={mimeTypeForPath(attachment)}
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
						onClick={onRemove}
						disabled={disabled}
						aria-label={t("ui.chat.composer_media.remove_attachment")}
					>
						<X aria-hidden="true" />
					</Button>
				</Tooltip>
			</div>
			{(image || video) && url && (
				<div className={LARGE_PREVIEW}>
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
};

/**
 * A non-image file's card: the type glyph, the name, and `TYPE · size`.
 *
 * WHY A CARD AND NOT THE 100px TILE (contract §6). A PDF has no thumbnail, and a
 * square tile left a clamped two-line name as the only thing a person could
 * recognise. The wider row keeps the whole filename readable and states what the
 * tile could not: what kind of file it is and how big.
 */
const AttachmentFileCard: FC<{
	attachment: string;
	id: string;
	fileName: string;
	disabled: boolean;
	byteSize?: number;
	onRemove: (event: React.MouseEvent) => void;
}> = ({ attachment, id, fileName, disabled, byteSize, onRemove }) => {
	useI18nLocale();
	const probedSize = useAttachmentSize(attachment);
	const size = byteSize ?? probedSize;
	const mimeType = mimeTypeForPath(attachment);
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
					onClick={onRemove}
					disabled={disabled}
					aria-label={t("ui.chat.composer_media.remove_attachment")}
				>
					<X aria-hidden="true" />
				</Button>
			</Tooltip>
		</div>
	);
};

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
	// Filename fallbacks are derived here, not cached when the attachment is added.
	useI18nLocale();
	/**
	 * Handle removing an attachment
	 */
	const handleRemove = useCallback(
		(id: string) => (event: React.MouseEvent) => {
			event.stopPropagation();
			if (!disabled) {
				onRemoveAttachment(id);
			}
		},
		[onRemoveAttachment, disabled],
	);

	// If no attachments, don't render anything
	if (!attachments.length) {
		return null;
	}

	return (
		<div className={cn("flex flex-col gap-1 py-2")}>
			<div className={cn("flex flex-wrap gap-3")}>
				{attachments.map(({ id, path }) => {
					const image = isImage(path);
					const video = isVideo(path);
					const fileName = getFileName(path);
					return image || video ? (
						<AttachmentTile
							// The attachment id, never the index: removing one must not remount
							// the chips after it (contract §6).
							key={id}
							id={id}
							attachment={path}
							fileName={fileName}
							image={image}
							video={video}
							disabled={disabled}
							onRemove={handleRemove(id)}
						/>
					) : (
						<AttachmentFileCard
							key={id}
							id={id}
							attachment={path}
							fileName={fileName}
							disabled={disabled}
							byteSize={byteSizes?.[path]}
							onRemove={handleRemove(id)}
						/>
					);
				})}
			</div>
			<span
				className={cn("text-ink-muted text-meta")}
				data-attachment-pending="true"
			>
				{t("ui.chat.attachments.pending_caption")}
			</span>
		</div>
	);
};
