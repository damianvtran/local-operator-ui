import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE SPEECH SETTINGS GROUP, rendered from the shipped component against the
 * daemon's own wire shapes.
 *
 * WHY THIS RENDERS RATHER THAN ASSERTING A DECISION. Three of this surface's
 * claims are about what a READER MEETS, not about a value a function returns:
 * the seven rows are the daemon's registry rows and nothing else (it offers no
 * credential field of any kind), the availability panel names the rung that
 * would serve and every rung that would not, and the reminder that points at
 * `/login radient` appears on the arm where nothing can speak — and only there.
 * A reader on a machine with a stored provider key and no Radient account hears
 * perfect speech, so a "sign in" notice on that arm would be the copy defect
 * this file exists to catch; it is availability, not the account, that decides.
 *
 * WHAT IT CANNOT CLAIM. jsdom has no layout engine, so "the panel is on screen"
 * is the component's own contract — rendered, and no ancestor `hidden` — never
 * geometry. Pixels live in the story frames and the geometry rig, and this wave
 * captured no frames (the host was under memory pressure).
 *
 * The harness is this repository's committed one for a rendered surface
 * (`scripts/backend-settings-collapse.test.mjs`): esbuild bundles the shipped
 * component against the renderer's own aliases, and the DOM is jsdom with a real
 * `react-dom/client` root.
 */

const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	/*
	 * A real origin, because the stores this subtree reads persist through
	 * `localStorage`: an opaque origin (the default with no `url`) has none, and
	 * a consumer that writes through it dies with "Cannot read properties of
	 * undefined (reading 'setItem')" in a passive effect rather than at an
	 * assertion.
	 */
	url: "http://localhost/",
});
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
		// ones the components need are plain constructors and do not.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
// Promoted explicitly rather than by the loop above: they exist only on a window
// with an origin, and the loop skipped them while the URL was absent.
globalThis.localStorage = bootstrapDOM.window.localStorage;
globalThis.sessionStorage = bootstrapDOM.window.sessionStorage;
// React's own flag for a test environment, so `act` is not merely advisory
// (`speech-controls.test.mjs` sets it for the same reason).
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

/*
 * The bridge has to exist before the module graph is evaluated: without
 * `window.api.desktop` the renderer takes its browser-dev HTTP branch, which is
 * not the code that ships.
 */
globalThis.window.api = {
	backend: {
		getStatus: async () => ({ state: "attached", url: "http://127.0.0.1:9/" }),
	},
	desktop: { request: async () => ({ status: 200, body: { result: {} } }) },
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { SpeechSection } from "./src/renderer/src/features/settings/components/speech-section";
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
	/*
	 * The renderer's `import.meta.env`. This bundle did not need it until the group
	 * pulled in the credential probe, whose module graph reaches the app's config
	 * loader; that loader does `Object.entries(import.meta.env)` at MODULE SCOPE,
	 * and `import.meta.env` is Vite's own and undefined under esbuild — so without
	 * this the harness dies at import with "Failed to load configuration" before
	 * a single test is registered (the same trap `ask-options.test.mjs` and
	 * `backend-error-surfaces.test.mjs` document).
	 */
	define: { "import.meta.env": "{}" },
	// React stays external so the bundle shares ONE copy with this file's own
	// imports: two copies give the component a different dispatcher than the one
	// `act` drives.
	external: [
		"react",
		"react-dom",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	packages: "external",
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
});

