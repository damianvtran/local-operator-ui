import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE SEARCH STEP'S TWO BRANCHES, RENDERED — the default, and the save.
 *
 * `onboarding-default-model.test.mjs` proves the shape of these tests for step 2
 * and the reason they are rendered at all: a rule asserted only in source is
 * asserted by nobody, because the line that changes is the CALL. This file is
 * the same contract for the redesigned search step:
 *
 *  1. the step OPENS on the Free branch - the free rotation needs no key, and
 *     the step used to present a single-key form that read as a requirement
 *     while the free pool was already serving;
 *  2. the free copy names the pool accurately (and does NOT advertise
 *     Perplexity, which is best-effort/walled and appears only as a key);
 *  3. the keys branch lists every search provider as its own row, and a value
 *     left in a row is saved on BLUR under that row's own credential key;
 *  4. a stored key reads as Saved without the user touching anything.
 *
 * What it cannot claim: jsdom has no layout engine, so "on screen" is the
 * component's own contract, not geometry. Pixels live in the committed frames.
 *
 * The harness is this repository's committed one for a rendered surface
 * (`scripts/backend-settings-collapse.test.mjs`): esbuild bundles the shipped
 * component against the renderer's aliases, and the DOM is jsdom with a real
 * `react-dom/client` root driven through `act`.
 */

// React DOM feature-detects input events at import time, so give it a document
// before loading it.
const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
});
/*
 * jsdom's window IS the DOM, but it is not the global environment the bundled
 * component runs in: ladder primitives reference `HTML*Element` as bare
 * globals, which jsdom defines on its window and Node does not define at all.
 * Every property the window owns is therefore promoted, not just `window` and
 * `document`.
 */
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// A few of jsdom's own accessors refuse to be read out of context; the
		// ones the components need are plain constructors and do not.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

/*
 * `import.meta.env` is the bundler's and this is not the bundler: without it
 * `load-config.ts` calls `Object.entries(undefined)` while the module graph is
 * evaluated. The values are what a build needs, not a configuration under test.
 */
globalThis.__RIG_ENV__ = {
	VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:1",
	VITE_RADIENT_SERVER_BASE_URL: "https://api.example.invalid/v1",
	VITE_RADIENT_CLIENT_ID: "rig",
	VITE_GOOGLE_CLIENT_ID: "rig.apps.googleusercontent.com",
	VITE_MICROSOFT_CLIENT_ID: "00000000-0000-0000-0000-000000000000",
	VITE_MICROSOFT_TENANT_ID: "common",
	VITE_PUBLIC_POSTHOG_KEY: "",
	VITE_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com",
	VITE_LOG_LEVEL: "info",
};

/*
 * The desktop bridge, installed before the module graph is evaluated: without
 * `window.api.desktop` the renderer takes its browser-dev HTTP branch, which is
 * not the code that ships. Three ops are answered - the credentials list, the
 * credential update, and nothing else. `storedKeys` is the bridge's own store,
 * so an update is visible to the refetch the mutation starts, the way a real
 * backend's answer would be.
 */
let storedKeys = [];
const updates = [];
globalThis.window.api = {
	desktop: {
		request: async (request) => {
			switch (request?.op) {
				case "credentials.list":
					return {
						status: 200,
						body: {
							status: 200,
							message: "ok",
							result: { keys: [...storedKeys] },
						},
					};
				case "credentials.update": {
					updates.push({ key: request.key, value: request.value });
					if (!storedKeys.includes(request.key)) storedKeys.push(request.key);
					return { status: 200, body: { status: 200, message: "ok" } };
				}
				default:
					return { status: 503, body: { detail: "not part of this test" } };
			}
		},
	},
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { SearchApiStep } from "./src/renderer/src/features/onboarding/components/steps/search-api-step";
			export { CREDENTIAL_MANIFEST } from "./src/renderer/src/features/settings/components/credential-manifest";
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
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	// React stays external so the bundle shares ONE copy with this file's own
	// imports: two copies give the component a different dispatcher than the one
	// `act` drives. `packages: "external"` keeps the rest of node_modules out of
	// the bundle for the same family of reasons.
	external: [
		"react",
		"react-dom",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	packages: "external",
	// Stylesheets and images carry no assertion here and Node cannot import them.
	loader: {
		".css": "empty",
		".png": "empty",
		".svg": "empty",
		".webp": "empty",
	},
	define: { "import.meta.env": "globalThis.__RIG_ENV__" },
	jsx: "automatic",
	write: false,
});

