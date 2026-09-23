import {
	type RaisableWindow,
	type RaiseReport,
	raiseWindow,
} from "../window-raise";
import { sessionRequesterOf } from "./host";

/**
 * What a consent banner's click does, as a function of its wiring.
 *
 * WHY THIS IS ITS OWN MODULE, and the reason is an observer rather than tidiness: a
 * native banner is raised only when the launch plan would itself have focused the
 * window (`show === "focus"`, `consent-notifier.ts`), and the runs this project can
 * automate are `headless` or `inactive` — so no automated run can ever produce the
 * click this function IS, and a rule with no observer is a rule that fails on the day
 * someone reorders it. Sitting beside `consent-notifier.ts` in its own file lets
 * `scripts/browser-host.test.mjs` drive the shipped function with a recording window,
 * which it cannot do for something buried in `startBrowserHost`'s forty options.
 *
 * THE ORDER IS THE RULE, and it is `desktop-notifier.ts`'s: name the request to the
 * renderer FIRST, then come forward. Raising first shows the window holding whatever
 * it was on for as long as the switch takes, which reads as a click that landed on the
 * wrong row.
 *
 * `sessionRequesterOf` is the SAME resolution the projection publishes
 * (`chromeState`'s `requesterSessionId`), so the conversation the renderer lands on is
 * the one whose badge counts the request — and a requester that names no conversation
 * arrives as `null`, which is what sends the click to the browser route instead.
 *
 * THE RAISE IS THE FIX for the operator's report (2026-09-23: "the click does nothing
 * and they must click the tab by hand"). Without it the click navigated a route behind
 * whatever they were looking at, which is the state the banner exists for (design
 * 9.2). It goes through `window-raise.ts` with the `banner-click` trigger, so the one
 * module that decides whether a window is shown still decides, and the one line that
 * answers "who took my focus" still names this act.
 */

/** The slice of the window a consent click touches: the renderer channel and
 * everything a raise needs. Structural, so the rule above is testable without
 * Electron — the same reason `window-raise.ts` declares its own window slice. */
export type ConsentClickWindow = RaisableWindow & {
	webContents: { send(channel: string, payload: unknown): void };
};

/** What the renderer is told, and what the no-window path has to carry forward. */
export interface ConsentAttentionPayload {
	entryId: string;
	requesterSessionId: string | null;
}

/** The channel the payload rides. Declared once: the preload subscribes to this
 * name and the no-window path below sends on it, which is the pair that has to
 * agree. */
export const CONSENT_ATTENTION_CHANNEL = "browser-consent-attention";

export function consentClickHandler(options: {
	/**
	 * The window to deliver to, ASKED FOR AT CLICK TIME rather than captured.
	 *
	 * This was a `BrowserWindow` instance, and that is what made the no-window case
	 * throw (UX review round 1, U2; measured on Electron 44.3.0: reading
	 * `webContents` on a destroyed window throws `Object has been destroyed`, and so
	 * does the send). A banner outlives its window: macOS keeps the raised banner in
	 * Notification Center, and its `click` listener is a closure on the notifier, so
	 * the click arrives into a main process whose window is gone — the app is alive
	 * in the Dock, which is exactly the operator's own state. `null` and `isDestroyed()`
	 * are the same event here and are answered the same way.
	 */
	window: () => ConsentClickWindow | null;
	show: "focus" | "inactive" | "never";
	report?: RaiseReport;
	/**
	 * Where the click goes when there is NO window to send to.
	 *
	 * The sibling completion banner states the rule (`desktop-notifier.ts`: "No
	 * window: the app is alive in the dock, which is the operator's own reported
	 * case. This used to return here, so the click did nothing at all"), and the app
	 * owns the answer because it owns window creation — `src/main/index.ts` parks the
	 * request and opens a window under the OPERATOR's plan, then delivers it when the
	 * renderer can hear it. Absent, a click with no window raises nothing and reports
	 * `banner-click` on the no-target line rather than throwing.
	 */
	reopen?: (payload: ConsentAttentionPayload) => void;
}): (entryId: string, requester: string) => void {
	return (entryId, requester) => {
		const payload: ConsentAttentionPayload = {
			entryId,
			requesterSessionId: sessionRequesterOf(requester),
		};
		const target = options.window();
		if (target === null || target.isDestroyed()) {
			if (options.reopen) {
				options.reopen(payload);
				return;
			}
			options.report?.(
				"trigger=banner-click mode=none requested=no-window reason=no-target",
			);
			return;
		}
		target.webContents.send(CONSENT_ATTENTION_CHANNEL, payload);
		raiseWindow(target, options.show, {
			trigger: "banner-click",
			report: options.report,
		});
	};
}
