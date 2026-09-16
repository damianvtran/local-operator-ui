import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE READER'S OWN SEQUENCE — collapse the index, then search it — driven
 * through the SHIPPED component.
 *
 * `backend-settings-tiers.test.mjs` asserts the DECISION (`allOpenTargets`): an
 * unfiltered press leaves the filter's collapse set empty, a filtered press
 * leaves the reader's layout alone. That arm cannot see whether the component
 * still CALLS it, and the gap is not theoretical: the reviewer put the handler
 * back to its pre-fix inline form with `allOpenTargets` exported and untouched,
 * and the committed suite stayed green while the shipped defect returned —
 * `Collapse all` then `provider` leaving two matched sections collapsed under a
 * "35 results in 6 sections" line, and a cleared query ending on a query-shaped
 * layout (agent review round 3, M4). The line that was found wrong twice is the
 * CALL, so the call is what this file renders.
 *
 * What it can and cannot claim: jsdom has no layout engine, so "the row is on
 * screen" is asserted as the component's own contract — the row is rendered and
 * no ancestor is `hidden` — not as geometry. Pixel claims live in the committed
 * frames and the geometry rig, which is where they belong.
 *
 * The harness is this repository's committed one for a rendered surface:
 * esbuild bundles the shipped component against the renderer's own aliases
 * (`scripts/backend-error-surfaces.test.mjs` renders this same component), and
 * the DOM is jsdom with a real `react-dom/client` root, as
 * `scripts/composer-tip-react.test.mjs` does.
 */

// React DOM feature-detects input events at import time, so give it a document
// before loading it rather than activating its legacy IE event polyfill. The
// component's reveal effect uses `requestAnimationFrame`, which jsdom only owns
// when it is visual.
const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>");
/*
 * jsdom's window IS the DOM, but it is not the global environment the bundled
 * component runs in: Radix's select and switch primitives reference
 * `HTMLFormElement` / `HTMLSelectElement` as bare globals, which jsdom defines
 * on its window and Node does not define at all, so a mount throws
 * `ReferenceError: HTMLFormElement is not defined` from a passive effect. Every
 * property the window owns is therefore promoted, not just `window` and
 * `document`.
 */
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// A few of jsdom's own accessors refuse to be read out of context; the
		// ones the components need (`HTML*Element`, `Event`, `getComputedStyle`)
		// are plain constructors and do not.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

/*
 * The bridge has to exist before the module graph is evaluated: without
 * `window.api.desktop` the renderer takes its browser-dev HTTP branch, which is
 * not the code that ships. The two queries are seeded below, so this answers
 * only if something unexpected asks.
 */
globalThis.window.api = {
	desktop: { request: async () => ({ status: 200, body: {} }) },
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { desktopKeys } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";
			export { backendSettingsKeys, BackendSettingsSection } from "./src/renderer/src/features/settings/components/backend-settings-section";
			export { createElement };
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	// React stays external so the bundle shares ONE copy with this file's own
	// imports: two copies give the component a different dispatcher than the one
	// `act` drives. `packages: "external"` is what keeps react-dom's own CJS
	// internals out of an ESM bundle, where its `require("react")` cannot resolve.
	external: [
		"react",
		"react-dom",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	packages: "external",
	// Stylesheets carry no assertion here and Node cannot import them.
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
});

