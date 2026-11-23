import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * CLOSING THE SETTINGS PAGE, driven through the shipped surface.
 *
 * Settings is a route with no OS chrome of its own (operator report: it could
 * not be closed). This file mounts the REAL content surface, the REAL close
 * button, the REAL Esc predicate and the REAL sidebar gear inside a hash router,
 * and drives the presses a reader makes. What only a render can prove, and what
 * this file therefore asserts:
 *
 *  - Close returns to the route the page was entered from, search string kept,
 *    and a cold deep link falls back to /chat;
 *  - Esc is the LAST reader of the press: a text field, a combobox with its
 *    list open, an open dialog and a marked shortcut recorder all keep it, and
 *    the second press (once focus has left the field) closes;
 *  - a modifier chord is never a close - it is what a recorder stores;
 *  - the gear toggles: it opens Settings from another route and closes the page
 *    it is already on, with its accessible name unchanged;
 *  - the keymap has no action that could reach the gear (it is click-only).
 *
 * The harness shape is this repository's committed one for a rendered surface
 * (`scripts/settings-search.test.mjs`): esbuild bundles the shipped modules
 * against the renderer's aliases, jsdom hosts a real `react-dom/client` root,
 * and the packages stay external so the page and this file share ONE React and
 * ONE router instance.
 */
const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// A few of jsdom's own accessors refuse to be read out of context.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CSS = { escape: (value) => String(value) };
bootstrapDOM.window.Element.prototype.scrollIntoView = () => {};
const { createRoot } = await import("react-dom/client");
const { HashRouter, Route, Routes } = await import("react-router-dom");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
	globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

/* The settings page's config read never answers here; the surface does not need
   it, but the sidebar foot's own children (the account row) mount beside the
   gear, so the bridge answers with an empty document rather than throwing. */
globalThis.window.api = {
	desktop: { request: async () => ({ status: 200, body: {} }) },
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { useLocation, useNavigate } from "react-router-dom";
			import { SettingsContentSurface, SettingsCloseButton } from "./src/renderer/src/features/settings/components/settings-close-surface";
			import { SettingsSearch } from "./src/renderer/src/features/settings/components/settings-search";
			import { SettingControl } from "./src/renderer/src/features/settings/components/setting-control";
			import { useSettingsReturnTracking, useCloseSettings, __resetSettingsReturn, SETTINGS_CLOSE_FALLBACK } from "./src/renderer/src/shared/hooks/use-settings-route";
			import { SettingsGear } from "./src/renderer/src/shared/components/navigation/sidebar-foot";
			import { KEYMAP_ACTIONS } from "./src/renderer/src/shared/keymap/keymap-registry";
			export { createElement };
			export { SettingsContentSurface, SettingsCloseButton, SettingsSearch, SettingsGear, SettingControl };
			export { useSettingsReturnTracking, useCloseSettings, __resetSettingsReturn, SETTINGS_CLOSE_FALLBACK };
			export { KEYMAP_ACTIONS };
			/* The route, as the page's own location hook sees it. Every page carries the
			   link a reader would press to open Settings, so a case never has to state
			   the route it came from. */
			export const Probe = ({ name }) => {
				const location = useLocation();
				const navigate = useNavigate();
				globalThis.__route = location.pathname + location.search;
				return createElement(
					"div",
					{ "data-probe": name },
					name,
					createElement(
						"button",
						{
							type: "button",
							"data-open-settings": "",
							onClick: () => navigate("/settings?section=general"),
						},
						"open settings",
					),
					createElement(
						"button",
						{
							type: "button",
							"data-change-tab": "",
							onClick: () => navigate("/settings?section=appearance"),
						},
						"change tab",
					),
				);
			};
			/* The shell around every route: the tracker, and the gear the app's
			   sidebar draws on every page. */
			export const Shell = ({ children }) => {
				useSettingsReturnTracking();
				return createElement("div", null, createElement(SettingsGear), children);
			};
			/* The location, recorded on EVERY route - including Settings, whose
			   element is not a Probe: without this the reading would stay on the
			   page Settings was opened from and every assertion would pass. */
			export const LocationProbe = () => {
				const location = useLocation();
				globalThis.__route = location.pathname + location.search;
				return null;
			};
			/* One page inside the Settings surface: a plain control to press Esc on,
			   a control that switches tabs (the in-page query change that must not
			   overwrite the return target), and the close button the surface brings. */
			export const PageInside = ({ children }) => {
				const navigate = useNavigate();
				return createElement(
					SettingsContentSurface,
					null,
					createElement(LocationProbe),
					createElement(
						"button",
						{
							type: "button",
							"data-change-tab": "",
							onClick: () => navigate("/settings?section=appearance"),
						},
						"change tab",
					),
					children,
				);
			};
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	packages: "external",
	loader: { ".css": "empty" },
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	write: false,
});
const bundlePath = new URL("./_settings-close.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));

const {
	Shell,
	Probe,
	PageInside,
	SettingsSearch,
	SettingControl,
	KEYMAP_ACTIONS,
	__resetSettingsReturn,
	SETTINGS_CLOSE_FALLBACK,
} = await import(bundlePath.href);

const { createElement } = React;

/** Put the window on a hash the router will read, before the tree mounts. */
function startAt(hash) {
	bootstrapDOM.window.location.hash = hash;
	globalThis.__route = undefined;
}

/**
 * Mount the app-shaped tree: a shell (tracker + gear) around the routes.
 *
 * Settings gets a page with a plain button to press Esc on and the real search
 * widget; every other route is a probe that records the location.
 */
async function mount(t, { inside = null, settingsExtra = null } = {}) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const settingsChildren = [
		createElement("button", { type: "button", id: "inside" }, "inside"),
		createElement("input", { id: "plain" }),
		createElement(
			"div",
			{ role: "dialog", "aria-label": "a dialog" },
			createElement("button", { type: "button", id: "in-dialog" }, "in dialog"),
		),
		createElement("input", { id: "recorder", "data-shortcut-recorder": "" }),
		settingsExtra,
		inside,
	].filter(Boolean);
	const tree = createElement(
		HashRouter,
		null,
		createElement(
			Shell,
			null,
			createElement(
				Routes,
				null,
				createElement(Route, {
					path: "/chat",
					element: createElement(Probe, { name: "chat" }),
				}),
				createElement(Route, {
					path: "/agents",
					element: createElement(Probe, { name: "agents" }),
				}),
				createElement(Route, {
					path: "/settings",
					element: createElement(PageInside, null, settingsChildren),
				}),
			),
		),
	);
	await act(async () => {
		root.render(tree);
	});
	await act(async () => {});
	t.after(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	});
	return { container };
}

