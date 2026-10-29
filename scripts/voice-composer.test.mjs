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
/* What the strip's two controls call; replaced per case by `controls()`. */
let controlCalls = [];
const controlStatus = (patch) => ({
	rig: "ready",
	webui_url: null,
	clients: 1,
	paused: false,
	muted: false,
	...patch,
});
const installControls = (start = {}) => {
	controlCalls = [];
	window.api = {
		...window.api,
		desktop: {
			...(window.api.desktop ?? {}),
			qwenVoice: {
				pause: async () => {
					controlCalls.push(["pause"]);
					return controlStatus({ ...start, paused: true });
				},
				resume: async () => {
					controlCalls.push(["resume"]);
					return controlStatus({ ...start, paused: false });
				},
				setMuted: async (muted) => {
					controlCalls.push(["mute", muted]);
					return controlStatus({ ...start, muted });
				},
				start: async () => {
					controlCalls.push(["start"]);
					return controlStatus({ ...start, rig: "starting" });
				},
			},
		},
	};
};

window.api = {
	desktop: {
		request: async (request) => {
			if (request?.op === "capabilities") {
				return {
					status: 200,
					body: { result: { desktop_available: true, features: { voice: 1 } } },
				};
			}
			if (request?.op === "voice.control") {
				return {
					status: 200,
					body: {
						result: {
							active:
								request.action === "enable"
									? { session_id: request.sessionId, enabled_at: Date.now() }
									: null,
							replaced: null,
						},
					},
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
			export { VoiceComposerStrip, ComposerVoiceButton, composerVoiceView, dictationOffReason, storyTime, localStatusText } from "./src/renderer/src/features/voice/voice-composer";
			export { useVoiceStore } from "./src/renderer/src/features/voice/voice-store";
			export { applyVoiceActive, controlVoice } from "./src/renderer/src/features/voice/use-voice-status";
			export { MessageInput } from "./src/renderer/src/shared/components/composer/message-input.tsx";
			export { useVoiceSwitchStore } from "./src/renderer/src/features/voice/use-voice-switch";
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
	storyTime,
	localStatusText,
	controlVoice,
	MessageInput,
	QueryClient,
	QueryClientProvider,
	applyVoiceActive,
	useVoiceStore,
	useVoiceSwitchStore,
} = await import(bundlePath.href);
await unlink(bundlePath);
// The switch is OFF by default; these cases are about voice ON.
useVoiceSwitchStore.setState({ enabled: true });

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

async function mountStrip({
	sessionId = AT,
	onScrollToNewest,
	isSmallView = false,
} = {}) {
	/*
	 * ONE ROOT AT A TIME: a test that mounts a second strip (the width pair)
	 * would otherwise leave the first root live, and a React root nobody unmounts
	 * keeps this process from exiting after the assertions have run.
	 */
	if (root) {
		await act(async () => {
			root.unmount();
		});
		root = null;
	}
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
					isSmallView,
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
		/* An end FOLLOWS a start; an end with no start is not a word (U3). */
		store.notePlayback("started", AT, Date.now() - 3000);
		store.notePlayback("ended", AT, Date.now());
	});
	await flush();
	assert.equal(chipText(), "Reply ended");
	assert.match(caption().textContent, /Said/);
	/* D6: the finished register, not the live accent wash Speaking wears. */
	assert.match(chip().className, /bg-surface/);
	assert.doesNotMatch(chip().className, /bg-accent-wash/);

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
/* DESIGN ROUND 1 / UX ROUND 1                                                 */
/* -------------------------------------------------------------------------- */

test("D1: a history row prints a clock, and its cell sizes itself", async () => {
	// The formatter: Intl's bare default is a DATE, which is what every row showed.
	assert.match(
		storyTime(Date.parse("2026-10-18T22:18:00Z")),
		/^\d{1,2}:\d{2}\s?[ap]m$/i,
	);
	assert.equal(
		storyTime(Number.NaN),
		"",
		"no wrong day for an unreadable stamp",
	);

	await mountStrip();
	await voiceReady();
	await act(async () => {
		useVoiceStore.setState({ story });
	});
	await openHistory();
	const row = window.document.querySelector('[data-voice-story="exchange"]');
	const cell = row.firstElementChild;
	assert.match(cell.textContent, /^\d{1,2}:\d{2}\s?[ap]m$/i);
	assert.doesNotMatch(cell.textContent, /2026|\//, "no date in the row");
	// A fixed 42px column is what overflowed; the column takes its own width now.
	assert.match(row.className, /grid-cols-\[auto_1fr\]/);
	assert.doesNotMatch(row.className, /42px/);
	assert.match(cell.className, /whitespace-nowrap/);
});

test("D4: the strip, its history and the notice share the composer's content column", async () => {
	await mountStrip();
	await voiceReady();
	const band = window.document.querySelector("[data-voice-strip]");
	assert.match(band.className, /\bpx-4\b/);
	assert.doesNotMatch(band.className, /px-2\.5/);

	await act(async () => {
		applyVoiceActive(slot("b2b2b2b2b2b2"), client);
	});
	await flush();
	const notice = window.document.querySelector("[data-voice-notice]");
	assert.match(notice.className, /\bpx-4\b/);
});

test("D8: the History chevron points down when closed and up when open", async () => {
	await mountStrip();
	await voiceReady();
	const toggle = () =>
		window.document.querySelector("[data-voice-history-toggle]");
	/* The panel's open state is remembered per window, so close it if a prior case left it open. */
	if (toggle().getAttribute("aria-expanded") === "true") {
		await act(async () => {
			toggle().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		});
		await flush();
	}
	// The glyph's own path, so the assertion is about direction, not class names.
	assert.match(toggle().innerHTML, /m6 9 6 6 6-6/, "closed: points down");
	await openHistory();
	assert.match(toggle().innerHTML, /m18 15-6-6-6 6/, "open: points up");
	assert.doesNotMatch(toggle().innerHTML, /m6 9 6 6 6-6/);
});

test("D11: at the narrow width the band pays back the composer's own 8px, so the chip shares the textarea's x", async () => {
	/*
	 * jsdom has no layout engine, so an x cannot be read here. What CAN be
	 * asserted is the arithmetic an x is made of: the band pulls itself left by
	 * the box's padding and then pads its content by the same amount, so content
	 * starts at box.x + padding - the textarea's own line. The failure D11
	 * measured was exactly a mismatch of those two numbers (16px pulled back over
	 * an 8px-padded box, so the band hung 8px out and the chip started 8px left
	 * of the textarea). Both come from `isSmallView`, so both are checked at both
	 * values.
	 */
	const pxOf = (className, pattern) => {
		const found = pattern.exec(className);
		return found ? Number(found[1]) * 4 : null;
	};
	for (const narrow of [true, false]) {
		await mountStrip({ isSmallView: narrow });
		await voiceReady();
		const band = window.document.querySelector("[data-voice-band]");
		const row = window.document.querySelector("[data-voice-strip]");
		assert.ok(band && row);
		const pulled = pxOf(band.className, /(?:^|\s)-mx-(\d)(?:\s|$)/);
		const padded = pxOf(row.className, /(?:^|\s)px-(\d)(?:\s|$)/);
		assert.equal(
			pulled,
			narrow ? 8 : 16,
			`${narrow ? "narrow" : "wide"}: the band pulls back the box's padding`,
		);
		assert.equal(
			padded,
			narrow ? 8 : 16,
			`${narrow ? "narrow" : "wide"}: and puts it back on the content`,
		);
		assert.equal(
			pulled,
			padded,
			"the two must match, or the content column leaves the textarea's",
		);
		assert.ok(
			band.className.includes(narrow ? "-mx-2" : "-mx-4"),
			`${narrow ? "narrow" : "wide"}: the responsive pair, not a hardcoded edge`,
		);
	}
});

test("D2: the first frame of an enable is Starting voice, never the stale rig status", async () => {
	installControls();
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

	let enabling;
	await act(async () => {
		enabling = controlVoice("enable", AT, client);
	});
	assert.equal(
		chipText(),
		"Starting voice",
		"the press paints the neutral word before the route answers",
	);
	await act(async () => {
		await enabling;
	});
	await flush();
	assert.equal(chipText(), "Starting voice");
});

test("D5: the lit wave on a stopped rig starts it instead of turning voice off", async () => {
	installControls();
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
	await act(async () => {
		applyVoiceActive(slot(AT), client);
		useVoiceStore
			.getState()
			.setRig(controlStatus({ rig: "stopped", clients: 0 }));
	});
	await flush();
	const wave = window.document.querySelector("[data-voice-toggle]");
	assert.equal(
		wave.getAttribute("aria-pressed"),
		"true",
		"the slot is still held",
	);
	assert.equal(wave.getAttribute("aria-label"), "Start voice");
	await act(async () => {
		wave.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	await flush();
	assert.deepEqual(
		controlCalls,
		[["start"]],
		"not disable: the wave is the way back in",
	);
});

test("D7: a muted reply says Silenced, and the mute face is not the live accent", async () => {
	installControls();
	await mountStrip();
	await voiceReady();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.setRig(controlStatus({ muted: true }));
		store.setActivity("speaking");
	});
	await flush();
	assert.equal(chipText(), "Silenced");
	assert.match(caption().textContent, /on screen/);
	const mute = window.document.querySelector("[data-voice-mute]");
	assert.equal(mute.getAttribute("aria-pressed"), "true");
	/*
	 * N4: the quiet face is an ink mix with the BAND's ground in both themes.
	 * `bg-surface` was right in dark and near-white in light, where a silenced
	 * strip pointed at the one control that is doing nothing.
	 */
	assert.match(
		mute.className,
		/aria-pressed:bg-\[color-mix\(in_oklab,var\(--color-sunken\)_92%,var\(--color-ink\)\)\]/,
	);
	assert.doesNotMatch(
		mute.className,
		/aria-pressed:bg-surface/,
		"surface is near-white in the light theme",
	);
	assert.doesNotMatch(
		mute.className,
		/aria-pressed:bg-\[color-mix\(in_oklab,var\(--color-accent-wash\)/,
		"the live accent wash is the wave's register, not a muted control's",
	);
});

test("U1: a take refused by a card says so in place, with the words it dropped", async () => {
	await mountStrip();
	await voiceReady();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.setCardPending(AT, true);
		store.noteNotSent(AT, "please also check the tests", Date.now());
	});
	await flush();
	assert.equal(chipText(), "Approve on screen");
	assert.match(
		caption().textContent,
		/Answer the question or approval on screen first/,
	);
	assert.match(caption().textContent, /please also check the tests/);
});

test("U5: focus returns to the same control after Resume", async () => {
	installControls({ rig: "starting" });
	await mountStrip();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.setActive(slot(AT));
		store.setRig(controlStatus({ paused: true }));
	});
	await flush();
	const resume = window.document.querySelector('[data-voice-action="resume"]');
	resume.focus();
	assert.equal(window.document.activeElement, resume);
	await act(async () => {
		resume.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	await flush();
	/*
	 * The resume answer is "Starting voice": the Pause/Resume control is not drawn
	 * in that state, so the button the press landed on is gone.
	 */
	assert.equal(
		window.document.querySelector('[data-voice-action="pause"]'),
		null,
	);
	await act(async () => {
		useVoiceStore.getState().setRig(controlStatus());
	});
	await flush();
	const pause = window.document.querySelector('[data-voice-action="pause"]');
	assert.ok(pause);
	assert.equal(
		window.document.activeElement,
		pause,
		"focus came back to the toggle it left",
	);
});

test("U6: Escape closes History from anywhere in the composer, not only the band", async () => {
	window.document.body.innerHTML = "<div id='root'></div>";
	const composer = window.document.createElement("form");
	composer.setAttribute("data-chat-region", "composer");
	composer.innerHTML =
		"<textarea data-test-field></textarea><div id='strip'></div>";
	window.document.getElementById("root").appendChild(composer);
	root = createRoot(window.document.getElementById("strip"));
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(VoiceComposerStrip, { sessionId: AT }),
			),
		);
	});
	await flush();
	await voiceReady();
	await act(async () => {
		useVoiceStore.setState({ story });
	});
	await openHistory();
	assert.ok(window.document.querySelector("[data-voice-history]"));
	const field = composer.querySelector("[data-test-field]");
	await act(async () => {
		field.dispatchEvent(
			new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});
	await flush();
	assert.equal(window.document.querySelector("[data-voice-history]"), null);
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
	assert.match(
		dictationOffReason(true, null),
		/Pause voice or turn it off to dictate/,
	);
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
					recordingProbe: { canUseRadientSpeech: true, speechBlock: "checking" },
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
	/* D3: the ink step alone measured pixel-identical in the trial. */
	assert.match(mic().className, /aria-disabled:opacity-50/);

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

test("paused releases the microphone, so dictation comes back", async () => {
	window.navigator.mediaDevices = {
		getUserMedia: async () => {
			throw new Error("paused is not a press");
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
					recordingProbe: { canUseRadientSpeech: true, speechBlock: "checking" },
				}),
			),
		);
	});
	await flush();
	const mic = () =>
		window.document.querySelector('button[aria-label="Start recording"]');
	await act(async () => {
		useVoiceStore.getState().setActive(slot(AT));
		useVoiceStore
			.getState()
			.setRig({ rig: "ready", webui_url: null, clients: 1 });
	});
	await flush();
	assert.equal(mic().getAttribute("aria-disabled"), "true");

	/* Pause: the hidden page is closed, so voice no longer owns the mic. */
	await act(async () => {
		useVoiceStore
			.getState()
			.setRig({ rig: "ready", webui_url: null, clients: 0, paused: true });
	});
	await flush();
	assert.equal(
		mic().getAttribute("aria-disabled"),
		null,
		"a paused voice leaves dictation usable",
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
					recordingProbe: { canUseRadientSpeech: true, speechBlock: "checking" },
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

test("a fresh ready rig connects neutrally; past the grace it offers Retry; stopped says Voice idle", async () => {
	await mountStrip();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.setActive(slot(AT));
		store.setRig({ rig: "ready", webui_url: null, clients: 0 });
	});
	await flush();
	/*
	 * D2/U8: the page connects ~200 ms after the models are up. That window is
	 * "Connecting voice" - a neutral word with no action - not the red failure.
	 */
	assert.equal(chipText(), "Connecting voice");
	assert.equal(
		window.document.querySelector("[data-voice-action]"),
		null,
		"a start in progress offers nothing to press",
	);

	await act(async () => {
		/* The grace expires with no page: now it is the failure it names. */
		useVoiceStore.setState({ readyAt: Date.now() - 10_000 });
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
	/*
	 * D5: the slot is still held, so the chip may not say "off" while the wave is
	 * lit - and the lit wave is the way back in, not a second action here.
	 */
	assert.equal(chipText(), "Voice idle");
	assert.equal(window.document.querySelector("[data-voice-action]"), null);
});

test("paused: the chip says Paused and its control is Resume", async () => {
	installControls();
	await mountStrip();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.setActive(slot(AT));
		store.setRig(controlStatus({ paused: true }));
	});
	await flush();
	assert.equal(chipText(), "Paused");
	const resume = window.document.querySelector('[data-voice-action="resume"]');
	assert.ok(resume, "the paused strip offers Resume");
	assert.equal(resume.getAttribute("aria-label"), "Resume voice");
	assert.equal(
		window.document.querySelector('[data-voice-action="pause"]'),
		null,
		"Pause is replaced, not shown beside its own opposite",
	);

	await act(async () => {
		resume.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	await flush();
	assert.deepEqual(controlCalls, [["resume"]]);
	assert.equal(chipText(), "Listening", "resume goes back to the ready word");
});

test("pause is offered while listening, and pressing it asks main", async () => {
	installControls();
	await mountStrip();
	await voiceReady();
	const pause = window.document.querySelector('[data-voice-action="pause"]');
	assert.ok(pause, "a listening strip offers Pause");
	assert.equal(pause.getAttribute("aria-label"), "Pause voice");
	await act(async () => {
		pause.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	await flush();
	assert.deepEqual(controlCalls, [["pause"]]);
	assert.equal(chipText(), "Paused", "the answer is mirrored at once");
});

test("the mute toggle names what it silences, and is pressed while muted", async () => {
	installControls();
	await mountStrip();
	await voiceReady();
	const mute = () => window.document.querySelector("[data-voice-mute]");
	assert.equal(mute().getAttribute("data-voice-mute"), "off");
	assert.equal(mute().getAttribute("aria-label"), "Silence the voice");
	await act(async () => {
		mute().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	await flush();
	assert.deepEqual(controlCalls, [["mute", true]]);
	assert.equal(mute().getAttribute("data-voice-mute"), "on");
	assert.equal(mute().getAttribute("aria-pressed"), "true");
	assert.equal(mute().getAttribute("aria-label"), "Hear the voice again");
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
test("QA round 3 Q-1: the mic prompt and denial are app-global, drawn with the slot elsewhere", () => {
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
	// The start case: the slot has not moved, so there is no holder at all.
	const prompting = {
		...base,
		rig: { rig: "stopped", webui_url: null, mic: "prompting" },
	};
	const view = composerVoiceView(prompting, AT, Date.now());
	assert.equal(view.kind, "here", "a live OS dialog is not the idle strip");
	assert.equal(view.chip, "waiting_mic");
	assert.equal(view.action, "settings");
	// The slot on another session does not hide it.
	const elsewhere = { ...base, active: slot("b2b2b2b2b2b2") };
	const other = composerVoiceView(
		{ ...elsewhere, rig: prompting.rig },
		AT,
		Date.now(),
	);
	assert.equal(other.kind, "here");
	assert.equal(other.chip, "waiting_mic");
	assert.equal(other.action, "settings");
	// Denied is the same app-wide fact, with Open Settings.
	const blocked = composerVoiceView(
		{
			...elsewhere,
			rig: { rig: "ready", webui_url: null, clients: 1, mic: "denied" },
		},
		AT,
		Date.now(),
	);
	assert.equal(blocked.kind, "here");
	assert.equal(blocked.chip, "mic_blocked");
	assert.equal(blocked.action, "settings");
	// Without a mic condition the same state is the elsewhere notice again.
	assert.equal(
		composerVoiceView(
			{ ...elsewhere, rig: { rig: "ready", webui_url: null, clients: 1 } },
			AT,
			Date.now(),
		).kind,
		"elsewhere",
	);
});

test("QA round 3 Q-1: the strip renders the mic band while the slot is elsewhere", async () => {
	await mountStrip();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.setActive(slot("b2b2b2b2b2b2"));
		store.setRig({ rig: "stopped", webui_url: null, mic: "prompting" });
	});
	await flush();
	assert.equal(chipText(), "Waiting for microphone permission…");
	assert.equal(
		window.document.querySelector("[data-voice-action]")?.textContent?.trim(),
		"Open Settings",
	);
	await act(async () => {
		useVoiceStore.getState().setRig({
			rig: "ready",
			webui_url: null,
			clients: 1,
			mic: "denied",
		});
	});
	await flush();
	assert.equal(chipText(), "Microphone blocked");
	assert.equal(
		window.document.querySelector("[data-voice-action]")?.textContent?.trim(),
		"Open Settings",
	);
});

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

test("SWITCH: with the switch off the wave button does not render", async () => {
	useVoiceSwitchStore.setState({ enabled: false });
	try {
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
		assert.equal(window.document.querySelector("[data-voice-toggle]"), null);
	} finally {
		useVoiceSwitchStore.setState({ enabled: true });
	}
});

/* ----------------------- S3: the local provider's statuses ---------------- */

test("S3: each local status and the download notice render their own copy", async () => {
	const base = (rig) => ({
		active: { session_id: "aaaaaaaaaaaa", enabled_at: 1 },
		rig,
		exchange: null,
		activity: null,
		cardPending: {},
		lastTake: null,
		lastSpoken: null,
		lastRefused: null,
		muted: false,
		readyAt: null,
		tick: null,
	});
	const view = (rig) =>
		composerVoiceView(base(rig), "aaaaaaaaaaaa", Date.now());
	assert.deepEqual(
		view({ rig: "stopped", webui_url: null, notice: "download_models" }),
		{
			kind: "download_notice",
		},
	);
	const dl = view({
		rig: "starting",
		webui_url: null,
		local: { code: "models_downloading", progress: 0.42 },
	});
	assert.deepEqual(dl.caption, { kind: "downloading", percent: 42 });
	for (const code of [
		"models_offline",
		"model_integrity",
		"mic_unavailable",
		"listening_failed",
	]) {
		const v = view({ rig: "error", webui_url: null, local: { code } });
		assert.equal(v.chip, "error", code);
		assert.equal(
			v.action,
			code === "mic_unavailable" ? "settings_retry" : "try_again",
			code,
		);
		assert.equal(v.caption.kind, "reason");
		assert.match(v.caption.text, /\S/);
	}
	const slow = view({
		rig: "ready",
		webui_url: null,
		clients: 1,
		local: { code: "speech_too_slow" },
	});
	assert.equal(slow.chip, "listening", "still listening");
	assert.deepEqual(slow.caption, { kind: "speech_slow" });
	// Six distinct sentences, and the speed one is the plan's words.
	const texts = new Set(
		[
			"models_offline",
			"model_integrity",
			"mic_unavailable",
			"listening_failed",
			"speech_too_slow",
		].map((code) => localStatusText({ code })),
	);
	assert.equal(texts.size, 5);
	assert.equal(
		localStatusText({ code: "speech_too_slow" }),
		"Too slow to speak here — replies stay on screen. Still listening.",
	);
	// A mic_unavailable caused by a denied permission is the mic_blocked state.
	const denied = view({
		rig: "error",
		webui_url: null,
		mic: "denied",
		local: { code: "mic_unavailable" },
	});
	assert.equal(denied.chip, "mic_blocked");
	assert.equal(denied.action, "settings");
	assert.equal(
		localStatusText({ code: "models_downloading", progress: 0.5 }),
		"Downloading voice models… 50%",
	);
});

test("S3 D2/D3: the notice has a Not now button; mic_unavailable offers Open Settings and Try again", async () => {
	const FR = process.env.VOICE_FRAMES_DIR;
	const dump = async (name) => {
		if (!FR) return;
		const { mkdirSync, writeFileSync } = await import("node:fs");
		mkdirSync(FR, { recursive: true });
		const el = strip() ?? window.document.querySelector("[data-voice-notice]");
		const text = [...el.querySelectorAll("*")]
			.filter((n) => n.children.length === 0)
			.map((n) => n.textContent)
			.join("");
		writeFileSync(`${FR}/${name}.txt`, `${text}\n`);
		writeFileSync(`${FR}/${name}.html`, el.outerHTML);
	};
	useVoiceStore.setState({
		active: slot(AT),
		rig: { rig: "stopped", webui_url: null, notice: "download_models" },
	});
	await mountStrip();
	const notice = window.document.querySelector(
		'[data-voice-notice="download"]',
	);
	assert.ok(notice.querySelector('[data-voice-action="accept_notice"]'));
	assert.equal(
		notice.querySelector('[data-voice-action="decline_notice"]').textContent,
		"Not now",
	);
	await dump("01-download-notice");
	for (const [name, code, mic] of [
		["05-mic-unavailable", "mic_unavailable", "unknown"],
		["06-listening-failed", "listening_failed", "granted"],
		["04-model-integrity", "model_integrity", "granted"],
	]) {
		useVoiceStore.setState({
			active: slot(AT),
			rig: { rig: "error", webui_url: null, mic, local: { code } },
		});
		await mountStrip();
		const actions = [...strip().querySelectorAll("[data-voice-action]")].map(
			(b) => b.getAttribute("data-voice-action"),
		);
		assert.deepEqual(
			actions,
			code === "mic_unavailable" ? ["settings", "try_again"] : ["try_again"],
			code,
		);
		await dump(name);
	}
	useVoiceStore.setState({
		active: slot(AT),
		rig: {
			rig: "ready",
			webui_url: null,
			clients: 1,
			local: { code: "speech_too_slow" },
		},
	});
	await mountStrip();
	await dump("07-speech-too-slow");
});
