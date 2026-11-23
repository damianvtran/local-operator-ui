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
 *  5. FRESHNESS: a turn ending re-reads the list - from the CHAT's hook, so it
 *     runs with the view closed (round-1 R1-3/U5).
 *  6. ROUND-1 REMEDIATION: unreachable vs older-runtime wording (R1-2/D1), a
 *     non-empty error sentence (R1-4), the rail total with the capability gone
 *     (Q-2), focus across the list/detail swap (U3), and the open project
 *     surviving a remount but not an unlink (U4).
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
let delaySessionRead = null;
/* Round-1 gate variants: a capabilities read that fails, an unpaired app,
   and a read failure that carries no sentence of its own. */
let failCapabilities = false;
let desktopAvailable = true;
let silentSessionFailure = false;

const answer = (request) => {
	requests.push(request);
	if (request.op === "capabilities") {
		if (failCapabilities) return { status: 500, body: {} };
		return {
			status: 200,
			body: {
				result: {
					desktop_contract: 1,
					desktop_available: desktopAvailable,
					desktop_auth: "bearer",
					features,
				},
			},
		};
	}
	if (request.op === "projects.for_session") {
		if (delaySessionRead) return delaySessionRead(request);
		if (failSessionRead)
			return {
				status: 500,
				body: silentSessionFailure ? {} : { detail: "registry unreadable" },
			};
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
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { CanvasProjectsViewer } from "./src/renderer/src/features/chat/components/canvas/canvas-projects-viewer";
import { ProjectDetailScreen } from "./src/renderer/src/features/projects/components/project-detail";
import { useProjectReadsTurnRefresh, useSessionProjects } from "./src/renderer/src/features/projects/hooks/use-projects-queries";
import { projectKeys } from "./src/renderer/src/features/projects/hooks/use-projects-queries";
export { projectKeys };
// The SAME bundled instance the viewer's queries consult, so going offline
// here pauses the viewer's refetch (a separate package copy would not).
export { onlineManager };
export { linkedProjectTotal } from "./src/renderer/src/features/projects/hooks/use-projects-queries";
export { useCanvasStore } from "./src/renderer/src/shared/store/canvas-store";
export { desktopRequestSchema, desktopEndpoint } from "./src/shared/desktop-contract";

const wrap = (client, child) =>
	createElement(QueryClientProvider, { client },
		createElement(MemoryRouter, null, child));

export function mount(container, props, cachedRows) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	if (cachedRows) client.setQueryData(projectKeys.forSession(props.sessionId), cachedRows, { updatedAt: Date.now() - 60_000 });
	const root = createRoot(container);
	const render = (next) =>
		root.render(wrap(client, createElement(CanvasProjectsViewer, next)));
	render(props);
	return { root, client, render };
}

/* ChatContent's two project hooks, without ChatContent: the rail's read and
   the turn-end refresh beside it (R1-3). Renders the read's length. */
function ChatRailProbe({ sessionId, turnTerminal }) {
	const read = useSessionProjects(sessionId, true);
	useProjectReadsTurnRefresh(turnTerminal, Boolean(sessionId));
	return createElement("output", { "data-rail-total": "" }, String(read.data?.length ?? "-"));
}

export function mountRailProbe(container, props) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	const root = createRoot(container);
	const render = (next) =>
		root.render(wrap(client, createElement(ChatRailProbe, next)));
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
	mountRailProbe,
	mountRouteDetail,
	projectKeys,
	onlineManager,
	linkedProjectTotal,
	useCanvasStore,
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
	delaySessionRead = null;
	failCapabilities = false;
	desktopAvailable = true;
	silentSessionFailure = false;
	/* The open project is persisted per conversation (U4); no case inherits
	   another's selection. */
	useCanvasStore.setState({ conversations: {} });
};
const CONVERSATION = "agent-1";

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
	sessionRows = () => [
		row("canvas-alpha", { title: "Canvas alpha" }),
		row("beta"),
	];
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

