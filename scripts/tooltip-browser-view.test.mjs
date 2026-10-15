/**
 * Every tooltip hides the native browser view while it is painted over it.
 *
 *     node scripts/run-desktop-tests.mjs scripts/tooltip-browser-view.test.mjs
 *
 * WHY THIS FILE EXISTS. A `WebContentsView` paints above all DOM, so a tooltip whose
 * panel lands inside the view's rect is invisible. The sidebar's conversation flyout
 * opens `right`, into the content area, and with the Browser route open only the
 * sliver over the sidebar's edge survived (operator report). The cure is the panel
 * rail's measured registration (#872), moved into the shared `Tooltip` so no call
 * site has to remember it. This pins that funnel: the predicate, the release paths,
 * the handoff between two flyouts (review round 1, R1), and the `suppressed`/`disabled`
 * props the flyout depends on.
 *
 * jsdom has no layout, so the panel's rect is STATED by each case - the instrument is
 * the policy's decision (does this box overlap the registered view rect), not a pixel.
 * `scripts/panel-rail.test.mjs` keeps the rail's own cases. NOT visual evidence.
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

const bootstrap = new JSDOM("<!doctype html>", { url: "http://localhost/" });
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrap.window.close();
	for (const name of ["window", "document"]) {
		Reflect.deleteProperty(globalThis, name);
	}
});

const EXTERNAL = /^(react|react-dom)(\/.*)?$/;
const BARE_SPECIFIER = /^[^./]/;
const CACHE = join(ROOT, "node_modules", ".cache", "tooltip-browser-view");
const bundle = await build({
	stdin: {
		contents: `
			export {
				suppressedOverlayIds,
				registerBrowserViewRect,
				subscribeBrowserView,
				browserViewSuppressed,
				RELEASE_HOLD_MS,
			} from "./src/renderer/src/shared/browser-view-policy";
			export { Tooltip, TooltipProvider } from "./src/renderer/src/shared/components/ui/tooltip";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
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
	alias: { "@shared": resolve(ROOT, "src/renderer/src/shared") },
	write: false,
});
mkdirSync(CACHE, { recursive: true });
const bundlePath = join(CACHE, "tooltip.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const {
	suppressedOverlayIds,
	registerBrowserViewRect,
	subscribeBrowserView,
	browserViewSuppressed,
	RELEASE_HOLD_MS,
	Tooltip,
	TooltipProvider,
} = await import(pathToFileURL(bundlePath).href);

/* ------------------------------------------------------------------ harness */

/*
 * The browser route at 1280x900: the sidebar's right edge is ~300px and the view's
 * rect starts after it. The flyout's box below sits at the row's right edge and
 * runs into the view; the "chrome band" box sits above the view's top.
 */
const VIEW = { x: 300, y: 120, width: 980, height: 780 };
const FLYOUT = { x: 290, y: 200, width: 256, height: 64 };
const ABOVE_VIEW = { x: 400, y: 80, width: 120, height: 28 };

/*
 * A rAF THE TEST DRAWS, not jsdom's. `pretendToBeVisual`'s rAF is a 16ms timer, and a
 * real-time wait inside an `act` scope costs seconds here: React keeps flushing while a
 * self-rescheduling rAF loop (floating-ui's autoUpdate, live for as long as a panel is
 * open) re-queues work, so one `frames()` wait measured 12,138ms on the
 * "no browser surface mounted" case, whose own work is milliseconds (review round 1,
 * R4). Frames are COUNTED instead: `api.frames(n)` draws n of them through `act`.
 */
const PLACEMENT_FRAMES = 8;
/* One 60Hz frame: only the policy's own hold is waited for in real time. */
const FRAME_MS = 17;

/*
 * jsdom's selector engine RECURSES on the top-layer pseudo-classes, and that recursion
 * was this file's whole wall time: nwsapi's `isFullscreen`/`isModal`/`isOpen` fall back
 * to the host `matches` (node_modules/nwsapi/src/nwsapi.js:707-747), which for jsdom is
 * `Element.prototype.matches` -> nwsapi -> `isFullscreen` again, and every
 * `getComputedStyle` on a mounted panel evaluates the UA stylesheet's `:fullscreen`
 * rule. Measured: the first `act` flush after a panel opened cost 11,612ms of that
 * recursion, while every other phase of the same case is milliseconds (review round 1,
 * R4). Nothing in this tree is fullscreen, modal, open, closed, picture-in-picture or a
 * popover - which is what jsdom answers anyway once the recursion unwinds - so the
 * answer is stated directly. Anchored to the exact selector strings nwsapi hands to
 * `matchesNative`, so a selector that merely CONTAINS one (say `:not(:fullscreen)`)
 * still goes through the engine rather than being answered here.
 */
