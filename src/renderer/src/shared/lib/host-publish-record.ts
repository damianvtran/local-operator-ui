/**
 * WHICH HOSTS HAVE PUBLISHED `effective_identity`, remembered while the host
 * that said so is demonstrably the same process.
 *
 * WHY THIS EXISTS. Core publishes the field on warm frames; a resumed team
 * session's cold frame may carry `{}` (core PR #2050 at f98240bd42), which is
 * indistinguishable, frame by frame, from an older host. A capability is a fact
 * about the HOST, not the frame, so the first frame that carries the field
 * records it and a later `{}` from the same host is read as cold, never as
 * "older". The proper fix is core deriving the keys on the cold path (the anchor
 * lane is doing that); this is the stopgap, and its stated residual is that the
 * FIRST cold team session opened on a strict host before any warm frame has been
 * seen is still #866's open list.
 *
 * THE FAILURE DIRECTION IS THE DESIGN. When the record is uncertain it fails
 * OPEN: back to #866's behaviour, whose failure is a refused pick answered with
 * the runtime's own sentence. It never fails CLOSED, because a closed seat over
 * a runtime that would accept the pick is a wrong statement with no way to act
 * on it from the header. So the record is wiped on every signal that the host
 * may have changed, and is re-established only from a WARM frame after it.
 *
 * THE SIGNALS (`use-desktop-feed.ts` is the only caller of `observeProcess` and
 * `reset`): the desktop feed's own `epoch` - "a fresh epoch per PROCESS start"
 * in the backend (`desktop_feed.py`), carried on EVERY feed frame, so a daemon
 * replaced in place under a running renderer (a downgrade or a rollback of
 * `lop` on the same port) answers with a new one - the feed dropping its
 * connection, and the feed capability being withdrawn. The renderer is NOT
 * reloaded in any of those cases, which is what made a module-lifetime record
 * wrong (QA round 2, Q3).
 *
 * WHAT THE FEED CANNOT SEE: a PEER's runtime swapped behind the relay. The feed
 * is this device's daemon's, so its epoch says nothing about a peer's process.
 * Peers are keyed apart from this device (`headerHostKey`) so a local record
 * never covers them, but a peer downgraded mid-run keeps its own record until
 * the local feed resets everything or the app restarts. That residual is stated
 * on the PR.
 *
 * WHY MODULE STATE WITH A SUBSCRIPTION. The writes come from a render's effect
 * and from the feed hook, in different components, with no common ancestor; the
 * header must re-render when a reset lands (a stale lock would otherwise sit on
 * screen until something else happened to render it), hence the version counter
 * a `useSyncExternalStore` reads. Nothing persists it: a restart re-learns it.
 */
export function createHostPublishRecord() {
	const seen = new Set<string>();
	const listeners = new Set<() => void>();
	let version = 0;
	let processEpoch: string | null = null;
	const bump = () => {
		version += 1;
		for (const listener of listeners) listener();
	};
	return {
		note: (hostKey: string) => {
			if (seen.has(hostKey)) return;
			seen.add(hostKey);
			bump();
		},
		has: (hostKey: string) => seen.has(hostKey),
		/** Wipe the record: the host may have changed, so fail open. */
		reset: () => {
			processEpoch = null;
			if (seen.size === 0) return;
			seen.clear();
			bump();
		},
		/**
		 * Feed the record the epoch of a frame from this device's daemon. A change
		 * from one seen earlier is a different process: wipe. The first epoch seen
		 * wipes nothing, because nothing was learned under an earlier one.
		 */
		observeProcess: (epoch: string) => {
			const previous = processEpoch;
			processEpoch = epoch;
			if (previous !== null && previous !== epoch) {
				if (seen.size === 0) return;
				seen.clear();
				bump();
			}
		},
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		version: () => version,
	};
}

export const hostPublishRecord = createHostPublishRecord();
