import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Per-member model overrides in the team editor: the wire vocabulary, the
 * payload a save sends, what the pane prints, and what a backend without the
 * route is allowed to show.
 *
 *     node --test --test-concurrency=1 scripts/team-member-overrides.test.mjs
 *
 * WHAT IT PINS, and why each one needs the instrument it has.
 *
 *   1. THE VOCABULARY IS THE WIRE'S, and "inherit" is not a member of it. The
 *      selects offer words; only some of those words exist on the wire, and the
 *      one that does not (`inherit`) has to become `null` - a value the backend
 *      accepts as "no override on this layer". A spread of the raw choice would
 *      send `inherit` and be refused; that is a unit fact about this module AND a
 *      contract fact, so it is asserted on both.
 *
 *   2. THE ROSTER'S OVERRIDES SURVIVE A SAVE THAT DOES NOT MENTION THEM. This is
 *      the hazard the whole feature turns on: `members` replaces the roster
 *      wholesale, so an editor that rebuilt the list from what it showed would
 *      erase every override the operator did not touch. It is decided by what the
 *      form SENDS, which no still frame and no pure function can show - hence the
 *      mount, over a bridge that records the write. The press this test uses is
 *      the count stepper, deliberately: it is a control jsdom can drive, so the
 *      case measures the PAYLOAD and not the harness's ability to open a Radix
 *      menu.
 *
 *   3. THE READING IS PRINTED WITH THE LAYER THAT SET IT, including the
 *      unavailable case with the backend's reason. The design note calls this the
 *      single most important surface of the layers: without it, a save that fell
 *      through looks exactly like one that wrote nothing.
 *
 *   4. A BACKEND WITHOUT THE ROUTE SHOWS NOTHING NEW, and a failure that is not
 *      its absence keeps the controls and says the reading could not be taken.
 *      The two are different states of the same query and the difference is the
 *      whole capability-probe decision.
 *
 * WHAT IT DOES NOT PROVE: that the backend answers the route (the backend PR and
 * QA's pass do), that the controls are reachable or legible (the rendered frames
 * on the pull request do), or that Radix's menu opens under jsdom - it does not,
 * so no case here depends on it. `jsdom` has no layout engine, so nothing here is
 * geometry evidence.
 */

const sharedBundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/agents/utils/member-overrides";',
			'export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";',
			'export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
			'export { bundledEnglish } from "./src/i18n/keys.gen";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	logLevel: "silent",
	tsconfig: "tsconfig.app.json",
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
});
const MOD = await import(
	`data:text/javascript;base64,${Buffer.from(
		sharedBundle.outputFiles[0].text,
	).toString("base64")}`
);

/* --------------------------------------------------------- the vocabulary -- */

test("the tier and effort words are the wire's own, and inherit is not one of them", () => {
	assert.deepEqual(MOD.MEMBER_TIERS, ["lo", "med", "hi"]);
	assert.deepEqual(MOD.MEMBER_EFFORTS, [
		"auto",
		"none",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	]);
	/* `auto` is a VALUE here, not the absence of one: the absence is `inherit`. */
	assert.ok(!MOD.MEMBER_EFFORTS.includes(MOD.INHERIT));
	const update = (members) =>
		MOD.desktopRequestSchema.safeParse({
			op: "teams.update",
			name: "crew",
			requestId: "0f0e0d0c-0b0a-4908-8706-050403020100",
			fields: { members },
		});
	const member = (over = {}) => ({
		role: "reviewer",
		count: 1,
		kind: "agent",
		...over,
	});
	assert.ok(update([member({ tier: "hi", effort: "max" })]).success);
	assert.ok(
		update([member({ tier: null, effort: null })]).success,
		"a cleared override is a null the wire accepts, not an omission it requires",
	);
	const stray = update([member({ tier: "inherit" })]);
	assert.equal(
		stray.success,
		false,
		"the select's own word for clearing is not a tier the wire has",
	);
	const typo = update([member({ effort: "extra-high" })]);
	assert.equal(typo.success, false);
	const unknownKey = update([member({ reasoning: "high" })]);
	assert.equal(
		unknownKey.success,
		false,
		"the member object is strict; an unknown key is refused rather than dropped",
	);
});

test("inherit clears the field to null, keeps it present, and reads back as inherit", () => {
	const wire = {
		role: "coder",
		count: 2,
		kind: "agent",
		tier: "hi",
		effort: "xhigh",
	};
	const cleared = MOD.withOverride(wire, { tier: MOD.INHERIT });
	assert.equal(cleared.tier, null);
	assert.equal(cleared.effort, "xhigh", "the other field is untouched");
	assert.match(
		JSON.stringify(cleared),
		/"tier":null/,
		"a cleared override stays in the payload: it is an act on the roster, not an omission",
	);
	assert.equal(MOD.withOverride(wire, { effort: MOD.INHERIT }).effort, null);
	assert.deepEqual(MOD.withOverride(wire, { tier: "lo" }), {
		...wire,
		tier: "lo",
	});
	assert.equal(MOD.overrideChoice(undefined), MOD.INHERIT);
	assert.equal(MOD.overrideChoice(null), MOD.INHERIT);
	assert.equal(MOD.overrideChoice("med"), "med");
});

