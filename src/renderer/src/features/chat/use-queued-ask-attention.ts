import {
	notificationsFrameRecord,
	sessionStatusTransitions,
} from "@shared/hooks/use-desktop-feed";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	nextQueuedAskReport,
	statusFrameMovesQueuedAskClaim,
} from "../../../../shared/app-attention-queued-asks";
import {
	FLEET_ASKS_QUERY_KEY,
	fleetAsksBySession,
	useFleetAsks,
} from "./fleet-asks";

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
 * reset (`onQueuedAskSessionsResync`). An UNREAD window (`counts === null`) says
 * nothing at all - the first thing a reload would otherwise say is `[]`, wiping a
 * claim main holds and would repair only on the next change (`nextQueuedAskReport`
 * carries the reasoning).
 *
 * FRESH ON THE EDGE, NOT ON A BACKGROUND POLL (round-1 M1). `useFleetAsks` polls
 * every 10 s and React Query pauses an interval refetch while the document is
 * hidden - deliberately, `fleet-asks.ts` says why - so with the window in the tray
 * a queued ask arriving would leave the dock saying "needs you" (the reported bug)
 * and an ask answered on a phone would leave a stale id masking a later blocking
 * question. The feed still delivers frames to a hidden renderer (Electron's
 * background throttling defers timers and rAF, not IPC delivery), and
 * `invalidateQueries` refetches active observers immediately with no visibility
 * gate (`@tanstack/query-core` refetches `refetchType ?? "active"`), so the frame
 * is the re-read and the poll keeps its costing rule.
 *
 * TWO DOORBELLS, BECAUSE ONE OF THEM RINGS INCOMPLETELY (round-2 M-A). A status
 * frame is the FAST doorbell, not a complete one: the harness publishes
 * `session_status` only when `status_dedupe_key` moves, so a queued ask added to a
 * conversation already sitting at `answer`/`approval` - or the last one leaving
 * while another pending item keeps it `answer` - sends no status frame at all, and
 * a hidden claim would keep missing, or keep masking, that conversation. The
 * `notifications` frame is the harness's own doorbell for the asks index
 * (`desktop_feed.py`'s `_maybe_emit_notifications`: the index is probed every
 * second and a frame is published on any identity move, a same-count replacement
 * included), and it is published AFTER the index write it reports, so a re-read
 * on it cannot see a pre-write index. It carries no ask identity, so every frame
 * is "the index may have moved" - at most one per probe tick. Both invalidate the
 * same key, one small index read per event; the status trigger stays because it
 * rings on the transition itself rather than within the next probe tick.
 *
 * THE INVARIANT: the claim main holds is the set the index held at the last event
 * that could have moved it - a status frame, a notifications frame, a poll, a
 * focus refetch, or main's own resync - so hiding the window cannot leave it
 * stale.
 */
export const useQueuedAskAttention = (): void => {
	const { rows } = useFleetAsks();
	const { client, provided } = useOptionalQueryClient();
	/** `null` is UNREAD (the route has not answered, or this backend predates
	 * it), never "nobody has a queued ask" - see `nextQueuedAskReport`. */
	const counts = useMemo(
		() => (rows === null ? null : fleetAsksBySession(rows)),
		[rows],
	);
	/** What main was last told, as the set's stable key; `null` before the first
	 * push and after a resync request. */
	const sent = useRef<string | null>(null);
	/** The ids main's claim holds: the set this window last reported. A status
	 * frame is judged against it to decide whether the claim may have moved. */
	const claimed = useRef<ReadonlySet<string>>(new Set());
	/** Counts main's requests so the push effect runs again for an UNCHANGED set:
	 * clearing `sent` alone would not re-run it when `counts` keeps its identity. */
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
		if (!provided) return;
		const invalidateClaim = () =>
			void client.invalidateQueries({ queryKey: FLEET_ASKS_QUERY_KEY });
		const stopStatus = sessionStatusTransitions.subscribe((transition) => {
			if (
				statusFrameMovesQueuedAskClaim(
					transition.sessionId,
					transition.code,
					claimed.current,
				)
			)
				invalidateClaim();
		});
		/* No filter: the frame names counts, not asks, so any of them may mean the
		 * index the claim derives from moved. */
		const stopNotifications =
			notificationsFrameRecord.subscribe(invalidateClaim);
		return () => {
			stopStatus();
			stopNotifications();
		};
	}, [client, provided]);

	useEffect(() => {
		void resync;
		const report = nextQueuedAskReport(counts, sent.current);
		if (!report) return;
		sent.current = report.key;
		claimed.current = new Set(report.ids);
		window.api?.appAttention?.reportQueuedAskSessions?.(report.ids);
	}, [counts, resync]);
};
