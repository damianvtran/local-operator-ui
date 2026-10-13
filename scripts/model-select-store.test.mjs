import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { after, test } from "node:test";
import { build, stop } from "esbuild";
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
 * Modern Node already exposes Event/CustomEvent. The copy loop above keeps
 * those Node constructors, but Radix dispatches its global CustomEvent on the
 * jsdom document: mixing realms throws before the popup can be exercised.
 * Pin actual DOM constructors before importing react-dom or renderer code.
 */
globalThis.Event = bootstrapDOM.window.Event;
globalThis.CustomEvent = bootstrapDOM.window.CustomEvent;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/*
 * Match connectivity-banner-notice.test.mjs: Node's navigator getter has no
 * browser onLine value, but the connectivity hook reads that exact property.
 * Use the actual jsdom navigator (synthetic online state), not an API mock or
 * a suppressed query error. Restore Node's descriptor when this host exits.
 */
const previousNavigator = Object.getOwnPropertyDescriptor(
	globalThis,
	"navigator",
);
Object.defineProperty(globalThis, "navigator", {
	value: bootstrapDOM.window.navigator,
	configurable: true,
});
after(() => {
	if (previousNavigator)
		Object.defineProperty(globalThis, "navigator", previousNavigator);
	else Reflect.deleteProperty(globalThis, "navigator");
});
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
// Some data helpers use the global fetch rather than window.fetch. Both must
// stay synthetic so delayed transport completions cannot fake a locale repaint.
globalThis.fetch = bootstrapDOM.window.fetch;
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

// The negative-control invocation removes only the model's subscription from
// the real source. The mounted repaint assertion must then fail, proving the
// harness is not passing because another store happened to trigger a render.
const localeNegativeControl =
	process.env.I18N_TEST_DISABLE_MODEL_SUBSCRIPTION === "1";
const staleCopyNegativeControl =
	process.env.I18N_TEST_FREEZE_MODEL_COPY === "1";

// esbuild's native compiler service is an owned subprocess, not native UI
// evidence. Stop it even when a component assertion fails; the allocation's
// exact-PID observer remains the final backstop for its process lineage.
after(() => stop());

