/**
 * The waveform's geometry and its accessibility math — pure functions, no DOM.
 *
 * WHY THIS IS ITS OWN MODULE. The player's canvas drawing, its hit-testing and
 * its screen-reader text must all describe the SAME bars: a bar the eye sees at
 * x=100 whose click seeks somewhere else, or an aria range that disagrees with
 * the drawn progress, is three implementations of one fact. So the numbers live
 * here, they are pure, and the node tests exercise them directly (the canvas
 * calls are a thin mapping over {@link waveformBars}).
 *
 * THE RECIPE (the ElevenLabs UI bar-wave recipe, adopted as the design spec's
 * values): 4 px bars with a 2 px gap and a 2 px radius, a 4 px base height for
 * silence, a value scaled by `height * 0.8` so the tallest peak leaves a
 * margin, an alpha ramp of 0.3..1.0 across the wave, and a 24 px fade at both
 * edges so the wave does not collide with the container's own border.
 *
 * NO PEAKS MEANS NO WAVEFORM. {@link waveformBars} given `null` peaks returns a
 * FLAT scrubber — every bar at the base height — and never a fabricated
 * envelope: a suggested shape the audio does not have is a lie about the sound,
 * which is worse than a plain line (the brief's own rule; the hook degrades to
 * this state whenever the sidecar is absent or unreadable).
 */

/** Bar geometry, from the recipe. */
export const BAR_WIDTH = 4;
export const BAR_GAP = 2;
export const BAR_RADIUS = 2;
export const BAR_BASE = 4;
export const BAR_PITCH = BAR_WIDTH + BAR_GAP;
export const VALUE_SCALE = 0.8;
export const EDGE_FADE_PX = 24;
export const ALPHA_MIN = 0.3;
export const ALPHA_MAX = 1;

/** One bar, in CSS pixels relative to the canvas' left edge. */
export type WaveformBar = {
	/** Left edge. */
	x: number;
	width: number;
	height: number;
	/** Ink alpha, 0..1 (the base wave draws every bar at its own alpha). */
	alpha: number;
};

/**
 * How many bars fit in `width`, including the edge fades. At least one: a
 * zero-bar waveform would draw nothing and offer nothing to aim at.
 */
export function barCountForWidth(width: number): number {
	if (!Number.isFinite(width) || width <= 0) return 1;
	return Math.max(1, Math.floor((width + BAR_GAP) / BAR_PITCH));
}

/**
 * The 24 px edge fade, as a multiplier. Measured from whichever edge is closer,
 * so it applies symmetrically at both ends.
 */
export function edgeFade(centerX: number, width: number): number {
	const distance = Math.min(centerX, width - centerX);
	if (!Number.isFinite(distance)) return 0;
	return Math.max(0, Math.min(1, distance / EDGE_FADE_PX));
}

/**
 * Downsample `peaks` (any resolution; the stored sidecar is 240 bars) onto
 * `count` bars by taking each bucket's MAXIMUM. Max rather than mean: a
 * transient that a mean would flatten is exactly what a waveform exists to
 * show, and no bar ever exceeds the data's own range.
 */
export function downsamplePeaks(
	peaks: readonly number[],
	count: number,
): number[] {
	if (count <= 0) return [];
	if (peaks.length === 0) return new Array(count).fill(0);
	const out: number[] = new Array(count);
	const step = peaks.length / count;
	for (let i = 0; i < count; i += 1) {
		const start = Math.floor(i * step);
		const end = Math.max(start + 1, Math.floor((i + 1) * step));
		let peak = 0;
		for (let j = start; j < end && j < peaks.length; j += 1) {
			const value = peaks[j];
			if (Number.isFinite(value) && value > peak) peak = value;
		}
		out[i] = Math.max(0, Math.min(1, peak));
	}
	return out;
}

/**
 * The bars to draw at one (peaks, width, height) — the ONE description the base
 * canvas, the played-ink canvas and the tests all read.
 *
 * `peaks` may be any length (240 in the sidecar) and is downsampled to the
 * count that fits; `null` draws the flat scrubber (see the header).
 */
export function waveformBars(
	peaks: readonly number[] | null,
	width: number,
	height: number,
): WaveformBar[] {
	const count = barCountForWidth(width);
	const values = peaks === null ? null : downsamplePeaks(peaks, count);
	const bars: WaveformBar[] = [];
	// The ramp's denominator is count-1; one bar has nothing to ramp across.
	const rampDenominator = Math.max(1, count - 1);
	for (let i = 0; i < count; i += 1) {
		// Draw through the fade zone: an empty inset cannot fade any ink.
		const x = i * BAR_PITCH;
		const centerX = x + BAR_WIDTH / 2;
		const value = values === null ? 0 : values[i];
		const raw = value * height * VALUE_SCALE;
		const barHeight = Math.max(BAR_BASE, Math.round(raw));
		const ramp = ALPHA_MIN + (ALPHA_MAX - ALPHA_MIN) * (i / rampDenominator);
		bars.push({
			x,
			width: BAR_WIDTH,
			height: barHeight,
			alpha: Math.min(ALPHA_MAX, ramp) * edgeFade(centerX, width),
		});
	}
	return bars;
}

/**
 * The `0:07` clock the transport labels wear. NaN and negatives are `0:00`, not
 * a fabricated time (an unknown duration must not render `-1:-1`).
 */
export function formatClock(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
	const total = Math.floor(seconds);
	const minutes = Math.floor(total / 60);
	const rest = total % 60;
	return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/**
 * Where a pointer at `x` seeks to, in seconds. The fraction is measured across
 * the full width — the edge fades are cosmetic, and a click that lands in one
 * must move the playhead somewhere a later click can also reach.
 */
export function seekSecondsAt(
	x: number,
	width: number,
	duration: number,
): number {
	if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) return 0;
	const fraction = Math.max(0, Math.min(1, x / width));
	if (!Number.isFinite(duration) || duration <= 0) return 0;
	return fraction * duration;
}

/**
 * The seek position as a fraction 0..1, for the played-ink canvas' clip-path —
 * the one value a scrub frame must move without a React render.
 */
export function progressFraction(current: number, duration: number): number {
	if (!Number.isFinite(current) || !Number.isFinite(duration) || duration <= 0)
		return 0;
	return Math.max(0, Math.min(1, current / duration));
}

/**
 * The slider's `aria-valuetext`. Time-valued, not a bare number: a screen
 * reader announcing "7" under a slider whose range ends at 12 cannot tell
 * seconds from bars, so both ends are stated as clocks.
 */
export function ariaValueText(current: number, duration: number): string {
	return `${formatClock(current)} of ${formatClock(duration)}`;
}
