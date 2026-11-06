/**
 * The Team Bridge link-preview card's model: every decision the card makes
 * before it paints, as pure functions.
 *
 * WHY A MODEL MODULE. A card has six drawable states and each one is a claim
 * about what core answered. Held in the component, those claims can only be
 * checked by mounting React and reading markup, which is how a card ends up
 * rendering `undefined` over a missing title or a `0x0` box over an image whose
 * dimensions nobody parsed. Here they are values, so the suite can assert each
 * one and the component's only job is to paint what it is handed.
 *
 * TWO RULES THAT MUST SURVIVE ANY SIMPLIFICATION OF THIS FILE.
 *
 * 1. THE STOP WHEN `web_fetch.enabled` IS OFF COMES FROM HERE, NOT FROM CORE.
 *    Core's read route never consults the switch and core has no delete for an
 *    artifact, so nothing upstream of this app refuses a read. Main does drop
 *    the bytes it cached when a resolve answers `disabled` (the drop rule in
 *    `src/main/link-preview/service.ts`), but that is best-effort cleanup, not a
 *    gate: a card that already holds a URL keeps painting it. `cardView` is
 *    therefore the one place that reads the `disabled` reason and hands back a
 *    state that draws no card and asks for no artifact; a future reader who
 *    "simplifies" `disabled` into the generic `absent` arm is silently
 *    restoring the request the operator turned off.
 *
 * 2. `expectedAccountId` IS REQUIRED AND IS NEVER INVENTED. `linkPreviewRequest`
 *    refuses to build a request without a usable receipt rather than sending
 *    one with a blank or a substituted value. This is the same discipline as the
 *    paste fix: a value with two meanings crossing a boundary is what caused
 *    that bug, and an optional receipt would reintroduce exactly that ambiguity
 *    — core compares the receipt against the identity the install holds, and a
 *    caller that "knows" the account must still say it.
 *
 * NO CACHE LIVES HERE OR ANYWHERE ELSE IN THE RENDERER. Every resolve is a call
 * to core, which owns the TTLs; a second copy of those rules in this app is a
 * second expiry, and the two would disagree first on the entry that matters.
 */
import {
	LINK_PREVIEW_ACCOUNT_MAX_CHARS,
	LINK_PREVIEW_ARTIFACT_ID,
	LINK_PREVIEW_MAX_CARDS_PER_MESSAGE,
	LINK_PREVIEW_MAX_URL_CHARS,
	type LinkPreview,
	type LinkPreviewAbsentReason,
	type LinkPreviewArtifact,
	type LinkPreviewArtifactResult,
	type LinkPreviewImageArtifact,
	type LinkPreviewResolveRequest,
	type LinkPreviewResolveResult,
} from "../../../../../shared/link-preview";

/**
 * How many delayed retries one mount may spend. A `429` is the case that
 * produces `retryAfterMs`, and a rate limiter is not an invitation to hold a
 * timer in every row forever: after this many the card settles to the silent
 * state, which is the same thing the reader sees for any other refusal.
 */
export const LINK_PREVIEW_MAX_DELAYED_RETRIES = 3;

/**
 * The furthest ahead a retry timer may be set. This is a bound on a timer THIS
 * process holds, not a judgement of core's delay: a card that would wait longer
 * than this draws nothing instead, because a transcript row is not a scheduler
 * and the reader will have scrolled on.
 */
export const LINK_PREVIEW_MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

/** The image strip's reserved height when the byte header carries no size. A
 * box is still reserved — the bytes serve 200 — but the card claims no ratio. */
export const LINK_PREVIEW_IMAGE_UNKNOWN_HEIGHT_PX = 128;

/* ------------------------------------------------------------------------- */
/* Asking                                                                     */
/* ------------------------------------------------------------------------- */

/** Why no request was built. Every one of these means core was never asked. */
export type LinkPreviewRequestRefusal =
	/** No account receipt, a non-string one, or one outside the route's bounds.
	 * Not a scope the caller may pick, and not something this app can default. */
	| "account"
	/** Nothing addressable to ask about: empty, or longer than core's bound. */
	| "url"
	/** The message already holds the per-message ceiling, so core would refuse
	 * this index as `cap`; asking would spend a round trip to be told so. */
	| "cap";

