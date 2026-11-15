import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act } from "react";

/*
 * THE CHAT CANVAS'S PROJECTS VIEW (operator, 2026-11-15): "a tab in the right
 * canvas in the chat view which shows any linked projects and you can click
 * the linked projects to view the project details view ... the same project
 * details view component ... with the difference being that we don't need the
 * component that sends a message to the agent".
 *
 * WHAT THIS FILE PINS, against the REAL components in jsdom with only the
 * desktop bridge faked (the `projects-entry-scroll.test.mjs` harness):
 *  1. THE WIRE: `projects.for_session` is a strict GET to
 *     `/v1/desktop/sessions/{id}/projects`, and its cache key nests under the
 *     Projects tab's `list` prefix so every project write refreshes it.
 *  2. THE GATE: no `projects_by_session` → the view says why and sends NO
 *     request; a draft (no session id) says so and sends none either.
 *  3. THE STATES: empty, error with a working retry, populated rows.
 *  4. THE DETAIL: a row opens `ProjectDetailScreen` itself; its back link
 *     returns to the list; the quick-send family (strip + per-row message
 *     buttons) is ABSENT, while the route-hosted screen still renders it —
 *     the contrast is what proves the omission is the prop, not a fixture.
 *  5. FRESHNESS: a turn ending re-reads the list.
 */

/* ----------------------------------------------------------------- env -- */

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// Accessors jsdom defines on the window take no new value.
	}
}
for (const name of ["Event", "CustomEvent", "MouseEvent", "KeyboardEvent"]) {
	globalThis[name] = dom.window[name];
}
globalThis.localStorage = dom.window.localStorage;
dom.window.Element.prototype.scrollIntoView = () => {};
dom.window.HTMLCanvasElement.prototype.getContext = () => null;
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.IntersectionObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
dom.window.matchMedia = (query) => ({
	matches: false,
	media: query,
	onchange: null,
	addEventListener() {},
	removeEventListener() {},
	addListener() {},
	removeListener() {},
	dispatchEvent: () => false,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fetch = () =>
	Promise.reject(new Error("no backend in this harness"));

const NOW_MS = new Date(2026, 10, 15, 14, 0, 0, 0).getTime();
const SESSION = "a1b2c3d4e5f6";

/* --------------------------------------------------------------- bridge -- */

const row = (id, extra = {}) => ({
	id,
	name: id,
	title: null,
	description: "",
	owner: null,
	team: null,
	status: "active",
	tags: [],
	start_date: null,
	target_date: null,
	completed_at: null,
	estimate: null,
	estimate_unit: "points",
	milestones_completed: 1,
	milestones_total: 3,
	sessions: 1,
	live_sessions: 0,
	progress_stale: false,
	progress_updated_at: NOW_MS / 1000 - 7200,
	updated_at: NOW_MS / 1000 - 7200,
	...extra,
});

const LINK = {
	session_id: SESSION,
	exists: true,
	title: "This chat",
	created_at: 1762000000,
	archived: false,
	runtime: null,
	subagents: null,
	todos: null,
};

const detailOf = (entry) => ({
	project: {
		...entry,
		progress: "Shipping the canvas view",
		progress_reported_by: "agent",
		created_at: 1762000000,
		milestones: [
			{
				name: "Design",
				target_date: null,
				completed_at: "2026-11-10",
				status: "done",
			},
		],
		updates: [
			{
				at: "2026-11-15T12:00:00Z",
				text: "Canvas list renders",
				by: "agent",
				attachments: [],
			},
		],
	},
	links: [LINK],
});

let requests = [];
let features = { projects: 2, projects_by_session: 1 };
let sessionRows = () => [row("canvas-alpha", { title: "Canvas alpha" })];
let failSessionRead = false;

const answer = (request) => {
	requests.push(request);
	if (request.op === "capabilities") {
		return {
			status: 200,
			body: {
				result: {
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features,
				},
			},
		};
	}
	if (request.op === "projects.for_session") {
		if (failSessionRead)
			return { status: 500, body: { detail: "registry unreadable" } };
		return {
			status: 200,
			body: {
				result: { session_id: request.sessionId, projects: sessionRows() },
			},
		};
	}
	if (request.op === "projects.get") {
		const found = sessionRows().find((entry) => entry.id === request.key);
		if (found) return { status: 200, body: { result: detailOf(found) } };
	}
	return {
		status: 404,
		body: { detail: `this harness has no answer for ${request.op}` },
	};
};
dom.window.api = { desktop: { request: (request) => answer(request) } };
/*
 * The route's quick-send strip mounts the shared composer, which subscribes to
 * the preload's IPC at mount; a no-op bridge is enough for it to render, and
 * the contrast case below needs it rendered.
 */
const ipcNoop = () => () => {};
dom.window.electron = {
	ipcRenderer: {
		on: ipcNoop,
		once: ipcNoop,
		removeListener: () => {},
		removeAllListeners: () => {},
		send: () => {},
		invoke: async () => null,
	},
};

/* ----------------------------------------------------------- the shipped -- */

const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { CanvasProjectsViewer } from "./src/renderer/src/features/chat/components/canvas/canvas-projects-viewer";
import { ProjectDetailScreen } from "./src/renderer/src/features/projects/components/project-detail";
export { projectKeys } from "./src/renderer/src/features/projects/hooks/use-projects-queries";
export { desktopRequestSchema, desktopEndpoint } from "./src/shared/desktop-contract";

const wrap = (client, child) =>
	createElement(QueryClientProvider, { client },
		createElement(MemoryRouter, null, child));

export function mount(container, props) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	const root = createRoot(container);
	const render = (next) =>
		root.render(wrap(client, createElement(CanvasProjectsViewer, next)));
	render(props);
	return { root, client, render };
}

export function mountRouteDetail(container, projectKey, nowMs) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	const root = createRoot(container);
	root.render(wrap(client, createElement(ProjectDetailScreen, { projectKey, nowMs })));
	return { root, client };
}
`;

const BARE_SPECIFIER = /^[^./]/;
const EXTERNAL = /^(react|react-dom|@tanstack\/react-query)(\/.*)?$/;
const bundle = await build({
	stdin: {
		contents: ENTRY,
		resolveDir: process.cwd(),
		sourcefile: "canvas-projects-view.mjs",
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
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
		".ttf": "empty",
		".woff": "empty",
		".woff2": "empty",
		".eot": "empty",
	},
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@assets": `${process.cwd()}/src/renderer/src/assets`,
	},
	write: false,
});
const bundlePath = new URL(
	`./_canvas-projects-view-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	mount,
	mountRouteDetail,
	projectKeys,
	desktopRequestSchema,
	desktopEndpoint,
} = await import(bundlePath.href).finally(() => unlink(bundlePath));

