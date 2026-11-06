/**
 * The two link-preview answers main gives the renderer, and the rules that shape
 * them. Pure logic: no Electron, no `fetch`, no filesystem — collaborators are
 * injected so a `node --test` case can drive every branch without a window.
 *
 * THE FETCH PATH IS NOT HERE, AND MUST NEVER COME BACK. Core resolves a link
 * (`local_operator/team_bridge/link_preview/`, released in core 0.101.2): it
 * parses the page, applies the address guard, sniffs the images, and stores them
 * under scope-derived ids. This module proxies two routes through the app's
 * existing desktop transport and caches the BYTES it is handed on the way past.
 * The superseded branch fetched the third-party URL here, and that is the code
 * path this file exists to replace. If you are about to write a `fetch(` in this
 * directory, stop: it belongs in core, behind the bearer, next to every other
 * network egress the assistant already makes.
 *
 * THERE IS NO RESOLVE CACHE HERE, ON PURPOSE. Core caches resolved previews with
 * its own TTLs and reports the hit/miss/eviction counters at
 * `GET /v1/desktop/team-bridge/link-preview/cache` (the route's stats endpoint,
 * useful to prove behaviour and never rendered). Adding a second cache here would
 * recreate exactly the two-sources-of-truth problem this rewrite removed: one
 * component believing a preview is fresh while the other has expired it, and two
 * places to look when they disagree. What main keeps is `artifact-cache.ts`
 * (bytes, so an image is not re-downloaded) and the small forget-index below
 * (ids only, in memory only, so the "disabled" rule can find what to drop).
 * Neither holds a card. What main keeps is
 * `artifact-cache.ts` (bytes, so an image is not re-downloaded) and the small
 * forget-index below (ids only, in memory only, so the "disabled" rule can find
 * what to drop). Neither holds a card.
 *
 * NOTHING IN HERE EVER LOGS, THROWS OR RETURNS A URL. Invariant 2 of the old
 * module is kept because it is the one part of that design that was right: a
 * link's query string regularly carries capability tokens, a log line outlives
 * the message, and the only identifier this module emits is an artifact id. The
 * handlers have no logger at all — the alternative is a future line somebody adds
 * for a one-off debug and forgets.
 */

import type { DesktopResponse } from "../../shared/desktop-contract";
import {
	LINK_PREVIEW_ACCOUNT_MAX_CHARS,
	LINK_PREVIEW_ARTIFACT_ID,
	LINK_PREVIEW_MAX_URL_CHARS,
	type LinkPreview,
	type LinkPreviewAbsentReason,
	type LinkPreviewArtifact,
	type LinkPreviewArtifactResult,
	type LinkPreviewImageArtifact,
	type LinkPreviewResolveResult,
} from "../../shared/link-preview";
import type { DesktopMediaResponse } from "../desktop-media";
import { type LinkPreviewArtifactCache, previewKeyFor } from "./artifact-cache";

/**
 * The two transport calls, as the caller supplies them.
 *
 * They are the app's OWN desktop transports (`desktop-transport.ts` for the JSON
 * plane, `desktop-media.ts` for bytes), wired in `index.ts`. Passing the
 * functions rather than the backend URL and token keeps the pairing, the bearer
 * and the per-op deadline in the one layer that owns them: this module could not
 * accidentally invent a second request policy.
 */
export interface LinkPreviewTransport {
	/** `desktop-request`'s transport, for the resolve route. */
	request(input: unknown): Promise<DesktopResponse>;
	/** `desktop-media`'s transport, for the artifact route. */
	media(input: unknown): Promise<DesktopMediaResponse>;
}

export interface LinkPreviewServiceOptions {
	transport: LinkPreviewTransport;
	/** Already `open()`ed by the caller. Absent means "cache disabled", which is a
	 * cold read every time and never an error: the app still works with no disk. */
	cache?: LinkPreviewArtifactCache;
}

/** The closed set of refusal reasons this build understands. A reason outside it
 * comes from a newer core, and is treated as `no-metadata` — see `absentReason`. */
const ABSENT_REASONS: ReadonlySet<string> = new Set<LinkPreviewAbsentReason>([
	"cap",
	"no-metadata",
	"local-or-private",
	"unsupported-scheme",
	"blocked-host",
	"content-type",
	"too-large",
	"not-html",
	"disabled",
]);

