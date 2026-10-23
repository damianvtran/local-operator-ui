/**
 * The Library card's audio contract, driven as the app mounts it.
 *
 * WHAT THIS FILE HOLDS (the operator's defect, 2026-10-23): an audio asset card
 * draws the SHARED sound player in its picture well - waveform, play/pause in
 * place, progress and click-to-seek from the player's own handlers - instead of
 * a glyph that only played after opening the drawer. The card is also three
 * SIBLING controls now (select, player, overflow), so a transport press must
 * not select the asset, and the title area must still select it.
 *
 * WHAT IT DELIBERATELY DOES NOT HOLD: pixels and decoding. JSDOM has no 2D
 * canvas context and no audio pipeline; the waveform's geometry is
 * `waveform-model.test.mjs`'s and the frames are the operator gate's. The
 * `data-sound-peaks` marker is the honest seam - `flat` for the 404 sidecar,
 * `stored` for a real envelope - exactly what the player writes.
 *
 * AUDIO SAFETY: a fake `Audio` is installed before the bundle loads, the same
 * control every suite that drives the engine uses, so no press can reach a
 * device.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/* ------------------------------------------------------------- the fake */

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
		this.onended = null;
		this.onerror = null;
		this.onloadedmetadata = null;
		this.ondurationchange = null;
		this.ontimeupdate = null;
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
		this.currentTime = seconds;
	}
}
globalThis.Audio = FakeAudio;

/* ------------------------------------------------------------- the DOM */

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// jsdom accessors that cannot be redefined; the DOM globals above suffice.
	}
}
for (const name of ["Event", "CustomEvent", "MouseEvent", "KeyboardEvent"]) {
	globalThis[name] = dom.window[name];
}
dom.window.Element.prototype.scrollIntoView = () => {};
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/*
 * A no-op ResizeObserver: the player measures its box and JSDOM implements no
 * layout. Geometry is stated explicitly where a case needs it, so a silent
 * observer is honest rather than convenient.
 */
class SilentResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}
globalThis.ResizeObserver = SilentResizeObserver;
dom.window.ResizeObserver = SilentResizeObserver;
dom.window.HTMLCanvasElement.prototype.getContext = () => null;
/*
 * A CONTROLLABLE IntersectionObserver, because the well's byte read is gated on
 * `useEverInView`: the case that proves the gate needs an observer that can be
 * made to answer. Every instance records its targets so a case can deliver an
 * intersection the way a real observer would.
 */
const OBSERVERS = [];
class TestIntersectionObserver {
	constructor(callback) {
		this.callback = callback;
		this.targets = new Set();
		OBSERVERS.push(this);
	}
	observe(target) {
		this.targets.add(target);
	}
	unobserve(target) {
		this.targets.delete(target);
	}
	disconnect() {
		this.targets.clear();
	}
}
globalThis.IntersectionObserver = TestIntersectionObserver;
dom.window.IntersectionObserver = TestIntersectionObserver;
URL.createObjectURL = () => "blob:library-card-test";
URL.revokeObjectURL = () => {};

/* ---------------------------------------------------------- the bridge */

const MEDIA = [];
const bridge = {
	audio: true,
	waveform: "json",
	thumbnail: "image",
	/** A waveform request parked until `release` runs (the stale-peaks case). */
	hangGate: null,
	release: null,
};
globalThis.window.api = {
	desktop: {
		media: async (request) => {
			MEDIA.push(request);
			if (request.op === "library.waveform") {
				if (bridge.waveform === "hang") {
					bridge.hangGate ??= new Promise((resolve) => {
						bridge.release = resolve;
					});
					await bridge.hangGate;
					return {
						status: 200,
						kind: "json",
						body: { version: 1, bars: 3, peaks: [0.1, 0.8, 0.3] },
					};
				}
				if (bridge.waveform === "404")
					return { status: 404, kind: "error", detail: "no sidecar" };
				if (bridge.waveform === "malformed")
					return { status: 200, kind: "json", body: { peaks: "nope" } };
				return {
					status: 200,
					kind: "json",
					body: { version: 1, bars: 3, peaks: [0.2, 0.9, 0.4] },
				};
			}
			if (request.op === "library.content") {
				if (bridge.audio) {
					return {
						status: 200,
						kind: "bytes",
						mimeType: "audio/wav",
						data: new Uint8Array([82, 73, 70, 70]),
					};
				}
				return { status: 404, kind: "error", detail: "no bytes" };
			}
			if (request.op === "library.thumbnail") {
				return {
					status: 200,
					kind: "bytes",
					mimeType: "image/png",
					data: new Uint8Array([137, 80, 78, 71]),
				};
			}
			throw new TypeError(`unexpected media op: ${request.op}`);
		},
	},
};

/* ------------------------------------------------------------ the mount */

const { after } = await import("node:test");
const { act, createElement } = await import("react");

const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LibraryCard } from "./src/renderer/src/features/library/components/library-card";
import { useAudioEngineStore } from "./src/renderer/src/shared/store/audio-engine-store";
import { useLibraryWaveform } from "./src/renderer/src/features/library/hooks/use-library-queries";

