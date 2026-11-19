import { senderField } from "./receipt-row-model";

/** Incoming Bridge display facts are separate from outgoing tool receipts.
 * The envelope is model context, not an admission proof. Only positively typed
 * producer metadata may supply identity. The journal row never carries a body:
 * an admitted body is read separately, by entry id, from core's display store
 * (`bridgeCardBodyOf` below); receipt presence is not clearance.
 */
export type BridgeReceipt = {
	sender: { name: string; kind?: "human" | "agent"; organization?: string };
	conversation: { kind?: "dm" | "group" | "channel"; label?: string };
	attachmentCount?: number;
};

const object = (value: unknown): Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
const label = (value: unknown): string =>
	typeof value === "string" ? senderField(value) : "";

/** No body parsing, @mention inference, or account-id-as-sender fallback. */
export function bridgeReceiptOf(
	details: Record<string, unknown>,
): BridgeReceipt {
	const wire = object(details.bridge_receipt);
	const current = wire.v === 1;
	const sender = current ? object(wire.sender) : object(details.sender);
	const conversation = current ? object(wire.conversation) : {};
	const count = current ? wire.attachment_count : undefined;
	return {
		sender: {
			name: label(sender.name),
			...(sender.kind === "human" || sender.kind === "agent"
				? { kind: sender.kind }
				: {}),
			...(label(sender.organization)
				? { organization: label(sender.organization) }
				: {}),
		},
		conversation: {
			...(conversation.kind === "dm" ||
			conversation.kind === "group" ||
			conversation.kind === "channel"
				? { kind: conversation.kind }
				: {}),
			...(label(conversation.label)
				? { label: label(conversation.label) }
				: {}),
		},
		...(typeof count === "number" && Number.isSafeInteger(count) && count >= 0
			? { attachmentCount: count }
			: {}),
	};
}

/*
 * ----------------------------------------------------------- admitted bodies
 *
 * WHY A SEPARATE READ, NOT A JOURNAL FIELD. Core never writes a Bridge body into
 * the session journal: the journal is replayed, forked, exported and compacted,
 * and a body in it could neither be revoked nor kept out of the model's context
 * (core `team_bridge/card_projection.py`). Core keeps the ADMITTED body in its
 * own display store instead and answers one entry-keyed read:
 *
 *   GET /v1/desktop/sessions/{session_id}/bridge-cards/{entry_id}/body
 *
 * advertised as `features.team_bridge_card_body >= 1` (core
 * `server/features.py`). The answer is pinned by the bridge-body design §4:
 *
 *   {v: 1, items: [{message_id, conversation_id, state, body?, source?,
 *                   hold?: {class, held_for_s}, reason?}], more}
 *
 * Every state and reason is the SERVER'S word. This module never derives a
 * moderation outcome locally (safety property D): an unknown state, a body on a
 * non-admitted item or a malformed frame all collapse to `unavailable`, never to
 * a guess in either direction. The body is untrusted markdown authored by a
 * teammate; it is rendered as data inside the provenance frame, never as copy.
 */

/** The closed state vocabulary of the card-body read (design §4). */
export const BRIDGE_CARD_BODY_STATES = [
	"admitted",
	"pending",
	"held",
	"refused",
	"not_admitted",
	"unavailable",
] as const;
export type BridgeCardBodyState = (typeof BRIDGE_CARD_BODY_STATES)[number];

/** Why an item is `unavailable`, when the server said (design §4). */
export const BRIDGE_CARD_BODY_REASONS = [
	"signed_out",
	"other_account",
	"not_member",
	"deleted",
	"hub_unsupported",
	"offline",
] as const;
export type BridgeCardBodyReason = (typeof BRIDGE_CARD_BODY_REASONS)[number];

export type BridgeCardBodyItem = {
	messageId: string;
	conversationId: string;
	state: BridgeCardBodyState;
	/** Present only on an `admitted` item: the admitted markdown, untrusted. */
	body?: string;
	reason?: BridgeCardBodyReason;
	/**
	 * Present only on a `held` item whose server hold says `class: "transient"`:
	 * screening has not run yet or delivery has not finished, so nobody decided
	 * anything (core `card_body._hold_view`). The card must not read that as a
	 * moderation decision (core #4238 review R4 / design D3). Any other or
	 * missing class keeps "Held by moderation": an unknown class is never
	 * softened into "waiting".
	 */
	transient?: true;
};

