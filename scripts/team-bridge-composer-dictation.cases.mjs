import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * Team Bridge's composer, as a DICTATION surface: the microphone, the recording
 * strip in the control row, and the take that becomes text.
 *
 * WHAT IS MOCKED, stated so nobody reads more into a green run: the microphone
 * and the recorder are `team-bridge-dictation.fixtures.ts`' scripted take, and
 * the transcription relay is that fixture's `desktop.media`. JSDOM has no
 * layout, so this file asserts STRUCTURE - which row the strip lives in, and
 * that the bar holds the same two children in every state - never a height.
 * The heights are measured from the live DOM in the story captures and quoted
 * in the PR body; a JSDOM number here would be an invented one.
 */
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;
/*
 * The preload surface, inert but present: the speech manager registers a
 * keyboard listener through it on mount. The same stand-in the sibling
 * Team Bridge suites state.
 */
dom.window.electron = {
	ipcRenderer: {
		on: () => () => {},
		removeListener: () => {},
		send: () => {},
		invoke: async () => ({}),
	},
};
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
for (const name of [
	"HTMLElement",
	"Element",
	"Node",
	"NodeFilter",
	"MutationObserver",
	"DocumentFragment",
	"CustomEvent",
	"HTMLInputElement",
	"HTMLButtonElement",
	"HTMLTextAreaElement",
	"MouseEvent",
	"KeyboardEvent",
	"FocusEvent",
	"FileReader",
	"Blob",
	"File",
	"Event",
])
	globalThis[name] = dom.window[name];
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (callback) =>
	setTimeout(() => callback(0), 0);
globalThis.cancelAnimationFrame = clearTimeout;
/*
 * JSDOM'S `File` HAS NO `arrayBuffer`, which the transcription client calls
 * before handing bytes to the relay. A shim is honest here: the fixture's relay
 * reads no bytes, so what is under test is the CALL, not the encoding.
 */
class FileShim {
	constructor(parts, name, options = {}) {
		this.name = name;
		this.type = options.type ?? "";
		const blob = new dom.window.Blob(parts, options);
		this.size = blob.size;
	}
	async arrayBuffer() {
		return new ArrayBuffer(0);
	}
}
globalThis.File = FileShim;

/*
 * THE RELAY THE FIXTURE REPLACES HAS TO EXIST FIRST: `installDictationFixture`
 * patches `window.api.desktop.media`, and a renderer with no `api` at all
 * would silently take the fixture's other arm and post to a dev proxy that
 * JSDOM does not have.
 */
dom.window.api = { desktop: {} };

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");

