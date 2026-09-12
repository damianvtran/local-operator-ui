/**
 * The conversation's name, resolved for the two places that must agree.
 *
 * The header a user lands on and the sidebar row they clicked are two views of
 * ONE conversation, so a click that renames the conversation is a defect, not a
 * cosmetic mismatch. It was happening for most of a real store.
 *
 * ## Why the live field is not the whole answer
 *
 * `conversation_title` on the live frontend state is the backend's JOURNALLED
 * title only — for a cold session it is whatever the last runtime checkpoint
 * carried, and empty when there is none (`AttachedSession._synthesise_cold_state`
 * plus `_restore_cold_details` in the backend). The catalogue row the sidebar
 * renders is named by a different, wider rule: `resume.session_name()` falls
 * back to the conversation's OPENING MESSAGE when nothing is journalled, and
 * that is what `sessions.list` serves as the row's name. Counted against the
 * operator's own store: of 1407 sessions, 226 carry a journalled title and 1180
 * are named from their opener alone. So the row said "Improve ask function
 * clickable options" and the header said "Untitled chat", for 1180 of 1407
 * conversations.
 *
 * ## The stand-in is DISPLAY only, and this is the constraint that matters
 *
 * An opener-derived name must never reach the wire as `conversation_title`:
 * `conversation_title_user_set` and the backend's naming errand both read that
 * field as "this conversation is already named", so writing a stand-in would
 * retire the one call that could give the conversation a real name. The
 * terminal UI already resolves exactly this tension with a provisional label
 * held beside the session rather than on it (`_provisional_name` and
 * `_restore_resumed_name` in `local_operator/tui/app.py`): "the row a user
 * picked and the tab they land on agree by construction rather than by
 * coincidence". This module is the same rule for the desktop header, and the
 * task's invariant is that one sentence.
 *
 * ## The second half: a blank live title must not destroy a known name
 *
 * The live title also flows the other way, into the catalogue row via
 * `store.upsertSession`, which merges with a plain spread — so the old
 * unconditional `title: canonical.frontend.conversation_title` wrote `""` over
 * a name the catalogue had already supplied, and the sidebar row the user had
 * just clicked rendered "Untitled chat" until the 5s list poll restored it. It
 * re-blanked on every frontend update, i.e. continuously while a turn streamed.
 * `catalogueTitleUpdate` below is that write, and it is deliberately a partial
 * row: an empty object adds NO key, which is the only way the merge can be told
 * to leave the existing name alone.
 */

/**
 * What a conversation reads as before anyone has named it.
 *
 * Lives here rather than at either call site because the header and the
 * catalogue's own fallback are asserted to agree about it; the sidebar's copy
 * is left where it is (this change does not own that file's fallback).
 */
export const UNTITLED_CHAT = "Untitled chat";

/**
 * A title counts as unknown when it is absent or whitespace-only.
 *
 * Whitespace matters because the two sources disagree about the empty string:
 * a journalled title is whitespace-normalised by the backend's own writer, so a
 * `"   "` arriving here means "no name", not "a name made of spaces". Without
 * this, a whitespace title would win the header and blank the row.
 */
export function isBlankTitle(title: string | null | undefined): boolean {
	return typeof title !== "string" || title.trim() === "";
}

/**
 * The text the chat header wears.
 *
 * Precedence: the draft branch first (a staged draft has no conversation yet),
 * then the live title, then the catalogue row's name, then the untitled
 * fallback. Live first is what keeps a real rename showing the moment it lands;
 * the catalogue second is what makes the header agree with the row the user
 * clicked, and it is a READ of that row — nothing here writes a name back.
 */
export function resolveChatTitle(input: {
	draftKey?: string | null;
	draftTarget?: string | null;
	liveTitle?: string | null;
	catalogueTitle?: string | null;
}): string {
	const { draftKey, draftTarget, liveTitle, catalogueTitle } = input;
	if (draftKey)
		return draftTarget ? `New chat with ${draftTarget}` : "New chat";
	if (!isBlankTitle(liveTitle)) return liveTitle as string;
	if (!isBlankTitle(catalogueTitle)) return catalogueTitle as string;
	return UNTITLED_CHAT;
}

/**
 * The title to write into the catalogue row for a live session, or nothing.
 *
 * Returns a partial row rather than a title value so that "write no title" is
 * expressible: `upsertSession` merges with `{ ...current, ...incoming }`, and a
 * key that is PRESENT with an `undefined` value still overwrites. Only the
 * absence of the key leaves the row's existing name standing, which is why the
 * empty-object case is the load-bearing one and why it is tested as a property
 * of the real store rather than of this function alone.
 *
 * A non-blank live title always wins, so `/rename` still propagates; a blank or
 * whitespace-only one falls back to the row's own name, and only a row that has
 * no name at all is left untouched.
 */
export function catalogueTitleUpdate(input: {
	liveTitle?: string | null;
	catalogueTitle?: string | null;
}): { title?: string } {
	const { liveTitle, catalogueTitle } = input;
	if (!isBlankTitle(liveTitle)) return { title: liveTitle as string };
	if (!isBlankTitle(catalogueTitle)) return { title: catalogueTitle as string };
	return {};
}
