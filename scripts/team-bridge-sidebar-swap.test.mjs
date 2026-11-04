#!/usr/bin/env node
/**
 * The Team Bridge sidebar swap (operator, 2026-11-03): on `/team-bridge` the
 * shell's left column hosts the bridge rail INSTEAD of the app navigation, with
 * a Back row on top, so the window has one sidebar rather than two.
 *
 * WHAT THIS PROVES, by mounting the real `ChatLayout` in jsdom:
 *  - route mode mounts no `SidebarNavigation` and exactly one host column, which
 *    carries the shell's `sidebar` glass region and the `surface` ground;
 *  - a route rendered in `content` portals into that column (and its React state
 *    and events stay in the route's tree), while the same route outside the
 *    shell renders its fallback inline;
 *  - the keeper (`StripFeedKeeper` in the app) stays mounted in route mode, so
 *    the catalogue feed keeps exactly one subscription while the nav is gone;
 *  - route mode docks even when the user's preference is the collapsed strip,
 *    and leaves that preference untouched;
 *  - the Back row's leave rule: history when this window has an entry before
 *    the current one, `/chat` on a cold open (deep link or notification),
 *    including after the page's `replace` consumed the deep-link params.
 *
 * And by reading the source, the pins that keep the page honest: the hosted
 * aside paints no glass of its own (no double alpha), the thread takeover starts
 * at the container edge when hosted, and the early returns still draw the column.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const memory = new Map();
globalThis.localStorage = {
	getItem: (key) => (memory.has(key) ? memory.get(key) : null),
	setItem: (key, value) => void memory.set(key, String(value)),
	removeItem: (key) => void memory.delete(key),
	clear: () => void memory.clear(),
	key: (index) => [...memory.keys()][index] ?? null,
	get length() {
		return memory.size;
	},
};

const bundle = await build({
	stdin: {
		contents: `
			import { MemoryRouter } from "react-router-dom";
			import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			import { ChatLayout } from "./src/renderer/src/shared/components/common/chat-layout";
			import { InLeftSidebarHost } from "./src/renderer/src/shared/components/navigation/left-sidebar-host";
			import { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";
			import { teamBridgeLeaveTarget } from "./src/renderer/src/features/team-bridge/team-bridge-leave";
			import { TeamBridgeBackRow } from "./src/renderer/src/features/team-bridge/team-bridge-route-column";
			import { useNavigationGestures } from "./src/renderer/src/shared/hooks/use-navigation-gestures";
			import { HashRouter, Routes, Route, useLocation, useNavigate, useSearchParams } from "react-router-dom";
			export { ChatLayout, InLeftSidebarHost, useUiPreferencesStore, teamBridgeLeaveTarget, TeamBridgeBackRow, useNavigationGestures, HashRouter, Routes, Route, useLocation, useNavigate, useSearchParams, MemoryRouter, QueryClient, QueryClientProvider };
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	mainFields: ["module", "main"],
	conditions: ["import"],
	external: ["react", "react/jsx-runtime", "react-dom"],
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45998" };',
	},
	loader: { ".css": "empty", ".png": "empty" },
	jsx: "automatic",
});
const bundlePath = new URL("./_tb-sidebar-swap.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	ChatLayout,
	InLeftSidebarHost,
	useUiPreferencesStore,
	teamBridgeLeaveTarget,
	TeamBridgeBackRow,
	useNavigationGestures,
	HashRouter,
	Routes,
	Route: RouterRoute,
	useLocation,
	useNavigate,
	useSearchParams,
	MemoryRouter,
	QueryClient,
	QueryClientProvider,
} = await import(bundlePath.href);
await unlink(bundlePath);

const el = React.createElement;

/** A stand-in for the app navigation: a mark the test can look for. */
const Nav = () => el("nav", { "data-test-nav": "" }, "app navigation");

