import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, afterEach, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * SESSION VOICE IN THE COMPOSER (design spec `voice-composer/SPEC.md`).
 *
 * WHAT IS MEASURED HERE, and why these four and not more:
 *
 *   1. THE STRIP'S WORDS, one case per state the spec draws: Listening, Hearing
 *      you, Working, Speaking, the two transient words, and the failure that
 *      replaces Pause and History with one action. The view model is derived,
 *      so a state that renders the wrong chip is a wrong derivation rather than
 *      a styling bug - which is the only kind of regression jsdom can tell
 *      apart from nothing at all (it has no layout engine).
 *   2. THE CUT CHIP: it appears only when the spoken reply was cut AND no later
 *      take has started, and pressing it asks the pane to scroll.
 *   3. THE NOTICE: voice held by another conversation draws one band with two
 *      actions, and none of the strip's own controls.
 *   4. THE HISTORY PANEL: collapsed by default, expandable, with the rows the
 *      store has recorded and the empty state when it has none; Escape closes
 *      it and returns focus to its toggle.
 *   5. THE DICTATION RULE: with the slot held, the microphone is
 *      `aria-disabled` - NOT `disabled` (spec §3, so it keeps focus and its
 *      tooltip) - it is dimmed, and a press starts no recorder. Moving the slot
 *      away restores it.
 *
 * WHAT THIS IS NOT: layout, colour, or the rendered contrast of any of it.
 * Those are the contrast contract's (the chip pairs are rows there) and the
 * design round's frames.
 */

const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const liveTimers = [];
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

/*
 * THE COMPOSER NEEDS THE DOCUMENT'S GLOBALS, not just `window`: it reads
 * `HTMLElement` (the focus helpers), `matchMedia` (the density reads) and the
 * observer constructors at mount. The strip alone needs none of them; the
 * dictation cases mount the shipped `MessageInput`, whose bootstrap is the same
 * one `composer-file-drop.test.mjs` documents.
 */
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
	File: window.File,
	FileList: window.FileList,
	FileReader: window.FileReader,
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
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}

Object.defineProperty(window.document, "visibilityState", { value: "hidden" });
Object.defineProperty(window.document, "hidden", { value: true });

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
		invoke: async () => ({ canceled: true, filePaths: [] }),
	},
};

/* The capabilities answer the voice gates read: voice is negotiated. */
window.api = {
	desktop: {
		request: async (request) => {
			if (request?.op === "capabilities") {
				return {
					status: 200,
					body: { result: { desktop_available: true, features: { voice: 1 } } },
				};
			}
			if (request?.op === "voice.status") {
				return {
					status: 200,
					body: {
						result: {
							active: window.__voiceSlot ?? null,
							settings: { max_spoken_chars: 800 },
						},
					},
				};
			}
			return { status: 200, body: { result: {} } };
		},
	},
};

const bundle = await build({
	stdin: {
		contents: `
			export { VoiceComposerStrip, ComposerVoiceButton, composerVoiceView, dictationOffReason } from "./src/renderer/src/features/voice/voice-composer";
			export { useVoiceStore } from "./src/renderer/src/features/voice/voice-store";
			export { applyVoiceActive } from "./src/renderer/src/features/voice/use-voice-status";
			export { MessageInput } from "./src/renderer/src/shared/components/composer/message-input.tsx";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
	loader: { ".css": "empty", ".svg": "text", ".png": "dataurl" },
	define: { "import.meta.env": "{}" },
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	write: false,
});
const bundlePath = new URL(
	`./_voice-composer-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	VoiceComposerStrip,
	ComposerVoiceButton,
	composerVoiceView,
	dictationOffReason,
	MessageInput,
	QueryClient,
	QueryClientProvider,
	applyVoiceActive,
	useVoiceStore,
} = await import(bundlePath.href);
await unlink(bundlePath);

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;

const client = new QueryClient({
	defaultOptions: { queries: { retry: false, gcTime: 0 } },
});

let root = null;

after(() => {
	for (const id of liveTimers) realClearTimeout(id);
	try {
		window.close();
	} catch {
		// jsdom's own teardown.
	}
});

afterEach(async () => {
	await act(async () => {
		root?.unmount();
	});
	root = null;
	window.__voiceSlot = null;
	useVoiceStore.setState({
		active: undefined,
		rig: undefined,
		activity: null,
		exchange: null,
		cardPending: {},
		lastTake: null,
		lastSpoken: null,
		tick: null,
		story: [],
		droppedTakeAt: null,
		pending: false,
		replaced: null,
	});
});

const AT = "a1a1a1a1a1a1";

/** The slot, as the store and the route state it. */
const slot = (sessionId) =>
	sessionId ? { session_id: sessionId, enabled_at: 1_790_000_000_000 } : null;

async function flush() {
	await act(async () => {
		await new Promise((resolve) => realSetTimeout(resolve, 0));
	});
}

async function mountStrip({ sessionId = AT, onScrollToNewest } = {}) {
	window.document.body.innerHTML = "<div id='root'></div>";
	root = createRoot(window.document.getElementById("root"));
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(VoiceComposerStrip, {
					sessionId,
					onScrollToNewest,
				}),
			),
		);
	});
	await flush();
	return window.document;
}

