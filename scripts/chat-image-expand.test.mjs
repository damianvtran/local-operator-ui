/**
 * A picture in a conversation opens expanded, and every way out of it works.
 *
 *     node --test scripts/chat-image-expand.test.mjs
 *
 * WHY THIS FILE EXISTS. The operator's report was that a `read` row's screenshot
 * could not be read in the transcript and that clicking it did nothing — and the
 * second half is a fact no frame can carry on its own: a still of the closed
 * state and a still of the open one look identical whether the click was wired or
 * not, and a story that hand-mounted the overlay would prove the overlay draws,
 * not that anything reaches it. So this drives the SHIPPED components — the
 * production `ImageAttachment`, `FileAttachment` and `CanonicalImage`, the real
 * `ImageLightbox` they render — and asserts what the DOM says after a real press.
 *
 * WHAT IT PINS, in the order the wiring can break:
 *
 *   1. `ImageAttachment` is a BUTTON with a title that says what the press does,
 *      and pressing it renders the overlay with the same picture in it;
 *   2. the same for a CANONICAL image, which is the surface the operator
 *      photographed: before this change that row rendered a plain `<div>` with no
 *      handler at all, so there was no button to press and nothing happened;
 *   3. the same for the pasted-image branch of `FileAttachment` — a pasted image
 *      is a picture in the conversation too;
 *   4. Escape closes it, a press on the scrim closes it, the close button closes
 *      it — the three exits, each against the element a user actually hits;
 *   5. focus returns to the picture on the way out, which Radix does NOT do here:
 *      its modal path moves focus to a `DialogTrigger` this composition has none
 *      of, so the caller hands the button over and the overlay focuses it;
 *   6. the overlay has an accessible NAME. Radix sets `aria-labelledby` only when
 *      a `DialogTitle` is present, so a dialog without one is announced as an
 *      unnamed dialog — and this Radix (1.1.23, the version `radix-ui` 1.6.7
 *      resolves) no longer logs the old missing-Title warning, which is why the
 *      assertion is on the name rather than on the absence of a warning;
 *   7. the picture's own accessible name states the ACTION, not only the thing
 *      (round 1, UX U1-1) — `aria-label`, because the action used to reach a
 *      reader only as the description off `title`;
 *   8. the file-actions menu beside a conversation picture stays reachable without
 *      a pointer (round 1, review R1-1). Its wrapper used to be `invisible`, i.e.
 *      `visibility: hidden`, which takes the trigger out of the tab order — and the
 *      four actions in it are the ones the picture's own click used to perform
 *      before that click became the expansion;
 *   9. a canonical picture with no bytes is a failure row and NOT a button, which
 *      is the precondition the overlay's own failure state rests on.
 *
 * HOW IT STANDS IN FOR A BROWSER. jsdom, with React's own scheduler, the rig
 * `run-panel-navigation.test.mjs` uses. The assertions are structural — which
 * element exists, what it is, what it is called, where focus is — and NOT
 * geometric: jsdom has no layout engine, so the 5% viewport margin, the
 * `object-contain` fit and the small-picture rule are the STORYBOOK frames'
 * business (`docs/evidence/chat-image-expand/`), not this file's. A green test
 * here is not visual evidence and does not claim to be.
 *
 * The same limit reaches the two places where a find needs the engine to do
 * something it cannot, and neither is covered by a weaker substitute here — both
 * were measured before being written off:
 *
 *   1. **Radix's dropdown cannot be opened.** With `console.time` around the call,
 *      twice, on this tree, opening it costs ~26s of layout churn (the popper's
 *      positioning loop and React's `act` flush against each other) and leaves
 *      work running past the test that opened it. That is a 26s tax and a flake
 *      in `test:desktop` for a claim a real browser makes better:
 *      `chat-image-expand--legacy-tabbed` holds focus on the trigger through the
 *      rig's own Tab presses, and `chat-image-expand--legacy-tabbed-open` then
 *      presses Enter through the input pipeline and requires the menu's items to
 *      appear. (`Enter` is the keyboard path a real browser has; this file's own
 *      assertion below drives a `pointerdown`, because jsdom has no `PointerEvent`
 *      and a synthetic `keydown` Enter does not open the menu here.)
 *   2. **An `<img>` cannot be made to report `error`.** jsdom implements no image
 *      decoder, so the event has to be handed to the element — and doing that
 *      leaves jsdom's own image work pending, which fails after the window closes
 *      with `TypeError: Failed to execute 'dispatchEvent' on EventTarget:
 *      parameter 1 is not of type 'Event'` and marks the file failed. Measured
 *      five ways, all leaky: a synthetic `error` on the overlay's `<img>`; the
 *      same with a bubbling event; the same plus `settle`; the same plus a 300ms
 *      macrotask drain; and the same after clearing the `src` first. A plain
 *      `<img>` mounted and then removed does NOT leak, and neither does an
 *      undecodable `src` nobody dispatches on — so the leak is the dispatched
 *      error itself, not this component removing the picture. The overlay's own
 *      failure state is proven where it is real: the story's capture latch waits
 *      for the fallback's copy to appear, so `chat-image-expand--expanded-failed`
 *      FAILS to capture rather than photographing the wrong state.
 *
 * ISOLATION. Nothing here boots the app, a fork or Electron: it is jsdom in this
 * process, so there is no window mode to name and no session of the operator's to
 * touch. The components are mounted with synthetic ids (`image-expand`), and the
 * picture is a `data:` URI, so nothing reaches a backend, a port or a store on
 * disk.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act, useState } from "react";

const ROOT = resolve(import.meta.dirname, "..");

/*
 * React DOM feature-detects input events at import time, so a document has to
 * exist before it is loaded — the bootstrap `run-panel-navigation.test.mjs` uses,
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
 * React stays out of the bundle so the mounted tree shares THIS process's copy
 * (element symbols and `act` are per-instance); everything else is bundled,
 * because the components reach MUI and zustand through deep specifiers node's
 * ESM resolver will not take. The bundle is written to a real file because bare
 * specifiers have to resolve at run time.
 */
