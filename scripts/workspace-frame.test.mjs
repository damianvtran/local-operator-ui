import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	Navigate,
	Route,
	createRoutesFromElements,
	matchRoutes,
} from "react-router-dom";

const root = "src/renderer/src/";
const read = (path) => readFileSync(root + path, "utf8");
const app = read("app.tsx");
const styles = read("styles/index.css");
const frameSource = read("shared/components/common/workspace-frame.tsx");
const require = createRequire(import.meta.url);

const ROUTE_PARAM = /:\w+/g;
const OUTLET_PLACEMENT =
	/<main\s+data-workspace-outlet=""[\s\S]*?className="panel-top-pad flex grow flex-col overflow-hidden"[\s\S]*?data-chrome-route-band=""[\s\S]*?<WorkspaceFrame inset=\{outletWrapsRoute\}>\s*\{routeBody\}\s*<\/WorkspaceFrame>\s*<\/main>/;
const INSET_MARKUP =
	/<div[^>]*data-workspace-frame-shell=""><div[^>]*data-workspace-frame="" data-glass-region="canvas-backing"><div data-fixture-body=""><\/div><\/div><\/div>/;
const FRAME_RULE = /\.workspace-frame\s*\{([^}]+)\}/;
const SHELL_RULE = /\.workspace-frame-shell\s*\{([^}]+)\}/;
const PERIMETER_RULE = /\.workspace-frame-shell::before\s*\{([^}]+)\}/;
const FRAME_SHELL_MARKER = /data-workspace-frame-shell=""/g;
const FRAME_IN_SHELL =
	/data-workspace-frame-shell=""><div[^>]*data-workspace-frame=""/;
const SHELL_BACKING_OR_CONTAINMENT = /(?:background|overflow|position)[^:]*:/;
const PERIMETER_PATH = /clip-path: shape\(([\s\S]*)\);/;
const PERIMETER_ARC = /arc to [^,]+\s+of\s+var\(--workspace-frame-radius\)/g;
const RAW_SHELL_GLASS =
	/background-color: color-mix\(\s*in srgb,\s*var\(--lo-surface\) calc\(var\(--lo-glass-a-surface\) \* 100%\),\s*transparent\s*\)/;
const FRAME_GUTTER_INLINE = /margin-inline: var\(--workspace-frame-gutter\);/;
const FRAME_GUTTER_BOTTOM =
	/margin-block-end: var\(--workspace-frame-gutter\);/;
const FRAME_RADIUS = /border-radius: var\(--workspace-frame-radius\);/;
const SIDEBAR_PERIMETER_RULE =
	/html\[data-glass~="sidebar"\] \.workspace-frame-shell::before,\s*html\[data-glass~="sidebar"\] \[data-workspace-tabs\] \{([^}]+)\}/;
const FRAME_OVERFLOW = /overflow: clip;/;
const DECORATIVE_FRAME_STYLES =
	/(?:^|\s)(?:border(?:-color|-width|-style)?|box-shadow|outline|margin-top|margin-block-start|padding[^:]*):/;