const bundle = await build({
	plugins:
		localeNegativeControl || staleCopyNegativeControl
			? [
					{
						name: "i18n-model-subscription-negative-control",
						setup(builder) {
							builder.onLoad({ filter: /model-select\.tsx$/ }, async (args) => {
								let contents = await readFile(args.path, "utf8");
								if (localeNegativeControl)
									contents = contents.replaceAll("useI18nLocale();", "");
								if (staleCopyNegativeControl) {
									// Restore only the old copy cache, not data fetching or the
									// locale hook. Label repaint alone must not hide stale options.
									const start = contents.indexOf(
										"const modelOptions: ModelOption[] = (() => {",
									);
									const end = contents.indexOf("\n\t})();", start);
									assert.ok(start >= 0 && end > start);
									contents = [
										contents.slice(0, start),
										contents
											.slice(start, end)
											.replace("= (() => {", "= useMemo(() => {"),
										"\n\t}, [availableModels, hostingId, value, allowCustom, allowDefault]);",
										contents.slice(end + "\n\t})();".length),
									].join("");
								}
								return {
									contents,
									loader: "tsx",
									resolveDir: dirname(args.path),
								};
							});
						},
					},
				]
			: [],
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { ModelSelect } from "./src/renderer/src/shared/components/hosting/model-select";
			export { useModelsStore } from "./src/renderer/src/shared/store/models-store";
			export { getModelsForHostingProvider } from "./src/renderer/src/shared/components/hosting/hosting-model-manifest";
			export { setLocale, registerCatalogue, clearRegisteredCatalogues } from "./src/i18n";
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
	setLocale,
	registerCatalogue,
	clearRegisteredCatalogues,
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
						onSave: async () => undefined,
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
						onSave: async () => undefined,
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

run(
	"a mounted model picker repaints labels and cached option copy on locale change",
	async (t) => {
		setLocale("en");
		const realFetch = useModelsStore.getState().fetchModels;
		useModelsStore.setState({
			models: [],
			providers: [],
			isInitialized: true,
			fetchModels: async () => undefined,
		});
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		t.after(async () => {
			await act(async () => root.unmount());
			container.remove();
			queryClient.clear();
			clearRegisteredCatalogues();
			setLocale("en");
			useModelsStore.setState({ fetchModels: realFetch });
		});
		await act(async () => {
			root.render(
				createElement(
					QueryClientProvider,
					{ client: queryClient },
					createElement(ModelSelect, {
						hostingId: "radient",
						value: "",
						allowDefault: true,
						onSave: async () => undefined,
					}),
				),
			);
		});
		// Query notifications are scheduled outside the initial commit. Let those
		// settle before the only state transition under test: the locale change.
		await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
		assert.ok(container.textContent.includes("Model"));
		assert.equal(container.querySelector('[role="combobox"]').value, "Default");
		// Synthetic fixture strings exercise repaint only; this is not a native
		// French translation or audit. The component stays mounted throughout.
		registerCatalogue("fr", {
			"ui.common.models.model_select.model": "Fixture model label",
			"ui.common.models.default": "Fixture inherited option",
		});
		await act(async () => setLocale("fr"));
		assert.ok(
			container.textContent.includes("Fixture model label"),
			container.textContent,
		);
		assert.equal(
			container.querySelector('[role="combobox"]').value,
			"Fixture inherited option",
		);
	},
);

run(
	"canonical model IDs remain displayable and searchable without saving",
	async (t) => {
		const canonical = "gpt-6.1-sol";
		const pretty = "GPT 6.1 Sol";
		const saves = [];
		const realFetch = useModelsStore.getState().fetchModels;
		useModelsStore.setState({ fetchModels: async () => undefined });
		t.after(() => useModelsStore.setState({ fetchModels: realFetch }));

		// jsdom has no layout observer. This shim admits the real popup's DOM;
		// it is not browser geometry, a screenshot, or native application proof.
		const scrollCalls = [];
		const originalScroll = Object.getOwnPropertyDescriptor(
			window.Element.prototype,
			"scrollIntoView",
		);
		// The real active-row effect requires this method; jsdom has no layout.
		// Reuse backend-settings-collapse.test.mjs's shim, recording calls rather
		// than claiming scrolling geometry or changing any list/filter state.
		window.Element.prototype.scrollIntoView = function (options) {
			scrollCalls.push({ tag: this.tagName, text: this.textContent, options });
		};
		t.after(() => {
			if (originalScroll)
				Object.defineProperty(
					window.Element.prototype,
					"scrollIntoView",
					originalScroll,
				);
			else Reflect.deleteProperty(window.Element.prototype, "scrollIntoView");
		});
		const previousObserver = globalThis.ResizeObserver;
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
		t.after(() => {
			globalThis.ResizeObserver = previousObserver;
		});

		const row = (id, name = pretty, provider = "openai") => ({
			id,
			name,
			provider,
			info: {
				id,
				name,
				description: "Synthetic native catalogue row",
				recommended: false,
			},
		});
		const render = async (
			hostingId,
			value,
			rows,
			inspect,
			knownProvider = true,
		) => {
			useModelsStore.setState({
				isInitialized: true,
				providers: knownProvider
					? [
							{
								id: hostingId,
								name: hostingId,
								description: "Synthetic provider",
								url: "https://synthetic.invalid",
								requiredCredentials: [],
							},
						]
					: [],
				models: rows,
			});
			const container = document.createElement("div");
			document.body.append(container);
			const root = createRoot(container);
			try {
				await act(async () => {
					root.render(
						createElement(
							QueryClientProvider,
							{ client: queryClient },
							createElement(ModelSelect, {
								hostingId,
								value,
								allowDefault: false,
								onSave: async (id) => saves.push(id),
							}),
						),
					);
				});
				const input = container.querySelector('input[role="combobox"]');
				assert.ok(
					input,
					"the actual ModelSelect must mount before any product assertion",
				);
				return await inspect(input);
			} finally {
				await act(async () => root.unmount());
				container.remove();
				queryClient.clear();
			}
		};

		// Collect both discriminators before failing, so the first defect cannot
		// hide the second. Exact/foreign/custom controls must pass independently.
		const display = await render(
			"openai",
			`openai/${canonical}`,
			[row(canonical)],
			async (input) => input.value,
		);
		const exact = await render(
			"openai",
			canonical,
			[row(canonical)],
			async (input) => input.value,
		);
		assert.equal(
			exact,
			pretty,
			"an exact canonical catalogue ID is a known model",
		);
		const exactPrefixed = await render(
			"openai",
			`openai/${canonical}`,
			[
				row(canonical),
				row(`openai/${canonical}`, "Exact prefixed catalogue row"),
			],
			async (input) => input.value,
		);
		assert.equal(
			exactPrefixed,
			"Exact prefixed catalogue row",
			"exact ID wins over outer-prefix equivalence",
		);
		const foreign = await render(
			"openrouter",
			`openai/${canonical}`,
			[row(canonical, pretty, "openrouter")],
			async (input) => input.value,
		);
		assert.equal(
			foreign,
			`openai/${canonical}`,
			"a foreign upstream prefix must never be stripped",
		);
		const nested = await render(
			"openrouter",
			`openai/${canonical}`,
			[row(`openai/${canonical}`, pretty, "openrouter")],
			async (input) => input.value,
		);
		assert.equal(
			nested,
			pretty,
			"a nested upstream ID remains intact when the catalogue knows it",
		);
		const unknown = await render(
			"openai",
			"openai/synthetic-not-listed",
			[row(canonical)],
			async (input) => input.value,
		);
		assert.equal(
			unknown,
			"openai/synthetic-not-listed",
			"genuinely unknown custom values remain raw",
		);
		const unknownHosting = await render(
			"synthetic-host",
			`synthetic-host/${canonical}`,
			[row(canonical, pretty, "synthetic-host")],
			async (input) => input.value,
			false,
		);
		assert.equal(
			unknownHosting,
			`synthetic-host/${canonical}`,
			"a hosting ID absent from the provider catalogue must not authorize prefix matching",
		);

		// Preserve observations before opening the popup: a host setup failure
		// there must not hide the already measured display/identity controls.
		console.log("MODEL_SELECT_DISPLAY_CONTROLS", {
			display,
			exact,
			exactPrefixed,
			foreign,
			nested,
			unknown,
			saves,
			u1DisplayMatchesKnownRow: display === pretty,
			syntheticOnline: navigator.onLine,
		});

		const search = await render(
			"openai",
			"",
			[row(canonical)],
			async (input) => {
				await act(async () => input.focus());
				const actualOptions = () => [
					...document.querySelectorAll('[role="option"]'),
				];
				assert.ok(
					actualOptions().some(
						(option) =>
							option.dataset.comboboxRow !== "typed" &&
							option.textContent.includes(pretty),
					),
					"setup: the actual popup must expose its genuine pretty-name row before filtering",
				);
				const setter = Object.getOwnPropertyDescriptor(
					window.HTMLInputElement.prototype,
					"value",
				).set;
				const type = async (text) => {
					await act(async () => {
						setter.call(input, text);
						input.dispatchEvent(new window.Event("input", { bubbles: true }));
					});
					assert.equal(
						input.value,
						text,
						"setup: the controlled input must reflect the typed query",
					);
				};
				// A no-match query proves filtering really consumed the event, not just
				// a physical input.value assignment leaving the old options on screen.
				await type("synthetic-unlisted-query");
				assert.ok(
					actualOptions().some(
						(option) =>
							option.dataset.comboboxRow === "typed" &&
							option.textContent.includes("synthetic-unlisted-query"),
					),
					"setup: the real query state must produce its typed-value fallback",
				);
				assert.ok(
					!actualOptions().some(
						(option) =>
							option.dataset.comboboxRow !== "typed" &&
							option.textContent.includes(pretty),
					),
					"setup: no-match filtering must hide the real row",
				);
				await type(canonical);
				assert.equal(
					input.getAttribute("aria-expanded"),
					"true",
					"the real combobox must be open",
				);
				const options = actualOptions();
				for (const option of options.filter(
					(item) => item.dataset.comboboxRow === "typed",
				)) {
					assert.ok(
						option.textContent.includes(canonical),
						"setup: raw-ID query must replace the previous typed-row state",
					);
				}
				const raw = {
					known: options.some(
						(option) =>
							option.dataset.comboboxRow !== "typed" &&
							option.textContent.includes(pretty),
					),
					custom: options.some(
						(option) => option.dataset.comboboxRow === "typed",
					),
					text: options.map((option) => option.textContent),
				};
				await type(`openai/${canonical}`);
				assert.ok(
					actualOptions().some(
						(option) =>
							option.dataset.comboboxRow !== "typed" &&
							option.textContent.includes(pretty),
					),
					"the current hosting's authorized selector is searchable",
				);
				assert.ok(
					!actualOptions().some(
						(option) => option.dataset.comboboxRow === "typed",
					),
					"an authorized selector is not offered as an invented custom ID",
				);
				return raw;
			},
		);
		const collision = await render(
			"openai",
			"",
			[
				row(canonical),
				row(`openai/${canonical}`, "Exact prefixed catalogue row"),
			],
			async (input) => {
				await act(async () => input.focus());
				const setter = Object.getOwnPropertyDescriptor(
					window.HTMLInputElement.prototype,
					"value",
				).set;
				await act(async () => {
					setter.call(input, `openai/${canonical}`);
					input.dispatchEvent(new window.Event("input", { bubbles: true }));
				});
				return [...document.querySelectorAll('[role="option"]')]
					.filter((option) => option.dataset.comboboxRow !== "typed")
					.map((option) => option.textContent);
			},
		);
		assert.ok(
			collision.some((text) => text.includes("Exact prefixed catalogue row")),
			"an exact canonical ID remains searchable when a presentation selector collides",
		);
		assert.ok(
			!collision.some((text) => text.includes(pretty)),
			"presentation-equivalent keywords must not shadow another row's exact canonical ID",
		);
		assert.deepEqual(
			saves,
			[],
			"normalizing display or filtering must not invoke onSave",
		);
		console.log("MODEL_SELECT_U1_U2_ACTUAL", {
			display,
			search,
			saves,
			scrollCalls,
		});
		assert.deepEqual(
			{ display, knownRawId: search.known, customRawId: search.custom },
			{
				display: pretty,
				knownRawId: true,
				customRawId: false,
			},
			"known hosting-prefix display and canonical raw-ID search must use the real row",
		);
	},
);