/** Silence the shared element and stop its clock after a case played. */
export function stopAudio() {
	useAudioEngineStore.getState().stop();
}

/** The hook alone, so a case can switch its asset id under a mounted viewer. */
export function WaveformProbe({ assetId }) {
	const peaks = useLibraryWaveform(assetId);
	return createElement("span", {
		"data-probe-peaks": peaks ? String(peaks.length) : "none",
	});
}

export function mountProbe(container, assetId) {
	const root = createRoot(container);
	root.render(createElement(WaveformProbe, { assetId }));
	return root;
}

export function mountCard(container, asset, actions) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const root = createRoot(container);
	root.render(
		createElement(
			QueryClientProvider,
			{ client },
			createElement(LibraryCard, { asset, selected: false, ...actions }),
		),
	);
	return { client, root };
}
`;
const bundle = await build({
	stdin: {
		contents: ENTRY,
		resolveDir: process.cwd(),
		sourcefile: "library-card.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	define: { "import.meta.env": "{}" },
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@features/chat/components/chat-sidebar": `${process.cwd()}/scripts/library-test-stubs/chat-sidebar.ts`,
	},
	loader: { ".css": "empty" },
	write: false,
});
const bundlePath = new URL(
	`./_library-card-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { mountCard, mountProbe, stopAudio, WaveformProbe } = await import(
	bundlePath.href
);
after(async () => {
	stopAudio();
	await unlink(bundlePath);
});

/* ------------------------------------------------------------- fixtures */

const tag = (id, name) => ({ id, name, category: "topic" });
const asset = (id, patch = {}) => ({
	id,
	ref: {
		type: "artifact",
		path: null,
		display_path: `attachments/${id}.bin`,
		digest: "0123456789abcdef0123456789abcdef",
		content_type: "audio/wav",
	},
	name: "",
	derived_name: `${id}.wav`,
	description: "",
	kind: "audio",
	category: "sound",
	origin: "generated",
	origin_group: "generated",
	origins: ["generated"],
	tags: [],
	primary_tag: null,
	size_bytes: 4096,
	width: null,
	height: null,
	duration_s: 12,
	created_at: 1_700_000_000,
	modified_at: 1_700_000_100,
	last_seen_at: 1_700_000_200,
	exists: true,
	highlighted: false,
	highlight_why: null,
	occurrences: [],
	session_count: 1,
	chat: null,
	preview: { state: "ready", mime_type: "audio/wav", pages: null },
	organized: null,
	locked: false,
	favorite: false,
	archived: false,
	...patch,
});

const AUDIO = asset("la_00000000000000a1", {
	name: "Storm swell",
	derived_name: "storm-swell.wav",
	tags: [tag("t1", "audio")],
});
/*
 * ONE ID PER CASE, because the waveform cache is per asset id FOR THE MODULE'S
 * LIFETIME (the production shape: an asset's sidecar cannot change). A case
 * that reused AUDIO's id would read the first case's settled answer and prove
 * the cache rather than the render.
 */
const AUDIO_404 = asset("la_00000000000000a3");
const AUDIO_STORED = asset("la_00000000000000a4");
const AUDIO_MALFORMED = asset("la_00000000000000a5");
const AUDIO_GATED = asset("la_00000000000000a6");
const IMAGE = asset("la_00000000000000a2", {
	name: "Invoice illustration",
	derived_name: "invoice.png",
	kind: "image",
	category: "image",
	ref: {
		type: "artifact",
		path: null,
		display_path: "attachments/invoice.png",
		digest: "fedcba9876543210fedcba9876543210",
		content_type: "image/png",
	},
	duration_s: null,
	width: 1600,
	height: 1000,
});

const noop = () => {};
const actions = (over = {}) => ({
	onSelect: noop,
	onAsk: noop,
	onEditMetadata: noop,
	onEditTags: noop,
	onToggleFavorite: noop,
	onOpenConversation: noop,
	onFilterSession: noop,
	...over,
});

