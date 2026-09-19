/**
 * Archiving, as decisions the app can be tested on rather than as JSX conditions.
 *
 * WHY a module of its own, in this repository's own words: a decision in a JSX
 * condition is one no test can reach. The sidebar cannot be rendered in this
 * repo's test suite — it reads the router, the canonical-sessions store and the
 * desktop capability hooks — so the three claims this file owns (which rows the
 * at-rest lists may draw, which of the archive commands applies to the
 * conversation on screen, and what a backend without the capability renders) are
 * asserted here instead of against the component's source text.
 *
 * WHAT ARCHIVING IS: a conversation the backend still holds and that can still be
 * resumed by explicit id, but that the default lists and the default search do
 * not mention. That is the whole of it — it is not a delete, it is not a folder,
 * and it is not a status the row draws at rest beyond one muted glyph.
 *
 * WHAT IT DELIBERATELY DOES NOT DO, each for the reason it is stated:
 *
 * - **No section of its own.** The pin work spent a design round fitting the
 *   sections that exist (`Pinned chats` above `Active chats`); a second
 *   collapsible `Archived chats` region would be a third list competing for the
 *   same 45% of the panel, for a set the user explicitly does not want to see.
 *   The escape hatch is the search block's `Include archived` control, which
 *   exists for exactly one query at a time.
 * - **No re-sort, no re-rank.** Archiving removes a row; it never moves one.
 * - **No capability ⇒ no partition at all**, which is `visibleRows`'s fail-closed
 *   arm and the reason `enabled` is a parameter rather than something the caller
 *   checks around the call.
 */

/**
 * The rows the at-rest lists may draw.
 *
 * `enabled` is the capability gate (`desktopFeatureEnabled(capabilities.data,
 * "session_archive")`), and it is a parameter so that "no capability ⇒ the list
 * is the list it always was" is ONE testable decision.
 *
 * The withdrawn arm returns the SAME array, not a copy, and does not read a
 * single row's `archived`: a backend that advertises no archive store may still
 * answer a `archived` field (or this client may be holding an optimistic one from
 * a press made before the capability was withdrawn), and filtering on it then
 * would hide a conversation with no control anywhere that could restore it — the
 * rows would be drawn nowhere, which is the failure the pin's `unpinnedRows`
 * states in the same words. Feed the gate shut and the panel paints exactly what
 * it painted before this feature existed.
 */
export function visibleRows<T extends { archived?: boolean }>(
	rows: T[],
	enabled: boolean,
): T[] {
	if (!enabled) return rows;
	return rows.filter((row) => row.archived !== true);
}

/**
 * The archived rows among `rows`, for a surface that has to count them.
 *
 * The same gate and the same fail-closed claim as `visibleRows`: with the
 * capability absent there is no archived set this client can name, so it reports
 * none rather than reporting rows it would not be able to act on.
 */
export function archivedRows<T extends { archived?: boolean }>(
	rows: T[],
	enabled: boolean,
): T[] {
	if (!enabled) return [];
	return rows.filter((row) => row.archived === true);
}

/**
 * The words on the archive control, in ONE place because two surfaces offer it:
 * the row's own control and the open conversation's header.
 *
 * The action, never the state - the state is the marker beside the title and the
 * glyph on the control, and `aria-pressed` would read as a claim about a toggle
 * rather than about a conversation (see the sidebar's control). The conversation
 * is named in curly quotes, the shape the pin control and the entity row's
 * manage control already use, so a screen reader hears which conversation the
 * press would act on rather than only what it would do.
 */
export function archiveControlLabel(label: string, archived: boolean): string {
	return `${archived ? "Unarchive" : "Archive"} “${label}”`;
}

/**
 * Whether one of the archive commands applies to the conversation on screen.
 *
 * Keyed on the DESTINATION rather than on the command's name, because the
 * destination is the frozen wire identifier the whole feature already keys on
 * (`sessions.archive`, `sessions.unarchive` — see the backend's command catalogue
 * and the renderer's `DESTINATIONS` table), while a name is a label the user may
 * see aliased. A second list of command names here would be a copy that drifts the
 * moment the catalogue gains an alias.
 *
 * Why it exists at all: the command catalogue is STATIC — the backend advertises
 * `/archive` and `/unarchive` for every conversation, because it does not know
 * which one this pane has open — so the two rows have to be filtered against the
 * open session's own state on this side. `/unarchive` on a conversation that is
 * not archived is not a harmless no-op a user should be offered: it is an action
 * with nothing to act on, and offering it beside `/archive` would leave the
 * palette showing a pair of opposites for one state, one of which does nothing.
 *
 * The two arms are deliberately different questions:
 *
 * - `archiveEnabled` is the CAPABILITY (`session_archive`). Absent, neither
 *   command is offered at all — the same fail-closed rule the row's control and
 *   the header's pill follow, so a backend with no archive store advertises no
 *   affordance rather than a press that 404s.
 * - `archived` is the conversation's STATE. `undefined` is UNKNOWN: the pane has
 *   no row on this client's page and no stated state, so `/unarchive` is withheld
 *   (it needs a positive fact) while `/archive` stays, because its desired state
 *   is well defined whatever the current one is.
 */
