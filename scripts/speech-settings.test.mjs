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
			export { ErrorBoundary } from "./src/renderer/src/shared/components/common/error-boundary";
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

const {
	QueryClient,
	QueryClientProvider,
	createElement,
	SpeechSection,
	ErrorBoundary,
} = await import(bundlePath.href);

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

/**
 * The voice half of the daemon, for the cases about the one speech provider.
 * Off by default, so every case above sees the capabilities it always saw:
 * `on` adds `features.voice`, `status` is what `voice.status` says about the
 * provider (`provider`, `providers`), `edits` records each `settings.edit`, and
 * `editReply` scripts a refusal. A write is what the next status read says.
 */
const voice = {
	on: false,
	/** `features.voice`: 2 is the speech route's level (the backend's own). */
	level: 2,
	status: {},
	edits: [],
	editReply: null,
	gets: 0,
	/** A promise the status read waits on, so a case can look at the loading frame. */
	hold: null,
};
const READY = { ready: true, reason: null };
const NO_KEY = { ready: false, reason: "No ElevenLabs API key is stored." };
const TOO_LOW = {
	ready: false,
	reason:
		"Your Radient credit balance is too low for speech. Add credits in the Radient Console to continue.",
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
						...(voice.on ? { voice: voice.level } : {}),
					},
				});
			case "voice.status":
				voice.gets += 1;
				if (voice.hold) await voice.hold;
				return ok({
					active: null,
					settings: { max_spoken_chars: 800 },
					...voice.status,
				});
			case "settings.edit":
				voice.edits.push(request);
				if (voice.editReply) return voice.editReply;
				voice.status = { ...voice.status, provider: request.value };
				return ok({});
			case "settings.list":
				return ok(registry);
			case "credentials.list":
				return ok({ keys: [] });
			case "tts.paths":
				/*
				 * Two non-success shapes, and they reach the group by different routes: a
				 * 500 is a refusal `desktopResult` throws for, while `malformed` is the one
				 * an unchecked cast lets through — a 200 whose body is not a
				 * `VoicePathResolution` (QA round 1, Q2). The group must say the same
				 * sentence for both and must not render a single availability fact from
				 * either.
				 */
				if (scenario === "unreadable") {
					return {
						status: 500,
						body: {
							detail: "The resolver could not read the credential store.",
						},
					};
				}
				if (scenario === "malformed") {
					return ok({ rungs_typo: [], servable_typo: true });
				}
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
const mount = async (t, scenario, props = {}) => {
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
				createElement(SpeechSection, props),
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

/**
 * Wait until the availability area has SETTLED, then return the rendered text.
 *
 * Waiting on the RENDERED state rather than on the clock, because the arms that
 * fail this way are retried once (`retryDesktopQuery` keeps one retry for a
 * failure that carries a status, which is what a 500 is) and a fixed sleep would
 * be either flaky or slower than the event it waits for. `Speaks through` and
 * the honest sentence are the two settled shapes; anything else is still the
 * in-flight note.
 */
const settleAvailability = async (container) => {
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		const text = container.textContent ?? "";
		if (
			text.includes("Speech availability could not be read.") ||
			text.includes("Speaks through")
		) {
			return text;
		}
		// eslint-disable-next-line no-await-in-loop
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 25));
		});
	}
	return container.textContent ?? "";
};

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

