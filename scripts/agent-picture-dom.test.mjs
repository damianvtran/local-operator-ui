/**
 * The picture editor's live behaviour, mounted in jsdom.
 *
 * WHY THIS IS NOT IN `agent-picture-edit.test.mjs`. That file renders to static
 * markup, which cannot run an effect or dispatch an event. Three claims of the
 * round-2 remediation are about exactly those two things, so they need a DOM:
 *
 *  - m-A: a pane that is ALREADY open in view mode opens its editor when the
 *    `?edit=picture` instruction arrives (an effect on the prop's rising edge);
 *  - D7/m-D: while a save is in flight the crop square ignores drag, arrows,
 *    `+`/`-`/`0` and the wheel (event handlers reading `busy`);
 *  - D6: the Save pill holds the width of the LONGER of its two labels in every
 *    locale (both labels stacked in one grid cell; the idle one `invisible`).
 *
 * WHAT jsdom CANNOT SAY: it has no layout engine, so the width claim is asserted
 * as the structure that produces it (one grid cell, both labels present, one
 * hidden) and not as pixels - the pixels are measured in a browser and quoted in
 * the PR. `getContext` is stubbed with a recorder so the crop's offset and zoom
 * are observable through the draw calls the component really makes.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export { AgentDetail } from "./src/renderer/src/features/agents/components/agent-detail";',
			'export { AgentAvatarCropper } from "./src/renderer/src/features/agents/components/agent-avatar-cropper";',
			'export { useAgentAvatarLayer, resetAgentAvatarMigrationForTests, LEGACY_AVATAR_STORAGE_KEY } from "./src/renderer/src/shared/agent-avatar/agent-avatar";',
			'export { setLocale } from "./src/renderer/src/shared/i18n";',
			'export { createElement } from "react";',
			'export { createRoot } from "react-dom/client";',
			'export { act } from "react";',
			'export { MemoryRouter } from "react-router-dom";',
			'export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
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
	// A real `require` for the CJS half of the graph (see agent-picture-edit.test.mjs).
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
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
		"react-router-dom",
		"@tanstack/react-query",
	],
	tsconfig: "tsconfig.app.json",
});
const bundlePath = new URL(
	`./_agent-picture-dom-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	AgentDetail,
	AgentAvatarCropper,
	useAgentAvatarLayer,
	resetAgentAvatarMigrationForTests,
	LEGACY_AVATAR_STORAGE_KEY,
	setLocale,
	createElement: h,
	createRoot,
	act,
	MemoryRouter,
	QueryClient,
	QueryClientProvider,
} = await import(bundlePath.href);
await unlink(bundlePath);

/*
 * THE DOM ARRIVES AFTER THE BUNDLE, for the reason `agent-class-toggle.test.mjs`
 * gives: installing a `localStorage` before the stores are evaluated makes their
 * persist middleware rehydrate and mount a poller that keeps the process alive.
 */
const { JSDOM } = await import("jsdom");
const dom = new JSDOM("<!doctype html>", { url: "http://localhost/" });
const { window } = dom;
window.api = {
	desktop: { request: async () => ({ status: 200, body: {} }) },
};
const shims = {
	window,
	document: window.document,
	navigator: window.navigator,
	getComputedStyle: window.getComputedStyle.bind(window),
	requestAnimationFrame: (callback) => setTimeout(callback, 0),
	cancelAnimationFrame: () => {},
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
};
// Every DOM constructor the tree can name, copied by name (the full list
// `agent-class-toggle.test.mjs` uses): a missing one surfaces as a
// ReferenceError inside a React commit, after the assertion that triggered it.
for (const key of [
	"Element",
	"Node",
	"NodeList",
	"DocumentFragment",
	"ShadowRoot",
	"HTMLElement",
	"HTMLAnchorElement",
	"HTMLButtonElement",
	"HTMLCanvasElement",
	"HTMLDivElement",
	"HTMLFormElement",
	"HTMLImageElement",
	"HTMLInputElement",
	"HTMLParagraphElement",
	"HTMLSelectElement",
	"HTMLSpanElement",
	"HTMLStyleElement",
	"HTMLTextAreaElement",
	"SVGElement",
	"MouseEvent",
	"KeyboardEvent",
	"WheelEvent",
	"FocusEvent",
	"PointerEvent",
	"InputEvent",
	"Event",
	"CustomEvent",
	"MutationObserver",
	"IntersectionObserver",
	"DOMParser",
	"XMLSerializer",
]) {
	if (key in window) shims[key] = window[key];
}
const originals = new Map();
for (const [key, value] of Object.entries(shims)) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
window.matchMedia ??= () => ({
	matches: false,
	addEventListener() {},
	removeEventListener() {},
});

