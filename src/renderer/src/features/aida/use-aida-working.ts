/**
 * Whether her rail row draws the working mark.
 *
 * WHAT COUNTS AS WORKING, and it is the app's own one code: `status.code ===
 * "busy"` - a turn in flight. The chat sidebar's row draws the spinning
 * `LoaderCircle` for exactly this code and for nothing else
 * (`chat-session-status.tsx`), so the rail wears the same mark for the same
 * fact. A parked gate (`approval` / `answer`) is a different fact with a
 * different glyph (the alert ring), `delegating` belongs to the subagent share
 * glyph, and `wedged` owns its own waves - none of them is "working", and
 * folding them in would say "she is on it" about rows that are in fact waiting
 * on the user.
 *
 * WHY IT CAN BE TRUE FOR A CLOSED CONVERSATION: the status is the CATALOGUE
 * row's, not the open conversation's - the machine-wide status feed publishes
 * it for every listed session (the `session_status` frames the store merges
 * onto the catalogue it already holds), so her proactive wake, which is a turn
 * in her session like any other, raises the mark while the user is anywhere in
 * the app. This is the same fact `unreadMarkKind` reads for a mark the sidebar
 * draws on a row that is not open.
 *
 * Live by subscription, the shape `use-aida-missed-messages.ts` owns: the feed
 * moves the row, the rail repaints.
 */
import {
	type CanonicalSessionRow,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";

/** The pure half, so the rule is executable in the desktop suite. */
export const aidaWorking = (
	sessions: CanonicalSessionRow[],
	sessionId: string | null | undefined,
): boolean =>
	sessionId
		? sessions.some(
				(row) => row.session_id === sessionId && row.status?.code === "busy",
			)
		: false;

/** Her session's working state, kept current as the store moves. */
export function useAidaWorking(sessionId: string | null | undefined): boolean {
	return useCanonicalSessionsStore((state) =>
		aidaWorking(state.sessions, sessionId),
	);
}
