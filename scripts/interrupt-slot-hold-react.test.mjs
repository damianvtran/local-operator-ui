#!/usr/bin/env node
/**
 * The grace window's CLOCK, driven through the shipped hook.
 *
 * WHY THIS FILE EXISTS. `interrupt-control.test.mjs` proves the fold's rules -
 * which instants hold the box and which release it - and it proves where the
 * composer reads them from. Neither can answer what the WIRING does over time:
 * that a mount arms nothing, that one falling edge arms exactly one timer of the
 * shipped length, that a control returning inside the window CLEARS it rather
 * than leaving it armed behind a dropped deadline, that the next falling edge
 * opens a fresh window, and that unmounting disarms what is left. Code review
 * round 1 (m1) filed exactly that: the timer was correct as far as anyone could
 * trace, and a trace is not a result.
 *
 * The composer itself cannot be mounted here - its module graph reads
 * `import.meta.env` at import time, which is why the source-scraping tests in
 * `interrupt-control.test.mjs` exist at all. So the probe below is the hook plus
 * one attribute: what the row does with the hook's answer is that file's
 * business, and the hook is where the clock lives.
 *
 * The timers are REAL and merely RECORDED - unlike `composer-tip-react.test.mjs`,
 * which replaces its clock outright, because React's own scheduler schedules
 * through `setTimeout` too and a wholesale replacement would take React's
 * flushing with it. Recording keeps both honest: the assertions about arms and
 * clears read the registry, and the assertions about what a user sees wait for
 * the real timer, so a hook that armed nothing would fail both.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

// React DOM feature-detects input events at import time. Give it a document
// before loading it, rather than activating its legacy IE event polyfill.
const bootstrapDOM = new JSDOM("<!doctype html>");
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

const bundle = await build({
	stdin: {
		contents: `
			export { useInterruptSlotHold } from "./src/renderer/src/features/chat/hooks/use-interrupt-slot-hold";
			export { INTERRUPT_SLOT_GRACE_MS } from "./src/renderer/src/features/chat/interrupt-slot-grace";
		`,
		loader: "ts",
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	write: false,
});
const bundlePath = new URL(
	`./_interrupt-slot-hold-react-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { INTERRUPT_SLOT_GRACE_MS, useInterruptSlotHold } = await import(
	bundlePath.href
);
await unlink(bundlePath);

const h = React.createElement;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The hook, and nothing else: the row's answer as an attribute. */
function Probe({ active }) {
	const hold = useInterruptSlotHold(active);
	return h("span", { "data-held": String(hold.held) });
}

/**
 * One mounted probe, with every arm and clear of a timer recorded.
 *
 * `armsForTheWindow` filters to the SHIPPED delay rather than to "our timer":
 * React's scheduler arms its own work with 0ms, and a test that could not tell
 * them apart would count a render as the box's hold. Nothing here restates the
 * number - it is imported from the module under test.
 */