const SPLIT_PAINT_GUARD =
	/html \[data-workspace-frame\]\[data-glass-region="canvas-backing"\]:has\(> \[data-glass-split\]\):not\(:has\(> \[data-workspace-route-pending\]\)\),\s*html\[data-glass\] \[data-glass-split\] \{\s*background-color: transparent;/;

/** Compile the actual JSX with inert page leaves. This exercises React Router's
 * matcher without importing App's live IPC, feature hooks or Electron process. */
function compile(source, modules = {}) {
	const { code } = transformSync(source, {
		loader: "tsx",
		jsx: "automatic",
		format: "cjs",
	});
	// esbuild replaces module.exports with its CommonJS export facade.
	return new Function("require", "module", `${code}\nreturn module.exports;`)(
		(name) => modules[name] ?? require(name),
		{ exports: {} },
	);
}

// Each family enumerates all the patterns, not just its sidebar entry. This is
// an independent expectation, NOT a second production routing/placement table.
const inventory = [
	{ page: "ChatPage", paths: ["/chat", "/chat/:agentId"], handle: "chat" },
	{ page: "AgentsPage", paths: ["/agents", "/agents/:agentId"] },
	{ page: "SettingsPage", paths: ["/settings"] },
	{ page: "AgentHubPage", paths: ["/agent-hub"] },
	{ page: "AgentDetailsPage", paths: ["/agent-hub/:agentId"] },
	{ page: "SchedulesPage", paths: ["/schedules"] },
	{ page: "ProjectsPage", paths: ["/projects", "/projects/:projectId"] },
	{ page: "BrowserPage", paths: ["/browser"], handle: "chrome" },
	{
		page: "NotificationsPage",
		paths: ["/notifications", "/notifications/:notificationId"],
		gate: "notificationsState",
	},
	{
		page: "LibraryPage",
		paths: ["/library", "/library/assets/:assetId"],
		gate: "libraryState",
	},
	{
		page: "TeamBridgePage",
		paths: ["/team-bridge"],
		handle: "bridge",
		gate: "bridgeState",
	},
	{ page: "MeshPage", paths: ["/mesh"], gate: "meshState" },
];

const declarationsAt = app.indexOf("const routes = createRoutesFromElements(");
const useRoutesAt = app.indexOf(
	"const routeContent = useRoutes(routes);",
	declarationsAt,
);
assert.ok(declarationsAt >= 0 && useRoutesAt > declarationsAt);
const { resolve } = compile(`
	export function resolve(bindings, pathname) {
		const { Navigate, Route, createRoutesFromElements, matchRoutes,
			${inventory.map(({ page }) => page).join(", ")},
			${inventory.flatMap(({ gate }) => gate ?? []).join(", ")}
		} = bindings;
		${app.slice(declarationsAt, useRoutesAt)}
		return { routes, routeOwnsSidebar, routeHasOwnChromeRow, outletWrapsRoute, chatOwnsBody, browserOwnsBody };
	}
`);
const bindings = {
	Navigate,
	Route,
	createRoutesFromElements,
	matchRoutes,
	...Object.fromEntries(inventory.map(({ page }) => [page, page])),
	...Object.fromEntries(
		inventory.flatMap(({ gate }) => (gate ? [[gate, "enabled"]] : [])),
	),
};
const example = (path) => path.replace(ROUTE_PARAM, "fixture-id");
const settledRoute = (routes, url) => matchRoutes(routes, url)?.at(-1)?.route;

test("every desktop route pattern and redirect declares its actual frame placement", () => {
	const { routes } = resolve(bindings, "/settings");
	assert.deepEqual(
		routes.map(({ path }) => path).sort(),
		inventory
			.flatMap(({ paths }) => paths)
			.concat("/", "*")
			.sort(),
	);
	for (const { page, paths, handle } of inventory) {
		for (const path of paths) {
			const url = example(path);
			const mode = resolve(bindings, url);
			const route = settledRoute(mode.routes, url);
			assert.equal(route.path, path, url);
			assert.equal(route.element.type, page, url);
			assert.equal(route.handle, handle, url);
			assert.equal(
				mode.outletWrapsRoute,
				handle !== "chat" && handle !== "chrome",
				url,
			);
			assert.equal(mode.routeOwnsSidebar, handle === "bridge", url);
			assert.equal(
				mode.routeHasOwnChromeRow,
				handle === "chat" || handle === "chrome",
				url,
			);
		}
	}
});

test("cold/disabled capability, aliases and unknown URLs all follow the Chat redirect", () => {
	function assertRedirect(url, caps, pattern = "*") {
		const {
			routes,
			routeOwnsSidebar,
			routeHasOwnChromeRow,
			outletWrapsRoute,
			chatOwnsBody,
			browserOwnsBody,
		} = resolve(caps, url);
		const route = settledRoute(routes, url);
		assert.equal(route.path, pattern, url);
		assert.equal(route.element.type, Navigate, url);
		assert.deepEqual(route.element.props, { to: "/chat", replace: true }, url);
		assert.equal(routeHasOwnChromeRow, true, url);
		assert.equal(routeOwnsSidebar, false, url);
		assert.equal(outletWrapsRoute, false, url);
	}
	assertRedirect("/", bindings, "/");
	for (const url of [
		"/not-a-route",
		"/team-bridge-old",
		"/chat/a/b",
		"/browser-old",
		"/library/assets",
	]) {
		assertRedirect(url, bindings);
	}
	for (const { gate, paths } of inventory) {
		if (!gate) continue;
		for (const state of ["unknown", "unpaired", "below-version"]) {
			for (const path of paths)
				assertRedirect(example(path), { ...bindings, [gate]: state });
		}
	}
});

test("App consumes the shell lane once and passes the matched route to the rail", () => {
	assert.match(app, OUTLET_PLACEMENT);
	assert.match(app, /insetRouteBody\s+showChatRail=\{placement === "chat"\}/);
	const shell = read("shared/components/common/chat-layout.tsx");
	assert.match(shell, /showChatRail && railMounted \? PANEL_RAIL_WIDTH_PX : 0/);
	assert.match(shell, /display: railWidth === 0 \? "none" : undefined/);
	assert.match(
		shell,
		/<PanelRailHostContext.Provider value=\{showChatRail \? railHost : null\}>/,
	);
	assert.match(
		shell,
		/\(!insetRouteBody \|\| fleetAsksOpen\) && <PanelEdge side="start"/,
	);
});

const frameModule = compile(frameSource);
const { WorkspaceFrame, useWorkspaceClearance } = frameModule;
const adapterImports = {
	"@shared/components/common/workspace-frame": frameModule,
};
const { ChatWorkspace } = compile(
	read("features/chat/components/chat-workspace.tsx"),
	adapterImports,
);
const { BrowserWorkspaceBody, BrowserRoutePending } = compile(
	read("features/browser/components/browser-workspace.tsx"),
	adapterImports,
);
const pendingAt = app.indexOf("const routePending = (");
const returnAt = app.indexOf("\n\treturn (", pendingAt);
assert.ok(pendingAt >= 0 && returnAt > pendingAt);
const { Outlet } = compile(`
	import { Suspense } from "react";
	export function Outlet({mode, routeContent, WorkspaceFrame, ChatWorkspace, BrowserRoutePending}) {
		const { routeOwnsSidebar, chatOwnsBody, browserOwnsBody, routeHasOwnChromeRow, outletWrapsRoute } = mode;
		const BackendStartupGate = () => null;
		const TeamBridgeEarlyColumn = () => <span data-test-early-back="" />;
		const Spinner = () => <span data-test-spinner="" />;
		const t = (key) => key;
		${app.slice(pendingAt, returnAt)}
		return (${app.match(OUTLET_PLACEMENT)[0]});
	}
`);

function FixtureBody() {
	return createElement("div", {
		"data-fixture-body": "",
		"data-shell-clearance": useWorkspaceClearance(),
	});
}

function SuspendedBody() {
	throw new Promise(() => {});
}

function renderOutlet(url, pending) {
	const mode = resolve(bindings, url);
	return renderToStaticMarkup(
		createElement(Outlet, {
			mode,
			WorkspaceFrame,
			ChatWorkspace,
			BrowserRoutePending,
			routeContent: pending
				? createElement(SuspendedBody)
				: settledFixture(mode),
		}),
	);
}

function settledFixture(mode) {
	const body = createElement(FixtureBody);
	if (mode.chatOwnsBody)
		return createElement(
			ChatWorkspace,
			{ tabs: createElement("div", { "data-workspace-tabs": "" }) },
			body,
		);
	if (mode.browserOwnsBody)
		return [
			createElement("div", { key: "chrome", "data-browser-route-chrome": "" }),
			createElement(
				BrowserWorkspaceBody,
				{ key: "body", isRoutePage: true },
				body,
			),
		];
	return body;
}

test("all 17 live patterns render exactly one effective body frame pending and settled", () => {
	const paths = inventory.flatMap(({ paths }) => paths.map(example));
	assert.equal(paths.length, 17);
	for (const url of paths) {
		for (const pending of [true, false]) {
			const markup = renderOutlet(url, pending);
			const frameCount = [...markup.matchAll(/data-workspace-frame=""/g)]
				.length;
			assert.equal(frameCount, 1, `${url} pending=${pending}: ${markup}`);
			assert.equal([...markup.matchAll(FRAME_SHELL_MARKER)].length, 1, url);
			assert.match(markup, FRAME_IN_SHELL);
			assert.equal(
				markup.includes("data-workspace-route-pending"),
				pending,
				url,
			);
			if (!pending) assert.match(markup, /data-shell-clearance="true"/);
			if (url.startsWith("/chat")) {
				assert.match(
					markup,
					/data-workspace-tabs=""[^>]*><\/div><div[^>]*data-workspace-frame-shell=""><div[^>]*data-workspace-frame=""[^>]*data-glass-region="canvas-content"/,
				);
			}
			if (url === "/browser") {
				assert.match(
					markup,
					/data-browser-route-(?:pending-)?chrome=""[^>]*><\/div><div[^>]*data-workspace-frame-shell=""><div[^>]*data-workspace-frame=""[^>]*data-glass-region="pane"/,
				);
			}
			assert.equal(
				markup.includes("data-test-early-back"),
				url === "/team-bridge" && pending,
				url,
			);
		}
	}
});

test("production adapters use the exercised boundaries; embedded Browser stays unframed", () => {
	const chat = read("features/chat/components/chat-content.tsx");
	const chatPage = read("features/chat/components/chat-page.tsx");
	assert.match(
		chat,
		/<ChatWorkspace tabs=\{workspaceTabs\}>\s*\{workspaceNotice\}\s*\{workspaceHeader\}\s*\{paneRow\}/,
	);
	assert.equal(
		[...chatPage.matchAll(/<ChatWorkspace>\s*\{routeNotice\}/g)].length,
		2,
	);
	assert.match(chatPage, /workspaceNotice=\{\s*<>\s*\{routeNotice\}/);
	const browser = read("features/browser/components/browser-surface.tsx");
	assert.match(
		browser,
		/data-browser-route-chrome=[\s\S]*?<BrowserWorkspaceBody\s+isRoutePage=\{isRoutePage\}\s+dockRowRef=\{attachDockRow\}\s*>/,
	);
	assert.doesNotMatch(
		renderToStaticMarkup(
			createElement(
				BrowserWorkspaceBody,
				{ isRoutePage: false },
				createElement(FixtureBody),
			),
		),
		/data-workspace-frame|data-shell-clearance="true"/,
	);
	for (const path of [
		"features/team-bridge/team-bridge-page.tsx",
		"features/community/community-home.tsx",
	]) {
		const bridge = read(path);
		assert.match(
			bridge,
			/const clearanceReserved = useWorkspaceClearance\(\);/,
		);
		assert.match(
			bridge,
			/clearanceReserved \? "\[--panel-top-pad:0px\]" : "panel-flush"/,
		);
		assert.match(bridge, /!clearanceReserved && "panel-top-pad"/);
	}
});

test("WorkspaceFrame has an inert slot for routes that own their own body", () => {
	const child = createElement("div", { "data-fixture-body": "" });
	const inset = renderToStaticMarkup(
		createElement(WorkspaceFrame, null, child),
	);
	assert.match(inset, INSET_MARKUP);
	const legacy = renderToStaticMarkup(
		createElement(WorkspaceFrame, { inset: false }, child),
	);
	assert.equal(
		legacy,
		'<div class="contents"><div class="contents"><div data-fixture-body=""></div></div></div>',
	);
});

test("the inset contributes geometry and one ground, not a seam, scroll owner or split backing", () => {
	const rule = styles.match(FRAME_RULE)?.[1];
	assert.ok(rule);
	assert.match(rule, FRAME_GUTTER_INLINE);
	assert.match(rule, FRAME_GUTTER_BOTTOM);
	assert.match(rule, FRAME_RADIUS);
	assert.match(rule, FRAME_OVERFLOW);
	assert.doesNotMatch(rule, DECORATIVE_FRAME_STYLES);
	assert.match(styles, SPLIT_PAINT_GUARD);
});

test("only the exposed frame perimeter carries the same raw shell glass as the tabs", () => {
	const shell = styles.match(SHELL_RULE)?.[1];
	const rim = styles.match(PERIMETER_RULE)?.[1];
	assert.ok(shell && rim, "the shell needs a distinct, clipped paint layer");
	assert.ok(shell.includes("--workspace-frame-gutter: 8px;"));
	assert.ok(shell.includes("--workspace-frame-radius: 10px;"));
	assert.doesNotMatch(shell, SHELL_BACKING_OR_CONTAINMENT);
	assert.ok(rim.includes("background-color: var(--lo-surface);"));
	assert.ok(rim.includes("pointer-events: none;"));
	const path = rim.match(PERIMETER_PATH)?.[1];
	assert.ok(path, "unclipped chrome would paint behind the translucent body");
	assert.equal([...path.matchAll(PERIMETER_ARC)].length, 4);
	const glass = styles.match(SIDEBAR_PERIMETER_RULE)?.[1];
	assert.ok(
		glass,
		"perimeter glass and workspace tabs must share their paint rule",
	);
	assert.match(glass, RAW_SHELL_GLASS);
});
