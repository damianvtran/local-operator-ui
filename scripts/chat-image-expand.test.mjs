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
 *      appear.
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
import React, { act } from "react";

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
const { ImageAttachment, FileAttachment, CanonicalImage } = await import(
	pathToFileURL(bundlePath).href
);

/* ------------------------------------------------------------------ fixtures */

/**
 * A 1x1 PNG, small enough to inline and real enough that the browser path is the
 * one under test. The overlays' own pixels are the frames' business.
 */
const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const PNG = `data:image/png;base64,${PNG_BASE64}`;
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
	/Screenshot could not be displayed\. Its stored copy is not available to this reader\./;

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
				label: "Screenshot",
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
			"Screenshot",
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
			 * trigger vanishes from under it (UX round 2, U2-1). The class is the half
			 * an engine without layout can check, exactly as above; the frame that
			 * shows it is `chat-image-expand--legacy-tabbed-open`, where the trigger
			 * must still be drawn behind the open menu.
			 */
			"has-[[data-state=open]]:pointer-events-auto",
			"has-[[data-state=open]]:opacity-100",
		]) {
			assert.ok(
				wrapper.className.includes(token),
				`the reveal must keep \`${token}\` — the four actions in it became pointer-only when the picture's click stopped opening the file (review round 1, R1-1)`,
			);
		}
		/*
		 * And the control itself is real: enabled, focusable, and not hidden from a
		 * reader while it is hidden from the pointer.
		 */
		const trigger = api.document.querySelector(FILE_ACTIONS);
		assert.ok(trigger, `the actions have a trigger (${FILE_ACTIONS})`);
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
				label: "Screenshot",
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
