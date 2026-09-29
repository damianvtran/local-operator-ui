import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE REFUSED JUMP, PINNED (QA round 1, Q-1): the sentence a reader gets when
 * a checkpoint's row is further back than the near path can walk, and the fact
 * that it is said ONCE, as an INFO toast, through the real component.
 *
 * Why a mount and not a source pin: the sentence and its toast wiring are the
 * claim, and both are execution — the constant is private to
 * `canonical-transcript.tsx`, the toast goes through the toast channel
 * (sonner), and a refactor that renamed either while leaving the other behind
 * would keep any text pin green. So this file mounts the shipped
 * `CanonicalTranscript` with a scripted transport that serves a manifest whose
 * only checkpoint is NOT in the transcript and whose page fetches refuse; it
 * presses the tick and reads the sonner history back.
 *
 * Only the network is faked (the `desktop-api$` seam `use-checkpoints.test.mjs`
 * established): the component, the hook, the rail, the jump loop and the toast
 * channel are all the shipped ones.
 */

const bundle = await build({
	stdin: {
		contents: `export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";
export { EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
export { MemoryRouter } from "react-router-dom";
export { toast } from "sonner";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The app's config loader reads `import.meta.env` at import time; an empty
	// object is the established stand-in (`backend-error-surfaces.test.mjs`).
	define: { "import.meta.env": "{}" },
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
	plugins: [
		{
			name: "checkpoints-transport-fixture",
			setup(builder) {
				builder.onResolve({ filter: /desktop-api$/ }, () => ({
					path: "transport",
					namespace: "checkpoints-fixture",
				}));
				builder.onLoad(
					{ filter: /.*/, namespace: "checkpoints-fixture" },
					() => ({
						contents: `export * from ${JSON.stringify(
							`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
						)}
export const desktopResult = (request) => globalThis.__railRequest(request);`,
						loader: "js",
						resolveDir: process.cwd(),
					}),
				);
			},
		},
	],
	write: false,
});

/*
 * The bootstrap DOM before the import, as `checkpoint-rail.test.mjs` documents:
 * module-scope environment probes (`canUseDOM`-style constants) capture a
 * browserless answer for the whole process otherwise.
 */
const bootstrap = new JSDOM("<!doctype html><div></div>", {
	url: "http://localhost/",
});
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
const bundlePath = new URL(
	"./_transcript-rail-refusal.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { CanonicalTranscript, EMPTY_TRANSCRIPT, MemoryRouter, toast } =
	await import(bundlePath.href);
await unlink(bundlePath);
const { createRoot } = await import("react-dom/client");

/** The sentence, verbatim from `canonical-transcript.tsx`. */
const REFUSAL =
	"Could not reach that turn. It is further back than the loaded history.";

/** The manifest's one checkpoint, absent from the empty transcript below. */
const checkpoint = {
	id: "u-old",
	kind: "user",
	turn: 1,
	ts: 1780000000,
	seq: 1,
	text: "an old message",
};

test("a refused tick jump says the shipped sentence once, as info", async () => {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	const { window } = dom;
	const originals = new Map();
	const shims = {
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		HTMLButtonElement: window.HTMLButtonElement,
		HTMLInputElement: window.HTMLInputElement,
		Element: window.Element,
		Node: window.Node,
		Event: window.Event,
		CustomEvent: window.CustomEvent,
		MouseEvent: window.MouseEvent,
		KeyboardEvent: window.KeyboardEvent,
		MutationObserver: window.MutationObserver,
		NodeFilter: window.NodeFilter,
		getComputedStyle: window.getComputedStyle.bind(window),
		requestAnimationFrame: window.requestAnimationFrame.bind(window),
		cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
		ResizeObserver: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
		IntersectionObserver: class {
			observe() {}
			unobserve() {}
			disconnect() {}
			takeRecords() {
				return [];
			}
		},
		localStorage: window.localStorage,
		sessionStorage: window.sessionStorage,
		matchMedia: (query) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener() {},
			removeListener() {},
			addEventListener() {},
			removeEventListener() {},
			dispatchEvent() {
				return false;
			},
		}),
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

	/*
	 * The scripted transport. The manifest answers once; the jump's page fetch
	 * (`sessions.history`) refuses, which is the near path's budget dying at
	 * its first page. Every request is recorded so the assertions can name
	 * what was asked.
	 */
	const requests = [];
	globalThis.__railRequest = async (request) => {
		requests.push(request);
		if (request.op === "sessions.checkpoints") {
			return {
				session_id: "s1",
				index: { state: "ready" },
				checkpoints: [checkpoint],
			};
		}
		throw new Error(`unscripted op ${request.op}`);
	};

	const containerRef = { current: null };
	const root = createRoot(window.document.getElementById("root"));
	try {
		await act(async () => {
			root.render(
				React.createElement(
					MemoryRouter,
					null,
					React.createElement(CanonicalTranscript, {
						frontend: { session_id: "s1" },
						transcript: EMPTY_TRANSCRIPT,
						gate: null,
						waiting: false,
						starting: false,
						loadingOlder: false,
						// The near path's refuse-from-the-first-page arm: no page
						// ever applies, so the target can never be reached.
						onLoadOlder: async () => false,
						containerRef,
						isSmallView: false,
						status: "live",
						failure: null,
						awaitingHydration: false,
						onReconnect: () => {},
					}),
				),
			);
		});
		await act(async () => {});
		const tick = window.document.querySelector(
			`[data-lo-checkpoint-rail] [data-checkpoint-id="${checkpoint.id}"]`,
		);
		assert.ok(tick, "the manifest's tick renders on the rail");
		await act(async () => {
			tick.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		});
		await act(async () => {});
		const refusals = toast
			.getHistory()
			.filter((entry) => entry.title === REFUSAL);
		assert.equal(refusals.length, 1, "one sentence, not one per attempt");
		assert.equal(refusals[0].type, "info", "an INFO toast, not an error");
		assert.deepEqual(
			requests.map((request) => request.op),
			["sessions.checkpoints"],
			"the jump asked the page source once and refused before any further read",
		);
	} finally {
		await act(async () => {
			root.unmount();
		});
		for (const [name, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else Reflect.deleteProperty(globalThis, name);
		}
		dom.window.close();
	}
});
