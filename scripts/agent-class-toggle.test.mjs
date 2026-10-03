import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * The agent class: its reading, its copy, and the ORDER of the writes a switch
 * makes.
 *
 * WHY THIS FILE EXISTS RATHER THAN ONLY A RIG FRAME. A capture rig can show the
 * control's four visual states, but it cannot produce the two facts that matter
 * most about it: the sequence of ops a switch sends (install-then-update for a
 * packaged starter, update alone for anything else) and what a failure midway
 * leaves behind. Both are decided before any pixel is drawn, so they are pinned
 * here against the SHIPPED module (bundled in memory, as
 * `agents-config-summary.test.mjs` does), and the frames carry the rest.
 *
 * Every assertion below is about behaviour that a wrong implementation would
 * still make look right on screen: a switch that sent the whole profile back
 * would revert a description edited in another window; a switch that installed
 * twice would report an idempotent no-op as work; a switch that read `""` or
 * `"PROACTIVE"` as proactive would be the nagging bug the class exists to end.
 *
 * THIS FILE ALSO CARRIES THE TWO PANE <-> COMPOSER HANDOFFS (QA round 2, Q1;
 * UX round 2, U1): "Ask for a change" has to reach the box that RENDERS it, and
 * the edit gate's discard question has to take the focus its `Cancel` gave up.
 * They live here for one reason - this is the tree's only harness that mounts the
 * real `AgentsPage` (`installBridge` + `mount` below), so a case that presses a
 * detail pane's header action and then reads the composer's own field has nowhere
 * else to run. Both are about a control whose effect is a fact about ANOTHER
 * component's tree, which is exactly what a mount can prove and a still cannot.
 */
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/agents/utils/agent-class";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	write: false,
	tsconfig: "tsconfig.web.json",
});
const {
	BUILTIN_SWITCH_DISCLOSURE,
	CLASS_LABEL,
	CLASS_MEANING,
	CLASS_SWITCH_EFFECT,
	ClassSwitchError,
	classOf,
	classSwitchFailure,
	classSwitchSteps,
	oppositeClass,
	switchAgentClass,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** A profile as the wire answers it, with only the fields a switch reads. */
const profile = (over = {}) => ({
	name: "aida",
	kind: "role",
	source: "installed",
	agent_id: "a1",
	description: "",
	tools: null,
	effort: null,
	delegate: false,
	...over,
});

test("absence reads reactive, and only the wire's own spelling reads proactive", () => {
	/*
	 * The absent value, the null an uninstalled starter's write half answers
	 * with, an empty string and a spelling this build does not know all read
	 * REACTIVE. The last one is the one worth having: an unrecognised value must
	 * never be the reason an agent starts messaging somebody, which is the
	 * backend's own stated rule for the same field.
	 */
	assert.equal(classOf({}), "reactive");
	assert.equal(classOf({ action_class: undefined }), "reactive");
	assert.equal(classOf({ action_class: null }), "reactive");
	assert.equal(classOf({ action_class: "" }), "reactive");
	assert.equal(classOf({ action_class: "PROACTIVE" }), "reactive");
	assert.equal(classOf({ action_class: "on" }), "reactive");
	assert.equal(classOf({ action_class: "proactive" }), "proactive");
	assert.equal(classOf({ action_class: "reactive" }), "reactive");
});

test("the two classes have one spelling each, in the app's sentence case", () => {
	assert.deepEqual(Object.values(CLASS_LABEL), ["Proactive", "Reactive"]);
	assert.equal(oppositeClass("proactive"), "reactive");
	assert.equal(oppositeClass("reactive"), "proactive");
});

test("the consequences are read BEFORE the press, in both directions", () => {
	/*
	 * UX round 2, U2/D1/n-2. The sentence that gets read before opting IN is
	 * `CLASS_SWITCH_EFFECT.reactive` — it is what an OFF switch is asking the
	 * reader to accept — so the nudge cycle AND the self-scheduled wakes have to
	 * live there rather than only in the sentence that appears once the switch is
	 * already ON. Before this, a reader could turn a switch on knowing it "lets it
	 * message you first" and learn about the backoff and the check-ins afterwards.
	 */
	const turningOn = CLASS_SWITCH_EFFECT.reactive.toLowerCase();
	assert.match(turningOn, /lets it write first/);
	assert.match(turningOn, /wait a few minutes/);
	assert.match(turningOn, /nudge you again/);
	assert.match(turningOn, /fixed number of tries/);
	assert.match(turningOn, /wake on its own schedule/);
	/* The off direction says what stops, and does not overclaim either. */
	const turningOff = CLASS_SWITCH_EFFECT.proactive.toLowerCase();
	assert.match(turningOff, /stops the nudging and the scheduled wakes/);
	/*
	 * Both directions answer "will it still reply to me": a control named for
	 * messaging that leaves that in doubt reads as a mute button.
	 */
	assert.match(turningOff, /still replies when you write to it/);
	assert.match(turningOn, /still replies when you write to it/);
});

test("the state copy names the mechanisms and not an absolute", () => {
	const proactive = CLASS_MEANING.proactive.toLowerCase();
	assert.match(proactive, /may message you on its own/);
	assert.match(proactive, /waits a few minutes/);
	assert.match(proactive, /nudges again/);
	assert.match(proactive, /fixed number of tries/);
	assert.match(proactive, /waits for you/);
	/*
	 * N-2: the old reactive sentence promised it "never messages you on its own",
	 * which is more than the platform can keep — the class gates the proactive
	 * MECHANISMS, not every conceivable way a session could be started. The
	 * replacement names the two mechanisms instead.
	 */
	const reactive = CLASS_MEANING.reactive.toLowerCase();
	assert.match(reactive, /does not nudge you/);
	assert.match(reactive, /does not wake on its own schedule/);
	assert.doesNotMatch(reactive, /never messages you/);
});

test("a packaged starter is installed first; anything else is updated once", () => {
	assert.deepEqual(
		classSwitchSteps(profile({ source: "builtin" }), "proactive"),
		[
			{ op: "profiles.install", name: "aida" },
			{
				op: "profiles.update",
				name: "aida",
				fields: { action_class: "proactive" },
			},
		],
	);
	for (const source of ["installed", "custom"]) {
		assert.deepEqual(classSwitchSteps(profile({ source }), "reactive"), [
			{
				op: "profiles.update",
				name: "aida",
				fields: { action_class: "reactive" },
			},
		]);
	}
});

test("the update carries the class and nothing else", () => {
	/*
	 * THE MERGE RULE IS THE REASON. An omitted field means "leave it alone" on
	 * this wire, so a switch that sent a whole profile back would revert whatever
	 * else moved while the pane was open — the same defect the detail pane's own
	 * save was rebuilt to avoid. Asserted on the field LIST rather than on the
	 * value, because a stray key that happened to hold the current value would
	 * pass a value-shaped assertion and still be a write nobody asked for.
	 */
	const update = classSwitchSteps(profile(), "proactive").at(-1);
	assert.deepEqual(Object.keys(update.fields), ["action_class"]);
});

test("a switch sends its steps in order, with a fresh request id for each", async () => {
	const seen = [];
	const ids = ["id-1", "id-2"];
	const result = await switchAgentClass(
		profile({ source: "builtin" }),
		"proactive",
		async (step, requestId) => {
			seen.push([step.op, requestId]);
			return profile({ source: "installed", action_class: "proactive" });
		},
		() => ids[seen.length],
	);
	assert.deepEqual(seen, [
		["profiles.install", "id-1"],
		["profiles.update", "id-2"],
	]);
	assert.equal(result.action_class, "proactive");
});

test("a switch to the class the agent is already in writes nothing", async () => {
	let calls = 0;
	const result = await switchAgentClass(
		profile({ action_class: "proactive" }),
		"proactive",
		async () => {
			calls += 1;
			return profile();
		},
	);
	assert.equal(result, null);
	assert.equal(calls, 0);
	/*
	 * And the no-op is decided by the EFFECTIVE class, not by the spelling: a
	 * profile whose payload omits the field is reactive, so asking for reactive
	 * is the no-op and asking for proactive is not.
	 */
	let second = 0;
	assert.equal(
		await switchAgentClass(profile(), "reactive", async () => {
			second += 1;
			return profile();
		}),
		null,
	);
	assert.equal(second, 0);
});

test("a failed step reports the steps that had already landed", async () => {
	/*
	 * THE HALF-COMPLETED CASE, which is the one a surface can get wrong without
	 * noticing: the install succeeded and the class write did not, so the record
	 * moved (a packaged starter now has a row of its own, and is editable) while
	 * the class is exactly what it was. A caller told only "that did not work"
	 * would leave the pane showing "Built-in" against a list that says
	 * "Installed".
	 */
	const failure = await switchAgentClass(
		profile({ source: "builtin" }),
		"proactive",
		async (step) => {
			if (step.op === "profiles.update") throw new Error("backend said no");
			return profile({ source: "installed" });
		},
	).catch((error) => error);
	assert.ok(failure instanceof ClassSwitchError);
	assert.equal(failure.message, "backend said no");
	assert.deepEqual(
		failure.completed.map((step) => step.op),
		["profiles.install"],
	);
	assert.match(
		classSwitchFailure(failure, failure.completed),
		/backend said no/,
	);
	/*
	 * AND IT CLAIMS ONLY THE INSTALL (UX round 2, U1). The old clause promised
	 * "its class is unchanged", which this layer cannot observe: a write that
	 * fails after the backend committed has landed, and only the pane's re-read
	 * knows it. The sentence states what is certain and leaves the class to the
	 * switch above it.
	 */
	const halfCopy = classSwitchFailure(failure, failure.completed);
	assert.match(halfCopy, /The install did land/);
	assert.doesNotMatch(halfCopy, /unchanged/);
	/*
	 * A failure with nothing landed says only the refusal: there is no second
	 * clause to write, and inventing one would tell the reader something about
	 * their record that did not happen.
	 */
	const early = await switchAgentClass(
		profile({ source: "installed" }),
		"proactive",
		async () => {
			throw new Error("offline");
		},
	).catch((error) => error);
	assert.ok(early instanceof ClassSwitchError);
	assert.deepEqual(early.completed, []);
	assert.equal(classSwitchFailure(early, early.completed), "offline");
});

test("a bare, non-Error rejection still says something a reader can act on", () => {
	/*
	 * A transport can reject with a value that is not an Error (`desktop-api`
	 * throws typed errors, but the deadline path and a mocked bridge need not), so
	 * the sentence cannot be `cause.message` unguarded: an empty alert is the
	 * failure a reader cannot act on at all.
	 *
	 * AND IT ADDS A FACT RATHER THAN ECHOING THE TITLE (UX round 2, U5/D3). The
	 * old fallback was "The class could not be changed.", a lowercase restatement
	 * of the alert heading above it; the actionable half — there is no reason to
	 * show, pressing again is the next step — is what this asserts.
	 */
	const copy = classSwitchFailure({ status: 500 }, []);
	assert.match(copy, /sent no reason/);
	assert.match(copy, /try the switch again/i);
	assert.doesNotMatch(copy, /class/i);
	assert.doesNotMatch(BUILTIN_SWITCH_DISCLOSURE, /undefined/);
});

test("the built-in disclosure names the install before the press, not after", () => {
	assert.match(BUILTIN_SWITCH_DISCLOSURE, /installs it first/);
	assert.match(BUILTIN_SWITCH_DISCLOSURE, /now editable/);
});

/* -------------------------------------------------------------- the page --- */

/*
 * THE REMOUNT PIN, and the fixture UX round 2's U1 needs.
 *
 * WHY THIS HALF IS jsdom RATHER THAN MORE PURE FUNCTIONS. Two of the findings
 * are about what the PAGE does across a write rather than about what the module
 * computes: the value on screen after a failure has to come from a RE-READ (U1,
 * and the reviewer's m-2 - the same defect from the code side), and the value
 * after a successful write has to survive a fresh mount (the round's other pin:
 * remount the page and assert the switch and the roster badge come from the
 * response, not from local state). Neither is visible to a function that never
 * renders, and both are invisible to a frame: a story photographs a state, it
 * does not tell you which read produced it.
 *
 * The transport below stands in for the bridge a packaged app injects, over a
 * world it MUTATES the way the backend does - so every value asserted here has
 * been through a read. It counts its ops, which is what makes the remount claim
 * checkable rather than assumed: the second mount has to ask for the record
 * again, and the assertions below fail if it answers from a cache instead.
 *
 * `jsdom` has no layout engine, so nothing here is geometry evidence; the frames
 * carry the pixels and this file carries the guards (the division
 * `transcript-focus-behaviour.test.mjs` states for the same reason).
 */

const pageBundle = await build({
	stdin: {
		contents: [
			'export { AgentsPage } from "./src/renderer/src/features/agents/components/agents-page";',
			'export { AIDA_SEAT_NAME, displayNameFor } from "./src/renderer/src/features/aida/use-aida-target";',
			/*
			 * The box's own store, so the storage below can be given to THAT store and no
			 * other (see the note under the import).
			 */
			'export { useConversationInputStore } from "./src/renderer/src/shared/store/conversation-input-store";',
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
	`./_agent-class-page-${process.pid}.mjs`,
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
];
const shims = {
	window,
	document: window.document,
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

/** The capabilities envelope, with the aida surface this build reads. */
const CAPABILITIES = {
	desktop_contract: 1,
	desktop_available: true,
	desktop_auth: "bearer",
	features: { profile_catalogue: 1, team_catalogue: 1, aida: 1 },
};

/** A row as `profiles.list` answers one. */
const row = (over = {}) => ({
	kind: "role",
	source: "installed",
	agent_id: "agent-aida",
	description: "",
	tools: null,
	effort: null,
	delegate: false,
	instructions: "Do the work and report what changed.",
	...over,
});

/**
 * The bridge, over a world the WRITE mutates.
 *
 * `failWrite` has two shapes on purpose: "refuse" answers a 422 and changes
 * nothing, "after-commit" applies the class and THEN rejects - the timeout a
 * user actually hits, and the one U1 is about, because the state on disk has
 * moved while the client is told the write failed.
 */
const installBridge = (
	rows,
	{ failWrite = null, aidaName = "Aida", features = {} } = {},
) => {
	const calls = [];
	const handler = async (request) => {
		calls.push(request.op);
		switch (request.op) {
			case "capabilities":
				return {
					status: 200,
					body: {
						result: {
							...CAPABILITIES,
							/*
							 * PER-MOUNT FEATURE KEYS, added for the seed case below: the
							 * configuration run needs its own key plus `session_interrupt`
							 * (`configRunEnabled`), and turning them on for the OTHER mounts
							 * would change what they render.
							 */
							features: { ...CAPABILITIES.features, ...features },
						},
					},
				};
			case "aida.status":
				return {
					status: 200,
					body: {
						result: {
							enabled: true,
							name: aidaName,
							session_id: "session-aida",
							paused: false,
							greeted: true,
						},
					},
				};
			/*
			 * EVERY READ HANDS OUT A COPY, and that is what makes the ambiguous-failure
			 * pin able to FAIL (QA round 2, Q-1 — the fixture's own defect, not the
			 * app's). The bridge mutates these `rows` in place when a write lands,
			 * because that is what a backend does; a fixture that served the SAME
			 * objects to `profiles.get` left the client's cached row already carrying
			 * the new class, so a pane that never re-read still painted "corrected" and
			 * the regression the pin exists for sailed through it.
			 *
			 * MEASURED BOTH WAYS (the mutation pair QA asked for): with the pre-fix
			 * guard restored, the pin PASSES against shared objects and FAILS against
			 * these copies; with both the guard and the copies in place it passes. The
			 * copy is what makes a cached read mean something — without it the cache
			 * and the world are one object, and there is no stale value to catch.
			 */
			case "profiles.list":
				return {
					status: 200,
					body: {
						result: { profiles: rows.map((entry) => ({ ...entry })) },
					},
				};
			case "profiles.get": {
				const hit = rows.find((entry) => entry.name === request.name);
				if (!hit) return { status: 404, body: { detail: "missing" } };
				return { status: 200, body: { result: { ...hit } } };
			}
			case "teams.list":
				return { status: 200, body: { result: { teams: [] } } };
			case "settings.list":
				return { status: 200, body: { result: { settings: [] } } };
			case "profiles.install": {
				const hit = rows.find((entry) => entry.name === request.name);
				if (!hit) return { status: 404, body: { detail: "missing" } };
				hit.source = "installed";
				return { status: 200, body: { result: hit } };
			}
			case "profiles.update": {
				const hit = rows.find((entry) => entry.name === request.name);
				if (!hit) return { status: 404, body: { detail: "missing" } };
				const fields = request.fields ?? {};
				if (failWrite === "after-commit") {
					if (fields.action_class) hit.action_class = fields.action_class;
					throw new Error("The request timed out.");
				}
				if (failWrite === "refuse")
					return {
						status: 422,
						body: {
							detail:
								"Value error, the class could not be written [type=value_error]",
						},
					};
				if (fields.action_class) hit.action_class = fields.action_class;
				return { status: 200, body: { result: hit } };
			}
			default:
				throw new Error(`unexpected desktop op in this test: ${request.op}`);
		}
	};
	window.api = { desktop: { request: handler } };
	return calls;
};

/** Mount the page at a route, with a client per mount (so a remount re-reads). */
const mount = async (path, rows, options) => {
	const calls = installBridge(rows, options);
	const container = document.createElement("div");
	document.body.append(container);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
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
						h(Route, { path: "/agents/:agentId", element: h(PAGE.AgentsPage) }),
					),
				),
			),
		);
	});
	return { container, root, calls };
};

