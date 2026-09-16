import { useEffect, useMemo, useRef } from "react";
import { useBrowserProjection } from "../hooks/use-browser-chrome";
import {
	type ApprovalRequestInput,
	type ApprovalTabInput,
	useApprovalQueue,
} from "../model/approval-queue-model";
import {
	type ConversationBrowserSummary,
	summariseConversations,
} from "../model/tab-index-model";

/** No requests, as a stable value: a fresh `[]` per render would re-key every memo
 * that depends on it, which is the whole cost this hook exists to avoid. */
const NO_REQUESTS: readonly ApprovalRequestInput[] = [];
const NO_TABS: readonly ApprovalTabInput[] = [];

export interface ConversationBrowserSummaries {
	/** Per-conversation counts, keyed by session id. Entry-wise identity reuse: an
	 * unchanged conversation keeps its object across ticks. */
	summaries: ReadonlyMap<string, ConversationBrowserSummary>;
	/** The shared approval clock, so a caller that renders an expiry ("expires in
	 * 4 minutes") reads the same instant the tray does (design §3.2). */
	now: number;
}

/**
 * What the sidebar and the header need to know about conversations the browser is
 * working in, from the ONE projection both of them already read.
 *
 * WHY A HOOK RATHER THAN A MAP BUILT IN EACH COMPONENT (design R2): a per-consumer
 * projection is the default this codebase invites, and at sidebar scale it is the wrong
 * default — 40 rows subscribing and projecting per browser event is how a list this
 * dense starts to tick. One subscription, one map, and the rows that did not change keep
 * the same summary object.
 *
 * WHY IT TAKES THE PROJECTION EVEN WHEN THE BROWSER IS CLOSED: the counts are the ONLY
 * way a conversation says "an agent has a tab there, and something is waiting", and a
 * mark that only appears while the pane is open would be a mark for people already
 * looking at the browser. The subscription is cheap (one IPC fan-out the app already
 * has) and it is the same store the pane and the route read.
 *
 * `useApprovalQueue` IS HERE FOR THE CLOCK, not for its rows: the expiry rule is
 * "`expiresAt <= now`", and `now` has to be the app's single clock or a request would
 * read as live in the sidebar for a tick after the tray has dropped it. Passing the real
 * request list is what starts that clock when something is live.
 */
export function useConversationBrowserSummaries(): ConversationBrowserSummaries {
	const { state } = useBrowserProjection();
	const requests = state?.pendingConsent ?? NO_REQUESTS;
	const tabs = state?.tabs ?? NO_TABS;
	const { now } = useApprovalQueue(requests, NO_TABS);

	const previous = useRef<
		ReadonlyMap<string, ConversationBrowserSummary> | undefined
	>(undefined);
	const summaries = useMemo(
		() => summariseConversations(tabs, requests, now, previous.current),
		[tabs, requests, now],
	);
	// Written after the render that produced it, so the NEXT projection tick can reuse
	// the entries that did not change. A `useMemo` that wrote this inside itself would be
	// mutating during render, which React is allowed to run twice.
	useEffect(() => {
		previous.current = summaries;
	}, [summaries]);

	return { summaries, now };
}
