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
import { FileIcon, FileX, ImageIcon, ImageOff } from "lucide-react";
import type { ReactNode } from "react";

import {
	AttachmentKindIcon,
	attachmentSizeLabel,
	attachmentTypeLabel,
} from "../../chat/components/attachment-file-card";
import { extensionOf } from "../../chat/utils/file-kind";
import {
	type BridgeAttachmentDescriptor,
	type BridgeFileDescriptor,
	attachmentBox,
	fileCardWidth,
	isAttachmentImage,
	isAvailableAttachment,
	isAvailableFile,
	middleTruncateFileName,
} from "./attachment-model";

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
	renderPreview?: (attachment: T, index: number) => ReactNode;
	/** S3b generic files, rendered after the images as noninteractive cards. */
	files?: readonly BridgeFileDescriptor[];
	fileCount?: number;
}) {
	useI18nLocale();
	/* Images first, files second, as two lists: the image list's markup is the
	 * pre-S3b markup byte for byte (the channel parity golden pins it), and a
	 * file-less message renders exactly that and nothing else. */
	const fileGroup = (
		<BridgeFileGroup files={files} count={fileCount} compact={compact} />
	);
	// A count-only audit response confirms presence, not descriptor authority.
	// One opaque receipt represents it; never manufacture ids or fetch targets.
	if (attachments.length === 0 && !(count > 0))
		return files.length > 0 || fileCount > 0 ? fileGroup : null;
	const items: readonly (T | null)[] = attachments.length
		? attachments
		: [null];
	const imageList = (
		<ul
			aria-label={t("ui.teamBridge.attachmentCard.list", {
				count: attachments.length || count,
			})}
			className="mt-1.5 flex min-w-0 flex-wrap items-start gap-2"
		>
			{items.map((attachment, index) => {
				const available =
					attachment !== null && isAvailableAttachment(attachment);
				const image = attachment !== null && isAttachmentImage(attachment);
				const preview =
					available && image && attachment
						? renderPreview?.(attachment, index)
						: null;
				const box = attachmentBox(attachment, items.length === 1, compact);
				const Icon = !available ? ImageOff : image ? ImageIcon : FileIcon;
				return (
					<li
						key={attachment?.id ?? "count-only"}
						style={{ width: box.width }}
						data-bridge-attachment-card={
							available ? (preview ? "preview" : "metadata") : "unavailable"
						}
						className={cn(
							"min-w-0 max-w-full overflow-hidden rounded-md border border-control bg-surface",
						)}
					>
						{preview ? (
							<div className="max-w-full overflow-hidden">{preview}</div>
						) : (
							<div
								className="flex max-w-full items-center justify-center bg-sunken text-ink-muted"
								style={{ height: box.height }}
							>
								<Icon size={24} aria-hidden="true" />
							</div>
						)}
						<div className="min-w-0 space-y-0.5 p-2 text-[12px] text-ink-muted">
							<p className="font-medium text-ink">
								{attachment
									? t("ui.teamBridge.attachmentCard.file")
									: t("ui.teamBridge.attachmentCard.list", { count })}
							</p>
							{available &&
								attachment &&
								Number.isSafeInteger(attachment.size) &&
								attachment.size > 0 && (
									<p dir="auto">
										{t("ui.teamBridge.attachmentCard.bytes", {
											size: attachment.size,
										})}
									</p>
								)}
							{!preview && (
								<p className="max-w-[28ch] break-words">
									{t(
										available
											? "ui.teamBridge.attachmentCard.metadata_only"
											: "ui.teamBridge.attachmentCard.unavailable",
									)}
								</p>
							)}
						</div>
					</li>
				);
			})}
		</ul>
	);
	if (files.length === 0 && !(fileCount > 0)) return imageList;
	return (
		<>
			{imageList}
			{fileGroup}
		</>
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
/* Server names are <= 120 scalars; ~32 fit a regular card on one line, and the
 * `truncate` class remains the width backstop for wide glyphs. */
const NAME_BUDGET = { regular: 34, compact: 28 } as const;

/**
 * Generic files (S3b) as noninteractive metadata cards: a class glyph, the
 * cleaned name, and `TYPE · size`. There is deliberately NO control on a card:
 * no download, open or Save As (removed in #1634 until a download contract is
 * decided), so a card is a plain list item a reader cannot act on.
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
				/* The chat card's own `PDF · 2.4 MB` vocabulary when the name has an
				 * extension; otherwise the server class, in words. */
				const type =
					name && extension
						? attachmentTypeLabel(name)
						: t("ui.teamBridge.fileCard.kind", {
								kind: CLASS_MIME.has(fileClass) ? fileClass : "other",
							});
				const size =
					available && file && Number.isSafeInteger(file.size) && file.size > 0
						? attachmentSizeLabel(file.size)
						: null;
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
						className="flex min-w-0 max-w-full items-center gap-2 rounded-md border border-control bg-surface p-2 text-[12px]"
					>
						<span
							className={cn(
								"flex size-8 shrink-0 items-center justify-center rounded-sm bg-sunken",
								available ? "text-ink" : "text-ink-muted",
							)}
						>
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
						<span className="min-w-0 flex-1">
							<span
								dir="auto"
								className={cn(
									"block truncate font-medium",
									available ? "text-ink" : "text-ink-muted",
								)}
							>
								{file === null
									? t("ui.teamBridge.fileCard.list", { count })
									: name
										? middleTruncateFileName(
												name,
												NAME_BUDGET[compact ? "compact" : "regular"],
											)
										: t("ui.teamBridge.attachmentCard.file")}
							</span>
							{file !== null && (
								<span className="block truncate text-ink-muted">
									{available
										? size
											? t("ui.chat.attachments.file_meta", { type, size })
											: type
										: t("ui.teamBridge.attachmentCard.unavailable")}
								</span>
							)}
						</span>
					</li>
				);
			})}
		</ul>
	);
}
