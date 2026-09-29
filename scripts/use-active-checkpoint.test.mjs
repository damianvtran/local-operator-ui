import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE ACTIVE CUE'S TIMING — when a read runs relative to the scroll stream.
 *
 * The cue's contract is "exactly one active mark whenever the reader is at
 * rest", and the failure UX round 1 found (N1) was a read timed wrong rather
 * than answered wrong: one -1600 px wheel left the cue null for the whole rest
 * window while a fresh read of the SAME settled state found a checkpoint
 * (`u0188`, on the 402-mark fixture). A claim about WHEN a read happens can
 * only be pinned where the clock is controllable, so the hook is driven
 * through a real client render under node's mock timers: `window`'s rAF and
 * timers are routed to `globalThis`, whose are mocked, and every rect is
 * stubbed by the case because jsdom has no layout.
 *
 * The first case is the regression itself and fails on the pre-N1 wiring (it
 * had no trailing read, so the settled state was never read and the cue stayed
 * null); the other two pin the halves that keep it honest - the leading read
 * during a gesture, and the effect's own re-read when a page lands without one.
 */

const bundle = await build({
	stdin: {
		contents: `
			import { createElement, useRef } from "react";
			import { useActiveCheckpoint } from "./src/renderer/src/features/chat/canonical/use-active-checkpoint";
			export { ACTIVE_CUE_SETTLE_MS } from "./src/renderer/src/features/chat/canonical/use-active-checkpoint";
			/*
			 * The probe: the region div carries the row elements the hook
			 * queries, and every render hands its answer to the tracker so a
			 * test reads the LAST one after any sequence of events.
			 */
			export function Harness({ rows, checkpoints, track }) {
				const ref = useRef(null);
				const cue = useActiveCheckpoint(ref, rows, checkpoints);
				track(cue);
				return createElement(
					"div",
					{ ref, "data-region": "" },
					rows.map((row) =>
						createElement("div", {
							key: row.record.id,
							"data-record-id": row.record.id,
						}),
					),
				);
			}
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	mainFields: ["module", "main"],
	conditions: ["import"],
	external: ["react", "react-dom", "react/jsx-runtime"],
	write: false,
});
// Written beside this file rather than imported as a data: URL, for the reason
// `warm-session.test.mjs` gives: react stays external, and a data: URL has no
// base path from which to resolve it.
const bundlePath = new URL(
	"./_use-active-checkpoint.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { Harness, ACTIVE_CUE_SETTLE_MS } = await import(bundlePath.href);
await unlink(bundlePath);
const { createRoot } = await import("react-dom/client");

/** The one field the cue reads off a row. */
const row = (id) => ({ record: { id } });

/** A checkpoint for the manifest filter (only `id` is read by the cue). */
const user = (id) => ({
	id,
	kind: "user",
	turn: 1,
	ts: 1780000000,
	seq: 1,
	text: "a message",
});

/** A zero rect with a chosen top, so `getBoundingClientRect` has a shape. */
const rect = (top) => ({
	top,
	left: 0,
	right: 0,
	bottom: top,
	width: 0,
	height: 0,
	x: 0,
	y: top,
	toJSON: () => ({}),
});

/**
 * A DOM and a root for one case. The scroll stream is the subject, so the
 * region's and the rows' rects are set per case and the scroll events are
 * dispatched by hand; `window`'s two schedulers resolve against `globalThis`
 * so `t.mock.timers` drives both.
 */
async function mountCue({ rows, checkpoints }) {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
	});
	const { window } = dom;
	window.requestAnimationFrame = (callback) =>
		globalThis.setTimeout(() => callback(Date.now()), 16);
	window.cancelAnimationFrame = (id) => globalThis.clearTimeout(id);
	window.setTimeout = (...args) => globalThis.setTimeout(...args);
	window.clearTimeout = (...args) => globalThis.clearTimeout(...args);
	const originals = new Map();
	const shims = {
		window,
		document: window.document,
		IS_REACT_ACT_ENVIRONMENT: true,
	};
	for (const [name, value] of Object.entries(shims)) {
		originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		Object.defineProperty(globalThis, name, {
			configurable: true,
			writable: true,
			value,
		});
	}
	if (typeof globalThis.CSS?.escape !== "function") {
		/*
		 * Not every jsdom this repo runs ships `CSS.escape`; the ids these
		 * cases use are attribute-safe, so an identity escape is enough.
		 */
		originals.set("CSS", Object.getOwnPropertyDescriptor(globalThis, "CSS"));
		globalThis.CSS = { escape: (value) => String(value) };
	}
	const root = createRoot(window.document.getElementById("root"));
	let latest = null;
	const track = (result) => {
		latest = result;
	};
	const render = async (nextRows) => {
		await act(async () => {
			root.render(
				React.createElement(Harness, {
					rows: nextRows,
					checkpoints,
					track,
				}),
			);
		});
	};
	await render(rows);
	const region = window.document.querySelector("[data-region]");
	region.getBoundingClientRect = () => rect(0);
	return {
		latest: () => latest,
		region,
		/** Stub every named row's top (the region's own top is 0). */
		setTops: (tops) => {
			for (const [id, top] of Object.entries(tops)) {
				const element = window.document.querySelector(
					`[data-record-id="${id}"]`,
				);
				element.getBoundingClientRect = () => rect(top);
			}
		},
		scroll: () => {
			region.dispatchEvent(new window.Event("scroll"));
		},
		reRender: async (nextRows) => {
			await render(nextRows);
		},
		flush: async () => {
			await act(async () => {});
		},
		close: async () => {
			await act(async () => {
				root.unmount();
			});
			for (const [name, descriptor] of originals) {
				if (descriptor) Object.defineProperty(globalThis, name, descriptor);
				else Reflect.deleteProperty(globalThis, name);
			}
			dom.window.close();
		},
	};
}

test("a pull that ends on a transient re-reads once the scroll goes idle (N1)", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const cue = await mountCue({
		rows: [row("u1"), row("u2"), row("u3")],
		checkpoints: [user("u1"), user("u2"), user("u3")],
	});
	try {
		/*
		 * The pull's own transient: nothing loaded is above the edge at the
		 * moment the leading read runs - the live repro's null at +103 ms.
		 */
		cue.setTops({ u1: 6, u2: 20, u3: 300 });
		cue.scroll();
		t.mock.timers.tick(16);
		await cue.flush();
		assert.equal(
			cue.latest().activeId,
			null,
			"the leading read sees the transient",
		);
		/*
		 * The walk's page lands and the reader-position compensation settles
		 * the DOM - with NO further scroll event. The trailing read is the
		 * only one left, and it is what the pre-N1 wiring lacked.
		 */
		cue.setTops({ u1: 40, u2: -25, u3: 300 });
		await act(async () => {
			t.mock.timers.tick(ACTIVE_CUE_SETTLE_MS);
		});
		await cue.flush();
		assert.equal(
			cue.latest().activeId,
			"u2",
			"the settle re-read lands on the settled state",
		);
	} finally {
		await cue.close();
	}
});

test("during a gesture the leading read still tracks every frame", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const cue = await mountCue({
		rows: [row("u1"), row("u2")],
		checkpoints: [user("u1"), user("u2")],
	});
	try {
		cue.setTops({ u1: -10, u2: 200 });
		cue.scroll();
		t.mock.timers.tick(16);
		await cue.flush();
		assert.equal(cue.latest().activeId, "u1", "one frame behind the event");
		/* A second event mid-stream re-reads again, not only at the settle. */
		cue.setTops({ u1: 30, u2: -5 });
		cue.scroll();
		t.mock.timers.tick(16);
		await cue.flush();
		assert.equal(
			cue.latest().activeId,
			"u2",
			"the next frame follows the moved edge",
		);
	} finally {
		await cue.close();
	}
});

test("a page that lands without a scroll re-reads through the effect", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const cue = await mountCue({
		rows: [row("u1"), row("u2")],
		checkpoints: [user("u1"), user("u2"), user("u3")],
	});
	try {
		cue.setTops({ u1: -50, u2: 200 });
		cue.scroll();
		t.mock.timers.tick(16);
		await cue.flush();
		assert.equal(cue.latest().activeId, "u1");
		/*
		 * A page arrives: the store grows, the loaded set is the effect's
		 * dependency, and the fresh row reads at the top of the DOM (jsdom's
		 * zero rect), so the cue moves with it and no event was sent.
		 */
		await cue.reRender([row("u1"), row("u2"), row("u3")]);
		await cue.flush();
		assert.equal(
			cue.latest().activeId,
			"u3",
			"the load alone re-read (the effect depends on the loaded set)",
		);
		assert.equal(cue.latest().loadedIds.has("u3"), true, "and the store grew");
	} finally {
		await cue.close();
	}
});
