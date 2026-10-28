import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * THE SKILLS TAB (U1, read-only): the mounted `AgentsPage` against a bridge that
 * answers like core's `skill_library:1`, plus the pure rules it is built on.
 *
 * WHY THIS IS A MOUNT AND NOT ONLY A STORY. The tab's behaviour is its STATE
 * TRANSITIONS - capability absent -> no tab and NO request; loading -> populated;
 * a refused read -> an error with a Retry that actually re-asks; an empty list vs
 * a search with no match -> two different sentences - and a still photographs one
 * state, it cannot show which read produced it. The bridge below records every op
 * it is asked, which is what makes "no request" and "re-asked" checkable.
 *
 * THE TRANSPORT IS FAKED AND NOTHING ELSE: the shipped `AgentsPage`, the shipped
 * hooks, the shipped `hubSkillState()` and the shipped catalogue run for real. The
 * wire shapes are core's (local-operator #2998, `desktop_skills.py`), written out
 * from its PR body, so a field this build invented would not be in these fixtures.
 *
 * jsdom has no layout engine; geometry is the frames' job (see the PR).
 */

/*
 * `window` AND `document` MUST EXIST BEFORE REACT DOM IS EVALUATED, or typing is
 * dead. react-dom decides at MODULE scope whether the platform has an `input`
 * event (`canUseDOM && isEventSupported("input")`); evaluated with no DOM it
 * answers no, and a text field's `onChange` then never fires - the search box
 * would look unwired when the harness is what is broken. `localStorage` is
 * deliberately NOT given here: `agent-class-toggle.test.mjs` measured that a
 * storage present at import time rehydrates the persisted stores and hangs the
 * file, so only the two globals React asks about are defined early, and the full
 * shim set still arrives after the import as before.
 */
const { JSDOM: EarlyJSDOM } = await import("jsdom");
const earlyDom = new EarlyJSDOM("<!doctype html>", {
	url: "http://localhost/",
});
// No storage on the early window: see the measurement above.
Object.defineProperty(earlyDom.window, "localStorage", {
	value: undefined,
	configurable: true,
});
globalThis.window = earlyDom.window;
globalThis.document = earlyDom.window.document;

