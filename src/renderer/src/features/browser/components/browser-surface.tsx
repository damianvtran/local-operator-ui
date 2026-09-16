import {
	clearConsentAttention,
	useConsentAttention,
} from "@shared/browser-consent-attention";
import {
	useBrowserViewSuppressed,
	useSuppressBrowserView,
	useSuppressedOverlayIds,
} from "@shared/browser-view-policy";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui";
import { AlertTriangle, Globe, X } from "lucide-react";
import type { FC } from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type BrowserTabView,
	useBrowserChrome,
} from "../hooks/use-browser-chrome";
import {
	type SurfaceScope,
	originOfUrl,
	requestsInScope,
	scopeFromKey,
	scopeKey,
	tabsInScope,
	useApprovalQueue,
} from "../model/approval-queue-model";
import { BrowserApprovalsDock } from "./browser-approvals-dock";
import { defaultApprovalHeaderLabel } from "./browser-approvals-tray";
import { BrowserConsentBar } from "./browser-consent-bar";
import { BrowserHandOverDialog } from "./browser-hand-over-dialog";
import { BrowserLoadFailure } from "./browser-load-failure";
import { BrowserTabStrip } from "./browser-tab-strip";
import { BrowserUrlBar } from "./browser-url-bar";

/**
 * The browser surface: everything that exists once per host.
 * Design: docs/design/ui-browser-tab.md 11.1 (one `WebContentsView` per tab),
 * 11.2 (who owns the rectangle), 11.3 (the layering consequence), 11.4 (focus),
 * 11.6 (popups are offered, not opened), 11.8 (human takeover), 11.9 (a route now,
 * a panel later); docs/design/browser-approval-ux.md 2 (the band is the
 * interactive surface), 4 (the surfaces), 7.1 (one implementation, two hosts).
 *
 * WHY THIS IS A COMPONENT AND NOT A ROUTE. The operator's question ("what is the
 * agent in THIS conversation doing") is conversational, not global, so the feature
 * is going to be hosted twice: the route the rail points at, and a pane inside a
 * conversation (PR 2). Everything that is once per host lives here — the rect
 * reporter, the view-visibility policy, the popup/error notices, the tray, the
 * dock, the tab strip and URL bar wiring — and the only thing a host chooses is
 * its `scope`, its evidence tags, and its header wording. Re-implementing the
 * strip and the tray per host is rejected for the same reason `branding.md`
 * refuses a second button implementation: they would drift.
 *
 * THE `scope` PROP IS PR 1's INTERFACE (spec §9, item 1). It is `"all"` today
 * because the only host is the route. It exists now, threaded through
 * `tabsInScope`, so PR 2 is a projection field plus a prop rather than a refactor
 * of this surface under a review round. A tab with no session attribution is not
 * any conversation's and appears only under `"all"` (design 7.3).
 *
 * THE LAYOUT CONTRACT, which is the part with a rule behind every line: the
 * renderer owns layout, so this component measures the element where the page
 * should go and reports `{x, y, width, height}` to main, which applies it with
 * `view.setBounds` to the ACTIVE tab only. Everything that can move the rectangle
 * goes through one `ResizeObserver` plus a window `resize` listener: window
 * resize, the rail collapsing or expanding (the rail is a flex sibling, so this
 * element's box changes), route changes away and back (the observer fires on
 * mount and the cleanup reports null), and — new here — the dock opening or
 * closing, because the dock is a flex sibling of the content element rather than
 * an overlay (§4.2). That last one is why the dock needs no suppression: the page
 * narrows and the host re-bounds the view on the next measurement.
 *
 * WHY A NULL RECT ON UNMOUNT, rather than only hiding the view: this owns the only
 * thing that knows where the native view belongs, so the moment it unmounts
 * nothing does. Main treats a null rect as "nowhere to paint" and hides every
 * view, so leaving the surface cannot leave a page painting over the rest of the
 * app. One host is mounted at a time, so there is exactly one rect reporter
 * (design 7.3), and the handover is a required test.
 *
 * FOCUS (design 11.4): nothing here focuses anything except the approvals dock,
 * whose opening moves focus to its own header (§4.2's keyboard contract) and whose
 * Escape returns focus to the Approvals control that opened it. Creating a view and
 * setting its bounds does not focus; `view.webContents.focus()` is never called,
 * and the repo's window-mode guard scans `src/main/` for the forbidden calls. An
 * agent `open` does not activate the new tab either — main appends it and marks it,
 * and this component only ever reflects the active tab main reports.
 *
 * HUMAN TAKEOVER (design 11.8): every tab in the strip is the user's. They can
 * click it, type a URL, reload, go back, and interact with the page directly. No
 * lock, no modal claim, no "agent busy" state — the safety mechanism for the
 * concurrent case is main's per-tab command lane and the epoch-stamped refs, not
 * a UI lock, so there is nothing to render for it here.
 */