const strip = () => window.document.querySelector("[data-voice-strip]");

/**
 * Open the history panel. The panel's open state is REMEMBERED PER WINDOW
 * (spec §6), and this file is one window, so a case cannot assume it starts
 * closed - it asks the toggle what it is now.
 */
async function openHistory() {
	const toggle = () =>
		window.document.querySelector("[data-voice-history-toggle]");
	if (toggle()?.getAttribute("aria-expanded") === "true") return;
	await act(async () => {
		toggle().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	await flush();
}
const chip = () => window.document.querySelector("[data-voice-chip]");
const caption = () => window.document.querySelector("[data-voice-caption]");
const chipText = () => chip()?.textContent?.trim() ?? null;

/** Put the slot on this session with a ready rig and one connected page. */
async function voiceReady() {
	await act(async () => {
		const store = useVoiceStore.getState();
		store.setActive(slot(AT));
		store.setRig({ rig: "ready", webui_url: null, clients: 1 });
	});
	await flush();
}

/* -------------------------------------------------------------------------- */
/* THE STRIP'S STATES                                                          */
/* -------------------------------------------------------------------------- */

test("listening: the chip and the idle caption, on the accent wash", async () => {
	await mountStrip();
	await voiceReady();
	assert.equal(chipText(), "Listening");
	assert.match(caption().textContent, /Say something/);
	assert.match(chip().className, /bg-accent-wash/);
	assert.match(chip().className, /text-accent/);
});

test("hearing you: the one solid fill, and no caption", async () => {
	await mountStrip();
	await voiceReady();
	await act(async () => {
		useVoiceStore.getState().setActivity("hearing");
	});
	await flush();
	assert.equal(chipText(), "Hearing you");
	assert.match(chip().className, /bg-accent\b/);
	assert.match(chip().className, /text-on-accent/);
	assert.equal(caption(), null, "no partial transcript is available to show");
});

test("working: the take that was heard is the caption", async () => {
	await mountStrip();
	await voiceReady();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.noteTake(AT, "run the tests on the login redirect", Date.now());
		store.setExchange("working", AT);
	});
	await flush();
	assert.equal(chipText(), "Working");
	assert.match(caption().textContent, /You said/);
	assert.match(caption().textContent, /run the tests on the login redirect/);
});

test("speaking: the spoken text is the caption", async () => {
	await mountStrip();
	await voiceReady();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.noteTake(AT, "run the tests", Date.now());
		store.setLastSpoken({
			sessionId: AT,
			text: "Three suites ran.",
			truncated: false,
			at: Date.now(),
		});
		store.setActivity("speaking");
	});
	await flush();
	assert.equal(chipText(), "Speaking");
	assert.match(caption().textContent, /Said/);
	assert.match(caption().textContent, /Three suites ran\./);
});

test("reply ended is a 1.5 s word, then Listening again", async () => {
	await mountStrip();
	await voiceReady();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.setLastSpoken({
			sessionId: AT,
			text: "Three suites ran.",
			truncated: false,
			at: Date.now(),
		});
		store.notePlayback("ended", AT, Date.now());
	});
	await flush();
	assert.equal(chipText(), "Reply ended");
	assert.match(caption().textContent, /Said/);

	/* The same tick, two seconds old: the beat is over and the word is gone. */
	await act(async () => {
		useVoiceStore.setState({
			tick: { kind: "ended", sessionId: AT, at: Date.now() - 2000, text: "x" },
		});
	});
	await flush();
	assert.equal(chipText(), "Listening");
});

