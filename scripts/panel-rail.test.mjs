/**
 * The panel rail (#872), executable.
 *
 *     node --test scripts/panel-rail.test.mjs
 *
 * WHY THIS FILE EXISTS. The rail is a new interaction surface - a vertical toolbar
 * with one tab stop, arrow-key movement and a lit state that must follow the STORE's
 * truth about what is drawn - and none of that is visible in a still: a frame cannot
 * tell a toolbar from four buttons, a roving tab stop from four, or an item lit
 * because its flag is up from one lit because its pane is on screen. The frames in
 * `docs/evidence/shell-app-shell/` carry the pixels; this carries the contract.
 *
 * WHAT IT DRIVES. The real `PanelRail` (and through it the real `RunDetailsTrigger`)
 * against the real UI-preferences store, in jsdom, with React's own scheduler - the
 * rig `run-panel-navigation.test.mjs` documents. The assertions are structural (roles,
 * attributes, `document.activeElement`, which controls exist), the honest instrument
 * for a DOM without a layout engine. It is NOT visual evidence.
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
const CACHE = join(ROOT, "node_modules", ".cache", "panel-rail");
const NAV = "src/renderer/src/shared/components/navigation";
const RUN = "src/renderer/src/features/chat/components/run-details";
const bundle = await build({
	stdin: {
		contents: `
			export { PanelRail } from "./${NAV}/panel-rail";
			export { PanelRailFrame } from "./${NAV}/panel-rail-frame";
			export { suppressedOverlayIds } from "./src/renderer/src/shared/browser-view-policy";
			export { ChatLayout } from "./src/renderer/src/shared/components/common/chat-layout";
			export { InPanelRailHost, PanelRailHostContext } from "./${NAV}/panel-rail-host";
			export { browserRailLabels, canvasRailLabels, consoleRailLabels, PANEL_RAIL_ORDER } from "./${NAV}/panel-rail-model";
			export { useUiPreferencesStore, resolveDrawnRightSlotPane } from "./src/renderer/src/shared/store/ui-preferences-store";
			export { deriveRunDetails } from "./${RUN}/run-detail-model";
			export * as fixtures from "./${RUN}/run-details.fixtures";
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
const bundlePath = join(CACHE, "rail.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const {
	PanelRail,
	suppressedOverlayIds,
	ChatLayout,
	InPanelRailHost,
	PanelRailHostContext,
	browserRailLabels,
	canvasRailLabels,
	consoleRailLabels,
	PANEL_RAIL_ORDER,
	useUiPreferencesStore,
	resolveDrawnRightSlotPane,
	deriveRunDetails,
	fixtures,
} = await import(pathToFileURL(bundlePath).href);

const read = (path) => readFileSync(join(ROOT, path), "utf8");

/* ------------------------------------------------------------------ harness */

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
		// `leaveReader` defers its focus to the next frame, and it calls these BARE
		// rather than off the window, so jsdom's own `window.requestAnimationFrame`
		// is not enough.
		requestAnimationFrame: window.requestAnimationFrame.bind(window),
		cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
		/*
		 * `leaveReader` builds its row selector with `CSS.escape`, BARE, and jsdom
		 * provides no `CSS` at all. It is listed here because the focus cases below
		 * FAIL without it - and the reason they did not before is worth keeping: a
		 * missing global reached from inside a rAF callback produces an uncaught
		 * error jsdom swallows, so this map's "fails loudly" promise needs an
		 * assertion that actually reads the effect, not just the list (R1-1, Q1).
		 */
		/* Nothing here builds a selector from an arbitrary id; the ids are the rail's own four. */
		CSS: { escape: (value) => String(value) },
		// Radix reads a node's computed style to tell a real `<button>` from a
		// non-element child; it reaches for the BARE global, like the two above.
		getComputedStyle: window.getComputedStyle.bind(window),
		// The UI-preferences store persists through zustand, which reaches for the
		// GLOBAL storage at each write rather than for this window's.
		localStorage: window.localStorage,
		sessionStorage: window.sessionStorage,
		IS_REACT_ACT_ENVIRONMENT: true,
		// MUI's `useMediaQuery` refuses without one, and the reader's own body is
		// the parent's transcript grammar, which is MUI-backed.
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
		ResizeObserver: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
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
		$: (selector) => window.document.querySelector(selector),
		$$: (selector) => [...window.document.querySelectorAll(selector)],
		items: () => [
			...window.document.querySelectorAll("[data-panel-rail-item]"),
		],
		ids: () =>
			[...window.document.querySelectorAll("[data-panel-rail-item]")].map(
				(item) => item.dataset.panelRailItem,
			),
		pressed: () =>
			[...window.document.querySelectorAll("[data-panel-rail-item]")]
				.filter((item) => item.getAttribute("aria-pressed") === "true")
				.map((item) => item.dataset.panelRailItem),
		item: (id) =>
			window.document.querySelector(`[data-panel-rail-item="${id}"]`),
		/* A synchronous press, then React's own flush of what it scheduled - the
		   two-pass shape `run-panel-navigation.test.mjs` documents (an awaited act
		   around the dispatch keeps flushing for minutes on a loaded host). */
		click: async (element) => {
			act(() => {
				element.dispatchEvent(
					new window.MouseEvent("click", { bubbles: true, cancelable: true }),
				);
			});
			await act(async () => {});
		},
		key: async (element, key) => {
			act(() => {
				element.dispatchEvent(
					new window.KeyboardEvent("keydown", {
						key,
						bubbles: true,
						cancelable: true,
					}),
				);
			});
			await act(async () => {});
		},
		store: (patch) => {
			act(() => {
				useUiPreferencesStore.setState(patch);
			});
		},
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

