import assert from "node:assert/strict";
import { test } from "node:test";
import {
	BUNDLE_STEP_BOUND_MS,
	BundleStepTimeoutError,
	boundBundleStep,
} from "./bundle-step-bound.mjs";

/*
 * The bound exists to name a step that never returns (see the module docstring for
 * the CI run that cost 54 silent minutes), so the cases here are the two facts a
 * reader of a red run has to be able to rely on: a finished step behaves exactly
 * as it did unwrapped, and a stuck step fails with its own name rather than
 * hanging.
 */

test("a step that settles inside the bound returns its own value untouched", async () => {
	const value = { outputFiles: [{ text: "bundle" }] };
	assert.equal(
		await boundBundleStep({
			step: "the esbuild build",
			file: "scripts/example.test.mjs",
			run: () => Promise.resolve(value),
		}),
		value,
	);
});

test("a step that never returns is rejected by name, naming the step and the file", async () => {
	await assert.rejects(
		boundBundleStep({
			step: "the dynamic import of the pane bundle",
			file: "scripts/child-reader-foot-react.test.mjs",
			ms: 20,
			run: () => new Promise(() => {}),
		}),
		(error) => {
			assert.ok(error instanceof BundleStepTimeoutError);
			assert.match(error.message, /the dynamic import of the pane bundle/u);
			assert.match(
				error.message,
				/scripts\/child-reader-foot-react\.test\.mjs/u,
			);
			// The bound's own number, so a reader can tell WHICH bound fired.
			assert.equal(error.ms, 20);
			return true;
		},
	);
});

test("a thunk that throws synchronously throws exactly as the unwrapped call did", () => {
	assert.throws(
		() =>
			boundBundleStep({
				step: "the esbuild build",
				file: "scripts/example.test.mjs",
				run: () => {
					throw new Error("esbuild refused the entry point");
				},
			}),
		/esbuild refused the entry point/u,
	);
});

test("a settled step leaves no timer holding the process open", async () => {
	// The bound must not be the reason a healthy lane stays alive: an uncleared
	// timer is a pending handle, and `getActiveResourcesInfo` is the reading that
	// distinguishes "cleared" from "merely unref'd".
	const before = process
		.getActiveResourcesInfo()
		.filter((name) => name === "Timeout").length;
	await boundBundleStep({
		step: "the esbuild build",
		file: "scripts/example.test.mjs",
		run: () => Promise.resolve(null),
	});
	const after = process
		.getActiveResourcesInfo()
		.filter((name) => name === "Timeout").length;
	assert.equal(after, before);
});

test("the default bound is the two minutes the incident argues for, not a test-sized one", () => {
	assert.equal(BUNDLE_STEP_BOUND_MS, 120_000);
});
