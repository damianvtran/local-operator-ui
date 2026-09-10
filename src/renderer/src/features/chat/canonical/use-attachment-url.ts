/**
 * Resolve one transcript image to a URL the browser can paint.
 *
 * Two sources, one answer. A LIVE event carried the base64 inline, so the URL
 * is a `data:` URI built synchronously — no fetch, no loading state, the
 * picture is there on the first frame. A DURABLE row carried only a digest,
 * because the transcript externalises anything over 1 KiB of base64 into
 * `<config>/attachments/<digest>.bin`, so the bytes come back over the media
 * relay as a blob.
 *
 * The legacy path does not port and it is worth saying why, because reaching
 * for it is the obvious mistake. `message-item/index.tsx` builds its URLs from
 * `client.static.getImageUrl(path)`, which works because a legacy message
 * carries image FILE PATHS on disk and `/v1/static/images` serves them by path.
 * A canonical message carries base64 or a store digest — there is no path, and
 * the static route rejects a `.bin` on MIME type anyway.
 *
 * Three properties this hook owes its caller:
 *
 * - **Blob URLs are revoked.** The transcript window is 60 rows and rows
 *   unmount as the reader scrolls, so an unrevoked blob per mount is a leak
 *   proportional to scrolling.
 * - **Digests are cached module-wide.** A digest is content-addressed and
 *   immutable, and the same screenshot recurs across rows and across sessions,
 *   so refetching per mount is pure waste. The cache holds the URL, and the
 *   revoke above is therefore reference-counted rather than unconditional —
 *   revoking a cached URL on the first unmount would break every other row
 *   holding it.
 * - **Failure returns `null`, never throws.** A missing attachment is an
 *   ordinary outcome (`session/attachments.py:149-153`: an interrupted write, a
 *   store the user pruned), and the view answers it with `BrokenAttachment`,
 *   which is the design-approved analogue of the TUI's own
 *   `▨ image unavailable` receipt.
 */

import { desktopMedia } from "@shared/api/local-operator/desktop-api";
import { useEffect, useState } from "react";
import type { TranscriptImage } from "./transcript-reducer";

/**
 * digest -> { url, refs }. Module-level because the point is to survive a row
 * unmounting: two rows showing the same screenshot, and the same row scrolled
 * out and back, must not each pay a round trip.
 */
const cache = new Map<string, { url: string; refs: number }>();

/** Digests whose fetch is in flight, so N mounts make one request. */
const inflight = new Map<string, Promise<string | null>>();

function retain(digest: string): string | null {
	const entry = cache.get(digest);
	if (!entry) return null;
	entry.refs += 1;
	return entry.url;
}

function release(digest: string) {
	const entry = cache.get(digest);
	if (!entry) return;
	entry.refs -= 1;
	if (entry.refs > 0) return;
	// Last holder gone. The bytes are immutable and cheap to refetch, and
	// keeping every screenshot of a long conversation alive in memory is the
	// larger cost, so the URL is revoked rather than parked.
	URL.revokeObjectURL(entry.url);
	cache.delete(digest);
}

async function fetchAttachment(
	sessionId: string,
	digest: string,
): Promise<string | null> {
	const existing = inflight.get(digest);
	if (existing) return existing;
	const pending = (async () => {
		try {
			const result = await desktopMedia(
				{ op: "sessions.attachment", sessionId, digest },
				null,
			);
			if (result.kind !== "bytes") return null;
			const url = URL.createObjectURL(
				new Blob([result.data as BlobPart], { type: result.mimeType }),
			);
			cache.set(digest, { url, refs: 0 });
			return url;
		} catch {
			// Never throw: the caller's contract is that an unresolvable image is
			// a placeholder, not an error boundary.
			return null;
		} finally {
			inflight.delete(digest);
		}
	})();
	inflight.set(digest, pending);
	return pending;
}

/**
 * `null` while a durable image is still being fetched AND after it failed.
 *
 * The two are deliberately one value. `AttachmentFrame` reserves the box and
 * shows no spinner by design, so a "loading" state would have nothing to
 * render that "unavailable" does not — and a local blob resolves in a frame or
 * two, which is under the threshold where a distinct state would be legible.
 */
export function useAttachmentUrl(
	image: TranscriptImage,
	sessionId: string | null,
): string | null {
	// An inline image needs no state at all: the URI is a pure function of the
	// bytes already in memory, so it is correct on the very first render and
	// never re-renders the row.
	const inline = image.data
		? `data:${image.mimeType};base64,${image.data}`
		: null;
	const [resolved, setResolved] = useState<string | null>(() =>
		image.attachment ? retain(image.attachment) : null,
	);

	useEffect(() => {
		const digest = image.attachment;
		if (inline || !digest || !sessionId) return;
		let live = true;
		const cached = retain(digest);
		if (cached) {
			setResolved(cached);
			return () => {
				live = false;
				release(digest);
			};
		}
		void fetchAttachment(sessionId, digest).then((url) => {
			if (!live || !url) return;
			// Retain AFTER the fetch, so the count reflects holders rather than
			// requests: a row unmounted mid-flight never retained and must not
			// release.
			setResolved(retain(digest));
		});
		return () => {
			live = false;
			// Only release what this mount actually retained. `retain` returns
			// null for a digest that never landed, and `release` is a no-op on a
			// digest absent from the cache, so a cancelled fetch is safe.
			release(digest);
		};
	}, [image.attachment, inline, sessionId]);

	return inline ?? resolved;
}