test("the group offers no field that could hold a credential, in any state", async (t) => {
	/*
	 * EVERY SCENARIO, not just the arm the rows render on (agent review round 1,
	 * N1). The rows come from one path, so the gap was theoretical — but a
	 * credential field is the one thing this surface must never grow, and the
	 * assertion costs one mount per state.
	 */
	for (const scenario of [
		"radient-pass",
		"stored-provider-key",
		"nothing",
		"older",
		"unreadable",
		"malformed",
	]) {
		const { container } = await mount(t, scenario);
		assert.equal(
			container.querySelectorAll('input[type="password"]').length,
			0,
			`${scenario}: a password field would be a second home for a provider key`,
		);
		const suspicious = [
			...container.querySelectorAll("input, textarea"),
		].filter((node) => CREDENTIAL_FIELD.test(fieldIdentity(node)));
		assert.deepEqual(
			suspicious.map((node) => node.outerHTML.slice(0, 80)),
			[],
			`${scenario}: providers are signed into through /login <provider>, never through a field here`,
		);
	}
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

/*
 * THE TWO WAYS THE REPORT CAN BE MISSING, and the one thing the group owes a
 * reader for both: the honest sentence, and no availability fact invented in its
 * place. A failed request was always handled; the malformed 200 was not —
 * `desktopResult` casts, so `speechAvailability` mapped `undefined` and the
 * throw took the route with it (QA round 1, Q2).
 */
for (const [scenario, why] of [
	["unreadable", "the request failed"],
	["malformed", "the reply was not this route's shape"],
]) {
	test(`${scenario}: the group says it could not read availability, and claims nothing`, async (t) => {
		const { container, asked } = await mount(t, scenario);
		const text = await settleAvailability(container);
		assert.ok(asked.includes("tts.paths"), `the read was taken (${why})`);
		assert.ok(
			text.includes("Speech availability could not be read."),
			`the reader is told the report is missing rather than shown a guess; rendered: ${text.slice(0, 240)}`,
		);
		for (const claim of ["Speaks through", "Ready", "No provider"]) {
			assert.ok(
				!text.includes(claim),
				`no availability fact is rendered from a payload that was not one: ${claim}`,
			);
		}
		assert.equal(
			container.querySelectorAll("[data-setting-key]").length,
			7,
			"the failure stays local: the seven rows the reader can still edit are rendered",
		);
	});
}

/* ------------------------------------------------------------------ *
 * The panel's way OUT of a crash — the boundary's reset path
 * ------------------------------------------------------------------ */

/*
 * WHY THIS IS TESTED AT THE BOUNDARY RATHER THAN THROUGH THE PANEL (agent review
 * round 2, follow-up b).
 *
 * The panel can no longer be made to throw from data — round 1's Q2 fix validates
 * the payload before anything maps it — so a crash here now means a defect, and
 * the finding was that the panel had no way out of one: a boundary latches, and
 * with a `fallback` NODE there is no button either, because the node form drops
 * `FallbackProps`. What was missing was therefore in the shared component, and
 * that is where this drives it: a throwing child, the real `ErrorBoundary`, and
 * the two halves of the reset — the render fallback's own `resetErrorBoundary`,
 * and `resetKeys` releasing a latch when the input changes.
 *
 * WHAT IS NOT COVERED HERE, stated rather than implied: no throw reaches the
 * shipped panel through the harness, so the section's WIRING of these props is
 * asserted in the source check below instead of by rendering it.
 */
let panelThrows = true;
let panelRenders = 0;
const PanelProbe = ({ shouldThrow = () => panelThrows }) => {
	panelRenders += 1;
	if (shouldThrow()) throw new Error("panel defect");
	return createElement("p", null, "the panel rendered");
};

const mountBoundary = async (t, props) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	t.after(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	});
	const render = (element) =>
		act(async () => {
			root.render(element);
		});
	return { container, render };
};

test("a new answer releases the panel's crash, and the render fallback gets the reset", async (t) => {
	panelThrows = true;
	panelRenders = 0;
	let handed = null;
	const probeFallback = (props) => {
		handed = props;
		return createElement(
			"div",
			null,
			"could not be read",
			"the panel rendered",
		);
	};

	const { container, render } = await mountBoundary(t);
	await render(
		createElement(
			ErrorBoundary,
			{ fallbackRender: probeFallback, resetKeys: [1] },
			createElement(PanelProbe),
		),
	);
	// The latched state, with the panel's own subtree gone.
	assert.ok(
		container.textContent.includes("could not be read"),
		"the fallback rendered for a crashed subtree",
	);
	assert.equal(
		typeof handed?.resetErrorBoundary,
		"function",
		"a render fallback is handed the boundary's own reset, which a node fallback never gets",
	);

	// The fault is gone and a new read has arrived: the reset key moves.
	panelThrows = false;
	await render(
		createElement(
			ErrorBoundary,
			{ fallbackRender: probeFallback, resetKeys: [2] },
			createElement(PanelProbe),
		),
	);
	assert.ok(
		container.textContent.includes("the panel rendered"),
		"a changed reset key releases the latch, so the next answer is rendered instead of the sentence",
	);
	assert.ok(
		!container.textContent.includes("could not be read"),
		"the fallback is gone once the subtree renders again",
	);
});

