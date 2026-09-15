/**
 * The only place in the main process that raises or focuses a window.
 *
 * Why it is its own module. `ready-to-show` used to call `show()`
 * unconditionally, so every agent-driven launch activated the app and took the
 * operator's keyboard focus. The fix is a gate, and a gate is only worth
 * anything if it is the ONLY way through: a single stray `window.show()`
 * re-breaks the operator's focus, and — measured on Electron 35.5.1 / macOS —
 * `focusable: false` does not save you. `NativeWindowMac::Show()` calls
 * `activateIgnoringOtherApps:YES` for every non-panel window whatever
 * `focusable` says, so a non-focusable window that is shown still makes the app
 * frontmost while `isFocused()` keeps reading false. The policy therefore has
 * to live at the call sites, and every call site is in this file.
 *
 * `scripts/window-mode.test.mjs` asserts both halves: that this module applies
 * the policy correctly (with a fake window, per mode) and that no other file
 * under `src/main/` calls `show`, `showInactive` or `focus` on a window.
 *
 * EVERY RAISE NAMES ITS TRIGGER, and reports one line through the caller's
 * logger. This file used to log nothing, which is why the operator's report —
 * "the app steals my focus whenever a chat completes" — was unanswerable on the
 * machine where it happened: five causes raise a window here, from an ordinary
 * launch to a second instance sharing the profile, a clicked banner, the viewer's
 * focus endpoint and a conversation delivered to a window, and nothing recorded
 * which one had just taken the focus. The trigger is a required part of the call
 * so a new raise cannot be added anonymously, and `never` — the path that raises
 * nothing — is deliberately silent: a headless run's whole value is that it leaves
 * no trace on the machine, its logs included.
 *
 * The parameter type is the slice of `BrowserWindow` a raise touches, so the
 * policy is testable in process without Electron — the same reason
 * `window-mode.ts` imports nothing from Electron either.
 */

import { readOpenSessionArgv } from "../shared/open-session";
import type { WindowShow } from "./window-mode";
import { resolveSecondLaunchShow } from "./window-mode";

/** The slice of `BrowserWindow` that raising a window touches. */
export interface RaisableWindow {
	show(): void;
	showInactive(): void;
	focus(): void;
	isMinimized(): boolean;
	restore(): void;
}

/**
 * Why a window is coming forward. One name per call site, so the log line that
 * answers "who took my focus" cannot be reduced to "something did".
 *
 * `open-conversation` names what the raise DOES rather than who asked for it,
 * because that site is shared: a banner click's recreate path, the viewer's
 * `resume_session` and a second launch that named a conversation all deliver to
 * the renderer first and then come forward through the same function.
 */
export type RaiseTrigger =
	| "initial-present"
	| "second-instance"
	| "banner-click"
	| "viewer-focus"
	| "open-conversation";

/** Where a raise's one line goes. Omitted means silent, never "unordered". */
export type RaiseReport = (line: string) => void;

export interface RaiseContext {
	trigger: RaiseTrigger;
	report?: RaiseReport;
}

/**
 * The line one raise reports: what asked for the window, how far the launch plan
 * allowed it to come, and the calls that actually happened.
 *
 * `applied` is read off the calls rather than derived from `requested`, so the
 * line is evidence about this process's window rather than a restatement of the
 * decision: a line that says `applied=show+focus` is one the operator can match
 * against the focus they just lost.
 */
function raiseLine(
	trigger: RaiseTrigger,
	requested: WindowShow,
	applied: readonly string[],
): string {
	return `trigger=${trigger} requested=${requested} applied=${applied.join("+")}`;
}

/**
 * What `ready-to-show` does: bring the window up the way the launch plan
 * allows.
 *
 * `normal` and the released app are the same call — `show()`, which focuses the
 * window on every platform. It deliberately does NOT add an explicit `focus()`:
 * that is not what shipped, and the point of `normal` is that nothing about a
 * person's launch changed.
 */
export function presentWindow(
	window: RaisableWindow,
	show: WindowShow,
	context: RaiseContext,
): void {
	if (show === "never") return;
	const applied: string[] = [];
	if (window.isMinimized()) {
		window.restore();
		applied.push("restore");
	}
	if (show === "inactive") {
		window.showInactive();
		applied.push("showInactive");
	} else {
		window.show();
		applied.push("show");
	}
	context.report?.(raiseLine(context.trigger, show, applied));
}

