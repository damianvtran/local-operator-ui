/**
 * WHERE A SPEAK PRESS IS AIMED: the two routes, the fallback, and the refusals
 * that must NOT fall back.
 *
 * WHAT THIS FILE IS, exactly: `@shared/lib/speech-target`'s rule and
 * `speech-store`'s `fetchSpeechFor` chain, driven through the store's own public
 * factory with the desktop relay stubbed AT THE BOUNDARY THE APP USES IT
 * (`@shared/api/local-operator`'s client). The recorder sees which ROUTE a press
 * took and what body it carried, which is the whole subject: the operator's
 * report was a press that asked the daemon's agent registry for a SESSION, and
 * a test that only asserted "a request happened" would have passed through the
 * entire defect.
 *
 * THE THREE ARMS THE PRODUCT OWES, one per test below:
 *
 *   1. a bound conversation asks for its ROLE AGENT - the specific target, the
 *      one the daemon's voice selection runs on;
 *   2. a conversation with no binding takes the AGENT-LESS route and still
 *      speaks (the old gate made this arm impossible: `Boolean(agentId)` hid the
 *      control);
 *   3. a binding the registry no longer holds fails over to the agent-less
 *      route instead of printing the unknown-agent sentence - and every OTHER
 *      refusal propagates, because a credit gate or a rate limit is not a wrong
 *      target and retrying it would spend a request and hide the real cause.
 *
 * The refusal strings are read from the shipped module rather than typed here:
 * they are the contract with `local-operator`'s speech route (see
 * `speech-errors.ts`), and a copy in this file would keep passing after the real
 * one moved.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/* The regex literals this file uses, hoisted (`scripts/` is held to `useTopLevelRegex`). */
const CLIENT_MODULE = /@shared\/api\/local-operator$/;
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
/** What the agent route does next: a Blob by default, or an Error to reject with. */
globalThis.__agentOutcome = null;
/** What the agent-less route does next. */
globalThis.__agentlessOutcome = null;

const bundle = await build({
	stdin: {
		contents:
			'export { speechAgentForRow } from "./src/renderer/src/shared/lib/speech-target";\n' +
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
				builder.onResolve({ filter: CLIENT_MODULE }, () => ({
					path: "client",
					namespace: "fixture",
				}));
				builder.onLoad(
					{ filter: ANY_SPECIFIER, namespace: "fixture" },
					(args) => {
						if (args.path === "config") {
							return {
								loader: "js",
								contents:
									'export const apiConfig = { baseUrl: "http://127.0.0.1:45998" };\n',
							};
						}
						return {
							loader: "js",
							contents: `
							const calls = () => (globalThis.__speechCalls ??= []);
							const settle = (kind, recorded, audio) => {
								calls().push(recorded);
								const outcome = kind === "agent" ? globalThis.__agentOutcome : globalThis.__agentlessOutcome;
								if (outcome instanceof Error) return Promise.reject(outcome);
								return Promise.resolve(new Blob([audio]));
							};
							export const createLocalOperatorClient = () => ({
								speech: {
									createForAgent: (agentId, request) =>
										settle("agent", { route: "agent", agentId, body: request }, "agent-audio"),
									create: (request) =>
										settle("agentless", { route: "agentless", body: request }, "agentless-audio"),
								},
							});
						`,
						};
					},
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

const { fetchSpeechFor, speechAgentForRow, SPEECH_UNKNOWN_AGENT_COPY } = mod;

const calls = () => globalThis.__speechCalls;
const reset = () => {
	globalThis.__speechCalls = [];
	globalThis.__agentOutcome = null;
	globalThis.__agentlessOutcome = null;
};

/* -------------------------------------------------- the row's binding rule */

test("the binding is the target, and an empty one is no binding at all", () => {
	assert.equal(
		speechAgentForRow({
			binding: { agent: "c4fd6f8d-0000-4000-8000-000000000000" },
		}),
		"c4fd6f8d-0000-4000-8000-000000000000",
		"a bound conversation aims at its role agent",
	);
	/*
	 * THE EMPTY STRING IS THE SHAPE THIS RULE EXISTS FOR: the daemon writes `""`
	 * for "no agent" on a team-bound session, and a truthiness test would pass it
	 * through into `/v1/agents//speech`.
	 */
	assert.equal(
		speechAgentForRow({ binding: { agent: "", team: "lopdev" } }),
		null,
		"an empty agent is no agent",
	);
	assert.equal(speechAgentForRow({ binding: { agent: null } }), null);
	assert.equal(speechAgentForRow({ binding: null }), null);
	assert.equal(speechAgentForRow(undefined), null, "no catalogue row yet");
});

/* ------------------------------------------------------------- the routes */

test("a bound conversation asks the AGENT route, and only that route", async () => {
	reset();
	const audio = await fetchSpeechFor("agent-1", "the words")();
	assert.equal(audio instanceof Blob, true);
	assert.deepEqual(
		calls().map((call) => call.route),
		["agent"],
		"one request, on the agent route",
	);
	assert.equal(calls()[0].agentId, "agent-1");
	assert.deepEqual(
		calls()[0].body,
		{ input_text: "the words" },
		"the agent route's own body shape",
	);
});

test("a conversation with no binding speaks through the agent-less route", async () => {
	reset();
	const audio = await fetchSpeechFor(null, "the words")();
	assert.equal(audio instanceof Blob, true);
	assert.deepEqual(
		calls().map((call) => call.route),
		["agentless"],
	);
	/*
	 * NEITHER A MODEL NOR A VOICE IS INVENTED CLIENT-SIDE. The daemon owns both
	 * on this route (its client omits them when a caller named none, and the
	 * `speech.voice.*` settings govern), so a fallback that named one would pin
	 * the product to a vendor's roster.
	 */
	assert.deepEqual(
		calls()[0].body,
		{ input: "the words" },
		"the agent-less body names the text and nothing else",
	);
});

test("a STALE binding falls over to the agent-less route, not to the sentence", async () => {
	reset();
	globalThis.__agentOutcome = new Error(SPEECH_UNKNOWN_AGENT_COPY);
	const audio = await fetchSpeechFor("agent-that-was-deleted", "the words")();
	assert.equal(
		audio instanceof Blob,
		true,
		"the press still speaks: the reader asked to hear the conversation, not for a registry hit",
	);
	assert.deepEqual(
		calls().map((call) => call.route),
		["agent", "agentless"],
		"it tried the specific target, then the one that needs no registry entry",
	);
});

test("every OTHER refusal propagates: a wrong target is the only thing retried", async () => {
	reset();
	globalThis.__agentOutcome = new Error(
		"Your Radient credit balance is too low for speech. Add credits in the Radient Console to continue.",
	);
	await assert.rejects(
		fetchSpeechFor("agent-1", "the words")(),
		CREDIT_REFUSAL,
		"the daemon's own refusal reaches the toast unchanged",
	);
	assert.deepEqual(
		calls().map((call) => call.route),
		["agent"],
		"and no second request was spent to discover that",
	);
});
