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

/** Identity is directory-derived, never an LLM notify argument. For an agent,
 * account_id/display_name name its HUMAN OWNER, not the recipient in owner.
 * Unknown versions/kinds degrade to today's title/icon without losing delivery. */
export type TeamBridgeNotificationSender = {
	v: 1;
	kind: "person" | "person_agent";
	account_id: string;
	display_name: string;
	agent_name?: string;
	avatar?: { account_id: string; hash: string };
};

export function parseTeamBridgeNotificationSender(
	value: unknown,
): TeamBridgeNotificationSender | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return;
	const input = value as Record<string, unknown>;
	if (
		input.v !== 1 ||
		(input.kind !== "person" && input.kind !== "person_agent")
	)
		return;
	const accountId = cleanId(input.account_id);
	const displayName = cleanText(
		input.display_name,
		TEAM_BRIDGE_NOTIFY_MAX_TITLE,
	);
	const agentName = cleanText(input.agent_name, TEAM_BRIDGE_NOTIFY_MAX_TITLE);
	if (
		!accountId ||
		!displayName ||
		(input.kind === "person_agent" && !agentName)
	)
		return;
	const ref = input.avatar as Record<string, unknown> | undefined;
	// Bad OPTIONAL photo metadata must not suppress the valid message or name.
	const avatar =
		ref &&
		typeof ref === "object" &&
		ref.account_id === accountId &&
		typeof ref.hash === "string" &&
		/^[0-9a-f]{16}$/.test(ref.hash)
			? { account_id: accountId, hash: ref.hash }
			: undefined;
	return {
		v: 1,
		kind: input.kind,
		account_id: accountId,
		display_name: displayName,
		...(input.kind === "person_agent"
			? { agent_name: agentName as string }
			: {}),
		...(avatar ? { avatar } : {}),
	};
}

export type TeamBridgeNotifyRequest = {
	owner: TeamBridgeNotifyOwner;
	conversationId: string;
	tenantId: string;
	/** Additive sender v1; absence keeps the legacy app icon. */
	sender?: TeamBridgeNotificationSender;
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

/** The same id vocabulary the notify payload accepts, for IPC envelopes that
 * carry an id outside a full request (the roster sync's `tenantId`). */
export function isTeamBridgeNotifyId(value: unknown): value is string {
	return cleanId(value) !== null;
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
	const sender = parseTeamBridgeNotificationSender(input.sender);
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
		...(sender ? { sender } : {}),
		...(subtitle === undefined ? {} : { subtitle }),
		...(threadId === undefined ? {} : { threadId }),
		...(viewing === undefined ? {} : { viewing }),
	};
}

/**
 * THE HOLD: the thread surface does not ship in this build, whatever a runtime
 * advertises.
 *
 * HERE, IN THE SHARED MODULE, because the hold has to close BOTH sides of the
 * notification path: main parks a banner's click target (including a thread
 * root) and the renderer turns it back into a route. A constant the renderer
 * alone read would leave `?thread=` on the path and would leave the banner
 * preview reading thread replies, which are the cache/retry paths carrying the
 * reported cross-account isolation defects inherited from #1304. A runtime
 * advertising the route is not clearance: the backend cannot know which client
 * build is talking to it, and a client built before the fix would reactivate
 * those defects the moment the runtime that serves threads ships
 * (local-operator PR #2757).
 *
 * Returning the feature is flipping this to `true` and letting the capability
 * key (`team_bridge_threads`) decide the rest - not a cleanup.
 */
export const TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD = false;

/**
 * THE REACTIONS HOLD: the reaction affordances do not ship in this build,
 * whatever a runtime advertises.
 *
 * The shipped runtime serves no reaction route at all (its OpenAPI schema
 * carries none; a reaction GET answers 404), and the old reaction path has NOT
 * been reviewed for account/retry safety. A backend advertising a
 * `team_bridge_reactions` capability must therefore never wake it up: enabling
 * reactions is a DELIBERATE flip of this constant in a release that carries the
 * verified fix, never an automatic consequence of a capability appearing.
 *
 * Kept beside the threads constant because the two holds share one shape: the
 * build constant dominates, and the capability only narrows further.
 */
export const TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD = false;

/**
 * The in-app path a click lands on.
 *
 * A query parameter rather than a new global store: the page already owns its
 * selected conversation as local state, and the router is the app's existing
 * way of naming a destination. The parameters are consumed once and cleared,
 * so a later refetch cannot yank the reader back to a conversation they moved
 * away from.
 *
 * NO THREAD PARAMETER WHILE THE HOLD IS ON. The click still lands on the
 * conversation, which is the notification's other half; the thread lane is not
 * routable in this build, and a parameter the page would have to ignore is a
 * navigable target one refactor away from mounting the held pane.
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
