/**
 * What a picture's action menu offers, per source kind — and where the menu
 * appears at all.
 *
 *     node --test scripts/image-actions.test.mjs
 *
 * WHY THIS FILE EXISTS. The operator's ask of 2026-10-11 was that hovering an
 * image offers its actions, and the honest hard half of that is not the menu's
 * markup: it is which actions each kind of picture may be offered. The menu that
 * shipped before this change was guarded by `isLocalFile`, so every picture the
 * canonical transcript draws — a durable `blob:` digest, a live `data:` URI —
 * had NO menu, while a path-backed one got file-shaped entries only. The kinds
 * and their action sets are declared once, as data, in
 * `src/renderer/src/features/chat/utils/image-actions.ts`; this file pins that
 * table, the two admission rules around it (a relative token is a path for an
 * attachment and NOT one for a markdown image), the byte-resolution the
 * `Copy image` entry performs, and — in jsdom, against the SHIPPED components —
 * that the menu appears where it was missing.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. Opening the Radix dropdown in jsdom costs
 * ~26s of layout churn and leaks work past the test (measured in
 * `chat-image-expand.test.mjs`), so the menu's ITEMS are not read back from an
 * opened portal here: the matrix is asserted against the data table the
 * component renders from, and the TRIGGER's presence and accessible name are
 * asserted against the mounted component. The real-browser half — a real hover
 * revealing the trigger and a real press opening the menu with these entries —
 * is the evidence set `docs/evidence/chat-image-actions/`'s business.
 *
 * ISOLATION. jsdom in this process, like `chat-image-expand.test.mjs`: no app,
 * no fork, no Electron, no window mode to name, synthetic ids only. The bridge
 * stubs are installed on a scratch `globalThis.window` and removed in `finally`.
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const ROOT = resolve(import.meta.dirname, "..");

/*
 * React DOM feature-detects input events at import time, so a document has to
 * exist before it is loaded — the bootstrap `chat-image-expand.test.mjs` uses,
 * and the same `Reflect.deleteProperty` cleanup, because `pnpm lint:scripts`
 * reads this file and its `noDelete` rule's suggested fix is not equivalent.
 */
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

/*
 * The SHIPPED modules, bundled for the same reason `chat-image-expand`'s file
 * bundles its components: they reach MUI and zustand through deep specifiers
 * node's ESM resolver will not take, and `react`/`react-dom` stay OUT of the
 * bundle so element symbols and `act` are per-instance.
 */