/**
 * How many previews' artifact ids this process remembers for the drop rule.
 *
 * Small on purpose: the map exists only so a `disabled`/`absent` answer can name
 * the ids to forget, and it is bounded by the number of cards a session is
 * plausibly still drawing. It is NOT a cache — nothing is served from it, and it
 * holds no page data at all.
 */
const FORGET_INDEX_LIMIT = 256;

/**
 * The ids a preview was holding, keyed by a hash of its URL, so a later refusal
 * for the same link knows what to drop.
 *
 * WHY THIS EXISTS AT ALL. A card's images are cached bytes on disk, addressed by
 * core's artifact id. When core later answers `disabled` (the operator switched
 * `web_fetch.enabled` off) or `absent` (the page stopped offering metadata), the
 * renderer drops the card — but the bytes would still be on disk, and a
 * re-mounted transcript that replays the id it already holds would draw the
 * picture for a preview that no longer exists. Core's refusal does not carry the
 * ids, so this app has to remember them from the answer that did.
 *
 * WHY A HASH RATHER THAN THE URL, AND WHY NOTHING IS PERSISTED. A plain URL map
 * would be a browsing record: every link the operator's correspondents sent,
 * retained for the process's life and one crash-dump away from disk. A sha256
 * with a fixed domain prefix answers the same question ("is this the same
 * preview?") without keeping the text. The map is in memory only and dies with
 * the process; after a restart the worst case is that stale bytes stay until
 * their 24 h TTL, which is the same window core gives the card itself.
 */
class ForgetIndex {
	private readonly ids = new Map<string, readonly string[]>();

	record(url: string, artifactIds: readonly string[]): void {
		if (artifactIds.length === 0) return;
		const key = previewKeyFor(url);
		// Re-insert so the Map's own order tracks recency: `keys().next()` below is
		// then the least recently remembered preview.
		this.ids.delete(key);
		this.ids.set(key, artifactIds);
		while (this.ids.size > FORGET_INDEX_LIMIT) {
			const oldest = this.ids.keys().next();
			if (oldest.done === true) break;
			this.ids.delete(oldest.value);
		}
	}

	/** The ids this preview was holding, and forget them: one refusal per preview
	 * needs them once, and a later resolve re-records a fresh answer. */
	take(url: string): readonly string[] {
		const key = previewKeyFor(url);
		const held = this.ids.get(key);
		this.ids.delete(key);
		return held ?? [];
	}
}

export interface LinkPreviewService {
	resolve(request: unknown): Promise<LinkPreviewResolveResult>;
	artifact(request: unknown): Promise<LinkPreviewArtifactResult>;
}

/** A trimmed, non-empty string within `max` characters, or `null`. */
function boundedString(value: unknown, max: number): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > max) return null;
	return trimmed;
}

/** The resolve request, validated before a socket is opened. `url` is length
 * bounded at core's own ceiling so a hostile renderer cannot make main serialize
 * a body core will refuse on size alone. */
export function isResolveRequest(
	value: unknown,
): value is { url: string; index: number; expectedAccountId: string } {
	if (typeof value !== "object" || value === null) return false;
	const request = value as {
		url?: unknown;
		index?: unknown;
		expectedAccountId?: unknown;
	};
	if (boundedString(request.url, LINK_PREVIEW_MAX_URL_CHARS) === null)
		return false;
	if (
		typeof request.index !== "number" ||
		!Number.isSafeInteger(request.index) ||
		request.index < 0
	)
		return false;
	return (
		boundedString(request.expectedAccountId, LINK_PREVIEW_ACCOUNT_MAX_CHARS) !==
		null
	);
}

/** The artifact request. The id's shape is asserted here as well as by core's
 * route and store, because it is a path segment on the wire and a FILE NAME in
 * this app's cache: one check in front of both is cheaper than a path bug. */
export function isArtifactRequest(
	value: unknown,
): value is { id: string; expectedAccountId: string } {
	if (typeof value !== "object" || value === null) return false;
	const request = value as { id?: unknown; expectedAccountId?: unknown };
	if (typeof request.id !== "string") return false;
	if (!LINK_PREVIEW_ARTIFACT_ID.test(request.id)) return false;
	return (
		boundedString(request.expectedAccountId, LINK_PREVIEW_ACCOUNT_MAX_CHARS) !==
		null
	);
}

