import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";

/*
 * The Appearance rows for message timestamps: instant commit through
 * `settings.edit` (no Save/draft), the style control inert while the master
 * switch is off, and a failed write that shows its reason with a Retry.
 * `window.api.desktop.request` is the only seam mocked; the real component,
 * ToggleSetting, Tabs and desktopResult run.
 */
const bootstrapDOM = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = bootstrapDOM;
const originals = new Map();
const shims = {
	window,
	document: window.document,
	HTMLElement: window.HTMLElement,
	HTMLFormElement: window.HTMLFormElement,
	HTMLInputElement: window.HTMLInputElement,
	HTMLButtonElement: window.HTMLButtonElement,
	Node: window.Node,
	Element: window.Element,
	SVGElement: window.SVGElement,
	MouseEvent: window.MouseEvent,
	KeyboardEvent: window.KeyboardEvent,
	FocusEvent: window.FocusEvent,
	Event: window.Event,
	CustomEvent: window.CustomEvent,
	localStorage: window.localStorage,
	/*
	 * jsdom's navigator, so `navigator.language` is a fixture rather than
	 * whatever the machine happens to be set to: the formatter reads it for the
	 * month and day order, and a test that passed in en-US and failed in en-GB
	 * would be measuring the developer's locale.
	 */
	navigator: window.navigator,
	getComputedStyle: window.getComputedStyle.bind(window),
	requestAnimationFrame: () => 0,
	cancelAnimationFrame: () => {},
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	// `window.matchMedia`, which jsdom does not implement at all and the theme
	// and preference stores read on import.
	matchMedia: (query) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
		dispatchEvent: () => false,
	}),
};
for (const [key, value] of Object.entries(shims)) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
/*
 * `matchMedia` ON THE JSDOM WINDOW AS WELL AS ON `globalThis`.
 *
 * The two are not the same object here, and which one a caller reaches for
 * depends on how it was written: the theme and preference stores read the
 * global, while `useMediaQuery` inside the working line - reached through the
 * transcript once a test mounts `waiting` - calls `window.matchMedia` and cannot
 * see the global at all (`TypeError: window.matchMedia is not a function`).
 */
