/**
 * What a Team Bridge OS banner SAYS, as pure functions.
 *
 * WHY THIS EXISTS. The first banner read "{conversation} ({organization})" /
 * "{sender} sent a message": metadata only, so a person glancing at Notification
 * Center could not tell WHO wrote or WHAT they said without opening the app.
 * The target is the shape every chat app has trained people to read:
 *
 *   title    = the sender ("Ada Lovelace", or "Aida (Ben)" for a chief of staff)
 *   subtitle = where ("#general · Minerva", "Direct message · Minerva")
 *   body     = a short single-line preview of the newest message, or
 *              "3 new messages: <preview>" when several are unread
 *
 * WHERE THE PREVIEW COMES FROM, and the constraint it lives under. The list and
 * unread payloads carry no body by design (the bridge keeps no body cache), so
 * the watcher reads the ONE newest message through the existing history route
 * at notify time (`use-team-bridge-notifications.ts`). This module only turns
 * that body into a preview; it never stores it, and nothing here logs. A human
 * member is entitled to every body in their conversation, an agent sender
 * included, so previewing an agent's message to a person is fine; agent members
 * read bodies only through the admit path, and this surface never runs as one.
 *
 * WHY THE PREVIEW IS SANITISED HERE, NOT ONLY VALIDATED IN MAIN. Main refuses a
 * payload containing `<`, `>` or a control character (`team-bridge-notify.ts`):
 * one bad character would cost the whole banner. A message body is free text
 * and routinely contains all three (code, `a > b`, newlines), so the preview is
 * made safe at the source and main's refusal stays a backstop for bugs.
 *
 * COPY IS THE CALLER'S. Every user-visible word comes through `copy`, so this
 * module is testable without the i18n runtime and the tests assert structure
 * ("the subtitle names the channel and the org") rather than one locale.
 */

import {
	TEAM_BRIDGE_NOTIFY_MAX_BODY,
	TEAM_BRIDGE_NOTIFY_MAX_SUBTITLE,
	TEAM_BRIDGE_NOTIFY_MAX_TITLE,
	safeTeamBridgeBannerText,
	truncateTeamBridgeText,
} from "../../../../shared/team-bridge-notify";

/** Longest preview, in code points, before the ellipsis. Slack's order of size:
 * enough to read a sentence, short enough to leave the title and subtitle room
 * in a macOS banner's ~5-line budget. */
export const TEAM_BRIDGE_PREVIEW_MAX = 140;

/*
 * Line-level markdown that carries no words: a heading's hashes, a quote's
 * marker, a list bullet or number, a fence line, a horizontal rule. Top-level
 * constants so the formatter does not allocate a regex per call.
 */
