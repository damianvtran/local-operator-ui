/**
 * Resolving one link into one card, under caps, and never trusting the far end.
 *
 * TWO INVARIANTS THIS FILE CARRIES, quoted for review.
 *
 *  (1) THE SNIFF DECIDES, NOT THE HEADER. `Content-Type` is a claim made by the
 *      server being fetched; the bytes are the fact. A page is parsed only when
 *      its bytes sniff as HTML (`sniffBytes(...) === "html"`), and an image
 *      artifact is stored only when its bytes sniff as one of the five raster
 *      formats. The declared type can narrow a REFUSAL's label - never widen an
 *      acceptance - so a `.png` answering `image/png` with an HTML document is not
 *      cached as a picture, a PNG answering `text/plain` is still a picture, and
 *      `image/svg+xml` is not an image this module knows at all.
 *
 *  (2) NO URL, HOST OR QUERY EVER REACHES A LOG, AN ERROR OR A FILENAME. The only
 *      identifier that may cross any of those surfaces is the opaque `previewId`
 *      (32 hex chars, sha256-derived). Every log call in this file is built from
 *      that id, a reason and a status - never from the URL it came from - because
 *      a request URL is user data: it can carry a search term, a private document
 *      id, or a token in a query string, and log files are read by support, by
 *      crash reporters and by whoever inherits the machine.
 *
 * WHY THE SHAPE OF THIS MODULE IS SO DEFENSIVE. Every input here is chosen by
 * whoever wrote the message, and the fetch happens from the reader's machine,
 * inside their network, with their ambient trust: that is the definition of an
 * SSRF primitive. So the URL is normalised (`url.ts`), the host is resolved and
 * every address classified once (`ssrf.ts`), the connection is pinned to that
 * address, EVERY redirect hop repeats the whole check, and the exchange is bounded
 * in bytes, in wall clock and in decompression.
 */

import { LINK_PREVIEW_MAX_CARDS_PER_MESSAGE } from "../../shared/link-preview";
import type {
	LinkPreview,
	LinkPreviewAbsentReason,
	LinkPreviewArtifactKind,
	LinkPreviewImageResult,
	LinkPreviewResolveResult,
} from "../../shared/link-preview";
import {
	type LinkPreviewCache,
	type PendingArtifact,
	previewIdFor,
} from "./cache";
import { parseImageDimensions } from "./dimensions";
import type { Hop } from "./http-transport";
import { extractMetadata, hasPreviewContent } from "./metadata";
import { isAcceptedImageKind, mimeForKind, sniffBytes } from "./sniff";
import { type LookupAll, verifyHostAddress } from "./ssrf";
import { lookupHostFor, normaliseLinkUrl } from "./url";

/** Overall wall clock for one resolve, redirects included. */
export const TOTAL_BUDGET_MS = 4000;
/** A single hop gets at most this much of the remaining budget. */
const MAX_HOP_MS = 4000;
/** A page, and each artifact, is bounded by this many DECOMPRESSED bytes. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Icons are small; anything larger is not a favicon. */
const MAX_FAVICON_BYTES = 256 * 1024;
/** Redirects followed before the chain is refused. */
const MAX_REDIRECTS = 3;

/**
 * Declared content types that are a file download rather than a document.
 *
 * Used ONLY to pick between two refusal labels once the bytes have already failed
 * to sniff as HTML (invariant 1) - never to accept or refuse on its own.
 */
const DECLARED_NON_DOCUMENT = new Set([
	"application/pdf",
	"application/zip",
	"application/octet-stream",
	"application/json",
	"application/xml",
	"text/plain",
	"text/csv",
]);

export type LinkPreviewLog = (line: string) => void;

export interface LinkPreviewService {
	resolve(request: {
		url: string;
		index: number;
	}): Promise<LinkPreviewResolveResult>;
	image(request: {
		previewId: string;
		which: LinkPreviewArtifactKind;
	}): Promise<LinkPreviewImageResult>;
}

export interface LinkPreviewServiceOptions {
	cache: LinkPreviewCache;
	hop: Hop;
	lookup: LookupAll;
	log?: LinkPreviewLog;
	now?: () => number;
}

/** An artifact whose bytes have already sniffed as one of the five accepted
 * formats. The id is derived by the caller (`previewIdFor`), because it depends on
 * the cache key rather than on the bytes. */
interface FetchedArtifact {
	mime: string;
	bytes: Uint8Array;
	kind: "png" | "jpeg" | "gif" | "webp" | "ico";
}

/** The outcome of one guarded fetch chain, before it becomes a card. */
type Fetched =
	| { ok: true; url: URL; bytes: Uint8Array; contentType: string | null }
	| { ok: false; result: LinkPreviewResolveResult };

/** The ceiling, named here so the guard reads as the product rule it is. */
const MAX_CARDS_PER_MESSAGE = LINK_PREVIEW_MAX_CARDS_PER_MESSAGE;
/** An artifact id: 32 lowercase hex characters and nothing else. */
const ARTIFACT_ID = /^[0-9a-f]{32}$/;

