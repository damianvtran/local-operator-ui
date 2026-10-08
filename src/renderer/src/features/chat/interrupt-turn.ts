/**
 * Stopping the current turn without ending the session: one write path, one
 * copy table.
 *
 * Every way a user can ask for this lands here - the composer's Stop control and
 * the Escape that is its accelerator - so the request and the sentence that
 * follows it cannot drift between two surfaces that answer the same question.
 *
 * WHAT THIS REPLACED, because the bug is the reason the module exists. The Stop
 * control used to post `{op: "sessions.command", command: "stop"}`, and that
 * route answers a CATALOGUE command: `"stop"` is not in the backend's
 * `OWNER_COMMANDS`, so the reply was a presentation form - HTTP 200, a
 * `native_action` whose destination is `sessions.stop`, i.e. "ask the client to
 * open the session-stop picker" - and a turn that was still streaming. A 200 and
 * a resolved promise read exactly like a stop that worked, which is why the
 * defect was found by measuring the session rather than by reading the button.
 *
 * THE RUNG, which is the other half of the same mistake and the reason nothing
 * here calls `sessions.stop`: that op is the KILL SWITCH - deny the pending
 * gates, dispose the runtime, release the writer lease, unpublish, exit - and it
 * is what the `/stop` picker offers. It is one key away from this one on purpose
 * of naming, not of meaning: the composer's Stop button promises this session's
 * CURRENT WORK, and a client that answered a turn-level press with a
 * process-level kill would be answering a question the user did not ask. The
 * `session_interrupt` capability is a new key rather than a `lifecycle` bump so
 * that an older backend keeps `/stop` working and is never told it can
 * interrupt.
 *
 * WHAT THE USER IS TOLD, and what they are deliberately not. The backend's
 * `interrupted` transcript kind is excluded from the notifier's banner kinds
 * because telling someone their own press worked is a notification nobody wants,
 * so the common case here renders NOTHING: the stream ends and the button leaves
 * the DOM as `busy` goes false. A notice appears only when the interrupt left
 * something running that the user cannot see the end of - see `interruptNotice`.
 */

import type { DesktopCapabilities } from "@shared/api/local-operator/desktop-api";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { desktopFeatureEnabled } from "@shared/api/local-operator/desktop-hooks";
import type { DesktopInterruptReceipt } from "../../../../shared/desktop-session-contract";

/**
 * What the app tells the user when a Stop press found nothing to stop and the
 * pane AGREES nothing was running.
 *
 * The press is an action the user took, so it gets an answer even when the
 * answer is "nothing was running" - see `interruptNotice` for the incident that
 * made silence untenable. The sentence reports the STATE rather than the press
 * (design round 1, D5/U7: "the stop changed nothing" read as the mechanism
 * failing, and named the press where the state is the fact). PROVISIONAL COPY,
 * pending the design round.
 */
export const IDLE_STOP_NOTICE =
	"No turn was running, so there was nothing to stop.";

/**
 * The same answer when the pane still CLAIMS a turn is running.
 *
 * A receipt is the one fresh authoritative reading a pane with a dead feed
 * gets, and it can contradict the held claim the working line is still
 * showing - measured in UX round 1's U1 as `Nothing was running` sitting
 * directly above a ticking `running bash 13s` line, with the operator's own
 * incident on record as the case where the serve's roster may itself have been
 * stale. Neither side can be declared the liar from here, so the sentence is
 * ATTRIBUTED to its source and admits the pane may be the one out of date,
 * instead of asserting a fact the view beside it visibly contradicts. The
 * caller pairs this with a re-read (`canonical.retry`) so the disagreement is
 * settled by the next snapshot rather than left standing. PROVISIONAL COPY,
 * pending the design round.
 */
export const IDLE_STOP_DISPUTED_NOTICE =
	"The runtime says no turn is running, so nothing was stopped. This view may be out of date.";

/**
 * Whether this renderer may interrupt a turn against this backend.
 *
 * BOTH halves are required and neither is a formality: the route sits behind the
 * desktop bearer, so a renderer that did not start the backend would render a
 * button whose every press is a 401, and `desktopFeatureEnabled` is what keeps
 * that fail-closed. Absent means the Stop control is NOT RENDERED - there is no
 * fallback to `/stop`, which would end the session the button never promised to
 * end, and no keeping of the old silent no-op, which is the lie being removed.
 */
export function sessionInterruptEnabled(
	capabilities: DesktopCapabilities | null | undefined,
): boolean {
	return desktopFeatureEnabled(capabilities, "session_interrupt", 1);
}

