/**
 * The project feed's asset grid: every kind renders, the shared gallery walks
 * its update's pictures and clips, and a long feed does not read files it has
 * not scrolled to.
 *
 *     node --test scripts/project-update-assets.test.mjs
 *
 * WHY THIS FILE EXISTS. The operator's ask was a GRID of an update's evidence
 * — images, sounds, videos and plain files — opening the chat view's own
 * viewer rather than a second one, plus a lightbox that walks only that
 * update's media. Those are wiring claims a frame cannot carry: a still of the
 * open lightbox looks identical whether Next is bound to the group or to
 * nothing, and "the tile did not read its bytes yet" is invisible in a
 * screenshot. So this drives the SHIPPED components (the production
 * `ProjectUpdateAssets`, the real `ImageAttachment`, `SoundPlayer`,
 * `FileActionsMenu` and `ImageLightbox`) and asserts what the DOM says after a
 * real press and a real Escape.
 *
 * WHAT IT PINS:
 *
 *   1. all four kinds render, and a legacy `data` row is classified by its
 *      extension (`.mp3`/`.mp4`) rather than falling through to a file tile;
 *   2. an image tile opens the shared lightbox — one dialog for the update, not
 *      the single-picture overlay `ImageAttachment` opens when no `press` is
 *      supplied;
 *   3. a video tile opens that same lightbox on a `<video>` slide;
 *   4. Next/Previous wrap within the update's media set, and the filmstrip
 *      jumps to a named slide;
 *   5. Escape closes the lightbox;
 *   6. a markdown tile opens the in-app preview dialog through
 *      `window.api.readFile` and does NOT hand the file to the OS
 *      (`window.api.openFile`), while a spreadsheet tile still does;
 *   7. lazy tiles reserve their slot but call no byte reader until
 *      `useEverInView` sees them.
 *
 * HOW IT STANDS IN FOR A BROWSER. jsdom with React's scheduler and the same
 * `act`/settle rig `chat-image-expand.test.mjs` establishes. The assertions are
 * structural — which element exists, what it is called, which reader was
 * called, what `src` the frame paints — not geometric: jsdom has no layout
 * engine, so the 117x78 slot, the four-per-row wrap and the hover reveal are
 * Storybook's business (`projects.stories.tsx`'s `with-assets`), not this
 * file's. A green test here is not visual evidence and does not claim to be.
 *
 * `IntersectionObserver` is a controllable double rather than the hook's
 * fail-open path: a host without one returns `seen = true` on the first render,
 * which would make the laziness case pass by never being lazy. The double
 * records every observer and lets a case deliver the intersecting entries at
 * the moment it chooses.
 *
 * ISOLATION. Nothing here boots the app, a fork or Electron: jsdom in this
 * process, a fake `window.api`, and no network. The fixture paths are invented
 * and never read — `readFileBytes`/`readFile` are the boundary under test.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const ROOT = resolve(import.meta.dirname, "..");

// React DOM feature-detects input events at import time, so a document has to
// exist before it is loaded — the bootstrap the sibling harnesses use.
const bootstrap = new JSDOM("<!doctype html>", { url: "http://localhost/" });
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
globalThis.localStorage = bootstrap.window.localStorage;
globalThis.sessionStorage = bootstrap.window.sessionStorage;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrap.window.close();
	for (const name of ["window", "document", "localStorage", "sessionStorage"]) {
		Reflect.deleteProperty(globalThis, name);
	}
});

const EXTERNAL = /^(react|react-dom)(\/.*)?$/;
const BARE_SPECIFIER = /^[^./]/;
const CACHE = join(ROOT, "node_modules", ".cache", "project-update-assets");
const bundle = await build({
	stdin: {
		contents: `
			export {
				ProjectUpdateAssets,
				projectAssetKind,
			} from "./src/renderer/src/features/projects/components/project-update-assets";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45999" };',
	},
	plugins: [
		{
			name: "react-stays-out",
			setup(builder) {
				builder.onResolve({ filter: BARE_SPECIFIER }, (args) =>
					EXTERNAL.test(args.path) ? { path: args.path, external: true } : null,
				);
			},
		},
	],
	loader: { ".css": "empty" },
	alias: {
		"@assets": resolve(ROOT, "src/renderer/src/assets"),
		"@features": resolve(ROOT, "src/renderer/src/features"),
		"@renderer": resolve(ROOT, "src/renderer/src"),
		"@shared": resolve(ROOT, "src/renderer/src/shared"),
	},
	write: false,
});
mkdirSync(CACHE, { recursive: true });
const bundlePath = join(CACHE, "project-update-assets.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const { ProjectUpdateAssets, projectAssetKind } = await import(
	pathToFileURL(bundlePath).href
);

/* ------------------------------------------------------------------ fixtures */