/* ------------------------------------------------------------- the reading -- */

const reading = (over = {}) => ({
	role: "coder",
	kind: "agent",
	tier: { value: "hi", source: "team" },
	model: { value: "anthropic/claude-opus-5-5", source: "tier" },
	effort: { value: "xhigh", requested: "xhigh", source: "team" },
	available: true,
	reason: "",
	...over,
});

test("a reading is matched by kind and casefolded role, and by nothing else", () => {
	const payload = {
		team: "crew",
		members: [reading(), reading({ role: "pod", kind: "team" })],
	};
	assert.equal(
		MOD.effectiveFor(payload, { role: "CODER", kind: "agent" })?.role,
		"coder",
	);
	assert.equal(
		MOD.effectiveFor(payload, { role: "coder", kind: "team" }),
		null,
		"the same name on a team slot is a different slot",
	);
	assert.equal(
		MOD.effectiveFor(payload, { role: "nobody", kind: "agent" }),
		null,
	);
	assert.equal(
		MOD.effectiveFor(undefined, { role: "coder", kind: "agent" }),
		null,
	);
});

test("every layer word the reading can carry has a catalogue key", () => {
	const keys = [
		MOD.tierSourceKey("team"),
		MOD.tierSourceKey("row"),
		MOD.tierSourceKey("none"),
		MOD.modelSourceKey("tier"),
		MOD.modelSourceKey("session"),
		MOD.effortSourceKey("team"),
		MOD.effortSourceKey("tier"),
		MOD.effortSourceKey("model_default"),
	];
	for (const key of keys) {
		assert.equal(
			typeof MOD.bundledEnglish[key],
			"string",
			`${key} is not in the bundled catalogue`,
		);
	}
	assert.equal(
		MOD.modelSourceKey("session"),
		"ui.agents.models.source.session",
	);
});

test("only a 404 on the route hides the override editor", () => {
	assert.equal(
		MOD.overrideEditorVisible(new MOD.DesktopControlError(404, "missing")),
		false,
	);
	assert.equal(
		MOD.overrideEditorVisible(new MOD.DesktopControlError(500, "boom")),
		true,
		"a backend that is merely erroring has not said the route is absent",
	);
	assert.equal(
		MOD.overrideEditorVisible(new MOD.DesktopControlError(403, "no")),
		true,
	);
	assert.equal(
		MOD.overrideEditorVisible(new MOD.DesktopControlError(null, "gone")),
		true,
	);
	assert.equal(MOD.overrideEditorVisible(new Error("network")), true);
	assert.equal(
		MOD.overrideEditorVisible(undefined),
		true,
		"before the read answers there is no failure to act on",
	);
});

test("the probe has three states, and only a positive success opens the editor", () => {
	/*
	 * M1 OF THE CODE REVIEW: `error === null` is not "supported". A create form has no
	 * team to read and an in-flight request has no answer, and both used to render the
	 * controls and then take them back when the 404 landed.
	 */
	assert.equal(
		MOD.overrideEditorState({ isSuccess: true, isError: false, error: null }),
		"available",
	);
	/*
	 * THE TABLE HOLDS ONE ENTRY PER STATE IT CAN TELL APART (code review round 2,
	 * minor 2). "In flight" and "no team to probe with" are the SAME object literal as
	 * far as this function can see - it reads three fields and neither case sets any of
	 * them - so the loop asserts that state once. The difference between them is a name
	 * to probe with, which is the component's business and is covered below by the
	 * in-flight case and the empty-catalogue create case.
	 */
	for (const probe of [
		/* nothing has answered yet, so nothing is claimed */
		{ isSuccess: false, isError: false, error: null },
		/* the route is not there: an older server, which also ignores the member keys */
		{
			isSuccess: false,
			isError: true,
			error: new MOD.DesktopControlError(404, "missing"),
		},
	]) {
		assert.equal(
			MOD.overrideEditorState(probe),
			"absent",
			"only a success may offer the override controls",
		);
	}
	/* A failure that is not the route's absence keeps the controls hidden AND speaks. */
	assert.equal(
		MOD.overrideEditorState({
			isSuccess: false,
			isError: true,
			error: new MOD.DesktopControlError(500, "boom"),
		}),
		"unavailable",
	);
	assert.equal(
		MOD.overrideEditorState({
			isSuccess: false,
			isError: true,
			error: new MOD.DesktopControlError(null, "gone"),
		}),
		"unavailable",
		"a backend that is down has not said the route is absent",
	);
});

