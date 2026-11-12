/**
 * Resolve one transcript attachment's bytes to a URL the browser can paint.
 *
 * One resolver, two media kinds. The bytes question is identical for a picture
 * and a video — a LIVE event carried the base64 inline (a `data:` URI built
 * synchronously, no fetch, no loading state), a DURABLE row carried only a
 * digest, because the transcript externalises anything over 1 KiB of base64
 * into `<config>/attachments/<digest>.bin`, so the bytes come back over the
 * media relay as a blob — and the fields it reads (`data`, `attachment`,
 * `mimeType`) are carried by both kinds. That is why the math lives once, in
 * `useAttachmentSource`, and both entry points below share it: the callers
 * differ only in what they DRAW (an `<img>` frame or a `<video>` player), never
 * in where the bytes come from.
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
import {
	blobAt,
	createBlobUrl,
	peek,
	publish,
	release,
	retain,
	revokeBlobUrl,
} from "@shared/lib/blob-url-cache";
import { useEffect, useState } from "react";
import type { TranscriptImage } from "./transcript-reducer";

/**
 * Which conversation's rows a transcript image belongs to.
 *
 * A durable image is a digest in a content-addressed store, and the route that
 * serves those bytes is scoped to the transcript that REFERENCES them — so
 * resolving one needs to know not just which session it was read through but
 * which conversation inside that session the row came from. A child's page is a
 * conversation of its own: its rows reference the same shared store, and the
 * parent's route refuses them (a child session is not a user session), so
 * `childId` is what selects the child-scoped twin.
 *
 * `childId: null` is the parent conversation. It is a value rather than an
 * optional field because "no child" is the ordinary case and the two callers
 * that pass it (`canonical-transcript.tsx`, both halves of the live session)
 * should have to say so.
 */
export type AttachmentScope = {
	sessionId: string;
	childId: string | null;
};

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
	{ promise: Promise<FetchOutcome>; holders: number }
>();

/**
 * What one attempt came back with: a URL, or the STATUS that refused it.
 *
 * The status is the whole point (docs/design/remote-files-parity.md §1, I1-2):
 * a peer-held digest whose owner is unreachable, or whose transfer is still
 * running, answers 504 and is worth asking again; a 404/409 is a permanent
 * answer from the store or the owner. `null` is a transport failure with no
 * status, which keeps today's `missing` meaning.
 */
type FetchOutcome = { url: string } | { url: null; status: number | null };

/**
 * The retry schedule for a 504, in milliseconds between attempts: five
 * attempts in all (the first plus four waits), then a click-to-retry state.
 * 2 + 4 + 8 + 16 = 30 s covers a transfer the backend left running after its
 * own 20 s wait (`REMOTE_FETCH_WAIT_S`) without polling an owner that is gone.
 */
export const ATTACHMENT_RETRY_DELAYS_MS = [2000, 4000, 8000, 16000] as const;

/** The status the backend uses for "ask again" and nothing else. */
const RETRYABLE_STATUS = 504;

/*
 * `peek`, `retain` and `release` come from `shared/lib/blob-url-cache`, keyed by
 * the attachment DIGEST: a digest is content-addressed and immutable, so two
 * rows showing the same screenshot, and the same row scrolled out and back,
 * share one entry instead of paying a round trip each. The refcount discipline
 * and its StrictMode note live in that module, because the canvas viewers need
 * the same discipline for a different key.
 */

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
	scope: AttachmentScope,
	digest: string,
): Promise<FetchOutcome> {
	const existing = inflight.get(digest);
	if (existing) {
		existing.holders += 1;
		return existing.promise;
	}
	const record: { promise: Promise<FetchOutcome>; holders: number } = {
		holders: 1,
		promise: null as unknown as Promise<FetchOutcome>,
	};
	record.promise = (async () => {
		try {
			const result = await desktopMedia(
				scope.childId
					? {
							op: "subagents.attachment",
							sessionId: scope.sessionId,
							childId: scope.childId,
							digest,
						}
					: {
							op: "sessions.attachment",
							sessionId: scope.sessionId,
							digest,
						},
				null,
			);
			// A refusal is returned, never published: only bytes enter the shared
			// cache, so no failure (a 504 above all) outlives this attempt.
			if (result.kind !== "bytes")
				return { url: null, status: result.status ?? null };
			const url = createBlobUrl(result.data as BlobPart, result.mimeType);
			if (record.holders <= 0) {
				// Everyone who asked for this is gone. Publishing it would strand an
				// entry no unmount can ever release, so it is revoked here instead
				// (the cache's own revoke, so the bytes it keeps for `Copy image`
				// go with the URL).
				revokeBlobUrl(url);
				return { url: null, status: null };
			}
			publish(digest, url);
			return { url };
		} catch {
			// Never throw: the caller's contract is that an unresolvable image is
			// a placeholder, not an error boundary.
			return { url: null, status: null };
		} finally {
			inflight.delete(digest);
		}
	})();
	inflight.set(digest, record);
	return record.promise;
}

/** The digest is not in the session's attachment store (the relay answered 404). */
export class AttachmentGoneError extends Error {
	constructor() {
		super("This item is no longer in the session");
		this.name = "AttachmentGoneError";
	}
}