/** A stand-in for the keeper: counts how many are mounted. */
let keepers = 0;
const Keeper = () => {
	React.useEffect(() => {
		keepers += 1;
		return () => {
			keepers -= 1;
		};
	}, []);
	return null;
};

/**
 * A route that owns the column: its rail content carries state (a counter) so
 * the test can prove the portal keeps the route's React tree, not the host's.
 */
const Route = () => {
	const [presses, setPresses] = React.useState(0);
	return el(
		"div",
		{ "data-test-route": "" },
		el(
			InLeftSidebarHost,
			{
				fallback: el("aside", { "data-test-inline": "" }, "inline rail"),
			},
			el(
				"button",
				{
					type: "button",
					"data-test-rail": "",
					onClick: () => setPresses((n) => n + 1),
				},
				`hosted rail ${presses}`,
			),
		),
		el("output", { "data-test-presses": "" }, String(presses)),
	);
};

const mount = async (tree, { collapsed = false } = {}) => {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		pretendToBeVisual: true,
		url: "http://localhost/#/team-bridge",
	});
	const previous = {
		window: globalThis.window,
		document: globalThis.document,
		navigator: globalThis.navigator,
		act: globalThis.IS_REACT_ACT_ENVIRONMENT,
		ResizeObserver: globalThis.ResizeObserver,
		HTMLElement: globalThis.HTMLElement,
	};
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	Object.defineProperty(globalThis, "navigator", {
		value: dom.window.navigator,
		configurable: true,
	});
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	dom.window.matchMedia = (query) => ({
		matches: false,
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
	});
	Object.defineProperty(dom.window, "innerWidth", {
		value: 1380,
		configurable: true,
	});
	useUiPreferencesStore.setState({ isSidebarCollapsed: collapsed });
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(dom.window.document.getElementById("root"));
	await act(async () => {
		root.render(
			el(QueryClientProvider, { client }, el(MemoryRouter, null, tree)),
		);
	});
	await act(async () => {});
	return {
		document: dom.window.document,
		teardown: async () => {
			await act(async () => root.unmount());
			client.clear();
			dom.window.close();
			globalThis.window = previous.window;
			globalThis.document = previous.document;
			Object.defineProperty(globalThis, "navigator", {
				value: previous.navigator,
				configurable: true,
			});
			globalThis.ResizeObserver = previous.ResizeObserver;
			globalThis.HTMLElement = previous.HTMLElement;
			globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
		},
	};
};

/** The shell's left column: the first child of the layout's flex row. */
const sidebarColumn = (document) =>
	document.querySelector("[data-titlebar-lane]").nextElementSibling
		.firstElementChild;

test("route mode: one sidebar - the host replaces the navigation, and the route fills it", async () => {
	const { document, teardown } = await mount(
		el(ChatLayout, {
			sidebar: el(Nav),
			content: el(Route),
			routeSidebar: { keeper: el(Keeper) },
		}),
	);
	try {
		assert.equal(
			document.querySelector("[data-test-nav]"),
			null,
			"the app navigation is not mounted on a route that owns the column",
		);
		const hosts = document.querySelectorAll("[data-route-sidebar-host]");
		assert.equal(hosts.length, 1, "exactly one host column");
		const host = hosts[0];
		assert.equal(host.getAttribute("data-glass-region"), "sidebar");
		for (const cls of ["panel-top-pad", "bg-surface", "h-full"]) {
			assert.ok(
				host.classList.contains(cls),
				`the host owns the panel contract (${cls})`,
			);
		}
		assert.ok(
			sidebarColumn(document).contains(host),
			"the host sits in the shell's left column",
		);
		const rail = host.querySelector("[data-test-rail]");
		assert.ok(rail, "the route's rail is portaled into the host");
		assert.equal(
			document.querySelector("[data-test-inline]"),
			null,
			"and the inline fallback is not drawn as well",
		);
		assert.equal(
			document.querySelector("[data-test-route]").contains(rail),
			false,
			"the rail is NOT inside the route's own DOM (one column, not two)",
		);
		await act(async () => {
			rail.click();
		});
		assert.equal(
			document.querySelector("[data-test-presses]").textContent,
			"1",
			"a press in the host updates the ROUTE's state: the portal keeps the React tree",
		);
		assert.equal(keepers, 1, "the keeper stays mounted in the nav's place");
	} finally {
		await teardown();
	}
	assert.equal(keepers, 0);
});

