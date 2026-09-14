import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
	active: boolean;
	/** Restored from a previous run (design 7). Always user-owned. */
	restored: boolean;
	/** A user tab the user has handed to a session (design 6.3). */
	handedOver: boolean;
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
}

export type ConsentDecision = "once" | "session" | "site" | "domain" | "deny";

/** What the preload exposes. Absent outside Electron (Storybook, the unit tests). */
type BrowserBridge = NonNullable<typeof window.api>["browser"];

function bridge(): BrowserBridge | null {
	return window.api?.browser ?? null;
}

/** Whether the browser controls can work at all. A route rendered outside
 * Electron says so rather than throwing on the first click. */
export function browserBridgeAvailable(): boolean {
	return bridge() !== null;
}

export interface BrowserChrome {
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
	/** A read or an action failed. Shown in the band, not as a toast per keystroke. */
	error: string | null;
	available: boolean;
	refresh: () => Promise<void>;
	newTab: () => Promise<void>;
	closeTab: (tabId: number) => Promise<void>;
	activateTab: (tabId: number) => Promise<void>;
	navigate: (url: string) => Promise<void>;
	reload: () => Promise<void>;
	stop: () => Promise<void>;
	history: (direction: "back" | "forward") => Promise<void>;
	setContentRect: (
		rect: { x: number; y: number; width: number; height: number } | null,
	) => void;
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
}

export function useBrowserChrome(): BrowserChrome {
	const [state, setState] = useState<BrowserChromeState | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pendingUrl, setPendingUrl] = useState<string | null>(null);
	const available = browserBridgeAvailable();

	const refresh = useCallback(async (): Promise<void> => {
		const api = bridge();
		if (!api) return;
		try {
			const next = (await api.state()) as BrowserChromeState | null;
			if (next && Array.isArray(next.tabs)) {
				setState(next);
				setError(null);
				// The tab has a URL of its own now: the pending note's job is done.
				if (next.url && next.url !== "about:blank") setPendingUrl(null);
			}
		} catch (caught) {
			setError(messageOf(caught));
		}
	}, []);

	useEffect(() => {
		if (!available) return;
		void refresh();
		const api = window.api?.browser;
		if (!api) return;
		// Two subscriptions rather than one: main emits the consent event for the
		// approval store's changes (which include the pending set) and the state
		// event for the registry's. Both land on the same projection, and reading it
		// twice is cheaper than two projections that can disagree.
		const offState = api.onStateChanged(() => void refresh());
		const offConsent = api.onConsentChanged(() => void refresh());
		return () => {
			offState();
			offConsent();
		};
	}, [available, refresh]);

	/**
	 * Run one intent, then re-read.
	 *
	 * Failures are reported in the band rather than swallowed: several of these
	 * refusals are the intended behaviour (a `nav_failed` for a non-http URL, a
	 * `tab_limit` on the ninth agent tab), so a silent failure would look like a
	 * dead button.
	 */
	const run = useCallback(
		async (action: () => Promise<unknown> | undefined): Promise<void> => {
			try {
				await action();
				setError(null);
			} catch (caught) {
				setError(messageOf(caught));
			}
			await refresh();
		},
		[refresh],
	);

	// The rect report is throttled to one per frame HERE, in the renderer, because
	// this is where the events originate: a live window resize fires far faster
	// than a native view can be repositioned, and an unthrottled `setBounds` storm
	// is visible as tearing (design 11.2).
	const frame = useRef<number | null>(null);
	const pendingRect = useRef<{
		x: number;
		y: number;
		width: number;
		height: number;
	} | null>(null);

	const setContentRect = useCallback(
		(rect: { x: number; y: number; width: number; height: number } | null) => {
			pendingRect.current = rect;
			if (frame.current !== null) return;
			frame.current = requestAnimationFrame(() => {
				frame.current = null;
				const next = pendingRect.current;
				void bridge()
					?.setContentRect(next)
					.catch(() => {
						// A rect that could not be delivered is corrected by the next
						// resize; reporting it as an error would put a message in the band
						// for a transient during a drag.
					});
			});
		},
		[],
	);

	useEffect(
		() => () => {
			if (frame.current !== null) cancelAnimationFrame(frame.current);
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
			available,
			refresh,
			newTab: () => run(() => api?.newTab()),
			closeTab: (tabId) => run(() => api?.closeTab(tabId)),
			activateTab: (tabId) => run(() => api?.activateTab(tabId)),
			navigate: (url) => {
				// Recorded before the intent is sent: the reply may take a while (the tab
				// has to load), and the point of the note is to cover exactly that window.
				setPendingUrl(url);
				return run(() => api?.navigate(url));
			},
			reload: () => run(() => api?.reload()),
			stop: () => run(() => api?.stop()),
			history: (direction) => run(() => api?.history(direction)),
			setContentRect,
			setViewVisible,
			respondToConsent: (entryId, decision) =>
				run(() => api?.respondToConsent(entryId, decision)),
			handOver: (tabId, sessionId) =>
				run(() => api?.handOver(tabId, sessionId)),
			revokeHandOver: (tabId) => run(() => api?.revokeHandOver(tabId)),
			revokeApproval: (origin) => run(() => api?.revokeApproval(origin)),
			revokeAllApprovals: () => run(() => api?.revokeAllApprovals()),
			forgetSite: (origin) => run(() => api?.forgetSite(origin)),
			clearData: (what) => run(() => api?.clearData(what)),
		}),
		[
			state,
			pendingUrl,
			error,
			available,
			refresh,
			run,
			setContentRect,
			setViewVisible,
			api,
		],
	);
}

/** The prefix Electron adds to an `ipcRenderer.invoke` rejection. Module scope
 * because a regex literal inside the function is rebuilt on every call and the
 * linter's rule is right about it. */
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*/;

/** IPC rejections arrive as `Error` with a prefix Electron adds, so the message
 * is unwrapped rather than shown raw. */
function messageOf(caught: unknown): string {
	const raw = caught instanceof Error ? caught.message : String(caught);
	return raw.replace(IPC_ERROR_PREFIX, "").trim();
}
