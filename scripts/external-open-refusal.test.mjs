/**
 * The refused external open's renderer half, driven through the shipped modules
 * (round-2 R-4).
 *
 *     node --test scripts/external-open-refusal.test.mjs
 *
 * WHY THIS FILE EXISTS. A refusal is only half done when the main process
 * decides it: a press that did nothing must say so. Two carriers deliver the
 * door's outcome to the renderer - `openUrlTarget` awaits the IPC answer, and a
 * markdown anchor's click gets the pushed `external-open-refused` event - and
 * this file pins both ends where they can actually be read: the same sentence
 * goes to the toast for the loopback class and for every other refusal, the
 * answer travels as a boolean so callers can act on it, and the subscription
 * installs once and uninstalls.
 *
 * ISOLATION. No Electron, no app, no DOM: `window.api` is a stub object this
 * file owns, and the toast manager is stubbed by path (the
 * `chat-session-copy-id.test.mjs` pattern) so what would have been said is
 * recorded rather than rendered.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = resolve(import.meta.dirname, "..");

/* The toast stub's matchers, hoisted for `useTopLevelRegex`. */
const TOAST_MANAGER = /@shared\/utils\/toast-manager/;
const ANY_MODULE = /.*/;

const toasts = [];
globalThis.__externalOpenToasts = toasts;

const bundle = await build({
	stdin: {
		contents: `
			export { externalOpenFailure, showExternalOpenRefusal, installExternalOpenRefusalToasts } from "./src/renderer/src/shared/lib/external-open-refusal";
			export { openUrlTarget, openTarget } from "./src/renderer/src/features/chat/utils/link-open";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	write: false,
	loader: { ".css": "empty" },
	// Vite's `import.meta.env` is read by config modules at import time; the URL
	// is dead on purpose, as in the link-affordances suite.
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45998" };',
	},
	alias: {
		"@renderer": resolve(ROOT, "src/renderer/src"),
		"@shared": resolve(ROOT, "src/renderer/src/shared"),
		"@features": resolve(ROOT, "src/renderer/src/features"),
	},
	plugins: [
		{
			name: "toast-fixture",
			setup(builder) {
				builder.onResolve({ filter: TOAST_MANAGER }, () => ({
					path: "toast",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: ANY_MODULE, namespace: "fixture" }, () => ({
					loader: "js",
					contents: `
						export const showErrorToast = (message) => {
							(globalThis.__externalOpenToasts ??= []).push(message);
						};
						export const dismissToast = () => {};
					`,
				}));
			},
		},
	],
});
const {
	externalOpenFailure,
	showExternalOpenRefusal,
	installExternalOpenRefusalToasts,
	openUrlTarget,
	openTarget,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const LOOPBACK_COPY =
	"Could not open that link. The app does not open links to your own machine or local network.";
const GENERIC_COPY = "Could not open that link.";

test("the sentence: one line, per refusal class", () => {
	// The loopback spelling is the door's own reason text, pinned main-side in
	// window-guards.test.mjs's refusal table - the two cannot drift apart.
	assert.equal(
		externalOpenFailure("URL names a loopback or private-network host"),
		LOOPBACK_COPY,
	);
	assert.equal(
		externalOpenFailure("scheme file: is not handed out"),
		GENERIC_COPY,
	);
	assert.equal(
		externalOpenFailure("the OS could not open the URL: no handler"),
		GENERIC_COPY,
	);
	// A direct call shows the same thing the carriers show.
	toasts.length = 0;
	showExternalOpenRefusal("about:blank is refused as a popup start");
	assert.deepEqual(toasts, [GENERIC_COPY]);
});

test("the toolbar half: openUrlTarget answers the door's outcome and shows the refusal", async () => {
	const calls = [];
	toasts.length = 0;
	const reasons = {
		"http://localhost:3000/": {
			ok: false,
			reason: "URL names a loopback or private-network host",
		},
	};
	globalThis.window = {
		api: {
			openExternal: async (url) => {
				calls.push(url);
				return reasons[url] ?? { ok: true };
			},
		},
	};

	assert.equal(await openUrlTarget("http://localhost:3000/"), false);
	assert.deepEqual(calls, ["http://localhost:3000/"]);
	assert.deepEqual(toasts, [LOOPBACK_COPY]);

	toasts.length = 0;
	assert.equal(await openUrlTarget("https://example.com/x"), true);
	assert.deepEqual(toasts, [], "an allowed open says nothing");

	// No bridge at all (Storybook and browser development): success, no error -
	// the same treatment `openLocalTarget` gives a missing bridge.
	globalThis.window = { api: {} };
	assert.equal(await openUrlTarget("https://example.com/x"), true);
	assert.deepEqual(toasts, []);

	// `openTarget` dispatches by kind and keeps the answer for its caller.
	toasts.length = 0;
	globalThis.window = {
		api: {
			openExternal: async () => ({
				ok: false,
				reason: "scheme smb: is not handed out",
			}),
		},
	};
	assert.equal(await openTarget("url", "smb://host/share"), false);
	assert.deepEqual(toasts, [GENERIC_COPY]);
	Reflect.deleteProperty(globalThis, "window");
});

test("the pushed half: subscription, sentence, and uninstall", () => {
	const listeners = [];
	toasts.length = 0;
	globalThis.window = {
		api: {
			onExternalOpenRefused: (callback) => {
				listeners.push(callback);
				return () => listeners.splice(listeners.indexOf(callback), 1);
			},
		},
	};

	const uninstall = installExternalOpenRefusalToasts();
	assert.equal(listeners.length, 1, "one subscription");
	listeners[0]({
		url: "http://localhost:3000",
		reason: "URL names a loopback or private-network host",
	});
	assert.deepEqual(toasts, [LOOPBACK_COPY]);

	uninstall();
	assert.equal(listeners.length, 0, "the unsubscribe removes the listener");

	// No bridge: a no-op install that still answers an uninstall.
	globalThis.window = {};
	const noop = installExternalOpenRefusalToasts();
	assert.equal(typeof noop, "function");
	noop();
	Reflect.deleteProperty(globalThis, "window");
});
