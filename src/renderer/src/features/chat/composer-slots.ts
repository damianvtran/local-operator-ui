/**
 * The composer's right-hand button cluster as FIXED SLOTS, and the rules that
 * decide which control stands in each.
 *
 * WHY SLOTS. The cluster is right-anchored, so every control that appeared to
 * the right of the dictation control pushed it 36px left (32px button + 4px
 * gap). A click aimed at the idle mic then landed on whatever had arrived in
 * its place - Stop, when a turn started. The old answer held an invisible third
 * box for a grace window; that moved the hazard rather than removing it. Here
 * Send and Stop are ONE slot (never drawn together), the dictation control owns
 * the slot beside it, and the only slot that ever appears (Insert transcript,
 * while recording) appears to the LEFT of both. So the x of slot A (mic /
 * Cancel) and slot B (Send / Steer / Stop / Send recording) is the same in every
 * state.
 *
 *     idle, working, stopping:   [A mic][B primary]                    68px
 *     recording:     [C Insert][A Cancel][B Send recording]            104px
 *
 * THE RECORDING ORDER IS main's OWN, with one control added. On main the row was
 * [Confirm][Cancel] with Cancel on the mic's spot; here Confirm is "Insert
 * transcript" at the same left spot, Cancel keeps the mic's spot, and Send
 * recording is new on the right, in Send's spot. The press guard (500 ms, below)
 * is what covers a reflex second press of the mic landing on Cancel. (Operator
 * decision after an independent design review; an earlier revision of this
 * change put Cancel leftmost.)
 *
 * The functions are pure so the matrix can be tested without a browser; the
 * composer reads them and renders one keyed button per role, so a press that
 * began on one role can never complete as a click on another (the old element
 * unmounts - a persisted button with a swapped handler would let a
 * pointerdown-on-Send / pointerup-after-flip fire Stop).
 */

import { BARE_OPTION_ORDINAL, approvalAnswerValue } from "./approval-words";

/** The dictation lifecycle as the composer reports it. */
export type DictationPhase =
	| "idle"
	| "preparing"
	| "recording"
	| "transcribing";

/** Slot A: the mic's own press point. */
export type SlotARole = "mic" | "mic-preparing" | "cancel" | "spinner";

/** Slot C: drawn only while recording, left of A. */
export type SlotCRole = "confirm";

/**
 * Slot B: the rightmost, "send" position. `connecting` is the inert busy face
 * that holds the slot while a send is going out, so the box emptying on the
 * press cannot flip the slot to Stop under a double click.
 */
export type SlotBRole =
	| "send"
	| "steer"
	| "stop"
	| "stop-busy"
	| "connecting"
	| "send-recording"
	| "send-recording-busy";

/** The roles that destroy or send something, and so ignore a press that follows their arrival too closely. */
export type GuardedRole = "stop" | "cancel" | "confirm" | "send-recording";

/**
 * Whether a guarded role's arrival arms the guard at all, given the role the
 * slot held just before it.
 *
 * Cancel, Insert transcript and Send recording are always armed: each arrives
 * under the pointer because the user just pressed the mic.
 *
 * STOP IS ARMED ONLY WHEN A SEND PUT IT THERE. The reflex re-press the guard
 * exists for is a second click on the control the user just pressed - Send -
 * and a send is always `connecting` for at least one render between Send and
 * Stop (the box empties on the press and `sendBusy` holds the slot). A Stop that
 * arrives any other way (the user cleared the box, a turn started elsewhere)
 * was not preceded by a press on this slot, so ignoring its first press would
 * be a dead button with no cause the user can see (UX round 1, U1).
 */
export function guardArmedBy(
	role: SlotARole | SlotBRole | SlotCRole,
	from: string | null,
): boolean {
	if (guardedRole(role) === null) return false;
	if (role === "stop")
		return from === "connecting" || from === "send-recording-busy";
	return true;
}

/**
 * How long a guarded role ignores a pointer press after it arrives in its slot.
 *
 * Chosen to cover the measured reflex re-press (120-170 ms after the flip in
 * `docs/evidence/interrupt-live/`) plus the settle latency around it. It
 * replaces the old 500 ms held-box grace with the same number and the same
 * reason; what changed is that the control is refused rather than the box held.
 */
export const ROLE_GUARD_MS = 500;

