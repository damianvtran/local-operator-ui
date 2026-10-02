/**
 * The Speak control's states, its press, and the action rows' hover reveal.
 *
 * WHAT THIS FILE IS, exactly:
 *
 *   1. THE STATES, MOUNTED. `AnswerActionRow` is rendered against a fixture
 *      probe and the REAL speech store, and the button's accessible name and
 *      disabled bit are read from the DOM: resting, loading, playing and the
 *      disabled-with-a-reason arm (whose sentence is read the way a keyboard
 *      reader gets it - by focusing the trigger and reading the tooltip, the
 *      `stt-mic-gate-session.test.mjs` path).
 *   2. THE PRESS, THROUGH THE SHIPPED CHAIN. The relay seam is stubbed
 *      (`window.api.desktop.media`, the exact call `desktop-api.ts` makes
 *      first), so a press is exercised end to end - control, store, request -
 *      and the request object is asserted: the text that is sent is the text
 *      the reader saw, and a clip sends the clipped text.
 *   3. THE DISCLOSURES. A clip raises "Reading the first N characters"; a
 *      refused relay raises the error toast AND leaves the row unpinned and
 *      the button out of its loading state, because a failed press must never
 *      look like nothing happened.
 *   4. THE REVEAL. The row fades at rest (opacity-only, so nothing moves), is
 *      revealed by hover or focus, stays visible on touch, and is PINNED
 *      visible while a state it owns (loading, playing, copied) is live.
 *   5. THE GLYPH. The copy controls the operator named wear the
 *      overlapping-squares `Copy` - asserted in the rendered DOM and pinned in
 *      the two sources - and `ClipboardCopy` survives only where it
 *      distinguishes the plain-text variant from the rich one
 *      (`text-selection-controls.tsx`).
 *
 * WHAT THIS FILE DOES NOT PROVE: pixels (the frames are the design round's),
 * or a real decode (the `Audio` element is a fake; the E2E playback capture is
 * scheduled for the QA round and is NOT claimed here).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/*
 * THE DOM, BEFORE THE GRAPH IS EVALUATED.
 *
 * Radix captures `canUseDOM`-style flags at MODULE SCOPE (`useIsomorphicLayoutEffect`
 * is chosen once, at evaluation), so a bundle imported with no `document` in the
 * global scope gets NO-OP layout effects for the rest of the process - measured
 * here: the tooltip's open state flipped (`data-state="instant-open"`) and its
 * portal never mounted, in every mount, for the file's whole life. The bootstrap
 * document is the pattern `stt-mic-gate-session.test.mjs` carries for the same
 * reason; each `mount()` below still swaps in its own fresh document.
 */
const bootstrap = new JSDOM("<!doctype html>", { url: "http://localhost/" });
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
globalThis.HTMLElement = bootstrap.window.HTMLElement;
globalThis.Node = bootstrap.window.Node;
Object.defineProperty(globalThis, "navigator", {
	configurable: true,
	value: bootstrap.window.navigator,
});
globalThis.getComputedStyle = bootstrap.window.getComputedStyle.bind(
	bootstrap.window,
);
for (const name of [
	"Event",
	"CustomEvent",
	"MouseEvent",
	"KeyboardEvent",
	"FocusEvent",
	"PointerEvent",
	"Element",
	"HTMLButtonElement",
	"HTMLAnchorElement",
	"NodeFilter",
	"MutationObserver",
]) {
	if (bootstrap.window[name]) globalThis[name] = bootstrap.window[name];
}

const ROW_SOURCE = readFileSync(
	"src/renderer/src/features/chat/canonical/message-actions-row.tsx",
	"utf8",
);
const LINK_SOURCE = readFileSync(
	"src/renderer/src/features/chat/canonical/link-toolkit.tsx",
	"utf8",
);

/*
 * Regexes at the top level: this tree charges literals built inside functions
 * to the lint budget (`useTopLevelRegex`), and `pnpm lint:scripts` holds
 * `scripts/` to it.
 */
const CLIPBOARD_COPY = /ClipboardCopy/;
const COPY_RENDER = /<Copy[\s/>]/;
const LUCIDE_COPY = /lucide-copy( |$)/;
const CLIPBOARD_GLYPH = /clipboard/;