const pageBundle = await build({
	stdin: {
		contents: [
			'export { AgentsPage } from "./src/renderer/src/features/agents/components/agents-page";',
			'export * as model from "./src/renderer/src/features/agents/skills-library-model";',
			'export { useRetryFocus } from "./src/renderer/src/features/agents/components/skills-library";',
			/*
			 * The box's own store, so the storage below can be given to THAT store and no
			 * other (see the note under the import).
			 */
			'export { useConversationInputStore } from "./src/renderer/src/shared/store/conversation-input-store";',
			// The run's pure seams the Skills composer widens (seam note §3-§4).
			'export * as summary from "./src/renderer/src/features/agents/config-run/summary";',
			'export { configRunEnabled, configSkillRunEnabled } from "./src/renderer/src/features/agents/config-run/use-config-run";',
			'export { configSeedPrompt, CONFIG_BOX_KEY } from "./src/renderer/src/features/agents/config-run/config-composer";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	/*
	 * A REAL `require` FOR THE CJS HALF OF THE GRAPH. The page still reaches
	 * `@emotion/react` through the MUI theme modules the migration has not moved
	 * yet, and that package's CJS build calls `require("react")` - which esbuild's
	 * ESM output refuses by default (`Dynamic require of "react" is not
	 * supported`, raised asynchronously and therefore AFTER the tests that ran).
	 * React 18 is CJS-only, so `import` and this `require` reach the SAME module
	 * instance rather than a second copy: no second React, no split context.
	 */
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"react-router-dom",
		/*
		 * External so the provider and the bundled hooks share ONE copy: a bundled
		 * second copy carries a different context, and `useQuery` would not find the
		 * client this file seeds (the reason `transcript-focus-behaviour.test.mjs`
		 * states for the same list).
		 */
		"@tanstack/react-query",
	],
	tsconfig: "tsconfig.web.json",
});
/*
 * THE BUNDLE LANDS ON DISK FOR THE LENGTH OF THE IMPORT, not in a `data:` URL:
 * a data: module cannot resolve the bare specifiers above, and the failure is an
 * `ERR_UNSUPPORTED_RESOLVE_REQUEST` raised asynchronously - after the tests that
 * had already registered have passed, so it reads as a green run with a mystery
 * epilogue. The pid keeps two of these files apart, and the unlink is immediate.
 */
const pageBundlePath = new URL(
	`./_skills-tab-page-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(pageBundlePath, pageBundle.outputFiles[0].text);
const PAGE = await import(pageBundlePath.href);
await unlink(pageBundlePath);

/*
 * WHY THE DOM AND ITS STORAGE ARRIVE AFTER THE BUNDLE, AND WHAT THAT COSTS THE
 * ONE CASE THAT NEEDS THEM EARLIER (QA round 2, Q1).
 *
 * zustand's `persist` resolves its storage ONCE, when the store module is
 * evaluated - and this page's stores are created at import time. Installing
 * jsdom's `localStorage` BEFORE the import was measured to hang this file: with a
 * storage in place the persisted stores REHYDRATE, which mounts a long-lived 5 s
 * connectivity poller (`useInternetConnectivity`), and the file then never exits
 * (`Promise resolution is still pending but the event loop has already resolved`,
 * with react-query's "Query data cannot be undefined" once per interval). The
 * ordering therefore stays as it was: the import first, the DOM after.
 *
 * The cost is that `useConversationInputStore` captured `undefined` as its
 * storage, so the box's own text threw `Cannot read properties of undefined
 * (reading 'setItem')` on every write - a harness failure that looks EXACTLY
 * like the Q1 defect (a press that leaves the box empty), which is why it is
 * fixed here rather than tolerated: the store is given an in-memory storage of
 * its own, which is the smallest thing that makes the write path real without
 * rehydrating anything the other stores persist. It is set on that store alone,
 * so no other test in this file changes behaviour.
 */
const memoryStorage = {
	getItem: () => null,
	setItem: () => undefined,
	removeItem: () => undefined,
};
/*
 * WHETHER THERE IS A `persist` API AT ALL IS A PROPERTY OF THE NODE RUNTIME, AND
 * CI RUNS A DIFFERENT ONE (agent review round 10, B1). zustand attaches
 * `api.persist` only when the middleware's storage factory RETURNED a storage,
 * and that factory defaults to `() => localStorage`. Node 22 - what `ci.yml`
 * sets up - has no `localStorage` global at all, so the reference THROWS,
 * `createJSONStorage` returns undefined, and the middleware takes its no-storage
 * branch: the store comes back bare, with no `.persist` to configure and no
 * hydration to await. Node 26 DECLARES the global (it is `undefined` without
 * `--localstorage-file`), so the same factory returns undefined instead of
 * throwing, zustand wraps it, and `.persist` exists with a storage whose first
 * write rejects. Calling the missing API is what took this file down on CI: the
 * `TypeError ... reading 'setOptions'` was raised HERE, during module evaluation,
 * so the file died before its seven jsdom cases - the round-9 case among them -
 * ever registered.
 *
 * The guard makes both runtimes correct instead of picking one. Where the API
 * exists (the local runtime) the store is given the in-memory storage, exactly as
 * before. Where it does not (CI) there is nothing to configure and nothing to
 * rehydrate: the middleware has ALREADY degraded the store to in-memory with no
 * storage at all, and `use-message-input.ts` documents that as a state it renders
 * in ("no persistence means no restored draft, never a broken page") - its effect
 * settles the box as hydrated when `persist` is absent, which is what lets the
 * seeded sentence reach the field there. Declaring a `localStorage` global before
 * the import would give the store a storage on both runtimes, and is the hazard
 * the block above was written about.
 */
const persistApi = PAGE.useConversationInputStore.persist;
if (persistApi) {
	persistApi.setOptions({ storage: memoryStorage });
	/*
	 * AND A HYDRATION THAT CAN COMPLETE. The hook whose box this is adopts a store
	 * write only once `persist.hasHydrated()` is true (`use-message-input.ts`'s
	 * "adopt a draft written from outside this hook" effect), and the failed
	 * hydration at import time left that flag FALSE - so the seed would land in the
	 * store and never reach the field. The storage above is what makes this
	 * rehydrate resolve; it is awaited before any mount, so no test sees a
	 * half-hydrated store.
	 */
	await persistApi.rehydrate();
}

const { JSDOM } = await import("jsdom");
const dom = new JSDOM("<!doctype html>", { url: "http://localhost/" });
const { window } = dom;
/*
 * THE DESKTOP BRIDGE, INERT.
 *
 * `window.electron` is a renderer global that only the app's preload writes
 * (`src/preload/index.ts`), so a DOM-less harness that mounts a page reaching it
 * has to supply its own — there is no other owner. `MessageInput` reaches it from
 * a passive effect on mount (the platform whose send chord it renders, and the
 * dialog behind attach), and this branch mounts that composer on `AgentsPage`
 * (`AgentPage` -> `ConfigComposer` -> `MessageInput`), which is how this file
 * came to need one: before that, nothing it rendered touched the bridge.
 *
 * The stand-in answers and nothing else, the shape
 * `agents-composer-mount.test.mjs` uses for the same composer and
 * `src/renderer/src/features/chat/components/story-electron-shim.ts` documents
 * for the stories ("Storybook's preview mocks `window.api` and not
 * `window.electron` ... so there is no other owner to restore it for"). The
 * transport this file is actually about is installed per mount, in
 * `installBridge` below, as `window.api`.
 */
window.electron = {
	ipcRenderer: {
		on: () => () => {},
		removeListener: () => window.electron.ipcRenderer,
		send: () => {},
		invoke: async (channel) =>
			channel === "get-platform-info"
				? { platform: "darwin" }
				: { canceled: true, filePaths: [] },
	},
};
/*
 * EVERY DOM CONSTRUCTOR THE TREE CAN NAME, copied by name rather than listed by
 * hand: the page reaches for `HTMLFormElement` and friends inside effects, and a
 * missing global surfaces there as a `ReferenceError` inside a React commit -
 * raised after the assertions of whichever test was running, which reads as a
 * component that failed to render for no stated reason.
 */
const SHIMMED_GLOBALS = [
	"Element",
	"Node",
	"NodeList",
	"DocumentFragment",
	"ShadowRoot",
	"HTMLElement",
	"HTMLAnchorElement",
	"HTMLButtonElement",
	"HTMLCanvasElement",
	"HTMLDivElement",
	"HTMLFormElement",
	"HTMLImageElement",
	"HTMLInputElement",
	"HTMLParagraphElement",
	"HTMLSelectElement",
	"HTMLSpanElement",
	"HTMLStyleElement",
	"HTMLTextAreaElement",
	"SVGElement",
	"MouseEvent",
	"KeyboardEvent",
	"FocusEvent",
	"PointerEvent",
	"InputEvent",
	"Event",
	"CustomEvent",
	"MutationObserver",
	"IntersectionObserver",
	"DOMParser",
	"XMLSerializer",
	// Radix's focus scope walks a TreeWalker with NodeFilter when a menu or a
	// dialog opens (the Remove double-confirm, review r1 m3).
	"NodeFilter",
];
/*
 * NO REAL NETWORK. A hub skill's pane now mounts the agents' `HubLinksPanel`,
 * whose sign-in/credential probes reach `HealthApi.healthCheck` through the global
 * `fetch` - a real request to whatever listens on the configured port, which on a
 * shared host is somebody's live process. Its keep-alive socket then held this
 * file open until the runner's timeout (measured: 2 TCP sockets in
 * `process.getActiveResourcesInfo()` after teardown). The transport under test is
 * the desktop bridge above; anything that leaves it is refused here, quietly, the
 * way an offline machine answers.
 */
const offlineFetch = async () => {
	throw new TypeError("fetch is disabled in skills-tab.test.mjs");
};
const shims = {
	window,
	document: window.document,
	fetch: offlineFetch,
	navigator: window.navigator,
	localStorage: window.localStorage,
	getComputedStyle: window.getComputedStyle.bind(window),
	requestAnimationFrame: (callback) => {
		setTimeout(callback, 0);
		return 0;
	},
	cancelAnimationFrame: () => {},
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	matchMedia: (query) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
		dispatchEvent: () => false,
	}),
};
for (const key of SHIMMED_GLOBALS) {
	if (key in window) shims[key] = window[key];
}
const originals = new Map();
for (const [key, value] of Object.entries(shims)) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
window.matchMedia ??= shims.matchMedia;

const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = await import("react");
const { MemoryRouter, Route, Routes } = await import("react-router-dom");
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);

/* ------------------------------------------------------------- fixtures --- */

const CAPS = (features = {}) => ({
	desktop_contract: 1,
	desktop_available: true,
	desktop_auth: "bearer",
	features: { profile_catalogue: 1, team_catalogue: 1, ...features },
});
const WITH_SKILLS = { skill_library: 1, hub_links: 1, hub_updates: 1 };

/** A `skills.list` row as core sends it (all six additive fields). */
const skill = (over = {}) => ({
	name: "local-skill",
	description: "A skill the reader wrote.",
	source: "local",
	link_id: null,
	editable: true,
	installed: true,
	fingerprint: "f".repeat(64),
	form: "document",
	...over,
});

const linkRow = (over = {}) => ({
	link_id: "link-1",
	kind: "skill",
	local_id: "pulled-org",
	name: "pulled-org",
	hub_id: "hub-skill-1",
	hub_source: "https://hub.example",
	visibility: "public",
	tenant_id: null,
	tenant_name: null,
	policy: { subscribe: true, auto_push: false, revision: "r1" },
	eligibility: { can_auto_push: false, reason: null },
	baseline_state: "pull",
	remote_revision: "rev-1",
	content_state: "present",
	local_path: "/home/u/.local-operator/skills/pulled-org",
	auto_will_apply: false,
	auto_will_push: false,
	pull: { state: "up-to-date" },
	push: { state: "up-to-date" },
	...over,
});

const FIVE = [
	skill({ name: "b-builtin", source: "builtin", editable: false }),
	skill({ name: "c-hub", source: "hub", link_id: "link-1" }),
	skill({ name: "d-local", source: "local" }),
	skill({ name: "e-external", source: "external", editable: false }),
	skill({ name: "f-project", source: "project", editable: false }),
];

/**
 * The bridge. `world` is mutable per test; `ops` records every request; a
 * handler value may be a function (called per request) so a case can fail the
 * first read and answer the second.
 */
const installBridge = (world) => {
	const ops = [];
	window.api = {
		desktop: {
			request: async (request) => {
				ops.push(request.name ? `${request.op}:${request.name}` : request.op);
				switch (request.op) {
					case "capabilities":
						// `capsGate` holds the answer (the capability query is LOADING);
						// `capsFail` refuses it (the capability query ERRORED).
						if (world.capsGate) await world.capsGate;
						if (world.capsFail)
							return { status: 500, body: { detail: "capabilities refused" } };
						return {
							status: 200,
							body: { result: CAPS(world.features ?? WITH_SKILLS) },
						};
					case "aida.status":
						return { status: 200, body: { result: { enabled: false } } };
					case "profiles.list":
						return { status: 200, body: { result: { profiles: [] } } };
					case "teams.list":
						return { status: 200, body: { result: { teams: [] } } };
					case "settings.list":
						return { status: 200, body: { result: { settings: [] } } };
					case "hub.links":
						return {
							status: 200,
							body: { result: { links: world.links ?? [], unresolved: [] } },
						};
					case "hub.updates":
						return {
							status: 200,
							body: {
								result: {
									generated_at: "2026-10-26T00:00:00Z",
									credential: "ok",
									settings: {
										auto_agents: false,
										auto_teams: false,
										interval_min: 60,
									},
									counts: {},
									items: world.updates ?? [],
								},
							},
						};
					case "skills.list": {
						// Awaited so a case can HOLD the answer (a promise) to observe loading.
						const answer = await (typeof world.skills === "function"
							? world.skills(request)
							: world.skills);
						if (answer instanceof Error) throw answer;
						if (answer?.status) return answer;
						return { status: 200, body: { result: { data: answer } } };
					}
					case "skills.create":
					case "skills.update":
					case "skills.remove": {
						// Only a world that opts in (`write`) accepts a write, so every
						// other case keeps proving the tab sends none (review r1 m3).
						if (!world.write)
							throw new Error(
								`unexpected desktop op in this test: ${request.op}`,
							);
						const answer = await world.write(request);
						return answer ?? { status: 200, body: { result: {} } };
					}
					default:
						throw new Error(
							`unexpected desktop op in this test: ${request.op}`,
						);
				}
			},
		},
	};
	return ops;
};

/*
 * EVERY MOUNTED VIEW, so a case whose assert throws before its own `teardown`
 * cannot leave a live React root (and its query timers) holding the file open
 * until the runner's timeout - which turned one failed assert into a 300 s hang
 * with no verdict printed. The file's `after` hook tears down what is left.
 */
const mounted = new Set();

const mount = async (path, world) => {
	const ops = installBridge(world);
	const container = document.createElement("div");
	document.body.append(container);
	// gcTime Infinity: with a window present at import, react-query is not in its
	// "server" mode and arms a 5-minute gc timer per query, which holds the test
	// process open long after every case has passed.
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
			// The write paths (review r1 m3) run mutations, whose own 5-minute gc
			// timer held the file open the same way.
			mutations: { gcTime: Number.POSITIVE_INFINITY },
		},
	});
	const root = createRoot(container);
	await act(async () => {
		root.render(
			h(
				MemoryRouter,
				{ initialEntries: [path] },
				h(
					QueryClientProvider,
					{ client },
					h(
						Routes,
						null,
						h(Route, { path: "/agents", element: h(PAGE.AgentsPage) }),
					),
				),
			),
		);
	});
	const view = { container, root, ops, client };
	mounted.add(view);
	return view;
};

const settle = async (done, budgetMs = 4_000) => {
	const started = Date.now();
	while (Date.now() - started < budgetMs) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});
		if (done()) return true;
	}
	return false;
};

const q = (container, selector) => container.querySelector(selector);
const text = (node) => node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const press = async (node) => {
	await act(async () => {
		node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
};
const mouseDown = async (node) => {
	// Radix Tabs activates on mousedown, not click.
	await act(async () => {
		node.dispatchEvent(
			new window.MouseEvent("mousedown", { bubbles: true, button: 0 }),
		);
	});
};
const typeInto = async (input, value) => {
	await act(async () => {
		const setter = Object.getOwnPropertyDescriptor(
			window.HTMLInputElement.prototype,
			"value",
		).set;
		setter.call(input, value);
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
};
const teardown = async (view) => {
	if (!mounted.delete(view)) return;
	await act(async () => view.root.unmount());
	view.container.remove();
	/*
	 * AND THE CLIENT'S CACHE. The default `gcTime: Infinity` above covers queries
	 * that take the default, but a hub skill's pane mounts `HubLinksPanel`, whose
	 * memberships query sets its own 10-minute `gcTime`: unmounting arms that
	 * timer, and it held the file open past the runner's timeout. `clear()` drops
	 * every query and its timer.
	 */
	view.client?.clear();
};
/*
 * ABSENCE IS ASSERTED ON A BOOLEAN, NEVER ON THE NODE. `assert.equal(node, null)`
 * that FAILS makes node:assert inspect the node, and a React-owned DOM node
 * drags its entire fiber graph (every prop, hook and closure of the page) into
 * the message: measured at 1.8 MB / +2.4 GB RSS for a 30-div toy tree, and past
 * 100 GB for this page - the memory-guard kills of 2026-10-26 were this, not a
 * render loop. A failing absence check must be a one-line message.
 */
const assertAbsent = (node, what) =>
	assert.ok(node === null, `${what} should be absent`);
const rowOf = (container, name) =>
	q(container, `[data-testid="skill-row-${name}"]`);

/* ----------------------------------------------- the pure rules, no React --- */

test("the details body: ASCII slice, and an emoji counted in UTF-16 units", () => {
	const { skillBody } = PAGE.model;
	// ASCII: unit count == char count.
	const ascii = "# Title\nUse it.";
	assert.equal(
		skillBody(`${ascii}\n\nreferences:\n- a.md`, {
			name: "x",
			body: null,
			body_in_detail: true,
			body_length: ascii.length,
		}),
		ascii,
	);
	// An astral character is TWO UTF-16 units here and ONE code point in Python.
	// core reports body_length in UTF-16 units, so slicing with it must return the
	// whole body; counting code points (Array.from) would cut it 2 units short.
	const emoji = "Ship it \u{1F680} now";
	assert.equal(emoji.length, 14, "JS counts the rocket as two units");
	assert.equal(Array.from(emoji).length, 13, "a code-point count differs");
	const detail = `${emoji}\n\nreferences:\n- a.md`;
	assert.equal(
		skillBody(detail, {
			name: "x",
			body: null,
			body_in_detail: true,
			body_length: emoji.length,
		}),
		emoji,
	);
	// NEGATIVE CONTROL: the wrong (code-point) length truncates the tail.
	assert.notEqual(
		skillBody(detail, {
			name: "x",
			body: null,
			body_in_detail: true,
			body_length: Array.from(emoji).length,
		}),
		emoji,
	);
});

test("the details body: inlined when body_in_detail is false; null when there is none", () => {
	const { skillBody } = PAGE.model;
	assert.equal(
		skillBody("resolver text", {
			name: "x",
			body: "inlined body",
			body_in_detail: false,
			body_length: 12,
		}),
		"inlined body",
	);
	// Subscribed-not-installed: core sends body null and body_in_detail false.
	assert.equal(
		skillBody("", { name: "x", body: null, body_in_detail: false }),
		null,
	);
	// A detail that claims to live in `detail` but the response has none.
	assert.equal(
		skillBody(undefined, {
			name: "x",
			body: null,
			body_in_detail: true,
			body_length: 5,
		}),
		null,
	);
	assert.equal(skillBody("d", undefined), null);
});

test("an older core's short rows normalise without throwing", () => {
	const { toSkillCard, toSkillCards } = PAGE.model;
	const card = toSkillCard({ name: "legacy", description: "old" });
	assert.deepEqual(card, {
		name: "legacy",
		description: "old",
		source: null,
		linkId: null,
		installed: true,
		fingerprint: null,
		form: null,
		// Only an explicit `true` from core is editable; an older row is not.
		editable: false,
	});
	assert.equal(toSkillCard({ name: "n", editable: true }).editable, true);
	// A label this build does not know is unknown, not a crash and not a guess.
	assert.equal(toSkillCard({ name: "n", source: "cloud" }).source, null);
	// Only an explicit false is "not installed".
	assert.equal(toSkillCard({ name: "n", installed: false }).installed, false);
	assert.deepEqual(
		toSkillCards([{ name: "b" }, { name: "a" }]).map((c) => c.name),
		["a", "b"],
	);
});

test("the hub join is by link_id, only for hub rows", () => {
	const { joinSkillHub, toSkillCard } = PAGE.model;
	const link = linkRow();
	const hub = toSkillCard(
		skill({ name: "pulled-org", source: "hub", link_id: "link-1" }),
	);
	const joined = joinSkillHub(hub, [link], new Map(), true);
	assert.equal(joined.state.kind, "pulled");
	// A different link_id is NOT joined by name.
	const stranger = toSkillCard(
		skill({ name: "pulled-org", source: "hub", link_id: "other" }),
	);
	assert.equal(
		joinSkillHub(stranger, [link], new Map(), true).state.kind,
		"not-present",
	);
	// A local skill has no hub relationship at all.
	assert.equal(
		joinSkillHub(toSkillCard(skill()), [link], new Map(), true),
		null,
	);
	// Inventory not ready -> unknown, never "not downloaded".
	assert.equal(
		joinSkillHub(hub, undefined, new Map(), false).state.kind,
		"unknown",
	);
});

/* -------------------------------------------------------- the mounted tab --- */

test("capability absent: no tab is offered and no skill request is sent", async () => {
	const view = await mount("/agents", { features: {}, skills: { skills: [] } });
	await settle(
		() =>
			view.ops.includes("capabilities") && view.ops.includes("profiles.list"),
	);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 60));
	});
	assertAbsent(
		q(view.container, '[data-testid="skills-tab"]'),
		"the Skills tab",
	);
	assert.ok(
		q(view.container, '[data-testid="agents-tab"]'),
		"the two-tab strip is intact",
	);
	assert.ok(q(view.container, '[data-testid="teams-tab"]'));
	assert.deepEqual(
		view.ops.filter((op) => op.startsWith("skills.") || op.startsWith("hub.")),
		[],
		"nothing skill- or hub-shaped was requested",
	);
	await teardown(view);
});

/*
 * THE REAL GATE, IN EVERY STATE IT CAN BE IN, counted over a window.
 *
 * `desktopFeatureEnabled` answers "unknown" for no capabilities at all and
 * "below-version" for a backend without the key, and `.enabled` is true only for
 * "enabled" - so loading, errored, absent and below-version all FAIL CLOSED. Each
 * case below mounts the unmutated page for ~1 s and records every op: the claim is
 * zero skill requests AND a finite, small request count (a render or refetch loop
 * would show as a count that grows with the window). Counts are asserted, never
 * the DOM node (see `assertAbsent`).
 */
const skillOps = (ops) => ops.filter((op) => op.startsWith("skills."));
const hubOps = (ops) => ops.filter((op) => op.startsWith("hub."));

test("gate fails CLOSED while the capability query is loading: zero skill requests, no loop", async () => {
	let release;
	const capsGate = new Promise((resolve) => {
		release = resolve;
	});
	const view = await mount("/agents?kind=skill", {
		capsGate,
		skills: { skills: [FIVE[0]] },
	});
	await settle(() => false, 800);
	assert.deepEqual(skillOps(view.ops), []);
	assert.deepEqual(hubOps(view.ops), []);
	assert.ok(
		view.ops.length < 10,
		`bounded request count while loading: ${view.ops.length}`,
	);
	assertAbsent(
		q(view.container, '[data-testid="skills-tab"]'),
		"the Skills tab",
	);
	release();
	await teardown(view);
});

test("gate fails CLOSED when the capability query ERRORS: zero skill requests, no loop", async () => {
	const view = await mount("/agents?kind=skill", {
		capsFail: true,
		skills: { skills: [FIVE[0]] },
	});
	await settle(() => false, 1500);
	assert.deepEqual(skillOps(view.ops), []);
	assert.deepEqual(hubOps(view.ops), []);
	assert.ok(
		view.ops.length < 12,
		`bounded request count after a refusal: ${view.ops.length}`,
	);
	assertAbsent(
		q(view.container, '[data-testid="skills-tab"]'),
		"the Skills tab",
	);
	await teardown(view);
});

test("skill_library present WITHOUT hub_links / hub_updates: one list read, no hub requests, hub rows say unavailable", async () => {
	const view = await mount("/agents?kind=skill", {
		features: { skill_library: 1 },
		skills: {
			skills: [skill({ name: "c-hub", source: "hub", link_id: "link-1" })],
		},
	});
	assert.ok(await settle(() => rowOf(view.container, "c-hub")));
	await settle(() => false, 800);
	assert.deepEqual(
		hubOps(view.ops),
		[],
		"no links or updates read without their capabilities",
	);
	assert.equal(
		skillOps(view.ops).length,
		1,
		"exactly one list read, not a refetch loop",
	);
	// The inventory can never answer, so the ROW invents nothing (no "not
	// downloaded" for a skill that is on disk): line two is the description alone.
	assert.equal(
		q(rowOf(view.container, "c-hub"), '[data-testid="skill-row-state"]') ===
			null,
		true,
		"no state word while the hub inventory cannot answer",
	);
	assert.doesNotMatch(
		text(rowOf(view.container, "c-hub")),
		/Not downloaded|Downloaded|Subscribed/,
	);
	await teardown(view);
});

/*
 * Q2 / R2: opening a skill must not ask `profiles.get` / `teams.get` for the SKILL's
 * name (a guaranteed 404 on every open, seen on the real wire 5 of 5). Asserted on
 * the recorded request log with booleans - never on a DOM node (see `assertAbsent`).
 */
const definitionReads = (ops) =>
	ops.filter(
		(op) => op.startsWith("profiles.get") || op.startsWith("teams.get"),
	);

test("opening a skill sends no profiles.get / teams.get (capability present)", async () => {
	const view = await mount("/agents?kind=skill&name=d-local", {
		skills: (request) =>
			request.name
				? {
						skills: FIVE,
						detail: "x",
						skill_detail: {
							...FIVE[2],
							body: "BODY",
							body_in_detail: false,
							body_length: 4,
							files: [],
							files_total: 0,
							files_truncated: false,
						},
					}
				: { skills: FIVE },
	});
	assert.ok(
		await settle(() =>
			/BODY/.test(text(q(view.container, '[data-testid="skill-detail"]'))),
		),
	);
	await settle(() => false, 400);
	assert.deepEqual(definitionReads(view.ops), []);
	await teardown(view);
});

test("a kind=skill&name= deep link on a core WITHOUT skill_library sends no profiles.get either", async () => {
	const view = await mount("/agents?kind=skill&name=some-skill", {
		features: {},
		skills: { skills: [] },
	});
	await settle(() => view.ops.includes("profiles.list"));
	await settle(() => false, 400);
	assert.deepEqual(definitionReads(view.ops), []);
	assert.deepEqual(skillOps(view.ops), []);
	await teardown(view);
});

/*
 * Q1: THE THREE-TAB STRIP. What jsdom CAN prove is the contract the geometry
 * depends on: every trigger may shrink (`min-w-0`), the label is the part that
 * truncates, the count is visually-hidden-not-removed when narrow (so it stays in
 * the accessible name), the icon is the first thing to go, and the title carries
 * label + count. What ONLY the real app proves is the pixels: that the strip's
 * scrollWidth <= clientWidth at 1380 px in each locale and that each trigger's
 * centre hits the trigger - jsdom has no layout engine, and no container-query
 * support, so those numbers are QA's real-app measurement, not this file's.
 */
test("the browse strip: label-sized tabs that can still shrink; the count stays in the accessible name", async () => {
	const view = await mount("/agents", {
		skills: { skills: FIVE },
	});
	assert.ok(
		await settle(() =>
			/5/.test(text(q(view.container, '[data-testid="skills-tab"]'))),
		),
	);
	for (const id of ["agents-tab", "teams-tab", "skills-tab"]) {
		const trigger = q(view.container, `[data-testid="${id}"]`);
		assert.ok(
			trigger.className.includes("min-w-0"),
			`${id} may shrink below its content`,
		);
		// D3: sized to the LABEL (flex-auto), not an equal third (flex-1), so a short
		// label hands its slack to the long one.
		assert.ok(
			trigger.className.includes("flex-auto"),
			`${id} is sized to its label`,
		);
		assert.ok(
			!trigger.className.includes("flex-1"),
			`${id} is not an equal third`,
		);
		assert.ok(
			!trigger.className.includes("@container"),
			`${id} is not a size container (it would defeat flex-auto)`,
		);
		assert.ok(
			q(trigger, `[data-testid="${id}-label"]`).className.includes("truncate"),
			`${id}'s label is the last-resort truncation`,
		);
		assert.equal(
			trigger.querySelector("svg") === null,
			true,
			`${id} draws no icon in the compact strip`,
		);
	}
	const skills = q(view.container, '[data-testid="skills-tab"]');
	assert.equal(skills.getAttribute("title"), "Skills 5");
	const count = [...skills.querySelectorAll("span")].find(
		(node) => node.textContent === "5",
	);
	assert.ok(
		count.className.includes("sr-only"),
		"the count is visually hidden, not removed",
	);
	assert.ok(
		!count.className.includes("hidden"),
		"the count is never display:none",
	);
	assert.match(text(skills), /Skills\s*5/);
	assert.ok(
		!/overflow-x-(auto|scroll)/.test(
			q(view.container, '[role="tablist"]').className,
		),
	);
	assert.equal(skills.hasAttribute("aria-controls"), false);
	await teardown(view);
});

