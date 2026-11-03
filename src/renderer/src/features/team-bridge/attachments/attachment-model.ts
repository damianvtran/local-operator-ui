/** Wire metadata is untrusted; neither dimensions nor state grant byte access. */
export type BridgeAttachmentDescriptor = {
	id: string;
	mime: string;
	size: number;
	state?: string;
	width?: number | null;
	height?: number | null;
};

export function isAvailableAttachment(
	attachment: BridgeAttachmentDescriptor,
): boolean {
	return attachment.state === undefined || attachment.state === "bound";
}

export function isAttachmentImage(
	attachment: BridgeAttachmentDescriptor,
): boolean {
	return attachment.mime === "image/png" || attachment.mime === "image/jpeg";
}

/** Keep the member flow's reserved geometry for every card state, before bytes.
 * Non-finite/negative dimensions must not escape into CSS or create layout shifts.
 */
export function attachmentBox(
	attachment: Pick<BridgeAttachmentDescriptor, "width" | "height"> | null,
	single: boolean,
	compact = false,
) {
	if (!single)
		return compact ? { width: 128, height: 88 } : { width: 156, height: 104 };
	const maxW = compact ? 264 : 360;
	const maxH = compact ? 176 : 240;
	const width = attachment?.width;
	const height = attachment?.height;
	if (
		!width ||
		!height ||
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width < 0 ||
		height < 0
	)
		return { width: 240, height: 160 };
	const scale = Math.min(maxW / width, maxH / height, 1);
	return {
		width: Math.max(64, Math.round(width * scale)),
		height: Math.max(64, Math.round(height * scale)),
	};
}