export type BridgeCardBody = {
	items: BridgeCardBodyItem[];
	/** Messages in a coalesced card beyond the ones listed, server count plus our cap. */
	more: number;
};

/**
 * The most items a coalesced card lists. Core already caps the answer at 20
 * (design §4: up to 200 ids coalesce into one card, the rest are counted in
 * `more`); the client cap is the same number so a server that sent more cannot
 * grow the card past what the design reviewed, and the overflow is counted
 * rather than dropped.
 */
export const BRIDGE_CARD_BODY_MAX_ITEMS = 20;

/**
 * Character length past which a body is collapsed behind "Show more". ~600
 * characters is about eight lines of the detail pane's measure: long enough
 * that an ordinary chat message shows whole, short enough that one long paste
 * does not push the rest of the transcript off screen (design §7 item 3).
 */
export const BRIDGE_CARD_BODY_COLLAPSE_CHARS = 600;

/**
 * Source lines past which a body is collapsed, whatever its length.
 *
 * WHY A LINE LIMIT AS WELL (#1977 design round 1, D3). The character cut alone
 * folded at the reviewed 7-line / 222 px target only because the fixture's lines
 * were ~75 characters; a checklist or code snippet of 20 short lines stayed
 * under 600 characters and rendered ~540 px unfolded. Counting `\n` is the
 * fold's height proxy rather than measuring the rendered box: it is
 * deterministic (the same cut on every open, in tests and at every pane width),
 * needs no layout pass before paint (no first-frame reflow) and keeps the cut a
 * pure function of the body. A source line can wrap to more than one rendered
 * line; the character limit bounds that case.
 */
export const BRIDGE_CARD_BODY_COLLAPSE_LINES = 7;

/**
 * Items a coalesced card shows before its own "Show more" (#1977 design round
 * 1, D2). Per-body folds never fire on short bodies, so twenty short messages
 * stacked to a 933 px card, taller than a 622 px viewport. Three keeps a
 * conversation's opening visible and the folded card near the single-body
 * target; the rest are one press away. Distinct from `more`: that counts
 * messages the server did not list at all, which no toggle can reveal.
 */
export const BRIDGE_CARD_BODY_FOLDED_ITEMS = 3;

/** Appended to a cut that lands inside a line, so the cut reads as a cut. */
const ELLIPSIS = "\u2026";

const STATES: ReadonlySet<string> = new Set(BRIDGE_CARD_BODY_STATES);
const REASONS: ReadonlySet<string> = new Set(BRIDGE_CARD_BODY_REASONS);
const MESSAGE_ID_MAX = 128;

function itemOf(value: unknown): BridgeCardBodyItem | null {
	const raw = object(value);
	const messageId = raw.message_id;
	const conversationId = raw.conversation_id;
	// An item without its ids cannot be attributed to a message in this card,
	// so it answers nothing; it is dropped rather than shown as someone's body.
	if (
		typeof messageId !== "string" ||
		!messageId ||
		messageId.length > MESSAGE_ID_MAX ||
		typeof conversationId !== "string" ||
		!conversationId ||
		conversationId.length > MESSAGE_ID_MAX
	)
		return null;
	const declared =
		typeof raw.state === "string" && STATES.has(raw.state)
			? (raw.state as BridgeCardBodyState)
			: "unavailable";
	// An `admitted` item MUST carry a non-empty body; one without is not a
	// message we can show, so it reads as unavailable instead of an empty card.
	const admitted =
		declared === "admitted" &&
		typeof raw.body === "string" &&
		raw.body.trim().length > 0;
	const state: BridgeCardBodyState =
		declared === "admitted" && !admitted ? "unavailable" : declared;
	const reason =
		state === "unavailable" &&
		typeof raw.reason === "string" &&
		REASONS.has(raw.reason)
			? (raw.reason as BridgeCardBodyReason)
			: undefined;
	const transient = state === "held" && object(raw.hold).class === "transient";
	return {
		messageId,
		conversationId,
		state,
		...(admitted ? { body: raw.body as string } : {}),
		...(reason ? { reason } : {}),
		...(transient ? { transient: true as const } : {}),
	};
}