test("interrupted says how far into the reply it happened, for 3 s", async () => {
	await mountStrip();
	await voiceReady();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.notePlayback("started", AT, Date.now());
		store.notePlayback("cancelled", AT, Date.now() + 24_000);
	});
	await flush();
	assert.equal(chipText(), "Interrupted");
	assert.match(caption().textContent, /Stopped at 0:24/);

	await act(async () => {
		useVoiceStore.setState({
			tick: {
				kind: "interrupted",
				sessionId: AT,
				at: Date.now() - 3500,
				seconds: 24,
			},
		});
	});
	await flush();
	assert.equal(chipText(), "Listening");
});

test("a failure replaces the actions with one, and names the rig's reason", async () => {
	await mountStrip();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.setActive(slot(AT));
		store.setRig({
			rig: "error",
			webui_url: null,
			reason: "Port 8765 is in use; stop the other voice rig first",
		});
	});
	await flush();
	assert.equal(chipText(), "Voice error");
	assert.match(caption().textContent, /Port 8765 is in use/);
	const action = window.document.querySelector("[data-voice-action]");
	assert.equal(action?.textContent?.trim(), "Try again");
});

test("a blocked microphone offers Open Settings, not Retry", async () => {
	await mountStrip();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.setActive(slot(AT));
		store.setRig({ rig: "ready", webui_url: null, clients: 1, mic: "denied" });
	});
	await flush();
	assert.equal(chipText(), "Microphone blocked");
	assert.match(
		caption().textContent,
		/macOS is not letting Local Operator hear you/,
	);
	const action = window.document.querySelector("[data-voice-action]");
	assert.equal(action?.textContent?.trim(), "Open Settings");
});

test("an approval on screen makes the chip the way to the card", async () => {
	let scrolled = 0;
	await mountStrip({ onScrollToNewest: () => scrolled++ });
	await voiceReady();
	await act(async () => {
		useVoiceStore.getState().setCardPending(AT, true);
	});
	await flush();
	assert.equal(chip()?.tagName, "BUTTON");
	assert.equal(chipText(), "Approve on screen");
	await act(async () => {
		chip().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	assert.equal(scrolled, 1, "pressing the chip asks the pane to scroll");
});

/* -------------------------------------------------------------------------- */
/* THE CUT CHIP                                                                */
/* -------------------------------------------------------------------------- */

test("cut short shows after a cut reply, and the next take retires it", async () => {
	let scrolled = 0;
	await mountStrip({ onScrollToNewest: () => scrolled++ });
	await voiceReady();
	const spokeAt = Date.now();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.noteTake(AT, "summarise the diff", spokeAt - 5000);
		store.setLastSpoken({
			sessionId: AT,
			text: "The diff touches six files.",
			truncated: true,
			at: spokeAt,
		});
	});
	await flush();
	const cut = window.document.querySelector("[data-voice-cut]");
	assert.ok(cut, "the cut chip is up");
	assert.equal(cut.textContent?.trim(), "Cut short · rest above ↑");
	await act(async () => {
		cut.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	assert.equal(scrolled, 1);

	/* A new take starts: the chip is about the reply BEFORE it. */
	await act(async () => {
		useVoiceStore.getState().noteTake(AT, "and the tests", spokeAt + 1000);
	});
	await flush();
	assert.equal(window.document.querySelector("[data-voice-cut]"), null);
});

test("an uncut reply leaves no cut chip", async () => {
	await mountStrip();
	await voiceReady();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.noteTake(AT, "hello", Date.now() - 1000);
		store.setLastSpoken({
			sessionId: AT,
			text: "Hi.",
			truncated: false,
			at: Date.now(),
		});
	});
	await flush();
	assert.equal(window.document.querySelector("[data-voice-cut]"), null);
});

/* -------------------------------------------------------------------------- */
/* THE NOTICE                                                                  */
/* -------------------------------------------------------------------------- */

test("voice on elsewhere is a notice with Move here and Go there, and no strip controls", async () => {
	const other = "b2b2b2b2b2b2";
	await mountStrip();
	await act(async () => {
		useVoiceStore.getState().setActive(slot(other));
	});
	await flush();
	const notice = window.document.querySelector("[data-voice-notice]");
	assert.ok(notice, "the notice is up");
	assert.match(notice.textContent, /Voice is on in/);
	assert.equal(strip(), null, "no strip of this session's own");
	assert.equal(
		window.document.querySelector("[data-voice-history-toggle]"),
		null,
		"no History for a session that does not hold the slot",
	);
	const labels = [...notice.querySelectorAll("button")].map((b) =>
		b.textContent?.trim(),
	);
	assert.deepEqual(labels, ["Move here", "Go there"]);
});

