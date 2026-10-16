/**
 * The keydown router: the pure decision, and the registration it rides (#928).
 *
 *     node --test scripts/keymap-dispatch.test.mjs
 *
 * WHY THIS FILE EXISTS. The router is the one place a chord becomes an action,
 * and its value is its ORDER: an editor's `preventDefault` wins, an overlay owns
 * its keys, a chord whose door is absent must not swallow the press — each rule
 * is the difference between a shortcut and a key the user needed. The decision
 * is pure (`keymapEventAction`), so the matrix below presses literal events at
 * it; the REGISTRATION is not pure, and the jsdom cells pin the property the
 * terminal carve-out silently depends on: the listener is registered in the
 * BUBBLE phase, so a descendant that calls `stopPropagation()` (xterm, for the
 * keys a shell consumes) keeps the router from ever firing — while the same
 * press from an ordinary element still reaches it.
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
const CACHE = join(ROOT, "node_modules", ".cache", "keymap-dispatch");
const bundle = await build({
	stdin: {
		contents: `
			export { useKeymapShortcuts, keymapEventAction } from "./src/renderer/src/shared/keymap/use-keymap-shortcuts";
			export { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";
			export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";
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
const bundlePath = join(CACHE, "keymap-dispatch.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const {
	keymapEventAction,
	useCanonicalSessionsStore,
	useKeymapShortcuts,
	useUiPreferencesStore,
} = await import(pathToFileURL(bundlePath).href);

/** A route every door is present on. */
const ROUTE = {
	mounted: true,
	session: true,
};

/** One press, as the decision reads it: a plain object, like the handler passes. */
const press = (overrides = {}) => ({
	key: "j",
	metaKey: true,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	repeat: false,
	isComposing: false,
	defaultPrevented: false,
	target: null,
	...overrides,
});

const source = (overrides = {}) => ({
	bindings: {},
	route: ROUTE,
	...overrides,
});

test("the match matrix: defaults, overrides, exact modifier sets", () => {
	// The console's default answers ⌘J / Ctrl+J.
	assert.equal(
		keymapEventAction(press(), source({ bindings: {} })),
		"panel.console",
	);
	assert.equal(
		keymapEventAction(press({ metaKey: false, ctrlKey: true }), source()),
		"panel.console",
	);
	// The canvas keeps its shipped chord as its default.
	assert.equal(
		keymapEventAction(press({ key: "c", shiftKey: true }), source()),
		"panel.canvas",
	);
	// An override MOVES an action: the default no longer matches, the override does.
	const rebound = source({ bindings: { "panel.console": "primary+u" } });
	assert.equal(
		keymapEventAction(press({ key: "u" }), rebound),
		"panel.console",
	);
	assert.equal(keymapEventAction(press(), rebound), null);
	// Exact modifier set: ⌘J is not ⌘⇧J, not ⌘⌥J.
	assert.equal(keymapEventAction(press({ shiftKey: true }), source()), null);
	assert.equal(keymapEventAction(press({ altKey: true }), source()), null);
	// An unbound action's chord is not a match, and an unknown chord is not ours.
	assert.equal(
		keymapEventAction(press({ key: "b", metaKey: true }), source()),
		null,
	);
	assert.equal(keymapEventAction(press({ key: "9" }), source()), null);
	/*
	 * The explicit no-chord state (U4) is INERT at dispatch: a cleared console
	 * never answers ⌘J, and the freed chord can be answered by another action
	 * instead — the whole point of clearing a defaulted action.
	 */
	const cleared = source({ bindings: { "panel.console": null } });
	assert.equal(keymapEventAction(press(), cleared), null);
	assert.equal(
		keymapEventAction(press({ key: "c", shiftKey: true }), cleared),
		"panel.canvas",
	);
	assert.equal(
		keymapEventAction(
			press(),
			source({
				bindings: { "panel.console": null, "panel.browser": "primary+j" },
			}),
		),
		"panel.browser",
	);
});

test("the bails, in the RFC's order", () => {
	// 1. Someone got here first.
	assert.equal(
		keymapEventAction(press({ defaultPrevented: true }), source()),
		null,
	);
	// 2. Holding the chord must not strobe; an IME composition is not a gesture.
	assert.equal(keymapEventAction(press({ repeat: true }), source()), null);
	assert.equal(keymapEventAction(press({ isComposing: true }), source()), null);
	// 3. No app modifier is not a chord this router answers.
	assert.equal(
		keymapEventAction(press({ metaKey: false, ctrlKey: false }), source()),
		null,
	);
	assert.equal(
		keymapEventAction(
			press({ key: "j", metaKey: false, ctrlKey: false, altKey: true }),
			source(),
		),
		null,
	);
});

