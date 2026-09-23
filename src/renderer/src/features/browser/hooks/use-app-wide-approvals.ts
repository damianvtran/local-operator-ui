import { useEffect } from "react";
import { useBrowserProjection } from "../hooks/use-browser-chrome";
import {
	type ApprovalRequestInput,
	liveApprovalCount,
	readApprovalClock,
	useApprovalClockValue,
} from "../model/approval-queue-model";

/** No requests, as a stable value: a fresh `[]` per render would re-key the clock
 * hook's effect on every tick (the same constant `useConversationBrowserSummaries`
 * keeps, for the same reason). */
const NO_REQUESTS: readonly ApprovalRequestInput[] = [];

/**
 * How many approvals the WHOLE APP is waiting on, for the rail's Browser badge.
 *
 * WHY THE RAIL NEEDS THIS ASK BACK (operator ask, 2026-09-23). `useConversationApprovals`
 * is scoped to the conversation on screen, which is the right rule for a badge in that
 * conversation's header and useless for a rail item that is on EVERY route: an agent in a
 * conversation the user is not looking at can be blocked on a prompt with nothing in the
 * chrome saying so. That capability was removed from the sidebar on 2026-09-18 with the
 * per-row mark ("it was the only surface reporting ANOTHER conversation's pending browser
 * approvals without opening the browser — the sidebar now reports nothing at all", recorded
 * in `docs/design/sidebar-conversation-browser.md`), and this restores it on the rail,
 * app-wide, rather than per row.
 *
 * WHY IT COUNTS UNATTRIBUTED REQUESTS, which is the one place it deliberately disagrees
 * with the per-conversation badge: this control's question is "is anything waiting on me",
 * and a live request the host could not attribute to a session is still a request. See
 * `liveApprovalCount` for the arithmetic and `summariseConversations` for why the
 * per-conversation map cannot answer this one.
 *
 * ONE PROJECTION AND THE CLOCK, WITH NO QUEUE MODEL (agent review round 1, F6):
 * `useBrowserProjection` is the window's single snapshot (`browser-projection-store.ts` —
 * a second subscription is a second thing to go stale) and `useApprovalClockValue` is the
 * shared interval the tray and the chips tick from, because liveness is derived rather
 * than published (nothing in main fires at expiry). This used to call `useApprovalQueue`
 * and take its `now`, which built `rows`/`waiting` and ran `reconcileResolved` on every
 * tick for state a rail badge never reads — on a component mounted on every route. The
 * clock is now a hook of its own and both consumers share it, which is what keeps this
 * from being a second clock.
 */
export function useAppWideApprovals(): number {
	const { state } = useBrowserProjection();
	const requests = state?.pendingConsent ?? NO_REQUESTS;
	const now = useApprovalClockValue((at) => liveApprovalCount(requests, at));
	/*
	 * A PROJECTION THAT LANDS IS A MOMENT TO RE-READ THE CLOCK (agent review round 2,
	 * F11). `useApprovalQueue` owns that re-read for every surface that reads a row, and
	 * extracting the clock (round 1, F6) took the rail out of that path: on a route where
	 * no queue-model consumer is mounted, the count was computed against a `now` up to a
	 * second old at the moment a refresh arrived — so a request that had already expired
	 * but is still in `pendingConsent` (nothing in main fires at expiry) counted for one
	 * tick where it should have read zero. Bounded and self-correcting, because the
	 * interval starts whenever anything is live; closed here because the fix is this call
	 * and not a second timer: `readApprovalClock` moves the ONE shared value and tells
	 * every subscriber, including this hook's own `setNow`.
	 */
	useEffect(() => {
		if (requests.length > 0) readApprovalClock();
	}, [requests]);
	return liveApprovalCount(requests, now);
}