test("the wave button is un-pressed with an accent dot while another session holds voice", async () => {
	window.document.body.innerHTML = "<div id='root'></div>";
	root = createRoot(window.document.getElementById("root"));
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(ComposerVoiceButton, { sessionId: AT }),
			),
		);
	});
	await flush();
	assert.equal(
		window.document
			.querySelector("[data-voice-toggle]")
			?.getAttribute("aria-pressed"),
		"false",
	);
	await act(async () => {
		applyVoiceActive(slot("b2b2b2b2b2b2"), client);
	});
	await flush();
	assert.equal(
		window.document
			.querySelector("[data-voice-toggle]")
			?.getAttribute("data-voice-dot"),
		"elsewhere",
	);
	await act(async () => {
		applyVoiceActive(slot(AT), client);
	});
	await flush();
	assert.equal(
		window.document
			.querySelector("[data-voice-toggle]")
			?.getAttribute("aria-pressed"),
		"true",
	);
	assert.equal(
		window.document
			.querySelector("[data-voice-toggle]")
			?.getAttribute("data-voice-dot"),
		null,
	);
});

/* -------------------------------------------------------------------------- */
/* THE HISTORY PANEL                                                           */
/* -------------------------------------------------------------------------- */

const story = [
	{
		kind: "exchange",
		at: Date.parse("2026-10-18T10:02:00Z"),
		sessionId: AT,
		heard: "Run the tests on the login redirect.",
		spoken: "Three suites ran.",
		truncated: false,
	},
	{
		kind: "interrupted",
		at: Date.parse("2026-10-18T10:05:00Z"),
		sessionId: AT,
		seconds: 24,
	},
];

test("the history panel is collapsed until its toggle is pressed", async () => {
	await mountStrip();
	await voiceReady();
	assert.equal(window.document.querySelector("[data-voice-history]"), null);
	const toggle = window.document.querySelector("[data-voice-history-toggle]");
	assert.equal(toggle?.getAttribute("aria-expanded"), "false");
	await act(async () => {
		toggle.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	await flush();
	assert.ok(window.document.querySelector("[data-voice-history]"));
	assert.equal(
		window.document
			.querySelector("[data-voice-history-toggle]")
			?.getAttribute("aria-expanded"),
		"true",
	);
});

test("the panel lists the exchanges it has, and its empty state when it has none", async () => {
	await mountStrip();
	await voiceReady();
	await act(async () => {
		useVoiceStore.setState({ story: [] });
	});
	await openHistory();
	const panel = window.document.querySelector("[data-voice-history]");
	assert.match(panel.textContent, /Nothing said yet/);

	await act(async () => {
		useVoiceStore.setState({ story });
	});
	await flush();
	const rows = window.document.querySelectorAll("[data-voice-story]");
	assert.equal(rows.length, 2);
	assert.match(rows[0].textContent, /You/);
	assert.match(rows[0].textContent, /Run the tests on the login redirect\./);
	assert.match(rows[1].textContent, /Interrupted at 0:24/);
});

test("Escape closes the panel and returns focus to its toggle", async () => {
	await mountStrip();
	await voiceReady();
	await act(async () => {
		useVoiceStore.setState({ story });
	});
	await openHistory();
	const panel = window.document.querySelector("[data-voice-history]");
	await act(async () => {
		panel.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
			}),
		);
	});
	await flush();
	assert.equal(window.document.querySelector("[data-voice-history]"), null);
	assert.equal(
		window.document.activeElement,
		window.document.querySelector("[data-voice-history-toggle]"),
	);
});

/* -------------------------------------------------------------------------- */
/* THE DICTATION RULE                                                          */
/* -------------------------------------------------------------------------- */

test("the dictation reason names the two cases and the holder's title", () => {
	assert.match(
		dictationOffReason(true, null),
		/Voice is on, so dictation is off/,
	);
	assert.match(dictationOffReason(true, null), /Turn voice off to dictate/);
	assert.match(
		dictationOffReason(false, "Fix login redirect"),
		/Voice is on in “Fix login redirect”/,
	);
	assert.match(dictationOffReason(false, null), /another conversation/);
});