export type LinkPreviewRequestPlan =
	| { kind: "ask"; request: LinkPreviewResolveRequest }
	| { kind: "refuse"; reason: LinkPreviewRequestRefusal };

/**
 * Build the resolve request, or refuse it here.
 *
 * The receipt is passed through byte for byte — never trimmed, never
 * substituted. An identity this app tidies up is an identity this app decided,
 * and core's comparison is the only thing that makes the field a receipt.
 */
export function linkPreviewRequest(input: {
	url: string | null | undefined;
	index: number;
	expectedAccountId: string | null | undefined;
}): LinkPreviewRequestPlan {
	const account = input.expectedAccountId;
	if (
		typeof account !== "string" ||
		account.length === 0 ||
		account.length > LINK_PREVIEW_ACCOUNT_MAX_CHARS
	) {
		return { kind: "refuse", reason: "account" };
	}
	const url = input.url;
	if (typeof url !== "string" || url.length === 0) {
		return { kind: "refuse", reason: "url" };
	}
	if (url.length > LINK_PREVIEW_MAX_URL_CHARS) {
		return { kind: "refuse", reason: "url" };
	}
	if (
		!Number.isInteger(input.index) ||
		input.index < 0 ||
		input.index >= LINK_PREVIEW_MAX_CARDS_PER_MESSAGE
	) {
		return { kind: "refuse", reason: "cap" };
	}
	return {
		kind: "ask",
		request: { url, index: input.index, expectedAccountId: account },
	};
}

/** The card's normalized content. Fields the wire OMITS arrive as `undefined`
 * (never `null`), which is why every one of them is read through this shape and
 * not straight off the answer. */
export interface LinkPreviewCard {
	/** The final canonical URL, for the card's link target. Display text only:
	 * nothing in this app fetches it. */
	url: string;
	siteName: string | null;
	title: string | null;
	description: string | null;
	favicon: LinkPreviewArtifact | null;
	image: LinkPreviewImageArtifact | null;
	/** `null` means the dimensions are UNKNOWN, never zero. */
	imageBox: { width: number; height: number } | null;
}

/**
 * The card's drawable states.
 *
 * `absent` and `disabled` look the same on screen and are distinct here because
 * they are distinct facts: one is a link core looked at and refused, the other
 * is a switch the operator turned off before anything was attempted. Only
 * `ready` and `retry` ever draw anything.
 */
export type LinkPreviewCardView =
	| { kind: "ready"; card: LinkPreviewCard }
	| { kind: "absent"; reason: LinkPreviewAbsentReason }
	/** The operator's `web_fetch.enabled` is off: plain text, no artifact, no
	 * further asking. See rule 1 in this file's header. */
	| { kind: "disabled" }
	/** A retryable failure that named its delay: WAIT, and draw nothing while
	 * waiting. A card here would be an error card core told us not to show. */
	| { kind: "waiting"; retryInMs: number }
	/** A retryable failure that named no delay: a quiet control, because only the
	 * person knows whether the link is still worth asking about. */
	| { kind: "retry" }
	/** Anything a retry cannot change, and a retry budget that is spent. */
	| { kind: "silent" };

/** Whether this state puts a card in the transcript. Used by the caller that
 * decides between a card and the plain link text. */
export function linkPreviewDrawsCard(view: LinkPreviewCardView): boolean {
	return view.kind === "ready" || view.kind === "retry";
}

/** A positive integer only. `0`, a negative, a fraction or a non-number is not a
 * measurement, and a card that drew `0x0` would be claiming one. */
const measured = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value) && value > 0;

/** The artifact id core issues (32 hex chars). A card that asked with anything
 * else would earn a `422`, so it is refused before the call. */
const usableArtifact = <T extends LinkPreviewArtifact>(
	artifact: T | null | undefined,
): T | null =>
	artifact &&
	typeof artifact === "object" &&
	typeof artifact.id === "string" &&
	LINK_PREVIEW_ARTIFACT_ID.test(artifact.id)
		? artifact
		: null;

/** A string or nothing: an empty or blank value is absent, not a title. */
const text = (value: unknown): string | null =>
	typeof value === "string" && value.trim().length > 0 ? value : null;

