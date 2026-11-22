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
	/<main\s+data-glass-region=\{\s*insetRouteBody \? undefined : "canvas-backing"\s*\}[\s\S]*?className="panel-top-pad flex grow flex-col overflow-hidden"[\s\S]*?data-chrome-route-band=""[\s\S]*?<WorkspaceFrame inset=\{insetRouteBody\}>\s*\{routeBody\}\s*<\/WorkspaceFrame>\s*<\/main>/;
const PENDING_PLACEMENT =
	/const routeBody = \([\s\S]*?<BackendStartupGate \/>[\s\S]*?<Suspense[\s\S]*?fallback=\{[\s\S]*?<TeamBridgeEarlyColumn \/>[\s\S]*?data-workspace-route-pending=""[\s\S]*?<Spinner[\s\S]*?\{routeContent\}\s*<\/Suspense>/;
const INSET_MARKUP =
	/<div class="workspace-frame flex min-h-0 min-w-0 flex-1 flex-col" data-workspace-frame="" data-glass-region="canvas-backing"><div data-fixture-body=""><\/div><\/div>/;
const FRAME_RULE = /\.workspace-frame\s*\{([^}]+)\}/;
const FRAME_GUTTER_INLINE = /margin-inline: 8px;/;
const FRAME_GUTTER_BOTTOM = /margin-block-end: 8px;/;
const FRAME_RADIUS = /border-radius: 10px;/;
const FRAME_OVERFLOW = /overflow: clip;/;
const DECORATIVE_FRAME_STYLES =
	/(?:^|\s)(?:border(?:-color|-width|-style)?|box-shadow|outline|margin-top|margin-block-start|padding[^:]*):/;
const SPLIT_PAINT_GUARD =
	/html \[data-workspace-frame\]\[data-glass-region="canvas-backing"\]:has\(> \[data-glass-split\]\):not\(:has\(> \[data-workspace-route-pending\]\)\),\s*html\[data-glass\] \[data-glass-split\] \{\s*background-color: transparent;/;

/** Compile the actual JSX with inert page leaves. This exercises React Router's
 * matcher without importing App's live IPC, feature hooks or Electron process. */
function compile(source) {
	const { code } = transformSync(source, {
		loader: "tsx",
		jsx: "automatic",
		format: "cjs",
	});
	// esbuild replaces module.exports with its CommonJS export facade.
	return new Function("require", "module", `${code}\nreturn module.exports;`)(
		require,
		{ exports: {} },
	);
}

// Each family enumerates all the patterns, not just its sidebar entry. This is
// an independent expectation, NOT a second production routing/placement table.
const inventory = [
	{ page: "ChatPage", paths: ["/chat", "/chat/:agentId"], handle: "chrome" },
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
		return { routes, routeOwnsSidebar, routeHasOwnChromeRow, insetRouteBody };
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
			assert.equal(mode.insetRouteBody, !handle, url);
			assert.equal(mode.routeOwnsSidebar, handle === "bridge", url);
			assert.equal(mode.routeHasOwnChromeRow, handle === "chrome", url);
		}
	}
});

test("cold/disabled capability, aliases and unknown URLs all follow the Chat redirect", () => {
	function assertRedirect(url, caps, pattern = "*") {
		const { routes, routeOwnsSidebar, routeHasOwnChromeRow, insetRouteBody } =
			resolve(caps, url);
		const route = settledRoute(routes, url);
		assert.equal(route.path, pattern, url);
		assert.equal(route.element.type, Navigate, url);
		assert.deepEqual(route.element.props, { to: "/chat", replace: true }, url);
		assert.equal(routeHasOwnChromeRow, true, url);
		assert.equal(routeOwnsSidebar, false, url);
		assert.equal(insetRouteBody, false, url);
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

test("App places the same frame after clearance and around startup, fallback and content", () => {
	assert.match(app, OUTLET_PLACEMENT);
	assert.match(app, PENDING_PLACEMENT);
	const { WorkspaceFrame } = compile(frameSource);
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
		'<div class="contents"><div data-fixture-body=""></div></div>',
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
