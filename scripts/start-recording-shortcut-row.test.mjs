import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const ROOT = resolve(import.meta.dirname, "..");
const bootstrap = new JSDOM("<!doctype html>", { url: "http://localhost/" });
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
globalThis.localStorage = bootstrap.window.localStorage;
globalThis.sessionStorage = bootstrap.window.sessionStorage;
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);
after(() => {
	bootstrap.window.close();
	for (const name of ["window", "document", "localStorage", "sessionStorage"]) {
		Reflect.deleteProperty(globalThis, name);
	}
});

const bundle = await build({
	stdin: {
		contents:
			'export { StartRecordingShortcutRow } from "./src/renderer/src/features/settings/components/start-recording-shortcut-row";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45999" };',
	},
	plugins: [
		{
			name: "react-stays-out",
			setup(builder) {
				builder.onResolve({ filter: /^[^./]/ }, (args) =>
					/^(react|react-dom|@tanstack\/react-query)(\/.*)?$/.test(args.path)
						? { path: args.path, external: true }
						: null,
				);
			},
		},
	],
	loader: { ".css": "empty" },
	alias: {
		"@assets": resolve(ROOT, "src/renderer/src/assets"),
		"@features": resolve(ROOT, "src/renderer/src/features"),
		"@renderer": resolve(ROOT, "src/renderer/src"),
		"@shared": resolve(ROOT, "src/renderer/src/shared"),
	},
	write: false,
});
const bundleDir = join(ROOT, "node_modules", ".cache", "start-recording-row");
mkdirSync(bundleDir, { recursive: true });
const bundlePath = join(bundleDir, "row.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const { StartRecordingShortcutRow } = await import(
	pathToFileURL(bundlePath).href
);

const setting = {
	key: "keymap.start_recording",
	section: "keymap",
	label: "Start recording",
	kind: "hotkey",
	help: "Starts speech-to-text recording in the desktop window.",
	value: "primary+shift+s",
	default: "primary+shift+s",
	is_default: true,
	minimum: null,
	maximum: null,
	members: [],
	choices: [],
	empty_unsets: false,
	redacted: false,
	tier: "core",
	hotkey_scope: "desktop",
};