const TOP_LAYER =
	/^:(fullscreen|modal|popover-open|open|closed|picture-in-picture)$/;

/* The row flyout's own props, as `chat-sidebar.tsx` spells them (the sweep case). */
const SIDE_RIGHT = /side="right"/;
const OVERLAY_NAME = /overlayName="sidebar-row-flyout"/;

async function mount(run) {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	const { window } = dom;
	/* This method is where the recursion above is entered: answer those selectors here. */
	const engineMatches = window.Element.prototype.matches;
	window.Element.prototype.matches = function (selectors) {
		if (TOP_LAYER.test(selectors)) return false;
		return engineMatches.call(this, selectors);
	};
	/* Callbacks waiting for the next drawn frame, keyed by rAF id. */
	const queued = new Map();
	let nextFrameId = 0;
	const drawFrame = () => {
		const pending = [...queued.entries()];
		queued.clear();
		for (const [, callback] of pending) callback(performance.now());
	};
	const shims = {
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		Element: window.Element,
		Node: window.Node,
		Event: window.Event,
		// Radix dispatches its "another tooltip opened" signal as a BARE CustomEvent.
		CustomEvent: window.CustomEvent,
		requestAnimationFrame: (callback) => {
			nextFrameId += 1;
			queued.set(nextFrameId, callback);
			return nextFrameId;
		},
		cancelAnimationFrame: (id) => {
			queued.delete(id);
		},
		getComputedStyle: window.getComputedStyle.bind(window),
		IS_REACT_ACT_ENVIRONMENT: true,
		ResizeObserver: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	};
	const originals = new Map();
	for (const [key, value] of Object.entries(shims)) {
		originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value,
		});
	}
	/* The panel's painted box, as the case states it. */
	let panelRect = FLYOUT;
	const proto = window.HTMLElement.prototype;
	const original = proto.getBoundingClientRect;
	proto.getBoundingClientRect = function () {
		if (this.hasAttribute?.("data-lo-tooltip-panel")) {
			const r = panelRect;
			return {
				left: r.x,
				top: r.y,
				right: r.x + r.width,
				bottom: r.y + r.height,
				x: r.x,
				y: r.y,
				width: r.width,
				height: r.height,
			};
		}
		return original.call(this);
	};
	const root = createRoot(window.document.getElementById("root"));
	const api = {
		window,
		document: window.document,
		$: (selector) => window.document.querySelector(selector),
		render: async (node) => {
			await act(async () => root.render(node));
		},
		setPanelRect: (rect) => {
			panelRect = rect;
		},
		/*
		 * Draw `n` frames, each inside its own `act` so React flushes what that frame
		 * triggered. The default covers the hook's placement budget (`PLACEMENT_FRAMES`)
		 * plus slack, which is the most it can ask for before it gives up on an unplaced
		 * popper; frames cost microseconds, so the count buys determinism.
		 */
		frames: async (n = PLACEMENT_FRAMES + 4) => {
			for (let drawn = 0; drawn < n; drawn += 1) {
				await act(async () => {
					drawFrame();
				});
			}
		},
		/*
		 * Wait out the policy's handoff hold, the one real timer this file cannot count
		 * frames for: a closed-reaching tooltip keeps its registration `RELEASE_HOLD_MS`
		 * past the panel (R1). `FRAME_MS` of slack, because a timer is not exact.
		 */
		hold: () =>
			act(
				async () =>
					new Promise((done) => setTimeout(done, RELEASE_HOLD_MS + FRAME_MS)),
			),
	};
	try {
		await run(api);
	} finally {
		await act(async () => root.unmount());
		proto.getBoundingClientRect = original;
		for (const [key, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
		window.close();
	}
}

/** One conversation row's flyout, as `chat-sidebar.tsx` passes it. */
const rowFlyout = (id, extra = {}) =>
	React.createElement(
		Tooltip,
		{
			key: id,
			content: "Pinned conversation title",
			side: "right",
			align: "start",
			disableHoverableContent: true,
			overlayName: "sidebar-row-flyout",
			...extra,
		},
		React.createElement("button", { id: `row${id}`, type: "button" }, "row"),
	);

/** The sidebar row flyout's props, as `chat-sidebar.tsx` passes them. */
const flyout = (extra = {}) =>
	React.createElement(TooltipProvider, null, rowFlyout("", extra));

/** Adjacent rows of one conversation list, both flyouts live at once. */
const flyouts = (...ids) =>
	React.createElement(
		TooltipProvider,
		null,
		ids.map((id) => rowFlyout(`-${id}`)),
	);

const named = (prefix) =>
	suppressedOverlayIds().filter((id) => id.startsWith(`${prefix}:`));

/* -------------------------------------------------------------------- cases */

test("the sidebar flyout that REACHES the view hides it for exactly as long as it is open", async () => {
	const release = registerBrowserViewRect(() => VIEW);
	try {
		await mount(async (api) => {
			await api.render(flyout());
			assert.deepEqual(suppressedOverlayIds(), [], "nothing at rest");
			act(() => api.$("#row").focus());
			await api.frames();
			assert.ok(api.$("[role=tooltip]"), "the flyout is open");
			assert.equal(
				named("sidebar-row-flyout").length,
				1,
				"an open flyout over the view registers once, under its own name",
			);
			act(() => api.$("#row").blur());
			await api.hold();
			assert.deepEqual(
				suppressedOverlayIds(),
				[],
				"closing releases it, once the handoff hold has lapsed",
			);
		});
	} finally {
		release();
	}
	assert.deepEqual(suppressedOverlayIds(), [], "unmount leaves nothing");
});

test("moving the pointer from one flyout to the next never shows the page in between", async () => {
	const release = registerBrowserViewRect(() => VIEW);
	try {
		await mount(async (api) => {
			await api.render(flyouts("a", "b"));
			act(() => api.$("#row-a").focus());
			await api.frames();
			const onA = named("sidebar-row-flyout");
			assert.equal(onA.length, 1, "A is open over the view and registered");
			/*
			 * Every policy notify from here to B's registration, with the state each one
			 * sends the native view: `shown` is what `setViewVisible(true)` answers to, so
			 * one `shown` inside this window is the page flashing back for a frame while the
			 * pointer crosses a row. Radix closes A the moment B opens and B registers only
			 * once floating-ui has placed it, so without the hold (review round 1, R1) the
			 * sequence reads registered -> EMPTY -> registered.
			 */
			const seen = [];
			const unsubscribe = subscribeBrowserView(() =>
				seen.push({
					shown: !browserViewSuppressed(),
					ids: suppressedOverlayIds(),
				}),
			);
			act(() => {
				api.$("#row-a").blur();
				api.$("#row-b").focus();
			});
			await api.frames();
			const onB = named("sidebar-row-flyout").filter((id) => id !== onA[0]);
			unsubscribe();
			assert.ok(
				seen.length >= 1,
				`the handoff did not move the registry: ${JSON.stringify(seen)}`,
			);
			assert.ok(
				seen.every((step) => !step.shown && step.ids.length > 0),
				`the page was shown between the two flyouts: ${JSON.stringify(seen)}`,
			);
			assert.equal(onB.length, 1, "B registered under its own name");
			assert.ok(
				named("sidebar-row-flyout").includes(onA[0]),
				"A's registration is still held, which is what kept the page hidden",
			);
			/*
			 * The hold lapses with B still registered: A's id goes, B's stays and the page
			 * stays hidden, which is the half of R1 a held id must not get wrong.
			 */
			await api.hold();
			assert.deepEqual(
				named("sidebar-row-flyout"),
				onB,
				"A's hold ends without the page coming back",
			);
		});
	} finally {
		release();
	}
});

test("a tooltip that does NOT reach the view leaves the page drawn (no flash)", async () => {
	const release = registerBrowserViewRect(() => VIEW);
	try {
		await mount(async (api) => {
			api.setPanelRect(ABOVE_VIEW);
			await api.render(flyout());
			act(() => api.$("#row").focus());
			await api.frames();
			assert.ok(api.$("[role=tooltip]"), "the tooltip is open");
			assert.deepEqual(suppressedOverlayIds(), [], "but the view is untouched");
		});
	} finally {
		release();
	}
});

/*
 * The "no browser surface mounted, nothing registers" case lived here and was removed in
 * review round 1 (R3): with no rect source `overlapsBrowserView` answers false whatever
 * the guard does, so it passed with or without the code it was named for. The guard it
 * meant to pin is the frame count below, which IS mutation-tested.
 */
test("with no browser surface mounted, an open schedules no frame and registers nothing", async () => {
	/*
	 * Every shared `Tooltip` runs the reach hook, so off the browser route an open
	 * must not poll for placement: the empty rect registry already answers. Measured
	 * before the guard: four desktop suites that open a tooltip without a rAF shim
	 * (ask-open-render, browser-chord-renderer, message-actions, stt-mic-gate-session)
	 * failed with "requestAnimationFrame is not defined".
	 */
	await mount(async (api) => {
		const scheduled = [];
		globalThis.requestAnimationFrame = (callback) => {
			scheduled.push(callback);
			return scheduled.length;
		};
		await api.render(flyout());
		act(() => api.$("#row").focus());
		await api.frames(2);
		assert.ok(api.$("[role=tooltip]"), "the tooltip is open");
		assert.equal(
			scheduled.filter((cb) => cb.name === "measure").length,
			0,
			"the reach hook scheduled no placement frame",
		);
		assert.deepEqual(
			suppressedOverlayIds(),
			[],
			"and the empty rect registry already answered: nothing registered",
		);
	});
});

test("an unnamed tooltip registers as `tooltip`", async () => {
	const release = registerBrowserViewRect(() => VIEW);
	try {
		await mount(async (api) => {
			await api.render(
				React.createElement(
					Tooltip,
					{ content: "hint", side: "right" },
					React.createElement("button", { id: "t", type: "button" }, "t"),
				),
			);
			act(() => api.$("#t").focus());
			await api.frames();
			assert.equal(named("tooltip").length, 1);
		});
	} finally {
		release();
	}
});

test("`suppressed` (the team mark owns the pointer) stands the registration down with the card", async () => {
	const release = registerBrowserViewRect(() => VIEW);
	try {
		await mount(async (api) => {
			await api.render(flyout({ suppressed: false }));
			act(() => api.$("#row").focus());
			await api.frames();
			assert.equal(named("sidebar-row-flyout").length, 1, "open: registered");
			await api.render(flyout({ suppressed: true }));
			await api.hold();
			assert.equal(api.$("[role=tooltip]"), null, "the card stands down");
			assert.deepEqual(
				suppressedOverlayIds(),
				[],
				"and so does the page's pause",
			);
			await api.render(flyout({ suppressed: false }));
			await api.frames();
			assert.equal(
				named("sidebar-row-flyout").length,
				1,
				"the card returns over the view, re-measured, and re-registers",
			);
		});
	} finally {
		release();
	}
});

test("`disabled` (a drag is armed) releases, and the next open measures afresh", async () => {
	const release = registerBrowserViewRect(() => VIEW);
	try {
		await mount(async (api) => {
			await api.render(flyout());
			act(() => api.$("#row").focus());
			await api.frames();
			assert.equal(named("sidebar-row-flyout").length, 1);
			await api.render(flyout({ disabled: true }));
			await api.hold();
			assert.equal(api.$("[role=tooltip]"), null, "rendered bare");
			assert.deepEqual(suppressedOverlayIds(), [], "nothing held");
			await api.render(flyout());
			/*
			 * The drag settles and the pointer arrives LATER - past the hook's placement
			 * frames. Reopening at once would be measured off a stale "open" and pass
			 * even without the reset; this wait is what makes the case bite (measured:
			 * with the reset removed and no wait, all eight cases still passed).
			 */
			await api.frames();
			/* The bare render remounted the button, so focus it again: a real open. */
			act(() => api.$("#row").focus());
			await api.frames();
			assert.equal(
				named("sidebar-row-flyout").length,
				1,
				"a later real open registers again (the mirrored state was reset)",
			);
		});
	} finally {
		release();
	}
});

test("a caller's onOpenChange still hears every uncontrolled open and close", async () => {
	const seen = [];
	await mount(async (api) => {
		await api.render(flyout({ onOpenChange: (open) => seen.push(open) }));
		act(() => api.$("#row").focus());
		await api.frames(2);
		act(() => api.$("#row").blur());
		await api.frames(2);
	});
	assert.deepEqual(seen, [true, false]);
});

test("the sidebar's row flyout is the call site that names itself", () => {
	const sidebar = readFileSync(
		join(ROOT, "src/renderer/src/features/chat/components/chat-sidebar.tsx"),
		"utf8",
	);
	const start = sidebar.indexOf("const withFlyout = ");
	assert.ok(start > 0, "the flyout helper exists");
	const helper = sidebar.slice(start, sidebar.indexOf("</Tooltip>", start));
	assert.match(helper, SIDE_RIGHT);
	assert.match(helper, OVERLAY_NAME);
});
