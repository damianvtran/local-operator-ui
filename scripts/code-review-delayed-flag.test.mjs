import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * `useDelayedFlag`'s contract, pinned where review round 1's F-2 said it
 * should be: a COMMITTED test rather than a scenario each round re-derives.
 *
 * WHY THE HOOK NEEDS ONE. The no-flicker rule (design §4) is a statement
 * about TIME, and no still can show it: the loading line must not paint
 * before the reveal threshold, must clean up when the row resolves early or
 * unmounts, and must re-arm when the state toggles - the three ways a
 * delayed flag leaks a timer or paints a frame the fetch never asked for.
 * The reviewer exercised all of it once (round 1, item 2); this file keeps
 * that exercise running.
 *
 * WHAT IS REAL: the shipped hook, bundled from the tree, under a real
 * `react-dom` root in jsdom - the same shape `agents-composer-mount.test.mjs`
 * runs. What is instrumented, and only that: `window.setTimeout` /
 * `window.clearTimeout` / `window.setInterval`, so "armed once", "cleared on
 * deactivate", "re-armed on toggle" and "no interval" are observations
 * rather than readings of the hook's source.
 *
 * TIMING POLICY, stated because wall-clock assertions are this suite's known
 * flake class: the no-early-reveal claim is asserted as an INEQUALITY over
 * `performance.now()` stamps (the reveal cannot precede its own timer), not
 * as "still hidden after a sleep" - so a busy machine slows the test down
 * without making it lie. The sleeps only decide when to stop waiting.
 */

const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/code-review",
});
for (const key of Object.getOwnPropertyNames(DOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = DOM.window[key];
	} catch {
		// jsdom's own accessors refuse to be read out of scope.
	}
}
globalThis.window = DOM.window;
globalThis.document = DOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (callback) =>
	setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);

/*
 * THE TIMER RECORD: every arm, every clear, every fire, every interval. `h`
 * is the jsdom handle so clear/fire can be matched against the arm.
 */
const timers = { armed: [], cleared: [], fired: new Set(), intervals: 0 };
const realSetTimeout = DOM.window.setTimeout.bind(DOM.window);
const realClearTimeout = DOM.window.clearTimeout.bind(DOM.window);
const realSetInterval = DOM.window.setInterval.bind(DOM.window);
DOM.window.setTimeout = (fn, ms, ...rest) => {
	const at = performance.now();
	// The callback runs after this assignment completes, so the closure can
	// name the handle it is going to record.
	const handle = realSetTimeout(
		() => {
			timers.fired.add(handle);
			fn();
		},
		ms,
		...rest,
	);
	timers.armed.push({ h: handle, ms, at });
	return handle;
};
DOM.window.clearTimeout = (handle) => {
	timers.cleared.push(handle);
	realClearTimeout(handle);
};
DOM.window.setInterval = (...args) => {
	timers.intervals += 1;
	return realSetInterval(...args);
};

const resetTimers = () => {
	timers.armed.length = 0;
	timers.cleared.length = 0;
	timers.fired.clear();
};

/** Every timer this test armed has since fired or been cleared - no leaks. */
const assertNoLiveTimers = () => {
	const live = timers.armed.filter(
		({ h }) => !timers.cleared.includes(h) && !timers.fired.has(h),
	);
	assert.deepEqual(live, [], "an armed timer is neither fired nor cleared");
};