const EXTERNAL = /^(react|react-dom)(\/.*)?$/;
const BARE_SPECIFIER = /^[^./]/;
const CACHE = join(ROOT, "node_modules", ".cache", "chat-image-expand");
const bundle = await build({
	stdin: {
		contents: `
			export { ImageAttachment } from "./src/renderer/src/features/chat/components/message-item/image-attachment";
			export { FileAttachment } from "./src/renderer/src/features/chat/components/message-item/file-attachment";
			export { CanonicalImage } from "./src/renderer/src/features/chat/canonical/canonical-image";
			export { FoldMedia } from "./src/renderer/src/features/chat/canonical/fold-media";
			export { TraceFold } from "./src/renderer/src/features/chat/components/trace/trace-fold";
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
const bundlePath = join(CACHE, "image-expand.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const {
	ImageAttachment,
	FileAttachment,
	CanonicalImage,
	FoldMedia,
	TraceFold,
} = await import(pathToFileURL(bundlePath).href);

/* ------------------------------------------------------------------ fixtures */

/**
 * A 1x1 PNG, small enough to inline and real enough that the browser path is the
 * one under test. The overlays' own pixels are the frames' business.
 */
const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const PNG = `data:image/png;base64,${PNG_BASE64}`;
/**
 * A 2x6 PORTRAIT, for the strip's uniform-slot claim: a tile that sized itself by
 * its picture drew a phone-shaped capture 36px wide beside 96px landscapes, so the
 * claim has to be made against two different aspects rather than one fixture twice.
 */
const PORTRAIT_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAIAAAAGCAIAAABmRdhlAAAAEElEQVR42mMIqDgBRAyEKQCEWRLBtZF+SAAAAABJRU5ErkJggg==";
/**
 * The legacy shape, which is a PATH on disk and a URL to paint from two different
 * strings: `file` is what the picture is called and what its file-actions menu
 * acts on, `src` is what the browser loads. The two must differ here — the
 * filename of a `data:` URI is the base64 tail, and a picture with no path has no
 * file-actions menu, so a URI for both would test neither.
 */
const FILE_PATH = "/tmp/image-expand/invoices-march.png";

/**
 * The row's image as the canonical reducer hands it over: an INLINE payload, so
 * `useAttachmentUrl` returns a `data:` URI on the first render and no relay
 * request is made. A digest-only image would put `desktopMedia` in the path,
 * which is a different question from the one this file asks.
 */
const transcriptImage = {
	id: "image-expand:0",
	data: PNG_BASE64,
	attachment: null,
	mimeType: "image/png",
};
const transcriptScope = { sessionId: "image-expand", childId: null };

/* ----------------------------------------------------------------- selectors */

/**
 * The picture as it is rendered in a conversation, and the control around it.
 *
 * `PICTURE_IMAGE` is shape rather than vocabulary on purpose: the pre-change
 * legacy picture was ALSO a `<button>`, so pressing through "the button with the
 * new title" would have made this file red on the old tree for a reason that is
 * not the behaviour under test — the pasted-image case would have failed to find
 * its control instead of failing to expand. Pressing the picture by its own
 * `<img>` asks the question that matters and lets each case fail on its own
 * answer.
 */
const PICTURE_IMAGE = "button img";
/**
 * The picture's control, named by the `title` this change introduces.
 *
 * Shipped markup a reader can check rather than a test-only hook — the rule the
 * pane's test applies to its `data-` attributes.
 */
const PICTURE = 'button[title^="Click to expand"]';
/** Radix's layer, i.e. everything the picture is not. */
const DIALOG = '[role="dialog"]';
/** The picture INSIDE the overlay, which is what "expanded" means here. */
const EXPANDED_PICTURE = '[role="dialog"] img';
/**
 * The scrim. Named by the role class the shared `DialogOverlay` gives it — the
 * element a press outside the picture lands on in a browser, and the one Radix
 * reads as "outside the layer".
 */
const SCRIM = '[class*="bg-scrim"]';
/** The overlay's own close control, which is not the panel's corner button. */
const CLOSE = 'button[aria-label="Close image"]';
/** What the closed state looks like: no layer, nothing to escape from. */
const isOpen = (document) => document.querySelector(DIALOG) !== null;

/**
 * The button the picture is wrapped in, or `null` where there is none.
 *
 * `null` is a real answer: on the pre-change tree a canonical row rendered a plain
 * `<div>` with no handler, which IS the operator's report — clicking it did
 * nothing because there was nothing to click.
 */
const pictureButton = (document) =>
	document.querySelector(PICTURE_IMAGE)?.closest("button") ?? null;

/**
 * The file-actions trigger beside a conversation picture, and the wrapper that
 * reveals it. Named by shipped attributes rather than a test hook, as above.
 */
const FILE_ACTIONS = 'button[aria-label="File actions"]';
const FILE_ACTIONS_WRAPPER = ".file-actions-menu";
/**
 * The two class TOKENS that made the reveal untabbable, hoisted here because
 * biome's `useTopLevelRegex` is right about them: they are the assertion's
 * subject, not a per-run computation.
 */
const UNTABBABLE_REVEAL = /\binvisible\b|group-hover:visible/;
/** The store's own failure sentence, which the digest-backed row must say. */
const STORE_COPY_RE =
	/Image could not be displayed\. Its stored copy is not available to this reader\./;

/* ------------------------------------------------------------------ harness */

/**
 * A plain DOM for one case, with the shims the shipped components reach for and
 * jsdom does not implement.
 *
 * Only the ones they actually touch, so a component that starts needing another
 * fails loudly here rather than silently no-oping — the rule (and the reason for
 * it, which was a `ReferenceError` swallowed inside a rAF callback) is
 * `run-panel-navigation.test.mjs`'s.
 */
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
		/*
		 * Radix's focus scope watches the layer's DOM for added and removed nodes to
		 * keep Tab inside it, and reads computed style to tell a hidden node from a
		 * visible one — both reached for as BARE globals, like the two above.
		 * RemoveScroll, which the overlay is wrapped in, sizes itself with a
		 * `ResizeObserver`.
		 */
		MutationObserver: window.MutationObserver,
		// The focus trap walks the layer with a TreeWalker, built with the BARE
		// `NodeFilter`, which jsdom only hangs off its window.
		NodeFilter: window.NodeFilter,
		// `getTabbableCandidates` scopes the walk with a bare `instanceof` per
		// control type.
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
		// MUI's `useMediaQuery` refuses without one, and `AttachmentFrame` is MUI
		// during the migration.
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
			/*
			 * The synchronous act runs the mount and the effects it starts; the empty
			 * async one is React's "flush what the mount scheduled" pass. Neither is a
			 * sleep: an awaited act keeps flushing until React's queue is quiet, which
			 * on an unmount of an MUI-backed tree is measured in minutes on a loaded
			 * host (see `run-panel-navigation.test.mjs`).
			 */
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
			await act(async () => {});
		},
		/**
		 * A press on the scrim, as a browser delivers it: `pointerdown` then `click`.
		 *
		 * Both halves are needed. Radix defers the outside dismissal to the following
		 * `click` when the pointerdown carries button 0 — which is every real press —
		 * and dispatching only the second one would test the deferral's shortcut
		 * rather than the path a user takes. `MouseEvent` is the constructor because
		 * jsdom ships no `PointerEvent`; the listener reads `button` and `target` off
		 * it, which is all a `pointerdown` is to this code.
		 */
		pressScrim: async (landed) => {
			const scrim = window.document.querySelector(SCRIM);
			assert.ok(scrim, `no scrim matched ${SCRIM}`);
			act(() => {
				scrim.dispatchEvent(
					new window.MouseEvent("pointerdown", {
						bubbles: true,
						cancelable: true,
						button: 0,
					}),
				);
				scrim.dispatchEvent(
					new window.MouseEvent("click", { bubbles: true, cancelable: true }),
				);
			});
			await api.settle(landed);
		},
		/**
		 * Escape, on the document, which is where Radix's own listener is.
		 *
		 * `keydown` rather than `keyup`: Radix's `useEscapeKeydown` answers the down
		 * edge, and a test that sent the up edge would pass while the product ignored
		 * the key.
		 */
		pressEscape: async (landed) => {
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
		/**
		 * Let a close finish, sampled against the state it is supposed to reach.
		 *
		 * A frame budget rather than a clock, and deliberately NOT
		 * `window.setTimeout`: Radix restores focus from a bare `setTimeout(..., 0)`
		 * on unmount, and inside this bundle "bare" is Node's timer while the tree the
		 * wait is about lives in jsdom — two queues with no ordering between them, so
		 * no fixed number of ticks is "long enough" by construction. Measured: a
		 * single `window.setTimeout(0)` in an earlier cut of this helper passed for
		 * Escape and the scrim and read `body` for the close button, because the
		 * landing was parked on the other queue. Sampling therefore waits for the
		 * condition (bare `setTimeout`, so it shares Radix's queue) and gives up after
		 * `budget` ticks — a landing that never happens is what the assertion after it
		 * reports, which is the honest reading rather than a green one.
		 */
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
		/** What an assertion can name without diffing two DOM trees. */
		focused: () => {
			const element = window.document.activeElement;
			if (!element || element === window.document.body) return "body";
			if (element === pictureButton(window.document)) return "picture";
			return `${element.tagName.toLowerCase()}[aria-label="${
				element.getAttribute("aria-label") ?? ""
			}"]`;
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

/* --------------------------------------------------------------------- cases */

test("a conversation picture is a button that expands it", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(ImageAttachment, {
				file: FILE_PATH,
				src: PNG,
				conversationId: "image-expand",
			}),
		);
		const picture = pictureButton(api.document);
		assert.ok(
			picture,
			"the picture must be a button a reader can reach from the keyboard",
		);
		assert.equal(
			api.document.querySelector(PICTURE),
			picture,
			"and it is the control whose title says what the press does",
		);
		assert.equal(
			picture.getAttribute("title"),
			"Click to expand invoices-march.png",
			'the title is what the press does, not what it used to do (this used to read "Click to open", which opened the file in another application)',
		);
		assert.equal(isOpen(api.document), false, "nothing is expanded yet");

		await api.click(picture);

		assert.ok(isOpen(api.document), "the press expands the picture");
		const expanded = api.document.querySelector(EXPANDED_PICTURE);
		assert.equal(
			expanded.getAttribute("src"),
			PNG,
			"the overlay shows the same picture, not a copy of it",
		);
		/*
		 * The accessible name, read the way a screen reader reads it: Radix sets
		 * `aria-labelledby` only when a `DialogTitle` is present, so this is the
		 * assertion that a dialog with no visible header is still named.
		 */
		const dialog = api.document.querySelector(DIALOG);
		const labelId = dialog.getAttribute("aria-labelledby");
		assert.ok(labelId, "the overlay must carry an accessible name");
		assert.equal(
			api.document.getElementById(labelId).textContent,
			"invoices-march.png",
			"and the name is the picture's own label",
		);
	});
});

