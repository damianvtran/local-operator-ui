import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act } from "react";

/*
 * The Projects search's TWO ENGINES driven at the PAGE level — the half a story
 * `play` cannot reach on this machine, because a play runs only where a story is
 * rendered in a BROWSER and the capture rig is a shared, single-slot resource
 * (agent review round 1, M1).
 *
 * WHAT IS DRIVEN: the SHIPPED `ProjectsPage` in jsdom, against the same desktop
 * bridge the app calls, with the capability answer flipped between the two
 * runtimes that matter — `projects: 1` (every backend older than core v0.65.0)
 * and `projects: 2` (the derived index). Each engine is asserted for its ROWS
 * and for its COPY, because the copy is what this change reconciled and the one
 * thing a still cannot falsify: the sentence must be true of whichever engine
 * produced the rows on screen.
 *
 * WHY THE STUB RECORDS EVERY REQUEST (the `projects-time-window` rule, sharpened
 * for this file): a surface that issues an op the stub cannot answer fails
 * loudly rather than rendering with quietly missing data — but here the OPEN
 * question is exactly WHICH op the page issues, so the recorded request list is
 * an assertion target and not only a guard. The `projects: 1` case asserts the
 * index is NEVER asked; the `projects: 2` case asserts it IS, with the string
 * the box holds.
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
/* A null 2D context: jsdom has none, and the page's graph asks for one at
 * import time on some themes (the sibling harness keeps the same stub). */
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
const NOW_SECONDS = Math.floor(
	new Date(2026, 8, 20, 14, 0, 0, 0).getTime() / 1000,
);

/* ------------------------------------------------------- the real modules -- */

/*
 * The PURE modules first: the file asks the shipped `projectsSearchQuery` what
 * the box's string is and the shipped `searchProjects` what the FALLBACK should
 * draw, rather than restating either rule. A test that re-derived the slice
 * would keep passing while the page sliced somewhere else - which is precisely
 * the defect MINOR-2 was.
 */
const pureBundle = await build({
	stdin: {
		contents:
			'export * as search from "./src/renderer/src/features/projects/project-search"; export { PROJECTS_SEARCH_MAX_CHARS } from "./src/shared/desktop-contract";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { search, PROJECTS_SEARCH_MAX_CHARS } = await import(
	`data:text/javascript;base64,${Buffer.from(pureBundle.outputFiles[0].text).toString("base64")}`
);

/* ---------------------------------------------------------------- rows -- */

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
	progress_updated_at: null,
	updated_at: NOW_SECONDS,
	...extra,
});

/*
 * THE THREE ROWS THE PAIR IS PHOTOGRAPHED ON, each carrying a different job:
 *
 *   - `invoice-run` is findable by the CLIENT matcher (the word is in its name),
 *     so it appears under both engines;
 *   - `billing-cutover` says nothing about an invoice in any field the listing
 *     carries, and the index's answer names it because its UPDATE text does -
 *     the row that discriminates "the index served" from "the fallback did";
 *   - `over-long`'s NAME IS the bounded string, so it is an exact hit under the
 *     slice both engines are asked and unreachable under the longer box (the
 *     subsequence band cannot reach the tail). The MINOR-2 pin therefore reads
 *     this row's presence as "the fallback ranked the slice".
 */
const LONG_QUERY = `${"a".repeat(PROJECTS_SEARCH_MAX_CHARS)} needletail`;
const LONG_SLICE = search.projectsSearchQuery(LONG_QUERY);
/** A row whose name IS the sliced string: an exact hit under the slice, and
 * nothing under the longer box (the subsequence band cannot reach the tail). */
const OVER_LONG_ROW = row("over-long", LONG_SLICE);

const ROWS = [
	row("invoice-run", "invoice-run", {
		description: "Nightly invoice run",
		team: "platform",
		updated_at: NOW_SECONDS - 7200,
	}),
	row("billing-cutover", "billing-cutover", {
		description: "Move the billing cutover to the new gate",
		team: "atlas",
		status: "planning",
		updated_at: NOW_SECONDS - 432000,
	}),
	OVER_LONG_ROW,
];

/* --------------------------------------------------------------- bridge -- */

