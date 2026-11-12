import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, mock, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * WHEN A CACHED PAINT ANNOUNCES ITSELF.
 *
 * THE DEFECT (operator report, 2026-11-12): "when i switch between team bridge
 * and session, it has some sort of loading mechanism to load conversation? looks
 * like it always does this". The rows were already on screen, and the indicator
 * still flashed on 60 of 60 measured returns because the snapshot takes a
 * median 165 ms to land (QA's mock daemon) and the indicator was drawn from the
 * first frame. The fix is a hold, and a hold is a clock - so this file owns the
 * clock with `node:test`'s mock timers rather than waiting one out.
 *
 * WHAT IS REAL: the shipped hook, mounted through React in jsdom. WHAT IS
 * STUBBED: time only. The cases are the hold's whole state machine - not yet,
 * now, never when the snapshot wins, immediate when the caller asks for no
 * hold, and a re-arm that does not inherit the previous clock.
 */

const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => {
	dom.window.close();
	for (const name of ["window", "document"]) {
		Reflect.deleteProperty(globalThis, name);
	}
});

const ROOT = resolve(import.meta.dirname, "..");
const result = await build({
	stdin: {
		contents:
			'export { useStaleIndicatorHold, STALE_INDICATOR_DELAY_MS } from "./src/renderer/src/features/chat/canonical/use-stale-indicator-hold";',
		resolveDir: ROOT,
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	external: ["react", "react/jsx-runtime"],
	write: false,
});
const cache = join(ROOT, "node_modules", ".cache", "stale-indicator-hold");
mkdirSync(cache, { recursive: true });
const bundlePath = join(cache, `bundle-${process.pid}.mjs`);
writeFileSync(bundlePath, result.outputFiles[0].text);
const { useStaleIndicatorHold, STALE_INDICATOR_DELAY_MS } = await import(
	pathToFileURL(bundlePath).href
);

/** Mounts the hook and records what it returns on every render. */
function mount(stale, delayMs) {
	const seen = [];
	const Probe = () => {
		const shown = useStaleIndicatorHold(stale, delayMs);
		seen.push(shown);
		return null;
	};
	const root = createRoot(document.getElementById("root"));
	act(() => root.render(React.createElement(Probe)));
	return {
		seen,
		last: () => seen.at(-1),
		rerender: (next, nextDelay) =>
			act(() =>
				root.render(
					React.createElement(() => {
						const shown = useStaleIndicatorHold(next, nextDelay);
						seen.push(shown);
						return null;
					}),
				),
			),
		unmount: () => act(() => root.unmount()),
	};
}

test("no indicator before the hold has elapsed", () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		const probe = mount(true, STALE_INDICATOR_DELAY_MS);
		assert.equal(
			probe.last(),
			false,
			"the first frame is the cached paint alone",
		);
		act(() => mock.timers.tick(STALE_INDICATOR_DELAY_MS - 1));
		assert.equal(probe.last(), false, "still inside the hold");
		act(() => mock.timers.tick(1));
		assert.equal(
			probe.last(),
			true,
			"at the threshold the indicator appears - a slow page is still stated",
		);
		probe.unmount();
	} finally {
		mock.timers.reset();
	}
});

test("a snapshot that lands first means the indicator never renders", () => {
	// THE COMMON RETURN: the measured mock distribution is median 165 ms, p90
	// 300 ms, max 434 ms, all inside the hold. `stale` going false before the
	// timer fires must leave the flag false, not flash it and take it away.
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		const probe = mount(true, STALE_INDICATOR_DELAY_MS);
		act(() => mock.timers.tick(200));
		probe.rerender(false, STALE_INDICATOR_DELAY_MS);
		assert.equal(probe.last(), false);
		act(() => mock.timers.tick(STALE_INDICATOR_DELAY_MS * 4));
		assert.equal(
			probe.last(),
			false,
			"the cleared timer cannot raise a stale flag",
		);
		assert.equal(
			probe.seen.includes(true),
			false,
			"it never rendered, not even for one commit",
		);
		probe.unmount();
	} finally {
		mock.timers.reset();
	}
});

test("a zero delay states the signal at once, for a caller with no hold", () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		const probe = mount(true, 0);
		assert.equal(
			probe.last(),
			true,
			"the remote/unproven case cannot wait: there are no readable rows under it",
		);
		probe.unmount();
	} finally {
		mock.timers.reset();
	}
});

test("a second cached paint waits its own hold", () => {
	// A raised flag must not survive the paint it described: the next cache
	// paint is a new observation and gets the whole delay again.
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		const probe = mount(true, STALE_INDICATOR_DELAY_MS);
		act(() => mock.timers.tick(STALE_INDICATOR_DELAY_MS));
		assert.equal(probe.last(), true);
		probe.rerender(false, STALE_INDICATOR_DELAY_MS);
		assert.equal(probe.last(), false);
		probe.rerender(true, STALE_INDICATOR_DELAY_MS);
		assert.equal(probe.last(), false, "the new paint starts its own clock");
		act(() => mock.timers.tick(STALE_INDICATOR_DELAY_MS));
		assert.equal(probe.last(), true);
		probe.unmount();
	} finally {
		mock.timers.reset();
	}
});