test("old core (no skill_library): the two-tab strip keeps its equal halves, icons and counts", async () => {
	const view = await mount("/agents", { features: {}, skills: { skills: [] } });
	assert.ok(
		await settle(() =>
			/\d/.test(text(q(view.container, '[data-testid="agents-tab"]'))),
		),
	);
	for (const id of ["agents-tab", "teams-tab"]) {
		const trigger = q(view.container, `[data-testid="${id}"]`);
		assert.ok(trigger.className.includes("flex-1"), `${id} is an equal half`);
		assert.ok(!trigger.className.includes("flex-auto"));
		assert.ok(trigger.querySelector("svg"), `${id} keeps its icon`);
	}
	const count = [
		...q(view.container, '[data-testid="agents-tab"]').querySelectorAll("span"),
	].find((n) => /^\d+$/.test(n.textContent));
	assert.ok(
		!count.className.includes("sr-only"),
		"the count stays visible on the two-tab strip",
	);
	await teardown(view);
});

/*
 * D1 / U1: a hub row with an update mark must keep its NAME. The structural
 * contract jsdom can prove: line one holds ONLY the name and the source word (no
 * mark, no shrink-0 chip beside the name), the mark leads LINE TWO, and line two is
 * one truncating run. The 0 px name was a pixel fact; the measured acceptance
 * (every name has non-zero width in en/es/ur at 1380 and 800 px, every row's text
 * starts at one x) is QA's real-app check, not this file's.
 */
test("a hub row with a failed update: name and source on line one, the mark leads line two", async () => {
	const row = skill({ name: "hub-linked", source: "hub", link_id: "link-1" });
	const view = await mount("/agents?kind=skill", {
		skills: { skills: [row] },
		links: [linkRow({ name: "hub-linked", local_id: "hub-linked" })],
		updates: [
			{
				kind: "skill",
				name: "hub-linked",
				state: "failed",
				error_class: "network",
				last_error: "x",
			},
		],
	});
	assert.ok(await settle(() => rowOf(view.container, "hub-linked")));
	assert.ok(
		await settle(() =>
			q(
				rowOf(view.container, "hub-linked"),
				'[data-testid="skill-row-state"] [data-hub-mark-state]',
			),
		),
	);
	const button = rowOf(view.container, "hub-linked");
	const lineOne = q(button, '[data-testid="skill-row-source"]').parentElement;
	assert.equal(
		lineOne.querySelector("[data-hub-mark-state]") === null,
		true,
		"no mark on line one",
	);
	assert.match(text(lineOne), /^hub-linked/);
	assert.ok(
		lineOne.firstElementChild.className.includes("truncate"),
		"the name truncates",
	);
	const lineTwo = q(button, '[data-testid="skill-row-line2"]');
	assert.ok(
		lineTwo.querySelector("[data-hub-mark-state]"),
		"the mark is on line two",
	);
	// The read-only surface must not promise a retry it does not have.
	assert.equal(
		text(lineTwo.querySelector("[data-hub-mark-state]")),
		"Update failed",
		"the failed mark is the short, instruction-free string",
	);
	assert.ok(
		lineTwo.className.includes("truncate"),
		"line two truncates as ONE run",
	);
	// The chip keeps its base `shrink-0`, which is inert inside a BLOCK run: line two
	// must not be a flex container, or that chip could push past the row again.
	assert.equal(
		/\b(flex|inline-flex|grid)\b/.test(lineTwo.className),
		false,
		"line two is a block run, so no child can refuse to shrink",
	);
	assert.equal(
		/\binline-flex\b/.test(q(lineTwo, "[data-hub-mark-state]").className),
		true,
		"the chip is inline inside the run",
	);
	// The mark comes first on line two.
	assert.ok(
		lineTwo.firstElementChild.getAttribute("data-testid") === "skill-row-state",
	);
	assert.equal(
		rowOf(view.container, "hub-linked").getAttribute("data-skill-state"),
		"failed",
	);
	await teardown(view);
});

/* M1: an old core + a kind=skill&name= link is the Agents tab, not a skeleton forever. */
test("a kind=skill&name= link on an old core shows the Agents empty pane, not a skeleton", async () => {
	const view = await mount("/agents?kind=skill&name=whatever", {
		features: {},
		skills: { skills: [] },
	});
	await settle(() => view.ops.includes("profiles.list"));
	await settle(() => false, 400);
	assert.equal(
		q(view.container, '[aria-hidden="true"].space-y-8') === null,
		true,
		"no detail skeleton",
	);
	assert.equal(
		q(view.container, '[data-testid="agents-tab"]').getAttribute("data-state"),
		"active",
	);
	await teardown(view);
});

/* D4: nothing in the right pane while the list is loading or empty. */
test("the select-a-skill prompt is absent while loading and when there are no skills", async () => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const loading = await mount("/agents?kind=skill", {
		skills: async () => {
			await gate;
			return { skills: [FIVE[0]] };
		},
	});
	await settle(() => false, 300);
	assert.equal(
		q(loading.container, '[data-testid="skills-select-prompt"]') === null,
		true,
		"absent while loading",
	);
	release();
	assert.ok(
		await settle(() =>
			q(loading.container, '[data-testid="skills-select-prompt"]'),
		),
		"present once populated",
	);
	await teardown(loading);
	const empty = await mount("/agents?kind=skill", { skills: { skills: [] } });
	assert.ok(
		await settle(() => q(empty.container, '[data-testid="skills-empty"]')),
	);
	assert.equal(
		q(empty.container, '[data-testid="skills-select-prompt"]') === null,
		true,
		"absent when empty",
	);
	await teardown(empty);
});

/* D5 positive control: a not-installed row with NO hub sentence still gets the badge. */
test("a not-installed skill with no hub sentence keeps its badge", async () => {
	const orphan = skill({ name: "orphan", source: "local", installed: false });
	const view = await mount("/agents?kind=skill&name=orphan", {
		skills: (request) =>
			request.name
				? {
						skills: [orphan],
						detail: null,
						skill_detail: {
							...orphan,
							body: null,
							body_in_detail: false,
							body_length: null,
							files: [],
							files_total: 0,
							files_truncated: false,
						},
					}
				: { skills: [orphan] },
	});
	assert.ok(
		await settle(() =>
			/Not installed/.test(
				text(q(view.container, '[data-testid="skill-meta"]')),
			),
		),
		"the header's meta line says Not installed",
	);
	await teardown(view);
});

