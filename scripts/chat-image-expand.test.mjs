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
 *   8. the image actions menu beside a conversation picture stays reachable without
 *      a pointer (round 1, review R1-1). Its wrapper used to be `invisible`, i.e.
 *      `visibility: hidden`, which takes the trigger out of the tab order — and the
 *      file-shaped actions in it are the ones the picture's own click used to
 *      perform before that click became the expansion (five of them now: the
 *      canvas entry and the four file actions, plus `Copy image` added by
 *      2026-10-11's image-actions pass);
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
			export { ImageGroupLightbox } from "./src/renderer/src/features/chat/canonical/image-group-lightbox";
			export { MarkdownImage } from "./src/renderer/src/features/chat/components/markdown-image";
			export { FoldMedia } from "./src/renderer/src/features/chat/canonical/fold-media";
			export { TraceFold } from "./src/renderer/src/features/chat/components/trace/trace-fold";
			export {
				clampGroupIndex,
				clampViewerPan,
				groupPositionLabel,
				stepZoom,
				VIEWER_ZOOM_MAX,
				wrapGroupIndex,
			} from "./src/renderer/src/shared/lib/image-viewer-model";
			export { SCROLLBAR_HOLD_MS } from "./src/renderer/src/shared/lib/scrollbar-activity";
			export { CONTROLS_RESTING_CLASS } from "./src/renderer/src/shared/components/common/image-lightbox";
			export { t } from "@shared/i18n";
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
	ImageGroupLightbox,
	MarkdownImage,
	FoldMedia,
	TraceFold,
	clampGroupIndex,
	clampViewerPan,
	groupPositionLabel,
	stepZoom,
	VIEWER_ZOOM_MAX,
	wrapGroupIndex,
	SCROLLBAR_HOLD_MS,
	CONTROLS_RESTING_CLASS,
	t,
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
 * strings: `file` is what the picture is called and what its actions menu
 * classifies, `src` is what the browser loads. The two must differ here — the
 * filename of a `data:` URI is the base64 tail — and the kinds are covered on
 * both sides now: this path-backed shape carries the file-shaped actions, and
 * the canonical cases below carry the menu a URI-only picture gets
 * (`scripts/image-actions.test.mjs` pins the per-kind matrix those menus read).
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

/* ------------------------------------------------- the carousel's own fixtures */

/**
 * A THIRD distinct picture, because "the picture switched" is a claim about the
 * src the viewer paints and two fixtures can prove one switch: a 2x2 magenta
 * square beside the 1x1 and the 2x6 portrait, so each of three tiles resolves to
 * a different URL and position can be read off the DOM alone.
 */
const MAGENTA_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVR4nGM4IRd1Qi6KAUIBACTGBQFVr/vpAAAAAElFTkSuQmCC";

const carouselImage = (id, base64) => ({
	id,
	data: base64,
	attachment: null,
	mimeType: "image/png",
});
/** A picture the group references and no store can serve: `missing` on the first render. */
const absentImage = (id) => ({
	id,
	data: null,
	attachment: null,
	mimeType: "image/png",
});

const IMAGE_ONE = carouselImage("image-expand:carousel:1", PNG_BASE64);
const IMAGE_TWO = carouselImage("image-expand:carousel:2", PORTRAIT_BASE64);
const IMAGE_THREE = carouselImage("image-expand:carousel:3", MAGENTA_BASE64);
const IMAGE_ABSENT = absentImage("image-expand:carousel:absent");

/** The carousel's own chrome, by the shipped attributes a reader can check. */
const FILMSTRIP = "[data-image-filmstrip]";
const LIVE_POSITION = '[role="dialog"] [aria-live="polite"]';
/**
 * The viewer's OWN picture box, which is how a case reads the painted src
 * without picking up a filmstrip tile's: the strip's tiles are images too, and
 * they sit after the viewer in DOM order, so the exit that says "the viewer
 * paints no picture" needs the frame's own marker rather than the dialog's
 * first image.
 */
const VIEWER_PICTURE = "[data-image-viewport] img";
const filmstripTiles = (document) =>
	[...document.querySelectorAll(`${FILMSTRIP} button`)].filter((button) =>
		(button.getAttribute("aria-label") ?? "").startsWith("Show image"),
	);
const viewerControl = (document, name) =>
	document.querySelector(`[role="dialog"] button[aria-label="${name}"]`);

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
 * The image actions trigger beside a conversation picture, and the wrapper that
 * reveals it. Named by shipped attributes rather than a test hook, as above:
 * the trigger's accessible name is the `supplement-row.tsx` vocabulary
 * (`Actions for <name>`), and the name here is the file's own basename.
 */
const FILE_ACTIONS = 'button[aria-label="Actions for invoices-march.png"]';
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
/**
 * The SAME sentence without the leading name, for labels that compose one: a
 * receipt's `aria-label` is `<name> <detail>`, and the name is the tile's own
 * position ("Image 3"), so the group cases match the store's half alone.
 */
const UNAVAILABLE_COPY_RE =
	/could not be displayed\. Its stored copy is not available to this reader\./;

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
		/**
		 * Any key, for the viewer's own keyboard rules (the arrow walk). Same shape
		 * as `pressEscape` and named separately so neither claim borrows the
		 * other's sender; `metaKey` exists so the case that must NOT switch can say
		 * why in its own name.
		 */
		pressKey: async (key, { metaKey = false } = {}) => {
			act(() => {
				window.document.dispatchEvent(
					new window.KeyboardEvent("keydown", {
						key,
						bubbles: true,
						cancelable: true,
						metaKey,
					}),
				);
			});
			await api.settle();
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
		/*
		 * One timer turn BEFORE the globals are restored, because Radix's focus
		 * scope schedules its unmount handoff in a `setTimeout(0)` (its
		 * `AUTOFOCUS_ON_UNMOUNT` dispatch). That timer is a NODE timer -
		 * `setTimeout` is not one of this harness's window shims, so
		 * `window.close()` cannot cancel it - and if it fires after the shims
		 * are restored (or after the NEXT mount installed its own), it builds
		 * its `CustomEvent` from that realm and dispatches it onto THIS
		 * window's container: jsdom refuses a foreign realm's event, and the
		 * uncaught rejection lands on whichever test is running then (measured:
		 * a stray `TypeError ... parameter 1 is not of type 'Event'` attributed
		 * to a later case). Flushing here makes the timer fire while its own
		 * window is still the installed one.
		 */
		await new Promise((resolve) => setTimeout(resolve, 0));
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

test("the image actions menu stays reachable without a pointer", async () => {
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
			`a picture on disk carries its image actions (${FILE_ACTIONS_WRAPPER})`,
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
			 * `image-actions-menu.tsx` nests `<Tooltip><DropdownMenuTrigger asChild>`
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
				`the reveal must keep \`${token}\` — the file-shaped actions in it became pointer-only when the picture's click stopped opening the file (review round 1, R1-1)`,
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
		// attribute flip: five entries, in the portal, where Radix puts them.
		const menu = api.document.querySelector('div[role="menu"]');
		assert.ok(menu, "the open menu is in the document (role=menu)");
		assert.equal(
			menu.querySelectorAll('[role="menuitem"]').length,
			5,
			"and it carries the five actions this menu offers",
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

test("Copy image on a PNG is the byte-exact pass-through, with no canvas in the path", async () => {
	await mount(async (api) => {
		/*
		 * THE CLAIM: a PNG blob skips the transcode entirely. The fix added an
		 * encode for every non-PNG type (Chromium's sanitized clipboard write
		 * refuses `image/jpeg` and friends; `image-actions.test.mjs` pins the
		 * decision), and the encode half needs a real document - so what a jsdom
		 * harness CAN answer is the half that must NOT enter it: the entry is
		 * written under `image/png`, and the bytes in it are the resolved blob's
		 * own, unchanged. The ENCODE branch (non-PNG decode, canvas, `toBlob`)
		 * genuinely cannot run here - jsdom has no canvas and no image decoder -
		 * so it is NOT faked; it is proven by the real-click `image-copy` scene
		 * against the built app (`docs/evidence/image-copy/`).
		 */
		const writes = [];
		const previousClipboardItem = Object.getOwnPropertyDescriptor(
			globalThis,
			"ClipboardItem",
		);
		const previousClipboard = Object.getOwnPropertyDescriptor(
			globalThis.navigator,
			"clipboard",
		);
		Object.defineProperty(globalThis, "ClipboardItem", {
			configurable: true,
			writable: true,
			value: class {
				constructor(items) {
					this.items = items;
				}
			},
		});
		Object.defineProperty(globalThis.navigator, "clipboard", {
			configurable: true,
			value: {
				write: async (items) => {
					writes.push(...items);
				},
				writeText: async () => {},
			},
		});
		try {
			await api.render(
				React.createElement(ImageAttachment, {
					file: PNG,
					src: PNG,
					conversationId: "image-expand",
				}),
			);
			const trigger = api.document.querySelector(
				'button[aria-label^="Actions for"]',
			);
			assert.ok(trigger, "a `data:`-kind picture carries the menu");
			act(() => {
				trigger.focus();
				trigger.dispatchEvent(
					new window.MouseEvent("pointerdown", {
						bubbles: true,
						cancelable: true,
						button: 0,
					}),
				);
			});
			await act(async () => {});
			const item = [...api.document.querySelectorAll('[role="menuitem"]')].find(
				(candidate) => candidate.textContent.includes("Copy image"),
			);
			assert.ok(item, "the menu's Copy image entry");
			act(() => {
				item.dispatchEvent(
					new window.MouseEvent("pointerdown", {
						bubbles: true,
						cancelable: true,
						button: 0,
					}),
				);
				item.dispatchEvent(
					new window.MouseEvent("click", { bubbles: true, cancelable: true }),
				);
			});
			await api.settle(() => writes.length > 0);
			assert.equal(writes.length, 1, "exactly one clipboard entry");
			assert.deepEqual(
				Object.keys(writes[0].items),
				["image/png"],
				"written under the clipboard's one writable image type",
			);
			const blob = writes[0].items["image/png"];
			const expected = Buffer.from(PNG_BASE64, "base64");
			assert.equal(
				blob.size,
				expected.length,
				"the pass-through hands over the resolved bytes unchanged",
			);
			assert.deepEqual(
				[...new Uint8Array(await blob.arrayBuffer())],
				[...expected],
			);
		} finally {
			if (previousClipboardItem)
				Object.defineProperty(
					globalThis,
					"ClipboardItem",
					previousClipboardItem,
				);
			else Reflect.deleteProperty(globalThis, "ClipboardItem");
			if (previousClipboard)
				Object.defineProperty(
					globalThis.navigator,
					"clipboard",
					previousClipboard,
				);
			else Reflect.deleteProperty(globalThis.navigator, "clipboard");
		}
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
			[
				"Expand Image 1",
				"Actions for Image 1",
				"Expand Image 2",
				"Actions for Image 2",
			],
			"each picture's name says WHICH one it is, in the same noun as the clause — and since the 2026-10-11 image-actions pass every tile also carries its picture's actions trigger (named with the tile's own label), so the exact list holds two controls per tile and a nameless extra one still fails here",
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

		/* The press that made the full picture readable is unchanged — by LABEL, not
		   by index: since the 2026-10-11 image-actions pass the strip's controls are
		   two per tile (expand + actions), so the second POSITION is no longer the
		   second picture. */
		const secondExpand = controls.find(
			(control) => control.getAttribute("aria-label") === "Expand Image 2",
		);
		assert.ok(secondExpand, "the second tile's expand control is on the strip");
		await api.click(secondExpand);
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
		assert.ok(
			classes.includes("bg-media-surface"),
			"the tile's resting extent is the fill role - `mediaSurface`, authored to the ΔE00 4.0 off-canvas floor - so a page-toned picture's tile separates where the shared `sunken` well measured as low as 2.00",
		);
		assert.ok(
			!classes.includes("bg-sunken"),
			"and it is no longer the shared well: a regression to `bg-sunken` leaves every palette assertion green while the tile loses the extent the fill role exists for",
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

/* ---------------------------------------------- the image actions menu (moved)
 *
 * The MOUNTED half of the image-actions matrix, moved here from
 * `image-actions.test.mjs` in the round-1 remediation (agent review R3): the
 * suite already pays for THIS file's component bundle and its jsdom stack, and
 * the extra copy of both was measured as the weight that tipped the desktop
 * suite's memory bound. The pure half — classification, the per-kind table, the
 * byte resolver — stays there, bundled from the two pure modules alone; the
 * relay seam these cases need is the one the durable fixtures above already use
 * (`api.window.api.desktop.media`).
 */
const IMAGE_ACTIONS_TRIGGER = 'button[aria-label^="Actions for"]';

test("a blob-backed canonical picture NOW carries the menu — the gap this change closes", async () => {
	const pngBytes = Uint8Array.from(atob(PNG_BASE64), (character) =>
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
			trigger = api.document.querySelector(IMAGE_ACTIONS_TRIGGER);
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
		const trigger = api.document.querySelector(IMAGE_ACTIONS_TRIGGER);
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
		const trigger = api.document.querySelector(IMAGE_ACTIONS_TRIGGER);
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

/* ------------------------------------------------------------- the carousel */

/*
 * THE ARITHMETIC FIRST, because every case below leans on it and the DOM cases
 * would only fail obliquely if it were wrong. These are the same functions the
 * components call; they are imported from the bundle rather than re-stated so a
 * copy cannot disagree with the shipped rule.
 */

test("the group walk wraps and clamps, and the position sentence is one rule", () => {
	assert.equal(
		wrapGroupIndex(0, 3, -1),
		2,
		"left from the first wraps to the last",
	);
	assert.equal(
		wrapGroupIndex(2, 3, 1),
		0,
		"right from the last wraps to the first",
	);
	assert.equal(wrapGroupIndex(1, 3, 1), 2, "and the walk is one step between");
	assert.equal(
		wrapGroupIndex(0, 1, -1),
		0,
		"a group of one stays on its only picture",
	);
	assert.equal(
		wrapGroupIndex(5, 0, 1),
		0,
		"an empty group has no position to walk to",
	);

	assert.equal(
		clampGroupIndex(-2, 3),
		0,
		"a stale low index clamps to the first",
	);
	assert.equal(
		clampGroupIndex(9, 3),
		2,
		"a stale high index clamps to the last",
	);
	assert.equal(
		clampGroupIndex(1.7, 3),
		1,
		"a fractional index truncates rather than drifting",
	);

	assert.equal(
		groupPositionLabel(1, 3),
		t("ui.common.viewer.position", { kind: "image", index: 2, count: 3 }),
		"one sentence, 1-based, both facts",
	);

	assert.equal(stepZoom(1, 1), 2, "a zoom step walks the ladder");
	assert.equal(
		stepZoom(VIEWER_ZOOM_MAX, 1),
		VIEWER_ZOOM_MAX,
		"and stops at its top",
	);
	assert.equal(stepZoom(1, -1), 1, "whereas the floor is fit itself");

	const frame = { width: 400, height: 200 };
	assert.deepEqual(
		clampViewerPan({ x: 999, y: -999 }, frame, 2),
		{ x: 200, y: -100 },
		"at 2x the picture overhangs by half its size a side, and a pan past that clamps to the edge — each axis around its own centre (no gap, no rubber band)",
	);
	assert.deepEqual(
		clampViewerPan({ x: 50, y: 40 }, frame, 1),
		{ x: 0, y: 0 },
		"at fit there is no overhang at all, which is the pan-only-when-zoomed rule as arithmetic",
	);
	assert.deepEqual(
		clampViewerPan({ x: 50, y: 40 }, { width: 0, height: 0 }, 3),
		{ x: 0, y: 0 },
		"and an unmeasured frame clamps to centre rather than to a guess",
	);
});

test("a group tile opens the carousel at the picture that was pressed, with the set's strip and arrows", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(FoldMedia, {
				images: [IMAGE_ONE, IMAGE_TWO, IMAGE_ABSENT],
				scope: transcriptScope,
				onRevealMore: () => {},
			}),
		);
		const second = api.document.querySelector(
			'[data-fold-media] button[aria-label="Expand Image 2"]',
		);
		assert.ok(second, "the strip's own second tile is the press under test");
		await api.click(second);

		assert.ok(isOpen(api.document), "the press opens the overlay");
		const dialog = api.document.querySelector(DIALOG);
		const mainPicture = dialog.querySelector("img");
		assert.equal(
			mainPicture.getAttribute("src"),
			`data:image/png;base64,${PORTRAIT_BASE64}`,
			"on the picture that was PRESSED, not the group's first",
		);
		assert.equal(
			api.document.getElementById(dialog.getAttribute("aria-labelledby"))
				.textContent,
			"Image 2",
			"and the overlay's name is that picture's own label, as the single-image case asserts",
		);
		assert.equal(
			api.document.querySelector(LIVE_POSITION)?.textContent,
			"Image 2 of 3",
			"the position is announced in one sentence, 1-based",
		);

		const strip = api.document.querySelector(FILMSTRIP);
		assert.ok(strip, "the group's other pictures are a strip in the layer");
		/*
		 * Two of the three are pressable tiles and the third is the RECEIPT — the
		 * same shape the transcript's own strip gives a picture with no bytes
		 * (there is no button there either), so the strip "reflects what is known"
		 * instead of offering a press that would show the same sentence over the
		 * scrim. The ARROWS still reach it; the walk is not bounded by the tiles.
		 */
		const tiles = filmstripTiles(api.document);
		assert.deepEqual(
			tiles.map((tile) => tile.getAttribute("aria-label")),
			["Show image 1 of 3", "Show image 2 of 3"],
			"every loaded picture is a tile, named by action and position",
		);
		assert.equal(
			tiles[1].getAttribute("aria-current"),
			"true",
			"and the current one carries the mark",
		);
		assert.equal(
			tiles[0].getAttribute("aria-current"),
			null,
			"which its neighbours do not",
		);
		/*
		 * The partially-loaded case, staged the one way that is honest: the third
		 * picture has no bytes at all, so its slot drew the receipt instead of a
		 * picture rather than a tile that would resolve to nothing.
		 */
		const receipt = strip.querySelector('[role="img"]');
		assert.match(
			receipt?.getAttribute("aria-label") ?? "",
			UNAVAILABLE_COPY_RE,
			"a picture with no bytes shows the receipt the transcript's own strip shows",
		);

		assert.ok(
			viewerControl(api.document, "Previous image"),
			"the walk left/right is on screen",
		);
		assert.ok(viewerControl(api.document, "Next image"), "in both directions");
	});
});

test("the arrows walk the whole group, wrapping at the ends, and a missing picture shows its receipt", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(FoldMedia, {
				images: [IMAGE_ONE, IMAGE_TWO, IMAGE_ABSENT],
				scope: transcriptScope,
				onRevealMore: () => {},
			}),
		);
		await api.click(
			api.document.querySelector(
				'[data-fold-media] button[aria-label="Expand Image 1"]',
			),
		);

		const pictureSrc = () =>
			api.document.querySelector(VIEWER_PICTURE)?.getAttribute("src") ?? null;
		const position = () =>
			api.document.querySelector(LIVE_POSITION)?.textContent ?? null;

		await api.click(viewerControl(api.document, "Next image"));
		assert.equal(
			pictureSrc(),
			`data:image/png;base64,${PORTRAIT_BASE64}`,
			"Next moves to the second picture",
		);
		assert.equal(position(), "Image 2 of 3", "and says so");

		await api.click(viewerControl(api.document, "Next image"));
		assert.equal(
			api.document.querySelector("[data-image-viewport]"),
			null,
			"the third picture has no bytes, so the viewer's frame holds no picture at all",
		);
		assert.match(
			api.document.querySelector(DIALOG)?.textContent ?? "",
			UNAVAILABLE_COPY_RE,
			"and answers with the store's own sentence rather than a torn glyph",
		);
		assert.equal(position(), "Image 3 of 3", "the position still advances");
		/*
		 * AND THE RECEIPT SLOT IS MARKED TOO (UX round 1, U1-1): the walk onto a
		 * picture with no bytes used to leave the strip with NO mark anywhere -
		 * the receipt has no control to carry the tile's edge - so the reader who
		 * walked onto it could not see which of the set was on screen. The ring
		 * lives on the slot, which the receipt slot has just as the tiles do.
		 */
		assert.ok(
			api.document
				.querySelector('[data-image-slot="3"]')
				.className.split(" ")
				.includes("ring-ink"),
			"the receipt slot carries the current ring",
		);
		assert.ok(
			!api.document
				.querySelector('[data-image-slot="1"]')
				.className.split(" ")
				.includes("ring-ink"),
			"and the slot that is no longer current does not",
		);

		await api.click(viewerControl(api.document, "Next image"));
		assert.equal(
			pictureSrc(),
			`data:image/png;base64,${PNG_BASE64}`,
			"Next from the last wraps to the first — the wrap is the walk's own rule",
		);
		assert.equal(
			position(),
			t("ui.common.viewer.position", { kind: "image", index: 1, count: 3 }),
			"and the announcement wraps with it",
		);
	});
});

test("the arrow KEYS switch pictures, and a modifier chord is left to the app", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(FoldMedia, {
				images: [IMAGE_ONE, IMAGE_TWO, IMAGE_THREE],
				scope: transcriptScope,
				onRevealMore: () => {},
			}),
		);
		await api.click(
			api.document.querySelector(
				'[data-fold-media] button[aria-label="Expand Image 1"]',
			),
		);
		const pictureSrc = () =>
			api.document.querySelector(VIEWER_PICTURE)?.getAttribute("src") ?? null;

		await api.pressKey("ArrowRight");
		assert.equal(
			pictureSrc(),
			`data:image/png;base64,${PORTRAIT_BASE64}`,
			"ArrowRight is the same walk as the button",
		);
		await api.pressKey("ArrowRight");
		assert.equal(
			pictureSrc(),
			`data:image/png;base64,${MAGENTA_BASE64}`,
			"and keeps walking",
		);
		await api.pressKey("ArrowLeft");
		assert.equal(
			pictureSrc(),
			`data:image/png;base64,${PORTRAIT_BASE64}`,
			"ArrowLeft steps back",
		);
		/*
		 * The modifier chord is the app's: ⌘← means "back" elsewhere in this
		 * window, and a viewer that swallowed it would take a navigation away
		 * from a reader who asked for it.
		 */
		await api.pressKey("ArrowRight", { metaKey: true });
		assert.equal(
			pictureSrc(),
			`data:image/png;base64,${PORTRAIT_BASE64}`,
			"a ⌘ chord does not step the group",
		);
	});
});

test("the filmstrip switches to the tile that was pressed and moves the current mark", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(FoldMedia, {
				images: [IMAGE_ONE, IMAGE_TWO, IMAGE_THREE],
				scope: transcriptScope,
				onRevealMore: () => {},
			}),
		);
		await api.click(
			api.document.querySelector(
				'[data-fold-media] button[aria-label="Expand Image 1"]',
			),
		);
		const tiles = filmstripTiles(api.document);
		const pictureSrc = () =>
			api.document.querySelector(VIEWER_PICTURE)?.getAttribute("src") ?? null;

		await api.click(tiles[2]);
		assert.equal(
			pictureSrc(),
			`data:image/png;base64,${MAGENTA_BASE64}`,
			"pressing a tile shows that tile's picture",
		);
		const after = filmstripTiles(api.document);
		assert.equal(
			after[2].getAttribute("aria-current"),
			"true",
			"and the current mark follows the press",
		);
		assert.equal(
			after[0].getAttribute("aria-current"),
			null,
			"off the old tile",
		);
		/*
		 * The mark's VISUAL half lives on the SLOT, which is where design round 1's
		 * D1-1 and UX round 1's U1-1 met: the tile's own `border-control` edge
		 * measured 1.52-2.36:1 over the light themes' scrims and vanished entirely
		 * when the current slot had no control - the receipt - while the slot's
		 * `ring-ink` clears the 3:1 non-text floor over every scrim composite (the
		 * contract asserts it) and can sit on ANY slot, including one with no
		 * button in it.
		 */
		const slots = [...api.document.querySelectorAll("[data-image-slot]")];
		assert.ok(
			slots[2].className.split(" ").includes("ring-ink"),
			"the current slot holds the ink ring at rest",
		);
		assert.ok(
			!slots[0].className.split(" ").includes("ring-ink"),
			"and the slots it does not show carry none",
		);
		assert.equal(
			api.document.querySelector(LIVE_POSITION)?.textContent,
			"Image 3 of 3",
			"the announcement follows too",
		);
		await api.click(after[0]);
		assert.equal(
			pictureSrc(),
			`data:image/png;base64,${PNG_BASE64}`,
			"and back is one more press, not a reopen",
		);
	});
});

