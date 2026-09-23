import { useBrowserProjection } from "../hooks/use-browser-chrome";
import {
	type ApprovalRequestInput,
	type ApprovalTabInput,
	liveApprovalCount,
	useApprovalQueue,
} from "../model/approval-queue-model";

/** No requests, as a stable value: a fresh `[]` per render would re-key the queue
 * model's effect on every tick (the same constant `useConversationBrowserSummaries`
 * keeps, for the same reason) — and no tabs, because this hook wants the clock and
 * not a queue: a rail badge reads no row, so there is nothing to resolve or number. */
const NO_REQUESTS: readonly ApprovalRequestInput[] = [];
const NO_TABS: readonly ApprovalTabInput[] = [];

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
 * ONE PROJECTION, ONE CLOCK, the same pair the header's badge reads: `useBrowserProjection`
 * is the window's single snapshot (`browser-projection-store.ts` — a second subscription is
 * a second thing to go stale), and `useApprovalQueue` is here for its `now`, on the same
 * shared interval the tray and the chips tick from, because liveness is derived rather than
 * published (nothing in main fires at expiry).
 */
export function useAppWideApprovals(): number {
	const { state } = useBrowserProjection();
	const requests = state?.pendingConsent ?? NO_REQUESTS;
	const { now } = useApprovalQueue(requests, NO_TABS);
	return liveApprovalCount(requests, now);
}
