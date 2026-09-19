import { useEffect, useMemo, useRef } from "react";
import {
	browserBridgeAvailable,
	useBrowserProjection,
} from "../hooks/use-browser-chrome";
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
	/**
	 * Per-conversation counts, keyed by session id. Entry-wise identity reuse: an
	 * unchanged conversation keeps its object across ticks.
	 *
	 * `undefined` MEANS THE BROWSER DOES NOT EXIST HERE (Storybook, a renderer outside
	 * Electron), and that is the rule ruling 5(a) states: no bridge means no projection
	 * means no summary. It is deliberately NOT an empty map — an empty map means "every
	 * conversation has nothing open", which is a different fact from "this surface has no
	 * browser at all". The two only happen to be the same NUMBER for today's one
	 * consumer (`useConversationApprovals`, where an absent map and an empty one both
	 * read zero); the contract is the hook's, and the sidebar's per-row mark — the
	 * consumer that needed the difference, because an empty map put forty inert
	 * controls on rows in a surface with no browser at all — is gone (operator ask,
	 * 2026-09-18).
	 */
	summaries: ReadonlyMap<string, ConversationBrowserSummary> | undefined;
	/** The shared approval clock, so a caller that renders an expiry ("expires in
	 * 4 minutes") reads the same instant the tray does (design §3.2). */
	now: number;
}

/**
 * What the chat header needs to know about conversations the browser is working
 * in, from the ONE projection the pane and the route already read.
 *
 * THE SIDEBAR WAS THE SECOND CONSUMER UNTIL THIS CHANGE (operator ask, 2026-09-18):
 * the per-row browser mark read this map, and deleting the mark leaves
 * `useConversationApprovals` as the one reader. The hook stays — the badge's count is
 * still this projection's, and a second implementation of it is what the paragraph
 * below exists to prevent — and the scale argument it was written for is kept because
 * it is why the projection is shared rather than rebuilt per consumer.
 *
 * WHY A HOOK RATHER THAN A MAP BUILT IN EACH COMPONENT (design R2): a per-consumer
 * projection is the default this codebase invites, and at sidebar scale it is the wrong
 * default — 40 rows subscribing and projecting per browser event is how a list this
 * dense starts to tick. One subscription, one map, and the entries that did not change
 * keep the same summary object.
 *
 * WHY IT TAKES THE PROJECTION EVEN WHEN THE BROWSER IS CLOSED: the counts are the ONLY
 * way a conversation says "an agent has a tab there, and something is waiting", and the
 * badge has to exist while the pane does not — a count that only appeared while the
 * pane was open would be a count for people already looking at the browser. The
 * subscription is cheap (one IPC fan-out the app already has) and it is the same store
 * the pane and the route read.
 *
 * `useApprovalQueue` IS HERE FOR THE CLOCK, not for its rows: the expiry rule is
 * "`expiresAt <= now`", and `now` has to be the app's single clock or a request would
 * read as live for a tick after the tray has dropped it. Passing the real request list
 * is what starts that clock when something is live.
 */
export function useConversationBrowserSummaries(): ConversationBrowserSummaries {
	const { state } = useBrowserProjection();
	const available = browserBridgeAvailable();
	const requests = state?.pendingConsent ?? NO_REQUESTS;
	const tabs = state?.tabs ?? NO_TABS;
	const { now } = useApprovalQueue(requests, NO_TABS);

	const previous = useRef<
		ReadonlyMap<string, ConversationBrowserSummary> | undefined
	>(undefined);
	const summaries = useMemo(
		() =>
			available
				? summariseConversations(tabs, requests, now, previous.current)
				: undefined,
		[tabs, requests, now, available],
	);
	// Written after the render that produced it, so the NEXT projection tick can reuse
	// the entries that did not change. A `useMemo` that wrote this inside itself would be
	// mutating during render, which React is allowed to run twice.
	useEffect(() => {
		previous.current = summaries;
	}, [summaries]);
	return { summaries, now };
}