test("a cleared override compares equal to one that was never set", () => {
	/*
	 * MINOR 2 OF THE CODE REVIEW. `members` replaces the roster wholesale, so the
	 * PAYLOAD keeps a cleared field as an explicit null; the FORM must not read that
	 * null as unsaved work when a slot went `hi` -> `Inherit`.
	 */
	const untouched = { role: "coder", kind: "agent", count: 1, key: "row-1" };
	const cleared = { ...untouched, tier: null, effort: null };
	assert.equal(MOD.memberSignature(cleared), MOD.memberSignature(untouched));
	assert.notEqual(
		MOD.memberSignature({ ...untouched, tier: "hi" }),
		MOD.memberSignature(untouched),
	);
	assert.notEqual(
		MOD.memberSignature({ ...untouched, count: 2 }),
		MOD.memberSignature(untouched),
		"a real change is still a change",
	);
	assert.equal(
		MOD.memberSignature(untouched),
		MOD.memberSignature({ ...untouched, key: "row-9" }),
		"the form's own row id is never part of the comparison",
	);
});

test("the route is a read on its own path, and the probe reads the same route it would ask", () => {
	const request = { op: "teams.effective", name: "crew" };
	assert.ok(MOD.desktopRequestSchema.safeParse(request).success);
	assert.equal(
		MOD.desktopRequestSchema.safeParse({ ...request, extra: 1 }).success,
		false,
	);
	assert.deepEqual(MOD.desktopEndpoint(request), {
		path: "/v1/desktop/teams/crew/effective",
		method: "GET",
	});
	assert.deepEqual(MOD.desktopEndpoint({ op: "teams.get", name: "crew" }), {
		path: "/v1/desktop/teams/crew",
		method: "GET",
	});
	assert.deepEqual(
		MOD.desktopEndpoint({ op: "teams.effective", name: "a b" }).path,
		"/v1/desktop/teams/a%20b/effective",
	);
});

/* ------------------------------------------------------------- the editor -- */

const pageBundle = await build({
	stdin: {
		contents:
			'export { TeamDetail } from "./src/renderer/src/features/agents/components/team-detail";',
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
		"@tanstack/react-query",
	],
	tsconfig: "tsconfig.web.json",
});
/*
 * THE BUNDLE LANDS ON DISK FOR THE LENGTH OF THE IMPORT. A `data:` module cannot
 * resolve the bare specifiers above, and the failure is an
 * `ERR_UNSUPPORTED_RESOLVE_REQUEST` raised asynchronously - after the tests that
 * already registered have passed, so it reads as a green run with a mystery
 * epilogue. The pid keeps two of these files apart, and the unlink is immediate.
 */
