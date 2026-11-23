import { useEffect, useMemo, useRef, useState } from "react";
import { queuedAskSessionIds } from "../../../../shared/app-attention-queued-asks";
import { fleetAsksBySession, useFleetAsks } from "./fleet-asks";

/**
 * THE WINDOW'S HALF OF THE DOCK/TRAY ASK FIX: which conversations hold at least
 * one OPEN QUEUED ask, pushed to app-main.
 *
 * WHY THE WINDOW PUSHES. The harness files a non-blocking queued ask under the
 * same feed status code a blocking question carries (`answer`), and the feed
 * carries no ask count, so app-main's projection cannot tell the two apart on its
 * own. This window is the only reader of the queued-ask index, so it states the
 * answer and `AppAttentionProjection` reads an `answer` status beside one of these
 * ids as already counted by the window's own badge rather than as a gate
 * (`shared/app-attention-queued-asks.ts` has the contract).
 *
 * MOUNTED ONCE, IN THE SHELL, because it speaks for the whole window and not for a
 * row: the same reason `PeersCatalogueSync` lives there. The read itself is the
 * shared fleet query - the top-level badge and the drawer are other lenses on one
 * answer, not a second fetch.
 *
 * SENT ON CHANGE ONLY. `queuedAskSessionIds` sorts, so a refetch that reorders rows
 * is not a change; the key is the whole payload, so nothing cheaper can drift. A
 * claim already sent is not re-sent, which is why main asks for it again after a
 * reset (`onQueuedAskSessionsResync`).
 *
 * `rows === null` (the route has not answered, or this backend predates it) sends
 * the EMPTY set: no queued ask is claimed, so every `answer` reads as a gate -
 * exactly the pre-fix behaviour, and the safe direction of the two.
 */
export const useQueuedAskAttention = (): void => {
	const { rows } = useFleetAsks();
	const ids = useMemo(
		() => queuedAskSessionIds(rows === null ? null : fleetAsksBySession(rows)),
		[rows],
	);
	/** What main was last told, as the set's stable key; `null` before the first
	 * push and after a resync request. */
	const sent = useRef<string | null>(null);
	/** Counts main's requests so the push effect runs again for an UNCHANGED set:
	 * clearing `sent` alone would not re-run it when `ids` keeps its identity. */
	const [resync, setResync] = useState(0);

	useEffect(
		() =>
			window.api?.appAttention?.onQueuedAskSessionsResync?.(() => {
				sent.current = null;
				setResync((value) => value + 1);
			}),
		[],
	);

	useEffect(() => {
		void resync;
		const key = ids.join("\u0000");
		if (sent.current === key) return;
		sent.current = key;
		window.api?.appAttention?.reportQueuedAskSessions?.(ids);
	}, [ids, resync]);
};
