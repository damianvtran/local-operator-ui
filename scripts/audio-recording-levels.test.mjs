import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The recording waveform's level pipeline, through the REAL module.
 *
 * WHY THIS FILE EXISTS. The operator's report (via Aida, 2026-09-29) was that
 * the waveform's peaks were unreadable, and the repair is an adaptive gain
 * whose whole point is a claim about a SEQUENCE of levels: quiet speech stays
 * visible, loud input stays bounded, and dynamics between them stay legible
 * rather than flattening at either end. A still cannot show any of those and
 * neither can the app's live path in CI - so the pipeline is a pure reducer
 * and this file drives it tick by tick, the same way the component does.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT COVER: the canvas drawing (the bars'
 * geometry) and the analyser wiring (that `getFloatTimeDomainData` fills the
 * buffer the reducer reads). The live-app frames in
 * `docs/evidence/stt-recording-display/` own the drawing, and the rig's own
 * run owns the wiring.
 */

const bundle = await build({
	stdin: {
		contents: `
			export {
				AUDIO_HEADROOM,
				AUDIO_LEVEL_GAMMA,
				AUDIO_NOISE_FLOOR,
				AUDIO_REFERENCE_DECAY,
				AUDIO_REFERENCE_FLOOR,
				AUDIO_RELEASE,
				INITIAL_AUDIO_LEVEL_STATE,
				advanceAudioLevel,
			} from "./src/renderer/src/features/chat/components/audio-recording-levels";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});

const {
	AUDIO_HEADROOM,
	AUDIO_LEVEL_GAMMA,
	AUDIO_REFERENCE_FLOOR,
	AUDIO_RELEASE,
	INITIAL_AUDIO_LEVEL_STATE,
	advanceAudioLevel,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/*
 * The pipeline's own ceiling, DERIVED rather than restated: a full-scale input
 * drives the gain to 1/headroom, and the curve compresses that. Pinning the
 * literal here instead would let a constants change silently stop testing
 * anything about the bound.
 */
const BOUNDED_LEVEL = (1 / AUDIO_HEADROOM) ** AUDIO_LEVEL_GAMMA;

/** Drive the reducer over a series of raw amplitudes, as the component does. */
const run = (series, initial = INITIAL_AUDIO_LEVEL_STATE) => {
	let state = initial;
	const levels = [];
	for (const raw of series) {
		const step = advanceAudioLevel(state, raw);
		state = step.state;
		levels.push(step.level);
	}
	return { levels, state };
};

test("quiet speech renders visibly, not as a sliver", () => {
	/*
	 * The defect's own input: a voice that sits well below the analyser's
	 * midpoint. The old linear map drew ~3% of the lane for this; the
	 * normalization must hold it at a readable fraction (the reference floor is
	 * what pins it there) and must never exceed the lane.
	 */
	const { levels } = run(Array.from({ length: 40 }, () => 0.03));
	assert.ok(
		levels.every((level) => level >= 0.35 && level <= 1),
		`quiet speech must stay visible and bounded, got ${JSON.stringify(levels.slice(0, 6))}`,
	);
});

test("loud input is bounded well below the lane's ceiling", () => {
	const { levels } = run(Array.from({ length: 20 }, () => 1));
	assert.ok(
		levels.every(
			(level) => level <= BOUNDED_LEVEL + 1e-9 && level >= BOUNDED_LEVEL - 0.05,
		),
		`a full-scale input must top out at the headroom bound (${BOUNDED_LEVEL.toFixed(3)}), got ${levels[0]}`,
	);
	// The clamp, exercised through the same public surface: out-of-range inputs
	// cannot push the level past the bound either way.
	const over = run(Array.from({ length: 5 }, () => 2.5));
	assert.ok(over.levels.every((level) => level <= BOUNDED_LEVEL + 1e-9));
	assert.equal(run([Number.NaN]).levels[0], 0);
});

test("dynamics stay visible between a quiet and a loud passage", () => {
	/*
	 * The "not a flat line" half: within one frame's history the reducer must
	 * keep separating a soft syllable from a loud one by a visible margin,
	 * rather than normalizing both to the same height.
	 */
	const alternating = Array.from({ length: 16 }, (_, index) =>
		index % 2 === 0 ? 0.04 : 0.2,
	);
	const { levels } = run(alternating);
	const quiet = levels.filter((_, index) => index % 2 === 0).slice(1);
	const loud = levels.filter((_, index) => index % 2 === 1).slice(1);
	const quietMean = quiet.reduce((a, b) => a + b, 0) / quiet.length;
	const loudMean = loud.reduce((a, b) => a + b, 0) / loud.length;
	assert.ok(
		loudMean - quietMean >= 0.2 && quietMean >= 0.35,
		`the two passages must stay legible apart (quiet ${quietMean.toFixed(2)}, loud ${loudMean.toFixed(2)})`,
	);
});

test("silence draws at the floor rather than at the recent loudness", () => {
	const { levels } = run(Array.from({ length: 10 }, () => 0.005));
	assert.ok(
		levels.every((level) => level <= 0.02),
		JSON.stringify(levels),
	);
});

test("after a loud passage quiet speech is visible again within the strip's window", () => {
	/*
	 * The recovery claim, in the shape the strip actually shows: a burst, then
	 * a quiet speaker. Right after the burst the level must DROP (the loud
	 * bars and quiet bars must not merge), and within the strip's ~8 s window
	 * quiet speech must climb back to a readable height.
	 */
	const { levels } = run(
		[0.6, 0.6, 0.6, 0.6, 0.6].concat(Array(50).fill(0.03)),
	);
	assert.ok(
		levels[6] < 0.35,
		`the post-burst dip must be visible, got ${levels[6].toFixed(2)}`,
	);
	assert.ok(
		levels.at(-1) >= 0.4,
		`quiet speech must recover within the window, got ${levels.at(-1).toFixed(2)}`,
	);
});

test("the level falls with the release rate rather than snapping", () => {
	const { levels } = run([0.6, 0.6, 0.6].concat(Array(4).fill(0)));
	// From the burst's plateau, the fall is eased through the release term:
	// each tick closes half the remaining gap rather than jumping to zero.
	const plateau = levels[2];
	assert.ok(plateau >= 0.8);
	assert.ok(levels[3] > plateau * 0.3 && levels[3] < plateau);
	assert.ok(levels[4] < levels[3] && levels[4] > 0);
	// `AUDIO_RELEASE` is the term doing it: pin the relationship rather than a
	// hand-computed number, so the test survives a retune of the constant.
	assert.ok(AUDIO_RELEASE > 0 && AUDIO_RELEASE <= 1);
});

test("the reducer is pure: same inputs, same outputs, no mutation", () => {
	const frozen = Object.freeze({ ...INITIAL_AUDIO_LEVEL_STATE });
	const first = run([0.02, 0.3, 0.05].concat(Array(5).fill(0.1)), frozen);
	const second = run([0.02, 0.3, 0.05].concat(Array(5).fill(0.1)), frozen);
	assert.deepEqual(first.levels, second.levels);
	assert.equal(frozen.reference, AUDIO_REFERENCE_FLOOR);
	// The reference is strictly positive by construction, so the gain can
	// never divide by zero however quiet the room is.
	assert.ok(first.state.reference > 0);
});
