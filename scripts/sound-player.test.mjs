/**
 * The SoundPlayer's control contract, driven as the app mounts it.
 *
 * WHAT THIS FILE HOLDS: the slider's accessible name and time-valued text, the
 * keyboard contract (Space toggles, arrows nudge, Home/End jump), a click that
 * seeks and plays, and the state marker each transport state writes. The widget
 * is mounted in JSDOM against the REAL component and the REAL engine, with a
 * fake `Audio` injected before the bundle loads — the same control every
 * audio-driving suite uses (`scripts/audio-engine.test.mjs`'s guard enforces
 * it), so nothing here can reach a device.
 *
 * WHAT IT DELIBERATELY DOES NOT HOLD: pixels. The canvas geometry is
 * `waveform-model.test.mjs`'s (pure numbers), and the rendered frames are the
 * operator gate's — a JSDOM canvas has no 2D context, so a paint assertion here
 * would be asserting a mock.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/* ------------------------------------------------------------- the fake */

const fakeAudios = [];
class FakeAudio {
	constructor() {
		this.src = null;
		this.played = false;
		this.paused = false;
		this.currentTime = 0;
		this.duration = 0;
		this.volume = 1;
		this.playbackRate = 1;
		this.preload = "";
		this.fastSeeks = [];
		this.onended = null;
		this.onerror = null;
	}
	play() {
		this.played = true;
		this.paused = false;
		return Promise.resolve();
	}
	pause() {
		this.paused = true;
	}
	removeAttribute(name) {
		if (name === "src") this.src = null;
	}
	load() {}
	fastSeek(seconds) {
		this.fastSeeks.push(seconds);
		this.currentTime = seconds;
	}
}
globalThis.Audio = FakeAudio;

/* ------------------------------------------------------------- the DOM */

/*
 * The document must exist BEFORE the bundle evaluates: the stores read their
 * persistence once, and React reaches `window` at first render.
 */
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// Node 22+ exposes `navigator` as a getter-only global; define it instead of
// assigning, so the renderer sees JSDOM's object the way a browser would.
Object.defineProperty(globalThis, "navigator", {
	value: dom.window.navigator,
	configurable: true,
});
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLCanvasElement = dom.window.HTMLCanvasElement;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(
	dom.window,
);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(
	dom.window,
);
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// JSDOM has no canvas implementation: the player's own guard skips the paint
// when `getContext` answers null, which is what keeps this suite about the
// CONTROL rather than about pixels.
dom.window.HTMLCanvasElement.prototype.getContext = () => null;

/*
 * A no-op ResizeObserver: the player measures its box (and the UI kit's own
 * hooks observe their elements), and JSDOM implements no layout. The stub never
 * fires a callback — geometry in this suite is stated explicitly where a test
 * needs it, so a silent observer is honest rather than convenient.
 */
class SilentResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}
globalThis.ResizeObserver = SilentResizeObserver;
dom.window.ResizeObserver = SilentResizeObserver;

const persisted = new Map();
globalThis.localStorage = {
	getItem: (key) => persisted.get(key) ?? null,
	setItem: (key, value) => persisted.set(key, value),
	removeItem: (key) => persisted.delete(key),
};

