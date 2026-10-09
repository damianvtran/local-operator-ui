import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act } from "react";

/*
 * THE DETAIL SCROLLER LANDS AT THE TOP ON EVERY ENTRY (UX round 1, U1;
 * operator: "we should stay scrolled at the top when clicking in").
 *
 * WHY A PAGE-LEVEL jsdom RIG RATHER THAN A COMPONENT ONE. The defect is a
 * property of the PAGE's DOM shape, not of anything inside it: the shipped
 * `ProjectsPage` returns a `div` of the same type at the same position from its
 * list and its detail branches, so React REUSES one root node across
 * `/projects` <-> `/projects/:projectId` and `scrollTop` is a property of that
 * NODE. The UX round measured the consequence live — leave the detail scrolled,
 * reopen the SAME project, land at the abandoned offset (200 / 800 / 1096) —
 * and this file drives the round trip through the shipped page in miniatures:
 * mark the scroller node, scroll it, walk to the list with the page's own
 * control, walk back, and read the SAME node again.
 *
 * WHAT IS DRIVEN: the shipped `ProjectsPage` under a real `MemoryRouter` with
 * the two routes the app registers (`app.tsx`: `/projects` and
 * `/projects/:projectId`), against a desktop bridge that answers the three ops
 * the two views read (`capabilities`, `projects.list`, `projects.get`). WHAT IS
 * FAKED, AND ONLY THAT: that bridge — no daemon, no transport. Every request is
 * recorded so a NEW op is visible in a failure message rather than silently
 * missing (the siblings' rule).
 *
 * ORDER IS LOAD-BEARING, and measured in the sibling harness: every top-level
 * `await` finishes BEFORE the first `test()` is registered, and the `after()`
 * hook is registered last. A `test()` registered above an await lets node:test
 * drain its queue mid-evaluation, and an `after()` registered by then RUNS -
 * closing this file's JSDOM under the tests that are still being defined.
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
/*
 * Node 26 DEFINES `localStorage` (undefined without a flag), so the copy loop
 * above skips it; the page's stores must BE jsdom's, explicitly, or every read
 * falls into its try/catch and answers the default - green on the wrong thing.
 */
globalThis.localStorage = dom.window.localStorage;
dom.window.Element.prototype.scrollIntoView = () => {};
/* A null 2D context: jsdom has none, and the graph asks for one at import time
 * on some themes (the sibling harness keeps the same stub). */
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

/** The instant the fixtures pin, so no label is a function of the real clock. */
const NOW_MS = new Date(2026, 8, 20, 14, 0, 0, 0).getTime();

/* --------------------------------------------------------------- bridge -- */

/** A listing row, every required field present, overridable. */
const row = (id, name, extra = {}) => ({
	id,
	name,
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
	milestones_completed: 0,
	milestones_total: 0,
	sessions: 0,
	live_sessions: 0,
	progress_stale: false,
	progress: "",
	progress_updated_at: null,
	progress_reported_by: "",
	created_at: 1762000000,
	updated_at: 1762000000,
	...extra,
});

const FIRST = row("rig-open", "rig-open", {
	description: "The entry-scroll rig's subject",
});
const SECOND = row("rig-two", "rig-two");

/** The detail projection `projects.get` answers: the listing row plus the
 * detail-only members, with no linked sessions - the strip renders its own
 * empty state, and nothing in this file is about the strip. */
const detailView = (entry) => ({
	...entry,
	milestones: [],
	updates: [],
});

/** Every request the page issued, in order - the "which op, with what" record. */
let requests = [];

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
					features: { projects: 1 },
				},
			},
		};
	}
	if (request.op === "projects.list") {
		return { status: 200, body: { result: { projects: [FIRST, SECOND] } } };
	}
	if (request.op === "projects.get") {
		const found =
			[FIRST, SECOND].find(
				(entry) => entry.id === request.key || entry.name === request.key,
			) ?? null;
		if (found !== null) {
			return {
				status: 200,
				body: {
					result: { project: detailView(found), links: [] },
				},
			};
		}
	}
	/* Anything else is a defect worth hearing about: the page must not issue an
	 * op this harness cannot answer and then render as if it had. */
	return {
		status: 404,
		body: { detail: `this harness has no answer for ${request.op}` },
	};
};
dom.window.api = { desktop: { request: (request) => answer(request) } };