test("nav mode: the navigation is drawn and a route with a host wrapper renders inline", async () => {
	const { document, teardown } = await mount(
		el(ChatLayout, { sidebar: el(Nav), content: el(Route) }),
	);
	try {
		assert.ok(document.querySelector("[data-test-nav]"));
		assert.equal(document.querySelector("[data-route-sidebar-host]"), null);
		assert.ok(
			document.querySelector("[data-test-route] [data-test-inline]"),
			"no host offered: the fallback renders where the route stands",
		);
		assert.equal(document.querySelector("[data-test-rail]"), null);
	} finally {
		await teardown();
	}
});

test("outside the shell (stories, static markup) the route renders its inline column", async () => {
	const { document, teardown } = await mount(el(Route));
	try {
		assert.ok(document.querySelector("[data-test-inline]"));
		assert.equal(document.querySelector("[data-test-rail]"), null);
	} finally {
		await teardown();
	}
});

test("route mode docks over a collapsed preference, and leaves the preference alone", async () => {
	const { document, teardown } = await mount(
		el(ChatLayout, {
			sidebar: el(Nav),
			content: el(Route),
			routeSidebar: {},
		}),
		{ collapsed: true },
	);
	try {
		const width = sidebarColumn(document).style.width;
		assert.notEqual(
			width,
			"56px",
			"no 56px strip for a rail with no strip form",
		);
		assert.equal(width, "260px", "the user's docked width (default 260)");
		assert.equal(
			useUiPreferencesStore.getState().isSidebarCollapsed,
			true,
			"the preference is not rewritten; it applies again on leaving the route",
		);
	} finally {
		await teardown();
	}
	const nav = await mount(
		el(ChatLayout, { sidebar: el(Nav), content: el(Route) }),
		{ collapsed: true },
	);
	try {
		assert.equal(
			sidebarColumn(nav.document).style.width,
			"56px",
			"control: the same preference is the strip on every other route",
		);
	} finally {
		await nav.teardown();
	}
});

test("Back goes through history only when this window has an entry before this one", () => {
	assert.equal(teamBridgeLeaveTarget({ idx: 3, key: "k" }), "history");
	assert.equal(teamBridgeLeaveTarget({ idx: 1 }), "history");
	assert.equal(
		teamBridgeLeaveTarget({ idx: 0, key: "abc123" }),
		"/chat",
		"a deep link whose params were consumed with replace has a real key but is still the first entry",
	);
	assert.equal(teamBridgeLeaveTarget({ idx: 0 }), "/chat");
	assert.equal(teamBridgeLeaveTarget(null), "/chat");
	assert.equal(teamBridgeLeaveTarget(undefined), "/chat");
	assert.equal(teamBridgeLeaveTarget({ idx: "2" }), "/chat");
});