test("a canonical image — the row that had no click at all — expands too", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(CanonicalImage, {
				image: transcriptImage,
				scope: transcriptScope,
				label: "Image",
			}),
		);
		const picture = pictureButton(api.document);
		assert.ok(
			picture,
			"a canonical tool row's screenshot is expandable; before this change it rendered a div with no handler",
		);
		await api.click(picture);
		assert.ok(isOpen(api.document), "the overlay is on screen");
		const dialog = api.document.querySelector(DIALOG);
		assert.equal(
			api.document.getElementById(dialog.getAttribute("aria-labelledby"))
				.textContent,
			"Image",
			"the row's own label names the overlay, not the blob's UUID",
		);
	});
});

test("a pasted image expands as well", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(FileAttachment, {
				file: PNG,
				onClick: () => {},
				conversationId: "image-expand",
			}),
		);
		const picture = pictureButton(api.document);
		assert.ok(picture, "a pasted image is a picture in the conversation too");
		await api.click(picture);
		assert.ok(isOpen(api.document), "the overlay is on screen");
	});
});

test("Escape closes the expanded picture and focus returns to it", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(ImageAttachment, {
				file: FILE_PATH,
				src: PNG,
				conversationId: "image-expand",
			}),
		);
		const picture = pictureButton(api.document);
		await api.click(picture);
		assert.ok(isOpen(api.document), "the overlay is open to be escaped from");
		picture.focus();

		await api.pressEscape(() => api.focused() === "picture");

		assert.equal(isOpen(api.document), false, "Escape closes the overlay");
		assert.equal(
			api.focused(),
			"picture",
			"focus is back on the picture, not on <body> — Radix's modal path aims at a DialogTrigger this composition does not have",
		);
	});
});

test("a press on the scrim outside the picture closes it", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(ImageAttachment, {
				file: FILE_PATH,
				src: PNG,
				conversationId: "image-expand",
			}),
		);
		const picture = pictureButton(api.document);
		await api.click(picture);
		/*
		 * The geometry that makes this a genuine outside press: the layer's box is
		 * the PICTURE's, so the scrim around it is a different element. A full-
		 * viewport content box would swallow this press and the dismissal would
		 * silently stop working.
		 */
		assert.ok(
			api.document.querySelector(SCRIM),
			"the scrim is a separate element from the picture's layer",
		);

		await api.pressScrim(() => api.focused() === "picture");

		assert.equal(
			isOpen(api.document),
			false,
			"a press on the scrim closes the overlay",
		);
		assert.equal(api.focused(), "picture", "and focus returns to the picture");
	});
});

test("the close button closes it and focus returns to the picture", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(ImageAttachment, {
				file: FILE_PATH,
				src: PNG,
				conversationId: "image-expand",
			}),
		);
		const picture = pictureButton(api.document);
		await api.click(picture);
		const close = api.document.querySelector(CLOSE);
		assert.ok(close, `the overlay carries its own close control (${CLOSE})`);

		await api.click(close);
		await api.settle(() => api.focused() === "picture");

		assert.equal(isOpen(api.document), false, "the close button closes it");
		assert.equal(api.focused(), "picture", "and focus returns to the picture");
	});
});

test("the picture's accessible name states the action, not only the thing", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(ImageAttachment, {
				file: FILE_PATH,
				src: PNG,
				conversationId: "image-expand",
			}),
		);
		const picture = pictureButton(api.document);
		/*
		 * The action was reachable only as the accessible DESCRIPTION before this
		 * (off `title`, which some readers skip), so the name a reader heard was
		 * the picture's own label and nothing more — UX round 1, U1-1.
		 */
		assert.equal(
			picture.getAttribute("aria-label"),
			"Expand invoices-march.png",
			"a reader must hear what pressing the picture does, not just what the picture is",
		);
		/*
		 * And the thing is still named where the name stands alone: the `alt` is
		 * what labels the picture itself in any context without the button around
		 * it (an exported transcript, a bare `<img>` in a future caller).
		 */
		assert.equal(
			picture.querySelector("img").getAttribute("alt"),
			"invoices-march.png",
			"the picture keeps its own alt text",
		);
	});
});