/* ----------------------------------------------------------- the shipped -- */

const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ProjectsPage } from "./src/renderer/src/features/projects/components/projects-page";

export function mount(container, nowMs, initialEntry) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	const root = createRoot(container);
	root.render(
		createElement(
			QueryClientProvider,
			{ client },
			createElement(
				MemoryRouter,
				{ initialEntries: [initialEntry] },
				createElement(
					Routes,
					null,
					createElement(Route, { path: "/projects", element: createElement(ProjectsPage, { nowMs }) }),
					createElement(Route, { path: "/projects/:projectId", element: createElement(ProjectsPage, { nowMs }) }),
				),
			),
		),
	);
	return { root, client };
}
`;

const BARE_SPECIFIER = /^[^./]/;
const EXTERNAL = /^(react|react-dom|@tanstack\/react-query)(\/.*)?$/;

const pageBundle = await build({
	stdin: {
		contents: ENTRY,
		resolveDir: process.cwd(),
		sourcefile: "projects-entry-scroll.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	/*
	 * React, ReactDOM and React Query stay out of the bundle: React must be THIS
	 * process's copy (element symbols and `act` are per-instance) and React Query
	 * too, or the provider and the hooks inside the page hand each other
	 * different module objects. Everything else is bundled because the page's
	 * graph reaches deep directory specifiers node's ESM resolver refuses.
	 */
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
	/* The page's graph reaches the composer (the strip mounts the shared
	 * `MessageInput`, whose chrome imports a PNG and stylesheets), so the
	 * bundle resolves the same assets every composer-mounting rig does. */
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
	`./_projects-entry-scroll-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, pageBundle.outputFiles[0].text);
/*
 * `finally`, not a following `await`: a failed import used to leave the bundle
 * in `scripts/`, where `lint:scripts` picks it up as a changed file and biome
 * dies reading it (the sibling harness measured exactly that).
 */
const { mount } = await import(bundlePath.href).finally(() =>
	unlink(bundlePath),
);

/* ------------------------------------------------------------ helpers -- */

const tick = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 25));
	});

/** Poll the live tree until `predicate` holds, with a generous boot budget. */
const waitFor = async (predicate, what) => {
	for (let attempt = 0; attempt < 800; attempt++) {
		if (predicate()) return;
		await tick();
	}
	throw new Error(
		`the page never reached: ${what} | ops=${JSON.stringify(requests.map((r) => r.op))} | body=${bodyText().slice(0, 300)}`,
	);
};

/**
 * The CURRENT mount, and why the queries below are scoped to it: jsdom keeps
 * every container appended to the document, so a document-wide query would
 * count the PREVIOUS test's tree as well. `mountPage` tears its predecessor
 * down before mounting.
 */
let current = null;

/** The current mount's own text, never the whole document's. */
const bodyText = () => current?.container.textContent ?? "";

/** The detail view's own scroller, named by the class ONLY the detail branch
 * carries. jsdom applies no stylesheet, so `overflow-y-auto` cannot be read
 * as a computed property; the gutter reservation
 * (`[scrollbar-gutter:stable_both-edges]`) is on this one element in the page,
 * which makes the substring an identity rather than a guess. */
const detailScroller = () =>
	current.container.querySelector('div[class*="scrollbar-gutter"]');

/** The detail header's own escape, the control this file navigates by. */
const allProjectsButton = () =>
	[...current.container.querySelectorAll("button")].find(
		(element) => element.textContent.trim() === "All projects",
	) ?? null;

/** A row in the LIST view, by the addressable `data-project-name` hook. */
const rowButton = (name) =>
	current.container.querySelector(`[data-project-name="${name}"]`);

