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
			export { AnswerActionRow } from "./src/renderer/src/features/chat/canonical/message-actions-row";
			export {
				ANSWER_ACTIONS_LABEL,
				USER_ACTIONS_LABEL,
				COPY_FEEDBACK_MS,
			} from "./src/renderer/src/features/chat/canonical/message-actions";
			export { SPEECH_MAX_CHARS } from "@shared/lib/speech-clip";
			export { useSpeechStore, messageSpeechKey } from "@shared/store/speech-store";
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
			React.createElement(mod.AnswerActionRow, {
				bodyText,
				kind: role,
				agentId: role === "user" ? undefined : "c1",
				speechId: role === "user" ? undefined : "a1",
			}),
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

test("loading and playing pin the row visible, and the labels follow", async () => {
	const { row, button, press, unmount } = await mount();
	await act(async () => {
		mod.useSpeechStore.setState({ loadingKey: mod.messageSpeechKey("a1") });
	});
	assert.ok(button("Loading speech"), "the loading state names itself");
	assert.equal(
		button("Loading speech").disabled,
		true,
		"and cannot be pressed again",
	);
	assert.equal(
		row().classList.contains("opacity-0"),
		false,
		"a loading press pins the row",
	);

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
	assert.deepEqual(
		requests(),
		[
			{
				op: "speech.agent",
				agentId: "c1",
				request: {
					input_text: "Four were late, and the oldest is 41 days behind.",
				},
			},
		],
		"one relay call, keyed to this conversation, carrying the text the reader saw",
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
				op: "speech.agent",
				agentId: "c1",
				request: { input_text: expected },
			},
		],
		"the request carries the clipped text, not the full answer",
	);
	assert.deepEqual(
		toasts().infos,
		[`Reading the first ${expected.length} characters`],
		"the clip is disclosed in the app's own sentence",
	);
	await unmount();
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
	const expected =
		"Sign in to Radient in the settings page to enable speaking aloud";
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
	await unmount();
});

/* ---------------------------------- 4. the user row's copy arm */

test("a user row offers Copy alone, fades like the answer row, and copies the user's text", async () => {
	const { row, button, press, written, unmount } = await mount({
		role: "user",
		bodyText: "Is the March import finished?",
	});
	const rowEl = row();
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