test("one picture in a group keeps the single-picture chrome — no strip, no arrows", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(FoldMedia, {
				images: [IMAGE_ONE],
				scope: transcriptScope,
				onRevealMore: () => {},
			}),
		);
		await api.click(
			api.document.querySelector(
				'[data-fold-media] button[aria-label="Expand Image"]',
			),
		);
		assert.ok(isOpen(api.document), "the lone picture still expands");
		assert.equal(
			api.document.querySelector(FILMSTRIP),
			null,
			"with no second picture there is no set to collage",
		);
		assert.equal(
			viewerControl(api.document, "Previous image"),
			null,
			"and no walk to offer",
		);
		assert.ok(
			viewerControl(api.document, "Zoom in"),
			"while the zoomed-state controls are there for one picture exactly as for three",
		);
	});
});

test("the zoomed-state controls are real buttons with names, and they step the ladder they claim", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(ImageAttachment, {
				file: FILE_PATH,
				src: PNG,
				conversationId: "image-expand",
			}),
		);
		await api.click(pictureButton(api.document));
		const picture = api.document.querySelector(EXPANDED_PICTURE);

		const zoomOut = viewerControl(api.document, "Zoom out");
		const zoomIn = viewerControl(api.document, "Zoom in");
		const reset = viewerControl(api.document, "Reset view");
		assert.ok(zoomOut && zoomIn && reset, "the cluster is on screen");
		assert.equal(
			zoomOut.disabled,
			true,
			"at fit there is nothing to zoom out of",
		);
		assert.equal(reset.disabled, true, "and nothing to reset");
		assert.equal(
			zoomIn.disabled,
			false,
			"while zooming in is the live control",
		);

		await api.click(zoomIn);
		assert.equal(
			picture.style.transform,
			"translate(0px, 0px) scale(2)",
			"one press is the ladder's second step, over the fit",
		);
		assert.equal(zoomOut.disabled, false, "and now there is a step back");
		assert.equal(reset.disabled, false, "and a view to reset");

		await api.click(zoomIn);
		await api.click(zoomIn);
		assert.equal(
			picture.style.transform,
			`translate(0px, 0px) scale(${VIEWER_ZOOM_MAX})`,
			"the ladder stops at its top",
		);
		assert.equal(zoomIn.disabled, true, "where the control says so");
	});
});