/**
 * What a second launch or a clicked notification banner asks for: bring this
 * window to the operator.
 *
 * In `normal` this is one `show()` more than the pre-change second-instance
 * path made, which restored and focused only. That is deliberate rather than
 * indistinguishable: the app HAS a hide path (`{ role: "hide" }`, Cmd+H), so
 * after the operator hides the window a second launch or a banner click now
 * brings it back instead of focusing it while it stays hidden — which is what
 * asking for the window means. The uniform sequence is the point: one function
 * decides, so a mode cannot be half-applied at one call site and not the other.
 *
 * It ends focused only in `normal`. `inactive` orders the window without
 * activating the app, and `headless` does nothing here at all — the caller
 * still delivers the conversation to the renderer, so the window holds the
 * right screen while staying off screen, which is what the mode promises. If
 * this path could raise a headless window, a notification click during a QA run
 * would be the one thing that interrupts the operator.
 */
export function raiseWindow(
	window: RaisableWindow,
	show: WindowShow,
	context: RaiseContext,
): void {
	if (show === "never") return;
	const applied: string[] = [];
	if (window.isMinimized()) {
		window.restore();
		applied.push("restore");
	}
	if (show === "inactive") {
		window.showInactive();
		applied.push("showInactive");
	} else {
		window.show();
		window.focus();
		applied.push("show", "focus");
	}
	context.report?.(raiseLine(context.trigger, show, applied));
}

/**
 * What a second launch asks this process to do, resolved from the two channels
 * Electron hands the winner: the losing process's `commandLine`, and the payload
 * it attached to its attempt at the single-instance lock.
 *
 * The CONVERSATION is read from the command line alone, and always: an id is
 * something the request names, never the process's own plan, so there is nothing
 * for a payload to add to it.
 */
export interface SecondLaunchRequest {
	/** The conversation the launch named, or null when it named none. */
	session: string | null;
	/** How far the window may come forward, as the REQUESTING launch resolved it. */
	show: WindowShow;
}

export function readSecondLaunchRequest(input: {
	commandLine?: readonly string[];
	additionalData?: unknown;
}): SecondLaunchRequest {
	const commandLine = input.commandLine ?? [];
	return {
		session: readOpenSessionArgv(commandLine),
		show: resolveSecondLaunchShow({
			argv: commandLine,
			additionalData: input.additionalData,
		}),
	};
}

/**
 * What a second launch does to this process, as plain callbacks.
 *
 * Split from the `second-instance` handler so the rule this change is about —
 * "the window comes forward only as far as the REQUESTING launch asked" — is
 * testable in process, with a fake window, rather than only observable by
 * launching a second app on somebody's desktop.
 */
export interface SecondLaunchTarget {
	/** This process's window, or null when it has none. */
	window: RaisableWindow | null;
	/**
	 * Deliver a named conversation to this process's renderer, creating a window
	 * when there is none. Null while this process is still starting.
	 */
	openConversation:
		| ((sessionId: string | null, show: WindowShow) => void)
		| null;
	/** Park a conversation that arrived before there was anywhere to deliver it. */
	queue: (sessionId: string, show: WindowShow) => void;
	report?: RaiseReport;
}

/**
 * Apply a second launch.
 *
 * A NAMED CONVERSATION IS DELIVERED WHATEVER THE MODE SAYS (the defect this
 * whole path exists for was a click that silently did nothing), and the raise
 * that follows it is the only part the mode governs — which is why a `headless`
 * request still moves the window's CONTENT to the right conversation while
 * leaving the window itself where it was.
 */
export function applySecondLaunch(
	request: SecondLaunchRequest,
	target: SecondLaunchTarget,
): void {
	if (request.session !== null) {
		if (target.openConversation) {
			target.openConversation(request.session, request.show);
		} else {
			target.queue(request.session, request.show);
		}
		return;
	}
	if (!target.window) return;
	raiseWindow(target.window, request.show, {
		trigger: "second-instance",
		report: target.report,
	});
}