test("a turn ending re-reads the linked projects from the CHAT, with the view closed (R1-3/U5)", async () => {
	reset();
	/* Only the rail's read is mounted - no CanvasProjectsViewer - which is the
	   closed-canvas case the rail's dot and count went stale in. */
	const { handle } = await fresh((container) =>
		mountRailProbe(container, { sessionId: SESSION, turnTerminal: 1 }),
	);
	const total = () =>
		current.container.querySelector("[data-rail-total]")?.textContent;
	await waitFor(() => total() === "1", "rail total");
	const before = ops("projects.for_session").length;
	sessionRows = () => [
		row("canvas-alpha", { title: "Canvas alpha" }),
		row("gamma", { title: "Gamma" }),
	];
	/* The first observed count is a baseline, never a refresh. */
	await act(async () => handle.render({ sessionId: SESSION, turnTerminal: 1 }));
	await tick();
	assert.equal(ops("projects.for_session").length, before);
	await act(async () => handle.render({ sessionId: SESSION, turnTerminal: 2 }));
	await waitFor(() => total() === "2", "re-read after the turn");
	assert.ok(ops("projects.for_session").length > before);
});

test("the rail total is 0 when the capability is absent, whatever is cached (Q-2)", () => {
	const cached = [row("a"), row("b"), row("c")];
	assert.equal(linkedProjectTotal(true, cached), 3);
	assert.equal(
		linkedProjectTotal(false, cached),
		0,
		"a disabled query keeps its data; the total does not",
	);
	assert.equal(linkedProjectTotal(true, undefined), 0);
});

/* ------------------------------------------------- round-1 remediation -- */

test("a failed capabilities read says the runtime can't be reached, not 'update' (R1-2/D1)", async () => {
	reset();
	failCapabilities = true;
	await fresh((container) =>
		mount(container, { sessionId: SESSION, nowMs: NOW_MS }),
	);
	await waitFor(
		() => text().includes("Can't reach the runtime"),
		"unreachable state",
	);
	assert.ok(!text().includes("Update Local Operator"));
	assert.equal(ops("projects.for_session").length, 0);
	/* Try again re-asks the capabilities, and a now-answering runtime lists. */
	failCapabilities = false;
	await click(buttonByText("Try again"));
	await waitFor(() => text().includes("Canvas alpha"), "rows after retry");
});

test("an unpaired app says so, not 'update' (R1-2/D1)", async () => {
	reset();
	desktopAvailable = false;
	await fresh((container) =>
		mount(container, { sessionId: SESSION, nowMs: NOW_MS }),
	);
	await waitFor(
		() => text().includes("Can't reach the runtime"),
		"unreachable state",
	);
	assert.ok(text().includes("isn't paired with the runtime"));
	assert.ok(!text().includes("Update Local Operator"));
	assert.equal(ops("projects.for_session").length, 0);
});

test("a read failure with no sentence of its own still says something (R1-4)", async () => {
	reset();
	failSessionRead = true;
	silentSessionFailure = true;
	await fresh((container) =>
		mount(container, { sessionId: SESSION, nowMs: NOW_MS }),
	);
	await waitFor(
		() => text().includes("Linked projects could not be loaded"),
		"error",
	);
	const paragraphs = [...current.container.querySelectorAll("p")].map((node) =>
		node.textContent.trim(),
	);
	assert.ok(
		paragraphs.every((line) => line.length > 0),
		`no empty description paragraph: ${JSON.stringify(paragraphs)}`,
	);
});

