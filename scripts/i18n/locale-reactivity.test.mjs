import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
	/*
	 * RELEASE THE SCHEDULER'S MESSAGE PORTS, or this command never exits.
	 *
	 * React's scheduler (bundled here with the browser condition, but running on
	 * Node's global `MessageChannel`) keeps its MessagePort handles REF'D, so the
	 * test runner prints its summary and then the process stays alive forever.
	 * Review round 1 (R1) measured five ref'd ports on this file and confirmed
	 * that closing them is what lets the summary print and the process return.
	 *
	 * This is TEARDOWN, not a forced green: every case has already run and
	 * reported by the time this hook executes, and no assertion is skipped or
	 * short-circuited. It closes only MessagePorts — nothing else the runner or
	 * jsdom owns — so a genuine failure still surfaces.
	 */
	for (const handle of process._getActiveHandles?.() ?? []) {
		try {
			if (handle?.constructor?.name === "MessagePort") handle.close();
		} catch {
			// A handle that refuses to close is not this suite's to force.
		}
	}
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
		async cleanup() {
			await act(async () => {
				root.unmount();
			});
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
		await probe.cleanup();
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
		await probe.cleanup();
	}
});

/*
 * STATIC CONSUMER PIN (review round 1, R2). The dynamic cases above prove the
 * MECHANISM with a probe; they cannot fail if someone deletes the subscription
 * from the real component, because the probe carries its own. This case reads
 * `SettingsPage`'s source and requires the subscription to be there, so
 * dropping it fails — the same source-level assertion style
 * `scripts/palette-search.test.mjs` already uses for its import contract. It is
 * deliberately a static check and says so: rendering the full SettingsPage
 * would drag in the whole query/store graph and is not a bounded test.
 */
test("SettingsPage itself subscribes to the locale (static pin, not a render)", () => {
	const source = readFileSync(
		join(
			import.meta.dirname,
			"..",
			"..",
			"src",
			"renderer",
			"src",
			"features",
			"settings",
			"components",
			"settings-page.tsx",
		),
		"utf8",
	);
	/*
	 * ANCHORED ON THE STATEMENT, NOT ON ANY MENTION (review round 2). The first
	 * version of this pin matched /useI18nLocale\(\)/ anywhere in the file — and the
	 * file's own explanatory comment above the call contains that exact text. The
	 * reviewer removed the REAL subscription by intercepting the filesystem and
	 * all three reactivity cases still passed, because the comment still matched:
	 * the pin could not fail on the regression it exists for, which is the very
	 * defect this suite was written to avoid. The pattern below requires a LINE
	 * that is the call as a statement, which a comment line can never be.
	 *
	 * A parsed AST would be the strongest form; this repository runs the native
	 * TypeScript 7, whose programmatic surface is `typescript/unstable/*` (the
	 * classic `ts.createSourceFile` is gone — see `check-strings.mjs`), so an AST
	 * walk here would be code this suite cannot verify locally under the execution
	 * stop. The anchored statement is precise for this file and fails SAFE: a
	 * refactor that wraps the call (e.g. `const locale = useI18nLocale();`) would
	 * fail the pin rather than silently pass it.
	 */
	assert.match(
		source,
		/^\s*useI18nLocale\(\);/m,
		"SettingsPage must call useI18nLocale() as a statement; t() alone is not reactive, so without it a language switch leaves the page in the old language",
	);
});

/*
 * STATIC CONSUMER PINS for the five chat surfaces the extraction added a
 * subscription to (agent review round 1, m4). The dynamic cases above prove the
 * MECHANISM, but they cannot fail when a real component drops its subscription:
 * the probe carries its own. `t()` does not subscribe, so a missing call in any
 * of these five leaves that surface in the previous language until an unrelated
 * repaint — the half-language bug this suite exists for, and one no other gate
 * would see in a file this large.
 *
 * The pattern is the same anchored statement the SettingsPage pin uses, for the
 * same reason recorded there: a comment that MENTIONS the call must not satisfy
 * the pin, and a refactor that wraps the call (e.g. `const locale =
 * useI18nLocale();`) fails closed rather than silently passing.
 */
const CHAT_LOCALE_SUBSCRIBERS = [
	{
		component: "ChatContent",
		path: ["features", "chat", "components", "chat-content.tsx"],
	},
	{
		component: "ChatPage",
		path: ["features", "chat", "components", "chat-page.tsx"],
	},
	{
		component: "ComposerStatusRow",
		path: ["features", "chat", "components", "composer-status-row.tsx"],
	},
	{
		component: "SessionStatusStrip",
		path: ["features", "chat", "session-status", "session-status-strip.tsx"],
	},
	{
		component: "ReplyPreview",
		path: ["features", "chat", "components", "reply-preview.tsx"],
	},
];

test("the five extracted chat surfaces subscribe to the locale (static pin, not a render)", () => {
	for (const { component, path } of CHAT_LOCALE_SUBSCRIBERS) {
		const source = readFileSync(
			join(import.meta.dirname, "..", "..", "src", "renderer", "src", ...path),
			"utf8",
		);
		assert.match(
			source,
			/^\s*useI18nLocale\(\);/m,
			`${component} must call useI18nLocale() as a statement; t() alone is not reactive, so without it a language switch leaves the surface in the old language`,
		);
	}
});