/* ------------------------------------------------------------ helpers -- */

const tick = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
	});

let current = null;
const text = () => current?.container.textContent ?? "";
const waitFor = async (predicate, what) => {
	for (let attempt = 0; attempt < 500; attempt++) {
		if (predicate()) return;
		await tick();
	}
	throw new Error(
		`never reached: ${what} | ops=${JSON.stringify(requests.map((r) => r.op))} | text=${text().slice(0, 300)}`,
	);
};
const fresh = async (mounter) => {
	if (current) {
		await act(async () => current.handle.root.unmount());
		current.container.remove();
	}
	requests = [];
	const container = document.createElement("div");
	document.body.append(container);
	let handle;
	await act(async () => {
		handle = mounter(container);
	});
	current = { container, handle };
	return current;
};
const buttonByText = (label) =>
	[...current.container.querySelectorAll("button")].find(
		(element) => element.textContent.trim() === label,
	) ?? null;
const click = async (element) => {
	await act(async () => {
		element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	await tick();
};
const ops = (op) => requests.filter((request) => request.op === op);

const reset = () => {
	features = { projects: 2, projects_by_session: 1 };
	sessionRows = () => [row("canvas-alpha", { title: "Canvas alpha" })];
	failSessionRead = false;
};

/* -------------------------------------------------------------- the wire -- */

test("projects.for_session is a strict GET on the session's projects route", () => {
	const ok = desktopRequestSchema.safeParse({
		op: "projects.for_session",
		sessionId: SESSION,
	});
	assert.equal(ok.success, true);
	assert.deepEqual(desktopEndpoint(ok.data), {
		path: `/v1/desktop/sessions/${SESSION}/projects`,
		method: "GET",
	});
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "projects.for_session",
			sessionId: "../x",
		}).success,
		false,
		"a session id outside the 12-hex pattern never reaches a path",
	);
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "projects.for_session",
			sessionId: SESSION,
			extra: 1,
		}).success,
		false,
		"strict: no stray body keys",
	);
});

test("the per-session key nests under the list prefix every write invalidates", () => {
	const key = projectKeys.forSession(SESSION);
	assert.deepEqual(key.slice(0, projectKeys.list.length), [
		...projectKeys.list,
	]);
	assert.notEqual(key.length, projectKeys.detail("x").length);
});

/* ------------------------------------------------------------- the gate -- */

test("an older backend: the view says why and sends no session read", async () => {
	reset();
	features = { projects: 2 };
	await fresh((container) =>
		mount(container, { sessionId: SESSION, nowMs: NOW_MS }),
	);
	await waitFor(
		() => text().includes("Linked projects aren't available"),
		"unavailable",
	);
	assert.equal(ops("projects.for_session").length, 0);
});

test("a draft: the view says so and sends no session read", async () => {
	reset();
	await fresh((container) => mount(container, { nowMs: NOW_MS }));
	await waitFor(() => text().includes("No conversation yet"), "draft copy");
	assert.equal(ops("projects.for_session").length, 0);
});