/** The hostname of the canonical URL, for the line above the title when a page
 * declares no `og:site_name`. `null` only when the URL does not parse — core
 * returns canonical http(s) URLs, so this is the degenerate case. */
export function linkPreviewHost(url: string): string | null {
	try {
		return new URL(url).hostname || null;
	} catch {
		return null;
	}
}

/**
 * Normalize one `ready` answer into the card's content.
 *
 * WHY THIS IS NOT A SPREAD. The wire omits unset fields instead of sending
 * `null` (measured against the running service: `siteName`, `favicon` and the
 * image's `width`/`height` are simply absent), so a component reading the
 * answer directly would paint `undefined` or reserve `0x0`. Every field is read
 * once, here, into a shape whose absent case is always `null`.
 */
export function linkPreviewCard(preview: LinkPreview): LinkPreviewCard {
	const image = usableArtifact(preview.image);
	const url = text(preview.url);
	return {
		url: url ?? "",
		siteName: text(preview.siteName),
		title: text(preview.title),
		description: text(preview.description),
		favicon: usableArtifact(preview.favicon),
		image,
		// BOTH dimensions or neither: a half-measured image would let the card
		// compute a ratio from one real number and one absence.
		imageBox:
			image && measured(image.width) && measured(image.height)
				? { width: image.width, height: image.height }
				: null,
	};
}

/** The one line that names the destination: the page's own site name, else the
 * host, else the title. Never empty for a card that draws, so every card has an
 * accessible name. */
export function linkPreviewSiteLabel(card: LinkPreviewCard): string {
	// `||`, not `??`. `linkPreviewCard` normalizes an absent URL to `""` rather
	// than `null`, and `??` accepts `""` as a finished answer — a globe and a
	// blank span, against the promise above.
	return (
		card.siteName || linkPreviewHost(card.url) || card.url || card.title || ""
	);
}

/**
 * The image's alt text.
 *
 * A preview picture restates the card's own text — it is decoration beside the
 * title, so it carries no alt text of its own and a screen reader does not
 * announce the same card twice. When the page supplied no title the picture is
 * the only content, so it takes the site label instead.
 */
export function linkPreviewImageAlt(card: LinkPreviewCard): string {
	return card.title ? "" : linkPreviewSiteLabel(card);
}

/** Whether a `ready` answer holds anything worth showing. Core answers
 * `no-metadata` for a page with nothing to show; this is the defensive twin, so
 * a future core that answers `ready` with four blanks does not paint an empty
 * box in the transcript. */
function hasCardContent(card: LinkPreviewCard): boolean {
	return Boolean(
		card.title || card.description || card.siteName || card.image || card.url,
	);
}

/** A retry decision, so the component never does arithmetic on a delay. */
export type LinkPreviewRetry =
	| { kind: "after"; ms: number }
	/** Core named a delay beyond the longest timer this app holds. */
	| { kind: "too-far" }
	/** Retryable, but nothing said when — the person decides. */
	| { kind: "manual" };

/**
 * Read a `retryable` error's delay.
 *
 * `retryAfterMs` is core's own number, not one this app chooses, so it is
 * honoured as given and only bounded at the far end. A non-retryable error has
 * no delay at all: those are the refusals a retry cannot change (another
 * account's receipt, no sign-in).
 */
export function linkPreviewRetry(
	result: Extract<LinkPreviewResolveResult, { kind: "error" }>,
): LinkPreviewRetry | null {
	if (!result.retryable) return null;
	const delay = result.retryAfterMs;
	if (typeof delay !== "number" || !Number.isFinite(delay)) {
		return { kind: "manual" };
	}
	if (delay <= 0) return { kind: "after", ms: 0 };
	if (delay > LINK_PREVIEW_MAX_RETRY_DELAY_MS) return { kind: "too-far" };
	return { kind: "after", ms: delay };
}

/**
 * The state one resolve answer draws.
 *
 * `delayedRetries` is how many timers this mount has already spent, so a rate
 * limiter cannot keep a row retrying for as long as it is on screen.
 */