/* D6 + U7: a reference preview is clamped, and the truncation notice precedes the control. */
test("a reference preview is clamped behind Show all, and the notice comes before the body's control", async () => {
	const row = skill({ name: "refs" });
	const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
	const view = await mount("/agents?kind=skill&name=refs", {
		skills: (request) =>
			request.name
				? {
						skills: [row],
						detail: "T",
						skill_detail: {
							...row,
							body: "T",
							body_in_detail: false,
							body_length: 1,
							body_truncated: true,
							body_bytes: 300000,
							files: [
								{
									path: "long.txt",
									size: 400,
									preview: long,
									preview_truncated: true,
								},
							],
							files_total: 1,
							files_truncated: false,
						},
					}
				: { skills: [row] },
	});
	assert.ok(
		await settle(() => q(view.container, '[data-testid="skill-files"]')),
	);
	const pane = q(view.container, '[data-testid="skill-detail"]');
	// U7: in document order the notice sits BEFORE the instructions block, hence before its Show all.
	const notice = q(pane, '[data-testid="skill-body-truncated"]');
	const body = q(pane, '[data-testid="skill-instructions"]');
	assert.ok(body, "the instructions block follows the notice");
	assert.equal(
		notice.compareDocumentPosition(body) &
			window.Node.DOCUMENT_POSITION_FOLLOWING,
		window.Node.DOCUMENT_POSITION_FOLLOWING,
	);
	// D6: open the file; its preview uses the clamped ReadBlock (line-clamp class), not a bare <pre>.
	await press(q(pane, '[data-testid="skill-files"] button'));
	const region = q(pane, '[data-testid="skill-files"] section');
	assert.ok(region, "the preview region opened");
	assert.equal(
		region.querySelector("pre") === null,
		true,
		"no unbounded <pre>",
	);
	assert.ok(
		region.querySelector('[class*="line-clamp"]'),
		"the preview is line-clamped",
	);
	// Q6: the clamp must keep wrapping an UNBROKEN token. jsdom has no layout, so this
	// asserts the class contract only (`overflow-wrap:anywhere` + `min-w-0`); that the
	// 2,048-char token really stays inside the pane (scrollWidth <= clientWidth, at
	// 1380 and 800 px, en and ur) is QA's real-app measurement.
	const wraps = (node, preWrap = true) => {
		const classes = node?.className ?? "";
		return (
			classes.includes("[overflow-wrap:anywhere]") &&
			classes.includes("min-w-0") &&
			(!preWrap || classes.includes("whitespace-pre-wrap"))
		);
	};
	assert.equal(
		wraps(region.querySelector('[data-break-long-tokens="true"]')),
		true,
		"the file preview wraps an unbroken token",
	);
	// The instructions are rendered markdown (block elements, so no pre-wrap), in
	// the same clamp, and still wrap an unbroken token.
	assert.equal(
		wraps(q(body, '[data-break-long-tokens="true"]'), false),
		true,
		"the SKILL.md body wraps an unbroken token",
	);
	assert.equal(
		q(body, '[data-read-markdown="true"] .lo-markdown') !== null,
		true,
		"the instructions render through ProjectMarkdown",
	);
	await teardown(view);
});

/*
 * U2: arrowing off the Skills tab must leave focus on the tab it landed on. Skill
 * mode mounts no composer, so activating Teams mounts one, and the composer's
 * mount-focus claim used to take the caret from the focused tab. The composer is
 * only enabled (and so only claims focus) with these two capabilities - without
 * them the case is a false negative - so the case asserts the composer IS there
 * (a boolean control) before asserting focus stayed on the tab.
 */
test("leaving the Skills tab by keyboard keeps focus on the tab, not the composer", async () => {
	const view = await mount("/agents?kind=skill", {
		features: { ...WITH_SKILLS, agents_config: 1, session_interrupt: 1 },
		skills: { skills: FIVE },
	});
	assert.ok(
		await settle(() => q(view.container, '[data-testid="skills-tab"]')),
	);
	const teams = q(view.container, '[data-testid="teams-tab"]');
	await act(async () => {
		teams.focus();
	});
	await settle(() => false, 400);
	assert.equal(
		q(view.container, '[data-testid="teams-tab"]').getAttribute("data-state"),
		"active",
		"focusing the tab activated it (Radix automatic activation)",
	);
	assert.equal(
		document.activeElement === q(view.container, '[data-testid="teams-tab"]'),
		true,
		"focus stayed on the tab",
	);
	await teardown(view);
});

/*
 * U9: pressing Retry arms a latch that hands focus back to Retry when the error
 * pane returns. A retry that SUCCEEDS must disarm it, or a later, unrelated failure
 * pulls focus to Retry out of whatever the reader is doing. The hook is driven
 * directly (a later failure cannot be forced through the page), and the assertions
 * are on booleans, never on the DOM node.
 */
const mountRetryProbe = async () => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	let setState;
	const { useState, useRef } = await import("react");
	function Harness() {
		const [state, set] = useState({ failed: true, fetching: false });
		setState = set;
		const retry = PAGE.useRetryFocus(state.failed, state.fetching);
		const other = useRef(null);
		return h(
			"div",
			null,
			h("input", { "data-testid": "elsewhere", ref: other }),
			state.failed
				? h(
						"div",
						{ ref: retry.holder },
						h(
							"button",
							{
								"data-testid": "retry",
								onClick: retry.onPress,
								// The real PaneError disables its button while fetching ("Retrying...")
								// and a disabled button cannot take focus - the state QA r5 Q1 hit.
								disabled: state.fetching,
							},
							"Retry",
						),
						// A second focusable INSIDE the pane (the details pane's own controls).
						h("a", { "data-testid": "inpane", href: "#x" }, "more"),
					)
				: null,
		);
	}
	await act(async () => {
		root.render(h(Harness));
	});
	const set = async (next) => {
		await act(async () => {
			setState(next);
		});
		await settle(() => false, 60);
	};
	return {
		container,
		set,
		focusedId: () => document.activeElement?.getAttribute("data-testid") ?? "",
		teardown: async () => {
			await act(async () => root.unmount());
			container.remove();
		},
	};
};

const pressRetry = async (probe) => {
	await act(async () => {
		probe.container.querySelector('[data-testid="retry"]').click();
	});
};

test("Retry focus, no cached data: the pane unmounts while fetching; a failed retry hands focus back", async () => {
	const probe = await mountRetryProbe();
	await pressRetry(probe);
	await probe.set({ failed: false, fetching: true });
	await probe.set({ failed: true, fetching: false });
	assert.equal(probe.focusedId(), "retry", "a failed retry hands focus back");
	await probe.teardown();
});

test("Retry focus, CACHED data: the pane stays mounted with a disabled button; focus lands on Retry only at the settle", async () => {
	const probe = await mountRetryProbe();
	await pressRetry(probe);
	// The error survives the fetch and the button is disabled: nothing may be focused yet.
	await probe.set({ failed: true, fetching: true });
	assert.notEqual(
		probe.focusedId(),
		"retry",
		"a disabled Retry is never focused",
	);
	// Settles with an error again: the button is enabled and takes focus.
	await probe.set({ failed: true, fetching: false });
	assert.equal(
		probe.focusedId(),
		"retry",
		"focus lands on the re-enabled Retry",
	);
	await probe.teardown();
});

test("Retry focus, CACHED data, retry succeeds: disarmed, focus is not pulled onto Retry", async () => {
	const probe = await mountRetryProbe();
	await pressRetry(probe);
	await probe.set({ failed: true, fetching: true });
	await probe.set({ failed: false, fetching: false });
	probe.container.querySelector('[data-testid="elsewhere"]').focus();
	assert.equal(probe.focusedId(), "elsewhere");
	// A LATER, unrelated background failure must not steal focus.
	await probe.set({ failed: true, fetching: false });
	assert.equal(
		probe.focusedId(),
		"elsewhere",
		"a later background failure does not pull focus to Retry",
	);
	await probe.teardown();
});

test("Retry focus: a background failure after a successful no-cache retry does not steal focus", async () => {
	const probe = await mountRetryProbe();
	await pressRetry(probe);
	await probe.set({ failed: false, fetching: true });
	await probe.set({ failed: false, fetching: false });
	probe.container.querySelector('[data-testid="elsewhere"]').focus();
	await probe.set({ failed: true, fetching: false });
	assert.equal(probe.focusedId(), "elsewhere");
	await probe.teardown();
});

test("Retry focus: a second Retry after a failed one is a fresh press that is honoured again", async () => {
	const probe = await mountRetryProbe();
	await pressRetry(probe);
	await probe.set({ failed: true, fetching: true });
	await probe.set({ failed: true, fetching: false });
	assert.equal(probe.focusedId(), "retry");
	// A real second press: the button has focus, the click arms it, and the button
	// then disables for the fetch, which drops focus to <body>.
	await pressRetry(probe);
	await probe.set({ failed: true, fetching: true });
	await act(async () => {
		document.activeElement?.blur();
	});
	await probe.set({ failed: true, fetching: false });
	assert.equal(
		probe.focusedId(),
		"retry",
		"the second press re-arms the hand-back",
	);
	await probe.teardown();
});

/*
 * R5-1 / R5-2: the hook may hand focus back ONLY to a reader who is homeless or
 * still inside the pane, and each guard must be load-bearing on its own. Each case
 * below turns a different single guard red (see the PR comment's revert-and-fail
 * table); assertions are on primitives (a testid string), never on a DOM node.
 */
test("Retry focus THEFT: the reader tabs to the search box while the retry is in flight; the failed settle leaves them there", async () => {
	const probe = await mountRetryProbe();
	await pressRetry(probe);
	await probe.set({ failed: true, fetching: true });
	probe.container.querySelector('[data-testid="elsewhere"]').focus();
	await probe.set({ failed: true, fetching: false });
	assert.equal(probe.focusedId(), "elsewhere", "focus is not yanked to Retry");
	await probe.teardown();
});

test("Retry focus: a reader who is homeless (focus on <body>) at the failed settle gets the hand-back", async () => {
	const probe = await mountRetryProbe();
	await pressRetry(probe);
	await probe.set({ failed: true, fetching: true });
	await act(async () => {
		document.activeElement?.blur();
	});
	assert.equal(probe.focusedId(), "", "focus is on <body> before the settle");
	await probe.set({ failed: true, fetching: false });
	assert.equal(probe.focusedId(), "retry", "a homeless reader gets Retry back");
	await probe.teardown();
});

test("Retry focus: a reader still inside the pane's own holder gets the hand-back", async () => {
	const probe = await mountRetryProbe();
	await pressRetry(probe);
	await probe.set({ failed: true, fetching: true });
	probe.container.querySelector('[data-testid="inpane"]').focus();
	assert.equal(probe.focusedId(), "inpane");
	await probe.set({ failed: true, fetching: false });
	assert.equal(
		probe.focusedId(),
		"retry",
		"inside the pane still counts as 'here'",
	);
	await probe.teardown();
});

test("Retry focus: the press is spent - a later REFETCH that fails does not hand focus to Retry, even to a homeless reader", async () => {
	const probe = await mountRetryProbe();
	await pressRetry(probe);
	await probe.set({ failed: true, fetching: true });
	await probe.set({ failed: false, fetching: false });
	// The reader clicks into nothing in particular; focus is on <body>.
	await act(async () => {
		document.activeElement?.blur();
	});
	// A background refetch: fetching true -> false with the error back.
	await probe.set({ failed: true, fetching: true });
	await probe.set({ failed: true, fetching: false });
	assert.notEqual(probe.focusedId(), "retry", "no press, no hand-back");
	await probe.teardown();
});

test("Retry focus: the press is spent at a failed settle - a SECOND settle without a new press does not hand focus back", async () => {
	const probe = await mountRetryProbe();
	await pressRetry(probe);
	await probe.set({ failed: true, fetching: true });
	await probe.set({ failed: true, fetching: false });
	assert.equal(probe.focusedId(), "retry");
	await act(async () => {
		document.activeElement?.blur();
	});
	await probe.set({ failed: true, fetching: true });
	await probe.set({ failed: true, fetching: false });
	assert.notEqual(
		probe.focusedId(),
		"retry",
		"the first press does not outlive its settle",
	);
	await probe.teardown();
});

test("Retry focus: a render where the error clears BEFORE the fetch starts is not mistaken for a settle", async () => {
	const probe = await mountRetryProbe();
	// A first full cycle leaves the hook's internal state as it is after a settle.
	await pressRetry(probe);
	await probe.set({ failed: true, fetching: true });
	await probe.set({ failed: true, fetching: false });
	// Second press: the error clears a beat BEFORE `fetching` flips.
	await pressRetry(probe);
	await probe.set({ failed: false, fetching: false });
	await probe.set({ failed: false, fetching: true });
	await probe.set({ failed: true, fetching: false });
	assert.equal(
		probe.focusedId(),
		"retry",
		"the second press is still honoured",
	);
	await probe.teardown();
});