test("reset returns the view to fit: the transform goes and the controls disable again", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(ImageAttachment, {
				file: FILE_PATH,
				src: PNG,
				conversationId: "image-expand",
			}),
		);
		await api.click(pictureButton(api.document));
		await api.click(viewerControl(api.document, "Zoom in"));
		assert.notEqual(
			api.document.querySelector(EXPANDED_PICTURE).style.transform,
			"",
			"the picture is zoomed before the reset",
		);

		await api.click(viewerControl(api.document, "Reset view"));
		assert.equal(
			api.document.querySelector(EXPANDED_PICTURE).style.transform,
			"",
			"reset returns the view to fit — no transform, the picture exactly where it opened",
		);
		assert.equal(
			viewerControl(api.document, "Zoom out").disabled,
			true,
			"and the cluster reads as fit again (zoom-out disabled)",
		);
		assert.equal(
			viewerControl(api.document, "Reset view").disabled,
			true,
			"with nothing left to reset",
		);
	});
});

test("Escape closes the carousel and focus returns to the strip tile that was pressed", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(FoldMedia, {
				images: [IMAGE_ONE, IMAGE_TWO],
				scope: transcriptScope,
				onRevealMore: () => {},
			}),
		);
		const second = api.document.querySelector(
			'[data-fold-media] button[aria-label="Expand Image 2"]',
		);
		await api.click(second);
		assert.ok(isOpen(api.document), "the carousel is open to be escaped from");
		second.focus();

		await api.pressEscape(
			() => api.focused() === 'button[aria-label="Expand Image 2"]',
		);

		assert.equal(isOpen(api.document), false, "Escape closes it");
		assert.equal(
			api.focused(),
			'button[aria-label="Expand Image 2"]',
			"and focus lands on the tile the reader pressed, not on <body> — the group overlay reuses the single-image handoff",
		);
	});
});

