/**
 * The waiting label a busy send earns while the backend still holds it.
 *
 * WHERE THE WAITING COMES FROM, and why that is the whole design: the
 * backend's `frontend.queued_steering[]` is its own list of messages waiting to
 * reach the running turn, and each item's `id` is the message id the optimistic
 * row was painted under and the durable row keeps (`appendPendingUser`: user
 * rows carry the request UUID). So a label is drawn only while the owner says
 * the message is queued — never at the press, never after delivery — which is
 * what makes it impossible to be false by construction (spec §C).
 *
 * THE MODE IS CLIENT-LOCAL, a deliberate limit rather than an oversight: the
 * wire carries no delivery mode for a queued message (the backend's items are
 * `id`, `text`, `image_count`, `status`), so `noteBusySend` remembers the mode
 * this client pressed with. A reload loses that map and the row loses its
 * label; it never gains a wrong one.
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
 */
export function busyWaitLabels(
	queued: readonly Record<string, unknown>[],
	streaming: boolean,
	modes: ReadonlyMap<string, string>,
): Map<string, BusyWaitState> {
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
	return labels;
}