test("opening a skill at a wide width keeps focus on its row; closing returns it there", async () => {
	const view = await mount("/agents?kind=skill", {
		skills: (request) =>
			request.name
				? {
						skills: FIVE,
						detail: "x",
						skill_detail: {
							...FIVE[2],
							body: "B",
							body_in_detail: false,
							body_length: 1,
							files: [],
							files_total: 0,
							files_truncated: false,
						},
					}
				: { skills: FIVE },
	});
	assert.ok(await settle(() => rowOf(view.container, "d-local")));
	rowOf(view.container, "d-local").focus();
	await press(rowOf(view.container, "d-local"));
	assert.ok(
		await settle(() => q(view.container, '[data-testid="skill-detail"] h2')),
	);
	// WIDE (the harness's matchMedia answers "not narrow"): the row stays on screen,
	// so focus STAYS on it and arrow-browsing continues (UX U3).
	await settle(() => false, 150);
	assert.equal(
		document.activeElement === rowOf(view.container, "d-local"),
		true,
		"wide: focus stays on the row",
	);
	// Close through the page's own Back control (the narrow-width route; Escape is the same intent).
	const back = [...view.container.querySelectorAll("button")].find(
		(button) => text(button) === "Back to the list",
	);
	assert.ok(back, "the Back control is offered while a skill is open");
	await press(back);
	assert.ok(
		await settle(
			() => document.activeElement === rowOf(view.container, "d-local"),
		),
		"closing returns focus to the row that was open",
	);
	await teardown(view);
});

test("capability absent: a stale ?kind=skill link falls back to the Agents tab", async () => {
	const view = await mount("/agents?kind=skill", {
		features: {},
		skills: { skills: [] },
	});
	await settle(() => view.ops.includes("profiles.list"));
	assert.equal(
		q(view.container, '[data-testid="agents-tab"]').getAttribute("data-state"),
		"active",
	);
	assert.equal(view.ops.filter((op) => op.startsWith("skills.")).length, 0);
	await teardown(view);
});

test("capability present: the third tab shows with its count and opens the roster", async () => {
	const view = await mount("/agents", {
		skills: {
			skills: FIVE,
			scope: "discoverable",
			detail: null,
			skill_detail: null,
		},
		links: [linkRow({ name: "c-hub", local_id: "c-hub" })],
	});
	assert.ok(
		await settle(() => q(view.container, '[data-testid="skills-tab"]')),
	);
	assert.ok(
		await settle(() =>
			/5/.test(text(q(view.container, '[data-testid="skills-tab"]'))),
		),
	);
	await mouseDown(q(view.container, '[data-testid="skills-tab"]'));
	assert.ok(await settle(() => rowOf(view.container, "b-builtin")));
	// Alphabetical; all five rows.
	const names = [
		...view.container.querySelectorAll("button[data-skill-source]"),
	].map((node) => node.getAttribute("data-testid").replace("skill-row-", ""));
	assert.deepEqual(names, [
		"b-builtin",
		"c-hub",
		"d-local",
		"e-external",
		"f-project",
	]);
	await teardown(view);
});

test("the FIVE source labels render, one per row", async () => {
	const view = await mount("/agents?kind=skill", {
		skills: { skills: FIVE },
		links: [linkRow({ name: "c-hub", local_id: "c-hub" })],
	});
	assert.ok(await settle(() => rowOf(view.container, "f-project")));
	const words = Object.fromEntries(
		FIVE.map((row) => [
			row.source,
			text(
				q(rowOf(view.container, row.name), '[data-testid="skill-row-source"]'),
			),
		]),
	);
	assert.deepEqual(words, {
		builtin: "Built-in",
		hub: "Agent Hub",
		local: "Local",
		external: "Other tool",
		project: "Project",
	});
	await teardown(view);
});

test("the four hub states, with a waiting update told apart from an applied one", async () => {
	const rows = [
		skill({ name: "s-none", source: "hub", link_id: "L0" }), // no link row: not present
		skill({ name: "s-pulled", source: "hub", link_id: "L1" }),
		skill({
			name: "s-sub",
			source: "hub",
			link_id: "L2",
			installed: false,
			fingerprint: null,
		}),
		skill({ name: "s-update", source: "hub", link_id: "L3" }),
		skill({ name: "s-applied", source: "hub", link_id: "L4" }),
	];
	const links = [
		linkRow({ link_id: "L1", name: "s-pulled", local_id: "s-pulled" }),
		linkRow({
			link_id: "L2",
			name: "s-sub",
			local_id: "s-sub",
			content_state: "absent",
			local_path: null,
		}),
		linkRow({
			link_id: "L3",
			name: "s-update",
			local_id: "s-update",
			pull: { state: "available" },
		}),
		linkRow({ link_id: "L4", name: "s-applied", local_id: "s-applied" }),
	];
	const updates = [
		{
			kind: "skill",
			name: "s-update",
			state: "available",
			auto_will_apply: false,
		},
		{ kind: "skill", name: "s-applied", state: "applied" },
	];
	const view = await mount("/agents?kind=skill", {
		skills: { skills: rows },
		links,
		updates,
	});
	assert.ok(await settle(() => rowOf(view.container, "s-applied")));
	// Joined data arrives after the rows: wait for the state to resolve.
	assert.ok(
		await settle(
			() =>
				rowOf(view.container, "s-update")?.getAttribute("data-skill-state") ===
				"available",
		),
	);
	const state = (name) =>
		rowOf(view.container, name).getAttribute("data-skill-state");
	// ONE state word per row, by the design spec's §2 priority; the default
	// (pulled and subscribed, nothing waiting) says nothing.
	assert.equal(state("s-none"), "unlinked");
	assert.equal(state("s-pulled"), null);
	assert.equal(state("s-sub"), "not-installed");
	assert.equal(state("s-update"), "available");
	assert.equal(state("s-applied"), "applied");
	// Line two of a quiet row starts with its description (acceptance check 1).
	assert.match(
		text(
			q(rowOf(view.container, "s-pulled"), '[data-testid="skill-row-line2"]'),
		),
		/^A skill the reader wrote\./,
	);
	for (const row of rows)
		assert.doesNotMatch(
			text(rowOf(view.container, row.name)),
			/Downloaded|Subscribed —|Not downloaded/,
			`${row.name} carries none of the long hub sentences`,
		);
	// installed:false is said in words, not just implied.
	assert.equal(
		rowOf(view.container, "s-sub").getAttribute("data-skill-installed"),
		"false",
	);
	assert.match(
		text(q(rowOf(view.container, "s-sub"), '[data-testid="skill-row-state"]')),
		/Not installed/,
	);
	// The WORD differs between a waiting and an applied update.
	const chip = (name) =>
		q(rowOf(view.container, name), "[data-hub-mark-state]")?.getAttribute(
			"data-hub-mark-state",
		);
	assert.equal(chip("s-update"), "available");
	assert.equal(chip("s-applied"), "applied");
	assert.match(text(rowOf(view.container, "s-update")), /Update available/);
	assert.match(text(rowOf(view.container, "s-applied")), /Update applied/);
	assert.doesNotMatch(
		text(rowOf(view.container, "s-applied")),
		/Update available/,
	);
	await teardown(view);
});

test("states: loading skeleton, error + Retry that re-asks, empty vs no-match", async () => {
	// ---- error, then retry succeeds
	let attempts = 0;
	const failing = await mount("/agents?kind=skill", {
		skills: () => {
			attempts += 1;
			return attempts <= 2
				? { status: 500, body: { detail: "the skill store is unreadable" } }
				: { skills: [skill()] };
		},
	});
	// The hook's own policy retries a failed read once (`retryDesktopQuery`), after
	// react-query's 1 s backoff, so the refusal is real only after TWO attempts.
	assert.ok(await settle(() => q(failing.container, '[role="alert"]'), 6_000));
	assert.equal(attempts, 2);
	assert.match(
		text(q(failing.container, '[role="alert"]')),
		/Skills could not be read/,
	);
	assert.match(
		text(q(failing.container, '[role="alert"]')),
		/the skill store is unreadable/,
	);
	const retry = [
		...failing.container.querySelectorAll('[role="alert"] button'),
	].find((button) => text(button) === "Retry");
	assert.ok(retry, "a Retry button exists");
	await press(retry);
	assert.ok(await settle(() => rowOf(failing.container, "local-skill")));
	assert.equal(attempts, 3, "Retry sent a further request");
	assertAbsent(q(failing.container, '[role="alert"]'), "the error alert");
	await teardown(failing);

	// ---- empty (nothing exists)
	const empty = await mount("/agents?kind=skill", { skills: { skills: [] } });
	assert.ok(
		await settle(() => q(empty.container, '[data-testid="skills-empty"]')),
	);
	assert.equal(
		q(empty.container, '[data-testid="skills-empty"]').getAttribute(
			"data-skills-empty",
		),
		"none",
	);
	const emptySentence = text(
		q(empty.container, '[data-testid="skills-empty"]'),
	);
	await teardown(empty);

	// ---- no match (rows exist, search excludes them): a DIFFERENT sentence
	const some = await mount("/agents?kind=skill", {
		skills: { skills: [skill()] },
	});
	assert.ok(await settle(() => rowOf(some.container, "local-skill")));
	await typeInto(q(some.container, 'input[type="search"]'), "zzz");
	assert.ok(
		await settle(() => q(some.container, '[data-testid="skills-empty"]')),
	);
	assert.equal(
		q(some.container, '[data-testid="skills-empty"]').getAttribute(
			"data-skills-empty",
		),
		"no-match",
	);
	const noMatch = text(q(some.container, '[data-testid="skills-empty"]'));
	assert.notEqual(noMatch, emptySentence, "two states, two sentences");
	assert.match(noMatch, /zzz/);
	// Searching by the visible SOURCE word works too.
	await typeInto(q(some.container, 'input[type="search"]'), "local");
	assert.ok(await settle(() => rowOf(some.container, "local-skill")));
	await teardown(some);
});

test("loading: the roster is a skeleton until the first answer", async () => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const view = await mount("/agents?kind=skill", {
		skills: () => ({
			status: 200,
			body: { result: { data: { skills: [skill()] } } },
			gate,
		}),
	});
	// The faked handler resolves at once, so assert the INITIAL render instead:
	// before any answer the roster list does not exist yet and no sentence claims
	// the list is empty.
	assertAbsent(
		q(view.container, '[data-testid="skills-empty"]'),
		"the empty sentence",
	);
	release();
	assert.ok(await settle(() => rowOf(view.container, "local-skill")));
	await teardown(view);
});

test("an older core's rows without the new fields: the tab degrades, it does not crash", async () => {
	const view = await mount("/agents?kind=skill", {
		skills: {
			skills: [
				{ name: "legacy-a", description: "old shape" },
				{ name: "legacy-b" },
			],
		},
	});
	assert.ok(await settle(() => rowOf(view.container, "legacy-a")));
	assert.equal(
		rowOf(view.container, "legacy-a").getAttribute("data-skill-source"),
		"unknown",
	);
	assert.match(text(rowOf(view.container, "legacy-a")), /Unknown source/);
	assert.match(text(rowOf(view.container, "legacy-b")), /No description/);
	await teardown(view);
});

test("details: body sliced from `detail` for an emoji body; files, truncation and where it lives", async () => {
	const emojiBody = "Ship it \u{1F680} now";
	const detailText = `${emojiBody}\n\nreferences:\n- references/big.md`;
	const row = skill({ name: "pulled-org", source: "hub", link_id: "link-1" });
	const view = await mount("/agents?kind=skill&name=pulled-org", {
		skills: (request) =>
			request.name
				? {
						skills: [row],
						detail: detailText,
						skill_detail: {
							...row,
							body: null,
							body_in_detail: true,
							body_length: emojiBody.length,
							body_bytes: 300_000,
							body_truncated: true,
							files: [
								{
									path: "references/big.md",
									size: 3001,
									preview: "first 2048 bytes",
									preview_truncated: true,
								},
							],
							files_total: 70,
							files_truncated: true,
							publish_budget: { limit: 262144, total: 262144 },
						},
					}
				: { skills: [row] },
		links: [linkRow()],
	});
	assert.ok(
		await settle(() => q(view.container, '[data-testid="skill-detail"]')),
	);
	assert.ok(
		await settle(() => q(view.container, '[data-testid="skill-files"]')),
	);
	const pane = q(view.container, '[data-testid="skill-detail"]');
	// The whole emoji body, not a tail cut off by a code-point count.
	assert.ok(
		text(pane).includes("Ship it \u{1F680} now"),
		"the body includes the emoji and its tail",
	);
	assert.ok(
		!text(pane).includes("references/big.md\n"),
		"the listing after the body is not part of it",
	);
	// Truncation is stated, never implied complete.
	assert.match(
		text(q(pane, '[data-testid="skill-body-truncated"]')),
		/Only the first part is shown/,
	);
	assert.match(
		text(q(pane, '[data-testid="skill-files-truncated"]')),
		/Showing 1 of at least 70 files/,
	);
	assert.match(
		text(q(pane, '[data-testid="skill-files"]')),
		/references\/big\.md/,
	);
	// Details is COLLAPSED on open: no 64-hex string is visible until it opens.
	assert.equal(
		/[0-9a-f]{64}/.test(text(pane)),
		false,
		"no fingerprint before Details is opened",
	);
	await press(q(pane, '[data-testid="skill-details"] button'));
	assert.match(
		text(q(pane, '[data-testid="skill-local-path"]')),
		/\/home\/u\/\.local-operator\/skills\/pulled-org/,
	);
	assert.match(text(q(pane, '[data-testid="skill-fingerprint"]')), /^f{64}$/);
	assert.match(text(q(pane, '[data-testid="skill-form"]')), /Single document/);
	assert.match(
		text(q(pane, '[data-testid="skill-meta"]')),
		/^Agent Hub · Following updates$/,
	);
	await teardown(view);
});

