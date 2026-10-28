/**
 * The files and pictures the PERSON attached to one conversation, as one list.
 *
 * TWO SOURCES, ONE LIST. The backend inventory
 * (`GET .../user-attachments`, `features.session_attachments`) has every
 * attachment in the journal, including the first-turn PDF of a long
 * conversation whose rows were never paged in. The live transcript records
 * carry what was sent since that read (a new send must appear without a
 * reload). This module unions the two by a stable key, so neither source can
 * duplicate or hide the other's entry.
 *
 * DEGRADED, NEVER EMPTY-CLAIMING. An older backend (capability absent), a
 * peer's conversation or an undecodable archive leaves only the loaded rows;
 * `complete: false` tells the section to say the list may be partial instead
 * of presenting it as everything.
 *
 * METADATA ONLY. Bytes resolve through the existing digest route
 * (`sessions.attachment`); nothing here carries base64 except a live image
 * the owner has not yet stored, whose `data` is the only way to paint it.
 */

import type {
	TranscriptDocument,
	TranscriptImage,
	TranscriptRecord,
} from "./transcript-reducer";

/** One item of the backend inventory (`docs/DESKTOP_API.md`, the user-attachment inventory). */
export type UserAttachmentWire = {
	message_id: string;
	ts?: number;
	index?: number;
	kind: "document" | "image";
	attachment?: string | null;
	filename?: string | null;
	mime_type?: string;
	bytes?: number | null;
	path?: string | null;
	/** Whether the ORIGIN path is still a file; `null` with no origin. */
	exists?: boolean | null;
	stored_path?: string | null;
	stored?: boolean;
	injection?: "native" | "extracted" | "reference" | null;
	/**
	 * `false` when the backend's sensitive-path gate refuses to copy this file
	 * out (`~/.ssh/id_rsa`, `.env`; core PR #3042 QA round 3, Q1): the row is
	 * listed but its materialise route answers 404. ABSENT on an older daemon,
	 * which never had the gate - there the capability bit alone decides.
	 */
	materialisable?: boolean;
};

export type UserAttachmentsListing = {
	state: "ready" | "unsupported" | "unavailable";
	items: UserAttachmentWire[];
	truncated?: boolean;
};

/**
 * Where an attachment's bytes still are, the three outcomes the missing state
 * must tell apart (operator requirement 3):
 *
 * - `present`: the origin path is still a file (or there is no origin and the
 *   retained copy is here - a pasted screenshot);
 * - `retained`: the origin is gone but the attachment store kept a copy;
 * - `gone`: neither the origin nor the retained copy exists;
 * - `unknown`: nothing has answered yet (a live send before the inventory
 *   re-read, or a degraded source) - never painted as missing.
 */
export type AttachmentAvailability =
	| "present"
	| "retained"
	| "gone"
	| "unknown";

export type UserAttachment = {
	/** Stable across sources: `${messageId}:${digest ?? index}`. */
	key: string;
	messageId: string;
	/** Milliseconds since the epoch, the transcript's own unit. */
	ts: number;
	kind: "document" | "image";
	digest: string | null;
	/** Inline base64 for a live image the store has not stored yet. */
	data: string | null;
	filename: string | null;
	mimeType: string;
	bytes: number | null;
	path: string | null;
	storedPath: string | null;
	availability: AttachmentAvailability;
	/**
	 * The block's position in its message's content (the inventory's `index`),
	 * so a message's rows keep send order however the list is sorted. Set on
	 * EVERY inventory row and on no loaded row, which is how
	 * `attachmentRefusals` tells the backend's judgements from rows it merely
	 * flagged.
	 */
	index?: number;
	/**
	 * The backend's per-row materialise verdict: `false` = never copy it out
	 * (no Open file / Open folder / Copy file path / Show in canvas over a
	 * copy); `null` = no verdict (a loaded row, or a daemon without the field),
	 * so the `session_attachments` capability alone governs, as before.
	 */
	materialisable: boolean | null;
};

