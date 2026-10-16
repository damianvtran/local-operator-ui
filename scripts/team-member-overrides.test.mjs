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
	const wire = { role: "coder", count: 2, kind: "agent", tier: "hi", effort: "xhigh" };
	const cleared = MOD.withOverride(wire, { tier: MOD.INHERIT });
	assert.equal(cleared.tier, null);
	assert.equal(cleared.effort, "xhigh", "the other field is untouched");
	assert.match(
		JSON.stringify(cleared),
		/"tier":null/,
		"a cleared override stays in the payload: it is an act on the roster, not an omission",
	);
	assert.equal(
		MOD.withOverride(wire, { effort: MOD.INHERIT }).effort,
		null,
	);
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
	const payload = { team: "crew", members: [reading(), reading({ role: "pod", kind: "team" })] };
	assert.equal(
		MOD.effectiveFor(payload, { role: "CODER", kind: "agent" })?.role,
		"coder",
	);
	assert.equal(
		MOD.effectiveFor(payload, { role: "coder", kind: "team" }),
		null,
		"the same name on a team slot is a different slot",
	);
	assert.equal(MOD.effectiveFor(payload, { role: "nobody", kind: "agent" }), null);
	assert.equal(MOD.effectiveFor(undefined, { role: "coder", kind: "agent" }), null);
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
	assert.equal(MOD.overrideEditorVisible(new MOD.DesktopControlError(404, "missing")), false);
	assert.equal(
		MOD.overrideEditorVisible(new MOD.DesktopControlError(500, "boom")),
		true,
		"a backend that is merely erroring has not said the route is absent",
	);
	assert.equal(
		MOD.overrideEditorVisible(new MOD.DesktopControlError(403, "no")),
		true,
	);
	assert.equal(MOD.overrideEditorVisible(new MOD.DesktopControlError(null, "gone")), true);
	assert.equal(MOD.overrideEditorVisible(new Error("network")), true);
	assert.equal(
		MOD.overrideEditorVisible(undefined),
		true,
		"before the read answers there is no failure to act on",
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
	assert.deepEqual(MOD.desktopEndpoint({ op: "teams.effective", name: "a b" }).path, "/v1/desktop/teams/a%20b/effective");
});

/* ------------------------------------------------------------- the editor -- */

