/**
 * WHERE A SPEAK PRESS IS AIMED: the name-to-id resolution, the two routes, the
 * fallback, and the refusals that must NOT fall back.
 *
 * WHAT THIS FILE IS, exactly: `@shared/lib/speech-target`'s rule and resolution,
 * and `speech-store`'s `fetchSpeechFor` chain, driven through the store's own
 * public factory with the desktop boundary stubbed AT THE LEVEL THE APP USES IT
 * (`desktopResult` for the profile list, the local-operator client for the speech
 * and agents routes). The recorder sees which ROUTE a press took, what body it
 * carried, and WHICH LOOKUP it made first - which is the whole subject: the
 * operator's report was a press that asked the daemon's agent registry for a
 * SESSION, its first fix sent the profile NAME to a route that resolves ids, and
 * a test that only asserted "a request happened" would have passed through all
 * three.
 *
 * THE FIXTURES ARE THE DAEMON'S OWN SHAPES, measured on a live daemon rather than
 * imagined, because the mismatch that produced the second defect was exactly a
 * fixture that was too convenient:
 *
 *   POST /v1/desktop/sessions {target: {kind:"agent", name:"aida"}}
 *     -> the attachment's binding is `aida` - a PROFILE name;
 *   GET  /v1/desktop/profiles -> aida: source "installed", agent_id 1d9c4467-…;
 *   POST /v1/agents/aida/speech       -> 404 + the unknown-agent sentence;
 *   POST /v1/agents/1d9c4467-…/speech -> 401 (past the registry).
 *
 * So the profile row's `agent_id` is the map that matters, the agents registry's
 * own name filter is the map for a binding that names an agent, and the value
 * read as an id is the last rung.
 *
 * THE ARMS THE PRODUCT OWES, one per test below:
 *
 *   1. a bound conversation asks for its ROLE AGENT, as the REGISTRY ID the
 *      route resolves - the binding's name is mapped, never forwarded;
 *   2. a conversation with no binding takes the AGENT-LESS route and still
 *      speaks (the old gate made this arm impossible: `Boolean(agentId)` hid the
 *      control);
 *   3. a binding the registry no longer holds fails over to the agent-less route
 *      instead of printing the unknown-agent sentence - and every OTHER refusal
 *      propagates, because a credit gate or a rate limit is not a wrong target
 *      and retrying it would spend a request and hide the real cause.
 *
 * The refusal strings are read from the shipped module rather than typed here:
 * they are the contract with `local-operator`'s speech route (see
 * `speech-errors.ts`), and a copy in this file would keep passing after the real
 * one moved. What the CONTAINMENT case below pins is the matcher's strictness,
 * not the sentence.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/* The regex literals this file uses, hoisted (`scripts/` is held to `useTopLevelRegex`). */
const CLIENT_MODULE = /@shared\/api\/local-operator$/;
const PROFILES_MODULE = /@shared\/api\/local-operator\/desktop-api$/;
const CONFIG_MODULE = /@shared\/config$/;
const ANY_SPECIFIER = /.*/;
/* The one refusal that must NOT be retried: the credit gate's own sentence. */
const CREDIT_REFUSAL = /credit balance is too low/;

/* The stores persist through `localStorage` at module scope, before the bundle runs. */
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};

/* ------------------------------------------------------------ the recorder */

/** Every speech call this file made, in order, as `{route, agentId?, body}`. */
globalThis.__speechCalls = [];
/** Every agents-registry lookup this file made, in order. */
globalThis.__catalogueCalls = [];
/** Every profile-list read this file made, in order (the op name). */
globalThis.__profileCalls = [];
/** The profiles `/v1/desktop/profiles` answers. */
globalThis.__profiles = [];
/** The agents registry the stub serves: rows as `/v1/agents` would answer them. */
globalThis.__registry = { agents: [], total: null };
/** What the agent route does next: a Blob by default, or an Error to reject with. */
globalThis.__agentOutcome = null;
/** What the agent-less route does next. */
globalThis.__agentlessOutcome = null;
/** Whether the catalogue read itself fails (an unreachable daemon). */
globalThis.__catalogueFails = false;
/** Whether the profile read itself fails. */
globalThis.__profilesFail = false;

/*
 * The REAL `desktop-api`, re-exported by the fixture below and overridden only in
 * `desktopResult`: the module is on the import path of the whole session store,
 * so replacing it wholesale would mean re-stating four exports this rig has no
 * business inventing - and a stand-in for `subscribeDesktopStream` is exactly the
 * kind of convenience that lets a test pass on a shape the app does not use.
 */
const REAL_DESKTOP_API = new URL(
	"../src/renderer/src/shared/api/local-operator/desktop-api.ts",
	import.meta.url,
).pathname;

