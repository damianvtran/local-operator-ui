import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE CHECKPOINT RAIL, RENDERED — ticks, hit targets, the hover card's two
 * kinds, and §D5's states, driven through the shipped component.
 *
 * A static render would prove none of it: the card is a hover/focus-gated
 * Radix popover with an intent delay, so whether it opens, what it says, and
 * that it stays open while the pointer is inside it are all EFFECTS of real
 * event dispatch and real timers. The intent window is exercised with REAL
 * milliseconds (the delays are the shipped constants, so a change to either is
 * felt here) rather than fake timers, because React's scheduler and Radix's
 * layering both schedule work of their own and a mocked clock wide enough to
 * hold both stops discriminating between the component's delay and its
 * neighbours'.
 *
 * The ported layout is jsdom's, so this file cannot see the card's position or
 * the overlap density of 267 ticks — those are the driver scenes' subject
 * (Phase 2). What it can see, and what it pins, is that every tick exists,
 * carries its accessible name, is placed at the fixed pitch, and that
 * the card's sentences come from the manifest rather than from markup.
 */

const bundle = await build({
	stdin: {
		contents:
			'export { CheckpointRail, CHECKPOINT_CARD_OPEN_DELAY_MS, CHECKPOINT_CARD_CLOSE_DELAY_MS, CHECKPOINT_RAIL_LABEL } from "./src/renderer/src/features/chat/canonical/checkpoint-rail";',
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
});
// Written beside this file rather than imported as a data: URL, for the same
// reason `warm-session.test.mjs` gives: react stays external, and a data: URL
// has no base path from which to resolve it.
const bundlePath = new URL("./_checkpoint-rail.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
/*
 * A bootstrap DOM installed BEFORE the import, and the placement is
 * load-bearing rather than tidy. Module-level environment probes in the
 * dependency graph (`canUseDOM`-style constants, evaluated once at import
 * time) capture a browserless answer for the whole process when the bundle is
 * imported with no `window`/`document` — measured while debugging this file:
 * the popover mounted, `open` was true, and Radix portalled NOTHING, silently.
 * With the globals installed first, the same code renders. The per-case DOMs
 * below still install and restore their own globals around each mount.
 */
const bootstrap = new JSDOM("<!doctype html><div></div>", {
	url: "http://localhost/",
});
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
const {
	CheckpointRail,
	CHECKPOINT_CARD_OPEN_DELAY_MS,
	CHECKPOINT_RAIL_LABEL,
	CHECKPOINT_CARD_CLOSE_DELAY_MS,
} = await import(bundlePath.href);
await unlink(bundlePath);
const { createRoot } = await import("react-dom/client");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One checkpoint, with the fields a case is not about filled in plausibly. */
const checkpoint = (over = {}) => ({
	id: "u1",
	kind: "user",
	turn: 1,
	ts: 1780000000,
	seq: 10,
	text: "a message",
	...over,
});

const completion = (over = {}) =>
	checkpoint({
		id: "c1",
		kind: "completion",
		naming: { state: "pending", name: null, summary: null },
		...over,
	});

/**
 * A DOM for one case, with the shims the shipped component reaches for and
 * jsdom does not implement — the same rule `chat-image-expand.test.mjs` states:
 * only the ones actually touched, so a component that starts needing another
 * fails loudly here rather than silently no-oping.
 */
async function mountRail(initial) {
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
		HTMLButtonElement: window.HTMLButtonElement,
		Element: window.Element,
		Node: window.Node,
		Event: window.Event,
		CustomEvent: window.CustomEvent,
		MouseEvent: window.MouseEvent,
		KeyboardEvent: window.KeyboardEvent,
		requestAnimationFrame: window.requestAnimationFrame.bind(window),
		cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
		/*
		 * Radix's focus scope watches the layer for added/removed nodes and reads
		 * computed style; the popper sizes itself with a `ResizeObserver`.
		 */
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
	/*
	 * The top-layer pseudo-classes, answered directly.
	 *
	 * @floating-ui asks `element.matches(":modal")` (and `:popover-open`)
	 * while it computes the card's containing block, and jsdom's selector
	 * engine loops on those: `:modal` → `isFullscreen` → `matches(":fullscreen")`
	 * → the same engine again, a recursion that only stops when the stack
	 * overflows into an inner try/catch which reads it as `false`. Measured on
	 * this file: ~10s of CPU per opened card, every sample inside nwsapi. jsdom
	 * implements no top layer, so `false` is the answer the recursion always
	 * reached anyway; this is that answer with the recursion skipped, and
	 * nothing else about matching changes.
	 */
	const TOP_LAYER_QUERIES = new Set([":modal", ":fullscreen", ":popover-open"]);
	const nativeMatches = window.Element.prototype.matches;
	window.Element.prototype.matches = function matches(selector) {
		if (TOP_LAYER_QUERIES.has(selector)) return false;
		return nativeMatches.call(this, selector);
	};

	const root = createRoot(window.document.getElementById("root"));
	const calls = { jumps: [], hovers: [] };
	const render = async (props) => {
		act(() => {
			root.render(
				React.createElement(CheckpointRail, {
					sessionId: "s1",
					checkpoints: [],
					onJump: (id) => calls.jumps.push(id),
					onHover: (id) => calls.hovers.push(id),
					...props,
				}),
			);
		});
		await act(async () => {});
	};
	const flush = async () => {
		await act(async () => {});
	};
	const api = {
		window,
		document: window.document,
		calls,
		render,
		flush,
		rail: () => window.document.querySelector("[data-lo-checkpoint-rail]"),
		ticks: () => [...window.document.querySelectorAll("[data-checkpoint-id]")],
		tick: (id) => window.document.querySelector(`[data-checkpoint-id="${id}"]`),
		dialog: () => window.document.querySelector("[role='tooltip']"),
		async close() {
			act(() => {
				root.unmount();
			});
			await act(async () => {});
			for (const [name, descriptor] of originals) {
				if (descriptor) Object.defineProperty(globalThis, name, descriptor);
				else Reflect.deleteProperty(globalThis, name);
			}
			dom.window.close();
		},
		/**
		 * Focus a tick the way a keyboard reader arrives at one.
		 *
		 * `blur()` first is not ceremony: a tick that is ALREADY focused fires no
		 * second `focus` event, so re-opening a card on the same button after an
		 * earlier interaction is a case `focus()` alone silently no-ops.
		 */
		focusTick: async (id) => {
			const element = window.document.querySelector(
				`[data-checkpoint-id="${id}"]`,
			);
			assert.ok(element, `no tick ${id} to focus`);
			act(() => {
				element.blur();
				element.focus();
			});
			await act(async () => {});
		},
	};
	await render(initial);
	return api;
}

/** The `pointerover`/`pointerout` pair React synthesises enter/leave from. */
const pointer = (rail, element, type) => {
	act(() => {
		element.dispatchEvent(
			new rail.window.MouseEvent(type, {
				bubbles: true,
				cancelable: true,
			}),
		);
	});
};

test("an empty manifest renders nothing, and a building one renders only its mark", async () => {
	const rail = await mountRail({ checkpoints: [], building: false });
	try {
		assert.equal(
			rail.rail(),
			null,
			"empty is nothing rendered, not an empty rail",
		);
		assert.equal(rail.ticks().length, 0);

		await rail.render({ checkpoints: [], building: true });
		assert.ok(rail.rail(), "the building state mounts the rail");
		const marks = rail.rail().querySelectorAll(".animate-pulse-visible");
		assert.equal(
			marks.length,
			1,
			"one liveness element, and it is the top mark",
		);
		assert.equal(marks[0].getAttribute("aria-hidden"), "true");

		await rail.render({
			checkpoints: [completion({ id: "c1", seq: 10 })],
			building: true,
		});
		assert.equal(
			rail.ticks().length,
			1,
			"checkpoints that arrived during the build already paint",
		);

		await rail.render({
			checkpoints: [completion({ id: "c1", seq: 10 })],
			building: false,
		});
		assert.equal(
			rail.rail().querySelectorAll(".animate-pulse-visible").length,
			0,
			"the mark leaves when the build settles",
		);
	} finally {
		await rail.close();
	}
});

test("ticks render from the manifest, in order, at the fixed pitch", async () => {
	const checkpoints = [
		checkpoint({
			id: "u1",
			seq: 0,
			ts: new Date(2026, 8, 28, 14, 32).getTime() / 1000,
		}),
		completion({
			id: "c1",
			turn: 1,
			seq: 50,
			naming: {
				state: "ready",
				name: "Fix the build",
				summary: "One sentence.",
			},
		}),
		checkpoint({ id: "u2", turn: 2, seq: 100, ts: 0 }),
	];
	const rail = await mountRail({ checkpoints });
	try {
		const ticks = rail.ticks();
		assert.equal(ticks.length, 3);
		assert.deepEqual(
			ticks.map((tick) => tick.getAttribute("data-checkpoint-id")),
			["u1", "c1", "u2"],
			"keyboard order is manifest order",
		);
		/*
		 * The reworked geometry (dsh, 2026-09-29): a FIXED 10px pitch, so the
		 * marks are not placed by seq any more - what this reads is the pitch
		 * itself, one 28x10 row per mark with the 20x2 dash inside it.
		 */
		assert.deepEqual(
			ticks.map((tick) => tick.getAttribute("aria-label")),
			[
				"Jump to your message in turn 1 of 2, 2:32 PM",
				"Jump to turn 1 of 2, Fix the build",
				"Jump to your message in turn 2 of 2",
			],
		);
		for (const tick of ticks) {
			assert.equal(tick.tagName, "BUTTON");
			assert.equal(tick.getAttribute("type"), "button");
			/* The 28 x 10 hit row around the 20 x 2 dash (dsh). */
			assert.ok(tick.className.includes("h-2.5"), "the hit row is 10px tall");
			assert.ok(tick.className.includes("w-7"), "and 28px wide");
			const bar = tick.querySelector("span");
			assert.ok(bar.className.includes("h-0.5"), "the dash is 2px tall");
			assert.ok(bar.className.includes("w-5"), "and 20px wide");
			assert.ok(
				bar.className.includes("bg-ink-dim"),
				"the rest ink is the floored role",
			);
			assert.equal(bar.getAttribute("aria-hidden"), "true");
		}
		/* The pointer must reach the ticks and nothing else on the rail. */
		assert.ok(rail.rail().className.includes("pointer-events-none"));
		assert.ok(ticks[0].className.includes("pointer-events-auto"));

		/*
		 * 267 is the observed worst case (the S3 addendum's 272 MB journal).
		 * Overlap is legal in v1; what must not break is the count and the
		 * ordering, so every checkpoint still owns a tick.
		 */
		const dense = Array.from({ length: 267 }, (_, index) =>
			completion({
				id: `d${index}`,
				turn: index + 1,
				seq: index,
				naming: { state: "pending", name: null, summary: null },
			}),
		);
		await rail.render({ checkpoints: dense });
		assert.equal(rail.ticks().length, 267);
		assert.deepEqual(
			rail.ticks().map((tick) => tick.getAttribute("data-checkpoint-id")),
			dense.map((entry) => entry.id),
			"DOM order is manifest order, so the dense rail reads top to bottom",
		);
		/* Fixed pitch: every row is the same height, so order is DOM order. */
		for (const tick of rail.ticks()) {
			assert.ok(tick.className.includes("h-2.5"));
		}
	} finally {
		await rail.close();
	}
});

test("a switch seeds the inbound port while the outbound mark is still reported (design round 4)", async () => {
	/*
	 * The warm re-open's residual write, pinned where it is decidable. `useActiveCheckpoint`
	 * keeps its id in state, so a switch can render the inbound conversation's ticks while the
	 * OUTBOUND conversation's mark is still what the rail is told is active - and the port seed
	 * used to be skipped for exactly that commit (treating a stale mark as "already seeded"),
	 * which painted the inbound ticks at the outbound offset until the inbound mark's arrival
	 * wrote the whole uniform translate. The design seat measured that at -1870 px in 4 of 6
	 * warm re-opens; jsdom has no layout, so the pixel verdict stays theirs and this arm pins
	 * WHICH WRITE HAPPENS, by defining the frame's own scrollTop and reading the write set.
	 */
	const outbound = [
		checkpoint({ id: "u1", seq: 0 }),
		completion({ id: "c1", turn: 1, seq: 50 }),
	];
	const inbound = [
		checkpoint({ id: "v1", seq: 0 }),
		completion({ id: "c2", turn: 1, seq: 50 }),
	];
	const rail = await mountRail({ sessionId: "s1", checkpoints: outbound });
	try {
		const frame = rail.document.querySelector("[data-rail-frame]");
		assert.ok(frame, "the rail has a port to seed");
		const writes = [];
		let position = 0;
		Object.defineProperty(frame, "scrollTop", {
			configurable: true,
			get: () => position,
			set: (value) => {
				writes.push(value);
				/* What a browser does with the write the seed makes (it writes the track's height). */
				position = Math.min(value, 2465 - 420);
			},
		});
		Object.defineProperty(frame, "scrollHeight", {
			configurable: true,
			value: 2465,
		});
		Object.defineProperty(frame, "clientHeight", {
			configurable: true,
			value: 420,
		});
		/*
		 * Rectangles by identity, on the DOM's own prototype: the frame is the port,
		 * the inbound mark sits 1900px into a 2465px track (inside it - past, say,
		 * the 24px pad the follow reserves), and everything else measures zero. The
		 * prototype is per-JSDOM, so no other case sees these numbers.
		 */
		Object.defineProperty(
			rail.window.Element.prototype,
			"getBoundingClientRect",
			{
				configurable: true,
				value() {
					if (this.hasAttribute("data-rail-frame")) {
						return { top: 0, height: 420 };
					}
					if (this.getAttribute("data-checkpoint-id") === "v1") {
						/* Viewport-relative, for a port already at its tail: content-space 2300. */
						return { top: 255, height: 2 };
					}
					return { top: 0, height: 0 };
				},
			},
		);

		/* The switch: inbound ticks, the outbound mark still reported as active. */
		await rail.render({
			activeId: "c1",
			checkpoints: inbound,
			sessionId: "s2",
		});
		assert.deepEqual(
			writes,
			[2465],
			`the commit that paints the inbound ticks seeded the port to the tail: ${JSON.stringify(writes)}`,
		);

		/* The inbound mark arrives at content-space 2300 of a 2465px track: inside the port. */
		writes.length = 0;
		await rail.render({
			activeId: "v1",
			checkpoints: inbound,
			sessionId: "s2",
		});
		assert.deepEqual(
			writes,
			[],
			`a mark already inside the port does not move it: ${JSON.stringify(writes)}`,
		);

		/* And a later mark-less moment (a scroll, a reveal) must not pull it back to the tail. */
		writes.length = 0;
		await rail.render({
			activeId: null,
			checkpoints: inbound,
			sessionId: "s2",
		});
		assert.deepEqual(
			writes,
			[],
			`the port stays where the follow left it: ${JSON.stringify(writes)}`,
		);
	} finally {
		await rail.close();
	}
});

test("focus opens the completion card; Escape closes it; Enter's click is the jump", async () => {
	const rail = await mountRail({
		checkpoints: [
			checkpoint({ id: "u1", seq: 0, text: "what changed?" }),
			completion({
				id: "c1",
				turn: 1,
				seq: 50,
				outcome: "open",
				naming: { state: "pending", name: null, summary: null },
			}),
		],
	});
	try {
		await rail.focusTick("c1");
		const card = rail.dialog();
		assert.ok(card, "focus opens the same card hover opens (D5)");
		assert.ok(card.textContent.includes("Turn 1"), "the fallback title");
		assert.ok(
			card.textContent.includes("Generating name…"),
			"the pending naming line",
		);
		assert.ok(card.textContent.includes("Open"), "the outcome word");
		assert.ok(card.textContent.includes("Turn 1 of 1"), "position in the turn");
		assert.equal(
			rail.calls.hovers.at(-1),
			"c1",
			"the card's identity is the hover signal the parent warms on",
		);

		act(() => {
			rail.window.document.dispatchEvent(
				new rail.window.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await rail.flush();
		assert.equal(rail.dialog(), null, "Escape dismisses the card");
		assert.equal(rail.calls.hovers.at(-1), null);

		/* The press itself is the jump; the card has said its piece by then. */
		act(() => {
			rail.tick("c1").dispatchEvent(
				new rail.window.MouseEvent("click", {
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await rail.flush();
		assert.deepEqual(rail.calls.jumps, ["c1"]);
		assert.equal(rail.dialog(), null);

		/* A READY name supersedes the fallback, and the user card is bounded. */
		await rail.render({
			checkpoints: [
				checkpoint({ id: "u1", seq: 0, text: "what changed?" }),
				completion({
					id: "c1",
					turn: 1,
					seq: 50,
					outcome: "error",
					naming: {
						state: "ready",
						name: "Fix the build",
						summary: "One sentence.",
					},
				}),
			],
		});
		await rail.focusTick("c1");
		const ready = rail.dialog();
		assert.ok(ready.textContent.includes("Fix the build"));
		const firstLine = ready.querySelector("p");
		assert.ok(
			firstLine?.textContent?.startsWith("Turn 1 of 1"),
			"the structural identity leads the card, matching the tick's own label (issue #680)",
		);
		assert.ok(
			firstLine
				?.querySelector(".text-ink-muted")
				?.textContent?.includes("Fix the build"),
			"the ready name rides the identity line in muted ink (design round 1, D2)",
		);
		assert.ok(ready.textContent.includes("One sentence."));
		assert.ok(ready.textContent.includes("Error"));
		assert.ok(!ready.textContent.includes("Generating name…"));

		await rail.focusTick("u1");
		const userCard = rail.dialog();
		assert.ok(userCard.textContent.includes("what changed?"));
		const clamped = userCard.querySelector("[data-checkpoint-card-text]");
		assert.ok(clamped, "the user text is the clamped preview surface");
		assert.ok(
			clamped.className.includes("line-clamp-3"),
			"clamped to its budget rather than scrollable",
		);
	} finally {
		await rail.close();
	}
});

test("a warm landing while the card is open does not swap its text (issue #680)", async () => {
	const rail = await mountRail({
		checkpoints: [
			completion({
				id: "c1",
				turn: 3,
				seq: 50,
				naming: { state: "pending", name: null, summary: null },
			}),
		],
	});
	try {
		await rail.focusTick("c1");
		const card = rail.dialog();
		assert.ok(card, "the card is open");
		assert.ok(card.textContent.includes("Generating name…"));
		/*
		 * The naming warm lands while the reader is still looking at the card -
		 * the exact race issue #680 reports: a live read swaps the summary under
		 * the cursor. The open-time snapshot must hold instead.
		 */
		await rail.render({
			checkpoints: [
				completion({
					id: "c1",
					turn: 3,
					seq: 50,
					naming: {
						state: "ready",
						name: "Fixed the jump",
						summary: "One line.",
					},
				}),
			],
		});
		assert.ok(rail.dialog(), "the card is still open");
		assert.ok(
			!rail.dialog().textContent.includes("Fixed the jump"),
			"the open card's text is frozen at open",
		);
		/* The warmed text is what the NEXT hover shows. */
		await rail.focusTick("c1");
		assert.ok(
			rail.dialog().textContent.includes("Fixed the jump"),
			"the next open carries the warmed name",
		);
	} finally {
		await rail.close();
	}
});

test("hover opens by intent after the delay and closes on the same discipline", async () => {
	const rail = await mountRail({
		checkpoints: [checkpoint({ id: "u1", seq: 10, text: "a hovered message" })],
	});
	try {
		const tick = rail.tick("u1");
		pointer(rail, tick, "pointermove");
		assert.equal(
			rail.dialog(),
			null,
			"nothing opens on the enter edge alone — the intent window has to elapse",
		);

		await sleep(CHECKPOINT_CARD_OPEN_DELAY_MS + 80);
		await rail.flush();
		const card = rail.dialog();
		assert.ok(card, "the card opens once the intent window elapses");
		assert.ok(card.textContent.includes("a hovered message"));

		/*
		 * The card is a TOOLTIP with `pointer-events-none` (dsh): the pointer
		 * cannot enter it, so leaving the MARK is leaving the preview and the
		 * close delay is the whole discipline - there is no keep-open arm for a
		 * pointer that cannot be inside it.
		 */
		pointer(rail, tick, "pointerout");
		await sleep(CHECKPOINT_CARD_CLOSE_DELAY_MS + 80);
		await rail.flush();
		assert.equal(
			rail.dialog(),
			null,
			"leaving the mark closes the card on the close delay",
		);
	} finally {
		await rail.close();
	}
});

/** One keydown, the way the rail's own handler receives it. */
const tickKey = (rail, element, key) => {
	act(() => {
		element.dispatchEvent(
			new rail.window.KeyboardEvent("keydown", {
				key,
				bubbles: true,
				cancelable: true,
			}),
		);
	});
};

test("the rail is ONE tab stop with roving memory (UX round 1, U1)", async () => {
	const rail = await mountRail({
		checkpoints: [
			checkpoint({ id: "u1", seq: 0, text: "first" }),
			checkpoint({ id: "c1", seq: 40, text: "second" }),
			checkpoint({ id: "u2", seq: 60, text: "third" }),
			checkpoint({ id: "c2", seq: 90, text: "fourth" }),
		],
	});
	try {
		const tabbable = () =>
			rail.ticks().filter((element) => element.tabIndex === 0);
		assert.equal(tabbable().length, 1, "exactly one tick in the tab order");
		assert.equal(
			tabbable()[0].getAttribute("data-checkpoint-id"),
			"u1",
			"and it is the FIRST tick until a reader moves",
		);
		/* Remembering the last-focused tick is what makes returning cheap. */
		await rail.focusTick("u2");
		assert.deepEqual(
			tabbable().map((element) => element.getAttribute("data-checkpoint-id")),
			["u2"],
			"focus moves the group's tab stop with it",
		);
	} finally {
		await rail.close();
	}
});

test("the arrows walk the ticks, Home and End take the ends (U1)", async () => {
	const rail = await mountRail({
		checkpoints: [
			checkpoint({ id: "u1", seq: 0, text: "first" }),
			checkpoint({ id: "c1", seq: 40, text: "second" }),
			checkpoint({ id: "u2", seq: 60, text: "third" }),
			checkpoint({ id: "c2", seq: 90, text: "fourth" }),
		],
	});
	try {
		const active = () =>
			rail.document.activeElement?.getAttribute("data-checkpoint-id") ?? null;
		await rail.focusTick("u1");
		tickKey(rail, rail.tick("u1"), "ArrowDown");
		await rail.flush();
		assert.equal(active(), "c1", "ArrowDown walks to the next tick");
		tickKey(rail, rail.tick("c1"), "ArrowDown");
		await rail.flush();
		assert.equal(active(), "u2", "and onward in DOM order");
		tickKey(rail, rail.tick("u2"), "ArrowUp");
		await rail.flush();
		assert.equal(active(), "c1", "ArrowUp returns");
		tickKey(rail, rail.tick("c1"), "End");
		await rail.flush();
		assert.equal(active(), "c2", "End takes the newest tick");
		tickKey(rail, rail.tick("c2"), "ArrowDown");
		await rail.flush();
		assert.equal(active(), "c2", "the walk clamps at the end");
		tickKey(rail, rail.tick("c2"), "Home");
		await rail.flush();
		assert.equal(active(), "u1", "Home takes the oldest tick");
		assert.equal(
			rail.ticks().filter((element) => element.tabIndex === 0).length,
			1,
			"the walk kept the group at one tab stop",
		);
	} finally {
		await rail.close();
	}
});

test("the rail names itself, as a vertical toolbar (UX round 1, U3)", async () => {
	const rail = await mountRail({
		checkpoints: [checkpoint({ id: "u1", seq: 0, text: "only" })],
	});
	try {
		const root = rail.rail();
		assert.equal(root.getAttribute("role"), "toolbar");
		assert.equal(root.getAttribute("aria-orientation"), "vertical");
		assert.equal(root.getAttribute("aria-label"), CHECKPOINT_RAIL_LABEL);
	} finally {
		await rail.close();
	}
});