/**
 * Parse one card-body answer. `null` means the frame is not the pinned v1 shape
 * (an older or newer server, a proxy page, a refusal body): the card then says
 * the body is unavailable, exactly as it did before this read existed.
 *
 * Desktop routes usually answer inside the `{result: …}` envelope; a bare v1
 * object is accepted too so the client does not depend on which of the two the
 * route chose.
 */
export function bridgeCardBodyOf(payload: unknown): BridgeCardBody | null {
	const outer = object(payload);
	const frame = outer.v === undefined ? object(outer.result) : outer;
	if (frame.v !== 1 || !Array.isArray(frame.items)) return null;
	const items = frame.items
		.map(itemOf)
		.filter((item): item is BridgeCardBodyItem => item !== null);
	const declaredMore =
		typeof frame.more === "number" &&
		Number.isSafeInteger(frame.more) &&
		frame.more > 0
			? frame.more
			: 0;
	const listed = items.slice(0, BRIDGE_CARD_BODY_MAX_ITEMS);
	return {
		items: listed,
		more: declaredMore + (items.length - listed.length),
	};
}

/**
 * The collapsed preview of a long body, cut on a boundary a reader recognises.
 *
 * A body folds past `lines` source lines OR `limit` characters (D3), whichever
 * comes first. Past the line limit, the cut is the end of the last whole line
 * kept. Inside the character window it prefers the last paragraph break, then
 * the last line break, then the last space, so the fold does not land
 * mid-word; it falls back to a hard cut for one long unbroken token. A cut never
 * splits a UTF-16 surrogate pair (an emoji would otherwise render as a
 * replacement glyph). A boundary in the first half of the character limit is
 * ignored, because folding a 600-character message after 40 characters hides
 * more than it saves.
 *
 * A cut that lands inside a line ends in `…` (the TUI's D4 ruling): without it
 * a prose fold mid-sentence is marked only by the toggle below it. A cut at a
 * line or paragraph break gets none, because the text there already ends where
 * its author ended a line. The ellipsis is a typographic mark, not copy, so it
 * is not translated.
 */
export function bridgeBodyPreview(
	body: string,
	limit = BRIDGE_CARD_BODY_COLLAPSE_CHARS,
	lines = BRIDGE_CARD_BODY_COLLAPSE_LINES,
): { text: string; truncated: boolean } {
	// The end of line `lines`, when anything but whitespace follows it.
	let lineEnd = -1;
	let seen = 0;
	for (
		let at = body.indexOf("\n");
		at !== -1;
		at = body.indexOf("\n", at + 1)
	) {
		seen += 1;
		if (seen === lines) {
			if (body.slice(at).trim()) lineEnd = at;
			break;
		}
	}
	if (lineEnd >= 0 && lineEnd <= limit)
		return { text: body.slice(0, lineEnd).trimEnd(), truncated: true };
	if (body.length <= limit) return { text: body, truncated: false };
	const window = body.slice(0, limit);
	const floor = Math.floor(limit / 2);
	let cut = -1;
	let atLineBreak = false;
	for (const boundary of ["\n\n", "\n", " "]) {
		const at = window.lastIndexOf(boundary);
		if (at >= floor) {
			cut = at;
			atLineBreak = boundary !== " ";
			break;
		}
	}
	if (cut < 0) {
		cut = limit;
		const code = body.charCodeAt(cut - 1);
		if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
	}
	const text = body.slice(0, cut).trimEnd();
	return { text: atLineBreak ? text : `${text}${ELLIPSIS}`, truncated: true };
}

/**
 * The items a coalesced card shows while folded, and how many it hides (D2).
 * A card folds only when the fold hides at least two items: hiding a single
 * one would trade one row for a toggle row of the same height.
 */
export function bridgeCardFold<T>(
	items: readonly T[],
	keep = BRIDGE_CARD_BODY_FOLDED_ITEMS,
): { shown: readonly T[]; hidden: number } {
	if (items.length - keep < 2) return { shown: items, hidden: 0 };
	return { shown: items.slice(0, keep), hidden: items.length - keep };
}
