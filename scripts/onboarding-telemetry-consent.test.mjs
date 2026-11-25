/**
 * The optional telemetry consent checkbox at the END of onboarding (operator
 * request, 2026-11-24: "have a small optional checkmark in the onboarding which
 * explains what the telemetry is used for ... add at the end").
 *
 *  T-1  It shows on the LAST step of each live sequence only - Meet with Aida,
 *       the default-model step with Radient and no Aida, Search with neither -
 *       and on no earlier step (`showsTelemetryConsent`, which the modal passes
 *       to the stage's `footerLead` slot).
 *  T-2  It reflects main's consent: unchecked while consent is off, checked when
 *       the user already opted in (e.g. via Settings -> Privacy).
 *  T-3  Toggling it calls the consent bridge's set(true) / set(false) - the one
 *       persisted write, the same path Settings uses.
 *  T-4  Without a consent bridge it renders nothing (nowhere to persist).
 *
 * jsdom + the real component, the `onboarding-step-block.test.mjs` shape.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act } from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
});
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// Accessors that refuse to be read out of context; not needed here.
	}
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");

const bundle = await build({
	stdin: {
		contents: `
			export { createElement } from "react";
			export { OnboardingTelemetryConsent } from "./src/renderer/src/features/onboarding/components/onboarding-telemetry-consent";
			export {
				onboardingSequence,
				showsTelemetryConsent,
			} from "./src/renderer/src/features/onboarding/components/onboarding-sequence";
			export { OnboardingStep } from "./src/renderer/src/shared/store/onboarding-store";
			export { useTelemetryConsentStore } from "./src/renderer/src/shared/analytics/use-telemetry-consent";
		`,
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
		"@renderer": "./src/renderer/src",
	},
	external: ["react", "react-dom", "react/jsx-runtime"],
	packages: "external",
	loader: { ".css": "empty" },
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	write: false,
});
const bundlePath = new URL(
	"./_onboarding-telemetry-consent.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));

const {
	createElement,
	OnboardingTelemetryConsent,
	onboardingSequence,
	showsTelemetryConsent,
	OnboardingStep,
	useTelemetryConsentStore,
} = await import(bundlePath.href);

const { CONNECT_PROVIDER, DEFAULT_MODEL, SEARCH, MEET } = OnboardingStep;

/** A consent bridge as the preload exposes it, recording every set(). */
const installBridge = (optedIn) => {
	const calls = [];
	let state = { optedIn, launchAllows: true, effective: optedIn };
	const listeners = new Set();
	window.api = {
		telemetryConsent: {
			get: async () => state,
			set: async (next) => {
				calls.push(next);
				state = { optedIn: next, launchAllows: true, effective: next };
				for (const listener of listeners) listener(state);
				return state;
			},
			onChange: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
	};
	return calls;
};

const mount = async (t) => {
	// The store is module state; each test starts from "unknown, not opted in".
	useTelemetryConsentStore.setState({
		state: { optedIn: false, launchAllows: true, effective: false },
		known: false,
	});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	t.after(async () => {
		await act(async () => root.unmount());
		container.remove();
		window.api = undefined;
	});
	await act(async () => {
		root.render(createElement(OnboardingTelemetryConsent));
	});
	// Let the bridge's get() resolve into the store.
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	return {
		container,
		box: () => container.querySelector('button[role="checkbox"]'),
	};
};

const click = async (element) => {
	await act(async () => {
		element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
};

test("T-1: the checkbox is on the last step of each sequence variant, and only there", () => {
	const variants = [
		// Aida available (no Radient): sign-in, model, search, Meet.
		{
			name: "Aida",
			input: { includeSearch: true, aidaAvailable: true },
			last: MEET,
		},
		// Radient connected, no Aida: search drops out, model is last.
		{
			name: "no Aida, Radient",
			input: { includeSearch: false, aidaAvailable: false },
			last: DEFAULT_MODEL,
		},
		// Neither: search is last.
		{
			name: "no Aida, no Radient",
			input: { includeSearch: true, aidaAvailable: false },
			last: SEARCH,
		},
	];
	for (const { name, input, last } of variants) {
		const sequence = onboardingSequence(input);
		const shown = sequence.filter((step) =>
			showsTelemetryConsent(step, sequence),
		);
		assert.deepEqual(shown, [last], `${name}: shown on ${shown}`);
	}
	// A persisted step outside the live sequence never shows it.
	const noMeet = onboardingSequence({
		includeSearch: true,
		aidaAvailable: false,
	});
	assert.equal(showsTelemetryConsent(MEET, noMeet), false);
	assert.equal(showsTelemetryConsent(CONNECT_PROVIDER, []), false);
});

test("T-2/T-3: unchecked while consent is off; toggling calls set(true) then set(false)", async (t) => {
	const calls = installBridge(false);
	const { box } = await mount(t);
	assert.ok(box(), "the checkbox renders when the bridge exists");
	assert.equal(box().getAttribute("aria-checked"), "false");

	await click(box());
	assert.deepEqual(calls, [true]);
	assert.equal(box().getAttribute("aria-checked"), "true");

	await click(box());
	assert.deepEqual(calls, [true, false]);
	assert.equal(box().getAttribute("aria-checked"), "false");
});

test("T-2: checked when the user already opted in (e.g. via Settings)", async (t) => {
	const calls = installBridge(true);
	const { box } = await mount(t);
	assert.equal(box().getAttribute("aria-checked"), "true");
	assert.deepEqual(calls, [], "mounting writes nothing");
});

test("T-4: without a consent bridge it renders nothing", async (t) => {
	window.api = undefined;
	const { container } = await mount(t);
	assert.equal(container.innerHTML, "");
});
