import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE SEARCH OVERLAY, THE REVEAL SEAM, AND THE CHORD — driven through the
 * shipped components.
 *
 * Three subjects, one file, because they are one surface: the panel is what
 * the reader sees, the reveal is what a hit does, and the chord is who opens
 * it. A static render would prove none of the three — every claim here is an
 * effect of a real event dispatch (a key, a click, a timer), and the reveal's
 * staged walk only exists across frames.
 *
 * The ported layout is jsdom's, so this file cannot see the panel's position
 * or how the list scrolls under 100 rows — those are the driver scenes' and
 * the evidence frames' subject. What it can see, and what it pins, is that
 * every state renders its own sentence and control, that the keyboard moves a
 * cursor the ARIA contract names, that a click lands the reveal walk on the
 * right row, and that the chord answers in the transcript and nowhere else.
 */

const bundle = await build({
	stdin: {
		contents: `
			export { ThreadSearchPanel, ThreadSearchOverlay } from "./src/renderer/src/features/chat/canonical/thread-search-overlay";
			export { THREAD_SEARCH_LANDED_MS, THREAD_SEARCH_LANDED_ATTR, revealThreadSearchHit, clearThreadSearchLanding } from "./src/renderer/src/features/chat/canonical/thread-search-reveal";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	// The renderer's aliases are tsconfig paths, not node resolutions; and the
	// dependency entries are resolved ESM-first, or a CJS package that
	// `require`s react (lucide-react) becomes an unbundleable dynamic require
	// with react held external.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	mainFields: ["module", "main"],
	conditions: ["import"],
	external: ["react", "react-dom", "react/jsx-runtime"],
	write: false,
	plugins: [
		{
			name: "find-transport-fixture",
			setup(builder) {
				// Only the network is faked, as `use-thread-search.test.mjs` does.
				builder.onResolve({ filter: /desktop-api$/ }, () => ({
					path: "transport",
					namespace: "find-fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "find-fixture" }, () => ({
					contents:
						"export const desktopResult = (request) => globalThis.__findRequest(request);",
					loader: "js",
				}));
			},
		},
	],
});
// Written beside this file rather than imported as a data: URL, for the same
// reason `checkpoint-rail.test.mjs` gives: react stays external, and a data:
// URL has no base path from which to resolve it.
const bundlePath = new URL(
	"./_thread-search-overlay.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
/*
 * A bootstrap DOM installed BEFORE the import, and the placement is
 * load-bearing rather than tidy: module-level environment probes in the
 * dependency graph (`canUseDOM`-style constants, evaluated once at import
 * time) capture a browserless answer for the whole process when the bundle is
 * imported with no `window`/`document` — measured while debugging
 * `checkpoint-rail.test.mjs`: the popover mounted, `open` was true, and Radix
 * portalled NOTHING, silently. With the globals installed first, the same code
 * renders.
 */
const bootstrap = new JSDOM("<!doctype html><div></div>", {
	url: "http://localhost/",
});
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
const {
	ThreadSearchPanel,
	ThreadSearchOverlay,
	THREAD_SEARCH_LANDED_MS,
	THREAD_SEARCH_LANDED_ATTR,
	revealThreadSearchHit,
	clearThreadSearchLanding,
} = await import(bundlePath.href);
await unlink(bundlePath);
const { createRoot } = await import("react-dom/client");

const SESSION = "abcdef123456";

const hit = (id, over = {}) => ({
	id,
	role: "user",
	ts: 1780000000,
	snippet: `a note about ${id}`,
	ranges: [],
	tier: "exact",
	...over,
});

/**
 * A DOM for one case, with the shims the shipped components reach for and
 * jsdom does not implement — the same rule `chat-image-expand.test.mjs`
 * states: only the ones actually touched, so a component that starts needing
 * another fails loudly here rather than silently no-oping.
 */
function installDom(html, { pretendToBeVisual = true } = {}) {
	const dom = new JSDOM(`<!doctype html><body>${html}</body>`, {
		url: "http://localhost/",
		pretendToBeVisual,
	});
	const { window } = dom;
	const scrolls = [];
	window.Element.prototype.scrollIntoView = function scrollIntoView(options) {
		scrolls.push({ element: this, options });
	};
	const originals = new Map();
	/*
	 * `CSS.escape`, which nothing in this environment provides: jsdom 26 ships no
	 * `CSS` object at all, and `revealThreadSearchHit` reaches for the global BARE
	 * — without this the reveal throws `ReferenceError: CSS is not defined`, and
	 * an error thrown inside a rAF callback is swallowed by jsdom, which is how
	 * `run-panel-navigation.test.mjs` records an entire suite staying green while
	 * the assertion it was about had never once run (R1-1, Q1). Copied from that
	 * file rather than special-cased: the selector is built from an arbitrary
	 * record id, and a leading digit or a colon must still match the row it names.
	 */
	const escapeCssIdent = (value) => {
		const string = String(value);
		let result = "";
		for (let index = 0; index < string.length; index += 1) {
			const code = string.charCodeAt(index);
			if (code === 0x00) {
				result += "\uFFFD";
				continue;
			}
			if (
				(code >= 0x01 && code <= 0x1f) ||
				code === 0x7f ||
				(index === 0 && code >= 0x30 && code <= 0x39) ||
				(index === 1 &&
					code >= 0x30 &&
					code <= 0x39 &&
					string.charCodeAt(0) === 0x2d)
			) {
				result += `\\${code.toString(16)} `;
				continue;
			}
			if (
				(index === 0 && code === 0x2d && string.length === 1) ||
				code >= 0x80 ||
				code === 0x2d ||
				code === 0x5f ||
				(code >= 0x30 && code <= 0x39) ||
				(code >= 0x41 && code <= 0x5a) ||
				(code >= 0x61 && code <= 0x7a)
			) {
				result += string.charAt(index);
				continue;
			}
			result += `\\${string.charAt(index)}`;
		}
		return result;
	};

	const shims = {
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		HTMLInputElement: window.HTMLInputElement,
		HTMLButtonElement: window.HTMLButtonElement,
		Element: window.Element,
		Node: window.Node,
		Event: window.Event,
		MouseEvent: window.MouseEvent,
		KeyboardEvent: window.KeyboardEvent,
		requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
		cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
		CSS: { escape: escapeCssIdent },
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
	return {
		window,
		document: window.document,
		scrolls,
		async close() {
			for (const [name, descriptor] of originals) {
				if (descriptor) Object.defineProperty(globalThis, name, descriptor);
				else Reflect.deleteProperty(globalThis, name);
			}
			dom.window.close();
		},
	};
}

/** Set an input's value the way a keystroke would, through React's tracker. */
function typeInto(window, input, value) {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	).set;
	setter.call(input, value);
	input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

/** Dispatch a key on an element, exactly as a focused reader would. */
function press(window, element, key, over = {}) {
	element.dispatchEvent(
		new window.KeyboardEvent("keydown", {
			key,
			bubbles: true,
			cancelable: true,
			...over,
		}),
	);
}

/**
 * The same, wrapped in `act`, for the controller's own DOM: the chord's
 * listener is a DOCUMENT listener, so its `setOpen` is scheduled by the
 * dispatch itself and a call outside `act` is the update React warns about
 * (measured: three of them across the two controller cases).
 */
async function pressAct(window, element, key, over = {}) {
	await act(async () => {
		press(window, element, key, over);
	});
}

/* --------------------------------------------------------------- the panel */

async function mountPanel(initial) {
	const env = installDom("<!doctype html><div id='root'></div>");
	const { window } = env;
	Object.defineProperty(window.navigator, "platform", {
		configurable: true,
		value: "MacIntel",
	});
	const root = createRoot(window.document.getElementById("root"));
	const calls = { moves: [], navigations: [], retries: 0, closes: 0 };
	const render = async (props) => {
		await act(async () => {
			root.render(
				React.createElement(ThreadSearchPanel, {
					query: "",
					onQueryChange: () => {},
					state: "idle",
					hits: [],
					cursor: -1,
					truncated: false,
					partial: false,
					onMoveCursor: (delta) => calls.moves.push(delta),
					onNavigate: (entry) => calls.navigations.push(entry.id),
					onRetry: () => {
						calls.retries += 1;
					},
					onClose: () => {
						calls.closes += 1;
					},
					isMac: true,
					...props,
				}),
			);
		});
		await act(async () => {});
	};
	const api = {
		window,
		document: window.document,
		calls,
		render,
		async close() {
			await act(async () => {
				root.unmount();
			});
			await env.close();
		},
		panel: () => window.document.querySelector("[data-lo-thread-search]"),
		input: () => window.document.querySelector("input"),
		options: () => [...window.document.querySelectorAll("[role='option']")],
		async type(text) {
			await act(async () => {
				typeInto(window, api.input(), text);
			});
		},
		async press(key, over) {
			await act(async () => {
				press(window, api.input(), key, over);
			});
		},
	};
	await render(initial);
	return api;
}

test("the results state renders the box, the marked snippets, and the ARIA cursor contract", async () => {
	const panel = await mountPanel({
		query: "ledger",
		state: "ready",
		hits: [
			hit("m1", { snippet: "the ledger was rebuilt", ranges: [[4, 10]] }),
			hit("m2", { role: "agent", snippet: "the ledger is fine", tier: "soft" }),
		],
		cursor: 0,
	});
	try {
		assert.equal(panel.input().placeholder, "Search this conversation");
		assert.equal(panel.input().value, "ledger");
		assert.equal(panel.input().getAttribute("role"), "combobox");
		assert.equal(panel.input().getAttribute("aria-expanded"), "true");

		const options = panel.options();
		assert.equal(options.length, 2);
		assert.equal(
			window.document
				.querySelector("[role='listbox']")
				.getAttribute("aria-label"),
			"Search results",
		);
		/* The cursor is announced from the input, not by moving focus. */
		assert.equal(
			panel.input().getAttribute("aria-activedescendant"),
			options[0].id,
			"the active option is the input's activedescendant",
		);
		assert.equal(options[0].getAttribute("aria-selected"), "true");
		assert.equal(options[1].getAttribute("aria-selected"), "false");

		const marks = [...options[0].querySelectorAll("mark")];
		assert.deepEqual(
			marks.map((mark) => mark.textContent),
			["ledger"],
		);
		assert.equal(
			options[0].textContent.includes("the ledger was rebuilt"),
			true,
		);
		assert.equal(
			options[0].textContent.includes("ledger was"),
			true,
			"the marked run is part of the snippet's own text",
		);
		assert.equal(
			options[1].textContent.includes("related"),
			true,
			"a soft hit says why it is here",
		);
		assert.equal(
			options[0].textContent.includes("related"),
			false,
			"an exact hit carries no tier mark",
		);
	} finally {
		await panel.close();
	}
});

test("the keyboard moves the cursor, opens the active row, closes, and re-checks when nothing is openable", async () => {
	const panel = await mountPanel({
		query: "ledger",
		state: "ready",
		hits: [hit("m1")],
		cursor: 0,
	});
	try {
		await panel.press("ArrowDown");
		await panel.press("ArrowUp");
		assert.deepEqual(panel.calls.moves, [1, -1]);

		await panel.press("Enter");
		assert.deepEqual(panel.calls.navigations, ["m1"]);

		await panel.press("Escape");
		assert.equal(panel.calls.closes, 1);

		/* With nothing to open and an index still building, Enter re-asks. */
		await panel.render({
			query: "ledger",
			state: "building",
			hits: [],
			cursor: -1,
		});
		await panel.press("Enter");
		assert.equal(panel.calls.retries, 1);
	} finally {
		await panel.close();
	}
});

test("a click lands on the row it hit", async () => {
	const panel = await mountPanel({
		query: "ledger",
		state: "ready",
		hits: [hit("m1"), hit("m2")],
		cursor: 0,
	});
	try {
		await act(async () => {
			panel
				.options()[1]
				.dispatchEvent(new panel.window.MouseEvent("click", { bubbles: true }));
		});
		assert.deepEqual(panel.calls.navigations, ["m2"]);
	} finally {
		await panel.close();
	}
});

test("every state renders its own sentence, and the recoverable ones their own control", async () => {
	const panel = await mountPanel({ state: "idle" });
	try {
		await panel.render({ query: "ledger", state: "loading", hits: [] });
		assert.match(panel.panel().textContent, /Searching/);
		assert.equal(
			panel.panel().textContent.includes("Try again"),
			false,
			"loading is not a failure",
		);

		await panel.render({ query: "ledger", state: "ready", hits: [] });
		assert.match(panel.panel().textContent, /No messages match this search\./);

		await panel.render({ query: "ledger", state: "building", hits: [] });
		assert.match(
			panel.panel().textContent,
			/Still indexing this conversation\./,
		);
		assert.match(
			panel.panel().textContent,
			/Results appear as the index catches up\./,
		);
		assert.match(panel.panel().textContent, /Check again/);

		await panel.render({
			query: "ledger",
			state: "building",
			hits: [hit("m1")],
			cursor: 0,
			partial: true,
		});
		assert.match(
			panel.panel().textContent,
			/Newer messages may be missing while the index catches up\./,
		);
		assert.equal(
			panel.options().length,
			1,
			"a partial answer's hits still paint",
		);

		await panel.render({ query: "ledger", state: "unsupported" });
		assert.match(panel.panel().textContent, /lives on another device/);
		assert.equal(panel.panel().textContent.includes("Try again"), false);

		await panel.render({ query: "ledger", state: "error" });
		assert.match(panel.panel().textContent, /could not be searched/);
		assert.match(panel.panel().textContent, /Try again/);
		await panel.press("Enter");
		assert.equal(panel.calls.retries, 1, "the error's own control asks again");
	} finally {
		await panel.close();
	}
});

test("a truncated list says so, and only a truncated, non-empty one does", async () => {
	const panel = await mountPanel({
		query: "ledger",
		state: "ready",
		hits: [hit("m1"), hit("m2")],
		cursor: 0,
		truncated: true,
	});
	try {
		assert.match(panel.panel().textContent, /Showing the first 2 matches\./);
		await panel.render({
			query: "ledger",
			state: "ready",
			hits: [hit("m1")],
			cursor: 0,
			truncated: false,
		});
		assert.equal(
			panel.panel().textContent.includes("Showing the first"),
			false,
		);
	} finally {
		await panel.close();
	}
});

/* -------------------------------------------------------------- the reveal */

/** One frame of the fixture's own clock, for the walk's staged frames. */
const nextFrame = () =>
	new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** The frames `jumpToFailedRow` itself waits: two layers is two rAFs. */
const walkFrames = async () => {
	for (let frame = 0; frame < 3; frame += 1) await nextFrame();
};

test("a mounted row is marked at once and scrolled to the centre by the shared walk, and the mark moves and times out", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const env = installDom(
		"<div id='scroller'><div data-record-id='m1'>one</div><div data-record-id='m2'>two</div></div>",
	);
	try {
		const scroller = env.document.getElementById("scroller");
		const first = env.document.querySelector("[data-record-id='m1']");
		const second = env.document.querySelector("[data-record-id='m2']");
		assert.equal(await revealThreadSearchHit(scroller, "m1"), "revealed");
		assert.equal(
			first.hasAttribute(THREAD_SEARCH_LANDED_ATTR),
			true,
			"a row already in the DOM is marked without waiting for the walk",
		);

		/* The SCROLL is the shared walk's: `jumpToFailedRow` centres the row two
		   of its own frames later, after the two layers it may have to open. */
		await walkFrames();
		assert.deepEqual(env.scrolls.at(-1).options, {
			block: "center",
			behavior: "smooth",
		});
		assert.equal(env.scrolls.at(-1).element, first);

		/* The mark MOVES rather than stacking: the old row loses it. */
		assert.equal(await revealThreadSearchHit(scroller, "m2"), "revealed");
		assert.equal(first.hasAttribute(THREAD_SEARCH_LANDED_ATTR), false);
		assert.equal(second.hasAttribute(THREAD_SEARCH_LANDED_ATTR), true);
		await walkFrames();
		assert.equal(env.scrolls.at(-1).element, second);

		/* And the timer, not only the next jump, takes it away. */
		t.mock.timers.tick(THREAD_SEARCH_LANDED_MS);
		assert.equal(second.hasAttribute(THREAD_SEARCH_LANDED_ATTR), false);

		/* The overlay's own close clears it eagerly. */
		await revealThreadSearchHit(scroller, "m1");
		assert.equal(first.hasAttribute(THREAD_SEARCH_LANDED_ATTR), true);
		clearThreadSearchLanding();
		assert.equal(first.hasAttribute(THREAD_SEARCH_LANDED_ATTR), false);
	} finally {
		await env.close();
	}
});

test("a collapsed turn is opened once, then the row is found; a bar that is not collapsed is left alone", async () => {
	const env = installDom("<div id='scroller'></div>");
	try {
		const scroller = env.document.getElementById("scroller");
		const bar = env.document.createElement("div");
		bar.setAttribute("data-run-ids", "m1 m2 m3");
		bar.setAttribute("data-record-id", "m1");
		bar.setAttribute("data-turn-summary", "");
		const trigger = env.document.createElement("button");
		trigger.setAttribute("aria-expanded", "false");
		bar.appendChild(trigger);
		scroller.appendChild(bar);
		let clicks = 0;
		trigger.addEventListener("click", () => {
			clicks += 1;
			/* The layer opens through React state in the app; here the handler
			   stands in for the commit that mounts the rows. */
			trigger.setAttribute("aria-expanded", "true");
			const row = env.document.createElement("div");
			row.setAttribute("data-record-id", "m1");
			row.textContent = "the row";
			scroller.appendChild(row);
		});

		assert.equal(
			await revealThreadSearchHit(scroller, "m1"),
			"revealed",
			"the shared walk opens the bar; this fixture's click mounts the row synchronously, as a discrete event's state update commits",
		);
		assert.equal(clicks, 1, "the bar is opened exactly once");

		/* A second reveal finds the row directly: no second press. */
		assert.equal(await revealThreadSearchHit(scroller, "m1"), "revealed");
		assert.equal(clicks, 1);
	} finally {
		await env.close();
	}
});

test("a message outside the rendered window reports not-mounted without a click", async () => {
	const env = installDom(
		"<div id='scroller'><div data-run-ids='m1 m2'><button aria-expanded='true'></button></div></div>",
	);
	try {
		const scroller = env.document.getElementById("scroller");
		let clicks = 0;
		scroller.querySelector("button").addEventListener("click", () => {
			clicks += 1;
		});
		assert.equal(await revealThreadSearchHit(scroller, "m9"), "not-mounted");
		assert.equal(clicks, 0);
		/* An already-open run is not pressed again. */
		assert.equal(await revealThreadSearchHit(scroller, "m1"), "not-mounted");
		assert.equal(
			clicks,
			0,
			"the walk only ever opens; an open bar is left as it is",
		);
		assert.equal(await revealThreadSearchHit(null, "m1"), "not-mounted");
	} finally {
		await env.close();
	}
});

test("the landed mark's timer and the stylesheet's animation are one number", () => {
	assert.equal(THREAD_SEARCH_LANDED_MS, 3000);
	const styles = readFileSync("src/renderer/src/styles/index.css", "utf8");
	assert.match(
		styles,
		/search-land-fade\s+3000ms/,
		"the stylesheet's animation duration is the timer's own span; a change to either is a change to the pair",
	);
	assert.match(
		styles,
		/\[data-lo-search-landed\]\s*\{\s*background-color: var\(--color-accent-wash\)/,
		"the mark paints the app's find-match wash",
	);
	assert.match(
		styles,
		/prefers-reduced-motion: reduce[\s\S]{0,400}\[data-lo-search-landed\]\s*\{\s*animation: none;/,
		"reduced motion keeps the wash statically instead of landing on the animation's transparent end frame",
	);
});

/* ------------------------------------------------------------ the chord */

/**
 * A controller mount: the transcript's own DOM (one scrolled region with a row,
 * one dialog for the foreign-overlay case) plus the overlay itself. The
 * containerRef points at the scroller, exactly as `canonical-transcript.tsx`
 * hands it over.
 */
async function mountController() {
	const env = installDom(
		`<div data-chat-region="transcript" tabindex="0" id="transcript">
			<div id="scroller"><div data-record-id="m1" id="row-m1">one</div></div>
		</div>
		<div role="dialog" id="dialog" tabindex="0">a dialog</div>
		<button id="outside">outside the chat surface</button>
		<div id="root"></div>`,
	);
	const { window } = env;
	Object.defineProperty(window.navigator, "platform", {
		configurable: true,
		value: "MacIntel",
	});
	const scroller = window.document.getElementById("scroller");
	const root = createRoot(window.document.getElementById("root"));
	const requests = [];
	globalThis.__findRequest = async (request) => {
		requests.push(request);
		return {
			query: request.q,
			state: "ready",
			partial: false,
			hits: [
				hit("m1", { snippet: "the ledger was rebuilt", ranges: [[4, 10]] }),
			],
			truncated: false,
		};
	};
	await act(async () => {
		root.render(
			React.createElement(ThreadSearchOverlay, {
				sessionId: SESSION,
				containerRef: { current: scroller },
			}),
		);
	});
	await act(async () => {});
	const api = {
		env,
		window,
		document: window.document,
		scroller,
		requests,
		overlay: () => window.document.querySelector("[data-lo-thread-search]"),
		input: () => window.document.querySelector("input"),
		async close() {
			await act(async () => {
				root.unmount();
			});
			await env.close();
		},
	};
	return api;
}

test("the chord opens the panel from the chat surface, and nowhere else", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const view = await mountController();
	try {
		const { window } = view;
		const transcript = window.document.getElementById("transcript");

		/* A foreign overlay's press stays its own. */
		const dialog = window.document.getElementById("dialog");
		dialog.focus();
		await pressAct(window, dialog, "f", { metaKey: true });
		assert.equal(view.overlay(), null, "a dialog owns its own keys");

		/* Outside the chat surface the press is not ours either. */
		const outside = window.document.getElementById("outside");
		outside.focus();
		await pressAct(window, outside, "f", { metaKey: true });
		assert.equal(view.overlay(), null);

		/* From the transcript it opens, with the box focused and the caret in it. */
		transcript.focus();
		await pressAct(window, transcript, "f", { metaKey: true });
		assert.notEqual(view.overlay(), null);
		assert.equal(window.document.activeElement, view.input());

		/* The chord re-answering itself selects the box rather than toggling. */
		view.input().value = "ledger";
		view.input().setSelectionRange(0, 0);
		await pressAct(window, view.input(), "f", { metaKey: true });
		assert.equal(view.window.document.activeElement, view.input());
		assert.equal(view.input().selectionStart, 0);
		assert.equal(view.input().selectionEnd, 6, "the box's text is selected");

		/* Escape closes and hands focus back to where it was. */
		await pressAct(window, view.input(), "Escape");
		assert.equal(view.overlay(), null);
		assert.equal(window.document.activeElement, transcript);
	} finally {
		await view.close();
	}
});

test("typing asks the conversation, and a click lands on the row in the scroller", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const view = await mountController();
	try {
		const { window } = view;
		const transcript = window.document.getElementById("transcript");
		transcript.focus();
		await pressAct(window, transcript, "f", { metaKey: true });

		await act(async () => {
			typeInto(window, view.input(), "ledger");
		});
		await act(async () => {
			t.mock.timers.tick(200);
		});
		await act(async () => {});
		assert.equal(view.requests.length, 1, "one request for one settled query");
		assert.equal(view.requests[0].sessionId, SESSION);
		assert.equal(view.requests[0].q, "ledger");

		const option = window.document.querySelector("[role='option']");
		assert.equal(option.textContent.includes("ledger"), true);
		await act(async () => {
			option.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		});
		const row = window.document.getElementById("row-m1");
		assert.equal(
			row.hasAttribute(THREAD_SEARCH_LANDED_ATTR),
			true,
			"the hit's message is marked in place",
		);
	} finally {
		await view.close();
	}
});
