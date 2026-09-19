/**
 * The link affordances, driven through the SHIPPED components in jsdom.
 *
 *     node --test scripts/chat-link-affordances.test.mjs
 *
 * WHY THIS FILE EXISTS. Round 1 left four claims with no instrument that could
 * see them, and every one is a claim about WIRING rather than about a value:
 *
 *   1. `classifyHref`'s `file://` branch was unreachable, because
 *      `defaultUrlTransform` blanked a hand-written `[report](file:///tmp/a.pdf)`
 *      before the component saw it (review M1);
 *   2. a `%`-encoded destination reached the app encoded, so Copy copied a string
 *      naming no file and `shell.openPath` was handed one (QA Q-1, UX U3);
 *   3. the anchor's two click traps - the mandatory `preventDefault` and the
 *      drag-select refusal - had no test that could catch their removal, because
 *      no suite imported the module that carried them (review M3);
 *   4. the toolbar's placement is RE-MEASURED when its subject changes inside one
 *      turn (design D1), the pointer path between a link and its toolbar keeps the
 *      subject where every containment test answered "not the turn" (design D1's
 *      BLOCKER), and `Tab`/`Escape` address the subject the reader is on even when
 *      the pointer and the keyboard disagree about which link that is (UX U1, U2
 *      and U8).
 *
 * FOUR OF THOSE ARE GATED ON A REAL BROWSER TOO, and the split is deliberate: a
 * jsdom suite can hold the arithmetic and the wiring, and cannot hold a pointer.
 * `docs/evidence/chat-canonical-links/` carries the frames for the same claims -
 * `hover-toolbar-button`, `copy-pressed` and the new `hover-gap-crossing` drive
 * real `Input.dispatchMouseEvent` samples through the gap - and the rig asserts
 * them rather than photographing them (`expectAnchored`, `expectKept`).
 *
 * HOW IT STANDS IN FOR A BROWSER. jsdom with React's own scheduler, the harness
 * `chat-image-expand.test.mjs` uses, over the PRODUCTION `MarkdownRenderer` and
 * `CanonicalTranscript` bundled from source by esbuild. The assertions are
 * structural - which attribute, which element, where focus is, what a press was
 * handed - and NOT geometric in the sense a frame is: jsdom has no layout engine,
 * so every box below is STUBBED, and each test says which box it stubbed and what
 * it therefore proves. The pixels are the story frames' business
 * (`docs/evidence/chat-canonical-links/`), and a green run here is not visual
 * evidence and does not claim to be.
 *
 * ISOLATION. Nothing here boots the app, a fork or Electron: it is jsdom in this
 * process, so there is no window mode to name and no session of the operator's to
 * touch. `window.api` is a stub object owned by this file, the conversation id is
 * synthetic (`links-test`), and no path in it is read from disk.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const ROOT = resolve(import.meta.dirname, "..");

/*
 * React DOM feature-detects input events at import time, so a document has to
 * exist before it is loaded - the bootstrap the other jsdom suites use, with the
 * same `Reflect.deleteProperty` cleanup `pnpm lint:scripts` requires.
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

/* React stays out of the bundle so the mounted tree shares THIS React instance. */
const EXTERNAL = /^(react|react-dom)(\/.*)?$/;
const BARE_SPECIFIER = /^[^./]/;
const CACHE = join(ROOT, "node_modules", ".cache", "chat-link-affordances");
const bundle = await build({
	stdin: {
		contents: `
			export { MarkdownRenderer, LINK_URL_TRANSFORM } from "./src/renderer/src/features/chat/components/markdown-renderer";
			export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";
			export { CanvasPaneProvider } from "./src/renderer/src/features/chat/utils/canvas-pane";
			export { classifyHref, probeStateFor, probeTarget, resetProbeCache } from "./src/renderer/src/features/chat/utils/link-actions";
			export { useCanvasStore } from "./src/renderer/src/shared/store/canvas-store";
			export { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	// Vite's `import.meta.env` is read by config modules at import time. The URL
	// is dead on purpose: nothing here should reach a service.
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45998" };',
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
const bundlePath = join(CACHE, "link-affordances.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const {
	MarkdownRenderer,
	CanonicalTranscript,
	CanvasPaneProvider,
	LINK_URL_TRANSFORM,
	classifyHref,
	probeTarget,
	probeStateFor,
	resetProbeCache,
	useCanvasStore,
	useUiPreferencesStore,
} = await import(pathToFileURL(bundlePath).href);

/* ------------------------------------------------------------------ the mount */

/**
 * A fresh document per test, with the globals the components reach for bare.
 *
 * `ResizeObserver` is a no-op because the hook under test only USES it to
 * re-measure; the measurement itself is what these tests stub, so a real
 * observer would add nothing but a source of nondeterminism.
 */
function mountDom() {
	const dom = new JSDOM('<!doctype html><div id="root"></div>', {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	const { window } = dom;
	/*
	 * The animation frames this shim has scheduled, so teardown can drop them
	 * BEFORE the globals go away (see `restore`). A placed strip schedules its own
	 * coalesced measure this way (`use-floating-control.ts`), and a callback that
	 * fires after teardown reads the `window` global and throws - which node scores
	 * as a FAILED FILE against a test that passed. Node's own `setTimeout` is left
	 * alone: React's scheduler and jsdom's timers use it, and wrapping it here was
	 * measured to break the mount outright (a commit-phase stack overflow).
	 */
	const pendingTimers = new Set();
	const originals = new Map();
	const shims = {
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		HTMLAnchorElement: window.HTMLAnchorElement,
		HTMLButtonElement: window.HTMLButtonElement,
		Element: window.Element,
		Node: window.Node,
		NodeFilter: window.NodeFilter,
		Event: window.Event,
		MouseEvent: window.MouseEvent,
		CustomEvent: window.CustomEvent,
		KeyboardEvent: window.KeyboardEvent,
		MutationObserver: window.MutationObserver,
		requestAnimationFrame: (callback) => {
			const handle = window.setTimeout(() => {
				pendingTimers.delete(handle);
				callback(0);
			}, 0);
			pendingTimers.add(handle);
			return handle;
		},
		cancelAnimationFrame: (handle) => {
			pendingTimers.delete(handle);
			window.clearTimeout(handle);
		},
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
	/**
	 * Tear the frame down without leaving work behind.
	 *
	 * The order matters and every step is a measured leak:
	 *
	 *   1. the timers this frame scheduled are DROPPED, because a placed strip
	 *      schedules its own coalesced measure (`use-floating-control.ts`) and that
	 *      callback reads the `window` global - if it fires after the globals are
	 *      put back, jsdom reports `ReferenceError: window is not defined` as an
	 *      uncaught error and node-as-a-test-runner scores it as a FAILED FILE,
	 *      i.e. a green suite that fails;
	 *   2. the window is closed, which drops jsdom's own pending timers;
	 *   3. the tree is NOT unmounted, and that is a measurement rather than an
	 *      oversight: unmounting a Radix-laden row costs ~86s of churn in jsdom (the
	 *      tooltips the toolbar's buttons carry, unmounting one `act` at a time),
	 *      while `close()` has already stopped every timer the tree could act on -
	 *      so the frame is abandoned to the garbage collector instead. A test file
	 *      that costs a minute and a half in `pnpm test:desktop` is a worse defect
	 *      than a tree jsdom is about to throw away;
	 *   4. only then are the globals restored.
	 */
	return {
		window,
		document: window.document,
		restore() {
			for (const handle of pendingTimers) window.clearTimeout(handle);
			pendingTimers.clear();
			/*
			 * UNMOUNT WITHOUT `act`, and while the window is still open: a tree left
			 * standing keeps its handlers on `document` (this hook listens there for
			 * `pointerdown`, `selectionchange` and Escape), so an abandoned frame's
			 * row still answers the NEXT test's events - measured, five abandoned
			 * trees turned a 0.3s test into a 75s fold of React warnings and
			 * cross-tree work. `act` around the unmount is what must be avoided
			 * instead: awaiting it around a Radix tooltip costs ~90s on its own.
			 */
			root.unmount();
			dom.window.close();
			for (const [key, descriptor] of originals) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
		},
		render: async (element) => {
			act(() => {
				root.render(element);
			});
			await act(async () => {});
		},
		/**
		 * A real event, dispatched inside a SYNCHRONOUS `act` so React flushes what
		 * it sets.
		 *
		 * Synchronous rather than awaited on purpose, and measured: an awaited
		 * `act(async () => {})` after every dispatch waits for React's queue to go
		 * quiet, and a focused toolbar button opens a Radix tooltip whose Floating
		 * UI `autoUpdate` loop never does - the Tab test cost 23s per dispatch that
		 * way against 0.4s this way, with identical assertions. Nothing here needs
		 * the async drain: every state these tests assert is set by a DISCRETE
		 * event, which React flushes before `act` returns.
		 *
		 * `window.Event`/`MouseEvent`/`KeyboardEvent` rather than node's: the
		 * listeners are jsdom's and read jsdom's own prototypes.
		 */
		dispatch: async (target, type, init = {}) => {
			/*
			 * Every pointer event is a `MouseEvent`: the row's corridor reads
			 * `clientX`/`clientY`, and a bare `Event` carries neither - which would
			 * silently make every sample "outside the corridor" and turn a real
			 * assertion into an accident.
			 */
			const EventCtor =
				type === "keydown"
					? window.KeyboardEvent
					: type === "click" ||
							type.startsWith("mouse") ||
							type.startsWith("pointer")
						? window.MouseEvent
						: window.Event;
			const event = new EventCtor(type, {
				bubbles: true,
				cancelable: true,
				...init,
			});
			act(() => {
				target.dispatchEvent(event);
			});
			return event;
		},
	};
}

/* ------------------------------------------------------------------ fixtures */

const HOME = "/Users/someone";
/*
 * What the main process's `resolveUserPath` does to the spelling a link wrote.
 * The suite needs it because the app's own probe answers with the RESOLVED path
 * and that string is the document's identity - a stub that answers
 * `resolved: input` makes every identity assertion below true for the wrong
 * reason (review round 1, M1).
 */
const resolveUserPath = (path) =>
	path.startsWith("~/") ? `${HOME}/${path.slice(2)}` : path;
const REPORT =
	"~/workspace/opoint-renewal-2026-09-17/opoint_adverse_media_query_failures_2026-09-17.xlsx";
/** The same file, as the probe and the Files panel's tile spell it. */
const RESOLVED_REPORT = resolveUserPath(REPORT);
const SHOTS = "/Users/someone/Downloads/Screenshot 2026-09-17 at 10.14.02.png";
/** The same URL as the story fixture writes it: percent-encoded, as prose. */
const FILE_URL = `file://${SHOTS.replace(/ /g, "%20")}`;
const GONE = "/tmp/lo-link-missing/report-2026-09-17.pdf";
const MISSING_MARKER = "/tmp/lo-link-missing/";

const ANSWER = [
	`Saved it to ${REPORT} (37 KB, 8 sheets).`,
	"",
	`The screenshot is at ${FILE_URL} and the missing one is ${GONE}.`,
].join("\n");

const record = (id, kind, text) =>
	kind === "user"
		? { kind, id, ts: 1_760_000_000_000, text, images: [] }
		: {
				kind,
				id,
				ts: 1_760_000_000_001,
				text,
				streaming: false,
				stopReason: null,
				error: false,
				complete: true,
			};

const TRANSCRIPT = {
	records: [
		record("u1", "user", "Where did the run put everything?"),
		record("a1", "assistant", ANSWER),
	],
	index: new Map([
		["u1", 0],
		["a1", 1],
	]),
};

/**
 * `probeFiles`, answering for this fixture's own paths only.
 *
 * Installed per test rather than once, because the missing-path case is the
 * interesting one and the honest default (no bridge) is optimistic.
 */
function stubApi(window, { exists = true, sizeBytes = 37_000 } = {}) {
	window.api = {
		...window.api,
		probeFiles: async (paths) =>
			paths.map((input) => ({
				input,
				resolved: resolveUserPath(input),
				exists: exists && !input.startsWith(MISSING_MARKER),
				isFile: true,
				sizeBytes,
				mtimeMs: 1_760_000_000_000,
			})),
	};
}

/* --------------------------------------------------------- stubbed geometry */

const rect = (left, top, width, height) => ({
	left,
	top,
	width,
	height,
	right: left + width,
	bottom: top + height,
	x: left,
	y: top,
	toJSON() {
		return { left, top, width, height };
	},
});

/** Give an element a box. jsdom reports zeros, so every geometry test stubs. */
const box = (element, value) => {
	element.getBoundingClientRect = () => value;
	return element;
};

/** Give an element line boxes (`getClientRects`), which is what the hook reads. */
const lines = (element, ...values) => {
	element.getClientRects = () => values;
	return element;
};

const ROW_BOX = rect(40, 300, 944, 400);
const PANE_BOX = rect(40, 100, 944, 600);
const CONTROL_BOX = rect(0, 0, 120, 32);

/**
 * A DEFAULT box and size for every element, stubbed at the prototype.
 *
 * jsdom has no layout engine, so every element reports 0x0. That is not merely
 * inconvenient here: Radix's positioning (the buttons carry `Tooltip`s) retries
 * while the reference has no box, and a retry loop against a zero box turns each
 * dispatch into seconds of churn. Giving the whole tree a plausible box keeps the
 * mount cheap, and each test that asserts GEOMETRY overrides the elements it
 * measures (`box`/`lines` below are own-property writes, so they win).
 */
const DEFAULT_BOX = rect(100, 100, 120, 20);
const DEFAULT_SIZE = { width: 28, height: 28 };
function stubLayout(window, controlSize = CONTROL_BOX) {
	const proto = window.HTMLElement.prototype;
	proto.getBoundingClientRect = () => DEFAULT_BOX;
	for (const [name, fallback] of [
		["offsetWidth", DEFAULT_SIZE.width],
		["offsetHeight", DEFAULT_SIZE.height],
	]) {
		Object.defineProperty(proto, name, {
			configurable: true,
			get() {
				return this.hasAttribute("data-lo-link-toolbar")
					? controlSize[name === "offsetWidth" ? "width" : "height"]
					: fallback;
			},
		});
	}
}

/** The rendered toolbar's own inline position, as the reader would see it. */
const placementOf = (document) => {
	const strip = document.querySelector("[data-lo-link-toolbar]");
	if (!strip) return null;
	return {
		top: Number.parseFloat(strip.style.top),
		left: Number.parseFloat(strip.style.left),
	};
};

const anchorFor = (document, endsWith) => {
	const anchors = [
		...document.querySelectorAll('[data-record-id="a1"] a[data-lo-kind]'),
	];
	const found = anchors.find((anchor) =>
		(anchor.getAttribute("data-lo-target") ?? "").endsWith(endsWith),
	);
	assert.ok(found, `no anchor ending in ${endsWith}`);
	return found;
};

/* ----------------------------------------------------- the rendered pipeline */

let frame;
beforeEach(() => {
	frame = mountDom();
});
afterEach(() => {
	frame?.restore();
});

test("a detected file:// URL reaches the app DECODED, href and target alike", async () => {
	/*
	 * QA Q-1 and UX U3, at the layer that was wrong: `remark-rehype` percent-encodes
	 * a destination on its way into hast, so the classifier met `%20` - and the app
	 * then copied `%20` and handed `shell.openPath` a string naming no file. The
	 * fixture is the story's own input, macOS's default screenshot name.
	 */
	stubApi(frame.window);
	await frame.render(
		React.createElement(MarkdownRenderer, {
			content: `Saved it to ${FILE_URL}.`,
		}),
	);
	const anchor = frame.document.querySelector("a[data-lo-kind]");
	assert.ok(anchor, "the URL in prose must become a link");
	assert.equal(anchor.getAttribute("data-lo-kind"), "file");
	assert.equal(anchor.getAttribute("data-lo-target"), SHOTS);
	assert.equal(anchor.getAttribute("href"), SHOTS);
	assert.ok(
		!anchor.getAttribute("href").includes("%"),
		"the href must be the path, not the encoded URL",
	);
	/* The reader still sees the URL the agent wrote. */
	assert.equal(anchor.textContent, FILE_URL);
});

test("a hand-written file:// markdown link gets the affordances", async () => {
	/*
	 * Review M1: this branch was DEAD - `defaultUrlTransform` blanked `file:` before
	 * the component saw the href, so the anchor rendered as `<a href="">` with no
	 * `data-lo-*` attributes and no toolbar, while two comments claimed the branch
	 * was reachable. `MarkdownRenderer` now passes a `urlTransform` that preserves
	 * `file:` for `href`, and this is the assertion that makes the claim true.
	 */
	stubApi(frame.window);
	await frame.render(
		React.createElement(MarkdownRenderer, {
			content: "The report is [report](file:///tmp/a%20b.pdf) and a PDF.",
		}),
	);
	const anchor = frame.document.querySelector("a[data-lo-kind]");
	assert.ok(anchor, "a hand-written file:// link must be a target");
	assert.equal(anchor.getAttribute("data-lo-kind"), "file");
	assert.equal(anchor.getAttribute("data-lo-target"), "/tmp/a b.pdf");
	assert.equal(anchor.getAttribute("href"), "/tmp/a b.pdf");
});

test("unlisted schemes are still blanked, and never get a toolbar", async () => {
	/*
	 * The other half of M1, and the reason the transform delegates instead of
	 * allowing: an href this app has no business opening keeps exactly the
	 * behaviour `defaultUrlTransform` gives it.
	 */
	stubApi(frame.window);
	for (const scheme of [
		"javascript:alert(1)",
		"data:text/plain,hello",
		"vbscript:msgbox(1)",
		"ftp://host/a.pdf",
	]) {
		const dom = mountDom();
		try {
			await dom.render(
				React.createElement(MarkdownRenderer, {
					content: `A [link](${scheme}) here.`,
				}),
			);
			const anchor = dom.document.querySelector("a");
			assert.ok(anchor, scheme);
			assert.equal(
				anchor.hasAttribute("data-lo-kind"),
				false,
				`${scheme} must not be a target`,
			);
			/* jsdom reports a blanked href as the current document's URL. */
			assert.ok(
				!/(javascript|vbscript|data|ftp):/i.test(
					anchor.getAttribute("href") ?? "",
				),
				`${scheme} must be blanked`,
			);
		} finally {
			dom.restore();
		}
	}
});

test("a detected anchor is not draggable, so a drag on it can select", async () => {
	/*
	 * The CODE cause of UX U4: an `<a>` with an href is draggable in Chromium, and
	 * a mousedown-then-drag on one starts the browser's own LINK DRAG, which
	 * suppresses text selection - so the designed "highlight wholly inside one link"
	 * state was unreachable with a mouse. The real drag is proven in the live story
	 * (the rig's own CDP gesture, in `docs/evidence/chat-canonical-links/`); this is
	 * the attribute that makes it possible.
	 */
	stubApi(frame.window);
	await frame.render(
		React.createElement(MarkdownRenderer, {
			content: `Saved it to ${REPORT}.`,
		}),
	);
	const anchor = frame.document.querySelector("a[data-lo-kind]");
	assert.equal(anchor.getAttribute("draggable"), "false");
	/*
	 * A hand-written `file:` link and a URL are the same kind of target, so they
	 * carry the same rule; an ordinary markdown link this app does not own keeps
	 * the browser's own drag behaviour, which is the line M1 drew.
	 */
	await frame.render(
		React.createElement(MarkdownRenderer, {
			content:
				"A [link](https://example.com/a.png) and a [file](file:///tmp/x.pdf).",
		}),
	);
	assert.equal(
		frame.document
			.querySelector('a[data-lo-kind="url"]')
			.getAttribute("draggable"),
		"false",
		"a URL target is a target too: a highlight inside it must be selectable",
	);
	assert.equal(
		frame.document
			.querySelector('a[data-lo-kind="file"]')
			.getAttribute("draggable"),
		"false",
	);
});

test("a press opens the DECODED path; a press with a live highlight opens nothing", async () => {
	/*
	 * Review M3: the anchor's two traps had no test that could catch their removal.
	 * Both are driven here through the SHIPPED anchor - a real `click` event on the
	 * rendered element, with the bridge recorded - because the decision's own unit
	 * test (`link-actions.test.mjs`) cannot see whether the handler is wired to it.
	 */
	stubApi(frame.window);
	const opened = [];
	frame.window.api.openFile = async (target) => {
		opened.push(target);
		return { ok: true, resolved: target };
	};
	await frame.render(
		React.createElement(MarkdownRenderer, {
			content: `Saved it to ${FILE_URL}.`,
		}),
	);
	const anchor = frame.document.querySelector("a[data-lo-kind]");

	/* 1. A plain press. */
	const plain = await frame.dispatch(anchor, "click");
	assert.deepEqual(opened, [SHOTS], "the press must open the decoded path");
	assert.equal(plain.defaultPrevented, true, "the default must be cancelled");

	/* 2. The same press with the reader's highlight still over the anchor. */
	opened.length = 0;
	const range = frame.document.createRange();
	range.selectNodeContents(anchor);
	const selection = frame.window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
	const dragging = await frame.dispatch(anchor, "click");
	assert.deepEqual(opened, [], "a drag must never launch an application");
	assert.equal(dragging.defaultPrevented, true, "and must still not navigate");
});

/* --------------------------------------------------------------- the toolbar */

/** Mount the transcript with the fixture, and stub every box it measures. */
async function mountTranscript(options = {}) {
	const { transcript = TRANSCRIPT, ...apiOptions } = options;
	stubApi(frame.window, apiOptions);
	/*
	 * The layout stubs go in BEFORE the mount: the toolbar's buttons carry Radix
	 * tooltips, which position themselves on mount, and a zero-sized reference
	 * makes that work retry - seconds of churn per mount in jsdom otherwise.
	 */
	stubLayout(frame.window);
	const containerRef = React.createRef();
	await frame.render(
		React.createElement(CanonicalTranscript, {
			transcript,
			frontend: null,
			gate: null,
			waiting: false,
			starting: false,
			loadingOlder: false,
			onLoadOlder: async () => true,
			containerRef,
			isSmallView: false,
			status: "live",
			failure: null,
			awaitingHydration: false,
			conversationId: "links-test",
			onReconnect: () => {},
		}),
	);
	/* The pane (which the placement clamps inside) and the row's own box. */
	const pane = frame.document.querySelector("[data-lo-canonical-transcript]");
	assert.ok(pane, "the transcript's scroller must be on screen");
	box(pane, PANE_BOX);
	for (const element of frame.document.querySelectorAll(
		'[data-record-id="a1"] *',
	)) {
		box(element, ROW_BOX);
	}
	return pane;
}

test("the strip re-measures when its subject changes inside one turn", async () => {
	/*
	 * Design D1, confirmed at the code level in round 1 and fixed with a measure
	 * key: `canonical-transcript.tsx` mounts `LinkToolkit` at a STABLE JSX position,
	 * so moving from one link to another inside one turn RE-RENDERS it rather than
	 * re-mounting it, and none of the events the hook listens for (scroll,
	 * selectionchange, resize, the two `ResizeObserver`s) fires. The old hook kept
	 * the first link's coordinates while the contents followed the second, so the
	 * strip floated over a link it was not about.
	 *
	 * The boxes are stubbed - jsdom has no layout - and that is what makes this the
	 * right instrument for this defect: the regression WAS an arithmetic one, and
	 * this asserts the arithmetic follows the subject. The pixels are the rig's
	 * business, and the rig asserts the same thing in a real browser
	 * (`docs/evidence/chat-canonical-links/hover-same-turn-second-link/`).
	 */
	await mountTranscript();
	const report = anchorFor(
		frame.document,
		"opoint_adverse_media_query_failures_2026-09-17.xlsx",
	);
	const shots = anchorFor(
		frame.document,
		"Screenshot 2026-09-17 at 10.14.02.png",
	);
	/*
	 * Two links on different lines, well apart, so a stale placement is unmissable:
	 * the row's own first line, then three lines down.
	 */
	lines(report, rect(200, 300, 400, 22));
	lines(shots, rect(180, 366, 300, 22));

	await frame.dispatch(report, "focusin");
	const first = placementOf(frame.document);
	assert.ok(first, "the strip must mount for a focused link");
	/*
	 * Row-relative coordinates, which is what the hook publishes: the anchor's own
	 * left edge minus the row's, so the strip travels with its row when the pane
	 * scrolls.
	 */
	assert.equal(first.left, 200 - ROW_BOX.left);

	await frame.dispatch(shots, "focusin");
	const second = placementOf(frame.document);
	assert.ok(second, "the strip must still be mounted for the new subject");
	assert.equal(
		second.left,
		180 - ROW_BOX.left,
		"the strip's own left edge must follow the new subject, not the old one",
	);
	assert.notDeepEqual(second, first);
	/* And the strip really is about the NEW link, so the two halves agree. */
	const strip = frame.document.querySelector("[data-lo-link-toolbar]");
	assert.match(strip.getAttribute("aria-label") ?? "", /Screenshot 2026-09-17/);
});

test("the transform keeps an href only when the classifier calls it a file", async () => {
	/*
	 * Round 2's code review MINOR 2, as an invariant rather than a list. The
	 * preservation rule and the classification rule have to be ONE rule: a `file:`
	 * shape the transform keeps alive but `classifyHref` calls `other` renders an
	 * anchor with a live `href` and `target="_blank"`, no `data-lo-*` attributes and
	 * no click handler - so it leaves through `setWindowOpenHandler` →
	 * `shell.openExternal` as a string the app never looked at. `/^file:/i` did
	 * exactly that for `file:/tmp/a.pdf`, `file:javascript:alert(1)` and
	 * `file:%2F%2Ftmp%2Fa.pdf`, all of which this branch had made LIVE while they
	 * were blanked before it.
	 *
	 * The corpus is asserted on the transform itself rather than through markdown,
	 * because a markdown destination cannot express a leading space or a control
	 * character and those are two of the shapes that have to stay blanked.
	 */
	const blanked = [
		"javascript:alert(1)",
		"JavaScript:alert(1)",
		"JAVASCRIPT:alert(1)",
		"data:text/plain,hello",
		"Data:text/plain,hello",
		"vbscript:msgbox(1)",
		"VBScript:msgbox(1)",
		"ftp://host/a.pdf",
		"FTP://host/a.pdf",
		"blob:https://example.com/9f2c1a",
		"about:blank",
		"About:Blank",
		/* Leading whitespace and control characters, which `^scheme:` anchors miss. */
		" javascript:alert(1)",
		"\tdata:text/plain,hello",
		"\u0001vbscript:msgbox(1)",
		"\u0000ftp://host/a.pdf",
		/* The `file:`-prefixed shapes the classifier does NOT classify. */
		"file:/tmp/a.pdf",
		"FILE:/tmp/a.pdf",
		"file:%2F%2Ftmp%2Fa.pdf",
		"file:javascript:alert(1)",
		" file:///tmp/a.pdf",
		/* A `file://` URL naming another host: `normalizeFileUrl` declines it. */
		"file://other-host/share",
		"file://tmp/a.pdf",
	];
	const kept = ["file:///tmp/a.pdf", "File:///tmp/a.pdf", "FILE:///tmp/a.pdf"];

	for (const url of blanked) {
		assert.equal(
			LINK_URL_TRANSFORM(url, "href"),
			"",
			`${JSON.stringify(url)} must be blanked`,
		);
	}
	for (const url of kept) {
		assert.equal(LINK_URL_TRANSFORM(url, "href"), url, `${url} must survive`);
		assert.equal(
			classifyHref(url)?.kind,
			"file",
			`${url} must be a file target`,
		);
	}
	/*
	 * The invariant, over the whole corpus at once: nothing `file:`-prefixed leaves
	 * this transform unless the classifier owns it. `mailto:` and `https:` are the
	 * library's own safe list and are deliberately not covered by it.
	 */
	for (const url of [
		...blanked,
		...kept,
		"https://example.com/a",
		"mailto:x@y",
	]) {
		const keptHref = LINK_URL_TRANSFORM(url, "href");
		if (keptHref !== "" && /^file:/i.test(keptHref)) {
			assert.equal(
				classifyHref(keptHref)?.kind,
				"file",
				`${JSON.stringify(url)} survives the transform unclassified`,
			);
		}
	}
	/* `src` is never preserved: this change is about links, not images. */
	assert.equal(LINK_URL_TRANSFORM("file:///tmp/a.png", "src"), "");
});

test("the corridor between a link and its toolbar keeps the subject; the prose does not", async () => {
	/*
	 * Round 2's BLOCKER (design D1), at the layer that decides it. The toolbar is
	 * placed 8px clear of the anchor's own box, and those 8px belong to the row's
	 * WRAPPER - `position: absolute` keeps the strip out of the turn's own box - so
	 * the element under a pointer crossing the gap is an ANCESTOR of the turn. Every
	 * containment test answers "not the turn" for it: `turn.contains(related)` is
	 * false and `closest("[data-lo-kind]")` is null, so the subject was cleared and
	 * the strip unmounted before the pointer could reach a button. A single teleport
	 * survived; `2 steps@16ms` did not.
	 *
	 * jsdom has no layout, so the boxes are stubbed - and the numbers here are the
	 * ones round 2 measured in a real browser (anchor `[174,377,806,394]`, strip
	 * `[174,339,272,369]`), which is what makes this a reading of the same geometry
	 * rather than an invented one. The pixels are the rig's
	 * (`docs/evidence/chat-canonical-links/hover-gap-crossing/`), and the rig drives
	 * the same gesture with real `Input.dispatchMouseEvent` samples.
	 */
	await mountTranscript();
	const anchor = anchorFor(
		frame.document,
		"opoint_adverse_media_query_failures_2026-09-17.xlsx",
	);
	box(anchor, rect(174, 377, 632, 17));
	const prose = anchor.closest("p");
	assert.ok(prose, "the link must live in a paragraph");

	await frame.dispatch(anchor, "focusin");
	const strip = frame.document.querySelector("[data-lo-link-toolbar]");
	assert.ok(strip, "the strip must mount for a focused link");
	box(strip, rect(174, 339, 98, 30));

	/* 1. The gap itself, which is the sample the old code lost it on. */
	await frame.dispatch(prose, "pointerover", { clientX: 200, clientY: 372 });
	assert.ok(
		frame.document.querySelector("[data-lo-link-toolbar]"),
		"a sample between the link and its toolbar must keep the subject",
	);
	/* 2. One pixel off the anchor's top edge, still over the paragraph. */
	await frame.dispatch(prose, "pointerover", { clientX: 200, clientY: 376 });
	assert.ok(
		frame.document.querySelector("[data-lo-link-toolbar]"),
		"a one-pixel stray off the link's own box must keep the subject",
	);
	/*
	 * 3. The prose, which is the direction that MUST still dismiss: a reader who has
	 * moved onto the words around the link has left the link, and the corridor is
	 * bounded by the clearance the toolbar is placed at. Both ways out of that band
	 * are sampled - BELOW the link's line and to the RIGHT of its last character -
	 * because either one clearing on its own would leave the other unproven. A sample
	 * one pixel off the anchor's box is inside the band (sample 2 above); one a line
	 * away, or one past the link's own right edge, is not.
	 */
	await frame.dispatch(prose, "pointerover", { clientX: 200, clientY: 420 });
	assert.equal(
		frame.document.querySelector("[data-lo-link-toolbar]"),
		null,
		"the strip must go when the pointer moves onto the prose below the link",
	);
	await frame.dispatch(anchor, "focusin");
	assert.ok(
		frame.document.querySelector("[data-lo-link-toolbar]"),
		"the strip must come back when the reader returns to the link",
	);
	await frame.dispatch(prose, "pointerover", { clientX: 900, clientY: 376 });
	assert.equal(
		frame.document.querySelector("[data-lo-link-toolbar]"),
		null,
		"and when the pointer moves onto the prose past the link's own right edge",
	);
});

test("the keyboard contract: Tab enters the FOCUSED link's toolbar, and Escape hands the reader back", async () => {
	/*
	 * UX round 1's U1 and U2, plus round 2's U8 (code review MINOR 1). The strip is
	 * rendered ONCE per turn, after the whole markdown body, so the DOM's own order
	 * cannot express "Tab enters the focused link's actions" - it walks link, link,
	 * link and lands in the LAST link's buttons, which is why the row intercepts the
	 * key. The reported defect was the MIXED state: the pointer out-ranks the
	 * keyboard, so a resting pointer re-subjects the strip, and the old code then
	 * consumed the reader's Tab and focused the strip's first button - the link
	 * under the POINTER's actions, not the focused link's.
	 */
	await mountTranscript();
	const report = anchorFor(
		frame.document,
		"opoint_adverse_media_query_failures_2026-09-17.xlsx",
	);
	const shots = anchorFor(
		frame.document,
		"Screenshot 2026-09-17 at 10.14.02.png",
	);
	lines(report, rect(200, 300, 400, 22));
	lines(shots, rect(180, 366, 300, 22));

	/* The reader is on the first link; the pointer rests on the second. */
	await frame.dispatch(report, "focusin");
	await frame.dispatch(shots, "pointerover", { clientX: 200, clientY: 372 });
	await new Promise((resolve) => setTimeout(resolve, 200));
	const pointed = frame.document.querySelector("[data-lo-link-toolbar]");
	assert.match(
		pointed.getAttribute("aria-label") ?? "",
		/Screenshot 2026-09-17/,
		"the pointer owns the strip while it rests (the dwell is 120ms)",
	);

	/* Tab, from the FOCUSED link. */
	const tab = await frame.dispatch(report, "keydown", {
		key: "Tab",
		bubbles: true,
		cancelable: true,
	});
	assert.equal(tab.defaultPrevented, true, "the row consumes the Tab");
	const after = frame.document.querySelector("[data-lo-link-toolbar]");
	assert.match(
		after.getAttribute("aria-label") ?? "",
		/opoint_adverse_media_query_failures/,
		"the strip must be re-subjected to the FOCUSED link, not the hovered one",
	);
	const focused = frame.document.activeElement;
	assert.equal(
		focused?.closest("[data-lo-link-toolbar]") !== null,
		true,
		"focus must be inside the toolbar",
	);
	assert.equal(
		focused?.getAttribute("aria-label"),
		"Copy path",
		"and on the FOCUSED link's own first action",
	);

	/* Escape, from inside the toolbar: the strip goes and focus returns to the link. */
	await frame.dispatch(focused, "keydown", {
		key: "Escape",
		bubbles: true,
		cancelable: true,
	});
	assert.equal(
		frame.document.querySelector("[data-lo-link-toolbar]"),
		null,
		"Escape must take the strip away",
	);
	assert.equal(
		frame.document.activeElement,
		report,
		"and hand focus back to the link the strip was about",
	);
	/*
	 * DRAIN THE TOOLTIP'S TIMERS BEFORE TEARDOWN, and it is not a luxury: this is
	 * the only test in the file that puts focus on a toolbar BUTTON, which arms the
	 * Radix tooltip that button carries. Radix schedules its open/close delays with
	 * `setTimeout`, the harness deliberately leaves node's `setTimeout` alone (see
	 * `mountDom`), and a callback that fires after teardown reads a global this file
	 * has already put back - measured as `ReferenceError: Element is not defined`,
	 * scored against the FILE rather than the test, so a green suite came back red.
	 * The frame's own rAF work is tracked and dropped by `restore`; only these
	 * delays need to be let through first, and they are bounded.
	 */
	await new Promise((resolve) => setTimeout(resolve, 450));
});

/* --------------------------------------------- where a press goes: canvas or OS */

/*
 * THE OPERATOR'S ASK, DRIVEN THROUGH THE SHIPPED ANCHOR AND THE SHIPPED TOOLBAR.
 *
 * "opening up files in local-operator-ui that are supported by canvas view (PDFs,
 * XLSX/csvs, text, markdown, etc) by default are opened in the canvas instead of
 * opened by the OS unless the user clicks to open with default application in the
 * hover popup (add this). Change open to 'Open in canvas' on the tooltip and then
 * another button for open in default application."
 *
 * Four things that sentence implies, and each is one of the tests below:
 *
 *   1. the press on the LINK goes to the canvas (not the OS);
 *   2. the toolbar offers BOTH presses, and the OS one still reaches the OS;
 *   3. a target the canvas cannot show - no viewer for the type, a path the probe
 *      already knows is gone - keeps exactly the press it had. This is the half a
 *      green frame cannot carry: a regression that routed every local path to the
 *      canvas would look NEW rather than wrong in a still, and the reader's `.zip`
 *      would open a tab saying nothing;
 *   4. with no pane provider at all - Storybook, the legacy message rows, the
 *      trace rows, the run panel's child reader - the press is the press of
 *      before. That is one assertion rather than a promise: the anchor is rendered
 *      by every markdown surface in this app and only one of them has a pane.
 *
 * The stores are real (bundled from source, not stubbed) because the claim is
 * about what a press WRITES: a stub would only assert that the wiring matches the
 * stub. Their keys are synthetic and cleared before each of these tests.
 */

const PANE = "links-test-pane";

const canvasStateFor = (conversationId) =>
	useCanvasStore.getState().conversations[conversationId];

/**
 * Empty the two stores a canvas press writes to.
 *
 * `canvas-store` persists to `localStorage` and `ui-preferences-store` owns the
 * right-hand slot, so a tab left behind by one test would be read as the next
 * test's own press - the failure that looks like a passing assertion about the
 * wrong press.
 */
function resetCanvasStores() {
	useCanvasStore.setState({ conversations: {} });
	useUiPreferencesStore.setState({ isCanvasOpen: false });
}

/**
 * Render one paragraph of markdown, inside a pane or not, with both bridges
 * recorded.
 *
 * `probeFiles` answers "it is there and it is a file" for everything, which is
 * the state a reader's own hover leaves behind; `readFile` echoes the path and the
 * encoding it was asked for, so a document's content is evidence about WHICH read
 * the press made rather than a constant.
 */
async function renderInPane(content, { pane = PANE, probeFiles } = {}) {
	stubApi(frame.window);
	/* A caller that needs its own answers (a gone file, a huge one) replaces the
	 * default stub rather than layering on it. */
	if (probeFiles) frame.window.api.probeFiles = probeFiles;
	const opened = [];
	frame.window.api.openFile = async (target) => {
		opened.push(target);
		return { ok: true, resolved: target };
	};
	const read = [];
	frame.window.api.readFile = async (target, encoding) => {
		read.push({ target, encoding });
		return { success: true, data: `${target}|${encoding}` };
	};
	resetCanvasStores();
	const anchor = () => frame.document.querySelector('a[data-lo-kind="file"]');
	const render = pane
		? React.createElement(
				CanvasPaneProvider,
				{ conversationId: pane },
				React.createElement(MarkdownRenderer, { content }),
			)
		: React.createElement(MarkdownRenderer, { content });
	await frame.render(render);
	return { opened, read, anchor: anchor() };
}

test("a press inside a pane opens the file in the CANVAS, and never asks the OS", async () => {
	const { opened, anchor } = await renderInPane(`Saved it to ${REPORT}.`);
	const press = await frame.dispatch(anchor, "click");
	assert.equal(
		press.defaultPrevented,
		true,
		"the default must still be cancelled",
	);
	/*
	 * The document is built behind an `await` (the text kinds are read before the
	 * tab is opened), so the promise chain has to drain before the store can be
	 * read - the flush is the ONLY thing the async `act` is for here.
	 */
	await act(async () => {});
	assert.deepEqual(
		opened,
		[],
		"the OS must not be asked for a file the canvas took",
	);
	const state = canvasStateFor(PANE);
	assert.ok(state, "the pane must have canvas state");
	assert.equal(
		state.selectedTabId,
		RESOLVED_REPORT,
		"the tab is the RESOLVED path's document, which is the identity the Files panel's tile for this file carries",
	);
	assert.equal(
		state.viewMode,
		"documents",
		"the pane must switch to the viewer",
	);
	assert.deepEqual(
		state.openTabs.map((tab) => tab.id),
		[RESOLVED_REPORT],
		"one file, one tab: the transcript's `~/` spelling and the panel's `/Users/...` spelling are the same document",
	);
	const document = state.files.at(-1);
	assert.equal(
		document.id,
		RESOLVED_REPORT,
		"the document's id is the probe's RESOLVED path, not the spelling the transcript wrote",
	);
	assert.equal(document.path, RESOLVED_REPORT);
	assert.equal(
		document.title,
		"opoint_adverse_media_query_failures_2026-09-17.xlsx",
		"the title is the basename the tab and the viewer chrome show",
	);
	/*
	 * The bytes are the ones THIS layer read, at the encoding the router chose for
	 * the kind: an `.xlsx` is a spreadsheet, so base64 - and a document that
	 * carried no content would be a viewer waiting on a read that never happens.
	 */
	/* The read is asked for the spelling the reader pressed; `read-file` resolves
	 * `~/` itself, so the bytes come back either way. */
	assert.equal(document.content, `${REPORT}|base64`);
	assert.equal(
		useUiPreferencesStore.getState().isCanvasOpen,
		true,
		"the right-hand slot must be claimed, or the tab opens into a canvas nobody sees",
	);
});

test("a press on a text file reads it as utf-8, and on a PDF does not read it at all", async () => {
	/*
	 * The router's own split, at the press rather than in the table: `utf-8` and
	 * `base64` are read here, and the kinds that read their own bytes (`bytes`,
	 * `range`) are handed over without them - a PDF's 40 MB must never become a
	 * string in a store persisted to `localStorage`.
	 */
	const text = await renderInPane("The log is at /tmp/x/run.log.");
	await frame.dispatch(text.anchor, "click");
	await act(async () => {});
	assert.deepEqual(
		text.read.map((entry) => entry.encoding),
		["utf-8"],
	);
	assert.equal(
		canvasStateFor(PANE).files.at(-1).content,
		"/tmp/x/run.log|utf-8",
	);

	const pdf = await renderInPane("The report is at /tmp/x/summary.pdf.");
	await frame.dispatch(pdf.anchor, "click");
	await act(async () => {});
	assert.deepEqual(pdf.read, [], "the viewer reads a PDF's bytes itself");
	assert.equal(canvasStateFor(PANE).files.at(-1).path, "/tmp/x/summary.pdf");
});

test("a press with NO pane is exactly the press of before: the OS", async () => {
	/*
	 * The degradation the context exists to give, asserted on the same path the
	 * canvas case uses: no provider, no canvas, and the OS hand-off untouched. Every
	 * surface that renders markdown without a chat pane depends on this, and so does
	 * the canvas's own viewer chrome (which renders its own markdown).
	 */
	const { opened, anchor } = await renderInPane(`Saved it to ${REPORT}.`, {
		pane: null,
	});
	await frame.dispatch(anchor, "click");
	await act(async () => {});
	assert.deepEqual(opened, [REPORT], "the OS is what opens it there");
	assert.equal(
		canvasStateFor(PANE),
		undefined,
		"and nothing may be opened into a canvas this surface does not have",
	);
	assert.equal(useUiPreferencesStore.getState().isCanvasOpen, false);
});

test("a type with no canvas viewer keeps the OS hand-off even inside a pane", async () => {
	/*
	 * `viewerFor`'s `null` is the documented "hand it to the OS", and this is the
	 * assertion that the new default did not swallow it: a `.zip` is a local path
	 * with no viewer, so the press must be the press it always was.
	 */
	const { opened, anchor } = await renderInPane(
		"The bundle is /tmp/x/bundle.zip.",
	);
	await frame.dispatch(anchor, "click");
	await act(async () => {});
	assert.deepEqual(opened, ["/tmp/x/bundle.zip"]);
	assert.equal(canvasStateFor(PANE), undefined);
});

test("a path the probe already knows is GONE gets no canvas tab", async () => {
	/*
	 * The one case where a canvas open would be a LIE rather than a downgrade: the
	 * toolbar already asked, the answer was "not there", and a tab would open onto a
	 * viewer saying nothing. The cached answer is read (no new round trip on the
	 * press), the canvas is skipped, and the reader keeps the OS attempt and its own
	 * sentence - which is what the missing-file matrix offers beside it.
	 */
	resetProbeCache();
	await probeTarget(GONE, async () => [
		{ input: GONE, resolved: GONE, exists: false, isFile: false },
	]);
	const { opened, anchor } = await renderInPane(`The report is at ${GONE}.`);
	await frame.dispatch(anchor, "click");
	await act(async () => {});
	assert.deepEqual(opened, [GONE], "the OS attempt, as before this change");
	assert.equal(canvasStateFor(PANE), undefined, "and no dead tab");
	resetProbeCache();
});

test("a press with nothing cached ASKS, and refuses a path the probe says is gone", async () => {
	/*
	 * Review round 1, Q1. The hover normally warms the probe cache, and the kinds
	 * that read their own bytes (`bytes`, `range`) read nothing at the press - so
	 * without a press-time question a PDF that vanished between the reveal and the
	 * press opened a tab onto nothing, where a text file correctly refused and
	 * handed the path to the OS.
	 *
	 * Nothing is cached here on purpose (`resetProbeCache`), which is also the
	 * keyboard/touch shape: a press can arrive on a link that was never hovered.
	 */
	resetProbeCache();
	const pdf = "/tmp/x/vanishing.pdf";
	const asked = [];
	const { opened, anchor } = await renderInPane(`The report is at ${pdf}.`, {
		probeFiles: async (paths) => {
			asked.push(...paths);
			return paths.map((input) => ({
				input,
				resolved: input,
				exists: false,
				isFile: false,
				sizeBytes: null,
				mtimeMs: null,
			}));
		},
	});
	await frame.dispatch(anchor, "click");
	await act(async () => {});
	assert.ok(
		asked.includes(pdf),
		"the press must ask about the path it is about to open, not trust a hover that may not have happened",
	);
	assert.equal(
		canvasStateFor(PANE),
		undefined,
		"a path the probe says is gone gets no tab, for a file kind that would never have read it",
	);
	assert.deepEqual(
		opened,
		[pdf],
		"and the OS attempt and its sentence are what is left",
	);
});

test("a file above the read ceiling is REFUSED: nothing read, nothing written", async () => {
	/*
	 * Review round 2's blocker, and the first version of this case is why it was
	 * missed: that one asserted the document's SHAPE (no bytes, `sizeBytes` carried)
	 * and so was satisfied by the very state that took the app down. A document
	 * without bytes is not a viewer waiting for a read - the three kinds this cap
	 * covers render `document.content` - and for a spreadsheet the sheet viewer
	 * throws `Workbook is empty` the moment the reader leaves the tab, which the
	 * ErrorBoundary turns into a dead window.
	 *
	 * So the assertion here is the whole contract in one place: the press refuses,
	 * the file is never read, and the store is exactly as it was - the tab that
	 * would have been the empty one does not exist.
	 */
	resetProbeCache();
	const huge = "/tmp/x/enormous.csv";
	const { read, opened, anchor } = await renderInPane(
		`The export is ${huge}.`,
		{
			probeFiles: async (paths) =>
				paths.map((input) => ({
					input,
					resolved: input,
					exists: true,
					isFile: true,
					sizeBytes: 8 * 1024 * 1024,
					mtimeMs: 1_760_000_000_000,
				})),
		},
	);
	await frame.dispatch(anchor, "click");
	await act(async () => {});
	assert.deepEqual(
		read,
		[],
		"nothing above the ceiling is read into the persisted store",
	);
	assert.equal(
		canvasStateFor(PANE),
		undefined,
		"and no document is written, so no viewer can be handed an empty one",
	);
	assert.deepEqual(
		opened,
		[huge],
		"the OS hand-off and its sentence are what a refusal leaves the reader",
	);
	assert.equal(useUiPreferencesStore.getState().isCanvasOpen, false);
});

test("above the read ceiling the strip loses the canvas and says why", async () => {
	/*
	 * Round 3, U8a, at the toolbar rather than at the matrix: the same mounted
	 * transcript, the same file, one difference - the probe answers 9 MB. The strip
	 * must not offer a destination the press refuses (UX measured exactly that: a
	 * button reading `Open in canvas` handing the file to the OS), so the canvas
	 * action is gone and the note explains the absence, because a reader who has
	 * learned that a `.xlsx` opens in the canvas reads a missing button as a bug.
	 */
	resetProbeCache();
	resetCanvasStores();
	await mountTranscript({ sizeBytes: 9_411_130 });
	const report = anchorFor(
		frame.document,
		"opoint_adverse_media_query_failures_2026-09-17.xlsx",
	);
	await frame.dispatch(report, "focusin");
	/* The reveal's probe is a promise; the strip's own answer lands one turn later. */
	await act(async () => {});
	const strip = frame.document.querySelector("[data-lo-link-toolbar]");
	const labels = [...strip.querySelectorAll("button")].map((button) =>
		button.getAttribute("aria-label"),
	);
	assert.deepEqual(
		labels,
		["Copy path", "Open", "Open folder", "Quote"],
		"the canvas action must be gone when the press would refuse it",
	);
	assert.match(
		strip.textContent,
		/Too large for the canvas preview/,
		"and the note must say why the canvas is absent",
	);
});

test("an already-open document is SELECTED, not refused, above the ceiling too", async () => {
	/*
	 * Round 3, U8b. The Files panel's own click reads uncapped, so a 9 MB
	 * spreadsheet can already be open in this pane when its link is pressed. The
	 * ceiling is about what this press can BUILD, so a document that is already
	 * built must win: the old order refused it and sent the reader to the OS to open
	 * the file they were looking at. The panel's tile op runs after the mount here
	 * because the mount clears the stores - which is also the incidental proof that
	 * the press reads the store at press time rather than trusting anything it saw
	 * when it rendered.
	 */
	resetProbeCache();
	const { read, opened, anchor } = await renderInPane(
		`The export is ${REPORT}.`,
		{
			probeFiles: async (paths) =>
				paths.map((input) => ({
					input,
					resolved: resolveUserPath(input),
					exists: true,
					isFile: true,
					sizeBytes: 9_411_130,
					mtimeMs: 1_760_000_000_000,
				})),
		},
	);
	useCanvasStore.getState().addFileAndSelect(PANE, {
		id: RESOLVED_REPORT,
		path: RESOLVED_REPORT,
		title: "opoint_adverse_media_query_failures_2026-09-17.xlsx",
		type: "spreadsheet",
		content: "the-panels-own-read",
	});
	useCanvasStore.getState().setSelectedTab(PANE, null);
	await frame.dispatch(anchor, "click");
	await act(async () => {});
	const state = canvasStateFor(PANE);
	assert.equal(
		state.selectedTabId,
		RESOLVED_REPORT,
		"the open document is selected rather than refused",
	);
	assert.deepEqual(
		opened,
		[],
		"and the OS is not asked to open what is on screen",
	);
	assert.deepEqual(
		read,
		[],
		"and nothing is re-read: the store's own document is kept",
	);
	assert.equal(state.files.length, 1, "one document, not two");
	assert.equal(
		state.files[0].content,
		"the-panels-own-read",
		"and the bytes the panel read survive the press",
	);
	assert.equal(useUiPreferencesStore.getState().isCanvasOpen, true);
});

test("a file deleted AFTER the hover is refused too: the press asks for itself", async () => {
	/*
	 * Review round 2, QA R2-2. Round 1's fix asked only when nothing was cached, so
	 * this exact repro - hover (which caches `exists: true`), delete the file, press -
	 * still opened a dead tab for the kinds that read nothing here, with no OS
	 * hand-off and no sentence. A cached positive is a fact about a moment that has
	 * passed, so the press asks the bridge itself and treats the cache as a fallback.
	 */
	resetProbeCache();
	const pdf = "/tmp/x/vanishing.pdf";
	/* The hover: a cached positive, which is the state that used to be trusted. */
	await probeTarget(pdf, async () => [
		{
			input: pdf,
			resolved: pdf,
			exists: true,
			isFile: true,
			sizeBytes: 13_904,
			mtimeMs: 1_760_000_000_000,
		},
	]);
	assert.ok(
		probeStateFor(pdf),
		"precondition: the hover left a positive behind",
	);
	const { opened, anchor } = await renderInPane(`The report is at ${pdf}.`, {
		probeFiles: async (paths) =>
			paths.map((input) => ({
				input,
				resolved: input,
				exists: false,
				isFile: false,
				sizeBytes: null,
				mtimeMs: null,
			})),
	});
	await frame.dispatch(anchor, "click");
	await act(async () => {});
	assert.equal(
		canvasStateFor(PANE),
		undefined,
		"a stale positive must not become a dead tab",
	);
	assert.deepEqual(
		opened,
		[pdf],
		"the OS attempt and its sentence are what is left",
	);
	assert.equal(
		probeStateFor(pdf),
		undefined,
		"and the stale entry is dropped, so the next reveal asks again (forgetProbe)",
	);
});

test("a second press on an open document does not read it again", async () => {
	/*
	 * Review round 1, n2. `addFileAndSelect` keeps the entry it already has, so a
	 * re-read would be bytes nobody looks at - and the read is the expensive half
	 * of the press.
	 */
	resetProbeCache();
	const { read, anchor } = await renderInPane(`Saved it to ${REPORT}.`);
	await frame.dispatch(anchor, "click");
	await act(async () => {});
	await frame.dispatch(anchor, "click");
	await act(async () => {});
	assert.equal(
		read.length,
		1,
		"the file is read once, however many presses it takes to open it",
	);
	assert.deepEqual(
		canvasStateFor(PANE).openTabs.map((tab) => tab.id),
		[RESOLVED_REPORT],
	);
});

test("a URL's browser press wears the browser mark, never the canvas one", async () => {
	/*
	 * Design round 2, D3. M2's guard is this delta's only user-visible behaviour
	 * change and nothing covered it: `viewerFor` routes by the last path segment, so
	 * a URL ending in `.pdf` has a viewer and, before the guard, the strip's `Open in
	 * browser` button wore `PanelRightOpen` - a mark disagreeing with the label beside
	 * it. No committed frame can show it (the fixture's URL carries no extension), so
	 * the assertion lives here and the set README's limits say as much.
	 *
	 * Both directions are asserted, because "the URL is not the canvas" is only
	 * meaningful beside "the file is": one mount, two subjects, two marks.
	 */
	resetProbeCache();
	const urlWithViewer = "https://example.com/reports/paper.pdf";
	await mountTranscript({
		transcript: {
			records: [
				record("u1", "user", "Where did the run put everything?"),
				record(
					"a1",
					"assistant",
					`The upstream page is ${urlWithViewer} and the file is ${REPORT}.`,
				),
			],
			index: new Map([
				["u1", 0],
				["a1", 1],
			]),
		},
	});
	const markOf = (label) => {
		const button = frame.document.querySelector(
			`[data-lo-link-toolbar] button[aria-label="${label}"]`,
		);
		assert.ok(button, `the strip must offer ${label}`);
		return button.querySelector("svg")?.getAttribute("class") ?? "";
	};
	/* The strip is raised per subject, so the two subjects are read in turn. */
	const urlAnchor = frame.document.querySelector('a[data-lo-kind="url"]');
	assert.ok(urlAnchor, "the URL must render as a URL anchor");
	await frame.dispatch(urlAnchor, "focusin");
	assert.match(
		markOf("Open in browser"),
		/external-link/,
		"the browser press wears the browser mark",
	);
	assert.doesNotMatch(
		markOf("Open in browser"),
		/panel-right-open/,
		"and never the canvas mark, though this URL's last segment has a viewer",
	);
	await frame.dispatch(
		anchorFor(
			frame.document,
			"opoint_adverse_media_query_failures_2026-09-17.xlsx",
		),
		"focusin",
	);
	assert.match(
		markOf("Open in canvas"),
		/panel-right-open/,
		"while the file's own canvas press wears the canvas mark",
	);
});

test("the strip offers both opens, and each press does its own thing", async () => {
	/*
	 * The operator's second half: the toolbar's `Open` becomes `Open in canvas` and
	 * a second button opens the OS's application. Driven through the SHIPPED toolbar
	 * buttons - the labels are the accessible names the reader's tooltip shows, so
	 * this asserts the copy as well as the wiring - and each press is read back off
	 * the store and the bridge it reaches.
	 */
	const opened = [];
	stubApi(frame.window);
	frame.window.api.openFile = async (target) => {
		opened.push(target);
		return { ok: true, resolved: target };
	};
	frame.window.api.readFile = async (target, encoding) => ({
		success: true,
		data: `${target}|${encoding}`,
	});
	resetCanvasStores();
	await mountTranscript();
	const report = anchorFor(
		frame.document,
		"opoint_adverse_media_query_failures_2026-09-17.xlsx",
	);
	await frame.dispatch(report, "focusin");
	const labels = [
		...frame.document.querySelectorAll("[data-lo-link-toolbar] button"),
	].map((button) => button.getAttribute("aria-label"));
	assert.deepEqual(labels, [
		"Copy path",
		"Open in canvas",
		"Open in default app",
		"Open folder",
		"Quote",
	]);
	const button = (label) =>
		frame.document.querySelector(
			`[data-lo-link-toolbar] button[aria-label="${label}"]`,
		);
	await frame.dispatch(button("Open in canvas"), "click");
	await act(async () => {});
	assert.deepEqual(
		opened,
		[],
		"Open in canvas must not reach the OS's application",
	);
	assert.equal(canvasStateFor("links-test").selectedTabId, RESOLVED_REPORT);
	/* And the OS press still does, from the same strip, on the same path. */
	await frame.dispatch(button("Open in default app"), "click");
	await act(async () => {});
	assert.deepEqual(opened, [REPORT]);
	/*
	 * The Radix tooltip delays this test arms, drained before teardown for the
	 * reason the keyboard test above documents in full: a delay that fires after
	 * `restore` reads a global that is gone, and node scores it against the FILE.
	 */
	await new Promise((resolve) => setTimeout(resolve, 450));
});
