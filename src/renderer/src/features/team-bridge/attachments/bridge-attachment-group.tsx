/**
 * Presentation only: resource authority stays with the caller. In particular,
 * owner-audit descriptors must never fall through to the member byte relay.
 * Image names are intentionally generic: the image contract carries no name.
 * Generic FILES (S3b `files[]`) do carry the cleaned uploader name, rendered as
 * visible text only (see `BridgeFileGroup`).
 */
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { FileIcon, FileX, ImageIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
	AttachmentKindIcon,
	attachmentSizeLabel,
	attachmentTypeLabel,
} from "../../chat/components/attachment-file-card";
import { extensionOf } from "../../chat/utils/file-kind";
import {
	ATTACHMENT_GRID_VISIBLE,
	ATTACHMENT_GROUP_MAX,
	type BridgeAttachmentDescriptor,
	type BridgeFileDescriptor,
	attachmentBox,
	attachmentFit,
	fileCardWidth,
	isAttachmentImage,
	isAvailableAttachment,
	isAvailableFile,
	splitFileNameTail,
} from "./attachment-model";
import {
	type InlineImageBox,
	InlineImageFailure,
	InlineImageOverflow,
} from "./inline-image-tile";

/**
 * Where the group puts one picture: a reserved single box, or a grid cell
 * (`box: null`, the cell's CSS sizes it). `overflow` is the `+N` the last
 * visible grid tile carries. The caller's tile renders into this slot and
 * decides nothing about layout, so the member relay and the owner audit lay
 * a set out identically.
 */
export type BridgeImageSlot = {
	box: InlineImageBox;
	fit: "cover" | "contain";
	overflow: number;
};

type Visual<T> = { attachment: T; index: number; preview: boolean };

/*
 * GRID CELLS (SPEC §3.1 "Multiple images"). Two columns, 4px gutter, square
 * cells, the whole set clipped to one 10px corner. Three images put the first
 * across both rows (a portrait crop) and stack the other two, as Slack and
 * Discord do; four is 2×2; five or more show four and the fourth says `+N`.
 * `aspect-square` makes the reserved size a function of the column width
 * alone, so nothing moves when the bytes land.
 */
function cellClass(position: number, visible: number) {
	if (visible === 3 && position === 0) return "row-span-2";
	return "aspect-square";
}

export function BridgeAttachmentGroup<T extends BridgeAttachmentDescriptor>({
	attachments,
	count = attachments.length,
	renderPreview,
	compact = false,
	files = [],
	fileCount = files.length,
}: {
	attachments: readonly T[];
	count?: number;
	compact?: boolean;
	renderPreview?: (
		attachment: T,
		index: number,
		slot: BridgeImageSlot,
	) => ReactNode;
	/** S3b generic files, rendered after the images as noninteractive chips. */
	files?: readonly BridgeFileDescriptor[];
	fileCount?: number;
}) {
	useI18nLocale();
	const fileGroup = (
		<BridgeFileGroup files={files} count={fileCount} compact={compact} />
	);
	// A count-only audit response confirms presence, not descriptor authority.
	// One opaque receipt represents it; never manufacture ids or fetch targets.
	if (attachments.length === 0 && !(count > 0))
		return files.length > 0 || fileCount > 0 ? fileGroup : null;
	/*
	 * Pictures go inline; everything that cannot be a picture here goes to a
	 * chip. An image the reader may not see (refused, expired, withheld) keeps
	 * its picture-shaped box so the transcript does not change shape around
	 * it; an available image this view will not fetch (audit without a scope),
	 * a non-image descriptor and a count-only receipt are chips, because a
	 * blank picture-sized box would promise a picture that never comes.
	 */
	const visuals: Visual<T>[] = [];
	const chips: { attachment: T | null; index: number }[] = [];
	attachments.forEach((attachment, index) => {
		const available = isAvailableAttachment(attachment);
		const preview =
			available && isAttachmentImage(attachment) && Boolean(renderPreview);
		if (preview || (!available && isAttachmentImage(attachment)))
			visuals.push({ attachment, index, preview });
		else chips.push({ attachment, index });
	});
	if (attachments.length === 0) chips.push({ attachment: null, index: 0 });
	const density = compact ? "compact" : "regular";
	const single = visuals.length === 1;
	const visible = Math.min(visuals.length, ATTACHMENT_GRID_VISIBLE);
	const overflow = visuals.length - visible;
	const listLabel = t("ui.teamBridge.attachmentCard.list", {
		count: attachments.length || count,
	});
	const renderVisual = (
		{ attachment, index, preview }: Visual<T>,
		position: number,
	) => {
		const slot: BridgeImageSlot = {
			box: single ? attachmentBox(attachment, true, compact) : null,
			fit: single ? attachmentFit(attachment) : "cover",
			overflow: position === visible - 1 ? overflow : 0,
		};
		const hidden = position >= visible;
		return (
			<li
				key={attachment.id}
				/* Images past the fourth stay mounted but hidden: the lightbox walks
				   the whole set, so their tiles must still publish their bytes. */
				hidden={hidden || undefined}
				data-bridge-attachment-card={preview ? "preview" : "unavailable"}
				className={cn(
					"group/slot relative min-w-0",
					!single && !hidden && cellClass(position, visible),
				)}
			>
				{preview && renderPreview ? (
					renderPreview(attachment, index, slot)
				) : (
					<InlineImageFailure
						box={slot.box}
						label={t("ui.teamBridge.attachments.position", {
							index: String(index + 1),
							count: String(attachments.length),
						})}
						copy={t("ui.teamBridge.attachments.unavailable")}
					/>
				)}
				{slot.overflow > 0 && <InlineImageOverflow count={slot.overflow} />}
			</li>
		);
	};
	const imageList =
		visuals.length > 0 ? (
			<ul
				aria-label={listLabel}
				style={{ maxWidth: ATTACHMENT_GROUP_MAX[density] }}
				className={cn(
					"mt-1 min-w-0",
					single
						? "flex"
						: "grid w-full grid-cols-2 gap-1 overflow-hidden rounded-md",
				)}
			>
				{visuals.map(renderVisual)}
			</ul>
		) : null;
	const chipList =
		chips.length > 0 ? (
			<ul
				aria-label={visuals.length ? undefined : listLabel}
				className="mt-1.5 flex min-w-0 flex-wrap items-start gap-2"
			>
				{chips.map(({ attachment }) => (
					<AttachmentChip
						key={attachment?.id ?? "count-only"}
						attachment={attachment}
						count={count}
						compact={compact}
					/>
				))}
			</ul>
		) : null;
	const hasFiles = files.length > 0 || fileCount > 0;
	if (!chipList && !hasFiles) return imageList;
	return (
		<>
			{imageList}
			{chipList}
			{hasFiles && fileGroup}
		</>
	);
}