/** The rect in CSS pixels, rounded, because Electron positions a native view in
 * device-independent pixels and a fractional origin shows as a seam. */
function measure(element: HTMLElement): {
	x: number;
	y: number;
	width: number;
	height: number;
} {
	const rect = element.getBoundingClientRect();
	return {
		x: Math.round(rect.left),
		y: Math.round(rect.top),
		width: Math.round(rect.width),
		height: Math.round(rect.height),
	};
}

export interface BrowserSurfaceProps {
	/** Which tabs this host shows. See the header comment. A host may pass a fresh
	 * object on every render: the surface keys its filters on the scope's VALUE (see
	 * `scopeKey` for the loop that naivety caused), so identity is free here. */
	scope: SurfaceScope;
	/** This host's own evidence tag, so a run can say which host it drove (§9's
	 * item 4: the hosts never co-mount, but a test has to know which one it is
	 * driving, and PR 2's pane passes its own). */
	surfaceTag: string;
	/** The dock's evidence tag, per host, for the same reason. */
	dockSurfaceTag: string;
	/** The tray header's wording, because the sentence is a fact about the scope:
	 * the route counts every request, and PR 2's pane counts only the requests this
	 * conversation's agent raised and has to say so (spec 7.2, interface 3). */
	approvalHeaderLabel?: (count: number) => string;
	/**
	 * The way out of a scope that has nothing in it, when the host HAS other tabs to
	 * show (spec 7.2).
	 *
	 * Absent on the route, where there is no narrower list to widen: `scope="all"`
	 * already shows everything, so its empty state has nothing to offer and says the
	 * plain truth ("No tabs are open."). The pane passes it, and the surface renders
	 * the action only for a conversation scope — a host that has no other scope is a
	 * host that must not offer one.
	 */
	onShowAllTabs?: () => void;
}

const DEFAULT_APPROVAL_HEADER = defaultApprovalHeaderLabel;