test("details: an inlined body, and a subscribed-not-installed skill with no SKILL.md", async () => {
	const inline = skill({ name: "inline-one" });
	const ghost = skill({
		name: "ghost-sub",
		source: "hub",
		link_id: "L9",
		installed: false,
		fingerprint: null,
	});
	const view = await mount("/agents?kind=skill&name=inline-one", {
		skills: (request) => {
			if (request.name === "inline-one")
				return {
					skills: [inline, ghost],
					detail: "different resolver text",
					skill_detail: {
						...inline,
						body: "INLINE BODY",
						body_in_detail: false,
						body_length: 11,
						body_truncated: false,
						files: [],
						files_total: 0,
						files_truncated: false,
					},
				};
			if (request.name === "ghost-sub")
				return {
					skills: [inline, ghost],
					detail: null,
					skill_detail: {
						...ghost,
						body: null,
						body_in_detail: false,
						body_length: null,
						body_bytes: null,
						body_truncated: false,
						files: [],
						files_total: 0,
						files_truncated: false,
					},
				};
			return { skills: [inline, ghost] };
		},
		links: [
			linkRow({
				link_id: "L9",
				name: "ghost-sub",
				local_id: "ghost-sub",
				content_state: "absent",
				local_path: null,
			}),
		],
	});
	assert.ok(
		await settle(() =>
			/INLINE BODY/.test(
				text(q(view.container, '[data-testid="skill-detail"]')),
			),
		),
	);
	assert.equal(
		q(view.container, '[data-testid="skill-body-truncated"]'),
		null,
		"no truncation notice when not truncated",
	);
	assert.equal(
		q(view.container, '[data-testid="skill-files-truncated"]'),
		null,
	);
	await teardown(view);

	const world = {
		skills: (request) => {
			if (request.name === "ghost-sub")
				return {
					skills: [ghost],
					detail: null,
					skill_detail: {
						...ghost,
						body: null,
						body_in_detail: false,
						body_length: null,
						body_bytes: null,
						body_truncated: false,
						files: [],
						files_total: 0,
						files_truncated: false,
					},
				};
			return { skills: [ghost] };
		},
		links: [
			linkRow({
				link_id: "L9",
				name: "ghost-sub",
				local_id: "ghost-sub",
				content_state: "absent",
				local_path: null,
			}),
		],
	};
	const second = await mount("/agents?kind=skill&name=ghost-sub", world);
	assert.ok(
		await settle(() => q(second.container, '[data-testid="skill-no-body"]')),
	);
	const pane = q(second.container, '[data-testid="skill-detail"]');
	assert.match(
		text(q(pane, '[data-testid="skill-no-body"]')),
		/subscribed but not installed/,
	);
	// The header says it once, in the plain words; no second badge repeats it.
	assert.match(
		text(q(pane, '[data-testid="skill-meta"]')),
		/^Agent Hub · Not installed$/,
	);
	await press(q(pane, '[data-testid="skill-details"] button'));
	assert.match(
		text(q(pane, '[data-testid="skill-fingerprint"]')),
		/Not available/,
	);
	assert.equal(
		q(pane, '[data-testid="skill-local-path"]'),
		null,
		"no path for a copy that is not there",
	);
	await teardown(second);
});

/* ===================================== the redesign (lane U2), pure rules --- */

test("front matter: stripped only when fenced at offset 0 and closed; other keys survive", () => {
	const { splitFrontMatter, otherFrontMatter } = PAGE.model;
	const full =
		"---\nname: demo\ndescription: >\n  Folded\n  words\nlicense: MIT\n---\n\n# Use it\nDo the thing.";
	const parts = splitFrontMatter(full);
	assert.equal(parts.text, "# Use it\nDo the thing.");
	assert.equal(otherFrontMatter(parts.meta), "license: MIT");
	// No front matter: untouched.
	assert.equal(splitFrontMatter("# Plain\nbody").text, "# Plain\nbody");
	assert.equal(splitFrontMatter("# Plain\nbody").meta, null);
	// A truncated body whose closing fence was cut is shown whole, never half-stripped.
	const cut = "---\nname: demo\ndescription: a very long";
	assert.equal(splitFrontMatter(cut).text, cut);
	// A fence that is not at offset 0 is not front matter.
	assert.equal(splitFrontMatter(" ---\nname: x\n---\nb").meta, null);
	// Only name/description: nothing "other" to show.
	assert.equal(otherFrontMatter("name: x\ndescription: y"), null);
});

test("SKILL.md rebuild: only the description line moves; everything else is byte for byte", () => {
	const { rebuildSkillMd, splitFrontMatter } = PAGE.model;
	const original =
		"---\nname: demo\ndescription: >\n  Old\n  folded\nlicense: MIT\nx-extra: 'keep'\n---\n\nBody";
	// Unchanged description: the file is the same bytes, whatever its quoting.
	assert.equal(
		rebuildSkillMd(original, "demo", null, splitFrontMatter(original).text),
		original,
	);
	const next = rebuildSkillMd(original, "demo", "New: words", "New body");
	assert.equal(
		next,
		"---\nname: demo\ndescription: \"New: words\"\nlicense: MIT\nx-extra: 'keep'\n---\n\nNew body",
	);
	// A rewritten description is ALWAYS double-quoted (review r1 m1).
	assert.match(
		rebuildSkillMd(original, "demo", "Plain words", "b"),
		/\ndescription: "Plain words"\n/,
	);
	// A bare file gains the minimal front matter core's validation needs.
	assert.equal(
		rebuildSkillMd("just body", "demo", "D", "just body"),
		'---\nname: "demo"\ndescription: "D"\n---\n\njust body',
	);
});

/*
 * m1: every shape PyYAML's YAML 1.1 resolver (core's `parse_frontmatter`) reads
 * as a NON-string when plain - int, sexagesimal int, float, inf, timestamp,
 * bool, null - plus a mapping indicator and an embedded quote. Measured against
 * the repo's PyYAML for the PR thread; here the contract is that each is written
 * as a JSON/YAML double-quoted scalar that decodes back to the exact text.
 */
test("SKILL.md rebuild: a description YAML would resolve to a non-string is quoted", () => {
	const { rebuildSkillMd } = PAGE.model;
	const original = "---\nname: demo\ndescription: Old\n---\n\nBody";
	for (const value of [
		"0x1F",
		"1:30",
		".5",
		".inf",
		"2026-10-27T10:00:00",
		"2026-10-27",
		"yes",
		"No",
		"on",
		"OFF",
		"null",
		"~",
		"true",
		"12",
		"a: b",
		'say "hi" # not a comment',
		"- list?",
	]) {
		const written = rebuildSkillMd(original, "demo", value, "Body");
		const line = /\ndescription: (.*)\n/.exec(written)?.[1];
		assert.equal(line?.startsWith('"'), true, `${value} is quoted`);
		assert.equal(JSON.parse(line), value, `${value} round-trips`);
	}
});

/* m2: CRLF in, CRLF out, and the untouched lines keep their bytes. */
test("SKILL.md rebuild: a CRLF file keeps its line endings and its untouched lines", () => {
	const { rebuildSkillMd, splitFrontMatter } = PAGE.model;
	const crlf =
		"---\r\nname: x\r\ndescription: >\r\n  Old\r\n  folded\r\nlicense: MIT\r\n---\r\n\r\nBody\r\nmore\r\n";
	const text = splitFrontMatter(crlf).text;
	assert.equal(
		rebuildSkillMd(crlf, "x", null, text),
		crlf,
		"unchanged: same bytes",
	);
	const next = rebuildSkillMd(crlf, "x", "New", text);
	assert.equal(
		next,
		'---\r\nname: x\r\ndescription: "New"\r\nlicense: MIT\r\n---\r\n\r\nBody\r\nmore\r\n',
	);
	assert.equal(/[^\r]\n/.test(next), false, "no bare LF anywhere");
	// A description ADDED to a CRLF block (none before) uses CRLF too.
	assert.equal(
		rebuildSkillMd("---\r\nname: x\r\n---\r\nB", "x", "D", "B"),
		'---\r\nname: x\r\ndescription: "D"\r\n---\r\nB',
	);
	// An LF file stays LF.
	assert.equal(
		/\r/.test(
			rebuildSkillMd("---\nname: x\ndescription: y\n---\nB", "x", "z", "B"),
		),
		false,
	);
});

test("edit eligibility: core's editable, narrowed by reference files and truncation", () => {
	const { skillEditability, toSkillCard } = PAGE.model;
	const kind = (row, detail) => {
		const result = skillEditability(toSkillCard(row), detail);
		return [result.kind, result.reason ?? null, result.copy ?? null].join("/");
	};
	const none = { files: [], files_total: 0, body_truncated: false };
	assert.equal(kind(skill(), none), "edit//");
	assert.equal(kind(skill(), { ...none, files_total: 2 }), "ask/files/");
	assert.equal(
		kind(skill(), { ...none, body_truncated: true }),
		"ask/truncated/",
	);
	assert.equal(kind(skill({ source: "hub" }), none), "edit//");
	assert.equal(
		kind(skill({ source: "builtin", editable: false }), none),
		"read-only/builtin/true",
	);
	assert.equal(
		kind(skill({ source: "external", editable: false }), none),
		"read-only/external/true",
	);
	assert.equal(
		kind(skill({ source: "project", editable: false }), none),
		"read-only/project/true",
	);
	assert.equal(
		kind(skill({ editable: false, form: "bundle" }), none),
		"read-only/bundle/false",
	);
	assert.equal(
		kind(skill({ source: "hub", installed: false, editable: false }), none),
		"not-installed//",
	);
	// The UI never re-derives `editable`: a local row core calls not editable is not.
	assert.equal(
		kind(skill({ editable: false, source: "cloud" }), none),
		"read-only/unknown/false",
	);
});

test("composer gate: the skill run needs agents_config_skills AND skill_library on top of the agents run", () => {
	// Paired, as the real capability read is: a feature is only "enabled" when the
	// desktop plane is available.
	const caps = (features) => ({ desktop_available: true, features });
	const base = {
		agents_config: 1,
		session_interrupt: 1,
		profile_catalogue: 1,
		team_catalogue: 1,
	};
	assert.equal(PAGE.configRunEnabled(caps(base)), true);
	// `skill_library` IS present here, so the only missing conjunct is
	// `agents_config_skills`: this assertion fails if that conjunct is dropped
	// (review r1 m4 - it used to pass on `skill_library` alone).
	assert.equal(
		PAGE.configSkillRunEnabled(caps({ ...base, skill_library: 1 })),
		false,
		"older core: no skill tool",
	);
	assert.equal(
		PAGE.configSkillRunEnabled(caps({ ...base, agents_config_skills: 1 })),
		false,
		"no skill_library: the settle diff could not read skills",
	);
	assert.equal(
		PAGE.configSkillRunEnabled(
			caps({ ...base, agents_config_skills: 1, skill_library: 1 }),
		),
		true,
	);
	const { skillComposerGate, toSkillCard } = PAGE.model;
	assert.equal(skillComposerGate(false, toSkillCard(skill())), "backend");
	assert.equal(skillComposerGate(true, null), "none");
	assert.equal(
		skillComposerGate(true, toSkillCard(skill({ installed: false }))),
		"not-installed",
	);
	assert.equal(
		skillComposerGate(
			true,
			toSkillCard(skill({ source: "builtin", editable: false })),
		),
		"read-only",
	);
	assert.equal(skillComposerGate(true, toSkillCard(skill())), null);
	assert.equal(
		PAGE.configSeedPrompt({ kind: "skill", name: "demo" }),
		"Change the skill demo: ",
	);
});

