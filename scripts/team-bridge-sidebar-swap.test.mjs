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
			import { onTeamBridgeRoute } from "./src/renderer/src/features/team-bridge/use-team-bridge-notification-open";
			import { teamBridgeOpenPath } from "./src/shared/team-bridge-notify";
			import { HashRouter, Routes, Route, useLocation, useNavigate, useSearchParams } from "react-router-dom";
			export { ChatLayout, InLeftSidebarHost, useUiPreferencesStore, teamBridgeLeaveTarget, TeamBridgeBackRow, useNavigationGestures, onTeamBridgeRoute, teamBridgeOpenPath, HashRouter, Routes, Route, useLocation, useNavigate, useSearchParams, MemoryRouter, QueryClient, QueryClientProvider };
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
	onTeamBridgeRoute,
	teamBridgeOpenPath,
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

const mount = async (
	tree,
	{ collapsed = false, width = 1380, fleetDrawer = false } = {},
) => {
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
		value: width,
		configurable: true,
	});
	useUiPreferencesStore.setState({
		isSidebarCollapsed: collapsed,
		isAskDrawerOpen: fleetDrawer,
		askDrawerScope: fleetDrawer ? "fleet" : "session",
	});
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
		rerender: async (next) => {
			await act(async () => {
				root.render(
					el(QueryClientProvider, { client }, el(MemoryRouter, null, next)),
				);
			});
			await act(async () => {});
		},
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

test("the fleet asks drawer never squeezes a route-owned column to the strip (round 1, M1/Q2)", async () => {
	/*
	 * 1000px is inside the band (~936-1139px with no right rail) where an open
	 * fleet drawer makes the NAV yield to its 56px strip; the bridge rail has no
	 * strip form, so in route mode the column must stay docked.
	 */
	const routed = await mount(
		el(ChatLayout, { sidebar: el(Nav), content: el(Route), routeSidebar: {} }),
		{ width: 1000, fleetDrawer: true },
	);
	try {
		assert.equal(sidebarColumn(routed.document).style.width, "260px");
		assert.ok(routed.document.querySelector("[data-test-rail]"));
	} finally {
		await routed.teardown();
	}
	const nav = await mount(
		el(ChatLayout, { sidebar: el(Nav), content: el(Route) }),
		{ width: 1000, fleetDrawer: true },
	);
	try {
		assert.equal(
			sidebarColumn(nav.document).style.width,
			"56px",
			"control: on a nav route the same drawer still makes the nav yield",
		);
	} finally {
		await nav.teardown();
	}
});

