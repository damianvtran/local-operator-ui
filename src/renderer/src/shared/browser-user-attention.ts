/**
 * The browser's "waiting on you" notifications: what the sidebar lists, how many
 * the Browser badge counts, and where a click on one lands.
 *
 * WHY THIS EXISTS (operator report, 2026-11-15): the desktop app's browser was
 * "stealing the view" — a password manager's prompt in an agent's tab switched
 * the operator into the browser from wherever he was. His ask: "make sure that
 * any browser approvals, etc show up as notifications in the sidebar instead and
 * the user can then decide when they're able to interact with that instead of
 * forcing the interaction". So nothing here moves the view on ARRIVAL; a wait is
 * a row and a badge count, and the view moves only inside `openBrowserAttention`,
 * which only a row's click calls.
 *
 * THREE KINDS, ONE LIST. A site-access approval already lived in the projection's
 * `pendingConsent` (and its badge count); a passkey custody hold and a held popup
 * arrive in `waitingOnUser` (`main/browser/user-attention.ts`). The approvals
 * corner popup and its badge stay inside the Browser view — these rows are the
 * app-wide door to them, not a second place to answer.
 *
 * WHERE A CLICK LANDS is `consentClickTarget`'s rule, the one a consent banner's
 * click already follows: the conversation that owns the tab (with its browser pane
 * open) when it is one the app can show, the browser route otherwise.
 *
 * PURE: no React, no store, no `window.api` — the shell injects those — so every
 * branch is asserted without a window (`scripts/browser-user-attention.test.mjs`).
 */

import type { CustodyHandoffTarget } from "./browser-passkey-custody-handoff";

/** What a tab is waiting on, as main projects it (`waitingOnUser`). */
export interface WaitingOnUserInput {
	kind: "passkey" | "popup";
	tabId: number;
	at: number;
}

/** The projection fields the rows read. */
export interface BrowserAttentionState {
	tabs: ReadonlyArray<{
		tabId: number;
		url: string;
		sessionId?: string | null;
	}>;
	pendingConsent: ReadonlyArray<{
		entryId: string;
		origin: string;
		expiresAt: number;
		requesterSessionId: string | null;
	}>;
	waitingOnUser?: ReadonlyArray<WaitingOnUserInput>;
}

export type BrowserAttentionKind = "passkey" | "popup" | "site-access";

/** One sidebar notification row. */
export interface BrowserAttentionRow {
	/** Stable per wait: a React key and a test handle. */
	key: string;
	kind: BrowserAttentionKind;
	/** The tab to bring forward; null for an approval (it is answered in the
	 * approvals card, not in a tab). */
	tabId: number | null;
	/** The pending consent entry a click names; null for a tab wait. */
	entryId: string | null;
	/** The site, as an origin (`https://example.com`), or null for a tab with no
	 * http(s) page yet. Rendered as its host. */
	origin: string | null;
	/** The conversation the wait belongs to, or null for one no conversation
	 * owns. Resolved to a title by the component. */
	sessionId: string | null;
	/** For a custody hold: its identity, so the handoff can be given back. */
	at: number;
}

/** The origin of a live http(s) URL, or null. `about:blank`'s origin is the
 * string "null", which must not be printed as a site. */
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

const NONE: readonly WaitingOnUserInput[] = [];

/**
 * The rows, oldest wait first, then live approvals in the host's own FIFO order.
 *
 * A tab wait whose tab is not in the projection is dropped: its tab is gone and
 * so is the wait (main clears both together; this only covers the moment
 * between). An approval counts only while LIVE (`now < expiresAt`): main fires
 * nothing at expiry, the same rule `liveApprovalCount` follows.
 */
export function browserAttentionRows(
	state: BrowserAttentionState | null | undefined,
	now: number,
): BrowserAttentionRow[] {
	if (!state) return [];
	const rows: BrowserAttentionRow[] = [];
	const waits = [...(state.waitingOnUser ?? NONE)].sort((a, b) => a.at - b.at);
	for (const wait of waits) {
		const tab = state.tabs.find((candidate) => candidate.tabId === wait.tabId);
		if (!tab) continue;
		rows.push({
			key: `${wait.kind}:${wait.tabId}:${wait.at}`,
			kind: wait.kind,
			tabId: wait.tabId,
			entryId: null,
			origin: originOf(tab.url),
			sessionId: tab.sessionId ?? null,
			at: wait.at,
		});
	}
	for (const request of state.pendingConsent) {
		if (!(now < request.expiresAt)) continue;
		rows.push({
			key: `site-access:${request.entryId}`,
			kind: "site-access",
			tabId: null,
			entryId: request.entryId,
			origin: request.origin,
			sessionId: request.requesterSessionId,
			at: 0,
		});
	}
	return rows;
}