export type SlotBInput = {
	dictation: DictationPhase;
	/** A turn is running (the page's held alive pair, not a raw frame). */
	alive: boolean;
	/** The Stop press has landed and the turn has not ended yet. */
	stopping: boolean;
	/** The box holds text or at least one attachment. */
	hasPayload: boolean;
	/** The composer would refuse a normal send (box refused, no provider, no model). */
	refused: boolean;
	/** A send this composer made is still unacknowledged. */
	sendBusy: boolean;
	/** "Send recording" has been pressed and has not settled. */
	sendRecording: SendRecordingPhase;
	/**
	 * A masked credential capture is open, or another mode in which dictated
	 * words must not be sent unreviewed.
	 */
	reviewRequired?: boolean;
};

export type SlotBResult = { role: SlotBRole; enabled: boolean };

/**
 * Slot B, first match wins:
 *
 *   Send recording in flight        -> send-recording-busy (inert, role locked)
 *   recording                       -> send-recording
 *   send in flight, box empty       -> connecting
 *   working, Stop pressed           -> stop-busy (outranks typed text)
 *   working, nothing to send        -> stop
 *   otherwise                       -> send, or steer while a turn runs
 *
 * `sendBusy` locks the slot only while the box is EMPTY: that is the state the
 * press leaves behind (the box empties on admission) and so the only one in
 * which the slot could flip to Stop under a double click. With new text typed
 * the Send stays live so a second press reaches the pane's own send lock and
 * its "still sending" sentence.
 */
export function slotBRole(input: SlotBInput): SlotBResult {
	if (input.sendRecording !== "idle") {
		// A held face of its OWN, not `connecting`: slot A already draws the one
		// spinner for this wait, so B stays a static disc that still says what the
		// press was ("Send recording", busy) rather than "Sending your message",
		// which would be false until the submit actually starts.
		return { role: "send-recording-busy", enabled: false };
	}
	if (input.dictation === "recording") {
		return {
			role: "send-recording",
			// `sendBusy`: a transcript that arrives while another send of this
			// composer is mid-clear is parked for that send's clear, so it would
			// never be in the box to be submitted.
			enabled: !input.refused && !input.reviewRequired && !input.sendBusy,
		};
	}
	if (input.sendBusy && !input.hasPayload) {
		return { role: "connecting", enabled: false };
	}
	if (input.alive && input.stopping) {
		return { role: "stop-busy", enabled: false };
	}
	if (input.alive && !input.hasPayload) {
		return { role: "stop", enabled: true };
	}
	return {
		role: input.alive ? "steer" : "send",
		// A transcript is still landing: a send now would race the take's own
		// write into the same box (the submit path refuses it as well).
		enabled:
			input.hasPayload && !input.refused && input.dictation !== "transcribing",
	};
}

/**
 * Slot A: the mic's own press point.
 *
 * `sendRecording` keeps the slot inert from the press of Send recording until
 * its submit settles: in the gap between the recorder stopping and the
 * transcription request starting the dictation phase reads `idle`, and a live
 * mic there would let a second press start a new take over the one being sent.
 */
export function slotARole(
	dictation: DictationPhase,
	sendRecording: SendRecordingPhase = "idle",
): SlotARole {
	if (dictation === "recording") return "cancel";
	if (dictation === "transcribing" || sendRecording !== "idle")
		return "spinner";
	if (dictation === "preparing") return "mic-preparing";
	return "mic";
}

/** Slot C exists only while recording. */
export function slotCRole(dictation: DictationPhase): SlotCRole | null {
	return dictation === "recording" ? "confirm" : null;
}

/**
 * The guard's class of role. Mic, a disabled Send and a Send the user typed
 * for are NOT guarded: dictation is never refused or greyed.
 */
export function guardedRole(
	role: SlotARole | SlotBRole | SlotCRole,
): GuardedRole | null {
	switch (role) {
		case "stop":
		case "cancel":
		case "confirm":
		case "send-recording":
			return role;
		default:
			return null;
	}
}

/**
 * Whether a press on a guarded role should be ignored.
 *
 * Only pointer/touch clicks are guarded (`detail > 0`): a keyboard activation
 * (Enter/Space on a focused button synthesises a click with `detail === 0`) is
 * a deliberate act that no reflex produces. The ignored press must NOT set
 * `disabled`, which would drop focus; the caller just returns.
 */