/* ----------------------------------------------------------- the states -- */

test("no links: the empty state", async () => {
	reset();
	sessionRows = () => [];
	await fresh((container) =>
		mount(container, { sessionId: SESSION, nowMs: NOW_MS }),
	);
	await waitFor(() => text().includes("No linked projects"), "empty state");
	assert.equal(ops("projects.for_session")[0].sessionId, SESSION);
});

test("a failed read: the error state, and Try again re-reads", async () => {
	reset();
	failSessionRead = true;
	await fresh((container) =>
		mount(container, { sessionId: SESSION, nowMs: NOW_MS }),
	);
	await waitFor(
		() => text().includes("Linked projects could not be loaded"),
		"error",
	);
	failSessionRead = false;
	/* The read's own retry policy may already have asked twice; the press must
	   ask again, whatever that count was. */
	const failedReads = ops("projects.for_session").length;
	await click(buttonByText("Try again"));
	await waitFor(() => text().includes("Canvas alpha"), "rows after retry");
	assert.equal(ops("projects.for_session").length, failedReads + 1);
});

test("rows: title, status and the board's own meta formatters", async () => {
	reset();
	sessionRows = () => [
		row("canvas-alpha", { title: "Canvas alpha" }),
		row("beta-key", { status: "paused", milestones_total: 0 }),
	];
	await fresh((container) =>
		mount(container, { sessionId: SESSION, nowMs: NOW_MS }),
	);
	await waitFor(() => text().includes("Canvas alpha"), "rows");
	const rows = current.container.querySelectorAll("[data-canvas-project-row]");
	assert.equal(rows.length, 2);
	assert.equal(rows[0].getAttribute("aria-label"), "Open Canvas alpha");
	assert.match(rows[0].textContent, /1\/3/);
	assert.match(rows[0].textContent, /reported 2h ago/);
	assert.equal(rows[1].getAttribute("aria-label"), "Open beta-key");
});

/* ----------------------------------------------------------- the detail -- */

test("a row opens the SAME detail screen, without quick-send, and back returns to the list", async () => {
	reset();
	await fresh((container) =>
		mount(container, { sessionId: SESSION, nowMs: NOW_MS }),
	);
	await waitFor(() => text().includes("Canvas alpha"), "rows");
	await click(current.container.querySelector("[data-canvas-project-row]"));
	await waitFor(
		() => text().includes("Canvas list renders"),
		"detail with history",
	);
	assert.deepEqual(ops("projects.get").at(-1), {
		op: "projects.get",
		key: "canvas-alpha",
	});
	/* The route's blocks: milestones, linked sessions, the update feed. */
	assert.ok(text().includes("Design"), "milestones render");
	assert.ok(text().includes("This chat"), "linked sessions render");
	/* The quick-send family is gone: no strip, no per-row message button. */
	assert.equal(
		current.container.querySelector('[data-tour-tag="project-quick-send"]'),
		null,
	);
	assert.equal(
		current.container.querySelector('[aria-label="Message This chat"]'),
		null,
	);
	/* Back is the host's list, not the Projects route. */
	assert.equal(buttonByText("All projects"), null);
	await click(buttonByText("Linked projects"));
	await waitFor(
		() => current.container.querySelector("[data-canvas-projects-list]"),
		"list again",
	);
});

test("contrast: the route-hosted screen still renders quick-send for the same record", async () => {
	reset();
	await fresh((container) =>
		mountRouteDetail(container, "canvas-alpha", NOW_MS),
	);
	await waitFor(() => text().includes("Canvas list renders"), "route detail");
	assert.ok(
		current.container.querySelector('[data-tour-tag="project-quick-send"]'),
		"the strip is the route's",
	);
	assert.ok(
		current.container.querySelector('[aria-label="Message This chat"]'),
	);
	assert.ok(buttonByText("All projects"));
});

/* ------------------------------------------------------------ freshness -- */

test("a turn ending re-reads the linked projects", async () => {
	reset();
	const { handle } = await fresh((container) =>
		mount(container, { sessionId: SESSION, nowMs: NOW_MS, turnTerminal: 1 }),
	);
	await waitFor(() => text().includes("Canvas alpha"), "rows");
	const before = ops("projects.for_session").length;
	sessionRows = () => [
		row("canvas-alpha", { title: "Canvas alpha" }),
		row("gamma", { title: "Gamma" }),
	];
	await act(async () =>
		handle.render({ sessionId: SESSION, nowMs: NOW_MS, turnTerminal: 2 }),
	);
	await waitFor(() => text().includes("Gamma"), "re-read after the turn");
	assert.ok(ops("projects.for_session").length > before);
});

test.after(async () => {
	if (current) {
		await act(async () => current.handle.root.unmount());
		current.container.remove();
	}
});
