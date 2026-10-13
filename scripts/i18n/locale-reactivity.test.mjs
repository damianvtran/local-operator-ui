import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * REACTIVITY — a t() consumer must REPAINT on a locale change.
 *
 * The reviewer's concern, verified in source: `t()` is a plain function read at
 * call time; it does NOT subscribe. A component that calls `t()` therefore also
 * has to read the store through `useI18nLocale()` (which is
 * `useSyncExternalStore(subscribeLocale, currentLocale)`) for React to re-render
 * it when the locale changes. `settings-page.tsx` called `t()` after this PR's
 * extraction but had NO such subscription — so switching the app language while
 * Settings stayed mounted would have left its header and section copy English
 * until an unrelated repaint: half the very bug this PR exists to fix.
 *
 * This suite loads the REAL `use-locale` hook and the REAL locale store, renders
 * a t()-calling component WITH the subscription, and asserts the rendered text
 * changes when the store does. It is deliberately hooked up the same way
 * SettingsPage is (subscribe + t()), so a regression that drops the subscription
 * from the pattern fails here.
 */

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
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
/*
 * Copy jsdom's window onto `globalThis` the way `scripts/language-live-updates.test.mjs`
 * does — NOT a bare `globalThis.navigator = dom.window.navigator`, which throws
 * because Node's own `navigator` is a getter-only property. React DOM needs the
 * element constructors and events on the global; the guarded copy brings them in
 * without fighting the ones Node already defines.
 */
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// jsdom accessors that refuse to leave their context; the component needs
		// none of those.
	}
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CSS = { escape: (value) => String(value) };
dom.window.Element.prototype.scrollIntoView = () => {};

const built = await build({
	stdin: {
		contents: [
			'export * as React from "react";',
			'export { act } from "react";',
			'export { createRoot } from "react-dom/client";',
			'export * as messages from "./src/i18n/messages";',
			'export * as locale from "./src/i18n/locale";',
			'export { useI18nLocale } from "./src/renderer/src/shared/i18n/use-locale";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "browser",
	write: false,
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);
const { messages, locale, useI18nLocale, React, act, createRoot } = mod;

after(() => {
	dom.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

/**
 * A component shaped like the fixed SettingsPage: it SUBSCRIBES and then calls
 * `t()`. `subscribed` toggles the subscription so the same harness can prove the
 * sabotage (no subscription) is what makes the case fail.
 */
function makeComponent(subscribed) {
	return function Probe() {
		if (subscribed) useI18nLocale();
		return React.createElement(
			"span",
			null,
			messages.t("ui.settings.page.title"),
		);
	};
}

async function renderProbe(subscribed) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const Probe = makeComponent(subscribed);
	await act(async () => {
		root.render(React.createElement(Probe, null));
	});
	return {
		text: () => container.textContent,
		async setLocaleAndSettle(next) {
			await act(async () => {
				locale.setLocale(next);
			});
		},
		cleanup() {
			root.unmount();
			container.remove();
		},
	};
}

test("a t() consumer WITH the locale subscription repaints on a locale change", async () => {
	locale.setLocale("en");
	const probe = await renderProbe(true);
	try {
		assert.equal(probe.text(), "Settings");
		await probe.setLocaleAndSettle("fr");
		assert.equal(
			probe.text(),
			"Paramètres",
			"the subscribed component must repaint to the new locale",
		);
		await probe.setLocaleAndSettle("en");
		assert.equal(probe.text(), "Settings", "and back again");
	} finally {
		probe.cleanup();
	}
});

test("SABOTAGE: WITHOUT the subscription the component does NOT repaint", async () => {
	/*
	 * This is the shape settings-page.tsx had before the fix. It proves the
	 * subscription is load-bearing: if this case ever renders "Paramètres", the
	 * harness itself became locale-aware and the case above stops discriminating.
	 */
	locale.setLocale("en");
	const probe = await renderProbe(false);
	try {
		assert.equal(probe.text(), "Settings");
		await probe.setLocaleAndSettle("fr");
		assert.equal(
			probe.text(),
			"Settings",
			"an unsubscribed t() consumer keeps the OLD language — the defect this pins",
		);
	} finally {
		probe.cleanup();
	}
});
