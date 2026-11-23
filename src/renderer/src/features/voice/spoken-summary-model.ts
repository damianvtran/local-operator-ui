/**
 * WHAT THE SPOKEN-SUMMARY BLOCK SAYS, derived and never stored.
 *
 * The block under a message is one element in a handful of states (the design's
 * frames 4a-13). Which state is a fact about the voice store - is voice on in
 * this conversation, was THIS message spoken by this window, is the rig playing
 * it right now, was it cut - so it is a function of those facts, pinned by
 * `scripts/spoken-summary.test.mjs`, rather than a ladder inside a component
 * that only a render could check.
 *
 * Two rules the states keep:
 *   - A block claims nothing the audio did not do. "Spoken aloud" needs the
 *     server to have spoken THIS paragraph (`source: "summary"`); a message the
 *     window never spoke, or spoke without the summary, is a plain "Spoken
 *     summary" with no control, because there is nothing it can replay.
 *   - A control is offered only where it does something: Replay while voice is
 *     on here and this window spoke the message; Play when the speaker was
 *     muted and the words were not heard.
 */

import type { VoiceSpokenEntry } from "./voice-store";

export type SpokenBlockTone =
	/** The paragraph is still being written and the answer will be spoken. */
	| "upcoming"
	/** The rig is playing it now. */
	| "speaking"
	| "spoken"
	/** The person spoke over it. */
	| "stopped"
	/** The speaker was muted: nothing was heard. */
	| "muted"
	/** The summary itself was longer than the cap. */
	| "cut"
	/** Not spoken by this window, or voice is off: a record of what was said. */
	| "static";

export type SpokenBlockControl = "replay" | "play" | null;

export type SpokenBlockView = {
	tone: SpokenBlockTone;
	control: SpokenBlockControl;
};

export type SpokenBlockInput = {
	/** The message is still streaming in. */
	streaming: boolean;
	/** This conversation holds the voice slot. */
	voiceHere: boolean;
	/** A take of this window is owed an answer in this conversation. */
	answerOwed: boolean;
	/** This window's record of speaking the message, if it did. */
	entry: VoiceSpokenEntry | undefined;
	/** The rig is playing THIS message's words right now. */
	playingThis: boolean;
	/** The rig's speaker is muted right now. */
	muted: boolean;
};

export function spokenBlockView(input: SpokenBlockInput): SpokenBlockView {
	const { entry } = input;
	if (!input.voiceHere)
		// Voice is off: whatever was said, there is no voice to say it again.
		return { tone: "static", control: null };
	if (input.streaming && !entry)
		return input.answerOwed
			? { tone: "upcoming", control: null }
			: { tone: "static", control: null };
	// Spoken without the summary (the fallback), or never spoken by this window.
	if (!entry || entry.source !== "summary")
		return { tone: "static", control: null };
	if (input.playingThis)
		return input.muted
			? { tone: "muted", control: "play" }
			: { tone: "speaking", control: null };
	if (entry.muted) return { tone: "muted", control: "play" };
	if (entry.interrupted) return { tone: "stopped", control: "replay" };
	if (entry.truncated) return { tone: "cut", control: "replay" };
	return { tone: "spoken", control: "replay" };
}

/**
 * The footnote under a reply the server spoke from its own text and cut at the
 * cap (frame 10): the summary block never drew, so the cut has to be said here.
 * It is true only for `source: "reply"` - a summary's own cut is the block's
 * label - and only while voice is on, the one time Replay does anything.
 */
export function replyCutNote(
	entry: VoiceSpokenEntry | undefined,
	voiceHere: boolean,
): boolean {
	return (
		voiceHere &&
		entry !== undefined &&
		entry.source === "reply" &&
		entry.truncated
	);
}