/* The source pins, at module scope (biome `useTopLevelRegex`). */
const BACK_CHORD = /^(⌘|Ctrl\+)\[$/;
const PIN_1 = /data-glass-region/;
const PIN_2 = /bg-surface|panel-top-pad|w-72/;
const PIN_3 =
	/data-glass-region="page-sidebar"[\s\S]{0,700}className="panel-top-pad flex w-72 shrink-0 flex-col bg-surface"/;
const PIN_4 = /railHosted \? "start-0" : "start-72"/;
const PIN_5 = /const railHosted = useLeftSidebarHosted\(\);/;
const PIN_6 =
	/if \(gatePending\)\s*return \(\s*<>\s*\{earlyColumn\}\s*<TeamBridgeGateLoading \/>/;
const PIN_7 =
	/if \(eligibility\)\s*return \(\s*<>\s*\{earlyColumn\}\s*<TeamBridgeEligibilityPanel/;
const PIN_8 =
	/const earlyColumn = \(\s*<TeamBridgeRouteColumn inline=\{null\}>/;
const PIN_9 = /useTextDirection\(\) === "rtl" \? ArrowRight : ArrowLeft/;
const PIN_10 = /aria-keyshortcuts=\{chord\}/;
const PIN_11 = /navigationShortcutLabel\(\s*"back"/;
const PIN_12 = /teamBridgeLeaveTarget\(window\.history\.state\)/;
const PIN_13 = /<AttentionBadge\s+count=\{attention\}/;
const PIN_14 = /<SidebarFoot \/>/;
const PIN_15 =
	/const routeOwnsSidebar =\s*bridgeState === "enabled" && pathname\.startsWith\(TEAM_BRIDGE_PATH\);/;
const PIN_16 =
	/routeSidebar=\{routeOwnsSidebar && \{ keeper: <StripFeedKeeper \/> \}\}/;
const PIN_17 = /isSidebarCollapsed && !routeOwnsSidebar \? "true" : "false"/;

const read = (path) => readFileSync(path, "utf8");
const PAGE = "src/renderer/src/features/team-bridge/team-bridge-page.tsx";
const COLUMN =
	"src/renderer/src/features/team-bridge/team-bridge-route-column.tsx";
const APP = "src/renderer/src/app.tsx";

test("the hosted rail paints no glass of its own: the host's `sidebar` region is the only alpha", () => {
	const page = read(PAGE);
	const hosted = page.slice(
		page.indexOf('data-team-bridge-rail="hosted"') - 40,
	);
	const aside = hosted.slice(0, hosted.indexOf(">"));
	assert.doesNotMatch(aside, PIN_1);
	assert.doesNotMatch(aside, PIN_2);
	// The inline copy keeps its own column contract for stories and SSR.
	assert.match(page, PIN_3);
});

test("the thread takeover starts at the container edge when the rail is hosted", () => {
	const page = read(PAGE);
	assert.match(page, PIN_4);
	assert.match(page, PIN_5);
});

test("the early states still own the column, so a gated reader always has a way out", () => {
	const page = read(PAGE);
	assert.match(page, PIN_6);
	assert.match(page, PIN_7);
	assert.match(page, PIN_8);
});

test("the column's Back row: direction-aware arrow, the chord, and the attention it stands in for", () => {
	const column = read(COLUMN);
	assert.match(column, PIN_9);
	assert.match(column, PIN_10);
	assert.match(column, PIN_11);
	assert.match(column, PIN_12);
	assert.match(column, PIN_13);
	assert.match(column, PIN_14);
});

test("the app swaps on the bridge route only, keeps the feed alive, and docks the titlebar", () => {
	const app = read(APP);
	assert.match(app, PIN_15);
	assert.match(app, PIN_16);
	assert.match(app, PIN_17);
});

/**
 * THE REAL PATH: the app's own router (`HashRouter`, as `main.tsx` mounts it),
 * the app's own gesture hook, and the shipped Back row - so `history.state.idx`
 * is written by React Router itself, not by a fixture.
 */
const mountApp = async (url) => {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		pretendToBeVisual: true,
		url,
	});
	const saved = {
		window: globalThis.window,
		document: globalThis.document,
		navigator: globalThis.navigator,
		act: globalThis.IS_REACT_ACT_ENVIRONMENT,
		HTMLElement: globalThis.HTMLElement,
	};
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	Object.defineProperty(globalThis, "navigator", {
		value: dom.window.navigator,
		configurable: true,
	});
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	dom.window.matchMedia = () => ({
		matches: false,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
	});
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, enabled: false } },
	});
	let go = null;
	const Where = () => {
		const location = useLocation();
		go = useNavigate();
		return el("output", { "data-where": "" }, location.pathname);
	};
	/* The page's own deep-link consumption: params read once, then replaced. */
	const Bridge = () => {
		const [params, setParams] = useSearchParams();
		React.useEffect(() => {
			if (params.size > 0) setParams({}, { replace: true });
		}, [params, setParams]);
		return el(TeamBridgeBackRow);
	};
	const App = () => {
		useNavigationGestures();
		return el(
			React.Fragment,
			null,
			el(Where),
			el(
				Routes,
				null,
				el(RouterRoute, { path: "/team-bridge", element: el(Bridge) }),
				el(RouterRoute, { path: "*", element: null }),
			),
		);
	};
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(dom.window.document.getElementById("root"));
	await act(async () => {
		root.render(
			el(QueryClientProvider, { client }, el(HashRouter, null, el(App))),
		);
	});
	await act(async () => {});
	const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
	return {
		window: dom.window,
		where: () => dom.window.document.querySelector("[data-where]").textContent,
		navigate: async (to) => {
			await act(async () => go(to));
		},
		press: async (target) => {
			await act(async () => {
				target();
				await settle();
			});
		},
		teardown: async () => {
			await act(async () => root.unmount());
			client.clear();
			dom.window.close();
			globalThis.window = saved.window;
			globalThis.document = saved.document;
			Object.defineProperty(globalThis, "navigator", {
				value: saved.navigator,
				configurable: true,
			});
			globalThis.HTMLElement = saved.HTMLElement;
			globalThis.IS_REACT_ACT_ENVIRONMENT = saved.act;
		},
	};
};