/* A recording 2d context: the draw rectangle IS the crop's offset and zoom. */
const draws = [];
window.HTMLCanvasElement.prototype.getContext = function getContext() {
	const canvas = this;
	return {
		clearRect() {},
		drawImage(_source, dx, dy, dw, dh) {
			draws.push({ canvas, dx, dy, dw, dh });
		},
	};
};
window.HTMLCanvasElement.prototype.setPointerCapture = () => {};

const mounted = [];
const mount = async (node) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => root.render(node));
	const rerender = (next) => act(async () => root.render(next));
	mounted.push(root);
	return { container, rerender };
};
after(async () => {
	for (const root of mounted) await act(async () => root.unmount());
	window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

/* ------------------------------------------------- m-A: the open pane --- */

const profile = {
	name: "scout",
	kind: "role",
	source: "custom",
	agent_id: "agent-1",
	description: "Finds things.",
	instructions: "Look.",
	tools: null,
	effort: null,
	delegate: false,
	definition_revision: "rev-1",
};
const pane = (openPictureEditor) =>
	h(
		QueryClientProvider,
		{
			client: new QueryClient({
				defaultOptions: { queries: { retry: false, gcTime: 0 } },
			}),
		},
		h(
			MemoryRouter,
			{ initialEntries: ["/agents?kind=agent&name=scout&agent=agent-1"] },
			h(AgentDetail, {
				profile,
				displayedName: "Scout",
				classNotice: null,
				onClassNotice: () => undefined,
				teams: [],
				effortTiers: [],
				askEnabled: false,
				onSaved: () => undefined,
				onDuplicate: () => undefined,
				onOpenTeam: () => undefined,
				onAskAgent: () => undefined,
				openPictureEditor,
			}),
		),
	);

test("a pane already open in view mode opens its editor when ?edit=picture arrives", async () => {
	const { container, rerender } = await mount(pane(false));
	assert.equal(container.querySelector("#agent-picture"), null);
	await rerender(pane(true));
	assert.ok(
		container.querySelector("#agent-picture"),
		"the picture field should have mounted without pressing Edit",
	);
});

test("the instruction never reopens an editor the person has no agent for", async () => {
	const { container, rerender } = await mount(pane(false));
	// A profile without an id has no field to open (the seed's own rule).
	await rerender(
		h(
			QueryClientProvider,
			{ client: new QueryClient() },
			h(
				MemoryRouter,
				{ initialEntries: ["/agents?kind=agent&name=scout"] },
				h(AgentDetail, {
					profile: { ...profile, agent_id: undefined },
					displayedName: "Scout",
					classNotice: null,
					onClassNotice: () => undefined,
					teams: [],
					effortTiers: [],
					askEnabled: false,
					onSaved: () => undefined,
					onDuplicate: () => undefined,
					onOpenTeam: () => undefined,
					onAskAgent: () => undefined,
					openPictureEditor: true,
				}),
			),
		),
	);
	assert.equal(container.querySelector("#agent-picture"), null);
});

/* ------------------------------------------ D7 / m-D: the locked frame --- */

// 2:1 so the cover fit leaves room to pan horizontally at 1x.
const SOURCE = { width: 512, height: 256 };
const cropper = (props = {}) =>
	h(AgentAvatarCropper, {
		source: SOURCE,
		onSave: () => undefined,
		onCancel: () => undefined,
		...props,
	});
const viewport = (container) =>
	container.querySelector("[data-agent-avatar-crop]");
const zoomReadout = (container) =>
	[...container.querySelectorAll("span")]
		.map((node) => node.textContent)
		.find((text) => /^\d\.\d\d×$/.test(text ?? ""));
const lastDrawOn = (canvas) =>
	draws.findLast((entry) => entry.canvas === canvas);
const key = (canvas, name) =>
	act(async () => {
		canvas.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: name,
				bubbles: true,
				cancelable: true,
			}),
		);
	});
