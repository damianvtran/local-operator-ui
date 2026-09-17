import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act, useState } from "react";
// React DOM feature-detects input events at import time. Give it a document
// before loading it, rather than activating its legacy IE event polyfill.
/*
 * A REAL ORIGIN, not jsdom's default opaque one: the write-path bundle below
 * imports the draft store, whose `persist` middleware resolves `localStorage`
 * once at module init and stays storage-less for the whole file if that read
 * throws (`createJSONStorage` catches it and returns no storage at all).
 */
const bootstrapDOM = new JSDOM("<!doctype html>", { url: "http://localhost/" });
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
globalThis.localStorage = bootstrapDOM.window.localStorage;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
	globalThis.localStorage = undefined;
});

// Run the shipped component, Button, React effects and DOM events, not an
// imitation hook runner. jsdom has no layout engine: rectangles below are the
// explicit input fixture, NOT browser geometry/Tab/Enter/Space evidence.
const source = "src/renderer/src/features/chat/components/";
// The composer's own setter lives one directory over, in the shared hooks.
const hooks = "src/renderer/src/shared/hooks/";
const bundle = await build({
	entryPoints: [`${source}measured-suggestion-stack.tsx`],
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	/*
	 * BOTH aliases the renderer's own bundler declares for this graph. `@shared`
	 * was the only one this test needed while its entries reached the chat feature
	 * by RELATIVE path - and `use-message-input` now imports the canonical store
	 * for the predicate its held-claim copy reads, which pulls in
	 * `use-canonical-session` and with it three `@features/...` specifiers. With
	 * `packages: "external"` an unaliased bare specifier is left in the output and
	 * Node cannot resolve it, so the suite failed at import rather than anywhere
	 * near the behaviour it tests (PR #307's second remediation round).
	 */
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	write: false,
});
const bundlePath = new URL(
	`./_suggestion-react-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { MeasuredSuggestionStack } = await import(bundlePath.href);
await unlink(bundlePath);

/*
 * A second bundle for the WRITE PATH, because it is a different module graph
 * from the stack's: the hook the composer takes its setter from and the store
 * that setter persists into, with no component in between. Bundled the same way
 * (the shipped modules, not an imitation hook runner), which is what lets the
 * fill's persistence be RUN below rather than argued from the call site.
 */
const writeBundle = await build({
	stdin: {
		contents: `
			export { useMessageInput } from "./${source}../../../shared/hooks/use-message-input";
			export { useConversationInputStore } from "./${source}../../../shared/store/conversation-input-store";
			export { DEFAULT_MESSAGE_SUGGESTIONS } from "./${source}composer-suggestions";
		`,
		loader: "tsx",
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	/*
	 * BOTH aliases the renderer's own bundler declares for this graph. `@shared`
	 * was the only one this test needed while its entries reached the chat feature
	 * by RELATIVE path - and `use-message-input` now imports the canonical store
	 * for the predicate its held-claim copy reads, which pulls in
	 * `use-canonical-session` and with it three `@features/...` specifiers. With
	 * `packages: "external"` an unaliased bare specifier is left in the output and
	 * Node cannot resolve it, so the suite failed at import rather than anywhere
	 * near the behaviour it tests (PR #307's second remediation round).
	 */
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	write: false,
});
const writeBundlePath = new URL(
	`./_suggestion-write-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(writeBundlePath, writeBundle.outputFiles[0].text);
const {
	DEFAULT_MESSAGE_SUGGESTIONS,
	useConversationInputStore,
	useMessageInput,
} = await import(writeBundlePath.href);
await unlink(writeBundlePath);

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
	/*
	 * The sample is HELD for the composer's mount, not re-derived from the
	 * prompt's visibility (round 1, R3).
	 *
	 * A wiring pin rather than a behavioural one, and the reason is the one
	 * `draft-splash.test.mjs` records at length: `MessageInput` cannot be mounted
	 * in isolation, because it needs a message list, a dispatcher and the
	 * canonical store, so what a rendered composer would prove here is only that
	 * one `useMemo` runs - the claim is about WHICH values it is allowed to
	 * recompute for. Neither the pin nor a mount can say the row does not change
	 * under the user's eye; that is a measurement on the running surface (QA's
	 * resize across `isSmallView`, or the canvas opening and closing).
	 */
	assert.match(
		input,
		/if \(heldSample\.current === null\) \{\s*heldSample\.current = sampleSuggestions\(/,
		"the empty chat's sample is drawn once and held in a ref",
	);
	assert.match(
		input,
		/return heldSample\.current;/,
		"every render after the first returns the held sample, so a gate flip repaints the same four labels",
	);
	assert.equal(
		input.match(/sampleSuggestions\(/g)?.length,
		1,
		"one draw site: a second call anywhere in the composer would sample under the reader again",
	);
	/*
	 * A suggestion press FILLS the composer and does not send (round 1, U1/Q1).
	 *
	 * The handler is bounded by the next declaration rather than by a closing
	 * brace, so a reformat inside it does not move the slice's end off the
	 * function; what the assertions mean is "this handler's whole body", which is
	 * the unit the interaction is.
	 */
	const handlerStart = input.indexOf("const handleSuggestionClick");
	const handlerEnd = input.indexOf("const shortcutText", handlerStart);
	assert.ok(handlerStart > 0 && handlerEnd > handlerStart);
	const handler = input.slice(handlerStart, handlerEnd);
	assert.match(
		handler,
		/setNewMessage\(suggestion\)/,
		"the label lands in the box, so the user reads it before anything leaves",
	);
	assert.doesNotMatch(
		handler,
		/onSendMessage/,
		"the band must not be able to send: a one-press request that opens a PR or rewires the tunnel is not a demo errand",
	);
	/*
	 * The press writes through the HOOK'S OWN SETTER, and that setter is the
	 * persisted one (round 2, M3).
	 *
	 * The alias is the whole of the question: `message-input.tsx` destructures
	 * `setInputValue` from `useMessageInput` as `setNewMessage`, and the hook binds
	 * that key to `handleChange` - the one steady-state writer of the
	 * per-conversation draft - rather than to the `useState` setter of the same
	 * name inside the hook. A reader who sees only the local name cannot tell those
	 * apart; the two assertions below are the pair that does, and the behavioural
	 * half runs in the last test in this file.
	 */
	assert.match(
		input,
		/setInputValue: setNewMessage,/,
		"the handler's `setNewMessage` is the hook's `setInputValue` key, not a setter of its own",
	);
	assert.match(
		readFileSync(`${hooks}use-message-input.ts`, "utf8"),
		/\n\t\tsetInputValue: handleChange,/,
		"and the hook binds that key to `handleChange`, which writes the draft store",
	);
	/*
	 * The two half-steps the typed path takes on the same edge (round 2): the
	 * empty -> non-empty warm, and the caret this file's own convention writes for
	 * a programmatic edit (`applyPlan` above).
	 */
	assert.match(
		handler,
		/if \(!newMessage\) onComposerInput\?\.\(\);/,
		"a press into an empty box is the same first-keystroke edge the textarea fires, so it warms the session too",
	);
	assert.match(
		handler,
		/pendingCaret\.current = suggestion\.length;/,
		"the caret is written with the value rather than left to the browser",
	);
});

/*
 * THE FILL'S WRITE PATH, RUN rather than read (round 2, M3).
 *
 * M3 read `setNewMessage(suggestion)` as a local-state write and concluded that a
 * filled label reaches the box but not the draft store, so it would not survive a
 * composer remount the way a typed sentence does. The alias above is the half of
 * the answer a reader can see; this is the half no reading settles, because the
 * claim is about what the store holds after the call and what a remount seeds from
 * it. So the shipped hook is mounted here against the shipped store and the chip's
 * own call is made: the setter the handler holds, with a real label from the
 * shipped pool, then a fresh mount to read what came back.
 *
 * What this file cannot carry, and does not claim: that `MessageInput` itself is
 * wired this way end to end. It cannot be mounted in isolation (no dispatcher or
 * canonical store in a jsdom fixture - see `draft-splash.test.mjs`), so the last
 * link is the alias assertion above rather than a rendered composer.
 */
test("a filled label reaches the persisted draft and survives a remount", async () => {
	// A real origin: the store persists through `localStorage`, which a document
	// with an opaque one (jsdom's default) throws on rather than stubs.
	const dom = new JSDOM("<div id='root'></div>", {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	const { window } = dom;
	const originals = new Map();
	for (const [key, value] of Object.entries({
		window,
		document: window.document,
		localStorage: window.localStorage,
		HTMLElement: window.HTMLElement,
		IS_REACT_ACT_ENVIRONMENT: true,
	})) {
		originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value,
		});
	}
	const draftKey = "draft-composer-fill";
	const label = DEFAULT_MESSAGE_SUGGESTIONS[2];
	let api = null;
	function Host() {
		api = useMessageInput({
			conversationId: draftKey,
			onSubmit: async () => {},
		});
		return h("textarea", {
			ref: api.textareaRef,
			readOnly: true,
			value: api.inputValue,
		});
	}
	/** A fresh root each time: React cannot re-render an unmounted one. */
	const mount = async () => {
		const root = createRoot(window.document.getElementById("root"));
		await act(async () => root.render(h(Host)));
		await act(async () => {});
		return root;
	};
	let root = null;
	try {
		root = await mount();
		assert.equal(
			api.inputValue,
			"",
			"an empty box to start, which is the only state the chips fill from",
		);
		/*
		 * The handler's own two calls, in its own order - the setter it holds, then
		 * the caret at the end of the label (which the handler writes through
		 * `pendingCaret`, a DOM concern this jsdom fixture does not carry).
		 */
		await act(async () => api.setInputValue(label));
		assert.equal(api.inputValue, label);
		assert.equal(
			useConversationInputStore.getState().getCurrentInput(draftKey),
			label,
			"a filled label must reach the persisted draft, not only the box: this is the write M3 said was missing",
		);
		/*
		 * And the consequence M3's repro is about: leave the conversation and come
		 * back. The box is seeded from the store on mount, so the label is still there
		 * - the same way a typed sentence is.
		 */
		await act(async () => root.unmount());
		root = null;
		root = await mount();
		assert.equal(
			api.inputValue,
			label,
			"a remounted composer seeds from the draft store, so the filled label survives exactly as a typed sentence does",
		);
	} finally {
		if (root) await act(async () => root.unmount());
		window.close();
		for (const [key, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	}
});
