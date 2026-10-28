/**
 * How the message list draws a row the author's own send journal owns.
 *
 * WHY A SIDE MAP, NOT FIELDS ON THE MESSAGE. `TeamBridgeMessage` is the hub's
 * contract; a local row is projected into that shape so the list draws it with
 * the SAME row (avatar, name, time, markdown body, attachment tiles) a hub
 * message gets. Everything only this session knows about it - the client
 * reference, whether the post is still in flight, the in-memory picture URLs,
 * the retry/discard handlers - travels beside it, keyed by `message.id`, so no
 * local field can leak into anything that serialises a message.
 *
 * LIFETIME RULES the journal must keep (the list cannot enforce them):
 * - Re-key the map entry to the server id at the swap, keeping `clientRef`:
 *   the list keys the React row by `clientRef`, so the row (and its image
 *   tiles) survives the id change without remounting.
 * - Keep the entry, as `confirmed`, for as long as the row is on screen.
 *   Dropping it re-keys the row by its server id: a remount, and the tiles
 *   fall back to the byte route (a loading frame where the local picture was).
 * - `previewUrls` stay owned by the journal: the list never revokes them.
 *   Release them on discard, on revocation, or once the row leaves the list.
 */
export type TeamBridgeLocalRowPresentation = {
	/** Stable across the local-to-server id swap; the list's React key. */
	clientRef: string;
	state: "pending" | "failed" | "confirmed";
	/*
	 * Index-aligned with `message.attachments`: a tile with a URL draws these
	 * bytes and makes NO request (the image is visible before its upload, and
	 * stays put through the swap). The projection must therefore carry one
	 * descriptor per staged image - with `width`/`height`, so `boxFor` reserves
	 * the same box the bound picture will get - even before the upload.
	 */
	previewUrls?: readonly (string | undefined)[];
	/** Shown only while `failed`. */
	onRetry?: () => void;
	/** Shown only while `failed`. */
	onDiscard?: () => void;
	/**
	 * Shown only while `failed`: puts the text and its images back in the draft
	 * that authored them and drops the row. Distinct from discard, which throws
	 * the attempt away, and from retry, which sends the same payload again.
	 */
	onReturnToDraft?: () => void;
	/**
	 * Shown only while `failed`: how many images this attempt had to abandon
	 * because they could no longer be staged (the hub forgot the staged id and
	 * the draft held no bytes). Retry then sends the text; the reader is told
	 * which part of their message is missing instead of finding out from a
	 * picture that quietly vanished.
	 */
	droppedAttachments?: number;
};