test("the retry button asks the boundary to reset rather than sitting inert", async (t) => {
	panelThrows = true;
	panelRenders = 0;
	const probeFallback = ({ resetErrorBoundary }) =>
		createElement(
			"button",
			{ type: "button", onClick: resetErrorBoundary },
			"Try again",
		);

	const { container, render } = await mountBoundary(t);
	await render(
		createElement(
			ErrorBoundary,
			{ fallbackRender: probeFallback, resetKeys: [1] },
			createElement(PanelProbe),
		),
	);
	const before = panelRenders;
	await act(async () => {
		container.querySelector("button").click();
	});
	assert.ok(
		panelRenders > before,
		"the press re-rendered the subtree: the button is wired to the reset, not decoration",
	);
	assert.ok(
		container.querySelector("button") !== null,
		"the fault is still there, so the fallback stands — a reset is not a fix",
	);
});

test("a node fallback still renders for the surfaces that only state something", async (t) => {
	panelThrows = true;
	const { container, render } = await mountBoundary(t);
	await render(
		createElement(
			ErrorBoundary,
			{ fallback: createElement("p", null, "something went wrong here") },
			createElement(PanelProbe),
		),
	);
	assert.ok(
		container.textContent.includes("something went wrong here"),
		"the additive props did not change what `fallback` means for the callers that pass a node",
	);
});

const PANEL_FALLBACK_ELEMENT =
	/fallbackRender=\{\s*\(props\) =>\s*<PanelFallback \{\.\.\.props\} \/>\s*\}/;

test("the shipped section wires the panel's reset, which no render can observe", () => {
	const source = readFileSync(
		"src/renderer/src/features/settings/components/speech-section.tsx",
		"utf8",
	);
	assert.match(
		source,
		PANEL_FALLBACK_ELEMENT,
		"render the hook-using PanelFallback as a component and forward the library's reset props",
	);
	assert.match(
		source,
		/resetKeys=\{\[pathsQuery\.dataUpdatedAt\]\}/,
		"the panel's reset key is the availability read itself: a fresh answer has to clear a crash the previous one caused",
	);
});

/* ------------------------------------------------------------------ *
 * What the failed read offers, and what the copy carries
 * ------------------------------------------------------------------ */

/**
 * The sentence a rung's own line carries, read from the rendered list rather
 * than restated here: the assertions below compare what the panel prints above
 * the list with what the list itself says.
 */
const rungReason = (container, name) => {
	const item = [...container.querySelectorAll("li")].find((node) =>
		(node.textContent ?? "").startsWith(name),
	);
	if (!item) return null;
	const spans = [...item.querySelectorAll("span")];
	return (spans[spans.length - 1].textContent ?? "").trim();
};

test("the failed read offers the registry read's own Retry, and the press re-issues the read", async (t) => {
	const { container, asked } = await mount(t, "unreadable");
	const text = await settleAvailability(container);
	assert.ok(
		text.includes("Speech availability could not be read."),
		`the settled arm is a failed read; rendered: ${text.slice(0, 160)}`,
	);

	const before = asked.filter((op) => op === "tts.paths").length;
	const retry = [...container.querySelectorAll("button")].find(
		(node) => node.textContent.trim() === "Retry",
	);
	assert.ok(
		retry,
		"a transient failure must offer a way back: this read is staleTime: Infinity with no focus or reconnect refetch (UX review round 1, U2)",
	);
	await act(async () => {
		retry.click();
	});
	await settleAvailability(container);
	assert.ok(
		asked.filter((op) => op === "tts.paths").length > before,
		"the press re-issued the read rather than only re-rendering the arm",
	);
});

test("the serving rung's sentence is printed once, not also above it", async (t) => {
	for (const [scenario, name] of [
		["radient-pass", "Radient Pass"],
		["stored-provider-key", "ElevenLabs"],
	]) {
		const { container } = await mount(t, scenario);
		const text = await settleAvailability(container);
		const sentence = rungReason(container, name);
		assert.ok(
			sentence,
			`the serving rung's own line rendered (${scenario}); rendered: ${text.slice(0, 200)}`,
		);
		assert.equal(
			text.split(sentence).length - 1,
			1,
			`${scenario}: the resolution's reason IS the serving rung's reason, so rendering both is one sentence twice (design review round 1, D2)`,
		);
	}
});

