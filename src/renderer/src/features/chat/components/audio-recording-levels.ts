/*
 * THE RECORDING WAVEFORM'S LEVEL PIPELINE, as a pure reducer.
 *
 * WHY THIS LIVES APART FROM THE CANVAS. The operator's report (via Aida,
 * 2026-09-29) was that the waveform was unreadable - the peaks barely moved.
 * The cause was the old pipeline: it averaged the analyser's byte FREQUENCY
 * data, and speech energy concentrates in a few low bins, so the average
 * stayed small whatever was said. The fix is an adaptive gain, and its claims
 * ("quiet speech still visibly moves", "loud input never clips", "dynamics
 * stay visible, not a flat line") are claims about a SEQUENCE of levels
 * rather than about a still. As a reducer they are unit-testable without an
 * AudioContext (`scripts/audio-recording-levels.test.mjs`), and the component
 * keeps only the drawing.
 *
 * THE PIPELINE, per tick (the component pushes ~15 bars a second):
 *
 *   raw amplitude (0..1, the analyser window's RMS)
 *     -> gated: what is left after the noise floor, so room tone is silence
 *     -> over a decaying REFERENCE: the recent loudest, so the same voice
 *        reads against the room rather than against an absolute scale
 *     -> a compression curve: lifts small dynamics into visible height
 *     -> a release smoother: instant attack, eased fall, so the strip reads
 *        as movement rather than a shimmer
 *
 * TWO DESIGN CHOICES ARE LOAD-BEARING:
 *
 * - The reference has a FLOOR (`AUDIO_REFERENCE_FLOOR`). Without it a whisper
 *   would normalize against itself, and the strip would slowly climb to full
 *   scale in a silent room - the opposite of "quiet speech is visible": it
 *   would make silence visible and then equalize everything above it. With
 *   the floor, a quiet phrase settles around half the lane and never drowns
 *   out the loud one.
 * - The gain carries HEADROOM over the reference, so "never clips" is a
 *   construction rather than a clamp: even a full-scale sample tops out below
 *   the lane's ceiling, and the tallest bars keep their rounded ends clear of
 *   the canvas edge.
 *
 * The decay and release rates are per TICK, tuned for the ~15 Hz the
 * component pushes at; the component's `FRAMES_TO_SKIP` is the one place that
 * decides the rate.
 */

/** Below this raw RMS the input reads as room tone rather than speech. */
export const AUDIO_NOISE_FLOOR = 0.015;

/** The reference's own floor: a whisper is measured against this, not itself. */
export const AUDIO_REFERENCE_FLOOR = 0.05;

/** Per-tick decay of the recent-loudest reference (~0.7 s half-life at ~15 Hz). */
export const AUDIO_REFERENCE_DECAY = 0.94;

/** The compression curve's exponent: lifts small dynamics into visible height. */
export const AUDIO_LEVEL_GAMMA = 0.6;

/** Headroom over the reference, so a full-scale input tops out below the lane. */
export const AUDIO_HEADROOM = 1.25;

/** How fast the shown level falls toward a lower target; attack is instant. */
export const AUDIO_RELEASE = 0.5;

/** The reducer's memory: the recent-loudest reference and the shown level. */
export type AudioLevelState = {
	reference: number;
	shown: number;
};

/** What a stream starts from; silence draws at the floor height. */
export const INITIAL_AUDIO_LEVEL_STATE: AudioLevelState = {
	reference: AUDIO_REFERENCE_FLOOR,
	shown: 0,
};

export type AudioLevelStep = {
	state: AudioLevelState;
	level: number;
};

/**
 * One tick of the pipeline: the raw amplitude (0..1) in, the level the bar is
 * drawn at (0..1) and the next state out. Pure: same state and raw, same step.
 */
export const advanceAudioLevel = (
	state: AudioLevelState,
	raw: number,
): AudioLevelStep => {
	const amplitude = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
	const gated = Math.max(0, amplitude - AUDIO_NOISE_FLOOR);
	const reference = Math.max(
		gated,
		state.reference * AUDIO_REFERENCE_DECAY,
		AUDIO_REFERENCE_FLOOR,
	);
	const gain = gated / (reference * AUDIO_HEADROOM);
	const curved = Math.min(1, gain ** AUDIO_LEVEL_GAMMA);
	const shown =
		curved >= state.shown
			? curved
			: state.shown + (curved - state.shown) * AUDIO_RELEASE;
	return { state: { reference, shown }, level: shown };
};
