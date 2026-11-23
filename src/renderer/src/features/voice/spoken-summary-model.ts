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
 *   - A control is offered only where it does something, by ONE rule for every
 *     Replay in the app (`replayOffer`: the block, the strip, History, the
 *     footnote): not at all when this conversation does not hold the voice or
 *     the voice is paused; present but unavailable while something is being
 *     said or asked to be; "Play" (unmute, then say it) while the speaker is
 *     muted; "Replay" otherwise.
 */

import type { VoiceSpokenEntry, VoiceStoreState } from "./voice-store";

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
	/**
	 * The control is drawn and keeps focus but does nothing (`aria-disabled`): a
	 * take is being spoken or requested. Unmounting it would drop the focus of
	 * the person who just pressed it.
	 */
	disabled: boolean;
};

/** The facts every Replay entry point reads; see `replayOffer`. */
export type ReplayFacts = {
	/** This conversation holds the voice slot. */
	voiceHere: boolean;
	/** The page is closed: nothing could be heard. */
	paused: boolean;
	/** Something is being spoken, heard or asked, or a take is owed an answer. */
	busy: boolean;
	/** The speaker is muted. */
	muted: boolean;
};

/**
 * The facts of `replayOffer` for one conversation, read from the voice store.
 * `busy` is the strip's old "busy" widened to every entry point: audio moving
 * (speaking, or the person talking), a message asked of the rig and not yet
 * started, or a take in this conversation still owed its answer.
 */
export function replayFactsOf(
	state: Pick<
		VoiceStoreState,
		"active" | "rig" | "activity" | "speakRequest" | "exchange"
	>,
	sessionId: string | undefined,
): ReplayFacts {
	return {
		voiceHere:
			sessionId !== undefined && state.active?.session_id === sessionId,
		paused: state.rig?.paused === true,
		muted: state.rig?.muted === true,
		busy:
			state.activity !== null ||
			state.speakRequest !== null ||
			(state.exchange?.kind === "working" &&
				state.exchange.sessionId === sessionId),
	};
}

/**
 * THE ONE AVAILABILITY RULE FOR REPLAY (UX round 1, U1/U3, design D4). `null`
 * means not offered; otherwise the word, and whether it is pressable now. A
 * second take over a playing one is a barge-in nobody asked for, so busy is
 * unavailable everywhere - not just in the strip.
 */
export function replayOffer(
	facts: ReplayFacts,
): { word: "replay" | "play"; disabled: boolean } | null {
	if (!facts.voiceHere || facts.paused) return null;
	return { word: facts.muted ? "play" : "replay", disabled: facts.busy };
}

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
	/** This message was asked of the rig and has not started: see `speakRequest`. */
	requested: boolean;
	/** The rig's speaker is muted right now. */
	muted: boolean;
	/** The voice is paused. */
	paused: boolean;
	/** Anything is being said or asked, for any message: Replay waits. */
	busy: boolean;
};

export function spokenBlockView(input: SpokenBlockInput): SpokenBlockView {
	const { entry } = input;
	const none = (tone: SpokenBlockTone): SpokenBlockView => ({
		tone,
		control: null,
		disabled: false,
	});
	if (!input.voiceHere)
		// Voice is off: whatever was said, there is no voice to say it again.
		return none("static");
	if (input.streaming && !entry)
		return none(input.answerOwed ? "upcoming" : "static");
	const offer = replayOffer(input);
	// ASKED, NOT YET ANSWERED: the server has not said which words it will speak,
	// but the block exists only because the message carries the paragraph. "Speaking"
	// from the press closes the gap that used to read "Spoken summary"; a refusal
	// closes the request and the block goes back to what it was.
	if (!entry && input.requested)
		return {
			tone: input.muted ? "muted" : "speaking",
			control: offer ? (input.muted ? "play" : offer.word) : null,
			disabled: offer?.disabled ?? false,
		};
	// Spoken without the summary (the fallback), or never spoken by this window.
	if (!entry || entry.source !== "summary") return none("static");
	const withControl = (tone: SpokenBlockTone): SpokenBlockView => ({
		tone,
		// A message that was not heard reads "Play", whatever the speaker is now.
		control: offer ? (tone === "muted" ? "play" : offer.word) : null,
		disabled: offer?.disabled ?? false,
	});
	// ASKED OR PLAYING IS "SPEAKING", NOT "SPOKEN ALOUD": the record is written
	// when the words go out, and the audio may yet be refused or never start.
	if (input.playingThis || input.requested)
		return withControl(input.muted ? "muted" : "speaking");
	if (entry.muted) return withControl("muted");
	if (entry.interrupted) return withControl("stopped");
	if (entry.truncated) return withControl("cut");
	return withControl("spoken");
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