/** Let every pending read settle, then answer whether `done` came true. */
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

const switchEl = (container) =>
	container.querySelector('[data-testid="agent-class-switch"]');

/** A control by its own visible name, inside a given scope (never the document). */
const buttonNamed = (scope, name) =>
	[...(scope?.querySelectorAll("button") ?? [])].find(
		(button) => button.textContent?.trim() === name,
	) ?? null;

const rosterSaysProactive = (container, name) =>
	Boolean(
		container
			.querySelector(`[data-testid="roster-row-${name}"]`)
			?.textContent?.includes("Proactive"),
	);

const withPage = async (body) => {
	const world = [
		row({ name: "aida", action_class: "reactive" }),
		row({ name: "reviewer", action_class: "reactive" }),
	];
	try {
		await body(world);
	} finally {
		document.body.innerHTML = "";
	}
};

test("the seat prints her configured name while its row keeps the registry key", async () => {
	await withPage(async (world) => {
		const { container } = await mount("/agents?kind=agent&name=aida", world, {
			aidaName: "Nova",
		});
		const loaded = await settle(() =>
			Boolean(container.querySelector('[data-testid="roster-row-aida"]')),
		);
		assert.ok(loaded, "the roster never rendered");
		/*
		 * THE ROW IS STILL THE `aida` ROW — ids, routes and marks key on the
		 * registry name — and the words a reader sees are the operator's.
		 */
		const aidaRow = container.querySelector('[data-testid="roster-row-aida"]');
		assert.match(aidaRow?.textContent ?? "", /Nova/);
		assert.doesNotMatch(
			aidaRow?.textContent ?? "",
			/\baida\b/i,
			"the registry key is still the words a reader sees",
		);
		/* Every other row prints its own name, unchanged. */
		assert.match(
			container.querySelector('[data-testid="roster-row-reviewer"]')
				?.textContent ?? "",
			/^reviewer/,
		);
		assert.equal(PAGE.displayNameFor("reviewer", "Nova"), "reviewer");
		assert.equal(PAGE.displayNameFor(PAGE.AIDA_SEAT_NAME, "Nova"), "Nova");
	});
});