const DRAWABLE = { mounted: true, runDetails: true, session: true };
const DRAFT = { mounted: true, runDetails: false, session: false };
const NO_PANES = {
	isRunPanelOpen: false,
	isCanvasOpen: false,
	isBrowserPaneOpen: false,
	isConsolePaneOpen: false,
	isAskDrawerOpen: false,
	askDrawerEvictedPane: null,
};
const details = () => deriveRunDetails(fixtures.settled());

const rail = (overrides = {}) =>
	React.createElement(PanelRail, {
		sessionId: "session-1",
		runDetails: details(),
		mcpServers: [],
		listOnScreen: false,
		readerChildId: null,
		browserAttentionCount: 0,
		consoleUnseenCount: 0,
		consoleUnseenPulsing: false,
		fileCount: 0,
		...overrides,
	});

/** Every case starts from a closed slot on a drawable route. */
const reset = (api, route = DRAWABLE) =>
	api.store({ ...NO_PANES, rightSlotRoute: route });

/* -------------------------------------------------------------------- cases */

test("the rail is ONE vertical toolbar with a name, in the fixed order", async () => {
	await mount(async (api) => {
		reset(api);
		await api.render(rail());
		const toolbar = api.$("[data-panel-rail]");
		assert.ok(toolbar, "the rail renders");
		assert.equal(toolbar.getAttribute("role"), "toolbar");
		assert.equal(toolbar.getAttribute("aria-orientation"), "vertical");
		assert.equal(toolbar.getAttribute("aria-label"), "Panels");
		assert.deepEqual(api.ids(), ["run", "browser", "console", "canvas"]);
		assert.deepEqual(api.ids(), [...PANEL_RAIL_ORDER]);
	});
});

test("one tab stop: exactly one item is tabbable, and it follows focus", async () => {
	await mount(async (api) => {
		reset(api);
		await api.render(rail());
		const tabbable = () =>
			api.items().filter((item) => item.getAttribute("tabindex") === "0");
		assert.equal(tabbable().length, 1, "exactly one tab stop");
		assert.equal(tabbable()[0].dataset.panelRailItem, "run", "the first item");
		assert.equal(
			api.items().filter((item) => item.getAttribute("tabindex") === "-1")
				.length,
			3,
		);
		/* Focus entering on another item (a click, a pointer) moves the stop with it. */
		act(() => api.item("console").focus());
		await act(async () => {});
		assert.equal(tabbable().length, 1);
		assert.equal(tabbable()[0].dataset.panelRailItem, "console");
	});
});