/**
 * Interrupt the session's current turn, and answer what it left running.
 *
 * `requestId` is the route's receipt key and reaches the wire as `request_id`:
 * "make the current turn stop" is idempotent and creates or destroys nothing, so
 * a retried press with the same id answers the first receipt instead of
 * interrupting twice. Every press gets a fresh id - two presses are two requests
 * the user made.
 *
 * BOUNDED, AND WHY IT HAS TO BE (operator incident, 2026-10-07). A press on a
 * half-dead socket used to sit on a promise that the transport would only
 * abandon at its own generic control deadline - 25 s for this op
 * (`desktopRequestTimeoutMs`), and not at all on the development proxy path -
 * so the catch that owes the user a sentence could be a quarter-minute away,
 * and the optimistic stopped-turn fact the press wrote stayed latched in the
 * meantime: band on screen, nothing stopped, no answer. `INTERRUPT_ACK_TIMEOUT_MS`
 * bounds it to the runtime's own answer envelope; a lost answer then reaches the
 * caller's existing catch path, which states the outcome as unknown rather than
 * leaving a claim standing.
 */
export function interruptTurn(
	sessionId: string,
	requestId: string,
	/*
	 * The bound is injectable so a test can drive a never-settling transport at
	 * 50 ms instead of waiting out the production envelope; every caller in the
	 * app takes the default.
	 */
	timeoutMs: number = INTERRUPT_ACK_TIMEOUT_MS,
): Promise<DesktopInterruptReceipt> {
	/*
	 * The controller is the bound's REASON, not a cancellation channel: an IPC
	 * invoke cannot be aborted (the transport's own `withDeadline` documents the
	 * same stance - "abandoning it is exactly the point"), and the dev-proxy
	 * `fetch` underneath does not take a signal through this call path. What the
	 * race below buys is the property that matters for a press: the promise
	 * SETTLES at the envelope, with the standard `AbortError` rejected into the
	 * caller's catch - so the sentence lands, and a late answer cannot resurrect
	 * a claim the receipt never made. For THIS op a race leaving the request in
	 * flight is safe: the route is receipted and idempotent per `requestId`.
	 */
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const settled = desktopResult<DesktopInterruptReceipt>({
		op: "sessions.interrupt",
		sessionId,
		requestId,
	});
	return Promise.race([
		settled,
		new Promise<never>((_, reject) => {
			controller.signal.addEventListener(
				"abort",
				() => reject(controller.signal.reason),
				{ once: true },
			);
		}),
	]).finally(() => clearTimeout(timer));
}

/**
 * How long a Stop press waits for its receipt before the answer is called LOST.
 *
 * THE RUNTIME'S OWN ENVELOPE, deliberately. The attach client gives a wedged
 * owner 15 s before a request id that has not been answered becomes an error
 * rather than a hang (`local_operator/mobile/attach_client.py`:
 * `ACK_TIMEOUT_S = 15.0` - "long enough for a turn-boundary op ... on a busy
 * owner, short enough that a wedged owner surfaces as an error rather than a
 * hang"), and `session/attached.py` sizes its own dial allowances against the
 * same number. A client bound that outlived the server's would keep the press
 * latched for a stretch the runtime itself already gave up on; one shorter would
 * call a healthy slow answer lost. So this is that number. The copy this
 * change introduces is provisional, pending the design round.
 */
export const INTERRUPT_ACK_TIMEOUT_MS = 15_000;

/**
 * The one sentence a completed interrupt can owe the user, or null.
 *
 * Null is the COMMON case and it is a decision, not an oversight: a turn that
 * stopped with nothing left under it has already said everything it has to say
 * by the stream ending, and the notification bridge's exclusion of the
 * `interrupted` kind is the tree's precedent for not raising a banner about the
 * user's own press.
 *
 * `idle` IS NOT SILENT ANY MORE (operator incident, 2026-10-07). The route's
 * `idle` - no turn was running, or the session was cold - used to answer with
 * nothing, on the reasoning that a sentence would invent an outcome. That
 * reasoning has a premise the incident falsified: it assumes the user already
 * knows nothing was running. The operator pressed Stop four times while HIS
 * pane believed a turn was up, and every press answered `idle` with zero
 * feedback - so the app's silence read as "the press did nothing" rather than
 * "there was nothing to stop", which is the one thing the press's answer must
 * never mean. The press is an ACTION the user took; the composer owes its
 * result a sentence even when the result is that nothing ran, and this one says
 * exactly what the receipt says and no more. Whether the roster behind the
 * answer was fresh is a separate, server-side question - the sentence is
 * worded to be true either way. The copy is provisional, pending the design
 * round.
 *
 * A notice ALSO exists for work the user cannot otherwise see stop:
 *
 * - `children_running` is subagents and team members the abort did NOT settle
 *   (the receipt counts what actually settled, so this is the remainder). They
 *   are on screen in the run panel, so the notice names the panel rather than
 *   claiming they were stopped.
 * - `background_jobs` is the session's detached `bash` commands, and an
 *   interrupt never touches them by design - they are not this turn's work, and
 *   a user who backgrounded a command did so precisely to outlive the turn. The
 *   only lever that ends them is ending the SESSION, which is the `/stop`
 *   command, so the notice says that rather than implying a second press here
 *   will do it.
 *
 * Numbers rather than `receipt`: the runtime's sentence is prose it owns and may
 * rephrase, while these two counts are read from the roster after the interrupt
 * and are the same facts the copy needs spelled.
 */