function absent(reason: LinkPreviewAbsentReason): LinkPreviewResolveResult {
	return { kind: "absent", reason };
}

export function createLinkPreviewService(
	options: LinkPreviewServiceOptions,
): LinkPreviewService {
	const { cache, hop, lookup } = options;
	/*
	 * Dimensions from the header ONLY, never a decode (see `dimensions.ts`): the
	 * bytes are parsed once here and the width/height reused, because measuring an
	 * image twice is how a hostile header ends up decoded for its numbers.
	 */
	const imageWithSize = (
		id: string,
		image: {
			mime: string;
			bytes: Uint8Array;
			kind: "png" | "jpeg" | "gif" | "webp" | "ico";
		},
	): {
		id: string;
		mime: string;
		width: number | null;
		height: number | null;
	} => {
		const size = parseImageDimensions(image.kind, image.bytes);
		return {
			id,
			mime: image.mime,
			width: size?.width ?? null,
			height: size?.height ?? null,
		};
	};
	const log = options.log ?? (() => {});
	const now = options.now ?? (() => Date.now());
	/** One fetch per normalised URL: N cards in one window share one exchange. */
	const inflight = new Map<string, Promise<LinkPreviewResolveResult>>();

	/**
	 * Follow a URL through at most `MAX_REDIRECTS` hops, re-running the FULL guard
	 * on each one.
	 *
	 * The guard cannot be applied once at the entry point: a public host is free to
	 * answer `302 Location: http://169.254.169.254/`, which is precisely the attack
	 * the first check would otherwise be holding the door for. So every hop resolves
	 * and classifies again, and the connection for that hop is pinned to the address
	 * that was just validated. Cookies are never sent (the transport has no jar) and
	 * there are no auth headers to strip.
	 */
	async function fetchGuarded(
		start: URL,
		maxBytes: number,
		deadline: number,
	): Promise<Fetched> {
		let current = start;
		for (let hopIndex = 0; hopIndex <= MAX_REDIRECTS; hopIndex += 1) {
			const normalised = normaliseLinkUrl(current.toString());
			if (!normalised.ok)
				return { ok: false, result: absent(normalised.reason) };
			current = normalised.url;
			const verified = await verifyHostAddress(
				lookupHostFor(current.hostname),
				lookup,
			);
			if (!verified.ok) return { ok: false, result: absent(verified.reason) };
			const remaining = deadline - now();
			if (remaining <= 0)
				return { ok: false, result: { kind: "error", retryable: true } };
			let response: Awaited<ReturnType<Hop>>;
			try {
				response = await hop({
					url: current,
					address: verified.address,
					family: verified.family,
					timeoutMs: Math.min(MAX_HOP_MS, deadline - now()),
					maxBytes,
				});
			} catch {
				// Transport failure, with no URL in the message: this is the point where
				// a raw error would otherwise carry the host straight into a log line.
				return { ok: false, result: { kind: "error", retryable: true } };
			}
			if (response.status >= 300 && response.status < 400) {
				if (response.location === null) {
					return { ok: false, result: { kind: "error", retryable: false } };
				}
				if (hopIndex === MAX_REDIRECTS) {
					// One hop too many: the chain is refused rather than truncated, because a
					// truncated chain answers for a page nobody asked to see.
					return { ok: false, result: { kind: "error", retryable: false } };
				}
				let next: URL;
				try {
					next = new URL(response.location, current);
				} catch {
					return { ok: false, result: { kind: "error", retryable: false } };
				}
				current = next;
				continue;
			}
			if (response.status < 200 || response.status >= 300) {
				return {
					ok: false,
					result: {
						kind: "error",
						retryable: response.status >= 500 || response.status === 429,
					},
				};
			}
			if (response.truncated) return { ok: false, result: absent("too-large") };
			return {
				ok: true,
				url: current,
				bytes: response.body,
				contentType: response.contentType,
			};
		}
		return { ok: false, result: { kind: "error", retryable: false } };
	}

	/** Why a body that is not HTML was refused. The declared type only picks the
	 * label; it never decides the outcome (invariant 1). */
	function nonHtmlReason(declaredType: string | null): LinkPreviewAbsentReason {
		const declared =
			(declaredType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
		return DECLARED_NON_DOCUMENT.has(declared) ? "content-type" : "not-html";
	}

	/** One artifact: fetched, sniffed, and only then accepted. `null` means the card
	 * simply has none - a broken picture is a state, not an error. */
	async function fetchArtifact(
		href: string | null,
		base: URL,
		maxBytes: number,
		deadline: number,
	): Promise<FetchedArtifact | null> {
		if (href === null || href.trim() === "") return null;
		let target: URL;
		try {
			target = new URL(href, base);
		} catch {
			return null;
		}
		const fetched = await fetchGuarded(target, maxBytes, deadline);
		if (!fetched.ok) return null;
		const sniffed = sniffBytes(fetched.bytes);
		// THE SNIFF DECIDES (invariant 1): an SVG, an HTML error page served under a
		// .png name, and a PDF all fail here and are stored as nothing at all.
		if (!isAcceptedImageKind(sniffed)) return null;
		return {
			mime: mimeForKind(sniffed),
			bytes: fetched.bytes,
			kind: sniffed,
		};
	}

	async function fetchAndBuild(
		url: URL,
		key: string,
		deadline: number,
	): Promise<LinkPreviewResolveResult> {
		const fetched = await fetchGuarded(url, MAX_BODY_BYTES, deadline);
		if (!fetched.ok) return fetched.result;
		const sniffed = sniffBytes(fetched.bytes);
		if (sniffed !== "html") {
			// Invariant 1: the bytes, not the header, decided this is not a document.
			return absent(nonHtmlReason(fetched.contentType));
		}
		const metadata = extractMetadata(fetched.bytes);
		if (!hasPreviewContent(metadata)) return absent("no-metadata");

		const faviconHref = metadata.iconHref ?? "/favicon.ico";
		const [favicon, image] = await Promise.all([
			fetchArtifact(faviconHref, fetched.url, MAX_FAVICON_BYTES, deadline),
			fetchArtifact(metadata.imageHref, fetched.url, MAX_BODY_BYTES, deadline),
		]);

		const faviconId = favicon === null ? null : previewIdFor("favicon", key);
		const imageId = image === null ? null : previewIdFor("image", key);
		const pending: PendingArtifact[] = [];
		if (favicon !== null && faviconId !== null) {
			pending.push({ id: faviconId, mime: favicon.mime, bytes: favicon.bytes });
		}
		if (image !== null && imageId !== null) {
			pending.push({ id: imageId, mime: image.mime, bytes: image.bytes });
		}
		const preview: LinkPreview = {
			url: fetched.url.toString(),
			title: metadata.title,
			description: metadata.description,
			siteName: metadata.siteName,
			favicon:
				faviconId === null || favicon === null
					? null
					: { id: faviconId, mime: favicon.mime },
			image:
				imageId === null || image === null
					? null
					: imageWithSize(imageId, image),
		};
		return cache.store(key, { kind: "ready", preview }, pending);
	}

	/** Record an answer without ever writing the address that produced it. The id
	 * is a one-way function of the key, so the log line cannot be reversed back
	 * into a URL. */
	function logOutcome(
		id: string | null,
		outcome: { kind: string; reason?: string },
	): void {
		// The ONLY identifier that may appear: an opaque id, a state and a reason.
		// Invariant 2 - no URL, host or query reaches this string.
		log(
			`link-preview ${id ?? "unidentified"} ${outcome.kind}${outcome.reason ? `:${outcome.reason}` : ""}`,
		);
	}

	return {
		async resolve(request) {
			// The per-message cap is enforced HERE, before any parsing or lookup, so a
			// message with forty links costs three fetches rather than forty. `index`
			// arrives from the renderer and is validated rather than trusted: a value
			// that is not a usable position is treated as over the cap, because the
			// only safe answer to nonsense is not to fetch.
			if (
				!Number.isInteger(request.index) ||
				request.index < 0 ||
				request.index >= MAX_CARDS_PER_MESSAGE
			) {
				return absent("cap");
			}
			const normalised = normaliseLinkUrl(request.url);
			if (!normalised.ok) {
				logOutcome(null, { kind: "absent", reason: normalised.reason });
				return absent(normalised.reason);
			}
			const { key, url } = normalised;
			const cached = cache.lookup(key);
			if (cached !== undefined) {
				logOutcome(previewIdFor("image", key), { kind: "cached" });
				return cached.result;
			}
			const existing = inflight.get(key);
			if (existing !== undefined) return existing;
			const deadline = now() + TOTAL_BUDGET_MS;
			const work = (async (): Promise<LinkPreviewResolveResult> => {
				let result: LinkPreviewResolveResult;
				try {
					result = await fetchAndBuild(url, key, deadline);
				} catch {
					// Anything unforeseen is a state, never a rejection: the renderer's
					// `resolve` call always resolves (the contract's first rule).
					result = { kind: "error", retryable: true };
				}
				if (result.kind !== "ready") {
					// Negative caching is what stops a dead host from being re-fetched on
					// every scroll (30 minutes, see cache.ts).
					await cache.store(key, result, []);
				}
				logOutcome(previewIdFor("image", key), result);
				return result;
			})();
			inflight.set(key, work);
			try {
				return await work;
			} finally {
				inflight.delete(key);
			}
		},

		async image(request) {
			if (request.which !== "favicon" && request.which !== "image") {
				return { kind: "error", code: "invalid-request", status: 400 };
			}
			if (
				typeof request.previewId !== "string" ||
				!ARTIFACT_ID.test(request.previewId)
			) {
				return { kind: "error", code: "invalid-request", status: 400 };
			}
			try {
				const artifact = await cache.read(request.previewId);
				if (artifact === null) {
					return { kind: "error", code: "not-found", status: 404 };
				}
				return { kind: "bytes", data: artifact.bytes, mimeType: artifact.mime };
			} catch {
				return { kind: "error", code: "io", status: 500 };
			}
		},
	};
}