test("the file-actions menu stays reachable without a pointer", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(ImageAttachment, {
				file: FILE_PATH,
				src: PNG,
				conversationId: "image-expand",
			}),
		);
		const wrapper = api.document.querySelector(FILE_ACTIONS_WRAPPER);
		assert.ok(
			wrapper,
			`a picture on disk carries its file actions (${FILE_ACTIONS_WRAPPER})`,
		);
		/*
		 * The contract, because this bundle loads no stylesheet and jsdom has no
		 * layout: `visibility: hidden` is what removed the trigger from the tab
		 * order, and the reveal that replaces it hides the control from the POINTER
		 * and the PAINTER (`pointer-events-none`, `opacity-0`) while leaving it in
		 * the DOM's focus order — and `group-focus-within` is the half that brings
		 * it back when focus is anywhere in the group. The real-browser half is in
		 * the header: `chat-image-expand--legacy-tabbed` fails to capture if Tab
		 * never reaches the trigger, and `--legacy-tabbed-open` requires the menu's
		 * items to appear when Enter is pressed on it.
		 */
		assert.ok(
			!UNTABBABLE_REVEAL.test(wrapper.className),
			`the reveal must not use a visibility toggle, which is untabbable (got: ${wrapper.className})`,
		);
		for (const token of [
			"pointer-events-none",
			"opacity-0",
			"group-hover:pointer-events-auto",
			"group-hover:opacity-100",
			"group-focus-within:pointer-events-auto",
			"group-focus-within:opacity-100",
			/*
			 * And the OPEN state, which is a different route to the same loss:
			 * opening this menu by keyboard moves focus into the Radix portal, so
			 * `group-focus-within` stops matching while the menu is on screen and the
			 * trigger vanishes from under it (U2-1).
			 *
			 * WHICH ATTRIBUTE these two tokens key on is the whole finding of round 3
			 * (U3-1, Q3-1), and this list is deliberately written so a wrong hook CANNOT
			 * pass it: the round-2 tokens keyed on `data-state=open`, and on this
			 * subtree that attribute belongs to the Tooltip —
			 * `file-actions-menu.tsx` nests `<Tooltip><DropdownMenuTrigger asChild>`
			 * and `ui/tooltip.tsx`'s `TooltipTrigger asChild` owns it — so it reads
			 * "closed" while the menu is genuinely open and the rule could never fire.
			 * The assertions below pin the attribute the dropdown DOES own, and the two
			 * DOM facts that make the difference measurable in an engine with no
			 * stylesheet: `aria-expanded` is on the trigger (false at rest), and the
			 * Tooltip's own `data-state` is on the same node, which is why keying on it
			 * was inert. The engine proof is the `legacy-tabbed-open` frame and its
			 * measurement, recorded in `docs/evidence/chat-image-expand/README.md`.
			 */
			"has-[[aria-expanded=true]]:pointer-events-auto",
			"has-[[aria-expanded=true]]:opacity-100",
		]) {
			assert.ok(
				wrapper.className.includes(token),
				`the reveal must keep \`${token}\` — the four actions in it became pointer-only when the picture's click stopped opening the file (review round 1, R1-1)`,
			);
		}
		assert.ok(
			!wrapper.className.includes("data-state"),
			`the open-state reveal must not key on \`data-state\`: on this subtree that attribute is the Tooltip's and reads "closed" while the menu is open, which is why the round-2 pair was inert (UX round 3 U3-1, QA round 3 Q3-1)`,
		);
		/*
		 * And the control itself is real: enabled, focusable, and not hidden from a
		 * reader while it is hidden from the pointer.
		 */
		const trigger = api.document.querySelector(FILE_ACTIONS);
		assert.ok(trigger, `the actions have a trigger (${FILE_ACTIONS})`);
		/*
		 * The two attributes that made the round-2 pair inert, asserted rather than
		 * described: the dropdown's own signal is present and false at rest (so a
		 * reveal keyed on it is a real hook), while the Tooltip's `data-state` is on
		 * the same node — the value it takes while the menu is open ("closed") is the
		 * reason the earlier tokens could not match.
		 */
		assert.equal(
			trigger.getAttribute("aria-expanded"),
			"false",
			"the reveal keys on the dropdown's own `aria-expanded`, which is present and false at rest",
		);
		assert.equal(
			trigger.getAttribute("data-state"),
			"closed",
			"and the Tooltip's `data-state` sits on that same node — which is why a reveal keyed on it was inert (U3-1)",
		);
		/*
		 * And the half the selector actually matches, which until round 4 was
		 * certified only by the frame: press the trigger — a `pointerdown`, the input
		 * this harness can drive — and the pair flips.
		 * `aria-expanded` goes TRUE — the value `has-[[aria-expanded=true]]` needs —
		 * while `data-state` STAYS "closed", because that attribute is the Tooltip's
		 * and the tooltip is not the thing that opened. That collision is the whole
		 * reason the reveal keys on one and not the other, so it is asserted here
		 * rather than left to the frame (review round 4, R4-4).
		 */
		trigger.focus();
		/*
		 * `MouseEvent` typed as `pointerdown`, not `PointerEvent`: jsdom ships no
		 * `PointerEvent`, and Radix's menu trigger reads `button` and `target` off the
		 * event, which is all a `pointerdown` is to this code. This is the same
		 * substitution the scrim press above already documents rather than a second
		 * convention for the same problem. A `keydown` Enter on the trigger was tried
		 * first and does NOT open the menu here — measured: `aria-expanded` stays
		 * "false" — so a future reader does not spend the same run rediscovering it.
		 */
		act(() => {
			trigger.dispatchEvent(
				new window.MouseEvent("pointerdown", {
					bubbles: true,
					cancelable: true,
					button: 0,
				}),
			);
		});
		await act(async () => {});
		assert.equal(
			trigger.getAttribute("aria-expanded"),
			"true",
			"pressing the trigger opens the menu, and the dropdown's own attribute flips to true — the value the reveal's selector matches",
		);
		assert.equal(
			trigger.getAttribute("data-state"),
			"closed",
			'while the menu is open the Tooltip\'s `data-state` is still "closed" on that same node, which is why keying the reveal on it could never fire (U3-1, Q3-1)',
		);
		// and the menu it claims to have opened is really on the page, not just an
		// attribute flip: four entries, in the portal, where Radix puts them.
		const menu = api.document.querySelector('div[role="menu"]');
		assert.ok(menu, "the open menu is in the document (role=menu)");
		assert.equal(
			menu.querySelectorAll('[role="menuitem"]').length,
			4,
			"and it carries the four actions this menu offers",
		);
		assert.equal(
			trigger.disabled,
			false,
			"it is an enabled control, not a disabled one faking a reveal",
		);
		assert.notEqual(
			trigger.getAttribute("tabindex"),
			"-1",
			"nothing takes it out of the tab order",
		);
		assert.equal(
			trigger.getAttribute("aria-hidden"),
			null,
			"it is not hidden from a reader while it is hidden from the pointer",
		);
		assert.equal(
			trigger.hasAttribute("inert"),
			false,
			"and it is not inert, which would take it out of the tab order across browsers",
		);
	});
});

test("a canonical picture with no bytes is a failure row, not an untappable picture", async () => {
	await mount(async (api) => {
		/*
		 * A digest whose bytes the store does not hold. `useAttachmentUrl` answers
		 * `null` for it (the relay's `{kind:"error"}` half is
		 * `attachment-url.test.mjs`'s), and this is what the view does with that
		 * answer — the precondition the overlay's own failure state rests on: with
		 * no bytes there is no button, so there is nothing to expand.
		 */
		await api.render(
			React.createElement(CanonicalImage, {
				image: {
					id: "image-expand:1",
					data: null,
					attachment: "0".repeat(32),
					mimeType: "image/png",
				},
				scope: transcriptScope,
				label: "Image",
			}),
		);
		await api.settle(
			() => api.document.body.textContent.includes("could not be displayed"),
			10,
		);
		assert.match(
			api.document.body.textContent,
			STORE_COPY_RE,
			"an unresolvable digest says so, in the store's own words rather than the on-disk ones",
		);
		assert.equal(
			pictureButton(api.document),
			null,
			"and it is not a button at all",
		);
	});
});

