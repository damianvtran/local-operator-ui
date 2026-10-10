import { mimeTypeForPath } from "@features/chat/utils/file-kind";
import { Button, Tooltip } from "@shared/components/ui";
import {
	previewFailureReason,
	useFileBlobUrl,
} from "@shared/hooks/use-file-blob-url";
import { cn } from "@shared/lib/utils";
import { File, X } from "lucide-react";
import type { FC } from "react";
import { useCallback, useState } from "react";

/**
 * Props for the AttachmentsPreview component
 */
type AttachmentsPreviewProps = {
	/** List of attachment paths or URLs */
	attachments: string[];
	/** Callback when an attachment is removed */
	onRemoveAttachment: (index: number) => void;
	/** Whether the component is disabled */
	disabled?: boolean;
};

// Regex for splitting file paths (moved to top-level for performance)
const PATH_SEPARATOR_REGEX = /[/\\]/;
// Regex for extracting the resource name from a data URI
const RESOURCE_NAME_REGEX = /name=([^;,]+)/;
// Regex for extracting the MIME type from a data URI
const MIME_TYPE_REGEX = /^data:([^;,]+)/;

/**
 * The 100px thumbnail tile. One sunken ground and a radius, no border: the
 * ground step already separates it from the composer, so a hairline would only
 * add a line that carries nothing.
 */
const TILE = cn(
	"relative flex size-25 flex-col items-center justify-center",
	"overflow-hidden rounded-md bg-sunken",
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
			return `Pasted ${mimeTypeMatch[1]}`;
		}
		return "Pasted file"; // Generic fallback for non-image data URIs
	}
	// Handle both local paths and URLs for actual files
	const parts = path.split(PATH_SEPARATOR_REGEX);
	return parts[parts.length - 1];
};

type AttachmentTileProps = {
	/** The attachment path or URL, exactly as the composer holds it. */
	attachment: string;
	/** The name shown in the caption strip and in the fallback body. */
	fileName: string;
	image: boolean;
	video: boolean;
	disabled: boolean;
	onRemove: (event: React.MouseEvent) => void;
};

/**
 * One tile, and where its pixels come from.
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
 * hover preview is not rendered at all (an empty elevated box over nothing was
 * the alternative; design round 1, D1/D2). The tile says WHY in its `title`
 * (too large / no longer exists / could not be read) rather than looking the
 * same for every cause (D5). Both degrades are stated rather than dressed as a
 * picture that is still coming.
 *
 * NO MTIME is passed, because a composer tile holds a bare path and a renderer
 * cannot `stat`: `useFileBlobUrl` then keeps the read private to this tile
 * instead of sharing it by path, so a file rewritten between two attaches is
 * re-read (agent review round 1, R1). The tile's own panel and thumbnail share
 * this ONE hook call, so a tile is still one read.
 */
const AttachmentTile: FC<AttachmentTileProps> = ({
	attachment,
	fileName,
	image,
	video,
	disabled,
	onRemove,
}) => {
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
				? "Could not be previewed"
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
			<File size={18} aria-hidden="true" />
			<span className={cn("line-clamp-2 break-all font-medium text-meta")}>
				{fileName}
			</span>
		</div>
	);

	return (
		<div className={cn("group relative")}>
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
				<Tooltip content="Remove attachment" disabled={disabled}>
					<Button
						variant="ghost"
						size="icon-sm"
						className={cn(
							"absolute top-1 right-1 bg-surface/85 text-danger",
							"hover:bg-danger-wash hover:text-danger",
							"disabled:bg-sunken disabled:text-ink-disabled",
						)}
						onClick={onRemove}
						disabled={disabled}
						aria-label="Remove attachment"
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
 * Component to display a preview of attachments
 */
export const AttachmentsPreview: FC<AttachmentsPreviewProps> = ({
	attachments,
	onRemoveAttachment,
	disabled = false,
}) => {
	/**
	 * Handle removing an attachment
	 */
	const handleRemove = useCallback(
		(index: number) => (event: React.MouseEvent) => {
			event.stopPropagation();
			if (!disabled) {
				onRemoveAttachment(index);
			}
		},
		[onRemoveAttachment, disabled],
	);

	// If no attachments, don't render anything
	if (!attachments.length) {
		return null;
	}

	return (
		<div className={cn("flex flex-wrap gap-3 py-2")}>
			{attachments.map((attachment, index) => (
				<AttachmentTile
					key={`${index}-${attachment}`}
					attachment={attachment}
					fileName={getFileName(attachment)}
					image={isImage(attachment)}
					video={isVideo(attachment)}
					disabled={disabled}
					onRemove={handleRemove(index)}
				/>
			))}
		</div>
	);
};