const pageBundlePath = new URL(
	`./_team-member-overrides-page-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(pageBundlePath, pageBundle.outputFiles[0].text);
const PAGE = await import(pageBundlePath.href);
await unlink(pageBundlePath);

const { JSDOM } = await import("jsdom");
const dom = new JSDOM("<!doctype html>", { url: "http://localhost/" });
const { window } = dom;

/*
 * THE DOM'S GLOBALS, ONTO NODE'S. React DOM reads `document`, `Event` and friends
 * off the global scope, and this file's own module graph (imported before the DOM
 * existed, as in `agent-class-toggle.test.mjs`) does the same at use time. The
 * shim list is that file's, which was measured against this app's graph.
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
	"Event",
	"CustomEvent",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"Document",
	"Window",
];
const shims = {
	document: window.document,
	window,
	navigator: window.navigator,
	location: window.location,
	history: window.history,
	localStorage: window.localStorage,
	sessionStorage: window.sessionStorage,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	IntersectionObserver: class {
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
for (const key of SHIMMED_GLOBALS) shims[key] = window[key];
for (const [key, value] of Object.entries(shims)) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
window.matchMedia ??= shims.matchMedia;
window.electron = {
	ipcRenderer: {
		on: () => () => {},
		removeListener: () => window.electron.ipcRenderer,
	},
};

const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = await import("react");
const { MemoryRouter } = await import("react-router-dom");
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);

/* ------------------------------------------------------------- the world -- */

const agentRow = (name) => ({
	name,
	kind: "role",
	source: "builtin",
	agent_id: null,
	description: "",
	tools: null,
	effort: null,
	delegate: false,
	instructions: "",
});

/**
 * One team whose SECOND slot carries both overrides.
 *
 * The overrides sit on the slot the case never touches, which is the point: a
 * save driven by the other row is exactly the case that erases them if the
 * editor sends what it showed without echoing what it read.
 */
const crew = () => ({
	id: "team-crew",
	name: "crew",
	description: "Ships things.",
	manager: "manager",
	instructions: "Work together.",
	project: "",
	members: [
		{ role: "coder", kind: "agent", count: 1 },
		{ role: "reviewer", kind: "agent", count: 2, tier: "hi", effort: "xhigh" },
	],
});

/**
 * What `/effective` answers for that roster, per member, as the BACKEND answers it
 * (`_effective_member` at branch head `edd506911`).
 *
 * `coder` has no override at all, so its model is the launching session's; the
 * `reviewer` slot carries tier `hi`, which this machine's tier map resolves to a
 * model. Each case states only the row it is about.
 */
const effective = ({ coder = {}, reviewer = {} } = {}) => ({
	team: "crew",
	members: [
		{
			role: "coder",
			kind: "agent",
			tier: { value: null, source: "none" },
			model: { value: null, source: "session" },
			effort: { value: null, requested: null, source: "model_default" },
			available: true,
			reason: "",
			...coder,
		},
		{
			role: "reviewer",
			kind: "agent",
			tier: { value: "hi", source: "team" },
			model: { value: "anthropic/claude-opus-5-5", source: "tier" },
			effort: { value: "xhigh", requested: "xhigh", source: "team" },
			available: true,
			reason: "",
			...reviewer,
		},
	],
});

/**
 * The readings the bridge can answer with, by name, so a case names the state it is
 * about instead of restating the wire.
 */
const READINGS = {
	ok: () => effective(),
	/*
	 * `auto`, RESOLVED AS THE BACKEND RESOLVES IT: to the MODEL's own default, which
	 * is not the tier map's level. A fixture that made them equal would photograph the
	 * one case where a wrong display looks right (design round 1, D0).
	 */
	auto: () =>
		effective({
			reviewer: {
				/* `medium` is what the contract probe measured for this model (minor 3). */
				effort: { value: "medium", requested: "auto", source: "team" },
			},
		}),
	/* A request the model's ladder clamps: asked for max, runs at high. */
	clamped: () =>
		effective({
			reviewer: {
				effort: { value: "high", requested: "max", source: "team" },
			},
		}),
	/*
	 * The tier is WRITTEN but nothing is configured at it. The backend keeps
	 * `source: "tier"` for the model and reports no model value at all, so the pane
	 * must not print a model clause for this row.
	 */
	refuse: () =>
		effective({
			reviewer: {
				model: { value: null, source: "tier" },
				available: false,
				reason:
					"tier 'hi' is not configured: no models are configured under subagents.models",
			},
		}),
};

/**
 * The bridge, over a world the write does NOT mutate.
 *
 * `outcome` is the probe's own variable: a name in `READINGS` answers with that
 * reading, a number answers that HTTP status (404 = a backend that predates the
 * route, 500 = one that is merely failing), and "pending" never answers at all -
 * the state the editor must survive without claiming a capability.
 */
const installBridge = (outcome = "ok") => {
	const calls = [];
	const writes = [];
	/*
	 * `slow-second` ANSWERS THE FIRST PROBE AND NEVER ANSWERS AGAIN - the state U6 is
	 * about: a save lands, the re-read is in flight, and the table still holds the
	 * values from before it.
	 */
	let probes = 0;
	const handler = async (request) => {
		calls.push(request.op);
		switch (request.op) {
			case "teams.get":
				return { status: 200, body: { result: { ...crew() } } };
			case "teams.effective":
				probes += 1;
				if (outcome === "pending" || (outcome === "slow-second" && probes > 1))
					return new Promise(() => {});
				if (typeof outcome === "number")
					return { status: outcome, body: { detail: "no such route" } };
				return {
					status: 200,
					body: { result: (READINGS[outcome] ?? READINGS.ok)() },
				};
			case "teams.update":
				writes.push(request.fields);
				return {
					status: 200,
					body: { result: { ...crew(), ...request.fields } },
				};
			default:
				throw new Error(`unexpected desktop op in this test: ${request.op}`);
		}
	};
	window.api = { desktop: { request: handler } };
	return { calls, writes };
};

/**
 * Mount the REAL team editor, with a client per mount so a re-read is a re-read.
 *
 * The pane is mounted directly rather than through `AgentsPage`: its subject here
 * is what the editor sends and what it prints, and a page mount would bring the
 * roster, the composer and the router's own route parsing along for nothing. The
 * props are the page's own (see `agents-page.tsx`), and `MemoryRouter` is what
 * `useNavigate` reads.
 */
const mountEditor = async (
	outcome = "ok",
	/*
	 * `create` MOUNTS THE FORM FOR A TEAM THAT DOES NOT EXIST YET, which is M1's case:
	 * there is no name to probe with, so the catalogue is the only thing that can say
	 * whether this backend has the route.
	 */
	{ create = false, teams = [crew()] } = {},
) => {
	const bridge = installBridge(outcome);
	const container = document.createElement("div");
	document.body.append(container);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const root = createRoot(container);
	await act(async () => {
		root.render(
			h(
				QueryClientProvider,
				{ client },
				h(
					MemoryRouter,
					null,
					h(PAGE.TeamDetail, {
						/* `create` mounts the form for a team that does not exist yet. */
						team: create ? undefined : crew(),
						agents: [
							agentRow("coder"),
							agentRow("reviewer"),
							agentRow("manager"),
						],
						teams,
						askEnabled: false,
						onSaved: () => {},
						onOpenAgent: () => {},
						onAskAgent: () => {},
					}),
				),
			),
		);
	});
	return { container, root, client, ...bridge };
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

const buttonNamed = (scope, name) =>
	[...(scope?.querySelectorAll("button") ?? [])].find(
		(button) => button.textContent?.trim() === name,
	) ?? null;

const stepper = (container, role, direction) =>
	container.querySelector(
		`[aria-label="${direction === "more" ? "One more" : "One fewer"} ${role}"]`,
	);

/** The manager's overrides hidden behind the form, mounted in edit mode. */
const openEditor = async (mounted) => {
	assert.ok(
		await settle(() => Boolean(buttonNamed(mounted.container, "Edit"))),
		"the team pane never rendered its read view",
	);
	await act(async () => {
		buttonNamed(mounted.container, "Edit")?.click();
	});
	assert.ok(
		await settle(() =>
			Boolean(mounted.container.querySelector('[data-testid="edit-footer"]')),
		),
		"the team editor never rendered",
	);
};

const save = (container) =>
	buttonNamed(
		container.querySelector('[data-testid="edit-footer"]'),
		"Save changes",
	);

const withEditor = async (outcome, body, options) => {
	let mounted;
	try {
		mounted = await mountEditor(outcome, options);
		await body(mounted);
	} finally {
		if (mounted) {
			await act(async () => mounted.root.unmount());
			/*
			 * AND THE QUERY CLIENT, whose `gcTime` is a real `setTimeout` per settled
			 * query (react-query's default is minutes). Unmounting the provider does not
			 * clear them, so a file that mounts a client per case and never clears one
			 * finishes its tests and then never exits - which, under
			 * `scripts/run-desktop-tests.mjs`, is a hung suite rather than a red one.
			 */
			mounted.client.clear();
		}
		document.body.innerHTML = "";
	}
};

/** The reading table's own header, so a case can say what the columns are. */
const readingHeaders = (container) =>
	[
		...container.querySelectorAll('[aria-label="Model and effort"] thead th'),
	].map((cell) => cell.textContent?.trim());

/**
 * One member's reading cells, each as the two facts it prints: a value and, under
 * it, the layer that set it (design round 1, D1 - the point of the columns is that
 * a value and its layer are different things, so they are asserted as different
 * things).
 */
const readingCells = (container, role) => {
	const row = [
		...container.querySelectorAll('[aria-label="Model and effort"] tbody tr'),
	].find(
		(candidate) => candidate.querySelector("td")?.textContent?.trim() === role,
	);
	assert.ok(row, `no reading row for ${role}`);
	return [...row.querySelectorAll("td")].map((cell) => ({
		text: cell.textContent?.trim() ?? "",
		parts: [...cell.querySelectorAll("span")].map(
			(span) => span.textContent?.trim() ?? "",
		),
	}));
};

test("a save that writes the roster echoes every slot's override, including the ones it did not touch", async () => {
	await withEditor("ok", async ({ container, writes, calls }) => {
		await openEditor({ container });
		await act(async () => stepper(container, "coder", "more")?.click());
		await act(async () => save(container)?.click());
		assert.ok(
			await settle(() => writes.length === 1),
			"the save never reached the bridge",
		);
		assert.deepEqual(
			writes[0].members,
			[
				{ role: "coder", kind: "agent", count: 2 },
				{
					role: "reviewer",
					kind: "agent",
					count: 2,
					tier: "hi",
					effort: "xhigh",
				},
			],
			"every slot carries its override, including the one this save never touched",
		);
		/*
		 * AND THE READING IS RE-READ, not patched locally (code review round 1, minor
		 * 1): only the backend knows what the tier just written resolves to, so the pane
		 * asks again rather than guessing. One call at mount, and AT LEAST one more after
		 * the save - two, in fact, because both the explicit refetch and the authoring
		 * prefix invalidation match this key, which is a redundant GET rather than a
		 * missing one, so the assertion counts a floor instead of an exact number.
		 */
		const probes = () => calls.filter((op) => op === "teams.effective").length;
		assert.ok(
			await settle(() => probes() >= 2),
			`the reading was not re-read after the save (calls: ${calls.join(", ")})`,
		);
	});
});

test("a cleared override reaches the wire as null, and both controls stay mounted", async () => {
	/*
	 * WHAT THIS PROVES, AND WHAT IT CANNOT - MEASURED, NOT ASSUMED (code review
	 * rounds 1 and 2, minor 1). The CLEAR here is driven through the module's own
	 * mapping, which pins the shape the form holds: a `null` on the wire, not the word
	 * `inherit` and not a dropped key.
	 *
	 * THE CONTROL ITSELF WAS THEN DRIVEN TWO MORE WAYS THIS ROUND, and neither reaches
	 * Radix's menu under this harness:
	 * - there is no hidden native `<select>` to poke: Radix mounts that bubble input
	 *   only when the root gets a `name` or `form` prop (`isFormControl`), and this
	 *   control has neither;
	 * - `Enter` at the trigger opens nothing, and a hand-made `pointerdown` at the
	 *   trigger followed by `pointerup`/`click` on the item selects nothing either -
	 *   the list never mounts, because the menu needs a layout engine.
	 * The wiring's evidence is therefore the RENDERED frames, where a real Chromium
	 * opens the list and takes an item: `team-overrides-menu-open.png` (the list open
	 * over the reviewer's effort select) and `team-overrides-menu-cleared.png` (the
	 * same control after choosing `Inherit (agent's effort)`, the form dirty).
	 */
	await withEditor("ok", async ({ container }) => {
		await openEditor({ container });
		const cleared = MOD.withOverride(crew().members[1], {
			tier: MOD.INHERIT,
			effort: MOD.INHERIT,
		});
		assert.equal(cleared.tier, null);
		assert.equal(cleared.effort, null);
		assert.match(JSON.stringify(cleared), /"tier":null.*"effort":null/);
		assert.ok(
			container.querySelector('[aria-label="Effort tier for coder"]'),
			"the tier select is not mounted on a backend that has the route",
		);
		assert.ok(
			container.querySelector('[aria-label="Reasoning effort for reviewer"]'),
			"the effort select is not mounted on a backend that has the route",
		);
	});
});

