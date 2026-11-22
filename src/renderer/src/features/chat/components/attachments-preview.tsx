import { dataUrlHeader, mimeTypeForPath } from "@features/chat/utils/file-kind";
import { USER_CONTENT_CLASS } from "@shared/analytics/autocapture-privacy";
import {
	Button,
	Dialog,
	DialogContent,
	DialogTitle,
	DialogTrigger,
	Tooltip,
} from "@shared/components/ui";
import {
	previewFailureReason,
	useFileBlobUrl,
} from "@shared/hooks/use-file-blob-url";
import { formatNumber, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import type { Attachment } from "@shared/store/conversation-input-store";
import { LoaderCircle, Maximize2, X } from "lucide-react";
import type { FC } from "react";
import {
	memo,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
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

// Same height for both kinds; the document still needs more inline room than a thumbnail.
const CHIP = "relative h-20 max-w-full shrink-0 rounded-md bg-sunken";
const TILE = cn(CHIP, "w-20");
const FILE_CARD = cn(CHIP, "flex w-62 items-center gap-2 py-2 ps-2 pe-8");

/**
 * The overlay corner the remove control reserves on every chip.
 *
 * One class for both shapes: the two chips differ in width, and a control that
 * moved between them would read as two different affordances.
 */
const REMOVE_CORNER = cn(
	"absolute end-1 top-1 z-10",
	"bg-surface text-ink-muted hover:bg-danger-wash hover:text-danger",
	// Hide only on mouse-only systems; hybrid touch devices also need a visible target.
	"[@media(hover:hover)_and_(pointer:fine)_and_(not_(any-pointer:coarse))]:opacity-0",
	"group-hover/chip:opacity-100! group-focus-within/chip:opacity-100!",
	"disabled:bg-sunken disabled:text-ink-disabled",
);

function RemoveAttachmentButton({
	id,
	disabled,
	onRemove,
}: {
	id: string;
	disabled: boolean;
	onRemove: (id: string) => void;
}) {
	const label = t("ui.chat.composer_media.remove_attachment");
	return (
		<Tooltip content={label} disabled={disabled}>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className={REMOVE_CORNER}
				onClick={(event) => {
					event.stopPropagation();
					onRemove(id);
				}}
				disabled={disabled}
				aria-label={label}
			>
				<X aria-hidden="true" />
			</Button>
		</Tooltip>
	);
}

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
 * expanded preview is not rendered at all. If available, the failure reason
 * is exposed separately from the filename. Both degrades are stated
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

	const name = fileName || t("ui.chat.composer_media.pasted_image");
	const triggerLabelId = useId();
	const mediaError = () => setUndecodableUrl(readyUrl);

	return (
		<div className={cn(TILE, "group/chip")} data-attachment-id={id}>
			{url ? (
				// The staging row has its own scroller. A portaled preview can leave
				// that scroller, and a real trigger gives touch and keyboard the same view.
				<Dialog>
					<DialogTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							className="relative size-full overflow-hidden rounded-md p-0 focus-visible:-outline-offset-2"
							aria-labelledby={triggerLabelId}
						>
							{/* Replay masks text, not attributes (including names and tooltips). */}
							<span
								id={triggerLabelId}
								className={cn("sr-only", USER_CONTENT_CLASS)}
							>
								{t("ui.chat.attachments.expand_aria", { name })}
							</span>
							{image ? (
								<img
									src={url}
									alt=""
									onError={mediaError}
									className="size-full object-cover"
								/>
							) : (
								<video
									src={url}
									preload="metadata"
									muted
									onError={mediaError}
									className="size-full object-cover"
								/>
							)}
							<span className="absolute start-1 top-1 grid size-5 place-items-center rounded-sm bg-surface text-ink-muted">
								<Maximize2 aria-hidden="true" />
							</span>
							{fileName && (
								<span className="absolute inset-x-0 bottom-0 truncate bg-surface px-1.5 py-0.5 text-center text-ink text-meta">
									{fileName}
								</span>
							)}
						</Button>
					</DialogTrigger>
					<DialogContent
						aria-describedby={undefined}
						className={cn(
							"max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] gap-3 overflow-y-auto p-4",
							image ? "max-w-2xl" : "max-w-3xl",
							USER_CONTENT_CLASS,
						)}
					>
						<DialogTitle className="truncate pe-10">{name}</DialogTitle>
						<div className="grid min-h-0 place-items-center overflow-hidden rounded-md bg-media-surface">
							{image ? (
								<img
									src={url}
									alt=""
									className="max-h-[min(70dvh,36rem)] w-full object-contain"
								/>
							) : video ? (
								<video
									src={url}
									controls
									preload="metadata"
									muted
									className="max-h-[min(70dvh,36rem)] w-full object-contain"
								/>
							) : null}
						</div>
					</DialogContent>
				</Dialog>
			) : (
				<div
					className="flex size-full flex-col items-center justify-center gap-1 px-1 text-center text-ink-muted"
					title={reason ?? undefined}
				>
					{degraded ? (
						<>
							<span className="max-w-full truncate font-medium text-meta">
								{name}
							</span>
							<span className="line-clamp-3 text-meta leading-tight">
								{t("ui.chat.composer_media.preview_failed")}
							</span>
							{reason &&
								reason !== t("ui.chat.composer_media.preview_failed") && (
									<span className="sr-only">{reason}</span>
								)}
						</>
					) : (
						<output className="flex flex-col items-center gap-1">
							<LoaderCircle
								className="size-4 motion-safe:animate-spin"
								aria-hidden="true"
							/>
							<span className="line-clamp-2 text-meta leading-tight">
								{t("ui.projects.project_updates.preview_loading")}
							</span>
						</output>
					)}
				</div>
			)}
			<RemoveAttachmentButton id={id} disabled={disabled} onRemove={onRemove} />
		</div>
	);
});

/**
 * A non-media file's name is the preview. Keep it alongside its kind and size
 * rather than making it fit the width of a thumbnail.
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
		<div className={cn(FILE_CARD, "group/chip")} data-attachment-id={id}>
			<span className="grid size-7 shrink-0 place-items-center rounded-sm bg-surface text-ink-muted">
				<AttachmentKindIcon
					name={fileName}
					mimeType={mimeType}
					className="size-4.5"
				/>
			</span>
			<div className="flex min-w-0 flex-col gap-0.5">
				<span
					className="line-clamp-2 wrap-anywhere font-medium text-body-sm text-ink"
					title={fileName}
				>
					{fileName}
				</span>
				<span className="truncate text-ink-muted text-meta">
					{attachmentMetaLine(fileName, mimeType, size)}
				</span>
			</div>
			<RemoveAttachmentButton id={id} disabled={disabled} onRemove={onRemove} />
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
		<div className="flex min-w-0 flex-col gap-2 py-2">
			<div className="flex flex-wrap items-baseline justify-between gap-x-2 text-meta">
				<span className="flex items-baseline gap-1.5 font-medium text-ink">
					{t("ui.canvas.files.attachments")}
					<span className="font-normal text-ink-muted tabular-nums">
						{formatNumber(chips.length)}
					</span>
				</span>
				<span className="text-ink-muted" data-attachment-pending="true">
					{t("ui.chat.attachments.pending_caption")}
				</span>
			</div>
			{/* The chips name the user's files, in text and in `title` (review
			    round 1, Q3): text and attributes stay out of autocapture, text out
			    of replay. */}
			<div className={cn("flex flex-wrap gap-2", USER_CONTENT_CLASS)}>
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
