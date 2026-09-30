/**
 * @file speech-clip.ts
 * @description
 * The client half of the speech character cap: what a press sends when the
 * text is longer than the service reads.
 *
 * WHY THE CLIENT CLIPS AT ALL, when the server also caps at 10000 characters:
 * press-to-play has to be predictable. A press that sends 90k characters and
 * comes back with either a refusal or a truncated read makes the button's
 * outcome depend on which end noticed the length first, and the reader only
 * learns which one after the fact. Clipping here means the press always reads
 * something the service will speak, and the disclosure ("Reading the first N
 * characters") states what was read before the audio starts.
 *
 * WHY A SENTENCE BOUNDARY and not the exact limit: audio that stops mid-word
 * reads as a fault. The cut lands on the last sentence ender (`.`, `!`, `?`
 * or a newline) inside the window, so what is read ends where a person would
 * end it; a window with no ender falls back to the last whitespace, and only a
 * window with neither - one unbroken 10000-character token - takes the hard
 * cut. Pathological cuts are still disclosed by the same toast, because a
 * silent one is the failure this module exists to prevent.
 *
 * The counting unit is the string's own UTF-16 length, the same unit the
 * server's rune-count fallback approximates for the ASCII-dominant prose this
 * is for. A cut inside a surrogate pair cannot be produced here (a boundary
 * character is never a lone surrogate), and a long run of astral characters is
 * counted one-per-two - the disclosure states the returned text's own length,
 * so the number the reader sees is never a claim about a string they do not
 * have.
 */

/**
 * The most characters a single press sends. Mirrors the service's own cap so
 * the client is never the side that discovers it.
 */
export const SPEECH_MAX_CHARS = 10000;

/** Whitespace, for the fallback cut. Top level because this tree charges
 * per-call regex literals to the lint budget. */
const WHITESPACE = /\s/;

/**
 * Where the last sentence ends within the window, as an index to cut at
 * (exclusive), or -1 when the window holds no sentence ender.
 *
 * Scanned BACKWARD, so the first found is the last one: the reader gets the
 * largest complete prefix rather than the earliest stopping point. An ender
 * only counts when whitespace (or the window's own end) follows it, which is
 * what keeps `3.14` and `example.com/path` from halving a number or a host.
 */
const lastSentenceEnd = (window: string): number => {
	for (let i = window.length; i > 0; i -= 1) {
		const ch = window[i - 1];
		if (ch === "\n") return i;
		if (ch === "." || ch === "!" || ch === "?") {
			const next = window[i];
			if (next === undefined || WHITESPACE.test(next)) return i;
		}
	}
	return -1;
};

/**
 * Where the last whitespace run ends, as an index to cut at (exclusive), or
 * -1 when the window has no whitespace at all.
 */
const lastWhitespaceEnd = (window: string): number => {
	for (let i = window.length; i > 0; i -= 1) {
		if (WHITESPACE.test(window[i - 1])) return i;
	}
	return -1;
};

/** What a press should read: the text to send, and whether it was shortened. */
export type SpeechClip = {
	/** The text to send - a prefix of the input when `clipped`. */
	text: string;
	/** True when the input was longer than {@link SPEECH_MAX_CHARS}. */
	clipped: boolean;
};

/**
 * Clip `input` to what one press may send.
 *
 * Shorter inputs are returned untouched (the same string, not a copy the
 * caller's identity comparison would miss). Longer ones are cut at the last
 * sentence boundary in the window, else the last whitespace, else the hard
 * limit; the result never ends on the whitespace the cut consumed.
 */
export function clipForSpeech(input: string): SpeechClip {
	if (input.length <= SPEECH_MAX_CHARS) {
		return { text: input, clipped: false };
	}
	const window = input.slice(0, SPEECH_MAX_CHARS);
	const sentenceEnd = lastSentenceEnd(window);
	const whitespaceEnd = lastWhitespaceEnd(window);
	const cut =
		sentenceEnd > 0
			? sentenceEnd
			: whitespaceEnd > 0
				? whitespaceEnd
				: SPEECH_MAX_CHARS;
	const text = input.slice(0, cut).trimEnd();
	/*
	 * The degenerate window - nothing but whitespace to the cap - would trim to
	 * nothing; a press that speaks nothing is worse than a hard cut, so the raw
	 * window stands in.
	 */
	return { text: text.length > 0 ? text : window, clipped: true };
}