/**
 * The condensed action group, which is the surface an image-bearing run is most
 * often read on.
 *
 * A collapsed group UNMOUNTS its rows, so a screenshot a call produced used to
 * be reachable only by expanding the group — the operator's report. The strip
 * that answers it is mounted here as the REAL component, because the claims
 * about it are the same class as every other claim in this file: each picture
 * is a real button (in the tab order, expanded by Enter or Space like any
 * other), each is NAMED, each carries the thumbnail ceiling rather than the
 * row's full 240px one, and a press on one still reaches the overlay.
 *
 * The strip's own budget is in its geometry, and the geometry is in three class
 * contracts rather than one ceiling: `h-[76px] w-[115px]` is the FIXED 115x76 slot every
 * tile shares (a picture that sized its own tile made the row a ragged grid — a
 * 200x360 portrait drew 36px wide beside 115px landscapes), `object-contain` is
 * what lets a picture of any aspect live in that slot without distortion, and the
 * row's full ceiling must be absent. The measured boxes are the frames'
 * (`docs/evidence/chat-trace-fold/*`, `scripts/condensed-group-media-geometry.mjs`);
 * jsdom has no layout, so what is asserted here is the contract those frames
 * measure.
 */
const SLOT_CLASSES = ["h-[76px]", "w-[115px]", "object-contain"];
/**
 * The slot's own GEOMETRY, for the boxes that are not pictures: the picture's
 * classes (`h-[76px] w-[115px] object-contain`) belong to an `<img>`, while the frame that
 * reserves its place and the receipt that stands in for it are the tile's measured
 * box (117x78) so that all three states occupy one slot.
 */
const SLOT_BOX = ["h-[78px]", "w-[117px]"];
const FULL_CEILING = /max-h-\[240px\]/;
/**
 * The three classes the ledger rule is made of, asserted on the element rather
 * than on a re-taken frame: this surface's frames are not byte-stable across two
 * captures at one head (measured), so the class list is the instrument (P1).
 */
const FULL_CEILING_CLASSES = ["max-h-[240px]", "max-w-full", "object-contain"];

test("a condensed group's pictures are named, expandable thumbnails", async () => {
	await mount(async (api) => {
		const second = {
			id: "image-expand:group:1",
			data: PORTRAIT_BASE64,
			attachment: null,
			mimeType: "image/png",
		};
		await api.render(
			React.createElement(FoldMedia, {
				images: [transcriptImage, second],
				scope: transcriptScope,
				onRevealMore: () => {},
			}),
		);

		const strip = api.document.querySelector("[data-fold-media]");
		assert.ok(strip, "the strip is on screen");
		assert.equal(strip.tagName, "UL", "a run's pictures are a list of them");
		assert.equal(
			api.document.querySelectorAll("[data-fold-media] li").length,
			2,
			"every picture the run produced is shown, not one and a count",
		);
		assert.equal(
			strip.getAttribute("aria-label"),
			"2 images from this run",
			"and the set itself is named, in the header's own noun, so a reader knows how many it is walking into",
		);

		const controls = [
			...api.document.querySelectorAll("[data-fold-media] button"),
		];
		assert.deepEqual(
			controls.map((control) => control.getAttribute("aria-label")),
			["Expand Image 1", "Expand Image 2"],
			"each picture's name says WHICH one it is, in the same noun as the clause",
		);
		const pictures = [
			...api.document.querySelectorAll("[data-fold-media] img"),
		];
		for (const picture of pictures) {
			for (const slotClass of SLOT_CLASSES) {
				assert.ok(
					picture.className.split(" ").includes(slotClass),
					`a condensed group's picture carries \`${slotClass}\` — the fixed tile slot, not the row's own ceiling`,
				);
			}
			assert.doesNotMatch(picture.className, FULL_CEILING);
		}
		/*
		 * D4: every tile is the SAME slot, whatever the picture's aspect. jsdom
		 * cannot lay two boxes out, so the claim asserted here is the one that makes
		 * the layout uniform - identical class strings on two images of different
		 * intrinsic sizes - and the rendered boxes are the frames' claim.
		 */
		assert.notEqual(
			pictures[0].getAttribute("src"),
			pictures[1].getAttribute("src"),
			"the two tiles really are different pictures (fixtures 1x1 and 2x6)",
		);
		assert.equal(
			pictures[0].className,
			pictures[1].className,
			"a landscape and a portrait picture get the same slot, so the row stays a grid",
		);

		/* The press that made the full picture readable is unchanged. */
		await api.click(controls[1]);
		assert.ok(isOpen(api.document), "a thumbnail expands to the full picture");
		assert.equal(
			api.document.getElementById(
				api.document.querySelector(DIALOG).getAttribute("aria-labelledby"),
			).textContent,
			"Image 2",
			"and the overlay is named for the picture that was pressed",
		);
	});
});

test("one picture in a group is named as one picture", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(FoldMedia, {
				images: [transcriptImage],
				scope: transcriptScope,
				onRevealMore: () => {},
			}),
		);
		assert.equal(
			api.document
				.querySelector("[data-fold-media]")
				.getAttribute("aria-label"),
			"1 image from this run",
		);
		assert.equal(
			pictureButton(api.document).getAttribute("aria-label"),
			"Expand Image",
			'a lone picture is not "Image 1"',
		);
	});
});

/**
 * The fold's own header, mounted here so the strip's count and the tile's states
 * can be asserted against the REAL component tree rather than against a stand-in.
 * The optional `Fold` mounts the same props through the caller's host (`FoldHost`
 * below) for the cases that press the fold's own toggles.
 */
const foldElement = (props, Fold = TraceFold) =>
	React.createElement(
		Fold,
		{
			summary: { units: ["Explored 1 file, ran 2 commands"], prose: true },
			actionCount: 3,
			failedCount: 0,
			/*
			 * Both defaulted to `null` rather than left out: `span?.running` is read on
			 * every render, so an absent prop is a crash rather than a default, and a
			 * fold with no stamps and no call in flight is the honest baseline for a
			 * header assertion.
			 */
			span: null,
			live: null,
			recordIds: ["t0"],
			...props,
		},
		React.createElement("span", { "data-testid": "fold-row" }, "row"),
	);

/*
 * THE CALLER'S HALF OF THE CONTRACT, for the cases that press the fold's own
 * toggles (`chat-image-expand` U1): `TraceFold` is CONTROLLED on this branch -
 * `open`/`onOpenChange` are the conversation registry's, handed down at the
 * transcript's call site (`open={foldOpenOf(...)}`, `onOpenChange` ->
 * `setFoldOpenFor`), and BOTH the header's press and the count slot's report
 * upward through that channel. `trace-fold.stories.tsx`'s `FoldHost` plays the
 * registry's part for the story frames; this plays it for the mounted-tree
 * cases, with a tap (`onPress`) so a case can assert the press REACHED the
 * caller rather than only that a later frame looks open. A bare `TraceFold`
 * render would press a path the component no longer has: the U1 case assumed an
 * internal `setOpen`, which is why it threw `onOpenChange is not a function`
 * until this host existed.
 */
