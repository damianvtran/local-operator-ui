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
			export { buildSettingsIndex, buildRenderedEntries } from "./src/renderer/src/features/settings/search/settings-search-index";
			export function Harness({ buildIndex, registry, sections, onJump, readRendered, onDismiss }) {
				const index = useSettingsSearchIndex({ registry, sections, build: buildIndex });
				return createElement(SettingsSearch, { index, onJump, readRendered, onDismiss });
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
const mount = async (
	t,
	{
		registry = payload,
		buildIndex,
		outcome = "landed",
		readRendered,
		onDismiss,
	} = {},
) => {
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
				readRendered,
				onDismiss,
				onJump: (entry) => {
					jumps.push(entry);
					return outcome;
				},
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
	/*
	 * The line itself, not "any `<p>` in the panel": the old selector matched a
	 * group heading too, so the assertion passed for the wrong reason (review
	 * round 1, n3).
	 */
	const more = container.querySelector("[data-search-more]");
	assert.ok(more, "a +N more line exists");
	assert.match(more.textContent ?? "", /more/i);
	assert.equal(
		Number.parseInt((more.textContent ?? "").match(/\d+/)?.[0] ?? "0", 10) > 0,
		true,
		"and it counts what is not shown",
	);
});

test("the combobox points its active option at a real option id", async (t) => {
	const { container } = await mount(t);
	await type(container, "theme");
	const input = field(container);
	assert.equal(input.getAttribute("aria-expanded"), "true");
	const listId = input.getAttribute("aria-controls");
	assert.equal(panel(container).id, listId);
	/*
	 * NOTHING IS MARKED UNTIL THE READER MOVES. A pre-marked first row made the
	 * first ArrowDown land on the second row (UX round 1, U9), so the combobox
	 * starts with no `aria-activedescendant`; the arrow is what names one.
	 */
	assert.equal(
		input.getAttribute("aria-activedescendant"),
		null,
		"no option is marked before the reader moves",
	);
	await press(container, "ArrowDown");
	const active = input.getAttribute("aria-activedescendant");
	assert.ok(active, "an active descendant once the arrow has chosen");
	assert.ok(container.querySelector(`[id="${active}"]`), "and it exists");
});