/* ------------------------------------------------- the fade, focus and scroll */

test("the controls fade to their resting floor after the hold, and activity wakes them", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(ImageAttachment, {
				file: FILE_PATH,
				src: PNG,
				conversationId: "image-expand",
			}),
		);
		await api.click(pictureButton(api.document));
		const controls = api.document.querySelector("[data-image-viewer-controls]");
		assert.ok(controls, "the cluster is on screen");

		/*
		 * FOCUS IS THE FLOOR'S PREREQUISITE (design round 1, D1-2). Radix's
		 * modal autofocus used to land on the cluster's first control, and the
		 * guard below re-arms while focus is inside the cluster - so the resting
		 * state was unreachable while the app had focus at all. The open now
		 * anchors focus on the picture's own frame instead: outside the cluster,
		 * inside the dialog.
		 */
		assert.equal(
			api.document.activeElement?.getAttribute("data-image-viewport"),
			"",
			"the frame takes focus at open, not a cluster control",
		);
		assert.ok(
			!controls.contains(api.document.activeElement),
			"so the guard can let the cluster rest",
		);
		assert.ok(
			controls.className.split(" ").includes("opacity-100"),
			"awake at open",
		);

		/*
		 * The hold is `SCROLLBAR_HOLD_MS` of real time — the scrollbar fade's
		 * own constant, imported rather than re-declared — so the case waits it
		 * out for real rather than faking the clock the production code reads.
		 */
		await act(async () => {
			await new Promise((resolve) =>
				setTimeout(resolve, SCROLLBAR_HOLD_MS + 400),
			);
		});
		/*
		 * The resting floor is the shipped component's own
		 * `CONTROLS_RESTING_CLASS` (design round 1, D1; agent review round 3,
		 * R3-2): imported rather than copied, so changing the floor cannot leave
		 * this assertion pinning the previous value - which is how this suite
		 * went red when 0.45 became 0.85.
		 */
		assert.ok(
			controls.className.split(" ").includes(CONTROLS_RESTING_CLASS),
			"after the hold the cluster sinks to its resting floor",
		);

		/*
		 * And ANY activity brings it back: the listener is observational, so a
		 * bare pointermove (the shape a reader makes by reaching for a control)
		 * is enough.
		 */
		await act(async () => {
			api.window.document.dispatchEvent(
				new api.window.Event("pointermove", { bubbles: true }),
			);
			await Promise.resolve();
		});
		await api.settle();
		assert.ok(
			controls.className.split(" ").includes("opacity-100"),
			"a pointer move wakes it to full strength",
		);
	});
});