const bundle = await build({
	stdin: {
		contents: [
			'export { useDelayedFlag } from "../src/renderer/src/features/code-review/hooks/use-delayed-flag";',
			'export { createRoot } from "react-dom/client";',
		].join("\n"),
		resolveDir: `${process.cwd()}/scripts`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	external: ["react", "react-dom", "react-dom/client"],
});
const bundlePath = new URL(
	"._code-review-delayed-flag.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));
const { useDelayedFlag, createRoot } = await import(bundlePath.href);

/*
 * THE PROBE: one `loading` event per render, stamped, so "exactly one
 * setState at the threshold" and "nothing after unmount" are counts over
 * real renders rather than assumptions about the hook.
 */
const probe = { events: [] };
const Harness = ({ active, delayMs }) => {
	const loading = useDelayedFlag(active, delayMs);
	probe.events.push({ t: performance.now(), loading });
	return null;
};

const mounts = [];
const mount = async (props) => {
	probe.events.length = 0;
	resetTimers();
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(React.createElement(Harness, props));
	});
	const record = {
		host,
		root,
		render: async (next) => {
			await act(async () => {
				root.render(React.createElement(Harness, next));
			});
		},
		unmount: async () => {
			await act(async () => {
				root.unmount();
			});
		},
	};
	mounts.push(record);
	return record;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits inside `act` until a true event exists or `budgetMs` elapses. */
const waitForReveal = async (budgetMs) => {
	const deadline = performance.now() + budgetMs;
	while (performance.now() < deadline) {
		if (probe.events.some((event) => event.loading)) return;
		await act(async () => {
			await sleep(40);
		});
	}
};

after(async () => {
	for (const { unmount } of mounts) await unmount();
	DOM.window.close();
});

test("a delay hides the flag until the threshold, then one setState reveals it", async () => {
	const { unmount } = await mount({ active: true, delayMs: 400 });
	assert.equal(timers.armed.length, 1, "one timer armed while active");
	assert.equal(timers.armed[0].ms, 400);
	assert.deepEqual(
		probe.events.map((event) => event.loading),
		[false],
		"the first paint is hidden",
	);

	await waitForReveal(1500);
	const revealed = probe.events.filter((event) => event.loading);
	assert.equal(revealed.length, 1, "exactly one reveal render");
	assert.ok(
		revealed[0].t - timers.armed[0].at >= 380,
		"the reveal cannot precede its own timer (>= delay, 20ms slack)",
	);

	// Stable afterwards: no repeats, no re-arm, no interval.
	const atReveal = probe.events.length;
	await act(async () => {
		await sleep(400);
	});
	assert.equal(probe.events.length, atReveal, "no further renders at rest");
	assert.equal(
		timers.armed.length,
		1,
		"the timer is never re-armed while active",
	);
	assert.equal(timers.intervals, 0, "no interval exists in this hook");
	assertNoLiveTimers();
	await unmount();
	assertNoLiveTimers();
});

test("deactivating before the threshold clears the timer and never reveals", async () => {
	const { render, unmount } = await mount({ active: true, delayMs: 400 });
	await act(async () => {
		await sleep(80);
	});
	await render({ active: false, delayMs: 400 });
	assert.ok(
		timers.cleared.includes(timers.armed[0].h),
		"the armed timer was cleared on deactivate",
	);

	await act(async () => {
		await sleep(600);
	});
	assert.equal(
		probe.events.some((event) => event.loading),
		false,
		"a deactivated flag never reveals",
	);
	const settled = probe.events.length;
	await act(async () => {
		await sleep(150);
	});
	assert.equal(probe.events.length, settled, "no late update after deactivate");
	assertNoLiveTimers();
	await unmount();
});

test("unmounting before the threshold clears the timer and stops all updates", async () => {
	const { unmount } = await mount({ active: true, delayMs: 400 });
	await act(async () => {
		await sleep(80);
	});
	await unmount();
	assert.ok(
		timers.cleared.includes(timers.armed[0].h),
		"the armed timer was cleared on unmount",
	);
	const settled = probe.events.length;
	await act(async () => {
		await sleep(600);
	});
	assert.equal(probe.events.length, settled, "nothing renders after unmount");
	assert.equal(
		probe.events.some((event) => event.loading),
		false,
		"no reveal reached a dead component",
	);
	assertNoLiveTimers();
});

test("a toggle re-arms; the reveal waits the live timer's full delay", async () => {
	const { render, unmount } = await mount({ active: true, delayMs: 400 });
	await act(async () => {
		await sleep(80);
	});
	await render({ active: false, delayMs: 400 });
	await render({ active: true, delayMs: 400 });
	assert.equal(timers.armed.length, 2, "one arm per activation");
	assert.ok(
		timers.cleared.includes(timers.armed[0].h),
		"the first arm was cleared before the second",
	);

	await act(async () => {
		await sleep(80);
	});
	assert.equal(
		probe.events.some((event) => event.loading),
		false,
		"the second arm is younger than the delay - still hidden",
	);

	await waitForReveal(1500);
	const revealed = probe.events.filter((event) => event.loading);
	assert.equal(
		revealed.length,
		1,
		"exactly one reveal render across both arms",
	);
	assert.ok(
		revealed[0].t - timers.armed[1].at >= 380,
		"the reveal follows the SECOND arm's timer, not the first",
	);
	assertNoLiveTimers();
	await unmount();
});

test("a zero delay reveals on the first effect-settled frame, with no timer", async () => {
	const { unmount } = await mount({ active: true, delayMs: 0 });
	assert.deepEqual(
		probe.events.map((event) => event.loading),
		[false, true],
		"the visible frame during the effect pass, then the reveal",
	);
	assert.equal(timers.armed.length, 0, "no timer exists for a zero delay");
	assert.equal(timers.intervals, 0);
	assertNoLiveTimers();
	await unmount();
});