const wheel = async (canvas, deltaY) => {
	const event = new window.WheelEvent("wheel", {
		deltaY,
		bubbles: true,
		cancelable: true,
	});
	await act(async () => {
		canvas.dispatchEvent(event);
	});
	return event;
};

test("an idle crop square answers the arrows, +/-, 0 and the wheel", async () => {
	const { container } = await mount(cropper());
	const canvas = viewport(container);
	const before = lastDrawOn(canvas).dx;
	await key(canvas, "ArrowLeft");
	assert.notEqual(lastDrawOn(canvas).dx, before, "the arrow should pan");
	await key(canvas, "+");
	assert.equal(zoomReadout(container), "1.25×");
	await wheel(canvas, -100);
	assert.notEqual(zoomReadout(container), "1.25×", "the wheel should zoom");
});

test("while saving, the crop square ignores every framing input", async () => {
	const { container, rerender } = await mount(cropper());
	const canvas = viewport(container);
	await rerender(cropper({ saving: true }));
	const frame = { ...lastDrawOn(canvas) };
	const zoom = zoomReadout(container);
	for (const name of [
		"ArrowLeft",
		"ArrowRight",
		"ArrowUp",
		"ArrowDown",
		"+",
		"=",
		"-",
		"0",
	]) {
		await key(canvas, name);
	}
	const spun = await wheel(canvas, -400);
	// A pointer drag: down, move, and the animation frame that would apply it.
	await act(async () => {
		const down = new window.MouseEvent("pointerdown", {
			bubbles: true,
			clientX: 10,
			clientY: 10,
		});
		canvas.dispatchEvent(down);
		const move = new window.MouseEvent("pointermove", {
			bubbles: true,
			clientX: 90,
			clientY: 40,
		});
		canvas.dispatchEvent(move);
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
	const after = lastDrawOn(canvas);
	assert.deepEqual(
		{ dx: after.dx, dy: after.dy, dw: after.dw, dh: after.dh },
		{ dx: frame.dx, dy: frame.dy, dw: frame.dw, dh: frame.dh },
		"the draw rectangle must not move while saving",
	);
	assert.equal(zoomReadout(container), zoom);
	// The page still must not scroll under the square.
	assert.equal(spun.defaultPrevented, true);
});

test("the zoom slider and the other framing controls are disabled while saving", async () => {
	const { container, rerender } = await mount(cropper());
	const slider = container.querySelector('input[type="range"]');
	assert.equal(slider.disabled, false);
	await rerender(cropper({ saving: true }));
	assert.equal(slider.disabled, true);
	// D8: the disabled look is carried by classes that react to `:disabled`, in
	// the same role tokens the other disabled controls use (never opacity).
	assert.match(slider.className, /disabled:cursor-not-allowed/);
	assert.match(
		slider.className,
		/disabled:\[&::-webkit-slider-thumb\]:bg-ink-disabled/,
	);
	assert.match(slider.className, /var\(--color-ink-disabled\)/);
	assert.doesNotMatch(slider.className, /opacity/);
});

/* ----------------------------------------------- D6: the Save pill --- */

for (const locale of ["en", "fr", "ru", "es", "hi", "ur"]) {
	test(`the Save pill holds both labels in one cell (${locale})`, async () => {
		setLocale(locale);
		const { container, rerender } = await mount(cropper());
		const labels = () => {
			const pill = container.querySelector("[data-agent-avatar-save]");
			const cell = pill.querySelector(".inline-grid");
			assert.ok(cell, "both labels share one grid cell");
			const [save, saving] = [...cell.children];
			return {
				text: [save.textContent, saving.textContent],
				hidden: [
					save.classList.contains("invisible"),
					saving.classList.contains("invisible"),
				],
				spoken: pill.textContent,
			};
		};
		const idle = labels();
		assert.notEqual(idle.text[0], idle.text[1]);
		assert.deepEqual(idle.hidden, [false, true]);
		await rerender(cropper({ saving: true }));
		const busy = labels();
		assert.deepEqual(busy.text, idle.text, "the cell's content never changes");
		assert.deepEqual(busy.hidden, [true, false]);
	});
}

/* ------------------------------------- Q-2: the migration needs no page --- */

/*
 * THE #1517 MIGRATION RUNS FROM THE APP'S AVATAR LAYER, NOT FROM THE AGENTS PAGE
 * (QA round 1, Q-2). It is triggered by the first avatar-map read, and the chat
 * header and sidebar rows pass the session row's digest as a hint that switches
 * that read off - so a person who stayed in chat never triggered it. Here only
 * `useAgentAvatarLayer` is mounted (the hook `app.tsx` calls once); the Agents
 * page, the editor and every hinted surface are NOT, which is what makes this
 * fail on the old code: nothing mounted reads the map, so no PUT is ever made.
 *
 * The transport is the desktop bridge the renderer really calls: the agents list
 * goes through `desktop.request` and the upload through `desktop.media`.
 */
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from("fixture-bytes").toString("base64")}`;
const SHA_ON_BACKEND = "f".repeat(64);

test("the migration uploads a legacy picture with only the app layer mounted", async () => {
	const puts = [];
	window.api.desktop.request = async () => ({
		status: 200,
		body: {
			result: {
				agents: [
					{ id: "agent-new" },
					{ id: "agent-has", avatar: { sha256: SHA_ON_BACKEND } },
				],
			},
		},
	});
	window.api.desktop.media = async (request) => {
		puts.push(request);
		return { status: 200, kind: "json", body: {} };
	};
	globalThis.localStorage = window.localStorage;
	window.localStorage.setItem(
		LEGACY_AVATAR_STORAGE_KEY,
		JSON.stringify({
			state: {
				images: {
					"agent-new": PNG_DATA_URL,
					// The backend already has a picture: it wins, nothing is uploaded.
					"agent-has": PNG_DATA_URL,
					// Not in this backend's list: kept, never dropped.
					"agent-unknown": PNG_DATA_URL,
				},
			},
			version: 0,
		}),
	);
	resetAgentAvatarMigrationForTests();
	const Layer = () => {
		useAgentAvatarLayer();
		return null;
	};
	await mount(
		h(
			QueryClientProvider,
			{
				client: new QueryClient({
					defaultOptions: { queries: { retry: false, gcTime: 0 } },
				}),
			},
			h(Layer),
		),
	);
	// The map read and the migration are async; let them settle.
	for (let i = 0; i < 20 && puts.length < 1; i++) {
		await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
	}
	await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
	assert.deepEqual(
		puts.map((p) => [p.op, p.agentId]),
		[["agent.avatar.put", "agent-new"]],
		"exactly one upload: the agent the backend lacks",
	);
	const left = JSON.parse(
		window.localStorage.getItem(LEGACY_AVATAR_STORAGE_KEY),
	).state.images;
	assert.deepEqual(
		Object.keys(left),
		["agent-unknown"],
		"uploaded and backend-won entries are cleared, the unknown id is kept",
	);
});
