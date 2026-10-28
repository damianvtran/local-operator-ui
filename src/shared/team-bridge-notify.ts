/// <reference lib="es2022.intl" />
// Electron 44 and the renderer both provide Intl.Segmenter; import only its
// standard declarations rather than widening the main project's ES target.
/**
 * The narrow contract between the renderer's Team Bridge watcher and main.
 *
 * WHY A SECOND CONTRACT. `team-bridge-contract.ts` describes the HUB's wire
 * shapes, parsed at the renderer boundary. This module describes the LOCAL IPC
 * payload and its limits: the renderer composes a banner's title and body from
 * conversation metadata it already holds, and main must not trust either
 * string just because a preload sent it.
 *
 * A MESSAGE PREVIEW MAY CROSS THIS CHANNEL, AND NOTHING KEEPS IT. The payload
 * carries a conversation id, a tenant id used to open the right organization,
 * the display strings (sender, place, and a short single-line preview of the
 * newest message the signed-in HUMAN member was entitled to read through the
 * history route), and the sequence number the banner is about. Main hands the
 * strings to the native Notification (retained for its click lifetime); our
 * routing closures keep only IDs, not this preview-bearing request. Nothing
 * here is persisted except that sequence number (`team-bridge-notify-store.ts`),
 * and no field is ever logged. The bridge's no-body-cache rule is about the server and the logs;
 * Notification Center holding the banner the person asked for is the feature.
 *
 * WHY VALIDATE IN A SHARED MODULE. Main is the security boundary, but the
 * renderer and the tests must agree about what a "valid" payload is and what
 * its size limits are. One implementation, imported by both, is what keeps a
 * limit from being enforced on one side only.
 */

/**
 * Longest banner title, in code units.
 *
 * A conversation name is up to 128 characters on the wire and the organization
 * is appended, so this is generous for the composed line while still refusing
 * a payload that would be clipped by the OS anyway.
 */
export const TEAM_BRIDGE_NOTIFY_MAX_TITLE = 320;

/**
 * Longest banner body, in code units.
 *
 * The preview is bounded at 140 CODE POINTS (`team-bridge-banner-format.ts`),
 * and an emoji or CJK-supplementary preview is two code units per point, so
 * this has to cover 280 plus the "N new messages: " lead rather than the 140
 * a Latin preview would need.
 */
export const TEAM_BRIDGE_NOTIFY_MAX_BODY = 360;

/** Longest subtitle: a channel or group name (128) and an organization. */
export const TEAM_BRIDGE_NOTIFY_MAX_SUBTITLE = 320;

/**
 * Sequence numbers are non-negative integers. `Number.isSafeInteger` is what
 * keeps a fractional or `Infinity` seq from becoming a dedupe key that can
 * never match a real sequence.
 */
const MAX_SEQ = Number.MAX_SAFE_INTEGER;

/** An id safe to put on the channel, in a URL query, and in a file key. */
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * One unsafe-character policy for every banner line, at BOTH ends of IPC.
 * C1 and bidi marks matter as much as newlines: a sender name can otherwise
 * reorder its own title or impersonate the place line. Angle brackets are not
 * markup on the native surface, but refusing them keeps future HTML consumers
 * from inheriting markup-shaped text. ZWJ/variation selectors stay: they are
 * necessary parts of emoji, not directional controls.
 */
function unsafeBannerCharacter(character: string): boolean {
	const code = character.codePointAt(0) ?? 0;
	return (
		character === "<" ||
		character === ">" ||
		code < 0x20 ||
		(code >= 0x7f && code <= 0x9f) ||
		code === 0x061c ||
		code === 0x200e ||
		code === 0x200f ||
		(code >= 0x202a && code <= 0x202e) ||
		(code >= 0x2066 && code <= 0x2069) ||
		code === 0x2028 ||
		code === 0x2029
	);
}

function hasUnsafeText(value: string): boolean {
	return Array.from(value).some(unsafeBannerCharacter);
}

const BANNER_WHITESPACE = /\s+/g;
const bannerSegments = new Intl.Segmenter(undefined, {
	granularity: "grapheme",
});

/**
 * Keep whole graphemes within a payload budget. The preview's budget counts
 * code points; IPC limits count UTF-16 code units. Neither may split a flag,
 * ZWJ family or combining accent, even if that leaves a little unused space.
 * The ellipsis is in addition to the content budget, as on the original preview.
 */
export function truncateTeamBridgeText(
	text: string,
	max: number,
	measure: "points" | "units" = "points",
): string {
	let used = 0;
	let result = "";
	for (const { segment } of bannerSegments.segment(text)) {
		const size =
			measure === "points" ? Array.from(segment).length : segment.length;
		if (used + size > max) return `${result.trimEnd()}…`;
		result += segment;
		used += size;
	}
	return result;
}

/**
 * Sanitise, rather than lose, an otherwise useful banner for a hostile label.
 * All title/place/body inputs use this before IPC; main still refuses the same
 * unsafe set as a strict backstop. Comparisons retain their meaning using
 * guillemets, and controls become spaces so adjacent words cannot run together.
 * `maxUnits` INCLUDES the ellipsis and matches the shared parser's wire limit.
 */