test("focus follows the swap: open lands on the back link, back returns to the opened row (U3)", async () => {
	reset();
	sessionRows = () => [
		row("canvas-alpha", { title: "Canvas alpha" }),
		row("beta-key", { title: "Beta" }),
	];
	await fresh((container) =>
		mount(container, {
			sessionId: SESSION,
			conversationId: CONVERSATION,
			nowMs: NOW_MS,
		}),
	);
	await waitFor(() => text().includes("Beta"), "rows");
	const second = current.container.querySelector(
		'[data-canvas-project-row="beta-key"]',
	);
	second.focus();
	await click(second);
	await waitFor(() => text().includes("Canvas list renders"), "detail");
	assert.equal(
		document.activeElement,
		buttonByText("Linked projects"),
		"focus is on the detail's back link, not <body>",
	);
	await click(buttonByText("Linked projects"));
	await waitFor(
		() => current.container.querySelector("[data-canvas-projects-list]"),
		"list again",
	);
	assert.equal(
		document.activeElement?.getAttribute("data-canvas-project-row"),
		"beta-key",
		"focus returns to the row that was opened, not the first row",
	);
});

test("the open project survives a remount (view switch / close-reopen) per conversation (U4)", async () => {
	reset();
	sessionRows = () => [
		row("canvas-alpha", { title: "Canvas alpha" }),
		row("beta"),
	];
	const props = {
		sessionId: SESSION,
		conversationId: CONVERSATION,
		nowMs: NOW_MS,
	};
	await fresh((container) => mount(container, props));
	await waitFor(() => text().includes("Canvas alpha"), "rows");
	await click(current.container.querySelector("[data-canvas-project-row]"));
	await waitFor(() => text().includes("Canvas list renders"), "detail");
	assert.equal(
		useCanvasStore.getState().conversations[CONVERSATION]?.selectedProjectId,
		"canvas-alpha",
	);
	/* Unmount + mount is what a view switch or close/reopen does to the viewer. */
	const composer = document.createElement("textarea");
	document.body.append(composer);
	composer.focus();
	await fresh((container) => mount(container, props));
	await waitFor(
		() => text().includes("Canvas list renders"),
		"the same project, not the list",
	);
	assert.equal(
		document.activeElement,
		composer,
		"restoration does not steal composer focus",
	);
	composer.remove();
	/* Another conversation does not inherit it. */
	await fresh((container) =>
		mount(container, { ...props, conversationId: "agent-2" }),
	);
	await waitFor(
		() => current.container.querySelector("[data-canvas-projects-list]"),
		"agent-2's list",
	);
});

test("a remembered project no longer linked here falls back to the list (U4)", async () => {
	reset();
	sessionRows = () => [];
	useCanvasStore
		.getState()
		.setSelectedProject(CONVERSATION, "gone-project", SESSION);
	await fresh((container) =>
		mount(container, {
			sessionId: SESSION,
			conversationId: CONVERSATION,
			nowMs: NOW_MS,
		}),
	);
	await waitFor(() => text().includes("No linked projects"), "the empty state");
	assert.equal(ops("projects.get").length, 0, "the stale record is never read");
	assert.equal(
		useCanvasStore.getState().conversations[CONVERSATION]?.selectedProjectId,
		null,
	);
});

/* Singleton navigation is derived from the settled linked read, never from
   the rail count or an effect that could reopen the canvas after close. */
const detailPane = () =>
	current.container.querySelector("[data-canvas-project-detail]");
const listPane = () =>
	current.container.querySelector("[data-canvas-projects-list]");
const props = {
	sessionId: SESSION,
	conversationId: CONVERSATION,
	nowMs: NOW_MS,
};
const refreshLinks = async () => {
	await act(async () => {
		void current.handle.client.invalidateQueries({
			queryKey: projectKeys.forSession(SESSION),
		});
	});
	await tick();
};
const deferredLinks = () => {
	let resolve;
	delaySessionRead = () =>
		new Promise((done) => {
			resolve = done;
		});
	return async (entries, sessionId = SESSION) => {
		assert.ok(resolve, "the delayed read started");
		delaySessionRead = null;
		await act(async () =>
			resolve({
				status: 200,
				body: {
					result: { session_id: sessionId, projects: entries },
				},
			}),
		);
		await tick();
	};
};