/**
 * The scenario the bridge answers from: which capability version the runtime
 * advertises, what the index's answer is, and how it behaves. Reset per test by
 * `mountPage`, so one case cannot leak into the next.
 */
let scenario = {
	/** The `projects` capability the `capabilities` answer carries. */
	projectsFeature: 1,
	/** The ids the index's answer names, in the answer's rank order. */
	indexIds: [],
	/** Hold the index's request open for ever (the in-flight state). */
	indexHangs: false,
	/** Fail the index's request with this sentence (the fallback's arm). */
	indexFails: null,
};

/** Every request the page issued, in order — the "which op, with what" record. */
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
					features: { projects: scenario.projectsFeature },
				},
			},
		};
	}
	if (request.op === "projects.list") {
		return { status: 200, body: { result: { projects: ROWS } } };
	}
	if (request.op === "projects.search") {
		if (scenario.indexHangs) return new Promise(() => {});
		if (scenario.indexFails) {
			return { status: 500, body: { detail: scenario.indexFails } };
		}
		const byId = new Map(ROWS.map((entry) => [entry.id, entry]));
		const hits = scenario.indexIds.flatMap((id) => {
			const found = byId.get(id);
			return found
				? [{ id, name: found.name, score: 1, fields: ["updates"] }]
				: [];
		});
		/*
		 * The echo is the request's own `q`, which is the route's contract and the
		 * rule the page applies an answer by: a stub that echoed anything else
		 * would be testing the refusal path instead of the happy one.
		 */
		return {
			status: 200,
			body: {
				result: {
					projects: hits,
					query: String(request.q ?? ""),
					count: hits.length,
				},
			},
		};
	}
	/* A `projects.get` the timeline would fan out is not reachable in the LIST
	 * view this file mounts; anything else is a defect worth hearing about. */
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
import { MemoryRouter } from "react-router-dom";
import { ProjectsPage } from "./src/renderer/src/features/projects/components/projects-page";
export { PROJECTS_SEARCH_DEBOUNCE_MS } from "./src/renderer/src/features/projects/hooks/use-projects-search";

