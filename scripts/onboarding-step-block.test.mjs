import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * ONBOARDING STEP 2, RENDERED — the hole a review round found in its own test.
 *
 * `default-model-plan.test.mjs` proves the RULE (what is shown, what is written,
 * whether Continue may be pressed). It cannot prove the step USES it: the literal
 * mutants a round-3 review ran — `onBlockReason(block)` turned into
 * `onBlockReason(null)`, and the modal's `disabled={footer.primaryDisabled}` turned
 * back into `disabled={continuing}` — survived every suite in this repository
 * (review round 3 R3-m3). This file renders the step and asserts the two hookups
 * that matter: it reports the block, and what it asks Continue to write is the
 * provider it is SHOWING.
 *
 * jsdom has no layout engine, so "the picker is on screen" here means the
 * component's own contract, not geometry. Pixels live in the committed frames.
 */

const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
});
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// Accessors that refuse to be read out of context; the constructors the
		// components need are plain ones and do not.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
/*
 * Node 22 declares a `localStorage` global that is UNDEFINED without
 * --experimental-webstorage, so the copy loop above skips it (the key exists) and
 * zustand's persist reads an undefined storage.
 */
globalThis.localStorage = bootstrapDOM.window.localStorage;
globalThis.sessionStorage = bootstrapDOM.window.sessionStorage;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

const CENSUS = JSON.parse(
	readFileSync("scripts/fixtures/auth-providers-first-run.json", "utf8"),
).providers;

/** The provider this test walks, and the models the backend serves for it. */
const PROVIDER = "deepseek";
const SERVED = ["deepseek-chat", "deepseek-reasoner"];

/**
 * The census with this provider CONNECTED, which is the state step 2 exists for:
 * `isConnectedRow` reads `has_credential`, and a row without it makes the step say
 * "no provider is connected yet" and assert nothing about the block.
 */
const census = (suggested = null) =>
	CENSUS.map((row) =>
		row.id === PROVIDER
			? { ...row, has_credential: true, suggested_model: suggested }
			: row,
	);

globalThis.window.api = {
	desktop: {
		request: async (request) => {
			const ok = (result) => ({ status: 200, body: { result } });
			switch (request.op) {
				case "capabilities":
					return ok({
						desktop_contract: 1,
						desktop_available: true,
						desktop_auth: "bearer",
						data: { auth: true, config: true, catalogue: false },
					});
				case "providers.list":
					return ok({ providers: census(globalThis.window.__suggested) });
				case "config.get":
					return ok({
						version: 1,
						metadata: {},
						values: { hosting: null, model: null },
					});
				case "config.update":
					globalThis.window.__writes.push(request.value);
					return ok({ version: 2, metadata: {}, values: request.value });
				case "models":
				case "legacy.models":
				case "models.list":
					return ok({
						providers: [
							{
								id: PROVIDER,
								name: "DeepSeek",
								description: "",
								url: "",
								requiredCredentials: [],
							},
						],
						models: SERVED.map((id) => ({
							id,
							name: id,
							provider: PROVIDER,
							owned_by: PROVIDER,
							created: 0,
							info: {
								description: "",
								context_window: 0,
								max_tokens: 0,
								recommended: id === SERVED[1],
								input_price: null,
								output_price: null,
								supports_images: false,
							},
						})),
					});
				default:
					return ok(null);
			}
		},
	},
};
globalThis.window.__writes = [];
/** What `providers.list` reports as the backend's suggestion, per test. */
globalThis.window.__suggested = null;
/*
 * The step's queries sit behind the connectivity gate, whose fallback is a real
 * HEALTH CHECK against the configured origin -- which a jsdom process cannot reach,
 * so every query errored with "Server is offline" before asserting anything. The
 * gate reads this bridge first, and "attached" is a reachable state.
 */
globalThis.window.api.backend = {
	getStatus: async () => ({
		state: "attached",
		url: "http://127.0.0.1:9",
	}),
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { DefaultModelStep } from "./src/renderer/src/features/onboarding/components/steps/default-model-step";
			export { useModelsStore } from "./src/renderer/src/shared/store/models-store";
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
	define: { "import.meta.env": "{}" },
	write: false,
});

