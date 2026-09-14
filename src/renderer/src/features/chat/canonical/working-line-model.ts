/**
 * What the one aggregate working line says, and which phase it is timing.
 *
 * Extracted from `canonical-transcript.tsx`'s memo so the derivation can be
 * exercised directly (`scripts/tool-row.test.mjs` bundles this module), because
 * the branch this file gained is the first one that is NOT read off a frame the
 * backend sent, and a rule about when to stop claiming something is exactly the
 * kind of rule that drifts when it is only eyeballed in a story.
 *
 * Every branch but one is a fact the backend actually sent. `intent` rides
 * `tool_execution_start` and is already on the tool record; a streaming
 * assistant record IS what "responding" means; and `thinking` is the default
 * for a model call in flight with nothing on the ledger to show for it. The
 * vocabulary is the harness's own (`harness/intent.py`), so a reader who
 * learned it in the terminal does not learn it again here.
 *
 * The exception is `starting`, and it is deliberately the weakest claim the app
 * can make:
 *
 * A send this app issued can be admitted by the owner and produce nothing at
 * all for seconds - a cold session spends ~1.15 s inside the message request
 * spawning its runtime (`use-warm-session.ts`), and the desktop surface cannot
 * warm a New-chat pane before the send because the pane has no session to warm
 * and no bridge to hold the warm with. The TUI never shows that gap: it warms
 * on the first keystroke, so its working line is almost never covering a
 * runtime start. Here it is, and before this branch the transcript showed the
 * user's own bubble and then nothing at all until the first frame landed.
 *
 * So this branch is carried by the app's own send rather than by a frame, and
 * the copy is chosen to claim nothing the renderer cannot check: it names what
 * the app is waiting for, and deliberately does NOT say the runtime or the
 * model is starting. The renderer cannot tell a session that is still engaging
 * from one that is merely slow to answer, and `thinking` - the ladder's own
 * word for "a model call is in flight", per `ACTIVITY_THINKING` - would assert
 * a model call for the whole of the engage. An earlier design reviewed here
 * also considered "starting the session"; it was rejected for the same reason,
 * because a warm session would be described as starting while it is already up.
 *
 * The phase is the ladder's `thinking` on purpose, rather than a phase of its
 * own. Phases are what the clock is keyed to, and the wait this branch names
 * and the model call that follows it are one wait to the reader: keying a
 * separate phase would restart the clock at 0s the moment the first frame
 * arrived, which is the "restarting the clock on every label change" defect
 * the working line's own contract calls out.
 */

import { displayName } from "../components/trace/tool-row-model";
import type { TranscriptRecord } from "./transcript-reducer";
import { paintsSomething } from "./transcript-rows";

export type WorkingLineState = { activity: string; phase: string };

/**
 * The label for a turn this app has admitted and that has produced nothing yet.
 *
 * Lowercase like every other rung, because this row is the machine-voice
 * column, and a sentence here would be the app narrating rather than the
 * harness reporting. It states the waiting and nothing else; see the file
 * comment for why it does not name the runtime or the model.
 */
export const ADMITTED_SEND_ACTIVITY = "waiting for the agent";

export type WorkingLineInput = {
	/** The owner is generating and nothing has painted yet for this turn. */
	waiting: boolean;
	/**
	 * A send from this panel has been admitted and no assistant row exists yet.
	 *
	 * The app's own fact, not the owner's: it is true from the moment the
	 * admission request is issued until that request settles. See
	 * `chat-page.tsx` for where it is read from.
	 */
	starting: boolean;
	/** A question is pending; it outranks every working state (branding § 7). */
	gate: boolean;
	/**
	 * The stream has failed unrecoverably and the transcript is rendering that
	 * failure instead. A working line next to it would claim progress the
	 * transport is not making.
	 */
	unavailable: boolean;
	records: TranscriptRecord[];
};

export function deriveWorkingLine({
	waiting,
	starting,
	gate,
	unavailable,
	records,
}: WorkingLineInput): WorkingLineState | null {
	if (gate) return null;

	if (waiting) {
		const runningTools = records.filter(
			(record) => record.kind === "tool" && record.phase === "running",
		) as Extract<TranscriptRecord, { kind: "tool" }>[];
		if (runningTools.length > 0) {
			// One call states its own purpose; a batch states a COUNT. Presenting
			// one call's intent as the whole batch's activity is a claim the rows
			// above it immediately contradict, and the count is the one fact this
			// line has that appears nowhere else on screen.
			const activity =
				runningTools.length === 1
					? (runningTools[0].intent ??
						`running ${displayName(runningTools[0].toolName)}`)
					: `running ${runningTools.length} tools`;
			return { activity, phase: "running" };
		}
		const composing = records.filter(
			(record) => record.kind === "tool" && record.phase === "composing",
		).length;
		if (composing > 0) {
			// The tool's NAME is deliberately absent: it arrives in fragments, and
			// `composing wr` reads as a typo rather than as a state.
			return {
				activity: `composing ${composing === 1 ? "a call" : `${composing} calls`}`,
				phase: "composing",
			};
		}
		const tail = records[records.length - 1];
		if (tail?.kind === "assistant" && tail.streaming) {
			// Only once prose is ACTUALLY streaming. `message_start` fires from a
			// placeholder at the top of every provider call, before the first
			// token, so flipping on it would claim the model is writing for the
			// whole of every turn — which is why the record's own `text` is the
			// trigger here, not its existence.
			if (tail.text) return { activity: "responding", phase: "responding" };
		}
		return { activity: "thinking", phase: "thinking" };
	}

	if (!starting) return null;
	// The owner has produced something for this turn, so the wait this branch
	// describes is over. This is the belt to the send latch's braces rather than
	// the primary clear: the latch is released when the admission request
	// settles, and the request's own frame can precede the receipt that settles
	// it (the owner's `frontend.update` lands 3-6 ms BEFORE the receipt once the
	// session is warm), so the two orderings are genuinely both reachable.
	//
	// An assistant record that paints nothing is NOT content - a provider call
	// opens one at `message_start`, before a token exists - and the row itself
	// uses the same predicate (`paintsSomething`), because two copies of that
	// rule is how the empty row comes back.
	const tail = records[records.length - 1];
	if (
		tail?.kind === "tool" ||
		(tail?.kind === "assistant" && paintsSomething(tail))
	)
		return null;
	if (unavailable) return null;
	return { activity: ADMITTED_SEND_ACTIVITY, phase: "thinking" };
}