const FoldHost = ({ onPress, ...props }) => {
	const [open, setOpen] = useState(false);
	return React.createElement(TraceFold, {
		...props,
		open,
		onOpenChange: (next) => {
			onPress?.(next);
			setOpen(next);
		},
	});
};

test("the count is text in the header, and a run with no pictures gets no clause", async () => {
	await mount(async (api) => {
		/*
		 * Design review round 1, D3: the strip's accessible name said how many
		 * pictures the run produced while the visible header said nothing, so a
		 * sighted reader was offered strictly less than a screen-reader user.
		 */
		await api.render(foldElement({ mediaCount: 3 }));
		assert.match(
			api.document.body.textContent,
			/3 images/,
			"the header states the count as text, not as a title attribute or a badge",
		);
		await api.render(foldElement({ mediaCount: 1 }));
		assert.match(
			api.document.body.textContent,
			/1 image\b/,
			'one picture is one image, not "1 images"',
		);
		await api.render(foldElement({ mediaCount: 0 }));
		assert.doesNotMatch(
			api.document.body.textContent,
			/image/,
			"and a run with no pictures reads exactly as it read before this change",
		);
	});
});

test("the strip is capped at one row, and says how many it is not showing", async () => {
	await mount(async (api) => {
		/*
		 * Design review round 1, D3's second half: height grew with the count and had
		 * no cap, so 25-30 pictures made a CONDENSED group taller than the expanded one
		 * it replaces (~391px against ~338.7px). One row is the budget, and past it the
		 * last slot is the count.
		 */
		const many = Array.from({ length: 8 }, (_, index) => ({
			id: `image-expand:many:${index}`,
			data: PNG_BASE64,
			attachment: null,
			mimeType: "image/png",
		}));
		let revealed = 0;
		await api.render(
			React.createElement(FoldMedia, {
				images: many,
				scope: transcriptScope,
				onRevealMore: () => {
					revealed += 1;
				},
			}),
		);
		const items = [...api.document.querySelectorAll("[data-fold-media] li")];
		assert.equal(items.length, 5, "one row of slots, whatever the count");
		assert.equal(
			api.document.querySelectorAll("[data-fold-media] img").length,
			4,
			"four pictures, because the fifth slot is the count",
		);
		/*
		 * U1: past the cap this slot is the only route to the pictures the row did
		 * not draw, so it is a real button - the fold's own toggle, in the app - and
		 * not inert text a reader can do nothing with.
		 */
		const more = items.at(-1).querySelector("button");
		assert.ok(more, "the count slot is a control, not text");
		assert.equal(
			more.textContent,
			"+4",
			"the VISIBLE label is compact: it is what lets the larger tile fit one row",
		);
		assert.equal(
			more.getAttribute("aria-label"),
			"+4 more images",
			"and the accessible name is the full sentence - the count's honest carrier, noun included",
		);
		assert.ok(
			(more.getAttribute("aria-label") ?? "").includes(
				more.textContent ?? "\u0000",
			),
			"WCAG 2.5.3 (label in name): the visible label is a SUBSTRING of the accessible name, so a speech user reading `+4` off the screen can match the control",
		);
		assert.ok(
			(more.getAttribute("title") ?? "").includes(more.textContent ?? "\u0000"),
			"and the pointer reader's sentence contains it too",
		);
		assert.equal(
			more.getAttribute("title"),
			"+4 more images",
			"the pointer reader gets the same sentence rather than a bare +4",
		);
		await api.click(more);
		assert.equal(revealed, 1, "pressing it asks the fold's owner to open");
	});
});

/**
 * A digest-backed row: no inline bytes, so the relay is the only way to a URL.
 *
 * The DIGEST is a parameter because the hook's in-flight table is module-wide and
 * keyed by digest, and this file shares one bundled module across its tests: two
 * tests that used the same digest would be one fetch, so the second would wait on
 * the first's bridge rather than exercising its own.
 */
const durableImage = (id, digestChar) => ({
	id,
	data: null,
	attachment: digestChar.repeat(32),
	mimeType: "image/png",
});

test("a tile whose bytes are still coming reserves its box rather than calling the picture unavailable", async () => {
	await mount(async (api) => {
		/*
		 * Agent review round 1, P3: the hook answered `null` for "resolving" and
		 * "failed" alike, so a durable screenshot's FIRST paint in the strip was the
		 * unavailable receipt, swapping to a tile a frame later - in the one surface
		 * whose point is that the artifact is on screen, and on the path that is
		 * NORMAL there (a collapsed fold unmounts the rows that would have warmed the
		 * cache). The relay is held OPEN here - the bridge never settles - because
		 * that is the state under test; the test below is the same mount with the
		 * relay answering empty.
		 */
		api.window.api = { desktop: { media: () => new Promise(() => {}) } };
		await api.render(
			React.createElement(FoldMedia, {
				images: [durableImage("image-expand:durable:1", "b")],
				scope: transcriptScope,
				onRevealMore: () => {},
			}),
		);
		const reserved = api.document.querySelector("[data-attachment-reserved]");
		assert.ok(reserved, "the first paint is a reserved box, not a receipt");
		for (const slotClass of SLOT_BOX) {
			assert.ok(
				reserved.className.split(" ").includes(slotClass),
				`the reserved box occupies the tile's own \`${slotClass}\` slot, so nothing reflows when the picture lands`,
			);
		}
		assert.doesNotMatch(
			api.document.body.textContent,
			STORE_COPY_RE,
			"and it does not say the picture is unavailable while it is still coming",
		);
	});
});

test("a tile whose bytes never came shows the receipt, bounded to the tile", async () => {
	await mount(async (api) => {
		/*
		 * The relay answers EMPTY here, deterministically: the previous test holds a
		 * bridge open forever, and a fetch that fails for real (this rig's dead port)
		 * needs event-loop turns the settle budget should not have to guess at - the
		 * state under test is what the hook does with an empty answer, not how long a
		 * refused connection takes.
		 */
		api.window.api = {
			desktop: {
				media: async () => ({ status: 404, kind: "error", detail: "gone" }),
			},
		};
		await api.render(
			React.createElement(FoldMedia, {
				images: [durableImage("image-expand:durable:2", "c")],
				scope: transcriptScope,
				onRevealMore: () => {},
			}),
		);
		await api.settle(
			() => api.document.querySelector("[data-attachment-reserved]") === null,
			40,
		);
		const receipt = api.document.querySelector(
			'[data-fold-media] [role="img"]',
		);
		assert.ok(
			receipt,
			"the tile becomes a receipt, not a sentence that would blow the strip's height",
		);
		for (const slotClass of SLOT_BOX) {
			assert.ok(
				receipt.className.split(" ").includes(slotClass),
				`and the receipt stays inside the tile's own \`${slotClass}\` box`,
			);
		}
		assert.match(
			receipt.getAttribute("aria-label") ?? "",
			/could not be displayed/,
			"named rather than a silent icon: a reader is told which attachment failed, and why",
		);
		/*
		 * U5: the same sentence reaches the pointer reader as the tile's tooltip -
		 * at 78px there is no room for it as prose (it was a 66px tile before the
		 * polish pass grew it), and the glyph alone reads as "still loading".
		 */
		assert.match(
			receipt.getAttribute("title") ?? "",
			/could not be displayed/,
			"and the tile says why on hover, not only to a screen reader",
		);
	});
});

