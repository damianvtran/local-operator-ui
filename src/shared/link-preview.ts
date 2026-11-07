/**
 * The link-preview contract: what ONE card may be shown, and what the renderer
 * may ask main for.
 *
 * WHY THE SHAPES LIVE IN `shared/`. The preload's `index.d.ts`, the main-process
 * proxy and the renderer's card all speak these types, and three hand-written
 * copies of a union with nine refusal reasons is how a card ends up rendering a
 * state nobody defined. It is the same reason `desktop-contract` and
 * `browser-tab-action` live here.
 *
 * WHAT CHANGED FROM THE FIRST ATTEMPT, AND WHY IT MATTERS TO THE UI LANE.
 * The superseded branch resolved links itself: it fetched the page in Electron
 * main, sniffed its HTML, parsed OpenGraph, and derived the artifact ids from the
 * URL. That whole path is gone. Fetching is a CORE capability now
 * (`local_operator/team_bridge/link_preview/`, released in core 0.101.2), and
 * this repo's only job is to proxy two routes and to keep artifact BYTES on disk.
 * Consequences a reader of this file has to know, because they are visible in the
 * shapes below and in nothing else:
 *
 *  1. THE IDS ARE CORE'S, not ours. `favicon.id` and `image.id` are 32 hex
 *     chars derived by core from the account, the tenant and the canonical URL,
 *     and they are the only names an artifact has. Nothing here derives a second
 *     id: two id schemes over the same bytes is how a cache serves one account's
 *     image to another's session. So the old `image({previewId, which})` request
 *     — which existed because the old code had to be told which KIND an id meant
 *     — collapses to `artifact({id})`: the id already names one artifact, and its
 *     mime arrives with the bytes (core re-sniffs them on every read, so a
 *     `which` field would be a second, unverifiable claim about the same bytes).
 *  2. THE ACCOUNT RECEIPT IS THE CALLER'S. Both routes are bearer-gated AND take
 *     the account the caller believes it is (`expected_account_id` in the body,
 *     `X-Link-Preview-Account` as a header). Main cannot invent that value: it
 *     holds no signed-in identity of its own, and the renderer already sends the
 *     same receipt on every `team_bridge.*` op. Core compares it against the
 *     identity the install actually holds and refuses a mismatch, so the field is
 *     a receipt rather than a grant — which is exactly why passing it through is
 *     safe.
 *  3. A REFUSAL IS STILL A STATE, NOT A THROW. `resolve` always resolves, so a
 *     hostile, dead or private link is one more card that renders nothing rather
 *     than an unhandled IPC rejection in the transcript.
 *  4. NOTHING HERE IS A THIRD-PARTY URL THE RENDERER MAY POINT AN `<img>` AT.
 *     `favicon`/`image` carry an opaque `id` and a mime; the bytes come from
 *     main's own cache through `artifact`. A card can therefore never leak a
 *     request — or the reader's address, or a referrer — to the site previewed.
 */

/** The per-message card ceiling. Enforced by CORE, before any fetch, because a
 * renderer-side cap is a suggestion: a message with forty links would otherwise
 * cost forty fetches. Mirrored here only so the renderer can stop rendering cards
 * it knows core will refuse as `cap`. */
export const LINK_PREVIEW_MAX_CARDS_PER_MESSAGE = 3;

/**
 * Core's own bound on the URL text a resolve may carry
 * (`MAX_URL_CHARS` in `server/routes/desktop_link_preview.py`). Longer than a
 * link a person wrote by hand; short enough that the fetcher's normalisation
 * never sees an unbounded body field.
 */
export const LINK_PREVIEW_MAX_URL_CHARS = 4096;

/** The account receipt's bounds, mirroring the route's `Header(min_length=1,
 * max_length=128)`. */
export const LINK_PREVIEW_ACCOUNT_MAX_CHARS = 128;

/** An artifact id, as core shapes it at its boundary and re-checks in its store.
 * Asserted here as well so a renderer value can never become a path segment. */
export const LINK_PREVIEW_ARTIFACT_ID = /^[0-9a-f]{32}$/;

/**
 * The two IPC channels, named HERE because they are the cross-lane contract.
 *
 * The preload invokes them, main answers them, and the renderer lane is the next
 * consumer: a channel string written twice is a rename that can land in one place
 * and not the other, so both sides import these two constants instead of
 * spelling them out.
 */
export const LINK_PREVIEW_RESOLVE_CHANNEL = "link-preview:resolve";
export const LINK_PREVIEW_ARTIFACT_CHANNEL = "link-preview:artifact";

export interface LinkPreviewArtifact {
	/** Core's scope-derived id: 32 hex chars, the only identifier that may cross a
	 * log line or name a cache file — never the URL it was derived from. */
	id: string;
	/** Sniffed from the bytes by core on every read, not read from a server's
	 * header and not trusted from a cache entry. */
	mime: string;
}

export interface LinkPreviewImageArtifact extends LinkPreviewArtifact {
	/** Read from the image's own header bytes by core; `null` when that header
	 * does not carry a size cheaply. Never measured by decoding pixels, and a
	 * renderer that needs the ratio must fall back to its own layout. */
	width: number | null;
	height: number | null;
}

export interface LinkPreview {
	/** The final canonical URL after redirects, for the card's link target. It is
	 * the link the message already carries — display text, never a fetch target
	 * for this app or for the renderer. */
	url: string;
	title: string | null;
	description: string | null;
	siteName: string | null;
	favicon: LinkPreviewArtifact | null;
	image: LinkPreviewImageArtifact | null;
}

