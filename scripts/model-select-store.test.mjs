import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE PICKER FOLLOWS THE STORE — the first-mount path QA round 2 walked.
 *
 * `ModelSelect` read its list through `getModelsForHostingProvider`, a getter over
 * the models store, inside a memo keyed on `hostingId` alone. On a backend without
 * the suggested-defaults fields the store is still EMPTY on the first render, so
 * the memo ran once, saw nothing, and never re-ran when the catalogue arrived:
 * onboarding step 2 sat with an empty, disabled Model field behind "No models
 * available for selected provider." while the same catalogue listed fine after a
 * remount (QA round 2 R2-Q3; `v0.62.26` is the newest release, so every first-run
 * user took that path).
 *
 * The component is rendered here because the defect is the CALL: a test over the
 * store's contents, or over `getModelsForHostingProvider`, passes whichever
 * dependencies the memo declares. What is asserted is the reader's own sequence --
 * render with the store empty, then let the store fill -- and that the message a
 * blocked first-run user sees goes away on its own.
 */

const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	// The models store persists through `localStorage`, which jsdom only provides
	// for a document that has an origin.
	url: "http://localhost/",
});
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// Accessors jsdom will not read out of context; the constructors the
		// components need are plain ones.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
globalThis.localStorage = bootstrapDOM.window.localStorage;
/*
 * The component's refresh hook arms a `window.setInterval`; nothing here waits for
 * a refresh, and a live interval keeps the event loop open after the assertions,
 * which turns a passing file into a timeout (the hang this repository's rendered
 * tests all guard against). The WINDOW's timer is stubbed and Node's is left
 * alone, because this file's own waits use the global one.
 */
bootstrapDOM.window.setInterval = () => 0;
bootstrapDOM.window.setTimeout = () => 0;
/*
 * And nothing reaches the network. The models store fetches on its own the moment
 * the tree mounts (the picker's refresh hook), and a real socket against an API the
 * test never started is both pointless here and the handle that stops this file
 * exiting: dropping it keeps the run self-contained and lets node finish.
 */
bootstrapDOM.window.fetch = async () => ({
	ok: true,
	status: 200,
	json: async () => ({ models: [], providers: [] }),
	text: async () => "{}",
});
bootstrapDOM.window.XMLHttpRequest = class {
	open() {}
	send() {}
	setRequestHeader() {}
	addEventListener() {}
	removeEventListener() {}
	abort() {}
};
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

globalThis.window.api = {
	desktop: {
		request: async () => ({ status: 200, body: { result: null } }),
		openAuthorization: async () => ({ opened: true }),
	},
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { ModelSelect } from "./src/renderer/src/shared/components/hosting/model-select";
			export { useModelsStore } from "./src/renderer/src/shared/store/models-store";
			export { getModelsForHostingProvider } from "./src/renderer/src/shared/components/hosting/hosting-model-manifest";
			export { createElement };
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
	external: [
		"react",
		"react-dom",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	packages: "external",
	loader: { ".css": "empty" },
	jsx: "automatic",
	/*
	 * The renderer reads `import.meta.env` at MODULE LOAD (the models store pulls in
	 * the config module, which walks it), and Vite is not the bundler here: an
	 * undefined `import.meta.env` throws before any assertion runs. An empty object
	 * is what a browser build without any VITE_* value looks like.
	 */
	define: { "import.meta.env": "{}" },
	write: false,
});

