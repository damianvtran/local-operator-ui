import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * HOW OFTEN DOES THE RUN'S RECOVERY PROBE ASK THE SERVER WHILE THE TRANSCRIPT
 * IS STREAMING?
 *
 * WHY THIS FILE EXISTS RATHER THAN A FRAME OR A BEHAVIOUR TEST. The probe
 * (400 ms after it arms, then every 4 s) is what notices a turn that ended while
 * the page was away. Its effect once named `stream.transcript` in its
 * dependencies, so every transcript delta — and a streaming run emits one per
 * flush — tore the timers down and re-armed them: the cadence followed the
 * flush rate instead of the clock, `sessions.get` fired once per burst, and a
 * stream that never left a 400 ms gap SUPPRESSED the probe entirely. None of
 * that is visible in a rendering, an error state or a settle outcome: the only
 * observable is the number of calls, so the number is what is asserted here.
 *
 * WHAT IS REAL: the shipped `useConfigRun`, its store and summary, and every
 * line of the probe. What is faked: the transcript source, `desktopResult`
 * (which becomes the counter) and three side boundaries — see
 * `agents-config-probe-stubs.mjs`. The delta schedules below are the input.
 *
 * THE TWO SCHEDULES ARE THE TEST. A sustained stream pins the suppression (the
 * pre-fix code answers 0 calls here); the burst schedule pins the per-burst
 * churn (pre-fix, one call per burst; fixed, only the 400 ms first probe).
 */

const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/agents",
});
const FORCE_FROM_JSDOM = [
	"Event",
	"CustomEvent",
	"UIEvent",
	"MouseEvent",
	"PointerEvent",
	"KeyboardEvent",
	"FocusEvent",
	"InputEvent",
	"CompositionEvent",
	"HTMLElement",
	"Element",
	"Node",
	"DocumentFragment",
	"Range",
	"Selection",
	"DOMRect",
	"DOMRectReadOnly",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
];
for (const key of Object.getOwnPropertyNames(DOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = DOM.window[key];
	} catch {
		// jsdom's own accessors refuse to be read out of scope.
	}
}
globalThis.window = DOM.window;
globalThis.document = DOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
DOM.window.matchMedia = (query) => ({
	media: query,
	matches: false,
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => false,
});

const apiStub = new URL("agents-config-probe-api-stub.mjs", import.meta.url)
	.pathname;
const stubs = new URL("agents-config-probe-stubs.mjs", import.meta.url)
	.pathname;
const bundle = await build({
	stdin: {
		contents: [
			'export { useConfigRun } from "../src/renderer/src/features/agents/config-run/use-config-run";',
			'export { useConfigRunStore } from "../src/renderer/src/features/agents/config-run/config-run-store";',
			'export { pushTranscriptDelta } from "./agents-config-probe-stubs.mjs";',
			'export { calls as probeCalls } from "./agents-config-probe-api-stub.mjs";',
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
	jsx: "automatic",
	external: ["react", "react-dom", "react/jsx-runtime"],
	alias: {
		"@shared/api/local-operator/desktop-api": apiStub,
		"@shared/api/local-operator/desktop-hooks": stubs,
		"@shared/api/local-operator/profile-hooks": stubs,
		"@shared/hooks/use-canonical-session": stubs,
		"@shared/hooks/use-desktop-watch-lease": stubs,
		"@shared/utils/toast-manager": stubs,
		"@features/chat/interrupt-turn": stubs,
		"@tanstack/react-query": stubs,
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
});
const bundlePath = new URL(
	"._agents-config-probe-cadence.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));
const {
	useConfigRun,
	useConfigRunStore,
	pushTranscriptDelta,
	probeCalls,
	createRoot,
} = await import(bundlePath.href);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const probes = () =>
	probeCalls.filter((call) => call.op === "sessions.get").length;

function Harness() {
	useConfigRun();
	return null;
}

/** A live run, mounted, with a transcript that has said nothing yet. */
const mount = async () => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	probeCalls.length = 0;
	useConfigRunStore
		.getState()
		.adopt("session-1", "Add a reviewer that only reads tests", null);
	await act(async () => {
		root.render(React.createElement(Harness));
	});
	return root;
};

const delta = async () => {
	await act(async () => {
		pushTranscriptDelta(`chunk ${Math.random()}`);
	});
};

test("a sustained stream does not suppress the recovery probe", async () => {
	const root = await mount();
	try {
		/*
		 * 12 deltas, 50 ms apart: 600 ms of continuous streaming, which never leaves
		 * the 400 ms of quiet the pre-fix timer needed — and that code therefore
		 * answered zero calls, leaving a run whose turn ended while the page was away
		 * unsettled until a reload.
		 */
		for (let index = 0; index < 12; index += 1) {
			await delta();
			await sleep(50);
		}
		assert.ok(
			probes() >= 1,
			`the first probe fired during the stream (got ${probes()})`,
		);
	} finally {
		/*
		 * UNMOUNTED IN A `finally`, because a failed assertion here would otherwise
		 * leave the probe's 4 s interval armed and keep the test process alive — a
		 * red test that reports as a five-minute timeout instead of a failure.
		 */
		await act(async () => root.unmount());
	}
});

test("the probe answers a burst of deltas once, not once per burst", async () => {
	const root = await mount();
	try {
		/*
		 * Three deltas, then 440 ms of quiet, three times over. Pre-fix this is three
		 * calls (one per burst, each 400 ms after that burst's last flush); fixed it
		 * is the single first probe, because nothing about the schedule re-arms it.
		 */
		for (let burst = 0; burst < 3; burst += 1) {
			for (let index = 0; index < 3; index += 1) {
				await delta();
				await sleep(60);
			}
			await sleep(440);
		}
		assert.equal(
			probes(),
			1,
			"only the 400 ms probe ran: the interval is 4 s and the cadence ignores deltas",
		);
	} finally {
		await act(async () => root.unmount());
	}
});