const bundle = await build({
	stdin: {
		contents: `
			export {
				AnswerActionRow,
				ROW_ARRIVAL_RECENT_MS,
			} from "./src/renderer/src/features/chat/canonical/message-actions-row";
			export {
				ANSWER_ACTIONS_LABEL,
				USER_ACTIONS_LABEL,
				COPY_FEEDBACK_MS,
			} from "./src/renderer/src/features/chat/canonical/message-actions";
			export { SPEECH_MAX_CHARS } from "@shared/lib/speech-clip";
			export {
				SPEECH_FAILURE_COPY,
				SPEECH_PLAYBACK_COPY,
			} from "@shared/lib/speech-errors";
			export { useSpeechStore, messageSpeechKey } from "@shared/store/speech-store";
			export { SpeakButton } from "@shared/components/common/speak-control";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	mainFields: ["module", "main"],
	conditions: ["import"],
	external: [
		"react",
		"react/jsx-runtime",
		"react-dom",
		"react-dom/server",
		"@tanstack/react-query",
	],
	plugins: [
		{
			name: "speech-fixtures",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-credentials/ },
					() => ({ path: "probe", namespace: "fixture" }),
				);
				builder.onResolve({ filter: /@shared\/utils\/toast-manager/ }, () => ({
					path: "toast",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => {
					if (args.path === "probe") {
						return {
							loader: "js",
							contents: `
								export const useRadientCredentialProbe = () => ({
									canUseRadientSpeech: globalThis.__speechConfigured === true,
									speechBlock: globalThis.__speechBlock ?? "sign-in",
								});
							`,
						};
					}
					return {
						loader: "js",
						contents: `
							const channel = () => (globalThis.__speechToasts ??= { errors: [], infos: [] });
							export const showErrorToast = (message) => { channel().errors.push(message); return "toast"; };
							export const showInfoToast = (message) => { channel().infos.push(message); return "toast"; };
							export const showSuccessToast = (message) => { channel().infos.push(message); return "toast"; };
							export const showWarningToast = (message) => { channel().infos.push(message); return "toast"; };
							export const dismissToast = () => {};
							export const resetToastDedup = () => {};
						`,
					};
				});
			},
		},
	],
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45998" };',
	},
	loader: { ".css": "empty", ".png": "empty" },
	jsx: "automatic",
});

const bundlePath = new URL(
	`./_speech-controls-${process.pid}.mjs`,
	import.meta.url,
);
const { writeFile, unlink } = await import("node:fs/promises");
await writeFile(bundlePath, bundle.outputFiles[0].text);
const mod = await import(bundlePath.href);
await unlink(bundlePath);

/* ------------------------------------------------------------- the fakes */

/** Every fake audio element this file created, in construction order. */
const fakeAudios = [];
class FakeAudio {
	constructor(src) {
		this.src = src;
		this.played = false;
		this.paused = false;
		this.onended = null;
		this.onerror = null;
		fakeAudios.push(this);
	}
	play() {
		this.played = true;
		return Promise.resolve();
	}
	pause() {
		this.paused = true;
	}
}
globalThis.Audio = FakeAudio;

const urls = { created: [], revoked: [] };
URL.createObjectURL = () => {
	const url = `blob:test/${urls.created.length}`;
	urls.created.push(url);
	return url;
};
URL.revokeObjectURL = (url) => {
	urls.revoked.push(url);
};

const state = () => mod.useSpeechStore.getState();
const toasts = () => globalThis.__speechToasts;
const requests = () => globalThis.__speechRequests;

const resetStore = () => {
	state().stopSpeech();
	mod.useSpeechStore.setState({
		audioCache: new Map(),
		heardKeys: new Set(),
		loadingKey: null,
		playingKey: null,
		error: null,
		audioElement: null,
		currentUrl: null,
		generation: 0,
	});
	fakeAudios.length = 0;
	urls.created.length = 0;
	urls.revoked.length = 0;
	globalThis.__speechToasts = { errors: [], infos: [] };
	globalThis.__speechRequests = [];
};

/* ------------------------------------------------------------- the mount */

const mount = async ({
	speechConfigured = true,
	block = "sign-in",
	relay = "ok",
	role = "answer",
	bodyText = "Four were late, and the oldest is 41 days behind.",
	reveal = null,
	hoverMatch = null,
	activeElementProbe = null,
	control = null,
} = {}) => {
	resetStore();
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: dom.window.navigator,
	});
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.Node = dom.window.Node;
	/*
	 * `getComputedStyle` and `ResizeObserver` are what Radix's popper reads
	 * while it positions an overlay, and it reads them off the GLOBAL: jsdom
	 * has neither there, and without them the tooltip's CONTENT fails to mount
	 * when the trigger opens (measured: the open fired, the panel never
	 * appeared). `stt-mic-gate-session.test.mjs` carries the same pair for the
	 * same reason.
	 */
	globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	globalThis.requestAnimationFrame = (callback) =>
		setTimeout(() => callback(0), 0);
	globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
	globalThis.matchMedia = (query) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
		dispatchEvent: () => false,
	});
	for (const name of [
		"Event",
		"CustomEvent",
		"MouseEvent",
		"KeyboardEvent",
		"FocusEvent",
		"PointerEvent",
		"Element",
		"HTMLButtonElement",
		"HTMLAnchorElement",
		"NodeFilter",
		"MutationObserver",
	]) {
		if (dom.window[name]) globalThis[name] = dom.window[name];
	}

	globalThis.__speechConfigured = speechConfigured === true;
	globalThis.__speechBlock = block;
	/*
	 * The `:hover` seam for the arrival reveal's silencing arm (design review
	 * round 2, D6): jsdom's matcher answers `false` for `:hover` no matter what
	 * is on screen (measured), so a case that needs "the pointer rests HERE"
	 * hands in a predicate over elements and the patched matcher consults it
	 * for `:hover` only. The limitation is the instrument's and is named in the
	 * cases that use it: this exercises the WALK the row performs, not a real
	 * pointer.
	 */
	globalThis.__speechHoverMatch = hoverMatch;
	const originalMatches = dom.window.Element.prototype.matches;
	dom.window.Element.prototype.matches = function (selector) {
		if (selector === ":hover" && globalThis.__speechHoverMatch) {
			return globalThis.__speechHoverMatch(this) === true;
		}
		return originalMatches.call(this, selector);
	};
	/*
	 * The focus seam for the same guard's other arm (agent review round 3,
	 * NIT-2): the row reads `ownerDocument.activeElement`, and jsdom only ever
	 * reports a really-focused node - so a case that needs "focus rests HERE"
	 * answers through this probe. Like the hover seam, it exercises the READ
	 * the row performs, not a real tab.
	 */
	if (activeElementProbe) {
		Object.defineProperty(dom.window.document, "activeElement", {
			configurable: true,
			get() {
				return activeElementProbe(dom.window.document) ?? null;
			},
		});
	}

	/*
	 * The relay seam `desktop-api.ts` reads FIRST (`window.api?.desktop?.media`):
	 * the app's own call, so the recorder observes the request the product
	 * really sends - the speech-auth guard's complaint about reaching around a
	 * surface cannot apply to the surface's own door.
	 */
	dom.window.api = {
		desktop: {
			media: async (request) => {
				requests().push(request);
				if (relay === "fail") {
					return {
						status: 503,
						kind: "error",
						detail: "Speech is temporarily unavailable.",
					};
				}
				if (relay === "raw") {
					return {
						status: 502,
						kind: "error",
						detail:
							"Speech generation failed upstream: Upstream responded 503 with no body.",
					};
				}
				if (relay === "gated") {
					/*
					 * A fetch that stays on the wire until the case releases it
					 * (`globalThis.__speechGateRelease()`), the shape a cancel-then-repress
					 * race needs: everything before the release is the in-flight window.
					 */
					return new Promise((resolve) => {
						globalThis.__speechGateRelease = () =>
							resolve({
								kind: "bytes",
								mimeType: "audio/mpeg",
								data: new Uint8Array([1]),
							});
					});
				}
				return {
					kind: "bytes",
					mimeType: "audio/mpeg",
					data: new Uint8Array([1]),
				};
			},
		},
	};

	const written = [];
	Object.defineProperty(dom.window.navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: async (text) => {
				written.push(text);
			},
		},
	});

	const { createRoot } = await import("react-dom/client");
	const root = createRoot(dom.window.document.getElementById("root"));
	await act(async () => {
		root.render(
			control
				? React.createElement(mod.SpeakButton, { control })
				: /*
					 * The row mounts inside the two ancestors every REAL row has - the
					 * record's own container (the reveal's `group`) inside the transcript
					 * pane - because the silencing rule is a fact about that boundary
					 * (UX round 2, U-r2-1) and a bare row cannot tell the two apart.
					 */
					React.createElement(
						"div",
						{ "data-testid": "pane" },
						React.createElement(
							"div",
							{ className: "group", "data-testid": "turn" },
							React.createElement(mod.AnswerActionRow, {
								bodyText,
								kind: role,
								agentId: role === "user" ? undefined : "c1",
								speechId: role === "user" ? undefined : "a1",
								revealId: reveal?.id,
								revealAt: reveal?.at,
							}),
						),
					),
		);
	});

	const marker =
		role === "user" ? "[data-lo-user-actions]" : "[data-lo-answer-actions]";
	const row = () => dom.window.document.querySelector(marker);
	const button = (label) =>
		dom.window.document.querySelector(
			`${marker} button[aria-label="${label}"]`,
		);
	const flush = async () => {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	};
	const click = async (target) => {
		await act(async () => {
			target.dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true }),
			);
		});
	};
	const press = async (label) => {
		await click(button(label));
		await flush();
	};
	const unmount = async () => {
		await act(async () => {
			root.unmount();
		});
		dom.window.document.body.innerHTML = "";
	};
	return { dom, row, button, press, click, flush, written, unmount };
};

/* The reveal's class tokens, asserted by name rather than by substring. */
const REVEAL_TOKENS = [
	"opacity-0",
	"pointer-events-none",
	"group-hover:opacity-100",
	"group-hover:pointer-events-auto",
	"group-focus-within:opacity-100",
	"group-focus-within:pointer-events-auto",
	"[@media(hover:none)]:opacity-100",
	"[@media(hover:none)]:pointer-events-auto",
	"transition-opacity",
];

/* ------------------------------------------- 1. the states, mounted */

test("the row fades at rest, with the reveal and the touch rule in its classes", async () => {
	const { row, button, unmount } = await mount({ speechConfigured: false });
	const rowEl = row();
	assert.equal(rowEl.getAttribute("role"), "toolbar");
	assert.equal(rowEl.getAttribute("aria-label"), mod.ANSWER_ACTIONS_LABEL);
	for (const className of REVEAL_TOKENS) {
		assert.ok(
			rowEl.classList.contains(className),
			`the resting row must carry ${className}`,
		);
	}
	assert.ok(button("Speak aloud"), "the control is present, just faded");
	assert.equal(
		button("Speak aloud").disabled,
		true,
		"a probe that cannot answer disables the press",
	);
	await unmount();
});

test("loading and playing pin the row visible, and a loading press cancels (U2)", async () => {
	const { dom, button, press, row, unmount } = await mount();
	await act(async () => {
		mod.useSpeechStore.setState({ loadingKey: mod.messageSpeechKey("a1") });
	});
	assert.ok(
		button("Loading speech. Press again to cancel."),
		"the loading state names itself and its cancel",
	);
	assert.equal(
		button("Loading speech. Press again to cancel.").disabled,
		false,
		"and stays pressable: the same control takes the fetch back (UX round 1, U2)",
	);
	assert.equal(
		row().classList.contains("opacity-0"),
		false,
		"a loading press pins the row",
	);
	/*
	 * C3: the tooltip and the accessible name are ONE sentence on the loading
	 * rung now. The panel is opened the way a reader opens it - focus on the
	 * trigger - and read from the rendered `role="tooltip"` node, the same
	 * instrument the disabled-reason case below uses.
	 */
	const loadingTrigger = button(
		"Loading speech. Press again to cancel.",
	).parentElement;
	let loadingTooltip = null;
	const loadingTooltips = new Set();
	for (
		let attempt = 0;
		attempt < 200 && loadingTooltip === null;
		attempt += 1
	) {
		loadingTrigger.dispatchEvent(
			new dom.window.FocusEvent("focusin", { bubbles: true, cancelable: true }),
		);
		// eslint-disable-next-line no-await-in-loop
		await new Promise((resolve) => setTimeout(resolve, 100));
		for (const panel of dom.window.document.querySelectorAll(
			'[role="tooltip"]',
		)) {
			const text = (panel.textContent ?? "").trim();
			loadingTooltips.add(text);
			if (text === "Loading speech. Press again to cancel.")
				loadingTooltip = panel;
		}
	}
	assert.ok(
		loadingTooltip,
		`the loading tooltip must read "Loading speech. Press again to cancel."; saw ${JSON.stringify([...loadingTooltips])}`,
	);

	await press("Loading speech. Press again to cancel.");
	assert.equal(
		mod.useSpeechStore.getState().loadingKey,
		null,
		"the second press cancelled the pending fetch",
	);
	assert.ok(button("Speak aloud"), "and the control is back at rest");

	await act(async () => {
		mod.useSpeechStore.setState({
			playingKey: mod.messageSpeechKey("a1"),
			loadingKey: null,
		});
	});
	assert.ok(button("Stop"), "playing is the Stop control");
	assert.equal(row().classList.contains("opacity-0"), false);

	await press("Stop");
	assert.ok(button("Speak aloud"), "stopping returns the resting control");
	assert.equal(
		row().classList.contains("opacity-0"),
		true,
		"and the row goes back to its resting fade",
	);
	await unmount();
});

test("copied pins the row, and the resting glyph is Copy", async () => {
	const { row, button, press, written, unmount } = await mount();
	const glyph =
		button("Copy").querySelector("svg")?.getAttribute("class") ?? "";
	assert.match(glyph, LUCIDE_COPY, "the copy control wears Copy");
	assert.doesNotMatch(glyph, CLIPBOARD_GLYPH, "not ClipboardCopy");
	await press("Copy");
	assert.deepEqual(written, [
		"Four were late, and the oldest is 41 days behind.",
	]);
	assert.ok(button("Copied"), "the label is the press's own answer");
	assert.equal(
		row().classList.contains("opacity-0"),
		false,
		"a copied tick pins the row",
	);
	await unmount();
});

/* --------------------------------------- 2. the press, shipped chain */

test("a configured service arms Speak, and the press reaches the relay with the visible text", async () => {
	const { button, press, unmount } = await mount();
	const speak = button("Speak aloud");
	assert.equal(speak.disabled, false, "a configured probe enables the press");
	await press("Speak aloud");
	/*
	 * THE AGENT-LESS ROUTE, because this harness mounts the row with a
	 * conversation and NO catalogue binding - the ordinary shape of a
	 * conversation the reader opened himself (`@shared/lib/speech-target`). The
	 * press used to carry the pane identity as an `agentId`, which the daemon's
	 * registry cannot resolve; the bound-conversation arm, and the same press
	 * reaching the agent route, is pinned in `scripts/message-actions.test.mjs`.
	 */
	assert.deepEqual(
		requests(),
		[
			{
				op: "speech.create",
				request: {
					input: "Four were late, and the oldest is 41 days behind.",
				},
			},
		],
		"one relay call, carrying the text the reader saw",
	);
	assert.ok(button("Stop"), "and the control is now the Stop control");
	await unmount();
});

test("an over-cap answer is clipped at a sentence end, disclosed, and sent as the clip", async () => {
	const sentence = "The quick brown fox jumps over the lazy dog. ";
	const long = sentence.repeat(250);
	const windowText = long.slice(0, mod.SPEECH_MAX_CHARS);
	const expected = windowText.slice(0, windowText.lastIndexOf(".") + 1);
	const { press, unmount } = await mount({ bodyText: long });
	await press("Speak aloud");
	assert.deepEqual(
		requests(),
		[
			{
				op: "speech.create",
				request: { input: expected },
			},
		],
		"the request carries the clipped text, not the full answer",
	);
	assert.deepEqual(
		toasts().infos,
		[
			`Reading the first ${expected.length.toLocaleString("en-US")} characters. The rest is not read aloud.`,
		],
		"the clip is disclosed once, with the count localised (copy round 1, C2; the remainder clause states the fact, copy round 2, C1)",
	);
	const fetchesBeforeReplay = requests().length;
	await press("Stop");
	await press("Replay speech");
	assert.equal(
		toasts().infos.length,
		1,
		"a replay does not re-disclose a clip already shown (copy round 1, C7)",
	);
	assert.equal(
		requests().length,
		fetchesBeforeReplay,
		"and the replay is a cache hit, not a second billed call",
	);
	await unmount();
});

test("an unmapped upstream diagnostic is mapped for the reader, detail to the console (U3/C5)", async () => {
	const { press, unmount } = await mount({ relay: "raw" });
	const logged = [];
	const original = console.error;
	console.error = (...args) => {
		logged.push(args.join(" "));
	};
	try {
		await press("Speak aloud");
	} finally {
		console.error = original;
	}
	assert.deepEqual(
		toasts().errors,
		[mod.SPEECH_FAILURE_COPY],
		"a support diagnostic never reads as copy",
	);
	assert.ok(
		logged.some((line) => line.includes("Upstream responded 503")),
		"the raw detail goes to the console",
	);
	await unmount();
});

test("a playback failure raises the error toast through the same channel (C1)", async () => {
	const { button, press, unmount } = await mount();
	await press("Speak aloud");
	assert.ok(button("Stop"), "the press is playing before the failure");
	const element = fakeAudios.at(-1);
	const original = console.error;
	console.error = () => {};
	try {
		await act(async () => {
			element.onerror();
		});
	} finally {
		console.error = original;
	}
	assert.deepEqual(
		toasts().errors,
		[mod.SPEECH_PLAYBACK_COPY],
		"a fetched-then-unplayable press must not look like nothing happened",
	);
	assert.ok(
		button("Replay speech"),
		"and the control returns to rest - the audio is cached, so the rest is Replay speech",
	);
	await unmount();
});

test("a cancel then re-press joins the same paid fetch; landed-but-unheard audio still reads Speak aloud (agent MINOR-1, UX U-r2-3)", async () => {
	const gated = await mount({ relay: "gated" });
	await gated.press("Speak aloud");
	assert.equal(requests().length, 1, "the first press is on the wire");
	await gated.press("Loading speech. Press again to cancel.");
	assert.equal(
		state().loadingKey,
		null,
		"the cancel returns the control to rest immediately (U2)",
	);
	await gated.press("Speak aloud");
	assert.equal(
		requests().length,
		1,
		"the re-press joined the in-flight fetch: no second billed synthesis (agent MINOR-1)",
	);
	await act(async () => {
		globalThis.__speechGateRelease();
	});
	await gated.flush();
	await gated.flush();
	assert.equal(
		requests().length,
		1,
		"still one request once the join resolves",
	);
	assert.ok(
		gated.button("Stop"),
		"and the joined response plays for the newer press",
	);
	await gated.press("Stop");
	assert.ok(
		gated.button("Replay speech"),
		"having played, the resting control offers a replay",
	);
	await gated.unmount();

	const cancelled = await mount({ relay: "gated" });
	await cancelled.press("Speak aloud");
	await cancelled.press("Loading speech. Press again to cancel.");
	await act(async () => {
		globalThis.__speechGateRelease();
	});
	await cancelled.flush();
	await cancelled.flush();
	assert.equal(
		state().audioCache.has(mod.messageSpeechKey("a1")),
		true,
		"the cancelled press's response still lands and caches: it was paid for",
	);
	assert.equal(
		state().heardKeys.has(mod.messageSpeechKey("a1")),
		false,
		"and the reader never heard it",
	);
	assert.ok(
		cancelled.button("Speak aloud"),
		"so the control still offers Speak aloud - never a Replay of audio that never played (U-r2-3)",
	);
	await cancelled.press("Speak aloud");
	assert.equal(
		requests().length,
		1,
		"and pressing it plays the cached response without a new request",
	);
	assert.ok(cancelled.button("Stop"));
	await cancelled.unmount();
});

/* ------------------------------------------------ 3. the disclosures */

test("a refused relay surfaces the error toast and leaves no press looking live", async () => {
	const { row, button, press, unmount } = await mount({ relay: "fail" });
	await press("Speak aloud");
	assert.deepEqual(
		toasts().errors,
		["Speech is temporarily unavailable."],
		"the relay's own sentence reaches the reader",
	);
	assert.equal(state().loadingKey, null, "the press settles out of loading");
	assert.equal(state().playingKey, null);
	assert.ok(button("Speak aloud"), "the control is back, enabled, at rest");
	assert.equal(button("Speak aloud").disabled, false);
	assert.equal(
		row().classList.contains("opacity-0"),
		true,
		"and the row is not pinned by a state that is over",
	);
	await unmount();
});

test("the disabled control explains itself through its tooltip", async () => {
	const { dom, button, unmount } = await mount({
		speechConfigured: false,
		block: "sign-in",
	});
	/*
	 * The tooltip is read the way a keyboard reader gets it: focus the trigger
	 * (the wrapper span, because a disabled button fires no pointer events) and
	 * read the panel, MATCHED BY NAME - a previous case's panel can still be
	 * mounted while the next opens (`stt-mic-gate-session.test.mjs`, whose
	 * dispatch/poll split this copies: one dispatch per attempt, no `act` around
	 * the poll, and a bounded retry).
	 */
	const trigger = button("Speak aloud").parentElement;
	const expected = "Sign in to Radient in Settings to enable speaking aloud";
	let found = null;
	const seen = new Set();
	for (let attempt = 0; attempt < 200 && found === null; attempt += 1) {
		trigger.dispatchEvent(
			new dom.window.FocusEvent("focusin", { bubbles: true, cancelable: true }),
		);
		// eslint-disable-next-line no-await-in-loop
		await new Promise((resolve) => setTimeout(resolve, 100));
		for (const panel of dom.window.document.querySelectorAll(
			'[role="tooltip"]',
		)) {
			const text = (panel.textContent ?? "").trim();
			seen.add(text);
			if (text === expected) found = panel;
		}
	}
	assert.ok(
		found,
		`the tooltip must read "${expected}"; saw ${JSON.stringify([...seen])}`,
	);
	/*
	 * And the same sentence has a NON-POINTER path (design round 1, D2; design
	 * round 2, D7): the wrapper names a description node whose text is the
	 * reason, and - because a description bound to a node nobody can focus
	 * reaches only a browse-mode reader - the wrapper takes focus with it, so a
	 * keyboard reader tabbing through meets the sentence too.
	 */
	const describedBy = trigger.getAttribute("aria-describedby");
	assert.ok(describedBy, "the disabled wrapper names a description");
	const described = dom.window.document.getElementById(describedBy);
	assert.ok(described, "the description node exists");
	assert.equal(
		(described.textContent ?? "").trim(),
		expected,
		"and carries the tooltip's sentence verbatim",
	);
	assert.equal(
		trigger.getAttribute("tabindex"),
		"0",
		"and the wrapper is focusable while the description holds a reason (D7)",
	);
	await unmount();
});

test("the description carries a reason only, and no reason means no tab stop (agent NIT-2 / design D7)", async () => {
	const base = {
		label: "Speak aloud",
		tooltip: "Speak aloud",
		isPlaying: false,
		isLoading: false,
		disabled: true,
		active: false,
		press: () => {},
	};
	/*
	 * The `available === false` arm: the tooltip is the affordance itself, so
	 * there is nothing to describe and the wrapper stays out of the tab order.
	 */
	const affordanceOnly = await mount({ control: { ...base, reason: null } });
	assert.equal(
		affordanceOnly.dom.window.document.querySelector("span[aria-describedby]"),
		null,
		"a tooltip that is not a reason binds no description (NIT-2)",
	);
	assert.equal(
		affordanceOnly.dom.window.document
			.querySelector("span")
			.getAttribute("tabindex"),
		null,
		"and adds no tab stop for furniture",
	);
	await affordanceOnly.unmount();

	const withReason = await mount({
		control: {
			...base,
			reason: "Sign in to Radient in Settings to enable speaking aloud",
		},
	});
	const described = withReason.dom.window.document.querySelector(
		"span[aria-describedby]",
	);
	assert.ok(described, "a reason binds a description");
	const id = described.getAttribute("aria-describedby");
	assert.equal(
		(
			withReason.dom.window.document.getElementById(id).textContent ?? ""
		).trim(),
		"Sign in to Radient in Settings to enable speaking aloud",
		"carrying the reason itself, not the button's name",
	);
	assert.equal(
		described.getAttribute("tabindex"),
		"0",
		"on a node the keyboard can reach",
	);
	await withReason.unmount();
});

test("a fresh arrival reveals itself once; an old record never flashes (U4)", async () => {
	const now = Date.now();
	const fresh = await mount({ reveal: { id: "arrive-fresh", at: now } });
	assert.ok(
		fresh.row().hasAttribute("data-lo-arrive"),
		"a newly arrived turn's row wears the reveal attribute",
	);
	await act(async () => {
		fresh
			.row()
			.dispatchEvent(
				new fresh.dom.window.Event("animationend", { bubbles: true }),
			);
	});
	assert.equal(
		fresh.row().hasAttribute("data-lo-arrive"),
		false,
		"the animation ending drops it: the resting state is where it ends",
	);
	await fresh.unmount();

	const again = await mount({ reveal: { id: "arrive-fresh", at: now } });
	assert.equal(
		again.row().hasAttribute("data-lo-arrive"),
		false,
		"once per record even across remounts (the pane windows rows in and out)",
	);
	await again.unmount();

	const old = await mount({
		reveal: {
			id: "arrive-old",
			at: now - mod.ROW_ARRIVAL_RECENT_MS - 60_000,
		},
	});
	assert.equal(
		old.row().hasAttribute("data-lo-arrive"),
		false,
		"a historical record does not flash: the reveal is about arrival, not mounting",
	);
	await old.unmount();

	const bare = await mount();
	assert.equal(
		bare.row().hasAttribute("data-lo-arrive"),
		false,
		"a row mounted without a reveal id never arrives",
	);
	await bare.unmount();

	/*
	 * The silencing arm, both directions (design review round 2, D6; UX round
	 * 2, U-r2-1). THE INSTRUMENT LIMITATION, stated: jsdom answers `false` for
	 * `:hover` however the page looks (measured), so the pointer's position is
	 * simulated through the harness's `:hover` seam - a predicate consulted by
	 * the patched matcher - which exercises the WALK the row performs and the
	 * boundary it stops at, not a real pointer. The design round re-checks the
	 * same rule on rendered frames; the CSS half of the yield is pinned as
	 * source below.
	 */
	const paneHover = await mount({
		reveal: { id: "arrive-pane", at: Date.now() },
		hoverMatch: (element) => element.getAttribute("data-testid") === "pane",
	});
	assert.ok(
		paneHover.row().hasAttribute("data-lo-arrive"),
		"a pointer inside the PANE but off the turn must not silence the nudge (U-r2-1: the old walk climbed to the pane and answered 'the reader is here' for any in-pane position, which is the ordinary state of a mouse reader)",
	);
	await paneHover.unmount();

	const turnHover = await mount({
		reveal: { id: "arrive-turn", at: Date.now() },
		hoverMatch: (element) => element.classList.contains("group"),
	});
	assert.equal(
		turnHover.row().hasAttribute("data-lo-arrive"),
		false,
		"the pointer ON the turn silences it, exactly as the row's comment claims",
	);
	await turnHover.unmount();

	/*
	 * The yield and the bubbling-animation guard (agent review round 2,
	 * MINOR-2 / NIT-1): a descendant's animation ending must not truncate the
	 * flash, and a reader arriving mid-flash takes the row back - and does not
	 * hand it back when they leave (leaving is not simulated; dropping the
	 * attribute is permanent by construction).
	 */
	const yielding = await mount({
		reveal: { id: "arrive-yield", at: Date.now() },
	});
	assert.ok(yielding.row().hasAttribute("data-lo-arrive"));
	await act(async () => {
		yielding
			.row()
			.querySelector("button")
			.dispatchEvent(
				new yielding.dom.window.Event("animationend", { bubbles: true }),
			);
	});
	assert.ok(
		yielding.row().hasAttribute("data-lo-arrive"),
		"a descendant's animationend must not drop the attribute (NIT-1)",
	);
	await act(async () => {
		yielding.dom.window.document
			.querySelector('[data-testid="turn"]')
			.dispatchEvent(new yielding.dom.window.Event("pointerenter"));
	});
	assert.equal(
		yielding.row().hasAttribute("data-lo-arrive"),
		false,
		"the reader's own arrival on the turn yields the flash (MINOR-2)",
	);
	await yielding.unmount();

	const focusYield = await mount({
		reveal: { id: "arrive-focus-yield", at: Date.now() },
	});
	assert.ok(focusYield.row().hasAttribute("data-lo-arrive"));
	await act(async () => {
		focusYield.dom.window.document
			.querySelector('[data-testid="turn"]')
			.dispatchEvent(
				new focusYield.dom.window.Event("focusin", { bubbles: true }),
			);
	});
	assert.equal(
		focusYield.row().hasAttribute("data-lo-arrive"),
		false,
		"the keyboard arm of the same yield is focusin on the turn",
	);
	await focusYield.unmount();

	/*
	 * The focus arm's own boundary, both directions (agent review round 3,
	 * NIT-2): focus INSIDE the pane but OFF the turn must not silence the
	 * nudge, and focus on the turn must - that second case is what the widened
	 * arm changed (it used to test the row alone, `element.contains`), so it
	 * fails if the boundary reverts to the narrow one that let a reader
	 * elsewhere in the pane keep the flash. jsdom only reports truly-focused
	 * nodes, so the read is answered through the same kind of seam as the
	 * pointer (the limitation stated above holds here too).
	 */
	const paneFocus = await mount({
		reveal: { id: "arrive-pane-focus", at: Date.now() },
		activeElementProbe: (doc) => doc.querySelector('[data-testid="pane"]'),
	});
	assert.ok(
		paneFocus.row().hasAttribute("data-lo-arrive"),
		"focus in the PANE but off the turn must not silence the nudge",
	);
	await paneFocus.unmount();

	const turnFocus = await mount({
		reveal: { id: "arrive-turn-focus", at: Date.now() },
		activeElementProbe: (doc) => doc.querySelector('[data-testid="turn"]'),
	});
	assert.equal(
		turnFocus.row().hasAttribute("data-lo-arrive"),
		false,
		"focus on the TURN silences it - the arm the r2 fix widened from row-only containment",
	);
	await turnFocus.unmount();
});

test("the reveal's stylesheet carries the yield and the reduced-motion snap (agent MINOR-2, UX U-r2-2)", async () => {
	const { readFile } = await import("node:fs/promises");
	const css = await readFile(
		new URL("../src/renderer/src/styles/index.css", import.meta.url),
		"utf8",
	);
	/*
	 * The CSS halves cannot be exercised through jsdom (no layout, no media
	 * queries), so they are pinned as SOURCE - the mechanism the design round
	 * can re-check on frames. The flash must yield to the reader's own arrival
	 * while it runs (an animated `opacity` outranks every normal declaration),
	 * and the reduced-motion arm must SNAP to the held state rather than
	 * withholding the nudge entirely (U-r2-2 measured exactly that gap).
	 */
	assert.match(
		css,
		/\.group:hover \[data-lo-arrive\][\s\S]{0,90}\.group:focus-within \[data-lo-arrive\][\s\S]{0,60}animation:\s*none;/,
		"the flash yields while the turn is hovered or focused (MINOR-2)",
	);
	assert.match(
		css,
		/@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,90}\[data-lo-arrive\][\s\S]{0,50}opacity: 1;/,
		"a reduced-motion reader gets a snap, not silence (U-r2-2)",
	);
});

/* ---------------------------------- 4. the user row's copy arm */

test("a user row offers Copy alone, fades like the answer row, and copies the user's text", async () => {
	const { row, press, written, unmount } = await mount({
		role: "user",
		bodyText: "Is the March import finished?",
	});
	const rowEl = row();
	assert.equal(
		rowEl.getAttribute("aria-label"),
		"Your message actions",
		"the possessive names whose message the toolbar acts on (copy round 1, C6)",
	);
	assert.equal(rowEl.getAttribute("aria-label"), mod.USER_ACTIONS_LABEL);
	assert.equal(rowEl.getAttribute("data-lo-answer-actions"), null);
	for (const className of REVEAL_TOKENS) {
		assert.ok(
			rowEl.classList.contains(className),
			`the user row shares the reveal: ${className}`,
		);
	}
	const labels = [...rowEl.querySelectorAll("button")].map((node) =>
		node.getAttribute("aria-label"),
	);
	/*
	 * Copy alone HERE because this mount hands the row no cut point (no
	 * `conversationId`, no `entryId`), which is the no-cut-point arm - the
	 * property under test is the absent Speak. A mount that DOES name one carries
	 * Fork too, and `scripts/speech-user-copy.test.mjs` is the case that renders
	 * the transcript itself, where the row genuinely is a cut point.
	 */
	assert.deepEqual(labels, ["Copy"], "Copy alone: a user turn offers no Speak");
	await press("Copy");
	assert.deepEqual(written, ["Is the March import finished?"]);
	await unmount();
});

/* ------------------------------------------------- 5. the glyph pins */

test("the operator's two copy sites carry Copy, and no ClipboardCopy", () => {
	for (const [name, source] of [
		["message-actions-row.tsx", ROW_SOURCE],
		["link-toolkit.tsx", LINK_SOURCE],
	]) {
		assert.ok(
			!CLIPBOARD_COPY.test(source),
			`${name} must not import or render ClipboardCopy`,
		);
		assert.ok(COPY_RENDER.test(source), `${name} must render <Copy`);
	}
	/*
	 * And the OTHER shape keeps its glyph: `text-selection-controls.tsx`'s
	 * second copy button is the plain-text variant beside the rich one, and two
	 * identical glyphs side by side would erase the distinction the labels make.
	 */
	assert.ok(
		CLIPBOARD_COPY.test(
			readFileSync(
				"src/renderer/src/shared/components/common/text-selection-controls.tsx",
				"utf8",
			),
		),
		"the plain-text copy variant keeps its own glyph",
	);
});
