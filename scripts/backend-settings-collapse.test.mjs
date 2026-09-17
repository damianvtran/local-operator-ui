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
	/*
	 * Teardown is armed FIRST, before anything this function creates exists. It is
	 * registered ON THE TEST (`t.after`, "after this test, however it ended")
	 * rather than written at the end of each test's body, because that placement
	 * only ever ran on the green path: a throw anywhere in a body leaves the rest
	 * unexecuted, and the tree this file mounted is then still live with nothing
	 * left to unmount it.
	 *
	 * Why FIRST, and not after `createRoot` (the placement this file first
	 * shipped with, one line above the render): entered there it still hangs. The
	 * two `setQueryData` seeds below are what hold the event loop, so a throw
	 * after them and before the teardown registers reproduces the original
	 * failure exactly - MEASURED with a probe throwing at the container append,
	 * `timeout 30` gave exit 124 at 30.0s with the warning stream and no summary;
	 * the same probe with the seeds removed exits 1 in 0.7s, and a teardown doing
	 * nothing but `client.clear()` exits it in 0.8s. The seeded query cache is
	 * the holder. Reachable without contrivance: `setQueryData` shape drift, a
	 * changed prop contract on `BackendSettingsSection`, or a Radix primitive
	 * jsdom does not provide all fail inside the body rather than on an
	 * assertion, and the red run then presents as a hang again.
	 *
	 * So each resource is torn down only if it exists, and the cache is cleared in
	 * a `finally` - an unmount that throws must not skip the one step that
	 * releases the loop. MEASURED on all three throw paths with this in place - a
	 * throw before `createRoot`, inside the render `act`, and after it - each
	 * exits 1 in about a second with a full summary naming the thrown error.
	 *
	 * WHY ANY OF IT MATTERS: once the mounted tree is left standing the process
	 * runs forever. The tree keeps the event loop open - Radix's popper and the
	 * reveal effect re-arm per frame and every render warns - so a bounded run
	 * produces a stream of warnings, no summary at all (node prints it only when
	 * the process is free to finish) and exit 124 under `timeout`. Wired into CI
	 * that way, a broken handler appears as a HANG rather than as a failing test,
	 * and a hang is the one result that gets retried until it looks flaky.
	 *
	 * WHICH MUTATION IS WHICH, because the first version of this comment named
	 * the wrong one. The handler reverted VERBATIM to its pre-fix inline form
	 * (from `dafc7f007^`, with `allOpenTargets` left exported and intact) fails
	 * all THREE cases - `tests 3 / pass 0 / fail 3`, summary 1.7s in (3.6s wall).
	 * The `pass 2 / fail 1` figure belongs to the LAYOUT-ONLY partial revert:
	 * pre-fix `setOpened`/`setClosed` writes with this tree's
	 * `setFilterClosed(new Set(targets.filter))` kept, which fails only the third
	 * case, summary 1.4s in. Both exit 1 within seconds with a summary, which is
	 * the property this file is for; a reader reverting to reproduce the hang will
	 * see three failures, not one.
	 */
	/* `const` record rather than `let` declarations: biome's `useConst` is right
	 * that each field is written once, and the teardown above has to be armed
	 * before any of them exists. */
	const mounted = {};
	t.after(async () => {
		await act(async () => {
			try {
				mounted.root?.unmount();
			} finally {
				// React Query arms a garbage-collection timer per cached query, and the
				// default is five minutes: without this the timers outlive the assertions
				// and hold the event loop, so three sub-second tests cost five minutes of
				// CI. (`mount` also pins `gcTime: 0`, which is what keeps a PASSING run
				// quick; this is the belt to that braces, and clearing the cache on the
				// way out is what a test wants anyway - the next mount seeds its own
				// client.)
				mounted.client?.clear();
			}
		});
		mounted.container?.remove();
	});
	mounted.client = new QueryClient({
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
	mounted.client.setQueryData(desktopKeys.capabilities, {
		desktop_available: true,
		features: { settings: 1 },
	});
	mounted.client.setQueryData(backendSettingsKeys.all, payload);
	mounted.container = document.createElement("div");
	document.body.append(mounted.container);
	mounted.root = createRoot(mounted.container);
	await act(async () => {
		mounted.root.render(
			createElement(
				QueryClientProvider,
				{ client: mounted.client },
				createElement(BackendSettingsSection, {}),
			),
		);
	});
	return mounted;
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

/*
 * Node's runner sets NO default per-test timeout, so a body that never settles
 * parks the run instead of failing it: a test awaiting a forever-pending
 * promise never returns, reports no failure, and exits 124 under a bound. This
 * file's green run is ~2s for all three cases, so 30s is ~15x its cost and
 * turns that shape into a failure. It does NOT bound the other shape - tests
 * that finish and then leave the process unable to exit, which is the hang this
 * file's `t.after` removes; a per-test timeout cannot see a leak that outlives
 * every test, so the Desktop Tests job carries its own `timeout-minutes` for
 * that one.
 */
const TEST_TIMEOUT_MS = 30_000;

/** The component's own visibility contract: rendered, and no ancestor hidden. */
const rowShown = (key) => {
	const el = document.querySelector(`[data-setting-key="${key}"]`);
	return Boolean(el) && el.closest("[hidden]") === null;
};

test(
	"Collapse all, then a search: the search force-opens what it matched",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
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
	},
);

test(
	"Collapse all with the tier shown, then a search: same, for all 19 sections",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
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
	},
);

test(
	"Collapse all during a search stays out of the reader's own layout",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
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
	},
);
