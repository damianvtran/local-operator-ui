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

/*
 * What the daemon's `voice.status` says about the speech provider
 * (`provider`, `providers`), set per case; `__editCalls` records every
 * `settings.edit`/`settings.reset` the Settings page sends, and `__editReply`
 * scripts the answer.
 */
window.__editCalls = [];
window.__voiceTextCalls = [];
window.api = {
	desktop: {
		request: async (request) => {
			if (request?.op === "capabilities") {
				return {
					status: 200,
					body: { result: { desktop_available: true, features: { voice: 2 } } },
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
			if (request?.op === "settings.edit" || request?.op === "settings.reset") {
				window.__editCalls.push(request);
				const reply = window.__editReply ?? {
					status: 200,
					body: { result: {} },
				};
				// A saved choice is what the next status read says.
				if (reply.status === 200 && request.op === "settings.edit")
					window.__voiceStatusExtra = {
						...(window.__voiceStatusExtra ?? {}),
						provider: request.value,
					};
				return reply;
			}
			if (request?.op === "voice.text") {
				// What `/voice/text` answers, scripted per case; every request is kept.
				window.__voiceTextCalls.push(request);
				return { status: 200, body: { result: window.__voiceText } };
			}
			if (request?.op === "voice.status") {
				return {
					status: 200,
					body: {
						result: {
							active: window.__voiceSlot ?? null,
							settings: { max_spoken_chars: 800 },
							...(window.__voiceStatusExtra ?? {}),
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
			export { VoiceComposerStrip, ComposerVoiceButton, composerVoiceView, dictationOffReason, storyTime } from "./src/renderer/src/features/voice/voice-composer";
			export { useVoiceStore } from "./src/renderer/src/features/voice/voice-store";
			export { registerVoiceRouteOpener, replaySpoken, spokenSourceOf } from "./src/renderer/src/features/voice/qwen-voice-controller";
			export { SpokenSummaryBlock, SpokenReplyNote } from "./src/renderer/src/features/voice/spoken-summary-block";
			export { applyVoiceActive, controlVoice } from "./src/renderer/src/features/voice/use-voice-status";
			export { MessageInput } from "./src/renderer/src/shared/components/composer/message-input.tsx";
			export { useVoiceSwitchStore } from "./src/renderer/src/features/voice/use-voice-switch";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export * as i18n from "./src/i18n";
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
	controlVoice,
	MessageInput,
	QueryClient,
	QueryClientProvider,
	applyVoiceActive,
	useVoiceStore,
	useVoiceSwitchStore,
	registerVoiceRouteOpener,
	replaySpoken,
	spokenSourceOf,
	SpokenSummaryBlock,
	SpokenReplyNote,
	i18n,
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
	window.__voiceStatusExtra = null;
	window.__editReply = null;
	window.__editCalls = [];
	window.__voiceTextCalls = [];
	window.__voiceText = null;
	window.api.desktop.qwenVoice = undefined;
	useVoiceStore.setState({
		spoken: {},
		reveal: null,
		active: undefined,
		rig: undefined,
		activity: null,
		speakRequest: null,
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
	assert.match(caption().textContent, /You said:/);
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

/*
 * THE TWO PROVIDER STATES OF THE STRIP. No provider chosen says so in the app's
 * own words and offers the one place to choose (Settings > Speech). A chosen
 * provider that is not ready shows the BACKEND's sentence as written and offers
 * that provider's page in Providers. Neither offers "Try again": nothing about
 * pressing it would change the answer - fixing the provider does, and main picks
 * that up from the re-read status by itself.
 */
const providerRig = (extra) => ({
	rig: "error",
	webui_url: null,
	...extra,
});
const withRoutes = () => {
	const opened = [];
	const off = registerVoiceRouteOpener((route) => opened.push(route));
	return { opened, off };
};

test("no provider chosen: the strip says so and offers Choose provider, which opens Settings > Speech", async () => {
	const { opened, off } = withRoutes();
	try {
		await mountStrip();
		await act(async () => {
			const store = useVoiceStore.getState();
			store.setActive(slot(AT));
			store.setRig(
				providerRig({
					cause: "provider_unset",
					reason: "Choose a speech provider in Settings to use voice.",
				}),
			);
		});
		await flush();
		assert.equal(chipText(), "Voice error");
		assert.match(caption().textContent, /Choose a speech provider/);
		const action = window.document.querySelector("[data-voice-action]");
		assert.equal(action?.getAttribute("data-voice-action"), "choose_provider");
		assert.equal(action?.textContent?.trim(), "Choose provider");
		await act(async () => action.click());
		assert.deepEqual(opened, ["/settings?section=speech"]);
	} finally {
		off();
	}
});

test("a provider that is not ready: the backend's sentence as written, and Set up in Providers for that provider", async () => {
	const { opened, off } = withRoutes();
	try {
		await mountStrip();
		await act(async () => {
			const store = useVoiceStore.getState();
			store.setActive(slot(AT));
			store.setRig(
				providerRig({
					cause: "provider_not_ready",
					provider: "elevenlabs",
					reason: "No ElevenLabs API key is stored.",
				}),
			);
		});
		await flush();
		assert.match(caption().textContent, /No ElevenLabs API key is stored\./);
		const action = window.document.querySelector("[data-voice-action]");
		assert.equal(action?.getAttribute("data-voice-action"), "provider_setup");
		assert.equal(action?.textContent?.trim(), "Set up in Providers");
		await act(async () => action.click());
		assert.deepEqual(opened, [
			"/settings?section=providers&provider=elevenlabs",
		]);
		assert.equal(
			window.document.querySelector('[data-voice-action="try_again"]'),
			null,
		);
	} finally {
		off();
	}
});

test("a Radient credit failure shows Radient's own sentence and links to Radient", async () => {
	const { opened, off } = withRoutes();
	try {
		await mountStrip();
		await act(async () => {
			const store = useVoiceStore.getState();
			store.setActive(slot(AT));
			store.setRig(
				providerRig({
					cause: "provider_not_ready",
					provider: "radient",
					reason:
						"Your Radient credit balance is too low for speech. Add credits in the Radient Console to continue.",
				}),
			);
		});
		await flush();
		assert.match(caption().textContent, /Add credits in the Radient Console/);
		await act(async () =>
			window.document.querySelector("[data-voice-action]").click(),
		);
		assert.deepEqual(opened, ["/settings?section=providers&provider=radient"]);
	} finally {
		off();
	}
});

/*
 * MAIN'S OWN CAUSES ARE KEYED, NOT SHOWN AS ENGLISH (review round 1, finding 3):
 * `reason` is shown as written only when the backend wrote it. What main itself
 * generates (the page stopped, no window, a provider with no sentence) carries a
 * `cause` the strip maps onto a translated key, whatever `reason` says.
 */
test("main's own causes read as translated strings, never as main's English reason", async () => {
	for (const [rig, expected, leak] of [
		[
			{ cause: "page_failed", reason: "The voice page stopped" },
			"Voice stopped unexpectedly.",
			/voice page stopped/i,
		],
		[
			{
				cause: "no_window",
				reason: "Voice needs a normal app window to hear you.",
			},
			"Voice could not start.",
			/normal app window/i,
		],
		[
			{ cause: "provider_not_ready", provider: "radient" },
			"Voice could not start.",
			/provider you chose/i,
		],
	]) {
		await mountStrip();
		await act(async () => {
			const store = useVoiceStore.getState();
			store.setActive(slot(AT));
			store.setRig(providerRig(rig));
		});
		await flush();
		assert.equal(caption().textContent.trim(), expected, JSON.stringify(rig));
		assert.doesNotMatch(caption().textContent, leak);
	}
});

test("a reason with no cause (a rig's own sentence) is still shown as written", async () => {
	await mountStrip();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.setActive(slot(AT));
		store.setRig(providerRig({ reason: "port 8765 is in use" }));
	});
	await flush();
	assert.match(caption().textContent, /Port 8765 is in use/);
});

test("checking the provider is the neutral 'starting' word, not an error", async () => {
	await mountStrip();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.setActive(slot(AT));
		store.setRig({ rig: "starting", webui_url: null });
	});
	await flush();
	assert.notEqual(chipText(), "Voice error");
	assert.equal(window.document.querySelector("[data-voice-action]"), null);
});

test("the view model keeps a provider state's action, and a plain rig error keeps Try again", () => {
	const base = {
		active: slot(AT),
		exchange: null,
		activity: null,
		cardPending: {},
		lastTake: null,
		lastSpoken: null,
		lastRefused: null,
		muted: false,
		readyAt: null,
		tick: null,
	};
	const view = (rig) => composerVoiceView({ ...base, rig }, AT, 0);
	assert.equal(
		view(providerRig({ cause: "provider_unset" })).action,
		"choose_provider",
	);
	assert.equal(
		view(providerRig({ cause: "provider_not_ready", provider: "radient" }))
			.action,
		"provider_setup",
	);
	assert.equal(
		view(providerRig({ reason: "Port in use" })).action,
		"try_again",
	);
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
	/*
	 * jsdom has no layout, so the narrow band's overflow cannot be measured here
	 * (the `NarrowCutHistoryOpen` story's play does). What is asserted is the
	 * contract that fix rests on: the chip may shrink and truncate - `shrink-0`
	 * pinned it at its full width and pushed the History toggle out of the band -
	 * and its title still says the whole sentence.
	 */
	assert.match(cut.className, /\bmin-w-0\b/);
	assert.match(cut.className, /\bshrink\b/);
	assert.doesNotMatch(cut.className, /\bshrink-0\b/);
	assert.ok(cut.querySelector(".truncate"), "the words are what truncates");
	assert.equal(cut.getAttribute("title"), "Cut short · rest above ↑");
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
	// The time rides the end of the first line, as the other rows' does.
	const cell = row.children[1].lastElementChild;
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
	assert.match(band.className, /\bpx-3\b/);
	assert.doesNotMatch(band.className, /px-2\.5/);

	await act(async () => {
		applyVoiceActive(slot("b2b2b2b2b2b2"), client);
	});
	await flush();
	const notice = window.document.querySelector("[data-voice-notice]");
	assert.match(notice.className, /\bpx-3\b/);
});

test("the chevron-only History toggle carries a title the same as its name", async () => {
	await mountStrip();
	await voiceReady();
	const toggle = () =>
		window.document.querySelector("[data-voice-history-toggle]");
	// The open state is remembered per window: read each state off the toggle.
	const seen = new Set();
	for (let press = 0; press < 2; press++) {
		const open = toggle().getAttribute("aria-expanded") === "true";
		assert.equal(
			toggle().getAttribute("title"),
			open ? "Hide history" : "History",
		);
		assert.equal(
			toggle().getAttribute("title"),
			toggle().getAttribute("aria-label"),
		);
		seen.add(open);
		await act(async () => {
			toggle().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		});
	}
	assert.equal(seen.size, 2, "both states were checked");
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

test("D11: the band takes no padding back from the box - it is a panel inside the editor, at both widths", async () => {
	/*
	 * jsdom has no layout engine, so an x cannot be read here (the Storybook
	 * `Voice/Composer band` stories measure it). What CAN be asserted is the cause
	 * of the operator's 2026-11-23 report: the band bled to the box's edges with a
	 * negative margin sized for a 16px padding, but the editor pads 8px (4px
	 * compact) under a shelf, so the band hung out of the card and over the shelf.
	 * No negative margin at all is the property that cannot drift from the box.
	 */
	for (const narrow of [true, false]) {
		await mountStrip({ isSmallView: narrow });
		await voiceReady();
		const band = window.document.querySelector("[data-voice-band]");
		const row = window.document.querySelector("[data-voice-strip]");
		assert.ok(band && row);
		const which = narrow ? "narrow" : "wide";
		assert.doesNotMatch(
			band.className,
			/(?:^|\s)-m[xtlr]?-/,
			`${which}: no negative margin`,
		);
		assert.match(band.className, /\bborder\b/, `${which}: its own edge`);
		assert.match(
			band.className,
			/\bmin-w-0\b/,
			`${which}: cannot widen the card`,
		);
		assert.match(
			row.className,
			narrow ? /\bpx-2\b/ : /\bpx-3\b/,
			`${which}: its own content padding`,
		);
	}
});

test("History shows the whole reply on its own lines, and notes the audio cut only when it was cut", async () => {
	const full = "Hook · When it runs\nPreToolUse · Before an action\n- a bullet";
	const exchange = (patch) => ({
		kind: "exchange",
		at: Date.parse("2026-10-18T10:02:00Z"),
		sessionId: AT,
		heard: "compare the hooks",
		spoken: "Hook When it runs PreToolUse Before an action",
		full,
		hasFullText: true,
		truncated: false,
		...patch,
	});
	await mountStrip();
	await voiceReady();
	await act(async () => {
		useVoiceStore.setState({ story: [exchange({})] });
	});
	await openHistory();
	let row = window.document.querySelector('[data-voice-story="exchange"]');
	// The newlines survive into the DOM and `pre-line` draws them as lines.
	const reply = row.querySelector(".whitespace-pre-line");
	assert.equal(
		reply?.textContent,
		full,
		"the row holds full_text verbatim, not the spoken text",
	);
	assert.doesNotMatch(row.textContent, /Hook When it runs PreToolUse/);
	assert.equal(row.querySelector("[data-voice-story-cut]"), null);

	await act(async () => {
		useVoiceStore.setState({ story: [exchange({ truncated: true })] });
	});
	await flush();
	row = window.document.querySelector('[data-voice-story="exchange"]');
	const note = row.querySelector("[data-voice-story-cut]");
	assert.ok(note, "a cut AUDIO is still said, beside the whole reply");
	assert.match(note.textContent, /Spoken aloud: first part only/);
	assert.doesNotMatch(
		note.className,
		/text-warning/,
		"not a missing-text warning",
	);
	assert.match(row.textContent, /PreToolUse · Before an action/);

	/*
	 * AN OLDER SERVER sends no `full_text`: the row holds the capped spoken text,
	 * so "first part only" under it would read as the row being complete. The
	 * strip's own cut chip still follows `truncated`; the row says nothing extra.
	 */
	await act(async () => {
		useVoiceStore.setState({
			story: [
				exchange({
					full: "Hook When it runs PreToolUse Before an action",
					hasFullText: false,
					truncated: true,
				}),
			],
		});
	});
	await flush();
	row = window.document.querySelector('[data-voice-story="exchange"]');
	assert.equal(
		row.querySelector("[data-voice-story-cut]"),
		null,
		"no note under capped text from a server with no full_text",
	);
	assert.match(row.textContent, /Hook When it runs PreToolUse/);

	// A reply with nothing yet reads as work in progress, not a blank row.
	await act(async () => {
		useVoiceStore.setState({
			story: [exchange({ spoken: null, full: null })],
		});
	});
	await flush();
	row = window.document.querySelector('[data-voice-story="exchange"]');
	assert.match(row.textContent, /Working/);
});

test("the strip's caption labels end in a colon, so the label is a separator", async () => {
	await mountStrip();
	await voiceReady();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.noteTake(AT, "can you check the tests", Date.now());
		store.setExchange("working", AT);
	});
	await flush();
	assert.match(caption().textContent, /^You said:\s/);
});

test("a full-width colon takes no gap after it; every other colon takes one", async () => {
	/*
	 * ONE RULE FOR EVERY LOCALE: zh-CN labels end in `：`, whose glyph carries its
	 * own space, so the caption must not add a second one; `:` and fr's ` :` do.
	 */
	i18n.registerCatalogue("zh-CN", {
		"ui.chat.voice.heard_label": "你说：",
	});
	await mountStrip();
	await voiceReady();
	const heard = async () => {
		await act(async () => {
			const store = useVoiceStore.getState();
			store.noteTake(AT, "检查测试", Date.now());
			store.setExchange("working", AT);
		});
		await flush();
		return caption().firstElementChild;
	};
	i18n.setLocale("zh-CN");
	try {
		const cn = await heard();
		assert.match(cn.className, /\bgap-0\b/);
		assert.equal(cn.textContent, "你说：检查测试", "no space after ：");
	} finally {
		i18n.setLocale("en");
	}
	await act(async () => {
		useVoiceStore.setState({ story: [], exchange: null, lastTake: null });
	});
	const en = await heard();
	assert.match(en.className, /\bgap-1\b/);
	assert.match(en.textContent, /^You said: /);
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

/*
 * CLEAR HISTORY. The panel's rows are the window's own in-memory record, and the only
 * way to empty them used to be restarting the app (found live, 2026-11-17: stale
 * "Not sent" rows after a refused take). One "Clear" control in the panel's header
 * drops the rows and the refused-take quote that duplicates them, and nothing else.
 */
test("Clear drops the history rows and the refused-take quote, and only those", async () => {
	await mountStrip();
	await voiceReady();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.noteTake(AT, "what about digimon", Date.now());
		store.noteNotSent(AT, "please also check the tests", Date.now() + 1);
	});
	await flush();
	await openHistory();
	assert.ok(
		window.document.querySelectorAll("[data-voice-story]").length >= 2,
		"the rows are on screen before the clear",
	);
	const clear = window.document.querySelector("[data-voice-history-clear]");
	assert.ok(clear, "the panel offers a Clear control while it holds rows");
	assert.equal(clear.textContent.trim(), "Clear");
	await act(async () => {
		clear.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	await flush();
	assert.equal(
		window.document.querySelectorAll("[data-voice-story]").length,
		0,
	);
	assert.deepEqual(useVoiceStore.getState().story, []);
	assert.equal(
		useVoiceStore.getState().lastRefused,
		null,
		"the quote is cleared too",
	);
	assert.equal(
		window.document.querySelector("[data-voice-history-clear]"),
		null,
		"nothing to clear, so no control",
	);
	assert.match(
		window.document.querySelector("[data-voice-history]").textContent,
		/Nothing said yet/,
	);
	assert.equal(
		useVoiceStore.getState().active?.session_id,
		AT,
		"clearing history never touches who holds the slot",
	);
});

test("Clear is not offered while the history is empty", async () => {
	await mountStrip();
	await voiceReady();
	await openHistory();
	assert.equal(
		window.document.querySelector("[data-voice-history-clear]"),
		null,
	);
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
		full: "Three suites ran.",
		hasFullText: true,
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
					recordingProbe: {
						canUseRadientSpeech: true,
						speechBlock: "could-not-check",
					},
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
	mic().focus();
	assert.equal(
		window.document.activeElement,
		mic(),
		"the locked mic takes focus",
	);
	// The flat dock dims by ink, not opacity, and a locked mic never highlights.
	for (const state of ["", "hover:", "active:"]) {
		assert.ok(
			mic().classList.contains(`aria-disabled:${state}text-ink-disabled`),
			`the locked mic uses disabled ink in ${state || "rest"} state`,
		);
		if (state)
			assert.ok(
				mic().classList.contains(`aria-disabled:${state}bg-transparent`),
				`the locked mic keeps a transparent background in ${state} state`,
			);
	}
	assert.ok(
		!Array.from(mic().classList).some(
			(token) =>
				token.startsWith("aria-disabled:") && token.includes("opacity-"),
		),
		"the locked mic does not fade the whole control",
	);

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
	assert.ok(mic().classList.contains("text-ink-dim"));
	assert.ok(mic().classList.contains("hover:text-ink"));
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
					recordingProbe: {
						canUseRadientSpeech: true,
						speechBlock: "could-not-check",
					},
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
					recordingProbe: {
						canUseRadientSpeech: true,
						speechBlock: "could-not-check",
					},
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

/* -------------------------------------------------------------------------- */
/* THE SPOKEN SUMMARY (the agent's `Spoken:` paragraph)                        */
/* -------------------------------------------------------------------------- */

const SUMMARY_TEXT = "Use SessionStart: it runs at the start of every session.";
const REPLY_FULL = "Hook · When it runs\nSessionStart · At the start";
const MSG = "msg-7";

/** A summary exchange row, as the controller's `setLastSpoken` completes it. */
const summaryRow = (patch = {}) => ({
	kind: "exchange",
	at: Date.parse("2026-11-23T11:07:00Z"),
	sessionId: AT,
	heard: "compare the hooks",
	spoken: SUMMARY_TEXT,
	full: REPLY_FULL,
	hasFullText: true,
	truncated: false,
	source: "summary",
	messageId: MSG,
	...patch,
});

test("History: a summary row shows the summary, a link to the full reply and Replay - not the reply", async () => {
	await mountStrip();
	await voiceReady();
	await act(async () => {
		useVoiceStore.setState({ story: [summaryRow()] });
	});
	await openHistory();
	const row = window.document.querySelector('[data-voice-story="exchange"]');
	assert.match(row.textContent, /Use SessionStart: it runs at the start/);
	assert.doesNotMatch(row.textContent, /Hook · When it runs/);
	const link = row.querySelector("[data-voice-story-link]");
	assert.equal(link.textContent.trim(), "Full reply in chat ↑");
	assert.ok(row.querySelector("[data-voice-story-replay]"));
	assert.equal(row.querySelector("[data-voice-story-cut]"), null);

	// The link asks the transcript to show THIS message, once per press.
	await act(async () => {
		link.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	assert.deepEqual(
		{ ...useVoiceStore.getState().reveal, nonce: undefined },
		{ sessionId: AT, messageId: MSG, nonce: undefined },
	);
	const first = useVoiceStore.getState().reveal.nonce;
	await act(async () => {
		link.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	assert.equal(useVoiceStore.getState().reveal.nonce, first + 1);

	// A summary cut at the cap says so, as the row's own cut.
	await act(async () => {
		useVoiceStore.setState({ story: [summaryRow({ truncated: true })] });
	});
	await flush();
	const cut = window.document
		.querySelector('[data-voice-story="exchange"]')
		.querySelector("[data-voice-story-cut]");
	assert.match(cut.textContent, /Spoken aloud: first part only/);
});

test("History: a reply row (fallback, or an older server) is the full-reply rendering, with no link", async () => {
	await mountStrip();
	await voiceReady();
	for (const patch of [
		{ source: "reply" },
		{ source: undefined, messageId: undefined },
	]) {
		await act(async () => {
			useVoiceStore.setState({
				story: [summaryRow({ spoken: "Hook When it runs", ...patch })],
			});
		});
		await openHistory();
		const row = window.document.querySelector('[data-voice-story="exchange"]');
		assert.equal(
			row.querySelector(".whitespace-pre-line").textContent,
			REPLY_FULL,
		);
		assert.equal(row.querySelector("[data-voice-story-link]"), null);
		assert.equal(row.querySelector("[data-voice-story-replay]"), null);
	}
});

test("older server: a missing spoken_source reads as the reply", () => {
	assert.equal(spokenSourceOf({ text: "x", spoken_chars: 1 }), "reply");
	assert.equal(
		spokenSourceOf({ text: "x", spoken_chars: 1, spoken_source: "reply" }),
		"reply",
	);
	assert.equal(
		spokenSourceOf({ text: "x", spoken_chars: 1, spoken_source: "summary" }),
		"summary",
	);
	assert.equal(
		spokenSourceOf({ text: "x", spoken_chars: 1, spoken_source: "other" }),
		"reply",
	);
	assert.equal(spokenSourceOf(null), "reply");
});

/** The rig's bridge, recording what it was asked to say. */
function installSpeak() {
	const spoken = [];
	window.api.desktop.qwenVoice = {
		speak: async (request) => {
			spoken.push(request);
			return { spoken: true };
		},
		setMuted: async (muted) => controlStatus({ muted }),
	};
	return spoken;
}

async function mountBlock(props) {
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
				React.Fragment,
				null,
				React.createElement(SpokenSummaryBlock, {
					sessionId: AT,
					messageId: MSG,
					summary: SUMMARY_TEXT,
					streaming: false,
					...props,
				}),
				React.createElement(SpokenReplyNote, { sessionId: AT, messageId: MSG }),
			),
		);
	});
	await flush();
	return window.document.querySelector("[data-spoken-summary]");
}

const spokenFrom = (source, patch = {}) =>
	useVoiceStore.getState().setLastSpoken({
		sessionId: AT,
		text: SUMMARY_TEXT,
		truncated: false,
		messageId: MSG,
		source,
		at: Date.now(),
		...patch,
	});

test("the block: voice off, or a message this window never spoke, is 'Spoken summary' with no control", async () => {
	let block = await mountBlock();
	assert.equal(block.getAttribute("data-spoken-summary"), "static");
	assert.match(block.textContent, /Spoken summary/);
	assert.match(block.textContent, /Use SessionStart/);
	assert.equal(block.querySelector("[data-spoken-control]"), null);
	assert.equal(block.getAttribute("aria-label"), "Spoken summary");

	// Voice on, but this window never spoke the message (an older turn).
	await voiceReady();
	block = await mountBlock();
	assert.equal(block.getAttribute("data-spoken-summary"), "static");
	assert.equal(block.querySelector("[data-spoken-control]"), null);
});

test("the block: spoken, cut, stopped early and muted each say so, and offer the right control", async () => {
	await voiceReady();
	await act(async () => spokenFrom("summary"));
	let block = await mountBlock();
	assert.equal(block.getAttribute("data-spoken-summary"), "spoken");
	assert.match(block.textContent, /Spoken aloud/);
	assert.ok(block.querySelector('[data-spoken-control="replay"]'));

	await act(async () => spokenFrom("summary", { truncated: true }));
	block = await mountBlock();
	assert.equal(block.getAttribute("data-spoken-summary"), "cut");
	assert.match(block.textContent, /Spoken aloud · first part only/);

	// A barge-in marks the message, not just the strip's three-second word.
	await act(async () => {
		spokenFrom("summary");
		const store = useVoiceStore.getState();
		store.notePlayback("started", AT, Date.now() - 5000);
		store.notePlayback("cancelled", AT, Date.now());
	});
	block = await mountBlock();
	assert.equal(block.getAttribute("data-spoken-summary"), "stopped");
	assert.match(block.textContent, /stopped early/);
	assert.ok(block.querySelector('[data-spoken-control="replay"]'));

	await act(async () => spokenFrom("summary", { muted: true }));
	block = await mountBlock();
	assert.equal(block.getAttribute("data-spoken-summary"), "muted");
	assert.match(block.textContent, /Not spoken \(muted\)/);
	assert.ok(block.querySelector('[data-spoken-control="play"]'));
	assert.equal(block.querySelector('[data-spoken-control="replay"]'), null);
});

test("the block: speaking says so, with no control, and a streaming paragraph is 'To be spoken'", async () => {
	await voiceReady();
	await act(async () => {
		spokenFrom("summary");
		useVoiceStore.getState().setActivity("speaking");
	});
	let block = await mountBlock();
	assert.equal(block.getAttribute("data-spoken-summary"), "speaking");
	assert.equal(block.textContent.trim().startsWith("Speaking"), true);
	// Replay stays MOUNTED (so a keyboard press keeps its focus) but waits.
	const waiting = block.querySelector('[data-spoken-control="replay"]');
	assert.equal(waiting?.getAttribute("aria-disabled"), "true");

	await act(async () => {
		useVoiceStore.setState({ spoken: {}, lastSpoken: null, activity: null });
		useVoiceStore.getState().setExchange("working", AT);
	});
	block = await mountBlock({ streaming: true, summary: "Use Session" });
	assert.equal(block.getAttribute("data-spoken-summary"), "upcoming");
	assert.match(block.textContent, /To be spoken/);
	assert.match(block.textContent, /Use Session/);
});

test("Replay is an explicit source reference: the server picks the paragraph, the rig says it, no History row moves", async () => {
	await voiceReady();
	const said = installSpeak();
	window.__voiceText = {
		text: SUMMARY_TEXT,
		spoken_chars: SUMMARY_TEXT.length,
		spoken_source: "summary",
		truncated: false,
		full_text: REPLY_FULL,
	};
	await act(async () => {
		// The earlier turn was spoken (no row to complete); a NEW take is then out.
		spokenFrom("summary", { at: Date.now() - 6000 });
		useVoiceStore.getState().noteTake(AT, "and the tests?", Date.now() - 4000);
	});
	// An unanswered take is in flight: a replay must not hand it the old summary.
	const block = await mountBlock();
	await act(async () => {
		block
			.querySelector('[data-spoken-control="replay"]')
			.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	await flush();
	assert.equal(window.__voiceTextCalls.length, 1);
	assert.deepEqual(window.__voiceTextCalls[0].source, {
		kind: "message",
		messageId: MSG,
	});
	assert.deepEqual(said, [{ text: SUMMARY_TEXT, kind: "reply" }]);
	const row = useVoiceStore.getState().story.at(-1);
	assert.equal(row.spoken, null, "the in-flight take's row stays unanswered");
	assert.equal(useVoiceStore.getState().spoken[MSG].source, "summary");
});

test("Play on a muted block unmutes, then replays", async () => {
	await voiceReady();
	const said = installSpeak();
	window.__voiceText = {
		text: SUMMARY_TEXT,
		spoken_chars: 10,
		spoken_source: "summary",
	};
	await act(async () => spokenFrom("summary", { muted: true }));
	const block = await mountBlock();
	await act(async () => {
		block
			.querySelector('[data-spoken-control="play"]')
			.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	await flush();
	assert.equal(said.length, 1);
	assert.equal(useVoiceStore.getState().spoken[MSG].muted, false);
});

test("replaySpoken is a direct call: it neither reads nor writes the turn fold's dedupe", async () => {
	await voiceReady();
	const said = installSpeak();
	window.__voiceText = { text: "Again.", spoken_chars: 6 };
	await replaySpoken(AT, MSG);
	await replaySpoken(AT, MSG);
	// Twice asked, twice spoken: the dedupe guards the automatic path only.
	assert.equal(said.length, 2);
	// An older server: no spoken_source, so the record reads as the reply.
	assert.equal(useVoiceStore.getState().spoken[MSG].source, "reply");
});

test("the fallback footnote: a cut reply says so under the reply, with Replay", async () => {
	await voiceReady();
	await act(async () => spokenFrom("reply", { truncated: true }));
	if (root) {
		await act(async () => root.unmount());
		root = null;
	}
	window.document.body.innerHTML = "<div id='root'></div>";
	root = createRoot(window.document.getElementById("root"));
	await act(async () => {
		root.render(
			React.createElement(SpokenReplyNote, { sessionId: AT, messageId: MSG }),
		);
	});
	await flush();
	const note = window.document.querySelector("[data-spoken-reply-note]");
	assert.match(note.textContent, /Spoken aloud: first part only/);
	assert.ok(note.querySelector('[data-spoken-control="replay"]'));
	await act(async () => spokenFrom("reply", { truncated: false }));
	await flush();
	assert.equal(window.document.querySelector("[data-spoken-reply-note]"), null);
});

test("the strip: Replay sits left of Pause, shows the summary at rest, and goes with the next take", async () => {
	await mountStrip();
	await voiceReady();
	await act(async () => {
		const store = useVoiceStore.getState();
		store.noteTake(AT, "compare the hooks", Date.now() - 5000);
		spokenFrom("summary", { at: Date.now() - 4000 });
	});
	await flush();
	assert.equal(chipText(), "Listening");
	assert.match(
		caption().textContent,
		/Use SessionStart/,
		"the summary is kept",
	);
	const replay = window.document.querySelector('[data-voice-action="replay"]');
	assert.ok(replay);
	const pause = window.document.querySelector('[data-voice-action="pause"]');
	assert.equal(
		replay.compareDocumentPosition(pause) &
			window.Node.DOCUMENT_POSITION_FOLLOWING,
		window.Node.DOCUMENT_POSITION_FOLLOWING,
		"Replay is before Pause",
	);

	// A reply spoken from its own text keeps today's idle caption (no long line).
	await act(async () =>
		spokenFrom("reply", { text: "A very long first part." }),
	);
	await flush();
	assert.doesNotMatch(caption().textContent, /A very long first part/);

	// The next take retires both.
	await act(async () => {
		useVoiceStore.getState().noteTake(AT, "and the tests", Date.now() + 1000);
	});
	await flush();
	assert.equal(
		window.document.querySelector('[data-voice-action="replay"]'),
		null,
	);
});

test("the cut chip follows the server's cut for a summary too, and a normal summary has none", async () => {
	await mountStrip();
	await voiceReady();
	await act(async () => {
		useVoiceStore.getState().noteTake(AT, "compare", Date.now() - 5000);
		spokenFrom("summary", { at: Date.now() - 4000 });
	});
	await flush();
	assert.equal(window.document.querySelector("[data-voice-cut]"), null);
	await act(async () => spokenFrom("summary", { truncated: true }));
	await flush();
	assert.ok(window.document.querySelector("[data-voice-cut]"));
});

/* -------------------------------------------------------------------------- */
/* THE ONE REPLAY RULE, THE ORDER OF STATES, AND ANOTHER CONVERSATION'S ROWS    */
/* -------------------------------------------------------------------------- */

const SUMMARY_REPLY = {
	text: SUMMARY_TEXT,
	spoken_chars: SUMMARY_TEXT.length,
	spoken_source: "summary",
	truncated: false,
	full_text: REPLY_FULL,
};

const click = (element) =>
	act(async () => {
		element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});

/** A rig whose `speak` answers when the test says, recording what it was asked. */
function installDeferredSpeak() {
	const asked = [];
	let release = () => {};
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	window.api.desktop.qwenVoice = {
		speak: async (request) => {
			asked.push(request);
			return gate;
		},
		setMuted: async (muted) => controlStatus({ muted }),
	};
	return { asked, release };
}

/** The three Replay entry points of one message, mounted together where they can be. */
async function mountEntryPoints() {
	await mountStrip();
	await act(async () => {
		useVoiceStore.setState({ story: [summaryRow()] });
	});
	await openHistory();
	return {
		strip: () => window.document.querySelector('[data-voice-action="replay"]'),
		history: () => window.document.querySelector("[data-voice-story-replay]"),
	};
}

/** A message this window spoke from its summary a while ago, then went quiet. */
const spokenEarlier = () =>
	act(async () => {
		const store = useVoiceStore.getState();
		store.noteTake(AT, "compare the hooks", Date.now() - 9000);
		spokenFrom("summary", { at: Date.now() - 8000 });
	});

test("U2: a Replay's block runs Speaking, then Spoken aloud only once the audio starts; a refused speak claims nothing", async () => {
	await voiceReady();
	window.__voiceText = SUMMARY_REPLY;
	const { asked, release } = installDeferredSpeak();
	const states = [];
	const watch = () => {
		const tone = window.document
			.querySelector("[data-spoken-summary]")
			?.getAttribute("data-spoken-summary");
		if (states.at(-1) !== tone) states.push(tone);
	};
	await mountBlock();
	watch();
	assert.deepEqual(states, ["static"], "never spoken here");

	await act(async () => {
		void replaySpoken(AT, MSG);
	});
	await flush();
	watch();
	// The rig has the words and has not answered: Speaking, Replay waiting.
	assert.deepEqual(states, ["static", "speaking"]);
	assert.equal(asked.length, 1);
	assert.equal(
		window.document
			.querySelector("[data-spoken-control]")
			?.getAttribute("aria-disabled"),
		"true",
	);
	await act(async () => release({ spoken: true }));
	await flush();
	watch();
	assert.deepEqual(states, ["static", "speaking"], "answered, not yet heard");

	await act(async () => {
		const store = useVoiceStore.getState();
		store.notePlayback("started", AT, Date.now());
		store.setActivity("speaking");
	});
	watch();
	assert.deepEqual(states, ["static", "speaking"]);
	await act(async () => {
		const store = useVoiceStore.getState();
		store.setActivity(null);
		store.notePlayback("ended", AT, Date.now());
	});
	watch();
	assert.deepEqual(states, ["static", "speaking", "spoken"]);
});

test("U2/m3: a refused speak puts the record back exactly, and the block never says Spoken aloud", async () => {
	await voiceReady();
	window.__voiceText = SUMMARY_REPLY;
	let answer = { spoken: false, reason: "paused" };
	window.api.desktop.qwenVoice = {
		speak: async () => answer,
		setMuted: async (muted) => controlStatus({ muted }),
	};
	// Never spoken here: the refusal leaves no record at all.
	await mountBlock();
	await act(async () => replaySpoken(AT, MSG));
	await flush();
	assert.equal(useVoiceStore.getState().spoken[MSG], undefined);
	assert.equal(useVoiceStore.getState().lastSpoken, null);
	assert.equal(useVoiceStore.getState().speakRequest, null);
	assert.equal(
		window.document
			.querySelector("[data-spoken-summary]")
			.getAttribute("data-spoken-summary"),
		"static",
	);

	// Spoken and cut off earlier: the interrupted mark and the old words survive.
	await act(async () => {
		spokenFrom("summary", { at: 1000, text: "Old words." });
		const store = useVoiceStore.getState();
		store.notePlayback("started", AT, Date.now() - 5000);
		store.notePlayback("cancelled", AT, Date.now());
	});
	const before = {
		entry: useVoiceStore.getState().spoken[MSG],
		last: useVoiceStore.getState().lastSpoken,
	};
	assert.equal(before.entry.interrupted, true);
	for (const reason of [
		"rig_not_ready",
		"no_client",
		"not_relayed",
		"paused",
	]) {
		answer = { spoken: false, reason };
		await act(async () => replaySpoken(AT, MSG));
		await flush();
		assert.deepEqual(
			useVoiceStore.getState().spoken[MSG],
			before.entry,
			reason,
		);
		assert.deepEqual(useVoiceStore.getState().lastSpoken, before.last, reason);
		assert.equal(useVoiceStore.getState().speakRequest, null, reason);
	}
});

test("one rule: while PAUSED no Replay is offered, in the block, the strip or History", async () => {
	await voiceReady();
	await spokenEarlier();
	const entry = await mountEntryPoints();
	assert.ok(entry.strip(), "offered at rest");
	assert.ok(entry.history(), "offered at rest");
	await act(async () => {
		useVoiceStore
			.getState()
			.setRig({ rig: "ready", webui_url: null, clients: 1, paused: true });
	});
	await flush();
	assert.equal(entry.history() === null, true);
	assert.equal(
		window.document.querySelector('[data-voice-action="replay"]'),
		null,
	);
	const block = await mountBlock();
	assert.equal(block.querySelector("[data-spoken-control]") === null, true);
	assert.equal(block.getAttribute("data-spoken-summary"), "spoken");
});

test("one rule: while MUTED all three say Play, and pressing unmutes, then speaks", async () => {
	for (const surface of ["strip", "history", "block"]) {
		await voiceReady();
		window.__voiceText = SUMMARY_REPLY;
		window.__voiceTextCalls = [];
		const said = installSpeak();
		let unmuted = false;
		const rig = (muted) => ({
			rig: "ready",
			webui_url: null,
			clients: 1,
			muted,
		});
		window.api.desktop.qwenVoice.setMuted = async (muted) => {
			unmuted = muted === false;
			return rig(muted);
		};
		await act(async () => useVoiceStore.getState().setRig(rig(true)));
		await spokenEarlier();
		const entry = await mountEntryPoints();
		const control =
			surface === "strip"
				? entry.strip()
				: surface === "history"
					? entry.history()
					: (await mountBlock()).querySelector("[data-spoken-control]");
		assert.equal(control.getAttribute("aria-label"), "Play", surface);
		assert.equal(control.getAttribute("aria-disabled"), null, surface);
		await click(control);
		await flush();
		assert.equal(unmuted, true, `${surface}: unmuted first`);
		assert.equal(said.length, 1, `${surface}: then spoken`);
		await act(async () => {
			useVoiceStore.setState({
				spoken: {},
				lastSpoken: null,
				speakRequest: null,
			});
		});
	}
});

test("one rule: while anything is being said or asked, all three wait, mounted, and a press does nothing", async () => {
	for (const busy of [
		() => useVoiceStore.getState().setActivity("speaking"),
		() => useVoiceStore.getState().setActivity("hearing"),
		() => useVoiceStore.getState().setExchange("working", AT),
		() =>
			useVoiceStore
				.getState()
				.setSpeakRequest({ sessionId: AT, messageId: "other", at: Date.now() }),
	]) {
		await voiceReady();
		window.__voiceTextCalls = [];
		const said = installSpeak();
		await spokenEarlier();
		const entry = await mountEntryPoints();
		await act(async () => busy());
		await flush();
		// One root at a time: the strip and History first, the block after.
		for (const control of [entry.strip(), entry.history()]) {
			assert.ok(control, "stays mounted");
			assert.equal(control.getAttribute("aria-disabled"), "true");
			await click(control);
		}
		const block = await mountBlock();
		const own = block.querySelector("[data-spoken-control]");
		assert.ok(own, "stays mounted");
		assert.equal(own.getAttribute("aria-disabled"), "true");
		await click(own);
		await flush();
		assert.equal(
			window.__voiceTextCalls.length,
			0,
			"no second take over a busy one",
		);
		assert.equal(said.length, 0);
		await act(async () => {
			useVoiceStore.setState({
				activity: null,
				exchange: null,
				speakRequest: null,
				spoken: {},
				lastSpoken: null,
				lastTake: null,
			});
		});
	}
});

test("m2/U4: Replay keeps its focus when pressed, and the block's label is one polite live region", async () => {
	await voiceReady();
	window.__voiceText = SUMMARY_REPLY;
	const { release } = installDeferredSpeak();
	await act(async () => spokenFrom("summary", { at: Date.now() - 8000 }));
	const block = await mountBlock();
	const replay = block.querySelector('[data-spoken-control="replay"]');
	replay.focus();
	assert.equal(window.document.activeElement, replay);
	await click(replay);
	await flush();
	const after = window.document.querySelector("[data-spoken-control]");
	assert.equal(after, replay, "the same element: not unmounted by the press");
	assert.equal(window.document.activeElement, replay, "and still focused");
	assert.equal(after.getAttribute("aria-disabled"), "true");
	// The label is a status region (`<output>`), and says what is happening.
	const live = block.querySelector("output");
	assert.match(live.textContent, /Speaking/);
	await act(async () => release({ spoken: true }));
	await flush();
});

test("R-M1: another conversation's History row keeps its summary and loses the link and Replay; a stale reveal is never left behind", async () => {
	await mountStrip();
	await voiceReady();
	await act(async () => {
		useVoiceStore.setState({
			story: [
				summaryRow({ sessionId: "b2b2b2b2b2b2", messageId: "old-msg" }),
				summaryRow(),
			],
		});
	});
	await openHistory();
	const rows = window.document.querySelectorAll(
		'[data-voice-story="exchange"]',
	);
	assert.equal(rows.length, 2);
	assert.match(rows[0].textContent, /Use SessionStart: it runs at the start/);
	assert.equal(rows[0].querySelector("[data-voice-story-link]") === null, true);
	assert.equal(
		rows[0].querySelector("[data-voice-story-replay]") === null,
		true,
	);
	assert.ok(rows[1].querySelector("[data-voice-story-link]"));
	assert.ok(rows[1].querySelector("[data-voice-story-replay]"));

	// A request for a conversation that is not the holder is dropped, not parked.
	useVoiceStore.getState().requestReveal("b2b2b2b2b2b2", "old-msg");
	assert.equal(useVoiceStore.getState().reveal, null);
	// A request that is parked is dropped when the slot moves away.
	useVoiceStore.getState().requestReveal(AT, MSG);
	assert.ok(useVoiceStore.getState().reveal);
	await act(async () => {
		useVoiceStore.getState().setActive(slot("b2b2b2b2b2b2"));
	});
	assert.equal(useVoiceStore.getState().reveal, null);
});

test("D2/Q-1: the footnote's Replay sits beside its note; the block's Replay is pushed to the trailing edge with a logical class", async () => {
	await voiceReady();
	await act(async () => spokenFrom("summary", { at: Date.now() - 8000 }));
	let block = await mountBlock();
	const blockReplay = block.querySelector("[data-spoken-control]");
	assert.match(blockReplay.className, /\bms-auto\b/);
	assert.doesNotMatch(blockReplay.className, /\bml-auto\b/);
	await act(async () => spokenFrom("reply", { truncated: true }));
	block = await mountBlock();
	const noteReplay = window.document.querySelector(
		"[data-spoken-reply-note] [data-spoken-control]",
	);
	assert.ok(noteReplay);
	assert.doesNotMatch(noteReplay.className, /\b(ml|ms)-auto\b/);
});

test("D3: at the narrow dock a cut reply's chip keeps the room Replay would take; wide keeps both", async () => {
	for (const [small, replayDrawn] of [
		[true, false],
		[false, true],
	]) {
		await voiceReady();
		await act(async () => {
			const store = useVoiceStore.getState();
			store.noteTake(AT, "compare the hooks", Date.now() - 9000);
			spokenFrom("summary", { at: Date.now() - 8000, truncated: true });
		});
		await mountStrip({ isSmallView: small });
		assert.ok(window.document.querySelector("[data-voice-cut]"));
		assert.equal(
			Boolean(window.document.querySelector('[data-voice-action="replay"]')),
			replayDrawn,
			small ? "narrow" : "wide",
		);
		await act(async () => {
			useVoiceStore.setState({ spoken: {}, lastSpoken: null, lastTake: null });
		});
	}
});
