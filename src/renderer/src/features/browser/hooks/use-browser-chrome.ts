import { unwrapIpcErrorMessage } from "@shared/utils/ipc-error-message";
import { showErrorToast } from "@shared/utils/toast-manager";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	browserBridge as bridge,
	browserBridgeAvailable,
	clearBrowserProjectionReadError,
	refreshBrowserProjection,
	useBrowserProjectionStore,
} from "../model/browser-projection-store";
import type { CloseTabsIntent } from "../model/tab-index-model";

/**
 * The renderer's half of the browser feature: the projection main publishes and
 * the intents the chrome sends. Design: docs/design/ui-browser-tab.md 6 (the
 * controls), 6.3 (hand-over), 9 (consent), 11.2 (layout), 11.9 (a route now, a
 * panel later).
 *
 * WHY the renderer holds no truth about tabs: main owns the registry, and the
 * strip is a PROJECTION of `chromeState()` over IPC. Two registries that can
 * disagree is how a tab gets closed twice or a handle keeps naming a tab that is
 * gone, so this file sends intents and re-reads state; it never mutates a copy.
 *
 * WHY every action re-reads rather than patching locally: main's answer to an
 * intent is the truth — an agent `open` may have added a tab while the user was
 * typing, a close may have raced a navigation — and a locally patched list would
 * show the user a state main does not have.
 */

/** One tab, as the strip renders it. */
export interface BrowserTabView {
	tabId: number;
	title: string;
	url: string;
	/** Who created it. An AGENT tab is marked in the strip (design 11.8). */
	owner: "user" | "agent";
	/**
	 * The conversation this tab belongs to, or `null` when it belongs to none.
	 *
	 * One field answers both "created by" and "handed to" because it is the same
	 * field in the registry: an agent tab carries the session that created it and a
	 * handed-over user tab carries the session it was handed to
	 * (docs/design/browser-approval-ux.md 7.2). The pane's "This conversation"
	 * scope is this field compared to the pane's own session id, which is why the
	 * host had to project it (`host.ts`'s `chromeState`, and the note there on why
	 * the name travels and the nonce does not).
	 *
	 * `null` is not "unknown": it is a restored tab, a user tab never handed over,
	 * or one handed back — all of them the user's, not a conversation's, so they
	 * appear only under All tabs.
	 */
	sessionId: string | null;
	active: boolean;
	/** Restored from a previous run (design 7). Always user-owned. */
	restored: boolean;
	/** A user tab the user has handed to a session (design 6.3). */
	handedOver: boolean;
	/** This tab's last top-level navigation was refused by the network. Marked in
	 * the strip, because a background tab's blank page says nothing on its own. */
	failed: boolean;
	/** THIS tab is loading right now.
	 *
	 * Per tab rather than only for the active one, and it is what makes an agent's
	 * work legible at all: an agent tab is created non-active, only the active tab
	 * occupies the content rectangle, so the strip's spinner is the only signal a
	 * parked tab can give (docs/design/browser-approval-ux.md 8.1, 8.3). */
	loading: boolean;
}

/** A pending per-origin approval request (design 9.2). */
export interface PendingConsentView {
	entryId: string;
	origin: string;
	authority: string;
	/** The broad option the popup may offer, computed by the host. Absent means
	 * the domain option is not offered (no public-suffix data), and the bar omits
	 * it rather than offering something the host would refuse. */
	broad: { scope: "domain" | "host"; key: string } | null;
	expiresAt: number;
	/** The bare lop session id of whoever asked, or null when the requester is not a
	 * session identity. Resolved to a conversation title for display; never rendered
	 * raw on its own. See the host's `chromeState` for what travels and why. */
	requesterSessionId: string | null;
}

/**
 * Why the active tab's last navigation failed.
 *
 * The remote document cannot paint this: a refused main-frame load leaves
 * Chromium's own blank surface in the view, so without this the chrome shows an
 * empty rectangle that is indistinguishable from a successfully loaded empty page
 * (design round 1, D1).
 */
export interface LoadFailureView {
	code: number;
	description: string;
	url: string;
}

/** A decision still in force (design 9.3). */
export interface ApprovalView {
	origin: string;
	scope: "origin" | "domain" | "host" | "deny" | "session";
	grantedAt: number;
}

