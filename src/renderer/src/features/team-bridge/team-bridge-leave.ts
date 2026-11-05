/**
 * Where "leave Team Bridge" goes: back through history when this window has an
 * in-app entry to go back to, else to `/chat`.
 *
 * WHY HISTORY AND NOT A REMEMBERED ROUTE. The window's history already holds
 * the place the reader came from (Settings, Library, a conversation), and ⌘[
 * already walks it. A second "last non-bridge route" store would be a second
 * answer to the same question, and the button and the chord would disagree the
 * first time they drifted.
 *
 * WHY `history.state.idx` AND NOT `location.key`. React Router stamps every
 * entry it writes with `{ idx }`, and `idx` is the entry's position in this
 * window's stack - 0 for the entry the window opened on. The tempting
 * `location.key !== "default"` test is wrong here: a notification or deep link
 * opens `/team-bridge?tenant=...&conversation=...` and the page consumes those
 * params with `setSearchParams({}, { replace: true })`, which gives the FIRST
 * entry a real key while it is still the first entry. `navigate(-1)` from there
 * goes nowhere, so a cold open would leave the reader with a dead Back. `idx`
 * survives a replace (the router copies it), so it answers "is there an entry
 * before this one" exactly.
 *
 * Every entry before this one is in-app: the renderer is a hash-routed Electron
 * window, so there is no foreign page in its history to fall back into. In-app
 * is not enough on its own, though: the entry before could be ANOTHER
 * `/team-bridge` entry, and then `navigate(-1)` would leave the reader where
 * they are (round 1, M2). The rule therefore relies on one entry per visit:
 * in-route navigation is state, deep-link params are cleared with a replace,
 * and a notification opened while already here replaces rather than pushes
 * (`use-team-bridge-notification-open.ts`).
 */
export type TeamBridgeLeaveTarget = "history" | "/chat";

export function teamBridgeLeaveTarget(
	historyState: unknown,
): TeamBridgeLeaveTarget {
	const idx =
		typeof historyState === "object" && historyState !== null
			? (historyState as { idx?: unknown }).idx
			: undefined;
	return typeof idx === "number" && idx > 0 ? "history" : "/chat";
}
