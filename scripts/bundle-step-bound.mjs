/**
 * Bounds ONE step of a test file's own bundle work, so a step that never returns
 * fails with its own name instead of becoming an unreadable stall.
 *
 * THE INCIDENT THIS EXISTS FOR. From 2026-10-31T09:50Z the `Desktop Tests` shard
 * that carried `scripts/child-reader-foot-react.test.mjs` stopped emitting output
 * for 54 silent minutes and was cancelled at the job's 50-minute cap (run
 * 41248028640, job 124562057434; the same signature on runs 41274378090,
 * 41277981038 and 41286247024, and again on run 41288401978 - PR 1551's head,
 * which is unrelated - where shards 0, 2 and 3 finished in 17, 10 and 8 minutes
 * while shard 1 was cancelled at 54m37s with its suite step still in progress and
 * its log scan never run). The job carried no test line at all, so the verdict
 * over the rest of the shard was unreadable, and the file's own last words were
 * React SSR warnings with no failing subtest: a step of that file's module had not
 * returned.
 *
 * WHAT IS BOUNDED, AND WHY IT IS THE CALLER'S CHOICE. This module knows nothing
 * about esbuild or imports; it races whatever thunk it is handed against a timer.
 * `scripts/child-reader-foot-react.test.mjs` bounds its two module-scope steps
 * (the esbuild build and the dynamic import of the bundle it writes), and the
 * names it passes are what the failure message carries - so the line a red CI run
 * shows says WHICH step never returned rather than only which file stalled.
 *
 * THE BOUND IS GENEROUS ON PURPOSE. A bound that turns a healthy lane red is
 * worse than no bound (the per-lane bound in `desktop-test-lane-bound.mjs` was
 * shipped at 10 minutes and had to be recalibrated after it killed a legitimately
 * long lane twice), so the default here sits far above measured cost: the whole
 * of `scripts/child-reader-foot-react.test.mjs` builds, imports and renders in
 * about 6 s on this host and its bundle step finished inside 6 s in the CI run
 * that later stalled, while the job's own cap is 50 minutes. Two minutes is
 * therefore ~20x the measured step and ~25x below the cap that hid the stall.
 *
 * WHY THE TIMER IS CLEARED RATHER THAN `unref`d. A `unref`ed timer does not keep
 * the event loop alive, which is precisely wrong here: the case this exists for
 * is a step whose own work has stopped holding the loop, and an unref'd timer
 * would then let the process exit quietly instead of reporting the bound. The
 * timer is cleared when the step settles, so a normal run leaves no handle and no
 * pending work behind.
 */

/** Milliseconds one bounded step may run before it is reported as stuck. */
export const BUNDLE_STEP_BOUND_MS = 120_000;

/**
 * The failure a stuck step produces. A distinct class rather than a bare `Error`
 * so a test can assert the bound fired instead of the step failing for its own
 * reason - the two are different facts about a red run.
 */
export class BundleStepTimeoutError extends Error {
	constructor({ step, file, ms }) {
		super(
			`${file}: the ${step} did not finish within ${Math.round(ms / 1000)}s (BUNDLE_STEP_BOUND_MS); the step is STUCK rather than slow - raise or disable the bound deliberately, do not widen the cap that hid it`,
		);
		this.name = "BundleStepTimeoutError";
		this.step = step;
		this.file = file;
		this.ms = ms;
	}
}

/**
 * Await `run()` under a bound, rejecting with a named `BundleStepTimeoutError`
 * when it passes.
 *
 * `run` is invoked SYNCHRONOUSLY, so a thunk that throws does so exactly as the
 * unwrapped call did and a caller sees no change in behaviour on the normal path.
 */
export function boundBundleStep({
	step,
	file,
	run,
	ms = BUNDLE_STEP_BOUND_MS,
}) {
	/*
	 * THE THUNK IS CALLED BEFORE THE TIMER IS ARMED, which is not stylistic: a step
	 * that throws synchronously must throw here and nowhere else, and a timer armed
	 * ahead of it would outlive the throw with nobody to clear it - a stray handle
	 * that keeps the lane alive to the bound and then rejects unhandled (measured:
	 * the file sat for the full 120 s before failing on the orphaned rejection).
	 */
	const stepPromise = run();
	let timer;
	const timeout = new Promise((_resolve, timeoutReject) => {
		timer = setTimeout(
			() => timeoutReject(new BundleStepTimeoutError({ step, file, ms })),
			ms,
		);
	});
	return Promise.race([stepPromise, timeout]).finally(() =>
		clearTimeout(timer),
	);
}