export interface BrowserChromeState {
	tabs: BrowserTabView[];
	activeTabId: number | null;
	url: string;
	title: string;
	loading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	pendingConsent: PendingConsentView[];
	approvals: ApprovalView[];
	/** The file-transfer surface (§16.4): what the host is writing now, where, and
	 * the last few decisions OF THIS TAB.
	 *
	 * WHY IT IS PART OF THIS PROJECTION rather than a channel of its own: it is
	 * chrome state the host owns, it changes for the same reason the tab list does
	 * (something happened in the browser), and `browser-projection-store.ts`'s rule
	 * is one event and one read rather than two projections that can disagree. The
	 * renderer never computes any of it: `dir` is the path MAIN opened, and the
	 * notes are main's decisions.
	 *
	 * WHY IT CARRIES BOTH DIRECTIONS AND IS SCOPED TO THE ACTIVE TAB (review round
	 * 1, D2 and U3): the host used to project the whole host's notes into every
	 * tab's chrome, so the strip of the tab the user was watching could narrate a
	 * decision taken in another one — which the published frames did. An upload now
	 * has a note here too, because the round-1 walk showed three files leaving the
	 * machine with nothing on screen at all.
	 *
	 * Optional because a host that predates the feature answers without it — the row
	 * then simply never renders, which is the honest degrade for a build that cannot
	 * transfer anything. */
	transfers?: TransferActivityView;
	/** Null while the active tab's last navigation succeeded, is still loading, or
	 * has no document yet. */
	navFailure: LoadFailureView | null;
}

/** One transfer decision, as the host reports it.
 *
 * IT CARRIES A DIRECTION AND A RULE (review round 1, D1, D2, U3): the direction is
 * what stops one strip's copy from being readable as a statement about the other
 * verb, and the rule plus its numbers is what lets the row write a HUMAN sentence —
 * the host's `reason` is written for the tool result, where exact byte counts are
 * the right thing and two of them one apart are unreadable. */
export interface TransferNoteView {
	name: string;
	/** How many files this decision covered (an upload call attaches several). */
	count: number;
	/** Where a download went. "" for an upload. */
	dir: string;
	outcome: "saved" | "refused" | "sent";
	/** The tool result's own sentence. The row does not print it (see the row's
	 * header); it is here so a debugging renderer or a test can compare the two. */
	reason: string;
	at: number;
	direction: "download" | "upload";
	/** The site an upload went to. */
	site: string;
	/** The tab whose decision this was. The row renders the decision either way and
	 * LABELS it when it belongs to another tab (see `TransferActivityView`). */
	tabId: number;
	/** Which rule refused it, and the numbers the row's sentence needs. */
	refusal: TransferRefusalView | null;
}

/** The rule a refusal came from, and its own units. */
export interface TransferRefusalView {
	rule: "executable" | "limit" | "count" | "write" | "interrupted" | "deadline";
	/** The file's own size in bytes, 0 where unknown. */
	bytes: number;
	/** The cap that fired: bytes for `limit`, files for `count`, seconds for
	 * `deadline`. */
	limit: number;
}

/** The transfer in flight, with the progress the row needs (U6). `total` is 0 for
 * a response that declared no length. */
export interface ActiveTransferView {
	name: string;
	received: number;
	total: number;
	/** The tab it belongs to, so a row beside another tab can say so. */
	tabId: number;
}

/** What the transfer row renders: the transfer in flight, the folder the host
 * writes into, the last few decisions newest-first, and WHICH TAB's chrome this
 * is.
 *
 * `notes` are host-wide and each carries its `tabId` (review round 1, D2). Filtering
 * them to the active tab was this change's first attempt and it broke the case the
 * feature exists for — an agent tab is created INACTIVE (`tabs.ts`), so the agent's
 * own downloads would have left no trace at all. What the row must not do is appear
 * to describe the page on screen, which is what `activeTabId` is for. */
export interface TransferActivityView {
	active: ActiveTransferView | null;
	dir: string | null;
	notes: TransferNoteView[];
	activeTabId: number | null;
}

export type ConsentDecision = "once" | "session" | "site" | "domain" | "deny";

