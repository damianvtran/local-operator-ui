import type { BridgeCardBody } from "./bridge-receipt-model";

/*
 * ------------------------------------------------------ re-reading an open card
 *
 * WHY A CARD KEEPS ASKING. A Team Bridge card is posted the moment a message
 * reaches this machine, but its body is handed off only at the receiving
 * session's next turn, and until then core's card-body read honestly answers
 * `pending`. Measured on the operator's machine (n=4005 cards, post → hand-off):
 * p50 45 s, p90 21 min, p99 100 min, max 8 h. So `pending` is the NORMAL first
 * answer for a card opened soon after it arrived, and it lasts a long time. The
 * first version read once per open and treated that answer as final: a pane
 * opened while pending said "Still being delivered." until it was closed and
 * reopened, and a pane left open never updated (the operator's report).
 *
 * THE POLICY. While the pane is open and the last answer is not final, read
 * again after 5 s, 10 s, 20 s, 30 s, then every 60 s, with no overall give-up:
 * the observed tail is hours, and a give-up would recreate the stale pane this
 * fixes. The early steps catch the median hand-off within a minute; the 60 s
 * steady state keeps an hours-long wait to one local read a minute. That is
 * cheap because re-reading a `pending`/`held` item is answered from the
 * receiver's own store in core before any hub backfill; only misses and
 * offline answers reach the hub, and those are exactly the ones worth retrying.
 *
 * WHAT IT DOES NOT CHANGE. Nothing is cached past an open (revocation stays
 * live, bridge-body design §2 C): the schedule lives only as long as the pane
 * is mounted, and a closed pane makes no reads at all.
 *
 * The same policy (states, steps, no give-up) runs in the core TUI and the
 * mobile relay so the three surfaces agree on when a card updates.
 */

/** Delays before the first re-reads, in milliseconds. */
export const BRIDGE_CARD_REREAD_STEPS_MS = [5_000, 10_000, 20_000, 30_000];

/** The steady interval once the steps are spent; never stops on its own. */
export const BRIDGE_CARD_REREAD_STEADY_MS = 60_000;

/** The wait before re-read number `attempt` (0-based). */
export function bridgeCardRereadDelay(attempt: number): number {
	return BRIDGE_CARD_REREAD_STEPS_MS[attempt] ?? BRIDGE_CARD_REREAD_STEADY_MS;
}

/**
 * `unavailable` reasons that a later read can turn into a body: the hub was
 * unreachable (`offline`) or core has not loaded that message yet
 * (`not_loaded`). Every other reason (deleted, other_account, signed_out,
 * not_member, hub_unsupported) needs the reader to do something first, so
 * asking again on a timer would only repeat it.
 */
const RETRYABLE_REASONS: ReadonlySet<string> = new Set([
	"offline",
	"not_loaded",
]);

/**
 * Whether an answer can still change while the pane stays open.
 *
 * Non-final: a failed or malformed read (`null`); any item `pending`; any item
 * `held`, of either class (a transient hold clears when screening runs, and an
 * awaiting-review hold can still be released or refused by a person); any
 * `unavailable` item with a retryable reason. Everything else is final,
 * including any state a newer server adds that this client does not know
 * (the parser already maps an unknown state to plain `unavailable`): failing
 * quiet means one read, never a poll against a server we do not understand.
 *
 * A coalesced card is non-final while ANY of its messages is, so the newest
 * message's body appears without reopening even when older ones are settled.
 */
export function bridgeCardBodyIsFinal(read: BridgeCardBody | null): boolean {
	if (read === null) return false;
	return !read.items.some(
		(item) =>
			item.state === "pending" ||
			item.state === "held" ||
			(item.state === "unavailable" &&
				item.reason !== undefined &&
				RETRYABLE_REASONS.has(item.reason)),
	);
}
