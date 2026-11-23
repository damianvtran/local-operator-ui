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
 *     tab's own page (`pagePressed`) that is NOT synthesized by the agent;
 *   - CLEARED when the window loses focus (`windowBlurred`), when another tab
 *     (or none) becomes active (`activated`), when the app's own renderer
 *     takes focus FROM a page (its `focus` event; a tab-strip click already
 *     has focus in the app, so typing in chat after one does NOT clear it),
 *     when the AGENT replaces the tab's main document (`actions/gate.ts`
 *     `navigateView`, review R11: the person engaged the old page, not the
 *     agent's next one), and when the tab closes or changes hands. A
 *     navigation the page or the person makes does not clear it.
 *
 * WHY A PAGE PRESS NEEDS `synthetic`. Electron raises `before-mouse-event` from
 * the RenderWidgetHost's mouse-event callbacks
 * (`shell/browser/api/electron_api_web_contents.cc`, `OnMouseEvent` registered
 * with `RenderWidgetHostImpl::AddMouseEventCallback`), and DevTools'
 * `Input.dispatchMouseEvent` forwards through that same host, so the event
 * itself cannot tell a person from the agent. The host therefore passes the
 * pool's own record of an agent input command in flight for that view
 * (`CdpPool.isDispatchingInput`): a press seen while one is in flight is the
 * agent's and engages nothing (fail closed: a person pressing at that exact
 * moment simply has to press again). The window must also be focused and the
 * tab the active one \u2014 a person cannot press a page they cannot see.
 */
export interface PagePress {
	/** An agent's CDP input command was in flight for this view. */
	synthetic: boolean;
	windowFocused: boolean;
	/** The tab is the one the window shows. */
	active: boolean;
}

export class TabEngagement {
	private tabId: number | null = null;

	selected(tabId: number, trusted: boolean, windowFocused: boolean): void {
		if (trusted && windowFocused) this.tabId = tabId;
	}

	pagePressed(tabId: number, press: PagePress): void {
		if (!press.synthetic && press.windowFocused && press.active)
			this.tabId = tabId;
	}

	activated(tabId: number | null): void {
		if (this.tabId !== tabId) this.clearAll();
	}

	/** The person left the app: engagement is not carried across the absence. */
	windowBlurred(): void {
		this.clearAll();
	}

	clear(tabId: number): void {
		if (this.tabId === tabId) this.clearAll();
	}

	clearAll(): void {
		this.tabId = null;
	}

	has(tabId: number): boolean {
		return this.tabId === tabId;
	}
}
