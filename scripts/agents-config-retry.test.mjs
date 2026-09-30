import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * WHO GETS A "RETRY", AND WHO MUST NOT.
 *
 * WHY THIS FILE EXISTS RATHER THAN A FRAME. The configuration run's error states
 * all look alike on screen — a red sentence beside Dismiss — and the difference
 * that matters is not visible: on exactly ONE of them is the request still
 * outstanding. `fail()` keeps the run's id through every failure so the run
 * stays nameable (review round 1, M2), and the strip used to read that id as
 * "there is something to send again" — which put Retry on a settle-read failure,
 * a dropped transport and a refused Stop, where the request HAD been delivered
 * and pressing it would run it a second time (agent review round 2, M-new). A
 * frame cannot hold that distinction and a still cannot tell the states apart,
 * so the rule is pinned here against the REAL composer.
 *
 * WHAT IS REAL: the shipped `ConfigComposer`, `RunStrip` and `RunSummary`, the
 * `Button`/`Badge`/`Textarea` primitives and `cn`. What is faked, and only that:
 * the run handle itself, which is a plain object in every case — the states
 * under test are decisions about a value, not about a hook.
 *
 * WHAT IT IS NOT: evidence about pixels. jsdom has no layout engine, so nothing
 * here says where the strip sits; that is the frames' job.
 */

const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/agents",
});
/*
 * jsdom's constructors are forced onto the global: Node defines `Event` and
 * friends itself, and a React tree whose events are built from Node's classes
 * fails inside the commit phase with an error that reads like a component bug.
 * The recipe is `agents-offer-dismiss.test.mjs`'s.
 */
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

const bundle = await build({
	stdin: {
		contents: [
			'export { ConfigComposer } from "./src/renderer/src/features/agents/config-run/config-composer";',
			'export { createRoot } from "react-dom/client";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
	},
	external: ["react", "react-dom", "react/jsx-runtime"],
	packages: "external",
	jsx: "automatic",
});

/*
 * THE BUNDLE IS WRITTEN BESIDE THIS FILE AND IMPORTED BY PATH, which is the
 * pattern `agents-offer-dismiss.test.mjs` uses and the reason for it: the
 * component graph reaches bare specifiers (`react`, `clsx` through `cn`,
 * `lucide-react`), and a `data:` URL cannot resolve those — Node raises
 * ERR_UNSUPPORTED_RESOLVE_REQUEST on the first one. A dot-prefixed sibling file
 * resolves them from the repo's own `node_modules` and is removed as soon as the
 * suite finishes.
 */
const bundlePath = new URL("._agents-config-retry.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));
const { ConfigComposer, createRoot } = await import(bundlePath.href);

/**
 * One run handle, in a named state.
 *
 * The four failures the store can reach are distinguished by `unsent` (and the
 * composer by `canRetry`, which the hook derives from it): only a request the
 * run never received is retryable.
 */
const handle = (overrides = {}) => ({
	enabled: true,
	disabledReason: null,
	status: "error",
	sessionId: "session-1",
	topic: "Add a reviewer that only reads tests",
	error: "The run finished, but its results could not be read.",
	draft: "Add a reviewer that only reads tests",
	setDraft: () => undefined,
	about: null,
	setAbout: () => undefined,
	touched: [],
	step: null,
	elapsed: "4s",
	activity: [],
	results: [],
	answer: "",
	start: async () => undefined,
	stop: async () => undefined,
	retry: async () => undefined,
	canRetry: false,
	dismiss: () => undefined,
	starting: false,
	attached: false,
	...overrides,
});

const mount = async (run) => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(
			React.createElement(ConfigComposer, {
				run,
				about: null,
				onClearAbout: () => undefined,
			}),
		);
	});
	return { host, root };
};

test("a request that was never delivered offers Retry", async () => {
	const { host, root } = await mount(
		handle({
			// The sessions.message catch: the create landed, the prompt did not.
			unsent: true,
			canRetry: true,
			error:
				"The run was set up, but your request could not be sent. It is still in the box — send it again when the backend is reachable.",
		}),
	);
	assert.ok(
		host.querySelector('[data-testid="config-retry"]'),
		"Retry for an unsent request",
	);
	assert.match(host.textContent ?? "", /could not be sent/);
	await act(async () => root.unmount());
});

test("a failure that already delivered the request offers no Retry", async () => {
	/*
	 * THE THREE SHAPES M-new NAMED, each with the session id still set (which is
	 * the whole trap): a settle read that failed after the run may have written,
	 * a transport that dropped while the run is still going, and a Stop that was
	 * refused. In every one of them the request reached the run, so re-sending it
	 * is a second run of the same work.
	 */
	const shapes = [
		{
			label: "settle-read failure",
			error: "The run finished, but its results could not be read.",
		},
		{
			label: "stream failure",
			error: "The connection to the run was lost. It may still be going.",
		},
		{
			label: "stop failure",
			error: "The run could not be stopped.",
		},
	];
	for (const shape of shapes) {
		const { host, root } = await mount(
			handle({ canRetry: false, error: shape.error }),
		);
		assert.equal(
			host.querySelector('[data-testid="config-retry"]'),
			null,
			`no Retry on a ${shape.label}`,
		);
		// The error is still reported, and Dismiss is still the way out.
		assert.match(host.textContent ?? "", new RegExp(shape.error.slice(0, 24)));
		assert.ok(
			[...host.querySelectorAll("button")].some(
				(node) => node.textContent?.trim() === "Dismiss",
			),
			`Dismiss remains on a ${shape.label}`,
		);
		await act(async () => root.unmount());
	}
});