/** The image types this client previews; anything else is never echoed. */
const IMAGE_TYPE = new Map([
	["image/png", "PNG"],
	["image/jpeg", "JPEG"],
]);

/*
 * THE CHIP (SPEC §3.1 "Non-image files", Slack-style): a 48px row, a kind
 * tile, a name and a `TYPE · size` line. Borderless; the fill is the extent.
 *
 * FILL IS `mediaSurface`, NOT THE SPEC'S `surface`. The spec measured the chip
 * on the channel pane once that pane moves to `canvas` (§3.2, a separate PR);
 * today the pane, and the thread pane permanently, paint `surface`, where a
 * `surface` chip would be the ground itself and vanish. Round 1 shipped
 * `elevated`, which merged into a HOVERED row (ΔE00 0.00 arcade, 1.14 gruvbox,
 * 1.21 obsidian, 1.90 everforest; agent review round 1, minor 1).
 * `mediaSurface` is the borderless-tile role the Team Bridge avatar plates
 * already rest on, held to ΔE00 3.0 off canvas, surface, elevated and rowHover
 * by `PERCEPTIBLE`'s "team bridge borderless person and agent plates" row
 * (fleet minima 4.00 / 5.96 / 7.89 / 3.70), so the chip keeps its extent on
 * every ground a message row takes. The kind tile steps the other way, to
 * `elevated` (7.89 minimum off the chip). `scripts/contrast-contract.mjs`
 * carries the ink rows and the ground-step row.
 *
 * NO HOVER STEP and NO CONTROL: a descriptor chip offers nothing to do (no
 * byte route; owner decision after #1634), and a hover colour step is this
 * app's promise that something is pressable.
 *
 * THE BORDER IS THE BOUNDARY, NOT THE FILL STEP. The fill step alone is
 * 1.10–1.12:1 against the pane, so on a dim or low-quality panel the chip stops
 * reading as a card and becomes text with a tint (design D6). `control` is the
 * composer chip's own edge token (3.43:1 light / 4.15:1 dark), the nearest
 * card boundary this app already draws, so no new token enters the palette. It
 * is one class on BOTH chip kinds: the image chip and the file chip stay the
 * same object (§4), and an image's metadata chip has the same 1.1:1 fill step
 * on the same ground.
 */
const CHIP_CLASS =
	"flex h-12 min-w-0 max-w-full items-center gap-2.5 rounded-md border border-control bg-media-surface px-2.5";
const CHIP_TILE_CLASS =
	"flex size-8 shrink-0 items-center justify-center rounded-sm bg-elevated";

/**
 * A descriptor that will not be drawn inline: an available image this view
 * does not fetch, a non-image descriptor, or a count-only receipt. The name is
 * generic on purpose (the image contract carries no name), and the meta line
 * names only a type this client knows plus a human size - never the raw mime,
 * never "N bytes".
 */