/**
 * Why a link has no card. Every value is a state the transcript renders as
 * nothing at all; they are distinct because the reasons have different
 * operational meanings, and because two of them must not be drawn with the same
 * copy.
 */
export type LinkPreviewAbsentReason =
	/** The message already holds `LINK_PREVIEW_MAX_CARDS_PER_MESSAGE` previews; no
	 * fetch was made. */
	| "cap"
	/** The page is fine and has nothing to show. */
	| "no-metadata"
	/** Core's address guard refused the target — including on a redirect hop. */
	| "local-or-private"
	/** Not http(s), or not a URL at all. */
	| "unsupported-scheme"
	/** No host to judge, credentials in the URL, a name that does not resolve, or
	 * a chain that could not be completed. */
	| "blocked-host"
	/** The server declared — and the bytes agreed — that this is a file download
	 * rather than a document. */
	| "content-type"
	/** The body, or a decompressed body, crossed its byte cap. */
	| "too-large"
	/** The bytes did not sniff as HTML. */
	| "not-html"
	/**
	 * The operator's own `web_fetch.enabled` is off, so core fetched nothing at
	 * all.
	 *
	 * DISTINCT FROM EVERY OTHER REASON ON PURPOSE, even though a card draws it the
	 * same way as `absent`: nothing was attempted and no address rule refused
	 * anything, so a renderer must not show the "this link goes somewhere local"
	 * copy for a switch the operator flipped. It is also the one reason with a
	 * main-side side effect — see the artifact-drop rule in
	 * `ForgetIndex` (`src/main/link-preview/service.ts`).
	 */
	| "disabled";

export type LinkPreviewResolveResult =
	| { kind: "ready"; preview: LinkPreview }
	| { kind: "absent"; reason: LinkPreviewAbsentReason }
	/**
	 * A failure with no more specific state. `retryable` is false for a refusal a
	 * retry cannot change (another account's receipt, no sign-in).
	 *
	 * `retryAfterMs` is present only when the backend said WHEN to come back (a
	 * `429` with `retry_after_seconds`), and it is the delay core asked for, not
	 * one this app chooses. A card that retries may wait this long; a card that
	 * ignores it is still correct to draw the retryable state, so this field is
	 * additive to the lane that already reads `retryable`.
	 */
	| { kind: "error"; retryable: boolean; retryAfterMs?: number };

export interface LinkPreviewResolveRequest {
	url: string;
	/** The link's 0-based position in its message. Core enforces the cap on it. */
	index: number;
	/** The account the caller believes it is. A receipt core verifies, never a
	 * scope the caller gets to pick. */
	expectedAccountId: string;
}

export interface LinkPreviewArtifactRequest {
	/** Core's artifact id from a resolved preview's `favicon.id`/`image.id`. */
	id: string;
	/** The same receipt the resolve call carried: the artifact route takes it as
	 * `X-Link-Preview-Account`, and a mismatch is a `404` indistinguishable from
	 * "gone". */
	expectedAccountId: string;
}

export type LinkPreviewArtifactErrorCode =
	/** 404 from core: this scope does not name the id — or the bytes are gone.
	 * Deliberately one code, because core makes the two indistinguishable. */
	| "not-found"
	/** The request never met a valid id, or core refused a malformed one (422). */
	| "invalid-request"
	/**
	 * Core answered `409`: this artifact belongs to another account.
	 *
	 * Its own member rather than `io` because it is the one refusal that says the
	 * account fence just held, and because `io` is the code a renderer retries:
	 * retrying cannot change whose account this is. A card should render nothing
	 * and stop asking.
	 */
	| "account-mismatch"
	/** `401`/`403`: this install is not signed in as an account that may read the
	 * id. Same class as `account-mismatch` — a retry does not help until the user
	 * signs in — and separate from it because the remedy is different. */
	| "unauthorized"
	/** Nothing the card can act on: a transport failure, a 5xx, or a 404 that did
	 * not come from core's artifact route (a desktop backend that predates it, in
	 * which case the card is still worth keeping). */
	| "io";

/** Same envelope style as the app's existing media answers
 * (`DesktopMediaResponse`), so a renderer already reading `kind` reads this. */
export type LinkPreviewArtifactResult =
	| { kind: "bytes"; data: Uint8Array; mimeType: string }
	| { kind: "error"; code: LinkPreviewArtifactErrorCode; status: number };

/**
 * The preload surface, `window.api.desktop.linkPreview` — the type
 * `DesktopAPI.linkPreview` names, so the bridge is declared once and the contract
 * points at it rather than restating the two calls.
 *
 * WHERE IT LIVES MATTERS, and it is not `api.linkPreview`: the preload exposes it
 * beside `teamBridge`, and a first cut typed it one level up, so a renderer
 * following the types called `undefined.resolve` (QA round 1, Q-1).
 * `scripts/link-preview-preload-shape.test.mjs` compiles a probe at this exact
 * path, so the two cannot drift again.
 */
export interface LinkPreviewBridge {
	resolve(
		request: LinkPreviewResolveRequest,
	): Promise<LinkPreviewResolveResult>;
	artifact(
		request: LinkPreviewArtifactRequest,
	): Promise<LinkPreviewArtifactResult>;
}