export function linkPreviewCardView(
	result: LinkPreviewResolveResult,
	delayedRetries = 0,
): LinkPreviewCardView {
	switch (result.kind) {
		case "ready": {
			const card = linkPreviewCard(result.preview);
			return hasCardContent(card)
				? { kind: "ready", card }
				: { kind: "absent", reason: "no-metadata" };
		}
		case "absent":
			// The one reason with a renderer-side obligation. Core's read route never
			// consults the switch and core has no delete for an artifact, so nothing
			// upstream can stop a read; main DOES drop the bytes it cached when a
			// resolve answers `disabled` (the drop rule in `service.ts`), but that is
			// best-effort and a card already holding a URL would keep painting. So
			// this arm is the whole stop. Rule 1 in the header.
			return result.reason === "disabled"
				? { kind: "disabled" }
				: { kind: "absent", reason: result.reason };
		case "error": {
			const retry = linkPreviewRetry(result);
			if (!retry) return { kind: "silent" };
			if (retry.kind === "too-far") return { kind: "silent" };
			if (retry.kind === "manual") return { kind: "retry" };
			if (delayedRetries >= LINK_PREVIEW_MAX_DELAYED_RETRIES) {
				return { kind: "silent" };
			}
			return { kind: "waiting", retryInMs: retry.ms };
		}
		default:
			return { kind: "silent" };
	}
}

/* ------------------------------------------------------------------------- */
/* Artifact bytes                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Why an artifact call did not produce bytes.
 *
 * `code` IS THE KEY, AND STATUS IS THE FALLBACK. Main has already turned Core's
 * HTTP answers into precise codes (`src/main/link-preview/service.ts`): `409`
 * arrives as `account-mismatch`, `401`/`403` as `unauthorized`, `422` as
 * `invalid-request`, and a `404` as `not-found` ONLY when the body carries
 * Core's own `artifact_not_found`. That last distinction is the one a status-keyed
 * classifier gets wrong: a `404` without that code means a desktop backend that
 * predates the route, which the card should keep asking of — not the same fact as
 * "these bytes are gone". Status is still read for a preload older than the
 * split, where `409` and a transport failure both arrive as `io`.
 */
export type LinkPreviewArtifactRefusal =
	| { kind: "served" }
	/** `not-found`: Core does not name this id in this scope, or the bytes are
	 * gone. The card keeps its text and drops the picture. */
	| { kind: "gone"; status: number }
	/** `invalid-request`: this app asked without a usable receipt, or with a
	 * malformed id. A renderer contract breach, never retried and never drawn as
	 * a person's problem. */
	| { kind: "receipt"; status: number }
	/** `account-mismatch`: the fence held — this artifact belongs to another
	 * account. Not retryable, and this app must not ask again with the same
	 * receipt. */
	| { kind: "account"; status: number }
	/** `unauthorized`: not signed in as an account that may read the id. The same
	 * "stop asking" class as `account-mismatch`, kept apart because the remedy is
	 * different — signing in, not a different receipt. */
	| { kind: "unauthorized"; status: number }
	/** `io`: a transport failure, a 5xx, or a `404` that did not come from Core's
	 * artifact route — the card is still worth keeping and asking about. */
	| { kind: "transient"; status: number };

/**
 * Classify one artifact answer.
 *
 * The code decides; the status only catches a preload that predates the split,
 * where `409` and every transport failure arrive as `io` together. See the type's
 * doc for why the `404` cannot be read from the status alone.
 */
export function linkPreviewArtifactRefusal(
	result: LinkPreviewArtifactResult,
): LinkPreviewArtifactRefusal {
	if (result.kind === "bytes") return { kind: "served" };
	const { code, status } = result;
	switch (code) {
		case "not-found":
			return { kind: "gone", status };
		case "invalid-request":
			return { kind: "receipt", status };
		case "account-mismatch":
			return { kind: "account", status };
		case "unauthorized":
			return { kind: "unauthorized", status };
		case "io":
			// A preload older than the code split still reported the account fence
			// as `io` with a 409; a 401/403 the same way.
			if (status === 409) return { kind: "account", status };
			if (status === 401 || status === 403) {
				return { kind: "unauthorized", status };
			}
			return { kind: "transient", status };
		default:
			return { kind: "transient", status };
	}
}