function optionalText(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

/** One artifact reference as core sends it, or `null` when the shape is not one
 * this build can address. An id that fails the pattern is DROPPED rather than
 * forwarded: it could not be fetched (core's route would 422) and it could not
 * name a cache file either. */
function toArtifact(value: unknown): LinkPreviewArtifact | null {
	if (typeof value !== "object" || value === null) return null;
	const artifact = value as { id?: unknown; mime?: unknown };
	if (typeof artifact.id !== "string") return null;
	if (!LINK_PREVIEW_ARTIFACT_ID.test(artifact.id)) return null;
	const mime = boundedString(artifact.mime, 128);
	if (mime === null) return null;
	return { id: artifact.id, mime };
}

function toImage(value: unknown): LinkPreviewImageArtifact | null {
	const base = toArtifact(value);
	if (base === null) return null;
	const image = value as { width?: unknown; height?: unknown };
	// Dimensions are optional and are only ever *reported*: a renderer that needs
	// a ratio either gets the real numbers or falls back to its own layout, so a
	// malformed pair is dropped rather than guessed at.
	const dimension = (candidate: unknown): number | null =>
		typeof candidate === "number" &&
		Number.isInteger(candidate) &&
		candidate > 0 &&
		candidate <= 100_000
			? candidate
			: null;
	return {
		...base,
		width: dimension(image.width),
		height: dimension(image.height),
	};
}

function toPreview(value: unknown): LinkPreview | null {
	if (typeof value !== "object" || value === null) return null;
	const preview = value as Record<string, unknown>;
	const url = boundedString(preview.url, LINK_PREVIEW_MAX_URL_CHARS);
	if (url === null) return null;
	const image = toImage(preview.image);
	return {
		url,
		// Core omits a field that is absent (`response_model_exclude_none`), so
		// "not there" and "null" mean the same thing and both become `null` here:
		// one absence spelling is what the renderer's union declares.
		title: optionalText(preview.title),
		description: optionalText(preview.description),
		siteName: optionalText(preview.siteName),
		favicon: toArtifact(preview.favicon),
		image:
			image === null
				? null
				: ({
						id: image.id,
						mime: image.mime,
						width: image.width,
						height: image.height,
					} satisfies LinkPreviewImageArtifact),
	};
}

/** A reason this build understands. An unknown one is `no-metadata`: it is the
 * only value that draws nothing while advertising no remedy, and a card must never
 * tell the user to retry a state this app cannot describe. */
function absentReason(value: unknown): LinkPreviewAbsentReason {
	return typeof value === "string" && ABSENT_REASONS.has(value)
		? (value as LinkPreviewAbsentReason)
		: "no-metadata";
}

/** Core's resolution body, mapped onto the renderer's union unchanged.
 *
 * A body that is not one of the three shapes is a transport-level failure rather
 * than a state: `retryable: true`, because nothing about the link was learned. */
export function mapResolution(result: unknown): LinkPreviewResolveResult {
	if (typeof result !== "object" || result === null)
		return { kind: "error", retryable: true };
	const resolution = result as Record<string, unknown>;
	if (resolution.kind === "ready") {
		const preview = toPreview(resolution.preview);
		// A "ready" with no addressable preview is a shape this build cannot draw,
		// and drawing a half-card would put a broken image in the transcript.
		return preview === null
			? { kind: "error", retryable: true }
			: { kind: "ready", preview };
	}
	if (resolution.kind === "absent")
		return { kind: "absent", reason: absentReason(resolution.reason) };
	if (resolution.kind === "error")
		return { kind: "error", retryable: resolution.retryable === true };
	return { kind: "error", retryable: true };
}

/**
 * The delay a `429` asked for, in milliseconds.
 *
 * Core sends `retry_after_seconds` in the body AND a `Retry-After` header. The
 * body is what this reads, because the transport hands back a status and a parsed
 * body and not the headers — and the two are the same number by construction
 * (`_rate_limited` derives both from one float). A 429 with no usable number is
 * still retryable, just without a delay to quote.
 */
function retryAfterMs(detail: unknown): number | undefined {
	if (typeof detail !== "object" || detail === null) return undefined;
	const seconds = (detail as { retry_after_seconds?: unknown })
		.retry_after_seconds;
	if (typeof seconds !== "number" || !Number.isFinite(seconds))
		return undefined;
	if (seconds < 0) return undefined;
	// Rounded up: waiting slightly too long is a slower card, waiting too little is
	// a second refusal.
	return Math.min(Math.ceil(seconds * 1000), 60_000);
}

/** The `detail` object of a desktop refusal, whatever nesting the route used. */
function refusalDetail(body: unknown): unknown {
	if (typeof body !== "object" || body === null) return undefined;
	return (body as { detail?: unknown }).detail;
}

/** The `result` field of the surface's `CRUDResponse` envelope. */
function envelopeResult(body: unknown): unknown {
	if (typeof body !== "object" || body === null) return undefined;
	return (body as { result?: unknown }).result;
}

/** Core's `CRUDResponse` code for a rate limit; the one status this module maps
 * to a delay rather than to a failure. */
const RATE_LIMITED = 429;

export function createLinkPreviewService(
	options: LinkPreviewServiceOptions,
): LinkPreviewService {
	const { transport, cache } = options;
	const forget = new ForgetIndex();

	async function resolve(input: unknown): Promise<LinkPreviewResolveResult> {
		if (!isResolveRequest(input))
			// Never sent, and no more specific state exists for "the caller asked for
			// something that is not a preview": `unsupported-scheme` is the nearest
			// honest answer, and it draws nothing.
			return { kind: "absent", reason: "unsupported-scheme" };
		const { url, index, expectedAccountId } = input;
		let answer: DesktopResponse;
		try {
			answer = await transport.request({
				op: "team_bridge.link_preview.resolve",
				url,
				index,
				expectedAccountId,
			});
		} catch {
			// A resolved promise says nothing about whether anything answered, so this
			// is the belt to the transport's braces: a caller that throws instead of
			// answering is a retry, never a broken link.
			return { kind: "error", retryable: true };
		}
		if (answer.status === RATE_LIMITED) {
			// "Not now" is not a broken link: a card that shows the retry state with
			// this delay is the whole point of the mapping.
			const delay = retryAfterMs(refusalDetail(answer.body));
			return {
				kind: "error",
				retryable: true,
				...(delay === undefined ? {} : { retryAfterMs: delay }),
			};
		}
		if (answer.status !== 200)
			// 4xx here is a fact a retry cannot change (another account's receipt — core
			// answers 409 — or no sign-in, 401); anything else is worth trying again.
			return {
				kind: "error",
				retryable: !(answer.status >= 400 && answer.status < 500),
			};
		const mapped = mapResolution(envelopeResult(answer.body));
		if (mapped.kind === "ready") {
			const preview = mapped.preview;
			forget.record(
				url,
				[preview.favicon?.id, preview.image?.id].filter(
					(candidate): candidate is string => typeof candidate === "string",
				),
			);
			return mapped;
		}
		if (mapped.kind === "absent") {
			// The drop rule. `disabled` matters most (the operator's own switch must
			// not leave drawable bytes behind), and any other absence means the card
			// this preview had is gone; either way the ids that preview was holding
			// must not survive it.
			const held = forget.take(url);
			if (held.length > 0) await cache?.drop(held);
		}
		return mapped;
	}

	async function artifact(input: unknown): Promise<LinkPreviewArtifactResult> {
		if (!isArtifactRequest(input))
			return { kind: "error", code: "invalid-request", status: 400 };
		const { id, expectedAccountId } = input;
		const cached = await cache?.read(id);
		if (cached !== undefined && cached !== null)
			return { kind: "bytes", data: cached.bytes, mimeType: cached.mime };
		let answer: DesktopMediaResponse;
		try {
			answer = await transport.media({
				op: "team_bridge.link_preview.artifact",
				id,
				expectedAccountId,
			});
		} catch {
			return { kind: "error", code: "io", status: 503 };
		}
		if (answer.kind === "bytes") {
			// Stored BEFORE it is returned, but a store failure is not a read failure:
			// the bytes are in hand and the card can draw them either way.
			await cache?.store(id, answer.mimeType, answer.data);
			return { kind: "bytes", data: answer.data, mimeType: answer.mimeType };
		}
		if (answer.status === 404 || answer.status === 422)
			// Core makes "your scope does not name this id" and "the bytes are gone"
			// deliberately indistinguishable, so there is one code for both — and this
			// app must not try to tell them apart either.
			return {
				kind: "error",
				code: answer.status === 404 ? "not-found" : "invalid-request",
				status: answer.status,
			};
		return { kind: "error", code: "io", status: answer.status };
	}

	return { resolve, artifact };
}
