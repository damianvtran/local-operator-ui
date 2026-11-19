/**
 * What an agent-driven tab is waiting on a PERSON for, held until that person
 * chooses to look.
 *
 * WHY THIS MODULE EXISTS (operator report, 2026-11-15): the desktop app's browser
 * was "stealing the view". A password manager's passkey prompt in an agent's tab
 * made main activate that tab, raise the window (`raiseWindow`, trigger
 * `passkey-custody`) and push an attention event the shell answered by navigating
 * to the browser — from wherever the operator was in the app, mid-sentence or
 * not. A sign-in popup an agent's page opened was shown on screen the moment it
 * existed. The operator's ask: "make sure that any browser approvals, etc show up
 * as notifications in the sidebar instead and the user can then decide when
 * they're able to interact with that instead of forcing the interaction".
 *
 * THE RULE THIS MODULE ENCODES: nothing an agent's tab does may change what the
 * user is looking at. A wait is RECORDED here and projected (`chromeState`'s
 * `waitingOnUser`), the renderer draws it as the Browser row's badge and a
 * sidebar notification row, and only the user's click on that row
 * (`browser-open-user-attention`, sender-checked in `ipc.ts`) activates the tab
 * and presents what was held. The agent keeps waiting meanwhile: custody has no
 * timer (`passkey-custody.ts`) and a held popup simply stays hidden, so not
 * coming over is never a failure.
 *
 * NO WINDOW CALL LIVES HERE. Presentation still goes through `window-raise.ts`
 * (the only module allowed to show a window; `scripts/window-mode.test.mjs`
 * scans for it): this module only decides WHEN, and hands the window to an
 * injected `present`. Pure and Electron-free so the "no raise, no activation"
 * half is asserted in process (`scripts/browser-user-attention.test.mjs`).
 */

/** What a tab is waiting on. `passkey`: a password manager's prompt under a
 * custody hold. `popup`: a sign-in (or other opener-bearing) window an agent's
 * page opened, held hidden. Site-access approvals are NOT here: they already
 * travel in `pendingConsent` and the renderer folds them into the same rows. */
export type UserAttentionKind = "passkey" | "popup";

/** One wait, as projected. Ids and a time only: the renderer resolves the tab's
 * origin and conversation from the same projection's `tabs`, so nothing here is
 * a second truth about either. */
export interface UserAttentionEntry {
	kind: UserAttentionKind;
	tabId: number;
	/** When the wait began (the custody hold's `at`, or when the first held
	 * popup arrived) — the row's identity and its order. */
	at: number;
}

/** The slice of the tab registry the custody wiring touches. */
export interface AttentionRegistry {
	exists(tabId: number): boolean;
	activeTabId(): number | null;
	activate(tabId: number): void;
}

/** The custody view the hold callbacks receive (`passkey-custody.ts`). */
export interface HeldView {
	tabId: number;
	at: number;
}

export interface CustodyAttentionDeps {
	registry: AttentionRegistry;
	/** The band beside a prompt the user can now see would contradict it. */
	clearNotice: (tabId: number) => void;
	/** Re-publish the projection, so the row appears/clears. */
	notifyChanged: () => void;
	/** Tell the renderer the hold ended, so a handoff the user CHOSE (by
	 * clicking the row) can give their view back. */
	sendEnded: (view: HeldView) => void;
}

/**
 * The custody hold's begin/end, without the view steal.
 *
 * `onBegin` used to activate the held tab, remember the tab it displaced and
 * raise the window. Now it only re-publishes (and clears a stale notice band):
 * the hold is listed in the projection and the user decides. The "give back the tab you were on" memory
 * is taken at `userOpened` instead — the moment the user actually moves — so it
 * is only ever undoing a move the user made from the notification, never one
 * nobody asked for.
 */