export function archiveDestinationApplies(
	destination: string | undefined,
	archived: boolean | undefined,
	archiveEnabled: boolean,
): boolean {
	if (
		destination !== "sessions.archive" &&
		destination !== "sessions.unarchive"
	) {
		// Everything else in the catalogue is none of this feature's business.
		return true;
	}
	if (!archiveEnabled) return false;
	if (destination === "sessions.unarchive") return archived === true;
	return archived !== true;
}

/**
 * Why a typed archive command did not run, in the register the panel already
 * uses for a `/move` it cannot perform.
 *
 * THREE sentences for three causes, because they are not the same problem and only
 * two of them are about a state the user can see: a backend that cannot archive is
 * an update, a conversation already in the state the command asks for is nothing at
 * all, and a conversation whose archived state this window does NOT KNOW is a third
 * thing again - `archiveDestinationApplies` withholds `/unarchive` for it, so a
 * typed one has to say why rather than claim a state nobody established.
 */
export const ARCHIVE_UNAVAILABLE_REASON =
	"This backend cannot archive conversations. Update the backend and try again.";

export const ARCHIVE_ALREADY_ARCHIVED_REASON =
	"This conversation is already archived. Use /unarchive to restore it.";

export const ARCHIVE_NOT_ARCHIVED_REASON =
	"This conversation is not archived, so there is nothing to restore.";

/**
 * The third arm of the same refusal (`archiveDestinationApplies`).
 *
 * Reached when the pane's conversation carries NO archived value at all - it is
 * not on this client's catalogue page, so neither a fact nor a row speaks for it.
 * Saying "not archived" there would be the client asserting a state it does not
 * have (review round 1, N4); the honest sentence says what is unknown and names
 * the one route that does reach the conversation (a search, whose hit carries its
 * state).
 */
export const ARCHIVE_STATE_UNKNOWN_REASON =
	"This window cannot tell whether that conversation is archived - it is not among the chats listed here. Find it with search and use its row to restore it.";

/**
 * Whether a search may draw archived conversations.
 *
 * THREE INPUTS, and the three-way answer is the reason this is a function a test
 * can call rather than a condition inside the sidebar's JSX:
 *
 * - `enabled` is the capability (`session_archive`). Absent, the widening does not
 *   exist at all - the same fail-closed rule `visibleRows` follows.
 * - `control` is the user's `Include archived` box, which is REMEMBERED across a
 *   cleared box rather than reset with the query (UX round 1, U8). Clearing the
 *   field used to disarm the widening, so a user who cleared and retyped the same
 *   query lost the archived result they had just found, with nothing saying why.
 *   Remembering it costs nothing hidden: the box is drawn CHECKED when the query
 *   returns, so the state is visible where it acts.
 * - `query` is what keeps the remembered widening from outliving the search: with
 *   no query in force there is no widened LIST either, so the at-rest panels draw
 *   exactly what they drew before the box was ever ticked. That is the same
 *   one-state rule the control's own visibility follows (it exists only while a
 *   query does), applied to what it MEANS rather than to where it is drawn.
 */
export function archivedSearchWidened(
	control: boolean,
	query: string,
	enabled: boolean,
): boolean {
	return enabled && control && query.trim().length > 0;
}

/**
 * Whether an undo offer still stands, given what this client now knows.
 *
 * THE RETIREMENT RULE IN ONE SENTENCE, and it is the sentence the caller's own
 * docstring carries: the offer stands while the conversation still holds the
 * state the offer was taken from, and is retired the moment this client knows it
 * does not.
 *
 * `current` is the effective value (this window's own fact first, the catalogue
 * row second) and `undefined` is "no such conversation here" - a deleted one, or
 * one the page stopped carrying - which is never the state the offer was about.
 * It is a function rather than a condition inline for the reason this whole module
 * exists: the version that shipped retired the offer on the first answer that
 * MENTIONED the row, so it lasted 0.4-1.6 s and nobody could reach it (UX round
 * 1, U4), and a rule with one home is a rule a test can hold.
 */
export function undoOfferStands(
	offered: boolean,
	current: boolean | undefined,
): boolean {
	return current === offered;
}