export function safeTeamBridgeBannerText(
	value: string,
	maxUnits: number,
): string {
	let safe = "";
	for (const character of value) {
		if (character === "<") safe += "‹";
		else if (character === ">") safe += "›";
		else safe += unsafeBannerCharacter(character) ? " " : character;
	}
	const line = safe.replace(BANNER_WHITESPACE, " ").trim();
	return line.length <= maxUnits
		? line
		: truncateTeamBridgeText(line, Math.max(0, maxUnits - 1), "units");
}

/** Captured from the credential-write journal, never inferred from a banner.
 * Epochs are document-local; main revokes the document on navigation/destruction. */
export type TeamBridgeNotifyAuthority = {
	accountId?: string;
	epoch: number;
	/** Credential refresh is unresolved, not a completed sign-out. */
	settling?: boolean;
};
export type TeamBridgeNotifyOwner = TeamBridgeNotifyAuthority & {
	accountId: string;
};

export function parseTeamBridgeNotifyAuthority(
	value: unknown,
): TeamBridgeNotifyAuthority | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const input = value as Record<string, unknown>;
	if (
		typeof input.epoch !== "number" ||
		!Number.isSafeInteger(input.epoch) ||
		input.epoch < 0
	)
		return null;
	if (input.accountId !== undefined && cleanId(input.accountId) === null)
		return null;
	if (input.settling !== undefined && typeof input.settling !== "boolean")
		return null;
	return {
		epoch: input.epoch,
		...(input.settling === undefined ? {} : { settling: input.settling }),
		...(input.accountId === undefined
			? {}
			: { accountId: input.accountId as string }),
	};
}

/** Missing/legacy owners fail closed, including at the renderer's last route boundary. */
export function teamBridgeNotifyOwnerMatches(
	owner: unknown,
	current: TeamBridgeNotifyAuthority | null,
): boolean {
	const parsed = parseTeamBridgeNotifyAuthority(owner);
	return Boolean(
		parsed?.accountId &&
			current?.accountId === parsed.accountId &&
			current.epoch === parsed.epoch,
	);
}

export type TeamBridgeNotifyRequest = {
	owner: TeamBridgeNotifyOwner;
	conversationId: string;
	tenantId: string;
	title: string;
	body: string;
	seq: number;
	/**
	 * Where the message was posted ("#general · Minerva"). ADDITIVE and optional:
	 * a renderer that predates it sends none and the banner keeps two lines.
	 * macOS renders it as the native subtitle; elsewhere main folds it into the
	 * body, because Electron documents `subtitle` as macOS-only.
	 */
	subtitle?: string;
	/**
	 * THE THREAD HOOK. A banner about a reply names its thread root so the click
	 * can open the thread lane. Carried through to the click target untouched;
	 * nothing sends it until the thread lane lands.
	 */
	threadId?: string;
	/**
	 * The renderer is showing THIS conversation right now. Main still owns
	 * quiet (only it knows real focus); this tells it that a focused window is
	 * on this conversation, so quiet applies. A banner for a DIFFERENT
	 * conversation is allowed through even while the window is focused, which
	 * is Slack's rule: a person reading #general still hears about a DM.
	 */
	viewing?: boolean;
};

/** Stale-click feedback carries no departing account or conversation IDs. */
export type TeamBridgeOpenResult = TeamBridgeOpenTarget | { unavailable: true };

/** What a click names: the organization and the conversation to open. */
export type TeamBridgeOpenTarget = {
	owner: TeamBridgeNotifyOwner;
	conversationId: string;
	tenantId: string;
	/** See `TeamBridgeNotifyRequest.threadId`. Absent unless one was sent. */
	threadId?: string;
};

function cleanId(value: unknown): string | null {
	return typeof value === "string" && SAFE_ID.test(value) ? value : null;
}

function cleanText(value: unknown, max: number): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > max) return null;
	if (hasUnsafeText(value)) return null;
	return trimmed;
}

/**
 * Parse a `team-bridge:notify` payload, or `null` when it must be refused.
 *
 * Deliberately total and silent: a malformed payload is a bad request, not a
 * state to repair, and the caller's answer is the same for every reason.
 */