function AttachmentChip({
	attachment,
	count,
	compact,
}: {
	attachment: BridgeAttachmentDescriptor | null;
	count: number;
	compact: boolean;
}) {
	const available = attachment !== null && isAvailableAttachment(attachment);
	const type = attachment ? IMAGE_TYPE.get(attachment.mime) : undefined;
	const size =
		available && attachment && Number.isSafeInteger(attachment.size)
			? attachmentSizeLabel(attachment.size > 0 ? attachment.size : null)
			: null;
	const name =
		attachment === null
			? t("ui.teamBridge.attachmentCard.list", { count })
			: type
				? t("ui.chat.canonical.image_label")
				: t("ui.teamBridge.attachmentCard.file");
	const meta = !available
		? attachment === null
			? null
			: t("ui.teamBridge.attachmentCard.unavailable")
		: type && size
			? t("ui.chat.attachments.file_meta", { type, size })
			: (size ?? type ?? null);
	const Icon =
		attachment === null || type ? ImageIcon : available ? FileIcon : FileX;
	return (
		<li
			/* The file chips' own width, so both chip kinds line up in a column. */
			style={{ width: fileCardWidth(compact) }}
			data-bridge-attachment-card={
				attachment === null || available ? "metadata" : "unavailable"
			}
			/* The view cannot show the picture; say so to a pointer reader too. */
			title={
				available && type
					? t("ui.teamBridge.attachmentCard.metadata_only")
					: undefined
			}
			className={CHIP_CLASS}
		>
			<span className={CHIP_TILE_CLASS}>
				<Icon size={16} aria-hidden="true" className="text-ink-muted" />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate font-medium text-[13px] text-ink">
					{name}
				</span>
				{meta && (
					<span dir="auto" className="block truncate text-ink-dim text-meta-sm">
						{meta}
					</span>
				)}
			</span>
		</li>
	);
}

/* The class is a server LABEL, mapped onto the chat card's icon vocabulary so a
 * PDF reads the same glyph here as in an agent chat; never a content type that
 * is served or trusted. */
const CLASS_MIME = new Map<string, string>([
	["pdf", "application/pdf"],
	["text", "text/plain"],
	["container", "application/zip"],
]);
/**
 * One file name as a flex row: the head shrinks and carries the single ellipsis,
 * the tail (its extension or ending, see `splitFileNameTail`) never shrinks, so
 * the extension stays whole at any card width.
 *
 * WHY NO CHARACTER BUDGET (design D2): pre-truncating with
 * `middleTruncateFileName` and then letting `text-overflow` clip the head put
 * TWO ellipses on one 240px card (`Customer onboa…list….docx`) and detached the
 * extension from the name it belonged to. The head holds the whole name now and
 * CSS is the only truncator: one ellipsis, measured against the width the card
 * actually gets instead of an estimated code-point count.
 *
 * BIDI: the row takes its direction from the whole name (`dir="auto"` reads the
 * first strong character of its descendants), so an Arabic name lays its parts
 * out right to left. Isolation alone does NOT hold a `.` in place: the full stop
 * is a neutral, and inside an RTL run it takes that run's direction, so `.csv`
 * painted as `csv.` (design D3). A tail that IS an extension therefore declares
 * `dir="ltr"` — an extension is Latin-ordered data, not a word — which pins the
 * dot to the left of the letters, while the isolate keeps the tail whole and out
 * of its neighbours' ordering. A tail that is instead the last few characters of
 * an extension-less name keeps the row's direction: those are letters of the
 * name's own script, and pinning them LTR would print the fragment reversed.
 * D9: text only, never an aria-label, title or id.
 */
function FileNameLabel({
	label,
	available,
}: {
	label: string;
	available: boolean;
}) {
	const { head, tail } = splitFileNameTail(label);
	return (
		<span
			dir="auto"
			className={cn(
				"flex min-w-0 font-medium",
				available ? "text-ink" : "text-ink-muted",
			)}
		>
			<span
				data-file-name-part="head"
				className="min-w-0 truncate"
				style={{ unicodeBidi: "isolate" }}
			>
				{head}
			</span>
			{tail && (
				<span
					data-file-name-part="tail"
					/* Only an extension is direction-free data; see the note above. */
					dir={tail.startsWith(".") ? "ltr" : undefined}
					className="shrink-0 whitespace-pre"
					style={{ unicodeBidi: "isolate" }}
				>
					{tail}
				</span>
			)}
		</span>
	);
}