window.matchMedia ??= shims.matchMedia;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
after(() => {
	bootstrapDOM.window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

const bundle = await build({
	stdin: {
		contents: [
			'export { MessageTimestampSettings, withoutScopeTag } from "./src/renderer/src/features/settings/components/message-timestamp-settings";',
			'export { desktopKeys } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});
const bundlePath = new URL(
	`./_ts-settings-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { MessageTimestampSettings, withoutScopeTag, desktopKeys } = await import(
	bundlePath.href
);
await unlink(bundlePath);

const row = (key, label, kind, value, extra = {}) => ({
	key,
	section: "appearance",
	label,
	kind,
	help: "Help text (desktop app).",
	value,
	default: kind === "bool" ? false : "absolute",
	is_default: true,
	minimum: null,
	maximum: null,
	members: [],
	choices: [],
	empty_unsets: false,
	redacted: false,
	...extra,
});
const rows = (on) => [
	row("display.message_timestamps", "Message timestamps", "bool", on),
	row(
		"display.message_timestamp_style",
		"Timestamp style",
		"enum",
		"absolute",
		{
			gated_by: "display.message_timestamps",
			choices: [
				{ value: "absolute", label: "Absolute", description: "" },
				{ value: "relative", label: "Relative", description: "" },
			],
		},
	),
];

const mountSettings = async (on, request) => {
	const edits = [];
	window.api = {
		desktop: {
			request: async (req) => {
				if (req.op === "settings.edit") {
					edits.push(req);
					return request(req);
				}
				if (req.op === "settings.list")
					return { status: 200, body: { result: { settings: rows(on) } } };
				return { status: 200, body: { result: {} } };
			},
		},
	};
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(desktopKeys.capabilities, {
		desktop_available: true,
		features: { settings: 1 },
	});
	client.setQueryData(desktopKeys.settings, { settings: rows(on) });
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(
			h(QueryClientProvider, { client }, h(MessageTimestampSettings)),
		);
	});
	return { container, edits, unmount: () => act(() => root.unmount()) };
};

const ok = async () => ({ status: 200, body: { result: {} } });

test("toggling the switch commits once, immediately, with the right key and value", async () => {
	const { container, edits, unmount } = await mountSettings(false, ok);
	const sw = container.querySelector(
		'[data-setting-key="display.message_timestamps"] [role="switch"], [data-setting-key="display.message_timestamps"] button',
	);
	assert.ok(sw, "the switch renders");
	await act(async () => {
		sw.click();
	});
	assert.equal(edits.length, 1);
	assert.equal(edits[0].key, "display.message_timestamps");
	assert.equal(edits[0].value, true);
	assert.equal(container.textContent.includes("Save"), false, "no Save step");
	assert.equal(container.textContent.includes("Use default"), false);
	unmount();
});

test("the style control is inert and explained while the switch is off", async () => {
	const { container, edits, unmount } = await mountSettings(false, ok);
	const styleRow = container.querySelector(
		'[data-setting-key="display.message_timestamp_style"]',
	);
	assert.equal(styleRow.getAttribute("aria-disabled"), "true");
	assert.match(styleRow.textContent, /Needs Message timestamps on\./);
	const relative = [...styleRow.querySelectorAll("button, [role=tab]")].find(
		(b) => /Relative/.test(b.textContent),
	);
	assert.ok(
		relative.disabled ||
			relative.getAttribute("aria-disabled") === "true" ||
			relative.hasAttribute("data-disabled"),
	);
	await act(async () => {
		relative.click();
	});
	assert.equal(edits.length, 0, "nothing is written while gated off");
	unmount();
});

test("with the switch on, picking Relative commits settings.edit once", async () => {
	const { container, edits, unmount } = await mountSettings(true, ok);
	const styleRow = container.querySelector(
		'[data-setting-key="display.message_timestamp_style"]',
	);
	assert.equal(styleRow.getAttribute("aria-disabled"), "false");
	const relative = [...styleRow.querySelectorAll("button, [role=tab]")].find(
		(b) => /Relative/.test(b.textContent),
	);
	await act(async () => {
		relative.dispatchEvent(
			new window.MouseEvent("mousedown", { bubbles: true, button: 0 }),
		);
		relative.click();
	});
	assert.equal(edits.length, 1);
	assert.equal(edits[0].key, "display.message_timestamp_style");
	assert.equal(edits[0].value, "relative");
	unmount();
});

test("a failed write shows its reason and Retry re-sends the same edit", async () => {
	let fail = true;
	const { container, edits, unmount } = await mountSettings(false, async () =>
		fail
			? { status: 500, body: { detail: "backend said no" } }
			: { status: 200, body: { result: {} } },
	);
	const sw = container.querySelector(
		'[data-setting-key="display.message_timestamps"] button',
	);
	await act(async () => {
		sw.click();
	});
	const alert = container.querySelector('[role="alert"]');
	assert.ok(alert, "the failure is shown");
	assert.match(alert.textContent, /backend said no/);
	fail = false;
	const retry = [...alert.querySelectorAll("button")].find((b) =>
		/Retry/.test(b.textContent),
	);
	await act(async () => {
		retry.click();
	});
	assert.equal(edits.length, 2);
	assert.deepEqual(
		[edits[1].key, edits[1].value],
		[edits[0].key, edits[0].value],
	);
	assert.equal(
		container.querySelector('[role="alert"]'),
		null,
		"cleared on success",
	);
	unmount();
});

test("the scope tag is stripped from help only when it trails", () => {
	assert.equal(
		withoutScopeTag("Show a timestamp (desktop app)."),
		"Show a timestamp.",
	);
	assert.equal(
		withoutScopeTag("Show a timestamp (desktop app)"),
		"Show a timestamp",
	);
	assert.equal(withoutScopeTag("Plain sentence."), "Plain sentence.");
});
