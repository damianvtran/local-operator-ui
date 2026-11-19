/**
 * One sound's stored peaks, as the player's waveform.
 *
 * WHERE THE PEAKS COME FROM. The harness precomputes 240 bars (0..1) once, when
 * a generated sound's artifact is created, and stores them beside the audio as
 * `<digest>.peaks.json` (the digest is the identity; the sidecar is a second
 * artifact fact, never a second copy of the audio). They arrive here over the
 * media relay's `sessions.attachment.waveform` op — the same bearer-scoped
 * store route family the bytes come from — and NEVER by decoding audio in the
 * renderer: decoding a 98 s MP3 was measured at ~64 ms once, which is fine at
 * artifact-creation time and unacceptable in a render loop.
 *
 * THREE ABSENCES, ONE ANSWER. No digest, a session that predates the sidecar
 * (the route answers not-found), and a malformed sidecar all resolve to `null`,
 * and the player draws its flat scrubber. That is deliberate and it is the
 * brief's rule: a waveform the audio does not have is a lie about the sound,
 * and a flat line is an honest "we do not know this shape".
 *
 * ONE FETCH PER DIGEST, FOR THE MODULE'S LIFETIME. A digest is content-addressed
 * and immutable, and the same generated sound can be mounted in the transcript,
 * the Files band and a highlight row at once, so N mounts share one promise (the
 * same collapse the attachment resolver documents). The MISS is cached too: the
 * route may simply not exist yet for older sessions, and re-asking on every
 * mount would spend a request per scroll for an answer that cannot change.
 */

import { desktopMedia } from "@shared/api/local-operator/desktop-api";
import { useEffect, useState } from "react";
import {
	ATTACHMENT_RETRY_DELAYS_MS,
	type AttachmentScope,
} from "./use-attachment-url";

/**
 * A stored sidecar's body, as bars: `{ peaks: number[] }`, or a bare array for a
 * writer that stored the list alone. Anything malformed is `null` — never a
 * guessed envelope — and every bar is clamped to 0..1 because a canvas height
 * computed from an out-of-range value would draw outside the player's box.
 */
export function peaksFrom(value: unknown): number[] | null {
	const list = Array.isArray(value)
		? value
		: value &&
				typeof value === "object" &&
				Array.isArray((value as { peaks?: unknown }).peaks)
			? (value as { peaks: unknown[] }).peaks
			: null;
	if (!list || list.length === 0) return null;
	const peaks: number[] = [];
	for (const entry of list) {
		if (typeof entry !== "number" || !Number.isFinite(entry)) return null;
		peaks.push(Math.max(0, Math.min(1, entry)));
	}
	return peaks;
}

/** Digests whose fetch is in flight, or whose answer is already known. */
const cache = new Map<
	string,
	Promise<number[] | null | typeof PENDING | typeof UNKEPT>
>();

/**
 * The relay call for one digest's sidecar, exported so the node tests can drive
 * the exact request the hook makes (and the player's own tests can stub it).
 */
export async function fetchWaveformPeaks(
	scope: AttachmentScope,
	digest: string,
): Promise<number[] | null> {
	const outcome = await fetchWaveformOutcome(scope, digest);
	return outcome === PENDING || outcome === UNKEPT ? null : outcome;
}

/**
 * The owner of a peer-held sound answered 504 (unreachable, or its transfer is
 * still running). Distinct from `null` because `null` is a settled answer the
 * cache keeps forever, and a 504 must never be kept: the same digest is worth
 * asking for again (docs/design/remote-files-parity.md §1).
 */
const PENDING = Symbol("waveform-pending");

/**
 * A 409: the store or the owner of a peer-held digest could not serve the
 * sidecar THIS time (`attachment_on_peer`, an offline replica). Painted flat,
 * like `null`, but never kept: the bytes beside it are re-asked on remount,
 * and the waveform has to follow them, or a sound that came back stays flat
 * for the app's lifetime (QA round 1, Q1-4).
 */
