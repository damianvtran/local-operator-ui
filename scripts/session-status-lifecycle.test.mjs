import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * A real React lifecycle, not static markup: SessionStatusStrip normally mounts
 * before its frontend snapshot arrives, and can lose that snapshot on reconnect.
 * The old early return skipped the duration hooks only on the absent render,
 * so the next render threw React #310 and replaced the composer with its error
 * boundary. A static render of either state alone cannot catch that defect.
 *
 * The boundary below records that failure rather than letting React's error
 * recovery hide it. The same test also measures the interval/observer lifetime:
 * active time ticks, inactive banked time does not, and losing the snapshot or
 * unmounting cannot leave a timer or observer behind. Pixels remain the built
 * app control's responsibility; jsdom can prove the lifecycle and text only.
 */
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
Object.defineProperty(globalThis, "navigator", {
	configurable: true,
	value: dom.window.navigator,
});
for (const name of ["Node", "Element", "HTMLElement", "MutationObserver"]) {
	globalThis[name] = dom.window[name];
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const observers = new Set();
globalThis.ResizeObserver = class {
	observe() {
		observers.add(this);
	}
	disconnect() {
		observers.delete(this);
	}
};

const bundle = await build({
	stdin: {
		contents:
			'export { SessionStatusStrip } from "./src/renderer/src/features/chat/session-status/session-status-strip";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react-dom/server",
		"react/jsx-runtime",
	],
	jsx: "automatic",
	write: false,
});
const bundlePath = new URL(
	`./_session-status-lifecycle-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { SessionStatusStrip } = await import(bundlePath.href);
await unlink(bundlePath);
const { createRoot } = await import("react-dom/client");

const SNAPSHOT = {
	effective_model: {
		provider: "openrouter",
		model_id: "openai/gpt-5",
		display_name: "OpenAI: GPT-5",
		reasoning: true,
		reasoning_effort: "high",
		reasoning_efforts: ["minimal", "low", "medium", "high"],
		context_window: 400_000,
	},
	selected_model: null,
	context_tokens: null,
	context_window: 400_000,
	context_is_estimate: null,
	cumulative_parent_cost: null,
	cost_knowledge: "unknown",
};

test("a strip survives absent → active → inactive → absent frontend without hook errors or leaked clocks", async (t) => {
	const now = 1_760_000_000_000;
	t.mock.timers.enable({ apis: ["setInterval", "Date"], now });
	const intervals = new Set();
	const errors = [];
	class Boundary extends React.Component {
		state = { failed: false };
		static getDerivedStateFromError() {
			return { failed: true };
		}
		componentDidCatch(error) {
			errors.push(error.message);
		}
		render() {
			return this.state.failed
				? React.createElement("output", { "data-hook-error": true })
				: this.props.children;
		}
	}
	// React logs a caught error too; the explicit boundary assertion below is
	// the verdict, rather than writing a component payload to the test log.
	t.mock.method(console, "error", () => {});
	dom.window.setInterval = (...args) => {
		const id = globalThis.setInterval(...args);
		intervals.add(id);
		return id;
	};
	dom.window.clearInterval = (id) => {
		intervals.delete(id);
		globalThis.clearInterval(id);
	};
	const container = document.getElementById("root");
	const root = createRoot(container);
	const render = async (frontend, readingsDropped = false) => {
		await act(async () => {
			root.render(
				React.createElement(
					Boundary,
					null,
					React.createElement(SessionStatusStrip, {
						frontend,
						readingsDropped,
					}),
				),
			);
		});
		assert.deepEqual(
			errors,
			[],
			"the snapshot transition must not throw a hook-order error",
		);
		assert.equal(container.querySelector("[data-hook-error]"), null);
	};
	const duration = () =>
		container.querySelector("[data-lo-duration]")?.textContent;
	try {
		await render(null);
		assert.equal(container.querySelector("[data-lo-session-strip]"), null);
		assert.equal(intervals.size, 0, "no reading means no active-time clock");

		const active = {
			...SNAPSHOT,
			active_duration_s: 60,
			activity_started_at: now / 1000 - 5,
		};
		await render(active);
		assert.equal(
			duration(),
			"1m5s",
			"banked time plus the open edge, not wall lifetime",
		);
		assert.equal(intervals.size, 1, "one active-time interval");
		await act(async () => t.mock.timers.tick(2000));
		assert.equal(
			duration(),
			"1m7s",
			"an active turn advances at the existing cadence",
		);

		await render({
			...active,
			active_duration_s: 67,
			activity_started_at: null,
		});
		assert.equal(intervals.size, 0, "an inactive reading clears its clock");
		await act(async () => t.mock.timers.tick(10_000));
		assert.equal(
			duration(),
			"1m7s",
			"waiting between turns adds no active time",
		);

		await render(active);
		assert.equal(intervals.size, 1, "a new active reading owns one clock");
		await render(null, true);
		assert.ok(container.querySelector("[data-lo-readings-dropped]"));
		assert.equal(
			intervals.size,
			0,
			"losing the frontend clears the active clock",
		);
		assert.equal(
			observers.size,
			0,
			"losing the reading disconnects its fit observer",
		);

		await render(active);
		assert.equal(
			intervals.size,
			1,
			"a reconnected reading can start its clock again",
		);
	} finally {
		await act(async () => root.unmount());
		assert.equal(intervals.size, 0, "unmount leaves no active-time interval");
		assert.equal(observers.size, 0, "unmount leaves no fit observer");
		t.mock.timers.reset();
		dom.window.close();
	}
});