export type UserAttachmentsView = {
	items: UserAttachment[];
	/** The backend read the whole journal; `false` = loaded rows only. */
	complete: boolean;
	truncated: boolean;
};

function availabilityOf(item: UserAttachmentWire): AttachmentAvailability {
	/*
	 * A REFUSED row is present only through its SAVED COPY (UX R3 U16). Its
	 * origin is exactly what the app may never read or hand to the OS, so an
	 * origin that still exists is no way in: with the copy pruned, `present`
	 * painted a normal row whose press opened "No longer in the session".
	 * Without the copy it is `gone` - the inert state - whatever the origin does.
	 */
	if (item.materialisable === false && !item.stored) return "gone";
	if (item.exists === true) return "present";
	if (item.exists === false) return item.stored ? "retained" : "gone";
	// No origin path (a pasted picture): the retained copy IS the attachment.
	return item.stored ? "present" : "gone";
}

const keyOf = (messageId: string, digest: string | null, index: number) =>
	`${messageId}:${digest ?? `#${index}`}`;

/** Project one backend item. Malformed items (no message id, no kind) drop out. */
export function fromWire(item: UserAttachmentWire): UserAttachment | null {
	if (!item || typeof item.message_id !== "string" || !item.message_id)
		return null;
	if (item.kind !== "document" && item.kind !== "image") return null;
	const digest =
		typeof item.attachment === "string" && item.attachment
			? item.attachment
			: null;
	return {
		key: keyOf(item.message_id, digest, item.index ?? 0),
		messageId: item.message_id,
		ts: Math.round((typeof item.ts === "number" ? item.ts : 0) * 1000),
		kind: item.kind,
		digest,
		data: null,
		filename: item.filename ?? null,
		mimeType:
			item.mime_type ??
			(item.kind === "image" ? "image/png" : "application/octet-stream"),
		bytes: typeof item.bytes === "number" ? item.bytes : null,
		path: item.path ?? null,
		storedPath: item.stored_path ?? null,
		availability: availabilityOf(item),
		index: typeof item.index === "number" ? item.index : 0,
		materialisable:
			typeof item.materialisable === "boolean" ? item.materialisable : null,
	};
}

function fromDocument(
	record: { id: string; ts: number },
	document: TranscriptDocument,
	index: number,
): UserAttachment {
	return {
		key: keyOf(record.id, document.attachment, index),
		messageId: record.id,
		ts: record.ts,
		kind: "document",
		digest: document.attachment,
		data: null,
		filename: document.filename,
		mimeType: document.mimeType,
		bytes: document.bytes > 0 ? document.bytes : null,
		path: document.path,
		storedPath: document.storedPath,
		availability: "unknown",
		materialisable: null,
	};
}

function fromImage(
	record: { id: string; ts: number },
	image: TranscriptImage,
	index: number,
): UserAttachment {
	return {
		key: keyOf(record.id, image.attachment, index),
		messageId: record.id,
		ts: record.ts,
		kind: "image",
		digest: image.attachment,
		data: image.data,
		filename: image.name ?? null,
		mimeType: image.mimeType,
		bytes: image.sizeBytes ?? null,
		path: null,
		storedPath: null,
		availability: "unknown",
		materialisable: null,
	};
}

/**
 * The user attachments the LOADED records carry, oldest first.
 *
 * User rows only, and only the person's own pictures: an artifact (`kind`
 * set) on a user row is a forwarded agent output, which the session-file
 * index already owns.
 */
export function attachmentsFromRecords(
	records: readonly TranscriptRecord[] | null | undefined,
): UserAttachment[] {
	const found: UserAttachment[] = [];
	for (const record of records ?? []) {
		if (record.kind !== "user") continue;
		(record.documents ?? []).forEach((document, index) => {
			found.push(fromDocument(record, document, index));
		});
		record.images.forEach((image, index) => {
			if (image.kind !== undefined && image.kind !== "image") return;
			found.push(fromImage(record, image, index));
		});
	}
	return found;
}