test("settle diff: a skill fingerprint change is 'instructions changed'; null skills never invent creates", () => {
	const { diffCatalogue, snapshotSkills, projectRunToolRow } = PAGE.summary;
	const before = {
		agents: {},
		teams: {},
		skills: snapshotSkills([
			{ name: "demo", description: "D", fingerprint: "a".repeat(64) },
			{ name: "other", description: "O", fingerprint: "b".repeat(64) },
		]),
	};
	const after = {
		agents: {},
		teams: {},
		skills: snapshotSkills([
			{ name: "demo", description: "D", fingerprint: "c".repeat(64) },
			{ name: "other", description: "O2", fingerprint: "b".repeat(64) },
			{ name: "fresh", description: "F", fingerprint: "d".repeat(64) },
		]),
	};
	const results = diffCatalogue(before, after, [
		{ kind: "skill", name: "demo" },
		{ kind: "skill", name: "other" },
	]);
	const line = (r) =>
		`${r.target.kind}:${r.target.name}:${r.created}:${r.changes.map((c) => c.label).join("|")}`;
	assert.deepEqual(results.map(line), [
		"skill:demo:false:instructions changed",
		"skill:other:false:description changed",
		"skill:fresh:true:",
	]);
	// A skills dimension that was not read on either side is NOT an empty catalogue.
	const unread = diffCatalogue(
		{ agents: {}, teams: {}, skills: null },
		after,
		[],
	);
	assert.equal(
		unread.length,
		0,
		"no phantom creates from a null before-snapshot",
	);
	// A touched skill whose list could not be read is still reported, without details.
	const blind = diffCatalogue({ agents: {}, teams: {}, skills: null }, after, [
		{ kind: "skill", name: "demo" },
	]);
	assert.deepEqual(blind.map(line), ["skill:demo:false:"]);
	// The run's `skill` tool rows are projected as skill targets; reads do not count.
	const row = (op) =>
		projectRunToolRow({
			toolName: "skill",
			args: { op, name: "demo" },
			phase: "done",
			ts: 1,
		});
	assert.equal(row("update").target.kind, "skill");
	assert.equal(row("update").writes, true);
	assert.equal(row("update").verb, "Updating skill demo");
	assert.equal(row("show").writes, false);
	assert.equal(PAGE.summary.RUN_TOOL_NAMES.has("skill"), true);
});

/* ================================= the redesign (lane U2), mounted page --- */

const SKILL_RUN = {
	...WITH_SKILLS,
	agents_config: 1,
	agents_config_skills: 1,
	session_interrupt: 1,
	skill_write: 1,
};

/** A world whose `name` read answers a detail for whichever row is asked. */
const detailWorld = (rows, details = {}) => ({
	skills: (request) => {
		if (!request.name) return { skills: rows };
		const row = rows.find((each) => each.name === request.name);
		const extra = details[request.name] ?? {};
		const body =
			extra.body ??
			`---\nname: ${row.name}\ndescription: ${row.description}\n---\n\nFollow the steps.`;
		return {
			skills: [row],
			detail: null,
			skill_detail: {
				...row,
				body,
				body_in_detail: false,
				body_length: body.length,
				body_truncated: false,
				files: [],
				files_total: 0,
				files_truncated: false,
				...extra,
			},
		};
	},
});

const composerOf = (container) =>
	q(container, '[data-testid="config-composer"]');
const boxOf = (container) =>
	q(container, '[data-testid="config-composer"] textarea');
const boxText = () =>
	PAGE.useConversationInputStore
		.getState()
		.getCurrentInput(PAGE.CONFIG_BOX_KEY);

test("composer: docked on the Skills tab and pointed at the open editable skill", async () => {
	PAGE.useConversationInputStore
		.getState()
		.setComposerText(PAGE.CONFIG_BOX_KEY, "");
	const rows = [skill({ name: "d-local", description: "Local one." })];
	const view = await mount("/agents?kind=skill&name=d-local", {
		features: SKILL_RUN,
		...detailWorld(rows),
	});
	assert.ok(
		await settle(() => q(view.container, '[data-testid="skill-actions"]')),
		"the action cluster painted once the detail answered",
	);
	assert.equal(
		composerOf(view.container) !== null,
		true,
		"the dock is mounted",
	);
	assert.ok(
		await settle(
			() =>
				text(q(view.container, '[data-testid="config-composer-about"]')) ===
				"About skill d-local",
		),
		"About names the open skill",
	);
	assert.equal(
		boxOf(view.container)?.getAttribute("placeholder"),
		"Change d-local…",
	);
	assert.equal(
		q(composerOf(view.container), "button")?.textContent?.includes("Clear") ??
			false,
		false,
		"no Clear on the Skills tab",
	);
	// Ask for a change seeds the model-facing sentence into the EMPTY box.
	assert.equal(boxText(), "");
	await press(q(view.container, '[data-testid="skill-ask"]'));
	assert.equal(boxText(), "Change the skill d-local: ");
	// Edit is offered for a SKILL.md-only skill, and Ask is then the ghost.
	assert.equal(q(view.container, '[data-testid="skill-edit"]') !== null, true);
	assert.match(
		q(view.container, '[data-testid="skill-ask"]').className,
		/hover:bg-/,
	);
	await teardown(view);
	PAGE.useConversationInputStore
		.getState()
		.setComposerText(PAGE.CONFIG_BOX_KEY, "");
});

test("composer on an older core: present, disabled, and saying why (no agents_config_skills)", async () => {
	const rows = [skill({ name: "d-local" })];
	const { agents_config_skills: _drop, ...older } = SKILL_RUN;
	const view = await mount("/agents?kind=skill&name=d-local", {
		features: older,
		...detailWorld(rows),
	});
	assert.ok(
		await settle(() => q(view.container, '[data-testid="skill-actions"]')),
	);
	assert.equal(
		composerOf(view.container) !== null,
		true,
		"the dock is still there",
	);
	assert.equal(
		q(view.container, '[data-testid="config-composer-about"]') === null,
		true,
		"no target on a core that cannot run it",
	);
	assert.equal(
		boxOf(view.container)?.getAttribute("placeholder"),
		"Update Local Operator to change skills by asking.",
	);
	assert.equal(
		q(view.container, '[data-testid="skill-ask"]') === null,
		true,
		"no Ask for a change button",
	);
	// No skill run op was ever sent from this page.
	assert.equal(view.ops.includes("sessions.create"), false);
	await teardown(view);
});

test("composer with nothing open: docked, gated, and the select prompt names the change path", async () => {
	const view = await mount("/agents?kind=skill", {
		features: SKILL_RUN,
		...detailWorld(FIVE),
	});
	assert.ok(
		await settle(() =>
			q(view.container, '[data-testid="skills-select-prompt"]'),
		),
	);
	assert.equal(composerOf(view.container) !== null, true);
	assert.equal(
		boxOf(view.container)?.getAttribute("placeholder"),
		"Open one of your skills to ask for a change.",
	);
	assert.match(
		text(q(view.container, '[data-testid="skills-select-prompt"]')),
		/or to change one of yours/,
	);
	await teardown(view);
});

test("read-only skill: the info alert, Copy to my skills, no Edit/Ask, and a gated box", async () => {
	const rows = [
		skill({ name: "b-builtin", source: "builtin", editable: false }),
	];
	const view = await mount("/agents?kind=skill&name=b-builtin", {
		features: SKILL_RUN,
		...detailWorld(rows),
	});
	assert.ok(
		await settle(() => q(view.container, '[data-testid="skill-read-only"]')),
	);
	assert.match(
		text(q(view.container, '[data-testid="skill-read-only"]')),
		/^Built-in skill/,
	);
	assert.equal(q(view.container, '[data-testid="skill-copy"]') !== null, true);
	assert.equal(q(view.container, '[data-testid="skill-edit"]') === null, true);
	assert.equal(q(view.container, '[data-testid="skill-ask"]') === null, true);
	assert.equal(
		q(view.container, '[data-testid="config-composer-about"]') === null,
		true,
	);
	assert.equal(
		boxOf(view.container)?.getAttribute("placeholder"),
		"This skill is read-only here.",
	);
	assert.match(
		text(q(view.container, '[data-testid="skill-meta"]')),
		/^Built-in · Read-only$/,
	);
	await teardown(view);
});

test("reference files: no inline Edit (the PUT replaces the file set); Ask is the bordered control", async () => {
	const rows = [skill({ name: "with-refs" })];
	const view = await mount("/agents?kind=skill&name=with-refs", {
		features: SKILL_RUN,
		...detailWorld(rows, {
			"with-refs": {
				files: [
					{ path: "ref.md", size: 10, preview: "x", preview_truncated: false },
				],
				files_total: 1,
			},
		}),
	});
	assert.ok(
		await settle(() => q(view.container, '[data-testid="skill-actions"]')),
	);
	assert.equal(q(view.container, '[data-testid="skill-edit"]') === null, true);
	assert.equal(q(view.container, '[data-testid="skill-ask"]') !== null, true);
	assert.match(
		q(view.container, '[data-testid="skill-ask"]').className,
		/border/,
		"Ask takes the secondary (bordered) variant when Edit is absent",
	);
	assert.match(
		text(q(view.container, '[data-testid="skill-detail"]')),
		/has reference files, so change it by asking/,
	);
	assert.equal(
		q(view.container, '[data-testid="skill-detail"]').getAttribute(
			"data-skill-editability",
		),
		"ask",
	);
	await teardown(view);
});

test("no skill_write: the #1443 read-only surface, with no Edit, Copy or Remove", async () => {
	const rows = [
		skill({ name: "d-local" }),
		skill({ name: "b-builtin", source: "builtin", editable: false }),
	];
	const { skill_write: _drop, ...noWrites } = SKILL_RUN;
	const local = await mount("/agents?kind=skill&name=d-local", {
		features: noWrites,
		...detailWorld(rows),
	});
	assert.ok(
		await settle(() => q(local.container, '[data-testid="skill-actions"]')),
	);
	assert.equal(q(local.container, '[data-testid="skill-edit"]') === null, true);
	assert.equal(q(local.container, '[data-testid="skill-more"]') === null, true);
	await teardown(local);
	const builtin = await mount("/agents?kind=skill&name=b-builtin", {
		features: noWrites,
		...detailWorld(rows),
	});
	assert.ok(
		await settle(() => q(builtin.container, '[data-testid="skill-read-only"]')),
	);
	assert.equal(
		q(builtin.container, '[data-testid="skill-copy"]') === null,
		true,
	);
	await teardown(builtin);
	const none = await mount("/agents?kind=skill", {
		features: noWrites,
		...detailWorld(rows),
	});
	assert.ok(
		await settle(() =>
			q(none.container, '[data-testid="skills-select-prompt"]'),
		),
	);
	assert.match(
		text(q(none.container, '[data-testid="skills-select-prompt"]')),
		/Skills are read-only here\./,
	);
	await teardown(none);
});

test("front matter in the pane: the description appears once; instructions start at the body", async () => {
	const description =
		"Use this when the operator asks about Minerva admin APIs.";
	const rows = [skill({ name: "fm", description })];
	const view = await mount("/agents?kind=skill&name=fm", {
		features: SKILL_RUN,
		...detailWorld(rows, {
			fm: {
				body: `---\nname: fm\ndescription: ${description}\nlicense: MIT\n---\n\n# Steps\nCall the API.`,
			},
		}),
	});
	assert.ok(
		await settle(() => q(view.container, '[data-testid="skill-instructions"]')),
	);
	const pane = text(q(view.container, '[data-testid="skill-detail"]'));
	assert.equal(
		pane.split(description).length - 1,
		1,
		"the description occurs exactly once",
	);
	const instructions = text(
		q(view.container, '[data-testid="skill-instructions"]'),
	);
	assert.equal(/^(---|name:|description:)/.test(instructions), false);
	assert.match(instructions, /^Steps Call the API\./);
	assert.equal(
		q(view.container, '[data-testid="skill-instructions"] h1') !== null,
		true,
		"the heading is rendered markdown, not a monospace dump",
	);
	// The other key is reachable under Details.
	await press(q(view.container, '[data-testid="skill-details"] button'));
	assert.equal(
		text(q(view.container, '[data-testid="skill-front-matter"]')),
		"license: MIT",
	);
	await teardown(view);
});

test("scope segments: All / Local / Agent Hub / Built-in filter by source, with their own empty sentence", async () => {
	const view = await mount("/agents?kind=skill", {
		features: SKILL_RUN,
		skills: { skills: FIVE.filter((row) => row.source !== "hub") },
	});
	assert.ok(
		await settle(() => q(view.container, '[data-testid="skills-scope-all"]')),
	);
	const labels = ["all", "local", "hub", "builtin"].map((value) =>
		text(q(view.container, `[data-testid="skills-scope-${value}"]`)),
	);
	assert.deepEqual(labels, ["All", "Local", "Agent Hub", "Built-in"]);
	await press(q(view.container, '[data-testid="skills-scope-local"]'));
	assert.equal(
		q(view.container, '[data-testid="skills-scope-local"]').getAttribute(
			"aria-pressed",
		),
		"true",
	);
	assert.equal(rowOf(view.container, "d-local") !== null, true);
	assert.equal(rowOf(view.container, "b-builtin") === null, true);
	await press(q(view.container, '[data-testid="skills-scope-hub"]'));
	assert.equal(
		text(q(view.container, '[data-testid="skills-empty"]')),
		"No skills from Agent Hub.",
	);
	await teardown(view);
});