export function interruptNotice(
	receipt: DesktopInterruptReceipt,
	/*
	 * Whether the pane's held claim still says a turn is alive, which selects
	 * which idle sentence is true (see `IDLE_STOP_DISPUTED_NOTICE`). A default of
	 * false keeps every reader that predates the field on the plain sentence.
	 */
	options: { turnClaimed?: boolean } = {},
): string | null {
	if (receipt.status === "idle")
		return options.turnClaimed === true
			? IDLE_STOP_DISPUTED_NOTICE
			: IDLE_STOP_NOTICE;
	if (receipt.status !== "interrupted") return null;
	const children = receipt.children_running ?? 0;
	const jobs = receipt.background_jobs ?? 0;
	if (children === 0 && jobs === 0) return null;
	/*
	 * Two nouns, one phrase each, so the two counts can share a subject without
	 * saying "still running" twice. Design round 1's D3 measured the old shape at
	 * five rendered lines in an 820px window, one of them the duplicate: the two
	 * counts are now one clause ("2 subagents and 1 background job are still
	 * running") whenever both are present, which is one line fewer at the narrow
	 * rung for the same facts.
	 *
	 * "background job" is the runtime's own term for a detached `bash` command in
	 * the text it prints when one finishes (`background job '<name>' failed:`), so
	 * the notice names the same thing the transcript does.
	 */
	const subagents = children === 1 ? "1 subagent" : `${children} subagents`;
	const backgroundJobs =
		jobs === 1 ? "1 background job" : `${jobs} background jobs`;
	/*
	 * The levers are named per fact rather than as one generic suggestion, and the
	 * reading surface is named the way the app names it: "Run details" is the
	 * pane's own title, its `aria-label` and its trigger ("Open run details"), and
	 * design round 1's D2 measured that "run panel" exists in code comments only.
	 * A reader who takes the sentence literally has to be able to find the thing it
	 * names.
	 *
	 * The pane READS - it ends nothing - and `/stop` is the only lever that ends a
	 * background job, because an interrupt never touches one. A single "press Stop
	 * again" would be false for both halves.
	 */
	if (children > 0 && jobs > 0)
		return `Stopped this turn. ${subagents} and ${backgroundJobs} are still running - open Run details to watch them, and use /stop to end the session and its jobs.`;
	if (children > 0)
		return `Stopped this turn. ${subagents} ${children === 1 ? "is" : "are"} still running - open Run details to watch ${children === 1 ? "it" : "them"}, or use /stop to end the session.`;
	return `Stopped this turn. ${backgroundJobs} ${jobs === 1 ? "is" : "are"} still running - ${jobs === 1 ? "it outlived the turn by design" : "they outlived the turn by design"}, so /stop is what ends ${jobs === 1 ? "it" : "them"} with the session.`;
}

/**
 * What a backend that cannot interrupt owes the user WHILE one of its turns runs.
 *
 * This is UX round 1's U4: with `session_interrupt` absent the control is not
 * rendered (correct - it would be a button whose every press is refused) and
 * Escape is a no-op, so the composer said nothing at all while the user's work
 * ran. Hiding a control that cannot work is right; leaving the user in the
 * original bug's silence is not, and the remaining lever (`/stop`, which ends
 * the SESSION) is discoverable only through the slash menu.
 *
 * One line in the same muted band `interruptNotice` uses, for one situation: a
 * turn is streaming and this build cannot stop it turn-wise. It says "predates
 * the control" rather than "unsupported" because that is the actual cause - a
 * version skew, not a configuration error the user could fix here - and it names
 * the honest lever instead of implying a second press will help.
 */
export function interruptUnavailableNotice(
	busy: boolean,
	enabled: boolean,
): string | null {
	if (!busy || enabled) return null;
	return "This backend predates the stop control, so this turn cannot be stopped from here - /stop ends the session and everything in it.";
}
