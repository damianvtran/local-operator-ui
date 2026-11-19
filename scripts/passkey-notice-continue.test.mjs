/**
 * "Continue in your own tab" on the passkey notice, as rendered.
 *
 * WHY THIS FILE EXISTS. Password-manager passkey prompts are `chrome-extension://`
 * subframes, which `extensions/subframe-policy.ts` refuses in agent-owned tabs on
 * purpose (CDP must never drive one). An App Store Connect passkey sign-in in an
 * agent's tab therefore ended NotAllowed with only "Open in system browser" on
 * offer, whose session is not shared with the app. The notice now offers the
 * same page in a tab the USER owns - but only on an agent tab's notice: a user
 * tab already runs extension frames, so the button there would promise nothing.
 *
 * `renderToStaticMarkup` drives the shipped component, so the assertions are on
 * the markup a reader gets. Nothing is painted here; frames are the PR's
 * rendered evidence. Main-side gating lives in `passkey-notice.test.mjs` and
 * `browser-host.test.mjs`.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export { BrowserPasskeyNotice } from "./src/renderer/src/features/browser/components/browser-passkey-notice";',
			'export { t } from "./src/renderer/src/shared/i18n";',
			'export { renderToStaticMarkup } from "react-dom/server";',
			'export { createElement, act } from "react";',
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
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	// The CJS half of the graph calls `require`, which esbuild's ESM output
	// refuses by default (see agent-picture-edit.test.mjs).
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: { ".css": "empty", ".svg": "text", ".png": "dataurl" },
	// One React shared by the component and the renderer.
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react-dom/client",
		"react/jsx-runtime",
	],
	tsconfig: "tsconfig.app.json",
});

// On disk for the import only: a data: module cannot resolve the bare
// specifiers kept external above.
const bundlePath = new URL(
	`./_passkey-notice-continue-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
let mod;
try {
	mod = await import(bundlePath.href);
} finally {
	await unlink(bundlePath);
}
const {
	BrowserPasskeyNotice,
	t,
	renderToStaticMarkup,
	createElement,
	act,
	createRoot,
} = mod;

const CONTINUE = t("ui.browser.browser_passkey_notice.continue_in_own_tab");
const AGENT_WHY = t("ui.browser.browser_passkey_notice.agent_explanation");
const SYSTEM = t("ui.browser.browser_passkey_notice.open_in_system_browser");

function notice(ownerKind, overrides = {}) {
	return {
		tabId: 39,
		origin: "https://idmsa.apple.com",
		embedded: true,
		kind: "get",
		outcome: "not-allowed",
		at: Date.now(),
		ownerKind,
		suppressed: 0,
		...overrides,
	};
}

function render(props) {
	return renderToStaticMarkup(
		createElement(BrowserPasskeyNotice, {
			onOpen: () => {},
			onDismiss: () => {},
			onContinueInUserTab: async () => true,
			...props,
		}),
	);
}

test("an agent tab's notice offers Continue in your own tab, says why, and keeps the system browser", () => {
	const html = render({ notice: notice("agent") });
	assert.ok(html.includes(CONTINUE), "the primary action is offered");
	assert.ok(html.includes('data-tour-tag="browser-passkey-notice-continue"'));
	assert.ok(html.includes(AGENT_WHY), "the agent-tab explanation is shown");
	// Review D1/D2/U1/U5: conditional, no repeated label or "agent-driven tab"
	// (the message line already says it), and it names the step that remains.
	// Narrowed with passkey custody: some managers CAN now show their window in
	// an agent tab, so the sentence covers only one that can't.
	assert.ok(AGENT_WHY.startsWith("If your password manager can’t show"));
	assert.ok(!AGENT_WHY.includes(CONTINUE), "the button label is not repeated");
	assert.ok(!AGENT_WHY.includes("agent-driven"));
	assert.ok(AGENT_WHY.includes("ask the agent to reload this page"));
	assert.ok(
		!html.includes(t("ui.browser.browser_passkey_notice.explanation")),
		"one hint, not two",
	);
	assert.ok(html.includes(SYSTEM), "Open in system browser is kept");
	assert.ok(
		html.indexOf(CONTINUE) < html.indexOf(SYSTEM),
		"the user-tab action comes first",
	);
});

test("a user tab's notice never offers it, even when the callback is wired", () => {
	for (const embedded of [false, true]) {
		const html = render({ notice: notice("user", { embedded }) });
		assert.ok(!html.includes(CONTINUE), `embedded=${embedded}`);
		assert.ok(!html.includes(AGENT_WHY), `embedded=${embedded}`);
		assert.ok(html.includes(SYSTEM));
	}
});

test("an agent tab's notice without the callback (an older host) falls back to the old hint", () => {
	const html = render({
		notice: notice("agent"),
		onContinueInUserTab: undefined,
	});
	assert.ok(!html.includes(CONTINUE));
	assert.ok(html.includes(t("ui.browser.browser_passkey_notice.explanation")));
});

/*
 * THE CLICK, MOUNTED (review round 1: R1/U4 double click, U2 focus). Static
 * markup cannot press a button or hold focus, so these mount the same component
 * in jsdom after the bundle above (the DOM must not exist while the stores
 * evaluate; see agent-picture-dom.test.mjs).
 */
