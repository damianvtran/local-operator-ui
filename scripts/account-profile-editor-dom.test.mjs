/**
 * The human profile editor's live behaviour, mounted in jsdom.
 *
 * WHY A DOM TEST. Design and UX round 1 on #1593 found defects that only show
 * up when effects run and events fire, so static markup cannot catch them:
 *
 *  - U1: a dirty draft registered a `beforeunload` guard. Electron answers a
 *    cancelled unload with NO dialog and silently cancels the close, which
 *    blocked window close, Cmd+Q, `/exit` and Sign out's reload. The contract is
 *    the in-memory draft, so no listener may exist at all.
 *  - U2: actions unmounted or disabled their own trigger and focus fell to
 *    <body>. Each action must land focus on a named control.
 *  - U3: Escape must back out of the discard question.
 *  - U5: inputs carry the service bounds as `maxLength`, and a refused field is
 *    marked `aria-invalid`, described and focused.
 *
 * The harness is `agent-picture-dom.test.mjs`'s: esbuild bundles the component
 * with React external, then jsdom is installed AFTER the bundle is evaluated.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export { AccountProfileEditor } from "./src/renderer/src/features/settings/components/account-profile-editor";',
			'export { setLocale, t } from "./src/renderer/src/shared/i18n";',
			'export { createElement } from "react";',
			'export { createRoot } from "react-dom/client";',
			'export { act } from "react";',
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
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	tsconfig: "tsconfig.app.json",
});
const bundlePath = new URL(
	`./_account-profile-editor-dom-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
/*
 * THE DOM ARRIVES BEFORE THE BUNDLE here, the reverse of
 * `agent-picture-dom.test.mjs`. react-dom decides `canUseDOM` (and with it
 * whether text inputs fire through the `input` event) when it is first
 * evaluated; loaded without a window it silently ignores typed changes, so
 * no draft ever becomes dirty. That file installs the DOM late because its
 * agent stores rehydrate from `localStorage`; this editor's graph has no
 * persisted store, so the early install costs nothing.
 */
const { JSDOM } = await import("jsdom");
const dom = new JSDOM("<!doctype html>", { url: "http://localhost/" });
const { window } = dom;
const shims = {
	window,
	document: window.document,
	navigator: window.navigator,
	getComputedStyle: window.getComputedStyle.bind(window),
	requestAnimationFrame: (callback) => setTimeout(callback, 0),
	cancelAnimationFrame: () => {},
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
};
for (const key of [
	"Element",
	"Node",
	"NodeList",
	"DocumentFragment",
	"ShadowRoot",
	"HTMLElement",
	"HTMLButtonElement",
	"HTMLDivElement",
	"HTMLFormElement",
	"HTMLHeadingElement",
	"HTMLInputElement",
	"HTMLLabelElement",
	"HTMLParagraphElement",
	"HTMLSpanElement",
	"HTMLTextAreaElement",
	"SVGElement",
	"MouseEvent",
	"KeyboardEvent",
	"FocusEvent",
	"PointerEvent",
	"InputEvent",
	"Event",
	"CustomEvent",
	"MutationObserver",
]) {
	if (key in window) shims[key] = window[key];
}
const originals = new Map();
for (const [key, value] of Object.entries(shims)) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
window.matchMedia ??= () => ({
	matches: false,
	addEventListener() {},
	removeEventListener() {},
});

const {
	AccountProfileEditor,
	setLocale,
	t,
	createElement: h,
	createRoot,
	act,
} = await import(bundlePath.href);
await unlink(bundlePath);
/*
 * Every `beforeunload` registration is recorded. Wrapping the real methods (and
 * not replacing them) keeps React's own listeners working while making a guard
 * visible to the assertion, whichever target it is attached to.
 */
const unloadListeners = new Set();
for (const target of [window, window.document]) {
	const add = target.addEventListener.bind(target);
	const remove = target.removeEventListener.bind(target);
	target.addEventListener = (type, listener, options) => {
		if (type === "beforeunload") unloadListeners.add(listener);
		return add(type, listener, options);
	};
	target.removeEventListener = (type, listener, options) => {
		if (type === "beforeunload") unloadListeners.delete(listener);
		return remove(type, listener, options);
	};
}

setLocale("en");

const SNAPSHOT = {
	scope: "a".repeat(64),
	profile: {
		account_id: "acc_dom_fixture",
		display_label: "Alex Example",
		display_name: "Alex Example",
		title: "Engineer",
		description: "Builds things.",
		timezone: "UTC",
		avatar: { source: "uploaded", hash: "0123456789abcdef" },
	},
};

