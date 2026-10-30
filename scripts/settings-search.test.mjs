import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE SETTINGS SEARCH FIELD AND ITS PANEL, driven through the SHIPPED component.
 *
 * What only a render can prove, and what this file therefore asserts:
 *
 *  - **the index is built ONCE** across ten keystrokes. `useSettingsSearchIndex`
 *    is called with a spy as its builder, so a memo that silently rebuilds
 *    (an unstable dependency) fails here rather than as a slow settings page;
 *  - **the panel is capped** at twelve rows with a "+N more" line, not 230
 *    option nodes;
 *  - **the combobox contract** — `aria-expanded`, `aria-controls`,
 *    `aria-activedescendant` pointing at a REAL option id, focus staying in the
 *    field while the arrows move;
 *  - **the two non-result states** say what the box searches / quote the query
 *    and offer exactly one way out.
 *
 * The harness shape is this repository's committed one for a rendered surface:
 * esbuild bundles the shipped component against the renderer's own aliases, and
 * the DOM is jsdom with a real `react-dom/client` root (as
 * `scripts/backend-settings-collapse.test.mjs` does).
 */
const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
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
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
	globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

globalThis.window.api = {
	desktop: { request: async () => ({ status: 200, body: {} }) },
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { SettingsSearch, useSettingsSearchIndex } from "./src/renderer/src/features/settings/components/settings-search";
			export { createElement };
			export { SettingsSearch };
			export { buildSettingsIndex } from "./src/renderer/src/features/settings/search/settings-search-index";
			export function Harness({ buildIndex, registry, sections, onJump }) {
				const index = useSettingsSearchIndex({ registry, sections, build: buildIndex });
				return createElement(SettingsSearch, { index, onJump });
			}
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
	},
	external: ["react", "react-dom", "react/jsx-runtime"],
	packages: "external",
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
});
const bundlePath = new URL("./_settings-search.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));

const { Harness, createElement } = await import(bundlePath.href);

/** The real registry fixture: the payload the surface is built against. */
const payload = JSON.parse(
	readFileSync("scripts/fixtures/backend-settings-registry.json", "utf8"),
);
const sections = [
	{ id: "general", label: "General settings" },
	{ id: "appearance", label: "Appearance" },
];

/** Mount the harness and return the container plus the spies. */
const mount = async (t, { registry = payload, buildIndex } = {}) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const jumps = [];
	const builds = { count: 0 };
	const builder =
		buildIndex ??
		((parts) => {
			builds.count += 1;
			// The real builder, imported lazily so the spy still counts calls.
			return moduleBuild(parts);
		});
	t.after(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	});
	await act(async () => {
		root.render(
			createElement(Harness, {
				buildIndex: builder,
				registry,
				sections,
				onJump: (entry) => jumps.push(entry),
			}),
		);
	});
	return { container, jumps, builds };
};

const moduleBuild = (await import(bundlePath.href)).buildSettingsIndex;

const field = (container) => container.querySelector('[role="combobox"]');
const panel = (container) => container.querySelector('[role="listbox"]');
const options = (container) =>
	Array.from(container.querySelectorAll('[role="option"]'));

/*
 * Type into the field the way a reader does: focus it, set the value, then the
 * input event. Focusing first matters — every keyboard assertion below is about
 * a reader whose caret is in the field, and a test that dispatches keys into an
 * unfocused input would pass or fail on jsdom's focus bookkeeping rather than
 * on the component's.
 */
const type = async (container, value) => {
	const input = field(container);
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
};

const press = async (container, key) => {
	await act(async () => {
		field(container).dispatchEvent(
			new bootstrapDOM.window.KeyboardEvent("keydown", {
				key,
				bubbles: true,
				cancelable: true,
			}),
		);
	});
};

test("ten keystrokes build the index once", async (t) => {
	const { container, builds } = await mount(t);
	for (const query of [
		"s",
		"se",
		"set",
		"sett",
		"setti",
		"settin",
		"setting",
		"settings",
		"settings",
		"settings\n",
	]) {
		await type(container, query);
	}
	assert.equal(builds.count, 1, "the page's memo holds across a typed query");
});