test("the reading is a table of values over their layers, not a run-on line", async () => {
	await withEditor("ok", async ({ container }) => {
		await openEditor({ container });
		await act(async () => buttonNamed(container, "Cancel")?.click());
		assert.ok(
			await settle(() => Boolean(readingHeaders(container)?.length)),
			"the read view never rendered its reading table",
		);
		assert.deepEqual(
			readingHeaders(container),
			["Member", "Model", "Effort"],
			"the reading's columns are the two facts plus the member they belong to",
		);
		const reviewer = readingCells(container, "reviewer");
		assert.deepEqual(
			reviewer[1].parts,
			["anthropic/claude-opus-5-5", "tier hi (from this team)"],
			"the model, then the tier in play and the layer that set it",
		);
		assert.deepEqual(
			reviewer[2].parts,
			["xhigh", "from this team"],
			"the effort, then the layer that set it",
		);
		const coder = readingCells(container, "coder");
		assert.deepEqual(
			coder[1].parts,
			["the launching session's model"],
			"a slot with no tier names the session once, not twice (D5)",
		);
		assert.deepEqual(
			coder[2].parts,
			["model default"],
			"an unnamed effort is its layer, not a layer under itself, and it reads as one of a pair with `auto` (design round 2, N2)",
		);
	});
});