const bundle = await build({
	stdin: {
		contents: [
			'export { SoundPlayer } from "./src/renderer/src/features/chat/canonical/sound-player";',
			'export { useAudioEngineStore, audioEngineElement } from "./src/renderer/src/shared/store/audio-engine-store";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "browser",
	write: false,
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	loader: { ".css": "empty" },
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
});
/*
 * WRITTEN TO DISK AND IMPORTED BY PATH, not imported from a data: URI: this
 * bundle keeps react external (the component must be the SAME React instance
 * the test's `act` and root use), and a data: URI cannot resolve a bare
 * specifier. `supplement-row.test.mjs` writes its bundle for the same reason;
 * the file is removed in the `after` hook.
 */
const bundlePath = new URL(
	`./_sound-player-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(async () => {
	await unlink(bundlePath);
});
const { SoundPlayer, useAudioEngineStore, audioEngineElement } = await import(
	bundlePath.href
);
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const h = React.createElement;

/* ------------------------------------------------------------- mounting */

const OWNER = `sound:${"a".repeat(32)}`;

async function mount() {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(
			h(SoundPlayer, {
				ownerId: OWNER,
				src: "blob:test",
				label: "Storm swell",
				peaks: [0.2, 0.9, 0.4, 0.7],
			}),
		);
	});
	const slider = container.querySelector('[role="slider"]');
	return {
		container,
		slider,
		async unmount() {
			await act(async () => root.unmount());
			container.remove();
		},
	};
}

/** A key event on the slider, inside `act`, as a real keypress reaches it. */
const press = async (slider, key) =>
	act(async () => {
		slider.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", {
				key,
				bubbles: true,
				cancelable: true,
			}),
		);
	});

const resetEngine = () => {
	useAudioEngineStore.getState().stop();
	useAudioEngineStore.setState({ element: null });
	fakeAudios.length = 0;
};

/* --------------------------------------------------------------- the pins */

test("the slider is named for its sound and reads time at both ends", async () => {
	resetEngine();
	const { slider, container, unmount } = await mount();
	assert.ok(slider, "the transport exposes a slider");
	assert.equal(slider.getAttribute("aria-label"), "Storm swell position");
	assert.equal(slider.getAttribute("aria-valuemin"), "0");
	// No metadata yet: the range is empty and the text says so, rather than
	// claiming a duration the element has not reported.
	assert.equal(slider.getAttribute("aria-valuetext"), "0:00 of 0:00");
	// The touch target is a role, not a pixel guess in this suite: the class
	// list is asserted so a later edit cannot quietly shrink it below 44 px.
	assert.ok(slider.className.includes("min-h-11"));
	// The control beside it is named for the action and the sound.
	const play = container.querySelector("button");
	assert.equal(play.getAttribute("aria-label"), "Play Storm swell");
	await unmount();
});

test("Space starts and pauses through the shared engine; the marker follows", async () => {
	resetEngine();
	const { slider, container, unmount } = await mount();
	const player = container.querySelector("[data-sound-player]");
	assert.equal(player.getAttribute("data-sound-status"), "idle");

	await press(slider, " ");
	// The engine's play() is async; the press's handler owns the settle.
	await act(async () => {});
	assert.equal(useAudioEngineStore.getState().ownerId, OWNER);
	assert.equal(useAudioEngineStore.getState().status, "playing");
	assert.equal(
		container
			.querySelector("[data-sound-player]")
			.getAttribute("data-sound-status"),
		"playing",
	);
	assert.equal(
		container.querySelector("button").getAttribute("aria-label"),
		"Pause Storm swell",
	);

	await press(slider, " ");
	await act(async () => {});
	assert.equal(useAudioEngineStore.getState().status, "paused");
	await unmount();
});

test("arrows nudge, Home and End jump, and each seeks the element", async () => {
	resetEngine();
	const { slider, unmount } = await mount();
	await press(slider, " ");
	await act(async () => {});
	const element = audioEngineElement();
	/*
	 * The element states a duration the way metadata would; the engine mirrors
	 * it. Inside `act`, because the ARROW HANDLER reads `duration` off its
	 * render's closure — a bare setState can leave the press arriving before the
	 * re-render, and then the nudge would clamp against the stale zero.
	 */
	await act(async () => {
		element.duration = 20;
		useAudioEngineStore.setState({ duration: 20 });
	});

	await press(slider, "ArrowRight");
	// One second, not five: these are 0.5-30 s clips, and a five-second nudge
	// would cross an entire sound effect in one keypress.
	assert.equal(element.currentTime, 1, "the nudge is one second");
	await press(slider, "ArrowLeft");
	assert.equal(element.currentTime, 0);
	await press(slider, "End");
	assert.equal(element.currentTime, 20);
	await press(slider, "Home");
	assert.equal(element.currentTime, 0);
	// The aria text is rewritten by the same frame loop that moves the ink, so
	// what a screen reader hears is the time the eye sees.
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 40));
	});
	assert.match(slider.getAttribute("aria-valuetext") ?? "", /^0:0\d of 0:20$/);
	await unmount();
});

test("a click on a resting slider starts at that point; a drag only scrubs", async () => {
	resetEngine();
	const { slider, unmount } = await mount();
	/*
	 * JSDOM has no PointerEvent constructor in every version this repo runs, so
	 * the event is a MouseEvent carrying the pointer fields the handler reads;
	 * `setPointerCapture` is absent and the component optional-calls it — which
	 * is the behaviour a browser without pointer capture would see too.
	 */
	const pointer = (type, clientX) => {
		const event = new dom.window.MouseEvent(type, {
			bubbles: true,
			cancelable: true,
			clientX,
		});
		Object.defineProperty(event, "pointerId", { value: 1 });
		return event;
	};
	/*
	 * THE PLAYER MEASURES ITS INNER BOX (`boxRef`), not the slider's outer div,
	 * so the geometry has to be stated on the element the component actually
	 * measures — a prototype stub for the whole document does that for every
	 * element this test creates. JSDOM reports zeros otherwise, and a zero-width
	 * box makes every fraction zero, which would make the seek assertions below
	 * pass for the wrong reason.
	 */
	dom.window.Element.prototype.getBoundingClientRect = () => ({
		left: 0,
		width: 200,
		top: 0,
		height: 44,
		right: 200,
		bottom: 44,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	});
	// The measurement runs in an effect; flush it before the press.
	await act(async () => {});

	/*
	 * A CLICK ON A RESTING SLIDER STARTS AT ITS POINT. The fraction is measured
	 * against the box the component measured (JSDOM reports none, so the stub
	 * above states 200 px). The duration is stated FIRST, because a click before
	 * metadata has nowhere to seek TO — `seekSecondsAt` answers 0 for an unknown
	 * duration rather than inventing a length — and the click's job in that case
	 * is only to start, which the assertion below covers.
	 *
	 * The element is activated by the click, so the media metadata would arrive
	 * on the same element: stating it on `element` before the press is what a
	 * resolved blob looks like a frame in.
	 */
	const element = audioEngineElement() ?? null;
	// The engine has no element until the press creates it; that first press is
	// therefore the metadata-less case, and the SECOND press (element known) is
	// the positioned case the brief's "click seeks and plays" describes.
	await act(async () => {
		slider.dispatchEvent(pointer("pointerdown", 150));
		slider.dispatchEvent(pointer("pointerup", 150));
	});
	await act(async () => {});
	assert.equal(useAudioEngineStore.getState().ownerId, OWNER, "a click plays");

	const live = audioEngineElement();
	await act(async () => {
		live.duration = 20;
		useAudioEngineStore.setState({ duration: 20 });
	});
	// Paused, then a click at 75% of the bar: it seeks to 15 s and resumes.
	await act(async () => {
		useAudioEngineStore.getState().pause(OWNER);
	});
	await act(async () => {
		slider.dispatchEvent(pointer("pointerdown", 150));
		slider.dispatchEvent(pointer("pointerup", 150));
	});
	await act(async () => {});
	// 150/200 = 75% of 20 s = 15 s.
	assert.equal(live.currentTime, 15);
	assert.equal(element, null);

	// A DRAG: down, move, up. The move scrubs through fastSeek and the release
	// commits the final position; a drag must NOT re-trigger playback.
	live.fastSeeks.length = 0;
	await act(async () => {
		slider.dispatchEvent(pointer("pointerdown", 20));
		slider.dispatchEvent(pointer("pointermove", 100));
		slider.dispatchEvent(pointer("pointerup", 100));
	});
	assert.equal(live.currentTime, 10, "the release commits the exact position");
	assert.equal(
		useAudioEngineStore.getState().status,
		"playing",
		"a scrub leaves playback where it was",
	);
	await unmount();
});

test("another sound's playback makes this row show its rest state", async () => {
	resetEngine();
	const { container, unmount } = await mount();
	// A DIFFERENT owner starts on the shared engine (the transcript's other row,
	// the Files band — any seat).
	await act(async () => {
		await useAudioEngineStore.getState().play("sound:other", "blob:other");
	});
	assert.equal(
		container
			.querySelector("[data-sound-player]")
			.getAttribute("data-sound-status"),
		"idle",
		"a you-are-not-active row never shows a stale spinner or a false pause",
	);
	assert.equal(
		container.querySelector("button").getAttribute("aria-label"),
		"Play Storm swell",
	);
	await unmount();
});
