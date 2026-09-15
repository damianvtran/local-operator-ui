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
import { readWindowIntent, resolveSecondLaunchShow } from "./window-mode";

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
 * THE NAMES ARE THE REQUEST, NOT THE MECHANISM. Three of these used to report a
 * single `open-conversation`, which made the second launch that names a
 * conversation, a clicked banner's recreate path and the viewer's
 * `resume_session` indistinguishable in the log — the one line whose whole job is
 * to tell those apart (review round 1, and UX U2). A site that delivers a
 * conversation before raising now names the requester that asked for it, and
 * `viewer-resume` and `viewer-focus` are separate verbs of one control endpoint
 * because they are separate requests: one opens a conversation, the other only
 * raises the window.
 */
export type RaiseTrigger =
	| "initial-present"
	| "second-instance"
	| "banner-click"
	| "viewer-focus"
	| "viewer-resume";

/**
 * Who asked for the window, when the caller can say.
 *
 * Both fields are DECLARED by the requester across the single-instance boundary
 * (see `window-mode.ts`'s payload), so they are diagnostic only: nothing is ever
 * decided from them. They exist because "a second launch did it" is as far as a
 * reader gets on a machine where several agents and scripts launch this app at
 * once, and the thing they can act on — which process to stop — is the pid.
 */
export interface RaiseRequester {
	pid?: number;
	cwd?: string;
}

/** Where a raise's one line goes. Omitted means silent, never "unordered". */
export type RaiseReport = (line: string) => void;

export interface RaiseContext {
	trigger: RaiseTrigger;
	/** Absent for a request this process made to itself. */
	requester?: RaiseRequester;
	report?: RaiseReport;
}

/**
 * The mode a raise happened under, from the show plan it was allowed.
 *
 * The mapping is one-to-one (`WINDOW_BEHAVIOUR` in `window-mode.ts`), so the
 * line can name the MODE a reader greps for without a second parameter threaded
 * to every call site — and `focus` alone is not a mode, which is why the line
 * used to be ungreppable for the ordinary launch (review round 1).
 */
const MODE_OF_SHOW: Record<WindowShow, string> = {
	focus: "normal",
	inactive: "inactive",
	never: "headless",
};

/**
 * The line one raise reports: what asked for the window, the mode it ran under,
 * how far the launch plan allowed it to come, and the calls that actually
 * happened.
 *
 * `applied` is read off the calls rather than derived from `requested`, so the
 * line is evidence about this process's window rather than a restatement of the
 * decision: a line that says `applied=show+focus` is one the operator can match
 * against the focus they just lost. `pid`/`cwd` are printed only when the
 * requester declared them, so a line without them means "this process asked".
 */
function requesterFields(context: RaiseContext): string[] {
	const who = context.requester;
	return [
		who?.pid === undefined ? null : `pid=${who.pid}`,
		who?.cwd === undefined ? null : `cwd=${who.cwd}`,
	].filter((field) => field !== null);
}

function raiseLine(
	context: RaiseContext,
	requested: WindowShow,
	applied: readonly string[],
): string {
	return [
		`trigger=${context.trigger}`,
		`mode=${MODE_OF_SHOW[requested]}`,
		`requested=${requested}`,
		...requesterFields(context),
		`applied=${applied.join("+")}`,
	].join(" ");
}

/**
 * What `ready-to-show` does: bring the window up the way the launch plan
 * allows.
 *
 * `normal` and the released app are the same call — `show()`, which focuses the
 * window on every platform. It deliberately does NOT add an explicit `focus()`:
 * that is not what shipped, and the point of `normal` is that nothing about a
 * person's launch changed.
 *
 * The `restore()` below is the same call `raiseWindow` makes, kept here so the
 * two paths read alike: a window being presented for the FIRST time cannot be
 * minimised, so it never fires on this path, and the rule that a request must
 * not un-minimise a window the operator put away lives in `raiseWindow`.
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
	context.report?.(raiseLine(context, show, applied));
}

/**
 * Whether a request that arrived at an app with NO window may create one.
 *
 * `never` IS THE ONE SHOW PLAN THAT MAY NOT, and not because of the focus grab —
 * a window that is never presented takes nothing from the operator. It is because
 * the window would be INVISIBLE AND REAL: macOS keeps the app alive with the
 * renderer warm, so the operator is left with an app whose Dock icon activates
 * nothing (the `activate` handler only creates a window when there are NONE) and
 * a conversation they cannot reach. That is a worse state than the focus theft
 * this path exists to remove.
 *
 * So a `never` request parks its conversation instead of building that window,
 * and the operator's next window — their own launch, a Dock click, a banner click
 * — opens it (`index.ts` owns the queue; the policy is here so it can be unit
 * tested, and so no future show plan can be invented without answering this
 * question). Nothing appears, nothing is raised, and nothing is lost.
 */
