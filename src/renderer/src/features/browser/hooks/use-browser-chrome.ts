import { t } from "@shared/i18n";
import { unwrapIpcErrorMessage } from "@shared/utils/ipc-error-message";
import { showErrorToast } from "@shared/utils/toast-manager";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	AddressHistoryRequest,
	AddressHistoryResponse,
} from "../../../../../shared/browser-address-history";
import type { BrowserAvailability } from "../../../../../shared/browser-availability";
import type { HumanTabActionOutcome } from "../../../../../shared/browser-tab-action";
import {
	browserBridge as bridge,
	browserBridgeAvailable,
	clearBrowserProjectionReadError,
	refreshBrowserProjection,
	useBrowserProjectionStore,
} from "../model/browser-projection-store";
import {
	type CloseTabsIntent,
	mergeChromeTabOrder,
} from "../model/tab-index-model";

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
	displayOrder?: number;
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
	/** THIS tab is producing sound right now, and whether the user has
	 * muted it. Per tab for the same reason as `loading`: a background tab
	 * making sound is legible (and silenceable) only from the strip.
	 * Projected by main from `tab-audio.ts`; the renderer never reads a
	 * page's media state itself. */
	audible: boolean;
	muted: boolean;
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
	/** S4b: which list presenter the product chrome has. `suspend` is Tier 1 —
	 * the field works, the native list does not. Absent on a pre-S4b main. */
	addressOverlay?: { mode: "popout" | "suspend"; reason: string | null };
	/** S6b: the native approvals card. Absent on a launch without the opt-in, in
	 * which case the shield keeps using the DOM dock. */
	approvalsCard?: { available: boolean; open: boolean };
	pageControls?: {
		find: {
			tabId: number;
			query: string;
			ordinal: number;
			matches: number;
			pending: boolean;
			unreported: boolean;
		} | null;
		zoom: number;
		zoomAllowed: boolean;
		notice: string | null;
	};
	availability?: BrowserAvailability;
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
	/** Who owned the tab this decision was taken on, as the HOST recorded it (review
	 * round 2, U10). The renderer resolves the tab's live record when it has one, and
	 * falls back to this when it does not: a tab can be CLOSED while its note is
	 * still on screen, and the marker must not then name a tab that is gone. `null`
	 * is "the host could not say", which renders the generic fallback rather than a
	 * guess. */
	ownerKind: "user" | "agent" | null;
}

/** The rule a refusal came from, and its own units. */
export interface TransferRefusalView {
	rule:
		| "executable"
		| "limit"
		| "count"
		| "write"
		| "interrupted"
		| "deadline"
		// The runtime cap: a write that was already on disk when it was cancelled, so
		// the row says the partial was discarded rather than that nothing was saved
		// (review round 2, R2-5).
		| "overrun";
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
	/** The newest file saved into the download directory, and how many have been saved
	 * in this app run, for the durable control's own label (review round 2, U12: once
	 * the row has retired, the folder control is the only thing on screen that knows
	 * anything arrived). */
	recent: { name: string; count: number } | null;
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
	lastDeliveredRect = rect;
	void bridge()
		?.setContentRect(rect)
		.catch(() => {});
}

/**
 * The last rectangle this renderer actually SENT main, for S2's projection echo.
 *
 * Main refuses a projection whose `pageRect` does not equal the layout it applied,
 * so the mirror must echo the same value the page reporter sent rather than
 * measuring the content element a second time: two measurements can disagree by a
 * frame during a resize, and that disagreement would read as a stale layout. A
 * reader after an unmount sees null, which is exactly "nowhere to paint".
 */
let lastDeliveredRect: ContentRect | null = null;

