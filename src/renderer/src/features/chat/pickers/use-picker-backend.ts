import { t } from "@shared/i18n";
/**
 * Shared backend plumbing for the destination adapters.
 *
 * Every adapter ends in a real desktop operation and shows the backend's
 * actual answer. These hooks keep that discipline in one place: a command
 * call returns the owner's `SlashResult` (or a second `native_action`, which
 * an adapter treats as "still needs input"), and `toResult` maps a
 * SlashResult's style onto the picker's result strip without inventing
 * wording. Errors are the backend's `detail` text when it gave one.
 */

import {
	DesktopControlError,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
// The app's ONE `runtime_busy` patience policy (bound, waits, and the reason the
// renderer's own deadline does not compound it) lives in the canonical store.
// Reused rather than restated here, so a second bound cannot drift from it.
import { withBusyResends } from "@shared/store/canonical-sessions-store";
import { useCallback, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { DesktopRequest } from "../../../../../shared/desktop-contract";
import type {
	DesktopCommandReceipt,
	DesktopSessionFrame,
} from "../../../../../shared/desktop-session-contract";
import type { PickerResult } from "./picker-host";

export type SlashOutcome = DesktopCommandReceipt["result"];

/**
 * What one `sessions.command` call left behind.
 *
 * Two facts rather than one, because the strip and a caller that has to report
 * the outcome LATER (the answer can land with the dialog already gone, UX U2)
 * must not state it differently: `result` is the line the strip shows, built
 * from the owner's own text, and it exists for the case where there is no
 * `outcome` to build it from — a call that never reached the owner. Returning
 * only the outcome made that line unreadable outside this hook, where the thrown
 * error it is composed from no longer exists.
 */
export type CommandRun = {
	outcome: SlashOutcome | null;
	result: PickerResult;
	/** A missing acknowledgement is not proof that the mutation was refused. */
	unconfirmed?: boolean;
	/**
	 * The owner's own frontend frame named the requested spec while the press was
	 * still waiting, so the press LANDED without a command receipt ever arriving.
	 * Distinct from `unconfirmed`: this is confirmation, just not by ack.
	 */
	confirmedByFrame?: boolean;
};

/**
 * The stop signal behind `confirmedByFrame`: not a refusal, not a transport
 * failure, and deliberately not a `DesktopControlError`, so the busy policy
 * rethrows it instead of repeating.
 */
class PressLandedWhileWaiting extends Error {
	constructor() {
		super("the owner's frontend frame already names the requested spec");
		this.name = "PressLandedWhileWaiting";
	}
}

export function isNativeAction(
	result: SlashOutcome,
): result is Extract<SlashOutcome, { kind: "native_action" }> {
	return result.kind === "native_action";
}

/** Map an owner SlashResult onto the result strip, verbatim text. */
export function toResult(result: SlashOutcome): PickerResult {
	if (isNativeAction(result)) {
		return {
			tone: "info",
			text: t(
				"ui.chat.pickers.use_picker_backend.the_backend_needs_more_input_for",
				{ destination: result.destination },
			),
		};
	}
	const style = result.style;
	const tone: PickerResult["tone"] =
		result.kind === "error" || style === "error"
			? "error"
			: style === "warning"
				? "warning"
				: result.kind === "notice"
					? "success"
					: "info";
	let text = result.text;
	if (!text && result.kind === "block") {
		const data = result.data as { items?: [string, string][]; title?: string };
		if (Array.isArray(data.items)) {
			text = [data.title, ...data.items.map(([k, v]) => `${k}: ${v}`)]
				.filter(Boolean)
				.join("\n");
		} else if ((result.data as { type?: string }).type === "loop") {
			// The loop block is state, not prose; the adapter's status panel
			// renders it, so the strip only needs the one-line summary.
			const loop = result.data as {
				status?: string;
				completed?: number;
				iterations?: number | null;
			};
			text = t("ui.chat.pickers.use_picker_backend.loop_turns", {
				status: loop.status ?? "started",
				completed: loop.completed ?? 0,
				iterations: loop.iterations ?? 0,
				of: loop.iterations ? "set" : "none",
			});
		} else {
			text = JSON.stringify(result.data, null, 2);
		}
	}
	return { tone, text: text || result.kind };
}

export function errorText(error: unknown): string {
	return error instanceof Error
		? error.message
		: t("ui.chat.pickers.use_picker_backend.the_backend_refused_it");
}

/** One command request, as the transport sees it. */
type CommandRequest = Extract<DesktopRequest, { op: "sessions.command" }>;

/**
 * The transport seam, so a test can watch the requests a run actually makes.
 * Defaults to the real one; nothing in the app passes this.
 */
type SendCommand = (request: CommandRequest) => Promise<DesktopCommandReceipt>;

/**
 * Run ONE owner command and classify its answer, outside React.
 *
 * WHY IT IS NOT A HOOK (this change's whole testability): the busy repeat below
 * is only meaningful as a *sequence of real dispatches* — the fix is that each
 * one carries a fresh `requestId` — and a `useState`-bound hook cannot be driven
 * from `node --test`. The hook keeps the state; the policy and the classification
 * live here where a suite can count attempts and read the ids that went out.
 *
 * THE REQUEST ID IS MINTED PER DISPATCH, INSIDE THE CALLBACK. That is the one
 * fact the whole repeat rests on: `/v1/desktop/sessions/{id}/commands` claims its
 * receipt WITHOUT `retry_safe` (`desktop_sessions.py`, `desktop_receipts.py`), so
 * a second attempt under the SAME id is answered `409 "Request outcome is
 * indeterminate"` — a definite failure claimed over a switch that may have
 * landed. A fresh id is a fresh journal claim instead, and re-issuing the same
 * target is idempotent in effect (`set_model`), so the repeat cannot double the
 * operation's result. It would NOT be safe for a general command resend: `/goal`
 * appends a turn, and a fresh id there would admit a second one.
 */
export async function runSessionCommand(
	input: {
		sessionId: string;
		command: string;
		args: string;
		/** The caller's own prefix for a failure that never reached the owner. */
		failure?: string;
		/**
		 * Repeat the dispatch on a `runtime_busy` refusal. OPT-IN, and only the
		 * model switch passes it: a busy owner is the one refusal whose own body
		 * invites a resend (`retryable: true`, `retry_after_ms`), and the switch is
		 * the one command whose repetition is a no-op. Every other caller keeps the
		 * single-attempt behaviour, so `/goal`, `/loop` and the approval escapes are
		 * untouched.
		 */
		resendWhileBusy?: boolean;
		/**
		 * The press has LANDED, read live, and read ONLY before a REPEAT — never before
		 * the first dispatch (design round 2, D5). A press whose session already names
		 * the target must still be SENT once: re-selecting the same model is the
		 * documented way the backend drops a fallback pin (`session.py`
		 * `_drop_fallback_pin`), so suppressing that send would report a switch that
		 * never happened while a fallback kept serving. What the predicate ends is the
		 * REPEAT: once a frame names the requested spec mid-wait, further attempts ask
		 * the owner for something it has already done, under a footer still reading
		 * `Switching the model…`. Only a caller that can see the frames passes it.
		 */
		landed?: () => boolean;
	},
	send: SendCommand = (request) =>
		desktopResult<DesktopCommandReceipt>(request),
): Promise<CommandRun> {
	const { sessionId, command, args, failure, resendWhileBusy, landed } = input;
	/*
	 * ATTEMPTS, not "is landed": `landed` is consulted only for a REPEAT, so the
	 * first dispatch is unconditional. The distinction is the whole of design round
	 * 2's D5 — with the predicate read first, a press on the model the session
	 * already names sent NOTHING and took the success path, which is exactly how a
	 * fallback pin (selected A, effective B) keeps serving after the user re-selects
	 * A to drop it.
	 */
	let dispatched = 0;
	const dispatch = async () => {
		/*
		 * The stop is thrown as a NON-DesktopControlError on purpose: `withBusyResends`
		 * rethrows anything that is not `runtime_busy` at once, so this ends the
		 * repeat at its first opportunity without touching that helper's bound or its
		 * waits. The residual is one wait (the busy hint, 2 s today) if the frame lands
		 * during it — measured, that is the window design D3 saw, not the whole repeat.
		 */
		if (dispatched > 0 && landed?.()) throw new PressLandedWhileWaiting();
		dispatched += 1;
		return send({
			op: "sessions.command",
			sessionId,
			requestId: uuidv4(),
			command,
			args,
		});
	};
	try {
		const receipt = await (resendWhileBusy
			? withBusyResends(dispatch)
			: dispatch());
		return { outcome: receipt.result, result: toResult(receipt.result) };
	} catch (error) {
		if (error instanceof PressLandedWhileWaiting) {
			/*
			 * Reachable only from a REPEAT (the first dispatch never reads `landed`), so
			 * the press went out at least once and the frame that named the model is the
			 * answer to that send. No receipt arrived, so there is nothing to quote:
			 * `outcome` is null and the strip stays empty (the hook skips `result` on this
			 * arm).
			 */
			return {
				outcome: null,
				result: { tone: "success", text: "" },
				confirmedByFrame: true,
			};
		}
		// A lost reply can follow an accepted mutation. Keep that disposition
		// separate from an acknowledged rejection; never replay the command
		// or turn the old backend's unavailable sentence into proof of failure.
		const unconfirmed =
			!(error instanceof DesktopControlError) ||
			error.code === "runtime_busy" ||
			error.status === null ||
			error.status >= 500;
		const result: PickerResult = {
			tone: unconfirmed ? "warning" : "error",
			text: unconfirmed
				? [
						t(
							"ui.projects.use_request_update.the_request_could_not_be_confirmed",
						),
						error instanceof DesktopControlError &&
						error.code === "runtime_unreachable"
							? errorText(error)
							: null,
					]
						.filter(Boolean)
						.join(" ")
				: `${failure ?? t("ui.chat.pickers.use_picker_backend.did_not_run", { command: command })}: ${errorText(error)}`,
		};
		return { outcome: null, result, unconfirmed };
	}
}

/**
 * Run one owner command against the session and keep its outcome.
 *
 * The dispatch and its classification are `runSessionCommand` (plain, and
 * therefore testable); this hook adds the strip's state around it. The request
 * id is minted per DISPATCH: a retry of the same intent would normally reuse it,
 * but on `/commands` a reused id meets the receipt journal's indeterminate 409,
 * so the one call that repeats (`options.resendWhileBusy`, the model switch)
 * needs a new id and gets it — the same logical press, re-claimed.
 */
export function useSessionCommand(sessionId: string) {
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<PickerResult | null>(null);
	const [outcome, setOutcome] = useState<SlashOutcome | null>(null);

	const run = useCallback(
		async (
			command: string,
			args: string,
			/**
			 * The CALLER'S own words for a call that never reached the owner, used as the
			 * prefix of the failure line. Omitted, the line names the slash command
			 * (`/goal did not run: …`), which is right for a picker whose field takes that
			 * command and wrong for a control whose press is not a slash command at all:
			 * the composer's status row is a button labelled `Clear goal`, and telling a
			 * person who pressed it that `/goal` failed names a surface they were never at
			 * (UX round 1, U2). Only the FIRST half of the line changes; the reason after
			 * the colon is still whatever the transport or the owner said.
			 */
			failure?: string,
			/**
			 * SEE `runSessionCommand`'s `resendWhileBusy`: the model switch is the only
			 * caller that sets it, because a switch's repeat is a no-op while `/goal`'s
			 * would admit a second turn. Absent, a command is dispatched exactly once -
			 * the behaviour every other control in this tree was written against.
			 */
			options?: { resendWhileBusy?: boolean; landed?: () => boolean },
		): Promise<CommandRun> => {
			setBusy(true);
			setResult(null);
			try {
				const settled = await runSessionCommand({
					sessionId,
					command,
					args,
					failure,
					resendWhileBusy: options?.resendWhileBusy,
					landed: options?.landed,
				});
				// A repeat leaves the control busy for the whole press, so nothing is
				// reported while the app still has a chance (the policy's own property);
				// only the settled run reaches the strip.
				if (settled.outcome) setOutcome(settled.outcome);
				// A press the owner's frame confirmed carries NO receipt, so there is no
				// sentence to put in the strip. Leaving the last result there would be a
				// second claim about a press that already moved on, and the dialog keeps
				// its own header (the model in force) as the answer.
				if (!settled.confirmedByFrame) setResult(settled.result);
				return settled;
			} finally {
				setBusy(false);
			}
		},
		[sessionId],
	);

	return { run, busy, result, outcome, setResult };
}

/**
 * How a failed picker operation reads: the caller's prefix, the error's own
 * detail, and - when the caller has one - a note it can add.
 *
 * WHY THE NOTE IS APPENDED AND NOT A REPLACEMENT (agent review round 2,
 * MAJOR-1): `perform` returns null for EVERY throw, so a caller cannot tell a
 * refusal the route classified from a transport failure, a timeout or a schema
 * refusal. A caller that substituted its own sentence therefore spoke for
 * causes it could not see - and the fork picker's did, replacing the core's
 * four distinct refusal sentences (compaction in flight, unknown id, a point
 * before the last summary, a boundary inside an unfinished tool batch) with one
 * sentence whose premise was false for one of them and whose advice was itself
 * refused by another. The detail is the owner's, so it stays; a note adds only
 * what the caller knows without claiming a cause.
 *
 * THE JOIN IS A LINE BREAK, not a space (design round 3, D1). The route's
 * sentences carry NO terminal period - `"history is being rewritten; retry
 * /fork when compaction finishes"` is quoted verbatim by the test beside this -
 * so a space ran two clauses together mid-word: "...compaction finishes If that
 * message...". `\n` is the separator the success path in `destination-pickers`
 * already uses for its second clause, and it is pinned by that test so the two
 * cannot drift apart again.
 */
export function operationFailureText(
	failurePrefix: string,
	detail: string,
	note?: string,
): string {
	return `${failurePrefix}: ${detail}${note ? `\n${note}` : ""}`;
}

/** Generic async operation state for adapters that call non-command ops. */
export function useOperation() {
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<PickerResult | null>(null);
	const perform = useCallback(
		async <T>(
			work: () => Promise<T>,
			describe: (value: T) => PickerResult,
			failurePrefix: string,
			failureNote?: string,
		): Promise<T | null> => {
			setBusy(true);
			setResult(null);
			try {
				const value = await work();
				setResult(describe(value));
				return value;
			} catch (error) {
				setResult({
					tone: "error",
					text: operationFailureText(
						failurePrefix,
						errorText(error),
						failureNote,
					),
				});
				return null;
			} finally {
				setBusy(false);
			}
		},
		[],
	);
	return { perform, busy, result, setResult };
}

export type SnapshotFrame = Extract<DesktopSessionFrame, { type: "snapshot" }>;
