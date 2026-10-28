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
	const merged = [...server];
	for (const item of local) {
		if (byKey.has(item.key)) continue;
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
 * Digests the backend refused to materialise (`materialisable: false`).
 *
 * The transcript's sent-file cards and pictures are painted from the loaded
 * records, which carry no verdict, so they look the digest up here. Keyed by
 * digest because the route is: the backend refuses EVERY row sharing a denied
 * digest (an attached `.env` re-sent as `notes.txt` is the same bytes).
 */
export function unmaterialisableDigests(
	view: Pick<UserAttachmentsView, "items">,
): Set<string> {
	return new Set(
		view.items
			.filter((item) => item.materialisable === false && item.digest !== null)
			.map((item) => item.digest as string),
	);
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

/**
 * The verdict for a digest painted from LOADED records (the transcript's
 * pictures and sent-file cards carry no verdict of their own): `false` when
 * the inventory refused that digest, else `null` (no verdict).
 */
export function verdictForDigest(
	refused: ReadonlySet<string>,
	digest: string | null | undefined,
): false | null {
	return digest && refused.has(digest) ? false : null;
}

/** The digests this view owns, so the agent-file list can drop its copy. */
export function attachmentDigests(view: UserAttachmentsView): Set<string> {
	return new Set(
		view.items
			.map((item) => item.digest)
			.filter((digest): digest is string => digest !== null),
	);
}