/* ===================== review r1: the write paths, mounted (B1, m3) --- */

/**
 * A skill on "disk" that the list and the detail read answer from SEPARATELY,
 * as core does, with a hold on the detail so a case can land the list first.
 * `write` simulates core's update/remove/create: compare-and-set on the
 * fingerprint, and an update REPLACES THE WHOLE FILE SET - the property that
 * turns a wrong base into a deleted reference file.
 */
const diskWorld = (over = {}) => {
	const disk = {
		name: "d-local",
		source: "local",
		description: "Old",
		fp: "a".repeat(64),
		body: "Body A",
		files: [],
		...over,
	};
	const hold = { gate: null, release: null };
	const writes = [];
	const row = () =>
		skill({
			name: disk.name,
			source: disk.source,
			description: disk.description,
			fingerprint: disk.fp,
			link_id: disk.source === "hub" ? "link-1" : null,
			editable: disk.editable ?? true,
		});
	const file = () =>
		`---\nname: ${disk.name}\ndescription: ${disk.description}\n---\n\n${disk.body}`;
	const world = {
		features: SKILL_RUN,
		links:
			disk.source === "hub"
				? [linkRow({ name: disk.name, local_id: disk.name })]
				: [],
		skills: async (request) => {
			if (!request.name) return { skills: [row()] };
			if (hold.gate) await hold.gate;
			const body = file();
			return {
				skills: [row()],
				detail: null,
				skill_detail: {
					...row(),
					body,
					body_in_detail: false,
					body_length: body.length,
					body_truncated: false,
					files: disk.files,
					files_total: disk.files.length,
					files_truncated: false,
				},
			};
		},
		write: async (request) => {
			writes.push(request);
			if (world.refuse) return world.refuse(request);
			if (request.op === "skills.update") {
				if (request.expectedFingerprint !== disk.fp)
					return {
						status: 409,
						body: { detail: { code: "skill_stale", message: "stale" } },
					};
				const content = request.files.find(
					(f) => f.path === "SKILL.md",
				).content;
				disk.body = content.replace(/^---[\s\S]*?\n---\n\n/, "");
				disk.files = request.files
					.filter((f) => f.path !== "SKILL.md")
					.map((f) => ({ path: f.path, size: f.content.length }));
				disk.fp = "c".repeat(64);
			}
			return { status: 200, body: { result: {} } };
		},
	};
	const holdDetail = () => {
		hold.gate = new Promise((resolve) => {
			hold.release = () => {
				hold.gate = null;
				resolve();
			};
		});
	};
	return { disk, world, writes, holdDetail, hold };
};

const editButton = (view) => q(view.container, '[data-testid="skill-edit"]');
const editForm = (view) =>
	q(view.container, '[data-testid="skill-detail"] form');
const typeArea = async (area, value) => {
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			window.HTMLTextAreaElement.prototype,
			"value",
		).set.call(area, value);
		area.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
};
const submit = async (form) => {
	await act(async () => {
		form.dispatchEvent(
			new window.Event("submit", { bubbles: true, cancelable: true }),
		);
	});
};
/** Refetch the library (list AND detail), and wait until both have been asked. */
const refetchSkills = async (view) => {
	const before = view.ops.filter((op) => op.startsWith("skills.list")).length;
	await act(async () => {
		void view.client.invalidateQueries({
			queryKey: ["desktop", "skills", "library"],
		});
	});
	return settle(
		() =>
			view.ops.filter((op) => op.startsWith("skills.list")).length >=
			before + 2,
	);
};

test("B1: a list read that lands BEFORE the detail cannot make Edit save old bytes over a run's change", async () => {
	const rig = diskWorld();
	const view = await mount("/agents?kind=skill&name=d-local", rig.world);
	assert.ok(await settle(() => editButton(view) !== null), "Edit offered at A");
	// A run rewrites the body (A -> B). The list answers; the detail is held.
	rig.disk.body = "Body B";
	rig.disk.fp = "b".repeat(64);
	rig.holdDetail();
	assert.ok(await refetchSkills(view));
	await settle(() => false, 150);
	const offeredMidFetch = editButton(view) !== null;
	if (offeredMidFetch) await press(editButton(view));
	rig.hold.release();
	await settle(() => false, 200);
	if (!editForm(view)) {
		assert.ok(await settle(() => editButton(view) !== null));
		await press(editButton(view));
	}
	const area = q(editForm(view), "textarea");
	await typeArea(area, `${area.value} edited`);
	await submit(editForm(view));
	await settle(
		() =>
			rig.writes.length > 0 ||
			q(view.container, '[data-testid="skill-conflict"]'),
	);
	assert.equal(
		offeredMidFetch,
		false,
		"Edit is not offered while the detail is fetching",
	);
	assert.equal(
		rig.disk.body.includes("Body B"),
		true,
		`the run's change survives (disk body: ${JSON.stringify(rig.disk.body)})`,
	);
	await teardown(view);
});

test("B1: a reference file a run added is never deleted by an Edit opened over the old file set", async () => {
	const rig = diskWorld();
	const view = await mount("/agents?kind=skill&name=d-local", rig.world);
	assert.ok(await settle(() => editButton(view) !== null));
	// The run adds a reference file; the list lands first, the detail later.
	rig.disk.files = [
		{
			path: "references/a.md",
			size: 3,
			preview: "ref",
			preview_truncated: false,
		},
	];
	rig.disk.fp = "b".repeat(64);
	rig.holdDetail();
	assert.ok(await refetchSkills(view));
	await settle(() => false, 150);
	if (editButton(view)) await press(editButton(view));
	rig.hold.release();
	await settle(() => false, 300);
	if (editForm(view)) {
		const area = q(editForm(view), "textarea");
		await typeArea(area, `${area.value} edited`);
		await submit(editForm(view));
		await settle(() => rig.writes.length > 0, 600);
	}
	assert.equal(rig.disk.files.length, 1, "references/a.md is still there");
	assert.equal(
		rig.writes.filter((w) => w.op === "skills.update").length,
		0,
		"no whole-file-set PUT was sent for a skill with reference files",
	);
	// And the settled pane now offers asking, not Edit.
	assert.equal(editButton(view), null);
	assert.equal(
		q(view.container, '[data-testid="skill-detail"]').getAttribute(
			"data-skill-editability",
		),
		"ask",
	);
	await teardown(view);
});

test("B1: the detail moving AFTER Edit opened refuses the save locally and keeps the draft", async () => {
	const rig = diskWorld();
	const view = await mount("/agents?kind=skill&name=d-local", rig.world);
	assert.ok(await settle(() => editButton(view) !== null));
	await press(editButton(view));
	const area = q(editForm(view), "textarea");
	await typeArea(area, "Body A edited");
	rig.disk.files = [
		{
			path: "references/a.md",
			size: 3,
			preview: "ref",
			preview_truncated: false,
		},
	];
	rig.disk.fp = "b".repeat(64);
	assert.ok(await refetchSkills(view));
	await settle(() => false, 200);
	await submit(editForm(view));
	assert.ok(
		await settle(
			() => q(view.container, '[data-testid="skill-conflict"]') !== null,
		),
		"the conflict alert shows",
	);
	assert.equal(rig.writes.length, 0, "nothing was sent");
	assert.equal(
		q(editForm(view), "textarea").value,
		"Body A edited",
		"the draft is kept",
	);
	assert.equal(rig.disk.files.length, 1);
	await teardown(view);
});

test("m3: Save sends skills.update with SKILL.md only; skill_stale keeps the draft", async () => {
	const rig = diskWorld();
	rig.world.refuse = (request) =>
		request.op === "skills.update"
			? {
					status: 409,
					body: { detail: { code: "skill_stale", message: "stale" } },
				}
			: undefined;
	const view = await mount("/agents?kind=skill&name=d-local", rig.world);
	assert.ok(await settle(() => editButton(view) !== null));
	await press(editButton(view));
	await typeArea(q(editForm(view), "textarea"), "Body A edited");
	await submit(editForm(view));
	assert.ok(
		await settle(
			() => q(view.container, '[data-testid="skill-conflict"]') !== null,
		),
	);
	const [sent] = rig.writes;
	assert.equal(rig.writes.length, 1);
	assert.equal(sent.op, "skills.update");
	assert.equal(sent.name, "d-local");
	assert.equal(
		sent.expectedFingerprint,
		"a".repeat(64),
		"CAS = the detail read's fingerprint at Edit",
	);
	assert.deepEqual(
		sent.files.map((f) => f.path),
		["SKILL.md"],
	);
	assert.equal(
		sent.files[0].content,
		"---\nname: d-local\ndescription: Old\n---\n\nBody A edited",
	);
	assert.equal(
		q(editForm(view), "textarea").value,
		"Body A edited",
		"the draft is kept",
	);
	await teardown(view);
});

test("m3: a successful Save writes, closes the form and re-reads", async () => {
	const rig = diskWorld();
	const view = await mount("/agents?kind=skill&name=d-local", rig.world);
	assert.ok(await settle(() => editButton(view) !== null));
	const readsBefore = view.ops.filter((op) =>
		op.startsWith("skills.list"),
	).length;
	await press(editButton(view));
	await typeArea(q(editForm(view), "textarea"), "Body A edited");
	await submit(editForm(view));
	assert.ok(await settle(() => editForm(view) === null), "the form closed");
	assert.equal(rig.disk.body, "Body A edited");
	assert.ok(
		await settle(
			() =>
				view.ops.filter((op) => op.startsWith("skills.list")).length >
				readsBefore,
		),
		"the library is re-read",
	);
	await teardown(view);
});

test("m3: Copy to my skills sends skills.create with copy_from = the same name", async () => {
	const rig = diskWorld({
		name: "b-builtin",
		source: "builtin",
		editable: false,
	});
	const view = await mount("/agents?kind=skill&name=b-builtin", rig.world);
	assert.ok(
		await settle(
			() => q(view.container, '[data-testid="skill-copy"]') !== null,
		),
	);
	await press(q(view.container, '[data-testid="skill-copy"]'));
	assert.ok(await settle(() => rig.writes.length === 1));
	assert.equal(rig.writes[0].op, "skills.create");
	assert.equal(rig.writes[0].name, "b-builtin");
	assert.equal(rig.writes[0].copyFrom, "b-builtin");
	await teardown(view);
});

test("m3: Remove asks, and only the SECOND dialog sends discard_local_changes", async () => {
	const rig = diskWorld({ name: "h-hub", source: "hub" });
	rig.world.refuse = (request) =>
		request.op === "skills.remove" && !request.discardLocalChanges
			? {
					status: 409,
					body: {
						detail: {
							code: "skill_local_changes_unpublished",
							message: "unpublished",
						},
					},
				}
			: undefined;
	const view = await mount("/agents?kind=skill&name=h-hub", rig.world);
	try {
		assert.ok(
			await settle(
				() => q(view.container, '[data-testid="skill-more"]') !== null,
			),
		);
		const trigger = q(view.container, '[data-testid="skill-more"]');
		// Focus + Enter opens a Radix menu in jsdom (the browser-page-menu-focus
		// precedent); jsdom has no PointerEvent for the pointer path.
		await act(async () => trigger.focus());
		await act(async () => {
			trigger.dispatchEvent(
				new window.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
			);
		});
		assert.ok(
			await settle(() => document.querySelector('[role="menuitem"]') !== null),
			"the menu opened",
		);
		await press(document.querySelector('[role="menuitem"]'));
		const confirm = () =>
			document.querySelector('[data-testid="skill-remove-confirm"]');
		assert.ok(await settle(() => confirm() !== null), "the first dialog asks");
		assert.equal(rig.writes.length, 0, "nothing is sent before the confirm");
		await press(confirm());
		assert.ok(
			await settle(() =>
				/unpublished changes/.test(
					text(document.querySelector('[role="dialog"]')),
				),
			),
			"the second dialog names what would be lost",
		);
		assert.deepEqual(
			rig.writes.map((w) => [w.op, w.discardLocalChanges]),
			[["skills.remove", false]],
		);
		await press(confirm());
		assert.ok(await settle(() => rig.writes.length === 2));
		assert.deepEqual(
			rig.writes.map((w) => [w.op, w.discardLocalChanges]),
			[
				["skills.remove", false],
				["skills.remove", true],
			],
		);
	} finally {
		// A failed assert must not leave the page mounted: it holds the file open.
		await teardown(view);
	}
});

after(async () => {
	for (const view of [...mounted]) await teardown(view);
	window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});
