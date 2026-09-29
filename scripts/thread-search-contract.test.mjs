import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * `sessions.find`, FROM THE OP TO THE REQUEST THE CLIENT SENDS.
 *
 * Two halves, one file, because they are two views of the same contract:
 *
 *   1. THE WIRE SHAPE. The op is bounded at both ends (a 1..256-character
 *      query, a 1..200 limit, a session id that is an id and not a path), the
 *      route is a GET under the session's own path with the query percent-
 *      encoded, and the limit is always sent so the request does not depend on
 *      a route default this client cannot see.
 *   2. THE CLIENT'S ONE JOB. `findThreadMessages` trims and bounds the query
 *      before the schema can refuse it, clamps a caller's limit, and answers an
 *      empty query LOCALLY — the box's clear gesture must not spend a scan to
 *      be told nothing matches nothing.
 *
 * What is faked: the network (`desktopResult`), the same fixture shape
 * `attention-seen.test.mjs` uses. Everything else is the shipped module.
 */

/* ------------------------------------------------------------- contract */

const contractBundle = await build({
	stdin: {
		contents: 'export * from "./src/shared/desktop-contract";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const contract = await import(
	`data:text/javascript;base64,${Buffer.from(contractBundle.outputFiles[0].text).toString("base64")}`
);

const SESSION = "abcdef123456";

const findRequest = (over = {}) => ({
	op: "sessions.find",
	sessionId: SESSION,
	q: "ledger",
	...over,
});

const parses = (request) =>
	contract.desktopRequestSchema.safeParse(request).success;

test("the find op is bounded at both ends and closes its vocabulary", () => {
	assert.equal(parses(findRequest()), true);
	assert.equal(parses(findRequest({ limit: 1 })), true);
	assert.equal(parses(findRequest({ limit: 200 })), true);
	assert.equal(parses(findRequest({ q: "x".repeat(256) })), true);

	assert.equal(
		parses(findRequest({ q: "" })),
		false,
		"an empty query is not a search",
	);
	assert.equal(parses(findRequest({ q: "x".repeat(257) })), false);
	assert.equal(parses(findRequest({ limit: 0 })), false);
	assert.equal(parses(findRequest({ limit: 201 })), false);
	assert.equal(parses(findRequest({ limit: 1.5 })), false);
	assert.equal(
		parses(findRequest({ sessionId: "../config" })),
		false,
		"a session id reaches a route path and is an id, never a path fragment",
	);
	assert.equal(parses(findRequest({ extra: 1 })), false, "no stray fields");
	assert.equal(
		parses({ op: "sessions.find", sessionId: SESSION }),
		false,
		"the query is required",
	);
});

test("the find route is a GET with the query encoded, and the limit always rides along", () => {
	const endpoint = contract.desktopEndpoint(findRequest({ q: "a&b #c" }));
	assert.equal(endpoint.method, "GET");
	assert.equal(
		endpoint.path,
		`/v1/desktop/sessions/${SESSION}/find?q=a%26b+%23c&limit=100`,
		"`&`, `#` and spaces are data, not request syntax; the default limit is sent",
	);
	const bounded = contract.desktopEndpoint(findRequest({ limit: 25 }));
	assert.equal(
		bounded.path,
		`/v1/desktop/sessions/${SESSION}/find?q=ledger&limit=25`,
	);
});

/* --------------------------------------------------------------- client */

const clientBundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/thread-search-client";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "find-transport-fixture",
			setup(builder) {
				// Only the network is faked: the rest of the module graph stays
				// real, and `desktopResult` becomes this file's scripted backend.
				builder.onResolve({ filter: /desktop-api$/ }, () => ({
					path: "transport",
					namespace: "find-fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "find-fixture" }, () => ({
					contents:
						"export const desktopResult = (request) => globalThis.__findRequest(request);",
					loader: "js",
				}));
			},
		},
	],
});
const client = await import(
	`data:text/javascript;base64,${Buffer.from(clientBundle.outputFiles[0].text).toString("base64")}`
);

/** A scripted backend that records every request it is asked. */
function backend(answer) {
	const requests = [];
	globalThis.__findRequest = async (request) => {
		requests.push(request);
		return answer(request);
	};
	return requests;
}

const readyAnswer = (request) => ({
	query: request.q,
	state: "ready",
	partial: false,
	hits: [],
	truncated: false,
});

test("the client trims, bounds and sends exactly one typed request", async () => {
	const requests = backend(readyAnswer);
	await client.findThreadMessages({ sessionId: SESSION, query: "  ledger  " });
	assert.deepEqual(requests[0], {
		op: "sessions.find",
		sessionId: SESSION,
		q: "ledger",
		limit: 100,
	});

	await client.findThreadMessages({
		sessionId: SESSION,
		query: "x".repeat(300),
	});
	assert.equal(
		requests[1].q.length,
		256,
		"an over-long query is cut to the schema's bound rather than refused by it",
	);

	await client.findThreadMessages({
		sessionId: SESSION,
		query: "ok",
		limit: 999,
	});
	assert.equal(requests[2].limit, 200);
	await client.findThreadMessages({
		sessionId: SESSION,
		query: "ok",
		limit: 0,
	});
	assert.equal(requests[3].limit, 1);
});

test("an empty query is answered locally, without a request", async () => {
	const requests = backend(readyAnswer);
	const answer = await client.findThreadMessages({
		sessionId: SESSION,
		query: "   ",
	});
	assert.deepEqual(answer, {
		query: "",
		state: "ready",
		partial: false,
		hits: [],
		truncated: false,
	});
	assert.equal(
		requests.length,
		0,
		"nothing matches nothing, and nothing is spent to learn it",
	);
});

test("the answer crosses the client untouched — the wire is the backend's own shape", async () => {
	const hits = [
		{
			id: "m1",
			role: "user",
			ts: 1780000000,
			snippet: "the ledger was rebuilt",
			ranges: [[4, 10]],
			tier: "exact",
		},
	];
	const requests = backend(() => ({
		query: "ledger",
		state: "building",
		partial: true,
		hits,
		truncated: true,
	}));
	const answer = await client.findThreadMessages({
		sessionId: SESSION,
		query: "ledger",
	});
	assert.deepEqual(answer.hits, hits);
	assert.equal(answer.state, "building");
	assert.equal(answer.partial, true);
	assert.equal(answer.truncated, true);
	assert.equal(requests.length, 1);
});