/**
 * Generic files (S3b) as noninteractive metadata cards: a class glyph, the
 * cleaned name, and `TYPE · size`. There is deliberately NO control on a card:
 * no download, open or Save As (removed in #1634 until a download contract is
 * decided), so a card is a plain list item a reader cannot act on. Because it is
 * inert by DECISION and not by omission, the available card states that limit on
 * the same registers the metadata image chip already uses (design D1) — see
 * `limit` below. A card that silently does nothing reads as broken next to an
 * image tile that offers Open and Save.
 *
 * D9: the name is visible text inside `dir="auto"` (an Arabic or Hebrew name
 * lays out by its own direction inside any UI locale). It never appears in an
 * aria-label, id, data attribute or log; the list's accessible name is a count.
 * A list with no descriptors but a positive `count` is one count-only receipt.
 */
export function BridgeFileGroup({
	files,
	count = files.length,
	compact = false,
}: {
	files: readonly BridgeFileDescriptor[];
	count?: number;
	compact?: boolean;
}) {
	useI18nLocale();
	if (files.length === 0 && !(count > 0)) return null;
	const width = fileCardWidth(compact);
	const items: readonly (BridgeFileDescriptor | null)[] = files.length
		? files
		: [null];
	return (
		<ul
			aria-label={t("ui.teamBridge.fileCard.list", {
				count: files.length || count,
			})}
			className="mt-1.5 flex min-w-0 flex-wrap items-start gap-2"
		>
			{items.map((file) => {
				const available = file !== null && isAvailableFile(file);
				const name = file?.displayName ?? null;
				const extension = name ? extensionOf(name) : null;
				const fileClass = file?.fileClass ?? "";
				const kind = CLASS_MIME.has(fileClass) ? fileClass : "other";
				/* The chat card's own `PDF · 2.4 MB` vocabulary when the name has an
				 * extension; otherwise the server class, in words. */
				const type =
					name && extension
						? attachmentTypeLabel(name)
						: t("ui.teamBridge.fileCard.kind", { kind });
				/* A nameless card titles itself `File`, and the `other` class words read
				 * back as that same sentence, so a nameless class-less file printed
				 * `File` above `File · 25.0 MB` (design D4). Suppress the repeated half;
				 * the size is the only fact that card holds. */
				const typeRepeatsTitle = !name && kind === "other";
				const size =
					available && file && Number.isSafeInteger(file.size) && file.size > 0
						? attachmentSizeLabel(file.size)
						: null;
				/* D4 would have this say a FILE is unavailable rather than an
				 * "attachment". That phrase is new English copy, which cannot land alone:
				 * ledger-check fails every locale whose English source moved, and
				 * check-i18n:coverage fails a key a shipped locale lacks. It waits for the
				 * translator + delta-audit round rather than half-landing here. */
				const meta = !available
					? t("ui.teamBridge.attachmentCard.unavailable")
					: typeRepeatsTitle
						? size
						: size
							? t("ui.chat.attachments.file_meta", { type, size })
							: type;
				/* D1: the card is inert by decision (#1634), not by omission, so it says so
				 * on the same register the metadata image chip already uses — the
				 * `metadata_only` sentence, as a pointer tooltip (no control, no download
				 * route, nothing to press). `aria-description` would be the richer
				 * channel but this tree's biome config rejects that attribute, and a
				 * second copy of the sentence in an `sr-only` span would have to be
				 * translated twice. */
				const limit = available
					? t("ui.teamBridge.attachmentCard.metadata_only")
					: undefined;
				return (
					<li
						key={file?.id ?? "count-only"}
						style={{ width }}
						data-bridge-file-card={
							file === null
								? "count-only"
								: available
									? "metadata"
									: "unavailable"
						}
						/* The shared chip look (see `CHIP_CLASS`): the `control` border is
						   the boundary, the fill only tints it; no hover step, because
						   nothing here is a control. */
						title={limit}
						className={cn(CHIP_CLASS, "gap-2.5")}
					>
						<span className={cn(CHIP_TILE_CLASS, "text-ink-muted")}>
							{file === null ? (
								<FileIcon size={16} aria-hidden="true" />
							) : available ? (
								<AttachmentKindIcon
									name={name ?? ""}
									mimeType={CLASS_MIME.get(fileClass)}
									className="size-4"
								/>
							) : (
								<FileX size={16} aria-hidden="true" />
							)}
						</span>
						<span className="min-w-0 flex-1 text-[13px]">
							{file !== null && name ? (
								<FileNameLabel label={name} available={available} />
							) : (
								<span
									dir="auto"
									className={cn(
										"block truncate font-medium",
										available ? "text-ink" : "text-ink-muted",
									)}
								>
									{file === null
										? t("ui.teamBridge.fileCard.list", { count })
										: t("ui.teamBridge.attachmentCard.file")}
								</span>
							)}
							{file !== null && meta && (
								<span className="block truncate text-ink-dim text-meta-sm">
									{meta}
								</span>
							)}
						</span>
					</li>
				);
			})}
		</ul>
	);
}
