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

const calls = [];
const answer = (request) => {
	if (request.op === "config.get")
		return { values: { hosting: "local", model_name: "mock" } };
	if (request.op === "capabilities")
		return {
			desktop_available: true,
			features: { commands: 1, session_credential: 1 },
		};
	if (request.op === "commands.list") return { commands: [] };
	return {};
};

globalThis.fetch = async (url, init) => {
	let request = {};
	try {
		request = JSON.parse(init?.body ?? "{}");
	} catch {
		request = {};
	}
	calls.push({ url: String(url), request });
	return {
		ok: true,
		status: 200,
		json: async () => ({ status: 200, body: { result: answer(request) } }),
	};
};

const bundle = await build({
	stdin: {
		contents: `
			export { MessageInput } from "./src/renderer/src/shared/components/composer/message-input.tsx";
			export { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
			export { useConversationInputStore } from "./src/renderer/src/shared/store/conversation-input-store";
			export { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";
			export { t } from "@shared/i18n";
		`,
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
	`./_busy-composer-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	MessageInput,
	QueryClient,
	QueryClientProvider,
	useQuery,
	useUiPreferencesStore,
} = await import(bundlePath.href);
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
	for (let pass = 0; pass < 8; pass++) {
		await act(async () => {
			await new Promise((resolve) => realSetTimeout(resolve, 0));
			await new Promise((resolve) => setImmediate(resolve));
		});
	}
};

let mountSeq = 0;
async function mount({ busyDefaultMode } = {}) {
	const conversationId = `conv-busy-${++mountSeq}`;
	const sent = [];
	root ??= createRoot(window.document.getElementById("root"));
	await act(async () => {
		root.render(
			h(
				QueryClientProvider,
				{ client },
				h(MessageInput, {
					isLoading: false,
					messages: [{ id: "m", role: "system", timestamp: new Date(0) }],
					conversationId,
					awaitingReply: true,
					busyDefaultMode,
					onSendMessage: async (...args) => {
						sent.push(args);
						return true;
					},
					onSlashCommand: async () => false,
					onCredentialsStored: () => {},
					paneHasSession: false,
				}),
			),
		);
	});
	await settle();
	return { conversationId, sent };
}

const writeValue = (field, next, caret) => {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLTextAreaElement.prototype,
		"value",
	)?.set;
	setter.call(field, next);
	if (caret !== undefined) field.setSelectionRange(caret, caret);
	field.dispatchEvent(new window.Event("input", { bubbles: true }));
};

const field = () => window.document.querySelector("textarea");

const type = async (text) => {
	for (const char of text) {
		const f = field();
		const start = f.selectionStart ?? f.value.length;
		const next = f.value.slice(0, start) + char + f.value.slice(start);
		await act(async () => {
			writeValue(f, next, start + 1);
		});
		await settle();
	}
};

const press = async (init, keyCode) => {
	const f = field();
	let claimed = false;
	await act(async () => {
		const event = new window.KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			...init,
		});
		// jsdom's KeyboardEvent init cannot set keyCode (it reads 0); a real
		// IME composition commit arrives with 229, so define it directly.
		if (keyCode !== undefined)
			Object.defineProperty(event, "keyCode", { value: keyCode });
		f.dispatchEvent(event);
		claimed = event.defaultPrevented;
	});
	await settle();
	return claimed;
};

test("a bound chord press hands its mode to the page's send", async () => {
	useUiPreferencesStore.setState({
		shortcutBindings: { "composer.send_queue": "primary+enter" },
	});
	const { sent } = await mount();
	await type("hello");
	const claimed = await press({ key: "Enter", metaKey: true });
	assert.equal(claimed, true, "the chord press submits");
	assert.equal(sent.length, 1, "one send handed to the page");
	const [, , , , , , delivery] = sent[0];
	assert.equal(delivery, "queue", "the press's delivery travels on the send");
	useUiPreferencesStore.setState({ shortcutBindings: {} });
});

test("plain Enter hands the default (null) to the page's send", async () => {
	useUiPreferencesStore.setState({ shortcutBindings: {} });
	const { sent } = await mount();
	await type("hello");
	await press({ key: "Enter" });
	assert.equal(sent.length, 1);
	const [, , , , , , delivery] = sent[0];
	assert.equal(delivery, null, "plain Enter means the page's default mode");
});

test("the busy placeholder names the resolved mode", async () => {
	await mount({ busyDefaultMode: "queue" });
	assert.equal(
		field()?.placeholder,
		"Enter queues it · Esc stops",
		"queue default names the queue sentence",
	);
	await mount({ busyDefaultMode: "both" });
	assert.equal(
		field()?.placeholder,
		"Enter waits, then interrupts · Esc stops",
		"both default names the both sentence",
	);
	await mount({ busyDefaultMode: "steer" });
	assert.equal(
		field()?.placeholder,
		"Enter sends now · Esc stops",
		"steer default names the steer sentence",
	);
});

test("a settings change made outside the app is read after invalidation", async () => {
	// The page's settings query carries `staleTime: 10_000`; after a write in
	// another surface invalidates `desktopKeys.settings`, the next read sees the
	// new row rather than the five-minute default's cached copy. This probe is
	// react-query's own semantics at the same staleTime the page uses.
	const key = ["busy-probe"];
	let value = "steer";
	const Probe = () => {
		const query = useQuery({
			queryKey: key,
			queryFn: async () => value,
			staleTime: 10_000,
		});
		return h("div", { "data-probe": "true" }, query.data ?? "pending");
	};
	client.removeQueries({ queryKey: key });
	root ??= createRoot(window.document.getElementById("root"));
	await act(async () => {
		root.render(h(QueryClientProvider, { client }, h(Probe)));
	});
	await settle();
	assert.equal(
		window.document.querySelector('[data-probe="true"]')?.textContent,
		"steer",
	);
	// An outside write (the TUI's settings edit) lands; invalidation is what a
	// Backend-settings write does. The next mount reads the new value.
	value = "queue";
	await act(async () => {
		await client.invalidateQueries({ queryKey: key });
	});
	await settle();
	assert.equal(
		window.document.querySelector('[data-probe="true"]')?.textContent,
		"queue",
		"the invalidated query refetches the outside write",
	);
	client.removeQueries({ queryKey: key });
});

test("keyCode 229 never sends", async () => {
	useUiPreferencesStore.setState({ shortcutBindings: {} });
	const { sent } = await mount();
	await type("hello");
	const claimed = await press({ key: "Enter", metaKey: true }, 229);
	assert.equal(
		claimed,
		false,
		"an IME composition commit is not claimed as a send",
	);
	assert.equal(sent.length, 0, "no send handed to the page");
});