const sidebarRole = readFileSync(
	"src/renderer/src/features/chat/components/chat-sidebar.tsx",
	"utf8",
).match(/export const rowCurrent =\s*("[^"]+")/)?.[1];
assert.ok(sidebarRole);
const bundle = await build({
	stdin: {
		contents: `export {TeamBridgeComposer} from "./src/renderer/src/features/team-bridge/team-bridge-composer";
 export {installDictationFixture} from "./src/renderer/src/features/team-bridge/team-bridge-dictation.fixtures";
 export {useConversationInputStore} from "./src/renderer/src/shared/store/conversation-input-store";
 export {QueryClient, QueryClientProvider} from "@tanstack/react-query";
 export {setLocale} from "./src/i18n";
 export {resolvePushToTalkBinding} from "./src/renderer/src/shared/hooks/use-speech-to-text-manager";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	external: ["@tanstack/react-query", "react", "react-dom"],
	define: { "import.meta.env": "__viteEnv" },
	banner: { js: "const __viteEnv = {};" },
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
	plugins: [
		{
			name: "chat-sidebar-stub",
			setup(plugin) {
				plugin.onResolve({ filter: /chat\/components\/chat-sidebar$/ }, () => ({
					path: "sidebar-role",
					namespace: "stub",
				}));
				plugin.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
					contents: `export const rowCurrent = ${sidebarRole};`,
					loader: "js",
				}));
			},
		},
	],
	tsconfig: "tsconfig.app.json",
	write: false,
});
const compiledPath = `${process.cwd()}/scripts/team-bridge-composer-dictation-runtime.cjs`;
const compiled = new Module(compiledPath);
compiled.filename = compiledPath;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const m = compiled.exports;
m.setLocale("en");

const CONVERSATION = "dictation-test-row";

let service;
let container;
let root;
let restore = () => {};

const mount = async (outcome, onSendMessage = () => true) => {
	restore = m.installDictationFixture(outcome);
	service = new m.QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => {
		root.render(
			React.createElement(
				m.QueryClientProvider,
				{ client: service },
				React.createElement(m.TeamBridgeComposer, {
					conversationId: CONVERSATION,
					placeholder: "Message",
					canAttach: true,
					recordingProbe: {
						canUseRadientSpeech: true,
						speechBlock: "checking",
					},
					onSendMessage,
				}),
			),
		);
	});
};

const mic = () =>
	container.querySelector('button[aria-label="Start recording"]');

const controls = () => container.querySelector("[data-composer-controls]");
const strip = () => container.querySelector("[data-dictation-strip]");
const bar = () => container.querySelector("[data-composer-bar]");

/*
 * JSDOM HAS NO PointerEvent, and React's `onPointerDown`/`onPointerUp` are plain
 * listeners on those event names - so a MouseEvent carrying `pointerId` is the
 * same dispatch the browser makes, without an engine jsdom does not ship.
 */
const pointer = (type) => {
	const event = new dom.window.MouseEvent(type, { bubbles: true, button: 0 });
	Object.defineProperty(event, "pointerId", { value: 1 });
	return event;
};

/** A press a reader makes: a tap, so the take stays live. */
const pressMic = async () => {
	await act(async () => {
		mic().dispatchEvent(pointer("pointerdown"));
		mic().dispatchEvent(pointer("pointerup"));
	});
};

const click = async (element) => {
	await act(async () => {
		element.dispatchEvent(
			new dom.window.MouseEvent("click", { bubbles: true }),
		);
	});
};

beforeEach(() => {
	m.useConversationInputStore.setState({ inputByConversation: {} });
});

afterEach(async () => {
	if (root) await act(async () => root.unmount());
	container?.remove();
	restore();
	root = undefined;
	container = undefined;
});

test("the idle bar carries a microphone and NO recording strip", async () => {
	await mount({ kind: "text", text: "" });
	assert.ok(mic(), "the idle bar offers a microphone");
	assert.equal(
		strip(),
		null,
		"no strip stands in the bar while nothing is recording",
	);
	/*
	 * THE BAR IS TWO CHILDREN AT REST - the field and the control row. The bar
	 * must not grow a third: that reserved row under the composer is the dead
	 * strip the operator reported, and it is invisible at rest by construction.
	 */
	assert.deepEqual(
		[...bar().children].map((child) => child.tagName.toLowerCase()),
		["textarea", "div"],
	);
});

test("a press puts the strip INSIDE the control row, not under the bar", async () => {
	await mount({ kind: "pending" });
	await pressMic();
	const live = strip();
	assert.ok(live, "the recording strip is up");
	assert.equal(
		live.parentElement,
		controls(),
		"the strip occupies the control row; it is not a row of its own",
	);
	assert.match(live.textContent ?? "", /Recording/);
	assert.match(
		live.textContent ?? "",
		/\d:\d\d/,
		"the strip carries the elapsed reading",
	);
	assert.ok(
		container.querySelector('button[aria-label="Confirm recording"]'),
		"the strip offers Confirm",
	);
	assert.ok(
		container.querySelector('button[aria-label="Cancel recording"]'),
		"the strip offers Cancel",
	);
	// The bar still holds exactly the field and the control row.
	assert.equal(bar().children.length, 2);
});

test("cancel discards the take: no transcription, no text, strip gone", async () => {
	let requests = 0;
	await mount({ kind: "text", text: "should never arrive" });
	const bridge = globalThis.window;
	const original = bridge.api?.desktop?.media;
	if (bridge.api?.desktop)
		bridge.api.desktop.media = async (...args) => {
			requests += 1;
			return original(...args);
		};
	await pressMic();
	await click(container.querySelector('button[aria-label="Cancel recording"]'));
	assert.equal(strip(), null, "the strip is gone");
	assert.equal(requests, 0, "a cancelled take is never sent");
});

test("confirm transcribes the take and fills the field", async () => {
	await mount({ kind: "text", text: "Ship it after the review." });
	await pressMic();
	/*
	 * THE CLIP FLOOR IS REAL TIME, not a story convenience: a take shorter than
	 * 250 ms is the tail of a press that was never speech.
	 */
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 300));
	});
	await click(
		container.querySelector('button[aria-label="Confirm recording"]'),
	);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 120));
	});
	const field = container.querySelector("textarea");
	assert.equal(field.value, "Ship it after the review.");
	assert.equal(strip(), null, "the strip retires with the take");
});

/*
 * PUSH-TO-TALK, through the chord and not the button. The operator asked for
 * the mic, the strip AND push-to-talk; the cases above press the button only,
 * so a composer that dropped its `useSpeechToTextManager` registration would
 * still pass them. This one dispatches the RESOLVED binding (whatever the
 * keymap registry answers, the platform default here) on the window the way
 * the manager's capture-phase listener receives it: keydown starts a take and
 * puts the strip in the control row, keyup ends it.
 */
test("the push-to-talk chord starts a take in the control row and its release ends it", async () => {
	await mount({ kind: "text", text: "Held and spoken." });
	const { code, key } = m.resolvePushToTalkBinding();
	const press = async (type) => {
		await act(async () => {
			window.dispatchEvent(
				new dom.window.KeyboardEvent(type, { bubbles: true, code, key }),
			);
		});
	};
	await press("keydown");
	const live = strip();
	assert.ok(live, "the chord opens the recording strip");
	assert.equal(live.parentElement, controls(), "in the control row");
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 300));
	});
	await press("keyup");
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 120));
	});
	assert.equal(strip(), null, "the release retires the strip");
	assert.equal(
		container.querySelector("textarea").value,
		"Held and spoken.",
		"the held take is transcribed into the field",
	);
});

// A live microphone take owns Enter even when the user left a typed draft in
// the focused field. Otherwise useMessageInput sends before the window-level
// dictation handler sees the already-prevented event (review R1).
for (const draft of ["", "typed draft"]) {
	test(`Enter confirms microphone dictation without sending (${draft || "empty draft"})`, async () => {
		const sent = [];
		m.useConversationInputStore.getState().setComposerText(CONVERSATION, draft);
		await mount({ kind: "text", text: "spoken words" }, (text) => {
			sent.push(text);
			return true;
		});
		await pressMic();
		const field = container.querySelector("textarea");
		field.focus();
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 300));
		});
		await act(async () => {
			field.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 120));
		});
		assert.deepEqual(
			sent,
			[],
			"dictation Enter must never submit the typed draft",
		);
		assert.equal(strip(), null, "the confirmed take is no longer recording");
		assert.match(
			field.value,
			/spoken words/,
			"the confirmed transcript reaches the draft",
		);
		if (draft)
			assert.ok(
				field.value.includes(draft),
				"the typed draft survives confirmation",
			);
	});
}

test("idle Enter still submits while Shift+Enter remains a newline", async () => {
	const sent = [];
	m.useConversationInputStore
		.getState()
		.setComposerText(CONVERSATION, "ordinary draft");
	await mount({ kind: "text", text: "" }, (text) => {
		sent.push(text);
		return true;
	});
	const field = container.querySelector("textarea");
	field.focus();
	const newline = new dom.window.KeyboardEvent("keydown", {
		key: "Enter",
		shiftKey: true,
		bubbles: true,
		cancelable: true,
	});
	await act(async () => {
		field.dispatchEvent(newline);
	});
	assert.equal(
		newline.defaultPrevented,
		false,
		"the browser may insert a newline (JSDOM has no editing default)",
	);
	assert.deepEqual(sent, []);
	await act(async () => {
		field.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	assert.deepEqual(sent, ["ordinary draft"]);
});

test("IME Enter does not confirm a microphone take or submit its draft", async () => {
	const sent = [];
	m.useConversationInputStore
		.getState()
		.setComposerText(CONVERSATION, "IME draft");
	await mount({ kind: "text", text: "spoken words" }, (text) => {
		sent.push(text);
		return true;
	});
	await pressMic();
	const field = container.querySelector("textarea");
	field.focus();
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 300));
	});
	await act(async () => {
		field.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
				isComposing: true,
			}),
		);
	});
	assert.ok(strip(), "IME confirmation leaves recording active");
	assert.deepEqual(sent, [], "IME confirmation sends nothing");
	await click(container.querySelector('button[aria-label="Cancel recording"]'));
});

// JSDOM has no layout: this checks the resize-trigger contract against
// synthetic scrollHeight, not rendered wrapping. QA's real frames prove pixels.
test("width-only resize remeasures, widens back, caps, and disconnects on unmount", async () => {
	const originalObserver = globalThis.ResizeObserver;
	const proto = dom.window.HTMLTextAreaElement.prototype;
	const originalHeight = Object.getOwnPropertyDescriptor(proto, "scrollHeight");
	const originalRect = proto.getBoundingClientRect;
	let width = 1248;
	let disconnected = false;
	let observedNode;
	let callback;
	let measures = 0;
	const rect = () => ({ width });
	proto.getBoundingClientRect = rect;
	Object.defineProperty(proto, "scrollHeight", {
		configurable: true,
		get() {
			measures++;
			return width < 400 ? 156 : 56;
		},
	});
	globalThis.ResizeObserver = class {
		constructor(fn) {
			callback = fn;
		}
		observe(node) {
			observedNode = node;
		}
		disconnect() {
			disconnected = true;
		}
	};
	try {
		m.useConversationInputStore
			.getState()
			.setComposerText(CONVERSATION, "unchanged wrapping draft");
		await mount({ kind: "text", text: "" });
		const field = container.querySelector("textarea");
		assert.ok(
			observedNode === field,
			"observe the mounted textarea, not its container",
		);
		assert.equal(field.style.height, "56px");
		assert.equal(
			typeof callback,
			"function",
			"the actual textarea width must be observed",
		);
		width = 328;
		await act(async () => {
			callback([]);
		});
		assert.equal(field.style.height, "136px");
		assert.equal(field.style.overflowY, "auto");
		const count = measures;
		await act(async () => {
			callback([]);
		});
		assert.equal(
			measures,
			count,
			"height-only observer notification must not feed back into measurement",
		);
		width = 1248;
		await act(async () => {
			callback([]);
		});
		assert.equal(field.style.height, "56px");
		assert.equal(field.style.overflowY, "hidden");
		assert.equal(
			field.value,
			"unchanged wrapping draft",
			"no input event needed",
		);
		await act(async () => {
			root.unmount();
		});
		root = undefined;
		assert.equal(disconnected, true);
		const finalCount = measures;
		width = 328;
		callback([]);
		assert.equal(
			measures,
			finalCount,
			"queued stale callbacks cannot measure after cleanup",
		);
	} finally {
		globalThis.ResizeObserver = originalObserver;
		proto.getBoundingClientRect = originalRect;
		if (originalHeight)
			Object.defineProperty(proto, "scrollHeight", originalHeight);
		else Reflect.deleteProperty(proto, "scrollHeight");
	}
});