const EXTERNAL = /^(react|react-dom)(\/.*)?$/;
const BARE_SPECIFIER = /^[^./]/;
const CACHE = join(ROOT, "node_modules", ".cache", "image-actions");
const bundle = await build({
	stdin: {
		contents: `
			export {
				barePath,
				blobFromDataUrl,
				classifyAttachmentSource,
				classifyImageSource,
				hasImageActions,
				httpImageFetchable,
				imageActions,
				resolveCopyableImage,
			} from "./src/renderer/src/features/chat/utils/image-actions";
			export { ImageActionsMenu } from "./src/renderer/src/features/chat/components/image-actions-menu";
			export { MarkdownImage } from "./src/renderer/src/features/chat/components/markdown-image";
			export { CanonicalImage } from "./src/renderer/src/features/chat/canonical/canonical-image";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	/*
	 * `import.meta.env` is Vite's and stories/config modules read it at import
	 * time. The port is dead on purpose: nothing here should reach a service, and
	 * a refused connection is the isolation rather than a failure.
	 */
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
const bundlePath = join(CACHE, "image-actions.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const {
	barePath,
	blobFromDataUrl,
	classifyAttachmentSource,
	classifyImageSource,
	hasImageActions,
	httpImageFetchable,
	imageActions,
	resolveCopyableImage,
	ImageActionsMenu,
	MarkdownImage,
	CanonicalImage,
} = await import(pathToFileURL(bundlePath).href);

/* The assertion subjects the matcher lint wants hoisted (they are regexes
   ABOUT a claim, not per-run computation — the `UNTABBABLE_REVEAL` precedent). */
const MALFORMED_DATA_URL = /Malformed/;
const NO_FILE_AT_GONE = /No file at \/tmp\/gone\.png/;
const MARKDOWN_IMG_ENTRY = /\bimg: MarkdownImage,/;
const MARKDOWN_IMG_IMPORT =
	/import \{ MarkdownImage \} from "\.\/markdown-image";/;

/* --------------------------------------------------------------------- matrix */

test("a source is classified by what it IS, not where it came from", () => {
	assert.equal(classifyImageSource("data:image/png;base64,AAAA"), "data");
	assert.equal(classifyImageSource("blob:http://localhost/abc"), "blob");
	assert.equal(classifyImageSource("http://localhost:1111/x.png"), "http");
	assert.equal(classifyImageSource("https://example.com/a.png"), "http");
	assert.equal(classifyImageSource("file:///tmp/a.png"), "path");
	assert.equal(classifyImageSource("/tmp/a.png"), "path");
	assert.equal(classifyImageSource("~/workspace/a.png"), "path");
	/*
	 * The refused shape: a relative token names no file this app can address —
	 * it would resolve against the PAGE's origin — and both admissions below
	 * hinge on this answer.
	 */
	assert.equal(classifyImageSource("shot.png"), "other");
	assert.equal(classifyImageSource("./assets/shot.png"), "other");
	assert.equal(classifyImageSource(""), "other");
});

test("an attachment token that is not URL-shaped is a path; a markdown one is not", () => {
	/*
	 * The attachment rule is the guard this menu replaces, spelled as data: the
	 * file menu showed for every spelling that was not `data:`/`blob:`/`http`,
	 * and `openFile` has always resolved such a token against main's cwd.
	 */
	assert.equal(classifyAttachmentSource("shot.png"), "path");
	assert.equal(classifyAttachmentSource("~/shot.png"), "path");
	assert.equal(classifyAttachmentSource("file:///tmp/a.png"), "path");
	// URL-shaped spellings are unchanged between the two rules.
	assert.equal(classifyAttachmentSource("data:image/png;base64,AA"), "data");
	assert.equal(classifyAttachmentSource("blob:x"), "blob");
	assert.equal(classifyAttachmentSource("https://e.test/a.png"), "http");
	// A markdown image's relative src is `other` — that ruling is the classifier's.
	assert.equal(classifyImageSource("shot.png"), "other");
});

test("the per-kind action table IS the feature", () => {
	const ids = (kind, canShowInCanvas, source = "") =>
		imageActions(kind, { canShowInCanvas, source }).map((a) => a.id);

	const canvas = true;
	const noCanvas = false;

	// A path-backed picture: the four file-shaped actions this menu inherits,
	// in the file menu's own order, plus the new byte action.
	assert.deepEqual(ids("path", canvas), [
		"show-in-canvas",
		"open-file",
		"open-folder",
		"copy-file-path",
		"copy-image",
	]);
	assert.deepEqual(ids("path", noCanvas), [
		"open-file",
		"open-folder",
		"copy-file-path",
		"copy-image",
	]);

	// A live `data:` URI: the canvas branch works today and is kept; the bytes
	// are in the string.
	assert.deepEqual(ids("data", canvas), ["show-in-canvas", "copy-image"]);
	assert.deepEqual(ids("data", noCanvas), ["copy-image"]);

	/*
	 * A durable `blob:` handle: `Copy image` ONLY. The canvas entry is absent by
	 * decision (a session-only handle would paint a dead tab after a restart
	 * because canvas documents persist), and the path entries by fact.
	 */
	assert.deepEqual(ids("blob", canvas), ["copy-image"]);
	assert.deepEqual(ids("blob", noCanvas), ["copy-image"]);

	/*
	 * An `http(s)` picture: the two entries that are facts about the URL, and
	 * the bytes entry only where the page's own CSP lets the fetch land
	 * (loopback) — the split every remote-URL case is.
	 */
	assert.deepEqual(ids("http", noCanvas, "http://localhost:1111/a.png"), [
		"copy-image",
		"copy-image-url",
		"open-in-browser",
	]);
	assert.deepEqual(ids("http", noCanvas, "https://example.com/a.png"), [
		"copy-image-url",
		"open-in-browser",
	]);

	// A relative token gets no menu, and no trigger is rendered for it.
	assert.deepEqual(ids("other", canvas, "shot.png"), []);
	assert.equal(
		hasImageActions("other", { canShowInCanvas: canvas, source: "" }),
		false,
	);
	// ... while every other kind does.
	assert.equal(
		hasImageActions("blob", { canShowInCanvas: canvas, source: "blob:x" }),
		true,
	);
});

test("the fetchability predicate is the CSP's own list", () => {
	assert.equal(
		httpImageFetchable("http://localhost:1111/v1/static/images?path=/a.png"),
		true,
	);
	assert.equal(httpImageFetchable("http://127.0.0.1:8080/x.png"), true);
	assert.equal(httpImageFetchable("http://localhost:3000/x.png"), false);
	assert.equal(httpImageFetchable("https://example.com/a.png"), false);
	assert.equal(httpImageFetchable("not a url"), false);
});

/* -------------------------------------------------------------- byte routes */

test("barePath strips the file:// spelling and nothing else", () => {
	assert.equal(barePath("file:///tmp/a.png"), "/tmp/a.png");
	assert.equal(barePath("/tmp/a.png"), "/tmp/a.png");
	assert.equal(barePath("~/a.png"), "~/a.png");
});

test("a data: URI decodes in memory — base64 and percent-encoded alike", async () => {
	const decoded = blobFromDataUrl("data:image/png;base64,AQID");
	assert.equal(decoded.type, "image/png");
	assert.deepEqual([...new Uint8Array(await decoded.arrayBuffer())], [1, 2, 3]);

	const text = blobFromDataUrl("data:image/svg+xml,%3Csvg/%3E");
	assert.equal(text.type, "image/svg+xml");
	assert.equal(await text.text(), "<svg/>");

	assert.throws(
		() => blobFromDataUrl("data:image/png;base64"),
		MALFORMED_DATA_URL,
	);
});

test("Copy image reads a path through the bridge, typed by extension", async () => {
	const calls = [];
	globalThis.window = {
		api: {
			readFileBytes: async (path, cap) => {
				calls.push([path, cap]);
				return {
					success: true,
					data: Uint8Array.from([1, 2, 3]),
					sizeBytes: 3,
				};
			},
		},
	};
	try {
		const blob = await resolveCopyableImage("path", "file:///tmp/a.png");
		// The bridge speaks bare paths, and no ceiling is passed: main's own
		// default (64 MiB) is the bound.
		assert.deepEqual(calls, [["/tmp/a.png", undefined]]);
		assert.equal(blob.type, "image/png");
		assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]);
	} finally {
		Reflect.deleteProperty(globalThis, "window");
	}
});

test("a bridge refusal rejects with the bridge's own sentence", async () => {
	globalThis.window = {
		api: {
			readFileBytes: async () => ({
				success: false,
				code: "not-found",
				error: "No file at /tmp/gone.png",
			}),
		},
	};
	try {
		await assert.rejects(
			() => resolveCopyableImage("path", "/tmp/gone.png"),
			NO_FILE_AT_GONE,
		);
	} finally {
		Reflect.deleteProperty(globalThis, "window");
	}
});

test("a blob: source resolves through the URL the picture is painted from", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (url) => {
		assert.equal(url, "blob:http://localhost/deadbeef");
		return {
			ok: true,
			blob: async () =>
				new Blob([Uint8Array.from([9])], { type: "image/webp" }),
		};
	};
	try {
		const blob = await resolveCopyableImage(
			"blob",
			"blob:x",
			"blob:http://localhost/deadbeef",
		);
		assert.equal(blob.type, "image/webp");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

/* ------------------------------------------------------------- the surfaces */

async function mount(render) {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	const { window } = dom;
	const originals = new Map();
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
	const root = createRoot(window.document.getElementById("root"));
	const api = {
		window,
		document: window.document,
		render: async (element) => {
			act(() => {
				root.render(element);
			});
			await act(async () => {});
		},
	};
	try {
		await render(api);
	} finally {
		act(() => root.unmount());
		await act(async () => {});
		window.close();
		for (const [key, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	}
}

/** A real 1x1 PNG, so the data: route is the one under test. */
const PNG =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_BASE64 = PNG.split(",")[1];

const TRIGGER = 'button[aria-label^="Actions for"]';

test("a blob-backed canonical picture NOW carries the menu — the gap this change closes", async () => {
	const pngBytes = Uint8Array.from(atob(PNG.split(",")[1]), (character) =>
		character.charCodeAt(0),
	);
	/*
	 * The durable route's bytes come over the media relay (`desktopMedia`
	 * answers from `window.api.desktop.media` when the bridge exists — the same
	 * seam the stories stub), so the stub is installed BEFORE the render and the
	 * `blob:` URL the test asserts on is one `use-attachment-url.ts` really
	 * created. This is the SHIPPED chain the operator's screenshots take:
	 * digest -> relay -> blob -> `CanonicalImage` -> `ImageAttachment`, and the
	 * menu at the end of it is the half that did not exist before this change.
	 */
	await mount(async (api) => {
		api.window.api = {
			desktop: {
				media: async () => ({
					status: 200,
					kind: "bytes",
					mimeType: "image/png",
					data: pngBytes,
				}),
			},
		};
		await api.render(
			React.createElement(CanonicalImage, {
				image: {
					id: "image-actions:blob",
					data: null,
					attachment: "0123456789abcdef0123456789abcdef",
					mimeType: "image/png",
				},
				scope: { sessionId: "image-actions", childId: null },
				label: "Generated image",
			}),
		);
		// The resolver's chain is async (effect -> relay -> state); wait for the
		// trigger to appear rather than assuming a number of ticks.
		let trigger = null;
		for (let tick = 0; tick < 50 && !trigger; tick += 1) {
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			});
			trigger = api.document.querySelector(TRIGGER);
		}
		assert.ok(
			api.document.querySelector(".file-actions-menu"),
			"a durable screenshot could not be acted on at all before this change; it must now carry the actions wrapper",
		);
		assert.ok(trigger, "and a trigger a reader can reach");
		assert.equal(
			trigger.getAttribute("aria-label"),
			"Actions for Generated image",
			"the name says which picture, the supplement-row vocabulary",
		);
	});
});

test("a live (data:) canonical picture carries the menu too", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(CanonicalImage, {
				image: {
					id: "image-actions:live",
					data: PNG_BASE64,
					attachment: null,
					mimeType: "image/png",
				},
				scope: { sessionId: "image-actions", childId: null },
				label: "Attached image",
			}),
		);
		const trigger = api.document.querySelector(TRIGGER);
		assert.ok(
			trigger,
			"a freshly pasted picture is a picture: it must carry the menu the path-backed one has",
		);
		assert.equal(
			trigger.getAttribute("aria-label"),
			"Actions for Attached image",
		);
	});
});

test("markdown images are ADMITTED by kind: a path gets the menu, a relative src does not", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(MarkdownImage, { src: "/tmp/shot.png", alt: "shot" }),
		);
		const wrapper = api.document.querySelector("[data-markdown-image]");
		assert.ok(wrapper, "an absolute path is a file this app can act on");
		const trigger = api.document.querySelector(TRIGGER);
		assert.equal(
			trigger?.getAttribute("aria-label"),
			"Actions for shot",
			"the alt names the picture in the trigger",
		);
		// The reveal contract, same tokens as the attachment wrapper's measured
		// set (the named-group spelling, because markdown renders inside rows
		// that may carry an anonymous `group` of their own).
		for (const token of [
			"pointer-events-none",
			"opacity-0",
			"group-hover/mdimg:pointer-events-auto",
			"group-hover/mdimg:opacity-100",
			"group-focus-within/mdimg:pointer-events-auto",
			"group-focus-within/mdimg:opacity-100",
			"has-[[aria-expanded=true]]:pointer-events-auto",
			"has-[[aria-expanded=true]]:opacity-100",
		]) {
			assert.ok(
				wrapper.className.includes(token),
				`the markdown reveal must carry \`${token}\` (got: ${wrapper.className})`,
			);
		}

		await api.render(
			React.createElement(MarkdownImage, { src: "shot.png", alt: "shot" }),
		);
		assert.equal(
			api.document.querySelector("[data-markdown-image]"),
			null,
			"a relative src names no file this app can address — it renders as the bare <img> it always was",
		);
	});
});