// Written to a real file rather than imported as a data: URL: modules resolved
// from a data: URL have no base path for the renderer's aliases.
const bundlePath = new URL(
	"./_backend-settings-collapse.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));

const {
	QueryClient,
	QueryClientProvider,
	createElement,
	backendSettingsKeys,
	desktopKeys,
	BackendSettingsSection,
} = await import(bundlePath.href);

/** The configured fixture: the wire the surface was built against. */
const payload = JSON.parse(
	readFileSync(
		"scripts/fixtures/backend-settings-registry-configured.json",
		"utf8",
	),
);

const mount = async (t) => {
	const client = new QueryClient({
		defaultOptions: {
			// Seeded rather than fetched: this file is about one handler's effect
			// on what renders, not about the wire.
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
			// `gcTime: 0` rather than the 5-minute default, and not for speed of
			// assertions: the default arms a garbage-collection timer per query that
			// holds the Node event loop open for five minutes AFTER the last
			// assertion, so three sub-second tests cost five minutes of CI. Zero
			// keeps a mounted query's data (the observers are active throughout each
			// test) and drops it the moment the tree unmounts, which is what a test
			// wants.
			gcTime: 0,
		},
	});
	client.setQueryData(desktopKeys.capabilities, {
		desktop_available: true,
		features: { settings: 1 },
	});
	client.setQueryData(backendSettingsKeys.all, payload);
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client },
				createElement(BackendSettingsSection, {}),
			),
		);
	});
	/*
	 * Teardown is registered ON THE TEST rather than written at the end of each
	 * test's body, because that placement only ever ran on the green path: an
	 * assertion that throws leaves the rest of the body unexecuted, and the tree
	 * this file mounted is then still live with nothing left to unmount it.
	 *
	 * MEASURED, on the failure this file exists for (the handler reverted to its
	 * pre-fix inline form, so the third case's last assertion fails): the
	 * assertions finish in ~1.4s, and the process then runs forever. The mounted
	 * tree keeps the event loop open - Radix's popper and the reveal effect
	 * re-arm per frame and every render warns - so 90 seconds produced 61,729
	 * warning lines, no summary at all (node prints it only when the process is
	 * free to finish) and exit 124 under `timeout`. Wired into CI that way, a
	 * broken handler appears as a HANG rather than as a failing test, and a hang
	 * is the one result that gets retried until it looks flaky. `t.after` is the
	 * hook for "after this test, however it ended", so a red run tears down here
	 * too and is reported as the failing test it is.
	 */
	t.after(async () => {
		await act(async () => {
			root.unmount();
			// React Query arms a garbage-collection timer per cached query, and the
			// default is five minutes: without this the timers outlive the assertions
			// and hold the event loop, so three sub-second tests cost five minutes of
			// CI. (`mount` also pins `gcTime: 0`, which is what keeps a PASSING run
			// quick; this is the belt to that braces, and clearing the cache on the
			// way out is what a test wants anyway - the next mount seeds its own
			// client.)
			client.clear();
		});
		container.remove();
	});
	return { root, client, container };
};

const click = async (el) => {
	assert.ok(el, "the control this step presses must be rendered");
	await act(async () => {
		el.dispatchEvent(
			new bootstrapDOM.window.MouseEvent("click", { bubbles: true }),
		);
	});
};

const type = async (el, value) => {
	assert.ok(el, "the search field must be rendered");
	await act(async () => {
		// React's `onChange` reads the DOM property's setter, not the attribute.
		const setter = Object.getOwnPropertyDescriptor(
			bootstrapDOM.window.HTMLInputElement.prototype,
			"value",
		).set;
		setter.call(el, value);
		el.dispatchEvent(new bootstrapDOM.window.Event("input", { bubbles: true }));
	});
};

const button = (name) =>
	[...document.querySelectorAll("button")].find(
		(el) => el.textContent.trim() === name,
	);

const search = () =>
	document.querySelector('input[aria-label="Search settings"]');

const openSections = () =>
	[...document.querySelectorAll("[data-settings-section]")].filter(
		(el) => el.getAttribute("data-open") === "true",
	).length;

/** The component's own visibility contract: rendered, and no ancestor hidden. */
const rowShown = (key) => {
	const el = document.querySelector(`[data-setting-key="${key}"]`);
	return Boolean(el) && el.closest("[hidden]") === null;
};

test("Collapse all, then a search: the search force-opens what it matched", async (t) => {
	await mount(t);

	await click(button("Collapse all"));
	assert.equal(
		openSections(),
		0,
		"Collapse all with no filter up collapses the index",
	);

	await type(search(), "provider");
	assert.ok(
		openSections() > 0,
		`a query force-opens the sections it matched; ${openSections()} were open`,
	);
	assert.ok(
		rowShown("hosting"),
		"the matched row is rendered and its section body is not hidden",
	);
});

test("Collapse all with the tier shown, then a search: same, for all 19 sections", async (t) => {
	await mount(t);

	await click(button("Show advanced"));
	await click(button("Collapse all"));
	assert.equal(openSections(), 0, "the tier-revealed index is collapsed");

	await type(search(), "provider");
	assert.ok(
		openSections() > 0,
		`every matched section is force-opened; ${openSections()} were open`,
	);
	assert.ok(
		rowShown("hosting"),
		"the matched row is rendered rather than counted and hidden",
	);
});

test("Collapse all during a search stays out of the reader's own layout", async (t) => {
	await mount(t);

	await type(search(), "provider");
	assert.ok(rowShown("hosting"), "the query shows its match to begin with");

	await click(button("Collapse all"));
	assert.equal(openSections(), 0, "the press collapses the list on screen");

	await type(search(), "");
	assert.equal(
		openSections(),
		4,
		"clearing the query restores the arrival layout, not a query-shaped one",
	);
	assert.ok(rowShown("hosting"), "and Model's own row is on screen again");
});