test("ArrowUp/ArrowDown walk the items, Home/End take the ends, and the walk is bounded", async () => {
	await mount(async (api) => {
		reset(api);
		await api.render(rail());
		const active = () => api.document.activeElement?.dataset?.panelRailItem;
		act(() => api.item("run").focus());
		await api.key(api.item("run"), "ArrowDown");
		assert.equal(active(), "browser");
		await api.key(api.item("browser"), "ArrowDown");
		assert.equal(active(), "console");
		await api.key(api.item("console"), "ArrowUp");
		assert.equal(active(), "browser");
		await api.key(api.item("browser"), "End");
		assert.equal(active(), "canvas");
		await api.key(api.item("canvas"), "ArrowDown");
		assert.equal(active(), "canvas", "bounded at the end, not wrapping");
		await api.key(api.item("canvas"), "Home");
		assert.equal(active(), "run");
		await api.key(api.item("run"), "ArrowUp");
		assert.equal(active(), "run", "bounded at the start, not wrapping");
		/* A chord is not a walk: a modified arrow is somebody else's. */
		act(() => api.item("run").focus());
		act(() => {
			api.item("run").dispatchEvent(
				new api.window.KeyboardEvent("keydown", {
					key: "ArrowDown",
					metaKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		assert.equal(active(), "run", "a modified arrow moves nothing");
	});
});

test("aria-pressed follows each of the four store flags, one at a time", async () => {
	await mount(async (api) => {
		for (const [flag, id] of [
			["isRunPanelOpen", "run"],
			["isBrowserPaneOpen", "browser"],
			["isConsolePaneOpen", "console"],
			["isCanvasOpen", "canvas"],
		]) {
			reset(api);
			await api.render(rail());
			assert.deepEqual(api.pressed(), [], "nothing is lit with the slot empty");
			api.store({ [flag]: true });
			assert.deepEqual(api.pressed(), [id], `${flag} lights ${id} and only it`);
			for (const item of api.items()) {
				assert.ok(
					item.hasAttribute("aria-pressed"),
					"every item states its pressed state, either way",
				);
			}
		}
	});
});

test("pressing an item claims the slot: the others are cleared, and a second press closes", async () => {
	await mount(async (api) => {
		reset(api);
		await api.render(rail());
		await api.click(api.item("canvas"));
		assert.deepEqual(api.pressed(), ["canvas"]);
		await api.click(api.item("browser"));
		assert.deepEqual(api.pressed(), ["browser"], "a swap, not a stack");
		assert.equal(useUiPreferencesStore.getState().isCanvasOpen, false);
		await api.click(api.item("browser"));
		assert.deepEqual(
			api.pressed(),
			[],
			"the lit item is also the way to close",
		);
		await api.click(api.item("console"));
		assert.deepEqual(api.pressed(), ["console"]);
		assert.equal(
			useUiPreferencesStore.getState().consoleOpenIntent,
			"session-1",
			"the console's open names THIS conversation, as the header's door did",
		);
		await api.click(api.item("run"));
		assert.deepEqual(api.pressed(), ["run"]);
	});
});

test("a claimed pane the route cannot draw lights NOTHING (the drawable-aware selector)", async () => {
	await mount(async (api) => {
		/* Every flag, on a route with no chat surface: claimed everywhere, drawn nowhere. */
		for (const flag of [
			"isRunPanelOpen",
			"isBrowserPaneOpen",
			"isConsolePaneOpen",
			"isCanvasOpen",
		]) {
			reset(api, { mounted: false, runDetails: false, session: false });
			api.store({ [flag]: true });
			assert.equal(
				resolveDrawnRightSlotPane(useUiPreferencesStore.getState()),
				null,
			);
			await api.render(rail());
			assert.deepEqual(api.pressed(), [], `${flag} on an undrawable route`);
		}
		/* The run panel claimed on a draft: no run details, so it cannot be drawn. */
		reset(api, DRAFT);
		api.store({ isRunPanelOpen: true });
		await api.render(rail({ runDetails: null, sessionId: null }));
		assert.deepEqual(
			api.pressed(),
			[],
			"run claimed on a draft lights nothing",
		);
		/* And the same claim on a route that CAN draw it does light it. */
		reset(api);
		api.store({ isRunPanelOpen: true });
		await api.render(rail());
		assert.deepEqual(api.pressed(), ["run"]);
	});
});

test("a panel the route cannot draw is ABSENT, not disabled", async () => {
	await mount(async (api) => {
		reset(api, DRAFT);
		await api.render(rail({ runDetails: null, sessionId: null }));
		assert.deepEqual(
			api.ids(),
			["browser", "canvas"],
			"Run details and Console are absent on {mounted, !runDetails, !session}",
		);
		for (const item of api.items()) {
			assert.equal(item.disabled, false);
			assert.equal(item.hasAttribute("aria-disabled"), false);
		}
		assert.equal(api.$("[data-run-panel-trigger]"), null);
		assert.equal(api.$("[data-tour-tag=console-pane-trigger]"), null);
		/* A conversation with a session but no run view model: Console without Run. */
		reset(api, { mounted: true, runDetails: false, session: true });
		await api.render(rail({ runDetails: null }));
		assert.deepEqual(api.ids(), ["browser", "console", "canvas"]);
	});
});

test("the tooltips are the header's verbatim; the accessible names are stable nouns (U2)", async () => {
	/* The model first: it is the one derivation the tooltip and the name share. */
	assert.deepEqual(browserRailLabels(false, 0), {
		tooltip: "Open browser",
		aria: "Browser",
	});
	assert.deepEqual(browserRailLabels(false, 1), {
		tooltip: "Open browser — 1 approval waiting",
		aria: "Browser, 1 waiting",
	});
	assert.deepEqual(browserRailLabels(false, 3), {
		tooltip: "Open browser — 3 approvals waiting",
		aria: "Browser, 3 waiting",
	});
	assert.deepEqual(browserRailLabels(true, 0), {
		tooltip: "Close browser",
		aria: "Browser",
	});
	assert.deepEqual(browserRailLabels(true, 12), {
		tooltip: "Close browser — 12 approvals waiting",
		aria: "Browser, 12 waiting",
	});
	assert.deepEqual(consoleRailLabels(false, 0), {
		tooltip: "Open console",
		aria: "Console",
	});
	assert.deepEqual(consoleRailLabels(false, 2), {
		tooltip: "Open console — 2 finished since you looked",
		aria: "Console, 2 finished since you looked",
	});
	assert.equal(consoleRailLabels(true, 0).aria, "Console");
	assert.equal(
		consoleRailLabels(true, 2).tooltip,
		"Close console — 2 finished since you looked",
	);
	assert.equal(canvasRailLabels(false, 0, "⌘⇧C").aria, "Canvas (⌘⇧C)");
	assert.equal(
		canvasRailLabels(false, 1, "⌘⇧C").tooltip,
		"Open canvas (⌘⇧C) — 1 file",
	);
	assert.equal(canvasRailLabels(false, 4, "⌘⇧C").aria, "Canvas (⌘⇧C), 4 files");
	assert.equal(canvasRailLabels(true, 0, "⌘⇧C").aria, "Canvas (⌘⇧C)");
	/* And the DOM: the NAME is stable and `aria-pressed` alone carries open/closed (U2). */
	await mount(async (api) => {
		reset(api);
		await api.render(
			rail({ browserAttentionCount: 2, consoleUnseenCount: 1, fileCount: 3 }),
		);
		assert.equal(
			api.item("browser").getAttribute("aria-label"),
			"Browser, 2 waiting",
		);
		assert.equal(
			api.item("console").getAttribute("aria-label"),
			"Console, 1 finished since you looked",
		);
		assert.match(
			api.item("canvas").getAttribute("aria-label"),
			/^Canvas \(.+\), 3 files$/,
		);
		api.store({ isBrowserPaneOpen: true });
		assert.equal(
			api.item("browser").getAttribute("aria-label"),
			"Browser, 2 waiting",
		);
		assert.equal(
			api.item("browser").getAttribute("aria-pressed"),
			"true",
			"open is `aria-pressed`'s to say, once, and the name no longer repeats it",
		);
		/* One claim at a time, as `claimRightSlot` writes it. */
		api.store({ isBrowserPaneOpen: false, isConsolePaneOpen: true });
		assert.equal(
			api.item("console").getAttribute("aria-label"),
			"Console, 1 finished since you looked",
		);
		api.store({ isConsolePaneOpen: false, isCanvasOpen: true });
		assert.match(
			api.item("canvas").getAttribute("aria-label"),
			/^Canvas \(.+\), 3 files$/,
		);
	});
});

test("the browser badge: the count, capped at 9+ on the glyph, ringed in the rail's own ground", async () => {
	await mount(async (api) => {
		reset(api);
		await api.render(rail({ browserAttentionCount: 0 }));
		assert.equal(
			api.$("[data-tour-tag=browser-pane-badge]"),
			null,
			"no badge at 0",
		);
		await api.render(rail({ browserAttentionCount: 1 }));
		const one = api.$("[data-tour-tag=browser-pane-badge]");
		assert.equal(one.textContent, "1");
		await api.render(rail({ browserAttentionCount: 9 }));
		assert.equal(api.$("[data-tour-tag=browser-pane-badge]").textContent, "9");
		await api.render(rail({ browserAttentionCount: 12 }));
		const capped = api.$("[data-tour-tag=browser-pane-badge]");
		assert.equal(capped.textContent, "9+", "the glyph is capped");
		assert.match(
			api.item("browser").getAttribute("aria-label"),
			/12 waiting/,
			"the name keeps the exact number",
		);
		assert.ok(
			capped.className.includes("ring-surface"),
			"the ring names the rail's ground (`surface`), not the header's `canvas`",
		);
		assert.ok(!capped.className.includes("ring-canvas"));
	});
});

test("while the Asks drawer holds the slot NOTHING is lit, and a press is a swap", async () => {
	await mount(async (api) => {
		reset(api);
		/* The drawer borrowed the slot from the browser: the borrow is recorded, and
		   lighting the covered pane would say something false. */
		api.store({
			isBrowserPaneOpen: false,
			isAskDrawerOpen: true,
			askDrawerScope: "session",
			askDrawerEvictedPane: "isBrowserPaneOpen",
		});
		await api.render(rail());
		assert.equal(
			resolveDrawnRightSlotPane(useUiPreferencesStore.getState()),
			"ask",
		);
		assert.deepEqual(api.pressed(), [], "zero items lit while Asks is drawn");
		await api.click(api.item("canvas"));
		const state = useUiPreferencesStore.getState();
		assert.equal(
			state.isAskDrawerOpen,
			false,
			"the press cleared the ask flag",
		);
		assert.equal(state.askDrawerEvictedPane, null, "and forfeited the borrow");
		assert.deepEqual(api.pressed(), ["canvas"]);
	});
});

test("focus returns to the item whose panel closed under the keyboard, and never otherwise", async () => {
	await mount(async (api) => {
		reset(api);
		await api.render(rail());
		await api.click(api.item("console"));
		/* The pane's own close button unmounted under focus: the browser drops it on body. */
		act(() => api.document.activeElement?.blur?.());
		assert.equal(api.document.activeElement, api.document.body);
		api.store({ isConsolePaneOpen: false });
		assert.equal(
			api.document.activeElement,
			api.item("console"),
			"focus is on the originating item",
		);

		/* Closed from elsewhere: focus is in the composer, and must stay there. */
		const composer = api.document.createElement("textarea");
		api.document.body.append(composer);
		await api.click(api.item("canvas"));
		act(() => composer.focus());
		api.store({ isCanvasOpen: false });
		assert.equal(
			api.document.activeElement,
			composer,
			"no focus stolen from the composer",
		);

		/* A swap is the user choosing, not a close: nothing is yanked back. */
		api.store({ isBrowserPaneOpen: true });
		act(() => api.document.activeElement?.blur?.());
		await api.click(api.item("canvas"));
		act(() => api.document.activeElement?.blur?.());
		api.store({ isCanvasOpen: false, isBrowserPaneOpen: true });
		assert.equal(
			api.document.activeElement,
			api.document.body,
			"a swap to another pane moves no focus",
		);
		composer.remove();
	});
});

test("never on first mount: a rail that appears over an empty slot takes no focus", async () => {
	await mount(async (api) => {
		reset(api);
		api.store({ isBrowserPaneOpen: false });
		await api.render(rail());
		assert.equal(api.document.activeElement, api.document.body);
	});
});

test("every legacy hook the tour, the proofs and the driver find the controls by is still there", async () => {
	await mount(async (api) => {
		reset(api);
		await api.render(
			rail({
				browserAttentionCount: 1,
				consoleUnseenCount: 1,
				consoleUnseenPulsing: true,
				fileCount: 2,
			}),
		);
		for (const selector of [
			"[data-run-panel-trigger]",
			'[data-tour-tag="browser-pane-trigger"]',
			'[data-tour-tag="browser-pane-badge"]',
			'[data-tour-tag="console-pane-trigger"]',
			'[data-tour-tag="console-pane-blip"]',
			'[data-tour-tag="open-canvas-button"]',
		]) {
			assert.ok(
				api.$(selector),
				`${selector} is gone: a proof or the tour attaches to it`,
			);
		}
		/* The blip's two inks, and the files dot, as the header drew them. */
		assert.ok(
			api
				.$('[data-tour-tag="console-pane-blip"]')
				.className.includes("bg-accent"),
		);
		await api.render(
			rail({ consoleUnseenCount: 1, consoleUnseenPulsing: false }),
		);
		assert.ok(
			api
				.$('[data-tour-tag="console-pane-blip"]')
				.className.includes("bg-ink-muted"),
		);
	});
});

test("the lit item is a ground, an ink and a bar - roles only - and idle hover is a colour step", async () => {
	await mount(async (api) => {
		reset(api);
		api.store({ isCanvasOpen: true });
		await api.render(rail());
		const lit = api.item("canvas").className;
		for (const role of [
			"bg-row-selected",
			"text-accent",
			"before:bg-accent",
			"before:w-0.5",
		]) {
			assert.ok(lit.includes(role), `the lit item lost ${role}`);
		}
		const idle = api.item("browser").className;
		assert.ok(idle.includes("hover:bg-row-hover"));
		assert.ok(!idle.includes("bg-row-selected"));
		assert.doesNotMatch(lit + idle, /#[0-9a-f]{3,8}\b/i, "no hex");
		/* 32px targets: the `icon` size, centred in the 44px rail. */
		assert.ok(api.item("run").className.includes("size-8"));
	});
});

test("the host is inert outside a shell and portals into the shell's element inside one", async () => {
	await mount(async (api) => {
		reset(api);
		await api.render(
			React.createElement(
				"div",
				null,
				React.createElement(InPanelRailHost, null, rail()),
			),
		);
		assert.equal(api.$("[data-panel-rail]"), null, "no host, no rail");
		const host = api.document.createElement("div");
		host.setAttribute("data-panel-rail-host", "");
		api.document.body.append(host);
		await api.render(
			React.createElement(
				PanelRailHostContext.Provider,
				{ value: host },
				React.createElement(InPanelRailHost, null, rail()),
			),
		);
		assert.ok(
			host.querySelector("[data-panel-rail]"),
			"the rail is drawn in the shell's host",
		);
		/* React context survives the portal: the lit state still follows the store. */
		api.store({ isBrowserPaneOpen: true });
		assert.deepEqual(api.pressed(), ["browser"]);
	});
});

/* ----------------------------------------------------------------- source pins */

test("the header no longer renders the four triggers or their shed ladder", () => {
	const header = read(
		"src/renderer/src/features/chat/components/chat-header.tsx",
	);
	for (const tag of [
		"browser-pane-trigger",
		"browser-pane-badge",
		"console-pane-trigger",
		"console-pane-blip",
		"open-canvas-button",
	]) {
		assert.ok(
			!header.includes(`data-tour-tag="${tag}"`),
			`chat-header.tsx still renders ${tag}: the trigger lives on the rail`,
		);
	}
	assert.ok(
		!header.includes("<RunDetailsTrigger"),
		"the run trigger left the header",
	);
	assert.ok(
		!header.includes("@[22.5rem]/chathdr"),
		"the run trigger's shed rung is gone",
	);
	assert.ok(
		!header.includes("@[17.5rem]/chathdr"),
		"the console's shed rung is gone",
	);
	assert.ok(
		!header.includes("@[20rem]/chathdr"),
		"the canvas's shed rung is gone",
	);
	/* What stays: the Asks door, the menu with its four entries, and the chord. */
	assert.ok(header.includes('data-tour-tag="ask-pane-trigger"'));
	for (const label of [
		"Run details",
		"Open browser",
		"Open console",
		"Open canvas",
	]) {
		assert.ok(header.includes(label), `the ... menu lost its "${label}" entry`);
	}
	assert.ok(
		header.includes("isCanvasTogglePress(event)"),
		"the existing chord is still bound, exactly as before",
	);
});

test("the rail is not a keyboard region and adds no chord", () => {
	const regions = read("src/renderer/src/features/chat/chat-regions.ts");
	assert.ok(
		!/panel-rail/.test(regions),
		"the rail is reached through the header menu, not an F6 stop",
	);
	const railSource = read(
		"src/renderer/src/shared/components/navigation/panel-rail.tsx",
	);
	assert.ok(
		!/document\.addEventListener/.test(railSource),
		"the rail binds no document listener: no new chord",
	);
});

test("only the shell host sizes the rail, from the route's `mounted` fact", () => {
	const layout = read(
		"src/renderer/src/shared/components/common/chat-layout.tsx",
	);
	assert.match(layout, /s\.rightSlotRoute\.mounted/);
	assert.match(layout, /data-panel-rail-host=""/);
	/* A SIBLING after the measured column, not a child: the one fact that lets the
	   resolver, the dock arithmetic and the chat floor stay untouched. */
	const column = layout.indexOf("ref={contentColumnRef}");
	const host = layout.indexOf("data-panel-rail-host");
	assert.ok(
		column > 0 && host > column,
		"the host follows the measured column",
	);
});

/* ----------------------------------------------- the host's width, BEHAVIOURALLY */

/*
 * R1 (agent review round 1): the host's width gate on `mounted` was pinned only by a
 * source regex, which a constant 44 still satisfies - three of four suites stayed
 * green with an empty 44px strip on settings and agents. This drives the REAL shell
 * (`ChatLayout`) and reads the host element's own width after each fact the chat
 * surface publishes, so the gate fails by BEHAVIOUR. jsdom has no layout engine, so
 * the number read is the width the shell COMMANDS (`style.width`), which is the
 * quantity the gate decides; the painted 44 is the frames' claim.
 */
async function withShell(run, wrap = (node) => node) {
	await mount(async (api) => {
		reset(api, { mounted: false, runDetails: false, session: false });
		const shell = (content) =>
			wrap(
				React.createElement(ChatLayout, {
					sidebar: React.createElement("div", { "data-sidebar-stub": "" }),
					content,
				}),
			);
		await run(api, shell);
	});
}
const hostWidth = (api) => api.$("[data-panel-rail-host]")?.style.width ?? null;

test("the host is 0 with no chat surface, 44 with one, and follows the fact both ways", async () => {
	await withShell(async (api, shell) => {
		await api.render(shell(React.createElement("main", null, "settings")));
		assert.equal(hostWidth(api), "0px", "no chat surface mounted: no strip");
		api.store({ rightSlotRoute: DRAWABLE });
		assert.equal(hostWidth(api), "44px", "a chat surface is mounted: 44");
		api.store({
			rightSlotRoute: { mounted: false, runDetails: false, session: false },
		});
		assert.equal(
			hostWidth(api),
			"0px",
			"the route left the chat surface: 0 again",
		);
		/* The host element persists across the change: the portal target never goes away. */
		assert.ok(api.$("[data-panel-rail-host]"));
	});
});

test("the rail is drawn in the host while the chat surface is mounted, and the strip closes when it is not", async () => {
	await withShell(async (api, shell) => {
		const chat = React.createElement(InPanelRailHost, null, rail());
		api.store({ rightSlotRoute: DRAWABLE });
		await api.render(shell(chat));
		assert.ok(
			api.$("[data-panel-rail-host] [data-panel-rail]"),
			"the portaled rail lands in the shell's host",
		);
		assert.equal(hostWidth(api), "44px");
		await api.render(shell(React.createElement("main", null, "agents")));
		api.store({
			rightSlotRoute: { mounted: false, runDetails: false, session: false },
		});
		assert.equal(
			api.$("[data-panel-rail]"),
			null,
			"no rail on a route with no chat surface",
		);
		assert.equal(hostWidth(api), "0px");
	});
});

test("the host stays 44 across React StrictMode's double-mounted effects", async () => {
	await withShell(
		async (api, shell) => {
			api.store({ rightSlotRoute: DRAWABLE });
			await api.render(
				shell(React.createElement(InPanelRailHost, null, rail())),
			);
			assert.equal(hostWidth(api), "44px");
			assert.ok(api.$("[data-panel-rail-host] [data-panel-rail]"));
		},
		(node) => React.createElement(React.StrictMode, null, node),
	);
});

/* ------------------------------------- D1: a rail tooltip hides the native view */

test("a rail tooltip suppresses the native browser view for exactly as long as it is open", async () => {
	await mount(async (api) => {
		reset(api);
		api.store({ isBrowserPaneOpen: true });
		await api.render(rail());
		const ours = () =>
			suppressedOverlayIds().filter((id) =>
				id.startsWith("panel-rail-tooltip"),
			);
		assert.deepEqual(ours(), [], "nothing is suppressed at rest");
		/* Keyboard focus is the path Radix opens a tooltip on without a pointer. */
		act(() => api.item("console").focus());
		await act(async () => {});
		assert.equal(ours().length, 1, "an open tooltip registers one suppression");
		act(() => api.item("console").blur());
		await act(async () => {});
		assert.deepEqual(ours(), [], "closing it releases the suppression");
	});
	assert.deepEqual(
		suppressedOverlayIds().filter((id) => id.startsWith("panel-rail-tooltip")),
		[],
		"and unmounting leaves nothing behind",
	);
});

/*
 * THE RAIL'S GEOMETRY IS A PIXEL CLAIM, AND JSDOM HAS NO LAYOUT, so these pin the
 * SPELLINGS the measured frames depend on (design round 1, D2/D3/D4). The numbers
 * they stand for were read from the rendered stories, not from this file, and are
 * in the PR thread: first glyph centre y=52 (= the `...`, the pane close and the
 * scope switch), bar x=88-90 against ring x=91.5-93.5, badge 14px with its ring
 * 1.5px inside the host.
 */
test("the first item's top is padding, not a strut plus a gap (D3)", () => {
	const rail = read(
		"src/renderer/src/shared/components/navigation/panel-rail.tsx",
	);
	assert.match(
		rail,
		/"pt-\[calc\(var\(--chrome-inset-end-h\)\+0\.25rem\)\]"/,
		"the container pads its top by the caption inset plus 4px",
	);
	assert.doesNotMatch(
		rail,
		/className="h-\[max\(0\.25rem,var\(--chrome-inset-end-h\)\)\] w-full shrink-0"/,
		"the in-flow strut is gone: with the container's gap it put the item at 8px",
	);
	assert.match(
		rail,
		/absolute inset-x-0 top-0 h-\[calc\(var\(--chrome-inset-end-h\)\+0\.25rem\)\]/,
		"the drag strip stays, out of the flex flow",
	);
});

test("the lit bar is clear of the focus ring, on the hairline column (D2)", () => {
	const item = read(
		"src/renderer/src/shared/components/navigation/panel-rail-item.tsx",
	);
	assert.ok(
		item.includes("before:-left-[6.5px]"),
		"the bar overlays the rail's leading hairline",
	);
	assert.ok(
		item.includes("focus-visible:outline-offset-1!"),
		"the ring sits at a 1px offset, so it starts 1px outside the control and the bar ends 4.5px outside it",
	);
});

test("the count badge is the small mark anchored to the corner (D4)", () => {
	const rail = read(
		"src/renderer/src/shared/components/navigation/panel-rail.tsx",
	);
	assert.match(rail, /absolute -top-\[2px\] -right-\[2px\] flex/);
	assert.match(rail, /h-3\.5 min-w-3\.5/);
	assert.ok(
		rail.includes("ring-2 ring-surface"),
		"the ring still names the rail's ground",
	);
});
