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
			export { suppressedOverlayIds, registerBrowserViewRect, overlapsBrowserView } from "./src/renderer/src/shared/browser-view-policy";
			export { ChatHeader } from "./src/renderer/src/features/chat/components/chat-header";
			export { AskDrawer } from "./src/renderer/src/features/chat/components/asks/ask-drawer";
			export { Tooltip, TooltipProvider } from "./src/renderer/src/shared/components/ui/tooltip";
			export { BrowserSafeTooltip } from "./src/renderer/src/shared/components/ui/browser-safe-tooltip";
			export { ChatLayout } from "./src/renderer/src/shared/components/common/chat-layout";
			export { InPanelRailHost, PanelRailHostContext } from "./${NAV}/panel-rail-host";
			export { askRailLabels, browserRailLabels, canvasRailLabels, codeRailLabels, consoleRailLabels, PANEL_RAIL_ORDER } from "./${NAV}/panel-rail-model";
			export { askRailToggleLabel, askScopeSubject, ASK_RAIL_ITEM_SELECTOR } from "./src/renderer/src/features/chat/ask-queue";
			export { captureRefusal } from "./src/renderer/src/shared/keymap/keymap-chord";
			export { useUiPreferencesStore, resolveDrawnRightSlotPane } from "./src/renderer/src/shared/store/ui-preferences-store";
			export { deriveRunDetails } from "./${RUN}/run-detail-model";
			export { SlotPaneNotice } from "./src/renderer/src/shared/components/common/slot-pane-notice";
			export { useKeymapShortcuts } from "./src/renderer/src/shared/keymap/use-keymap-shortcuts";
			export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";
			export { FLEET_ASKS_UNAVAILABLE_FRONTEND } from "./src/renderer/src/features/chat/fleet-asks";
			export { runPaneNotice, codeReviewPaneNotice, RUN_NOTICE_DRAFT, RUN_NOTICE_READING, RUN_NOTICE_UNREADABLE, RUN_NOTICE_MISSING, CODE_NOTICE_DRAFT, CODE_NOTICE_BELOW_VERSION, CODE_NOTICE_CHECKING, codeNoticeLoadLead, SLOT_NOTICE_PROGRESS_DELAY_MS } from "./src/renderer/src/features/chat/right-slot-notices";
			export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";
			export { BACKEND_PAIRING_SENTENCE } from "./src/renderer/src/shared/api/local-operator/backend-error";
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
	captureRefusal,
	PanelRail,
	suppressedOverlayIds,
	registerBrowserViewRect,
	overlapsBrowserView,
	Tooltip,
	TooltipProvider,
	BrowserSafeTooltip,
	ChatHeader,
	AskDrawer,
	ChatLayout,
	InPanelRailHost,
	PanelRailHostContext,
	askRailLabels,
	askRailToggleLabel,
	ASK_RAIL_ITEM_SELECTOR,
	browserRailLabels,
	canvasRailLabels,
	codeRailLabels,
	consoleRailLabels,
	PANEL_RAIL_ORDER,
	useUiPreferencesStore,
	resolveDrawnRightSlotPane,
	deriveRunDetails,
	fixtures,
	SlotPaneNotice,
	useKeymapShortcuts,
	useCanonicalSessionsStore,
	FLEET_ASKS_UNAVAILABLE_FRONTEND,
	runPaneNotice,
	codeReviewPaneNotice,
	RUN_NOTICE_DRAFT,
	RUN_NOTICE_READING,
	RUN_NOTICE_UNREADABLE,
	RUN_NOTICE_MISSING,
	CODE_NOTICE_DRAFT,
	CODE_NOTICE_BELOW_VERSION,
	CODE_NOTICE_CHECKING,
	codeNoticeLoadLead,
	SLOT_NOTICE_PROGRESS_DELAY_MS,
	DesktopControlError,
	BACKEND_PAIRING_SENTENCE,
} = await import(pathToFileURL(bundlePath).href);

const read = (path) => readFileSync(join(ROOT, path), "utf8");

// An arbitrary ACTIVE binding, not a browser-owned gesture. A future reserved
// set expansion must fail at this guard instead of as a misleading tooltip diff.
const ASK_SAMPLE_CHORD = "primary+shift+u";
test("the asks sample chord remains capturable, not reserved", () => {
	assert.equal(
		captureRefusal(ASK_SAMPLE_CHORD, "panel.ask", {}),
		null,
		`rail fixture ${ASK_SAMPLE_CHORD} must stay an assignable sample chord`,
	);
});

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
		HTMLInputElement: window.HTMLInputElement,
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
		/* Nothing here builds a selector from an arbitrary id; the ids are the rail's own five. */
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
		// Radix's dropdown (the header's `...` menu) watches the DOM it portals into.
		MutationObserver: window.MutationObserver,
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

const DRAWABLE = { mounted: true, session: true };
const DRAFT = { mounted: true, session: false };
const NO_PANES = {
	isRunPanelOpen: false,
	isCanvasOpen: false,
	isBrowserPaneOpen: false,
	isConsolePaneOpen: false,
	isCodeReviewPaneOpen: false,
	isAskDrawerOpen: false,
	askDrawerScope: "session",
	askDrawerEvictedPane: null,
	/* The liveness projection the pane publishes: a reset must not leave one cell's
	   running terminal lighting the next cell's item. */
	consoleLiveSurface: null,
};
const details = () => deriveRunDetails(fixtures.settled());

/*
 * The rail as the chat surface mounts it. All six doors are present on every chat
 * route (the always-visible rail, D1), so the harness carries no offer flags; the
 * draft cells pass `sessionId: null` and `runDetails: null`.
 */
const rail = (overrides = {}) => {
	const { sessionId = "session-1", ...rest } = overrides;
	return React.createElement(PanelRail, {
		sessionId,
		runDetails: details(),
		mcpServers: [],
		listOnScreen: false,
		readerChildId: null,
		browserAttentionCount: 0,
		askCount: 0,
		askScope: "session",
		consoleUnseenCount: 0,
		consoleUnseenPulsing: false,
		fileCount: 0,
		codeOpened: 0,
		codeMentioned: 0,
		codeAttention: null,
		...rest,
	});
};

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
		assert.deepEqual(api.ids(), [
			"run",
			"ask",
			"browser",
			"console",
			"canvas",
			"code",
		]);

		assert.deepEqual(api.ids(), [...PANEL_RAIL_ORDER]);
		/* The asks item sits SECOND (#896), its historical slot: the pre-#872 header
		   ran Run -> Asks -> Browser -> Console -> Canvas. */
		assert.equal(
			api.ids()[1],
			"ask",
			"the fifth door returned to its old position",
		);
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
			5,
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
		assert.equal(active(), "ask", "the ask item is the second stop (#896)");
		await api.key(api.item("ask"), "ArrowDown");
		assert.equal(active(), "browser");
		await api.key(api.item("browser"), "ArrowDown");
		assert.equal(active(), "console");
		await api.key(api.item("console"), "ArrowUp");
		assert.equal(active(), "browser");
		await api.key(api.item("browser"), "End");
		assert.equal(active(), "code", "the sixth item is the last");
		await api.key(api.item("code"), "ArrowDown");
		assert.equal(active(), "code", "bounded at the end, not wrapping");
		await api.key(api.item("code"), "Home");
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