test("a switch round-trips: the re-read paints it, and a fresh mount re-reads it", async () => {
	await withPage(async (world) => {
		const first = await mount("/agents?kind=agent&name=aida", world, {
			aidaName: "Nova",
		});
		assert.ok(
			await settle(() => Boolean(switchEl(first.container))),
			"the class control never rendered",
		);
		assert.equal(
			switchEl(first.container)?.getAttribute("aria-checked"),
			"false",
		);

		await act(async () => {
			switchEl(first.container)?.click();
		});
		/*
		 * SETTLED MEANS THE READ CAME BACK, not that the optimistic paint moved:
		 * the roster badge is rendered from `profiles.list`, which the page only
		 * re-reads after the write answers.
		 */
		assert.ok(
			await settle(() => rosterSaysProactive(first.container, "aida")),
			"the roster badge never arrived; the write did not round-trip",
		);
		assert.equal(
			switchEl(first.container)?.getAttribute("aria-checked"),
			"true",
		);

		/* The fresh mount, over the same world, must ASK again. */
		const readsBefore = first.calls.filter(
			(op) => op === "profiles.get",
		).length;
		await act(async () => {
			first.root.unmount();
		});
		const second = await mount("/agents?kind=agent&name=aida", world, {
			aidaName: "Nova",
		});
		const again = await settle(() => Boolean(switchEl(second.container)));
		assert.ok(again, "the second mount never rendered");
		assert.ok(
			second.calls.filter((op) => op === "profiles.get").length > 0,
			"the remount answered from a cache instead of re-reading",
		);
		assert.ok(readsBefore > 0);
		/*
		 * THE VALUE SURVIVES THE MOUNT, and it survived it as a READ: nothing in
		 * this component tree carries the class across a remount, so a switch that
		 * is ON here is ON because the transport said so.
		 */
		assert.equal(
			switchEl(second.container)?.getAttribute("aria-checked"),
			"true",
		);
		assert.ok(rosterSaysProactive(second.container, "aida"));
		await act(async () => {
			second.root.unmount();
		});
	});
});