test("arrows move the active option and Enter jumps to it, focus staying in the field", async (t) => {
	const { container, jumps } = await mount(t);
	await type(container, "model");
	await press(container, "ArrowDown");
	assert.equal(
		field(container).getAttribute("aria-activedescendant"),
		options(container)[0].id,
		"the first press selects the first row (not the second)",
	);
	await press(container, "ArrowDown");
	assert.equal(
		field(container).getAttribute("aria-activedescendant"),
		options(container)[1].id,
		"the second press moves to the second row",
	);
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
	await type(container, "model");
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
		panel(container),
		"one press clears and leaves the panel open: clear first, close second (UX round 1, U4)",
	);
	assert.ok(
		document.activeElement === field(container),
		"the reader stays in the field to type the next query",
	);
	await press(container, "Escape");
	assert.equal(
		panel(container),
		null,
		"the second press, on an empty field, closes",
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

test("the Clear button is reachable by keyboard, and the panel survives the Tab into it (QA round 1, Q3)", async (t) => {
	/*
	 * The panel followed the FIELD's blur, so tabbing from the field toward the
	 * Clear button unmounted the panel the reader was tabbing into and left
	 * focus on `<body>`: the button could never take a caret or show its ring
	 * (QA round 1, Q3). The widget asks the question that matters — did focus
	 * leave the WIDGET? — which is a question about the container, not the
	 * input.
	 */
	const { container } = await mount(t);
	await type(container, "zzzqqq");
	const clear = container.querySelector("button");
	assert.ok(clear, "the no-result state offers its one action");
	await act(async () => {
		clear.focus();
	});
	assert.equal(
		panel(container) !== null,
		true,
		"focus moving to the panel's own control does not close the panel",
	);
	assert.equal(
		document.activeElement,
		clear,
		"the Clear button can hold focus, so it can show and use its ring",
	);
	// Leaving the whole surface still closes it: the panel is not sticky.
	const outside = document.createElement("button");
	document.body.append(outside);
	await act(async () => {
		clear.dispatchEvent(
			new bootstrapDOM.window.FocusEvent("blur", { bubbles: true }),
		);
		await new Promise((r) => setTimeout(r, 0));
	});
	await act(async () => {
		outside.focus();
	});
	await act(async () => {
		await new Promise((r) => setTimeout(r, 0));
	});
	assert.equal(panel(container), null, "focus leaving the widget closes it");
	outside.remove();
});

test("a row that mounts after the first focus is still found (QA round 1, Q5)", async (t) => {
	/*
	 * The page's rendered half was read ONCE per mount, so a row that mounts
	 * after the field's first focus — window glass and the effort select both
	 * wait for a bridge/store answer — was invisible to every later query, which
	 * is how a row whose every single word finds it can be absent from the panel
	 * (QA round 1, Q5). Opening the panel re-reads the page's own rows.
	 */
	// A tiny registry: this case is about the PAGE half arriving late, and the
	// 230-row fixture costs a full index build for nothing.
	const { buildRenderedEntries } = await import(bundlePath.href);
	const { container } = await mount(t, {
		registry: { sections: [], settings: [] },
		readRendered: () =>
			buildRenderedEntries(document.querySelector("[data-settings-content]")),
	});
	const rows = document.createElement("div");
	rows.setAttribute("data-settings-content", "");
	document.body.append(rows);
	await type(container, "translucent");
	assert.equal(
		container.querySelector('[role="option"]'),
		null,
		"nothing matches before the row exists",
	);
	rows.innerHTML = `
		<div data-search-section="appearance" data-search-section-label="Appearance">
			<div data-search-row="appearance.glass" data-search-control>
				<div>
					<span data-search-label="">Translucent window</span>
					<p>Lets your desktop show through the app window, blurred by the system.</p>
				</div>
			</div>
		</div>`;
	await act(async () => {
		field(container).blur();
		field(container).focus();
	});
	assert.equal(
		container
			.querySelector('[role="option"]')
			?.textContent?.includes("Translucent window"),
		true,
		"reopening the panel sees the row that arrived",
	);
	rows.remove();
});

test("a jump that cannot land is said on screen, not only to a screen reader (UX round 1, U2)", async (t) => {
	const { container } = await mount(t, { outcome: "missing" });
	await type(container, "model");
	await press(container, "ArrowDown");
	await press(container, "Enter");
	const notice = container.querySelector("[data-search-notice]");
	assert.ok(notice, "the sentence is rendered in the panel");
	assert.match(
		notice.textContent ?? "",
		/not on screen/i,
		"and it is the message the panel already had",
	);
	assert.equal(
		notice.getAttribute("aria-hidden"),
		"true",
		"the visible copy is not a second announcement",
	);
	const live = container.querySelector('output[aria-live="polite"]');
	assert.match(
		live?.textContent ?? "",
		/not on screen/i,
		"the polite region still speaks it",
	);
});

test("the listbox is not a tab stop (UX round 1, U6)", async (t) => {
	const { container } = await mount(t);
	await type(container, "model");
	assert.equal(
		panel(container).getAttribute("tabindex"),
		"-1",
		"Tab does not land on the scroll region; options are reached by aria-activedescendant",
	);
});

test("a dismissal tells the page to restore what the reader was looking at (UX round 1, U5)", async (t) => {
	const dismissals = [];
	const { container } = await mount(t, { onDismiss: () => dismissals.push(1) });
	await type(container, "model");
	await press(container, "Escape");
	assert.deepEqual(
		dismissals,
		[],
		"clearing a query is not a dismissal — nothing is restored yet",
	);
	await press(container, "Escape");
	assert.equal(dismissals.length, 1, "closing the panel tells the page");
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

test("a jump that cannot land is a sentence, not a silent close", async (t) => {
	/*
	 * B1/m5: a registry key or a section with no rendered root used to close the
	 * panel and move nothing, with `jump.missing` in all eight catalogues and
	 * never spoken. The page answers `"missing"`; the panel must say so and stay
	 * open with the reader still in the field.
	 */
	const { container } = await mount(t, { outcome: "missing" });
	await type(container, "theme");
	await press(container, "Enter");
	const status = container.querySelector('output[aria-live="polite"]');
	assert.match(status?.textContent ?? "", /not on screen/i);
	assert.ok(panel(container), "the panel stays open for the next choice");
	assert.ok(
		document.activeElement === field(container),
		"and the reader stays in the field",
	);
});