test("the arm whose resolution sentence is unique still prints it", async (t) => {
	const { container } = await mount(t, "nothing");
	const text = await settleAvailability(container);
	assert.ok(
		text.includes(NOTHING_AVAILABLE_REASON),
		"the de-duplication must not swallow the sentence no rung carries: on this arm it is the daemon's own statement of both remedies",
	);
});

test("the inert note names both remedies, and prints the command bare", async (t) => {
	const { container } = await mount(t, "nothing");
	const text = await settleAvailability(container);
	assert.ok(
		!text.includes("`"),
		"backticks rendered as characters around the route in every frame (design review round 1, D5)",
	);
	assert.ok(
		text.includes("/login radient"),
		"the route stays runnable, in the form the app's other surfaces print it",
	);
	assert.match(
		text,
		/provider key/i,
		"the key route is named too, so a reader who wants no Radient account is not sent only to sign-in (UX review round 1, U3)",
	);
});

test("the serving rung's name carries the stronger ink, and the others the muted one", async (t) => {
	const { container } = await mount(t, "radient-pass");
	await settleAvailability(container);
	const nameOf = (name) =>
		[...container.querySelectorAll("li > span:first-child")].find((node) =>
			(node.textContent ?? "").startsWith(name),
		);
	const serving = nameOf("Radient Pass");
	const other = nameOf("ElevenLabs");
	assert.ok(serving && other, "both rungs rendered their name line");
	assert.ok(
		serving.classList.contains("text-ink") &&
			!serving.classList.contains("text-ink-muted") &&
			other.classList.contains("text-ink-muted"),
		"which rung would serve is a text-weight step, not only the word `not` in the faintest ink (design review round 1, D4)",
	);
});

/* -------------------------------------------------------------------------- */
/* THE ONE SPEECH PROVIDER, and the hands-free switch, in the Speech section    */
/* -------------------------------------------------------------------------- */

const providerBox = (container) =>
	container.querySelector("[data-speech-provider]");
const radio = (container, value) =>
	container.querySelector(`input[type="radio"][value="${value}"]`);
const optionText = (container, value) =>
	container.querySelector(`[data-speech-provider-option="${value}"]`)
		?.textContent ?? "";

/** Voice-on fixtures, restored after the case so no other case sees them. */
const withVoice = async (t, status, run) => {
	voice.on = true;
	voice.status = status;
	voice.edits = [];
	voice.editReply = null;
	voice.gets = 0;
	voice.hold = null;
	t.after(() => {
		voice.on = false;
		voice.level = 2;
		voice.hold = null;
		voice.status = {};
		voice.editReply = null;
		globalThis.window.api.desktop.qwenVoice = undefined;
	});
	return run();
};

test("PROVIDER: two choices, Radient cloud and My ElevenLabs key, neither chosen until the person picks", async (t) => {
	await withVoice(
		t,
		{ provider: null, providers: { radient: READY, elevenlabs: NO_KEY } },
		async () => {
			const { container } = await mount(t, "radient-pass");
			assert.ok(providerBox(container), "the choice is in the Speech section");
			const radios = [
				...providerBox(container).querySelectorAll('input[type="radio"]'),
			];
			assert.deepEqual(
				radios.map((r) => r.value),
				["radient", "elevenlabs"],
			);
			assert.deepEqual(
				radios.map((r) => r.checked),
				[false, false],
			);
			assert.match(optionText(container, "radient"), /Radient cloud/);
			assert.match(
				optionText(container, "radient"),
				/billed to your Radient credit/i,
			);
			assert.match(optionText(container, "elevenlabs"), /My ElevenLabs key/);
			assert.match(
				providerBox(container).textContent,
				/No provider chosen yet/,
			);
			assert.doesNotMatch(
				providerBox(container).textContent,
				/Local|OpenAI|Groq/,
			);
		},
	);
});

test("PROVIDER: the chosen provider is the one voice.status names", async (t) => {
	await withVoice(
		t,
		{
			provider: "elevenlabs",
			providers: { radient: READY, elevenlabs: READY },
		},
		async () => {
			const { container } = await mount(t, "radient-pass");
			assert.equal(radio(container, "elevenlabs").checked, true);
			assert.equal(radio(container, "radient").checked, false);
			assert.doesNotMatch(
				providerBox(container).textContent,
				/No provider chosen yet/,
			);
		},
	);
});

