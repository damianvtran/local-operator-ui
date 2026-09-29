import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act } from "react";

/*
 * THE SPEECH GATES READ THE RADIENT SESSION FIRST, THE LEGACY KEY SECOND
 * (issue #674).
 *
 * The report: a user signed in to Radient Cloud through the settings page gets
 * a permanently disabled mic whose tooltip says "Sign in to Radient in the
 * settings page to enable audio recording" — the state they just left. The
 * gate read `useRadientCredentialProbe()`'s file question alone
 * (`RADIENT_API_KEY` in the legacy `/v1/credentials` list), and a sign-in lands
 * in the backend's auth store instead, which is the store the backend's own
 * speech and transcription routes resolve first (`resolve_radient_credential`).
 *
 * WHAT THIS FILE IS, exactly:
 *
 *   1. THE SHIPPED PROBE, MOUNTED. The real `useRadientCredentialProbe` runs
 *      against a real `QueryClient`, a real DOM and the shipped transport, and
 *      publishes its reading on every render, so the matrix below asserts the
 *      values the four surfaces actually receive rather than a restatement of
 *      the hook. The bridge's envelopes are the backend's own shapes, copied
 *      from `desktop_radient.py`/the settings-account-gate rig.
 *   2. THE SPEAK-ALOUD SURFACE, MOUNTED. `MessageControls` is rendered with the
 *      same bridge, and the speech control's disabled state and reason are read
 *      from the DOM — the exact thing the report says stays off for a
 *      signed-in user.
 *   3. SOURCE PINS for the two surfaces a jsdom mount cannot reach honestly
 *      (a selection toolbar needs a real Range; the canvas editor needs the
 *      canvas context): their enable flags derive from the SHARED capability
 *      and their copy ladders keep both the offline and the sign-in arms. The
 *      composer's own DOM cases live in `credential-composer.test.mjs`, beside
 *      its harness.
 *
 * WHAT THIS IS NOT: proof of layout, of the composer's mic in a browser, or of
 * a real Radient round trip. jsdom has no layout engine; the strings and the
 * disabled bits are what it can see, and those are what the report is about.
 */

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { createRoot } from "react-dom/client";
			import { QueryClientProvider } from "@tanstack/react-query";
			import { useRadientCredentialProbe } from "./src/renderer/src/shared/hooks/use-credentials";
			import { radientUserKeys, useRadientUserQuery } from "./src/renderer/src/shared/hooks/use-radient-user-query";
			import { MessageControls } from "./src/renderer/src/features/chat/components/message-item/message-controls";

			/*
			 * The probe, publishing BOTH readings it combines: the capability the
			 * surfaces enable on, and the account-read class the session tier is
			 * derived from — the second is what lets a case wait for the read to
			 * have ANSWERED rather than for a moment in time.
			 */
			export const Probe = () => {
				const probe = useRadientCredentialProbe();
				const account = useRadientUserQuery();
				globalThis.__speechProbe = {
					hasRadientApiKey: probe.hasRadientApiKey,
					hasRadientSession: probe.hasRadientSession,
					isUnavailable: probe.isUnavailable,
					canUseRadientSpeech: probe.canUseRadientSpeech,
					accountRead: account.accountRead,
				};
				return null;
			};

			export const mountProbe = (container, client) => {
				const root = createRoot(container);
				root.render(
					createElement(
						QueryClientProvider,
						{ client },
						createElement(Probe),
					),
				);
				return root;
			};

			export const mountControls = (container, client) => {
				const root = createRoot(container);
				root.render(
					createElement(
						QueryClientProvider,
						{ client },
						/*
						 * THE PROBE RIDES BESIDE THE CONTROL, on the same client: the
						 * publishing component is how a case waits for the file query to
						 * have SETTLED (answered or failed) before reading the tooltip —
						 * reading the control a tick early shows the loading state's
						 * sentence, which is neither of the two states under test.
						 */
						createElement(Probe),
						createElement(MessageControls, {
							isUser: false,
							content: "The turn this strip belongs to.",
							messageId: "m-speech-gate",
							agentId: "a-speech-gate",
						}),
					),
				);
				return root;
			};

			export { QueryClient } from "@tanstack/react-query";
			export { radientUserKeys };
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
		"@assets": "./src/renderer/src/assets",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	// React, React Query and ReactDOM stay external so the bundle shares ONE copy
	// with this file's own imports; a bundled second copy would give the page a
	// different query client and a second renderer.
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react-dom/client",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	loader: {
		".css": "empty",
		".png": "empty",
		".svg": "empty",
		".jpg": "empty",
		".webp": "empty",
		".woff": "empty",
		".woff2": "empty",
	},
	// `import.meta.env` is the bundler's; without a value `load-config.ts` calls
	// `Object.entries(undefined)` while the graph evaluates.
	define: { "import.meta.env": "globalThis.__RIG_ENV__" },
	jsx: "automatic",
	write: false,
});

