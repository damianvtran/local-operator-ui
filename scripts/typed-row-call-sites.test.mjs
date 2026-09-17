/*
 * Free text at the control's THREE pre-existing call sites, rendered for real.
 *
 * Round 2 made the row that carries the typed text opt-in on two props —
 * `onCustomSubmit` **and** `customRowLabel` — while the owners of free text are
 * the ones that pass `onCustomSubmit`. Only the settings wrapper passes a label,
 * so at `hosting-select`, `model-select` and `create-file-dialog` a query that
 * matched nothing left Enter doing nothing at all and `onBlur` discarding the
 * text: a shipped affordance removed from two features by a remediation that was
 * supposed to add one (review round 2, R2-1, MAJOR).
 *
 * The unit tests around `buildComboboxRows` could not see it, and that is worth
 * stating: they pass the "free text allowed" flag themselves, so the flag's
 * VALUE was never the thing under test. This file renders the SHIPPED component
 * with each call site's own props, in a real DOM, and presses the key — so the
 * gate between "this owner wants free text" and "a row offers it" is exercised
 * where it lives rather than where it is read.
 *
 * What it can and cannot claim: jsdom runs the component's own event handlers and
 * state, so the row's presence and the value Enter commits are the shipped
 * ones; it has no layout engine, so nothing here says anything about pixels. The
 * three prop sets are transcribed from the call sites with their line numbers
 * quoted, because a prop set that drifted from the real call site would make
 * this file pass about code nobody ships.
 */
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

// React DOM feature-detects input events at import time, so give it a document
// before loading it; the component's popover and its own effects need the rest
// of jsdom's globals promoted the way the section's test does it.
const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	// Radix and the popover resolve anchors through `new URL(...)`, which needs a
	// document address rather than jsdom's default `about:blank`.
	url: "http://localhost/settings",
});
/*
 * The DOM constructors jsdom owns are FORCED onto the global, including the ones
 * Node already defines. The usual recipe skips a key that exists globally, and
 * that is wrong here: Node 26 defines `Event` and `CustomEvent` itself, so Radix
 * would build its document-level events from NODE's classes and jsdom would
 * refuse them with `parameter 1 is not of type 'Event'` — an error thrown from
 * inside React's commit phase, which reads as a component bug rather than a
 * harness one. The rest are promoted only where Node has nothing, so the
 * harness's own timers and fetch are Node's.
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
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// A few of jsdom's own accessors refuse to be read out of scope.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
// `act` refuses to flush effects without this, and a component whose popover
// mounts an effect would then be asserted in a state React never committed.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/*
 * jsdom has no layout engine, so it implements no scrolling at all: the control's
 * effect that keeps the active row in view would throw on the first render.
 * Nothing here is about pixels, so the stub states the only truth jsdom has.
 */
bootstrapDOM.window.Element.prototype.scrollIntoView = () => {};
const { createRoot } = await import("react-dom/client");