async function mount({ backend = true, saveStatus = 200 }, run) {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	const originals = new Map();
	const shims = {
		window: dom.window,
		document: dom.window.document,
		HTMLElement: dom.window.HTMLElement,
		Element: dom.window.Element,
		Node: dom.window.Node,
		Event: dom.window.Event,
		CustomEvent: dom.window.CustomEvent,
		KeyboardEvent: dom.window.KeyboardEvent,
		MouseEvent: dom.window.MouseEvent,
		IS_REACT_ACT_ENVIRONMENT: true,
	};
	for (const [key, value] of Object.entries(shims)) {
		originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value,
		});
	}
	const requests = [];
	let live = backend ? { ...setting } : null;
	const response = (result) => ({
		status: 200,
		body: { status: 200, message: "ok", result },
	});
	let recordingState = {
		value: setting.value,
		canonical: "primary+shift+s",
	};
	const pending = [];
	dom.window.requestAnimationFrame = (callback) =>
		dom.window.setTimeout(() => callback(dom.window.performance.now()), 0);
	dom.window.electron = {
		recordingShortcut: {
			get: async () => recordingState,
			onChange: () => () => {},
			markPending: (value) => pending.push(value),
			syncClaims: () => {},
		},
	};
	dom.window.api = {
		windowChrome: { facts: () => ({ platform: "linux" }) },
		desktop: {
			request: async (request) => {
				requests.push(request);
				if (request.op === "settings.list")
					return response({ sections: [], settings: live ? [live] : [] });
				if (request.op === "settings.edit" && request.key === setting.key) {
					if (saveStatus !== 200)
						return {
							status: saveStatus,
							body: {
								status: saveStatus,
								detail: "Chord already assigned to Quick send.",
							},
						};
					live = {
						...setting,
						value: request.value,
						is_default: request.value === setting.default,
					};
					recordingState = { ...recordingState, value: request.value };
					return response({ ...live });
				}
				if (request.op === "settings.reset" && request.key === setting.key) {
					live = { ...setting };
					recordingState = { ...recordingState, value: setting.value };
					return response({ ...live });
				}
				throw new Error(`unexpected ${request.op}`);
			},
		},
	};
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const root = createRoot(dom.window.document.getElementById("root"));
	act(() =>
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(StartRecordingShortcutRow),
			),
		),
	);
	for (let attempt = 0; attempt < 10; attempt += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
	}
	try {
		try {
			await run({
				window: dom.window,
				requests,
				$: (selector) => dom.window.document.querySelector(selector),
				text: () => dom.window.document.body.textContent,
				pending,
			});
		} catch (error) {
			console.error(error);
			throw error;
		}
	} finally {
		await act(async () => root.unmount());
		client.clear();
		await act(async () => {});
		dom.window.close();
		for (const [key, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	}
}

test.afterEach(() => {
	// A failed assertion must not leave a live JSDOM timer/root holding node:test.
});

test("standalone without a provider keeps the old panel-only surface inert", async () => {
	const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/" });
	const original = Object.getOwnPropertyDescriptor(
		globalThis,
		"IS_REACT_ACT_ENVIRONMENT",
	);
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.window.document.getElementById("root"));
	act(() => root.render(React.createElement(StartRecordingShortcutRow)));
	await act(async () => {});
	assert.equal(dom.window.document.body.textContent, "");
	act(() => root.unmount());
	dom.window.close();
	if (original)
		Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", original);
	else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

test("older backend omits the promoted row without a second local store", async () => {
	await mount({ backend: false }, async (api) => {
		assert.equal(api.text(), "");
		assert.deepEqual(api.requests, [{ op: "settings.list" }]);
	});
});

test("capture saves immediately and explicit reset restores the default and focus", async () => {
	await mount({}, async (api) => {
		const input = api.$('input[data-shortcut-action="keymap.start_recording"]');
		assert.ok(input);
		assert.equal(input.value, "Ctrl+Shift+S");
		assert.equal(api.text().includes("Quick send"), false);
		assert.equal(api.text().includes(setting.help), true);
		await act(async () => {
			input.dispatchEvent(
				new api.window.KeyboardEvent("keydown", {
					key: "r",
					metaKey: true,
					altKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		assert.deepEqual(
			api.requests.filter((request) => request.op === "settings.edit"),
			[{ op: "settings.edit", key: setting.key, value: "primary+alt+r" }],
		);
		assert.equal(input.value, "Ctrl+Alt+R");
		assert.equal(api.window.document.activeElement, input);
		assert.equal(
			[...api.window.document.querySelectorAll("button")].some(
				(button) => button.textContent === "Save",
			),
			false,
		);
		assert.deepEqual(api.pending, ["primary+alt+r", undefined]);
		const reset = api.$(
			'button[aria-label="Reset Start recording to its default"]',
		);
		assert.ok(reset);
		await act(async () => reset.click());
		assert.deepEqual(
			api.requests.filter((request) => request.op === "settings.reset"),
			[{ op: "settings.reset", key: setting.key }],
		);
		assert.equal(input.value, "Ctrl+Shift+S");
		assert.equal(api.window.document.activeElement, input);
	});
});

test("self capture is a no-op and panel conflicts use one exact sentence", async () => {
	await mount({}, async (api) => {
		const input = api.$('input[data-shortcut-action="keymap.start_recording"]');
		input.focus();
		await act(async () => {
			input.dispatchEvent(
				new api.window.KeyboardEvent("keydown", {
					key: "s",
					ctrlKey: true,
					shiftKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		assert.equal(
			api.requests.some((request) => request.op === "settings.edit"),
			false,
		);
		assert.equal(api.text().includes("Already assigned"), false);
	});
	await mount({}, async (api) => {
		const input = api.$('input[data-shortcut-action="keymap.start_recording"]');
		await act(async () => {
			input.dispatchEvent(
				new api.window.KeyboardEvent("keydown", {
					key: "j",
					ctrlKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		assert.equal(
			api.text().includes("Already assigned to Open console."),
			true,
		);
		assert.equal(
			api.text().includes("Already assigned to Already assigned"),
			false,
		);
	});
});

test("a refusal preserves the saved chord and Escape keeps focus", async () => {
	await mount({ saveStatus: 409 }, async (api) => {
		const input = api.$('input[data-shortcut-action="keymap.start_recording"]');
		await act(async () =>
			input.dispatchEvent(
				new api.window.KeyboardEvent("keydown", {
					key: " ",
					metaKey: true,
					altKey: true,
					shiftKey: true,
					bubbles: true,
					cancelable: true,
				}),
			),
		);
		assert.ok(api.text().includes("Chord already assigned to Quick send"));
		assert.equal(input.value, "Ctrl+Shift+S");
		await act(async () =>
			input.dispatchEvent(
				new api.window.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			),
		);
		assert.equal(api.window.document.activeElement, input);
		assert.equal(
			api.requests.filter((request) => request.op === "settings.reset").length,
			0,
		);
	});
});