const bundlePath = new URL(
	`./_stt-mic-gate-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);

/*
 * The DOM, before the graph is evaluated: the stores persist through
 * `localStorage` at module scope, so a missing document is an import-time
 * throw rather than a render-time one.
 */
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.localStorage = window.localStorage;
globalThis.sessionStorage = window.sessionStorage;
/*
 * `navigator` through `defineProperty`: Node's own is a getter-only property,
 * so an assignment silently fails in CommonJS and throws here in ESM
 * (measured). jsdom's copy reports `onLine: true`, which is the browser state
 * the connectivity gate is written against.
 */
Object.defineProperty(globalThis, "navigator", {
	configurable: true,
	value: window.navigator,
});

/*
 * THE DOM EVENT CLASSES, from the window the document came from.
 *
 * Node has its own `Event`/`CustomEvent` globals, and bundle code that writes
 * `new CustomEvent(...)` resolves THEM — a Node-realm event dispatched on a
 * jsdom node is refused (`parameter 1 is not of type 'Event'`, measured when
 * Radix's tooltip opens and dispatches its `TOOLTIP_OPEN` announcement). The
 * composer rigs carry the same override for the same reason.
 */
for (const key of [
	"Event",
	"CustomEvent",
	"KeyboardEvent",
	"MouseEvent",
	"FocusEvent",
	"InputEvent",
	"ClipboardEvent",
	// The popper's own feature tests read the DOM classes off the GLOBAL too
	// ("Element is not defined" was the measured failure without these).
	"Node",
	"Element",
	"HTMLElement",
	"HTMLTextAreaElement",
	"HTMLInputElement",
	"HTMLButtonElement",
]) {
	if (window[key]) {
		Object.defineProperty(globalThis, key, {
			configurable: true,
			value: window[key],
		});
	}
}

/*
 * What Radix's popper reads while it positions an overlay, and jsdom has
 * neither: the real `getComputedStyle` (radix reads it off the GLOBAL, not off
 * the window) and a `ResizeObserver` whose methods are inert (the composer rigs
 * carry the same pair for the same reason).
 */
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

/*
 * The health endpoint the connectivity gate reads before it will enable any
 * backend query. A server that never answers disables every gated query — the
 * state this rig produced by NOT stubbing this at first: the file probe sat
 * `pending/idle` forever, which the capability reports as `isUnavailable`
 * (offline), so no matrix case could see a key at all.
 */
globalThis.fetch = async (url) => {
	if (String(url).includes("/health")) {
		return {
			ok: true,
			status: 200,
			json: async () => ({
				status: 200,
				message: "OK",
				result: { version: "rig" },
			}),
		};
	}
	throw new Error(`stt-mic-gate rig: unexpected fetch to ${url}`);
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
 * A hidden document: React Query's interval hooks (the connectivity probes, the
 * capabilities watch) pause only when the document is not visible, and a jsdom
 * document reports itself visible with no focus — visible, the file's timers
 * run forever and the process never exits. Counted and cleared anyway, because
 * "paused" is a promise jsdom makes about a value this rig could accidentally
 * change.
 */
Object.defineProperty(window.document, "visibilityState", { value: "hidden" });
Object.defineProperty(window.document, "hidden", { value: true });

const liveTimers = [];
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
const tracked =
	(real) =>
	(...args) => {
		const id = real(...args);
		liveTimers.push(id);
		return id;
	};
globalThis.setTimeout = tracked(realSetTimeout);
globalThis.setInterval = tracked(realSetInterval);
window.setTimeout = tracked(realSetTimeout);
window.setInterval = tracked(realSetInterval);

/** `matchMedia`, which jsdom does not implement; one stable object per query. */
const mediaQueries = new Map();
window.matchMedia = (query) => {
	const key = String(query);
	if (!mediaQueries.has(key)) {
		mediaQueries.set(key, {
			matches: false,
			media: key,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		});
	}
	return mediaQueries.get(key);
};

/*
 * The health read the credentials query's connectivity gate depends on. The
 * gate DISABLES credential queries when the server is offline, and this rig
 * wants the enabled path: a probe that never ran would read as unavailable
 * for the wrong reason and the whole matrix would be vacuous.
 */
globalThis.fetch = async (url) => {
	if (String(url).includes("/health")) {
		return {
			ok: true,
			status: 200,
			json: async () => ({ status: 200, result: { version: "rig" } }),
		};
	}
	return { ok: false, status: 404, json: async () => ({}) };
};

/*
 * The bridge, before the graph is evaluated (the renderer must take the
 * desktop-control path, which is the code that ships).
 */
const SIGNED_IN_ACCOUNT = {
	status: 200,
	body: {
		result: {
			data: {
				msg: "ok",
				result: {
					account: {
						id: "acct_stt_mic_gate",
						tenant_id: "ten_stt_mic_gate",
						email: "mic-gate@example.test",
						name: "Mic Gate",
						role: "owner",
						status: "active",
						created_at: "2026-01-02T03:04:05Z",
						updated_at: "2026-01-02T03:04:05Z",
					},
					identity: {
						email: "mic-gate@example.test",
						provider: "google",
						provider_id: "google-mic-gate",
					},
				},
			},
		},
	},
};

/*
 * The account read's answers, in the backend's own shapes: the success envelope
 * is the `{msg, result}` chain `radientProxy` unwraps, and the signed-out
 * answer is the daemon's own 409 sentence (the class that sets "signed-out",
 * measured at `desktop_radient.py`). "refused" carries the typed code, so it is
 * the credential-refusal class rather than the signed-out one.
 */
const ACCOUNT_ANSWERS = {
	"signed-in": SIGNED_IN_ACCOUNT,
	"signed-out": {
		status: 409,
		body: { detail: "Sign in to Radient to access your account" },
	},
	refused: {
		status: 401,
		body: {
			detail: {
				code: "radient_credential_refused",
				message: "Radient could not complete this operation",
				details: {},
			},
		},
	},
};

/**
 * The per-case bridge state. `null` keys mean "leave the fixture's own answer".
 * `credentialsCalls` counts the file-list reads, which is the instrument for
 * the refetch-on-auth-change case.
 */
const bridge = {
	account: "signed-out",
	keys: [],
	credentialsFail: false,
	credentialsCalls: 0,
};

globalThis.window.api = {
	desktop: {
		request: async (request) => {
			if (request?.op === "capabilities") {
				return {
					status: 200,
					body: {
						result: {
							desktop_available: true,
							features: {
								radient: 1,
								auth: 1,
								commands: 1,
								session_credential: 1,
							},
						},
					},
				};
			}
			if (request?.op === "credentials.list") {
				bridge.credentialsCalls += 1;
				if (bridge.credentialsFail) {
					return {
						status: 503,
						body: { detail: "rig: the server did not answer" },
					};
				}
				return { status: 200, body: { result: { keys: [...bridge.keys] } } };
			}
			if (request?.op === "radient.request") {
				return ACCOUNT_ANSWERS[bridge.account];
			}
			return { status: 503, body: { detail: "not part of this test" } };
		},
	},
};

const { QueryClient, mountControls, mountProbe, radientUserKeys } =
	await import(bundlePath.href);
await unlink(bundlePath);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Flush React and the bridge until `predicate` holds, or fail naming it. */
async function until(predicate, what, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		await act(async () => {
			await new Promise((resolve) => realSetTimeout(resolve, 10));
		});
		const value = predicate();
		if (value) return value;
		if (Date.now() > deadline) {
			throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
		}
	}
}

const roots = [];
const clients = [];
function clientForRig() {
	const client = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: Number.POSITIVE_INFINITY,
				refetchOnWindowFocus: false,
			},
			mutations: { gcTime: Number.POSITIVE_INFINITY },
		},
	});
	clients.push(client);
	return client;
}

function containerForRig() {
	const container = window.document.createElement("div");
	window.document.body.appendChild(container);
	return container;
}

/** Mount the probe rig with `state`, returning the container. */
async function mountProbeRig(state) {
	/*
	 * EVERY FIELD IS ASSIGNED, defaults filled. A case that omits one must not
	 * inherit the previous case's override: the first cut of this rig used
	 * `Object.assign`, and `credentialsFail` stayed true from the dead-probe case
	 * into the refused-sign-in case, which then failed for a state it never set.
	 */
	bridge.account = state.account;
	bridge.keys = state.keys ?? [];
	bridge.credentialsFail = state.credentialsFail ?? false;
	bridge.credentialsCalls = 0;
	const client = clientForRig();
	const container = containerForRig();
	let root;
	await act(async () => {
		root = mountProbe(container, client);
	});
	roots.push(root);
	return { client, container };
}

/** Mount the MessageControls rig with `state`, returning the container. */
async function mountControlsRig(state) {
	bridge.account = state.account;
	bridge.keys = state.keys ?? [];
	bridge.credentialsFail = state.credentialsFail ?? false;
	bridge.credentialsCalls = 0;
	const client = clientForRig();
	const container = containerForRig();
	let root;
	await act(async () => {
		root = mountControls(container, client);
	});
	roots.push(root);
	return { client, container };
}

/*
 * THE TOOLBAR'S SPEECH CONTROL, as the DOM carries it: the disabled bit and the
 * tooltip the reader gets. The tooltip is read by focusing the trigger's span —
 * the path a keyboard user takes — and polling for the panel, bounded so a
 * change that stops it opening fails here instead of hanging.
 */
function speechButton(container) {
	return container.querySelector('button[aria-label="Speak aloud"]');
}

/**
 * Open a tooltip and return the sentence it shows, MATCHED BY NAME.
 *
 * WHY THE EXPECTED TEXT IS MATCHED, not merely `pop()`ped: the primitive keeps
 * a previously opened tooltip's panel mounted while the next one opens, so
 * "the last [role=tooltip]" can be the PREVIOUS case's sentence (measured: the
 * offline case read the previous case's sign-in sentence byte-for-byte). The
 * poll therefore returns the panel whose text is the expected sentence, and
 * fails naming every text it did see when none matches — which is what makes a
 * wrong sentence a readable failure rather than a timeout.
 */
let lastTooltipTrigger = null;
async function openTooltip(trigger, expected) {
	if (lastTooltipTrigger && lastTooltipTrigger !== trigger) {
		const previous = lastTooltipTrigger;
		await act(async () => {
			previous.dispatchEvent(
				new window.FocusEvent("focusout", { bubbles: true }),
			);
		});
	}
	lastTooltipTrigger = trigger;
	const seen = new Set();
	for (let attempt = 0; attempt < 80; attempt += 1) {
		await act(async () => {
			trigger.dispatchEvent(
				new window.FocusEvent("focusin", { bubbles: true, cancelable: true }),
			);
		});
		for (const panel of window.document.querySelectorAll('[role="tooltip"]')) {
			const text = (panel.textContent ?? "").trim();
			seen.add(text);
			if (text === expected) return text;
		}
		await act(async () => {
			await new Promise((resolve) => realSetTimeout(resolve, 50));
		});
	}
	throw new Error(
		`no tooltip read "${expected}"; sentences seen: ${JSON.stringify([...seen])}`,
	);
}

test("an OAuth session alone satisfies the speech capability, with no key listed", async () => {
	await mountProbeRig({ account: "signed-in", keys: [] });
	const probe = await until(
		() => globalThis.__speechProbe,
		"the probe to publish a reading",
	);
	await until(
		() => globalThis.__speechProbe.accountRead === "ready",
		"the account read to answer",
	);
	assert.equal(
		globalThis.__speechProbe.hasRadientSession,
		true,
		"the signed-in account read is the session tier",
	);
	assert.equal(
		globalThis.__speechProbe.hasRadientApiKey,
		false,
		"and the file lists no key at all — the session alone is the difference",
	);
	assert.equal(
		globalThis.__speechProbe.canUseRadientSpeech,
		true,
		"a signed-in user's speech capability is ON (issue #674)",
	);
	assert.equal(
		globalThis.__speechProbe.isUnavailable,
		false,
		"nothing is offline about this state",
	);
	assert.ok(probe, "the probe reading is the mounted hook's own");
});

test("a legacy key alone still satisfies the capability when no session is stored", async () => {
	await mountProbeRig({ account: "signed-out", keys: ["RADIENT_API_KEY"] });
	/*
	 * THE CONDITION IS THE FILE READ ITSELF, not a sibling query's answer: the
	 * account read can settle a tick before the file list lands, and reading the
	 * probe in between is reading a render that was never the state under test
	 * (measured while writing this file).
	 */
	await until(
		() => globalThis.__speechProbe?.hasRadientApiKey === true,
		"the file probe to answer with the key listed",
	);
	assert.equal(globalThis.__speechProbe.hasRadientSession, false);
	assert.equal(globalThis.__speechProbe.hasRadientApiKey, true);
	assert.equal(
		globalThis.__speechProbe.canUseRadientSpeech,
		true,
		"the key-only install is unchanged: the file tier still enables speech",
	);
});

test("neither a session nor a key is the disabled state, and it is not the offline one", async () => {
	await mountProbeRig({ account: "signed-out", keys: [] });
	// The file probe ANSWERED (an empty list is an answer, not a failure): wait
	// for that settlement rather than for a sibling query's timing.
	await until(
		() => globalThis.__speechProbe?.isUnavailable === false,
		"the file probe to settle with an answer",
	);
	assert.equal(
		globalThis.__speechProbe.canUseRadientSpeech,
		false,
		"no session and no key means speech stays off",
	);
	assert.equal(
		globalThis.__speechProbe.isUnavailable,
		false,
		"and it is the not-signed-in state, not the offline one — the two have different copy",
	);
});

test("a dead probe is the offline state, and it keeps speech off", async () => {
	await mountProbeRig({
		account: "signed-out",
		keys: [],
		credentialsFail: true,
	});
	await until(
		() => globalThis.__speechProbe?.isUnavailable === true,
		"the file probe to fail",
	);
	assert.equal(
		globalThis.__speechProbe.canUseRadientSpeech,
		false,
		"a probe that could not ask cannot enable the control",
	);
});

test("a refused sign-in does not enable speech: the remedy is the sign-in copy", async () => {
	await mountProbeRig({ account: "refused", keys: [] });
	await until(
		() => globalThis.__speechProbe?.accountRead === "refused",
		"the account read to answer refused",
	);
	assert.equal(globalThis.__speechProbe.hasRadientSession, false);
	assert.equal(
		globalThis.__speechProbe.canUseRadientSpeech,
		false,
		"a refused credential is not a live session",
	);
});

test("signing in flips the capability without a remount, and re-asks the file list", async () => {
	const { client } = await mountProbeRig({ account: "signed-out", keys: [] });
	await until(
		() => globalThis.__speechProbe?.accountRead === "signed-out",
		"the account read to answer signed-out",
	);
	assert.equal(globalThis.__speechProbe.canUseRadientSpeech, false);
	const readsBefore = bridge.credentialsCalls;

	/*
	 * THE SIGN-IN FUNNEL'S OWN EVENT: every surface that completes a Radient
	 * sign-in invalidates the account read (`provider-detail.tsx`'s
	 * `commissionAccountRead`, reached by the grid, the connect dialog, onboarding
	 * and the account section), so the flip below is driven the way the app drives
	 * it rather than by writing the cache.
	 */
	bridge.account = "signed-in";
	await act(async () => {
		await client.invalidateQueries({ queryKey: radientUserKeys.all });
	});
	await until(
		() => globalThis.__speechProbe?.canUseRadientSpeech === true,
		"the capability to flip on the re-read",
	);
	assert.equal(
		globalThis.__speechProbe.hasRadientSession,
		true,
		"a signed-in user's mic enables without a reload",
	);
	assert.equal(
		bridge.credentialsCalls,
		readsBefore + 1,
		"and the file probe re-asked once behind the auth change (the refresh-on-auth-change contract)",
	);
});

test("the speak-aloud control is enabled for a signed-in user with no key listed", async () => {
	const { container } = await mountControlsRig({
		account: "signed-in",
		keys: [],
	});
	const button = await until(
		() => speechButton(container),
		"the speech control to render",
	);
	await until(
		() => !speechButton(container).hasAttribute("disabled"),
		"the control to become enabled",
	);
	assert.equal(button.hasAttribute("disabled"), false);
});

test("and the sign-in sentence is owed only to a machine that is not signed in", async () => {
	const { container } = await mountControlsRig({
		account: "signed-out",
		keys: [],
	});
	await until(
		() =>
			globalThis.__speechProbe?.accountRead === "signed-out" &&
			globalThis.__speechProbe?.isUnavailable === false,
		"the reads to settle signed-out with the file probe answered",
	);
	assert.equal(
		speechButton(container).hasAttribute("disabled"),
		true,
		"no session and no key leaves the control off",
	);
	/*
	 * The reason is read from the tooltip the disabled control actually shows:
	 * the span wrapper is the trigger precisely because a disabled button
	 * swallows its own pointer events, so the reader must still be told why.
	 * The call itself is the assertion — a machine with no sign-in is the state
	 * this sentence is FOR, and the helper fails naming what it saw otherwise.
	 */
	await openTooltip(
		speechButton(container).parentElement,
		"Sign in to Radient in the settings page to enable text to speech",
	);
});

test("the offline sentence replaces the sign-in one when the probe cannot ask", async () => {
	const { container } = await mountControlsRig({
		account: "signed-out",
		keys: [],
		credentialsFail: true,
	});
	await until(
		() => globalThis.__speechProbe?.isUnavailable === true,
		"the file probe to fail",
	);
	assert.equal(speechButton(container).hasAttribute("disabled"), true);
	/*
	 * The call is the assertion: sending someone to fix an account that is not
	 * broken is the worse mistake, and the helper fails naming the sentences it
	 * did see when the offline one never arrives.
	 */
	await openTooltip(
		speechButton(container).parentElement,
		"Text to speech is unavailable while Local Operator is offline",
	);
});

/*
 * THE SOURCE PINS. The two surfaces a jsdom mount cannot reach honestly, plus
 * the guard that no surface drifts back to the file-only gate: each enable flag
 * must derive from the shared capability, and each copy ladder must keep the
 * offline arm beside the sign-in arm.
 */
const SOURCES = {
	"the composer mic":
		"src/renderer/src/features/chat/components/message-input.tsx",
	"the speak-aloud control":
		"src/renderer/src/features/chat/components/message-item/message-controls.tsx",
	"the selection toolbar":
		"src/renderer/src/shared/components/common/text-selection-controls.tsx",
	"the canvas editor mic":
		"src/renderer/src/features/chat/components/canvas/inline-edit.tsx",
};

/*
 * One top-level literal per pattern: `scripts/` is inside the script-lint gate
 * (`scripts/check-scripts-lint.mjs` runs biome over the files a change touches),
 * and biome's `useTopLevelRegex` refuses a literal it cannot see once.
 */
const CAPABILITY_FLAG = /canUseRadientSpeech/;
const FILE_ONLY_GATE =
	/= hasRadientApiKey && !isUnavailable|isRadientApiKeyConfigured && !isLoadingCredentials/;
const OFFLINE_SENTENCE = /unavailable while Local Operator is offline/;
const SIGN_IN_SENTENCE =
	/Sign in to Radient in the settings page to enable (audio recording|text to speech)/;

test("every speech surface derives its gate from the shared capability", async () => {
	for (const [name, path] of Object.entries(SOURCES)) {
		const source = await readFile(path, "utf8");
		assert.match(
			source,
			CAPABILITY_FLAG,
			`${name} must read the shared session-first capability`,
		);
		assert.doesNotMatch(
			source,
			FILE_ONLY_GATE,
			`${name} must not keep a file-only gate of its own`,
		);
	}
});

test("every speech surface keeps both the offline and the sign-in sentences", async () => {
	for (const [name, path] of Object.entries(SOURCES)) {
		const source = await readFile(path, "utf8");
		assert.match(
			source,
			OFFLINE_SENTENCE,
			`${name} must name the offline case rather than folding it into the sign-in sentence`,
		);
		assert.match(
			source,
			SIGN_IN_SENTENCE,
			`${name} keeps the sign-in sentence for a reader who is not signed in`,
		);
	}
});

test("teardown", async () => {
	for (const root of roots) {
		await act(async () => {
			root?.unmount();
		});
	}
	for (const client of clients) {
		client.clear();
	}
	for (const id of liveTimers) {
		clearTimeout(id);
		clearInterval(id);
	}
	dom.window.close();
});