test("PROVIDER: a stored value this app does not know (an old engine word) shows as none chosen and crashes nothing", async (t) => {
	for (const provider of ["byok", "local", "openai", 7]) {
		await withVoice(
			t,
			{ provider, providers: { radient: READY, elevenlabs: READY } },
			async () => {
				const { container } = await mount(t, "radient-pass");
				assert.deepEqual(
					[...providerBox(container).querySelectorAll("input")].map(
						(r) => r.checked,
					),
					[false, false],
					String(provider),
				);
			},
		);
	}
});

test("PROVIDER: each choice says Ready, or the backend's own sentence with a way to set it up", async (t) => {
	const opened = [];
	await withVoice(
		t,
		{
			provider: "radient",
			providers: { radient: TOO_LOW, elevenlabs: NO_KEY },
		},
		async () => {
			const { container } = await mount(t, "radient-pass", {
				onOpenProviders: (provider) => opened.push(provider),
			});
			assert.match(
				optionText(container, "radient"),
				/Your Radient credit balance is too low for speech\. Add credits in the Radient Console to continue\./,
			);
			assert.match(
				optionText(container, "elevenlabs"),
				/No ElevenLabs API key is stored\./,
			);
			assert.doesNotMatch(optionText(container, "radient"), /Ready/);
			const setups = [
				...container.querySelectorAll("[data-speech-provider-setup]"),
			];
			assert.deepEqual(
				setups.map((b) => b.getAttribute("data-speech-provider-setup")),
				["radient", "elevenlabs"],
			);
			assert.match(setups[1].textContent, /Set up in Providers/);
			await act(async () => setups[1].click());
			assert.deepEqual(
				opened,
				["elevenlabs"],
				"the link names the provider it is about",
			);
		},
	);
	await withVoice(
		t,
		{ provider: "radient", providers: { radient: READY, elevenlabs: READY } },
		async () => {
			const { container } = await mount(t, "radient-pass", {
				onOpenProviders: () => {},
			});
			assert.match(optionText(container, "radient"), /Ready/);
			assert.match(optionText(container, "elevenlabs"), /Ready/);
			assert.equal(
				container.querySelectorAll("[data-speech-provider-setup]").length,
				0,
				"nothing to set up",
			);
		},
	);
});

test("PROVIDER: an older backend that sends no readiness shows no verdict and no link, and still lets the person choose", async (t) => {
	await withVoice(t, {}, async () => {
		const { container } = await mount(t, "radient-pass", {
			onOpenProviders: () => {},
		});
		assert.equal(
			container.querySelectorAll("[data-speech-provider-status]").length,
			0,
		);
		assert.equal(
			container.querySelectorAll("[data-speech-provider-setup]").length,
			0,
		);
		// Unknown readiness is not "not ready": nothing is disabled, as before.
		assert.equal(radio(container, "radient").disabled, false);
		assert.equal(radio(container, "elevenlabs").disabled, false);
	});
	await withVoice(t, { provider: "elevenlabs" }, async () => {
		const { container } = await mount(t, "radient-pass");
		assert.equal(radio(container, "elevenlabs").checked, true);
		assert.equal(radio(container, "radient").disabled, false);
		assert.equal(radio(container, "elevenlabs").disabled, false);
	});
});

const settle = async () => {
	for (let turn = 0; turn < 3; turn += 1)
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
};

/** The text of the elements a radio's `aria-describedby` points at. */
const describedBy = (container, value) =>
	(radio(container, value).getAttribute("aria-describedby") ?? "")
		.split(" ")
		.filter(Boolean)
		.map((id) => container.querySelector(`[id="${id}"]`)?.textContent ?? "")
		.join(" ");

test("PROVIDER: a provider that is not ready cannot be chosen, and says why", async (t) => {
	const opened = [];
	await withVoice(
		t,
		{ provider: null, providers: { radient: READY, elevenlabs: NO_KEY } },
		async () => {
			const { container } = await mount(t, "radient-pass", {
				onOpenProviders: (provider) => opened.push(provider),
			});
			// The real disabled state, so assistive technology reports it.
			assert.equal(radio(container, "elevenlabs").disabled, true);
			assert.equal(radio(container, "radient").disabled, false);
			// Its reason is linked to it, not only printed near it.
			assert.match(
				describedBy(container, "elevenlabs"),
				/No ElevenLabs API key is stored\./,
			);
			assert.match(describedBy(container, "radient"), /Ready/);
			await act(async () => radio(container, "elevenlabs").click());
			await settle();
			assert.deepEqual(voice.edits, [], "nothing is written for it");
			assert.equal(radio(container, "elevenlabs").checked, false);
			// The way to fix it is still a live control.
			const setup = container.querySelector(
				'[data-speech-provider-setup="elevenlabs"]',
			);
			assert.ok(setup);
			assert.equal(setup.disabled, false);
			await act(async () => setup.click());
			assert.deepEqual(opened, ["elevenlabs"]);
		},
	);
});

