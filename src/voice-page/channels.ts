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
	/** page -> main (invoke): the verified bytes of one manifest file, by name. */
	model: "voice-page:model",
	/** page -> main: the text of one local transcription. */
	transcript: "voice-page:transcript",
	/** main -> page: one reply's segments (text) for the local speaker (L6). */
	speak: "voice-page:speak",
	/** page -> main: `started | ended | cancelled`, what the speaker is doing. */
	playback: "voice-page:playback",
	/** page -> main: the page's own health, from a closed set (S3). */
	status: "voice-page:status",
} as const;

export type PlaybackKind = "started" | "ended" | "cancelled";

/** What the page may say about itself; main maps each to a status and its copy. */
export const PAGE_STATUS_CODES = [
	"listening",
	"speech_too_slow",
	"listening_failed",
	"mic_unavailable",
] as const;
export type PageStatusCode = (typeof PAGE_STATUS_CODES)[number];

/** Main -> page: a reply as sentences. The page synthesizes; no audio crosses. */
export type SpeakMessage = { replyId: string; segments: string[] };

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