test("auto reads as the model's own default, never as the level it resolved to", async () => {
	/*
	 * D0. The backend resolves `auto` to the MODEL's default, which for this model is
	 * not the tier map's level; printing the resolved level alone said the operator
	 * had chosen it by hand, and two members with different stored overrides read
	 * identically.
	 */
	await withEditor("auto", async ({ container }) => {
		assert.ok(
			await settle(() => Boolean(readingHeaders(container)?.length)),
			"the reading table never rendered",
		);
		const reviewer = readingCells(container, "reviewer");
		assert.deepEqual(
			reviewer[2].parts,
			["auto", "the model's default"],
			"the request, then where the level comes from - not the level, which is what two members' rows used to share (design round 1, D0; round 2, N2)",
		);
	});
});

test("a clamped request shows both the ask and the level it runs at", async () => {
	await withEditor("clamped", async ({ container }) => {
		assert.ok(
			await settle(() => Boolean(readingHeaders(container)?.length)),
			"the reading table never rendered",
		);
		const reviewer = readingCells(container, "reviewer");
		assert.deepEqual(reviewer[2].parts, ["max → high", "from this team"]);
	});
});

test("an unavailable member is printed with the backend's reason, names no model, and says where to fix it", async () => {
	await withEditor("refuse", async ({ container }) => {
		assert.ok(
			await settle(() => Boolean(readingHeaders(container)?.length)),
			"the reading table never rendered",
		);
		const reviewer = readingCells(container, "reviewer");
		assert.deepEqual(
			reviewer[1].parts,
			["not resolved", "tier hi (from this team)"],
			"a tier that produced no model must not be shown as one that did",
		);
		const reason = container.querySelector(
			'[data-testid="team-effective-unavailable"]',
		);
		assert.ok(reason, "the reason was not printed");
		assert.match(
			reason.textContent ?? "",
			/^reviewer cannot start: tier 'hi' is not configured/,
			"the sentence names its member: it sits in a row of its own, and naming is how a reader knows whose it is (design round 2, D11)",
		);
		assert.match(
			container.textContent ?? "",
			/Add the tier in Settings\./,
			"the backend names a config path; the pane has to name the place to go",
		);
		/* And the same warning is on the member's row in the editor, marked as saved. */
		await act(async () => {
			const edit = buttonNamed(container, "Edit");
			edit?.click();
		});
		assert.ok(
			await settle(() =>
				Boolean(
					container.querySelector('[data-testid="team-member-unavailable"]'),
				),
			),
			"the editor did not warn about the saved tier",
		);
		assert.match(
			container.querySelector('[data-testid="team-member-unavailable"]')
				.textContent ?? "",
			/Saved setting — reviewer cannot start/,
		);
		assert.match(
			container.textContent ?? "",
			/Add the tier in Settings\./,
			"the FORM names the place to go as well as the read view (UX round 1, U4)",
		);
	});
});