test("a focused control holds the cluster awake past the hold", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(ImageAttachment, {
				file: FILE_PATH,
				src: PNG,
				conversationId: "image-expand",
			}),
		);
		await api.click(pictureButton(api.document));
		const controls = api.document.querySelector("[data-image-viewer-controls]");
		const zoomIn = viewerControl(api.document, "Zoom in");
		/*
		 * The other half of the guard: a reader who TABBED onto a control must
		 * not have it dim under them (the scrollbar fade's own amended rule).
		 * Focus in the cluster re-arms the hold for as long as it stays there.
		 */
		act(() => {
			zoomIn.focus();
		});
		await act(async () => {
			await new Promise((resolve) =>
				setTimeout(resolve, SCROLLBAR_HOLD_MS + 400),
			);
		});
		assert.ok(
			controls.className.split(" ").includes("opacity-100"),
			"a focused control keeps the cluster at full strength",
		);
	});
});

test("a walk from a strip tile moves focus with the picture - and off the tiles onto a receipt", async () => {
	await mount(async (api) => {
		await api.render(
			React.createElement(FoldMedia, {
				images: [IMAGE_ONE, IMAGE_TWO, IMAGE_ABSENT],
				scope: transcriptScope,
				onRevealMore: () => {},
			}),
		);
		await api.click(
			api.document.querySelector(
				'[data-fold-media] button[aria-label="Expand Image 1"]',
			),
		);
		const strip = api.document.querySelector(FILMSTRIP);
		const tiles = filmstripTiles(api.document);

		/*
		 * THE STAGED CASE (design round 1, D1-3): focus is ON a strip tile - the
		 * reader tabbed to it - and the walk moves the current. The tile that
		 * held focus must not keep reading as the current one: focus follows the
		 * picture to the new tile's own control.
		 */
		act(() => {
			tiles[0].focus();
		});
		await api.pressKey("ArrowRight");
		assert.equal(
			api.document.activeElement?.getAttribute("aria-label"),
			"Show image 2 of 3",
			"focus followed the walk to the new current tile",
		);

		/*
		 * And onto a picture that has NO control to take it: the receipt slot is
		 * not a button, so focus leaves the tiles for the dialog's layer rather
		 * than staying on the stale tile.
		 */
		await api.pressKey("ArrowRight");
		assert.ok(
			!strip.contains(api.document.activeElement),
			"focus left the strip when the walk landed on the receipt",
		);
		assert.equal(
			api.document.activeElement,
			api.document.querySelector(DIALOG),
			"and sits on the dialog's layer",
		);
	});
});