test("the real <img> survives the live-to-settled transition without remounting", async () => {
	await mount(async (api) => {
		/*
		 * Agent review round 1, P2: the body claimed node identity on the picture's
		 * `<img>` across the settle, and the assertion behind it was node identity on
		 * a `<span>` stand-in. This is the real tree - `TraceFold` + `FoldMedia` +
		 * `CanonicalImage` + `ImageAttachment` - across exactly that transition: the
		 * section carries a live clause and is then settled.
		 */
		const images = [
			{ ...transcriptImage },
			{ ...transcriptImage, id: "image-expand:settle:1" },
		];
		const render = (props) =>
			api.render(
				foldElement({
					...props,
					mediaCount: images.length,
					condensedMedia: (expand) =>
						React.createElement(FoldMedia, {
							images,
							scope: transcriptScope,
							onRevealMore: expand,
						}),
				}),
			);
		await render({
			sectionLive: true,
			live: { verb: "Running", object: "pnpm vitest run" },
		});
		const strip = api.document.querySelector("[data-fold-media]");
		const picture = api.document.querySelector("[data-fold-media] img");
		assert.ok(
			strip && picture,
			"the strip and its picture are drawn while live",
		);

		await render({ sectionLive: false, live: null });
		assert.equal(
			api.document.querySelector("[data-fold-media]"),
			strip,
			"the strip's own node survives the settle",
		);
		assert.equal(
			api.document.querySelector("[data-fold-media] img"),
			picture,
			"and so does the picture's - nothing remounts, so nothing re-decodes or flickers",
		);
	});
});

test("the count slot opens the fold it belongs to (U1)", async () => {
	await mount(async (api) => {
		/*
		 * UX round 1, U1: past the cap the count slot is the only route to the
		 * pictures the row did not draw, and it was inert text. It is a button now
		 * whose press is the FOLD'S OWN toggle - the same upward channel the
		 * header's press uses - so pressing it must reach the conversation (here
		 * `FoldHost`, playing the registry's part) and open the fold: the strip
		 * unmounts and the rows it stood for mount.
		 */
		const many = Array.from({ length: 8 }, (_, index) => ({
			id: `image-expand:more:${index}`,
			data: PNG_BASE64,
			attachment: null,
			mimeType: "image/png",
		}));
		const pressed = [];
		await api.render(
			foldElement(
				{
					mediaCount: many.length,
					condensedMedia: (expand) =>
						React.createElement(FoldMedia, {
							images: many,
							scope: transcriptScope,
							onRevealMore: expand,
						}),
					onPress: (next) => pressed.push(next),
				},
				FoldHost,
			),
		);
		const strip = api.document.querySelector("[data-fold-media]");
		assert.ok(strip, "the strip is on screen while condensed");
		const more = [...strip.querySelectorAll("button")].find((control) =>
			/more images?/.test(control.getAttribute("aria-label") ?? ""),
		);
		assert.ok(more, "the count slot is a real button");
		await api.click(more);
		assert.deepEqual(
			pressed,
			[true],
			"the press reached the conversation's registry - the channel the header's own press uses",
		);
		assert.equal(
			api.document.querySelector("[data-fold-media]"),
			null,
			"pressing it opens the fold: the strip hands over to the rows",
		);
		assert.ok(
			api.document.querySelector('[data-testid="fold-row"]'),
			"and the rows it stood for are mounted",
		);
	});
});

/*
 * THE POLISH PASS'S CONTRACTS (the operator's "drop the ring, a step larger, improve
 * the design"). jsdom has no layout and no hover, so what is asserted is the class
 * contract the rendered frames and `condensed-group-media-geometry.mjs` measure:
 * the measured boxes are theirs, the wiring that produces them is pinned here.
 * Cases marked CONTRACT PIN state a decision and cannot fail before the change in a
 * way that says anything new; the rest fail on the pre-change tree.
 */
const manyImages = (count, tag) =>
	Array.from({ length: count }, (_, index) => ({
		id: `image-expand:${tag}:${index}`,
		data: PNG_BASE64,
		attachment: null,
		mimeType: "image/png",
	}));

test("the tile is borderless at rest and its edge returns on hover and on keyboard focus", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(FoldMedia, {
				images: manyImages(2, "edge"),
				scope: transcriptScope,
				onRevealMore: () => {},
			}),
		);
		const frame = api.document.querySelector(
			"[data-fold-media] img",
		).parentElement;
		const classes = frame.className.split(" ");
		assert.ok(
			classes.includes("border-transparent"),
			"at rest the 1px border is RESERVED but invisible: the tile reads borderless and the returning edge moves nothing",
		);
		assert.ok(
			!classes.includes("border-control"),
			"and the resting ring is gone (the operator's ask)",
		);
		for (const arm of [
			"group-hover/tile:border-control",
			"group-focus-visible/tile:border-control",
		]) {
			assert.ok(
				classes.includes(arm),
				`the edge returns through \`${arm}\` - focus is half of it, so the keyboard case is never ambiguous on a tile with no resting boundary`,
			);
		}
		const button = api.document.querySelector("[data-fold-media] button");
		const buttonClasses = button.className.split(" ");
		assert.ok(
			buttonClasses.includes("group/tile"),
			"the edge answers to THIS tile's own button, not to the wrapper's unnamed group that the file-actions menu keys on",
		);
		assert.ok(
			buttonClasses.includes("rounded-sm"),
			"D4: the button the global focus ring is drawn on carries the frame's 6px radius, so the ring is not a square around a rounded tile",
		);
		assert.ok(
			classes.includes("overflow-hidden") && classes.includes("rounded-sm"),
			"the frame clips: the inner zoom can never leave the tile's silhouette",
		);
	});
});

test("hover zooms the picture INSIDE the tile, bounded by the gutter, and stands down under reduced motion", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(FoldMedia, {
				images: manyImages(1, "zoom"),
				scope: transcriptScope,
				onRevealMore: () => {},
			}),
		);
		const picture = api.document.querySelector("[data-fold-media] img");
		const classes = picture.className.split(" ");
		const zoom = classes.find((name) => name.includes("scale-["));
		assert.equal(
			zoom,
			"motion-safe:group-hover/tile:scale-[1.04]",
			"the zoom is the picture's, keyed to the tile's group, and gated on motion-safe",
		);
		assert.ok(
			!classes.some(
				(name) => name.includes("scale-[") && !name.startsWith("motion-safe:"),
			),
			"REDUCED-MOTION ARM: no ungated scale exists, so a reader who asked for less motion gets the edge alone",
		);
		const factor = Number(zoom.match(/scale-\[([\d.]+)\]/)[1]);
		/* The gutter is 8px and the tile 117px: the most a scaled picture may grow
		   before it could reach a neighbour, were the frame not clipping it. */
		assert.ok(
			factor > 1 && factor <= 1 + 8 / 117,
			`the zoom (${factor}) stays inside the gutter bound (${(1 + 8 / 117).toFixed(3)})`,
		);
		assert.ok(
			classes.includes("motion-safe:duration-fast") &&
				classes.includes("motion-safe:transition-transform"),
			"120ms, on the picture only",
		);
		assert.ok(
			classes.includes("motion-safe:ease-out-quart"),
			"with the app's own easing",
		);
	});
});