/**
 * Union of the backend inventory and the loaded records, newest first.
 *
 * Identity is `(message, digest)`: the backend's row wins (it carries the
 * existence facts), and a loaded entry the inventory does not know (a send
 * made after it was read, or the whole list when the backend cannot answer)
 * is appended. A live image with no digest yet is matched by message + kind +
 * position, so the stored row that follows replaces it rather than doubling it.
 */
export function mergeUserAttachments(
	listing: UserAttachmentsListing | null,
	records: readonly TranscriptRecord[] | null | undefined,
): UserAttachmentsView {
	const complete = listing?.state === "ready";
	const server = complete
		? (listing?.items ?? [])
				.map(fromWire)
				.filter((item): item is UserAttachment => item !== null)
		: [];
	const byKey = new Map(server.map((item) => [item.key, item]));
	const perMessageKind = new Map<string, number>();
	for (const item of server) {
		const slot = `${item.messageId}:${item.kind}`;
		perMessageKind.set(slot, (perMessageKind.get(slot) ?? 0) + 1);
	}
	const local = attachmentsFromRecords(records);
	const seenLocal = new Map<string, number>();
	/*
	 * A loaded row the inventory's keys miss is still judged by the inventory's
	 * refusals (QA R5 Q2): an inline block's key is positional on one side and
	 * digest-keyed on the other, and an unjudged duplicate would carry the
	 * refused file's origin path into the canvas row's Open / Copy file path.
	 */
	const refusals = attachmentRefusals({ items: server });
	const localCount = new Map<string, number>();
	for (const item of local) {
		const slot = `${item.messageId}:${item.kind}`;
		localCount.set(slot, (localCount.get(slot) ?? 0) + 1);
	}
	const localPosition = new Map<string, number>();
	const merged = [...server];
	for (const original of local) {
		const slotKey = `${original.messageId}:${original.kind}`;
		const at = localPosition.get(slotKey) ?? 0;
		localPosition.set(slotKey, at + 1);
		if (byKey.has(original.key)) continue;
		const verdict = refusalVerdict(refusals, {
			messageId: original.messageId,
			kind: original.kind,
			position: at,
			count: localCount.get(slotKey) ?? 0,
			digest: original.digest,
			path: original.path,
		});
		const item =
			verdict === false ? { ...original, materialisable: false } : original;
		if (item.digest === null) {
			// No digest yet: the server knows this message+kind only if it already
			// listed at least as many of that kind for the message.
			const slot = `${item.messageId}:${item.kind}`;
			const position = seenLocal.get(slot) ?? 0;
			seenLocal.set(slot, position + 1);
			if (position < (perMessageKind.get(slot) ?? 0)) continue;
		}
		byKey.set(item.key, item);
		merged.push(item);
	}
	merged.sort((a, b) => b.ts - a.ts);
	return {
		items: merged,
		complete,
		truncated: Boolean(listing?.truncated),
	};
}

/**
 * What the inventory refused (`materialisable: false`), indexed for the
 * transcript's sent-file cards and pictures - painted from LOADED records,
 * which carry no verdict of their own.
 *
 * WHY NOT DIGESTS ALONE (QA R5 Q2). Core keeps a file under 768 B INLINE in
 * the journal (`_ATTACHMENT_FLOOR_BYTES`), so its block has no `attachment`
 * digest, and a file attached by reference has no stored copy at all. Those
 * are exactly the small `.env` / `id_rsa` / `server.pem` the gate exists for,
 * and a digest-keyed lookup found nothing, so their cards offered Copy path
 * and Open on the real key. Three keys, any one of which refuses:
 *
 * - `digests`: the route refuses EVERY row sharing a denied digest (an
 *   attached `.env` re-sent as `notes.txt` is the same bytes);
 * - `slots`: the inventory's OWN identity for a block with no digest -
 *   message + kind + position, the same identity `mergeUserAttachments`
 *   dedupes a digest-less loaded row by - as each position's verdict in send
 *   order;
 * - `paths`: the refused origin paths, for a block whose position cannot be
 *   trusted.
 */