test("the walk scrolls the current slot into view, a receipt's slot included", async () => {
	await mount(async (api) => {
		const calls = [];
		/*
		 * jsdom does not implement `scrollIntoView`; the component optional-calls
		 * it, so the suite can install a recorder instead of stubbing the layout.
		 */
		api.window.HTMLElement.prototype.scrollIntoView =
			function scrollIntoView() {
				calls.push(this.getAttribute("data-image-slot"));
			};
		try {
			await api.render(
				React.createElement(FoldMedia, {
					images: [IMAGE_ONE, IMAGE_TWO, IMAGE_ABSENT],
					scope: transcriptScope,
					onRevealMore: () => {},
				}),
			);
			await api.click(
				api.document.querySelector(
					'[data-fold-media] button[aria-label="Expand Image 1"]',
				),
			);
			assert.equal(
				calls.at(-1),
				"1",
				"opening scrolls the current slot into view (the strip may be wider than its viewport)",
			);

			await api.click(viewerControl(api.document, "Next image"));
			assert.equal(calls.at(-1), "2", "and every walk scrolls the NEW current");

			await api.click(viewerControl(api.document, "Next image"));
			assert.equal(
				calls.at(-1),
				"3",
				"including the receipt's slot, which has no button but is still a slot",
			);
		} finally {
			Reflect.deleteProperty(
				api.window.HTMLElement.prototype,
				"scrollIntoView",
			);
		}
	});
});

