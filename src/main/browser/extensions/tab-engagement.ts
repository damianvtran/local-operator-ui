/**
 * Which tab a PERSON is engaging right now: the lock that lets a password
 * manager's prompt document into an agent tab (`auth-request.ts` "WHAT IS
 * ADMITTED").
 *
 * A LIVE SIGNAL, NOT A LATCH (review S4/B3). Engagement used to be set only by
 * a trusted tab-strip selection and cleared only by activating another tab, so
 * (a) a person who clicked straight into the page of the already-selected tab
 * never engaged it and a real 1Password sign-in was refused, and (b) one
 * selection twenty minutes ago still admitted provider documents into a tab
 * nobody was looking at. Now:
 *
 *   - SET by a trusted tab-strip selection (`selected`), or by a press on the
 *     tab's own page (`pagePressed`) that is NOT synthesized by the agent. If
 *     the primary press is delivered before window focus arrives, the same
 *     click's release (`pageReleased`) can engage once the window is focused;
 *   - CLEARED when the window loses focus (`windowBlurred`), when another tab
 *     (or none) becomes active (`activated`), when the app's own renderer
 *     takes focus FROM a page (its `focus` event; a tab-strip click already
 *     has focus in the app, so typing in chat after one does NOT clear it),
 *     when the AGENT replaces the tab's main document (`actions/gate.ts`
 *     `navigateView`, review R11: the person engaged the old page, not the
 *     agent's next one), and when the tab closes or changes hands. A
 *     navigation the page or the person makes does not clear it.
 *
 * WHY BOTH EDGES NEED `synthetic`. Electron's `before-mouse-event` fires in
 * the page's input path for DevTools' `Input.dispatchMouseEvent` too (measured
 * on Electron 45.1.0), so a trusted DOM click does not distinguish human from
 * agent. Only the main process knows when a CDP input command is in flight
 * (`CdpPool.isDispatchingInput`). Neither edge may engage during that command.
 * At engagement the window must still be focused and this tab active.
 */
export interface PagePress {
	/** An agent's CDP input command was in flight for this view. */
	synthetic: boolean;
	/** Only the primary button can complete a focus-acquiring click. */
	primary: boolean;
	windowFocused: boolean;
	/** The tab is the one the window shows. */
	active: boolean;
}

export class TabEngagement {
	private tabId: number | null = null;
	private awaitingFocusedRelease: number | null = null;

	selected(tabId: number, trusted: boolean, windowFocused: boolean): void {
		if (!trusted || !windowFocused) return;
		this.awaitingFocusedRelease = null;
		this.tabId = tabId;
	}

	pagePressed(tabId: number, press: PagePress): void {
		this.pagePointerLeft(tabId); // a new press supersedes an unfinished one
		if (press.synthetic || !press.active) return;
		if (press.windowFocused) this.tabId = tabId;
		else if (press.primary) this.awaitingFocusedRelease = tabId;
	}

	pageReleased(tabId: number, release: PagePress): void {
		if (this.awaitingFocusedRelease !== tabId) return;
		// Consume even an invalid release: a trailing input edge cannot re-use
		// this press, nor can a release alone grant engagement.
		this.awaitingFocusedRelease = null;
		if (
			release.primary &&
			!release.synthetic &&
			release.windowFocused &&
			release.active
		)
			this.tabId = tabId;
	}

	/** Release outside the page may never reach its native input observer. */
	pagePointerLeft(tabId: number): void {
		if (this.awaitingFocusedRelease === tabId)
			this.awaitingFocusedRelease = null;
	}

	activated(tabId: number | null): void {
		if (this.tabId !== tabId) this.tabId = null;
		if (this.awaitingFocusedRelease !== tabId)
			this.awaitingFocusedRelease = null;
	}

	/** The person left the app: engagement is not carried across the absence. */
	windowBlurred(): void {
		this.clearAll();
	}

	clear(tabId: number): void {
		if (this.tabId === tabId) this.tabId = null;
		this.pagePointerLeft(tabId);
	}

	clearAll(): void {
		this.tabId = null;
		this.awaitingFocusedRelease = null;
	}

	has(tabId: number): boolean {
		return this.tabId === tabId;
	}
}