// Written to a real file rather than imported as a data: URL: modules resolved
// from a data: URL have no base path for the renderer's aliases.
const bundlePath = new URL("./_speech-settings.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));

const { QueryClient, QueryClientProvider, createElement, SpeechSection } =
	await import(bundlePath.href);

/** The committed `/v1/settings` projection: the daemon's own registry rows. */
const registry = JSON.parse(
	readFileSync("scripts/fixtures/backend-settings-registry.json", "utf8"),
);

const RADIENT = "provider_tts_radient";
const ELEVENLABS = "provider_tts_elevenlabs";
const OPENAI = "provider_tts_openai";

/** The daemon's own sentences, so a rendered line can be matched exactly. */
const NOTHING_AVAILABLE_REASON =
	"No text-to-speech provider is available: sign in to Radient, or store an ElevenLabs or OpenAI API key.";

const resolutionFor = (scenario) => {
	if (scenario === "radient-pass") {
		return {
			path: RADIENT,
			reason: "Signed in to Radient.",
			servable: true,
			rungs: [
				{ path: RADIENT, available: true, reason: "Signed in to Radient." },
				{
					path: ELEVENLABS,
					available: false,
					reason: "No ElevenLabs API key is stored.",
				},
				{
					path: OPENAI,
					available: false,
					reason: "No OpenAI API key is stored.",
				},
			],
		};
	}
	if (scenario === "stored-provider-key") {
		return {
			path: ELEVENLABS,
			reason: "An ElevenLabs API key is stored.",
			servable: true,
			rungs: [
				{
					path: RADIENT,
					available: false,
					reason: "Not signed in to Radient.",
				},
				{
					path: ELEVENLABS,
					available: true,
					reason: "An ElevenLabs API key is stored.",
				},
				{
					path: OPENAI,
					available: false,
					reason: "No OpenAI API key is stored.",
				},
			],
		};
	}
	return {
		path: "none",
		reason: NOTHING_AVAILABLE_REASON,
		servable: false,
		rungs: [
			{ path: RADIENT, available: false, reason: "Not signed in to Radient." },
			{
				path: ELEVENLABS,
				available: false,
				reason: "No ElevenLabs API key is stored.",
			},
			{
				path: OPENAI,
				available: false,
				reason: "No OpenAI API key is stored.",
			},
		],
	};
};

/** Every op the group issues, answered the way the daemon answers it. */
const installBridge = (scenario, asked) => {
	globalThis.window.api.desktop.request = async (request) => {
		asked.push(request.op);
		const ok = (result) => ({
			status: 200,
			body: { status: 200, message: "ok", result },
		});
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: {
						settings: 1,
						auth: 1,
						radient: 1,
						// `tts` is the gate this surface sits behind; the `older` scenario
						// withholds it, which is what a daemon predating voicing does.
						...(scenario === "older" ? {} : { tts: 1 }),
					},
				});
			case "settings.list":
				return ok(registry);
			case "credentials.list":
				return ok({ keys: [] });
			case "tts.paths":
				return ok(resolutionFor(scenario));
			case "radient.request":
				/*
				 * The account read. `radient-pass` is the only scenario with an account:
				 * the BYO arm is deliberately signed out and still served, which is the
				 * state the reminder must NOT fire on. The refusal carries the daemon's
				 * own no-credential CODE, which is what classifies "signed out" rather
				 * than "an outage".
				 */
				if (scenario === "radient-pass") {
					return ok({
						data: {
							msg: "ok",
							result: {
								account: {
									id: "acct_test",
									tenant_id: "ten_test",
									email: "speech@example.test",
									name: "Test",
									role: "owner",
									status: "active",
								},
								identity: {
									email: "speech@example.test",
									provider: "google",
									provider_id: "google-test",
								},
							},
						},
					});
				}
				return {
					status: 409,
					body: {
						detail: {
							code: "radient_no_credential",
							message: "Sign in to Radient to use this.",
						},
					},
				};
			default:
				return {
					status: 404,
					body: { detail: { code: "not_implemented", message: request.op } },
				};
		}
	};
};

/**
 * Mount the group against one scenario, and let every read settle.
 *
 * Teardown is armed FIRST, on the test, before anything this function creates
 * exists — `backend-settings-collapse.test.mjs` measured the failure mode that
 * teaches: a mounted tree left standing keeps the event loop open, so a broken
 * handler presents as a five-minute hang with no summary rather than as a red
 * test. The cache is cleared from a `finally` for the same reason.
 */