/** The content rectangle main applies to the active view, in CSS pixels. */
export interface ContentRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** What the preload exposes. Absent outside Electron (Storybook, the unit tests).
 * The accessor itself lives in `browser-projection-store.ts`, next to the one
 * subscription that uses it, so there is exactly one answer to "is the browser
 * available" — this module keeps the name its callers already read. */
export { browserBridgeAvailable };

/**
 * Send one rectangle to main, unconditionally and without waiting.
 *
 * Extracted so the two call sites that must NOT go through the frame scheduler
 * (a null rect, and the unmount) can share one implementation of "deliver it".
 * A delivery that fails is corrected by the next report; reporting it in the band
 * would put a message there for a transient during a drag.
 */
function deliverContentRect(rect: ContentRect | null): void {
	void bridge()
		?.setContentRect(rect)
		.catch(() => {});
}

export interface BrowserChrome {
	/** The projection main publishes: the tab strip, the URL bar and the pending
	 * requests all render from this ONE read (see `useBrowserProjection`). */
	state: BrowserChromeState | null;
	/**
	 * Where the user asked to go, while the tab has not committed it.
	 *
	 * STATE rather than a ref inside the URL bar, because the placeholder that
	 * publishes it has to appear in the same render as the loading state — a ref
	 * mutated during the keydown handler is invisible to that render, which the proof
	 * run measured as a loading frame with an empty placeholder. Cleared as soon as
	 * the tab has a real URL, which is what makes it a statement about a PENDING
	 * navigation rather than a copy of the bar.
	 */
	pendingUrl: string | null;
	/** An action refusal or a failed state read, whichever is newest. Shown in the
	 * band, not as a toast per keystroke. */
	error: string | null;
	/** Clear it by hand. The only way an action refusal goes away other than a
	 * later action succeeding. */
	dismissError: () => void;
	available: boolean;
	refresh: () => Promise<void>;
	/**
	 * Open a tab, attributed to a conversation when the host has one (design R1).
	 *
	 * THE ARGUMENT AND NOT HOOK STATE, deliberately: the attribution target is the
	 * HOST's conversation, so it is the host that knows it and there is one call site
	 * per control. A hook that read a session id from state would need a second place
	 * to decide which conversation a tab belongs to, which is the one thing this
	 * change's design forbids.
	 *
	 * `null` is a real and common argument: the route, and the pane on a draft, open
	 * tabs that belong to no conversation. It means the same thing to main as an
	 * absent argument — an unattributed, user-owned tab.
	 */
	newTab: (sessionId?: string | null) => Promise<void>;
	closeTab: (tabId: number) => Promise<boolean>;
	/**
	 * Close several tabs as ONE intent (design R5).
	 *
	 * WHY THE INTENT TRAVELS WHOLE rather than as a list of ids: "close all tabs in this
	 * conversation" has to be resolved in MAIN, at execution time. The band stays open
	 * while the user reads it, so a list this side computed seconds ago can miss a tab an
	 * agent opened in that conversation in the meantime — and the user pressed something
	 * that said all. Main also skips ids that are already gone, so a double press closes
	 * the rest rather than failing the batch.
	 *
	 * THE RETURN IS THE OUTCOME, and only the strip's caret restore reads it (review
	 * round 2, A-2): `false` means the invoke was refused. A refusal is the one close
	 * result the caller cannot infer from the projection, because the re-read that
	 * follows it still shows every tab — the same picture as a close that has not landed
	 * yet, which is what left the strip waiting for a projection that could never come.
	 * It is the fact, not the message: the message is `error`'s job.
	 */
	closeTabs: (intent: CloseTabsIntent) => Promise<boolean>;
	activateTab: (tabId: number) => Promise<void>;
	navigate: (url: string) => Promise<void>;
	reload: () => Promise<void>;
	stop: () => Promise<void>;
	history: (direction: "back" | "forward") => Promise<void>;
	setContentRect: (rect: ContentRect | null) => void;
	setViewVisible: (visible: boolean) => void;
	respondToConsent: (
		entryId: string,
		decision: ConsentDecision,
	) => Promise<void>;
	handOver: (tabId: number, sessionId: string) => Promise<void>;
	revokeHandOver: (tabId: number) => Promise<void>;
	revokeApproval: (origin: string) => Promise<void>;
	revokeAllApprovals: () => Promise<void>;
	forgetSite: (origin: string) => Promise<void>;
	clearData: (what: "cookies" | "cache" | "everything") => Promise<void>;
	/**
	 * Open the host's download directory in the OS file manager (§16.4).
	 *
	 * A HUMAN ACTION BY CONSTRUCTION, and this is the design's line rather than a
	 * UI preference: §11.4 forbids "reveal in Finder" FROM THE TOOL, so the agent has
	 * no route to this — it is a button the user presses, and the path it opens is
	 * the one main chose, never one this side named.
	 *
	 * IT REPORTS ITS OWN FAILURE (review round 1, U4): `shell.openPath` RETURNS its
	 * error rather than throwing, so the earlier `runVoid` discarded it and a press
	 * that opened nothing looked exactly like one that worked — the same defect
	 * `link-open.ts` exists to prevent one hop over. Main answers `{opened, message}`
	 * and the message is what a toast has to say.
	 */
	revealDownloads: () => Promise<void>;
}

