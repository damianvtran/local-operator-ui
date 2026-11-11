/** Real source + mounted DOM contracts; pixels remain independent browser QA's. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
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
// Radix dispatches CustomEvent through the document; use the same DOM realm.
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
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
		contents: `
 export { getFileName } from "./src/renderer/src/features/chat/utils/get-file-name";
 export { encodeAttachments } from "./src/renderer/src/features/chat/utils/attachment-encode";
 export { FileActionsMenu } from "./src/renderer/src/features/chat/canonical/supplement-file-actions";
 export { ImageActionsMenu } from "./src/renderer/src/features/chat/components/image-actions-menu";
 export { SoundPlayer } from "./src/renderer/src/features/chat/canonical/sound-player";
 export { setLocale, t } from "./src/i18n";
 `,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "browser",
	write: false,
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	tsconfig: "tsconfig.web.json",
	loader: { ".css": "empty" },
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
});
const bundlePath = new URL(
	`./_attachment-chrome-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(async () => {
	await unlink(bundlePath);
	dom.window.close();
});
const {
	getFileName,
	encodeAttachments,
	FileActionsMenu,
	ImageActionsMenu,
	SoundPlayer,
	setLocale,
} = await import(bundlePath.href);
const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const locales = JSON.parse(
	readFileSync("i18n/languages.json", "utf8"),
).languages.map((x) => x.code);
const catalogues = Object.fromEntries(
	locales.map((locale) => [
		locale,
		Object.assign(
			{},
			...["ui.chat", "ui.chat.composer_media", "ui.common.actions"].map((ns) =>
				JSON.parse(
					readFileSync(`src/i18n/catalogues/${locale}/${ns}.json`, "utf8"),
				),
			),
		),
	]),
);
const message = (locale, key, arg = {}) =>
	catalogues[locale][key].replace(
		/\{(name|label|current|total)\}/g,
		(_, k) => arg[k],
	);
const name = "Résumé — رپورٹ '猫'.png";
async function mount(element) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => root.render(element));
	return {
		container,
		async close() {
			await act(async () => root.unmount());
			container.remove();
		},
	};
}
test("fallback-names-all-locales", () => {
	for (const locale of locales) {
		setLocale(locale);
		for (const uri of [
			"data:image/png;base64,AA==",
			"data:image/png;name=%E0%A4%A;base64,AA==",
		])
			assert.equal(
				getFileName(uri),
				message(locale, "ui.chat.composer_media.pasted_image"),
			);
		for (const uri of [
			"data:application/pdf;base64,AA==",
			"data:;base64,AA==",
			"data:text/plain;name=%E0%A4%A;base64,AA==",
		])
			assert.equal(
				getFileName(uri),
				message(locale, "ui.chat.composer_media.pasted_file"),
			);
		for (const mime of ["image/png", "application/pdf"])
			assert.equal(
				getFileName(
					`data:${mime};name=${encodeURIComponent(name)};base64,AA==`,
				),
				name,
			);
		assert.equal(getFileName(`/tmp/${name}`), name);
		assert.equal(getFileName(`C:\\files\\${name}`), name);
	}
	setLocale("en");
});
test("generic-upload-name-is-intentional", async () => {
	const originalApi = window.api;
	try {
		for (const locale of locales) {
			setLocale(locale);
			const calls = [];
			window.api = {
				uploadAttachment: async (source) => {
					calls.push(source);
					return {
						success: true,
						attachment: {
							digest: "a".repeat(64),
							name: source.name,
							mime_type: "application/pdf",
							bytes: 1,
						},
					};
				},
			};
			const named = `data:application/pdf;name=${encodeURIComponent(name)};base64,AA==`;
			const unnamed = "data:application/pdf;base64,AA==";
			const result = await encodeAttachments([
				named,
				unnamed,
				"data:image/png;base64,AA==",
			]);
			assert.deepEqual(calls, [
				{ kind: "dataUrl", dataUrl: named, name },
				{
					kind: "dataUrl",
					dataUrl: unnamed,
					name: message(locale, "ui.chat.composer_media.pasted_file"),
				},
			]);
			assert.equal(result.files[0].name, name);
			assert.equal(result.files[1].bytes, 1);
			assert.equal(result.files[1].mime_type, "application/pdf");
			assert.equal(result.images.length, 1);
			assert.equal(result.images[0].mime_type, "image/png");
			assert.equal(result.images[0].data_b64, "AA==");
		}
	} finally {
		window.api = originalApi;
		setLocale("en");
	}
});
test("action-names-all-locales and mounted en-fr-ur without new props", async () => {
	const view = await mount(
		h(
			"div",
			null,
			h(FileActionsMenu, { actionPath: "/tmp/a.pdf", label: name }),
			h(FileActionsMenu, { actionPath: "/tmp/a.pdf", label: "" }),
			h(FileActionsMenu, { actionPath: "/tmp/a.pdf" }),
			h(ImageActionsMenu, { file: "/tmp/a.png", label: name }),
			h(ImageActionsMenu, { file: "/tmp/a.png" }),
			h(ImageActionsMenu, { file: "/tmp/a.png", label: "" }),
			h(ImageActionsMenu, {
				file: "/tmp/a.png",
				label: name,
				"aria-label": "",
			}),
			h(ImageActionsMenu, {
				file: "/tmp/a.png",
				label: name,
				"aria-label": name,
			}),
		),
	);
	try {
		const buttons = [...view.container.querySelectorAll("button")];
		assert.equal(buttons.length, 8);
		for (const locale of [...locales, "en", "fr", "ur"]) {
			await act(async () => setLocale(locale));
			const named = message(locale, "ui.common.actions.actions_for_name", {
				name,
			});
			assert.deepEqual(
				buttons.map((x) => x.getAttribute("aria-label")),
				[
					named,
					message(locale, "ui.common.actions.file_actions_menu.file_actions"),
					message(locale, "ui.common.actions.file_actions_menu.file_actions"),
					named,
					message(locale, "ui.chat.image_actions.actions"),
					message(locale, "ui.common.actions.actions_for_name", { name: "" }),
					"",
					name,
				],
			);
			assert.equal(
				view.container.querySelector("button"),
				buttons[0],
				"no remount on locale change",
			);
		}
	} finally {
		await view.close();
		setLocale("en");
	}
});
test("audio-slider-named-all-locales and mounted en-fr-ur without new props", async () => {
	const second = "Swell — آواز";
	const view = await mount(
		h(
			"div",
			null,
			...[name, second].map((label, i) =>
				h(SoundPlayer, {
					key: i,
					ownerId: `attachment-chrome-${i}`,
					src: `blob:synthetic-${i}`,
					label,
					peaks: [0.2, 0.8],
					durationHint: 10,
				}),
			),
		),
	);
	try {
		const sliders = [...view.container.querySelectorAll('[role="slider"]')];
		assert.equal(sliders.length, 2);
		const before = sliders.map((x) => [
			x.getAttribute("aria-valuenow"),
			x.getAttribute("aria-valuetext"),
		]);
		for (const locale of [...locales, "en", "fr", "ur"]) {
			await act(async () => setLocale(locale));
			assert.deepEqual(
				sliders.map((x) => x.getAttribute("aria-label")),
				[name, second].map((label) =>
					message(locale, "ui.chat.audio.position_label", { label }),
				),
			);
			assert.equal(view.container.querySelector('[role="slider"]'), sliders[0]);
			// aria-valuenow is locale-free and must not move; aria-valuetext is the
			// catalogue sentence over the two m:ss clocks (ASCII digits, as the
			// visible readout) and must follow the locale on a PAUSED, mounted clip,
			// where only the painter's locale dependency rewrites it (census B7).
			assert.deepEqual(
				sliders.map((x) => [
					x.getAttribute("aria-valuenow"),
					x.getAttribute("aria-valuetext"),
				]),
				before.map(([now]) => [
					now,
					message(locale, "ui.chat.audio.position_value", {
						current: "0:00",
						total: "0:10",
					}),
				]),
			);
		}
	} finally {
		await view.close();
		setLocale("en");
	}
});
test("fixture-chrome-not-transcript", () => {
	const story = readFileSync(
		"src/renderer/src/features/chat/components/canvas/canvas.stories.tsx",
		"utf8",
	);
	assert.ok(story.includes('t("ui.chat.composer.placeholder.idle")'));
	assert.ok(!story.includes("Ask a follow-up about the write-up"));
	assert.ok(
		story.includes(
			"Reconcile the March invoices and write up who still owes money.",
		),
	);
	assert.ok(
		story.includes(
			"Three customers are outstanding: Northwind, Contoso and Fabrikam, for",
		),
	);
});
