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
 */
export function interruptTurn(
	sessionId: string,
	requestId: string,
): Promise<DesktopInterruptReceipt> {
	return desktopResult<DesktopInterruptReceipt>({
		op: "sessions.interrupt",
		sessionId,
		requestId,
	});
}

/**
 * The one sentence a completed interrupt can owe the user, or null.
 *
 * Null is the COMMON case and it is a decision, not an oversight: a turn that
 * stopped with nothing left under it has already said everything it has to say
 * by the stream ending, and the notification bridge's exclusion of the
 * `interrupted` kind is the tree's precedent for not raising a banner about the
 * user's own press. The route's `idle` - no turn was running, or the session is
 * cold - is also null: nothing happened, and a sentence would invent an outcome.
 *
 * A notice exists only for work the user cannot otherwise see stop:
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
): string | null {
	if (receipt.status !== "interrupted") return null;
	const children = receipt.children_running ?? 0;
	const jobs = receipt.background_jobs ?? 0;
	if (children === 0 && jobs === 0) return null;
	// "background job" is the runtime's own term for a detached `bash` command in
	// the text it prints when one finishes (`background job '<name>' failed:`),
	// so the notice names the same thing the transcript does.
	const childClause =
		children === 1
			? "1 subagent is still running"
			: `${children} subagents are still running`;
	const jobClause =
		jobs === 1
			? "1 background job is still running"
			: `${jobs} background jobs are still running`;
	/*
	 * The levers are named per fact rather than as one generic suggestion. The
	 * run panel READS - it ends nothing - and `/stop` is the only thing that ends
	 * a background job, because an interrupt never touches one. A single "press
	 * Stop again" would be false for both halves.
	 */
	if (children > 0 && jobs > 0)
		return `Stopped this turn. ${childClause}, and ${jobClause} - open the run panel to watch the subagents, and use /stop to end the session and its jobs.`;
	if (children > 0)
		return `Stopped this turn. ${childClause} - open the run panel to watch ${children === 1 ? "it" : "them"}, or use /stop to end the session.`;
	return `Stopped this turn. ${jobClause} - it outlived the turn by design, so /stop is what ends it with the session.`;
}
