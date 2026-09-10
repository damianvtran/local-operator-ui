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

/**
 * Digests whose fetch is in flight, so N mounts make one request.
 *
 * The value carries `holders` alongside the promise because the RESULT needs an
 * owner. A row that unmounts mid-flight cannot release what it never retained,
 * so the count of live requesters is what tells the resolver whether anyone is
 * still waiting when the bytes land — see `fetchAttachment`.
 */
const inflight = new Map<
	string,
	{ promise: Promise<string | null>; holders: number }
>();

/**
 * The cached URL without taking a reference — a READ, safe in a render.
 *
 * Separate from `retain` because a `useState` initializer must be pure and
 * React deliberately double-invokes it under `StrictMode`. Peeking lets a warm
 * mount paint the picture on its first frame (the common case when scrolling
 * back over a screenshot) while the refcount stays owned entirely by the
 * effect, which is the only place that can also pay it back.
 */
function peek(digest: string): string | null {
	return cache.get(digest)?.url ?? null;
}

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

/**
 * Fetch one digest's bytes, collapsing N concurrent mounts onto one request.
 *
 * `abandonFetch` is the other half and must be called by every caller that
 * stops caring, because a blob created for nobody is unreachable garbage: the
 * cache entry would sit at `refs: 0` with no holder left to drive it to zero,
 * and `release` is a documented no-op on a digest that was absent when the
 * unmount ran. Fast scrolling through a screenshot-heavy transcript is exactly
 * the motion that produces that race, so the resolver counts its waiters and
 * discards a result nobody is left to hold.
 */
function fetchAttachment(
	sessionId: string,
	digest: string,
): Promise<string | null> {
	const existing = inflight.get(digest);
	if (existing) {
		existing.holders += 1;
		return existing.promise;
	}
	const record: { promise: Promise<string | null>; holders: number } = {
		holders: 1,
		promise: null as unknown as Promise<string | null>,
	};
	record.promise = (async () => {
		try {
			const result = await desktopMedia(
				{ op: "sessions.attachment", sessionId, digest },
				null,
			);
			if (result.kind !== "bytes") return null;
			const url = URL.createObjectURL(
				new Blob([result.data as BlobPart], { type: result.mimeType }),
			);
			if (record.holders <= 0) {
				// Everyone who asked for this is gone. Publishing it would strand an
				// entry no unmount can ever release, so it is revoked here instead.
				URL.revokeObjectURL(url);
				return null;
			}
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
	inflight.set(digest, record);
	return record.promise;
}

/** One requester stopped waiting. The last one to leave discards the result. */
function abandonFetch(digest: string) {
	const existing = inflight.get(digest);
	if (existing) existing.holders -= 1;
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
	// A PEEK, never a retain. `retain` mutates a refcount, and a `useState`
	// initializer that mutates is impure: under the `StrictMode` this app mounts
	// (`main.tsx`) it is deliberately double-invoked, so retaining here added a
	// ref per warm mount that no unmount could pay back and the blob outlived
	// the window. Peeking keeps the first paint (the reason this seed exists at
	// all) while the effect below owns every reference.
	const [resolved, setResolved] = useState<string | null>(() =>
		image.attachment ? peek(image.attachment) : null,
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
		// Nothing cached. On a cold mount this matches the seed and React bails
		// out of the re-render; it only does work in the narrow race where the
		// entry was revoked between the render-phase peek and this effect, and
		// there it drops a URL that is already dead rather than painting it.
		setResolved(null);
		// Tracks whether this mount is still party to the fetch it started.
		// `inflight` is keyed by DIGEST, not by attempt, so once our own attempt
		// settles and deletes its record, a later row retrying the same digest
		// owns a DIFFERENT record. Abandoning unconditionally would decrement
		// that stranger's count — one we never incremented — and the resolver
		// would then discard bytes out from under a row still on screen. The
		// path is ordinary, not exotic: `desktopMedia` answers any non-2xx or
		// transport failure with `{kind:"error"}`, which resolves `null` without
		// throwing and leaves the row mounted on `BrokenAttachment`.
		let joined = true;
		void fetchAttachment(sessionId, digest).then((url) => {
			joined = false;
			if (!live || !url) return;
			// Retain AFTER the fetch, so the count reflects holders rather than
			// requests: a row unmounted mid-flight never retained and must not
			// release.
			setResolved(retain(digest));
		});
		return () => {
			live = false;
			// Two different books to close, and both are needed. `release` pays
			// back a retain this mount made (a no-op if the fetch never landed),
			// while `abandonFetch` drops this mount's claim on a result still in
			// flight so the resolver can discard bytes nobody is waiting for —
			// but only while that claim is still outstanding.
			if (joined) abandonFetch(digest);
			release(digest);
		};
	}, [image.attachment, inline, sessionId]);

	return inline ?? resolved;
}