export function shouldIgnoreRolePress({
	arrivedAt,
	now,
	detail,
	guardMs = ROLE_GUARD_MS,
}: {
	/** `performance.now()` when the role arrived in its slot, or null if unknown. */
	arrivedAt: number | null;
	now: number;
	/** `MouseEvent.detail`: 0 for keyboard, the click count for a pointer. */
	detail: number;
	guardMs?: number;
}): boolean {
	if (detail <= 0) return false;
	if (arrivedAt === null) return false;
	return now - arrivedAt < guardMs;
}

/**
 * "Send recording": stop, transcribe, and submit the transcript as a message in
 * one step. The phase is the whole of that step's state, so the slot can hold
 * its busy face from the press until the submit settles or fails.
 *
 *   idle -> awaiting-transcript   the press (recorder stopping, transcribing)
 *   awaiting-transcript -> ready-to-submit   a usable transcript landed
 *   awaiting-transcript -> idle   failure, empty transcript, discarded take
 *   ready-to-submit -> submitting   the box still holds exactly what the
 *                                   transcript made it; the submit has fired
 *   ready-to-submit -> idle         the box changed meanwhile: nothing is sent
 *   submitting -> idle              the send settled (accepted or refused)
 */
export type SendRecordingPhase =
	| "idle"
	| "awaiting-transcript"
	| "ready-to-submit"
	| "submitting";

export type SendRecordingEvent =
	| { type: "press" }
	/** The transcription request settled. `usable` is false for an error, an empty transcript or an aborted burst. */
	| { type: "transcript"; usable: boolean }
	/** The take was thrown away before any request (too short, or cancelled). */
	| { type: "discarded" }
	/**
	 * The render after the transcript landed. `draftIntact` is whether the box
	 * holds exactly the draft-at-press joined with the transcript - anything else
	 * means the user typed during the wait, and those words were never reviewed
	 * as part of a send.
	 */
	| { type: "checked"; draftIntact: boolean }
	/** The submit path has run. `sendBusy` is its in-flight flag as of the next render. */
	| { type: "settled"; sendBusy: boolean };

export function sendRecordingNext(
	phase: SendRecordingPhase,
	event: SendRecordingEvent,
): SendRecordingPhase {
	switch (event.type) {
		case "press":
			return phase === "idle" ? "awaiting-transcript" : phase;
		case "transcript":
			if (phase !== "awaiting-transcript") return phase;
			return event.usable ? "ready-to-submit" : "idle";
		case "discarded":
			return phase === "awaiting-transcript" ? "idle" : phase;
		case "checked":
			if (phase !== "ready-to-submit") return phase;
			return event.draftIntact ? "submitting" : "idle";
		case "settled":
			return phase === "submitting" && !event.sendBusy ? "idle" : phase;
		default:
			return phase;
	}
}

/**
 * What the box must hold for a dictated send to go out: the draft at the press
 * joined with the transcript, exactly as Confirm's append writes it.
 *
 * Anything else means the user typed (or a paste landed) while the transcript
 * was in flight. Those words were never part of the press, so nothing is sent
 * and the box is left as it is for the user to review.
 */
export function dictatedSendCheck({
	draftAtPress,
	transcript,
	current,
	join,
}: {
	draftAtPress: string;
	transcript: string;
	current: string;
	/** `joinTranscript`, passed in so this module stays free of the composer's hook file. */
	join: (draft: string, text: string) => string;
}): { expected: string; intact: boolean } {
	const expected = join(draftAtPress, transcript);
	return { expected, intact: current === expected };
}

/**
 * Whether dictated words, sent while a question is pending, would ANSWER it.
 *
 * The page takes the sent text of a pending gate two ways: `approvalAnswerValue`
 * (yes, ok, allow, approve, deny, 1, 2 ...) for an approval, and
 * `resolveNumericAnswer` (a bare 1-9 picks that option of an ask card) for a
 * question. Either one turns a transcript the user has not read into a decision,
 * and a stray "ok" or "two" from the room is enough. The composer does not hold
 * the gate's options, so any bare ordinal is refused rather than only the ones
 * that happen to be in range.
 */
export function dictatedWouldAnswerGate(text: string): boolean {
	return (
		approvalAnswerValue(text) !== null || BARE_OPTION_ORDINAL.test(text.trim())
	);
}