let fixtureId = 0;
const attachment = (name, kind, bytes = 1024) => ({
	name,
	kind,
	path: `/tmp/project-update-assets/${name}`,
	bytes,
	added_at: "2026-10-19T10:00:00Z",
});

/**
 * One update carrying all four kinds in the order the grid must keep, plus the
 * legacy rows the backend wrote before `audio`/`video` existed: `data` for a
 * `.wav` and a `.mp4` is still a player and a clip.
 */
const fixture = () => {
	fixtureId += 1;
	return {
		at: "2026-10-19T10:00:00Z",
		text: "## Evidence\n\nAll four kinds.",
		by: "operator",
		attachments: [
			attachment(`shot-one-${fixtureId}.png`, "image"),
			attachment(`clip-${fixtureId}.mp4`, "video"),
			attachment(`voice-${fixtureId}.wav`, "audio"),
			attachment(`notes-${fixtureId}.md`, "data"),
			attachment(`table-${fixtureId}.csv`, "data"),
			attachment(`legacy-clip-${fixtureId}.mp4`, "data"),
			attachment(`legacy-sound-${fixtureId}.mp3`, "data"),
		],
	};
};

const grid = (document) => document.querySelector("[data-project-asset-grid]");
const tiles = (document, kind) =>
	document.querySelectorAll(`[data-project-asset-tile="${kind}"]`);
const dialog = (document) => document.querySelector('[role="dialog"]');
const viewerImage = (document) =>
	document.querySelector("[data-image-viewport] img");
const viewerVideo = (document) =>
	document.querySelector("[data-image-viewport] video[data-lightbox-video]");
const filmstrip = (document) =>
	document.querySelector("[data-project-asset-filmstrip]");
const filmstripButtons = (document) => [
	...(filmstrip(document)?.querySelectorAll("button") ?? []),
];

/* -------------------------------------------------------------------- mount */

/**
 * Mount `element` in a fresh jsdom with a fake bridge, a controllable
 * IntersectionObserver, and the globals Radix/React reach for as bare names.
 * The body runs inside that realm; the DOM is torn down after it, including
 * one timer turn for Radix's focus handoff (the reason is in
 * `chat-image-expand.test.mjs`'s mount).
 */
