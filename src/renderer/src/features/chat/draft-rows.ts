/**
 * The new-chat drafts the sidebar lists (§C1, UX round 2's U8).
 *
 * WHAT WAS WRONG. `⌘N` stages a fresh draft, and a draft pane's identity IS its
 * store key (`draft:<uuid>`) — so the composer's text, which is persisted under
 * that key (`conversation-input-store`'s `inputByConversation`), stayed on disk
 * and left the screen. Nothing in the product could name the key again: the
 * sidebar listed SESSIONS, and a session-less draft is not one. Two QA/UX passes
 * reproduced the loss, and it is a loss by reachability rather than by deletion,
 * which is why the fix is a row and not a rescue.
 *
 * WHY THE ROWS ARE DERIVED HERE rather than read off the drafts map where they
 * are drawn. Three conditions decide whether a draft is one of these rows, the
 * rule has to be true of the state AFTER a relaunch (where it is restored from
 * `persist` rather than built by `stageDraft`), and a rule written inline in a
 * component cannot be exercised by this repository's `node:test` suites — the
 * same argument `draftIdentityFor` and `panelIdentityFor` state in the store.
 *
 * THE THREE CONDITIONS, and what each refuses:
 *
 *  - **no `sessionId`, or that session not listed yet** — a draft that has become a
 *    session is that session, and it is already a row in this list under its own
 *    title. Listing it twice would put one conversation on screen under two names,
 *    one of them stale. The owner is read from `sessionId` OR from a
 *    `send:<sessionId>` key (a live send writes no field), and the row stands only
 *    while the session's own row is ABSENT from the list the caller is drawing
 *    (D6: no duplicate; U6: the presence that survives a lagging catalogue).
 *  - **no `target`** — a draft addressed to an agent or a team
 *    (`draft:agent:<name>`) is reachable by pressing that entity's own row, which
 *    is the gesture that CREATED it; a `Draft:` row beside it would be a second
 *    way to the same pane and a second thing to keep in step with it.
 *  - **non-empty text** — an untouched draft is the pane the user is looking at,
 *    and the launch seed (`launchDraftSeed`) writes one on every cold start. A
 *    list that opened with an empty `Draft:` row on a brand-new install would be
 *    one row of noise that says nothing. THE TEXT HAS TWO SOURCES: the composer,
 *    and - when the box has cleared at a press - the claim's own `submittedText`,
 *    because a chat whose first send is in flight is exactly the chat a reader
 *    needs to find in this list (design review round 1's D3; UX round 1's U2 for
 *    the create that dies in that window).
 *
 * THE TEXT COMES FROM THE INPUT STORE, or from the draft's claim, not from a
 * third place: the composer writes on every change
 * (`use-message-input`'s persistence effect), so the row's first line is one
 * keystroke behind the box, which is the same interval at which the box is the
 * truth - and `submittedText` is the press's own record of what went, kept until
 * the claim resolves.
 */
import type { ChatDraft } from "@shared/store/canonical-sessions-store";

/** What every draft row's label starts with, so the list states what the row is. */
export const DRAFT_ROW_PREFIX = "Draft: ";

/** The default `listedSessionIds`: a caller that lists no sessions owns no row. */
const EMPTY_LISTED_SESSIONS: ReadonlySet<string> = new Set();

/**
 * One row the sidebar draws.
 *
 * `text` is carried beside `label` so a caller can render the whole thing (a
 * tooltip, an accessible name) without re-reading the input store, and so the
 * suite can assert the two are the same draft.
 */
export type DraftRow = {
	key: string;
	label: string;
	text: string;
	/**
	 * Whether this row's send hop is LIVE (`ChatDraft.pending`): a create or a
	 * message still on the wire, with nothing decided yet.
	 *
	 * WHY THE ROW CARRIES IT (UX round 1's U2, remediation): the discard acts are
	 * inapplicable in exactly this state — a press that removes the row while the
	 * send goes on to land is a "discard" followed by a silent send — and the
	 * sidebar disables them from this field rather than re-deriving the predicate
	 * (the same one-place rule the row's `text` states above). A FAILED claim is
	 * not pending and stays discardable.
	 */
	pending: boolean;
};

/**
 * The first line of a draft, as the row's own words.
 *
 * FIRST LINE rather than the whole draft: a message is a paragraph, and a row is
 * one 30px line. Leading blank lines are skipped rather than trimmed into
 * nothing, because a draft that opens with a newline is a real shape (paste, or
 * a deliberate paragraph break) and rendering it as an empty row would read as a
 * lost draft — the defect these rows exist to answer.
 */
export const draftRowTitle = (text: string): string => {
	const line = text.split("\n").find((part) => part.trim().length > 0) ?? "";
	const trimmed = line.trim();
	// The cap is the row's own: the label is drawn with `truncate`, and cutting
	// here as well keeps the DOM string (and every accessible name built from it)
	// the same length as what is on screen, so a screen reader does not read out
	// four hundred characters the eye never sees.
	const CAPPED = 48;
	return trimmed.length > CAPPED
		? `${trimmed.slice(0, CAPPED).trimEnd()}…`
		: trimmed;
};