export function parseTeamBridgeNotifyRequest(
	value: unknown,
): TeamBridgeNotifyRequest | null {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const input = value as Record<string, unknown>;
	const owner = parseTeamBridgeNotifyAuthority(input.owner);
	const conversationId = cleanId(input.conversationId);
	const tenantId = cleanId(input.tenantId);
	const title = cleanText(input.title, TEAM_BRIDGE_NOTIFY_MAX_TITLE);
	const body = cleanText(input.body, TEAM_BRIDGE_NOTIFY_MAX_BODY);
	const seq = input.seq;
	/*
	 * The additive fields are refused WHOLE when present and malformed, the
	 * same rule as the required ones: a subtitle that failed the text check is
	 * a caller bug, and silently dropping it would hide that bug behind a
	 * banner that looks almost right.
	 */
	const subtitle =
		input.subtitle === undefined
			? undefined
			: cleanText(input.subtitle, TEAM_BRIDGE_NOTIFY_MAX_SUBTITLE);
	const threadId =
		input.threadId === undefined ? undefined : cleanId(input.threadId);
	const viewing = input.viewing;
	if (
		subtitle === null ||
		threadId === null ||
		(viewing !== undefined && typeof viewing !== "boolean")
	) {
		return null;
	}
	if (
		!owner?.accountId ||
		conversationId === null ||
		tenantId === null ||
		title === null ||
		body === null ||
		typeof seq !== "number" ||
		!Number.isSafeInteger(seq) ||
		seq < 0 ||
		seq > MAX_SEQ
	) {
		return null;
	}
	return {
		owner: { accountId: owner.accountId, epoch: owner.epoch },
		conversationId,
		tenantId,
		title,
		body,
		seq,
		...(subtitle === undefined ? {} : { subtitle }),
		...(threadId === undefined ? {} : { threadId }),
		...(viewing === undefined ? {} : { viewing }),
	};
}

/**
 * THE THREADS BUILD SWITCH: the thread surface SHIPS in this build; the
 * runtime's `team_bridge_threads` capability decides the rest.
 *
 * HERE, IN THE SHARED MODULE, because it closes BOTH sides of the notification
 * path: main parks a banner's click target (including a thread root) and the
 * renderer turns it back into a route.
 *
 * WHY IT WAS HELD, AND WHAT LIFTED IT. The thread read/cache/retry paths
 * carried cross-account isolation defects inherited from #1304 (the surface was
 * reverted in #1353; #1360 fenced private state at auth transitions but left
 * the dormant thread paths out). Flipping this was conditioned on fixing those
 * prerequisites, not on a runtime advertising a route, and this build carries
 * both halves:
 * - RUNTIME: local-operator advertises `team_bridge_threads` only alongside a
 *   replies read that REQUIRES `expected_account_id` + `tenant_id` and refuses a
 *   mismatched bearer with 409 `account_mismatch` before any hub request.
 * - RENDERER: thread pages are keyed by signed-in account + tenant + credential
 *   epoch, every read and retry is fenced on that owner, a reply carries the
 *   receipt, and every foreign owner's pages are cancelled and removed at each
 *   auth transition (`team-bridge-thread-cache.ts`).
 *
 * STILL FAIL CLOSED BELOW THIS LINE. `teamBridgeThreadsAvailable` mounts the
 * surface only when the capability answers exactly `enabled`, so an older core
 * (no key), a below-version or an unpaired runtime shows no thread control,
 * and `teamBridgePlaneOwner` (team-bridge-api) refuses to send any thread
 * request to a runtime without the key. Setting this back to `false` is the
 * kill switch if a regression is found.
 */
export const TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD = true;

/**
 * THE REACTIONS BUILD SWITCH: the reaction affordances SHIP in this build; the
 * runtime's `team_bridge_reactions` capability decides the rest.
 *
 * WHY IT WAS HELD, AND WHAT LIFTED IT. The shipped runtime once served no
 * reaction route, and the old reaction path had never been reviewed for
 * account/retry safety: it carried only a tenant, so enabling it would have
 * bypassed the atomic owner guard every other private write uses. This build
 * carries the reviewed fix:
 * - RUNTIME: local-operator advertises `team_bridge_reactions` only alongside
 *   reaction PUT/DELETE routes that REQUIRE `expected_account_id` + `tenant_id`
 *   and refuse a mismatched bearer with 409 `account_mismatch`.
 * - RENDERER: every toggle carries the owner captured at the click, and a
 *   toggle settling after the page's auth remount writes nothing
 *   (`useTeamBridgeReactionState`).
 *
 * Kept beside the threads switch because the two share one shape: this constant
 * is the kill switch, and the capability only narrows further.
 * `teamBridgeReactionsAvailable` mounts nothing unless the key answers exactly
 * `enabled`, and `teamBridgePlaneOwner` sends no reaction request to a runtime
 * without it.
 */
export const TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD = true;

/**
 * The in-app path a click lands on.
 *
 * A query parameter rather than a new global store: the page already owns its
 * selected conversation as local state, and the router is the app's existing
 * way of naming a destination. The parameters are consumed once and cleared,
 * so a later refetch cannot yank the reader back to a conversation they moved
 * away from.
 *
 * THE THREAD PARAMETER FOLLOWS THE BUILD SWITCH. With threads shipped, a reply
 * banner lands on its thread; the page still mounts the pane only when the
 * runtime's `team_bridge_threads` capability answers `enabled`, so an older
 * core opens the conversation and ignores `thread`. With the switch off the
 * parameter is never written, so no navigable target can mount a held pane.
 */
export function teamBridgeOpenPath(target: TeamBridgeOpenTarget): string {
	const query = new URLSearchParams({
		tenant: target.tenantId,
		conversation: target.conversationId,
		...(TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD && target.threadId
			? { thread: target.threadId }
			: {}),
	});
	return `/team-bridge?${query.toString()}`;
}
