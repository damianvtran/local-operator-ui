/**
 * Where passkey custody takes the user, and when it gives them back.
 *
 * WHY THIS EXISTS (UX round 1, U1; design D3). When a password manager's prompt
 * comes up in an agent-driven tab (`main/browser/extensions/passkey-custody.ts`)
 * the shell moves the user to it UNPROMPTED: the agent's conversation with its
 * browser pane open, or the browser route. Unlike a consent banner click, the
 * user did not choose that move, so once the hold ends they get their previous
 * view back: route, conversation (or draft), and the pane's open state for the
 * conversation they were already in.
 *
 * THE ONE RULE: give back ONLY if the user is still exactly where the handoff
 * put them. Anything else means they chose another view meanwhile (another
 * conversation, a route, closed the pane), and that choice is theirs to keep.
 * Main applies the same rule to the browser's active tab (`onEnd` there).
 *
 * IDENTITY, NOT TIMERS. A hold is `{tabId, at}`. A hold is snapshotted once:
 * a repeat attention for the same hold is ignored, so nothing here can be
 * driven into a loop by a page re-embedding the prompt document, and no rate
 * limit or cooldown is invented (main keeps one hold per tab until the user
 * returns it, so a new hold needs a human press first).
 *
 * OS FOCUS is out of reach here. Electron has no honest way to hand focus back
 * to another application, and the window raise already obeys the launch plan
 * (`window-raise.ts`: `inactive` never takes focus).
 *
 * PURE AND OUT OF THE SHELL, like `browser-consent-attention.ts`, so both
 * branches are asserted without a window (`scripts/passkey-custody.test.mjs`).
 */

/** The parts of the user's view custody may move. */
export interface CustodyViewSnapshot {
	pathname: string;
	activeSessionId: string | null;
	activeDraftKey: string | null;
	browserPaneOpen: boolean;
}

/** Where the handoff lands: `consentClickTarget`'s answer. */
export type CustodyHandoffTarget =
	| { kind: "conversation"; sessionId: string }
	| { kind: "browser" };

/** What the shell does to give the view back. Every field optional: only what
 * the handoff actually changed is undone. */
export interface CustodyRestorePlan {
	/** Re-open this draft (the user was composing a new chat). */
	openDraft?: string;
	/** Re-select this conversation. */
	session?: string | null;
	/** Close the browser pane the handoff opened in the SAME conversation. */
	closeBrowserPane?: true;
	navigate?: string;
}

interface Entry {
	before: CustodyViewSnapshot;
	handoff: CustodyViewSnapshot;
}

const keyOf = (tabId: number, at: number): string => `${tabId}:${at}`;

/** The view the handoff leaves the user in, from the one they were in. */
export function handoffView(
	target: CustodyHandoffTarget,
	before: CustodyViewSnapshot,
): CustodyViewSnapshot {
	if (target.kind === "browser") return { ...before, pathname: "/browser" };
	return {
		pathname: "/chat",
		activeSessionId: target.sessionId,
		activeDraftKey: null,
		browserPaneOpen: true,
	};
}

function sameView(a: CustodyViewSnapshot, b: CustodyViewSnapshot): boolean {
	return (
		a.pathname === b.pathname &&
		a.activeSessionId === b.activeSessionId &&
		a.activeDraftKey === b.activeDraftKey &&
		a.browserPaneOpen === b.browserPaneOpen
	);
}

/**
 * How to get from `handoff` back to `before`, or null when nothing changed.
 * The pane is only closed in the conversation the user was ALREADY in: the
 * pane state is per conversation, so re-selecting their own conversation
 * brings back its own pane, and closing a pane there would be a change of ours.
 */
export function restorePlan(
	before: CustodyViewSnapshot,
	handoff: CustodyViewSnapshot,
): CustodyRestorePlan | null {
	if (sameView(before, handoff)) return null;
	const plan: CustodyRestorePlan = {};
	if (before.activeDraftKey !== handoff.activeDraftKey && before.activeDraftKey)
		plan.openDraft = before.activeDraftKey;
	else if (before.activeSessionId !== handoff.activeSessionId)
		plan.session = before.activeSessionId;
	else if (before.browserPaneOpen === false && handoff.browserPaneOpen === true)
		plan.closeBrowserPane = true;
	if (before.pathname !== handoff.pathname) plan.navigate = before.pathname;
	return plan;
}

/** The handoffs in flight, by hold. One instance per shell. */
export class CustodyHandoffs {
	private readonly entries = new Map<string, Entry>();

	/**
	 * A hold's attention arrived. Returns the view to move to, or null when this
	 * hold was already handed off (a repeat for the same identity moves nothing).
	 */
	begin(
		hold: { tabId: number; at: number },
		target: CustodyHandoffTarget,
		current: CustodyViewSnapshot,
	): CustodyViewSnapshot | null {
		const key = keyOf(hold.tabId, hold.at);
		if (this.entries.has(key)) return null;
		const handoff = handoffView(target, current);
		this.entries.set(key, { before: current, handoff });
		return handoff;
	}

	/**
	 * The hold ended. Returns what to undo, or null when there is nothing to
	 * give back: an unknown hold, a handoff that changed nothing, or a user who
	 * has moved since (their choice stands).
	 */
	end(
		hold: { tabId: number; at: number },
		current: CustodyViewSnapshot,
	): CustodyRestorePlan | null {
		const key = keyOf(hold.tabId, hold.at);
		const entry = this.entries.get(key);
		this.entries.delete(key);
		if (!entry) return null;
		if (!sameView(current, entry.handoff)) return null;
		return restorePlan(entry.before, entry.handoff);
	}
}