export function createCustodyAttention(deps: CustodyAttentionDeps): {
	onBegin: (view: HeldView) => void;
	onEnd: (view: HeldView) => void;
	userOpened: (tabId: number) => void;
} {
	const returnTab = new Map<number, number | null>();
	return {
		onBegin: (view) => {
			// A "request still pending / did not complete" band left from before the
			// hold would contradict the custody band if the user reaches the held tab
			// their own way (the tab strip, not the row). Clearing it moves no view
			// (PR #1933 round 1, R1).
			deps.clearNotice(view.tabId);
			deps.notifyChanged();
		},
		onEnd: (view) => {
			// Whatever the page's request reported while the user had it (their own
			// cancel in the provider's window is a NotAllowed too) is not a failure to
			// explain afterwards.
			deps.clearNotice(view.tabId);
			const previous = returnTab.get(view.tabId);
			returnTab.delete(view.tabId);
			// Given back ONLY if the user is still on the custody tab: a tab they
			// chose meanwhile is theirs.
			if (
				previous !== undefined &&
				previous !== null &&
				deps.registry.activeTabId() === view.tabId &&
				deps.registry.exists(previous)
			)
				deps.registry.activate(previous);
			else deps.notifyChanged();
			deps.sendEnded(view);
		},
		userOpened: (tabId) => {
			if (!deps.registry.exists(tabId)) return;
			deps.clearNotice(tabId);
			if (!returnTab.has(tabId)) {
				const previous = deps.registry.activeTabId();
				returnTab.set(tabId, previous === tabId ? null : previous);
			}
			deps.registry.activate(tabId);
		},
	};
}

/** The slice of a popup window this module touches. */
export interface HeldWindow {
	isDestroyed(): boolean;
}

/**
 * Popup windows an agent's page opened, held hidden until the user asks.
 *
 * WHY HIDDEN AND NOT `inactive`: `inactive` (`showInactive`) never activates the
 * app, but on macOS it still orders the window in front of whatever the operator
 * is doing in ANY app — the view is taken even when the focus is not. A held
 * popup still exists and runs (the page's `window.opener` contract, CDP), so an
 * agent can drive a sign-in that needs nobody and the row clears when it closes;
 * one that needs a person waits for the click.
 *
 * Created with `focusable: true` by the caller (the open handler's options read
 * the opener's presentation, which is `inactive` for an agent opener), so a
 * window presented later takes keystrokes like any other.
 */
export class HeldPopups<W extends HeldWindow> {
	private readonly byTab = new Map<number, { at: number; windows: Set<W> }>();

	constructor(private readonly now: () => number = Date.now) {}

	hold(tabId: number, window: W): void {
		const entry = this.byTab.get(tabId) ?? {
			at: this.now(),
			windows: new Set(),
		};
		entry.windows.add(window);
		this.byTab.set(tabId, entry);
	}

	/** A held window closed (or was presented): forget it, and the tab's entry
	 * with its last window. Returns whether anything changed. */
	release(window: W): boolean {
		for (const [tabId, entry] of this.byTab) {
			if (!entry.windows.delete(window)) continue;
			if (entry.windows.size === 0) this.byTab.delete(tabId);
			return true;
		}
		return false;
	}

	/** The user asked: hand over every live held window of this tab and forget
	 * them (a presented window is no longer waiting). */
	take(tabId: number): W[] {
		const entry = this.byTab.get(tabId);
		this.byTab.delete(tabId);
		if (!entry) return [];
		return [...entry.windows].filter((window) => !window.isDestroyed());
	}

	entries(): UserAttentionEntry[] {
		return [...this.byTab].map(([tabId, entry]) => ({
			kind: "popup",
			tabId,
			at: entry.at,
		}));
	}
}

/**
 * Whether a popup window should be HELD rather than presented. Only an agent
 * opener's window is held, and only when the launch plan would show it at all
 * (`never` is already hidden for good, with nobody to click a row). A user's own
 * popup is the one they just clicked for and keeps its presentation.
 */
export function holdsPopup(
	openerOwner: "user" | "agent" | null,
	presentation: "focus" | "inactive" | "never",
): boolean {
	return openerOwner === "agent" && presentation !== "never";
}