test("singleton: authoritative one opens detail immediately without moving composer focus or chat scroll", async () => {
	reset();
	const composer = document.createElement("textarea");
	const chat = document.createElement("div");
	document.body.append(composer, chat);
	composer.focus();
	chat.scrollTop = 217;
	await fresh((container) => mount(container, props));
	await waitFor(
		() => text().includes("Canvas list renders"),
		"automatic singleton detail",
	);
	assert.ok(detailPane());
	assert.equal(listPane(), null, "no redundant one-row chooser");
	assert.equal(
		document.activeElement,
		composer,
		"automatic entry never focuses the back link",
	);
	assert.equal(chat.scrollTop, 217);
	assert.equal(
		current.container.querySelector('[data-tour-tag="project-quick-send"]'),
		null,
	);
	assert.ok(text().includes("Design") && text().includes("This chat"));
	assert.equal(
		Boolean(useCanvasStore.getState().conversations[CONVERSATION]?.isOpen),
		false,
		"loading links never opens the canvas store",
	);
	composer.remove();
	chat.remove();
});

test("singleton: Back escapes across remount and unchanged refetch; changed links permit forwarding again", async () => {
	reset();
	await fresh((container) => mount(container, props));
	await waitFor(() => text().includes("Canvas list renders"), "detail");
	await click(buttonByText("Linked projects"));
	assert.ok(listPane());
	await refreshLinks();
	await waitFor(() => listPane(), "Back survives unchanged refetch");
	await fresh((container) => mount(container, props));
	await waitFor(() => listPane(), "Back survives close/reopen");
	sessionRows = () => [row("canvas-alpha"), row("beta")];
	await refreshLinks();
	await waitFor(
		() =>
			current.container.querySelectorAll("[data-canvas-project-row]").length ===
			2,
		"many",
	);
	sessionRows = () => [row("canvas-alpha")];
	await refreshLinks();
	await waitFor(() => detailPane(), "many to one forwards again");
});

test("singleton: automatic one to many chooses; explicit valid selection persists; deletion resolves remaining singleton", async () => {
	reset();
	await fresh((container) => mount(container, props));
	await waitFor(() => detailPane(), "one detail");
	sessionRows = () => [row("canvas-alpha"), row("beta")];
	await refreshLinks();
	await waitFor(() => listPane(), "automatic one to many chooser");
	await click(
		current.container.querySelector('[data-canvas-project-row="beta"]'),
	);
	await waitFor(() => detailPane(), "explicit beta");
	sessionRows = () => [row("canvas-alpha"), row("beta"), row("gamma")];
	await refreshLinks();
	await waitFor(
		() => detailPane(),
		"valid explicit choice survives link change",
	);
	assert.equal(ops("projects.get").at(-1).key, "beta");
	sessionRows = () => [row("gamma")];
	await refreshLinks();
	await waitFor(
		() => ops("projects.get").at(-1)?.key === "gamma",
		"deleted beta replaced by singleton",
	);
	sessionRows = () => [];
	await refreshLinks();
	await waitFor(
		() => text().includes("No linked projects"),
		"unlink last project",
	);
	assert.equal(detailPane(), null);
});

test("singleton: delayed authoritative read never treats a stale cached one as final", async () => {
	reset();
	const finish = deferredLinks();
	await fresh((container) => mount(container, props, [row("canvas-alpha")]));
	await waitFor(() => ops("projects.for_session").length > 0, "pending read");
	assert.equal(detailPane(), null);
	assert.equal(listPane(), null);
	assert.equal(ops("projects.get").length, 0);
	await finish([row("canvas-alpha"), row("beta")]);
	await waitFor(() => listPane(), "authoritative many");
	assert.equal(ops("projects.get").length, 0);
});

