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

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useCallback, useState } from "react";
import { v4 as uuidv4 } from "uuid";
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
};

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
			text: `The backend needs more input for ${result.destination}.`,
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
			text = `Loop ${loop.status ?? "started"}: ${loop.completed ?? 0}${
				loop.iterations ? ` of ${loop.iterations}` : ""
			} turns`;
		} else {
			text = JSON.stringify(result.data, null, 2);
		}
	}
	return { tone, text: text || result.kind };
}

export function errorText(error: unknown): string {
	return error instanceof Error ? error.message : "the backend refused it";
}

/**
 * Run one owner command against the session and keep its outcome. The
 * request id is minted per call: a retry of the SAME intent should reuse it,
 * but a picker submission is a new intent each time the user confirms.
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
		): Promise<CommandRun> => {
			setBusy(true);
			setResult(null);
			try {
				const receipt = await desktopResult<DesktopCommandReceipt>({
					op: "sessions.command",
					sessionId,
					requestId: uuidv4(),
					command,
					args,
				});
				setOutcome(receipt.result);
				const result = toResult(receipt.result);
				setResult(result);
				return { outcome: receipt.result, result };
			} catch (error) {
				const result: PickerResult = {
					tone: "error",
					text: `${failure ?? `/${command} did not run`}: ${errorText(error)}`,
				};
				setResult(result);
				return { outcome: null, result };
			} finally {
				setBusy(false);
			}
		},
		[sessionId],
	);

	return { run, busy, result, outcome, setResult };
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
					text: `${failurePrefix}: ${errorText(error)}`,
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