/** Flush the effect/promise chain the byte and peaks reads run through. */
const settle = async (rounds = 6) => {
	for (let i = 0; i < rounds; i += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
};

/** Deliver one intersection to the observer watching a matching element. */
const intersect = async (predicate) => {
	for (const observer of OBSERVERS) {
		const target = [...observer.targets].find(predicate);
		if (!target) continue;
		await act(async () =>
			observer.callback([{ isIntersecting: true, target }], observer),
		);
		return target;
	}
	return null;
};

const mount = async (row, over = {}) => {
	const container = document.createElement("div");
	document.body.append(container);
	const handle = mountCard(container, row, actions(over));
	await settle();
	return { container, ...handle };
};

const click = async (element) => {
	await act(async () => {
		element.dispatchEvent(
			new dom.window.MouseEvent("click", {
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	await settle();
};

/* ---------------------------------------------------------------- cases */

test("an audio card mounts the shared player; an image card does not", async () => {
	const audio = await mount(AUDIO);
	await intersect((node) => node.hasAttribute("data-library-audio-well"));
	await settle();
	assert.ok(
		audio.container.querySelector(
			'[data-library-audio-well] [data-sound-player="compact"]',
		),
		"the waveform well carries the one shared player",
	);
	assert.equal(
		audio.container.querySelectorAll("[data-sound-player]").length,
		1,
		"one player per card",
	);

	const image = await mount(IMAGE);
	await intersect((node) => node.closest("[data-library-card-id]") !== null);
	await settle();
	assert.ok(
		image.container.querySelector("img"),
		"the image keeps its picture",
	);
	assert.equal(
		image.container.querySelector("[data-sound-player]"),
		null,
		"no player on a picture card",
	);
	assert.ok(
		MEDIA.some((op) => op.op === "library.thumbnail"),
		"the image card still reads its thumbnail route",
	);
});

test("play starts the track in place and does not select the asset", async () => {
	let selected = 0;
	const card = await mount(AUDIO, {
		onSelect: () => {
			selected += 1;
		},
	});
	await intersect((node) => node.hasAttribute("data-library-audio-well"));
	await settle();

	const play = card.container.querySelector("[data-sound-player] button");
	assert.ok(play, "the transport pressed here is the player's own");
	await click(play);
	assert.equal(selected, 0, "the transport press is not a card press");
	assert.ok(
		card.container.querySelector('[data-sound-status="playing"]'),
		"the press actually started playback (fake element, no device)",
	);

	const title = card.container.querySelector(
		`[data-library-card-id="${AUDIO.id}"] > button`,
	);
	assert.ok(title, "the title area is the select control");
	await click(title);
	assert.equal(selected, 1, "the title still selects the asset");
});

test("a 404 waveform still mounts the flat scrubber and keeps the player usable", async () => {
	bridge.waveform = "404";
	try {
		const card = await mount(AUDIO_404);
		await intersect((node) => node.hasAttribute("data-library-audio-well"));
		await settle();
		assert.ok(card.container.querySelector("[data-sound-player]"));
		assert.equal(
			card.container
				.querySelector("[data-sound-player]")
				?.getAttribute("data-sound-peaks"),
			"flat",
			"a missing sidecar is the honest flat scrubber, never a shape",
		);
		assert.ok(card.container.querySelector("[data-sound-slider]"));
	} finally {
		bridge.waveform = "json";
	}
});

test("a stored sidecar draws the waveform, and a malformed one does not", async () => {
	const stored = await mount(AUDIO_STORED);
	await intersect((node) => node.hasAttribute("data-library-audio-well"));
	await settle();
	assert.equal(
		stored.container
			.querySelector("[data-sound-player]")
			?.getAttribute("data-sound-peaks"),
		"stored",
	);

	bridge.waveform = "malformed";
	try {
		const malformed = await mount(AUDIO_MALFORMED);
		await intersect((node) => node.hasAttribute("data-library-audio-well"));
		await settle();
		assert.equal(
			malformed.container
				.querySelector("[data-sound-player]")
				?.getAttribute("data-sound-peaks"),
			"flat",
		);
	} finally {
		bridge.waveform = "json";
	}
});

test("the well's bytes wait for the viewport latch, exactly as the image thumbnail does", async () => {
	MEDIA.length = 0;
	const card = await mount(AUDIO_GATED);
	assert.equal(
		MEDIA.filter(
			(op) => op.op === "library.content" || op.op === "library.waveform",
		).length,
		0,
		"an unseen audio card reads neither bytes nor peaks",
	);
	await intersect((node) => node.hasAttribute("data-library-audio-well"));
	await settle();
	const ops = MEDIA.map((op) => op.op).sort();
	assert.deepEqual(ops, ["library.content", "library.waveform"]);
	assert.equal(
		card.container.querySelector("[data-sound-player]") !== null,
		true,
	);
});

test("switching the drawer's asset clears the previous waveform before the answer", async () => {
	/*
	 * M1 from review round 1: `LibraryPreview` keeps ONE viewer mounted and
	 * swaps its asset prop, so the hook's state survived the switch and drew
	 * A's bars under B's title until B's request answered. The fix seeds the
	 * new asset's peaks from the cache at the top of the effect; this case
	 * parks B's request so the FIRST frame is observable.
	 */
	const first = asset("la_00000000000000b1");
	const second = asset("la_00000000000000b2");
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = mountProbe(container, first.id);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	for (let index = 0; index < 6; index += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
	const probe = () => container.querySelector("[data-probe-peaks]");
	assert.equal(
		probe()?.getAttribute("data-probe-peaks"),
		"3",
		"the first asset's sidecar is painted",
	);
	bridge.waveform = "hang";
	try {
		await act(async () => {
			root.render(createElement(WaveformProbe, { assetId: second.id }));
		});
		assert.equal(
			probe()?.getAttribute("data-probe-peaks"),
			"none",
			"the switch clears A's bars before B answers (flat, never stale)",
		);
	} finally {
		bridge.release?.();
		bridge.release = null;
		bridge.hangGate = null;
		bridge.waveform = "json";
		await act(async () => root.unmount());
		container.remove();
	}
});