/** The parts of the user's view a click may move (the custody handoff's
 * snapshot shape). */
export interface AttentionViewSnapshot {
	pathname: string;
	activeSessionId: string | null;
	activeDraftKey: string | null;
	browserPaneOpen: boolean;
}

/** What the shell hands `openBrowserAttention`. */
export interface OpenBrowserAttentionDeps {
	/** `consentClickTarget` over the current session list. */
	target: (sessionId: string | null) => CustodyHandoffTarget;
	currentView: () => AttentionViewSnapshot;
	/** The custody handoffs; `begin` records the view to give back when the hold
	 * ends — ONLY here, so a give-back only ever undoes the user's own click. */
	beginCustodyHandoff: (
		hold: { tabId: number; at: number },
		target: CustodyHandoffTarget,
		current: AttentionViewSnapshot,
	) => void;
	/** `window.api.browser.openUserAttention`: main activates the tab and
	 * presents its held popups. Resolves `false` when main no longer has the tab
	 * (the hold ended between the projection and the click). */
	openTab: (tabId: number) => Promise<boolean>;
	/** `noteConsentAttention`: the approvals card selects the named request. */
	noteConsent: (entryId: string) => void;
	setActiveSession: (sessionId: string) => void;
	setBrowserPaneOpen: (open: boolean) => void;
	navigate: (path: string) => void;
}

/**
 * A row was clicked: the ONE place a browser wait moves the user's view. Lands
 * where a consent banner's click lands, with the wait visible — the custody band
 * on the activated tab, the held popup presented, the approvals card on the
 * named request.
 *
 * The tab is opened FIRST and its answer awaited (PR #1933 round 1, R2): a hold
 * can end between the projection and the click, and main then answers `false`.
 * Recording a custody handoff for that hold would leave an entry no `ended`
 * event ever closes, and navigating would land the user on a pane with nothing
 * waiting — so a `false` moves nothing and records nothing. The view to give
 * back is still snapshotted before the await: it must be the view the user
 * clicked from, not one a concurrent update produced.
 */
export async function openBrowserAttention(
	row: BrowserAttentionRow,
	deps: OpenBrowserAttentionDeps,
): Promise<void> {
	const target = deps.target(row.sessionId);
	if (row.kind === "site-access") {
		if (row.entryId) deps.noteConsent(row.entryId);
	} else if (row.tabId !== null) {
		const current = deps.currentView();
		if (!(await deps.openTab(row.tabId))) return;
		if (row.kind === "passkey")
			deps.beginCustodyHandoff(
				{ tabId: row.tabId, at: row.at },
				target,
				current,
			);
	}
	if (target.kind === "browser") {
		deps.navigate("/browser");
		return;
	}
	deps.setActiveSession(target.sessionId);
	deps.setBrowserPaneOpen(true);
	deps.navigate("/chat");
}

/**
 * Which rows ARRIVED since the last look, for the sidebar's polite live region
 * (PR #1933 round 1, U4: a row appearing was silent to assistive tech, and a
 * wait the user cannot see is a wait nobody answers).
 *
 * `seen === null` is the first look: everything already listed is the state the
 * user came to, not news, so it seeds the set and announces nothing — otherwise
 * collapsing and re-expanding the sidebar (which remounts the announcer) would
 * read every standing wait aloud again. A row that left and came back under the
 * same key is announced again, because it is a new wait.
 */
export function attentionArrivals(
	seen: ReadonlySet<string> | null,
	rows: readonly BrowserAttentionRow[],
): { arrivals: BrowserAttentionRow[]; seen: Set<string> } {
	const next = new Set(rows.map((row) => row.key));
	if (seen === null) return { arrivals: [], seen: next };
	return { arrivals: rows.filter((row) => !seen.has(row.key)), seen: next };
}
