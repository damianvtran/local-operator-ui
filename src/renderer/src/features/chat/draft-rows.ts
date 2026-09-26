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
 *  - **no `sessionId`** — a draft that has become a session is that session, and
 *    it is already a row in this list under its own title. Listing it twice would
 *    put one conversation on screen under two names, one of them stale.
 *  - **no `target`** — a draft addressed to an agent or a team
 *    (`draft:agent:<name>`) is reachable by pressing that entity's own row, which
 *    is the gesture that CREATED it; a `Draft:` row beside it would be a second
 *    way to the same pane and a second thing to keep in step with it.
 *  - **non-empty text** — an untouched draft is the pane the user is looking at,
 *    and the launch seed (`launchDraftSeed`) writes one on every cold start. A
 *    list that opened with an empty `Draft:` row on a brand-new install would be
 *    one row of noise that says nothing.
 *
 * THE TEXT COMES FROM THE INPUT STORE, not from the draft row, because that is
 * where the composer writes it — the draft row carries identity (key, target,
 * request ids) and never the user's words. Reading the two maps together is what
 * makes the label track the typing: the composer writes on every change
 * (`use-message-input`'s persistence effect), so the row's first line is one
 * keystroke behind the box, which is the same interval at which the box is the
 * truth.
 */
import type { ChatDraft } from "@shared/store/canonical-sessions-store";

/** What every draft row's label starts with, so the list states what the row is. */
export const DRAFT_ROW_PREFIX = "Draft: ";

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
 * Every draft the sidebar should list, in the order the store holds them.
 *
 * ORDER is the drafts map's own insertion order, which `persist` round-trips:
 * a draft list has no timestamps to sort by (a draft is created by a keypress,
 * and `stageDraft` writes no clock), and inventing one would be a second fact to
 * keep true. Newest-last is what insertion order gives, and the list renders it
 * reversed for the same reason the chat list puts today above this week.
 */
export function untargetedDraftRows(
	drafts: Record<string, ChatDraft>,
	inputByConversation: Record<string, { currentInput?: string } | undefined>,
): DraftRow[] {
	const rows: DraftRow[] = [];
	for (const [key, draft] of Object.entries(drafts)) {
		if (draft.sessionId) continue;
		if (draft.target) continue;
		const text = inputByConversation[key]?.currentInput ?? "";
		if (text.trim().length === 0) continue;
		rows.push({
			key,
			label: `${DRAFT_ROW_PREFIX}${draftRowTitle(text)}`,
			text,
		});
	}
	return rows.reverse();
}