const mount = async (t, scenario) => {
	const mounted = {};
	t.after(async () => {
		await act(async () => {
			try {
				mounted.root?.unmount();
			} finally {
				mounted.client?.clear();
			}
		});
		mounted.container?.remove();
	});

	const asked = [];
	installBridge(scenario, asked);

	mounted.client = new QueryClient({
		defaultOptions: {
			/*
			 * `gcTime` INSIDE `queries`, which is where query-core reads it: with a
			 * default per-query cache time of five minutes the GC timer that each
			 * query arms on unmount holds the Node event loop open long after the
			 * last assertion — measured here as a five-minute tail with a green
			 * summary, which in CI is a lane that looks hung rather than passing.
			 */
			queries: { retry: false, gcTime: 0 },
		},
	});
	mounted.container = document.createElement("div");
	document.body.appendChild(mounted.container);
	mounted.root = createRoot(mounted.container);
	await act(async () => {
		mounted.root.render(
			createElement(
				QueryClientProvider,
				{ client: mounted.client },
				createElement(SpeechSection, {}),
			),
		);
	});
	// Every read is a stubbed promise; two macrotask turns let the queries
	// settle and the tree re-render.
	for (let turn = 0; turn < 3; turn += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
	return { container: mounted.container, asked };
};

/**
 * The words that would make a field a credential entry, and the field's own
 * identity to test them against.
 *
 * A top-level constant rather than a literal in the filter, because the rule is
 * one rule: a `useTopLevelRegex` warning is the lint telling us so.
 */
const CREDENTIAL_FIELD = /api[\s-_]?key|secret|token/i;

const fieldIdentity = (node) =>
	[
		node.getAttribute("id"),
		node.getAttribute("name"),
		node.getAttribute("aria-label"),
		node.getAttribute("placeholder"),
		node.getAttribute("data-setting-key"),
	]
		.filter(Boolean)
		.join(" ");

const rowKeys = (container) =>
	[...container.querySelectorAll("[data-setting-key]")].map((node) =>
		node.getAttribute("data-setting-key"),
	);

test("the group renders the daemon's seven voicing rows and nothing else", async (t) => {
	const { container } = await mount(t, "radient-pass");
	assert.deepEqual(
		rowKeys(container),
		[
			"speech.voice.gender",
			"speech.voice.tone",
			"speech.voice.expressiveness",
			"speech.voice.pace",
			"speech.voice.language",
			"speech.voice.accent",
			"speech.voice.instructions",
		],
		"the group's rows are the registry's voicing keys, in the registry's order",
	);
});

test("the group offers no field that could hold a credential", async (t) => {
	const { container } = await mount(t, "nothing");
	assert.equal(
		container.querySelectorAll('input[type="password"]').length,
		0,
		"a password field would be a second home for a provider key",
	);
	const suspicious = [...container.querySelectorAll("input, textarea")].filter(
		(node) => CREDENTIAL_FIELD.test(fieldIdentity(node)),
	);
	assert.deepEqual(
		suspicious.map((node) => node.outerHTML.slice(0, 80)),
		[],
		"providers are signed into through /login <provider>, never through a field here",
	);
});

test("the availability panel names the serving rung and every rung's reason", async (t) => {
	const { container } = await mount(t, "radient-pass");
	const text = container.textContent ?? "";
	assert.ok(
		text.includes("Radient Pass"),
		"the serving rung is named in the reader's words",
	);
	assert.ok(
		text.includes("Signed in to Radient."),
		"the daemon's own reason is rendered verbatim",
	);
	for (const reason of [
		"No ElevenLabs API key is stored.",
		"No OpenAI API key is stored.",
	]) {
		assert.ok(text.includes(reason), `the unlit rung says why: ${reason}`);
	}
});

test("a stored provider key serves a signed-out account, and raises no reminder", async (t) => {
	const { container, asked } = await mount(t, "stored-provider-key");
	const text = container.textContent ?? "";
	assert.ok(
		asked.includes("tts.paths"),
		"the availability read is what the panel is built from",
	);
	assert.ok(
		text.includes("An ElevenLabs API key is stored."),
		"the cascade is servable, so the panel says so",
	);
	assert.ok(
		!text.includes("/login radient"),
		"the reminder is driven by availability, not by the account: this machine can speak",
	);
});

test("nothing available: the daemon's reason, and the route that fixes it", async (t) => {
	const { container } = await mount(t, "nothing");
	const text = container.textContent ?? "";
	assert.ok(
		text.includes(NOTHING_AVAILABLE_REASON),
		"the resolver's sentence is rendered rather than restated",
	);
	assert.ok(
		text.includes("/login radient"),
		"the remedy names the runnable route",
	);
});

test("a backend that does not serve voicing is never asked for the report", async (t) => {
	const { container, asked } = await mount(t, "older");
	assert.ok(
		!asked.includes("tts.paths"),
		"a daemon that does not advertise `tts` must not be asked for the route",
	);
	assert.ok(
		(container.textContent ?? "").includes("Update the backend"),
		"the version gap is stated, with its remedy",
	);
});