/**
 * The device that holds this digest did not answer in time (the relay
 * answered 504: owner unreachable, or its transfer is still running). Unlike
 * `AttachmentGoneError` this is worth retrying, and the toast says so.
 */
export class AttachmentOwnerUnreachableError extends Error {
	constructor() {
		super("The device that holds these bytes did not answer in time");
		this.name = "AttachmentOwnerUnreachableError";
	}
}

/**
 * One digest's bytes as a `Blob`, fetched on demand and held by nobody.
 *
 * For an action (`Copy image`, `Save as...`) on a surface that does not paint the
 * picture itself - a Files row mounts one menu per row and resolves only the
 * thumbnails in view. A warm cache entry is reused (`blobAt` on the painted
 * URL); otherwise the bytes come over the same media relay as `fetchAttachment`
 * but are NOT published into the refcounted URL cache: nothing would retain an
 * entry created for a single action, and an unretained entry is the leak that
 * cache's rules exist to prevent. Throws a sentence a toast can carry.
 */
export async function fetchAttachmentBlob(
	scope: AttachmentScope,
	digest: string,
): Promise<Blob> {
	const warm = peek(digest);
	const held = warm ? blobAt(warm) : null;
	if (held) return held;
	const result = await desktopMedia(
		scope.childId
			? {
					op: "subagents.attachment",
					sessionId: scope.sessionId,
					childId: scope.childId,
					digest,
				}
			: { op: "sessions.attachment", sessionId: scope.sessionId, digest },
		null,
	);
	if (result.kind !== "bytes") {
		// 404 is the store's "no such digest" (`attachment`: a hand-pruned store, an
		// interrupted write); anything else is the relay failing, which a retry can
		// clear. The two want different sentences, so the type says which it was.
		if (result.status === 404) throw new AttachmentGoneError();
		if (result.status === RETRYABLE_STATUS)
			throw new AttachmentOwnerUnreachableError();
		throw new Error("These bytes are not available right now");
	}
	return new Blob([result.data as BlobPart], { type: result.mimeType });
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
/**
 * Where a canonical image's bytes come from, as of this render.
 *
 * THREE STATES, NOT TWO, and the distinction belongs to the caller because the
 * caller is what has something different to draw for each. This used to return
 * `null` for "still resolving" and "failed" alike, on the reasoning that a
 * loading state would have nothing to render that "unavailable" does not - true
 * while the receipt was the only thing a caller could paint for either, and false
 * the moment a caller has a BOX to reserve. The condensed group's tile is 115x76 (117x78 with its border) by
 * construction, so a durable picture's first paint was a sentence-shaped receipt
 * that swapped to a tile a frame later, in the one surface whose whole point is
 * that the artifact is on screen (agent review round 1, P3). The cold path is the
 * NORMAL path there: a condensed fold unmounts the rows that would otherwise have
 * warmed the cache.
 *
 * `resolving` is every state before an attempt has come back empty, `missing` is
 * the state after one has. Only `missing` may paint the receipt.
 */
export type AttachmentSource =
	| { state: "ready"; url: string }
	| { state: "resolving" }
	| { state: "missing" }
	/*
	 * The owner of a peer-held digest kept answering 504 through the whole
	 * backoff. Not `missing`: the bytes exist on a device that may come back, so
	 * the caller paints the receipt WITH a retry, and `retry` starts a fresh
	 * five-attempt cycle.
	 */
	| { state: "retryable"; retry: () => void };

/**
 * The fields the resolver reads off any attachment ref, whatever its kind.
 *
 * A structural type rather than `TranscriptImage` because the resolver has no
 * business knowing what a ref IS — only where its bytes are and what they are.
 * Both `TranscriptImage` and a video ref satisfy it, which is what lets one
 * hook serve both components (see the header).
 */
export type AttachmentRef = {
	/** Base64 payload when the event carried it inline. Live path. */
	data: string | null;
	/** Attachment-store digest when the row referenced it. Durable path. */
	attachment: string | null;
	mimeType: string;
};

/**
 * Where one attachment's bytes come from, as of this render — the shared
 * resolver both media components mount (the header explains why it is one).
 */
export function useAttachmentSource(
	ref: AttachmentRef,
	scope: AttachmentScope | null,
): AttachmentSource {
	// An inline attachment needs no state at all: the URI is a pure function of
	// the bytes already in memory, so it is correct on the very first render and
	// never re-renders the row.
	const inline = ref.data ? `data:${ref.mimeType};base64,${ref.data}` : null;
	// A PEEK, never a retain. `retain` mutates a refcount, and a `useState`
	// initializer that mutates is impure: under the `StrictMode` this app mounts
	// (`main.tsx`) it is deliberately double-invoked, so retaining here added a
	// ref per warm mount that no unmount could pay back and the blob outlived
	// the window. Peeking keeps the first paint (the reason this seed exists at
	// all) while the effect below owns every reference.
	const [resolved, setResolved] = useState<string | null>(() =>
		ref.attachment ? peek(ref.attachment) : null,
	);
	/**
	 * Whether an attempt has come back EMPTY, which is the only fact that separates
	 * "late" from "absent". It is not derived from `resolved === null`, because a
	 * cold mount and a 404 are the same value there - the conflation this exists to
	 * end.
	 */
	const [failed, setFailed] = useState<null | "missing" | "retryable">(null);
	/*
	 * Bumped by `retry` to re-arm the effect for a fresh backoff cycle. A
	 * counter rather than a boolean because two clicks are two cycles.
	 */
	const [cycle, setCycle] = useState(0);
	/*
	 * The scope's two ids as PRIMITIVES, read once.
	 *
	 * The effect below must depend on the ids rather than on `scope`: callers
	 * build the object per render, so its identity is not stable and depending on
	 * it would refetch on every render. Reading them into locals also keeps the
	 * dependency list a list of values rather than of member expressions —
	 * `useExhaustiveDependencies` refuses `scope?.sessionId` for the same reason
	 * it exists, and the alternative (silencing it) would hide a real drift if
	 * this hook ever grew a dependency it forgot to name.
	 */
	const scopeSessionId = scope?.sessionId ?? null;
	const scopeChildId = scope?.childId ?? null;

	useEffect(() => {
		void cycle;
		const digest = ref.attachment;
		if (inline || !digest || !scopeSessionId) return;
		let live = true;
		const cached = retain(digest);
		if (cached) {
			setResolved(cached);
			setFailed(null);
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
		// THIS attempt is not the last attempt's failure: clearing the flag is what
		// lets the box be reserved again rather than the receipt re-painted over a
		// picture that is on its way (a retry after a dropped relay frame).
		setFailed(null);
		// Tracks whether this mount is still party to the fetch it started.
		// `inflight` is keyed by DIGEST, not by attempt, so once our own attempt
		// settles and deletes its record, a later row retrying the same digest
		// owns a DIFFERENT record. Abandoning unconditionally would decrement
		// that stranger's count — one we never incremented — and the resolver
		// would then discard bytes out from under a row still on screen. The
		// path is ordinary, not exotic: `desktopMedia` answers any non-2xx or
		// transport failure with `{kind:"error"}`, which resolves without
		// throwing and leaves the row mounted on `BrokenAttachment`.
		let joined = false;
		let wait: ReturnType<typeof setTimeout> | undefined;
		const scopeNow = { sessionId: scopeSessionId, childId: scopeChildId };
		/*
		 * One cycle: up to `ATTACHMENT_RETRY_DELAYS_MS.length + 1` attempts while
		 * the relay answers 504, then `retryable`. The row stays `resolving`
		 * between attempts (the box is reserved, nothing flickers), and each
		 * attempt goes back through `fetchAttachment`, so N rows waiting on one
		 * peer-held digest still make one request per attempt.
		 */
		const attempt = (index: number) => {
			joined = true;
			void fetchAttachment(scopeNow, digest).then((outcome) => {
				joined = false;
				if (!live) return;
				if (outcome.url === null) {
					if (outcome.status !== RETRYABLE_STATUS) {
						// The bytes are absent rather than late - a 404/409 or a transport
						// failure - and this is the only path allowed to say so.
						setFailed("missing");
						return;
					}
					const delay = ATTACHMENT_RETRY_DELAYS_MS[index];
					if (delay === undefined) {
						setFailed("retryable");
						return;
					}
					wait = setTimeout(() => {
						wait = undefined;
						if (live) attempt(index + 1);
					}, delay);
					return;
				}
				// Retain AFTER the fetch, so the count reflects holders rather than
				// requests: a row unmounted mid-flight never retained and must not
				// release.
				setResolved(retain(digest));
			});
		};
		attempt(0);
		return () => {
			live = false;
			if (wait !== undefined) clearTimeout(wait);
			// Two different books to close, and both are needed. `release` pays
			// back a retain this mount made (a no-op if the fetch never landed),
			// while `abandonFetch` drops this mount's claim on a result still in
			// flight so the resolver can discard bytes nobody is waiting for —
			// but only while that claim is still outstanding.
			if (joined) abandonFetch(digest);
			release(digest);
		};
	}, [ref.attachment, inline, scopeSessionId, scopeChildId, cycle]);

	const url = inline ?? resolved;
	if (url) return { state: "ready", url };
	/*
	 * No URL. An attachment with a digest and a scope to fetch it within is
	 * RESOLVING until an attempt comes back empty; anything else - no digest at
	 * all, or no scope to ask - can never produce one, and says so on the first
	 * render.
	 */
	if (!ref.attachment || !scopeSessionId || failed === "missing")
		return { state: "missing" };
	if (failed === "retryable")
		return { state: "retryable", retry: () => setCycle((n) => n + 1) };
	return { state: "resolving" };
}

/**
 * The image entry point, as `CanonicalImage` and every earlier caller mounts
 * it. A thin delegation to `useAttachmentSource` — one resolver, two names —
 * kept because the image callers read better against their own noun.
 */
export function useAttachmentUrl(
	image: TranscriptImage,
	scope: AttachmentScope | null,
): AttachmentSource {
	return useAttachmentSource(image, scope);
}
