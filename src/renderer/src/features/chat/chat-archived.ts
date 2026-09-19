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
 * TWO sentences for two causes, because they are not the same problem and only
 * one of them has anything the user can do: a backend that cannot archive is
 * an update, and a conversation that is already in the state the command asks
 * for is nothing at all.
 */
export const ARCHIVE_UNAVAILABLE_REASON =
	"This backend cannot archive conversations. Update the backend and try again.";

export const ARCHIVE_ALREADY_ARCHIVED_REASON =
	"This conversation is already archived. Use /unarchive to restore it.";

export const ARCHIVE_NOT_ARCHIVED_REASON =
	"This conversation is not archived, so there is nothing to restore.";
