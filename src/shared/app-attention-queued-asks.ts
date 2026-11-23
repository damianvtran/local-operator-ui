/**
 * The one IPC pair that tells app-main which conversations hold an OPEN QUEUED
 * ask.
 *
 * WHY THE WINDOW HAS TO SPEAK AT ALL. The harness files a non-blocking queued ask
 * under the same feed status code as a blocking question (`answer`), and a feed
 * frame carries only `{code, revision}` per conversation - no ask count - so a
 * projection built from the feed alone cannot tell "the agent is parked on a
 * question that needs you" from "the agent asked, kept working, and left a
 * question waiting in the queue". The window is the only reader of the queued-ask
 * index (`fleet-asks.ts`), so it publishes the set of conversation ids holding at
 * least one answerable queued ask, and `AppAttentionProjection` reads an `answer`
 * status beside one of those ids as ALREADY COUNTED rather than as a gate. An
 * `approval` stays a gate either way: consent parks the agent whatever else is
 * queued.
 *
 * THE TWO DIRECTIONS, AND WHY THERE ARE TWO. The report is the window's claim; the
 * request is main asking for it again. The window pushes when the SET changes and
 * not on a clock, and main drops the claim on every reset (an epoch replacement
 * included), so without the request a conversation whose queued ask did not change
 * would read as needing the user from the reset until the next change - which may
 * be hours.
 *
 * In `shared/` because both ends import it: the preload must not pull a main
 * module (which reads the filesystem) into its bundle.
 */
export const APP_ATTENTION_QUEUED_ASKS_CHANNEL = "app-attention:queued-asks";
export const APP_ATTENTION_QUEUED_ASKS_RESYNC_CHANNEL =
	"app-attention:queued-asks-resync";

/**
 * The most conversation ids one report may carry.
 *
 * `maxSessions` in the desktop contract caps a session listing request at 5000
 * (`shared/desktop-contract.ts`) - the largest population this app's own control
 * plane will ask about at once - so a report above it names more conversations
 * than a window can know about, and is refused WHOLE rather than truncated: a
 * partial set would silently un-mask a conversation it dropped.
 */
export const MAX_QUEUED_ASK_SESSIONS = 5000;

/** Session ids are UUIDs (36 characters); the bound keeps "any string" from
 * crossing the IPC seam without admitting an unbounded one. */
const MAX_SESSION_ID_LENGTH = 256;

/**
 * Counts per conversation (`fleetAsksBySession`) -> the sorted, deduplicated id
 * list main is told about.
 *
 * SORTED because the window compares this list as a KEY to decide whether to push
 * at all: an unsorted list would make a row reorder look like a change and spend
 * an IPC call on it. A count that is not a positive safe integer is DROPPED rather
 * than coerced: a `NaN` from a malformed row says nothing about how many asks are
 * open, and counting it would claim a queued ask that does not exist.
 */
export function queuedAskSessionIds(
	counts: ReadonlyMap<string, number> | null | undefined,
): string[] {
	if (!counts) return [];
	const ids: string[] = [];
	for (const [id, count] of counts) {
		if (typeof id !== "string" || id.length === 0) continue;
		if (!Number.isSafeInteger(count) || count <= 0) continue;
		ids.push(id);
	}
	return ids.sort();
}

/**
 * Main's ONLY acceptance of the window's claim: an array of non-empty session
 * ids within {@link MAX_QUEUED_ASK_SESSIONS}, or `null` for a refusal.
 *
 * `null` and `[]` are different facts: `[]` is a real claim ("nobody holds a
 * queued ask") and must un-mask everything; `null` is a payload this process will
 * not believe, and the claim already held is left alone. Duplicates are folded
 * rather than refused - two readers of one conversation is a redundant claim, not
 * a malformed one.
 */
export function parseQueuedAskSessionIds(payload: unknown): string[] | null {
	if (!Array.isArray(payload)) return null;
	if (payload.length > MAX_QUEUED_ASK_SESSIONS) return null;
	const ids = new Set<string>();
	for (const value of payload) {
		if (typeof value !== "string") return null;
		if (value.length === 0 || value.length > MAX_SESSION_ID_LENGTH) return null;
		ids.add(value);
	}
	return [...ids];
}
