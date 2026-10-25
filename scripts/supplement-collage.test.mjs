/**
 * The 14-sound collage, MOUNTED: fourteen cells with fourteen live players.
 *
 * WHY THIS FILE EXISTS (agent review round 1, M2). `supplement-row.test.mjs`
 * renders the row STATICALLY: a digest has no bytes there, so every cell draws
 * the resolver's reserved line and the static assertion can only count cells,
 * never players. The only fourteen-PLAYER proof was the native sounds scene,
 * which no CI step runs. This mounts the shipped row against a stubbed desktop
 * media boundary and asserts the thing CI must keep: fourteen distinct digests
 * produce fourteen `SoundPlayer`s, in both the expanded and the condensed form.
 *
 * WHAT IT DOES NOT HOLD: pixels. A JSDOM canvas has no 2D context and the
 * waveform's geometry is `waveform-model.test.mjs`'s; the frames are the
 * operator gate's (`scripts/run-sounds-scene.mjs`).
 *
 * AUDIO SAFETY: a fake `Audio` is installed before the bundle loads, so nothing
 * here can reach a device.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/* ------------------------------------------------------------- the fake */

class FakeAudio {
	constructor() {
		this.src = null;
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
		// jsdom accessors that cannot be redefined; the DOM globals suffice.
	}
}
for (const name of ["Event", "CustomEvent", "MouseEvent", "KeyboardEvent"]) {
	globalThis[name] = dom.window[name];
}
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
dom.window.ResizeObserver = globalThis.ResizeObserver;
dom.window.HTMLCanvasElement.prototype.getContext = () => null;
URL.createObjectURL = () => "blob:supplement-collage";
URL.revokeObjectURL = () => {};

/* ------------------------------------------------------------ the bridge */

const MEDIA = [];
globalThis.window.api = {
	desktop: {
		media: async (request) => {
			MEDIA.push(request.op);
			if (request.op === "sessions.attachment") {
				return {
					status: 200,
					kind: "bytes",
					mimeType: "audio/wav",
					data: new Uint8Array([82, 73, 70, 70]),
				};
			}
			if (request.op === "sessions.attachment.waveform") {
				return {
					status: 200,
					kind: "json",
					body: { version: 1, bars: 240, peaks: [0.2, 0.9, 0.4] },
				};
			}
			throw new TypeError(`unexpected media op: ${request.op}`);
		},
	},
};

/* ------------------------------------------------------------ the mount */

const { act } = await import("react");
const { createElement } = await import("react");
const { createRoot } = await import("react-dom/client");

const ENTRY = `
export { SupplementRow } from "./src/renderer/src/features/chat/canonical/supplement-row";
`;
const bundle = await build({
	stdin: {
		contents: ENTRY,
		resolveDir: process.cwd(),
		sourcefile: "supplement-collage.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	define: { "import.meta.env": "{}" },
	jsx: "automatic",
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
	// React stays external so the test and the bundle share one instance; the
	// rest is bundled because `@mui/material/styles` is a DIRECTORY import that
	// node's ESM loader refuses when left external (library-card's bundle can
	// leave packages external because its import graph does not reach it).
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	write: false,
});
const bundlePath = new URL(
	`./_supplement-collage-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(async () => {
	await unlink(bundlePath);
});
const { SupplementRow } = await import(bundlePath.href);

/* --------------------------------------------------------------- fixtures */

const digest = (index) => `${String(index).padStart(32, "0")}`;
const sounds = Array.from({ length: 14 }, (_, index) => ({
	attachment: digest(index + 1),
	mime: "audio/wav",
	title: `Take ${index + 1}`,
	durationS: 6 + index,
}));
const record = {
	kind: "supplement",
	ts: 1_791_000_060,
	anchor: "a1",
	job: "0123456789ab",
	version: 1,
	state: "done",
	files: [],
	filesMore: 0,
	more: [],
	components: [],
	sounds,
	error: "",
	dismissed: false,
	live: false,
};

const settle = async (rounds = 8) => {
	for (let index = 0; index < rounds; index += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
};

const mount = async (condensed) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(
			createElement(SupplementRow, {
				record,
				sessionId: "5ea1face0001",
				condensed,
			}),
		);
	});
	await settle();
	return { container, root };
};

/* ----------------------------------------------------------------- cases */

test("fourteen sounds mount fourteen players, in both forms", async () => {
	for (const condensed of [false, true]) {
		MEDIA.length = 0;
		const { container, root } = await mount(condensed);
		const items = container.querySelectorAll("[data-supplement-sound]");
		const players = container.querySelectorAll(
			"[data-supplement-sound] [data-sound-player]",
		);
		assert.equal(items.length, 14, `14 cells (condensed=${condensed})`);
		assert.equal(players.length, 14, `14 players (condensed=${condensed})`);
		assert.equal(
			container.querySelectorAll("[data-supplement-sound] [data-sound-slider]")
				.length,
			14,
			"every player carries its own scrubber",
		);
		assert.equal(
			container.querySelectorAll("[data-supplement-sound-placeholder]").length,
			0,
			"no cell is left on its reserved line once bytes resolve",
		);
		// One content read and one peaks read per distinct digest: the section
		// never re-fetches a neighbour's media, and no player is a copy.
		assert.equal(
			MEDIA.filter((op) => op === "sessions.attachment").length,
			14,
			"each digest resolves its own bytes once",
		);
		await act(async () => root.unmount());
		container.remove();
	}
});