test("the panel caps at twelve rows and says how many more there are", async (t) => {
	const { container } = await mount(t);
	await type(container, "s");
	assert.equal(options(container).length, 12);
	const more = container.querySelector(
		'[data-search-more], [role="listbox"] p',
	);
	assert.ok(panel(container).textContent.includes("more"), "a +N more line");
	assert.ok(more);
});

test("the combobox points its active option at a real option id", async (t) => {
	const { container } = await mount(t);
	await type(container, "theme");
	const input = field(container);
	assert.equal(input.getAttribute("aria-expanded"), "true");
	const listId = input.getAttribute("aria-controls");
	assert.equal(panel(container).id, listId);
	const active = input.getAttribute("aria-activedescendant");
	assert.ok(active, "an active descendant while results are open");
	assert.ok(container.querySelector(`[id="${active}"]`), "and it exists");
});

test("arrows move the active option and Enter jumps to it, focus staying in the field", async (t) => {
	const { container, jumps } = await mount(t);
	await type(container, "theme");
	const first = field(container).getAttribute("aria-activedescendant");
	await press(container, "ArrowDown");
	const second = field(container).getAttribute("aria-activedescendant");
	assert.notEqual(first, second, "ArrowDown moved the active option");
	// IDENTITY, compared as a boolean: `assert.equal` on two jsdom elements
	// builds an inspect diff over the whole node when they differ, which on a
	// failure is an out-of-memory rather than a report.
	assert.ok(
		document.activeElement === field(container),
		"focus stayed in the field",
	);
	await press(container, "Enter");
	assert.equal(jumps.length, 1, "Enter took the reader to the active row");
	assert.equal(panel(container), null, "and closed the panel");
});

test("Home and End land on the first and last option", async (t) => {
	const { container } = await mount(t);
	await type(container, "theme");
	const total = options(container).length;
	await press(container, "End");
	assert.equal(
		field(container).getAttribute("aria-activedescendant"),
		options(container).at(-1).id,
	);
	await press(container, "Home");
	assert.equal(
		field(container).getAttribute("aria-activedescendant"),
		options(container)[0].id,
	);
	assert.ok(total > 1);
});

test("Escape clears a query rather than dismissing the reader's work", async (t) => {
	const { container } = await mount(t);
	await type(container, "theme");
	await press(container, "Escape");
	assert.equal(field(container).value, "");
	assert.ok(
		document.activeElement === field(container),
		"the reader stays in the field to type the next query",
	);
});

test("the empty state says what the box searches and names the shortcut", async (t) => {
	const { container } = await mount(t);
	await act(async () => {
		field(container).focus();
	});
	const text = panel(container).textContent;
	assert.ok(text.includes("registry"), "says it searches the registry");
	assert.ok(/⌘F|Ctrl\+F/.test(text), "names the shortcut");
	assert.equal(
		options(container).length,
		0,
		"no option ids in the empty state",
	);
});

test("no results quotes the query and offers exactly one way out", async (t) => {
	const { container } = await mount(t);
	await type(container, "zzzqqq");
	const text = panel(container).textContent;
	assert.ok(text.includes("zzzqqq"), "the query is quoted back");
	assert.equal(
		container.querySelectorAll("button").length,
		1,
		"one action, not two",
	);
	const clear = container.querySelector("button");
	await act(async () => {
		clear.dispatchEvent(
			new bootstrapDOM.window.MouseEvent("click", { bubbles: true }),
		);
	});
	assert.equal(field(container).value, "");
});

test("the live region announces the result count", async (t) => {
	const { container } = await mount(t);
	await type(container, "theme");
	/*
	 * The live region is an `<output aria-live="polite">`, not a `role="status"`
	 * div: `<output>` is the semantic element for a computed result, and its
	 * default politeness is the one a result count wants.
	 */
	const status = container.querySelector('output[aria-live="polite"]');
	assert.ok(status, "a polite live region exists");
	assert.ok(/\d+ results?/.test(status.textContent), status.textContent);
});