const mounted = [];
const mount = async (props = {}) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () =>
		root.render(
			h(AccountProfileEditor, {
				snapshot: SNAPSHOT,
				onSave: async () => SNAPSHOT,
				onUpload: async () => SNAPSHOT,
				onRemove: async () => SNAPSHOT,
				...props,
			}),
		),
	);
	mounted.push(root);
	return container;
};
after(async () => {
	for (const root of mounted) await act(async () => root.unmount());
	window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

const field = (container, label) => {
	const node = [...container.querySelectorAll("label")].find(
		(candidate) => candidate.textContent === label,
	);
	assert.ok(node, `label ${label} is rendered`);
	return container.querySelector(`#${CSS.escape(node.htmlFor)}`);
};
const button = (container, name) => {
	const found = [...container.querySelectorAll("button")].find(
		(candidate) => candidate.textContent?.trim() === name,
	);
	assert.ok(found, `button ${name} is rendered`);
	return found;
};
/* React tracks the input's value itself; set it through the native setter so
   the change event carries the new text (jsdom has no user typing). */
const type = async (input, value) => {
	const proto =
		input.tagName === "TEXTAREA"
			? window.HTMLTextAreaElement.prototype
			: window.HTMLInputElement.prototype;
	Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
	await act(async () => {
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
};
const click = (node) =>
	act(async () => {
		node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
const pressEscape = (node) =>
	act(async () => {
		node.dispatchEvent(
			new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});
const CSS = { escape: (value) => value.replace(/:/g, "\\:") };

test("U1: a dirty draft registers no beforeunload guard (Electron would silently cancel close)", async () => {
	const container = await mount();
	const name = field(container, t("ui.settings.personal_profile.display_name"));
	await type(name, "Alex Edited");
	assert.equal(name.value, "Alex Edited", "the draft is dirty");
	assert.equal(
		unloadListeners.size,
		0,
		"no beforeunload listener may be registered while the draft is dirty",
	);
	const event = new window.Event("beforeunload", { cancelable: true });
	window.dispatchEvent(event);
	assert.equal(event.defaultPrevented, false, "an unload is never cancelled");
});

test("U5: inputs carry the service bounds as maxLength", async () => {
	const container = await mount();
	assert.equal(
		field(container, t("ui.settings.personal_profile.display_name")).maxLength,
		64,
	);
	assert.equal(
		field(container, t("ui.settings.personal_profile.title")).maxLength,
		80,
	);
	assert.equal(
		field(container, t("ui.settings.personal_profile.description")).maxLength,
		500,
	);
});

test("U5: a refused field is aria-invalid, described and focused, and nothing is sent", async () => {
	let sent = 0;
	const container = await mount({
		onSave: async () => {
			sent++;
			return SNAPSHOT;
		},
	});
	const about = field(container, t("ui.settings.personal_profile.description"));
	await type(
		about,
		Array.from({ length: 9 }, (_, i) => `line ${i}`).join("\n"),
	);
	await click(button(container, t("ui.settings.personal_profile.save")));
	assert.equal(sent, 0, "Save sent nothing");
	assert.equal(about.getAttribute("aria-invalid"), "true");
	const message = container.querySelector(
		`#${CSS.escape(about.getAttribute("aria-describedby"))}`,
	);
	assert.equal(
		message?.textContent,
		t("ui.settings.personal_profile.description_lines", { count: "8" }),
	);
	assert.equal(document.activeElement, about, "focus moved to the bad field");
});

test("U2/U3: Cancel focuses the discard question; Escape keeps editing and returns focus to Cancel", async () => {
	const container = await mount();
	const name = field(container, t("ui.settings.personal_profile.display_name"));
	await type(name, "Alex Edited");
	const cancel = button(container, t("ui.common.actions.cancel"));
	await click(cancel);
	const keep = button(
		container,
		t("ui.settings.personal_profile.keep_editing"),
	);
	assert.equal(document.activeElement, keep, "focus is inside the question");
	const question = [...container.querySelectorAll("[role=alert]")].find(
		(node) => node.textContent === t("ui.settings.personal_profile.discard"),
	);
	assert.ok(question, "the question is announced as an alert");
	await pressEscape(keep);
	assert.equal(
		[...container.querySelectorAll("button")].some(
			(node) =>
				node.textContent?.trim() ===
				t("ui.settings.personal_profile.keep_editing"),
		),
		false,
		"Escape dismissed the question",
	);
	assert.equal(name.value, "Alex Edited", "the draft was kept");
	assert.equal(
		document.activeElement,
		button(container, t("ui.common.actions.cancel")),
		"focus returned to Cancel",
	);
});

test("U2: Discard changes restores the draft and lands focus on the section heading", async () => {
	const container = await mount();
	const name = field(container, t("ui.settings.personal_profile.display_name"));
	await type(name, "Alex Edited");
	await click(button(container, t("ui.common.actions.cancel")));
	await click(
		button(container, t("ui.settings.personal_profile.discard_action")),
	);
	assert.equal(name.value, "Alex Example");
	assert.equal(
		document.activeElement?.textContent,
		t("ui.settings.personal_profile.heading"),
	);
});

test("U2/U3: the removal confirmation takes focus, and Escape returns it to Remove photo", async () => {
	const container = await mount();
	await click(button(container, t("ui.settings.personal_profile.remove")));
	const cancel = [...container.querySelectorAll("fieldset button")].find(
		(node) => node.textContent?.trim() === t("ui.common.actions.cancel"),
	);
	assert.equal(document.activeElement, cancel, "focus is inside the fieldset");
	await pressEscape(cancel);
	assert.equal(
		container.querySelector("fieldset"),
		null,
		"Escape dismissed it",
	);
	assert.equal(
		document.activeElement,
		button(container, t("ui.settings.personal_profile.remove")),
	);
});

test("N2: the file input is out of the accessibility tree; the button is the one name", async () => {
	const container = await mount();
	const input = container.querySelector("input[type=file]");
	assert.equal(input.getAttribute("aria-hidden"), "true");
	assert.equal(input.hasAttribute("aria-label"), false);
});