export function lastDeliveredContentRect(): ContentRect | null {
	return lastDeliveredRect === null ? null : { ...lastDeliveredRect };
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
	 *
	 * IT IS ALSO THE START PAGE'S OWN LIFETIME (LOH-13 B). The surface hides the
	 * native view while the active tab is on its start state, and a PENDING note for
	 * THIS tab is what says "the user has chosen a destination, so do not paint the
	 * start page over it" — which is what stops the start page lingering across the
	 * window between an accepted submit and main's own `loading` push (F4, round 3).
	 *
	 * IT IS KEYED TO THE TAB THAT MADE THE ATTEMPT (F3, round 3 re-adding what round
	 * 2 got right for `pendingUrl` then lost in `refusedUrl`). A bare string leaked
	 * across tabs: refuse an address on one tab, open a fresh one, and the new tab's
	 * field was seeded with the other tab's address. So the note carries its `tabId`,
	 * and every reader compares it to the ACTIVE tab — a fresh tab reads null and
	 * starts empty, while the tab that made the attempt still restores its own.
	 */
	pendingUrl: string | null;
	/**
	 * The address of the last `navigate` that was REFUSED, or null.
	 *
	 * WHY A SECOND FIELD RATHER THAN THE NOTE'S OWN VALUE. A refused navigate — an
	 * IPC rejection of a blank url, or main's `nav_failed` for an unparseable or
	 * non-http(s) address — must both (a) stop suppressing the native view, so the
	 * start page comes back with a surface to retry from, and (b) hand the user's
	 * typed address BACK, because the start field's draft is mount-local and dies on
	 * submit. `pendingUrl` is cleared for (a) — its whole meaning is "a page is on its
	 * way", which is false the moment the invoke is refused — so the value has to
	 * survive somewhere for (b), and this is that somewhere.
	 *
	 * Non-null therefore means "a navigation was attempted for THIS tab and nothing
	 * started loading", and the string is what was attempted. It is cleared by the
	 * next accepted navigate and by the next landed read, and it is keyed to the tab
	 * that made the attempt for the same reason `pendingUrl` is (F3, round 3).
	 */
	refusedUrl: string | null;
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
	reorderTabs: (ids: number[]) => Promise<void>;
	actOnTab: (
		tabId: number,
		action: "duplicate" | "reload" | "mute" | "unmute",
	) => Promise<HumanTabActionOutcome | undefined>;
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
	/** `expectedTabId` is the tab the address draft belongs to. Main refuses the
	 * navigation when that is no longer the active tab, so a commit that raced a
	 * tab switch cannot load the new tab with the old draft. */
	navigate: (url: string, expectedTabId?: number) => Promise<void>;
	/** Local address suggestions: the persistent history store plus this host's
	 * live tab stacks, ranked in main. A failure here is not a navigation failure:
	 * the field degrades to plain URL editing and `use-address-autocomplete`
	 * reports its own state. */
	addressHistory: (
		request: AddressHistoryRequest,
	) => Promise<AddressHistoryResponse>;
	/** Main's projection invalidations, unrefcounted here: the address field is one
	 * reader and it subscribes only while focused. Returns the unsubscribe. */
	onStateChanged: (callback: () => void) => () => void;
	/** Home: return the active tab to the browser's start state. No URL
	 * travels with it — main owns what the start state is (LOH-13). */
	home: () => Promise<void>;
	reload: (hard?: boolean) => Promise<void>;
	pageControl: (
		tabId: number,
		action: "open" | "close" | "search" | "print" | "in" | "out" | "reset",
		query?: string,
		forward?: boolean,
		next?: boolean,
	) => Promise<void>;
	reopenTab: (sessionId?: string | null) => Promise<void>;
	stop: () => Promise<void>;
	/** Ask the host to start again after an exhausted startup (round 1, D1a).
	 * The recovery half of the `unavailable` state, which otherwise leaves the
	 * user with no in-product way forward. */
	retry: () => Promise<void>;
	history: (direction: "back" | "forward") => Promise<void>;
	setContentRect: (rect: ContentRect | null) => void;
	/** Hide/show the native view. `ownPage` names WHY it is hidden when it is: the
	 * renderer is painting one of the browser's own state pages (start page,
	 * load failure) rather than an overlay covering the content area. Main keeps
	 * shortcut ownership for the first and refuses it for the second; see
	 * `browser-surface.tsx` and `registry.ts:chromeVisible`. */
	setViewVisible: (
		visible: boolean,
		ownPage?: boolean,
		ownStatePage?: boolean,
	) => void;
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
	/**
	 * The pending-navigation note, KEYED TO THE TAB THAT MADE THE ATTEMPT (F3, round
	 * 3). A bare string leaked across tabs — refuse an address on one tab, open a
	 * fresh one, and the new tab's field offered the other tab's address — which is
	 * the same cross-tab class round 1 removed from the view gate. The key is the
	 * `tabId` at the moment the intent was sent; the exposed `pendingUrl` compares it
	 * to the ACTIVE tab, so a fresh tab reads null while the tab that made the
	 * attempt keeps its own note.
	 */
	const [pending, setPending] = useState<{
		tabId: number | null;
		url: string;
	} | null>(null);
	/** See `BrowserChrome.refusedUrl`: the attempt whose invoke was refused, held so
	 * the start page can restore the address the user typed (F1, round 2). Keyed to
	 * its tab for the same reason `pending` is (F3, round 3). */
	const [refused, setRefused] = useState<{
		tabId: number | null;
		url: string;
	} | null>(null);
	/**
	 * THE TWO NOTES AS THE ACTIVE TAB SEES THEM. This is where the per-tab keying
	 * becomes an ANSWER rather than an internal detail: a note whose `tabId` is not
	 * the active tab is invisible here, so the surface's gate and the start page's
	 * restored address are both about the tab on screen. Switching tabs therefore
	 * shows each tab's own truth with no clearing bookkeeping, and a fresh tab reads
	 * null on both — which is what makes it start empty.
	 */
	const activeTabId = state?.activeTabId ?? null;
	const pendingUrl =
		pending && pending.tabId === activeTabId ? pending.url : null;
	const refusedUrl =
		refused && refused.tabId === activeTabId ? refused.url : null;
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
		if (!next) return;
		// WHICH TAB THE READ IS ABOUT, so a landing on tab B does not discard tab A's
		// note (F3, round 3): the clears below are keyed to the tab the read describes,
		// not applied wholesale.
		const readTabId = next.activeTabId ?? null;
		/*
		 * A LANDED PAGE ENDS THE NOTE FOR THE TAB IT LANDED IN. This is the first of
		 * the two ways a note ends; it is keyed because a wholesale clear would take a
		 * refused address off a tab that is not the one that just loaded.
		 *
		 * WHY THE START-STATE READ DOES *NOT* RELEASE THE NOTE, which is the round-3
		 * correction (F4) and the reason the round-2 version of this function is gone.
		 * Round 2 released the note whenever a read showed the start state with nothing
		 * in flight, to stop it outliving a refused attempt. But an ACCEPTED navigate
		 * looks identical on the next read — main has not pushed `did-start-loading`
		 * yet, so the projection still says `about:blank` and `loading:false` — so that
		 * release cleared the note a millisecond after a legitimate submit and the
		 * start page lingered over the navigation the user had just launched (F4).
		 *
		 * The refusal case it existed for is now handled where it is actually KNOWN —
		 * in `navigate` below, on the invoke's own rejection — and an attempt the user
		 * abandons is handled by the explicit controls (`home`, `stop`). Those are
		 * facts, not inferences from a read that cannot yet tell the two apart.
		 */
		if (next.url && next.url !== "about:blank") {
			setPending((current) =>
				current && current.tabId === readTabId ? null : current,
			);
			setRefused((current) =>
				current && current.tabId === readTabId ? null : current,
			);
		}
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
	 *
	 * `ownPage` and `ownStatePage` are forwarded unchanged: they are reasons, not
	 * visibility flags. `ownPage` drives keyboard ownership (cleared by an
	 * overlay); `ownStatePage` survives one, so controls stay refused on the start
	 * page while a menu is open over it (QA Q3-1).
	 */
	const setViewVisible = useCallback(
		(visible: boolean, ownPage = false, ownStatePage = ownPage) => {
			void bridge()
				?.setViewVisible(visible, ownPage, ownStatePage)
				.catch(() => {
					// Losing a visibility update corrects itself on the next policy change;
					// surfacing it would put a message in the band for a race the user cannot
					// act on.
				});
		},
		[],
	);

	const api = bridge();
	return useMemo<BrowserChrome>(
		() => ({
			state,
			pendingUrl,
			error,
			dismissError,
			available,
			refresh,
			reorderTabs: (ids) =>
				runVoid(() =>
					api?.reorderTabs(mergeChromeTabOrder(state?.tabs ?? [], ids)),
				),
			actOnTab: async (tabId, action) => {
				// A failed load can still create and activate a retained plain-user
				// destination. Preserve that identity independently of error feedback,
				// so a conversation pane can reveal it without copying attribution.
				let outcome: HumanTabActionOutcome | undefined;
				await run(async () => {
					outcome = await api?.actOnTab(tabId, action);
					if (outcome?.status === "failed")
						throw new Error(outcome.error.message);
				});
				return outcome;
			},
			newTab: (sessionId) => runVoid(() => api?.newTab(sessionId ?? null)),
			closeTab: (tabId) => run(() => api?.closeTab(tabId)),
			closeTabs: (intent) => run(() => api?.closeTabs(intent)),
			activateTab: (tabId) => runVoid(() => api?.activateTab(tabId)),
			navigate: (url, expectedTabId) => {
				// Recorded before the intent is sent, KEYED TO THE ACTIVE TAB (F3): the reply
				// may take a while (the tab has to load), the point of the note is to cover
				// exactly that window, and the tab it is about is the one that is active now.
				// A caller that names the tab its draft belongs to keeps the note about THAT
				// tab, which is the same tab main will check before it loads anything.
				const tabId = expectedTabId ?? state?.activeTabId ?? null;
				setPending({ tabId, url });
				setRefused(null);
				// A REFUSED ATTEMPT ENDS THE NOTE AND REMEMBERS THE ADDRESS (F1, round 2).
				// `run` answers whether main accepted the invoke, so a refusal is known
				// HERE rather than inferred later from a note that never cleared — which
				// is what stranded the start page behind a blank view. Clearing the note
				// puts the start page (and its retry) back; keeping the address lets the
				// start field restore what was typed, because its draft is mount-local
				// and dies with the submit that carried it here.
				//
				// AN ACCEPTED ATTEMPT LEAVES THE NOTE IN PLACE, and that is F4's fix: the
				// note is the gate term that keeps the start page from lingering over the
				// navigation the user just launched, for the window before main's own
				// `loading` push arrives. It is safe to gate on again only because it is now
				// released on a refusal (here) and on a read showing the start state idle
				// (`refresh`), which is what F1 was missing.
				return run(async () => {
					await api?.navigate(url, expectedTabId);
				}).then((accepted) => {
					if (!accepted) {
						setPending(null);
						setRefused({ tabId, url });
					}
				});
			},
			home: () => {
				// AN EXPLICIT CONTROL ENDS THE NOTE FOR THIS TAB (F1's other half, kept
				// without the round-2 release that broke F4). `home` means "return to the
				// start state", so a pending note — whose meaning is "a page is on its
				// way" — is false the moment the user asks for the start state back. Same
				// for `stop`, which is the control whose whole meaning is "abandon this
				// attempt". Together they are the release path for an attempt main accepted
				// and never started loading, which is the one case the refusal clear cannot
				// see.
				const tabId = state?.activeTabId ?? null;
				setPending((current) =>
					current && current.tabId === tabId ? null : current,
				);
				setRefused((current) =>
					current && current.tabId === tabId ? null : current,
				);
				return runVoid(() => api?.home());
			},
			reload: (hard) => runVoid(() => api?.reload(hard)),
			pageControl: (tabId, action, query = "", forward = true, next = false) =>
				runVoid(() => api?.pageControl(tabId, action, query, forward, next)),
			addressHistory: async (request) => {
				// NOT `run`: a suggestion read's failure is not an ACTION failure.
				// Putting it in `actionError` would surface an error band for a field
				// that still types and navigates perfectly well. The hook owns the
				// degraded state, which is exactly the proposal's safe fallback.
				if (!api) throw new Error("The browser is not available.");
				return api.addressHistory(request);
			},
			onStateChanged: (callback) => api?.onStateChanged(callback) ?? (() => {}),
			reopenTab: (sessionId) =>
				runVoid(() => api?.reopenTab(sessionId ?? null)),
			stop: () => {
				// See `home`: the explicit abandon control releases this tab's note.
				const tabId = state?.activeTabId ?? null;
				setPending((current) =>
					current && current.tabId === tabId ? null : current,
				);
				return runVoid(() => api?.stop());
			},
			retry: () => runVoid(() => api?.retry()),
			history: (direction) => runVoid(() => api?.history(direction)),
			setContentRect,
			setViewVisible,
			refusedUrl,
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
						showErrorToast(
							t("ui.browser.use_browser_chrome.downloads_folder_failed", {
								message,
							}),
						);
					}
				}),
		}),
		[
			state,
			pendingUrl,
			refusedUrl,
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
