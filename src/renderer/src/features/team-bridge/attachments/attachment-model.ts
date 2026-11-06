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

/*
 * INLINE IMAGE GEOMETRY (Team Bridge visual refresh, SPEC §3.1 / D1). The
 * operator's report was that images sat in bordered "File" cards; Slack and
 * Discord show the picture and nothing else, at a size that reads as content.
 * One picture gets up to 400×320 in the channel and 280×220 in the compact
 * thread pane; a set lays out as a 2-column grid no wider than the same 400 /
 * 280, with a 4px gutter (so a square cell is at most (400 - 4) / 2 = 198).
 *
 * Every number here is decided from the DESCRIPTOR, before any byte arrives:
 * the reserved box is the loading state, and a box that changed when the
 * picture decoded would move the message below it and fight the list's
 * stick-to-bottom anchor.
 */
export const ATTACHMENT_GROUP_MAX = { regular: 400, compact: 280 } as const;
const SINGLE_MAX = {
	regular: { width: 400, height: 320 },
	compact: { width: 280, height: 220 },
} as const;
/** What a picture with no (or garbage) dimensions reserves. */
const UNKNOWN_BOX = { width: 240, height: 160 } as const;
/** Grid tiles shown before the last visible one turns into `+N`. */
export const ATTACHMENT_GRID_VISIBLE = 4;

function validDimensions(
	attachment: Pick<BridgeAttachmentDescriptor, "width" | "height"> | null,
): { width: number; height: number } | null {
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
		return null;
	return { width, height };
}

/**
 * How the picture fills its reserved box. `cover` when the box IS the
 * picture's own ratio (the scale math below keeps it), so cover crops
 * nothing. `contain` - a letterbox on `bg-media-surface` - when the ratio is
 * extreme (wider than 2.5:1 or taller than 1:2.5): the 64px floor then makes
 * the box squarer than the picture, and cover would crop a panorama down to
 * a strip of its middle. Unknown dimensions also contain: the 240×160 box was
 * reserved blind, and growing it to the decoded size after it painted is
 * exactly the scroll jump the reservation exists to prevent.
 */
export function attachmentFit(
	attachment: Pick<BridgeAttachmentDescriptor, "width" | "height"> | null,
): "cover" | "contain" {
	const size = validDimensions(attachment);
	if (!size) return "contain";
	const ratio = size.width / size.height;
	return ratio > 2.5 || ratio < 0.4 ? "contain" : "cover";
}

/** Keep the member flow's reserved geometry for every card state, before bytes.
 * Non-finite/negative dimensions must not escape into CSS or create layout shifts.
 * `single: false` returns one square grid cell at the group's full width; the
 * rendered grid sizes cells with CSS so a narrower column shrinks them evenly.
 */
export function attachmentBox(
	attachment: Pick<BridgeAttachmentDescriptor, "width" | "height"> | null,
	single: boolean,
	compact = false,
) {
	const density = compact ? "compact" : "regular";
	if (!single) {
		const cell = (ATTACHMENT_GROUP_MAX[density] - 4) / 2;
		return { width: cell, height: cell };
	}
	const maxW = SINGLE_MAX[density].width;
	const maxH = SINGLE_MAX[density].height;
	const size = validDimensions(attachment);
	if (!size) return { ...UNKNOWN_BOX };
	const { width, height } = size;
	const scale = Math.min(maxW / width, maxH / height, 1);
	return {
		width: Math.max(64, Math.round(width * scale)),
		height: Math.max(64, Math.round(height * scale)),
	};
}

/**
 * A generic FILE on a message (agent-server S3b `files[]`), kept apart from
 * `BridgeAttachmentDescriptor` because the server keeps the two apart: images
 * may be previewed through the byte relay, files never are (the hub marks them
 * `download_only`). Files were metadata only after #1634; the operator's
 * decision a-fdf0 added ONE action, Save, which the CALLER commissions through
 * its own authority (member relay in a thread, owner-audit relay in the audit).
 * Nothing here grants or implies byte access: a descriptor is still only what
 * the card draws and which Save it may offer.
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
	/** The retention sweeper's deadline, when the server sends one (ISO time). */
	expiresAt: string | null;
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
	expires_at?: string | null;
}): BridgeFileDescriptor {
	const name = file.display_name?.trim();
	return {
		id: file.id,
		fileClass: file.class ?? "",
		size: typeof file.size === "number" ? file.size : 0,
		displayName: name ? name : null,
		state: file.state ?? "",
		expiresAt: file.expires_at ?? null,
	};
}

export function isAvailableFile(file: BridgeFileDescriptor): boolean {
	return file.state === "bound";
}

/**
 * What a file card IS before anyone presses anything. `expired` is the sweeper's
 * terminal state OR a bound file whose stated deadline has passed: the hub
 * answers a late read with the same uniform 404 as a refusal, so the deadline is
 * the only way the card can say "expired" rather than "unavailable" - and it is
 * read fail-safe: an unparseable deadline is ignored, never treated as expired
 * or as a grant. Every other non-bound state is `unavailable` (fail closed).
 */
