import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act, createElement as h } from "react";

/*
 * THE SETTINGS-INTENT CHIP LINE AND SIDEBAR DOT, RENDERED (PR #1823 round 1).
 *
 * WHY THIS FILE EXISTS. The round-1 findings on these two surfaces are about
 * what a user can READ and where their focus LANDS, which no test over the
 * pure mirror reaches:
 * - D1 / U1: a failed chip's sentence carries the reason, and an ellipsised
 *   single line clipped it behind Retry/Dismiss. A failed row must wrap and
 *   carry the full sentence as its `title`; in-progress rows stay one line.
 * - U2: Retry, Dismiss and Cancel unmount the button that holds focus. The
 *   chip line must hand focus to `restoreFocus` (the composer input).
 * - D4: the sidebar dot must take no width of its own (absolutely placed in
 *   the row's locality cell), so a dot coming and going never shifts a title.
 * - U4: the dot's name is the slot's own chip sentence, not a generic line.
 * jsdom does no layout, so geometry is asserted on the classes that own it;
 * the rendered frames are the designer's re-capture.
 */

const dom = new JSDOM("<!doctype html><body></body>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const key of [
	"window",
	"document",
	"navigator",
	"HTMLElement",
	"Element",
	"Node",
	"SVGElement",
	"Event",
	"MouseEvent",
	"localStorage",
])
	Object.defineProperty(globalThis, key, {
		configurable: true,
		value: dom.window[key],
	});
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
// Frames run when the test flushes them, so "after React committed" is explicit.
const frames = [];
globalThis.requestAnimationFrame = (callback) => frames.push(callback);
globalThis.cancelAnimationFrame = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

const bundled = await build({
	stdin: {
		contents: `
export { SettingsIntentChips } from "./src/renderer/src/features/chat/session-status/settings-intent-chips";
export { SettingsIntentDot } from "./src/renderer/src/features/chat/components/chat-settings-intent-mark";
`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	write: false,
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: { ".css": "empty", ".svg": "text", ".png": "dataurl" },
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});
const mod = { exports: {} };
new Function("module", "exports", "require", bundled.outputFiles[0].text)(
	mod,
	mod.exports,
	(await import("node:module")).createRequire(import.meta.url),
);
const { SettingsIntentChips, SettingsIntentDot } = mod.exports;

const REASON = "The model acme/no-such-model is not in the catalogue.";
const failed = {
	kind: "model",
	value: "acme/no-such-model",
	request_id: "00000000-0000-4000-8000-000000000001",
	generation: 1,
	state: "failed",
	error: { code: "model_unknown", message: REASON, retryable: true },
};
const applying = { ...failed, state: "applying", error: null };

function mount() {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	return {
		host,
		render: (element) => act(() => root.render(element)),
		unmount: () => {
			act(() => root.unmount());
			host.remove();
		},
	};
}

test("D1: a failed chip wraps and carries its whole reason; a live chip stays one line", () => {
	const view = mount();
	view.render(
		h(SettingsIntentChips, {
			slots: {
				model: failed,
				effort: { ...applying, kind: "effort", value: "low" },
			},
			onRetry: () => {},
			onDismiss: () => {},
		}),
	);
	const row = view.host.querySelector('[data-settings-intent="model"]');
	const sentence = row.querySelector("span[title]");
	assert.ok(sentence.title.endsWith(REASON), "the title holds the full reason");
	assert.equal(sentence.textContent, sentence.title);
	const classes = sentence.className.split(/\s+/);
	assert.ok(!classes.includes("truncate"), "a failure is never ellipsised");
	assert.ok(classes.includes("whitespace-normal"));
	assert.ok(
		row.className.split(/\s+/).includes("flex-wrap"),
		"buttons drop under it",
	);
	const live = view.host
		.querySelector('[data-settings-intent="effort"]')
		.querySelector("span[title]");
	assert.ok(live.className.split(/\s+/).includes("truncate"));
	view.unmount();
});

test("U2: Dismiss hands focus to the composer once its button is gone", () => {
	const view = mount();
	const composer = document.createElement("textarea");
	document.body.append(composer);
	let slots = { model: failed };
	const props = () => ({
		slots,
		onRetry: () => {},
		onDismiss: () => {
			slots = {};
		},
		restoreFocus: () => composer.focus(),
	});
	view.render(h(SettingsIntentChips, props()));
	const dismiss = [...view.host.querySelectorAll("button")].find(
		(button) => button.textContent === "Dismiss",
	);
	dismiss.focus();
	assert.equal(document.activeElement, dismiss);
	act(() => dismiss.click());
	view.render(h(SettingsIntentChips, props())); // the slot is gone
	assert.equal(dismiss.isConnected, false);
	for (const frame of frames.splice(0)) frame();
	assert.equal(document.activeElement, composer);
	composer.remove();
	view.unmount();
});

test("U2: a click that leaves focus somewhere real is not yanked", () => {
	const view = mount();
	const composer = document.createElement("textarea");
	const elsewhere = document.createElement("input");
	document.body.append(composer, elsewhere);
	let restored = 0;
	view.render(
		h(SettingsIntentChips, {
			slots: { model: failed },
			onRetry: () => elsewhere.focus(),
			onDismiss: () => {},
			restoreFocus: () => {
				restored += 1;
			},
		}),
	);
	const retry = [...view.host.querySelectorAll("button")].find(
		(button) => button.textContent === "Retry",
	);
	act(() => retry.click());
	for (const frame of frames.splice(0)) frame();
	assert.equal(restored, 0);
	assert.equal(document.activeElement, elsewhere);
	composer.remove();
	elsewhere.remove();
	view.unmount();
});

test("D4 / U4: the dot takes no width and names the change it stands for", () => {
	const view = mount();
	view.render(
		h(SettingsIntentDot, {
			state: "failed",
			description: `Couldn't switch to GPT-6: ${REASON}`,
		}),
	);
	const dot = view.host.querySelector("[data-settings-intent-mark]");
	assert.equal(
		dot.getAttribute("aria-label"),
		`Couldn't switch to GPT-6: ${REASON}`,
	);
	assert.equal(dot.title, dot.getAttribute("aria-label"));
	const classes = dot.className.split(/\s+/);
	assert.ok(classes.includes("absolute"), "out of the row's flow");
	assert.ok(classes.includes("inset-0"), "centred in an empty locality cell");
	view.render(h(SettingsIntentDot, { state: "applying", corner: true }));
	const badge = view.host.querySelector("[data-settings-intent-mark]");
	assert.ok(badge.className.split(/\s+/).includes("-top-0.5"), "corner badge");
	assert.equal(badge.getAttribute("aria-label"), "Applying a settings change");
	// D5: the live dot pulses through the 0.75-trough keyframes, not 0.5.
	assert.ok(badge.firstElementChild.className.includes("lo-intent-pulse"));
	assert.ok(!badge.firstElementChild.className.includes("animate-pulse"));
	view.unmount();
});
