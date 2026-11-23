/**
 * The waiting label a busy send earns while the backend still holds it.
 *
 * WHERE THE WAITING COMES FROM, and why that is the whole design: the
 * backend's `frontend.queued_steering[]` is its own list of messages waiting to
 * reach the running turn, and each item's `id` is the message id the optimistic
 * row was painted under and the durable row keeps (`appendPendingUser`: user
 * rows carry the request UUID). So a label is drawn only while the owner says
 * the message is queued — never at the press, never after delivery — which is
 * what makes the WAIT itself impossible to be false by construction (spec §C).
 *
 * THE MODE IS CLIENT-LOCAL, a deliberate limit rather than an oversight: the
 * wire carries no delivery mode for a queued message (the backend's items are
 * `id`, `text`, `image_count`, `status`), so `noteBusySend` remembers the mode
 * this client pressed with. Two consequences a reader must not read past:
 *
 * - A steer sent from the TUI, the phone, a peer session, or by this client
 *   before a reload is NOT in that map. Those messages earn no line of their
 *   own, and `joined` is decided only from the steers this client can see - so
 *   a queue/both row can still say "waits" while the backend is in fact urgent
 *   about it, and a reload loses every line. The claim the label makes is
 *   therefore "waits, sent this way by THIS client", never a general statement
 *   about the backend's urgency: the WAIT half is the owner's fact, the MODE
 *   half is this client's own record of the press.
 * - An entry outlives the queue read it was written for (the bound in
 *   `canonical-sessions-store.ts` is what keeps the map small), and the wait
 *   always disappears first: the label is drawn only while the id is in
 *   `queued_steering`, so a stale entry is never drawn at all.
 *
 * `joined` mirrors the TUI receipt rule (spec §B): any steer waiting in the
 * queue makes every queue and queue-then-steer row go out WITH that steer, so
 * its line says so — and the steer row keeps its own line. `deferred` is the
 * turn having ended while the message still waits: it goes out with the
 * reader's next message.
 */

import type { DeliveryMode } from "../composer-send-key";

/** What a waiting row can say about itself. */
export type BusyWaitState = DeliveryMode | "joined" | "deferred";

/**
 * The one empty answer, SHARED by every frame that has nothing to label.
 *
 * A frame with no labels is the common case - every settled turn - and a fresh
 * `Map` per render would hand the pane's context a new value at every turn's
 * start and end, re-rendering every user row for a map that says nothing. One
 * instance, typed read-only and frozen, keeps that identity still; the fold
 * below is the only writer, and it never writes here.
 */
export const NO_BUSY_WAIT_LABELS: ReadonlyMap<string, BusyWaitState> =
	Object.freeze(new Map<string, BusyWaitState>());

const isDeliveryMode = (mode: string | undefined): mode is DeliveryMode =>
	mode === "steer" || mode === "queue" || mode === "both";

/**
 * One label per queued id this client knows the mode of.
 *
 * Takes the queue as the wire hands it (`Array<Record<string, unknown>>`,
 * contract `desktop-session-contract.ts`), so a frame whose item shape drifted
 * degrades to no label instead of a guess. A mode the map holds but this
 * module does not know (an older client, a hand-written fixture) also degrades
 * to no label: the four sentences are all true statements about a delivery
 * mode, and an unknown one has no true sentence here.
 *
 * Returns `NO_BUSY_WAIT_LABELS` itself when nothing gets a label: the callers
 * hand the result to a React context, where a fresh empty map is a new value on
 * every frame and repaints every row.
 */
export function busyWaitLabels(
	queued: readonly Record<string, unknown>[],
	streaming: boolean,
	modes: ReadonlyMap<string, string>,
): ReadonlyMap<string, BusyWaitState> {
	const known = new Map<string, DeliveryMode>();
	for (const item of queued) {
		const id = item?.id;
		const mode = typeof id === "string" ? modes.get(id) : undefined;
		if (typeof id !== "string" || !isDeliveryMode(mode)) continue;
		known.set(id, mode);
	}
	const steerWaiting = [...known.values()].includes("steer");
	const labels = new Map<string, BusyWaitState>();
	for (const [id, mode] of known) {
		if (!streaming) labels.set(id, "deferred");
		else labels.set(id, steerWaiting && mode !== "steer" ? "joined" : mode);
	}
	return labels.size === 0 ? NO_BUSY_WAIT_LABELS : labels;
}