test("an overlay owns its own keys (rule 4)", () => {
	const inDialog = {
		closest: (selector) =>
			String(selector).includes('[role="dialog"]') ? {} : null,
	};
	assert.equal(keymapEventAction(press({ target: inDialog }), source()), null);
	const inMenu = new (class {
		closest(selector) {
			return String(selector).includes('[role="menu"]') ? {} : null;
		}
	})();
	assert.equal(keymapEventAction(press({ target: inMenu }), source()), null);
	// An ordinary element (and a null target) answer to nobody: the chord acts.
	assert.equal(
		keymapEventAction(press({ target: { closest: () => null } }), source()),
		"panel.console",
	);
});

test("a door-absent action is a no-op: only a route with no chat surface has no doors", () => {
	// No chat surface at all: browser, canvas and console all stand down.
	const unmounted = { ...ROUTE, mounted: false };
	assert.equal(
		keymapEventAction(
			press({ key: "c", shiftKey: true }),
			source({ route: unmounted }),
		),
		null,
	);
	assert.equal(keymapEventAction(press(), source({ route: unmounted })), null);
	assert.equal(
		keymapEventAction(
			press({ key: "u" }),
			source({
				bindings: { "panel.ask": "primary+u" },
				route: unmounted,
			}),
		),
		null,
	);
	assert.equal(
		keymapEventAction(
			press({ key: "u" }),
			source({
				bindings: { "panel.ask": "primary+u" },
			}),
		),
		"panel.ask",
	);
});

test("every panel chord acts on a draft: all six doors are present wherever the rail is (D1)", () => {
	const draft = { mounted: true, session: false };
	const bindings = {
		"panel.run": "primary+u",
		"panel.ask": "primary+g",
		"panel.browser": "primary+h",
		"panel.console": "primary+i",
		"panel.canvas": "primary+e",
		"panel.code": "primary+d",
	};
	for (const [action, chord] of Object.entries(bindings)) {
		assert.equal(
			keymapEventAction(
				press({ key: chord.slice(-1) }),
				source({ bindings, route: draft }),
			),
			action,
			`${action} must act on a draft`,
		);
	}
});

/* ------------------------------------------------------------------ jsdom */