const loaders = {
	config: 'export const apiConfig = { baseUrl: "http://127.0.0.1:45998" };',
	profiles: `
		export * from ${JSON.stringify(REAL_DESKTOP_API)};
		const seen = () => (globalThis.__profileCalls ??= []);
		export const desktopResult = (request) => {
			seen().push(request.op);
			if (globalThis.__profilesFail) {
				return Promise.reject(new Error("profiles unreachable"));
			}
			if (request.op !== "profiles.list") {
				return Promise.reject(new Error("not part of this rig: " + request.op));
			}
			return Promise.resolve({ profiles: globalThis.__profiles ?? [] });
		};
	`,
	client: `
		const calls = () => (globalThis.__speechCalls ??= []);
		const lookups = () => (globalThis.__catalogueCalls ??= []);
		const settle = (kind, recorded, audio) => {
			calls().push(recorded);
			const outcome = kind === "agent" ? globalThis.__agentOutcome : globalThis.__agentlessOutcome;
			if (outcome instanceof Error) return Promise.reject(outcome);
			return Promise.resolve(new Blob([audio]));
		};
		const registry = () => globalThis.__registry ?? { agents: [], total: null };
		export const createLocalOperatorClient = () => ({
			speech: {
				createForAgent: (agentId, request) =>
					settle("agent", { route: "agent", agentId, body: request }, "agent-audio"),
				create: (request) =>
					settle("agentless", { route: "agentless", body: request }, "agentless-audio"),
			},
			agents: {
				/*
				 * THE DAEMON'S OWN FILTER: a case-insensitive substring match, applied
				 * BEFORE the page is cut, with \`total\` counting every match.
				 */
				listAgents: (page, perPage, name) => {
					lookups().push({ name, page, perPage });
					if (globalThis.__catalogueFails) {
						return Promise.reject(new Error("catalogue unreachable"));
					}
					const all = registry().agents ?? [];
					const matched = name
						? all.filter((row) => row.name.toLowerCase().includes(String(name).toLowerCase()))
						: all;
					const total = registry().total ?? matched.length;
					return Promise.resolve({
						status: 200,
						result: { total, page, per_page: perPage, agents: matched.slice(0, perPage) },
					});
				},
				/* Ids only, as measured: a display name answers 404 here. */
				getAgent: (agentId) => {
					lookups().push({ byId: agentId });
					const hit = (registry().agents ?? []).find((row) => row.id === agentId);
					if (!hit) {
						return Promise.reject(new Error("Get agent request failed: 404 Not Found"));
					}
					return Promise.resolve({ status: 200, result: hit });
				},
			},
		});
	`,
};

const bundle = await build({
	stdin: {
		contents:
			'export { speechBindingForRow, resolveSpeechProfile, resolveSpeechAgentId, fetchSpeechAgentId, SPEECH_AGENT_LOOKUP_PAGE } from "./src/renderer/src/shared/lib/speech-target";\n' +
			'export { fetchSpeechFor } from "./src/renderer/src/shared/store/speech-store";\n' +
			'export { SPEECH_UNKNOWN_AGENT_COPY } from "./src/renderer/src/shared/lib/speech-errors";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	external: ["@tanstack/react-query"],
	plugins: [
		{
			name: "speech-fixtures",
			setup(builder) {
				builder.onResolve({ filter: CONFIG_MODULE }, () => ({
					path: "config",
					namespace: "fixture",
				}));
				builder.onResolve({ filter: PROFILES_MODULE }, () => ({
					path: "profiles",
					namespace: "fixture",
				}));
				builder.onResolve({ filter: CLIENT_MODULE }, () => ({
					path: "client",
					namespace: "fixture",
				}));
				builder.onLoad(
					{ filter: ANY_SPECIFIER, namespace: "fixture" },
					(args) => ({
						loader: "js",
						contents: loaders[args.path],
						/*
						 * A virtual module has no directory of its own, so a fixture that
						 * re-exports a real file has to be given one to resolve against.
						 */
						resolveDir: process.cwd(),
					}),
				);
			},
		},
	],
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45998" };',
	},
	loader: { ".css": "empty", ".png": "empty" },
});