/** Press a key on an element, the way the reader's focus would send it. */
async function press(element, init) {
	let dispatched = false;
	await act(async () => {
		dispatched = element.dispatchEvent(
			new bootstrapDOM.window.KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				...init,
			}),
		);
	});
	return dispatched;
}

const escapePress = (element, init = {}) =>
	press(element, { key: "Escape", ...init });

/** Click an element inside act, so React's handlers run before the assertions. */
async function click(element) {
	await act(async () => {
		element.click();
	});
	await act(async () => {});
}

const $ = (container, selector) => container.querySelector(selector);

/** Type into a field the way a reader does: focus, set the value, input event. */
async function type(container, value) {
	const input = $(container, '[role="combobox"]');
	await act(async () => {
		input.focus();
	});
	const setter = Object.getOwnPropertyDescriptor(
		bootstrapDOM.window.HTMLInputElement.prototype,
		"value",
	).set;
	await act(async () => {
		setter.call(input, value);
		input.dispatchEvent(
			new bootstrapDOM.window.Event("input", { bubbles: true }),
		);
	});
}

test("a cold link has no return target, so Close falls back to the chat route", async () => {
	__resetSettingsReturn();
	assert.equal(SETTINGS_CLOSE_FALLBACK, "/chat");
});

test("Escape closes Settings and returns to the route it was opened from", async (t) => {
	__resetSettingsReturn();
	startAt("#/agents?tab=teams");
	const { container } = await mount(t);
	// The route the reader is on, recorded by the tracker before Settings opens.
	assert.equal(globalThis.__route, "/agents?tab=teams");
	await click($(container, "[data-open-settings]"));
	assert.equal(globalThis.__route, "/settings?section=general");
	/* A tab change is a QUERY change: it must not re-pin the return target. */
	await click($(container, "[data-change-tab]"));
	assert.equal(globalThis.__route, "/settings?section=appearance");

	const closeButton = $(container, "[data-settings-close]");
	assert.ok(closeButton, "the surface renders the close button");
	assert.equal(closeButton.getAttribute("aria-label"), "Close settings");
	assert.equal(closeButton.getAttribute("aria-keyshortcuts"), "Escape");

	await escapePress($(container, "#inside"));
	assert.equal(globalThis.__route, "/agents?tab=teams");
});

test("the close button lands on the same route as Escape", async (t) => {
	__resetSettingsReturn();
	startAt("#/chat");
	const { container } = await mount(t);
	await click($(container, "[data-open-settings]"));
	assert.equal(globalThis.__route, "/settings?section=general");
	await click($(container, "[data-settings-close]"));
	assert.equal(globalThis.__route, "/chat");
});

test("a cold deep link opens Settings with nothing to return to, so Escape goes to /chat", async (t) => {
	__resetSettingsReturn();
	startAt("#/settings");
	const { container } = await mount(t);
	assert.equal(globalThis.__route, "/settings");
	await escapePress($(container, "#inside"));
	assert.equal(globalThis.__route, "/chat");
});