test("aria-pressed follows each of the six store flags, one at a time", async () => {
	await mount(async (api) => {
		for (const [flag, id] of [
			["isRunPanelOpen", "run"],
			["isBrowserPaneOpen", "browser"],
			["isConsolePaneOpen", "console"],
			["isCanvasOpen", "canvas"],
			/* The fifth state (#896): the drawer holds the slot, so the ASKS item is the
			   lit one - the fix the issue names, where the rail used to light nothing. */
			["isAskDrawerOpen", "ask"],
			["isCodeReviewPaneOpen", "code"],
		]) {
			reset(api);
			/* The console item's lit state follows LIVENESS, not the pane flag
			   (operator report, 2026-10-21), so the cell that opens it must say a
			   process is running - the prop chat-content derives from the pane. */
			await api.render(rail(id === "console" ? { consoleLiveCount: 1 } : {}));
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

test("the console item follows liveness, and an open history pane still toggles closed (U5)", async () => {
	/*
	 * THE OPERATOR'S REPORT (2026-10-21) AND ITS UX ROUND-1 CORRECTION (U5).
	 *
	 * Open on restored history: the item must NOT look active ("0 live"), and the
	 * press is the pane's TOGGLE - it closes the pane the user is reading, because a
	 * rail item is a door. The create-on-open rule belongs to the CLOSED state: a
	 * press that opens an empty/history pane files `requestConsoleOpen`, and the pane
	 * creates. A live console keeps the lit paint and the same close.
	 */
	await mount(async (api) => {
		reset(api);
		api.store({ isConsolePaneOpen: true, consoleLiveSurface: null });
		await api.render(rail({ consoleLiveCount: 0 }));
		assert.deepEqual(
			api.pressed(),
			[],
			"an open pane with no running surface is not the active console",
		);
		/*
		 * S5: the rail no longer carries a tooltip. A label opened LEFT would land on
		 * the native browser page, and a tooltip may not take the page away (the
		 * kind table), so the rail's accessible name is the channel. What this test
		 * still owns is the PRESS: an unlit item on an open history pane closes it.
		 */
		await api.click(api.item("console"));
		let state = useUiPreferencesStore.getState();
		assert.equal(
			state.isConsolePaneOpen,
			false,
			"the unlit item on an open history pane is the toggle that closes it",
		);
		assert.equal(
			state.consoleOpenIntent,
			null,
			"closing is not a request for a new terminal",
		);

		// A CLOSED pane's press is the open that may create.
		reset(api);
		api.store({ isConsolePaneOpen: false, consoleLiveSurface: null });
		await api.render(rail({ consoleLiveCount: 0 }));
		await api.click(api.item("console"));
		state = useUiPreferencesStore.getState();
		assert.equal(state.isConsolePaneOpen, true, "a closed item opens the pane");
		assert.equal(
			state.consoleOpenIntent,
			"session-1",
			"and asks the pane for a terminal",
		);

		// And the live case is the lit toggle it always was.
		reset(api);
		api.store({
			isConsolePaneOpen: true,
			consoleLiveSurface: { sessionId: "session-1", count: 1 },
		});
		await api.render(rail({ consoleLiveCount: 1 }));
		assert.deepEqual(
			api.pressed(),
			["console"],
			"a running console is the active one",
		);
		await api.click(api.item("console"));
		assert.equal(
			useUiPreferencesStore.getState().isConsolePaneOpen,
			false,
			"the lit item is still the way to put a live console away",
		);
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
		// The console's active treatment is liveness, so this door is judged in the
		// state it is meant to be lit in: an open pane with a running surface.
		await api.render(rail({ consoleLiveCount: 1 }));
		await api.click(api.item("console"));
		assert.deepEqual(api.pressed(), ["console"]);
		assert.equal(
			useUiPreferencesStore.getState().consoleOpenIntent,
			"session-1",
			"the console's open names THIS conversation, as the header's door did",
		);
		await api.click(api.item("run"));
		assert.deepEqual(api.pressed(), ["run"]);
		/* THE ASKS ITEM IS THE HEADER TRIGGER'S OLD DOOR (#896), verbatim: a toggle in
		   ITS scope - it closes when this scope is open, replaces the OTHER scope's open
		   (open=true for this one), and claims the slot from any sibling. */
		await api.click(api.item("ask"));
		assert.equal(useUiPreferencesStore.getState().isAskDrawerOpen, true);
		assert.equal(useUiPreferencesStore.getState().askDrawerScope, "session");
		assert.deepEqual(
			api.pressed(),
			["ask"],
			"the open drawer lights its own item, not its neighbours",
		);
		await api.click(api.item("ask"));
		assert.equal(
			useUiPreferencesStore.getState().isAskDrawerOpen,
			false,
			"a second press closes its own drawer",
		);
		assert.deepEqual(
			api.pressed(),
			[],
			"and the slot is EMPTY (#1079): the lit item is the same door in both directions, as it is for its five siblings, so the press asks for an empty slot rather than handing the run panel it borrowed back. The borrow rule is unchanged for the closes the user did NOT press (the empty queue, Escape, the carried fleet drawer).",
		);
		assert.equal(
			useUiPreferencesStore.getState().isRunPanelOpen,
			false,
			"the displaced run panel does not return",
		);
		/* Open in the OTHER scope: the press REPLACES the scope rather than closing. */
		api.store({ isAskDrawerOpen: true, askDrawerScope: "fleet" });
		await api.click(api.item("ask"));
		assert.equal(useUiPreferencesStore.getState().isAskDrawerOpen, true);
		assert.equal(
			useUiPreferencesStore.getState().askDrawerScope,
			"session",
			"the press re-opens in this item's scope",
		);
		assert.deepEqual(api.pressed(), ["ask"]);
		/* And the drawer's claim is cleared by a sibling's press, as `claimRightSlot`
		   writes it: pressing any other item is a swap. */
		await api.click(api.item("browser"));
		assert.equal(useUiPreferencesStore.getState().isAskDrawerOpen, false);
		assert.deepEqual(
			api.pressed(),
			["browser"],
			"a swap clears the drawer's claim",
		);
	});
});

test("the lit asks press empties the slot in BOUND mode too, and the conversation keeps no pane (#1079)", async () => {
	await mount(async (api) => {
		reset(api);
		/* Bound, with the browser in the slot and in the conversation's memory: the
		   issue's own repro - the memory is the record of what the drawer borrowed. */
		api.store({
			rightSlotKey: "session-1",
			rightSlotMemory: [["session-1", "browser"]],
			isBrowserPaneOpen: true,
		});
		await api.render(rail());
		assert.deepEqual(api.pressed(), ["browser"]);
		await api.click(api.item("ask"));
		assert.deepEqual(
			api.pressed(),
			["ask"],
			"the drawer takes the slot from the browser",
		);
		/* The keyboard stands where the drawer's own return left it - `<body>`, the
		   documented signature the rail's focus effect reads. */
		assert.equal(api.document.activeElement, api.document.body);
		await api.click(api.item("ask"));
		assert.deepEqual(
			api.pressed(),
			[],
			"pressing the lit item closes the panel instead of restoring the browser",
		);
		assert.equal(
			api.document.activeElement,
			api.document.body,
			"and the close moves no focus: the rail's effect stands down for the asks item (#896/#820/#835), so nothing is yanked back to the pressed item",
		);
		const state = useUiPreferencesStore.getState();
		assert.equal(
			state.isBrowserPaneOpen,
			false,
			"the browser does not come back",
		);
		assert.deepEqual(
			state.rightSlotMemory,
			[],
			"closed is the ABSENCE of an entry, so the conversation remembers no pane",
		);
		/* The switch away and back that reads the memory is the store suite's cell
		   (`right-slot-memory.test.mjs`, where the follower is installed); here the
		   entry's absence is the assertion the rail's own press can make. */
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
			"isAskDrawerOpen",
			"isCodeReviewPaneOpen",
		]) {
			reset(api, { mounted: false, session: false });
			api.store({ [flag]: true });
			assert.equal(
				resolveDrawnRightSlotPane(useUiPreferencesStore.getState()),
				null,
			);
			await api.render(rail());
			assert.deepEqual(api.pressed(), [], `${flag} on an undrawable route`);
		}
		/*
		 * ON A MOUNTED DRAFT EVERY DURABLE PANE DRAWS (D2): a pane that cannot act
		 * there draws its notice, so its claim lights its door. The session-scope
		 * asks drawer is the one exception: its home is a conversation.
		 */
		for (const [flag, id] of [
			["isRunPanelOpen", "run"],
			["isBrowserPaneOpen", "browser"],
			["isCanvasOpen", "canvas"],
			["isCodeReviewPaneOpen", "code"],
		]) {
			reset(api, DRAFT);
			api.store({ [flag]: true });
			await api.render(rail({ runDetails: null, sessionId: null }));
			assert.deepEqual(api.pressed(), [id], `${flag} on a mounted draft`);
		}
		/*
		 * THE CONSOLE IS THE EXCEPTION HERE, and it follows its own rule: the item is
		 * active only while a terminal is RUNNING (operator report, 2026-10-21), and a
		 * draft has no conversation to run one in. The pane still draws its notice; the
		 * door just does not claim a live console.
		 */
		reset(api, DRAFT);
		api.store({ isConsolePaneOpen: true });
		await api.render(rail({ runDetails: null, sessionId: null }));
		assert.deepEqual(
			api.pressed(),
			[],
			"a draft has no live console, so the console door is not the active one",
		);
		reset(api, DRAFT);
		api.store({ isAskDrawerOpen: true, askDrawerScope: "session" });
		await api.render(rail({ runDetails: null, sessionId: null }));
		assert.deepEqual(
			api.pressed(),
			[],
			"the session-scope drawer on a draft has no home, so it lights nothing",
		);
	});
});

test("every door is present on a draft, and none is disabled (D1)", async () => {
	await mount(async (api) => {
		reset(api, DRAFT);
		await api.render(
			rail({ runDetails: null, sessionId: null, askScope: "fleet" }),
		);
		assert.deepEqual(
			api.ids(),
			[...PANEL_RAIL_ORDER],
			"all six doors on {mounted, !session} with no run model",
		);
		for (const item of api.items()) {
			assert.equal(item.disabled, false);
			assert.equal(item.hasAttribute("aria-disabled"), false);
		}
		/* The run trigger with no model: present, the bare label, no mark. */
		const run = api.$("[data-run-panel-trigger]");
		assert.ok(run, "the run trigger renders with a null model");
		assert.equal(run.getAttribute("aria-label"), "Run details");
		assert.ok(api.$("[data-tour-tag=console-pane-trigger]"));
		assert.ok(api.$("[data-tour-tag=code-pane-trigger]"));
		/* A conversation whose frame has not been read: the same six. */
		reset(api);
		await api.render(rail({ runDetails: null }));
		assert.deepEqual(api.ids(), [...PANEL_RAIL_ORDER]);
	});
});

test("a door pressed on a draft opens its pane, and the console files no open request (D1)", async () => {
	await mount(async (api) => {
		reset(api, DRAFT);
		api.store({ consoleOpenIntent: null });
		await api.render(
			rail({ runDetails: null, sessionId: null, askScope: "fleet" }),
		);
		await api.click(api.item("console"));
		const state = useUiPreferencesStore.getState();
		assert.equal(state.isConsolePaneOpen, true, "the pane opens on a draft");
		assert.equal(
			state.consoleOpenIntent,
			null,
			"no conversation, so no console is requested",
		);
		assert.deepEqual(
			api.pressed(),
			[],
			"a draft has no live terminal, so the console item is not the active one",
		);
		for (const [id, flag] of [
			["run", "isRunPanelOpen"],
			["code", "isCodeReviewPaneOpen"],
		]) {
			await api.click(api.item(id));
			assert.equal(
				useUiPreferencesStore.getState()[flag],
				true,
				`${id} opens on a draft`,
			);
			assert.deepEqual(api.pressed(), [id]);
		}
	});
});

/*
 * THE NOTICE PANES (D1/D3): what a door pressed where its pane cannot act opens.
 * The choice is a pure function of the route's facts; the pane is one component.
 */
test("each pane that cannot act picks the notice for its reason (D1/D3)", () => {
	const run = (over) =>
		runPaneNotice({
			sessionId: "s-1",
			status: "connecting",
			missing: false,
			failure: null,
			...over,
		});
	assert.equal(
		run({ sessionId: undefined }),
		RUN_NOTICE_DRAFT,
		"run on a draft",
	);
	assert.equal(
		run({ sessionId: null, status: "unavailable" }),
		RUN_NOTICE_DRAFT,
	);
	for (const status of ["connecting", "reconnecting", "live"]) {
		assert.equal(
			run({ status }),
			RUN_NOTICE_READING,
			`a read that can still answer (${status}) is a progress line`,
		);
	}
	/*
	 * THE READ THAT ENDED (design D1 = UX U5): a stream that gave up is a resolved
	 * line, never "Reading…" - with the transcript's own sentence as its detail when
	 * there is one, and the 404 named as what it is.
	 */
	assert.equal(run({ status: "unavailable" }), RUN_NOTICE_UNREADABLE);
	const failed = run({
		status: "unavailable",
		failure: { statement: "Lost the connection to this conversation." },
	});
	assert.equal(failed.kind, "run-unreadable");
	assert.equal(failed.tone, "unavailable");
	assert.equal(failed.title, RUN_NOTICE_UNREADABLE.title);
	assert.equal(failed.detail, "Lost the connection to this conversation.");
	assert.equal(
		run({ status: "unavailable", missing: true }),
		RUN_NOTICE_MISSING,
	);
	assert.ok(
		!/Reading/.test(RUN_NOTICE_MISSING.title + RUN_NOTICE_UNREADABLE.title),
	);

	const code = (over) =>
		codeReviewPaneNotice({
			sessionId: "s-1",
			state: "enabled",
			cause: null,
			loadError: null,
			...over,
		});
	assert.deepEqual(
		code({}),
		{ notice: null, sessionId: "s-1" },
		"enabled with a conversation: the real pane, for that conversation",
	);
	assert.equal(code({ sessionId: undefined }).notice, CODE_NOTICE_DRAFT);
	assert.equal(
		code({ sessionId: undefined, state: "below-version" }).notice,
		CODE_NOTICE_DRAFT,
		"a draft says draft whatever the backend serves",
	);
	assert.equal(
		code({ state: "below-version" }).notice,
		CODE_NOTICE_BELOW_VERSION,
	);
	assert.equal(code({ state: "unknown" }).notice, CODE_NOTICE_CHECKING);
	/*
	 * THE TWO FAILURES LEAD WITH THIS PANE'S LEAD and carry the shared sentence as the
	 * detail, verbatim (design D3), in the `unavailable` tone.
	 */
	const outdated = code({
		state: "unknown",
		loadError: new DesktopControlError(404, "not found"),
	}).notice;
	assert.equal(outdated.kind, "code-unreadable");
	assert.equal(outdated.tone, "unavailable");
	assert.equal(outdated.title, codeNoticeLoadLead());
	assert.equal(
		outdated.detail,
		"The Local Operator server is older than this app expects. Update the server and try again.",
	);
	const unreachable = code({
		state: "unknown",
		loadError: new DesktopControlError(null, "no answer"),
	}).notice;
	assert.equal(unreachable.title, codeNoticeLoadLead());
	assert.equal(
		unreachable.detail,
		"The Local Operator server is not answering.",
	);
	const unpaired = code({
		state: "unpaired",
		cause: "credential-refused",
	}).notice;
	assert.equal(unpaired.kind, "code-unpaired");
	assert.equal(unpaired.tone, "unavailable");
	assert.equal(unpaired.title, codeNoticeLoadLead());
	assert.equal(unpaired.detail, BACKEND_PAIRING_SENTENCE["credential-refused"]);

	const every = [
		RUN_NOTICE_DRAFT,
		RUN_NOTICE_READING,
		RUN_NOTICE_UNREADABLE,
		RUN_NOTICE_MISSING,
		CODE_NOTICE_DRAFT,
		CODE_NOTICE_BELOW_VERSION,
		CODE_NOTICE_CHECKING,
		outdated,
		unpaired,
	];
	for (const notice of every) {
		/* One title rule (design D2): a sentence ends in a full stop, progress in an ellipsis. */
		assert.match(
			notice.title,
			notice.tone === "loading" ? /…$/ : /\.$/,
			`${notice.kind}: "${notice.title}"`,
		);
		/* One noun for the process (design D2, `backend-error.ts`'s copy table). */
		assert.ok(
			!/backend/i.test(`${notice.title} ${notice.detail ?? ""}`),
			`${notice.kind} says "backend"`,
		);
	}
	/* The draft notices name the next step (UX U3). */
	for (const notice of [RUN_NOTICE_DRAFT, CODE_NOTICE_DRAFT]) {
		assert.match(notice.detail, /^Send a message to start this conversation/);
		assert.equal(notice.tone, "empty");
	}
});

test("a progress notice waits before it is drawn; an answer shows at once (UX U1)", async () => {
	await mount(async (api) => {
		const notice = (props) =>
			React.createElement(
				TooltipProvider,
				null,
				React.createElement(SlotPaneNotice, {
					label: "Run details",
					closeLabel: "Close run details",
					onClose: () => {},
					labelInk: "dim",
					labelInset: true,
					...props,
				}),
			);
		await api.render(notice(RUN_NOTICE_READING));
		assert.ok(
			api.$('[data-slot-pane-notice="run-reading"]'),
			"the bar is there at once",
		);
		assert.equal(
			api.$("[data-slot-pane-notice-body]"),
			null,
			"a fast read lands in an empty slot: no sentence to blink",
		);
		await act(async () => {
			await new Promise((r) =>
				setTimeout(r, SLOT_NOTICE_PROGRESS_DELAY_MS + 50),
			);
		});
		assert.ok(
			api
				.$("[data-slot-pane-notice-body]")
				?.textContent.includes(RUN_NOTICE_READING.title),
			"a slow read gets its sentence",
		);
		/* A resolved notice is an answer, and is drawn on its first frame. */
		await api.render(notice(RUN_NOTICE_UNREADABLE));
		assert.ok(
			api
				.$("[data-slot-pane-notice-body]")
				?.textContent.includes(RUN_NOTICE_UNREADABLE.title),
		);
		/* The label copies the pane it stands in for (design D4). */
		const label = api.$("[data-slot-pane-notice] span");
		assert.ok(
			label.className.includes("text-ink-dim") &&
				label.className.includes("px-1"),
		);
		await api.render(
			notice({
				...CODE_NOTICE_DRAFT,
				label: "Code review",
				labelInk: "muted",
				labelInset: false,
			}),
		);
		const codeLabel = api.$("[data-slot-pane-notice] span");
		assert.ok(
			codeLabel.className.includes("text-ink-muted") &&
				!codeLabel.className.includes("px-1"),
		);
	});
});

test("the notice pane names itself, closes from its bar and on Escape, and leaves the composer's Escape alone", async () => {
	await mount(async (api) => {
		let closes = 0;
		const notice = (key) =>
			React.createElement(
				TooltipProvider,
				null,
				React.createElement(
					React.Fragment,
					null,
					React.createElement("textarea", { "aria-label": "Message" }),
					React.createElement(SlotPaneNotice, {
						key,
						label: "Run details",
						closeLabel: "Close run details",
						onClose: () => {
							closes += 1;
						},
						labelInk: "dim",
						labelInset: true,
						...RUN_NOTICE_DRAFT,
					}),
				),
			);
		await api.render(notice("a"));
		const pane = api.$("[data-slot-pane-notice]");
		assert.ok(pane, "the notice pane renders");
		assert.equal(pane.getAttribute("data-slot-pane-notice"), "run-draft");
		assert.equal(pane.getAttribute("aria-label"), "Run details");
		assert.ok(pane.textContent.includes(RUN_NOTICE_DRAFT.title));
		assert.ok(pane.textContent.includes(RUN_NOTICE_DRAFT.detail));
		await api.click(api.$('[aria-label="Close run details"]'));
		assert.equal(closes, 1, "the bar's close control closes");
		await api.key(api.document.body, "Escape");
		assert.equal(closes, 2, "an unclaimed Escape closes the pane");
		await api.key(api.$('textarea[aria-label="Message"]'), "Escape");
		assert.equal(closes, 2, "the composer's Escape is not the notice's");
	});
});

test("chat-content mounts the notice in the same slot the real run and code panes use", () => {
	const content = read(
		"src/renderer/src/features/chat/components/chat-content.tsx",
	);
	assert.ok(
		/\{isRunPanelOpen && \([\s\S]{0,4000}?\{runDetails \? \([\s\S]{0,4000}?<RunPanel[\s\S]{0,4000}?\) : \([\s\S]{0,400}?<SlotPaneNotice[\s\S]{0,400}?runPaneNotice\(\{\s*sessionId,\s*status: canonical\.view\.status,/.test(
			content,
		),
		"the run slot no longer falls back to the notice when there is no model",
	);
	assert.ok(
		/\{isCodeReviewPaneOpen && \([\s\S]{0,2000}?codeSlot\.notice !== null \?[\s\S]{0,400}?<SlotPaneNotice[\s\S]{0,800}?<CodeReviewPane\s+sessionId=\{codeSlot\.sessionId\}/.test(
			content,
		),
		"the code slot no longer gates `CodeReviewPane` (and its query) behind the notice",
	);
});

/*
 * THE ASKS ITEM (#896): always present now (D1 retired the host's "offered" gate;
 * a host with no queue opens a drawer that says so), and its two labels carry the
 * scope and the count. Asserted on BOTH scopes,
 * because the scope is the one fact that makes two renders of one control describe
 * two different queues (UX round 1, U3), and on the tag, because the drawer's
 * focus-return anchor and Escape door attach to it (#820/#835's contract, moved with
 * the control).
 */
test("the asks item is always present, and its labels carry the scope and the count", async () => {
	await mount(async (api) => {
		reset(api);
		await api.render(rail({ askCount: 3, askScope: "session" }));
		const offered = api.item("ask");
		assert.ok(offered, "offered: the item is present");
		assert.equal(offered.getAttribute("data-tour-tag"), "ask-pane-trigger");
		assert.ok(
			offered.matches(ASK_RAIL_ITEM_SELECTOR),
			"the drawer's entry/return path resolves to this item's tag",
		);
		assert.equal(offered.getAttribute("data-ask-scope"), "session");
		assert.equal(
			offered.getAttribute("aria-label"),
			"Asks, This conversation, 3 waiting",
			"the name is the stable noun + scope + count (U2); no verb",
		);
		assert.equal(
			offered.getAttribute("aria-pressed"),
			"false",
			"open/closed is `aria-pressed`'s to say, once",
		);
		await api.render(rail({ askCount: 11, askScope: "fleet" }));
		assert.equal(
			api.item("ask").getAttribute("aria-label"),
			"Asks, All conversations, 11 waiting",
		);
		assert.equal(api.item("ask").getAttribute("data-ask-scope"), "fleet");
		/* Zero still names its subject (U3): the scope word is what says WHICH queue
		   the quiet door opens. */
		await api.render(rail({ askCount: 0, askScope: "fleet" }));
		assert.equal(
			api.item("ask").getAttribute("aria-label"),
			"Asks, All conversations",
		);
	});
});

/*
 * THE VERB IS THE ITEM'S OWN SCOPE, THE LIT STATE IS THE SLOT'S (round-1 N1).
 * While the OTHER scope's drawer is carried onto this conversation the item is
 * the lit one - the drawer holds the slot, so `aria-pressed` reads true - but
 * its press RE-SCOPES rather than closes, so the tooltip must read `Open` while
 * the light stays on; same scope, the press closes and the verb flips. This is
 * the header trigger's reading before the move, restored in the one state where
 * the two facts genuinely differ. The tooltip is read OPEN (focus, the app's
 * own keyboard path), because that is the string a reader actually gets - the
 * accessible name deliberately carries no verb (U2).
 */
test("the asks item's NAME follows its SCOPE while aria-pressed follows the slot (N1)", async () => {
	await mount(async (api) => {
		reset(api);
		await api.render(rail({ askCount: 2, askScope: "session" }));
		// S5: the visible tooltip is gone (it would open over the page), so the
		// scope the verb used to state lives in the accessible name.
		const name = () => api.item("ask").getAttribute("aria-label") ?? "";
		act(() => api.item("ask").focus());
		await frames(30);
		assert.match(name(), /This conversation/);
		assert.match(name(), /2 waiting/);
		assert.equal(api.item("ask").getAttribute("aria-pressed"), "false");

		/* The carried cross-scope state: a fleet drawer is up over this conversation. */
		api.store({ isAskDrawerOpen: true, askDrawerScope: "fleet" });
		await frames(2);
		assert.match(
			name(),
			/This conversation/,
			"cross-scope: the name states the scope the press will act on",
		);
		assert.equal(
			api.item("ask").getAttribute("aria-pressed"),
			"true",
			"while the slot-wide light says a drawer is up",
		);

		/* Same scope: the press closes this scope's drawer. */
		api.store({ isAskDrawerOpen: true, askDrawerScope: "session" });
		await frames(2);
		assert.match(
			name(),
			/This conversation, 2 waiting/,
			"same-scope: the name still states the scope",
		);
		assert.equal(api.item("ask").getAttribute("aria-pressed"), "true");

		/* Closed again. */
		api.store({ isAskDrawerOpen: false });
		await frames(2);
		assert.match(name(), /This conversation, 2 waiting/);
		assert.equal(api.item("ask").getAttribute("aria-pressed"), "false");
		/*
		 * ...and the bound cap rides the tooltip too (#928, review round 1's
		 * F2 = design D3): the same promise the dispatcher answers, printed in the
		 * register this host spells (linux), and gone again when the row is reset.
		 */
		api.store({ shortcutBindings: { "panel.ask": ASK_SAMPLE_CHORD } });
		await frames(2);
		assert.match(
			name(),
			/\(Ctrl\+Shift\+U\)/,
			"the bound cap rides the accessible name too",
		);
		api.store({ shortcutBindings: {} });
		act(() => api.item("ask").blur());
	});
});

test("the tooltips are the header's verbatim; the accessible names are stable nouns (U2)", async () => {
	/* The model first: it is the one derivation the tooltip and the name share. */
	assert.deepEqual(browserRailLabels(false, 0, null), {
		tooltip: "Open browser",
		aria: "Browser",
	});
	assert.deepEqual(browserRailLabels(false, 1, null), {
		tooltip: "Open browser — 1 approval waiting",
		aria: "Browser, 1 waiting",
	});
	assert.deepEqual(browserRailLabels(false, 3, null), {
		tooltip: "Open browser — 3 approvals waiting",
		aria: "Browser, 3 waiting",
	});
	assert.deepEqual(browserRailLabels(true, 0, null), {
		tooltip: "Close browser",
		aria: "Browser",
	});
	assert.deepEqual(browserRailLabels(true, 12, null), {
		tooltip: "Close browser — 12 approvals waiting",
		aria: "Browser, 12 waiting",
	});
	assert.deepEqual(consoleRailLabels(false, 0, null), {
		tooltip: "Open console",
		aria: "Console",
	});
	assert.deepEqual(consoleRailLabels(false, 2, null), {
		tooltip: "Open console — 2 finished since you looked",
		aria: "Console, 2 finished since you looked",
	});
	assert.equal(consoleRailLabels(true, 0, null).aria, "Console");
	assert.equal(
		consoleRailLabels(true, 2, null).tooltip,
		"Close console — 2 finished since you looked",
	);
	assert.equal(canvasRailLabels(false, 0, "⌘⇧C").aria, "Canvas (⌘⇧C)");
	assert.equal(
		canvasRailLabels(false, 1, "⌘⇧C").tooltip,
		"Open canvas (⌘⇧C) — 1 file",
	);
	assert.equal(canvasRailLabels(false, 4, "⌘⇧C").aria, "Canvas (⌘⇧C), 4 files");
	assert.equal(canvasRailLabels(true, 0, "⌘⇧C").aria, "Canvas (⌘⇧C)");
	/*
	 * THE ASKS ITEM (#896): the tooltip is the DOOR'S OWN SENTENCE from `ask-queue.ts`
	 * and the name is the stable noun + scope + count. The third shape is the U3
	 * promise restated on the rail: at ZERO it still names its scope, which is what
	 * keeps it distinct from the drawer's own `Close asks` dismiss.
	 */
	assert.deepEqual(askRailLabels(false, "session", 1, null), {
		tooltip: "Open asks — This conversation, 1 waiting",
		aria: "Asks, This conversation, 1 waiting",
	});
	assert.deepEqual(askRailLabels(true, "fleet", 2, null), {
		tooltip: "Close asks — All conversations, 2 waiting",
		aria: "Asks, All conversations, 2 waiting",
	});
	/*
	 * NOTIFICATIONS (decisions D9): the door's badge adds this conversation's
	 * unread updates, so the name says both; zero updates is today's name.
	 */
	assert.equal(
		askRailLabels(false, "session", 1, null, 2).aria,
		"Asks, This conversation, 1 waiting, 2 unread updates",
	);
	assert.equal(
		askRailLabels(false, "session", 1, null, 0).aria,
		"Asks, This conversation, 1 waiting",
	);
	assert.deepEqual(askRailLabels(false, "session", 0, null), {
		tooltip: "Open asks — This conversation",
		aria: "Asks, This conversation",
	});
	/*
	 * The bound cap (#928, review round 1's F2 = design D3): the chord rides the
	 * noun in BOTH registers, exactly where the five siblings print theirs. The
	 * asks item used to be the one rail control whose promise the dispatcher
	 * answered but the control never showed.
	 */
	assert.deepEqual(askRailLabels(false, "session", 1, "⌘A"), {
		tooltip: "Open asks (⌘A) — This conversation, 1 waiting",
		aria: "Asks (⌘A), This conversation, 1 waiting",
	});
	assert.deepEqual(askRailLabels(true, "fleet", 0, "⌘A"), {
		tooltip: "Close asks (⌘A) — All conversations",
		aria: "Asks (⌘A), All conversations",
	});
	assert.notEqual(
		askRailLabels(true, "session", 0, null).tooltip,
		"Close asks",
		"the rail door must never be the same string as the pane's own dismiss",
	);
	/* THE TOOLTIP IS THE REUSE ITSELF, not a second spelling: `askRailLabels` prints
	   `ask-queue.ts`'s composer for the same state, so the two cannot drift. */
	assert.equal(
		askRailLabels(true, "session", 0, null).tooltip,
		askRailToggleLabel({ open: true, scope: "session", count: 0 }),
		"one derivation: the rail's tooltip IS ask-queue's sentence",
	);
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
			"Console (Ctrl+J), 1 finished since you looked",
			"the console ships bound (#928), so its name prints the cap",
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
			"Console (Ctrl+J), 1 finished since you looked",
		);
		api.store({ isConsolePaneOpen: false, isCanvasOpen: true });
		assert.match(
			api.item("canvas").getAttribute("aria-label"),
			/^Canvas \(.+\), 3 files$/,
		);
	});
});

test("the item caps are the BOUND chords: both registers, absent when unbound, and they follow the store (#928)", async () => {
	/* The model first: bound → parens in the tooltip AND the accessible name;
	   unbound → no parens at all. */
	assert.deepEqual(browserRailLabels(false, 0, "⌘B"), {
		tooltip: "Open browser (⌘B)",
		aria: "Browser (⌘B)",
	});
	assert.deepEqual(consoleRailLabels(false, 2, "⌘J"), {
		tooltip: "Open console (⌘J) — 2 finished since you looked",
		aria: "Console (⌘J), 2 finished since you looked",
	});
	assert.equal(
		codeRailLabels(false, 2, 1, null, "⌘R").aria,
		"Code review (⌘R), 2 opened, 1 mentioned",
	);
	assert.deepEqual(browserRailLabels(false, 1, null), {
		tooltip: "Open browser — 1 approval waiting",
		aria: "Browser, 1 waiting",
	});
	/*
	 * And the DOM: the rail derives each cap from the registry's effective chord
	 * — the console ships bound (`primary+j`, `Ctrl+J` on the test host's linux
	 * platform) while browser/run/ask/code are unbound — and a STORE WRITE moves
	 * the printed chord, so a rebind and the promise the control prints move
	 * together.
	 */
	await mount(async (api) => {
		reset(api);
		await api.render(rail({ consoleUnseenCount: 1 }));
		assert.equal(
			api.item("console").getAttribute("aria-label"),
			"Console (Ctrl+J), 1 finished since you looked",
		);
		assert.equal(api.item("browser").getAttribute("aria-label"), "Browser");
		api.store({
			shortcutBindings: {
				"panel.console": "primary+u",
				"panel.browser": "primary+i",
				"panel.ask": ASK_SAMPLE_CHORD,
			},
		});
		assert.equal(
			api.item("console").getAttribute("aria-label"),
			"Console (Ctrl+U), 1 finished since you looked",
		);
		assert.equal(
			api.item("browser").getAttribute("aria-label"),
			"Browser (Ctrl+I)",
		);
		assert.equal(
			api.item("ask").getAttribute("aria-label"),
			"Asks (Ctrl+Shift+U), This conversation",
			"the asks item's cap prints too (F2 = D3): it used to be the one item whose promise was invisible on the control",
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

test("the ask badge (#896): the count, capped at 9+ on the glyph, styled like the browser's", async () => {
	await mount(async (api) => {
		reset(api);
		await api.render(rail({ askCount: 0 }));
		assert.equal(
			api.$("[data-tour-tag=ask-pane-badge]"),
			null,
			"no badge at 0",
		);
		await api.render(rail({ askCount: 1 }));
		assert.equal(api.$("[data-tour-tag=ask-pane-badge]").textContent, "1");
		await api.render(rail({ askCount: 12 }));
		const capped = api.$("[data-tour-tag=ask-pane-badge]");
		assert.equal(capped.textContent, "9+", "the glyph is capped");
		assert.match(
			api.item("ask").getAttribute("aria-label"),
			/12 waiting/,
			"the name keeps the exact number",
		);
		assert.ok(
			capped.className.includes("ring-surface"),
			"the ring names the rail's ground, as the browser mark's does",
		);
		assert.ok(!capped.className.includes("ring-canvas"));
		/* The mark draws while the item is LIT: the count must not disappear with the
		   pane it opened (the shape the operator asked for on the header trigger). */
		api.store({ isAskDrawerOpen: true, askDrawerScope: "session" });
		assert.equal(api.item("ask").getAttribute("aria-pressed"), "true");
		assert.equal(api.$("[data-tour-tag=ask-pane-badge]").textContent, "9+");
	});
});

test("while the Asks drawer holds the slot the ASK ITEM is lit, and a press on another item is a swap", async () => {
	await mount(async (api) => {
		reset(api);
		/* The drawer borrowed the slot from the browser: the borrow is recorded, and
		   lighting the covered pane would say something false. #896: the ask item is
		   the one that lights, because the drawer is what is drawn. */
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
		assert.deepEqual(
			api.pressed(),
			["ask"],
			"the drawer's own item is the lit one, and only it - before #896 this was []",
		);
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

/*
 * THE RAIL STANDS DOWN FOR THE ASKS DRAWER TOO (round-1 F1/Q2). The rail's
 * focus-return effect and the drawer's own return are the two mechanisms that can
 * each claim the keyboard when the drawer closes. For the CHIP door the drawer
 * must win: it knows which door was pressed and the rail effect cannot see that -
 * and since #896 put an ask item on the rail, the rail effect's lookup FOUND one
 * (pre-#896 there was nothing to find), so it pre-empted the drawer's return and
 * the keyboard went to the rail item instead of the chip. The matrix below is the
 * reviewer's, in-test: railless chip (the committed outcome), railed chip (was
 * WRONG before the fix), railed rail-item (the control), and a rail without the
 * ask item (which pins the item as the cause, not a pre-existing race).
 */
const F1_TS = 1_760_000_000_000;
const F1_ASK = {
	ask_id: "a-f1",
	created_at: F1_TS,
	expires_at: F1_TS + 3_600_000,
	timeout_s: 3600,
	status: "open",
	delivered: false,
	questions: [
		{
			id: "target",
			question: "Which environment?",
			options: [{ label: "staging" }],
		},
	],
};
const F1_FRAME = { asks: [F1_ASK], asks_open: 1, asks_truncated: null };

/** The drawer as `chat-content` gates it: mounted off the store flag, closed by its own door. */
const RailDrawerHarness = ({ railMounted }) => {
	const open = useUiPreferencesStore((s) => s.isAskDrawerOpen);
	return React.createElement(
		React.Fragment,
		null,
		railMounted ? rail() : null,
		open
			? React.createElement(AskDrawer, {
					frontend: F1_FRAME,
					scope: "session",
					onClose: () =>
						useUiPreferencesStore.getState().setAskDrawerOpen(false, "session"),
				})
			: null,
	);
};

/** One cell: press a door, open, Escape on the landing, read where focus landed. */
async function f1Cell(api, { railMounted, door }) {
	reset(api);
	const chip = api.document.createElement("button");
	chip.setAttribute("data-lo-ask-item-toggle", "");
	chip.setAttribute("data-test-chip", "");
	api.document.body.append(chip);
	await api.render(React.createElement(RailDrawerHarness, { railMounted }));
	const doorEl = door === "chip" ? chip : api.item("ask");
	assert.ok(doorEl, "the door this cell presses is present");
	act(() => doorEl.focus());
	act(() => {
		useUiPreferencesStore.getState().setAskDrawerOpen(true, "session");
	});
	await act(async () => {});
	const surface = api.$("[data-lo-ask-surfaces]");
	assert.ok(
		surface?.contains(api.document.activeElement),
		"the entry move put the keyboard in the drawer before the close",
	);
	act(() => {
		api.document.activeElement.dispatchEvent(
			new api.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});
	await act(async () => {});
	assert.equal(
		api.$("[data-lo-ask-surfaces]"),
		null,
		"Escape closed the drawer",
	);
	/*
	 * READ FOCUS BEFORE THE CHIP IS REMOVED: the close path returns the keyboard to
	 * the chip, and jsdom drops `document.activeElement` to `<body>` the moment the
	 * focused node is detached - removing it first would report `body` for a return
	 * that actually happened.
	 */
	const afterClose = api.document.activeElement;
	chip.remove();
	return { chip, doorEl, afterClose };
}

test("a drawer opened from the CHIP returns focus to the chip with the rail mounted (F1/Q2)", async () => {
	await mount(async (api) => {
		const railless = await f1Cell(api, { railMounted: false, door: "chip" });
		assert.equal(
			railless.afterClose,
			railless.chip,
			"baseline: the chip is the door focus goes back to",
		);

		const railed = await f1Cell(api, { railMounted: true, door: "chip" });
		assert.equal(
			railed.afterClose,
			railed.chip,
			"the rail effect must not pre-empt the drawer's return for the chip door",
		);

		const control = await f1Cell(api, { railMounted: true, door: "rail" });
		assert.equal(
			control.afterClose,
			control.doorEl,
			"the rail-item door returns to the rail item",
		);

		/* The railless baseline above is the control that pins the ask item as the
		   cause: an "unoffered" rail no longer exists (D1), so it is the only one. */
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
				askCount: 1,
				consoleUnseenCount: 1,
				consoleUnseenPulsing: true,
				fileCount: 2,
			}),
		);
		for (const selector of [
			"[data-run-panel-trigger]",
			'[data-tour-tag="browser-pane-trigger"]',
			'[data-tour-tag="browser-pane-badge"]',
			/* The asks item's tag and badge (#896): the drawer's entry/return path and
			   the tour attach to the first; the second is the mark the issue asked to
			   carry over from the header. */
			'[data-tour-tag="ask-pane-trigger"]',
			'[data-tour-tag="ask-pane-badge"]',
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

test("the header no longer renders the five triggers or their shed ladder", () => {
	const headerCopy = JSON.parse(
		readFileSync("src/i18n/catalogues/en/ui.chat.header.json", "utf8"),
	);
	assert.equal(
		headerCopy["ui.chat.header.close_run_details"],
		"Close run details",
	);
	assert.equal(
		headerCopy["ui.chat.header.open_run_details"],
		"Open run details",
	);
	const header = read(
		"src/renderer/src/features/chat/components/chat-header.tsx",
	);
	for (const tag of [
		"browser-pane-trigger",
		"browser-pane-badge",
		"console-pane-trigger",
		"console-pane-blip",
		"open-canvas-button",
		/* The asks trigger is the LAST to leave (#896), and its badge goes with it:
		   both tags live on the rail's item now, and a header that kept one would be
		   the defect the issue names - two doors of one kind in two places. */
		"ask-pane-trigger",
		"ask-pane-badge",
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
	/* What stays: the menu with all FIVE entries - its asks row is the header's only
	   asks door now (#896) - the chord, and the asks item's tag where it moved TO.
	   The rail source carries the tag because the drawer's focus-return anchor and
	   Escape door attach to the control, not to a file. */
	const railSource = read(
		"src/renderer/src/shared/components/navigation/panel-rail.tsx",
	);
	assert.ok(
		railSource.includes('data-tour-tag="ask-pane-trigger"'),
		"the asks item's tag must live on the rail item: it is the drawer's anchor",
	);
	for (const label of [
		't("ui.chat.header.open_run_details")',
		"Close asks",
		"Open browser",
		"Open console",
		"Open canvas",
	]) {
		assert.ok(header.includes(label), `the ... menu lost its "${label}" entry`);
	}
	/* The asks row's label is the sibling toggle spelling, and its PLACEMENT mirrors
	   the rail's order (between Run details and Open browser). */
	assert.ok(
		header.includes('{asksOpen ? "Close asks" : "Open asks"}'),
		"the asks row must be the same toggle sentence as the browser row's",
	);
	/* The run row's label is keyed now (close/open) and its ternary can wrap:
	   whitespace-tolerant form - the branch is the pin, not the indentation Biome
	   leaves it at. */
	const runAt = header.search(
		/\{isRunPanelOpen\s*\?\s*t\("ui\.chat\.header\.close_run_details"\)\s*:\s*t\("ui\.chat\.header\.open_run_details"\)\}/,
	);
	const asksAt = header.indexOf('{asksOpen ? "Close asks" : "Open asks"}');
	const browserAt = header.indexOf(
		'{isBrowserPaneOpen ? "Close browser" : "Open browser"}',
	);
	assert.ok(
		runAt >= 0 && asksAt > runAt && browserAt > asksAt,
		"the asks row sits between Run details and Open browser, mirroring the rail (#896)",
	);
	assert.ok(
		!header.includes("isCanvasTogglePress"),
		"the header's canvas listener retires into the registry router (#928), so one chord cannot get two answers once a user rebinds it",
	);
});

test("the rail is not a keyboard region, and binds no listener of its own", () => {
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
		"the rail binds no listener of its own: every assigned chord arrives through the one router (#928)",
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
		reset(api, { mounted: false, session: false });
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
			rightSlotRoute: { mounted: false, session: false },
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
			rightSlotRoute: { mounted: false, session: false },
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

/*
 * THE SUPPRESSION IS MEASURED, NOT BLANKET (design round 2, D11 / review R7 / QA Q6).
 * jsdom has no layout, so the rect of the open tooltip is STATED by the case - the
 * instrument is the policy's own decision (does this box overlap the registered view
 * rect), not a pixel. The measured positions the numbers come from (1280x900, run
 * present, the FOUR-item rail the round measured): the view's rect is
 * [740,150,496,750]; Canvas's tooltip is at y=150..178
 * (23px inside), Console's at y=114..142 and Browser's and Run's higher still.
 * #896's asks item moves every box below the first down one pitch, so WHICH items
 * reach the view at 1280x900 is re-derived by the evidence pass; these cases pin the
 * PREDICATE, not a layout.
 */
const VIEW = { x: 740, y: 150, width: 496, height: 750 };
const frames = (n = 14) =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, n * 20));
	});

test("the rail label is mounted only when no browser view can clip it (S5 D2)", async () => {
	await mount(async (api) => {
		reset(api);
		const release = registerBrowserViewRect(() => VIEW);
		await api.render(rail());
		const node = api.item("canvas");
		act(() => api.item("canvas").focus());
		await frames(30);
		assert.equal(
			api.$('[role="tooltip"]'),
			null,
			"with a view mounted the label would be clipped, so it is not mounted",
		);
		assert.ok(
			api.item("canvas").getAttribute("aria-label"),
			"the accessible name still carries it",
		);
		assert.deepEqual(suppressedOverlayIds(), [], "focus never pauses");
		release();

		/* No surface: the same rail, the same focus, the label is back. This is the
		   regression the round-1 review found — the removal was global, but the
		   conflict exists only on the browser route. */
		await frames(2);
		assert.equal(
			api.item("canvas"),
			node,
			"the trigger node survives the view appearing and disappearing (U8)",
		);
		assert.equal(
			document.activeElement,
			node,
			"and focus does not fall to body while it happens",
		);
		act(() => api.item("canvas").blur());
		await frames(2);
		act(() => api.item("canvas").focus());
		await frames(30);
		assert.ok(api.$('[role="tooltip"]'), "a tooltip is mounted with no view");
		assert.deepEqual(suppressedOverlayIds(), [], "and it still never pauses");
	});
});

test("Tooltip's onOpenChange follows what is SHOWN, so suppressed cannot leave a caller stuck on (R12)", async () => {
	await mount(async (api) => {
		const seen = [];
		const el = (suppressed) =>
			React.createElement(
				TooltipProvider,
				null,
				React.createElement(
					Tooltip,
					{
						content: "hint",
						suppressed,
						onOpenChange: (open) => seen.push(open),
					},
					React.createElement("button", { id: "t", type: "button" }, "t"),
				),
			);
		await api.render(el(false));
		act(() => api.$("#t").focus());
		await act(async () => {});
		assert.equal(seen.at(-1), true, "opened by focus");
		await api.render(el(true));
		assert.equal(
			seen.at(-1),
			false,
			"forced shut by `suppressed`: the report follows, it is not left at true",
		);
		await api.render(el(false));
		assert.equal(
			seen.at(-1),
			true,
			"the DEFAULT resumes: suppression is not a discard (round-4 reviewer MAJOR-1)",
		);
		assert.ok(
			api.$('[role="tooltip"]'),
			"the panel returns when the override lifts",
		);
	});
});

test("discard opt-in stays closed on lift, and BrowserSafeTooltip opts in by default (U14)", async () => {
	await mount(async (api) => {
		const warns = [];
		const original = console.error;
		console.error = (...args) => warns.push(args.join(" "));
		try {
			// A caller's own `suppressed` is not a view discard (U29): with no
			// browser view, suppress then lift and a FRESH focus opens the label.
			const caller = (suppressed) =>
				React.createElement(
					BrowserSafeTooltip,
					{ content: "caller", suppressed },
					React.createElement(
						"button",
						{ id: "tooltip-caller", type: "button" },
						"c",
					),
				);
			await api.render(caller(true));
			await frames(2);
			act(() => api.$("#tooltip-caller").focus());
			await frames(20);
			assert.equal(api.$('[role="tooltip"]'), null, "caller suppression hides");
			await api.render(caller(false));
			await frames(2);
			act(() => api.$("#tooltip-caller").blur());
			act(() => api.$("#tooltip-caller").focus());
			await frames(20);
			assert.ok(
				api.$('[role="tooltip"]'),
				"caller suppression resumes by default",
			);

			const el = (suppressed) =>
				React.createElement(
					TooltipProvider,
					null,
					React.createElement(
						Tooltip,
						{ content: "hint", suppressed, discardWhileSuppressed: true },
						React.createElement("button", { id: "d", type: "button" }, "d"),
					),
				);
			await api.render(el(false));
			act(() => api.$("#d").focus());
			await frames(20);
			assert.ok(api.$('[role="tooltip"]'), "open before suppression");
			await api.render(el(true));
			assert.equal(api.$('[role="tooltip"]'), null, "suppression hides it");
			await api.render(el(false));
			assert.equal(
				api.$('[role="tooltip"]'),
				null,
				"discard is opt-in: lifting must not repaint the closed panel",
			);

			// BrowserSafeTooltip: focus, view arrives, view leaves; the label must
			// not repaint, and the root must never flip uncontrolled.
			const safe = () =>
				React.createElement(
					BrowserSafeTooltip,
					{ content: "safe" },
					React.createElement("button", { id: "s", type: "button" }, "s"),
				);
			await api.render(safe());
			act(() => api.$("#s").focus());
			await frames(20);
			assert.ok(
				api.$('[role="tooltip"]'),
				"no view: label is a normal tooltip",
			);
			const release = registerBrowserViewRect(() => VIEW);
			await frames(4);
			assert.equal(api.$('[role="tooltip"]'), null, "view: panel stands down");
			release();
			await frames(6);
			assert.equal(
				api.$('[role="tooltip"]'),
				null,
				"view gone: a view-based label must not resume",
			);
			assert.equal(
				warns.filter((line) => /uncontrolled to controlled/i.test(line)).length,
				0,
				"a boolean suppressed prop cannot flip the Radix root",
			);
		} finally {
			console.error = original;
		}
	});
});

test("the measured overlap is a positive area, so touching edges do not count", () => {
	const release = registerBrowserViewRect(() => VIEW);
	assert.equal(
		overlapsBrowserView({ x: 1000, y: 122, width: 120, height: 28 }),
		false,
		"ends exactly at the view's top",
	);
	assert.equal(
		overlapsBrowserView({ x: 1000, y: 123, width: 120, height: 28 }),
		true,
		"one px inside",
	);
	release();
	assert.equal(
		overlapsBrowserView({ x: 1000, y: 150, width: 120, height: 28 }),
		false,
		"no surface registered: no view",
	);
});

/* -------------------- R9 / Q1: the `...` menu's canvas row is a second door, really */

/*
 * The row used to call `onOpenOptions`, the page's slash-command chips toggle, and
 * so never opened the canvas at any width (on main as well). The menu's own comment
 * says it writes the store fields the rail writes; this is the cell that makes that
 * sentence executable: open the real menu, press the row, read the store.
 *
 * CONSEQUENCE, stated rather than hidden: nothing now sets the chat page's
 * `options` state (`chat-page.tsx`, set only by `onOpenOptions`), so the legacy
 * slash-command chips row it gates is unreachable. It was reachable only through
 * this row, which labelled itself "Open canvas"; a control that did something other
 * than its label says is the defect, and no other door to the chips exists. The
 * dead row is recorded as an accepted consequence on the PR, not removed here.
 */
test("the ... menu's Open canvas row opens the CANVAS, not the slash-command chips", async () => {
	await mount(async (api) => {
		reset(api);
		let chipsToggled = 0;
		await api.render(
			React.createElement(
				TooltipProvider,
				null,
				React.createElement(ChatHeader, {
					agentName: "Core",
					onOpenOptions: () => {
						chipsToggled += 1;
					},
					onToggleBrowser: () => {},
					onOpenConsole: () => {},
				}),
			),
		);
		const trigger = api.$('[aria-label="Conversation actions"]');
		assert.ok(trigger, "the overflow menu's trigger is in the header");
		act(() => {
			trigger.dispatchEvent(
				new api.window.KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await act(async () => {});
		const row = api
			.$$('[role="menuitem"]')
			.find((item) => item.textContent.trim() === "Open canvas");
		assert.ok(row, "the menu offers Open canvas");
		assert.equal(useUiPreferencesStore.getState().isCanvasOpen, false);
		await api.click(row);
		assert.equal(
			useUiPreferencesStore.getState().isCanvasOpen,
			true,
			"the row flips the canvas flag",
		);
		assert.equal(chipsToggled, 0, "and does not toggle the legacy chips row");
	});
});

/*
 * AND THE CONTRASTING DOOR FOR ASKS (#896). The asks row speaks through a PROP
 * (`onToggleAsks`) rather than reaching into the store, because the scope fact is
 * the caller's: this pins the three things that makes true - the row is offered
 * exactly where a host offers a door, its label states the action the press takes
 * (`Open asks` / `Close asks`, the browser row's toggle idiom), and pressing it
 * fires the host's toggle and nothing else.
 */
test("the ... menu's asks row is the header's remaining door: gated, verb-labelled, wired to the prop", async () => {
	await mount(async (api) => {
		reset(api);
		let toggles = 0;
		const header = (key, asks) =>
			React.createElement(
				TooltipProvider,
				null,
				React.createElement(ChatHeader, {
					key,
					agentName: "Core",
					onOpenOptions: () => {},
					...asks,
				}),
			);
		const openMenu = async () => {
			const trigger = api.$('[aria-label="Conversation actions"]');
			act(() => {
				trigger.dispatchEvent(
					new api.window.KeyboardEvent("keydown", {
						key: "Enter",
						bubbles: true,
						cancelable: true,
					}),
				);
			});
			await act(async () => {});
		};
		const rowNamed = (text) =>
			api
				.$$('[role="menuitem"]')
				.find((item) => item.textContent.trim() === text);
		/* Offered, closed: the row reads `Open asks`, and pressing it fires the prop. */
		await api.render(
			header("offered", {
				onToggleAsks: () => {
					toggles += 1;
				},
			}),
		);
		await openMenu();
		const open = rowNamed("Open asks");
		assert.ok(open, "the menu offers the asks row where a host offers a door");
		await api.click(open);
		assert.equal(toggles, 1, "the row presses the host's toggle, once");
		/* Offered, open: the same row flips to `Close asks`. */
		await api.render(
			header("open", { onToggleAsks: () => {}, asksOpen: true }),
		);
		await openMenu();
		assert.ok(
			rowNamed("Close asks"),
			"the label states the action the press will take, as the browser row's does",
		);
		/* A header whose host passes no toggle draws no asks row - the header still
		   renders what its host offers; `chat-content` now always offers it (D1,
		   pinned below). */
		await api.render(header("none", {}));
		await openMenu();
		assert.equal(
			api
				.$$('[role="menuitem"]')
				.filter((item) => /asks/i.test(item.textContent)).length,
			0,
			"no asks row where the host passes no toggle",
		);
	});
});

test("on a draft the ... menu carries all six panel rows, in rail order (D1)", async () => {
	await mount(async (api) => {
		reset(api, DRAFT);
		/* `chat-content`'s draft props: no session, no run model, every panel door. */
		await api.render(
			React.createElement(
				TooltipProvider,
				null,
				React.createElement(ChatHeader, {
					agentName: "Core",
					onOpenOptions: () => {},
					onToggleBrowser: () => {},
					onToggleAsks: () => {},
					onOpenConsole: () => {},
					onOpenCodeReview: () => {},
					asksScope: "fleet",
				}),
			),
		);
		const trigger = api.$('[aria-label="Conversation actions"]');
		act(() => {
			trigger.dispatchEvent(
				new api.window.KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await act(async () => {});
		const rows = api
			.$$('[role="menuitem"]')
			.map((item) => item.textContent.trim());
		assert.deepEqual(
			rows.filter((text) =>
				/^(Open|Close) (run details|asks|browser|console|canvas|code review)$/.test(
					text,
				),
			),
			[
				"Open run details",
				"Open asks",
				"Open browser",
				"Open console",
				"Open canvas",
				"Open code review",
			],
		);
		/* The run row toggles the flag the pane reads, with no model at all. */
		await api.click(
			api
				.$$('[role="menuitem"]')
				.find((item) => item.textContent.trim() === "Open run details"),
		);
		assert.equal(useUiPreferencesStore.getState().isRunPanelOpen, true);
	});
	/*
	 * And the host passes every one of those doors unconditionally: no
	 * `sessionId ? … : undefined` or capability gate in front of the asks, console
	 * or code review props (the draft arms are the notice panes').
	 */
	const content = read(
		"src/renderer/src/features/chat/components/chat-content.tsx",
	);
	assert.ok(/onToggleAsks=\{\(\) => \{/.test(content), "onToggleAsks is gated");
	assert.ok(
		/onOpenConsole=\{\s*sessionId\s*\?[\s\S]{0,2400}?:[\s\S]{0,800}?\(\) => setConsolePaneOpen\(!isConsolePaneOpen\)/.test(
			content,
		),
		"onOpenConsole has no draft arm",
	);
	assert.ok(
		/onOpenCodeReview=\{[\s\S]{0,900}?\(\) =>\s*setCodeReviewPaneOpen\(/.test(
			content,
		) && !/onOpenCodeReview=\{\s*codeReviewEnabled/.test(content),
		"onOpenCodeReview is gated",
	);
});

/*
 * THE MENU DOOR'S FULL WALK (round-1 Q1). The `…` menu's asks row is the third
 * door to the drawer, and the one that cannot signal its press through focus -
 * Radix hands the keyboard back to the menu's own trigger when it closes, so
 * the mount's door read finds nothing. Its open writes the store's
 * `askOpenIntent` instead, and this drives the real header + drawer + store
 * together: the row OPENS over a live-but-empty queue and the keyboard lands in
 * the pane; the request is CONSUMED by the mount that answers it; while this
 * scope is open the row still CLOSES with no request written, and it closes as
 * the PRESSED KIND (#1079, UX round 1 U1/U2) - an empty slot, not the pane it
 * borrowed handed back; a stranded close returns the keyboard to the trigger;
 * and a later NON-USER open over the empty queue still auto-closes - the
 * "consumed, not inheritable" half.
 *
 * The handler below is `chat-content.tsx`'s own expression (its source shape is
 * pinned in `fleet-asks.test.mjs`); this file pins what it DOES.
 */
test("the ... menu's asks row opens the drawer over an empty queue, and its doors behave (Q1)", async () => {
	await mount(async (api) => {
		reset(api);
		const emptyFrame = { asks: [], asks_open: 0, asks_truncated: null };
		let closes = 0;
		const Harness = () => {
			const asksOpen = useUiPreferencesStore(
				(s) => s.isAskDrawerOpen && s.askDrawerScope === "session",
			);
			const drawerOpen = useUiPreferencesStore((s) => s.isAskDrawerOpen);
			return React.createElement(
				React.Fragment,
				null,
				React.createElement(
					TooltipProvider,
					null,
					React.createElement(ChatHeader, {
						agentName: "Core",
						onOpenOptions: () => {},
						asksScope: "session",
						asksOpen,
						onToggleAsks: () => {
							const state = useUiPreferencesStore.getState();
							if (state.isAskDrawerOpen && state.askDrawerScope === "session") {
								/*
								 * THE ROW'S CLOSE IS THE PRESSED KIND (#1079): its source shape is pinned in
								 * `fleet-asks.test.mjs`, and what it DOES is asserted below - the slot is
								 * left empty rather than handed back.
								 */
								state.setAskDrawerOpen(false, "session", {
									dismissSlot: true,
								});
								return;
							}
							state.setAskDrawerOpen(true, "session");
							state.requestAskOpen("session");
						},
					}),
				),
				drawerOpen
					? React.createElement(AskDrawer, {
							frontend: emptyFrame,
							scope: "session",
							/*
							 * The DRAWER decides which kind of close it is - the X asks for an empty
							 * slot, its Escape and the emptied queue withdraw - and this forwards it to
							 * the store, exactly as `chat-content.tsx`'s door does (#1079).
							 */
							onClose: (options) => {
								closes += 1;
								useUiPreferencesStore
									.getState()
									.setAskDrawerOpen(false, "session", options);
							},
						})
					: null,
			);
		};
		const openMenu = async () => {
			const trigger = api.$('[aria-label="Conversation actions"]');
			assert.ok(trigger, "the menu trigger is in the header");
			act(() => {
				trigger.dispatchEvent(
					new api.window.KeyboardEvent("keydown", {
						key: "Enter",
						bubbles: true,
						cancelable: true,
					}),
				);
			});
			await act(async () => {});
		};
		const rowNamed = (text) =>
			api
				.$$('[role="menuitem"]')
				.find((item) => item.textContent.trim() === text);

		await api.render(React.createElement(Harness));

		/* (a) THE ROW OPENS over the empty queue: stays up, keyboard inside, request gone. */
		await openMenu();
		const openRow = rowNamed("Open asks");
		assert.ok(openRow, "the menu offers Open asks");
		await api.click(openRow);
		await act(async () => {});
		assert.equal(
			useUiPreferencesStore.getState().isAskDrawerOpen,
			true,
			"the row opened the drawer over the live-but-empty queue",
		);
		assert.equal(
			useUiPreferencesStore.getState().askOpenIntent,
			null,
			"the request is consumed by the mount that answers it",
		);
		const surface = api.$("[data-lo-ask-surfaces]");
		assert.ok(
			surface,
			"a door-opened mount is not auto-closed over the empty queue (the empty state keeps its door)",
		);
		/*
		 * THE MENU'S TEARDOWN WRITES LAND IN THEIR OWN MACROTASK, so at the instant
		 * this read, the keyboard can be mid-flight - on `body`, the menu item just
		 * detached - while the restore (the trigger write the drawer's claim answers
		 * into the pane) is still queued: measured in a jsdom probe against these
		 * components, it was delivered AFTER the click's own awaited act in 5 of 10
		 * runs, and reading that transient is what made this cell flake under load.
		 * The contract is the SETTLED state - the claim answers the restore whenever
		 * it is delivered - so the pin waits for the keyboard to land, bounded; a
		 * regression that leaves it on the trigger or `body` still fails it (the
		 * late-write fixture, in the Q1/M1 case below, stages that deterministically).
		 */
		for (
			let i = 0;
			i < 8 && !surface.contains(api.document.activeElement);
			i += 1
		)
			await new Promise((resolve) => setTimeout(resolve, 0));
		assert.ok(
			surface.contains(api.document.activeElement),
			"the entry move put the keyboard in the pane (the empty chain's last resort is the surface)",
		);

		/* (d) STRANDED CLOSE: Escape on the landing returns the keyboard to the trigger. */
		act(() => {
			api.document.activeElement.dispatchEvent(
				new api.window.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
				}),
			);
		});
		await act(async () => {});
		assert.equal(
			useUiPreferencesStore.getState().isAskDrawerOpen,
			false,
			"Escape closed it",
		);
		assert.equal(
			api.document.activeElement,
			api.$('[aria-label="Conversation actions"]'),
			"a stranded close returns the keyboard to the trigger that was pressed",
		);

		/*
		 * (c) WHILE OPEN, THE ROW CLOSES - no request written, and the slot left EMPTY
		 * (#1079, UX round 1 U1/U2): this row is a toggle the user pressed, so it means here
		 * what it means on the rail item and on the drawer's X.
		 *
		 * THE SLOT IS SET UP BOUND AND EXPLICITLY, the panel-rail bound cell's own state
		 * (Browser in the slot and in the conversation's memory), for two reasons: the borrow
		 * is invisible in bound mode - the memory holds the answer, so nothing is written to
		 * `askDrawerEvictedPane` - and a cell that let the store's leftover bind decide which
		 * arm it walked would be measuring whatever the previous cell left behind. In bound
		 * mode the give-back would PROJECT the memory entry and the press must RETRACT it, so
		 * this is the arm where a missing `dismissSlot` is visible as a pane that returns.
		 */
		api.store({
			rightSlotKey: "session-1",
			rightSlotMemory: [["session-1", "browser"]],
			isBrowserPaneOpen: true,
		});
		await act(async () => {});
		assert.equal(
			useUiPreferencesStore.getState().isBrowserPaneOpen,
			true,
			"the browser holds the slot before the row's open",
		);
		await openMenu();
		await api.click(rowNamed("Open asks"));
		await act(async () => {});
		assert.equal(
			useUiPreferencesStore.getState().isAskDrawerOpen,
			true,
			"reopened",
		);
		assert.equal(
			useUiPreferencesStore.getState().isBrowserPaneOpen,
			false,
			"over the browser's claim: the drawer took the slot from it",
		);
		await openMenu();
		const closeRow = rowNamed("Close asks");
		assert.ok(
			closeRow,
			"while this scope's drawer is open the row flips to Close asks",
		);
		await api.click(closeRow);
		await act(async () => {});
		assert.equal(
			useUiPreferencesStore.getState().isAskDrawerOpen,
			false,
			"the close arm closed it",
		);
		assert.equal(
			useUiPreferencesStore.getState().askOpenIntent,
			null,
			"the close arm writes no request",
		);
		assert.equal(
			useUiPreferencesStore.getState().isBrowserPaneOpen,
			false,
			"and the browser does NOT come back: one label, one outcome - the close the user asked for empties the slot here exactly as it does on the rail item",
		);
		assert.deepEqual(
			useUiPreferencesStore.getState().rightSlotMemory,
			[],
			"closed is the ABSENCE of an entry, so the conversation remembers no pane: the row's close RETRACTED it rather than projecting it",
		);

		/* (b) THE REQUEST IS NOT INHERITABLE: a non-user open over the empty queue still closes. */
		closes = 0;
		act(() => {
			useUiPreferencesStore.getState().setAskDrawerOpen(true, "session");
		});
		await act(async () => {});
		assert.equal(
			closes,
			1,
			"the policy-shaped open over the empty queue fired the auto-close, once",
		);
		assert.equal(
			useUiPreferencesStore.getState().isAskDrawerOpen,
			false,
			"and the drawer did not stay",
		);
	});
});

/*
 * THE ASKS CHORD OPENS A DRAWER THAT STAYS (QA round 1 Q1 = agent review m1 of the
 * always-visible rail). A chord leaves focus where it was, so the drawer cannot read
 * the press off a focused door; before the fix it took the mount for a carried flag
 * and auto-closed it over an empty or unsupported queue - the chord did nothing.
 * Driven end to end: the real dispatcher, the real store and the real drawer, over
 * the three frames a chord can meet - the fleet's empty answer and its failed read
 * (D4's resolved, unpublished frame) on a draft, and an empty session queue on a
 * conversation.
 */
test("the asks chord opens a drawer that survives an empty or unsupported queue (Q1/m1)", async () => {
	for (const [label, scope, frame] of [
		[
			"fleet, empty",
			"fleet",
			{ asks: [], asks_open: 0, asks_truncated: false },
		],
		["fleet, read failed (D4)", "fleet", FLEET_ASKS_UNAVAILABLE_FRONTEND],
		[
			"session, empty",
			"session",
			{ asks: [], asks_open: 0, asks_truncated: null },
		],
	]) {
		await mount(async (api) => {
			reset(api, scope === "fleet" ? DRAFT : DRAWABLE);
			api.store({ shortcutBindings: { "panel.ask": "primary+g" } });
			act(() => {
				useCanonicalSessionsStore.setState({
					activeDraftKey: null,
					activeSessionId: scope === "fleet" ? null : "session-1",
				});
			});
			let closes = 0;
			const Harness = () => {
				useKeymapShortcuts();
				const open = useUiPreferencesStore((s) => s.isAskDrawerOpen);
				const drawn = useUiPreferencesStore((s) => s.askDrawerScope);
				return open
					? React.createElement(AskDrawer, {
							frontend: frame,
							scope: drawn,
							onClose: () => {
								closes += 1;
								useUiPreferencesStore.getState().setAskDrawerOpen(false, drawn);
							},
						})
					: null;
			};
			await api.render(React.createElement(Harness));
			/* ⌘G with focus on <body>: what a chord press leaves behind. */
			const chord = async () => {
				act(() => {
					api.document.body.dispatchEvent(
						new api.window.KeyboardEvent("keydown", {
							key: "g",
							metaKey: true,
							bubbles: true,
							cancelable: true,
						}),
					);
				});
				await act(async () => {});
			};
			await chord();
			await act(async () => {});
			const state = useUiPreferencesStore.getState();
			assert.equal(
				state.isAskDrawerOpen,
				true,
				`${label}: the chord opened the drawer and it stayed`,
			);
			assert.equal(
				state.askDrawerScope,
				scope,
				`${label}: in the route's scope`,
			);
			assert.equal(
				closes,
				0,
				`${label}: the auto-close did not take the chord's open`,
			);
			assert.ok(
				api.$("[data-lo-ask-surfaces]"),
				`${label}: the drawer is drawn`,
			);
			assert.equal(
				state.askOpenIntent,
				null,
				`${label}: the request was consumed by the mount`,
			);
			/* The same chord closes it again: a toggle, as the door is. */
			await chord();
			assert.equal(
				useUiPreferencesStore.getState().isAskDrawerOpen,
				false,
				`${label}: the chord closes it`,
			);
			assert.equal(
				useUiPreferencesStore.getState().askOpenIntent,
				null,
				`${label}: the close files no request`,
			);
		});
	}
});

/*
 * THE CLAIM ANSWERS A RESTORE THAT LANDS AFTER IT WOULD HAVE SETTLED (round-2
 * M1), and once settled it is the user's, not the drawer's (round-2 N2).
 *
 * WHY IT EXISTS. The settle used to be "one macrotask of quiet after the last
 * write landed the keyboard inside" - and the restore the menu performs is
 * itself a `setTimeout(0)` its teardown queues, so on a loaded host the
 * delivery can land AFTER that beat: the claim settled, the late write put the
 * keyboard back on the `…` trigger, and the drawer stayed open with the
 * keyboard outside it - the exact state the Q1 case above exists to prevent.
 * This stages the loaded ordering deterministically (a scratch probe reproduced
 * the old failure 3/3 under it): the restore is deferred one macrotask, with a
 * second write one macrotask behind the first - the burst shape the teardown
 * itself produces (two trigger writes in a StrictMode pass). The claim must
 * answer both writes and end with the keyboard in the pane; then, with the
 * claim settled, a deliberate focus on the trigger must STICK - the disarm is
 * what stops the claim fighting a user's Tab (N2).
 */
test("a restore that lands after the drawer's own settle still ends inside, and a later move to the trigger sticks (Q1/M1)", async () => {
	await mount(async (api) => {
		reset(api);
		const emptyFrame = { asks: [], asks_open: 0, asks_truncated: null };
		const Harness = () => {
			const asksOpen = useUiPreferencesStore(
				(s) => s.isAskDrawerOpen && s.askDrawerScope === "session",
			);
			const drawerOpen = useUiPreferencesStore((s) => s.isAskDrawerOpen);
			return React.createElement(
				React.Fragment,
				null,
				React.createElement(
					TooltipProvider,
					null,
					React.createElement(ChatHeader, {
						agentName: "Core",
						onOpenOptions: () => {},
						asksScope: "session",
						asksOpen,
						onToggleAsks: () => {
							const state = useUiPreferencesStore.getState();
							if (state.isAskDrawerOpen && state.askDrawerScope === "session") {
								/*
								 * THE ROW'S CLOSE IS THE PRESSED KIND (#1079): its source shape is pinned in
								 * `fleet-asks.test.mjs`, and what it DOES is asserted below - the slot is
								 * left empty rather than handed back.
								 */
								state.setAskDrawerOpen(false, "session", {
									dismissSlot: true,
								});
								return;
							}
							state.setAskDrawerOpen(true, "session");
							state.requestAskOpen("session");
						},
					}),
				),
				drawerOpen
					? React.createElement(AskDrawer, {
							frontend: emptyFrame,
							scope: "session",
							/* The same forwarding door as the Q1 harness above (#1079). */
							onClose: (options) => {
								useUiPreferencesStore
									.getState()
									.setAskDrawerOpen(false, "session", options);
							},
						})
					: null,
			);
		};
		const openMenu = async () => {
			const trigger = api.$('[aria-label="Conversation actions"]');
			assert.ok(trigger, "the menu trigger is in the header");
			act(() => {
				trigger.dispatchEvent(
					new api.window.KeyboardEvent("keydown", {
						key: "Enter",
						bubbles: true,
						cancelable: true,
					}),
				);
			});
			await act(async () => {});
		};
		const rowNamed = (text) =>
			api
				.$$('[role="menuitem"]')
				.find((item) => item.textContent.trim() === text);
		const turns = async (n) => {
			for (let i = 0; i < n; i += 1)
				await new Promise((resolve) => setTimeout(resolve, 0));
		};

		await api.render(React.createElement(Harness));

		await openMenu();
		const trigger = api.$('[aria-label="Conversation actions"]');
		assert.ok(trigger, "the menu trigger is in the header");
		/*
		 * THE LOADED ORDERING, STAGED: the restore - the trigger's own focus write
		 * on the menu's way out - is deferred one macrotask, and a second write
		 * follows one macrotask behind the first. Under the old single-beat settle
		 * this ends with the keyboard ON THE TRIGGER, drawer open.
		 */
		const restore = trigger.focus.bind(trigger);
		let deferred = false;
		trigger.focus = () => {
			if (deferred) return restore();
			deferred = true;
			setTimeout(() => {
				restore();
				setTimeout(() => restore(), 0);
			}, 0);
		};
		await api.click(rowNamed("Open asks"));
		await act(async () => {});
		await turns(12);
		assert.ok(
			deferred,
			"the fixture engaged: the teardown wrote focus to the trigger, deferred",
		);
		const surface = api.$("[data-lo-ask-surfaces]");
		assert.equal(
			useUiPreferencesStore.getState().isAskDrawerOpen,
			true,
			"the row opened the drawer over the empty queue",
		);
		assert.ok(surface, "the door-opened mount is not auto-closed");
		assert.ok(
			surface.contains(api.document.activeElement),
			"the late restore was answered: the keyboard is in the pane, never back on the trigger with the drawer open",
		);
		/*
		 * AND THE DISARM IS REAL (N2): the claim's chain is all macrotasks and all
		 * of them are delivered above, so it has settled - a deliberate focus on
		 * the trigger is the user's and must stick. A claim still armed would
		 * bounce it into the pane.
		 */
		const triggerNow = api.$('[aria-label="Conversation actions"]');
		triggerNow.focus();
		await turns(4);
		assert.equal(
			api.document.activeElement,
			triggerNow,
			"a settled claim does not bounce a deliberate move to the trigger",
		);
		assert.equal(
			useUiPreferencesStore.getState().isAskDrawerOpen,
			true,
			"and the drawer stays up",
		);
	});
});

/*
 * THE RAIL'S GEOMETRY IS A PIXEL CLAIM, AND JSDOM HAS NO LAYOUT, so these pin the
 * SPELLINGS the measured frames depend on (design round 1, D2/D3/D4; the bar's
 * spelling re-measured when the rail's hairline came out, #1008). The numbers
 * they stand for were read from the rendered stories, not from this file, and are
 * in the PR thread: first glyph centre y=52 (= the `...`, the pane close and the
 * scope switch), bar x=88-90 against ring x=91-93, badge 14px with its ring 2px
 * inside the host.
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

test("the lit bar is clear of the focus ring, flush with the rail's leading edge (D2)", () => {
	const item = read(
		"src/renderer/src/shared/components/navigation/panel-rail-item.tsx",
	);
	assert.ok(
		item.includes("before:-start-[6px]"),
		"the bar is 6px outside the 32px control - the item is centred in the 44px rail, so the gutter is 6px a side - and its 2px width therefore starts ON the rail's leading (inline-start) edge in either writing direction",
	);
	assert.ok(
		!item.includes("before:-left-[6px]") &&
			!item.includes("before:-right-[6px]"),
		"the bar must be anchored to the rail's inline-start edge, not a physical side: in RTL the rail stands at the window's left and the content boundary is its right edge",
	);
	assert.ok(
		!item.includes("before:-left-[6.5px]"),
		"the 6.5px offset belonged to the 5.5px gutter the 1px border left plus the border: with the border gone it would put the bar half a pixel outside the rail, straddling the pane",
	);
	assert.ok(
		item.includes("focus-visible:outline-offset-1!"),
		"the ring sits at a 1px offset, so it occupies 1px-3px outside the control and the bar ends 4px outside it: a 1px gap",
	);
});

test("the count badge is the small mark anchored to the corner (D4)", () => {
	const rail = read(
		"src/renderer/src/shared/components/navigation/panel-rail.tsx",
	);
	assert.match(rail, /absolute -top-0\.5 -end-0\.5 flex/);
	assert.ok(
		rail.includes("text-meta-sm"),
		"the type token, not a literal size",
	);
	assert.ok(!rail.includes("text-[0.6875rem]"));
	assert.match(rail, /h-3\.5 min-w-3\.5/);
	assert.ok(
		rail.includes("ring-2 ring-surface"),
		"the ring still names the rail's ground",
	);
});

/*
 * THE PANE'S BAR AND EMPTY STATE AT NARROW WIDTHS (design round 2, D12 / D13). Measured
 * in the rendered stories, so these pin the spellings the readings depend on: the title
 * sheds at 330px of pane (the switch's labels need ~325, so a shed at 300 left a band
 * where the labels truncated before the title went), and the empty state's two buttons
 * wrap instead of clipping when the pane is 220px.
 */
test("the title sheds before the switch's labels truncate, and the empty state's buttons wrap (D12/D13)", () => {
	const pane = read(
		"src/renderer/src/features/browser/components/browser-pane.tsx",
	);
	assert.equal(
		(pane.match(/@max-\[330px\]\/bpane/g) ?? []).length,
		3,
		"the title and both switch triggers use the one threshold",
	);
	assert.ok(
		!pane.includes("@max-[300px]/bpane"),
		"no rung is left at the old threshold",
	);
	const surface = read(
		"src/renderer/src/features/browser/components/browser-surface.tsx",
	);
	assert.ok(
		surface.includes(
			'className="flex flex-wrap items-center justify-center gap-2"',
		),
		"the empty state's button row wraps",
	);
});