const bundlePath = new URL(
	`./_speech-target-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const mod = await import(bundlePath.href);
await unlink(bundlePath);

/* ------------------------------------------------------------- the fixtures */

/** The profile row a conversation's binding names, as the daemon publishes it. */
const RIG_PROFILE = {
	name: "aida",
	agent_id: "1d9c4467-ac0f-45d9-b529-4a54628ea342",
};
/** The agents-registry row that profile is backed by (same id, same name). */
const RIG_AGENT = { id: RIG_PROFILE.agent_id, name: "aida" };
/** A second agent whose name CONTAINS the first's - the substring trap. */
const NAMESAKE = {
	id: "0f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b",
	name: "aida-two",
};

const reset = ({
	profiles = [RIG_PROFILE],
	agents = [RIG_AGENT],
	total = null,
	agentOutcome = null,
	agentlessOutcome = null,
	catalogueFails = false,
	profilesFail = false,
} = {}) => {
	globalThis.__speechCalls = [];
	globalThis.__catalogueCalls = [];
	globalThis.__profileCalls = [];
	globalThis.__profiles = profiles;
	globalThis.__registry = { agents, total };
	globalThis.__agentOutcome = agentOutcome;
	globalThis.__agentlessOutcome = agentlessOutcome;
	globalThis.__catalogueFails = catalogueFails;
	globalThis.__profilesFail = profilesFail;
};

/* ------------------------------------------- 1. the rule, and the resolution */

test("the binding is the daemon's ATTACHMENT KEY, and an empty one means none", () => {
	assert.equal(
		mod.speechBindingForRow({ binding: { agent: "aida", team: null } }),
		"aida",
		"the row's binding is what a press starts from",
	);
	assert.equal(
		mod.speechBindingForRow({ binding: { agent: "", team: "squad" } }),
		null,
		"a team-bound session writes the empty string for `agent`, and it is not a target",
	);
	assert.equal(mod.speechBindingForRow({ binding: null }), null);
	assert.equal(mod.speechBindingForRow(null), null);
});

test("a PROFILE name resolves through the profile row's own agent_id", () => {
	assert.deepEqual(
		mod.resolveSpeechProfile("aida", [RIG_PROFILE]),
		{ state: "agent", agentId: RIG_PROFILE.agent_id },
		"the daemon publishes the registry id beside the name it writes into the binding",
	);
	/*
	 * THREE ANSWERS, and the middle one is the pin for round 2's MINOR-1: a row
	 * whose `agent_id` is null is the daemon saying "this role has no agent", which
	 * is not the same fact as "no such profile" - only the third answer opens the
	 * registry rungs.
	 */
	assert.deepEqual(
		mod.resolveSpeechProfile("aida", [{ name: "aida", agent_id: null }]),
		{ state: "role-without-agent" },
		"a builtin that was never installed has no agent for the route to resolve",
	);
	assert.deepEqual(
		mod.resolveSpeechProfile("nobody", [RIG_PROFILE]),
		{ state: "unknown" },
		"a name the daemon does not hold is the state that falls through",
	);
});

test("a NAMESAKE caught by the substring query is not this conversation's agent", () => {
	assert.equal(
		mod.resolveSpeechAgentId("aida", { agents: [NAMESAKE, RIG_AGENT] }),
		RIG_AGENT.id,
		"the match is exact, and it is made on the rows the filter returned",
	);
	assert.equal(
		mod.resolveSpeechAgentId("aida", { agents: [NAMESAKE] }),
		null,
		"a name the page does not carry answers null rather than a namesake",
	);
});

test("a binding that is already an ID resolves as one", () => {
	assert.equal(
		mod.resolveSpeechAgentId(RIG_AGENT.id, { agents: [RIG_AGENT] }),
		RIG_AGENT.id,
		"the id limb makes the rule idempotent",
	);
});

test("a TRUNCATED answer refuses to guess", () => {
	assert.equal(
		mod.resolveSpeechAgentId("aida", { agents: [NAMESAKE], total: 412 }),
		null,
		"when the filter matched more rows than it returned, the agent may be on another page",
	);
	assert.equal(
		mod.resolveSpeechAgentId("aida", { agents: [RIG_AGENT], total: 13 }),
		RIG_AGENT.id,
		"and an exact match found on the page is still the answer",
	);
});

/* ------------------------------------------------------- 2. the press itself */

test("a bound conversation is RESOLVED and spoken by its role agent", async () => {
	reset();
	const audio = await mod.fetchSpeechFor("aida", "Hello")();
	assert.deepEqual(
		globalThis.__profileCalls,
		["profiles.list"],
		"the press asks the daemon's own profile map first",
	);
	assert.deepEqual(
		globalThis.__catalogueCalls,
		[],
		"and never falls through to the registry when the profile answers",
	);
	assert.deepEqual(
		globalThis.__speechCalls,
		[
			{
				route: "agent",
				agentId: RIG_PROFILE.agent_id,
				body: { input_text: "Hello" },
			},
		],
		"the request is aimed at the REGISTRY ID, never at the profile name the binding carries",
	);
	assert.equal(audio.size > 0, true, "and the reader gets audio");
});

test("a binding that names an AGENT resolves through the registry's name query", async () => {
	reset({ profiles: [] });
	await mod.fetchSpeechFor("aida", "Hello")();
	assert.deepEqual(
		globalThis.__catalogueCalls,
		[{ name: "aida", page: 1, perPage: mod.SPEECH_AGENT_LOOKUP_PAGE }],
		"the TUI's writer puts an agent name in the binding, and the name filter is the map for it",
	);
	assert.deepEqual(
		globalThis.__speechCalls,
		[{ route: "agent", agentId: RIG_AGENT.id, body: { input_text: "Hello" } }],
		"and the id that comes back is what the press aims at",
	);
});

test("a role with no agent takes the agent-less route, and never a NAMESAKE agent", async () => {
	/*
	 * THE PIN FOR ROUND 2's MINOR-1 (agent review). The daemon holds the profile
	 * and says it has no agent, while the agents registry holds an INSTALLED AGENT
	 * by the same name. The profile map is the daemon's own answer for a role
	 * binding, so the press must take the agent-less route - not speak in a
	 * different agent's voice because it shares the role's name.
	 */
	reset({
		profiles: [{ name: "aida", agent_id: null }],
		agents: [{ id: "9f2b1c7d-3e4f-4a5b-8c9d-0e1f2a3b4c5d", name: "aida" }],
	});
	await mod.fetchSpeechFor("aida", "Hello")();
	assert.deepEqual(
		globalThis.__speechCalls,
		[{ route: "agentless", body: { input: "Hello" } }],
		"the daemon's own map answers for its own role name; the registry is not consulted",
	);
	assert.deepEqual(
		globalThis.__catalogueCalls,
		[],
		"and no registry lookup is spent on the namesake",
	);
});

test("a conversation with no binding speaks through the agent-less route", async () => {
	reset();
	await mod.fetchSpeechFor(null, "Hello")();
	assert.deepEqual(
		globalThis.__profileCalls,
		[],
		"no binding: nothing to resolve, so nothing is looked up",
	);
	assert.deepEqual(
		globalThis.__speechCalls,
		[{ route: "agentless", body: { input: "Hello" } }],
		"the agent-less route needs no registry entry, and names no model and no voice",
	);
});

test("a binding the registry no longer holds fails over, and never prints the sentence", async () => {
	reset({ profiles: [], agents: [] });
	const audio = await mod.fetchSpeechFor("Deleted Agent", "Hello")();
	assert.deepEqual(
		globalThis.__speechCalls,
		[{ route: "agentless", body: { input: "Hello" } }],
		"a stale binding falls to the agent-less route rather than refusing to speak",
	);
	assert.equal(audio.size > 0, true, "and the reader still gets audio");
});

test("a daemon that cannot answer the lookups does not block the press", async () => {
	reset({ catalogueFails: true, profilesFail: true });
	await mod.fetchSpeechFor("aida", "Hello")();
	assert.deepEqual(
		globalThis.__speechCalls,
		[{ route: "agentless", body: { input: "Hello" } }],
		"the lookup is an optimisation, not a gate: an unreachable backend still speaks",
	);
});

/* ------------------------------------------------------ 3. the failover edge */

test("an id that went stale between the lookup and the call fails over", async () => {
	reset({ agentOutcome: new Error(mod.SPEECH_UNKNOWN_AGENT_COPY) });
	await mod.fetchSpeechFor("aida", "Hello")();
	assert.deepEqual(
		globalThis.__speechCalls.map((call) => call.route),
		["agent", "agentless"],
		"the agent route is tried with the resolved id, and the unknown-agent refusal falls over",
	);
});

test("a sentence that CONTAINS the unknown-agent copy is NOT that refusal", async () => {
	/*
	 * The matcher is EXACT on purpose, and this is the case that pins it: a refusal
	 * whose sentence merely carries the designed copy as a substring is a different
	 * failure, and retrying it would spend a request and hide the cause. A matcher
	 * loosened to `includes` fails over here and this test fails with it.
	 */
	reset({
		agentOutcome: new Error(`${mod.SPEECH_UNKNOWN_AGENT_COPY} (agent 42)`),
	});
	await assert.rejects(
		mod.fetchSpeechFor("aida", "Hello")(),
		(error) => error.message.startsWith(mod.SPEECH_UNKNOWN_AGENT_COPY),
		"a longer sentence that begins with the copy is not the copy",
	);
	assert.deepEqual(
		globalThis.__speechCalls.map((call) => call.route),
		["agent"],
		"and no second request is spent on it",
	);
});

test("every OTHER refusal propagates: a wrong target is the only thing retried", async () => {
	reset({
		agentOutcome: new Error("Your credit balance is too low for speech."),
	});
	await assert.rejects(
		mod.fetchSpeechFor("aida", "Hello")(),
		CREDIT_REFUSAL,
		"a credit gate reaches the toast unchanged",
	);
	assert.deepEqual(
		globalThis.__speechCalls.map((call) => call.route),
		["agent"],
		"and is not retried against a second route",
	);
});