async function mount(run) {
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
		KeyboardEvent: window.KeyboardEvent,
		IS_REACT_ACT_ENVIRONMENT: true,
	};
	for (const [key, value] of Object.entries(shims)) {
		originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value,
		});
	}
	const root = createRoot(window.document.getElementById("root"));
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: (query) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener() {},
			removeListener() {},
			addEventListener() {},
			removeEventListener() {},
			dispatchEvent: () => false,
		}),
	});
	const host = ({ childRef }) => {
		useKeymapShortcuts();
		return React.createElement(
			"div",
			{ "data-testid": "host" },
			React.createElement("span", { "data-testid": "child", ref: childRef }),
		);
	};
	const api = {
		window,
		$: (selector) => window.document.querySelector(selector),
		dispatch: (target, init) => {
			act(() => {
				target.dispatchEvent(
					new window.KeyboardEvent("keydown", {
						key: "j",
						metaKey: true,
						bubbles: true,
						cancelable: true,
						...init,
					}),
				);
			});
		},
	};
	/* The store seeds the fixture the dispatcher reads at press time. */
	act(() => {
		useUiPreferencesStore.setState({
			shortcutBindings: {},
			rightSlotRoute: ROUTE,
			isConsolePaneOpen: false,
			isAskDrawerOpen: false,
			askDrawerScope: "session",
		});
		useCanonicalSessionsStore.setState({
			activeDraftKey: null,
			activeSessionId: "session-1",
		});
	});
	const ref = React.createRef();
	act(() => {
		root.render(React.createElement(host, { childRef: ref }));
	});
	await act(async () => {});
	try {
		await run(api, window, ref);
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

test("the router is registered in the BUBBLE phase: a descendant's stopPropagation keeps it from firing", async () => {
	await mount(async (api, window, ref) => {
		const child = api.$('[data-testid="child"]');
		/* 1. The ordinary path: a press from a descendant reaches the document
		   listener and the console's default chord runs its toggle. */
		api.dispatch(child, { key: "j" });
		assert.equal(
			useUiPreferencesStore.getState().isConsolePaneOpen,
			true,
			"the plain descendant press must reach the router",
		);
		/* Reset, then 2. the terminal's property: the descendant consumes the
		   press with `stopPropagation()`, and the router must never see it. A
		   CAPTURE-phase registration on `document` would have run BEFORE this
		   listener and fired anyway - which is exactly what this cell refuses. */
		act(() => {
			useUiPreferencesStore.setState({ isConsolePaneOpen: false });
		});
		const stopper = (event) => event.stopPropagation();
		child.addEventListener("keydown", stopper);
		try {
			api.dispatch(child, { key: "j" });
		} finally {
			child.removeEventListener("keydown", stopper);
		}
		assert.equal(
			useUiPreferencesStore.getState().isConsolePaneOpen,
			false,
			"a descendant that consumed the press must keep the router from firing",
		);
		/* And on a draft the chord still acts (D1): the pane opens to its "needs a
		   conversation" state, and no open request is filed - there is no working
		   directory to spawn a console in. */
		act(() => {
			useCanonicalSessionsStore.setState({ activeSessionId: null });
			useUiPreferencesStore.setState({
				rightSlotRoute: { mounted: true, session: false },
				consoleOpenIntent: null,
			});
		});
		api.dispatch(child, { key: "j" });
		assert.equal(useUiPreferencesStore.getState().isConsolePaneOpen, true);
		assert.equal(useUiPreferencesStore.getState().consoleOpenIntent, null);
	});
});

/*
 * THE CHORD IS THE SAME DOOR (#1079). `panel.ask` routes through the same
 * `togglePanelRailItem` the rail's item presses, so the chord's CLOSE has to be the
 * pressed kind too: an empty slot rather than the borrowed pane handed back. This
 * cell drives the real router (the registration, its door gate and the action), not
 * the store's writer directly.
 */
test("the panel.ask chord closes the slot the way the lit item does (#1079)", async () => {
	await mount(async (api) => {
		const child = api.$('[data-testid="child"]');
		const state = () => useUiPreferencesStore.getState();
		act(() => {
			useUiPreferencesStore.setState({
				shortcutBindings: { "panel.ask": "primary+u" },
				isBrowserPaneOpen: true,
			});
		});
		/* The press is the chord's own: meta on this host, which `primary` collapses. */
		api.dispatch(child, { key: "u" });
		assert.equal(state().isAskDrawerOpen, true, "the chord opens the drawer");
		assert.equal(
			state().isBrowserPaneOpen,
			false,
			"borrowing the slot from the browser",
		);
		api.dispatch(child, { key: "u" });
		assert.equal(state().isAskDrawerOpen, false);
		assert.equal(
			state().isBrowserPaneOpen,
			false,
			"and its close asks for an empty slot rather than handing the browser back",
		);
		/*
		 * AND THE SAME PRESS IN BOUND MODE (#1079, agent review round 1 R3). The chord is one
		 * path through `togglePanelRailItem`, so a chord that passed a different context - or
		 * stopped passing `dismissSlot` - would fail as the conversation's MEMORY entry
		 * surviving the close, which the unbound leg above cannot see: with no `rightSlotKey`
		 * there is no entry to retract and the reading would look right either way. This is the
		 * panel-rail bound cell's setup (Browser open, in the slot and in the memory).
		 */
		act(() => {
			useUiPreferencesStore.setState({
				rightSlotKey: "session-1",
				rightSlotMemory: [["session-1", "browser"]],
				isBrowserPaneOpen: true,
			});
		});
		api.dispatch(child, { key: "u" });
		assert.equal(
			state().isAskDrawerOpen,
			true,
			"the chord opens the drawer over the conversation's remembered browser",
		);
		assert.equal(state().isBrowserPaneOpen, false, "taking the slot from it");
		api.dispatch(child, { key: "u" });
		assert.equal(state().isAskDrawerOpen, false, "the second press closes");
		assert.equal(
			state().isBrowserPaneOpen,
			false,
			"and the browser still does not come back",
		);
		assert.deepEqual(
			state().rightSlotMemory,
			[],
			"because the chord's close RETRACTS the entry (`memoryDismiss`) rather than projecting it: switching away and back shows no panel, which is #1079's request",
		);
	});
});
