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
		async (command: string, args: string) => {
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
				setResult(toResult(receipt.result));
				return receipt.result;
			} catch (error) {
				const failure: PickerResult = {
					tone: "error",
					text: `/${command} did not run: ${errorText(error)}`,
				};
				setResult(failure);
				return null;
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
