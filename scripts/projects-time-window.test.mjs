import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act } from "react";

/*
 * The board's time window (feat/board-time-window), in two halves.
 *
 * HALF ONE is the model, executed bare in Node the way `projects-tab.test.mjs`
 * runs it: the ladder's tokens, labels, phrases and arithmetic, the guarded
 * store, the predicate's inclusive boundary in SECONDS, and the empty-window
 * heading. The module under test is the real one; nothing is re-implemented.
 *
 * HALF TWO drives the SHIPPED page in jsdom (the `projects-card-click.test.mjs`
 * harness): the window narrows the BOARD alone (the List and the Timeline must
 * still draw every row), the control appears exactly where the board can
 * render, and the empty window's "Show all time" action widens and persists.
 * The stub answers only the ops the page actually issues, so a new op says so
 * loudly rather than rendering a surface with quietly missing data.
 *
 * ORDER IS LOAD-BEARING, and measured: every top-level `await` finishes BEFORE
 * the first `test()` is registered. A `test()` registered above an await lets
 * node:test drain its queue mid-evaluation, and an `after()` hook registered by
 * then RUNS - closing this file's JSDOM under the tests that are still being
 * defined (reproduced: the hook fired between two tests, and every later test
 * hit `document === undefined`). The same discipline puts the hook itself
 * after the last registration.
 *
 * WHAT THIS FILE DOES NOT DO: click the Select open. That is an interaction
 * against a real browser (the story plays drive it, and the capture frames
 * photograph the panel); jsdom's synthetic pointer cannot prove Radix's
 * positioning, and a green assertion there would be evidence about jsdom.
 */

/* ---------------------------------------------------------------- model -- */

const modelBundle = await build({
	stdin: {
		contents:
			'export * as model from "./src/renderer/src/features/projects/project-model";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	/* `project-model` reads the i18n locale layer (@shared/i18n), whose shim
	 * reaches src/i18n by relative path — only the @shared alias is needed
	 * (the `turn-timestamp.test.mjs` recipe). */
	alias: {
		"@shared": "./src/renderer/src/shared",
	},
	write: false,
});
const { model } = await import(
	`data:text/javascript;base64,${Buffer.from(modelBundle.outputFiles[0].text).toString("base64")}`
);

const {
	BOARD_WINDOWS,
	DEFAULT_BOARD_WINDOW,
	PROJECTS_BOARD_WINDOW_STORAGE_KEY,
	boardWindowEmptyHeading,
	boardWindowMeta,
	boardWindowProjects,
	isBoardWindow,
	readBoardWindow,
	writeBoardWindow,
} = model;

/* ----------------------------------------------------------------- page -- */

/*
 * The environment first, before the page's bundle is even built: react-dom
 * feature-detects input support at import time, so the document has to exist
 * before the entry that pulls it in is imported (the bounded window below
 * replaces itself on load, which is why the test that needs it waits for
 * `load`, not for the constructor).
 */
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
 * above skips it; the page's store must BE jsdom's, explicitly, or every
 * readBoardWindow would read an undefined object, fail its try/catch, and fall
 * back to the default - green on the wrong thing.
 */
globalThis.localStorage = dom.window.localStorage;
dom.window.Element.prototype.scrollIntoView = () => {};
/*
 * A null 2D context: jsdom has none, and the page's graph reaches a text
 * measurer that asks for one at import time - jsdom's "not implemented"
 * write-up lands on stderr as an error a reader would take for this file's
 * fault (`secret-ask.test.mjs` keeps the same stub for the same reason).
 */
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
/* jsdom has no matchMedia; the page tree asks nothing today, and a hostile
 * environment is what keeps that true. */
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

/** The instant the stories and the fixtures pin, so ages are a function of it. */
const NOW_MS = new Date(2026, 8, 20, 14, 0, 0, 0).getTime();
const HOUR_S = 3600;
const DAY_S = 86_400;

/** A listing row, every required field present, overridable. */
const row = (id, name, ageSeconds, extra = {}) => ({
	id,
	name,
	title: null,
	description: "",
	owner: null,
	team: null,
	status: "active",
	progress: null,
	progress_updated_at: null,
	progress_reported_by: "",
	progress_stale: false,
	tags: [],
	created_at: NOW_MS / 1000 - ageSeconds,
	updated_at: NOW_MS / 1000 - ageSeconds,
	start_date: null,
	target_date: null,
	completed_at: null,
	estimate: null,
	estimate_unit: "points",
	sessions: 0,
	live_sessions: 0,
	milestones: [],
	milestones_completed: 0,
	milestones_total: 0,
	...extra,
});

/** One listing row as the `projects.get` document the timeline fans out for. */
const detailForRow = (project) => ({
	project: {
		id: project.id,
		name: project.name,
		title: project.title,
		owner: project.owner,
		team: project.team,
		description: project.description,
		status: project.status,
		progress: "",
		progress_updated_at: project.progress_updated_at,
		progress_reported_by: "",
		progress_stale: project.progress_stale,
		tags: project.tags,
		sessions: [],
		created_at: project.updated_at,
		updated_at: project.updated_at,
		start_date: project.start_date,
		target_date: project.target_date,
		completed_at: project.completed_at,
		estimate: project.estimate,
		estimate_unit: project.estimate_unit,
		milestones: [],
		updates: [],
	},
	links: [],
});

/*
 * The bridge the page mounts against, the same shape the stories' stub uses:
 * `capabilities` opens the gate (the surface exists in this install), and the
 * listing answers from `rows`. Any other op is an error rather than a shrug -
 * a surface that issues one the stub does not know must fail loudly here, not
 * render with quietly missing data.
 */
const stub = { rows: [], details: {} };
const answer = (request) => {
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
		return { status: 200, body: { result: { projects: stub.rows } } };
	}
	if (request.op === "projects.get") {
		const found = stub.details[String(request.key ?? "")];
		return found
			? { status: 200, body: { result: found } }
			: { status: 404, body: { detail: "no such project" } };
	}
	return {
		status: 404,
		body: { detail: `this harness has no answer for ${request.op}` },
	};
};
dom.window.api = { desktop: { request: (request) => answer(request) } };

