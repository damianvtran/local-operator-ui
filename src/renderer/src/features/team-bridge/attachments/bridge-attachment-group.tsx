/**
 * Presentation only: resource authority stays with the caller. In particular,
 * owner-audit descriptors must never fall through to the member byte relay.
 * Names are intentionally generic until the wire contract supplies a safe name.
 */
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { FileIcon, ImageIcon, ImageOff } from "lucide-react";
import type { ReactNode } from "react";

import {
	type BridgeAttachmentDescriptor,
	attachmentBox,
	isAttachmentImage,
	isAvailableAttachment,
} from "./attachment-model";

export function BridgeAttachmentGroup<T extends BridgeAttachmentDescriptor>({
	attachments,
	count = attachments.length,
	renderPreview,
	renderAction,
	compact = false,
}: {
	attachments: readonly T[];
	count?: number;
	compact?: boolean;
	renderPreview?: (attachment: T, index: number) => ReactNode;
	renderAction?: (attachment: T, index: number) => ReactNode;
}) {
	useI18nLocale();
	// A count-only audit response confirms presence, not descriptor authority.
	// One opaque receipt represents it; never manufacture ids or fetch targets.
	if (attachments.length === 0 && !(count > 0)) return null;
	const items: readonly (T | null)[] = attachments.length
		? attachments
		: [null];
	return (
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
							{available && attachment && renderAction?.(attachment, index)}
						</div>
					</li>
				);
			})}
		</ul>
	);
}
