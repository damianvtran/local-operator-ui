/**
 * One supplement component's assembled document, fetched once per digest.
 *
 * WHY A MODULE CACHE. A digest is content-addressed and immutable (the route
 * family is digest-addressed by construction — memo §2.7), the same component
 * recurs across a replayed page and across mounts, and the panel can hold
 * several frames of one document set. The cache therefore holds the PROMISE of
 * the bytes, not just the bytes: N mounts of one digest make one request. The
 * bound (64 documents) is a cap on retention, not on correctness — an evicted
 * digest simply refetches.
 *
 * FAILURE IS A VALUE, NOT A THROW, and it says WHICH failure: a `null` html
 * with `failed: true` is a document that cannot be shown (the route's 404 for
 * a pruned blob, a refusal, a malformed body). The frame answers that with the
 * frame-level fallback line — `Couldn't render this graphic` — the same one a
 * hung or torn-down frame paints, because "the bytes are gone" and "the bytes
 * never rendered" are the same fact to a reader. A failure is NOT cached, so a
 * later mount retries.
 *
 * WHY NOT `useAttachmentUrl`'s blob cache: these bytes are a JSON document the
 * frame consumes as a `data:` URL, never a URL the browser paints, and the
 * blob cache's whole refcounting discipline exists for `<img src>` lifetimes.
 * The one thing both keep is the digest key.
 */

import { desktopMedia } from "@shared/api/local-operator/desktop-api";
import { useEffect, useState } from "react";
import { isDigest } from "./supplement-model";

/** The largest document this surface will accept, in characters. */
export const MAX_SUPPLEMENT_DOCUMENT_CHARS = 2 * 1024 * 1024;

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
const MAX_CACHED_DOCUMENTS = 64;

export type SupplementDocument = {
	html: string | null;
	/** True once a fetch has failed (404, refusal, malformed body). */
	failed: boolean;
};

const NOT_FETCHED: SupplementDocument = { html: null, failed: false };

/**
 * Fetch one digest's document, collapsing concurrent mounts onto one request.
 */
async function fetchDocument(
	sessionId: string,
	digest: string,
): Promise<string | null> {
	const key = `${sessionId}:${digest}`;
	const existing = inflight.get(key);
	if (existing) return existing;
	const promise = (async () => {
		try {
			const response = await desktopMedia(
				{ op: "sessions.supplementDocument", sessionId, digest },
				null,
			);
			if (response.kind !== "json") return null;
			const body = response.body as { html?: unknown } | null;
			const html = body && typeof body.html === "string" ? body.html : null;
			if (html === null || html.length > MAX_SUPPLEMENT_DOCUMENT_CHARS) {
				return null;
			}
			cache.set(key, html);
			while (cache.size > MAX_CACHED_DOCUMENTS) {
				const oldest = cache.keys().next().value;
				if (oldest === undefined) break;
				cache.delete(oldest);
			}
			return html;
		} catch {
			// A refusal or a transport failure reads as "cannot show it": the
			// caller paints the fallback line, never an error boundary.
			return null;
		} finally {
			inflight.delete(key);
		}
	})();
	inflight.set(key, promise);
	return promise;
}

/**
 * The document for one component, `NOT_FETCHED` until it resolves.
 *
 * `enabled` is the lazy-mount gate (§2.11: a frame mounts only when its answer
 * row is in the viewport): the fetch does not start until the frame's
 * IntersectionObserver says it is near.
 */
export function useSupplementDocument(
	sessionId: string | null,
	digest: string,
	enabled: boolean,
): SupplementDocument {
	const [state, setState] = useState<SupplementDocument>(() => {
		if (!sessionId || !isDigest(digest)) return NOT_FETCHED;
		const cached = cache.get(`${sessionId}:${digest}`);
		return cached !== undefined ? { html: cached, failed: false } : NOT_FETCHED;
	});
	useEffect(() => {
		if (!enabled || !sessionId || !isDigest(digest)) return;
		const cached = cache.get(`${sessionId}:${digest}`);
		if (cached !== undefined) {
			setState({ html: cached, failed: false });
			return;
		}
		let cancelled = false;
		void fetchDocument(sessionId, digest).then((html) => {
			if (cancelled) return;
			setState(
				html !== null ? { html, failed: false } : { html: null, failed: true },
			);
		});
		return () => {
			cancelled = true;
		};
	}, [enabled, sessionId, digest]);
	return state;
}
