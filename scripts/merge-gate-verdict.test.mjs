import assert from "node:assert/strict";
import { test } from "node:test";

import { gateVerdict } from "./merge-gate-verdict.mjs";

/**
 * The two directions Aida's brief requires, plus the hole that was open on main.
 *
 * Every row here is a decision that used to be reachable only by spending a
 * full-suite run, so the matrix is the cheap proof that the fix keeps the
 * gate's intent instead of widening it.
 */

const suite = (overrides = {}) => ({
	changes: { result: "success" },
	test: { result: "success" },
	"desktop-tests-result": { result: "success" },
	"native-proofs": { result: "success" },
	...overrides,
});

test("a fully green run passes", () => {
	const { bad } = gateVerdict({
		needs: suite(),
		eventName: "pull_request",
		nativeScope: "true",
	});
	assert.deepEqual(bad, []);
});

test("a backend-only diff may skip the native lane on a pull request", () => {
	// The change that pays for itself: no native surface, no macOS slot.
	const { bad } = gateVerdict({
		needs: suite({ "native-proofs": { result: "skipped" } }),
		eventName: "pull_request",
		nativeScope: "false",
	});
	assert.deepEqual(bad, []);
});

test("a native-touching diff may NOT skip the native lane on a pull request", () => {
	// NEGATIVE CONTROL. If this ever passes, the lane stopped proving anything.
	const { bad } = gateVerdict({
		needs: suite({ "native-proofs": { result: "skipped" } }),
		eventName: "pull_request",
		nativeScope: "true",
	});
	assert.deepEqual(bad, [{ job: "native-proofs", result: "skipped" }]);
});

test("a native-touching diff may NOT skip the lane on a dispatch either", () => {
	// The hole that was open on main: `native_proofs=false` on a dispatch used
	// to certify a head that needs the proof.
	const { bad } = gateVerdict({
		needs: suite({ "native-proofs": { result: "skipped" } }),
		eventName: "workflow_dispatch",
		nativeScope: "true",
	});
	assert.deepEqual(bad, [{ job: "native-proofs", result: "skipped" }]);
});

test("main's own push and nightly runs keep skipping the lane", () => {
	// The workflow computes `nativeSkipAllowed` for exactly these runs; the
	// verdict no longer guesses it from the event name.
	for (const eventName of ["push", "schedule"]) {
		const { bad } = gateVerdict({
			needs: suite({ "native-proofs": { result: "skipped" } }),
			eventName,
			nativeScope: "true",
			nativeSkipAllowed: "true",
		});
		assert.deepEqual(bad, [], `${eventName} must not require the native lane`);
	}
});

test("a dispatch of the default branch keeps its post-merge role", () => {
	const { bad } = gateVerdict({
		needs: suite({ "native-proofs": { result: "skipped" } }),
		eventName: "workflow_dispatch",
		nativeScope: "true",
		nativeSkipAllowed: "true",
	});
	assert.deepEqual(bad, []);
});

test("a branch dispatch asks the scope question", () => {
	// Round 1 found the dispatch path forcing `native=true` for every ref, which
	// made a docs-only branch dispatch red. It now computes the diff, so a scope
	// of `false` must pass and a scope of `true` must not.
	const skip = { ...suite({ "native-proofs": { result: "skipped" } }) };
	assert.deepEqual(
		gateVerdict({
			needs: skip,
			eventName: "workflow_dispatch",
			nativeScope: "false",
		}).bad,
		[],
	);
	assert.deepEqual(
		gateVerdict({
			needs: skip,
			eventName: "workflow_dispatch",
			nativeScope: "true",
		}).bad,
		[{ job: "native-proofs", result: "skipped" }],
	);
});

test("unset scope is not a licence to skip", () => {
	// An older caller, a broken output step, an empty value: all unknown, all
	// treated as "the lane was needed".
	for (const nativeScope of ["", undefined, null]) {
		const { bad } = gateVerdict({
			needs: suite({ "native-proofs": { result: "skipped" } }),
			eventName: "pull_request",
			nativeScope,
		});
		assert.deepEqual(
			bad,
			[{ job: "native-proofs", result: "skipped" }],
			`scope ${String(nativeScope)} must not allow the skip`,
		);
	}
});

test("changes may never skip, and failures never pass", () => {
	const skip = gateVerdict({
		needs: suite({ changes: { result: "skipped" } }),
		eventName: "push",
		nativeScope: "true",
	});
	assert.deepEqual(skip.bad, [{ job: "changes", result: "skipped" }]);

	const failed = gateVerdict({
		needs: suite({
			test: { result: "failure" },
			"native-proofs": { result: "cancelled" },
		}),
		eventName: "pull_request",
		nativeScope: "false",
	});
	assert.deepEqual(failed.bad, [
		{ job: "test", result: "failure" },
		{ job: "native-proofs", result: "cancelled" },
	]);
});

test("other suite jobs may still skip, as they could before", () => {
	const { bad } = gateVerdict({
		needs: suite({ "desktop-tests-result": { result: "skipped" } }),
		eventName: "pull_request",
		nativeScope: "true",
	});
	assert.deepEqual(bad, []);
});