/* The class contract here and real-browser rects in the evidence README are
 * complementary: jsdom has no layout and cannot prove scrollport clearance. */
test("wide wrap reveals both endpoint slots with the 1px ring scroll-margin contract", async () => {
	await mount(async (api) => {
		const images = Array.from({ length: 10 }, (_, index) => ({
			...IMAGE_ONE,
			id: `ring-clearance:${index}`,
		}));
		const calls = [];
		api.window.HTMLElement.prototype.scrollIntoView = function (options) {
			calls.push({ slot: this.getAttribute("data-image-slot"), options });
		};
		try {
			await api.render(
				React.createElement(FoldMedia, {
					images,
					scope: transcriptScope,
					onRevealMore: () => {},
				}),
			);
			await api.click(
				api.document.querySelector(
					'[data-fold-media] button[aria-label="Expand Image 1"]',
				),
			);
			await api.click(viewerControl(api.document, "Previous image"));
			assert.equal(calls.at(-1).slot, "10", "Previous wraps to the last slot");
			await api.click(viewerControl(api.document, "Next image"));
			assert.equal(calls.at(-1).slot, "1", "Next wraps back to the first slot");
			for (const index of [1, 10]) {
				const slot = api.document.querySelector(`[data-image-slot="${index}"]`);
				assert.ok(
					slot.classList.contains("scroll-mx-px"),
					"both endpoints reserve the ring's 1px inline outset during reveal",
				);
			}
			assert.deepEqual(calls.at(-1).options, {
				block: "nearest",
				inline: "nearest",
			});
		} finally {
			Reflect.deleteProperty(
				api.window.HTMLElement.prototype,
				"scrollIntoView",
			);
		}
	});
});

/* A controlled strip-root observer plus the real media bridge/resolver chain.
 * No jsdom visibility/layout claim: deliveries below are explicit fixture input. */