export function mount(container, nowMs) {
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
				{ initialEntries: ["/projects"] },
				createElement(ProjectsPage, { nowMs }),
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
		sourcefile: "projects-search-index.mjs",
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
	/*
	 * THE PAGE'S GRAPH NOW REACHES THE COMPOSER (2026-10-05): the detail sheet's
	 * quick-send strip mounts the shared `MessageInput`, whose empty-chat chrome
	 * imports `BrandMark` and therefore a PNG. These aliases and loaders are
	 * `agents-composer-mount.test.mjs`'s recipe, so the bundle resolves the same
	 * assets every other composer-mounting rig does.
	 */
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
	`./_projects-search-index-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, pageBundle.outputFiles[0].text);
/*
 * `finally`, not a following `await`: a failed import used to leave the bundle
 * in `scripts/`, where `lint:scripts` picks it up as a changed file and biome
 * dies reading it (the sibling harness measured exactly that).
 */
const { mount, PROJECTS_SEARCH_DEBOUNCE_MS } = await import(
	bundlePath.href
).finally(() => unlink(bundlePath));

/* ------------------------------------------------------------ helpers -- */

const tick = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 25));
	});

/** Poll the live tree until `predicate` holds, with a generous boot budget. */ const waitFor =
	async (predicate, what) => {
		for (let attempt = 0; attempt < 800; attempt++) {
			if (predicate()) return;
			await tick();
		}
		throw new Error(
			`the page never reached: ${what} | keys=${JSON.stringify(rowKeys())} | ops=${JSON.stringify(requests.map((r) => r.op))} | body=${bodyText().slice(0, 300)}`,
		);
	};

/**
 * The CURRENT mount, and the reason the queries below are scoped to it: jsdom
 * keeps every container appended to the document, so a document-wide
 * `[data-project-name]` query counted the PREVIOUS test's rows as well and the
 * boot wait never settled (measured: six keys for three rows, four tests red).
 * `mountPage` therefore tears its predecessor down before mounting.
 */
let current = null;

/** The List's rows in RENDERED order, by key — the page's own hook. */
const rowKeys = () =>
	[...(current?.container.querySelectorAll("[data-project-name]") ?? [])].map(
		(node) => node.dataset.projectName ?? "",
	);

/**
 * Let real time pass on the page's own clock, so a claim that something did NOT
 * happen can be made: no request is observable by definition, so the window it
 * would have fired in is what the assertion waits out. Sized from the SHIPPED
 * debounce constant rather than a literal, so a change to the debounce cannot
 * turn this into a test of a window that closed too early.
 */
const settle = async (ms) => {
	const until = Date.now() + ms;
	while (Date.now() < until) await tick();
};

/** The current mount's own text, never the whole document's. */
const bodyText = () => current?.container.textContent ?? "";

/**
 * Mount the shipped page under one scenario, ONE MOUNT AT A TIME: the previous
 * one is unmounted and its container removed first, so a test's tree cannot be
 * counted by the next one's queries (see `current`).
 */
const mounted = [];
const mountPage = async (overrides = {}) => {
	const previous = mounted.pop();
	if (previous) {
		await act(async () => {
			previous.handle.root.unmount();
		});
		previous.container.remove();
		current = null;
	}
	scenario = {
		projectsFeature: 1,
		indexIds: [],
		indexHangs: false,
		indexFails: null,
		...overrides,
	};
	requests = [];
	/*
	 * The view is PERSISTED, so this file states it rather than inheriting
	 * whatever the previous case (or another suite in this process) left: the
	 * assertions read the LIST's rows and the LIST's count sentence.
	 */
	localStorage.setItem("projects-view", "list");
	const container = document.createElement("div");
	document.body.appendChild(container);
	const handle = mount(container, NOW_MS);
	mounted.push({ container, handle });
	current = { container, handle };
	/* The listing has drawn before any test reads a row. */
	await waitFor(() => rowKeys().length === ROWS.length, "the listing");
	return handle;
};

const NOW_MS = NOW_SECONDS * 1000;

/** Type into the box the way a browser does: the native setter, then `input`. */
const type = async (value) => {
	const field = current?.container.querySelector(
		'input[aria-label="Search projects"]',
	);
	if (!field) throw new Error("the search field is missing");
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	)?.set;
	await act(async () => {
		setter.call(field, value);
		field.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
};

const searchRequests = () =>
	requests.filter((request) => request.op === "projects.search");

/* -------------------------------------------------------------- tests -- */

test("with no index advertised the page never asks for one, and the copy is the client's", async () => {
	await mountPage({ projectsFeature: 1 });
	await type("invoice");
	await waitFor(
		() => bodyText().includes("1 of 3 projects"),
		"the client engine's count",
	);
	/* The row whose word is in its own name; and NOT the row only the index's
	 * update text could reach. */
	assert.deepEqual(rowKeys(), ["invoice-run"]);
	/*
	 * AND THE WINDOW IS WAITED OUT BEFORE THE CLAIM IS MADE. "No request was
	 * sent" has no event to observe, so a test that asserted it immediately
	 * would pass on a page that asks 180 ms later - which is exactly what this
	 * file's first draft did, and what the gate falsification caught: removing
	 * the capability gate from the hook call left all six tests green. Two
	 * debounce windows of real time on the page's own clock, sized from the
	 * shipped constant.
	 */
	await settle(2 * PROJECTS_SEARCH_DEBOUNCE_MS);
	assert.equal(
		searchRequests().length,
		0,
		"a version-1 backend has no route to answer, so asking it is the 404 this app must not cause",
	);
	/* The no-match case carries the CLIENT matcher's sentence, which is true of
	 * what actually searched. */
	await type("zzznothing");
	await waitFor(
		() => bodyText().includes("No projects match"),
		"the no-match block",
	);
	assert.ok(bodyText().includes("Update text is not searched."));
	assert.ok(!bodyText().includes("teams and update text."));
});

test("with the index advertised the page paints its answer, in the answer's order", async () => {
	await mountPage({
		projectsFeature: 2,
		indexIds: ["billing-cutover", "invoice-run"],
	});
	await type("invoice");
	await waitFor(
		() => rowKeys().includes("billing-cutover"),
		"the index's own hit",
	);
	const asked = searchRequests();
	assert.equal(
		asked.length >= 1,
		true,
		"the index is asked when it is advertised",
	);
	assert.equal(
		asked[asked.length - 1].q,
		"invoice",
		"the request carries the box's own string",
	);
	assert.deepEqual(
		rowKeys(),
		["billing-cutover", "invoice-run"],
		"the answer's RANK ORDER, not the listing's order and not a local re-sort",
	);
	assert.ok(bodyText().includes("2 of 3 projects"));
});

test("with the index advertised and nothing matching, the copy is the INDEX's", async () => {
	await mountPage({ projectsFeature: 2, indexIds: [] });
	await type("zzznothing");
	await waitFor(
		() => bodyText().includes("No projects match"),
		"the no-match block",
	);
	/* The sentence that must NOT claim update text is unsearched: the engine
	 * that produced this empty result reads it. */
	assert.ok(
		bodyText().includes(
			"Searches names, descriptions, tags, owners, teams and update text.",
		),
	);
	assert.ok(!bodyText().includes("Update text is not searched."));
});

test("a failed index request falls back to the client's rows and the client's sentence", async () => {
	await mountPage({
		projectsFeature: 2,
		indexFails: "the index is unavailable",
	});
	await type("invoice");
	/* The fallback's row is on screen before the request even leaves, so the
	 * REQUEST is what is waited for first: the claim under test is that the
	 * failure is handled, and a test that asserted the rows immediately would
	 * pass on a page that never asked at all. */
	await waitFor(
		() => searchRequests().length >= 1,
		"the index request to be attempted",
	);
	await tick();
	await waitFor(() => rowKeys().includes("invoice-run"), "the fallback's row");
	await type("zzznothing");
	await waitFor(
		() => bodyText().includes("No projects match"),
		"the no-match block on the fallback",
	);
	assert.ok(
		bodyText().includes("Update text is not searched."),
		"the sentence is the engine's that actually answered",
	);
});

test("while the index is owed an answer the fallback's rows stand, and an empty fallback says it is still searching", async () => {
	await mountPage({ projectsFeature: 2, indexHangs: true });
	await type("invoice");
	await waitFor(
		() => rowKeys().includes("invoice-run"),
		"the fallback's row while the request is in flight",
	);
	/* Not "nothing matches": the index may be about to contradict it. */
	assert.ok(!bodyText().includes("No projects match"));
	await type("zzznothing");
	await waitFor(() => bodyText().includes("Searching"), "the in-flight line");
	assert.ok(!bodyText().includes("No projects match"));
	assert.deepEqual(rowKeys(), []);
});

test("an over-bound paste asks both engines the SAME string", async () => {
	/*
	 * MINOR-2's pin, and the assertion is chosen to FAIL on the code it was
	 * written against: `over-long`'s name IS the 256-character slice, so it is an
	 * exact hit under the bounded string and unreachable under the full box. The
	 * fallback rendering that row is the proof that the page ranked the SLICE;
	 * with the old `searchProjects(projects, query)` it drew nothing, and the
	 * list changed the moment the index's answer landed.
	 */
	await mountPage({ projectsFeature: 2, indexHangs: true });
	await type(LONG_QUERY);
	/* The request is what is waited for: it is proof the debounce fired, and with
	 * the index held open the rows below stay the FALLBACK's for good. */
	await waitFor(
		() => searchRequests().length >= 1,
		"the index request for the bounded string",
	);
	await tick();
	const asked = searchRequests();
	assert.equal(
		asked[asked.length - 1].q,
		LONG_SLICE,
		"the wire carries the bounded string",
	);
	assert.equal(
		LONG_SLICE.length,
		PROJECTS_SEARCH_MAX_CHARS,
		"the route's own bound",
	);
	/*
	 * THE ASSERTION THAT FAILS ON THE CODE THIS PIN WAS WRITTEN AGAINST: the
	 * admitted set must be the client matcher's over the BOUNDED string. The old
	 * page ranked the box, and the bounded string is an EXACT hit on
	 * `over-long`'s name while the box reaches nothing - so a fallback reading
	 * the box drew no rows at all, and the list would have changed the moment
	 * the index's answer landed.
	 */
	assert.deepEqual(
		rowKeys(),
		search.searchProjects(ROWS, LONG_SLICE).map((entry) => entry.name),
	);
	assert.deepEqual(
		search.searchProjects(ROWS, LONG_QUERY),
		[],
		"the full box reaches nothing, so the two strings are distinguishable",
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
