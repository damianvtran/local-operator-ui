import {
	useBrowserViewSuppressed,
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
	useRef,
	useState,
} from "react";
import {
	type BrowserTabView,
	useBrowserChrome,
} from "../hooks/use-browser-chrome";
import { BrowserConsentBar } from "./browser-consent-bar";
import { BrowserHandOverDialog } from "./browser-hand-over-dialog";
import { BrowserSitesSheet } from "./browser-sites-sheet";
import { BrowserTabStrip } from "./browser-tab-strip";
import { BrowserUrlBar } from "./browser-url-bar";

/**
 * The browser surface: a route today, a panel later.
 * Design: docs/design/ui-browser-tab.md 11.1 (one `WebContentsView` per tab),
 * 11.2 (who owns the rectangle), 11.3 (the layering consequence), 11.4 (focus),
 * 11.6 (popups are offered, not opened), 11.8 (human takeover), 11.9 (a route now,
 * a panel later).
 *
 * THE LAYOUT CONTRACT, which is the part with a rule behind every line: the
 * renderer owns layout, so this component measures the element where the page
 * should go and reports `{x, y, width, height}` to main, which applies it with
 * `view.setBounds` to the ACTIVE tab only. Everything that can move the rectangle
 * goes through one `ResizeObserver` plus a window `resize` listener: window
 * resize, the rail collapsing or expanding (the rail is a flex sibling, so this
 * element's box changes), and route changes away and back (the observer fires on
 * mount and the cleanup reports null).
 *
 * WHY A NULL RECT ON UNMOUNT, rather than only hiding the view: this is a route,
 * and the moment it unmounts nothing is left that knows where the native view
 * belongs. Main treats a null rect as "nowhere to paint" and hides every view, so
 * navigating to chat cannot leave a page painting over the conversation.
 *
 * FOCUS (design 11.4): nothing here focuses anything. Creating a view and setting
 * its bounds does not focus; `view.webContents.focus()` is never called, and the
 * repo's window-mode guard scans `src/main/` for the forbidden calls. An agent
 * `open` does not activate the new tab either — main appends it and marks it, and
 * this component only ever reflects the active tab main reports.
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

export const BrowserPage: FC = () => {
	const chrome = useBrowserChrome();
	const suppressed = useBrowserViewSuppressed();
	const suppressedBy = useSuppressedOverlayIds();
	const contentRef = useRef<HTMLDivElement | null>(null);
	const [sitesOpen, setSitesOpen] = useState(false);
	const [handOverTab, setHandOverTab] = useState<BrowserTabView | null>(null);
	const [busy, setBusy] = useState(false);
	const [blockedPopup, setBlockedPopup] = useState<{
		tabId: number;
		url: string;
	} | null>(null);

	const state = chrome.state;
	const tabs = state?.tabs ?? [];
	const activeTab =
		tabs.find((tab) => tab.tabId === state?.activeTabId) ?? null;

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
			// The route is going away: nothing knows where the view belongs now.
			chrome.setContentRect(null);
		};
	}, [chrome.setContentRect]);

	// ---- the overlay policy -------------------------------------------------
	// One boolean → one IPC call → `setVisible(false)` on open and `(true)` on
	// close (design 11.3). The strip and the URL bar are outside the view's rect,
	// so they stay painted and the screen never looks empty.
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
	// so the only job here is to make sure this route is showing the current state.
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

	const pending = state?.pendingConsent?.[0] ?? null;
	// Which tabs are parked on an origin that is waiting for an answer. Matching on
	// the URL's origin rather than on a tab id is deliberate: the prompt is raised
	// by an agent's navigation, which may target a tab the user is not looking at.
	const waitingTabIds = tabs
		.filter((tab) =>
			state?.pendingConsent?.some(
				(entry) => originOf(tab.url) === entry.origin,
			),
		)
		.map((tab) => tab.tabId);

	const currentOrigin = activeTab ? originOf(activeTab.url) : null;

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
		<div className="flex h-full min-h-0 flex-col bg-canvas">
			<BrowserTabStrip
				tabs={tabs}
				activeTabId={state?.activeTabId ?? null}
				loading={Boolean(state?.loading)}
				waitingTabIds={waitingTabIds}
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
				onOpenSites={() => setSitesOpen(true)}
				approvalCount={
					state?.approvals.filter((row) => row.scope !== "deny").length ?? 0
				}
			/>
			{pending && (
				// `aria-live` because this band appears without the user's action: the
				// agent navigated, and the prompt must be announced rather than merely
				// painted (design 9.2's whole reason for the bar).
				<div aria-live="polite">
					<BrowserConsentBar
						pending={pending}
						busy={busy}
						onDecide={(entryId, decision) =>
							void runBusy(() => chrome.respondToConsent(entryId, decision))
						}
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
						onClick={() => void chrome.refresh()}
					>
						<X aria-hidden className="size-3.5" />
					</Button>
				</output>
			)}

			{/* The content rect. The native view paints ABOVE this element, so
			    everything below is visible only while the view is hidden — which is
			    exactly why the treatment is a page title and one line rather than a
			    full screen: it is what the user sees in the gap, and looking like a
			    deliberate paused state is the difference between "a dialog is open"
			    and "the browser broke" (design 11.3). */}
			<div
				ref={contentRef}
				className="relative min-h-0 grow bg-canvas"
				data-tour-tag="browser-content"
			>
				{!state && (
					<div className="flex h-full items-center justify-center">
						<Spinner size="lg" label="Loading browser" />
					</div>
				)}
				{state && tabs.length === 0 && (
					<div className="flex h-full flex-col items-center justify-center gap-3">
						<Globe aria-hidden className="size-6 text-ink-dim" />
						<p className="text-body text-ink-muted">No tabs are open.</p>
						<Button
							variant="primary"
							size="sm"
							onClick={() => void chrome.newTab()}
						>
							Open a tab
						</Button>
					</div>
				)}
				{suppressed && state && tabs.length > 0 && (
					<div
						className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center"
						data-tour-tag="browser-paused"
						data-suppressed-by={suppressedBy}
					>
						<p className="max-w-lg truncate text-title text-ink">
							{state.title || activeTab?.title || "This page"}
						</p>
						<p className="text-body-sm text-ink-muted">
							Paused while a dialog or panel is open — close it to bring the page
							back.
						</p>
					</div>
				)}
			</div>

			<BrowserSitesSheet
				open={sitesOpen}
				onOpenChange={setSitesOpen}
				approvals={state?.approvals ?? []}
				currentOrigin={currentOrigin}
				busy={busy}
				onRevoke={(origin) => void runBusy(() => chrome.revokeApproval(origin))}
				onRevokeAll={() => void runBusy(() => chrome.revokeAllApprovals())}
				onForgetSite={(origin) => void runBusy(() => chrome.forgetSite(origin))}
				onClearData={(what) => void runBusy(() => chrome.clearData(what))}
			/>
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

/**
 * The origin of a tab's live URL, or null when there is not one.
 *
 * The scheme check is not decoration: `new URL("about:blank").origin` is the
 * STRING "null", which is truthy, so a blank tab would otherwise be offered as a
 * site to forget — and `safeHttpUrl` on the main side would refuse it, turning a
 * nonsense button into an error notice. A pending request's origin is always a real
 * http(s) origin, so this is also what makes the waiting match exact.
 */
function originOf(url: string): string | null {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:"
			? parsed.origin
			: null;
	} catch {
		return null;
	}
}