const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ProjectsPage } from "./src/renderer/src/features/projects/components/projects-page";

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

/** Any bare specifier; the resolver plugin keeps only the named ones external. */
const BARE_SPECIFIER = /^[^./]/;
/** React, ReactDOM and React Query stay out of the bundle; everything else goes in. */
const EXTERNAL = /^(react|react-dom|@tanstack\/react-query)(\/.*)?$/;

const bundle = await build({
	stdin: {
		contents: ENTRY,
		resolveDir: process.cwd(),
		sourcefile: "projects-time-window.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	/*
	 * REACT AND REACT QUERY STAY OUT; EVERYTHING ELSE GOES IN (the
	 * `run-panel-navigation.test.mjs` shape). React must be THIS process's copy
	 * - element symbols and `act` are per-instance - and React Query must be
	 * too, or the provider below and the hooks inside the page hand each other
	 * different module objects. Everything else is BUNDLED because the page's
	 * graph reaches MUI through deep directory specifiers
	 * (`@mui/material/styles`), which node's ESM resolver refuses: left
	 * external, the bundle loads and then dies on the import.
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
	`./_projects-time-window-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
/*
 * `finally`, not a following `await`: a failed import (a directory-import
 * refusal, a syntax error) used to leave the 1 MB bundle in `scripts/` - where
 * `lint:scripts` picks it up as a changed file and biome dies reading it
 * (reproduced: `spawnSync biome ENOBUFS`).
 */
const { mount } = await import(bundlePath.href).finally(() =>
	unlink(bundlePath),
);

const tick = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 25));
	});

/** Poll the live tree until `predicate` holds, with a generous boot budget. */
const waitFor = async (predicate, what) => {
	for (let attempt = 0; attempt < 400; attempt++) {
		if (predicate()) return;
		await tick();
	}
	throw new Error(`the page never reached: ${what}`);
};

const cards = () =>
	[...document.querySelectorAll("[data-project-name]")].map(
		(node) => node.dataset.projectName,
	);

/** Mount the shipped page against the stub, with its stored choices set. */
async function openPage({ rows = [], details = {}, view, windowToken } = {}) {
	stub.rows = rows;
	stub.details = details;
	localStorage.clear();
	if (view) localStorage.setItem("projects-view", view);
	if (windowToken) {
		localStorage.setItem(PROJECTS_BOARD_WINDOW_STORAGE_KEY, windowToken);
	}
	const host = document.createElement("div");
	document.body.append(host);
	const handle = await act(() => mount(host, NOW_MS));
	return {
		...handle,
		teardown: async () => {
			await act(() => {
				handle.root.unmount();
				handle.client.clear();
			});
			host.remove();
		},
	};
}

/** One mount, torn down whatever the assertions do. */
const withPage = async (options, run) => {
	const view = await openPage(options);
	try {
		await run();
	} finally {
		await view.teardown();
	}
};

/* ------------------------------------------------------------- the tests -- */

test("the ladder owns the tokens, the labels, the phrases and the arithmetic", () => {
	assert.deepEqual(
		BOARD_WINDOWS.map((entry) => entry.value),
		["24h", "7d", "30d", "90d", "all"],
	);
	assert.deepEqual(
		BOARD_WINDOWS.map((entry) => entry.label),
		[
			"Last 24 hours",
			"Last 7 days",
			"Last 30 days",
			"Last 90 days",
			"All time",
		],
	);
	assert.deepEqual(
		BOARD_WINDOWS.map((entry) => entry.phrase),
		[
			"the last 24 hours",
			"the last 7 days",
			"the last 30 days",
			"the last 90 days",
			null,
		],
	);
	assert.deepEqual(
		BOARD_WINDOWS.map((entry) => entry.seconds),
		[86_400, 604_800, 2_592_000, 7_776_000, null],
	);
	/* The default is the ladder's own rung, and `all` carries no arithmetic. */
	assert.equal(DEFAULT_BOARD_WINDOW, "7d");
	assert.equal(boardWindowMeta("7d").seconds, 604_800);
	assert.equal(boardWindowMeta("all").seconds, null);
	/* An unrecognised token reads as the DEFAULT's row, never as `all`: a
	 * window nothing can vouch for must narrow the board, not open it. */
	assert.deepEqual(boardWindowMeta("bogus"), boardWindowMeta("7d"));
	assert.ok(isBoardWindow("90d"));
	assert.ok(!isBoardWindow("90"));
	assert.ok(!isBoardWindow("ALL"));
	assert.ok(!isBoardWindow(""));
});

test("the window store is guarded, and an unreadable token reads as the default", () => {
	const key = PROJECTS_BOARD_WINDOW_STORAGE_KEY;
	assert.equal(key, "projects-board-window");
	const original = globalThis.localStorage;
	const store = new Map();
	globalThis.localStorage = {
		getItem: (name) => store.get(name) ?? null,
		setItem: (name, value) => store.set(name, value),
		removeItem: (name) => store.delete(name),
	};
	try {
		/* Nothing stored: the default. */
		assert.equal(readBoardWindow(), "7d");
		/* Every ladder token round-trips. */
		for (const token of ["24h", "7d", "30d", "90d", "all"]) {
			store.set(key, token);
			assert.equal(readBoardWindow(), token);
		}
		/* Anything else reads as ABSENT, and the absent answer is the default -
		 * never "show everything" silently. */
		for (const junk of ["ALL", "All time", "90", "", "7days", '{"v":"7d"}']) {
			store.set(key, junk);
			assert.equal(readBoardWindow(), "7d");
		}
		/* A write lands the value token, not JSON and not a label. */
		writeBoardWindow("30d");
		assert.equal(store.get(key), "30d");
	} finally {
		globalThis.localStorage = original;
	}
});

test("a locked store cannot fail the read or the write", () => {
	const original = globalThis.localStorage;
	globalThis.localStorage = {
		getItem: () => {
			throw new Error("locked");
		},
		setItem: () => {
			throw new Error("locked");
		},
	};
	try {
		assert.equal(readBoardWindow(), "7d");
		/* A failed persist must not fail the change. */
		writeBoardWindow("all");
	} finally {
		globalThis.localStorage = original;
	}
});

test("the predicate is inclusive at the boundary, in seconds, over updated_at", () => {
	const nowMs = 1_800_000_000_000;
	const at = (ageSeconds) => ({
		id: `r${ageSeconds}`,
		name: `r${ageSeconds}`,
		updated_at: nowMs / 1000 - ageSeconds,
	});
	/* Exactly at the boundary is INSIDE; one second past is out. */
	assert.equal(boardWindowProjects([at(86_400)], "24h", nowMs).length, 1);
	assert.equal(boardWindowProjects([at(86_401)], "24h", nowMs).length, 0);
	assert.equal(boardWindowProjects([at(604_800)], "7d", nowMs).length, 1);
	assert.equal(boardWindowProjects([at(604_801)], "7d", nowMs).length, 0);
	assert.equal(boardWindowProjects([at(2_592_000)], "30d", nowMs).length, 1);
	assert.equal(boardWindowProjects([at(7_776_001)], "90d", nowMs).length, 0);
	/* A real ladder over one set: the rungs are nested, and the fixture's own
	 * ages land where the stories' frames say they do. */
	const rows = [
		at(2 * 3600),
		at(5 * 86_400),
		at(12 * 86_400),
		at(45 * 86_400),
		at(200 * 86_400),
	];
	const names = (window) =>
		boardWindowProjects(rows, window, nowMs).map((project) => project.name);
	assert.deepEqual(names("24h"), ["r7200"]);
	assert.deepEqual(names("7d"), ["r7200", "r432000"]);
	assert.deepEqual(names("30d"), ["r7200", "r432000", "r1036800"]);
	assert.deepEqual(names("90d"), ["r7200", "r432000", "r1036800", "r3888000"]);
	assert.equal(names("all").length, 5);
	/* A future stamp (clock skew) is inside every window - the predicate does
	 * not clamp, it compares. */
	assert.equal(boardWindowProjects([at(-3600)], "24h", nowMs).length, 1);
	/* `all` is NO PREDICATE: the very same array, not a filtered copy. */
	assert.equal(boardWindowProjects(rows, "all", nowMs), rows);
	/* A filtered window is a new array; the input is never mutated. */
	const narrowed = boardWindowProjects(rows, "7d", nowMs);
	assert.notEqual(narrowed, rows);
	assert.equal(rows.length, 5);
});

test("the empty-window heading embeds the ladder's phrase, and `all` has none", () => {
	assert.equal(
		boardWindowEmptyHeading("24h"),
		"Nothing changed in the last 24 hours.",
	);
	assert.equal(
		boardWindowEmptyHeading("7d"),
		"Nothing changed in the last 7 days.",
	);
	assert.equal(
		boardWindowEmptyHeading("30d"),
		"Nothing changed in the last 30 days.",
	);
	assert.equal(
		boardWindowEmptyHeading("90d"),
		"Nothing changed in the last 90 days.",
	);
	/* Unreachable at `all`: no predicate can narrow a non-empty listing to
	 * nothing, which is why the one value whose heading could not be true
	 * never gets one. */
	assert.equal(boardWindowEmptyHeading("all"), null);
});

test("the window narrows the board - and only the board", async () => {
	const rows = [
		row("a", "recent-work", 2 * HOUR_S),
		row("b", "older-work", 5 * DAY_S),
	];
	/* A stored 24h window: the board draws one card. */
	await withPage({ rows, view: "board", windowToken: "24h" }, async () => {
		await waitFor(() => cards().length === 1, "the narrowed board");
		assert.deepEqual(cards(), ["recent-work"]);
	});

	/* The SAME stored window over the List: every row, because the window is
	 * the board's preference and the list's job is the sweep of everything. */
	await withPage({ rows, view: "list", windowToken: "24h" }, async () => {
		await waitFor(() => cards().length === 2, "the unfiltered list");
		assert.deepEqual(cards().sort(), ["older-work", "recent-work"]);
	});

	/* And the Timeline, whose fan-out reads the same listing. The two rows
	 * carry dates: the timeline draws bars only for projects with a span, and
	 * an undated pair would photograph the no-dates state instead. */
	const datedRows = [
		row("a", "recent-work", 2 * HOUR_S, {
			start_date: "2026-09-01",
			target_date: "2026-10-15",
		}),
		row("b", "older-work", 5 * DAY_S, {
			start_date: "2026-08-20",
			target_date: "2026-09-30",
		}),
	];
	await withPage(
		{
			rows: datedRows,
			details: {
				a: detailForRow(datedRows[0]),
				b: detailForRow(datedRows[1]),
			},
			view: "timeline",
			windowToken: "24h",
		},
		async () => {
			await waitFor(() => cards().length === 2, "the unfiltered timeline");
			assert.deepEqual(cards().sort(), ["older-work", "recent-work"]);
		},
	);
});

test("the window control appears only where the board can render", async () => {
	const rows = [row("a", "one", HOUR_S)];
	/* On the board: present. */
	await withPage({ rows, view: "board" }, async () => {
		await waitFor(
			() =>
				document.querySelector('[data-tour-tag="projects-board-window"]') !==
				null,
			"the control on the board",
		);
	});
	/* In the List - even with rows on screen: absent. */
	await withPage({ rows, view: "list" }, async () => {
		await waitFor(() => cards().length === 1, "the list's rows");
		assert.equal(
			document.querySelector('[data-tour-tag="projects-board-window"]'),
			null,
			"the control must hide in the List view",
		);
	});
	/* Over the STORE-empty state: absent (a window over nothing widens
	 * nothing; the state's own action is "New project"). */
	await withPage({ rows: [], view: "board" }, async () => {
		await waitFor(
			() => (document.body.textContent ?? "").includes("No projects yet."),
			"the store-empty state",
		);
		assert.equal(
			document.querySelector('[data-tour-tag="projects-board-window"]'),
			null,
			"the control must hide over the store-empty state",
		);
	});
});

test("the empty window names the ladder, and its action widens and persists", async () => {
	const rows = [row("a", "old-a", 12 * DAY_S), row("b", "old-b", 45 * DAY_S)];
	await withPage({ rows, view: "board" }, async () => {
		await waitFor(
			() =>
				(document.body.textContent ?? "").includes(
					"Nothing changed in the last 7 days.",
				),
			"the empty-window heading",
		);
		assert.ok(
			(document.body.textContent ?? "").includes(
				"Older projects are hidden by the window.",
			),
			"the empty-window body copy",
		);
		assert.equal(cards().length, 0, "no card under the empty window");
		const action = [...document.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Show all time"),
		);
		assert.ok(action, "the Show all time action");
		await act(() => {
			action.dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		});
		await waitFor(() => cards().length === 2, "the widened board");
		assert.deepEqual(cards().sort(), ["old-a", "old-b"]);
		assert.equal(
			localStorage.getItem(PROJECTS_BOARD_WINDOW_STORAGE_KEY),
			"all",
			"the recovery must persist the token it widened to",
		);
		/*
		 * AND THE CARET COMES BACK (UX round 1, U3; pinned here because review
		 * round 2 asked for the assert that discriminates rather than for the
		 * sentence). The action unmounts the button the press came from, so
		 * without the hand-back `document.activeElement` is BODY - a keyboard
		 * reader dropped at the top of the document with the state they just
		 * changed behind them. Measured: this assertion fails on `864b71e559`
		 * (activeElement = body) and passes from `d89f1aa15d`.
		 */
		const control = document.querySelector(
			'[data-tour-tag="projects-board-window"]',
		);
		assert.ok(control, "the window control is still on screen at `all`");
		await waitFor(
			() => document.activeElement === control,
			"the caret to come back to the window control",
		);
		assert.equal(
			document.activeElement,
			control,
			"the recovery must hand the caret back to the window control",
		);
	});
});

/*
 * LAST, and that is the point (see the file's header): by the time a hook can
 * run, every test above is registered. The window is closed so its timers do
 * not outlive the file; the properties are cleared so a later reader (or a
 * `--test-isolation` re-run) sees this file left nothing global behind.
 */
after(() => {
	dom.window.close();
	Reflect.deleteProperty(globalThis, "window");
	Reflect.deleteProperty(globalThis, "document");
	Reflect.deleteProperty(globalThis, "localStorage");
	Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});