export interface BrowserProjection {
	/** The projection itself, or `null` before the first read lands. */
	state: BrowserChromeState | null;
	/**
	 * A state read failed: main could not answer, or answered something unusable.
	 * Separate from the action error, for the reason `error` states.
	 */
	readError: string | null;
	/**
	 * Re-read the projection.
	 *
	 * Returns the state it read as well as setting it, because a caller's own
	 * consequence of a read — `useBrowserChrome`'s pending-URL note — needs the value
	 * the read produced rather than the state React is about to render. `null`
	 * when the bridge is absent or the read failed, which are the two ways there is
	 * no new state to act on.
	 */
	refresh: () => Promise<BrowserChromeState | null>;
	/**
	 * Clear a read failure by hand.
	 *
	 * It exists because the two error slots are cleared by different events and the
	 * dismiss control clears BOTH: a successful read clears only `readError`, and
	 * `useBrowserChrome`'s `dismissError` is the user saying "I have read this" about
	 * whichever of the two is showing. Exposing the setter rather than re-exporting the
	 * state is what keeps the read's own lifecycle inside the hook that owns it.
	 */
	clearReadError: () => void;
}

/**
 * The projection, subscribed — the READ half of the browser chrome, split out so a
 * second reader can have the same source rather than a second way of getting it.
 *
 * WHY THIS IS SEPARATE, and the reason is PR 2's rather than a tidy-up: the chat
 * header's Globe trigger carries an attention badge counting THIS conversation's
 * live requests (`docs/design/browser-approval-ux.md` 7.3), and that control is
 * mounted whether or not the pane is. It needs the projection and none of the
 * twenty intents `useBrowserChrome` returns, so mounting the whole chrome in the
 * header would put every tab control in a header that has one badge and no tab
 * strip. A hand-written second subscription — its own `api.state()`, its own two
 * event handlers — is the drift this repository refuses everywhere else, so the
 * read lives in `browser-projection-store.ts` once and every reader, including
 * `useBrowserChrome`, selects from it.
 *
 * WHAT CHANGED, and why it had to (design 1.5): this used to own a `useState`
 * pair, an initial read and two `ipcRenderer.on` subscriptions PER CALL. Two
 * consumers made that correct; a mark on every conversation row turns it into
 * forty subscriptions and forty full `/browser-state` reads per event. The store
 * is now the only subscriber — `useSyncExternalStore` subscribes once per mounted
 * consumer and the store refcounts them onto one bridge subscription — and THIS
 * function is the three-line selector that keeps its callers' contract unchanged.
 */
export function useBrowserProjection(): BrowserProjection {
	const { state, readError } = useBrowserProjectionStore();
	return {
		state,
		readError,
		refresh: refreshBrowserProjection,
		clearReadError: clearBrowserProjectionReadError,
	};
}

