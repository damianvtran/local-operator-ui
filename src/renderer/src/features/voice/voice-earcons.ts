/**
 * THE END EARCON (plan §8): a short falling two-note tone when a reply finishes,
 * so the end of a spoken answer is audible without looking at the screen.
 *
 * It plays through THIS window's Web Audio, not the hidden voice page's: the
 * page's audio is the rig's speech, and mixing a cue into it would be a second
 * sound the echo guard then has to recognise as ours next to "Switched.".
 *
 * Kept under s2s's 384 ms `min_speech_ms`: two 60 ms notes with a 20 ms gap. The
 * microphone can hear it, and the VAD cannot call it a turn.
 *
 * The cancelled playback event never reaches here: that is an interruption, not
 * an end, and a tone would say the reply finished when it did not.
 */

/** The two notes, high then low: a falling "done" rather than a rising alarm. */
export const END_TONE_HZ = [880, 660] as const;
export const END_NOTE_SECONDS = 0.06;
const END_NOTE_GAP_SECONDS = 0.02;
const END_PEAK_GAIN = 0.08;
const END_RAMP_SECONDS = 0.01;

/** The slice of `AudioParam` the tone uses. */
export type EarconParam = {
	setValueAtTime: (value: number, at: number) => void;
	linearRampToValueAtTime: (value: number, at: number) => void;
	exponentialRampToValueAtTime: (value: number, at: number) => void;
};

/** The slice of `AudioContext` the tone uses (a test seam). */
export type EarconAudio = {
	currentTime: number;
	state?: string;
	resume?: () => Promise<void>;
	destination: unknown;
	createOscillator: () => {
		type: string;
		frequency: EarconParam;
		connect: (node: unknown) => void;
		start: (at: number) => void;
		stop: (at: number) => void;
	};
	createGain: () => {
		gain: EarconParam;
		connect: (node: unknown) => void;
	};
};

/**
 * Schedule the tone at `start` and return the time it ends. Pure over the
 * injected context, so the shape of the cue is testable without an audio device.
 */
export function scheduleReplyEndTone(
	audio: EarconAudio,
	start = audio.currentTime,
): number {
	let at = start;
	for (const hz of END_TONE_HZ) {
		const oscillator = audio.createOscillator();
		const gain = audio.createGain();
		oscillator.type = "sine";
		oscillator.frequency.setValueAtTime(hz, at);
		// A short fade in and a fast decay: a click, not a beep.
		gain.gain.setValueAtTime(0, at);
		gain.gain.linearRampToValueAtTime(END_PEAK_GAIN, at + END_RAMP_SECONDS);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + END_NOTE_SECONDS);
		oscillator.connect(gain);
		gain.connect(audio.destination);
		oscillator.start(at);
		oscillator.stop(at + END_NOTE_SECONDS);
		at += END_NOTE_SECONDS + END_NOTE_GAP_SECONDS;
	}
	return at;
}

let context: EarconAudio | null = null;

/**
 * Play the end tone. Silent where there is no Web Audio (node, a stripped
 * renderer), and one context is reused for the window's life.
 */
export async function playReplyEndTone(): Promise<void> {
	const Ctor = (globalThis as { AudioContext?: new () => EarconAudio })
		.AudioContext;
	if (!Ctor) return;
	context ??= new Ctor();
	if (context.state === "suspended") await context.resume?.();
	scheduleReplyEndTone(context);
}
