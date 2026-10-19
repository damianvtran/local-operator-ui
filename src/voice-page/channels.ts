/**
 * The voice page's IPC surface (plan D2): one message up in two flavours, three
 * down. Names live here so the page's preload and main's relay (U2) cannot
 * disagree about a string.
 */
export const VOICE_PAGE_CHANNELS = {
	/** page -> main: the WAV bytes of one finished utterance. */
	take: "voice-page:take",
	/** page -> main: `speech_start | speech_end`. */
	vad: "voice-page:vad",
	/** main -> page: a segment's bytes and its id. */
	play: "voice-page:play",
	/** main -> page: stop playback and drop the schedule. */
	stop: "voice-page:stop",
	/** main -> page: silence (or restore) the page's own output. */
	mute: "voice-page:mute",
} as const;

export type VadEventKind = "speech_start" | "speech_end";

/** `last` marks a reply's final segment, so the page knows when to drain. */
export type PlayMessage = { id: string; bytes: Uint8Array; last?: boolean };