const FENCE_LINE = /^\s*(```|~~~).*$/gm;
const HEADING_MARKER = /^\s{0,3}#{1,6}\s+/gm;
const QUOTE_MARKER = /^\s{0,3}(>\s?)+/gm;
const LIST_MARKER = /^\s*([-*+]|\d{1,9}[.)])\s+/gm;
const TASK_MARKER = /^\[[ xX]\]\s+/gm;
const RULE_LINE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/gm;
/* Inline: images keep their alt text, links keep their label, autolinks keep
 * the address. Images first, so `![a](u)` is not read as `!` + a link. */
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const LINK = /\[([^\]]+)\]\([^)]*\)/g;
const AUTOLINK = /<((?:https?|mailto):[^>\s]+)>/gi;
const HTML_TAG = /<\/?[A-Za-z][^>]*>/g;
const INLINE_CODE = /`+([^`]*)`+/g;
/* Emphasis by its paired delimiters only, and `_x_` only at word boundaries
 * (CommonMark's own rule), so a snake_case identifier survives intact. */
const STRONG = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/g;
const STRIKE = /~~(?=\S)([\s\S]*?\S)~~/g;
const EMPHASIS = /(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g;
const UNDERSCORE_EMPHASIS = /(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g;

/**
 * A single-line, markdown-free, bounded preview of a message body, or `null`
 * when nothing readable remains (an empty body, an image with no alt text, a
 * body the caller could not read).
 *
 * Angle brackets become their single-guillemet look-alikes rather than being
 * dropped: `a > b` must still read as a comparison, and main refuses the real
 * characters. Truncation budgets code points but keeps whole graphemes (D1), so neither
 * a flag nor a ZWJ/combining sequence is split.
 */
export function teamBridgePreviewText(
	body: string | null | undefined,
	max = TEAM_BRIDGE_PREVIEW_MAX,
): string | null {
	if (typeof body !== "string" || body.trim().length === 0) return null;
	const words = body
		.replace(FENCE_LINE, " ")
		.replace(RULE_LINE, " ")
		.replace(HEADING_MARKER, "")
		.replace(QUOTE_MARKER, "")
		.replace(LIST_MARKER, "")
		.replace(TASK_MARKER, "")
		.replace(IMAGE, "$1")
		.replace(LINK, "$1")
		.replace(AUTOLINK, "$1")
		.replace(HTML_TAG, "")
		.replace(INLINE_CODE, "$1")
		.replace(STRONG, "$2")
		.replace(STRIKE, "$1")
		.replace(EMPHASIS, "$1$2")
		.replace(UNDERSCORE_EMPHASIS, "$1$2");
	// The policy is shared with title/subtitle sanitisation AND main's strict
	// parser, so a safe body cannot still lose its banner to a hostile label.
	const line = safeTeamBridgeBannerText(words, Number.MAX_SAFE_INTEGER);
	if (line.length === 0) return null;
	return truncateTeamBridgeText(line, max);
}

/** Where the message was posted, as the subtitle names it. */
export type TeamBridgeBannerPlace =
	| { kind: "channel"; name: string | null }
	| { kind: "dm" }
	| { kind: "group"; name: string | null };

/** The facts one banner is composed from. */
export type TeamBridgeBannerFacts = {
	/** The sender as the rail names them; `null` when no source could say. */
	senderLabel: string | null;
	/** The conversation's own title, the last-resort banner title. */
	conversationName: string | null;
	place: TeamBridgeBannerPlace;
	organizationName: string | null;
	/** The newest message's preview (already `teamBridgePreviewText`). */
	preview: string | null;
	/** The server's unread count for the reader in this conversation. */
	unreadCount: number;
};

/** The catalogue copy the composition needs, injected (see module doc). */
export type TeamBridgeBannerCopy = {
	untitled: string;
	directMessage: string;
	group: string;
	channel: (name: string) => string;
	subtitle: (place: string, organization: string) => string;
	count: (count: number) => string;
	countPreview: (count: number, preview: string) => string;
	fallback: string;
};

export type TeamBridgeBannerText = {
	title: string;
	subtitle: string;
	body: string;
};

/**
 * Compose the three banner lines.
 *
 * THE COUNT IS THE SERVER'S UNREAD, not a client tally. Several messages that
 * land between two polls (or across polls before the reader opens the
 * conversation) are exactly the messages still unread, and the server already
 * counts them excluding the reader's own; a client counter would drift from the
 * badge the rail paints beside it. Main replaces the conversation's previous
 * banner by its stable id, so the person sees ONE banner whose count grows,
 * never a stack.
 */
export function teamBridgeBannerText(
	facts: TeamBridgeBannerFacts,
	copy: TeamBridgeBannerCopy,
): TeamBridgeBannerText {
	const title =
		facts.senderLabel?.trim() ||
		facts.conversationName?.trim() ||
		copy.untitled;
	const placeLabel =
		facts.place.kind === "dm"
			? copy.directMessage
			: facts.place.kind === "channel"
				? facts.place.name?.trim()
					? copy.channel(facts.place.name.trim())
					: (facts.conversationName?.trim() ?? copy.untitled)
				: facts.place.name?.trim() ||
					facts.conversationName?.trim() ||
					copy.group;
	const subtitle = facts.organizationName
		? copy.subtitle(placeLabel, facts.organizationName)
		: placeLabel;
	const count = Math.max(1, Math.floor(facts.unreadCount));
	const body =
		count > 1
			? facts.preview
				? copy.countPreview(count, facts.preview)
				: copy.count(count)
			: (facts.preview ?? copy.fallback);
	return {
		title:
			safeTeamBridgeBannerText(title, TEAM_BRIDGE_NOTIFY_MAX_TITLE) ||
			copy.untitled,
		subtitle:
			safeTeamBridgeBannerText(subtitle, TEAM_BRIDGE_NOTIFY_MAX_SUBTITLE) ||
			copy.untitled,
		body:
			safeTeamBridgeBannerText(body, TEAM_BRIDGE_NOTIFY_MAX_BODY) ||
			copy.fallback,
	};
}