test("the shipped markdown renderer wires the image component in", async () => {
	/*
	 * A SOURCE pin rather than a mount, and the reason is cost: importing
	 * `markdown-renderer.tsx` pulls mermaid, katex and the full remark/rehype
	 * stack into this test's bundle — the weight `chat-link-affordances.test.mjs`
	 * already pays in the suite — for a claim that is one map entry. What the
	 * pin reads is the entry and its import, which is exactly what a dropped
	 * `img:` line would remove; the RENDERED half (a markdown image's menu on a
	 * real page) is the evidence set's `markdown` state, whose capture refuses
	 * a frame without it.
	 */
	const source = readFileSync(
		join(
			ROOT,
			"src/renderer/src/features/chat/components/markdown-renderer.tsx",
		),
		"utf8",
	);
	assert.match(
		source,
		MARKDOWN_IMG_ENTRY,
		"MARKDOWN_COMPONENTS must map `img` to the shipped MarkdownImage",
	);
	assert.match(
		source,
		MARKDOWN_IMG_IMPORT,
		"and the map's entry must be imported",
	);
});

test("the menu itself refuses to render without actions", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(ImageActionsMenu, {
				file: "shot.png",
			}),
		);
		assert.equal(
			api.document.querySelector("button"),
			null,
			"a relative-only source gets no trigger at all",
		);
		await api.render(React.createElement(ImageActionsMenu, { file: "blob:x" }));
		assert.ok(
			api.document.querySelector(TRIGGER),
			"a blob picture gets its trigger",
		);
	});
});