export function useBrowserChrome(): BrowserChrome {
	const {
		state,
		readError,
		refresh: readState,
		clearReadError,
	} = useBrowserProjection();
	/** An ACTION was refused: `nav_failed`, `tab_limit`, `origin_not_allowed`... */
	const [actionError, setActionError] = useState<string | null>(null);
	const [pendingUrl, setPendingUrl] = useState<string | null>(null);
	const available = browserBridgeAvailable();

	/**
	 * The one error the band renders, and WHY THERE ARE TWO SLOTS BEHIND IT.
	 *
	 * An action failure and a state-fetch failure are different facts with
	 * different lifetimes, and a single slot let the second erase the first: every
	 * action re-reads the projection, so a refused navigation, a failed hand-over
	 * or a `tab_limit` was cleared by the successful state read that followed it a
	 * few milliseconds later. The user saw a dead button rather than the refusal
	 * the feature promises (review round 1, R6).
	 *
	 * So a successful READ clears only `readError`, and `actionError` is cleared
	 * only by a successful ACTION or by the user dismissing it. That is the whole
	 * rule, and it is why `run` no longer funnels both through one setter.
	 */
	const error = actionError ?? readError;

	/**
	 * The projection, read the one way, plus this hook's own consequence of a read:
	 * the tab has a URL of its own now, so the pending note's job is done.
	 *
	 * That is why the read's VALUE is used rather than the `state` React is about to
	 * render — the note is about the read that just landed, not about the render it
	 * triggers.
	 */
	const refresh = useCallback(async (): Promise<void> => {
		const next = await readState();
		if (next?.url && next.url !== "about:blank") setPendingUrl(null);
	}, [readState]);

	/**
	 * Run one intent, then re-read, and report whether main ACCEPTED the invoke.
	 *
	 * Failures are reported in the band rather than swallowed: several of these
	 * refusals are the intended behaviour (a `nav_failed` for a non-http URL, a
	 * `tab_limit` on the ninth agent tab), so a silent failure would look like a
	 * dead button.
	 *
	 * The `await refresh()` is deliberately AFTER the error is recorded and cannot
	 * clear it - see the two error slots above. Reading the projection is how the
	 * band learns what main did; it is not an answer to what the action was told.
	 *
	 * THE RETURNED OUTCOME IS THAT SAME DISTINCTION, for the one caller that has to
	 * act on it instead of reading it: the strip's caret restore has to know that a
	 * close was refused, because a refusal and a close still in flight look identical
	 * in the projection (review round 2, A-2). `false` is `action` rejecting; nothing
	 * else here reports it, and the band's own message is unchanged.
	 */
	const run = useCallback(
		async (action: () => Promise<unknown> | undefined): Promise<boolean> => {
			let accepted = true;
			try {
				await action();
				setActionError(null);
			} catch (caught) {
				accepted = false;
				setActionError(unwrapIpcErrorMessage(caught));
			}
			await refresh();
			return accepted;
		},
		[refresh],
	);

	/** `run`, for every call site that does not ask what the invoke answered. */
	const runVoid = useCallback(
		(action: () => Promise<unknown> | undefined): Promise<void> =>
			run(action).then(() => undefined),
		[run],
	);

	/** Clear the band's error. The one explicit dismissal, so a refusal the user
	 * has read does not sit there until something else happens to succeed. */
	const dismissError = useCallback((): void => {
		setActionError(null);
		clearReadError();
	}, [clearReadError]);

	// ---- the rectangle, and the ONE update that must not be throttled --------
	//
	// The throttle exists because a live window resize fires far faster than a
	// native view can be repositioned, and an unthrottled `setBounds` storm is
	// visible as tearing (design 11.2).
	//
	// A NULL RECT IS NOT A RESIZE SAMPLE. It is the lifecycle invalidation that
	// takes the native view off the screen when the browser route unmounts (design
	// 11.3): nothing is left that knows where the view belongs, and main treats a
	// null rect as "nowhere to paint". Throttling it through a frame is a
	// correctness bug with a visual consequence, not a missed tick - the pending
	// frame is cancelled by this hook's own unmount cleanup, so the null update was
	// dropped and the native view stayed over the chat (review round 1, R4).
	//
	// So null bypasses the scheduler and is sent on the spot, and it also cancels
	// any pending non-null frame - which would otherwise be applied AFTER the hide
	// and put the view back up on a route that no longer exists.
	const frame = useRef<number | null>(null);
	const pendingRect = useRef<ContentRect | null>(null);

	const setContentRect = useCallback((rect: ContentRect | null) => {
		if (rect === null) {
			if (frame.current !== null) {
				cancelAnimationFrame(frame.current);
				frame.current = null;
			}
			pendingRect.current = null;
			deliverContentRect(null);
			return;
		}
		pendingRect.current = rect;
		if (frame.current !== null) return;
		frame.current = requestAnimationFrame(() => {
			frame.current = null;
			deliverContentRect(pendingRect.current);
		});
	}, []);

	// The hook's own terminal guarantee: whatever the caller's own cleanup order
	// is, this mount's last word about the rectangle is the hide. It is idempotent
	// on main's side (`setContentRect(null)` hides a view that is already hidden),
	// which is what makes it safe to send even when the caller already reported it.
	useEffect(
		() => () => {
			if (frame.current !== null) cancelAnimationFrame(frame.current);
			deliverContentRect(null);
		},
		[],
	);

	/**
	 * Show or hide the native view.
	 *
	 * A `useCallback` rather than an inline arrow inside the returned object,
	 * because the browser page drives this from an effect: an identity that
	 * changed every render would re-run the layout effect on every state update,
	 * and the cleanup would hide the view once per change — a flicker rather than
	 * a policy.
	 */
	const setViewVisible = useCallback((visible: boolean) => {
		void bridge()
			?.setViewVisible(visible)
			.catch(() => {
				// Losing a visibility update corrects itself on the next policy change;
				// surfacing it would put a message in the band for a race the user cannot
				// act on.
			});
	}, []);

	const api = bridge();
	return useMemo<BrowserChrome>(
		() => ({
			state,
			pendingUrl,
			error,
			dismissError,
			available,
			refresh,
			newTab: (sessionId) => runVoid(() => api?.newTab(sessionId ?? null)),
			closeTab: (tabId) => run(() => api?.closeTab(tabId)),
			closeTabs: (intent) => run(() => api?.closeTabs(intent)),
			activateTab: (tabId) => runVoid(() => api?.activateTab(tabId)),
			navigate: (url) => {
				// Recorded before the intent is sent: the reply may take a while (the tab
				// has to load), and the point of the note is to cover exactly that window.
				setPendingUrl(url);
				return runVoid(() => api?.navigate(url));
			},
			reload: () => runVoid(() => api?.reload()),
			stop: () => runVoid(() => api?.stop()),
			history: (direction) => runVoid(() => api?.history(direction)),
			setContentRect,
			setViewVisible,
			respondToConsent: (entryId, decision) =>
				runVoid(() => api?.respondToConsent(entryId, decision)),
			handOver: (tabId, sessionId) =>
				runVoid(() => api?.handOver(tabId, sessionId)),
			revokeHandOver: (tabId) => runVoid(() => api?.revokeHandOver(tabId)),
			revokeApproval: (origin) => runVoid(() => api?.revokeApproval(origin)),
			revokeAllApprovals: () => runVoid(() => api?.revokeAllApprovals()),
			forgetSite: (origin) => runVoid(() => api?.forgetSite(origin)),
			clearData: (what) => runVoid(() => api?.clearData(what)),
			revealDownloads: () =>
				runVoid(async () => {
					const answer = await api?.revealDownloads();
					// Main answers `{opened, message}`: `shell.openPath` returns its failure as a
					// string rather than throwing, so a discarded answer is how a press that
					// opened nothing came to look like one that worked (review round 1, U4).
					const message = (answer as { message?: unknown } | undefined)
						?.message;
					if (typeof message === "string" && message) {
						showErrorToast(`Could not open the downloads folder. ${message}`);
					}
				}),
		}),
		[
			state,
			pendingUrl,
			error,
			dismissError,
			available,
			refresh,
			run,
			runVoid,
			setContentRect,
			setViewVisible,
			api,
		],
	);
}

/** The prefix Electron adds to an `ipcRenderer.invoke` rejection, and the unwrap
 * itself, live in `@shared/utils/ipc-error-message` now: the update surfaces
 * unwrap the same envelope for the same reason, and two spellings of one rule
 * is how the two answers drift apart. */