test("the reading's headers sit on their columns rather than inset from them", async () => {
	/*
	 * D12. The body cells of the first and last columns are `px-0`, so a header with the
	 * primitive's default inset stands 8 px to the right of the values it heads. A
	 * rendered frame is the only instrument that can MEASURE the alignment; this pins
	 * the invariant the alignment is computed from, so a later change to one side and
	 * not the other is caught here rather than in a re-shoot.
	 */
	await withEditor("ok", async ({ container }) => {
		assert.ok(
			await settle(() => Boolean(readingHeaders(container)?.length)),
			"the reading table never rendered",
		);
		const table = container.querySelector('[aria-label="Model and effort"]');
		const padding = (cell) =>
			(cell.className.match(/\bpx-\S+/g) ?? []).sort().join(" ");
		const heads = [...table.querySelectorAll("thead th")];
		const cells = [...table.querySelectorAll("tbody tr:first-child td")];
		assert.equal(heads.length, 3);
		for (const [index, head] of heads.entries()) {
			assert.equal(
				padding(head),
				padding(cells[index]),
				`the ${head.textContent?.trim()} header is inset differently from the cells it heads (D12)`,
			);
		}
	});
});

test("a role or a selector that clips keeps its full text readable", async () => {
	/*
	 * D13. The columns are fixed so the table holds at 480, which means a long role and
	 * a routed selector truncate; the tooltip is what makes a clipped fact a shown fact.
	 */
	await withEditor("ok", async ({ container }) => {
		assert.ok(
			await settle(() => Boolean(readingHeaders(container)?.length)),
			"the reading table never rendered",
		);
		const titles = [
			...container.querySelectorAll('[aria-label="Model and effort"] [title]'),
		].map((el) => el.getAttribute("title"));
		assert.ok(
			titles.includes("reviewer"),
			"the member's own name is not readable when the column clips it",
		);
		assert.ok(
			titles.includes("anthropic/claude-opus-5-5"),
			"the selector is not readable when the column clips it",
		);
	});
});

test("the scope and the precedence are stated where the choice is made, and in the read view", async () => {
	/*
	 * U1. The operator's own question was whether an override here reaches the agent or
	 * another team; nothing on the form said it did not.
	 */
	await withEditor("ok", async ({ container }) => {
		await openEditor({ container });
		const hint = container.querySelector('[data-testid="team-override-scope"]');
		assert.ok(hint, "the form does not say what an override here applies to");
		assert.match(
			hint.textContent ?? "",
			/applies to this team only, and takes priority over the agent's own tier and effort/,
			"both halves are needed: this team only, and it beats the agent's own setting",
		);
		await act(async () => buttonNamed(container, "Cancel")?.click());
		assert.ok(
			await settle(() => Boolean(readingHeaders(container)?.length)),
			"the reading table never rendered",
		);
		assert.match(
			container.textContent ?? "",
			/applies to this team only/,
			"the read view carries the same sentence, from the same message",
		);
	});
});

test("the Saved caption names the layer as well as the value", async () => {
	/* U3: the form is where the operator decides whether to CLEAR the override. */
	await withEditor("ok", async ({ container }) => {
		await openEditor({ container });
		assert.ok(
			await settle(() => (container.textContent ?? "").includes("Saved")),
			"the form never printed a saved caption",
		);
		const text = container.textContent ?? "";
		assert.match(
			text,
			/Model: anthropic\/claude-opus-5-5 \(from this team\)/,
			"the saved model's layer belongs beside it, and it is the TIER's layer: that is what says the value is this team's own override rather than the agent's pin",
		);
		assert.match(
			text,
			/Effort: xhigh \(from this team\)/,
			"and so does the saved effort's",
		);
	});
});

