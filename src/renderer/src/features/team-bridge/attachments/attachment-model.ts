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

/**
 * A generic FILE on a message (agent-server S3b `files[]`), kept apart from
 * `BridgeAttachmentDescriptor` because the server keeps the two apart: images
 * may be previewed through the byte relay, files never are in this client (no
 * preview, no download, no Save As - owner decision after #1634). A file card
 * is metadata only, so nothing here grants or implies byte access.
 *
 * `displayName` is message content shown to the authorized human as visible
 * text. It must never reach an aria-label, a DOM id, a data attribute or a log
 * (the D9 rule in `team-bridge-attachments.tsx`).
 */
export type BridgeFileDescriptor = {
	id: string;
	/** Server byte-sniffed LABEL (`pdf`/`text`/`container`/`other`), not a safety claim. */
	fileClass: string;
	size: number;
	displayName: string | null;
	state: string;
};

/** The two wire shapes (member `files[]`, owner-audit `files[]`) normalized into
 * one descriptor, so the card cannot drift between the thread and the audit. A
 * missing state is NOT treated as bound (unlike historical image descriptors):
 * files only exist from S3b on, which always sends a state, so absence is a
 * malformed row and fails closed to the unavailable card. */
export function toBridgeFileDescriptor(file: {
	id: string;
	class?: string | null;
	size?: number | null;
	display_name?: string | null;
	state?: string | null;
}): BridgeFileDescriptor {
	const name = file.display_name?.trim();
	return {
		id: file.id,
		fileClass: file.class ?? "",
		size: typeof file.size === "number" ? file.size : 0,
		displayName: name ? name : null,
		state: file.state ?? "",
	};
}

export function isAvailableFile(file: BridgeFileDescriptor): boolean {
	return file.state === "bound";
}

/**
 * A file name shortened IN THE MIDDLE to at most `max` code points, keeping the
 * extension end readable (`Quarterly board…summary.pdf`), because the two ends
 * are what a person recognises a file by. CSS can only ellipsise one end, so
 * this is a character budget; the card then splits it with `splitFileNameTail`
 * so the width backstop can only ellipsise the head. Code-point based (`Array.from`), not UTF-16 `slice` like
 * `middleTruncate` in `sent-file-card.tsx`: a name is arbitrary user text and
 * cutting through a surrogate pair would print a broken glyph. Server names are
 * already cleaned of bidi/format controls and bounded to 120 scalars.
 */
export function middleTruncateFileName(name: string, max: number): string {
	const chars = Array.from(name);
	if (chars.length <= max) return name;
	if (max <= 1) return "…".slice(0, Math.max(0, max));
	const tail = Math.floor((max - 1) / 2);
	const head = max - 1 - tail;
	return `${chars.slice(0, head).join("")}…${chars.slice(-tail).join("")}`;
}

/**
 * Split an already-bounded display label into a shrinkable HEAD and a protected
 * TAIL, so the card can let CSS ellipsise only the head while the part a
 * person identifies a file by stays visible (QA Q1 / design D1 / UX U2: an
 * end-ellipsis on the whole name clipped `.docx`, and CJK or emoji tails, that
 * `middleTruncateFileName` had kept). The character budget alone cannot do it:
 * glyph widths vary, so a 34-code-point label still overflows a 182px slot.
 *
 * The tail is the extension (dot included) when it is short enough to be one,
 * otherwise the last few code points of a long name, so an extension-less name
 * keeps its ending too. Both bounds keep the tail from starving the head; the
 * tail never includes the `…` that middle truncation inserted. Code-point
 * based for the same reason as `middleTruncateFileName`.
 */
const MAX_EXTENSION_TAIL = 9;
const FALLBACK_TAIL = 4;
export function splitFileNameTail(label: string): {
	head: string;
	tail: string;
} {
	const chars = Array.from(label);
	const dot = chars.lastIndexOf(".");
	let cut = chars.length;
	if (dot > 0 && chars.length - dot <= MAX_EXTENSION_TAIL) cut = dot;
	else if (chars.length > FALLBACK_TAIL * 2) cut = chars.length - FALLBACK_TAIL;
	const ellipsis = chars.lastIndexOf("…");
	if (ellipsis >= cut) cut = ellipsis + 1;
	if (cut >= chars.length || cut <= 0) return { head: label, tail: "" };
	return {
		head: chars.slice(0, cut).join(""),
		tail: chars.slice(cut).join(""),
	};
}

/** Card width for a file row: wide enough for a ~28-character name at regular
 * density, and narrower in compact so two cards share a 272px audit column. */
export function fileCardWidth(compact: boolean): number {
	return compact ? 208 : 240;
}