// Written to a real file rather than imported as a data: URL: modules resolved
// from a data: URL have no base path for the renderer's aliases.
const bundlePath = new URL(
	`./_search-api-step-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	QueryClient,
	QueryClientProvider,
	SearchApiStep,
	CREDENTIAL_MANIFEST,
	createElement,
} = await import(bundlePath.href);
await unlink(bundlePath);

const click = async (el) => {
	assert.ok(el, "the control this step presses must be rendered");
	await act(async () => {
		el.dispatchEvent(
			new bootstrapDOM.window.MouseEvent("click", { bubbles: true }),
		);
	});
};

const type = async (el, value) => {
	assert.ok(el, "the field this step types into must be rendered");
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

/** The blur a user causes by leaving the field. React's `onBlur` is `focusout`. */
const blur = async (el) => {
	await act(async () => {
		el.dispatchEvent(
			new bootstrapDOM.window.FocusEvent("focusout", { bubbles: true }),
		);
	});
};

const until = async (check, what, timeoutMs = 5000) => {
	const start = Date.now();
	for (;;) {
		const value = check();
		if (value) return value;
		if (Date.now() - start > timeoutMs)
			assert.fail(`timed out waiting for ${what}`);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});
	}
};

const mount = async () => {
	const client = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: Number.POSITIVE_INFINITY,
				// The connectivity gate must be OPEN before any credentials read is
				// worth asserting: its server-health and internet answers are seeded
				// below, and an infinite staleTime keeps a refetch from re-asking a
				// port nothing is listening on.
				staleTime: Number.POSITIVE_INFINITY,
				retryOnMount: false,
			},
			// A mutation's cache entry otherwise schedules its own five-minute GC,
			// which keeps the process alive long past the last assertion (measured
			// in `settings-account-gate.test.mjs`).
			mutations: { gcTime: 0 },
		},
	});
	client.setQueryData(["server-health"], { online: true, snapshot: null });
	client.setQueryData(["internet-connectivity"], true);
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client },
				createElement(SearchApiStep, {}),
			),
		);
	});
	// The first credentials read is a query; the assertions below assume it has
	// landed, so the mount waits for the list to have been answered.
	await until(
		() => Boolean(document.querySelector("input[type='radio']")),
		"the step to render",
	);
	return {
		container,
		teardown: async () => {
			await act(async () => root.unmount());
			container.remove();
		},
	};
};

const freeRadio = () => document.getElementById("onboarding-search-mode-free");
const keysRadio = () => document.getElementById("onboarding-search-mode-keys");
const rowFor = (key) => document.querySelector(`[data-search-key="${key}"]`);
const inputFor = (key) =>
	document.querySelector(`[data-search-key="${key}"] input`);

/** The provider keys the keys branch must offer, in the manifest's own order. */
/**
 * The catalogue's search rows, read from the shipped manifest rather than
 * restated: the step's contract is to render every Search entry, in order.
 */
const searchRows = () =>
	CREDENTIAL_MANIFEST.filter((cred) => cred.type === "search");

/** The provider names every search row must show, in the catalogue's order. */
const EXPECTED_NAMES = [
	"SERP API key",
	"Tavily API key",
	"Brave API key",
	"Exa API key",
	"Parallel API key",
	"Perplexity API key",
];

test("the step opens on Free, and its copy names the free pool and never Perplexity", async () => {
	storedKeys = [];
	updates.length = 0;
	const mounted = await mount();
	try {
		assert.equal(freeRadio().checked, true, "Free must be the default branch");
		assert.equal(keysRadio().checked, false, "adding keys must be opt-in");
		assert.equal(
			document.querySelectorAll("input[type='password']").length,
			0,
			"the free branch must not ask for a key",
		);
		const text = document.body.textContent;
		assert.ok(
			text.includes("DuckDuckGo"),
			"the pool's first leg must be named",
		);
		assert.ok(
			text.includes("Tavily's free tier"),
			"the keyless tier must be named",
		);
		assert.ok(
			text.includes("Exa and Parallel"),
			"Exa and Parallel must be named",
		);
		assert.ok(
			text.includes("Recommended"),
			"Free must carry the recommendation cue",
		);
		assert.ok(
			!text.includes("Perplexity"),
			"Perplexity must not be advertised as part of the reliable free pool",
		);
	} finally {
		await mounted.teardown();
	}
});

test("the keys branch lists every provider, and leaving a field saves its own key", async () => {
	storedKeys = [];
	updates.length = 0;
	const mounted = await mount();
	try {
		await click(keysRadio());
		assert.equal(keysRadio().checked, true);
		assert.equal(freeRadio().checked, false);

		const declared = searchRows();
		assert.equal(
			declared.length,
			6,
			"the catalogue carries six search providers",
		);
		assert.deepEqual(
			declared.map((cred) => cred.name),
			EXPECTED_NAMES,
			"the catalogue's search rows, in the order the step renders them",
		);
		const rows = [...document.querySelectorAll("[data-search-key]")].map((el) =>
			el.getAttribute("data-search-key"),
		);
		assert.deepEqual(
			rows,
			declared.map((cred) => cred.key),
			"every catalogue row gets its own field, in the manifest's order",
		);
		for (const cred of declared)
			assert.ok(
				rowFor(cred.key)?.textContent.includes(cred.name),
				`the ${cred.key} row names its provider`,
			);

		const brave = inputFor("BRAVE_API_KEY");
		await type(brave, "brave-test-key");
		await blur(brave);

		await until(() => updates.length === 1, "the blur to save the typed key");
		assert.deepEqual(
			updates,
			[{ key: "BRAVE_API_KEY", value: "brave-test-key" }],
			"a row saves under its OWN credential key",
		);

		// The saved state is visible, and only on the row that saved: the
		// mutation refetches the list, whose bridge now carries the key.
		await until(
			() => (rowFor("BRAVE_API_KEY")?.textContent ?? "").includes("Saved"),
			"the Saved badge on the saved row",
		);
		assert.ok(
			!(rowFor("EXA_API_KEY")?.textContent ?? "").includes("Saved"),
			"a row with no stored key must not claim one",
		);
	} finally {
		await mounted.teardown();
	}
});

test("a key the backend already holds reads as Saved without touching the field", async () => {
	storedKeys = ["BRAVE_API_KEY"];
	updates.length = 0;
	const mounted = await mount();
	try {
		await click(keysRadio());
		await until(
			() => (rowFor("BRAVE_API_KEY")?.textContent ?? "").includes("Saved"),
			"the Saved badge for a stored key",
		);
		assert.equal(updates.length, 0, "nothing may be written by rendering");
	} finally {
		await mounted.teardown();
	}
});