test("a failed probe says what it costs and offers a retry, in the form and the read view", async () => {
	/* U5, and Q2's behaviour half. */
	await withEditor(500, async ({ container, calls }) => {
		assert.ok(
			await settle(() =>
				(container.textContent ?? "").includes("so overrides cannot be edited"),
			),
			"the failure must say what the operator is missing, not only that it failed",
		);
		const before = calls.filter((op) => op === "teams.effective").length;
		await act(async () => buttonNamed(container, "Try again")?.click());
		assert.ok(
			await settle(
				() => calls.filter((op) => op === "teams.effective").length > before,
			),
			"the retry did not re-run the probe the controls are gated on",
		);
		await act(async () => buttonNamed(container, "Edit")?.click());
		assert.match(
			container.textContent ?? "",
			/so overrides cannot be edited/,
			"the form says it too, where the operator came to set an override",
		);
	});
});

test("the reading is marked while the post-save re-read is in flight", async () => {
	/* U6: a pre-save table under a `Saved` toast is the confusion this exists to end. */
	await withEditor("slow-second", async ({ container }) => {
		await openEditor({ container });
		await act(async () => save(container)?.click());
		assert.ok(
			await settle(() =>
				Boolean(
					container.querySelector('[data-testid="team-effective-refreshing"]'),
				),
			),
			"the table was left showing pre-save values with nothing to say it was moving",
		);
	});
});

test("a create form on a machine with no teams says why the overrides are not there", async () => {
	/* Q3: correct behaviour that otherwise looks like a missing feature. */
	await withEditor(
		"ok",
		async ({ container }) => {
			assert.ok(
				await settle(() =>
					Boolean(
						container.querySelector('[data-testid="team-override-no-probe"]'),
					),
				),
				"nothing explains a create form with no override controls",
			);
			await act(async () => buttonNamed(container, "Add member")?.click());
			assert.equal(
				container.querySelector('[aria-label^="Effort tier for"]'),
				null,
				"and the controls still wait for a save, because there is still nothing to probe",
			);
		},
		{ create: true, teams: [] },
	);
});

test("a backend without the route shows no override controls and no reading", async () => {
	await withEditor(404, async ({ container, calls }) => {
		assert.ok(
			await settle(() => calls.includes("teams.effective")),
			"the probe was never taken",
		);
		assert.equal(
			container.querySelector('[aria-label="Effort tier for coder"]'),
			null,
			"a server without the route must not offer an override it would discard",
		);
		assert.equal(
			container.querySelector('[data-testid="team-effective-unavailable"]'),
			null,
		);
		assert.equal(
			(container.textContent ?? "").includes("could not be read"),
			false,
			"an older server says nothing: there is nothing the operator can do about it",
		);
	});
});

test("a probe that failed for another reason hides the controls and says the reading is missing", async () => {
	/*
	 * M1's other half. The controls are hidden until a POSITIVE success, so a backend
	 * that is merely failing gets neither the controls nor silence: hiding them without
	 * a word would read as a feature that is not there.
	 */
	await withEditor(500, async ({ container }) => {
		assert.ok(
			await settle(() =>
				(container.textContent ?? "").includes("could not be read"),
			),
			"a failing probe must not be silent",
		);
		assert.equal(
			container.querySelector('[aria-label="Effort tier for coder"]'),
			null,
		);
	});
});

test("an in-flight probe offers nothing and says nothing", async () => {
	await withEditor("pending", async ({ container, calls }) => {
		assert.ok(
			await settle(() => calls.includes("teams.effective")),
			"the probe was never taken",
		);
		assert.equal(
			container.querySelector('[aria-label="Effort tier for coder"]'),
			null,
			"a pending read is not a supported backend (M1)",
		);
		assert.equal(
			(container.textContent ?? "").includes("could not be read"),
			false,
		);
	});
});

test("a create form probes with a team the catalogue has, and offers the controls when it answers", async () => {
	await withEditor(
		"ok",
		async ({ container, calls }) => {
			assert.ok(
				await settle(() => calls.includes("teams.effective")),
				"a create form must probe: nothing else can say whether this backend has the route",
			);
			/*
			 * A CREATE FORM STARTS WITH NO ROSTER, so the row that carries the controls only
			 * exists once a member does.
			 */
			await act(async () => buttonNamed(container, "Add member")?.click());
			assert.ok(
				await settle(() =>
					Boolean(container.querySelector('[aria-label^="Effort tier for"]')),
				),
				"the create form did not offer the overrides after a positive probe",
			);
			assert.equal(
				readingHeaders(container).length,
				0,
				"the probed team's own reading is not this new team's reading",
			);
		},
		{ create: true },
	);
});

test("a create form with no team to probe offers nothing", async () => {
	await withEditor(
		"ok",
		async ({ container, calls }) => {
			assert.equal(
				calls.includes("teams.effective"),
				false,
				"the probe was taken with nothing to name",
			);
			await act(async () => buttonNamed(container, "Add member")?.click());
			assert.equal(
				container.querySelector('[aria-label^="Effort tier for"]'),
				null,
				"with no team to ask about, the capability is unknown (M1)",
			);
		},
		{ create: true, teams: [] },
	);
});