const bundlePath = new URL(
	"./_onboarding-step-block.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));

const {
	QueryClient,
	QueryClientProvider,
	createElement,
	DefaultModelStep,
	useModelsStore,
} = await import(bundlePath.href);

/** Seed the catalogue the step reads, in the store's own shapes. */
const seedCatalogue = (ids) => {
	useModelsStore.setState({
		isInitialized: true,
		providers: [
			{
				id: PROVIDER,
				name: "DeepSeek",
				description: "",
				url: "",
				requiredCredentials: [],
			},
		],
		models: ids.map((id) => ({
			id,
			name: id,
			provider: PROVIDER,
			owned_by: PROVIDER,
			created: 0,
			info: {
				description: "",
				context_window: 0,
				max_tokens: 0,
				recommended: id === "deepseek-reasoner",
				input_price: null,
				output_price: null,
				supports_images: false,
			},
		})),
	});
};

const mount = async (t) => {
	const mounted = {
		client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
		blocks: [],
		continues: [],
	};
	t.after(() => {
		try {
			mounted.root?.unmount();
		} finally {
			mounted.container?.remove();
			mounted.client?.clear();
		}
	});
	mounted.container = document.createElement("div");
	document.body.append(mounted.container);
	mounted.root = createRoot(mounted.container);
	await act(async () => {
		mounted.root.render(
			createElement(
				QueryClientProvider,
				{ client: mounted.client },
				createElement(DefaultModelStep, {
					onBlockReason: (reason) => mounted.blocks.push(reason),
					onBeforeContinue: (run) => mounted.continues.push(run),
				}),
			),
		);
	});
	mounted.text = () => mounted.container.textContent ?? "";
	return mounted;
};

const settle = async () => {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 150));
	});
};

/*
 * WHY THIS SUITE ENDS ITSELF.
 *
 * After the tree is unmounted and the query cache cleared, this process still holds
 * a socket and timer handles, so node never exits on its own and the runner reports
 * a PASSING file as a job timeout -- which is exactly what happened to this file and
 * its sibling under `scripts/run-desktop-tests.mjs` ("Promise resolution is still
 * pending", node 22 and 26, review round 4 R4-m4). The exit is explicit and carries
 * the code the run earned, so a failure can never be reported as green.
 */
after(() => process.exit(failures > 0 ? 1 : 0));

let failures = 0;
const trackedTest = (name, body) =>
	test(name, async (t) => {
		try {
			await body(t);
		} catch (error) {
			failures += 1;
			throw error;
		}
	});

trackedTest(
	"step 2 asks Continue for the provider it shows, and prefers the backend's suggestion",
	async (t) => {
		globalThis.window.__writes.length = 0;
		globalThis.window.__suggested = {
			id: "deepseek-reasoner",
			name: "DeepSeek Reasoner",
		};
		seedCatalogue(SERVED);
		const mounted = await mount(t);
		await settle();

		/*
		 * The step keeps the write it hands to Continue: a step that SHOWED DeepSeek and
		 * wrote something else is the defect this rule exists for.
		 */
		const run = mounted.continues.at(-1);
		assert.equal(
			typeof run,
			"function",
			"the step never handed Continue a write, so a rewrite of the shown provider cannot be caught",
		);
		await act(async () => {
			await run();
		});
		assert.deepEqual(
			globalThis.window.__writes,
			[{ hosting: PROVIDER, model_name: "deepseek-reasoner" }],
			"Continue must write the provider the step showed, taking the backend's suggestion",
		);
		globalThis.window.__suggested = null;
	},
);

trackedTest(
	"with no suggestion to take, the step reports the block its footer reads",
	async (t) => {
		seedCatalogue(SERVED);
		const mounted = await mount(t);
		await settle();

		assert.equal(
			mounted.blocks.at(-1),
			"Pick a model to continue.",
			"the step never reported its block, so the footer cannot disable Continue",
		);
	},
);

trackedTest(
	"with a catalogue that lists nothing for the provider the step names that, and does not block",
	async (t) => {
		seedCatalogue([]);
		const mounted = await mount(t);
		await settle();

		assert.equal(
			mounted.blocks.at(-1),
			null,
			"a backend that lists nothing for this provider is not a missing choice to block on",
		);
		assert.match(
			mounted.text(),
			/can't list DeepSeek models yet/,
			"the step must say which provider it could not list",
		);
	},
);

/*
 * The modal's two hookups, pinned by SHAPE rather than by rendering it.
 *
 * Rendering `OnboardingModal` means seeding the onboarding store, the config and a
 * Radix dialog to assert one attribute; these two lines say the same thing and fail
 * when either is reverted, which is the property the review round asked for
 * (R3-m3: `disabled={continuing}` and a step that reports nothing both survived
 * every suite in this repository). It is a shape pin, not an interaction: the
 * rendered half is above, and the frames carry the pixels.
 */
const MODAL =
	"src/renderer/src/features/onboarding/components/onboarding-modal.tsx";
const STEP =
	"src/renderer/src/features/onboarding/components/steps/default-model-step.tsx";

const stripComments = (path) =>
	readFileSync(path, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1");

trackedTest(
	"the modal's Continue is disabled by the block the step reports, not by a spinner",
	() => {
		const modal = stripComments(MODAL);
		assert.match(
			modal,
			/const footer = onboardingFooter\(currentStep, stepBlock, continuing\);/,
			"the footer no longer reads the block the step registered",
		);
		assert.match(
			modal,
			/disabled=\{footer\.primaryDisabled\}/,
			"Continue is disabled by something other than the footer's own decision",
		);
		assert.match(
			modal,
			/onBlockReason=\{registerStepBlock\}/,
			"the step is not wired to the registration its footer reads",
		);
		const step = stripComments(STEP);
		assert.match(
			step,
			/onBlockReason\(block\);/,
			"the step reports something other than the block it computed",
		);
	},
);
