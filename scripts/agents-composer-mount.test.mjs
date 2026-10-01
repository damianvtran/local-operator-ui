import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE RUN'S BOX IS THE APP'S COMPOSER — mounted, and holding the one line that
 * says what it is.
 *
 * WHY THIS FILE EXISTS RATHER THAN A FRAME. Two of Scope B's decisions are
 * statements about the DOM that a still cannot prove and a reviewer should not
 * have to take on trust:
 *
 *  1. the aside sentence is a PERMANENT NODE inside the composer's notice band,
 *     verbatim, and it is what the box's `aria-describedby` names — the design's
 *     U4 requirement, and the reason it is not a placeholder (`transcriptless`
 *     plus `placeholderOverride` would have made it one);
 *  2. the send seam is the composer's own (`onSendMessage(content, attachments)`)
 *     and it reaches the run with the attachments the composer collected — the
 *     one state the note forbids is a control whose payload the send drops.
 *
 * WHAT IS REAL: the shipped `ConfigComposer`, the shipped `MessageInput` and its
 * input store. What is faked, and only that: the run handle, which is a plain
 * object — the composer's contract is with that object, not with the hook.
 *
 * WHAT IT IS NOT: evidence about pixels. jsdom has no layout engine, so nothing
 * here says how the box sits on the page; that is the frames' job.
 */

const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/agents",
});
const FORCE_FROM_JSDOM = [
	"Event",
	"CustomEvent",
	"UIEvent",
	"MouseEvent",
	"PointerEvent",
	"KeyboardEvent",
	"FocusEvent",
	"InputEvent",
	"CompositionEvent",
	"HTMLElement",
	"Element",
	"Node",
	"DocumentFragment",
	"Range",
	"Selection",
	"DOMRect",
	"DOMRectReadOnly",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
];
for (const key of Object.getOwnPropertyNames(DOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = DOM.window[key];
	} catch {
		// jsdom's own accessors refuse to be read out of scope.
	}
}
globalThis.window = DOM.window;
globalThis.document = DOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/*
 * A STORAGE THAT ANSWERS. Two persisted stores in this graph (the onboarding
 * store, the conversation-input store) rehydrate at import time, and a jsdom
 * window without storage throws inside them before any test runs.
 */
const storage = new Map();
Object.defineProperty(DOM.window, "localStorage", {
	configurable: true,
	value: {
		getItem: (key) => storage.get(key) ?? null,
		setItem: (key, value) => storage.set(key, String(value)),
		removeItem: (key) => storage.delete(key),
		clear: () => storage.clear(),
		key: (index) => [...storage.keys()][index] ?? null,
		get length() {
			return storage.size;
		},
	},
});
globalThis.localStorage = DOM.window.localStorage;
DOM.window.matchMedia = (query) => ({
	media: query,
	matches: false,
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => false,
});
/*
 * FRAMES, BECAUSE JSDOM HAS NONE WITHOUT `pretendToBeVisual`. The composer's send
 * path schedules its optimistic paint on one, so a missing `requestAnimationFrame`
 * fails a send a browser would have made.
 */
globalThis.requestAnimationFrame = (callback) =>
	setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
globalThis.ResizeObserver = class {
	observe() {}
	disconnect() {}
};
/*
 * A CANVAS THAT ANSWERS, because the composer's graph measures text at MODULE
 * scope (the maths renderer's default console width) and jsdom's canvas throws
 * "not implemented" — an import-time failure that would read as a broken test
 * rather than a missing shim. Only `measureText` is ever called.
 */
DOM.window.HTMLCanvasElement.prototype.getContext = () => ({
	measureText: (text) => ({ width: String(text).length * 8 }),
	font: "",
	fillText: () => {},
	clearRect: () => {},
	save: () => {},
	restore: () => {},
});

/*
 * THE DESKTOP BRIDGE, INERT. The composer's mount path reaches it (the catalogue
 * read behind the credential probe, the transcription manager's own probe); this
 * file is about what the box renders and what its send seam carries, and a call
 * that answers "nothing" is the honest stand-in for a bridge this rig does not
 * have.
 */
DOM.window.electron = {
	ipcRenderer: {
		on: () => () => {},
		removeListener: () => {},
		send: () => {},
		invoke: async (channel) =>
			channel === "get-platform-info"
				? { platform: "darwin" }
				: { canceled: true, filePaths: [] },
	},
};
DOM.window.api = {
	ipcRenderer: {
		invoke: async () => ({}),
		send: () => {},
		on: () => {},
		once: () => {},
		removeListener: () => {},
		removeAllListeners: () => {},
	},
	readFile: undefined,
	platform: "darwin",
};
globalThis.api = DOM.window.api;