test("cold strip demand admits visible and wrapped neighbour slots, not far digests; admission resets on close/group change", async () => {
	await mount(async (api) => {
		const oldObserver = globalThis.IntersectionObserver;
		const observers = [];
		class ControlledObserver {
			constructor(callback, options) {
				this.callback = callback;
				this.root = options.root;
				this.slots = [];
				this.disconnected = false;
				observers.push(this);
			}
			observe(slot) {
				this.slots.push(slot);
			}
			disconnect() {
				this.disconnected = true;
			}
			deliver(index, visible = true) {
				this.callback([
					{ target: this.slots[index - 1], isIntersecting: visible },
				]);
			}
		}
		globalThis.IntersectionObserver = ControlledObserver;
		const requests = [];
		const replies = [];
		api.window.api = {
			desktop: {
				media: (request) => {
					requests.push(request.digest);
					return new Promise((resolve) => replies.push(resolve));
				},
			},
		};
		const images = Array.from({ length: 12 }, (_, index) => ({
			id: `demand-test:${index}`,
			data: index === 0 || index === 5 ? PNG_BASE64 : null,
			attachment:
				index === 0 || index === 5
					? null
					: (300 + index).toString(16).padStart(32, "0"),
			mimeType: "image/png",
		}));
		const draw = (open, group = images) =>
			api.render(
				React.createElement(ImageGroupLightbox, {
					images: group,
					index: 0,
					scope: transcriptScope,
					open,
					onOpenChange: () => {},
				}),
			);
		try {
			await draw(true);
			assert.deepEqual(
				new Set(requests),
				new Set([images[1].attachment, images[11].attachment]),
				"open loads only wrapped neighbours; inline selected image needs no relay",
			);
			assert.equal(
				observers.filter((o) => !o.disconnected).length,
				1,
				"ONE strip-root observer",
			);
			const observer = observers.at(-1);
			assert.equal(observer.root, api.document.querySelector(FILMSTRIP));
			assert.equal(
				observer.slots.length,
				12,
				"every known slot stays in the list",
			);
			assert.ok(
				api.document.querySelector('[data-image-slot="6"] img'),
				"offscreen inline-known image is immediate",
			);
			const slot8 = api.document.querySelector('[data-image-slot="8"]');
			const reserved8 = slot8.querySelector("[data-attachment-deferred]");
			assert.ok(
				reserved8,
				"far cold tile is a stable reserved box, not a fetch",
			);
			for (const cls of SLOT_BOX) assert.ok(reserved8.classList.contains(cls));
			await act(async () => {
				observer.deliver(4);
			});
			await api.settle();
			assert.ok(
				requests.includes(images[3].attachment),
				"scroll visibility loads that digest",
			);
			const countAfterVisible = requests.length;
			await act(async () => {
				observer.deliver(4, false);
			});
			await api.settle();
			assert.equal(
				requests.length,
				countAfterVisible,
				"leaving view does not restart resolution",
			);
			assert.equal(
				api.document.querySelector(
					'[data-image-slot="4"] [data-attachment-deferred]',
				),
				null,
				"admission latches while open",
			);
			await api.click(
				api.document.querySelector('button[aria-label="Show image 4 of 12"]'),
			);
			assert.equal(
				api.document.querySelector(LIVE_POSITION)?.textContent,
				"Image 4 of 12",
				"an admitted resolving tile is selectable before its bytes arrive",
			);
			assert.ok(
				slot8.firstElementChild.classList.contains("h-[79px]"),
				"cold outer slots reserve the browser-measured settled height throughout",
			);
			await api.click(
				slot8.querySelector('button[aria-label="Show image 8 of 12"]'),
			);
			assert.equal(
				api.document.querySelector('[data-image-slot="8"]'),
				slot8,
				"selection never remounts the stable li",
			);
			for (const index of [6, 7, 8])
				assert.ok(
					requests.includes(images[index].attachment),
					"selection admits current +/-1 before bytes arrive",
				);
			assert.equal(
				api.document.querySelector(LIVE_POSITION)?.textContent,
				"Image 8 of 12",
			);
			for (const cls of SLOT_BOX)
				assert.ok(
					slot8
						.querySelector("[data-attachment-reserved]")
						.classList.contains(cls),
					"same box while resolving",
				);
			assert.ok(
				!requests.includes(images[9].attachment),
				"another far cold digest is still untouched",
			);
			await draw(false);
			await draw(true);
			assert.ok(
				api.document.querySelector(
					'[data-image-slot="8"] [data-attachment-deferred]',
				),
				"close/reopen clears latched eligibility",
			);
			const freshObserver = observers.at(-1);
			await act(async () => {
				observer.deliver(8);
			});
			await api.settle();
			assert.ok(
				api.document.querySelector(
					'[data-image-slot="8"] [data-attachment-deferred]',
				),
				"retired observer cannot admit the reopened strip",
			);
			const other = images.map((image, index) => ({
				...image,
				id: `other:${index}`,
				attachment: image.attachment
					? (500 + index).toString(16).padStart(32, "0")
					: null,
			}));
			await draw(true, other);
			assert.ok(
				api.document.querySelector(
					'[data-image-slot="4"] [data-attachment-deferred]',
				),
				"new group cannot inherit old index admission",
			);
			await act(async () => {
				freshObserver.deliver(4);
			});
			await api.settle();
			assert.ok(
				!requests.includes(other[3].attachment),
				"old group's queued callback cannot fetch a new group's far digest",
			);
			await api.click(viewerControl(api.document, "Previous image"));
			assert.equal(
				api.document.querySelector(LIVE_POSITION)?.textContent,
				"Image 12 of 12",
				"wrap admits last image before bytes arrive",
			);
			assert.ok(
				requests.includes(other[10].attachment),
				"wrapped neighbour 11 loads on demand",
			);
		} finally {
			// Finish synthetic attempts before changing the jsdom realm; nothing is sent to a daemon.
			await act(async () => {
				for (const reply of replies)
					reply({
						status: 404,
						kind: "error",
						detail: "Synthetic fixture ended",
					});
			});
			if (oldObserver) globalThis.IntersectionObserver = oldObserver;
			else Reflect.deleteProperty(globalThis, "IntersectionObserver");
		}
	});
});