export type BridgeFileView = "available" | "expired" | "unavailable";
export function fileView(
	file: BridgeFileDescriptor,
	now: number = Date.now(),
): BridgeFileView {
	if (file.state === "expired") return "expired";
	if (!isAvailableFile(file)) return "unavailable";
	const deadline = file.expiresAt ? Date.parse(file.expiresAt) : Number.NaN;
	/* The hub's `expires_at` is a non-pointer Go time (agent-server
	 * `responses.BridgeFile`), so an unset deadline arrives as the zero time
	 * `0001-01-01T00:00:00Z`: no deadline, not "expired two millennia ago". A
	 * bound file's real one is bind time + 400 days (S3b "Retention"), so only a
	 * deadline after the Unix epoch is read as one. */
	if (!(deadline > 0)) return "available";
	return deadline <= now ? "expired" : "available";
}

/*
 * WHY A SAVE FAILED, as the card words it. The relay's statuses are closed:
 * main restates an over-ceiling file as 413 (its own stream cap, or core's
 * declared `attachment_too_large`), so `too_large` is exact. A transport
 * failure (no status), a timeout, a rate limit or a 5xx is `failed`: the
 * reader may try again. Everything else - 401/403, the hub's uniform 404
 * (gone, expired, not a member, other tenant), 409 account change, 410, 422 -
 * is `unavailable`: an authenticated refusal is never offered as a retry and
 * never explained beyond "unavailable" (the D7 rule images already follow).
 */
export type BridgeFileSaveFailure = "unavailable" | "too_large" | "failed";
export function fileSaveFailure(status: number | null): BridgeFileSaveFailure {
	if (status === 413) return "too_large";
	if (status === null || status === 408 || status === 429 || status >= 500)
		return "failed";
	return "unavailable";
}

/* Characters no desktop file system takes in a name (controls handled apart). */
const UNSAFE_NAME = /[\\/:*?"<>|]/g;
/* Leading/trailing spaces and dots: a hidden file, or a name Windows refuses. */
const NAME_EDGES = /^[\s.]+|[\s.]+$/g;
const HAS_MEANING = /[^_]/;
const CLASS_EXTENSION = new Map([
	["pdf", ".pdf"],
	["text", ".txt"],
	["container", ".zip"],
]);

/**
 * The name a save dialog proposes. The uploader's `display_name` when there is
 * one - the name the reader sees on the card - reduced to one path segment
 * with nothing a file system refuses; otherwise `file-N` plus the extension the
 * server's class implies (`other` gets none rather than a guessed one).
 *
 * NEVER the server's `Content-Disposition` name (`attachment.bin`): that is a
 * fixed placeholder for a direct navigation, and main never forwards it. The
 * result is handed to the platform dialog only; it is message content and is
 * never logged or put in an attribute (D9).
 */
export function fileSaveName(
	file: BridgeFileDescriptor,
	index: number,
): string {
	// C0/C1 controls by code point: a regex range over them is unreadable.
	const cleaned = Array.from(file.displayName ?? "", (character) => {
		const code = character.codePointAt(0) ?? 0;
		return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? "_" : character;
	})
		.join("")
		.replace(UNSAFE_NAME, "_")
		.replace(NAME_EDGES, "");
	if (cleaned && HAS_MEANING.test(cleaned)) return cleaned;
	return `file-${index + 1}${CLASS_EXTENSION.get(file.fileClass) ?? ""}`;
}

/**
 * A file name shortened IN THE MIDDLE to at most `max` code points, keeping the
 * extension end readable (`Quarterly board…summary.pdf`), because the two ends
 * are what a person recognises a file by. CSS can only ellipsise one end, so
 * this is a character budget. Code-point based (`Array.from`), not UTF-16 `slice`
 * like `middleTruncate` in `sent-file-card.tsx`: a name is arbitrary user text
 * and cutting through a surrogate pair would print a broken glyph. Server names
 * are already cleaned of bidi/format controls and bounded to 120 scalars.
 *
 * NOT USED BY THE TEAM BRIDGE FILE CARD (design D2). That card needs the tail
 * protected AND the head ellipsised to its real width; a code-point budget does
 * the first while guessing at the second, and passed through `truncate` it
 * produced two ellipses (`Customer onboa…list….docx`). The card now hands
 * `splitFileNameTail` the whole name and lets CSS own the single truncation.
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
 * Split a display label into a shrinkable HEAD and a protected TAIL, so the card
 * can let CSS ellipsise only the head while the part a person identifies a file
 * by stays visible (QA Q1 / design D1 / UX U2: an end-ellipsis on the whole name
 * clipped `.docx`, and CJK or emoji tails). A character budget cannot do it:
 * glyph widths vary, so a 34-code-point label still overflows a 182px slot — so
 * since design D2 the card passes the WHOLE name here and lets CSS measure.
 *
 * Direction is not decided here. The card paints the parts in the name's own
 * order and pins the TAIL to `ltr`, because a `.` inside an RTL run reorders to
 * `csv.` (design D3).
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

/** Chip width for a file row: the 320px Slack-style chip at regular density
 * (SPEC §3.1), capped at the column by the caller's `min(…, 100%)`; narrower
 * in compact so a chip still fits the ~272px thread and audit columns whole. */
export function fileCardWidth(compact: boolean): number {
	return compact ? 240 : 320;
}