test("the +N control is an outlined button, not a filled pill (D3) - a resting edge at the contract's 3:1", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(FoldMedia, {
				images: manyImages(6, "outline"),
				scope: transcriptScope,
				onRevealMore: () => {},
			}),
		);
		const more = api.document.querySelector(
			"[data-fold-media] li:last-child button",
		);
		const classes = more.className.split(" ");
		assert.ok(
			classes.includes("border-control"),
			'the resting cue is the control edge, which contrast-contract.mjs pins at >=3:1 on every palette ground ("outline control")',
		);
		assert.ok(
			!classes.includes("bg-surface"),
			"and the fill that made it a pill is gone",
		);
		assert.equal(
			more.textContent,
			"+2",
			"five tiles' worth: six pictures, four tiles, +2",
		);
	});
});

test("the compact label is a function of the count alone; the name is the sentence, singular at one", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(FoldMedia, {
				images: manyImages(5, "one"),
				scope: transcriptScope,
				onRevealMore: () => {},
			}),
		);
		const more = api.document.querySelector(
			"[data-fold-media] li:last-child button",
		);
		assert.equal(
			api.document.querySelectorAll("[data-fold-media] img").length,
			4,
			"FIVE pictures draw four tiles: five 117px tiles (617px) do not fit the 556px column",
		);
		assert.equal(more.textContent, "+1");
		assert.equal(
			more.getAttribute("aria-label"),
			"+1 more image",
			"the noun agrees with the count in the name, and the name contains the visible `+1` (WCAG 2.5.3)",
		);
		assert.ok(
			(more.getAttribute("aria-label") ?? "").includes("+1"),
			"containment pinned at the singular too",
		);
	});
});

test("the uncapped strip is a four-column grid with no stranded tile (D5)", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(FoldMedia, {
				images: manyImages(9, "grid"),
				scope: transcriptScope,
				uncapped: true,
				onRevealMore: () => {},
			}),
		);
		const strip = api.document.querySelector("[data-fold-media]");
		assert.match(
			strip.className,
			/grid-cols-\[repeat\(4,max-content\)\]/,
			"a four-column grid, the capped row's own width",
		);
		const items = [...strip.querySelectorAll("li")];
		assert.equal(
			items.length,
			9,
			"one item per picture and nothing else in the list",
		);
		const starts = items
			.map((item, index) => [index, item.className.includes("col-start-1")])
			.filter(([, starts]) => starts)
			.map(([index]) => index);
		assert.deepEqual(
			starts,
			[0, 4, 7],
			"nine pictures break 4 / 3 / 2: the last row is two tiles, never one",
		);
	});
});

test("LEAK CHECK: the row's own (full) picture and the legacy frame keep the hairline and take no tile group", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(ImageAttachment, {
				file: FILE_PATH,
				src: PNG,
				label: "invoice",
				conversationId: "image-expand",
			}),
		);
		const frame = api.document.querySelector("button img").parentElement;
		const classes = frame.className.split(" ");
		assert.ok(
			classes.includes("border-hairline"),
			"a transcript row's picture keeps its decorative hairline",
		);
		assert.ok(
			!classes.some(
				(name) => name.includes("/tile") || name === "border-transparent",
			),
			"and none of the tile's hover or focus arms leaked onto it",
		);
		const button = api.document.querySelector("button");
		assert.ok(
			!button.className.split(" ").includes("group/tile"),
			"the full picture's button is not a tile group: nothing in a transcript row zooms",
		);
		assert.ok(
			!api.document.querySelector("button img").className.includes("scale-["),
			"and its picture never scales",
		);
	});
});

/*
 * U2 - KEYBOARD FOCUS AFTER THE COUNT'S PRESS. A keyboard press is, to the DOM,
 * a focused button receiving `click`, so that is what is sent: jsdom cannot turn a
 * keydown into a click, and the assertion is about where focus is AFTER the
 * control has unmounted, not about key synthesis.
 */
const pressByKeyboard = async (api, control) => {
	control.focus();
	assert.equal(
		api.document.activeElement,
		control,
		"the control holds focus first",
	);
	await api.click(control);
};

test("pressing +N by keyboard lands focus on the fold's trigger, not on <body> (U2)", async () => {
	await mount(async (api) => {
		await api.render(
			foldElement(
				{
					mediaCount: 8,
					condensedMedia: (expand) =>
						React.createElement(FoldMedia, {
							images: manyImages(8, "focus"),
							scope: transcriptScope,
							onRevealMore: expand,
						}),
				},
				FoldHost,
			),
		);
		await pressByKeyboard(
			api,
			api.document.querySelector("[data-fold-media] li:last-child button"),
		);
		assert.equal(
			api.document.querySelector("[data-fold-media]"),
			null,
			"the press opened the fold and the strip - with the control - unmounted",
		);
		const trigger = api.document.querySelector(
			"[data-fold-ids] button[aria-expanded]",
		);
		assert.equal(trigger.getAttribute("aria-expanded"), "true");
		assert.equal(
			api.document.activeElement,
			trigger,
			"focus continues from where the reader pressed: the trigger, which stays mounted and closes the group again",
		);
	});
});

test("CONTROL ARM: a caller that only opens the fold leaves focus on <body> - the defect the handoff removes", async () => {
	await mount(async (api) => {
		/* The pre-fix `() => onOpenChange(true)`, written out: the same strip over a
		   host that opens and unmounts and does nothing else. If this arm ever reads
		   anything but <body> the instrument is no longer seeing the defect and the
		   test above proves nothing. */
		const Bare = () => {
			const [open, setOpen] = useState(false);
			return React.createElement(
				"div",
				null,
				React.createElement(
					"button",
					{ type: "button", "aria-expanded": open },
					"trigger",
				),
				!open &&
					React.createElement(FoldMedia, {
						images: manyImages(8, "bare"),
						scope: transcriptScope,
						onRevealMore: () => setOpen(true),
					}),
			);
		};
		await api.render(React.createElement(Bare));
		await pressByKeyboard(
			api,
			api.document.querySelector("[data-fold-media] li:last-child button"),
		);
		assert.equal(
			api.document.activeElement,
			api.document.body,
			"focus fell to <body>: the next Tab would restart at the document's first stop",
		);
	});
});

test("the full-ceiling picture keeps the three classes the ledger rule is made of", async () => {
	await mount(async (api) => {
		/*
		 * Agent review round 1, P1: the `size` refactor dropped `max-w-full` and
		 * `object-contain` from BOTH sizes, so the comment above the class map cited
		 * `object-contain` as the reason a `min-w` floor was rejected while the element
		 * no longer carried it. They are restored, and the claim is asserted here
		 * rather than left to a frame: the pre-existing frames of this surface are not
		 * byte-stable across captures (measured - two identical sweeps at one head
		 * differ), so a re-take cannot be the instrument, and the class list is what
		 * changed.
		 */
		await api.render(
			React.createElement(ImageAttachment, {
				file: FILE_PATH,
				src: PNG,
				label: "invoice",
				conversationId: "image-expand",
			}),
		);
		const picture = api.document.querySelector("button img");
		for (const fullClass of FULL_CEILING_CLASSES) {
			assert.ok(
				picture.className.split(" ").includes(fullClass),
				`the transcript's own picture carries \`${fullClass}\``,
			);
		}
	});
});