test("a refusal reverts the switch and says why", async () => {
	await withPage(async (world) => {
		const { container } = await mount("/agents?kind=agent&name=aida", world, {
			failWrite: "refuse",
		});
		assert.ok(await settle(() => Boolean(switchEl(container))));
		await act(async () => {
			switchEl(container)?.click();
		});
		const explained = await settle(() =>
			Boolean(container.querySelector('[data-testid="agent-class-error"]')),
		);
		assert.ok(explained, "a refused write produced no alert");
		const alert = container.querySelector('[data-testid="agent-class-error"]');
		/*
		 * The pair says what is known and why, once each (U5/D3): the title leads
		 * with the operation that did not complete, the body carries the backend's
		 * own sentence with its envelope stripped, and neither restates the other.
		 */
		assert.match(alert?.textContent ?? "", /^The switch did not go through/);
		assert.match(alert?.textContent ?? "", /could not be written/);
		assert.doesNotMatch(alert?.textContent ?? "", /The class was not changed/);
		assert.equal(switchEl(container)?.getAttribute("aria-checked"), "false");
		assert.equal(rosterSaysProactive(container, "aida"), false);
	});
});

test("a write that failed AFTER the backend committed is corrected by the re-read", async () => {
	await withPage(async (world) => {
		/*
		 * THE U1 CASE, and the reason the re-read is unconditional. The world IS
		 * proactive by the time the error reaches the control - exactly what a
		 * timeout after a commit leaves behind - so a pane that did not re-read
		 * would sit there saying the class was not changed while the agent nudges.
		 */
		const { container } = await mount("/agents?kind=agent&name=aida", world, {
			failWrite: "after-commit",
		});
		assert.ok(await settle(() => Boolean(switchEl(container))));
		await act(async () => {
			switchEl(container)?.click();
		});
		const explained = await settle(() =>
			Boolean(container.querySelector('[data-testid="agent-class-error"]')),
		);
		assert.ok(explained, "an ambiguous failure produced no notice");
		const corrected = await settle(
			() => switchEl(container)?.getAttribute("aria-checked") === "true",
		);
		assert.ok(
			corrected,
			"the control kept painting the pre-write class after an ambiguous failure",
		);
		assert.ok(
			rosterSaysProactive(container, "aida"),
			"the roster badge did not follow the re-read",
		);
	});
});

