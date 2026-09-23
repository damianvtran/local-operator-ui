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

export function consentClickHandler(options: {
	window: ConsentClickWindow;
	show: "focus" | "inactive" | "never";
	report?: RaiseReport;
}): (entryId: string, requester: string) => void {
	return (entryId, requester) => {
		options.window.webContents.send("browser-consent-attention", {
			entryId,
			requesterSessionId: sessionRequesterOf(requester),
		});
		raiseWindow(options.window, options.show, {
			trigger: "banner-click",
			report: options.report,
		});
	};
}
