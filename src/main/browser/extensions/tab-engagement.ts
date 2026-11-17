/**
 * Has a PERSON engaged this agent tab? The gate in front of passkey custody.
 *
 * WHY (operator report 2026-11-17). 1Password's passive inline autofill card
 * ("Sign in" / Other logins) is rendered in the same extension document as its
 * passkey prompts, so it appears on every login form — including the login pages
 * an agent navigates to on its own. Custody used to admit it on sight, which
 * paused the agent and raised "Password manager needs you" on tabs nobody was
 * looking at. The operator's rule: a hand-off can only follow a person clicking
 * into / focusing that agent tab and interacting; an agent opening a tab or
 * navigating to a login page must produce nothing. Before engagement the frame
 * is refused exactly as it was before custody existed (`subframe-policy.ts`).
 *
 * THE SIGNAL is the tab view's native `focus` event (`wireView` in `index.ts`),
 * counted only when, at that moment, the tab is the registry's active tab, its
 * page is presented, and the window itself is focused — the same facts
 * `userTabFocused` uses. Not `before-input-event`/`input-event`: CDP
 * `Input.dispatch*` travels the same RenderWidgetHost input path, so those
 * cannot tell an agent from a person. Agent CDP input does not activate the
 * window or the tab (`actions/input.ts`), and an agent cannot raise the window
 * (`window-raise.ts`). Whether CDP input can ever fire native `focus` on a
 * presented tab in a focused window is a QA negative control, not a measured
 * fact yet.
 *
 * LIFETIME: a latch with no timer. Cleared when another tab is activated, the
 * tab closes, the tab changes hands, or the person clicks the app's own chrome
 * or chat. NOT cleared on window or page blur: the OS biometric sheet and the
 * 1Password app both take window focus in the middle of the very ceremony this
 * latch exists to admit.
 */

export interface EngagementFacts {
	/** The registry's active tab id, or null. */
	activeTabId: number | null;
	/** Whether the active tab's page is presented in the window. */
	presented: boolean;
	/** Whether the host window itself has OS focus. */
	windowFocused: boolean;
}

export class TabEngagement {
	private readonly engaged = new Set<number>();

	/** The tab view's native `focus` fired. Returns whether it now counts. */
	focused(tabId: number, facts: EngagementFacts): boolean {
		if (facts.activeTabId !== tabId || !facts.presented || !facts.windowFocused)
			return false;
		this.engaged.add(tabId);
		return true;
	}

	/** Another tab became active: only that tab may stay engaged, and only if a
	 * person focuses it again. */
	activated(tabId: number | null): void {
		for (const id of [...this.engaged])
			if (id !== tabId) this.engaged.delete(id);
	}

	/** The tab closed or changed hands. */
	clear(tabId: number): void {
		this.engaged.delete(tabId);
	}

	/** The person clicked the app's own chrome or chat. */
	clearAll(): void {
		this.engaged.clear();
	}

	has(tabId: number): boolean {
		return this.engaged.has(tabId);
	}
}

/**
 * The admission gate `will-frame-navigate` applies to a password manager's
 * frame in an agent tab: `admit` (which puts the custody hold in place) is
 * called ONLY when a person engaged the tab. Not engaged → it is never called,
 * and the caller refuses the frame exactly as before custody existed.
 */
export function admitIfEngaged(
	engagement: Pick<TabEngagement, "has">,
	tabId: number,
	admit: () => boolean,
): boolean {
	return engagement.has(tabId) && admit();
}