test("Ask for a change puts its own sentence in the box that renders (QA round 2, Q1)", async () => {
	await withPage(async (world) => {
		const { container, root } = await mount(
			"/agents?kind=agent&name=aida",
			world,
			{
				aidaName: "Nova",
				features: { agents_config: 1, session_interrupt: 1 },
			},
		);
		const box = () => container.querySelector("textarea");
		assert.ok(
			await settle(() => Boolean(box())),
			"the run's box never rendered",
		);
		const ask = buttonNamed(container, "Ask for a change");
		assert.ok(ask, "the header action never rendered");
		/*
		 * THE BOX MUST START EMPTY or this case proves nothing: the sentence is what
		 * the PRESS is supposed to put there, and a value another mount left behind
		 * would let a broken seed pass. The assertion below is the rendered `value`,
		 * not the store — the defect was a seed that reached a store nothing renders.
		 */
		assert.equal(box().value, "", "the box was not empty before the press");
		await act(async () => {
			ask.click();
		});
		/*
		 * THE BADGE IS THE HALF THAT KEPT WORKING, and asserting it here is what
		 * tells the two halves apart when this case fails: a missing badge means the
		 * press never reached the page's handler, a missing sentence with the badge
		 * present means the handler seeded a store the box does not read.
		 */
		assert.match(
			container.textContent ?? "",
			/About agent aida/,
			"the press did not reach the page's handler at all (no target named)",
		);
		assert.equal(
			box().value,
			"Change the agent aida: ",
			"the press seeded a store the box does not render: the sentence is not in the box",
		);
		assert.equal(
			document.activeElement,
			box(),
			"the caret did not land in the box the sentence arrived in",
		);
		await act(async () => root.unmount());
	});
});