test("PROVIDER: Radient cloud is disabled the same way when Radient is not ready", async (t) => {
	await withVoice(
		t,
		{
			provider: null,
			providers: {
				radient: { ready: false, reason: "Not signed in to Radient." },
				elevenlabs: READY,
			},
		},
		async () => {
			const { container } = await mount(t, "radient-pass", {
				onOpenProviders: () => {},
			});
			assert.equal(radio(container, "radient").disabled, true);
			assert.equal(radio(container, "elevenlabs").disabled, false);
			assert.match(
				describedBy(container, "radient"),
				/Not signed in to Radient\./,
			);
			await act(async () => radio(container, "radient").click());
			await settle();
			assert.deepEqual(voice.edits, []);
			assert.ok(
				container.querySelector('[data-speech-provider-setup="radient"]'),
			);
		},
	);
});

test("PROVIDER: a chosen provider that has become not ready stays chosen, shows why, and the other can be picked", async (t) => {
	await withVoice(
		t,
		{
			provider: "elevenlabs",
			providers: { radient: READY, elevenlabs: NO_KEY },
		},
		async () => {
			const { container } = await mount(t, "radient-pass", {
				onOpenProviders: () => {},
			});
			// The stored value is not touched and is not hidden.
			assert.equal(radio(container, "elevenlabs").checked, true);
			assert.deepEqual(voice.edits, []);
			assert.match(
				optionText(container, "elevenlabs"),
				/No ElevenLabs API key is stored\./,
			);
			assert.ok(
				container.querySelector('[data-speech-provider-setup="elevenlabs"]'),
			);
			assert.equal(radio(container, "radient").disabled, false);
			await act(async () => radio(container, "radient").click());
			await settle();
			assert.deepEqual(voice.edits, [
				{ op: "settings.edit", key: "speech.provider", value: "radient" },
			]);
			assert.equal(radio(container, "radient").checked, true);
		},
	);
});

test("PROVIDER: with neither ready both are disabled, none is chosen, and the line says to set one up in Providers", async (t) => {
	await withVoice(
		t,
		{ provider: null, providers: { radient: TOO_LOW, elevenlabs: NO_KEY } },
		async () => {
			const { container } = await mount(t, "radient-pass", {
				onOpenProviders: () => {},
			});
			assert.deepEqual(
				[...providerBox(container).querySelectorAll("input")].map((r) => [
					r.checked,
					r.disabled,
				]),
				[
					[false, true],
					[false, true],
				],
			);
			const text = providerBox(container).textContent;
			assert.match(
				text,
				/Neither provider is ready yet\. Set one up in Providers/,
			);
			assert.doesNotMatch(text, /No provider chosen yet/);
		},
	);
});

test("PROVIDER: while the status is still loading both are disabled and nothing claims to be Ready", async (t) => {
	let release = () => {};
	await withVoice(
		t,
		{ provider: null, providers: { radient: READY, elevenlabs: READY } },
		async () => {
			voice.hold = new Promise((resolve) => {
				release = resolve;
			});
			const { container } = await mount(t, "radient-pass");
			assert.ok(providerBox(container), "the choice is there while it loads");
			assert.deepEqual(
				[...providerBox(container).querySelectorAll("input")].map(
					(r) => r.disabled,
				),
				[true, true],
			);
			const text = providerBox(container).textContent;
			assert.doesNotMatch(text, /Ready/);
			assert.doesNotMatch(text, /No provider chosen yet/);
			assert.equal(
				container.querySelectorAll("[data-speech-provider-status]").length,
				0,
			);
			release();
			await settle();
			assert.deepEqual(
				[...providerBox(container).querySelectorAll("input")].map(
					(r) => r.disabled,
				),
				[false, false],
			);
			assert.match(providerBox(container).textContent, /Ready/);
		},
	);
	release();
});