test("singleton: pending and failed revalidation cannot expose stale selected details", async () => {
	reset();
	await fresh((container) => mount(container, props));
	await waitFor(() => detailPane(), "initial singleton");
	const finish = deferredLinks();
	await refreshLinks();
	assert.equal(
		detailPane(),
		null,
		"stale cached singleton hidden while refetch is unresolved",
	);
	assert.equal(listPane(), null);
	await finish([row("canvas-alpha"), row("beta")]);
	await waitFor(() => listPane(), "settled many");
	await click(
		current.container.querySelector('[data-canvas-project-row="canvas-alpha"]'),
	);
	await waitFor(() => detailPane(), "explicit selection");
	failSessionRead = true;
	await refreshLinks();
	await waitFor(
		() => text().includes("Linked projects could not be loaded"),
		"failed revalidation",
	);
	assert.equal(
		detailPane(),
		null,
		"error takes priority over stale linked data",
	);
	failSessionRead = false;
	await click(buttonByText("Try again"));
	await waitFor(() => detailPane(), "confirmed selection restored");
});

test("singleton: paused offline revalidation never authorizes the stale cached one (R1)", async () => {
	reset();
	await fresh((container) => mount(container, props));
	await waitFor(() => detailPane(), "initial singleton");
	const key = projectKeys.forSession(SESSION);
	const reads = () => ops("projects.for_session").length;
	try {
		/* Offline + invalidate: TanStack parks the refetch as fetchStatus
		   "paused" with isSuccess true and isFetching false on the cached
		   singleton, the exact shape `!isFetching` mistook for settled. */
		sessionRows = () => [row("canvas-alpha"), row("beta")];
		const before = reads();
		await act(async () => onlineManager.setOnline(false));
		await refreshLinks();
		const paused = current.handle.client.getQueryState(key);
		assert.equal(paused.status, "success");
		assert.equal(paused.fetchStatus, "paused");
		assert.equal(reads(), before, "no confirming read ran while offline");
		assert.equal(Boolean(detailPane()), false, "paused: stale detail hidden");
		assert.equal(Boolean(listPane()), false, "paused: no stale chooser");

		/* Resume: the parked read runs (pending/fetching keeps detail hidden)
		   and only its settled idle singleton answer opens detail again. */
		const finish = deferredLinks();
		await act(async () => onlineManager.setOnline(true));
		await waitFor(() => reads() > before, "resumed read started");
		assert.equal(
			current.handle.client.getQueryState(key).fetchStatus,
			"fetching",
		);
		assert.equal(Boolean(detailPane()), false, "resumed but pending: hidden");
		await finish([row("canvas-alpha")]);
		await waitFor(() => detailPane(), "settled idle singleton opens detail");
		assert.equal(current.handle.client.getQueryState(key).fetchStatus, "idle");

		/* A failed read over the cached singleton is not authorization either. */
		failSessionRead = true;
		await refreshLinks();
		await waitFor(
			() => text().includes("Linked projects could not be loaded"),
			"failed revalidation",
		);
		assert.equal(Boolean(detailPane()), false, "failed: stale detail hidden");
	} finally {
		failSessionRead = false;
		onlineManager.setOnline(true);
	}
});

test("singleton: same conversation key with a new backend session never inherits explicit choice or Back escape", async () => {
	reset();
	sessionRows = () => [row("canvas-alpha"), row("beta")];
	await fresh((container) => mount(container, props));
	await waitFor(() => listPane(), "first session list");
	await click(
		current.container.querySelector('[data-canvas-project-row="beta"]'),
	);
	await waitFor(() => detailPane(), "first session detail");
	const finish = deferredLinks();
	const nextSession = "bbbbbbbbbbbb";
	await act(async () =>
		current.handle.render({ ...props, sessionId: nextSession }),
	);
	await waitFor(
		() => ops("projects.for_session").some((r) => r.sessionId === nextSession),
		"new session read",
	);
	assert.equal(detailPane(), null);
	await finish([row("canvas-alpha"), row("beta")], nextSession);
	await waitFor(() => listPane(), "new backend session chooses independently");
	await act(async () =>
		current.handle.render({ ...props, conversationId: "agent-2" }),
	);
	await waitFor(() => listPane(), "switch conversation");
	assert.equal(detailPane(), null);
});

test.after(async () => {
	if (current) {
		await act(async () => current.handle.root.unmount());
		current.container.remove();
	}
});
