import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

/*
 * NWSAPI 2.2.27 asks node.matches() for native :fullscreen/:modal state,
 * but JSDOM implements matches through NWSAPI itself. The resulting recursion
 * was 80% of an isolated speech-tooltip CPU profile. The scoped jsdom>nwsapi
 * override pins the upstream repair rather than changing product tooltips:
 * https://github.com/dperini/nwsapi/issues/215
 * https://github.com/dperini/nwsapi/commit/a6e79c4d32cafbb46d43a1ca27d451a130b7a3b9
 * Capturing the native matcher and guarding re-entry is shipped in 2.2.28.
 * Count actual DOM matcher calls, not elapsed time: this fails deterministically
 * with the old transitive dependency without a machine-dependent speed budget.
 * The defensive depth ceiling only contains the RED control's recursion; the
 * assertion still fails on every recursive call, even when NWSAPI catches it.
 */
for (const selector of [":fullscreen", ":modal"]) {
	test(`JSDOM ${selector} matching never re-enters its own selector engine`, () => {
		const dom = new JSDOM("<!doctype html><div></div>");
		const proto = dom.window.Element.prototype;
		const original = proto.matches;
		let calls = 0;
		let depth = 0;
		let maxDepth = 0;
		proto.matches = function (...args) {
			calls += 1;
			depth += 1;
			maxDepth = Math.max(maxDepth, depth);
			try {
				if (depth > 4) throw new Error("recursive DOM matcher control");
				return original.apply(this, args);
			} finally {
				depth -= 1;
			}
		};
		try {
			const result = dom.window.document.querySelector("div").matches(selector);
			console.log(JSON.stringify({ selector, result, calls, maxDepth }));
			assert.equal(result, false, "a plain JSDOM element has no native state");
			assert.equal(
				maxDepth,
				1,
				"native-state matching must not call back into JSDOM matches",
			);
			assert.equal(calls, 1, "only the caller's initial match is needed");
		} finally {
			proto.matches = original;
			dom.window.close();
		}
	});
}