/**
 * The accessible name - and the tooltip, which is the same string in both
 * channels the way the session rows' acts do it - for a draft row's discard
 * control.
 *
 * THE ACTION, NEVER THE STATE (the archive control's rule, one control over),
 * and the row's own prefix is DROPPED rather than echoed: `Draft: ` is what the
 * label already says the row IS, so keeping it would have the control read
 * "Discard draft “Draft: …”" - the noun twice, which is the kind of stutter
 * that makes a screen-reader pass feel unfinished.
 */
export const discardDraftLabel = (label: string): string => {
	const title = label.startsWith(DRAFT_ROW_PREFIX)
		? label.slice(DRAFT_ROW_PREFIX.length)
		: label;
	return `Discard draft “${title}”`;
};

/**
 * The position a discard should hand the caret to, computed from the keys as
 * they stood BEFORE the write.
 *
 * WHY THIS IS A FUNCTION RATHER THAN AN EXPRESSION IN THE HANDLER (agent review
 * round 1's R2 = design round 1's D2). The handler's own version read the index
 * of the button it was handed among the rows' `[data-draft-row]` elements — and
 * that button carries `data-draft-discard`, so the index was always -1, the
 * clamp always `0`, and deleting the third draft dropped the reader at the TOP
 * of the list (measured on the built app; the suite that "pinned" it asserted
 * the expression's shape rather than its arithmetic). THE KEY IS THE ONLY SAFE
 * IDENTITY here — rows reorder under the write — and the number returned is the
 * position in the AFTER list the caret should take: the removed row's own
 * index, so the row that slides up gets focus. A key that is no longer there
 * (already discarded) reads as position 0, which the caller clamps against
 * whatever remains.
 */
export function discardSuccessorIndex(
	keysBefore: readonly string[],
	removedKey: string,
): number {
	const at = keysBefore.indexOf(removedKey);
	return Math.max(at, 0);
}

/**
 * Every draft the sidebar should list, in the order the store holds them.
 *
 * ORDER is the drafts map's own insertion order, which `persist` round-trips:
 * a draft list has no timestamps to sort by (a draft is created by a keypress,
 * and `stageDraft` writes no clock), and inventing one would be a second fact to
 * keep true. Newest-last is what insertion order gives, and the list renders it
 * reversed for the same reason the chat list puts today above this week.
 *
 * THE SESSION ROW IS THE PRESENCE, WHEN IT EXISTS (agent review round 2's D6 and
 * UX round 2's U6, one rule with two faces). A draft that has become a session
 * is normally that session's own row: listing it again puts one conversation on
 * screen under two names, one of them labelled `Draft:` for a message that is in
 * flight - or, after a refusal, failed (D6 measured exactly that on a live send,
 * because the `send:<sessionId>` shape never writes the `sessionId` field that
 * used to refuse it). But "normally" is not "always": between a create's answer
 * and the catalogue's next paint the session row can be absent, and then the
 * draft row is the ONLY presence (U6: five attempts could not click back to a
 * chat that had just refused). So the caller states which sessions it is
 * listing, and the rule is: skip an owned draft exactly when its own session is
 * among them.
 */
export function untargetedDraftRows(
	drafts: Record<string, ChatDraft>,
	inputByConversation: Record<string, { currentInput?: string } | undefined>,
	listedSessionIds: ReadonlySet<string> = EMPTY_LISTED_SESSIONS,
): DraftRow[] {
	const rows: DraftRow[] = [];
	for (const [key, draft] of Object.entries(drafts)) {
		/*
		 * The conversation this draft belongs to, whichever way its key spells it
		 * (`draftBelongsToSession` states the same pair in the store): a staged
		 * draft learns `sessionId` at the create's answer, while the live-send shape
		 * `send:<sessionId>` carries the id in the key alone.
		 */
		const owner =
			draft.sessionId ??
			(key.startsWith("send:") ? key.slice("send:".length) : undefined);
		if (owner && listedSessionIds.has(owner)) continue;
		if (draft.target) continue;
		const typed = inputByConversation[key]?.currentInput ?? "";
		/*
		 * THE CLAIM'S TEXT IS THE FALLBACK (design review round 1, D3). The composer
		 * clears at the press, and this row used to clear with it - so the chat lost
		 * its only sidebar presence for the whole create hop, and a create that died
		 * in that window left the conversation unreachable from the list entirely
		 * (UX round 1, U2). `submittedText` is kept on the draft until the claim
		 * resolves, so the row can state what is in flight.
		 *
		 * AND THE RESOLUTION'S OWN RECORD IS THE THIRD (UX round 2, U6, measured on
		 * the refusal frame): `resolveHeldFromServer` clears `submittedText` when it
		 * writes `undelivered`, and this rule then found no text at all - so the
		 * just-refused chat vanished from the list at exactly the moment a reader
		 * looks for it, which is U6's five attempts. `undelivered.text` is the same
		 * string the ROW paints from (`resynthesisePendingSend`'s resolved arm), so
		 * the list and the row read one source rather than two.
		 */
		const text =
			typed.trim().length > 0
				? typed
				: (draft.submittedText ?? draft.undelivered?.text ?? "");
		if (text.trim().length === 0) continue;
		rows.push({
			key,
			label: `${DRAFT_ROW_PREFIX}${draftRowTitle(text)}`,
			text,
			pending: draft.pending === true,
		});
	}
	return rows.reverse();
}
