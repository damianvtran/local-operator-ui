/**
 * The narrow contract between the renderer's Team Bridge watcher and main.
 *
 * WHY A SECOND CONTRACT. `team-bridge-contract.ts` describes the HUB's wire
 * shapes, parsed at the renderer boundary. This module describes the LOCAL IPC
 * payload and its limits: the renderer composes a banner's title and body from
 * conversation metadata it already holds, and main must not trust either
 * string just because a preload sent it.
 *
 * NO BODY EVER CROSSES THIS CHANNEL. The payload carries a conversation id, a
 * tenant id used to open the right organization, the two display strings the
 * server already exposed (a conversation name, an organization name and a
 * sender label), and the sequence number the banner is about. Nothing here is
 * persisted except that sequence number (`team-bridge-notify-store.ts`).
 *
 * WHY VALIDATE IN A SHARED MODULE. Main is the security boundary, but the
 * renderer and the tests must agree about what a "valid" payload is and what
 * its size limits are. One implementation, imported by both, is what keeps a
 * limit from being enforced on one side only.
 */

/** Longest conversation/tenant id this channel accepts. */
export const TEAM_BRIDGE_NOTIFY_MAX_ID = 128;

/**
 * Longest banner title, in code units.
 *
 * A conversation name is up to 128 characters on the wire and the organization
 * is appended, so this is generous for the composed line while still refusing
 * a payload that would be clipped by the OS anyway.
 */
export const TEAM_BRIDGE_NOTIFY_MAX_TITLE = 320;

/** Longest banner body. The composed sentence is short by construction. */
export const TEAM_BRIDGE_NOTIFY_MAX_BODY = 200;

/**
 * Sequence numbers are non-negative integers. `Number.isSafeInteger` is what
 * keeps a fractional or `Infinity` seq from becoming a dedupe key that can
 * never match a real sequence.
 */
const MAX_SEQ = Number.MAX_SAFE_INTEGER;

/** An id safe to put on the channel, in a URL query, and in a file key. */
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * Characters forbidden in banner text.
 *
 * `<` and `>` are refused rather than escaped: a native notification has no
 * HTML renderer, but accepting markup-shaped text would make a future surface
 * that DOES render it inherit an injection. Control characters are refused
 * because one line is all an OS banner can show, and a newline in a title is
 * how a sender label learns to impersonate a second line. The tab is included
 * for the same reason.
 */
/**
 * Whether the text contains a character a one-line native banner must not
 * carry.
 *
 * A code-point loop rather than a regex: the forbidden set is exactly "markup
 * delimiters and control characters", and a loop states that without the
 * escaping a control-character regex needs in source.
 */
function hasUnsafeText(value: string): boolean {
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (
			character === "<" ||
			character === ">" ||
			code < 0x20 ||
			code === 0x7f
		) {
			return true;
		}
	}
	return false;
}

export type TeamBridgeNotifyRequest = {
	conversationId: string;
	tenantId: string;
	title: string;
	body: string;
	seq: number;
};

/** What a click names: the organization and the conversation to open. */
export type TeamBridgeOpenTarget = {
	conversationId: string;
	tenantId: string;
};

function cleanId(value: unknown): string | null {
	return typeof value === "string" && SAFE_ID.test(value) ? value : null;
}

function cleanText(value: unknown, max: number): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > max) return null;
	if (hasUnsafeText(trimmed)) return null;
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
	const conversationId = cleanId(input.conversationId);
	const tenantId = cleanId(input.tenantId);
	const title = cleanText(input.title, TEAM_BRIDGE_NOTIFY_MAX_TITLE);
	const body = cleanText(input.body, TEAM_BRIDGE_NOTIFY_MAX_BODY);
	const seq = input.seq;
	if (
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
	return { conversationId, tenantId, title, body, seq };
}

/** Parse the conversation/tenant pair carried by a click's open request. */
export function parseTeamBridgeOpenTarget(
	value: unknown,
): TeamBridgeOpenTarget | null {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const input = value as Record<string, unknown>;
	const conversationId = cleanId(input.conversationId);
	const tenantId = cleanId(input.tenantId);
	if (conversationId === null || tenantId === null) return null;
	return { conversationId, tenantId };
}

/**
 * The in-app path a click lands on.
 *
 * A query parameter rather than a new global store: the page already owns its
 * selected conversation as local state, and the router is the app's existing
 * way of naming a destination. The parameters are consumed once and cleared,
 * so a later refetch cannot yank the reader back to a conversation they moved
 * away from.
 */
export function teamBridgeOpenPath(target: TeamBridgeOpenTarget): string {
	const query = new URLSearchParams({
		tenant: target.tenantId,
		conversation: target.conversationId,
	});
	return `/team-bridge?${query.toString()}`;
}