test("the seeded sentence leaves the box when its target does (agent review round 9, finding 2)", async () => {
	await withPage(async (world) => {
		const { container, root } = await mount(
			"/agents?kind=agent&name=aida",
			world,
			{
				aidaName: "Nova",
				features: { agents_config: 1, session_interrupt: 1 },
			},
		);
		const box = () => container.querySelector("textarea");
		assert.ok(
			await settle(() => Boolean(box())),
			"the run's box never rendered",
		);
		const ask = buttonNamed(container, "Ask for a change");
		assert.ok(ask, "the header action never rendered");
		await act(async () => {
			ask.click();
		});
		/*
		 * THE BOX REALLY HOLDS THE SEED FIRST, or the empty box below proves nothing:
		 * a box that was never seeded is empty for free.
		 */
		assert.equal(
			box().value,
			"Change the agent aida: ",
			"the press did not seed the box, so this case cannot speak about the clear",
		);
		/*
		 * THE ROW IS RE-QUERIED INSIDE THE WAIT, because the roster arrives from its
		 * own read: the box above renders before the sidebar's rows do, so a single
		 * query taken here would ratify whichever render happened to be up and then
		 * wait on a node that was never going to appear.
		 */
		const reviewer = () =>
			container.querySelector('[data-testid="roster-row-reviewer"]');
		assert.ok(
			await settle(() => Boolean(reviewer())),
			"the roster row the switch needs never rendered",
		);
		await act(async () => {
			reviewer().click();
		});
		/*
		 * THE BADGE GOING IS WHAT SAYS THE EFFECT RAN. Without it an empty box could
		 * just be a composer that never heard about the switch and cleared itself.
		 */
		assert.ok(
			await settle(
				() => !container.querySelector('[data-testid="config-composer-about"]'),
			),
			"the target was not left behind, so the clear was never asked for",
		);
		/*
		 * THE BOX IS THE SUBJECT, NOT THE STORE. The defect was exactly the two
		 * disagreeing - the row empty, the sentence on screen - so a store-only
		 * assertion passes on it. This one fails on the bug: seen failing against the
		 * `setCurrentInput` clear, with this message.
		 */
		assert.equal(
			box().value,
			"",
			"the seeded sentence stayed in the box after its target was left behind",
		);
		await act(async () => root.unmount());
	});
});