async function fixture(run) {
	const dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true });
	const { window } = dom;
	const arms = [];
	const clears = [];
	const live = new Map();
	const realSetTimeout = globalThis.setTimeout;
	const realClearTimeout = globalThis.clearTimeout;
	globalThis.setTimeout = (fn, delay, ...rest) => {
		const id = realSetTimeout(fn, delay, ...rest);
		live.set(id, delay);
		arms.push({ id, delay });
		return id;
	};
	globalThis.clearTimeout = (id) => {
		live.delete(id);
		clears.push(id);
		return realClearTimeout(id);
	};
	const originals = [];
	for (const [key, value] of Object.entries({
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		IS_REACT_ACT_ENVIRONMENT: true,
	})) {
		originals.push([key, Object.getOwnPropertyDescriptor(globalThis, key)]);
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value,
		});
	}

	const root = createRoot(window.document.getElementById("root"));
	const api = {
		/** What the row reads: the hook's own `held`. */
		held: () =>
			window.document
				.querySelector("[data-held]")
				?.getAttribute("data-held") === "true",
		/** Every timer armed for the shipped window, in order. */
		arms: () => arms.filter((arm) => arm.delay === INTERRUPT_SLOT_GRACE_MS),
		/** Whether the given arm is still pending. */
		pending: (id) => live.has(id),
		cleared: (id) => clears.includes(id),
		render: async (active) => {
			await act(async () => {
				root.render(h(Probe, { active }));
			});
		},
		/** Let real time pass, with React flushing whatever it wakes up. */
		wait: async (ms) => {
			await act(async () => {
				await sleep(ms);
			});
		},
		unmount: async () => {
			await act(async () => {
				root.unmount();
			});
		},
	};

	try {
		await run(api);
	} finally {
		globalThis.setTimeout = realSetTimeout;
		globalThis.clearTimeout = realClearTimeout;
		for (const [key, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
		window.close();
	}
}

test("a freshly mounted idle composer holds nothing and arms no timer", async () => {
	await fixture(async (probe) => {
		await probe.render(false);
		assert.equal(probe.held(), false, "an idle composer held a reservation");
		assert.equal(
			probe.arms().length,
			0,
			"mounting armed a timer: the window must open on a transition, never on a render",
		);
	});
});

test("the falling edge arms exactly one window, and the real timer releases the box", async () => {
	await fixture(async (probe) => {
		// A turn runs: the control is offered, and the box is not something the row
		// needs to draw beside it.
		await probe.render(true);
		assert.equal(probe.held(), true, "a running turn left the box unheld");
		assert.equal(
			probe.arms().length,
			0,
			"a running turn armed a timer: there is no deadline to keep while the control is on screen",
		);
		// The turn ends: one window, of the shipped length, armed once.
		await probe.render(false);
		assert.equal(probe.held(), true, "the falling edge did not hold the box");
		const armed = probe.arms();
		assert.equal(
			armed.length,
			1,
			`the falling edge armed ${armed.length} windows instead of one`,
		);
		assert.equal(
			armed[0].delay,
			INTERRUPT_SLOT_GRACE_MS,
			"the window armed is not the shipped length",
		);
		assert.ok(probe.pending(armed[0].id), "the window's timer is not pending");
		// ... and the release is the timer firing, not a render: nothing releases it
		// early, and it has released one tick past the window.
		await probe.wait(INTERRUPT_SLOT_GRACE_MS + 60);
		assert.equal(
			probe.held(),
			false,
			"the box was still held after the window",
		);
		assert.equal(
			probe.arms().length,
			1,
			"the release re-armed the window: the box would be held forever",
		);
	});
});

test("a control that returns inside the window clears the timer, and the next edge opens a fresh one", async () => {
	await fixture(async (probe) => {
		await probe.render(true);
		await probe.render(false);
		const first = probe.arms()[0];
		assert.ok(first, "the first falling edge armed nothing");
		// The turn restarts 40ms into the window. The deadline must be DROPPED rather
		// than inherited: the control is on screen again, so a timer left armed would
		// release a box the running turn does not need released.
		await probe.wait(40);
		await probe.render(true);
		assert.equal(probe.held(), true);
		assert.ok(
			probe.cleared(first.id),
			"the window's timer was left armed when the control came back",
		);
		assert.equal(probe.arms().length, 1, "the flip back armed a second window");
		// The second turn ends, inside what a deadline inherited from the first edge
		// would have called expired: a FRESH window must open, and it must be the one
		// that releases the box.
		await probe.wait(40);
		await probe.render(false);
		const second = probe.arms()[1];
		assert.ok(second, "the second falling edge armed no window");
		assert.notEqual(
			second.id,
			first.id,
			"the second window reused the first timer",
		);
		// Past the FIRST window's expiry - 500ms after the first edge - and still inside
		// the second one: a deadline inherited from the first edge would have released the
		// box here, which is the property this test exists for.
		const elapsed = 80;
		await probe.wait(INTERRUPT_SLOT_GRACE_MS + 20 - elapsed);
		assert.equal(
			probe.held(),
			true,
			"the box was released at the first window's expiry while the second window was still open",
		);
		// ... and released once the second window has run its own course.
		await probe.wait(120);
		assert.equal(probe.held(), false, "the box outlived the second window");
	});
});

test("unmounting inside the window disarms the timer", async () => {
	await fixture(async (probe) => {
		await probe.render(true);
		await probe.render(false);
		const armed = probe.arms()[0];
		assert.ok(armed, "the falling edge armed nothing");
		await probe.unmount();
		assert.ok(
			probe.cleared(armed.id),
			"the window's timer outlived the composer that opened it",
		);
	});
});