test("voice on here dims the microphone, keeps it focusable, and starts no recorder", async () => {
	let opened = 0;
	window.navigator.mediaDevices = {
		getUserMedia: async () => {
			opened++;
			throw new Error("the rig should own the microphone");
		},
	};
	window.document.body.innerHTML = "<div id='root'></div>";
	root = createRoot(window.document.getElementById("root"));
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(MessageInput, {
					isLoading: false,
					messages: [{ id: "m", role: "system", timestamp: new Date(0) }],
					conversationId: AT,
					onSendMessage: async () => true,
					recordingProbe: { canUseRadientSpeech: true, speechBlock: "none" },
				}),
			),
		);
	});
	await flush();
	await voiceReady();

	const mic = () =>
		window.document.querySelector('button[aria-label="Start recording"]');
	assert.ok(mic(), "the dictation control is on screen");
	assert.equal(mic().getAttribute("aria-disabled"), "true");
	assert.equal(
		mic().hasAttribute("disabled"),
		false,
		"aria-disabled, not the attribute: the control keeps focus and its tooltip",
	);
	assert.match(mic().className, /aria-disabled:text-ink-disabled/);

	await act(async () => {
		mic().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	await flush();
	assert.equal(opened, 0, "no recorder is acquired while voice holds the slot");

	await act(async () => {
		useVoiceStore.getState().setActive(null);
	});
	await flush();
	assert.equal(mic().getAttribute("aria-disabled"), null);
	assert.ok(
		!mic().className.includes("aria-disabled:text-ink-disabled") ||
			mic().getAttribute("aria-disabled") === null,
	);
});

test("voice in ANOTHER session blocks dictation here too", async () => {
	window.navigator.mediaDevices = {
		getUserMedia: async () => {
			throw new Error("the rig should own the microphone");
		},
	};
	window.document.body.innerHTML = "<div id='root'></div>";
	root = createRoot(window.document.getElementById("root"));
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(MessageInput, {
					isLoading: false,
					messages: [{ id: "m", role: "system", timestamp: new Date(0) }],
					conversationId: AT,
					onSendMessage: async () => true,
					recordingProbe: { canUseRadientSpeech: true, speechBlock: "none" },
				}),
			),
		);
	});
	await flush();
	await act(async () => {
		useVoiceStore.getState().setActive(slot("b2b2b2b2b2b2"));
	});
	await flush();
	assert.equal(
		window.document
			.querySelector('button[aria-label="Start recording"]')
			?.getAttribute("aria-disabled"),
		"true",
	);
});

test("a rig that is ready with no page offers Retry, and a stopped one offers Start voice", async () => {
	await mountStrip();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.setActive(slot(AT));
		store.setRig({ rig: "ready", webui_url: null, clients: 0 });
	});
	await flush();
	assert.equal(chipText(), "Voice page not connected");
	assert.equal(
		window.document.querySelector("[data-voice-action]")?.textContent?.trim(),
		"Retry",
	);

	await act(async () => {
		useVoiceStore.getState().setRig({ rig: "stopped", webui_url: null });
	});
	await flush();
	assert.equal(chipText(), "Voice off");
	assert.equal(
		window.document.querySelector("[data-voice-action]")?.textContent?.trim(),
		"Start voice",
	);
});

test("no control in the strip submits the composer it sits inside", async () => {
	await mountStrip();
	await voiceReady();
	await act(async () => {
		useVoiceStore.getState().setCardPending(AT, true);
	});
	await flush();
	await openHistory();
	const controls = [
		...window.document.querySelectorAll("[data-voice-strip] button"),
	];
	assert.ok(controls.length >= 2, "the strip's own controls are on screen");
	for (const control of controls) {
		assert.equal(
			control.getAttribute("type"),
			"button",
			`${control.textContent?.trim() || control.getAttribute("data-voice-chip")} would submit the form`,
		);
	}
});

/* The view model's own answer for the states the DOM cases do not drive. */
test("the view model hides the strip when the slot is empty or belongs elsewhere", () => {
	const base = {
		active: undefined,
		rig: undefined,
		exchange: null,
		activity: null,
		cardPending: {},
		lastTake: null,
		lastSpoken: null,
		tick: null,
	};
	assert.equal(composerVoiceView(base, AT, Date.now()).kind, "off");
	assert.equal(composerVoiceView(base, undefined, Date.now()).kind, "off");
	assert.equal(
		composerVoiceView({ ...base, active: slot("b2b2b2b2b2b2") }, AT, Date.now())
			.kind,
		"elsewhere",
	);
});