const backButton = (app) =>
	app.window.document.querySelector("[data-team-bridge-back]");
const chord = (app) =>
	app.window.document.dispatchEvent(
		new app.window.KeyboardEvent("keydown", {
			key: "[",
			metaKey: true,
			ctrlKey: true,
			bubbles: true,
			cancelable: true,
		}),
	);

test("Back returns to the route the reader came from (button and ⌘[ alike)", async () => {
	/* /chat -> /settings -> /team-bridge: a double back would land on /chat. */
	const app = await mountApp("http://localhost/#/chat");
	try {
		await app.navigate("/settings");
		await app.navigate("/team-bridge");
		assert.equal(app.where(), "/team-bridge");
		await app.press(() => backButton(app).click());
		assert.equal(app.where(), "/settings", "the button goes back in history");

		await app.navigate("/team-bridge");
		await app.press(() => chord(app));
		assert.equal(
			app.where(),
			"/settings",
			"the chord goes back once - the global hook stood down, so it did not go back twice",
		);
	} finally {
		await app.teardown();
	}
});

test("Back on a deep link (the window opened on the route) goes to /chat, and so does ⌘[", async () => {
	const deepLink =
		"http://localhost/#/team-bridge?tenant=tnt_1&conversation=bcv_1";
	const app = await mountApp(deepLink);
	try {
		assert.equal(app.where(), "/team-bridge");
		assert.equal(
			app.window.location.hash,
			"#/team-bridge",
			"the page consumed the params with replace, as the real page does",
		);
		await app.press(() => backButton(app).click());
		assert.equal(app.where(), "/chat");
	} finally {
		await app.teardown();
	}
	const again = await mountApp(deepLink);
	try {
		await again.press(() => chord(again));
		assert.equal(again.where(), "/chat");
	} finally {
		await again.teardown();
	}
});

test("the Back row names the action, carries the chord, and uses the leave keys", async () => {
	const app = await mountApp("http://localhost/#/team-bridge");
	try {
		const button = backButton(app);
		assert.equal(button.getAttribute("aria-label"), "Leave Team Bridge");
		assert.match(button.getAttribute("aria-keyshortcuts"), BACK_CHORD);
		assert.equal(button.textContent.trim(), "Back");
	} finally {
		await app.teardown();
	}
});