test("the discard question takes the focus its Cancel gave up (UX round 2, U1)", async () => {
	await withPage(async (world) => {
		const { container, root } = await mount(
			"/agents?kind=agent&name=aida",
			world,
			{
				aidaName: "Nova",
			},
		);
		const footer = () => container.querySelector('[data-testid="edit-footer"]');
		assert.ok(
			await settle(() => Boolean(buttonNamed(container, "Edit"))),
			"the pane never rendered its read view",
		);
		/*
		 * THE FOOTER IS THE EDITOR'S, so the editor is opened BEFORE it is waited for:
		 * the read view has no `Cancel` at all, and a wait that ran first would time
		 * out on a pane that is behaving.
		 */
		await act(async () => {
			buttonNamed(container, "Edit")?.click();
		});
		assert.ok(
			await settle(() => Boolean(footer())),
			"the editor never rendered its footer",
		);
		/*
		 * A REAL DRAFT FIELD HAS TO CHANGE: `dirty` is value-based
		 * (`JSON.stringify(draft) !== JSON.stringify(base)`), so the state UX reached
		 * by typing a character into Instructions is reached here with the delegation
		 * switch - the same kind of edit, through a control this harness can drive
		 * (a real press), rather than a synthesised keystroke into a React-controlled
		 * textarea. What the case is about is the FOCUS the confirm takes, not which
		 * field made the draft dirty.
		 */
		const delegate = container.querySelector(
			'[aria-label="May delegate to subagents"]',
		);
		assert.ok(delegate, "the edit form's delegation switch is not mounted");
		await act(async () => {
			delegate.click();
		});
		assert.match(
			footer().textContent ?? "",
			/Unsaved changes/,
			"the draft never became dirty, so the confirm under test would never open",
		);
		const cancel = buttonNamed(footer(), "Cancel");
		assert.ok(cancel, "the editor's Cancel is not in the footer");
		/*
		 * FOCUS FIRST, THEN PRESS. The defect is what happens to the FOCUSED node when
		 * its row is replaced, so a press that never held focus would test nothing: a
		 * keyboard user reaches this button with Shift+Tab from the box and presses
		 * Enter, and jsdom has no tab order to walk, so the focus is set directly.
		 */
		cancel.focus();
		await act(async () => {
			cancel.click();
		});
		const keep = buttonNamed(footer(), "Keep editing");
		assert.ok(keep, "the discard question never opened");
		assert.equal(
			document.activeElement,
			keep,
			"focus fell out of the question, so the next Tab reaches Discard changes",
		);
		await act(async () => root.unmount());
	});
});

after(() => {
	window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});
