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
 *      turn, and Escape and Tab address the subject the reader is on (design D1,
 *      UX U1 and U2).
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
			export { MarkdownRenderer } from "./src/renderer/src/features/chat/components/markdown-renderer";
			export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";
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
const { MarkdownRenderer, CanonicalTranscript } = await import(
	pathToFileURL(bundlePath).href
);

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
			const EventCtor =
				type === "keydown"
					? window.KeyboardEvent
					: type === "click" ||
							type.startsWith("mouse") ||
							type === "pointerdown"
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

const REPORT =
	"~/workspace/opoint-renewal-2026-09-17/opoint_adverse_media_query_failures_2026-09-17.xlsx";
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
function stubApi(window, { exists = true } = {}) {
	window.api = {
		...window.api,
		probeFiles: async (paths) =>
			paths.map((input) => ({
				input,
				resolved: input,
				exists: exists && !input.startsWith(MISSING_MARKER),
				isFile: true,
				sizeBytes: 37_000,
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
	stubApi(frame.window, options);
	/*
	 * The layout stubs go in BEFORE the mount: the toolbar's buttons carry Radix
	 * tooltips, which position themselves on mount, and a zero-sized reference
	 * makes that work retry - seconds of churn per mount in jsdom otherwise.
	 */
	stubLayout(frame.window);
	const containerRef = React.createRef();
	await frame.render(
		React.createElement(CanonicalTranscript, {
			transcript: TRANSCRIPT,
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