test("PROVIDER: choosing writes speech.provider through settings.edit, and the radio follows the read", async (t) => {
	await withVoice(
		t,
		{ provider: null, providers: { radient: READY, elevenlabs: READY } },
		async () => {
			const { container } = await mount(t, "radient-pass");
			const gets = voice.gets;
			await act(async () => radio(container, "elevenlabs").click());
			for (let turn = 0; turn < 3; turn += 1)
				await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
			assert.deepEqual(voice.edits, [
				{ op: "settings.edit", key: "speech.provider", value: "elevenlabs" },
			]);
			assert.ok(
				voice.gets > gets,
				"the status is re-read so main learns the choice",
			);
			assert.equal(radio(container, "elevenlabs").checked, true);
			assert.equal(radio(container, "radient").checked, false);
			// Picking the one already chosen writes nothing.
			await act(async () => radio(container, "elevenlabs").click());
			assert.equal(voice.edits.length, 1);
		},
	);
});

test("PROVIDER: a refused write shows the daemon's sentence and leaves the old choice", async (t) => {
	await withVoice(
		t,
		{ provider: "radient", providers: { radient: READY, elevenlabs: READY } },
		async () => {
			voice.editReply = {
				status: 422,
				body: {
					detail: {
						code: "invalid_setting",
						message: "Not a speech provider.",
					},
				},
			};
			const { container } = await mount(t, "radient-pass");
			await act(async () => radio(container, "elevenlabs").click());
			for (let turn = 0; turn < 3; turn += 1)
				await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
			assert.match(
				providerBox(container).textContent,
				/Not a speech provider\./,
			);
			assert.equal(radio(container, "radient").checked, true);
			assert.equal(radio(container, "elevenlabs").checked, false);
		},
	);
});

test("PROVIDER: it is asked and shown with the hands-free switch OFF, and a backend without voice shows no choice", async (t) => {
	await withVoice(t, { provider: null }, async () => {
		const { container } = await mount(t, "radient-pass");
		assert.ok(providerBox(container));
		assert.equal(voice.gets >= 1, true);
	});
	voice.on = false;
	const { container } = await mount(t, "radient-pass");
	// `ok`, not `equal(…, null)`: a failing equal would print a whole jsdom element.
	assert.ok(providerBox(container) === null, "no features.voice, no choice");
});

test("PROVIDER: a backend on features.voice 1 has no speech route, so it shows no choice", async (t) => {
	await withVoice(t, { provider: null }, async () => {
		voice.level = 1;
		const { container } = await mount(t, "radient-pass");
		assert.ok(providerBox(container) === null, "voice 1 is not enough");
		assert.equal(voice.gets, 0, "and voice.status is not asked");
	});
});

test("SWITCH: the hands-free voice switch lives in the Speech section, with its own words", async (t) => {
	await withVoice(t, { provider: null }, async () => {
		globalThis.window.api.desktop.qwenVoice = {
			getEnabled: async () => false,
			setEnabled: async (on) => on,
			onEnabled: () => () => {},
		};
		const { container } = await mount(t, "radient-pass");
		assert.match(container.textContent, /Session voice/);
		assert.match(
			container.textContent,
			/Lets you talk to a conversation hands-free/,
		);
		const toggle = container.querySelector('[role="switch"]');
		assert.ok(toggle, "the switch itself is in the section");
	});
});

test("SWITCH: it is also there when the section could not load, so voice can still be turned off", async (t) => {
	await withVoice(t, { provider: null }, async () => {
		globalThis.window.api.desktop.qwenVoice = {
			getEnabled: async () => true,
			setEnabled: async (on) => on,
			onEnabled: () => () => {},
		};
		const { container } = await mount(t, "older");
		assert.match(container.textContent, /Session voice/);
	});
});

test("SWITCH: the Appearance section no longer carries the switch or an engine row", () => {
	const page = readFileSync(
		"src/renderer/src/features/settings/components/settings-page.tsx",
		"utf8",
	);
	assert.equal(page.includes("<VoiceSwitchSetting"), false);
	assert.equal(page.includes("VoiceEngineSetting"), false);
	const section = readFileSync(
		"src/renderer/src/features/settings/components/speech-section.tsx",
		"utf8",
	);
	assert.ok(section.includes("<VoiceSwitchSetting"));
	assert.ok(section.includes("<SpeechProviderSetting"));
});