const bundle = await build({
	stdin: {
		contents: [
			'export { ConfigComposer } from "../src/renderer/src/features/agents/config-run/config-composer";',
			'export { createRoot } from "react-dom/client";',
			'export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
		].join("\n"),
		resolveDir: `${process.cwd()}/scripts`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@assets": `${process.cwd()}/src/renderer/src/assets`,
	},
	/*
	 * THE COMPOSER'S GRAPH REACHES ASSETS AND FONTS (the brand mark, the maths
	 * renderer's own faces). They are not what this file is about, and the rig's
	 * recipe is `shared-composer.test.mjs`'s: every one of them loads as an
	 * empty/text/dataurl module so the bundle stays about behaviour.
	 */
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
		".ttf": "empty",
		".woff": "empty",
		".woff2": "empty",
		".eot": "empty",
	},
	define: { "import.meta.env": "{}" },
	/*
	 * THE BUNDLE KEEPS A CJS DEPENDENCY (react-error-boundary, reached through the
	 * composer's own error boundary), and a CJS file inside an ESM bundle needs a
	 * `require` that resolves from THIS file — the recipe `shared-composer.test.mjs`
	 * states for the same reason.
	 */
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
});
const bundlePath = new URL(
	"._agents-composer-mount.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));
const { ConfigComposer, QueryClient, QueryClientProvider, createRoot } =
	await import(bundlePath.href);

/** One run handle, with the sends it received. */
const handle = (overrides = {}) => {
	const sent = [];
	const run = {
		enabled: true,
		disabledReason: null,
		status: "idle",
		sessionId: null,
		frontend: null,
		topic: "",
		error: null,
		stopError: null,
		about: null,
		touched: [],
		step: null,
		elapsed: "0s",
		activity: [],
		results: [],
		answer: "",
		canRetry: false,
		starting: false,
		attached: false,
		start: async (text, about, attachments) => {
			sent.push({ text, about, attachments });
			return true;
		},
		stop: async () => undefined,
		retry: async () => undefined,
		dismiss: () => undefined,
		...overrides,
	};
	return { run, sent };
};

const mount = async (run) => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	/*
	 * THE COMPOSER READS QUERY STATE (the credential probe, the composer's own
	 * error boundary), so a client is part of mounting it — the same shape the app
	 * provides, with retries off because nothing here presses a query's control.
	 */
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client: queryClient },
				React.createElement(ConfigComposer, {
					run,
					about: null,
					onClearAbout: () => undefined,
				}),
			),
		);
	});
	return { host, root };
};

/** Type into the composer's box the way a keyboard does. */
const type = async (host, text) => {
	const box = host.querySelector("textarea");
	assert.ok(box, "the shared composer's box is mounted");
	const setter = Object.getOwnPropertyDescriptor(
		DOM.window.HTMLTextAreaElement.prototype,
		"value",
	)?.set;
	await act(async () => {
		setter?.call(box, text);
		box.dispatchEvent(new DOM.window.Event("input", { bubbles: true }));
	});
	return box;
};

test("the aside sentence is the box's own description, verbatim", async () => {
	const { run } = handle();
	const { host, root } = await mount(run);
	const note = host.querySelector('[data-testid="config-composer-note"]');
	assert.ok(note, "the standing sentence renders inside the composer");
	assert.equal(
		note.textContent?.trim(),
		"Runs in the background. This does not appear in your conversation.",
		"verbatim, because the operator reads it to trust the control",
	);
	const box = host.querySelector("textarea");
	assert.ok(
		(box?.getAttribute("aria-describedby") ?? "").includes(
			"config-composer-note",
		),
		`the box describes itself with it (got ${box?.getAttribute("aria-describedby")})`,
	);
	assert.equal(
		note.getAttribute("id"),
		"config-composer-note",
		"the node carries the id the box names",
	);
	await act(async () => root.unmount());
});

test("a send from the shared box reaches the run with its attachments", async () => {
	const { run, sent } = handle();
	const { host, root } = await mount(run);
	const box = await type(host, "Add a reviewer that only reads tests");
	await act(async () => {
		box.dispatchEvent(
			new DOM.window.KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
			}),
		);
	});
	assert.equal(sent.length, 1, "the seam fired once");
	assert.equal(sent[0].text, "Add a reviewer that only reads tests");
	assert.equal(
		sent[0].about,
		null,
		"no row is selected, so no target is named",
	);
	assert.ok(
		Array.isArray(sent[0].attachments),
		"attachments arrive as the composer's own list, never dropped",
	);
	await act(async () => root.unmount());
});

test("a send the run refuses leaves the text in the box", async () => {
	/*
	 * THE DRAFT RULE, THROUGH THE SEAM (§3.3.1): `false` is the composer's own
	 * "put the text back". A run that answers false is the message-call failure —
	 * the request never reached the run — and the operator's sentence must still be
	 * there to send again.
	 */
	const { run } = handle({ start: async () => false });
	const { host, root } = await mount(run);
	const box = await type(host, "Add a team called shipping");
	await act(async () => {
		box.dispatchEvent(
			new DOM.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
	});
	assert.equal(
		host.querySelector("textarea")?.value,
		"Add a team called shipping",
		"the refused text is still in the box",
	);
	await act(async () => root.unmount());
});

/*
 * The mount leaves handles the composer itself owns (its transcription manager,
 * the query client this file creates). The suite ends here; `agents-config-retry`
 * exits the same way for the same reason.
 */
process.exit(0);