const pageBundle = await build({
	stdin: {
		contents: 'export { TeamDetail } from "./src/renderer/src/features/agents/components/team-detail";',
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

/** What `/effective` answers for that roster. */
const effective = (over = {}) => ({
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
			...over,
		},
		{
			role: "reviewer",
			kind: "agent",
			tier: { value: "hi", source: "team" },
			model: { value: "anthropic/claude-opus-5-5", source: "tier" },
			effort: { value: "xhigh", requested: "xhigh", source: "team" },
			available: true,
			reason: "",
		},
	],
});

/**
 * The bridge, over a world the write does NOT mutate.
 *
 * `effectiveOutcome` is the probe's own variable: "ok" answers the reading, a
 * number answers that HTTP status (404 = a backend that predates the route, 500 =
 * one that is merely failing), and "refuse" marks the reading unavailable with the
 * backend's reason instead.
 */
const installBridge = (outcome = "ok") => {
	const calls = [];
	const writes = [];
	const handler = async (request) => {
		calls.push(request.op);
		switch (request.op) {
			case "teams.get":
				return { status: 200, body: { result: { ...crew() } } };
			case "teams.effective":
				if (typeof outcome === "number")
					return { status: outcome, body: { detail: "no such route" } };
				return {
					status: 200,
					body: {
						result:
							outcome === "refuse"
								? effective({
										tier: { value: "hi", source: "team" },
										model: { value: null, source: "session" },
										available: false,
										reason: "tier 'hi' is not configured",
									})
								: effective(),
					},
				};
			case "teams.update":
				writes.push(request.fields);
				return { status: 200, body: { result: { ...crew(), ...request.fields } } };
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
const mountEditor = async (outcome = "ok") => {
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
						team: crew(),
						agents: [agentRow("coder"), agentRow("reviewer"), agentRow("manager")],
						teams: [crew()],
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

const withEditor = async (outcome, body) => {
	let mounted;
	try {
		mounted = await mountEditor(outcome);
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

test("a save that writes the roster echoes every slot's override, including the ones it did not touch", async () => {
	await withEditor("ok", async ({ container, writes }) => {
		await openEditor({ container });
		/*
		 * THE PRESS IS ON THE OTHER MEMBER'S COUNT. `coder` carries no override, and
		 * `reviewer` carries both - so the roster goes out with the touch on `coder`
		 * and the overrides riding along from the read.
		 */
		const more = stepper(container, "coder", "more");
		assert.ok(more, "the count stepper is not mounted");
		await act(async () => {
			more.click();
		});
		await act(async () => {
			save(container)?.click();
		});
		assert.ok(
			await settle(() => writes.length === 1),
			"the save never reached the bridge",
		);
		assert.deepEqual(writes[0].members, [
			{ role: "coder", count: 2, kind: "agent" },
			{
				role: "reviewer",
				count: 2,
				kind: "agent",
				tier: "hi",
				effort: "xhigh",
			},
		]);
	});
});

test("clearing an override on one slot sends null for it and leaves the other slot's alone", async () => {
	await withEditor("ok", async ({ container, writes }) => {
		await openEditor({ container });
		/*
		 * THE CLEAR IS DRIVEN THROUGH THE MODULE'S OWN MAPPING, because jsdom cannot
		 * open a Radix menu (no layout, and Radix's item selection is pointer-driven).
		 * What this case therefore pins is the SHAPE of what the form holds after a
		 * clear - a `null` on the wire, not the word `inherit` and not a dropped key -
		 * which is the half a frame cannot show either.
		 */
		const cleared = MOD.withOverride(
			{ role: "reviewer", count: 2, kind: "agent", tier: "hi", effort: "xhigh" },
			{ tier: MOD.INHERIT },
		);
		assert.deepEqual(cleared, {
			role: "reviewer",
			count: 2,
			kind: "agent",
			tier: null,
			effort: "xhigh",
		});
		/* And the editor's own controls are on screen for the operator to use. */
		assert.ok(
			container.querySelector(
				'[aria-label="Model tier for reviewer"]',
			),
			"the tier select is not mounted on a backend that has the route",
		);
		assert.ok(
			container.querySelector(
				'[aria-label="Reasoning effort for reviewer"]',
			),
			"the effort select is not mounted on a backend that has the route",
		);
	});
});

test("the read pane prints each member's effective model, effort and the layer that set it", async () => {
	await withEditor("ok", async ({ container, calls }) => {
		/*
		 * THE READING IS IN THE READ VIEW, which is where a launch's resolution is
		 * read; the selects live behind Edit. So this case waits on the reading
		 * itself - the model id the tier map resolved to - and not on a control.
		 */
		assert.ok(
			await settle(() =>
				(container.textContent ?? "").includes("anthropic/claude-opus-5-5"),
			),
			"the resolved model is not printed",
		);
		assert.equal(calls.filter((op) => op === "teams.effective").length, 1);
		const line = [...container.querySelectorAll("li")]
			.map((row) => row.textContent ?? "")
			.find((text) => text.includes("reviewer"));
		assert.ok(line, "the reading for reviewer is not printed");
		assert.match(line, /effort xhigh/);
		assert.match(line, /from this team/);
		assert.match(line, /tier hi/);
		const session = [...container.querySelectorAll("li")]
			.map((row) => row.textContent ?? "")
			.find((text) => text.includes("coder"));
		assert.match(
			session ?? "",
			/the launching session's model/,
			"a null model prints as inheriting the session, not as a blank",
		);
		assert.match(session ?? "", /the model's default/);
	});
});

test("an unavailable member is printed with the backend's reason, not as a silent fall-through", async () => {
	await withEditor("refuse", async ({ container }) => {
		assert.ok(
			await settle(() =>
				Boolean(
					container.querySelector('[data-testid="team-effective-unavailable"]'),
				),
			),
			"the unavailable state never rendered",
		);
		assert.match(
			container.querySelector('[data-testid="team-effective-unavailable"]')
				?.textContent ?? "",
			/tier 'hi' is not configured/,
		);
		/*
		 * AND THE SAME WARNING SITS BESIDE THE CONTROL THAT CAN FIX IT: the operator
		 * choosing a tier sees the one it is replacing before saving, not only the
		 * resolution afterwards.
		 */
		await openEditor({ container });
		assert.match(
			container.querySelector('[data-testid="team-member-unavailable"]')
				?.textContent ?? "",
			/tier 'hi' is not configured/,
		);
	});
});

test("a backend without the route shows no override controls and no reading", async () => {
	await withEditor(404, async ({ container, calls }) => {
		assert.ok(
			await settle(() => calls.includes("teams.effective")),
			"the probe never asked",
		);
		assert.doesNotMatch(
			container.textContent ?? "",
			/Model and effort/,
			"and it must not print a reading it never received",
		);
		assert.doesNotMatch(container.textContent ?? "", /could not be read/);
		/*
		 * THE CONTROLS ARE ASKED FOR IN THE FORM, which is the only place they can
		 * appear: asserting their absence in the read view would be true of every
		 * backend and would pin nothing.
		 */
		await openEditor({ container });
		assert.equal(
			container.querySelector('[aria-label="Model tier for reviewer"]'),
			null,
			"an older server must not be offered an override it would ignore",
		);
		assert.equal(
			container.querySelector('[aria-label="Reasoning effort for reviewer"]'),
			null,
		);
	});
});

test("a read that failed for any other reason keeps the controls and says the reading is missing", async () => {
	await withEditor(500, async ({ container }) => {
		assert.ok(
			await settle(() =>
				(container.textContent ?? "").includes("could not be read"),
			),
			"a failed read was reported as nothing at all",
		);
		await openEditor({ container });
		assert.ok(
			container.querySelector('[aria-label="Model tier for reviewer"]'),
			"the controls were hidden for a failure that is not the route's absence",
		);
	});
});