async function mount(bridge, body) {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	const { window } = dom;
	const originals = new Map();
	const observers = [];
	const readings = { bytes: [], text: [], opened: [], revealed: [] };

	class MockIntersectionObserver {
		constructor(callback, options) {
			this.callback = callback;
			this.options = options;
			this.disconnected = false;
			this.target = null;
			observers.push(this);
		}

		observe(target) {
			this.target = target;
		}

		disconnect() {
			this.disconnected = true;
		}

		unobserve() {}
		takeRecords() {
			return [];
		}
	}

	const shims = {
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		Element: window.Element,
		Node: window.Node,
		Event: window.Event,
		CustomEvent: window.CustomEvent,
		MouseEvent: window.MouseEvent,
		KeyboardEvent: window.KeyboardEvent,
		requestAnimationFrame: window.requestAnimationFrame.bind(window),
		cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
		MutationObserver: window.MutationObserver,
		IntersectionObserver: MockIntersectionObserver,
		NodeFilter: window.NodeFilter,
		HTMLInputElement: window.HTMLInputElement,
		getComputedStyle: window.getComputedStyle.bind(window),
		ResizeObserver: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
		localStorage: window.localStorage,
		sessionStorage: window.sessionStorage,
		IS_REACT_ACT_ENVIRONMENT: true,
		matchMedia: (query) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener() {},
			removeListener() {},
			addEventListener() {},
			removeEventListener() {},
			dispatchEvent: () => false,
		}),
	};
	for (const [key, value] of Object.entries(shims)) {
		originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value,
		});
	}
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: shims.matchMedia,
	});
	window.IntersectionObserver = MockIntersectionObserver;
	// jsdom has no scroll method; the strip's reveal is a browser nicety.
	window.Element.prototype.scrollIntoView = () => {};

	window.api = {
		readFileBytes: async (path) => {
			readings.bytes.push(path);
			return { success: true, data: new Uint8Array([137, 80, 78, 71]) };
		},
		readFile: async (path) => {
			readings.text.push(path);
			return { success: true, data: "# Notes\n\nAll four kinds are here." };
		},
		openFile: (path) => {
			readings.opened.push(path);
		},
		showItemInFolder: () => {},
		...bridge,
	};
	// jsdom has no canvas; SoundPlayer skips painting when getContext is null.
	window.HTMLCanvasElement.prototype.getContext = () => null;

	const root = createRoot(window.document.getElementById("root"));
	const api = {
		window,
		document: window.document,
		readings,
		observers,
		render: async (element) => {
			act(() => {
				root.render(element);
			});
			await act(async () => {});
		},
		click: async (target) => {
			assert.ok(target, "the element to press must exist");
			act(() => {
				target.dispatchEvent(
					new window.MouseEvent("click", { bubbles: true, cancelable: true }),
				);
			});
			await api.settle();
		},
		pressEscape: async (landed = () => true) => {
			act(() => {
				window.document.dispatchEvent(
					new window.KeyboardEvent("keydown", {
						key: "Escape",
						bubbles: true,
						cancelable: true,
					}),
				);
			});
			await api.settle(landed);
		},
		settle: async (landed = () => true, budget = 40) => {
			for (let tick = 0; tick < budget; tick += 1) {
				await act(async () => {
					await new Promise((resolve) => setTimeout(resolve, 0));
				});
				await new Promise((resolve) =>
					window.requestAnimationFrame(() => resolve()),
				);
				if (landed()) return;
			}
		},
		/**
		 * Deliver one intersecting entry to every live observer, the moment the
		 * lazy cases choose. The hook disconnects after the first `seen`, so an
		 * observer already disconnected is skipped rather than handed a second
		 * entry.
		 */
		revealSome: async (count) => {
			let revealed = 0;
			act(() => {
				for (const observer of [...observers]) {
					if (revealed >= count) break;
					if (observer.disconnected || observer.target === null) continue;
					observer.callback(
						[{ isIntersecting: true, target: observer.target }],
						observer,
					);
					revealed += 1;
				}
			});
			await api.settle();
			return revealed;
		},
		revealAll: async () => {
			act(() => {
				for (const observer of [...observers]) {
					if (observer.disconnected || observer.target === null) continue;
					observer.callback(
						[{ isIntersecting: true, target: observer.target }],
						observer,
					);
				}
			});
			await api.settle();
		},
	};
	try {
		await body(api);
	} finally {
		act(() => root.unmount());
		await act(async () => {});
		await new Promise((resolve) => setTimeout(resolve, 0));
		window.close();
		for (const [key, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	}
}

/* --------------------------------------------------------------------- cases */

test("a legacy `data` row is classified by its extension", () => {
	assert.equal(projectAssetKind(attachment("shot.png", "data")), "image");
	assert.equal(projectAssetKind(attachment("clip.mp4", "data")), "video");
	assert.equal(projectAssetKind(attachment("voice.wav", "data")), "audio");
	assert.equal(projectAssetKind(attachment("table.csv", "data")), "file");
	// An explicit kind wins over a misleading extension: the writer said what it was.
	assert.equal(projectAssetKind(attachment("clip.mp4", "image")), "image");
});

test("the grid renders images, videos, sounds and files", async () => {
	const update = fixture();
	await mount(null, async (api) => {
		await api.render(
			React.createElement(ProjectUpdateAssets, {
				attachments: update.attachments,
			}),
		);
		await api.revealAll();

		assert.ok(grid(api.document), "the grid itself is mounted");
		assert.equal(tiles(api.document, "image").length, 1);
		assert.equal(
			tiles(api.document, "video").length,
			2,
			"the explicit clip and the legacy data row",
		);
		assert.equal(
			tiles(api.document, "audio").length,
			2,
			"the explicit sound and the legacy data row",
		);
		assert.equal(
			tiles(api.document, "file").length,
			2,
			"the markdown note and the spreadsheet",
		);
		assert.equal(
			api.document.querySelectorAll("[data-sound-player='compact']").length,
			2,
			"both sounds are the canonical compact player, not a bare <audio>",
		);
		assert.equal(
			api.document.querySelectorAll("audio").length,
			0,
			"no bare audio element on the surface",
		);
	});
});

test("an image tile opens the shared lightbox for the whole update", async () => {
	const update = fixture();
	await mount(null, async (api) => {
		await api.render(
			React.createElement(ProjectUpdateAssets, {
				attachments: update.attachments,
			}),
		);
		await api.revealAll();
		await api.click(
			api.document.querySelector(
				`button[aria-label="Open shot-one-${fixtureId}.png"]`,
			),
		);

		assert.ok(dialog(api.document), "pressing the picture opens a dialog");
		assert.equal(
			api.document.querySelectorAll('[role="dialog"]').length,
			1,
			"exactly one dialog: the grid owns one gallery",
		);
		assert.ok(viewerImage(api.document), "the shared image frame is painted");
		assert.equal(
			viewerImage(api.document).getAttribute("src")?.startsWith("blob:"),
			true,
			"the viewer paints the resolved bytes, not a stale placeholder",
		);
	});
});

test("Next and Previous walk that update's media, wrapping at both ends", async () => {
	fixture();
	const attachments = [
		attachment(`shot-a-${fixtureId}.png`, "image"),
		attachment(`shot-b-${fixtureId}.png`, "image"),
		attachment(`clip-${fixtureId}.mp4`, "video"),
	];
	await mount(null, async (api) => {
		await api.render(React.createElement(ProjectUpdateAssets, { attachments }));
		await api.revealAll();
		await api.click(
			api.document.querySelector(
				`button[aria-label="Open shot-a-${fixtureId}.png"]`,
			),
		);
		await api.settle(() => viewerImage(api.document) !== null);
		assert.equal(viewerImage(api.document)?.alt, `shot-a-${fixtureId}.png`);

		const next = () =>
			api.click(
				api.document.querySelector('[role="dialog"] [data-image-viewer-next]'),
			);
		const previous = () =>
			api.click(
				api.document.querySelector('[role="dialog"] [data-image-viewer-prev]'),
			);

		await next();
		await api.settle(() => viewerImage(api.document)?.alt !== undefined);
		assert.equal(
			viewerImage(api.document)?.alt,
			`shot-b-${fixtureId}.png`,
			"Next moves to the second picture",
		);

		await previous();
		await api.settle(() => viewerImage(api.document) !== null);
		assert.equal(
			viewerImage(api.document)?.alt,
			`shot-a-${fixtureId}.png`,
			"Previous returns to the first picture",
		);

		await previous();
		await api.settle(() => viewerVideo(api.document) !== null);
		assert.ok(
			viewerVideo(api.document),
			"Previous wraps past the first picture to the last media item",
		);

		await next();
		await api.settle(() => viewerImage(api.document) !== null);
		assert.equal(
			viewerImage(api.document)?.alt,
			`shot-a-${fixtureId}.png`,
			"Next wraps past the last item back to the first",
		);
	});
});

test("a video tile opens the lightbox on a video slide", async () => {
	const update = fixture();
	await mount(null, async (api) => {
		await api.render(
			React.createElement(ProjectUpdateAssets, {
				attachments: update.attachments,
			}),
		);
		await api.revealAll();
		await api.click(
			api.document.querySelector(
				`button[aria-label="Play clip-${fixtureId}.mp4"]`,
			),
		);

		assert.ok(viewerVideo(api.document), "the video slide is a real <video>");
		assert.equal(viewerVideo(api.document).hasAttribute("controls"), true);
		assert.equal(viewerVideo(api.document).autoplay, true);
		assert.equal(
			viewerImage(api.document),
			null,
			"no image frame under a clip",
		);
	});
});

test("the filmstrip jumps to the slide it names", async () => {
	const update = fixture();
	await mount(null, async (api) => {
		await api.render(
			React.createElement(ProjectUpdateAssets, {
				attachments: update.attachments,
			}),
		);
		await api.revealAll();
		await api.click(
			api.document.querySelector(
				`button[aria-label="Open shot-one-${fixtureId}.png"]`,
			),
		);
		const buttons = filmstripButtons(api.document);
		assert.equal(
			buttons.length,
			3,
			"the update's picture and both clips are its set",
		);

		const clip = buttons.find((button) =>
			(button.getAttribute("aria-label") ?? "").includes(
				`clip-${fixtureId}.mp4`,
			),
		);
		assert.ok(clip, "the clip has a filmstrip tile a reader can name");
		await api.click(clip);
		await api.settle(() => viewerVideo(api.document) !== null);
		assert.ok(viewerVideo(api.document), "the strip selected the clip");
	});
});

test("Escape closes the lightbox", async () => {
	const update = fixture();
	await mount(null, async (api) => {
		await api.render(
			React.createElement(ProjectUpdateAssets, {
				attachments: update.attachments,
			}),
		);
		await api.revealAll();
		await api.click(
			api.document.querySelector(
				`button[aria-label="Open shot-one-${fixtureId}.png"]`,
			),
		);
		assert.ok(dialog(api.document));
		await api.pressEscape(() => dialog(api.document) === null);
		assert.equal(dialog(api.document), null, "the layer is gone");
	});
});

test("markdown opens the in-app preview, not the OS app", async () => {
	const update = fixture();
	await mount(null, async (api) => {
		await api.render(
			React.createElement(ProjectUpdateAssets, {
				attachments: update.attachments,
			}),
		);
		await api.revealAll();
		await api.click(
			api.document.querySelector(
				`button[aria-label="Preview notes-${fixtureId}.md"]`,
			),
		);
		await api.settle(
			() =>
				api.document.querySelector("[data-project-file-preview] h1") !== null,
		);

		assert.ok(dialog(api.document), "the preview dialog opened");
		assert.deepEqual(api.readings.text, [
			`/tmp/project-update-assets/notes-${fixtureId}.md`,
		]);
		assert.equal(
			api.document.querySelector("[data-project-file-preview] h1")?.textContent,
			"Notes",
			"the markdown is rendered by ProjectMarkdown, not shown as source",
		);
		assert.deepEqual(
			api.readings.opened,
			[],
			"the OS application was not asked to open the note",
		);

		await api.pressEscape(() => dialog(api.document) === null);
	});
});

test("a spreadsheet still falls back to the OS app", async () => {
	const update = fixture();
	await mount(null, async (api) => {
		await api.render(
			React.createElement(ProjectUpdateAssets, {
				attachments: update.attachments,
			}),
		);
		await api.revealAll();
		await api.click(
			api.document.querySelector(
				`button[aria-label="Open table-${fixtureId}.csv"]`,
			),
		);
		assert.deepEqual(api.readings.opened, [
			`/tmp/project-update-assets/table-${fixtureId}.csv`,
		]);
		assert.equal(dialog(api.document), null, "no in-app preview for a sheet");
	});
});

/* -------------------------------------------------------------- focus return */

/**
 * Radix's modal path restores focus to a `DialogTrigger` this composition does
 * not have; without an explicit target every exit lands on `<body>`, and the
 * reader's next Tab starts from the top of the app. These cases press the
 * tile, close by each door, and read `document.activeElement`.
 */
const imageButton = (document) =>
	document.querySelector('[data-project-asset-tile="image"] button');
const previewButton = (document, name) =>
	document.querySelector(`button[aria-label="Preview ${name}"]`);

test("Escape returns focus to the pressed picture tile", async () => {
	const update = fixture();
	await mount(null, async (api) => {
		await api.render(
			React.createElement(ProjectUpdateAssets, {
				attachments: update.attachments,
			}),
		);
		await api.revealAll();
		const tile = imageButton(api.document);
		assert.ok(tile, "the picture tile");
		tile.focus();
		await api.click(tile);
		assert.ok(dialog(api.document));
		await api.pressEscape(() => dialog(api.document) === null);
		assert.equal(
			api.document.activeElement,
			tile,
			"Escape hands focus back to the tile",
		);
	});
});

test("the X returns focus to the pressed picture tile", async () => {
	const update = fixture();
	await mount(null, async (api) => {
		await api.render(
			React.createElement(ProjectUpdateAssets, {
				attachments: update.attachments,
			}),
		);
		await api.revealAll();
		const tile = imageButton(api.document);
		assert.ok(tile, "the picture tile");
		tile.focus();
		await api.click(tile);
		assert.ok(dialog(api.document));
		await api.click(
			api.document.querySelector('button[aria-label="Close asset"]'),
		);
		await api.settle(() => dialog(api.document) === null);
		assert.equal(
			api.document.activeElement,
			tile,
			"the close control hands focus back to the tile",
		);
	});
});

test("Escape returns focus to the pressed note tile", async () => {
	const update = fixture();
	await mount(null, async (api) => {
		await api.render(
			React.createElement(ProjectUpdateAssets, {
				attachments: update.attachments,
			}),
		);
		const tile = previewButton(api.document, `notes-${fixtureId}.md`);
		assert.ok(tile, "the markdown tile");
		tile.focus();
		await api.click(tile);
		await api.settle(() => dialog(api.document) !== null);
		await api.pressEscape(() => dialog(api.document) === null);
		assert.equal(
			api.document.activeElement,
			tile,
			"Escape hands focus back to the file tile",
		);
	});
});

test("the preview X returns focus to the pressed note tile", async () => {
	const update = fixture();
	await mount(null, async (api) => {
		await api.render(
			React.createElement(ProjectUpdateAssets, {
				attachments: update.attachments,
			}),
		);
		const tile = previewButton(api.document, `notes-${fixtureId}.md`);
		assert.ok(tile, "the markdown tile");
		tile.focus();
		await api.click(tile);
		await api.settle(() => dialog(api.document) !== null);
		await api.click(
			api.document.querySelector('[role="dialog"] button[aria-label="Close"]'),
		);
		await api.settle(() => dialog(api.document) === null);
		assert.equal(
			api.document.activeElement,
			tile,
			"the close control hands focus back to the file tile",
		);
	});
});

test("Preview from the tile menu returns focus to the tile button", async () => {
	const update = fixture();
	await mount(null, async (api) => {
		await api.render(
			React.createElement(ProjectUpdateAssets, {
				attachments: update.attachments,
			}),
		);
		const tile = previewButton(api.document, `notes-${fixtureId}.md`);
		const trigger = api.document.querySelector(
			`button[aria-label="File actions for notes-${fixtureId}.md"]`,
		);
		assert.ok(tile, "the file tile button");
		assert.ok(trigger, "the tile's ellipsis trigger");
		/*
		 * The projects board's own menu driver: Radix opens on the down edge, and
		 * its items answer a completed press. The pointer pair is a MouseEvent
		 * because jsdom ships no PointerEvent.
		 */
		act(() => {
			for (const type of ["pointerdown", "pointerup"]) {
				trigger.dispatchEvent(
					new api.window.MouseEvent(type, { bubbles: true, button: 0 }),
				);
			}
			trigger.click();
		});
		const menuItem = () =>
			[...api.document.querySelectorAll('[role="menuitem"]')].find(
				(item) => item.textContent?.trim() === "Preview",
			);
		await api.settle(() => menuItem() !== undefined);
		const item = menuItem();
		assert.ok(item, "the Preview item");
		act(() => {
			for (const type of ["pointerdown", "pointerup"]) {
				item.dispatchEvent(
					new api.window.MouseEvent(type, { bubbles: true, button: 0 }),
				);
			}
			item.click();
		});
		await api.settle(() => dialog(api.document) !== null);
		assert.ok(dialog(api.document), "the menu opened the preview");
		await api.pressEscape(() => dialog(api.document) === null);
		assert.equal(
			api.document.activeElement,
			tile,
			"the menu door still hands focus back to the file tile",
		);
	});
});

test("a failed read shows reader copy, never the path or the syscall", async () => {
	const update = fixture();
	const failed = {
		readFile: async () => ({
			success: false,
			error: new Error(
				"ENOENT: no such file or directory, open '/Users/dana/private/notes.md'",
			),
		}),
	};
	await mount(failed, async (api) => {
		await api.render(
			React.createElement(ProjectUpdateAssets, {
				attachments: update.attachments,
			}),
		);
		const tile = previewButton(api.document, `notes-${fixtureId}.md`);
		assert.ok(tile, "the markdown tile");
		await api.click(tile);
		await api.settle(() =>
			dialog(api.document)?.textContent?.includes("could not be opened"),
		);
		const text = dialog(api.document)?.textContent ?? "";
		assert.match(text, /This file could not be opened\./);
		assert.match(text, /stored copy may have moved or was deleted/);
		assert.doesNotMatch(text, /ENOENT/);
		assert.doesNotMatch(text, /\/Users\//);
	});
});

test("the gallery shares one read per path across tile, filmstrip and layer", async () => {
	fixture();
	const attachments = [
		attachment(`shot-a-${fixtureId}.png`, "image"),
		attachment(`shot-b-${fixtureId}.png`, "image"),
	];
	await mount(null, async (api) => {
		await api.render(React.createElement(ProjectUpdateAssets, { attachments }));
		await api.revealAll();
		assert.equal(
			api.readings.bytes.length,
			2,
			"one read per picture for the two tiles",
		);

		await api.click(
			api.document.querySelector(
				`button[aria-label="Open shot-a-${fixtureId}.png"]`,
			),
		);
		await api.settle(() => viewerImage(api.document) !== null);
		assert.equal(
			api.readings.bytes.length,
			2,
			"the lightbox reuses the tile's cached bytes",
		);

		await api.click(api.document.querySelector("[data-image-viewer-next]"));
		await api.settle(() => viewerImage(api.document) !== null);
		assert.equal(
			api.readings.bytes.length,
			2,
			"the second slide reuses the second tile's bytes",
		);

		const tiles = filmstripButtons(api.document);
		assert.ok(tiles.length >= 2, "the strip has both pictures");
		await api.click(tiles[0]);
		await api.settle();
		assert.equal(
			api.readings.bytes.length,
			2,
			"a filmstrip jump reuses the same cache entry",
		);
	});
});

test("a 40-update feed admits only the slots it has seen", async () => {
	fixture();
	const updates = Array.from({ length: 40 }, (_, index) => [
		attachment(`perf-shot-${fixtureId}-${index}.png`, "image"),
		attachment(`perf-sound-${fixtureId}-${index}.mp3`, "audio"),
		attachment(`perf-note-${fixtureId}-${index}.md`, "data"),
	]);
	await mount(null, async (api) => {
		await api.render(
			React.createElement(
				React.Fragment,
				null,
				updates.map((attachments, index) =>
					React.createElement(ProjectUpdateAssets, {
						key: index,
						attachments,
					}),
				),
			),
		);
		await api.settle();
		assert.equal(
			api.document.querySelectorAll('[data-project-asset-tile="image"]').length,
			40,
			"every slot is reserved up front",
		);
		assert.deepEqual(
			api.readings.bytes,
			[],
			"a 120-file feed opens without reading one",
		);
		const admitted = await api.revealSome(4);
		assert.equal(admitted, 4, "four observers were near the viewport");
		assert.equal(
			api.readings.bytes.length,
			4,
			"four admissions, not 120 reads",
		);
	});
});

test("lazy tiles reserve their slot and read nothing until seen", async () => {
	const update = fixture();
	await mount(null, async (api) => {
		await api.render(
			React.createElement(ProjectUpdateAssets, {
				attachments: update.attachments,
			}),
		);
		await api.settle();

		assert.ok(grid(api.document));
		assert.equal(
			tiles(api.document, "image").length,
			1,
			"the slot is reserved before its bytes",
		);
		assert.equal(
			api.document.querySelectorAll("[data-project-asset-grid] img").length,
			0,
			"no picture is painted before the tile is near",
		);
		assert.deepEqual(
			api.readings.bytes,
			[],
			"the feed opened without reading a single file",
		);

		await api.revealAll();
		assert.equal(
			api.readings.bytes.length,
			5,
			"one read each for the image, both clips and both sounds — files need none",
		);
	});
});
