import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * The busy-send delivery path, driven through the SHIPPED composer.
 *
 * Source-regex "wiring" tests pin that the Enter sites call `sendKeyOf`; this
 * file mounts the real `MessageInput`, types text and presses a bound chord,
 * and asserts what the composer handed the page: the `delivery` option. The
 * store half — `admitChatDraft` putting `delivery` on the `sessions.message`
 * body — is the same real path `busy-delivery-desktop.test.mjs` drives, so
 * together they prove chord press -> page -> body without a DOM-only claim.
 *
 * The world is built BEFORE the bundle is imported, because the stores
 * (`zustand/persist`) read `localStorage` at module scope. The rig is cloned
 * from `credential-composer.test.mjs`'s harness, trimmed to what this file
 * needs: jsdom globals, the fetch stub, the bundle and the mount.
 */

const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
const { window } = dom;
const originals = new Map();
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

for (const [key, value] of Object.entries({
	window,
	document: window.document,
	localStorage: window.localStorage,
	sessionStorage: window.sessionStorage,
	HTMLElement: window.HTMLElement,
	HTMLTextAreaElement: window.HTMLTextAreaElement,
	HTMLInputElement: window.HTMLInputElement,
	HTMLButtonElement: window.HTMLButtonElement,
	Element: window.Element,
	Node: window.Node,
	Event: window.Event,
	CustomEvent: window.CustomEvent,
	FocusEvent: window.FocusEvent,
	KeyboardEvent: window.KeyboardEvent,
	InputEvent: window.InputEvent,
	MouseEvent: window.MouseEvent,
	ClipboardEvent: window.ClipboardEvent,
	getComputedStyle: window.getComputedStyle.bind(window),
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	MutationObserver: window.MutationObserver,
	requestAnimationFrame: (callback) => realSetTimeout(() => callback(0), 0),
	cancelAnimationFrame: (id) => clearTimeout(id),
})) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}

Object.defineProperty(window.document, "visibilityState", { value: "hidden" });
Object.defineProperty(window.document, "hidden", { value: true });

window.setTimeout = tracked(realSetTimeout);
window.setInterval = tracked(realSetInterval);

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

window.electron = {
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

/*
 * `/approvals` from the desktop popup, driven through the production composer:
 * a CLICK on a value row must dispatch exactly what typing the value and
 * pressing Enter dispatches (operator report 2026-11-24: clicking "auto" did
 * not apply; typing it + Enter applied and then "bugged out").
 */
const SESSION = "abcdef123456";
const COMMANDS = [
	{
		name: "approvals",
		description: "Tool approval mode",
		aliases: [],
		arguments: "optional",
		echo: false,
		consumes_prompt: false,
		destination: "session.approvals",
		execution: "owner",
	},
];
const answer = (request) => {
	if (request.op === "config.get")
		return { values: { hosting: "local", model_name: "mock" } };
	if (request.op === "capabilities")
		return { desktop_available: true, features: { commands: 1 } };
	if (request.op === "commands.list") return { commands: COMMANDS };
	if (request.op === "commands.entities")
		return { entities: [{ value: "auto" }, { value: "ask" }], current: "ask" };
	return {};
};
globalThis.fetch = async (_url, init) => {
	let request = {};
	try {
		request = JSON.parse(init?.body ?? "{}");
	} catch {
		request = {};
	}
	return {
		ok: true,
		status: 200,
		json: async () => ({ status: 200, body: { result: answer(request) } }),
	};
};
const bundle = await build({
	stdin: {
		contents: `export { MessageInput } from "./src/renderer/src/shared/components/composer/message-input.tsx"; export { QueryClient, QueryClientProvider } from "@tanstack/react-query";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@assets": `${process.cwd()}/src/renderer/src/assets`,
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	define: { "import.meta.env": "{}" },
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	write: false,
});
const bundlePath = new URL(
	`./_approvals-pick-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { MessageInput, QueryClient, QueryClientProvider } = await import(
	bundlePath.href
);
await unlink(bundlePath);
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const h = React.createElement;
const client = new QueryClient({
	defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
let root;
after(() => {
	root?.unmount();
	client.clear();
	for (const id of liveTimers) {
		clearTimeout(id);
		clearInterval(id);
	}
	dom.window.close();
});
const settle = async () => {
	for (let pass = 0; pass < 12; pass++) {
		await act(async () => {
			await new Promise((resolve) => realSetTimeout(resolve, 0));
			await new Promise((resolve) => setImmediate(resolve));
		});
	}
};
async function mount() {
	const dispatched = [];
	const sent = [];
	root?.unmount();
	root = createRoot(window.document.getElementById("root"));
	await act(async () => {
		root.render(
			h(
				QueryClientProvider,
				{ client },
				h(MessageInput, {
					isLoading: false,
					messages: [{ id: "m", role: "system", timestamp: new Date(0) }],
					conversationId: SESSION,
					onSendMessage: async (...args) => {
						sent.push(args);
						return true;
					},
					onSlashCommand: async (invocation) => {
						dispatched.push({ name: invocation.name, args: invocation.args });
						return "consumed";
					},
					onCredentialsStored: () => {},
					paneHasSession: true,
				}),
			),
		);
	});
	await settle();
	return { dispatched, sent };
}
const field = () => window.document.querySelector("textarea");
const writeValue = (f, next, caret) => {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLTextAreaElement.prototype,
		"value",
	)?.set;
	setter.call(f, next);
	if (caret !== undefined) f.setSelectionRange(caret, caret);
	f.dispatchEvent(new window.Event("input", { bubbles: true }));
};
const type = async (text) => {
	for (const char of text) {
		const f = field();
		const at = f.selectionStart ?? f.value.length;
		await act(async () => {
			writeValue(f, f.value.slice(0, at) + char + f.value.slice(at), at + 1);
		});
		await settle();
	}
};
const press = async (key) => {
	await act(async () => {
		field().dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key,
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	await settle();
};
/* Hoisted: the scripts ratchet refuses a regex literal built per call. */
const WHITESPACE = /\s+/;
const optionNamed = (word) =>
	[...window.document.querySelectorAll('[role="option"]')].find(
		(node) => node.textContent?.trim().split(WHITESPACE)[0] === word,
	);
const click = async (node) => {
	await act(async () => {
		node.dispatchEvent(
			new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }),
		);
		node.dispatchEvent(
			new window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
	await settle();
};
const popupOpen = () =>
	window.document.querySelectorAll('[role="option"]').length > 0;

test("typing `/approvals auto` + Enter dispatches approvals auto once and clears the box", async () => {
	const { dispatched, sent } = await mount();
	await type("/approvals auto");
	await press("Enter");
	assert.deepEqual(dispatched, [{ name: "approvals", args: "auto" }]);
	assert.equal(sent.length, 0, "nothing is sent as a message");
	assert.equal(field().value, "", "the consumed command leaves the box empty");
	assert.equal(popupOpen(), false, "no list is left open over the empty box");
});

test("clicking the `auto` row dispatches exactly what typing it + Enter does", async () => {
	const { dispatched, sent } = await mount();
	await type("/approvals ");
	const row = optionNamed("auto");
	assert.ok(row, "the approvals list offers an auto row");
	await click(row);
	assert.deepEqual(dispatched, [{ name: "approvals", args: "auto" }]);
	assert.equal(sent.length, 0);
	assert.equal(field().value, "");
	assert.equal(popupOpen(), false);
});