export type AttachmentRefusals = {
	digests: ReadonlySet<string>;
	/** `${messageId}:${kind}` -> per-position `true` = refused, in send order. */
	slots: ReadonlyMap<string, readonly boolean[]>;
	paths: ReadonlySet<string>;
};

/** One stable "nothing refused", so a memoised row's prop compares equal. */
export const NO_REFUSALS: AttachmentRefusals = {
	digests: new Set(),
	slots: new Map(),
	paths: new Set(),
};

export function attachmentRefusals(
	view: Pick<UserAttachmentsView, "items">,
): AttachmentRefusals {
	const digests = new Set<string>();
	const paths = new Set<string>();
	const rows = new Map<string, { index: number; refused: boolean }[]>();
	for (const item of view.items) {
		// Only rows the inventory itself judged: a loaded row (no `index`, even
		// one the merge flagged) or an older daemon's (`null`) has no verdict of
		// its own to place, and must not shift the positions.
		if (item.materialisable === null || item.index === undefined) continue;
		const refused = item.materialisable === false;
		if (refused && item.digest) digests.add(item.digest);
		if (refused && item.path) paths.add(item.path);
		const slot = `${item.messageId}:${item.kind}`;
		const list = rows.get(slot) ?? [];
		list.push({ index: item.index, refused });
		rows.set(slot, list);
	}
	if (!digests.size && !paths.size) return NO_REFUSALS;
	const slots = new Map<string, boolean[]>();
	for (const [slot, list] of rows) {
		if (!list.some((row) => row.refused)) continue;
		list.sort((a, b) => a.index - b.index);
		slots.set(
			slot,
			list.map((row) => row.refused),
		);
	}
	return { digests, slots, paths };
}

/**
 * The verdict for one block of a LOADED record: `false` when the inventory
 * refused it, else `null` (no verdict - the capability alone governs).
 *
 * `position` / `count` are the block's place among its record's attachments
 * of that kind, counted the way `attachmentsFromRecords` counts them. FAIL
 * CLOSED: when the inventory refused a row of this message and kind but the
 * record holds a different number of them (a block one side classifies and
 * the other does not), no position can be trusted, so every block of that
 * kind is treated as refused rather than guessed allowed.
 */
export function refusalVerdict(
	refusals: AttachmentRefusals,
	block: {
		messageId: string;
		kind: UserAttachment["kind"];
		position: number;
		count: number;
		digest: string | null | undefined;
		path?: string | null;
	},
): false | null {
	if (block.digest && refusals.digests.has(block.digest)) return false;
	if (block.path && refusals.paths.has(block.path)) return false;
	const slot = refusals.slots.get(`${block.messageId}:${block.kind}`);
	if (!slot) return null;
	if (slot.length !== block.count) return false;
	return slot[block.position] ? false : null;
}

/**
 * THE ONE PER-ROW GATE for every materialise-backed action (Open file, Open
 * folder, Copy file path, Show in canvas over a copy) on every surface: the
 * canvas rows, the transcript's pictures and the sent-file card.
 *
 * It is round 2's capability gate (R2-1) with the backend's per-row verdict
 * folded in, so there is one decision rather than two branches that can drift:
 * no `session_attachments` -> nothing; a digest the backend marked
 * `materialisable: false` -> nothing. A digest with NO verdict (a loaded row,
 * or an older daemon that never sends the field) is governed by `capable`
 * alone, exactly as before - an absent field is not a denial.
 */
export function canMaterialiseAttachment(
	capable: boolean,
	materialisable: boolean | null | undefined,
): boolean {
	return capable && materialisable !== false;
}

/** The digests this view owns, so the agent-file list can drop its copy. */
export function attachmentDigests(view: UserAttachmentsView): Set<string> {
	return new Set(
		view.items
			.map((item) => item.digest)
			.filter((digest): digest is string => digest !== null),
	);
}