test("Escape in the search field closes its list and clears its text before the page", async (t) => {
	__resetSettingsReturn();
	startAt("#/settings");
	const { container } = await mount(t, {
		settingsExtra: createElement(SettingsSearch, { index: [] }),
	});
	const field = $(container, '[role="combobox"]');
	await type(container, "theme");
	assert.equal(field.value, "theme");
	assert.ok($(container, '[role="listbox"]'), "typing opens the results panel");

	await escapePress(field);
	assert.equal(field.value, "", "the first Escape clears the query");
	assert.equal(globalThis.__route, "/settings", "the page stays open");

	await escapePress(field);
	assert.equal(
		$(container, '[role="listbox"]'),
		null,
		"the empty field's next Escape closes the list",
	);
	assert.equal(globalThis.__route, "/settings");

	// Focus has left the field, and nothing else is nearer: this press closes.
	await escapePress($(container, "#inside"));
	assert.equal(globalThis.__route, "/chat");
});

test("a text field keeps Escape even with nothing to clear", async (t) => {
	__resetSettingsReturn();
	startAt("#/settings");
	const { container } = await mount(t);
	const input = $(container, "#plain");
	input.focus();
	await escapePress(input);
	assert.equal(globalThis.__route, "/settings");
});

test("an open dialog keeps Escape", async (t) => {
	__resetSettingsReturn();
	startAt("#/settings");
	const { container } = await mount(t);
	await escapePress($(container, "#in-dialog"));
	assert.equal(globalThis.__route, "/settings");
});

test("a marked shortcut recorder keeps Escape even without its own stop", async (t) => {
	__resetSettingsReturn();
	startAt("#/settings");
	const { container } = await mount(t);
	const recorder = $(container, "#recorder");
	recorder.focus();
	await escapePress(recorder);
	assert.equal(globalThis.__route, "/settings");
});

test("a modifier chord is never a close", async (t) => {
	__resetSettingsReturn();
	startAt("#/settings");
	const { container } = await mount(t);
	const inside = $(container, "#inside");
	for (const init of [
		{ key: "k", metaKey: true },
		{ key: "k", ctrlKey: true },
		{ key: "Escape", ctrlKey: true },
		{ key: "Escape", metaKey: true },
		{ key: "Escape", altKey: true },
		{ key: "Escape", shiftKey: true },
	]) {
		await press(inside, init);
		assert.equal(
			globalThis.__route,
			"/settings",
			`${JSON.stringify(init)} must not close Settings`,
		);
	}
});

test("the keymap has no action that could reach the gear", () => {
	// The gear is click-only: a chord would have to name it, and the registry's
	// actions are the panel toggles and the composer's sends.
	assert.ok(KEYMAP_ACTIONS.length > 0);
	for (const action of KEYMAP_ACTIONS) {
		assert.match(action.id, /^(panel|composer)\./);
		assert.doesNotMatch(action.id, /settings/i);
	}
	const source = readFileSync(
		"src/renderer/src/shared/components/navigation/sidebar-foot.tsx",
		"utf8",
	);
	assert.equal(
		[...source.matchAll(/onClick=\{/g)].length,
		1,
		"the gear has exactly one handler, and it is the click",
	);
	assert.doesNotMatch(source, /onKeyDown|aria-keyshortcuts/);
});

test("the gear opens Settings from another route and closes it while open", async (t) => {
	__resetSettingsReturn();
	startAt("#/chat");
	const { container } = await mount(t);
	const gear = () => $(container, '[data-tour-tag="nav-item-settings"]');
	assert.equal(globalThis.__route, "/chat");
	assert.equal(gear().getAttribute("aria-current"), null);

	await click(gear());
	assert.equal(globalThis.__route, "/settings");
	assert.equal(gear().getAttribute("aria-current"), "page");

	await click(gear());
	assert.equal(globalThis.__route, "/chat");
	assert.equal(gear().getAttribute("aria-current"), null);
	assert.equal(
		gear().getAttribute("aria-label"),
		"Settings",
		"the accessible name does not change under the pointer",
	);
});

test("the registry's hotkey recorder keeps Escape and keeps its binding", async (t) => {
	__resetSettingsReturn();
	startAt("#/settings");
	const setting = {
		key: "web_search.max_results",
		section: "web_search",
		label: "Maximum results",
		kind: "hotkey",
		help: "How many results a search returns.",
		value: "ctrl+j",
		default: "ctrl+j",
		is_default: true,
		minimum: null,
		maximum: null,
		members: [],
		choices: [],
		empty_unsets: false,
		redacted: false,
		tier: "core",
		hotkey_scope: "app",
	};
	const changes = [];
	const { container } = await mount(t, {
		settingsExtra: createElement(SettingControl, {
			setting,
			value: "ctrl+j",
			onValueChange: (value) => changes.push(value),
		}),
	});
	// The surface's own marked probe is also a recorder; the row is the other one.
	const field = $(container, "input[data-shortcut-recorder]:not(#recorder)");
	assert.equal(field.value, "ctrl+j");
	field.focus();
	await escapePress(field);
	assert.equal(
		globalThis.__route,
		"/settings",
		"Escape must not close Settings",
	);
	assert.equal(changes.length, 0, "Escape is a cancel, never a binding");
	assert.notEqual(
		document.activeElement,
		field,
		"the recorder's own blur still runs",
	);
});