export const BrowserSurface: FC<BrowserSurfaceProps> = ({
	scope,
	surfaceTag,
	dockSurfaceTag,
	approvalHeaderLabel = DEFAULT_APPROVAL_HEADER,
	onShowAllTabs,
}) => {
	const chrome = useBrowserChrome();
	const suppressed = useBrowserViewSuppressed();
	const suppressedBy = useSuppressedOverlayIds();
	const contentRef = useRef<HTMLDivElement | null>(null);
	const approvalsTriggerRef = useRef<HTMLButtonElement | null>(null);
	const [dockOpen, setDockOpen] = useState(false);
	/** Which request's card is expanded. View state, defaulting to the attention
	 * entry and then to the oldest — exactly the band's rule before this feature
	 * (spec 4.1), never a second copy of main's queue. */
	const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
	const [handOverTab, setHandOverTab] = useState<BrowserTabView | null>(null);
	const [busy, setBusy] = useState(false);
	const [blockedPopup, setBlockedPopup] = useState<{
		tabId: number;
		url: string;
	} | null>(null);

	/**
	 * The scope, held by IDENTITY as well as by value.
	 *
	 * WHY THIS ONE LINE MATTERS, and it is a real defect rather than tidiness: every
	 * memo and every effect below keys on `scope`'s identity — the tab memo, the
	 * request memo, and the queue model's own effects — and the queue model's clock
	 * tick re-renders this component. A host that rebuilds its scope object per render
	 * (the pane does: `{ sessionId }` in its own render body) therefore produced a new
	 * filtered ARRAY per render, which re-ran the model's effect, which published the
	 * clock, which re-rendered — a render loop whose period is the microsecond it
	 * takes to run it, on a surface that still paints and so looks fine in a frame.
	 *
	 * The fix belongs HERE rather than only in the caller, because this component owns
	 * the model and the model's contracts are its to keep: it derives its own stable
	 * scope from the scope's VALUE (the route's `"all"`, or the session id, both
	 * primitives) and hands that to everything downstream, so no host can trip it.
	 */
	const scopeField = scopeKey(scope);
	const stableScope = useMemo<SurfaceScope>(
		() => scopeFromKey(scopeField),
		[scopeField],
	);

	const state = chrome.state;
	// The scope filter, applied to the projection the strip, the URL bar and the
	// waiting chips all read. `state?.tabs` is a fresh array per projection, so the
	// filter is memoised on it rather than on `state`.
	const allTabs = state?.tabs;
	const tabs = useMemo(
		() => tabsInScope(allTabs ?? [], stableScope),
		[allTabs, stableScope],
	);
	const activeTab =
		tabs.find((tab) => tab.tabId === state?.activeTabId) ?? null;

	// THE ONE CLOCK (spec 3.3). The queue model owns the 1s interval and the
	// ordinal, so the tray, the dock, the tab chips and the badge cannot disagree.
	//
	// THE SAME SCOPE APPLIES TO THE REQUESTS, for the second half of the same
	// question (“which of these are mine”): the scope's OWN key for that is the
	// requester rather than a tab (spec 7.2 — a request belongs to a conversation by
	// WHO ASKED), so `requestsInScope` is a different filter from `tabsInScope` over a
	// different field, and both are fed the host's one scope prop. That is what makes
	// the pane's badge count this conversation's live requests while the route's
	// counts every one, from the same component and the same model: the input differs,
	// nothing here branches on which host it is.
	const requests = state?.pendingConsent;
	const pendingRequests = useMemo(
		() => requestsInScope(requests ?? [], stableScope),
		[requests, stableScope],
	);
	const queue = useApprovalQueue(pendingRequests, tabs);

	// ---- layout: report the rectangle ---------------------------------------
	// `useLayoutEffect` so the first report lands before the browser paints: with
	// a passive effect the view would appear one frame after the chrome, which is
	// a flash of the placeholder under it.
	useLayoutEffect(() => {
		const element = contentRef.current;
		if (!element) return;
		const report = (): void => chrome.setContentRect(measure(element));
		report();
		const observer = new ResizeObserver(report);
		observer.observe(element);
		// Also on window resize: a monitor switch changes the device pixel ratio
		// without necessarily changing this element's CSS box (design 11.2 names
		// "devicePixelRatio changes on a monitor switch" as a source of rect
		// change), and the observer cannot see that.
		window.addEventListener("resize", report);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", report);
			// The surface is going away: nothing knows where the view belongs now.
			chrome.setContentRect(null);
		};
	}, [chrome.setContentRect]);

	// ---- the overlay policy -------------------------------------------------
	// One boolean → one IPC call → `setVisible(false)` on open and `(true)` on
	// close (design 11.3). The strip and the URL bar are outside the view's rect,
	// so they stay painted and the screen never looks empty. The approvals dock is
	// deliberately NOT part of this: it narrows the content rect instead, which is
	// the whole reason the queue lives in a dock rather than a sheet (spec §2).
	useEffect(() => {
		chrome.setViewVisible(!suppressed);
	}, [chrome.setViewVisible, suppressed]);

	// ---- popups: offered, never opened --------------------------------------
	// `setWindowOpenHandler` denies every `window.open` in main; http(s) ones are
	// offered to the user here instead of being auto-opened (design 11.6), because
	// an unexpected window is the one popup behaviour a user cannot undo.
	useEffect(() => {
		const api = window.api?.browser;
		if (!api) return;
		return api.onPopupBlocked((payload) => setBlockedPopup(payload));
	}, []);

	// A banner click names the pending request; the band is already rendering it,
	// so the only job here is to make sure this surface is showing current state.
	useEffect(() => {
		const api = window.api?.browser;
		if (!api) return;
		return api.onConsentAttention(() => void chrome.refresh());
	}, [chrome.refresh]);

	const runBusy = useCallback(async (action: () => Promise<void>) => {
		setBusy(true);
		try {
			await action();
		} finally {
			setBusy(false);
		}
	}, []);

	// A banner click names the request it was raised for, and the shell has already
	// navigated here (see `shared/browser-consent-attention`). Two things follow: the
	// band shows THAT request rather than the oldest, and the attention is dropped
	// once it is no longer pending — answered, expired or cancelled — so a later
	// request does not inherit an answer given to an earlier one (review round 1, R8).
	const attention = useConsentAttention();
	const named = attention
		? pendingRequests.find((entry) => entry.entryId === attention)
		: undefined;
	useEffect(() => {
		if (attention && !named) clearConsentAttention(attention);
	}, [attention, named]);
	// An attention click moves the selection, but a LOCAL selection is not thrown
	// away by an unrelated refresh: only a named request takes the selection over.
	useEffect(() => {
		if (named) setSelectedEntryId(named.entryId);
	}, [named]);

	const selectedRow =
		queue.rows.find((row) => row.request.entryId === selectedEntryId) ??
		queue.rows[0] ??
		null;
	const pendingSelected = selectedRow?.request ?? null;

	const decide = useCallback(
		(
			entryId: string,
			decision: Parameters<typeof chrome.respondToConsent>[1],
		) => {
			// Told to the model before the IPC leaves, so the row this answer came from
			// is not reported as "withdrawn by the agent" when the projection drops it
			// (spec 3.4: an answered request is excluded from the expiry memory).
			queue.noteDecision(entryId);
			void runBusy(() => chrome.respondToConsent(entryId, decision));
		},
		[chrome.respondToConsent, queue.noteDecision, runBusy],
	);

	/*
	 * THE BAND CAN UNMOUNT UNDER THE PRESSED CONTROL, so focus is handed on rather
	 * than dropped (UX round 2, U11). Answering the LAST request leaves the band
	 * nothing to render - a user decision writes no resolved row, that memory is for
	 * expiry and withdrawal - and the pressed control goes with it, so
	 * `document.activeElement` fell to `<body>` and a keyboard user restarted from the
	 * top of the document. The Approvals control is where `closeDock` sends focus too;
	 * this is the same "task finished" moment.
	 *
	 * ON THE TRANSITION, NOT ON A FRAME OF THE CLICK (review round 3, MINOR). The first
	 * version scheduled this in `requestAnimationFrame` from the click handler and
	 * bailed unless focus was already unowned - but the band is rendered from the
	 * projection, `noteDecision` writes only a ref, so at the next frame the pressed
	 * button was normally still mounted and still focused (Chromium focuses a button on
	 * click) and the guard returned. The band then unmounted when the IPC push landed,
	 * and focus fell to `<body>` exactly as before: the handoff only fired when the
	 * round trip beat the frame. Observing the band empty is the reliable signal, since
	 * it is the event that actually removes the focused node.
	 *
	 * Still guarded on focus being genuinely unowned and the dock being closed: an
	 * expiry elsewhere, or a user whose attention is on the page, must not have the
	 * control grabbed out from under them. `bandWasShowing` keeps a first mount with an
	 * empty queue from stealing focus on load.
	 */
	const bandShowing = queue.rows.length > 0 || queue.resolved.length > 0;
	const bandWasShowing = useRef(false);
	useEffect(() => {
		const wasShowing = bandWasShowing.current;
		bandWasShowing.current = bandShowing;
		if (bandShowing || !wasShowing) return;
		if (dockOpen) return;
		if (document.activeElement !== document.body) return;
		approvalsTriggerRef.current?.focus();
	}, [bandShowing, dockOpen]);

	const closeDock = useCallback(() => {
		setDockOpen(false);
		// Escape and the close button both return focus to the control that opened
		// the dock (spec 4.2's keyboard contract), so a keyboard user is not dropped
		// at the top of the document.
		approvalsTriggerRef.current?.focus();
	}, []);

	const currentOrigin = activeTab ? originOfUrl(activeTab.url) : null;
	// A failed load leaves Chromium's own surface in the view - blank, because
	// Electron ships no error page - so the reason can only be painted here, and the
	// view has to go away for this panel to be visible at all (design 11.3). That is
	// the same hide-and-restore lever the overlay policy uses; the id says which
	// reason applied, so a paused page is never mistaken for a broken one.
	const navFailure = state?.navFailure ?? null;
	const suppressionIds = suppressedBy ? suppressedBy.split(",") : [];
	// WHICH OF THE TWO EXPLANATIONS THE USER GETS WHEN BOTH ARE TRUE.
	//
	// A dialog can be open over a tab whose last load failed, and the two states say
	// different things: one is about something the user has just opened, the other
	// about the page underneath. The overlay wins, because it is the user's own
	// immediate action and its copy is a promise about what closing it does - a
	// promise that stays true here, since closing the dialog reveals the failure
	// panel. Letting the panel win instead left "close it to bring the page back"
	// unreachable in exactly the state it was written for.
	const overlaySuppressing = suppressionIds.some(
		(id) => id && !id.startsWith("browser-load-failure:"),
	);
	const showingFailure =
		navFailure !== null &&
		state !== null &&
		tabs.length > 0 &&
		!overlaySuppressing;
	// Registered for the failure whether or not the panel is the thing on screen:
	// while an overlay is up the view is hidden anyway, and releasing the
	// registration behind a dialog would restore a blank Chromium surface over it.
	useSuppressBrowserView(navFailure !== null, "browser-load-failure");

	if (!chrome.available) {
		return (
			<div className="flex h-full items-center justify-center bg-canvas p-6">
				<p className="text-body text-ink-muted">
					The browser is only available in the desktop app.
				</p>
			</div>
		);
	}

	return (
		<div
			className="flex h-full min-h-0 flex-col bg-canvas"
			data-tour-tag={surfaceTag}
		>
			<BrowserTabStrip
				tabs={tabs}
				activeTabId={state?.activeTabId ?? null}
				waiting={queue.waiting}
				onActivate={(tabId) => void chrome.activateTab(tabId)}
				onClose={(tabId) => void chrome.closeTab(tabId)}
				onNewTab={() => void chrome.newTab()}
				onHandOver={(tab) => setHandOverTab(tab)}
				onRevokeHandOver={(tabId) => void chrome.revokeHandOver(tabId)}
			/>
			<BrowserUrlBar
				url={state?.url ?? ""}
				pendingUrl={chrome.pendingUrl}
				loading={Boolean(state?.loading)}
				canGoBack={Boolean(state?.canGoBack)}
				canGoForward={Boolean(state?.canGoForward)}
				disabled={tabs.length === 0}
				onNavigate={(url) => void chrome.navigate(url)}
				onBack={() => void chrome.history("back")}
				onForward={() => void chrome.history("forward")}
				onReload={() => void chrome.reload()}
				onStop={() => void chrome.stop()}
				onOpenApprovals={() => setDockOpen((open) => !open)}
				waitingCount={queue.count}
				triggerRef={approvalsTriggerRef}
			/>
			{/* The band renders while there is anything to say: a live request, or a
			    resolved row the user is still reading (spec 3.4's bounded memory). One
			    pending request and no resolved rows is the common case and the tray then
			    renders the card alone, which is the band the user already knows. */}
			{(queue.rows.length > 0 || queue.resolved.length > 0) && (
				// `aria-live` because this band appears without the user's action: the
				// agent navigated, and the prompt must be announced rather than merely
				// painted (design 9.2's whole reason for the bar).
				<div aria-live="polite">
					<BrowserConsentBar
						rows={queue.rows}
						resolved={queue.resolved}
						selectedEntryId={selectedRow?.request.entryId ?? null}
						onSelect={setSelectedEntryId}
						busy={busy}
						onDecide={decide}
						dockOpen={dockOpen}
						onToggleDock={() => setDockOpen((open) => !open)}
						headerLabel={approvalHeaderLabel}
					/>
				</div>
			)}
			{blockedPopup && (
				<div
					className="flex items-center gap-2 border-control border-b bg-surface px-3 py-1.5"
					data-tour-tag="browser-popup-notice"
				>
					<AlertTriangle
						aria-hidden
						className="size-4 shrink-0 text-ink-muted"
					/>
					<p className="min-w-0 grow truncate text-body-sm text-ink-muted">
						A popup to{" "}
						<span className="font-mono text-mono-sm">{blockedPopup.url}</span>{" "}
						was blocked.
					</p>
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							const url = blockedPopup.url;
							setBlockedPopup(null);
							void runBusy(async () => {
								await chrome.newTab();
								await chrome.navigate(url);
							});
						}}
					>
						Open in a new tab
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Dismiss"
						onClick={() => setBlockedPopup(null)}
					>
						<X aria-hidden className="size-3.5" />
					</Button>
				</div>
			)}
			{chrome.error && (
				<output
					className="flex items-center gap-2 border-control border-b bg-danger-wash px-3 py-1.5"
					data-tour-tag="browser-error"
				>
					<p className="min-w-0 grow text-body-sm text-ink">{chrome.error}</p>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Dismiss"
						// An explicit dismissal, rather than a `refresh()` that happened to
						// succeed: a refusal is the user's to clear once they have read it,
						// and re-reading the projection must not be able to erase it (R6).
						onClick={() => chrome.dismissError()}
					>
						<X aria-hidden className="size-3.5" />
					</Button>
				</output>
			)}

			{/* The content row: the page area and the dock are FLEX SIBLINGS, so the
			    content element — and the rectangle reported from it — narrows when the
			    dock opens. That is the design's whole point (`spec 2`): a native view
			    cannot be CSS-scaled or overlaid, so the dock is in flow, and the
			    `ResizeObserver` above re-reports on the same frame. */}
			<div className="flex min-h-0 grow">
				{/* The content rect. The native view paints ABOVE this element, so
				    everything below is visible only while the view is hidden — which is
				    exactly why the treatment is a page title and one line rather than a
				    full screen: it is what the user sees in the gap, and looking like a
				    deliberate paused state is the difference between "a dialog is open"
				    and "the browser broke" (design 11.3). */}
				<div
					ref={contentRef}
					// `min-w-0` because the content element is now a flex SIBLING of the dock: a
					// flex item's default `min-width: auto` refuses to shrink below its content, so
					// the dock would push the column wider instead of narrowing it and the
					// reported rect would never change (spec §4.2). The 240px floor the design
					// also names is a PANE-layout decision, not this class's: in a pane narrower
					// than ~520px the dock takes the whole width and the page is given none
					// (spec §4.4), which is PR 2's layout to choose.
					className="relative min-h-0 min-w-0 grow bg-canvas"
					data-tour-tag="browser-content"
					/* The suppression reason on the element that is always here, so a run — or a
					   support session — reads WHY the page is hidden rather than inferring it
					   from whatever happens to be on screen. The paused note carries the same
					   attribute; the failure panel is a different element, and a reason that is
					   only readable in one of the two states is the state that gets misread. */
					data-suppressed-by={suppressedBy}
				>
					{!state && (
						<div className="flex h-full items-center justify-center">
							<Spinner size="lg" label="Loading browser" />
						</div>
					)}
					{state && tabs.length === 0 && (
						// ONE ACTION, ONE LABEL (design round 3, D19). The strip's own `+` is
						// `aria-label="New tab"`, so that is the label the feature already tells the
						// user to look for; the EMPHASIS differs between this branch and the next -
						// primary when there is nothing else to do, outline when the real next move
						// is to pick a tab above - and that is deliberate rather than an
						// inconsistency to iron out.
						//
						// TWO ACTIONS IN THE SCOPED BRANCH, and they are two DIFFERENT actions rather
						// than the same one twice (spec 7.2): `Show all tabs` widens the LIST and
						// `New tab` opens a page. The first is the primary one here, because the
						// state this copy exists for is the half-truth case - three tabs are open
						// and none of them is this conversation's - and the honest next move there
						// is to look at what IS open, not to open a fourth. It is rendered only when
						// the host actually HAS a wider scope to offer, so the route's own empty
						// state keeps its single action.
						<div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
							<Globe aria-hidden className="size-6 text-ink-dim" />
							{scope === "all" ? (
								<p className="text-body text-ink-muted">No tabs are open.</p>
							) : (
								<p className="text-body text-ink-muted">
									No browser tabs in this conversation yet. A tab an agent opens
									appears here while it works.
								</p>
							)}
							<div className="flex items-center gap-2">
								{scope !== "all" && onShowAllTabs && (
									<Button
										variant="primary"
										size="sm"
										onClick={onShowAllTabs}
										data-tour-tag="browser-scope-show-all"
									>
										Show all tabs
									</Button>
								)}
								<Button
									variant={scope === "all" ? "primary" : "outline"}
									size="sm"
									onClick={() => void chrome.newTab()}
								>
									New tab
								</Button>
							</div>
						</div>
					)}
					{state && tabs.length > 0 && !activeTab && (
						// A tab can be closed while another is left (the agent's, typically) and the
						// registry then has no active tab at all: without this the page area is
						// blank with nothing saying why, and the only way out — pressing a tab in
						// the strip — is something nothing suggests (review round 2, U4).
						<div className="flex h-full flex-col items-center justify-center gap-3">
							<Globe aria-hidden className="size-6 text-ink-dim" />
							<p className="text-body text-ink-muted">
								No tab is selected. Pick a tab above, or open a new one.
							</p>
							<Button
								variant="outline"
								size="sm"
								onClick={() => void chrome.newTab()}
							>
								New tab
							</Button>
						</div>
					)}
					{suppressed && overlaySuppressing && state && tabs.length > 0 && (
						<output
							className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center"
							data-tour-tag="browser-paused"
							data-suppressed-by={suppressedBy}
						>
							<p className="max-w-lg truncate text-title text-ink">
								{state.title || activeTab?.title || "This page"}
							</p>
							<p className="text-body-sm text-ink-muted">
								Paused while a dialog or panel is open — close it to bring the
								page back.
							</p>
						</output>
					)}
					{showingFailure && navFailure && (
						<BrowserLoadFailure
							failure={navFailure}
							onRetry={() => void chrome.reload()}
						/>
					)}
				</div>
				<BrowserApprovalsDock
					open={dockOpen}
					rows={queue.rows}
					resolved={queue.resolved}
					selectedEntryId={pendingSelected?.entryId ?? null}
					onSelect={setSelectedEntryId}
					busy={busy}
					onDecide={decide}
					approvals={state?.approvals ?? []}
					currentOrigin={currentOrigin}
					onRevoke={(origin) =>
						void runBusy(() => chrome.revokeApproval(origin))
					}
					onRevokeAll={() => void runBusy(() => chrome.revokeAllApprovals())}
					onForgetSite={(origin) =>
						void runBusy(() => chrome.forgetSite(origin))
					}
					onClearData={(what) => void runBusy(() => chrome.clearData(what))}
					onClose={closeDock}
					surfaceTag={dockSurfaceTag}
				/>
			</div>
			<BrowserHandOverDialog
				open={handOverTab !== null}
				tab={handOverTab}
				busy={busy}
				onClose={() => setHandOverTab(null)}
				onConfirm={(tabId, sessionId) => {
					setHandOverTab(null);
					void runBusy(() => chrome.handOver(tabId, sessionId));
				}}
			/>
		</div>
	);
};
