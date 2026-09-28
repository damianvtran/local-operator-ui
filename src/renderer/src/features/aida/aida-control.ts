/**
 * Aida's vocabulary: the actions her route takes, the reserved words of `/aida`,
 * and the sentences its receipts and refusals use.
 *
 * PURE — no React, no transport — because this is the half the desktop suite
 * bundles and EXECUTES (`scripts/aida-sidebar.test.mjs`), the same split
 * `slash-submit.ts` keeps from `slash-dispatch.ts`: the rules a press turns on
 * are run by the test, and only the wiring is pinned as source. The hooks and
 * the route calls live in `use-aida-target.ts`.
 */

import type { DesktopAidaControlResult } from "../../../../shared/desktop-control-contract";

/** The route's own op vocabulary, mirrored (`aida.control`, `design.md` § 4). */
export type AidaControlAction =
	| "open"
	| "pause"
	| "resume"
	| "greet"
	| "status";

/**
 * The control word an argument names, or null when the argument is a message.
 *
 * THE WHOLE ARGUMENT MUST BE THE WORD — not its first token. `/aida pause` is the
 * control; `/aida pause and tell me what you think` is a message to her, because
 * a rule that read only the first token would silently swallow the rest of a
 * sentence the user addressed to an agent. Case-insensitive, so `/aida Pause`
 * still reads as the control word.
 *
 * The reserved vocabulary is `design.md`'s (§ 2.5, "reserved subcommands:
 * pause, resume, status") and it is deliberately a closed set with no escape
 * grammar in this build: the TUI's `=pause` spelling is a terminal grammar for
 * talking ABOUT those words, and nothing here has been given the authority to
 * define a second one for the desktop.
 */
export function aidaReservedAction(
	argument: string,
): "pause" | "resume" | "status" | null {
	const word = argument.trim().toLowerCase();
	if (word === "pause" || word === "resume" || word === "status") return word;
	return null;
}

/**
 * The sentence a control op's receipt shows.
 *
 * Keyed on the OP rather than on the answer's state alone, because the same
 * state answers `status` ("Aida is paused.") and a pause ("Aida is paused. She
 * will not check in until you resume her.") — one reports, one confirms.
 */
export function aidaControlReceipt(
	action: "pause" | "resume" | "status",
	state: DesktopAidaControlResult,
): { text: string; kind: "success" | "info" } {
	if (action === "pause")
		return {
			text: "Aida is paused. She will not check in until you resume her.",
			kind: "success",
		};
	if (action === "resume")
		return {
			text: "Aida is resumed. She will check in on her usual schedule.",
			kind: "success",
		};
	return {
		kind: "info",
		text: state.paused ? "Aida is paused." : "Aida is active.",
	};
}

/**
 * The sentence a failed open or control shows.
 *
 * The transport's and the backend's own words travel verbatim when there are any
 * (`DesktopControlError` carries the route's `detail.message`, or the app's own
 * composed sentence for a transport failure); the fallback exists only for a
 * throw that carried nothing, because the one thing this surface must not do is
 * fail silently.
 */
export function aidaControlFailureCopy(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	return "Aida's controls could not reach the backend.";
}