export function canCreateWindowFor(show: WindowShow): boolean {
	return show !== "never";
}

/**
 * The plan the OPERATOR'S OWN request presents under — a Dock click, the menu's
 * open, a launch they made themselves.
 *
 * NOT the process's own launch plan, deliberately (UX review round 2, U6). The
 * window mode is a promise about the LAUNCH: an agent's run must not grab focus
 * by starting. `app.on("activate")` is the other direction — a person clicking the
 * Dock icon of an app that has no window — and answering that with a window nobody
 * can see is the worse failure: for a `headless`-plan process `presentWindow(...,
 * "never")` shows nothing, so the window would be real, invisible, and holding the
 * parked conversation the queue had just handed it. The operator asked; the window
 * comes forward.
 */
export const OPERATOR_SHOW: WindowShow = "focus";

/**
 * Report that a request was PARKED rather than delivered or raised.
 *
 * Why a park is not silent like `never`: the request asked for something that has
 * not happened yet, and the losing launch was told so. Without this line the log's
 * answer to "what happened to what I asked for" is nothing at all — the winner
 * creates no window and raises nothing, so there is no other line to find (UX
 * review round 2, U5). `parked=<session>` is the conversation that is waiting.
 */
export function reportParked(session: string, context: RaiseContext): void {
	reportParkState([session], "parked", context);
}

/**
 * The park lines other than the park itself, in one shape so a reader greps one
 * token and finds every state a waiting conversation can be in.
 *
 * WHY EACH ONE EXISTS. A park is a promise to a losing launch that the conversation
 * will be delivered once a window is open, and the log is the only place that
 * promise can be checked, so every way it can end is a line: `delivered` (it
 * arrived), `left+waiting` (the window that claimed it died first, and it is STILL
 * queued rather than lost — review/QA round 3), `evicted` (the queue is bounded and
 * this one was dropped to hold the bound), `dropped+app-quit` (it died with the
 * process). Without the last two the queue's own limits would be invisible, which
 * is the same silence the park line was added to remove (UX round 3, U2).
 */
function reportParkState(
	sessions: readonly string[],
	applied: string,
	context: RaiseContext,
): void {
	context.report?.(
		[
			`trigger=${context.trigger}`,
			`mode=${MODE_OF_SHOW.never}`,
			"requested=never",
			`parked=${sessions.join(",")}`,
			...requesterFields(context),
			`applied=${applied}`,
		].join(" "),
	);
}

/** A parked conversation actually reached a renderer: the loop closes (UX U2). */
export function reportParkedDelivered(
	session: string,
	context: RaiseContext,
): void {
	reportParkState([session], "delivered", context);
}

/**
 * A window that claimed parked conversations died before delivering them.
 *
 * This is a state, not a loss: the entries never left the queue, so the operator's
 * next window opens them — the line says which ones are still waiting (review round
 * 3, MINOR-1 / QA round 3, Q-1).
 */
export function reportParkedLeftWaiting(
	sessions: readonly string[],
	context: RaiseContext,
): void {
	reportParkState(sessions, "left+waiting", context);
}

/** The oldest waiting conversation was dropped to hold the queue's bound. */
export function reportParkedEvicted(
	session: string,
	context: RaiseContext,
): void {
	reportParkState([session], "evicted", context);
}

/**
 * Conversations still waiting when the process quit. No `RaiseContext` because
 * nothing was requested here: this is the queue reporting its own end, which is
 * otherwise a silence indistinguishable from a delivery.
 */