const bundle = await build({
	stdin: {
		contents:
			'export { SearchableSelect } from "./src/renderer/src/shared/components/ui/searchable-select";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: { "@shared": "./src/renderer/src/shared" },
	/*
	 * React stays external so the bundle shares ONE copy with this file's own
	 * imports: two copies hand the component a different dispatcher than the one
	 * `act` drives, and the failure reads as a hook called outside a component.
	 */
	external: ["react", "react-dom", "react/jsx-runtime"],
	packages: "external",
	// Stylesheets carry no assertion here and Node cannot import them.
	loader: { ".css": "empty" },
	jsx: "automatic",
});
/*
 * Written beside this file and imported by URL rather than inlined as a `data:`
 * URL: the bundle's externals are bare specifiers (`react/jsx-runtime` above
 * all), and only a file URL resolves those against `node_modules`.
 */
const bundlePath = new URL(
	"./_typed-row-call-sites.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));
const { SearchableSelect } = await import(bundlePath.href);

const OPTIONS = [
	{
		id: "anthropic",
		name: "Anthropic (Claude Pro/Max)",
		description: "Needs sign-in",
	},
	{ id: "ollama", name: "Ollama", description: "No key needed" },
];

/**
 * The three call sites, each as the SHIPPED code passes them. Every `onCustomSubmit`
 * below is transcribed from the call site named above it, and every one of them is
 * conditional on the owner's own flag (`allowCustom` in the two hosting pickers,
 * unconditional in the dialog).
 */
const CALL_SITES = [
	{
		name: "shared/components/hosting/hosting-select.tsx:326-337",
		// `onCustomSubmit` is `allowCustom ? (text) => save(text) : undefined`,
		// and `settings-page.tsx:903` passes `allowCustom={true}`.
		props: {
			label: "Hosting provider",
			placeholder: "Select a hosting provider...",
			busyLabel: "Saving hosting provider",
		},
		custom: true,
	},
	{
		name: "shared/components/hosting/model-select.tsx:388-398",
		// Same `allowCustom` gate; `settings-page.tsx:914` passes true.
		props: {
			label: "Model",
			placeholder: "Select a model...",
			busyLabel: "Saving model",
		},
		custom: true,
	},
	{
		name: "features/chat/components/canvas/create-file-dialog.tsx:222-233",
		// `onCustomSubmit={(text) => setFileType(text)}`, ungated, under a tooltip
		// that promises "Pick an extension, or type one that is not listed."
		props: {
			label: "File type",
			placeholder: "Select or type an extension",
			busyLabel: "Loading file types",
		},
		custom: true,
	},
];

/** Type into the field the way React reads it: set the value, then fire input. */
const type = async (input, text) => {
	const setter = Object.getOwnPropertyDescriptor(
		bootstrapDOM.window.HTMLInputElement.prototype,
		"value",
	).set;
	await act(async () => {
		setter.call(input, text);
		input.dispatchEvent(
			new bootstrapDOM.window.Event("input", { bubbles: true }),
		);
	});
};

const press = async (input, key) => {
	await act(async () => {
		input.dispatchEvent(
			new bootstrapDOM.window.KeyboardEvent("keydown", {
				key,
				bubbles: true,
				cancelable: true,
			}),
		);
	});
};

const mount = async (site, custom) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const committed = [];
	await act(async () => {
		root.render(
			React.createElement(SearchableSelect, {
				...site.props,
				options: OPTIONS,
				selected: { id: "anthropic", name: "Anthropic (Claude Pro/Max)" },
				onSelect: () => {},
				onCustomSubmit: custom ? (text) => committed.push(text) : undefined,
			}),
		);
	});
	const input = container.querySelector('input[role="combobox"]');
	assert.ok(input, `${site.name} must render the combobox input`);
	return { container, root, committed, input };
};

/*
 * Queried from the DOCUMENT, not from the mount container: the listbox is a Radix
 * popover and renders through a portal on `document.body`, so a container-scoped
 * query finds an open list and no rows — which is how a first cut of this file
 * reported the bug it was written to catch.
 */
const typedRows = () =>
	document.querySelectorAll('li[data-combobox-row="typed"]');

for (const site of CALL_SITES) {
	test(`${site.name}: an unmatched query still offers the typed text`, async () => {
		const { container, root, committed, input } = await mount(
			site,
			site.custom,
		);
		await act(async () => {
			// The pointer path, which is what opens the list in the app. A
			// programmatic `focus()` dispatches no event React listens for.
			input.dispatchEvent(
				new bootstrapDOM.window.MouseEvent("mousedown", { bubbles: true }),
			);
			input.dispatchEvent(
				new bootstrapDOM.window.MouseEvent("click", { bubbles: true }),
			);
			input.focus();
		});
		await type(input, "zzz-not-listed");
		assert.equal(
			typedRows().length,
			1,
			"the typed-text row must exist for an owner that commits free text",
		);
		// The default label, because this caller supplies none: a caller with no
		// opinion about copy must not have to write one to keep its free text.
		assert.equal(
			typedRows()[0].textContent.includes('Use "zzz-not-listed"'),
			true,
			`the row must name the typed text, read: ${typedRows()[0].textContent}`,
		);
		await press(input, "Enter");
		assert.deepEqual(
			committed,
			["zzz-not-listed"],
			"Enter must hand the typed text to the owner's own commit path",
		);
		await act(async () => root.unmount());
		container.remove();
	});
}

test("a field whose owner does not commit free text offers no such row", async () => {
	// The other direction, so the gate is pinned from both sides: the dialog's
	// extension picker and the hosting pickers pass `onCustomSubmit` only when
	// their owner allows a custom value, and a caller that does not must not get
	// a row offering one.
	const site = CALL_SITES[0];
	const { container, root, committed, input } = await mount(site, false);
	await act(async () => {
		input.dispatchEvent(
			new bootstrapDOM.window.MouseEvent("mousedown", { bubbles: true }),
		);
		input.focus();
	});
	await type(input, "zzz-not-listed");
	assert.equal(typedRows().length, 0);
	await press(input, "Enter");
	assert.deepEqual(committed, []);
	await act(async () => root.unmount());
	container.remove();
});