test("⌘B is a no-op on a route-owned column, and its handle does not advertise it (U1)", async () => {
	const { document, teardown } = await mount(
		el(ChatLayout, { sidebar: el(Nav), content: el(Route), routeSidebar: {} }),
	);
	try {
		await act(async () => {
			document.dispatchEvent(
				new document.defaultView.KeyboardEvent("keydown", {
					key: "b",
					metaKey: true,
					ctrlKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		assert.equal(useUiPreferencesStore.getState().isSidebarCollapsed, false);
		const handle = document.querySelector('[role="separator"]');
		assert.ok(handle, "the column is still resizable");
		assert.equal(handle.getAttribute("aria-label"), "Resize the sidebar");
	} finally {
		await teardown();
	}
});

test("focus follows the swap when it was in the column, and only then (U2/Q3)", async () => {
	/* A nav with a focusable current row, as the real nav marks its destination. */
	const FocusNav = () =>
		el(
			"nav",
			null,
			el("button", { type: "button", "data-test-row": "chat" }, "Chat"),
			el(
				"button",
				{ type: "button", "aria-current": "page", "data-test-row": "current" },
				"Current",
			),
		);
	const shell = (routed) =>
		el(ChatLayout, {
			sidebar: el(FocusNav),
			content: el(Route),
			routeSidebar: routed ? {} : false,
		});
	const app = await mount(shell(false));
	try {
		const doc = app.document;
		doc.querySelector('[data-test-row="chat"]').focus();
		await app.rerender(shell(true));
		assert.equal(
			doc.activeElement?.getAttribute("data-test-rail"),
			"",
			"entry: the route column's first control has focus, not <body>",
		);
		await app.rerender(shell(false));
		assert.equal(
			doc.activeElement?.getAttribute("data-test-row"),
			"current",
			"leave: the nav's current destination row has focus",
		);
		// Control: focus outside the column is never taken.
		const outside = doc.createElement("input");
		doc.body.appendChild(outside);
		outside.focus();
		await app.rerender(shell(true));
		assert.equal(doc.activeElement, outside);
	} finally {
		await app.teardown();
	}
});

/*
 * #1660 QA Q5: a first open draws the EARLY column (Back + title) and then swaps
 * it for the full rail. The Back that took focus is unmounted, so focus must be
 * re-homed on the new first control rather than falling to <body>. And Q6/U6:
 * on leave, a staged-draft `New chat` (and a disabled current row) also carries
 * `aria-current="page"` ahead of the destination row - focus goes to the
 * destination, never to the control that stages a chat.
 */
test("entry focus survives the early -> full column swap (#1660 Q5)", async () => {
	const Staged = ({ full }) =>
		el(
			"div",
			null,
			el(
				InLeftSidebarHost,
				{ fallback: null },
				full
					? el("button", { type: "button", "data-test-full": "" }, "Back")
					: el("button", { type: "button", "data-test-early": "" }, "Back"),
			),
		);
	const shell = (routed, full) =>
		el(ChatLayout, {
			sidebar: el(
				"nav",
				null,
				el("button", { type: "button", "data-test-row": "chat" }, "Chat"),
			),
			content: routed ? el(Staged, { full }) : el("main"),
			routeSidebar: routed ? {} : false,
		});
	const app = await mount(shell(false, false));
	try {
		const doc = app.document;
		doc.querySelector('[data-test-row="chat"]').focus();
		await app.rerender(shell(true, false));
		assert.equal(
			doc.activeElement?.hasAttribute("data-test-early"),
			true,
			"entry: the early column's Back has focus",
		);
		/* The shell marked that focus as its own, which is what keeps Back's
		   tooltip shut on entry (#1660 U7). */
		assert.equal(doc.activeElement?.hasAttribute("data-focus-handoff"), true);
		await app.rerender(shell(true, true));
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(
			doc.activeElement?.hasAttribute("data-test-full"),
			true,
			`the full column's Back takes the focus the early one held, not <body> (got ${doc.activeElement?.tagName})`,
		);
	} finally {
		await app.teardown();
	}
});

test("leave focus picks the destination row, not a staged New chat or a disabled row (#1660 Q6/U6)", async () => {
	const nav = (newChatDisabled) =>
		el(
			"nav",
			null,
			el(
				"button",
				{
					type: "button",
					"aria-current": "page",
					"data-new-chat-row": "",
					disabled: newChatDisabled,
				},
				"New chat",
			),
			el(
				"button",
				{ type: "button", "aria-current": "page", "data-test-row": "library" },
				"Library",
			),
		);
	const shell = (routed, newChatDisabled) =>
		el(ChatLayout, {
			sidebar: nav(newChatDisabled),
			content: el(Route),
			routeSidebar: routed ? {} : false,
		});
	for (const disabled of [false, true]) {
		const app = await mount(shell(true, disabled));
		try {
			const doc = app.document;
			doc.querySelector("[data-test-rail]").focus();
			await app.rerender(shell(false, disabled));
			assert.equal(
				doc.activeElement?.getAttribute("data-test-row"),
				"library",
				`leave (New chat ${disabled ? "disabled" : "enabled"}): focus is on the destination row`,
			);
		} finally {
			await app.teardown();
		}
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
const PIN_8 = /const earlyColumn = <TeamBridgeEarlyColumn \/>;/;
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
		navigate: async (to, options) => {
			await act(async () => go(to, options));
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

test("a notification opened while on Team Bridge does not cost Back a press (round 1, M2/Q1)", async () => {
	/* chat -> settings -> bridge -> notification-open -> Back = settings. */
	const app = await mountApp("http://localhost/#/chat");
	try {
		await app.navigate("/settings");
		await app.navigate("/team-bridge");
		const path = teamBridgeOpenPath({
			tenantId: "tnt_1",
			conversationId: "bcv_1",
		});
		// The opener's own decision, read from the live hash as the hook reads it.
		const replace = onTeamBridgeRoute(app.window.location.hash);
		assert.equal(replace, true);
		await app.navigate(path, replace ? { replace: true } : undefined);
		await app.press(() => {});
		assert.equal(app.where(), "/team-bridge");
		assert.equal(
			app.window.location.hash,
			"#/team-bridge",
			"the page consumed the params with its own replace",
		);
		await app.press(() => backButton(app).click());
		assert.equal(app.where(), "/settings", "one press leaves");
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
		const name = button.getAttribute("aria-label");
		assert.equal(name, "Back, leave Team Bridge");
		// WCAG 2.5.3 Label in Name: the name starts with what is on screen.
		assert.ok(name.startsWith(button.textContent.trim()));
		assert.match(button.getAttribute("aria-keyshortcuts"), BACK_CHORD);
		assert.equal(button.textContent.trim(), "Back");
	} finally {
		await app.teardown();
	}
});
