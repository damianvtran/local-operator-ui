import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act, useState } from "react";
// React DOM feature-detects input events at import time. Give it a document
// before loading it, rather than activating its legacy IE event polyfill.
const bootstrapDOM = new JSDOM("<!doctype html>");
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	delete globalThis.window;
	delete globalThis.document;
});

// Run the shipped component, Button, React effects and DOM events, not an
// imitation hook runner. jsdom has no layout engine: rectangles below are the
// explicit input fixture, NOT browser geometry/Tab/Enter/Space evidence.
const source = "src/renderer/src/features/chat/components/";
const bundle = await build({
	entryPoints: [`${source}measured-suggestion-stack.tsx`],
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	write: false,
});
const bundlePath = new URL(
	`./_suggestion-react-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { MeasuredSuggestionStack } = await import(bundlePath.href);
await unlink(bundlePath);

const suggestions = [
	"First",
	"Second, with a wrapped label",
	"Third",
	"Fourth",
];
const h = React.createElement;

async function fixture(run) {
	const dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true });
	const { window } = dom;
	const originals = new Map();
	const observers = [];
	for (const [key, value] of Object.entries({
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		IS_REACT_ACT_ENVIRONMENT: true,
		ResizeObserver: class {
			constructor(callback) {
				this.callback = callback;
				this.nodes = new Set();
				observers.push(this);
			}
			observe(node) {
				this.nodes.add(node);
			}
			disconnect() {
				this.nodes.clear();
			}
		},
	})) {
		originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value,
		});
	}
	let finishFonts;
	Object.defineProperty(window.document, "fonts", {
		value: {
			ready: new Promise((resolve) => {
				finishFonts = resolve;
			}),
		},
	});
	window.innerHeight = 180;
	// Four rows, the second 48px high because its label wraps. Available room
	// is 90px: the first TWO whole rows fit, not the first two fixed-height chips.
	const rowBoxes = [
		[0, 28],
		[36, 84],
		[92, 120],
		[128, 156],
	];
	const rect = (top, height) => ({
		top,
		bottom: top + height,
		height,
		width: 300,
		left: 0,
		right: 300,
	});
	window.HTMLElement.prototype.getBoundingClientRect = function () {
		if (this.dataset.testBand !== undefined) return rect(0, window.innerHeight);
		if (this.dataset.testSplash !== undefined) {
			const stack = this.querySelector("[data-lo-suggestion-stack]");
			return rect(0, 90 + (Number.parseFloat(stack?.style.maxHeight) || 156));
		}
		if (this.dataset.loSuggestionStack !== undefined)
			return rect(90, Number.parseFloat(this.style.maxHeight) || 156);
		if (this.parentElement?.dataset.loSuggestionStack !== undefined) {
			const index = [...this.parentElement.children].indexOf(this);
			return rect(
				90 + rowBoxes[index][0],
				rowBoxes[index][1] - rowBoxes[index][0],
			);
		}
		return rect(0, 0);
	};
	const root = createRoot(window.document.getElementById("root"));
	const sent = [];
	function Host({
		small = false,
		hydrating = false,
		messages = 0,
		generation = 0,
		disabled = false,
	}) {
		const [band, setBand] = useState(null);
		const [splash, setSplash] = useState(null);
		return h(
			"div",
			{
				ref: setBand,
				"data-test-band": "",
				style: { paddingTop: 0, paddingBottom: 0 },
			},
			h("textarea", { "aria-label": "Composer" }),
			!small &&
				!hydrating &&
				messages === 0 &&
				h(
					"div",
					{ key: generation, ref: setSplash, "data-test-splash": "" },
					h(MeasuredSuggestionStack, {
						band,
						splash,
						suggestions,
						disabled,
						onSelect: (suggestion) => sent.push(suggestion),
						focusComposer: () =>
							window.document.querySelector("textarea").focus(),
					}),
				),
		);
	}
	const api = {
		window,
		sent,
		observers,
		finishFonts,
		buttons: () => [
			...window.document.querySelectorAll("[data-lo-suggestion-stack] button"),
		],
		stack: () => window.document.querySelector("[data-lo-suggestion-stack]"),
		render: async (props = {}) => {
			await act(() => root.render(h(React.StrictMode, null, h(Host, props))));
		},
		resize: async (height) => {
			await act(() => {
				window.innerHeight = height;
				window.dispatchEvent(new window.Event("resize"));
			});
		},
		liveObservers: () =>
			observers.filter((observer) => observer.nodes.size > 0),
	};
	try {
		await run(api);
	} finally {
		await act(() => root.unmount());
		await act(async () => {
			finishFonts();
			await Promise.resolve();
		});
		assert.equal(
			api.liveObservers().length,
			0,
			"unmount disconnects every observer, including StrictMode's first pass",
		);
		window.close();
		for (const [key, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	}
}

function assertCapped(api) {
	assert.equal(api.stack().style.maxHeight, "84px");
	assert.equal(api.liveObservers().length, 1);
	assert.ok([...api.liveObservers()[0].nodes][0].isConnected);
	assert.deepEqual(
		api.buttons().map((button) => button.disabled),
		[false, false, true, true],
	);
}

test("capped rows cannot receive focus or activate; visible wrapped chips remain available", async () => {
	await fixture(async (api) => {
		await api.render();
		assertCapped(api);
		const buttons = api.buttons();
		for (const button of buttons.slice(2)) {
			assert.equal(
				button.disabled,
				true,
				"native disabled removes both sequential and programmatic focus",
			);
			assert.equal(button.getAttribute("aria-hidden"), "true");
			assert.equal(button.style.visibility, "hidden");
			button.focus();
			assert.notEqual(api.window.document.activeElement, button);
			await act(() => {
				button.click();
				button.dispatchEvent(
					new api.window.MouseEvent("click", { bubbles: true }),
				);
			});
		}
		assert.deepEqual(
			api.sent,
			[],
			"omitted rows cannot call onSelect even through a dispatched click",
		);
		for (const button of buttons.slice(0, 2)) {
			assert.equal(button.tabIndex, 0);
			assert.equal(button.getAttribute("aria-hidden"), null);
			assert.ok(button.className.includes("whitespace-normal"));
			button.focus();
			assert.equal(api.window.document.activeElement, button);
		}
		await act(() => buttons[1].click());
		assert.deepEqual(api.sent, [suggestions[1]]);
	});
});

test("resize hands omitted focus to composer and expanding restores all rows", async () => {
	await fixture(async (api) => {
		await api.resize(400);
		await api.render();
		assert.equal(api.stack().style.maxHeight, "");
		api.buttons()[3].focus();
		await api.resize(180);
		assertCapped(api);
		assert.equal(api.window.document.activeElement.tagName, "TEXTAREA");
		await api.resize(400);
		for (const button of api.buttons()) {
			assert.equal(button.disabled, false);
			assert.equal(button.tabIndex, 0);
			assert.equal(button.style.visibility, "");
			assert.equal(button.getAttribute("aria-hidden"), null);
		}
		await api.render({ disabled: true });
		await act(() => api.buttons()[0].click());
		assert.deepEqual(
			api.sent,
			[],
			"recording/input-disabled continues to block visible chips",
		);
	});
});

for (const [name, initial] of [
	["initial-small → large", { small: true }],
	["hydrating → empty", { hydrating: true }],
	["send → empty", { messages: 1 }],
]) {
	test(`${name}: mounts observer with the SAME suggestion sample`, async () => {
		await fixture(async (api) => {
			await api.render(initial);
			assert.equal(api.stack(), null);
			assert.equal(api.liveObservers().length, 0);
			await api.render();
			assertCapped(api);
			await api.resize(400);
			assert.equal(
				api.stack().style.maxHeight,
				"",
				"new listener responds without a changed suggestion sample",
			);
		});
	});
}

test("splash → small/send → splash replaces nodes and ignores detached callbacks", async () => {
	await fixture(async (api) => {
		await api.render();
		assertCapped(api);
		for (const transition of [
			{ small: true },
			{ messages: 1 },
			{ hydrating: true },
		]) {
			const oldStack = api.stack();
			const oldObserver = api.liveObservers()[0];
			await api.render(transition);
			assert.equal(oldStack.isConnected, false);
			assert.equal(oldObserver.nodes.size, 0);
			await api.render();
			assertCapped(api);
			assert.notEqual(api.stack(), oldStack);
			await act(() => oldObserver.callback());
			assertCapped(api);
		}
		await api.render({ generation: 1 });
		assertCapped(api);
		await act(async () => {
			api.finishFonts();
			await Promise.resolve();
		});
		assertCapped(api);
	});
});

test("MessageInput wires node-valued refs and delegates its existing splash predicate", () => {
	const input = readFileSync(`${source}message-input.tsx`, "utf8");
	assert.match(input, /ref=\{setBand\}/);
	assert.match(input, /ref=\{setSplash\}/);
	assert.match(
		input,
		/<MeasuredSuggestionStack\s+band=\{band\}\s+splash=\{splash\}/,
	);
	assert.match(
		input,
		/focusComposer=\{\(\) => textareaRef\.current\?\.focus\(\)\}/,
	);
	assert.doesNotMatch(input, /suggestionStackRef|setSuggestionStackCap/);
});
