/**
 * The link-preview contract: what ONE card may be shown, and what the renderer
 * may ask main for.
 *
 * WHY THE SHAPES LIVE IN `shared/`. The preload's `index.d.ts`, the main-process
 * service and the renderer's card all speak these types, and three hand-written
 * copies of a union with eight refusal reasons is how a card ends up rendering a
 * state nobody defined. It is the same reason `desktop-contract` and
 * `browser-tab-action` live here.
 *
 * TWO INVARIANTS THIS CONTRACT EXISTS TO CARRY.
 *
 *  1. A refusal is a STATE, not a throw. `resolve` always resolves, so a hostile
 *     or broken third-party page is one more card that renders nothing rather
 *     than an unhandled IPC rejection in the transcript.
 *  2. Nothing in here is a third-party URL the renderer may point an `<img>` at.
 *     `favicon`/`image` carry an opaque `id` and a mime type; the bytes are
 *     fetched from main's own cache through `image`. A third-party origin is
 *     never named in a renderer-fetchable position, so a card can never leak a
 *     request (or the reader's IP, or a referrer) to the site being previewed.
 */

/**
 * The per-message card ceiling. Three is the number the product chose for a
 * message that is mostly links; the cap lives in MAIN because a renderer-side
 * cap is a suggestion - `resolve` refuses `index >= 3` before any DNS lookup, so
 * a message with forty links costs three fetches, not forty.
 */
export const LINK_PREVIEW_MAX_CARDS_PER_MESSAGE = 3;

/** Which artifact of a preview an `image` request names. */
export type LinkPreviewArtifactKind = "favicon" | "image";

/**
 * The two IPC channels, named HERE because they are the cross-lane contract.
 *
 * The preload invokes them, main answers them, and the renderer lane is the next
 * consumer: a channel string written twice is a rename that can land in one place
 * and not the other, so both sides import these two constants instead of spelling
 * them out.
 */
export const LINK_PREVIEW_RESOLVE_CHANNEL = "link-preview:resolve";
export const LINK_PREVIEW_IMAGE_CHANNEL = "link-preview:image";

export interface LinkPreviewFavicon {
	/** Opaque, 32 hex chars, sha256-derived. The only identifier that may cross
	 * a log line or a filename - never the URL it was derived from. */
	id: string;
	/** Sniffed from the bytes, not read from the server's header. */
	mime: string;
}

export interface LinkPreviewImage extends LinkPreviewFavicon {
	/** Parsed from the image's own header bytes; `null` when the header was
	 * truncated or the format carries no size. Never measured by decoding. */
	width: number | null;
	height: number | null;
}

export interface LinkPreview {
	/** The final canonical URL after redirects, for the card's link target. */
	url: string;
	title: string | null;
	description: string | null;
	siteName: string | null;
	favicon: LinkPreviewFavicon | null;
	image: LinkPreviewImage | null;
}

/**
 * Why a link has no card. Every value is a state the transcript renders as
 * nothing at all; they are distinct because the reasons have different TTLs and
 * different operational meanings (a dead host is negative-cached, a cap is not
 * even a fetch).
 */
export type LinkPreviewAbsentReason =
	/** `index >= LINK_PREVIEW_MAX_CARDS_PER_MESSAGE`; no request was made. */
	| "cap"
	/** The page is fine and has nothing to show. */
	| "no-metadata"
	/** Resolved to loopback/private/link-local/CGNAT/ULA/metadata. */
	| "local-or-private"
	/** Not http(s), or not a URL at all. */
	| "unsupported-scheme"
	/** Credentials in the URL, an unnormalisable host, or a DNS failure. */
	| "blocked-host"
	/** The server declared, and the bytes agreed, that this is a file download
	 * rather than a document (see `LinkPreviewAbsentReason`'s note in
	 * `resolve.ts` - the header may only narrow a refusal, never widen an
	 * acceptance). */
	| "content-type"
	/** The body or a decompressed body crossed its byte cap. */
	| "too-large"
	/** The bytes did not sniff as HTML. */
	| "not-html";

export type LinkPreviewResolveResult =
	| { kind: "ready"; preview: LinkPreview }
	| { kind: "absent"; reason: LinkPreviewAbsentReason }
	/** Transport/parse failure with no more specific state. `retryable` is false
	 * for a refusal that a retry cannot change (a blocked host, a bad scheme). */
	| { kind: "error"; retryable: boolean };

export interface LinkPreviewResolveRequest {
	url: string;
	/** The link's 0-based position in its message. */
	index: number;
}

export interface LinkPreviewImageRequest {
	previewId: string;
	which: LinkPreviewArtifactKind;
}

export type LinkPreviewImageErrorCode = "not-found" | "invalid-request" | "io";

/** Same envelope style as the app's existing media answers
 * (`DesktopMediaResponse`), so a renderer already reading `kind` reads this. */
export type LinkPreviewImageResult =
	| { kind: "bytes"; data: Uint8Array; mimeType: string }
	| { kind: "error"; code: LinkPreviewImageErrorCode; status: number };

/** The preload surface, `window.api.linkPreview`. */
export interface LinkPreviewBridge {
	resolve(
		request: LinkPreviewResolveRequest,
	): Promise<LinkPreviewResolveResult>;
	image(request: LinkPreviewImageRequest): Promise<LinkPreviewImageResult>;
}