const mounted = [];
const mountPage = async (initialEntry) => {
	const previous = mounted.pop();
	if (previous) {
		await act(async () => {
			previous.handle.root.unmount();
		});
		previous.container.remove();
		current = null;
	}
	requests = [];
	/* The view is PERSISTED, and the assertions read the LIST's rows. */
	localStorage.setItem("projects-view", "list");
	const container = document.createElement("div");
	document.body.appendChild(container);
	const handle = mount(container, NOW_MS, initialEntry);
	mounted.push({ container, handle });
	current = { container, handle };
	/* The detail has drawn before any test reads it: its scroller and the
	 * header's escape both exist only once `projects.get` has answered. */
	await waitFor(
		() => detailScroller() !== null && allProjectsButton() !== null,
		"the detail view",
	);
	return handle;
};

/** A real press, the way a user makes one. */
const press = async (element) => {
	await act(async () => {
		element.dispatchEvent(
			new window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
	await tick();
};

/* -------------------------------------------------------------- tests -- */

test("re-entering the same project lands the shared detail scroller at the top", async () => {
	await mountPage(`/projects/${FIRST.id}`);

	/*
	 * THE UX ROUND'S OWN TECHNIQUE, made mechanical: MARK the node before
	 * leaving, so every later reading can assert it is the SAME node - the
	 * reuse is what lets an offset survive at all, and a test that only
	 * re-queried "a scroller" could pass on a fresh node whose 0 means
	 * nothing.
	 */
	const marked = detailScroller();
	marked.dataset.entryScrollProbe = "detail-scroller";
	marked.scrollTop = 500;
	assert.equal(
		marked.scrollTop,
		500,
		"jsdom stores the offset (no layout engine clamps it) - without that this file would assert nothing",
	);

	/* Leave by the page's own control, and with the marker in place. */
	const leave = allProjectsButton();
	assert.ok(leave !== null, "the detail's escape exists");
	await press(leave);
	await waitFor(() => rowButton(FIRST.name) !== null, "the list");

	assert.ok(
		current.container.querySelector(
			'[data-entry-scroll-probe="detail-scroller"]',
		) === marked,
		"the list view still draws the SAME root node (the reuse the UX round measured) - the offset really does ride the node across the round trip",
	);

	/* Re-open the SAME project, by its own row. */
	const row = rowButton(FIRST.name);
	assert.ok(row !== null, "the list draws the row");
	await press(row);
	await waitFor(() => detailScroller() !== null, "the detail again");

	const after = detailScroller();
	assert.equal(
		after,
		marked,
		"the re-entry draws the same node (so the reset below is the effect, not a fresh element's default)",
	);
	assert.equal(
		after.scrollTop,
		0,
		"re-opening the same project must land at the top - the reused node must not carry the offset the reader left",
	);
});

test("entering a different project lands the shared detail scroller at the top", async () => {
	await mountPage(`/projects/${FIRST.id}`);

	const marked = detailScroller();
	marked.dataset.entryScrollProbe = "detail-scroller";
	/* A second, different offset: the reset must not be an accident of one
	 * particular number. */
	marked.scrollTop = 640;

	const leave = allProjectsButton();
	assert.ok(leave !== null, "the detail's escape exists");
	await press(leave);
	await waitFor(() => rowButton(SECOND.name) !== null, "the list");

	const other = rowButton(SECOND.name);
	assert.ok(other !== null, "the list draws the other project's row");
	await press(other);
	await waitFor(() => detailScroller() !== null, "the other detail");

	const after = detailScroller();
	assert.equal(after, marked, "the other project's detail draws the same node");
	assert.equal(
		after.scrollTop,
		0,
		"opening a DIFFERENT project is an entry too - it must land at the top",
	);
});

/* Registered LAST: node:test runs hooks in registration order, and this file's
 * tests are defined above this line (see the header). */
after(() => {
	for (const { container, handle } of mounted) {
		handle.root.unmount();
		container.remove();
	}
});
