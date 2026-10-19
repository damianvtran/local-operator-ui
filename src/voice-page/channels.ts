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

/**
 * One segment of a reply. `id.replyId` names the reply and `id.index` the
 * segment's place in it (from 0). The page plays only the current reply: a
 * message for any other (retired) reply is dropped, and a new `replyId` resets
 * the page's inbox. `last` marks the reply's final segment, so the page knows
 * when to drain.
 */
export type PlayMessage = {
	id: { replyId: string; index: number };
	bytes: Uint8Array;
	last?: boolean;
};