const { JSDOM } = await import("jsdom");
const dom = new JSDOM("<!doctype html>", { url: "http://localhost/" });
const { window } = dom;
for (const [key, value] of Object.entries({
	window,
	document: window.document,
	navigator: window.navigator,
	getComputedStyle: window.getComputedStyle.bind(window),
	IS_REACT_ACT_ENVIRONMENT: true,
	HTMLElement: window.HTMLElement,
	Element: window.Element,
	Node: window.Node,
	MouseEvent: window.MouseEvent,
	FocusEvent: window.FocusEvent,
	Event: window.Event,
})) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}

function deferred() {
	let resolve;
	const promise = new Promise((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

async function mount(props) {
	const host = document.createElement("div");
	// The pane's rest-stop stand-in: a programmatic focus target like the
	// surface's chord root.
	const rest = document.createElement("div");
	rest.tabIndex = -1;
	const slot = document.createElement("div");
	host.append(rest, slot);
	document.body.append(host);
	const root = createRoot(slot);
	const element = (overrides) =>
		createElement(BrowserPasskeyNotice, {
			onOpen: () => {},
			onDismiss: () => {},
			restFocus: () => rest.focus(),
			...props,
			...overrides,
		});
	await act(async () => root.render(element({})));
	const button = () =>
		slot.querySelector('[data-tour-tag="browser-passkey-notice-continue"]');
	return {
		rest,
		button,
		rerender: (overrides) => act(async () => root.render(element(overrides))),
		unmount: async () => {
			await act(async () => root.unmount());
			host.remove();
		},
	};
}

const click = (node) =>
	act(async () => {
		node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});

test("a pending continue disables the button, so a double click asks main once", async () => {
	const calls = [];
	let pending = deferred();
	const view = await mount({
		notice: notice("agent"),
		onContinueInUserTab: (n) => {
			calls.push(n.tabId);
			return pending.promise;
		},
	});
	try {
		await click(view.button());
		assert.equal(view.button().disabled, true, "disabled while in flight");
		assert.equal(view.button().getAttribute("aria-busy"), "true");
		await click(view.button());
		assert.deepEqual(calls, [39], "the second click never reached main");
		// A refusal re-enables it, so the user can try again.
		await act(async () => pending.resolve(false));
		assert.equal(view.button().disabled, false);
		pending = deferred();
		await click(view.button());
		assert.deepEqual(calls, [39, 39]);
		await act(async () => pending.resolve(false));
	} finally {
		await view.unmount();
	}
});

test("a successful continue hands focus to the pane's rest-stop, not <body>", async () => {
	const pending = deferred();
	const view = await mount({
		notice: notice("agent"),
		onContinueInUserTab: () => pending.promise,
	});
	try {
		view.button().focus();
		assert.equal(document.activeElement, view.button());
		await click(view.button());
		// Main activates the new user tab: the agent tab's notice (and the
		// focused button) unmount before the invoke answers.
		await view.rerender({ notice: null });
		assert.equal(document.activeElement, document.body, "the U2 symptom");
		await act(async () => pending.resolve(true));
		assert.notEqual(document.activeElement, document.body);
		assert.equal(document.activeElement, view.rest);
	} finally {
		await view.unmount();
	}
});

test("a successful continue does not take focus from wherever the user moved on to", async () => {
	const pending = deferred();
	const elsewhere = document.createElement("input");
	document.body.append(elsewhere);
	const view = await mount({
		notice: notice("agent"),
		onContinueInUserTab: () => pending.promise,
	});
	try {
		await click(view.button());
		elsewhere.focus();
		await act(async () => pending.resolve(true));
		assert.equal(document.activeElement, elsewhere);
	} finally {
		await view.unmount();
		elsewhere.remove();
		window.close();
	}
});