const bundlePath = new URL("._model-select-store.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));

const {
	createElement,
	ModelSelect,
	QueryClient,
	QueryClientProvider,
	useModelsStore,
	getModelsForHostingProvider,
} = await import(bundlePath.href);

// The component refreshes the catalogue through react-query, so the tree needs a
// client; nothing here asserts on its cache.
const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

const NO_MODELS = /No models available/;

/*
 * WHY THIS FILE ENDS ITSELF.
 *
 * After the tree is unmounted and the query cache cleared, this process still holds
 * a socket and two timer handles (measured: `getActiveResourcesInfo()` reports
 * `ConnectWrap`, `PipeWrap`, `TCPSocketWrap`, `Timeout`, `Immediate`), so node never
 * exits on its own and the runner reports a passing file as a job timeout -- the
 * failure mode this repository's rendered tests exist to avoid. Neither the store's
 * fetch nor the window timers could be stubbed away without changing what the
 * component is being tested THROUGH, so the exit is explicit and carries the code
 * the run earned: `failures` is incremented by the wrapper below before the error
 * is re-thrown, so an assertion that fails can never be reported as green.
 */
after(() => {
	process.exit(failures > 0 ? 1 : 0);
});

let failures = 0;
const run = (name, body) =>
	test(name, async (t) => {
		try {
			await body(t);
		} catch (error) {
			failures += 1;
			throw error;
		}
	});

run(
	"the model list arrives when the store fills, on the same mount",
	async (t) => {
		// The store as the first render finds it on a released backend: no catalogue yet.
		useModelsStore.setState({
			models: [],
			providers: [],
			isInitialized: false,
		});

		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		t.after(() => {
			try {
				root.unmount();
			} finally {
				container.remove();
				queryClient.clear();
			}
		});

		await act(async () => {
			root.render(
				createElement(
					QueryClientProvider,
					{ client: queryClient },
					createElement(ModelSelect, {
						hostingId: "radient",
						value: "",
						onChange: () => undefined,
					}),
				),
			);
		});
		assert.match(
			container.textContent ?? "",
			NO_MODELS,
			"with no catalogue the picker says so, which is the state the defect froze",
		);

		/*
		 * THE STORE'S OWN FETCH IS ISOLATED, and the reason is a finding rather than
		 * tidiness: this picker mounts `useModels`, whose auto-fetch runs against the
		 * configured base URL. In this environment that call can be ANSWERED -- by
		 * another process holding the port -- with an empty catalogue, which sets
		 * `providers: []` and `models: []` and wipes the very listing this test
		 * publishes. The five-second TIME cache this suite was written against masked
		 * that for exactly as long as the assertion needs; the store-keyed cache the
		 * review round asked for (R3-m4) does not, which is how the masking surfaced.
		 * The subject here is the picker following the STORE, so the fetch is a
		 * recorded no-op and nothing else about the mount changes.
		 */
		const realFetch = useModelsStore.getState().fetchModels;
		useModelsStore.setState({ fetchModels: async () => undefined });
		t.after(() => useModelsStore.setState({ fetchModels: realFetch }));

		/*
		 * The catalogue lands, exactly as it does a moment after mount. Nothing is
		 * remounted and no prop changes: the list has to follow the store, or the field
		 * stays disabled and Continue stays blocked for the whole first run.
		 */
		await act(async () => {
			useModelsStore.setState({
				isInitialized: true,
				providers: [
					{
						id: "radient",
						name: "Radient",
						description: "Radient models",
						url: "https://radient.example",
						requiredCredentials: [],
					},
				],
				models: [
					{
						id: "auto",
						provider: "radient",
						info: {
							name: "Automatic",
							description: "Picks a model for the request",
							context_window: 128000,
							max_tokens: 4096,
							recommended: true,
						},
					},
					{
						id: "qa/fake-model",
						provider: "radient",
						info: {
							name: "QA Fake",
							description: "A model this file's fixture made up",
							context_window: 8192,
							max_tokens: 1024,
						},
					},
				],
			});
		});

		assert.doesNotMatch(
			container.textContent ?? "",
			NO_MODELS,
			"the picker must re-read the store it was told to wait for",
		);
	},
);

run(
	"a listing that arrives INSIDE the old cache's window is the listing the picker sees",
	async (t) => {
		/*
		 * THE CASE THE FIVE-SECOND CACHE FAILED. The first case above cannot catch a
		 * time-based cache at all: it mounts on an EMPTY store, and an empty store
		 * returns before any cache is written, so the pre-fix implementation
		 * (`CACHE_TTL = 5000`, `now - lastCacheTime`) passes it (review round 4,
		 * R4-m1 -- reproduced against `b4856092e^`). Here the first render READS a real
		 * listing, which is what fills the cache, and then the store changes within
		 * that window: a cache keyed on a clock still returns the OLD models for the
		 * rest of it, and one keyed on the store returns the new ones immediately.
		 */
		const listing = (id, name) => ({
			id,
			provider: "radient",
			info: {
				name,
				description: "",
				context_window: 8192,
				max_tokens: 1024,
			},
		});
		const withModels = (models) => ({
			isInitialized: true,
			providers: [
				{
					id: "radient",
					name: "Radient",
					description: "",
					url: "https://radient.example",
					requiredCredentials: [],
				},
			],
			models,
		});
		useModelsStore.setState(withModels([listing("auto", "Automatic")]));
		/*
		 * The store's own fetch is isolated here for the reason the first case states:
		 * this environment can ANSWER it with an empty catalogue, which wipes the very
		 * listing this case publishes.
		 */
		const realFetch = useModelsStore.getState().fetchModels;
		useModelsStore.setState({ fetchModels: async () => undefined });
		t.after(() => useModelsStore.setState({ fetchModels: realFetch }));

		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		t.after(() => {
			try {
				root.unmount();
			} finally {
				container.remove();
				queryClient.clear();
			}
		});

		await act(async () => {
			root.render(
				createElement(
					QueryClientProvider,
					{ client: queryClient },
					createElement(ModelSelect, {
						hostingId: "radient",
						value: "",
						onChange: () => undefined,
					}),
				),
			);
		});
		/*
		 * The render above is what FILLS the cache: the picker's own read ran and the
		 * old implementation remembered its answer for five seconds. What is asserted
		 * here is that read, because the option rows themselves only exist in the
		 * closed select's popup -- the first case covers the render path, and this one
		 * covers the cache the render left behind.
		 */
		assert.deepEqual(
			getModelsForHostingProvider("radient").map((model) => model.id),
			["auto"],
			"the first read must be the listing the store held",
		);

		/*
		 * The catalogue a moment later: the provider published a new listing while the
		 * old cache's five seconds were still running.
		 */
		await act(async () => {
			useModelsStore.setState(withModels([listing("auto-2", "Automatic Two")]));
		});

		assert.deepEqual(
			getModelsForHostingProvider("radient").map((model) => model.id),
			["auto-2"],
			"a listing inside the old cache's window must reach the picker: the cache belongs to the store, not the clock",
		);
	},
);