export function reportParksAtQuit(
	sessions: readonly string[],
	report: RaiseReport,
): void {
	report(
		[
			"trigger=app-quit",
			`mode=${MODE_OF_SHOW.never}`,
			"requested=never",
			`parked=${sessions.join(",")}`,
			"applied=dropped+quit",
		].join(" "),
	);
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
 *
 * ONLY A FOCUS-CLASS REQUEST RESTORES A MINIMISED WINDOW (UX review U3).
 * `restore()` takes a window back out of the Dock, which is not what "visible,
 * never activated" asks for: a run that deliberately does not want to be in
 * front has no business putting a window the operator pushed aside back over
 * their work, where their next keystroke still would not reach it. An undeclared
 * or `normal` request is the one that means "bring this to me", and it keeps
 * restoring.
 *
 * AND `showInactive()` IS NOT A WAY AROUND THAT. Removing the explicit
 * `restore()` was not enough on its own: macOS deminiaturises a window as part of
 * ordering it, so a `showInactive()` on a Dock-ed window brought it back anyway —
 * measured, that window's state went `minimized: true` -> `false` with
 * `applied=showInactive` and no `restore` in the line. An `inactive` request
 * therefore leaves a minimised window exactly where it is and only orders one
 * that is already on screen.
 */
export function raiseWindow(
	window: RaisableWindow,
	show: WindowShow,
	context: RaiseContext,
): void {
	if (show === "never") return;
	const applied: string[] = [];
	if (show === "inactive") {
		if (window.isMinimized()) {
			/*
			 * DECLINED, AND SAID SO (review round 2, MINOR-1). The behaviour is right —
			 * an `inactive` request must not un-minimise — but returning silently made a
			 * request that was declined indistinguishable from one that never arrived,
			 * and the loser had been told the running app "may order its window forward".
			 * `never` stays silent: that is the documented promise of a mode that raises
			 * nothing, and there is no declined request in it.
			 */
			context.report?.(raiseLine(context, show, ["skipped", "minimised"]));
			return;
		}
		window.showInactive();
		applied.push("showInactive");
	} else {
		if (window.isMinimized()) {
			window.restore();
			applied.push("restore");
		}
		window.show();
		window.focus();
		applied.push("show", "focus");
	}
	context.report?.(raiseLine(context, show, applied));
}

/**
 * What a second launch asks this process to do, resolved from the two channels
 * Electron hands the winner: the losing process's `commandLine`, and the payload
 * it attached to its attempt at the single-instance lock.
 *
 * The CONVERSATION is read from the command line alone, and always: an id is
 * something the request names, never the process's own plan, so there is nothing
 * for a payload to add to it.
 *
 * The REQUESTER's identity is not read for a decision either. It is what the
 * other process said about itself, printed so a reader with several agents on one
 * machine can tell which one asked (UX review U2).
 */
export interface SecondLaunchRequest {
	/** The conversation the launch named, or null when it named none. */
	session: string | null;
	/** How far the window may come forward, as the REQUESTING launch resolved it. */
	show: WindowShow;
	/**
	 * Who asked, for the log line only. `null` when the requester declared
	 * nothing this build can read; `cwd` falls back to the working directory
	 * Electron reports for the second instance, which is always there.
	 */
	requester: RaiseRequester | null;
}

export function readSecondLaunchRequest(input: {
	commandLine?: readonly string[];
	additionalData?: unknown;
	workingDirectory?: string;
}): SecondLaunchRequest {
	const commandLine = input.commandLine ?? [];
	const intent = readWindowIntent(input.additionalData);
	const requester: RaiseRequester = {};
	if (intent?.pid !== undefined) requester.pid = intent.pid;
	const cwd = intent?.cwd ?? input.workingDirectory;
	if (cwd !== undefined && cwd !== "") requester.cwd = cwd;
	return {
		session: readOpenSessionArgv(commandLine),
		show: resolveSecondLaunchShow({
			argv: commandLine,
			additionalData: input.additionalData,
		}),
		requester: Object.keys(requester).length === 0 ? null : requester,
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
	 *
	 * It receives the whole REQUEST rather than just the show plan, because the
	 * window it may have to create has to be created under the requester's plan
	 * too. A `headless` request against a process with no window is still a window
	 * that must never be shown (review round 1, MAJOR), and the requester's
	 * identity belongs on the line whichever branch ran (UX review U2).
	 */
	openConversation:
		| ((sessionId: string, request: SecondLaunchRequest) => void)
		| null;
	/**
	 * Park a conversation that arrived before there was anywhere to deliver it.
	 */
	queue: (sessionId: string, request: SecondLaunchRequest) => void;
	/**
	 * Open this app's OWN window — the default view — when a request arrives at an
	 * app that has none and there is nothing to deliver to it.
	 *
	 * Why this exists: a windowless winner used to ignore this request entirely
	 * (`if (!target.window) return`), so the operator launching the app again while
	 * it ran saw NOTHING appear — and, with a conversation parked for the next
	 * window, nothing ever opened it. It is also the path the parked conversation
	 * rides in on: the window this creates is created under the request's plan and
	 * consumes whatever is parked as its initial session.
	 */
	openWindow?: ((request: SecondLaunchRequest) => void) | null;
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
 *
 * The `openConversation` target may itself PARK the conversation rather than
 * deliver it: when this app has no window open and the request must not be shown,
 * building one would leave an invisible window holding a screen nobody can reach,
 * so the conversation waits for the operator's next window instead
 * (`canCreateWindowFor`, and the queue in `index.ts`).
 */
export function applySecondLaunch(
	request: SecondLaunchRequest,
	target: SecondLaunchTarget,
): void {
	if (request.session !== null) {
		if (target.openConversation) {
			target.openConversation(request.session, request);
		} else {
			target.queue(request.session, request);
		}
		return;
	}
	if (!target.window) {
		/*
		 * Nothing to raise and nothing to deliver — but the request may still be one
		 * that asks for the app: a person launching it again, or a run that declares
		 * `inactive`. `headless` is not, which is the whole of that mode's promise.
		 */
		if (canCreateWindowFor(request.show)) target.openWindow?.(request);
		return;
	}
	raiseWindow(target.window, request.show, {
		trigger: "second-instance",
		requester: request.requester ?? undefined,
		report: target.report,
	});
}