const UNKEPT = Symbol("waveform-unkept");

async function fetchWaveformOutcome(
	scope: AttachmentScope,
	digest: string,
): Promise<number[] | null | typeof PENDING | typeof UNKEPT> {
	try {
		const result = await desktopMedia(
			{
				op: "sessions.attachment.waveform",
				sessionId: scope.sessionId,
				digest,
			},
			null,
		);
		if (result.kind === "json") return peaksFrom(result.body);
		if (result.kind === "bytes") {
			// The sidecar's MIME is not guaranteed to announce itself as JSON
			// (`application/json` vs an octet-stream store read), so the bytes are
			// decoded and parsed; a body that is not JSON stays unread.
			const text = new TextDecoder().decode(result.data);
			try {
				return peaksFrom(JSON.parse(text) as unknown);
			} catch {
				return null;
			}
		}
		if (result.status === 504) return PENDING;
		if (result.status === 409) return UNKEPT;
		return null;
	} catch {
		return null;
	}
}

/**
 * The peaks for one digest, or `null` while (and after) failing — the player
 * renders `null` as its flat scrubber, so there is no distinct loading state to
 * paint and no window in which a wrong shape could be drawn.
 */
export function useWaveform(
	digest: string | null,
	scope: AttachmentScope | null,
): number[] | null {
	const sessionId = scope?.sessionId ?? null;
	const childId = scope?.childId ?? null;
	const [peaks, setPeaks] = useState<number[] | null>(() =>
		digest ? cacheValue(digest) : null,
	);
	useEffect(() => {
		if (!digest || !sessionId) {
			setPeaks(null);
			return;
		}
		let live = true;
		let wait: ReturnType<typeof setTimeout> | undefined;
		// The bytes' own schedule (`ATTACHMENT_RETRY_DELAYS_MS`): a 504 is asked
		// again on the same backoff, and after the last one the player keeps its
		// flat scrubber. Nothing is cached, so a remount asks afresh.
		const attempt = (index: number) => {
			requestPeaks({ sessionId, childId }, digest).then((value) => {
				if (!live) return;
				if (value === UNKEPT) {
					setPeaks(null);
					return;
				}
				if (value !== PENDING) {
					setPeaks(value);
					return;
				}
				const delay = ATTACHMENT_RETRY_DELAYS_MS[index];
				if (delay === undefined) return;
				wait = setTimeout(() => {
					wait = undefined;
					if (live) attempt(index + 1);
				}, delay);
			});
		};
		attempt(0);
		return () => {
			live = false;
			if (wait !== undefined) clearTimeout(wait);
		};
	}, [digest, sessionId, childId]);
	return peaks;
}

/** What the cache already knows, synchronously, for the first paint. */
function cacheValue(digest: string): number[] | null {
	// Only a settled HIT is readable synchronously; a pending promise has no
	// value yet and a settled miss is `null` (the effect below re-reads the same
	// entry and settles at once, which React bails out of re-rendering).
	const entry = settled.get(digest);
	return entry ?? null;
}

/** Settled answers, so a later mount paints the waveform on its first frame. */
const settled = new Map<string, number[] | null>();

function requestPeaks(
	scope: AttachmentScope,
	digest: string,
): Promise<number[] | null | typeof PENDING | typeof UNKEPT> {
	const existing = cache.get(digest);
	if (existing) return existing;
	const pending = fetchWaveformOutcome(scope, digest)
		.then((value) => {
			if (value === PENDING || value === UNKEPT) {
				// Never cache a 504 or a 409: the next attempt (or the next mount)
				// must reach the relay.
				cache.delete(digest);
				return value;
			}
			settled.set(digest, value);
			return value;
		})
		.catch(() => {
			settled.set(digest, null);
			return null;
		});
	cache.set(digest, pending);
	return pending;
}
