import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";

// Bundle in memory so this regression guard uses the shipped TS paths without
// adding a second app build, dependency tree, or permanent generated fixture.
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/main/desktop-transport"; export * from "./src/main/desktop-ipc"; export * from "./src/main/viewer-record"; export * from "./src/main/picker-directory"; export {desktopRequestByteBudget, desktopRequestDeadlineMs, desktopRequestDeadlineDetail, DESKTOP_DEADLINE_EXCEEDED_CODE, MAX_DESKTOP_REQUEST_BYTES, MAX_DESKTOP_ENVELOPE_BYTES, MAX_DESKTOP_ENVELOPE_OVERHEAD_BYTES, DESKTOP_REQUEST_TOO_LARGE_DETAIL} from "./src/shared/desktop-contract";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "electron-fixture",
			setup(builder) {
				builder.onResolve({ filter: /^electron$/ }, () => ({
					path: "electron",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					contents: `
			export const ipcMain = { handle: (name, handler) => globalThis.__desktopHandlers.set(name, handler) };
			export const shell = { openExternal: async (url) => { globalThis.__desktopOpens.push(url); } };
		`,
					loader: "js",
				}));
			},
		},
	],
});
const {
	ViewerRecordPublisher,
	requestDesktop,
	requestDesktopOutcome,
	trustedDesktopFrame,
	registerDesktopIPC,
	guardForegroundReceipts,
	rememberPickedDirectory,
	withRememberedDirectory,
	desktopRequestByteBudget,
	desktopRequestDeadlineMs,
	desktopRequestDeadlineDetail,
	DESKTOP_DEADLINE_EXCEEDED_CODE,
	MAX_DESKTOP_REQUEST_BYTES,
	MAX_DESKTOP_ENVELOPE_BYTES,
	MAX_DESKTOP_ENVELOPE_OVERHEAD_BYTES,
	DESKTOP_REQUEST_TOO_LARGE_DETAIL,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
let server;
let url;
const seen = [];
const token = "synthetic-main-process-token";
before(async () => {
	server = createServer(async (req, res) => {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		seen.push({
			path: req.url,
			method: req.method,
			authorization: req.headers.authorization,
			body: Buffer.concat(chunks).toString(),
		});
		if (req.url === "/v1/settings/redirect") {
			res.writeHead(302, { Location: `${url}/stolen` });
			res.end();
			return;
		}
		/*
		 * The backend's store-failure ladder, at the boundary this hop exists to
		 * cross.
		 *
		 * A CODED error body on a non-2xx status has to arrive intact, because the
		 * renderer classifies the send from `detail.code` and renders `detail.message`
		 * verbatim: a hop that parsed a body only for 2xx would turn an out-of-space
		 * 507 into "the backend could not complete this request", and the composer's
		 * retry hint would be the only advice on screen - which is the incident this
		 * ladder was split for.
		 *
		 * Keyed on the session id so no other case in this file changes shape, and it
		 * uses the statuses and codes the backend's error ladder raises
		 * (`store_busy` 503, `store_out_of_space` 507, `store_unavailable` 500).
		 */
		const storeFailure = {
			503503503503: [
				503,
				"store_busy",
				"Read state is busy right now. It will catch up on its own.",
			],
			507507507507: [
				507,
				"store_out_of_space",
				"There is not enough space on this disk to save your message. Free up space, then send it again.",
			],
			500500500500: [
				500,
				"store_unavailable",
				"This chat's stored state could not be read or written. Retrying will not help; check this machine's storage and its logs.",
			],
		}[req.url.match(/\/sessions\/([a-f0-9]{12})\/messages/)?.[1]];
		if (storeFailure) {
			const [status, code, message] = storeFailure;
			res.writeHead(status, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ detail: { code, message } }));
			return;
		}
		res.setHeader("Content-Type", "application/json");
		res.end(
			JSON.stringify({
				result:
					req.url === "/v1/capabilities"
						? {
								desktop_available: true,
								features: { auth: 1, settings: 1 },
							}
						: { saved: true },
			}),
		);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
	await new Promise((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
});

test("real HTTP receives only allowlisted route and main-owned bearer", async () => {
	const response = await requestDesktop(
		{ op: "auth.key", provider: "openai", value: "synthetic-provider-key" },
		url,
		token,
	);
	assert.equal(response.status, 200);
	const last = seen.at(-1);
	assert.equal(last.path, "/v1/auth/providers/openai/key");
	assert.equal(last.method, "PUT");
	assert.equal(last.authorization, `Bearer ${token}`);
	assert.deepEqual(JSON.parse(last.body), { value: "synthetic-provider-key" });
	assert.ok(!JSON.stringify(response).includes(token));
});

test("unpaired desktop fails closed but public negotiation explains unavailable controls", async () => {
	assert.equal(
		(await requestDesktop({ op: "settings.list" }, url, null)).status,
		503,
	);
	const response = await requestDesktop({ op: "capabilities" }, url, null);
	assert.equal(response.body.result.desktop_available, false);
});

test("a store-failure envelope crosses this hop with its status, code and sentence intact", async () => {
	const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
	/*
	 * The renderer reads the send's category off `detail.code` and shows
	 * `detail.message` as the sentence, so the three store arms of the backend's
	 * error ladder have to survive this hop whole - on 507 and 500 as much as on
	 * the 503 the composer used to see for all of them. Measured through real
	 * loopback HTTP, not a stubbed `fetch`: the assertion is about what MAIN hands
	 * the renderer after a non-2xx status.
	 */
	for (const [sessionId, status, code] of [
		["503503503503", 503, "store_busy"],
		["507507507507", 507, "store_out_of_space"],
		["500500500500", 500, "store_unavailable"],
	]) {
		const response = await requestDesktop(
			{
				op: "sessions.message",
				sessionId,
				requestId,
				text: "look at this screenshot",
			},
			url,
			token,
		);
		assert.equal(response.status, status);
		assert.equal(response.body.detail.code, code);
		// The sentence is the backend's own, untouched: it names the volume and the
		// remedy, which is a fact only the process that touched the store has.
		assert.match(response.body.detail.message, /\S/);
		assert.equal(
			response.body.detail.message.startsWith("The backend could not"),
			false,
			"a classified store failure must not arrive as the transport's generic sentence",
		);
	}
});

test("arbitrary URL, injected headers, path traversal and wrong body types never reach HTTP", async () => {
	const count = seen.length;
	for (const request of [
		{ op: "fetch", url: "https://evil.example" },
		{ op: "auth.key", provider: "../config", value: "secret" },
		{
			op: "auth.key",
			provider: "openai",
			value: "secret",
			headers: { Authorization: "bad" },
		},
		{ op: "config.update", value: { arbitrary_secret: "not-allowed" } },
		{ op: "auth.input", id: "id", value: "secret" },
	]) {
		const response = await requestDesktop(request, url, token);
		assert.equal(response.status, 422);
		assert.ok(!JSON.stringify(response).includes("secret"));
	}
	assert.equal(seen.length, count);
});

test("canonical session operations preserve identity, arguments and main-owned authorization", async () => {
	const sessionId = "123456abcdef";
	const childId = "fedcba987654";
	const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
	for (const [operation, suffix, method, expected] of [
		[
			{ op: "sessions.create", requestId, cwd: "/tmp/example" },
			"",
			"POST",
			{ request_id: requestId, cwd: "/tmp/example" },
		],
		[{ op: "sessions.get", sessionId }, `/${sessionId}`, "GET", undefined],
		[
			{
				op: "sessions.search",
				q: "retention sweep",
				limit: 25,
			},
			"/search?q=retention+sweep&limit=25",
			"GET",
			undefined,
		],
		[
			{
				op: "sessions.message",
				sessionId,
				requestId,
				text: "hello",
				mode: "steer",
			},
			`/${sessionId}/messages`,
			"POST",
			{ request_id: requestId, text: "hello", images: [], mode: "steer" },
		],
		[
			{
				op: "sessions.command",
				sessionId,
				requestId,
				command: "goal",
				args: "Keep one identity",
			},
			`/${sessionId}/commands`,
			"POST",
			{
				request_id: requestId,
				command: "goal",
				args: "Keep one identity",
				images: [],
			},
		],
		[
			{
				op: "sessions.answer",
				sessionId,
				requestId: "gate-id",
				epoch: "owner-epoch",
				approved: false,
			},
			`/${sessionId}/answers`,
			"POST",
			{ request_id: "gate-id", epoch: "owner-epoch", approved: false },
		],
		/*
		 * The run panel's reader. It is the newest read on this surface and it
		 * had NO unit pin: `grep -rn 'subagents.transcript' scripts/` was empty,
		 * so the op's endpoint mapping and the two ids it validates rested on a
		 * story frame whose page came out of a fixture seam. The mapping is
		 * asserted here through the REAL transport (the request is issued and the
		 * path is read off the wire), and the query string is part of it: the
		 * cursor is `before_id` — an entry id, not an offset — and the row cap
		 * defaults to the parent's own 100.
		 */
		[
			{ op: "subagents.transcript", sessionId, childId },
			`/${sessionId}/children/${childId}/transcript?limit=100`,
			"GET",
			undefined,
		],
		[
			{
				op: "subagents.transcript",
				sessionId,
				childId,
				beforeId: "entry-abc",
				limit: 25,
			},
			`/${sessionId}/children/${childId}/transcript?limit=25&before_id=entry-abc`,
			"GET",
			undefined,
		],
		[
			{
				op: "sessions.watch",
				sessionId,
				subscriptionId: "a".repeat(32),
				visible: false,
				canNotify: true,
			},
			`/${sessionId}/watch`,
			"POST",
			{ subscription_id: "a".repeat(32), visible: false, can_notify: true },
		],
		[
			{
				op: "sessions.seen",
				sessionId,
				completionToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
			},
			`/${sessionId}/seen`,
			"POST",
			{ completion_token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
		],
	]) {
		assert.equal((await requestDesktop(operation, url, token)).status, 200);
		const actual = seen.at(-1);
		assert.equal(actual.path, `/v1/desktop/sessions${suffix}`);
		assert.equal(actual.method, method);
		assert.equal(actual.authorization, `Bearer ${token}`);
		assert.deepEqual(
			actual.body ? JSON.parse(actual.body) : undefined,
			expected,
		);
	}
	const count = seen.length;
	for (const input of [
		{ op: "sessions.get", sessionId: "../config" },
		{
			op: "sessions.message",
			sessionId,
			requestId: "not-a-uuid",
			text: "hello",
		},
		{ op: "sessions.command", sessionId, requestId, command: "goal extra" },
		// A search carries a query and nothing else: no query at all is not a
		// search of everything, and a query longer than the backend's own bound is
		// refused here rather than by the backend's generic "invalid fields".
		{ op: "sessions.search" },
		// An EMPTY query is refused by name too. The backend answers one by listing
		// the whole store (the phone's web client asks for exactly that), but this
		// surface already holds that list — its box is a filter over the catalogue —
		// so an empty `q` would ask the server to send back everything the client
		// has (review round 1, R5).
		{ op: "sessions.search", q: "" },
		{ op: "sessions.search", q: "x".repeat(257) },
		{ op: "sessions.search", q: "ok", limit: 501 },
		{
			op: "sessions.search",
			q: "ok",
			sessionId,
		},
		// A receipt carries a completion token and nothing else: a timestamp or a
		// bodyless call is what let a background tab acknowledge an unseen result.
		{ op: "sessions.seen", sessionId },
		{ op: "sessions.seen", sessionId, completionToken: "now" },
		{
			op: "sessions.seen",
			sessionId: "../config",
			completionToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
		},
		{
			op: "sessions.seen",
			sessionId,
			completionToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
			seenAt: 123,
		},
		{
			op: "sessions.watch",
			sessionId,
			subscriptionId: "a".repeat(32),
			visible: "true",
			canNotify: true,
		},
		/*
		 * The reader's own containment, refused before any HTTP. Neither id is a
		 * path and neither may be shaped like one: the route resolves the child
		 * directory from the ids and the parent's roster, so a traversal that
		 * reached `endpoint()` would be renderer-controlled path text. The cursor
		 * is bounded like every other entry id (128 chars), and an unknown field
		 * is refused rather than ignored.
		 */
		{ op: "subagents.transcript", sessionId, childId: "../config" },
		{ op: "subagents.transcript", sessionId: "../config", childId },
		{ op: "subagents.transcript", sessionId, childId, limit: 501 },
		{ op: "subagents.transcript", sessionId, childId, limit: 0 },
		{
			op: "subagents.transcript",
			sessionId,
			childId,
			beforeId: "e".repeat(129),
		},
		{ op: "subagents.transcript", sessionId, childId, path: "/etc/passwd" },
	])
		assert.equal((await requestDesktop(input, url, token)).status, 422);
	assert.equal(seen.length, count);
});

test("gated legacy reads travel the authenticated contract, not a bare fetch", async () => {
	// These routes are gated in managed mode (agent inventory, cwd paths, job
	// history and conversation content are the same tenant's data as the
	// control plane), so the renderer's old bare `fetch` 401s against exactly
	// the backend this app starts. Each must reach its real path, carry the
	// main-owned bearer, and preserve the arguments the previous URL builder
	// put in the query string.
	const agentId = "fixture-agent";
	for (const [operation, path, method] of [
		[
			{ op: "legacy.agents.list", page: 2, perPage: 25 },
			"/v1/agents?page=2&per_page=25",
			"GET",
		],
		[
			{
				op: "legacy.agents.list",
				page: 1,
				perPage: 10,
				name: "qa",
				direction: "desc",
			},
			"/v1/agents?page=1&per_page=10&name=qa&direction=desc",
			"GET",
		],
		[{ op: "legacy.agent.get", agentId }, `/v1/agents/${agentId}`, "GET"],
		[
			{ op: "legacy.agent.history", agentId, page: 3, perPage: 50 },
			`/v1/agents/${agentId}/history?page=3&per_page=50`,
			"GET",
		],
		[{ op: "legacy.jobs.list" }, "/v1/jobs", "GET"],
		[
			{ op: "legacy.jobs.list", agentId, status: "running" },
			`/v1/jobs?agent_id=${agentId}&status=running`,
			"GET",
		],
		[{ op: "legacy.job.get", jobId: "job-1" }, "/v1/jobs/job-1", "GET"],
		[{ op: "legacy.models.providers" }, "/v1/models/providers", "GET"],
		// The provider/sort/direction the model list actually builds. Dropping
		// them would silently widen every filtered list to the whole catalogue.
		[
			{
				op: "legacy.models",
				provider: "openai",
				sort: "name",
				direction: "ascending",
			},
			"/v1/models?provider=openai&sort=name&direction=ascending",
			"GET",
		],
		[
			{ op: "auth.probe", provider: "ollama" },
			"/v1/auth/providers/ollama/probe",
			"POST",
		],
	]) {
		assert.equal((await requestDesktop(operation, url, token)).status, 200);
		const actual = seen.at(-1);
		assert.equal(actual.path, path);
		assert.equal(actual.method, method);
		assert.equal(actual.authorization, `Bearer ${token}`);
	}

	// The vocabulary stays closed: no traversal, no invented sort key, no
	// renderer-supplied URL.
	const count = seen.length;
	for (const input of [
		{ op: "legacy.agent.get", agentId: "../config" },
		{ op: "legacy.job.get", jobId: "../../etc/passwd" },
		{ op: "legacy.models", sort: "; drop" },
		{ op: "legacy.models", direction: "sideways" },
		{ op: "legacy.agents.list", perPage: 10000 },
		{ op: "auth.probe", provider: "../config" },
	])
		assert.equal((await requestDesktop(input, url, token)).status, 422);
	assert.equal(seen.length, count);
});

test("the schedules surface travels the authenticated contract with its body intact", async () => {
	// Review round 3 reproduced an unauthenticated cross-origin POST that
	// persisted an ACTIVE schedule -- a prompt the user's own agent later runs.
	// The whole family is gated now, so every one of these must carry the
	// main-owned bearer, and the write bodies must arrive unmangled: a dropped
	// `is_active` or `interval` silently reschedules the user's automation.
	const agentId = "fixture-agent";
	const scheduleId = "fixture-schedule";
	const create = {
		prompt: "summarize my inbox",
		interval: 30,
		unit: "minutes",
		is_active: true,
		one_time: false,
	};
	for (const [operation, path, method, body] of [
		[
			{ op: "legacy.schedules.list", page: 2, perPage: 25 },
			"/v1/schedules?page=2&per_page=25",
			"GET",
		],
		[
			{ op: "legacy.agent.schedules.list", agentId, page: 1, perPage: 10 },
			`/v1/agents/${agentId}/schedules?page=1&per_page=10`,
			"GET",
		],
		[
			{ op: "legacy.agent.schedule.create", agentId, schedule: create },
			`/v1/agents/${agentId}/schedules`,
			"POST",
			create,
		],
		[
			{ op: "legacy.schedule.get", scheduleId },
			`/v1/schedules/${scheduleId}`,
			"GET",
		],
		[
			{
				op: "legacy.schedule.edit",
				scheduleId,
				schedule: { prompt: "changed", is_active: false },
			},
			`/v1/schedules/${scheduleId}`,
			"PATCH",
			{ prompt: "changed", is_active: false },
		],
		[
			{ op: "legacy.schedule.remove", scheduleId },
			`/v1/schedules/${scheduleId}`,
			"DELETE",
		],
	]) {
		assert.equal((await requestDesktop(operation, url, token)).status, 200);
		const actual = seen.at(-1);
		assert.equal(actual.path, path);
		assert.equal(actual.method, method);
		assert.equal(actual.authorization, `Bearer ${token}`);
		if (body) assert.deepEqual(JSON.parse(actual.body), body);
	}

	// The vocabulary stays closed here too: no traversal through a schedule id,
	// no unit the backend enum does not have, no extra key smuggled into a body
	// the server would accept.
	const count = seen.length;
	for (const input of [
		{ op: "legacy.schedule.get", scheduleId: "../../v1/config" },
		{
			op: "legacy.agent.schedule.create",
			agentId: "../config",
			schedule: create,
		},
		{
			op: "legacy.agent.schedule.create",
			agentId,
			schedule: { ...create, unit: "fortnights" },
		},
		{
			op: "legacy.agent.schedule.create",
			agentId,
			schedule: { ...create, agent_id: "someone-else" },
		},
		{
			op: "legacy.agent.schedule.create",
			agentId,
			schedule: { prompt: "no interval" },
		},
		{ op: "legacy.schedules.list", perPage: 10000 },
	])
		assert.equal((await requestDesktop(input, url, token)).status, 422);
	assert.equal(seen.length, count);
});

test("every remaining gated legacy call travels the contract, not a bare fetch", async () => {
	// `apiConfig.baseUrl` points AT THE BACKEND, so these did not pass through
	// the main-process relay at all: in managed mode they went out with no
	// bearer and 401'd. QA clicked "New agent" in the live app and got 401
	// (review round 3, Q7). Each must now reach its real path and method with
	// the main-owned bearer, and the write bodies must arrive unmangled.
	const agentId = "fixture-agent";
	const agent = { name: "new agent", security_prompt: "be careful" };
	for (const [operation, path, method, body] of [
		[{ op: "legacy.agent.create", agent }, "/v1/agents", "POST", agent],
		[
			{ op: "legacy.agent.update", agentId, update: { name: "renamed" } },
			`/v1/agents/${agentId}`,
			"PATCH",
			{ name: "renamed" },
		],
		[{ op: "legacy.agent.delete", agentId }, `/v1/agents/${agentId}`, "DELETE"],
		[
			{ op: "legacy.agent.conversation.clear", agentId },
			`/v1/agents/${agentId}/conversation`,
			"DELETE",
		],
		[
			{ op: "legacy.agent.systemPrompt.get", agentId },
			`/v1/agents/${agentId}/system-prompt`,
			"GET",
		],
		[
			{
				op: "legacy.agent.systemPrompt.update",
				agentId,
				systemPrompt: "be terse",
			},
			`/v1/agents/${agentId}/system-prompt`,
			"PUT",
			{ system_prompt: "be terse" },
		],
		[
			{ op: "legacy.agent.download", agentId },
			`/v1/agents/${agentId}/download`,
			"GET",
		],
		[{ op: "legacy.job.cancel", jobId: "job-1" }, "/v1/jobs/job-1", "DELETE"],
	]) {
		assert.equal((await requestDesktop(operation, url, token)).status, 200);
		const actual = seen.at(-1);
		assert.equal(actual.path, path);
		assert.equal(actual.method, method);
		assert.equal(actual.authorization, `Bearer ${token}`);
		if (body) assert.deepEqual(JSON.parse(actual.body), body);
	}

	/*
	 * The legacy agent-variable ops are GONE from the vocabulary, not merely
	 * unused. The code-memory panel was their only consumer, and a
	 * familiar-looking call is how the bug comes back: a session id sent to
	 * `/v1/agents/{id}/execution-variables` can only 404, because that route
	 * resolves agent-directory UUIDs. Refusing the op at the contract is what
	 * makes that mistake impossible rather than merely unlikely.
	 */
	const count = seen.length;
	for (const input of [
		{ op: "legacy.agent.variables.list", agentId },
		{ op: "legacy.agent.variables.get", agentId, key: "API_TOKEN" },
		{
			op: "legacy.agent.variables.delete",
			agentId,
			key: "../../../v1/credentials",
		},
		{ op: "legacy.agent.update", agentId: "../config", update: {} },
		{ op: "legacy.job.cancel", jobId: "../agents" },
		{ op: "legacy.agent.create", agent: {}, extra: "smuggled" },
	])
		assert.equal((await requestDesktop(input, url, token)).status, 422);
	assert.equal(seen.length, count);
});

test("control catalogues, lifecycle, MCP and Radient use closed main-owned transport", async () => {
	const sessionId = "123456abcdef";
	const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
	for (const [operation, path, method] of [
		[{ op: "legacy.models" }, "/v1/models", "GET"],
		[
			{ op: "legacy.agent.upload", agentId: "fixture-agent" },
			"/v1/agents/fixture-agent/upload",
			"POST",
		],
		[{ op: "commands.list" }, "/v1/desktop/commands", "GET"],
		[
			{ op: "commands.entities", sessionId, command: "team", name: "test" },
			`/v1/desktop/sessions/${sessionId}/command-entities?command=team&name=test`,
			"GET",
		],
		[
			{ op: "models.catalogue", live: true },
			"/v1/desktop/models?live=true",
			"GET",
		],
		[
			{ op: "usage.get", provider: "openai", live: true },
			"/v1/desktop/usage?live=true&refresh=false&provider=openai",
			"GET",
		],
		[
			{ op: "analytics.get", sessionId, days: 7 },
			`/v1/desktop/analytics?days=7&session_id=${sessionId}`,
			"GET",
		],
		/*
		 * The two diagnostics reads, and the reason they are here rather than in a
		 * test of their own: the map is one switch, and an op that reaches the
		 * wrong PATH is the failure mode this table exists to catch — a panel
		 * asking `/v1/desktop/sessions/{id}/report` of a backend that serves it at
		 * another path shows a 404 as "unavailable", which reads as a broken
		 * backend rather than a wrong URL.
		 */
		[{ op: "info.get" }, "/v1/desktop/info", "GET"],
		[
			{ op: "sessions.report", sessionId, recentLimit: 25 },
			`/v1/desktop/sessions/${sessionId}/report?recent_limit=25`,
			"GET",
		],
		[
			{ op: "skills.list", sessionId, name: "fixture" },
			`/v1/desktop/skills?session_id=${sessionId}&name=fixture`,
			"GET",
		],
		[
			{ op: "sessions.failovers", sessionId },
			`/v1/desktop/sessions/${sessionId}/failovers`,
			"GET",
		],
		[
			{ op: "sessions.variables.list", sessionId },
			`/v1/desktop/sessions/${sessionId}/variables`,
			"GET",
		],
		[
			{
				op: "sessions.credential",
				sessionId,
				action: "store",
				key: "TEST_KEY",
				value: "fixture-secret",
			},
			`/v1/desktop/sessions/${sessionId}/credentials`,
			"POST",
		],
		[
			{ op: "sessions.fork", sessionId, requestId, message: "Continue" },
			`/v1/desktop/sessions/${sessionId}/fork`,
			"POST",
		],
		[
			{ op: "sessions.stop", requestId, targets: [sessionId], confirmed: true },
			"/v1/desktop/stop",
			"POST",
		],
		[
			{ op: "sessions.aside", sessionId, requestId, text: "Question" },
			`/v1/desktop/sessions/${sessionId}/asides`,
			"POST",
		],
		[
			{
				op: "sessions.adopt",
				sessionId,
				requestId,
				asideId: requestId,
				confirmed: true,
			},
			`/v1/desktop/sessions/${sessionId}/asides/${requestId}/adopt`,
			"POST",
		],
		[
			{ op: "mcp.list", sessionId },
			`/v1/desktop/sessions/${sessionId}/mcp`,
			"GET",
		],
		[
			{
				op: "mcp.control",
				sessionId,
				control: {
					action: "add",
					name: "plugin:fixture",
					command: "fixture",
					args: ["two words"],
					env: { TOKEN: "${TOKEN}" },
				},
			},
			`/v1/desktop/sessions/${sessionId}/mcp`,
			"POST",
		],
		[
			{ op: "radient.request", control: { operation: "account" } },
			"/v1/desktop/radient",
			"POST",
		],
		[
			{ op: "accounts.remove", accountId: 1, confirmed: true },
			"/v1/auth/accounts/1",
			"DELETE",
		],
	]) {
		const response = await requestDesktop(operation, url, token);
		assert.equal(response.status, 200);
		const actual = seen.at(-1);
		assert.equal(actual.path, path);
		assert.equal(actual.method, method);
		assert.equal(actual.authorization, `Bearer ${token}`);
		assert.ok(!actual.path.includes("fixture-secret"));
		assert.ok(!JSON.stringify(response).includes("fixture-secret"));
		if (operation.control)
			assert.deepEqual(JSON.parse(actual.body), operation.control);
	}
	/*
	 * Code memory's write half, compared by BODY rather than by path alone:
	 * create carries the key, update deliberately does not (once the name
	 * exists it is immutable and travels in the path), and the body shape is the
	 * route's own `{key, value, type}` / `{value, type}`. The key below has a
	 * space in it on purpose - a Python name is not the only legal key
	 * (`globals()["outstanding total"] = 1` is memory like any other), so the
	 * path must percent-encode it rather than the renderer refusing to address
	 * a name the panel lists.
	 */
	const codeMemoryKey = "outstanding total";
	for (const [operation, path, method, body] of [
		[
			{
				op: "sessions.variables.create",
				sessionId,
				key: codeMemoryKey,
				value: "7",
				type: "int",
			},
			`/v1/desktop/sessions/${sessionId}/variables`,
			"POST",
			{ key: codeMemoryKey, value: "7", type: "int" },
		],
		[
			{
				op: "sessions.variables.update",
				sessionId,
				key: codeMemoryKey,
				value: "{'a': 1}",
				type: "dict",
			},
			`/v1/desktop/sessions/${sessionId}/variables/outstanding%20total`,
			"PATCH",
			{ value: "{'a': 1}", type: "dict" },
		],
		[
			{ op: "sessions.variables.delete", sessionId, key: codeMemoryKey },
			`/v1/desktop/sessions/${sessionId}/variables/outstanding%20total`,
			"DELETE",
		],
	]) {
		assert.equal((await requestDesktop(operation, url, token)).status, 200);
		const actual = seen.at(-1);
		assert.equal(actual.path, path);
		assert.equal(actual.method, method);
		assert.equal(actual.authorization, `Bearer ${token}`);
		if (body) assert.deepEqual(JSON.parse(actual.body), body);
	}

	/*
	 * A key that could address another route, and a type outside the six-name
	 * table, are both refused BEFORE the transport: the key becomes a path
	 * segment, and the type selects the worker's coercion - neither is a value
	 * to guess at.
	 */
	const beforeRefusals = seen.length;
	for (const operation of [
		{ op: "sessions.variables.delete", sessionId, key: "../../v1/credentials" },
		{
			op: "sessions.variables.update",
			sessionId,
			key: "a/b",
			value: "1",
			type: "int",
		},
		{
			op: "sessions.variables.create",
			sessionId,
			key: "x",
			value: "1",
			type: "string",
		},
		{ op: "sessions.variables.list", sessionId: "not-a-session" },
	]) {
		assert.equal((await requestDesktop(operation, url, token)).status, 422);
	}
	assert.equal(seen.length, beforeRefusals);
	const count = seen.length;

	for (const operation of [
		{ op: "sessions.stop", requestId, targets: [sessionId], confirmed: false },
		{
			op: "mcp.control",
			sessionId,
			control: {
				action: "add",
				name: "test",
				command: "fixture",
				env: { TOKEN: "fixture-secret" },
			},
		},
		{
			op: "mcp.control",
			sessionId,
			control: { action: "fetch", url: "https://example.org" },
		},
		{ op: "radient.request", control: { operation: "tokens.get" } },
		{
			op: "radient.request",
			control: {
				operation: "account",
				headers: { Authorization: "fixture-secret" },
			},
		},
		{ op: "accounts.remove", accountId: 1, confirmed: false },
	]) {
		const response = await requestDesktop(operation, url, token);
		assert.equal(response.status, 422);
		assert.ok(!JSON.stringify(response).includes("fixture-secret"));
	}
	assert.equal(seen.length, count);
});

test("redirect cannot forward the main capability", async () => {
	const response = await requestDesktop(
		{ op: "settings.edit", key: "redirect", value: true },
		url,
		token,
	);
	assert.equal(response.status, 503);
	assert.ok(!seen.some((request) => request.path === "/stolen"));
});

test("sender URL allows only packaged file or exact dev origin", () => {
	assert.ok(
		trustedDesktopFrame(
			"file:///app/index.html#/settings",
			"file:///app/index.html",
		),
	);
	assert.ok(
		!trustedDesktopFrame("file:///app/other.html", "file:///app/index.html"),
	);
	assert.ok(
		!trustedDesktopFrame("https://evil.example", "http://localhost:5187"),
	);
	assert.ok(
		!trustedDesktopFrame("http://localhost:5188", "http://localhost:5187"),
	);
});

test("a watch release withdraws the record's conversation, so a later click switches instead of raising", async () => {
	/*
	 * QA ROUND 2, Q1 — the entry point the renderer actually uses.
	 *
	 * The presence withdrawal (R2-4) and the routing record are two answers to two
	 * questions, and only the first was being cleared: a click after navigating away
	 * from A found the record still naming A, was answered with a raise, and because
	 * that branch reports success no later rung of the ladder was tried. So this
	 * drives the real handler with the real publisher and then reads the FILE the
	 * backend's `lop resume-click` reads, because the file is what the click routes on.
	 */
	globalThis.__desktopHandlers = new Map();
	const frame = { url: "file:///app/index.html" };
	const contents = { mainFrame: frame };
	const owner = { webContents: contents, isDestroyed: () => false };
	const released = [];
	const dir = mkdtempSync(join(tmpdir(), "viewer-release-"));
	const publisher = new ViewerRecordPublisher(dir, 4249);
	publisher.setControlPort(1);
	publisher.start();
	publisher.noteSession("conversation-a");
	assert.equal(
		JSON.parse(readFileSync(join(dir, "4249.json"), "utf8")).current_session,
		"conversation-a",
	);
	registerDesktopIPC(
		() => owner,
		"file:///app/index.html",
		async () => ({ status: 200, body: { result: {} } }),
		undefined,
		undefined,
		{
			releaseWatch: (windowId, sessionId) =>
				released.push([windowId, sessionId]),
		},
		(sessionId) => {
			released.push(["record", sessionId]);
			publisher.releaseSession(sessionId);
		},
	);
	await globalThis.__desktopHandlers.get("desktop-watch-release")(
		{ sender: contents, senderFrame: frame },
		{ sessionId: "conversation-a" },
	);
	assert.deepEqual(
		released,
		[
			[contents.id, "conversation-a"],
			["record", "conversation-a"],
		],
		"the release withdraws the presence AND the routing record",
	);
	assert.equal(
		JSON.parse(readFileSync(join(dir, "4249.json"), "utf8")).current_session,
		"",
		"a click for that conversation must now be told to switch to it",
	);
	publisher.stop();
	rmSync(dir, { recursive: true, force: true });

	/*
	 * ...AND THE LIVE CALL SITE IS WIRED, which is the half a handler test cannot
	 * see: a handler that offers the hook is useless if `index.ts` never passes the
	 * record to it. Asserted on the call's own argument list, the way this suite's
	 * sibling guards assert the shapes they depend on.
	 */
	const index = readFileSync("src/main/index.ts", "utf8");
	const call = index.slice(index.indexOf("registerDesktopIPC("));
	assert.match(
		call.slice(0, call.indexOf(");")),
		/viewerRecord\?\.releaseSession\(sessionId\)/,
		"index.ts must hand the release handler the live viewer record, or the record keeps naming the conversation the pane left",
	);
});

test("IPC rejects other frames and opens only backend-returned authorization once", async () => {
	globalThis.__desktopHandlers = new Map();
	globalThis.__desktopOpens = [];
	const frame = { url: "file:///app/index.html" };
	const contents = { mainFrame: frame };
	const owner = { webContents: contents, isDestroyed: () => false };
	const calls = [];
	registerDesktopIPC(
		() => owner,
		"file:///app/index.html",
		async (request) => {
			calls.push(request);
			return {
				status: 200,
				body: {
					result: { auth_url: "https://provider.example/authorize?state=test" },
				},
			};
		},
	);
	const invoke = globalThis.__desktopHandlers.get("desktop-request");
	assert.throws(() =>
		invoke({ sender: {}, senderFrame: frame }, { op: "settings.list" }),
	);
	assert.throws(() =>
		invoke(
			{ sender: contents, senderFrame: { url: frame.url } },
			{ op: "settings.list" },
		),
	);
	assert.equal(calls.length, 0);
	const event = { sender: contents, senderFrame: frame };
	await invoke(event, { op: "settings.list" });
	const open = globalThis.__desktopHandlers.get("desktop-open-authorization");
	await open(event, "operation-1");
	await open(event, "operation-1");
	assert.equal(globalThis.__desktopOpens.length, 1);
	assert.equal(calls.at(-1).op, "auth.status");
	await assert.rejects(() => open(event, "https://evil.example"));
	frame.url = "https://evil.example";
	assert.throws(() => invoke(event, { op: "settings.list" }));
});

test("the media relay hands on ArrayBuffer-backed bytes and refuses anything else", async () => {
	// `Blob`, which the relay builds a multipart body from, accepts only views
	// over a plain ArrayBuffer, and the DOM typings cannot tell a SharedArrayBuffer
	// view from an ArrayBuffer-backed one at the call site -- which is why the
	// narrowing lives at this boundary. Each case below is a branch of it.
	globalThis.__desktopHandlers = new Map();
	const frame = { url: "file:///app/index.html" };
	const contents = { mainFrame: frame };
	const owner = { webContents: contents, isDestroyed: () => false };
	const seen = [];
	registerDesktopIPC(
		() => owner,
		"file:///app/index.html",
		async () => ({ status: 200, body: { result: {} } }),
		undefined,
		async (_input, bytes) => {
			seen.push(bytes);
			return { status: 200, kind: "json", body: { result: {} } };
		},
	);
	const invoke = globalThis.__desktopHandlers.get("desktop-media");
	const event = { sender: contents, senderFrame: frame };
	const input = { op: "speech.create" };

	// A whole ArrayBuffer is adopted as a view over it.
	const buffer = new ArrayBuffer(4);
	new Uint8Array(buffer).set([1, 2, 3, 4]);
	await invoke(event, input, buffer);
	assert.deepEqual([...seen.at(-1)], [1, 2, 3, 4]);

	// A view keeps its own offset and length: the relay forwards the bytes the
	// caller chose, not the whole backing buffer.
	const backing = new Uint8Array([9, 8, 7, 6, 5]);
	await invoke(event, input, backing.subarray(1, 4));
	assert.deepEqual([...seen.at(-1)], [8, 7, 6]);
	assert.ok(seen.at(-1).buffer instanceof ArrayBuffer);

	// A SharedArrayBuffer view is not a valid Blob part. It is refused as absent
	// bytes rather than copied into an ArrayBuffer-backed view that would claim
	// to be exactly what the caller sent.
	await invoke(event, input, new Uint8Array(new SharedArrayBuffer(4)));
	assert.equal(seen.at(-1), null);

	// Everything that is not binary at all is absent bytes too.
	for (const notBytes of [null, undefined, "bytes", { 0: 1 }, 42]) {
		await invoke(event, input, notBytes);
		assert.equal(seen.at(-1), null, JSON.stringify(notBytes));
	}
});

test("a picker reopens where the last one of its kind landed", () => {
	// Electron 43 stopped the OS remembering the last-used directory and made
	// Downloads the default, so main remembers it instead. `kind` is per picker
	// so the working-directory picker and the file picker do not share a
	// directory; a caller's own `defaultPath` is never overwritten; and a
	// remembered directory that is gone falls back rather than handing the OS a
	// path it will silently ignore. Real directories on disk, because the module
	// checks that the remembered path still exists.
	const scratch = mkdtempSync(join(tmpdir(), "picker-test-"));
	const picked = join(scratch, "project");
	mkdirSync(picked, { recursive: true });
	const file = join(picked, "notes.txt");
	writeFileSync(file, "x");
	const fallback = "/fallback";

	// Nothing remembered yet: the FALLBACK, not undefined. An undefined
	// defaultPath is exactly what Electron 43 turns into Downloads, which is the
	// behaviour this module exists to avoid.
	assert.equal(
		withRememberedDirectory("picker-test-directory", {}, fallback).defaultPath,
		fallback,
		"the first use of a picker must not land on Downloads",
	);

	// A directory pick remembers the path itself; a file pick remembers its parent.
	rememberPickedDirectory("picker-test-directory", [picked], true);
	assert.equal(
		withRememberedDirectory("picker-test-directory", {}, fallback).defaultPath,
		picked,
	);
	rememberPickedDirectory("picker-test-file", [file]);
	assert.equal(
		withRememberedDirectory("picker-test-file", {}, fallback).defaultPath,
		picked,
	);
	assert.equal(
		withRememberedDirectory("picker-test-other", {}, fallback).defaultPath,
		fallback,
		"one picker's directory must not leak into another's",
	);

	// An explicit defaultPath from the caller wins.
	assert.equal(
		withRememberedDirectory(
			"picker-test-file",
			{ defaultPath: "/elsewhere" },
			fallback,
		).defaultPath,
		"/elsewhere",
	);

	// A cancelled pick reports no paths and must not clear or corrupt the memory:
	// reopening in the directory the user was last in is the point.
	rememberPickedDirectory("picker-test-file", []);
	assert.equal(
		withRememberedDirectory("picker-test-file", {}, fallback).defaultPath,
		picked,
	);

	// A remembered directory that is gone (unmounted, renamed, deleted) falls
	// back, and is forgotten rather than offered again if the path reappears.
	const gone = join(scratch, "unmounted");
	mkdirSync(gone, { recursive: true });
	rememberPickedDirectory("picker-test-gone", [gone], true);
	assert.equal(
		withRememberedDirectory("picker-test-gone", {}, fallback).defaultPath,
		gone,
	);
	rmSync(gone, { recursive: true, force: true });
	assert.equal(
		withRememberedDirectory("picker-test-gone", {}, fallback).defaultPath,
		fallback,
		"a remembered directory that no longer exists must not be handed back",
	);
	mkdirSync(gone, { recursive: true });
	assert.equal(
		withRememberedDirectory("picker-test-gone", {}, fallback).defaultPath,
		fallback,
		"the stale entry is dropped, not merely skipped while it is missing",
	);

	// The options the caller passed are preserved, and the caller's object is not
	// mutated -- the renderer's own options object crosses the IPC boundary.
	const options = { properties: ["openFile"], title: "Select File" };
	const returned = withRememberedDirectory(
		"picker-test-file",
		options,
		fallback,
	);
	assert.deepEqual(returned.properties, ["openFile"]);
	assert.equal(returned.title, "Select File");
	assert.equal(options.defaultPath, undefined);

	rmSync(scratch, { recursive: true, force: true });
});

test("a read receipt is admitted only by an actually foreground native window", async () => {
	// Renderer visibility cannot prove native foreground: an occluded, hidden or
	// minimized window still reports `visibilityState === "visible"` and can
	// still hold document focus. Main owns the real BrowserWindow, so this is
	// the only place the claim can be checked -- and it is enforced on the
	// shared typed request door so no alternate caller can route around it.
	globalThis.__desktopHandlers = new Map();
	const frame = { url: "file:///app/index.html" };
	const contents = { mainFrame: frame };
	const state = {
		destroyed: false,
		visible: true,
		minimized: false,
		focused: true,
	};
	const owner = {
		webContents: contents,
		isDestroyed: () => state.destroyed,
		isVisible: () => state.visible,
		isMinimized: () => state.minimized,
		isFocused: () => state.focused,
	};
	const calls = [];
	registerDesktopIPC(
		() => owner,
		"file:///app/index.html",
		async (request) => {
			calls.push(request);
			return { status: 200, body: { result: { unseen: false } } };
		},
	);
	const invoke = globalThis.__desktopHandlers.get("desktop-request");
	const event = { sender: contents, senderFrame: frame };
	const receipt = {
		op: "sessions.seen",
		sessionId: "123456abcdef",
		completionToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
	};

	await invoke(event, receipt);
	assert.equal(calls.length, 1, "a focused, visible window may acknowledge");

	// Every individual negative must refuse on its own: a background window is
	// unfocused, an occluded/hidden one is not visible, and a minimized one can
	// report both while showing the user nothing.
	for (const background of [
		{ focused: false },
		{ visible: false },
		{ minimized: true },
	]) {
		Object.assign(state, { visible: true, minimized: false, focused: true });
		Object.assign(state, background);
		await assert.rejects(
			() => invoke(event, receipt),
			/foreground/,
			JSON.stringify(background),
		);
	}
	assert.equal(calls.length, 1, "no background state reached the backend");

	// The gate is specific to receipts. Ordinary control traffic from a
	// background window is legitimate and must not be broken by it.
	Object.assign(state, { visible: false, minimized: true, focused: false });
	await invoke(event, { op: "settings.list" });
	assert.equal(calls.at(-1).op, "settings.list");

	Object.assign(state, { visible: true, minimized: false, focused: true });
	await invoke(event, receipt);
	assert.equal(
		calls.length,
		3,
		"the receipt is admitted again once foreground",
	);
});

test("receipt revisions converge monotonically across reconnects and reordering", async () => {
	// Owner epochs restart; the receipt clock does not. Frames arrive reordered
	// after a reconnect, and a snapshot captured before an acknowledgement can
	// land after it -- so applying whatever arrived last would resurrect an
	// already-read result or, worse, hide a newer unread one.
	const contract = await build({
		stdin: {
			contents: 'export * from "./src/shared/desktop-session-contract";',
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	const { mergeCompletionAttention } = await import(
		`data:text/javascript;base64,${Buffer.from(contract.outputFiles[0].text).toString("base64")}`
	);
	const sessionId = "123456abcdef";
	const at = (published, acknowledged, extra = {}) => ({
		conversation_id: `session/${sessionId}`,
		completion_token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
		anchor_id: "result-1",
		kind: "complete",
		unseen: published > acknowledged,
		revision: [published, acknowledged],
		supported: true,
		...extra,
	});
	const merge = (current, incoming) =>
		mergeCompletionAttention(current, incoming, sessionId)?.revision;

	assert.deepEqual(merge(undefined, at(2, 1)), [2, 1]);
	assert.deepEqual(merge(at(1, 1), at(2, 1)), [2, 1]);
	assert.deepEqual(merge(at(2, 1), at(2, 2)), [2, 2]);
	// Neither clock may run backwards, whichever direction the staleness is in.
	assert.deepEqual(merge(at(2, 2), at(1, 1)), [2, 2]);
	assert.deepEqual(merge(at(2, 2), at(2, 1)), [2, 2]);
	// Identity is namespaced: a persistent agent conversation and an unrelated
	// session are different authorities even when the trailing id matches.
	for (const foreign of [
		{ conversation_id: "session/ffffffffffff" },
		{ conversation_id: `agent/${sessionId}` },
		{ revision: ["x", 1] },
		{ revision: [-1, 0] },
		{ revision: [3] },
	]) {
		assert.deepEqual(
			merge(at(2, 2), at(9, 9, foreign)),
			[2, 2],
			JSON.stringify(foreign),
		);
	}
	assert.deepEqual(merge(at(2, 2), undefined), [2, 2]);
});

test("the receipt gate rides the sender, so a non-IPC main caller cannot bypass it", async () => {
	// `DesktopNotifier` holds its own reference to the same underlying sender
	// and calls it directly, so a gate living only inside the `desktop-request`
	// IPC handler would not cover it. Not exploitable while the notifier emits
	// only `sessions.watch` — but it is precisely how a future main-process
	// caller would acquire an ungated `sessions.seen`.
	const state = { visible: false, minimized: true, focused: false };
	const owner = {
		isDestroyed: () => false,
		isVisible: () => state.visible,
		isMinimized: () => state.minimized,
		isFocused: () => state.focused,
	};
	const calls = [];
	const guarded = guardForegroundReceipts(
		() => owner,
		async (input) => {
			calls.push(input);
			return { status: 200, body: { result: {} } };
		},
	);
	const receipt = {
		op: "sessions.seen",
		sessionId: "123456abcdef",
		completionToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
	};

	// A background window is refused even though this never touches ipcMain.
	await assert.rejects(() => guarded(receipt), /foreground/);
	assert.equal(calls.length, 0);

	// The notifier's own traffic is unaffected: a lease is not a read, and it
	// legitimately reports presence from a background window.
	await guarded({
		op: "sessions.watch",
		sessionId: "123456abcdef",
		subscriptionId: "a".repeat(32),
		visible: false,
		canNotify: true,
	});
	assert.equal(calls.length, 1);

	Object.assign(state, { visible: true, minimized: false, focused: true });
	await guarded(receipt);
	assert.equal(calls.length, 2);

	// Double application (sender-wrapped AND registered through the IPC entry)
	// must stay idempotent rather than double-refusing a legitimate receipt.
	const twice = guardForegroundReceipts(() => owner, guarded);
	await twice(receipt);
	assert.equal(calls.length, 3);
});

// The guard that produced this test refused every op at a bare 262144, which is
// 29% of what the backend accepts and less than one pasted Retina screenshot,
// while the schema in the same package promised eight 1,000,000-char images. A
// per-op table is what keeps the pipe and the promise from disagreeing again.
test("byte budgets are per operation, and message ops get the backend's real headroom", () => {
	// Pinned to `Prompt.nonempty` in desktop_sessions.py:101 (900,000) less
	// envelope headroom. Only the ops that carry images get it.
	assert.equal(desktopRequestByteBudget("sessions.message"), 880000);
	assert.equal(desktopRequestByteBudget("sessions.command"), 880000);
	// `sessions.fork` declares the same 200,000-char text field as
	// `sessions.message`, so it belongs in the same tier; on the control budget
	// it 413'd a fork message the schema promised to accept (round 1, R3).
	assert.equal(desktopRequestByteBudget("sessions.fork"), 880000);
	// Sized to its OWN schema, which declares 1,000,000 characters. Any smaller
	// number is a pipe narrower than the promise in front of it - the exact
	// asymmetry this contract exists to prevent (round 1, R3).
	assert.equal(
		desktopRequestByteBudget("legacy.agent.systemPrompt.update"),
		1100000,
	);
	// Control ops move fixed-shape fields and must stay tight: a wider budget
	// there buys nothing and widens what an untrusted renderer can push.
	assert.equal(desktopRequestByteBudget("config.update"), 262144);
	assert.equal(desktopRequestByteBudget("auth.key"), 262144);
	assert.equal(desktopRequestByteBudget("capabilities"), 262144);
	// The dev proxy bounds a streamed read by this before the op is knowable,
	// then defers to the per-op refusal. It must cover the widest budget or it
	// truncates a legal request before anything can classify it - so this is
	// asserted as a RELATIONSHIP, not a literal, because pinning the literal is
	// what would silently re-narrow the read when a tier is added.
	for (const op of [
		"sessions.message",
		"sessions.command",
		"sessions.fork",
		"legacy.agent.systemPrompt.update",
		"config.update",
	])
		assert.ok(
			MAX_DESKTOP_REQUEST_BYTES >= desktopRequestByteBudget(op),
			`the streamed read bound must cover ${op}`,
		);
	assert.equal(MAX_DESKTOP_REQUEST_BYTES, 1100000);
	// The proxy weighs the ENVELOPE, which is wider than any body budget.
	assert.ok(MAX_DESKTOP_ENVELOPE_BYTES > MAX_DESKTOP_REQUEST_BYTES);
	assert.equal(
		MAX_DESKTOP_ENVELOPE_BYTES,
		MAX_DESKTOP_REQUEST_BYTES + MAX_DESKTOP_ENVELOPE_OVERHEAD_BYTES,
	);
});

test("a message just under the budget is sent and just over is refused before any HTTP", async () => {
	const sessionId = "123456abcdef";
	const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
	const budget = desktopRequestByteBudget("sessions.message");
	const text = "Five screenshots and a long question.";
	// Reach the budget with an IMAGE, because that is the ordinary way to reach
	// it. (Not the ONLY way: JSON escaping makes a C0 control 6 bytes, so 200,000
	// NULs is ~1.2 MB inside the 200,000-char cap. The guard refuses that too;
	// the point here is the attachment-carrying case.) Measure the envelope rather
	// than hardcoding it, so a field added to the body cannot silently move the
	// boundary this test claims to pin.
	const envelope = Buffer.byteLength(
		JSON.stringify({
			request_id: requestId,
			text,
			images: [{ data_b64: "", mime_type: "image/png" }],
			mode: "prompt",
		}),
	);
	const message = (bytes) => ({
		op: "sessions.message",
		sessionId,
		requestId,
		text,
		images: [
			{ data_b64: "A".repeat(bytes - envelope), mime_type: "image/png" },
		],
	});

	const count = seen.length;
	const fits = await requestDesktop(message(budget), url, token);
	assert.equal(fits.status, 200);
	assert.equal(Buffer.byteLength(seen.at(-1).body), budget);
	// The old global literal is the number this payload used to die on, and it
	// is 3.4x under what the backend accepts. Stated here so a regression that
	// reinstates it fails with the reason attached.
	assert.ok(budget > 262144);

	// One byte over is the whole difference: no fetch, and the detail names the
	// message rather than "this desktop request", which is not what the user
	// believes they sent.
	const over = await requestDesktop(message(budget + 1), url, token);
	assert.equal(over.status, 413);
	assert.equal(over.body.detail, DESKTOP_REQUEST_TOO_LARGE_DETAIL);
	// The backstop cannot name a size, so it must at least name an action -
	// "too large" with no remedy is an unfinished error (review round 1, Q-3).
	assert.match(over.body.detail, /Remove an image, or split the text/);
	assert.equal(
		seen.length,
		count + 1,
		"the refused body must never reach HTTP",
	);
});

test("control ops stay far below their own budget, so the tight cap is a backstop not a limit", async () => {
	// The widest control field in the vocabulary is a 32768-char credential, so
	// no legitimate control body approaches 262,144. That is the design: the
	// tight budget bounds a malformed or hostile renderer payload, and refusing
	// a real control at it would be a bug. A body past the SCHEMA is rejected
	// earlier and never reaches HTTP either way.
	const count = seen.length;
	const legitimate = await requestDesktop(
		{ op: "credentials.update", key: "SOME_KEY", value: "v".repeat(32768) },
		url,
		token,
	);
	assert.equal(legitimate.status, 200);
	assert.ok(
		Buffer.byteLength(seen.at(-1).body) <
			desktopRequestByteBudget("credentials.update"),
	);
	const oversize = await requestDesktop(
		{ op: "credentials.update", key: "SOME_KEY", value: "v".repeat(32769) },
		url,
		token,
	);
	assert.equal(oversize.status, 422);
	assert.equal(
		seen.length,
		count + 1,
		"the refused body must never reach HTTP",
	);
});

test("sessions.warm reaches the warm route with an empty body on the control budget", async () => {
	// R12. The op carries no text and no images, so it must NOT be in
	// `MESSAGE_OPS`: a message-tier budget on a 2-byte body would widen what an
	// untrusted renderer can push for nothing in return. This is the op the
	// renderer fires from a KEYSTROKE, so it is also the one where a wrong
	// budget is cheapest to miss and most often exercised.
	const sessionId = "123456abcdef";
	assert.equal(
		desktopRequestByteBudget("sessions.warm"),
		desktopRequestByteBudget("capabilities"),
		"the warm op takes the control budget, so it must not be a MESSAGE_OPS member",
	);
	const count = seen.length;
	const response = await requestDesktop(
		{ op: "sessions.warm", sessionId },
		url,
		token,
	);
	assert.equal(response.status, 200);
	assert.equal(seen.length, count + 1, "exactly one request reached HTTP");
	const last = seen.at(-1);
	assert.equal(last.path, `/v1/desktop/sessions/${sessionId}/warm`);
	assert.equal(last.method, "POST");
	assert.equal(last.authorization, `Bearer ${token}`);
	// `{}` and not an omitted body: the transport only sets Content-Type when a
	// body exists, and the route's input model forbids extras while still
	// requiring a JSON object, so an absent body 422s a legal call.
	assert.deepEqual(JSON.parse(last.body), {});
	// The op literal is shorter than the longest one the envelope allowance was
	// justified from ("sessions.command"), so that constant needs no change.
	assert.ok("sessions.warm".length < "sessions.command".length);

	// The closed vocabulary still refuses a warm that tries to carry payload or
	// address something that is not a session id.
	for (const bad of [
		{ op: "sessions.warm" },
		{ op: "sessions.warm", sessionId: "../config" },
		{ op: "sessions.warm", sessionId, text: "smuggled" },
		{
			op: "sessions.warm",
			sessionId,
			requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		},
	]) {
		const refused = await requestDesktop(bad, url, token);
		assert.equal(
			refused.status,
			422,
			`${JSON.stringify(bad)} must not reach HTTP`,
		);
	}
	assert.equal(seen.length, count + 1, "no malformed warm reached the network");
});

test("sessions.interrupt reaches the interrupt route with request_id only", async () => {
	/*
	 * The op the composer's Stop control and its Escape accelerator fire. It
	 * carries no text and no images, so it is NOT a `MESSAGE_OPS` member: a
	 * message-tier budget on a 36-byte body would widen what an untrusted
	 * renderer can push for nothing in return.
	 *
	 * The body is the point of the whole change and is asserted exactly. The
	 * control used to post `{op: "sessions.command", command: "stop"}`, which the
	 * backend answers with a PRESENTATION FORM - HTTP 200 and a `native_action`
	 * asking the client to open the session-stop picker - while the turn kept
	 * streaming. A route reached with the wrong body is indistinguishable from a
	 * stop that worked, so this test pins the body to `{request_id}` alone and the
	 * path to the interrupt route, and never `.../stop`, which is the kill switch.
	 */
	const sessionId = "123456abcdef";
	const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
	assert.equal(
		desktopRequestByteBudget("sessions.interrupt"),
		desktopRequestByteBudget("capabilities"),
		"the interrupt op takes the control budget, so it must not be a MESSAGE_OPS member",
	);
	const count = seen.length;
	const response = await requestDesktop(
		{ op: "sessions.interrupt", sessionId, requestId },
		url,
		token,
	);
	assert.equal(response.status, 200);
	assert.equal(seen.length, count + 1, "exactly one request reached HTTP");
	const last = seen.at(-1);
	assert.equal(last.path, `/v1/desktop/sessions/${sessionId}/interrupt`);
	assert.equal(last.method, "POST");
	assert.equal(last.authorization, `Bearer ${token}`);
	assert.deepEqual(JSON.parse(last.body), { request_id: requestId });

	/*
	 * There is no `confirmed` field, and its ABSENCE is a decision rather than an
	 * omission: an interrupt destroys nothing - the session and its process keep
	 * running - so requiring a confirmation would make Escape useless on the one
	 * path where a second press is not available.
	 */
	const confirmed = await requestDesktop(
		{ op: "sessions.interrupt", sessionId, requestId, confirmed: true },
		url,
		token,
	);
	assert.equal(confirmed.status, 422, "an interrupt is not confirmable");

	/*
	 * `sessions.interrupt` is now the LONGEST op literal in the vocabulary (18
	 * characters against `sessions.command`'s 16), which is the fact
	 * `MAX_DESKTOP_ENVELOPE_OVERHEAD_BYTES` is sized from. Asserted rather than
	 * asserted-in-a-comment: the widest possible envelope this op can produce has
	 * to fit the allowance the streaming proxy adds on top of the body budget, or
	 * the proxy truncates a request `requestDesktop` and the backend both accept.
	 */
	for (const op of ["sessions.interrupt", "sessions.command"]) {
		const envelope = Buffer.byteLength(
			JSON.stringify({ op, sessionId, requestId }),
		);
		const body = Buffer.byteLength(JSON.stringify({ request_id: requestId }));
		assert.ok(
			envelope - body <= MAX_DESKTOP_ENVELOPE_OVERHEAD_BYTES,
			`the ${op} envelope exceeds the proxy's overhead allowance`,
		);
	}

	// The closed vocabulary still refuses an interrupt that tries to carry
	// payload, address something that is not a session id, or drop the receipt
	// key the route's idempotency is built on.
	for (const bad of [
		{ op: "sessions.interrupt" },
		{ op: "sessions.interrupt", sessionId },
		{ op: "sessions.interrupt", sessionId, requestId: "not-a-uuid" },
		{ op: "sessions.interrupt", sessionId: "../config", requestId },
		{ op: "sessions.interrupt", sessionId, requestId, command: "stop" },
	]) {
		const refused = await requestDesktop(bad, url, token);
		assert.equal(
			refused.status,
			422,
			`${JSON.stringify(bad)} must not reach HTTP`,
		);
	}
	assert.equal(
		seen.length,
		count + 1,
		"no malformed interrupt reached the network",
	);
});

/*
 * ---------------------------------------------------------------------------
 * The code-memory read path, through the SHIPPING renderer module.
 *
 * Review round 1 (C-01 / Q-1 / U1) found the panel reading one envelope level
 * too shallow: the four routes answer `result: {data: <state>, replayed: false}`
 * and `desktopResult` returns `envelope.result`, so `data.state` was undefined
 * and every state fell through to the empty branch - a populated namespace
 * rendering "Nothing stored yet". Nothing in the suite could see it, because
 * every fixture answered the shape for which an unwrapped read works.
 *
 * So this test does not assert a fixture's shape. It replays the bodies the
 * BACKEND sent - copied from a live session against PR #1101's routes - through
 * the module the renderer really calls, and asserts the resolved value. The
 * second half is the guard that would have failed before the fix: the same
 * module, handed the shallow envelope, must NOT resolve a state. A test that
 * only asserted the correct shape would keep passing if someone re-flattened
 * the read path and re-flattened the fixture with it.
 * ---------------------------------------------------------------------------
 */
const rendererBundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/api/local-operator/session-variables-api"; export { desktopRequestSchema, desktopEndpoint, isWritableVariableKey } from "./src/shared/desktop-contract"; export { desktopFeatureEnabled } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	listSessionVariables,
	createSessionVariable,
	updateSessionVariable,
	deleteSessionVariable,
	isWritableVariableKey,
	desktopRequestSchema,
	desktopEndpoint: rendererDesktopEndpoint,
	// The capability gate the pins tests read: the SAME export the renderer bundle carries, so
	// the test asks the shipped predicate rather than a restatement of it.
	desktopFeatureEnabled,
} = await import(
	`data:text/javascript;base64,${Buffer.from(rendererBundle.outputFiles[0].text).toString("base64")}`
);

const SESSION = "8fd6c6a40934";

/** Serve fixed bodies through the renderer transport, as a backend would. */
const serveRenderBodies = (bodies) => {
	globalThis.window = {
		api: {
			desktop: {
				request: async (request) => {
					const body = bodies[request.op];
					if (!body) throw new Error(`no body for ${request.op}`);
					return { status: 200, body };
				},
			},
		},
	};
};

/** What `GET /v1/desktop/sessions/{id}/variables` really answers. */
const LIST_BODY = {
	status: 200,
	message: "Desktop session result.",
	result: {
		data: {
			state: "observed",
			runtime: "running",
			kernel: "resident",
			variables: [
				{
					key: "total_outstanding",
					type: "float",
					value: "1234.5",
					editable: true,
					truncated: false,
				},
			],
			truncated: false,
		},
		replayed: false,
	},
};

const VARIABLE = {
	key: "total_outstanding",
	type: "float",
	value: "1234.5",
	editable: true,
	truncated: false,
};

test("a code-memory read resolves the state inside the backend's `data` wrapper", async () => {
	serveRenderBodies({ "sessions.variables.list": LIST_BODY });
	const result = await listSessionVariables(SESSION);
	assert.equal(
		result.state,
		"observed",
		"the read must resolve the state the backend named, not the wrapper around it",
	);
	assert.equal(result.variables.length, 1);
	assert.equal(result.variables[0].key, "total_outstanding");
});

test("the writes resolve their ack out of the same wrapper", async () => {
	serveRenderBodies({
		"sessions.variables.create": {
			status: 200,
			message: "ok",
			result: { data: { state: "ok", variable: VARIABLE }, replayed: false },
		},
		// A variable of its own, so the assertion below reads as "the update's ack
		// is what came back" rather than as "the write was ignored": the value
		// asked for and the value answered are deliberately different.
		"sessions.variables.update": {
			status: 200,
			message: "ok",
			result: {
				data: {
					state: "ok",
					variable: { ...VARIABLE, value: "9" },
				},
				replayed: false,
			},
		},
		"sessions.variables.delete": {
			status: 200,
			message: "ok",
			result: { data: { state: "ok" }, replayed: false },
		},
	});
	const created = await createSessionVariable(SESSION, {
		key: "total_outstanding",
		value: "1234.5",
		type: "float",
	});
	assert.equal(created.key, "total_outstanding");
	const updated = await updateSessionVariable(SESSION, {
		key: "total_outstanding",
		value: "9",
		type: "float",
	});
	// The ack's own value, which is the one the backend stored, not the one the
	// request asked for: an unwrap that read the wrong level would return the
	// request body and still pass a comparison against it.
	assert.equal(updated.value, "9");
	await deleteSessionVariable(SESSION, "total_outstanding");
});

test("the shallow envelope - the shape this PR shipped against - does not resolve a state", async () => {
	serveRenderBodies({
		"sessions.variables.list": {
			status: 200,
			message: "ok",
			// What the Storybook fixtures used to answer: the state where the
			// backend puts its wrapper. Kept as a test rather than deleted from
			// history, because this is the exact body that made a broken read
			// path look correct in 98 committed frames.
			result: LIST_BODY.result.data,
		},
	});
	const result = await listSessionVariables(SESSION);
	assert.equal(
		result?.state,
		undefined,
		"if this ever resolves a state, the read path is reading a shape the backend does not send",
	);
});

test("a dot-only key is refused by the contract and never addressed", () => {
	for (const key of [".", "..", "...", "", "a".repeat(129), "bad\u0007name"]) {
		assert.equal(
			isWritableVariableKey(key),
			false,
			`${key} must not be addressable`,
		);
		const parsed = desktopRequestSchema.safeParse({
			op: "sessions.variables.delete",
			sessionId: SESSION,
			key,
		});
		assert.equal(parsed.success, false, `${key} must not pass the schema`);
	}
	/*
	 * And why the rule has to be a refusal rather than a warning: the endpoint
	 * builder itself is happy to produce the traversing path, and `new URL` in
	 * the transport resolves it away before the request leaves - so a name of
	 * dots would address `/variables/` or the collection, not the name. Pinned
	 * here so the rule cannot be relaxed without this line failing.
	 */
	const { path: traversing } = rendererDesktopEndpoint({
		op: "sessions.variables.delete",
		sessionId: SESSION,
		key: "..",
	});
	assert.equal(
		new URL(traversing, "http://127.0.0.1:1111").pathname,
		`/v1/desktop/sessions/${SESSION}/`,
		"a dot-only key re-points the request; the schema refusal is what stops it",
	);
	// Names that are legal memory stay addressable: a space, a dot inside a
	// name, and a dunder - the reason this is a denylist rather than an
	// identifier regex.
	for (const key of ["outstanding total", "a.b", "__builtins__"]) {
		assert.equal(
			isWritableVariableKey(key),
			true,
			`${key} must stay addressable`,
		);
		const { path } = rendererDesktopEndpoint({
			op: "sessions.variables.delete",
			sessionId: SESSION,
			key,
		});
		assert.equal(
			new URL(path, "http://127.0.0.1:1111").pathname,
			`/v1/desktop/sessions/${SESSION}/variables/${encodeURIComponent(key)}`,
		);
	}
});
test("sessions.presence claims the kinds and the window the delivery lease reads", async () => {
	// B1. The lease is what makes rung 2 eligible, and it reads three fields
	// beside `can_notify`: the kinds this app can deliver, the conversation a
	// window is displaying, and that window's own state. A claim that omits them
	// is not a weaker claim, it is a claim to NOTHING - the backend defaults
	// `can_notify_kinds` to empty (so every completion falls to the runtime's own
	// banner, whose claim advances the read watermark and leaves this app nothing
	// to compose) and `window` to all-false (so `attended` is false and a
	// completion in the conversation ON SCREEN is bannered). Both are the
	// operator's reported symptom, so the body is asserted here rather than
	// trusted to the call site that builds it.
	const sessionId = "123456abcdef";
	const count = seen.length;
	const response = await requestDesktop(
		{
			op: "sessions.presence",
			subscriptionId: "c".repeat(32),
			canNotify: true,
			canNotifyKinds: ["complete", "error"],
			sessionId,
			window: {
				exists: true,
				focused: true,
				visible: true,
				minimized: false,
			},
		},
		url,
		token,
	);
	assert.equal(response.status, 200);
	assert.equal(seen.length, count + 1, "exactly one request reached HTTP");
	const last = seen.at(-1);
	assert.equal(last.path, "/v1/desktop/presence");
	assert.equal(last.method, "POST");
	assert.equal(last.authorization, `Bearer ${token}`);
	assert.deepEqual(JSON.parse(last.body), {
		subscription_id: "c".repeat(32),
		can_notify: true,
		can_notify_kinds: ["complete", "error"],
		session_id: sessionId,
		window: {
			exists: true,
			focused: true,
			visible: true,
			minimized: false,
		},
	});

	// A windowless app is a real state and must still name its window object as
	// all-false with an empty session: the backend discards a session id that
	// arrives without a window, and a stale id here would suppress the banner for
	// a conversation nobody can see.
	const windowless = await requestDesktop(
		{
			op: "sessions.presence",
			subscriptionId: "d".repeat(32),
			canNotify: true,
			canNotifyKinds: ["complete", "error"],
			sessionId: "",
			window: {
				exists: false,
				focused: false,
				visible: false,
				minimized: false,
			},
		},
		url,
		token,
	);
	assert.equal(windowless.status, 200);
	assert.deepEqual(JSON.parse(seen.at(-1).body), {
		subscription_id: "d".repeat(32),
		can_notify: true,
		can_notify_kinds: ["complete", "error"],
		session_id: "",
		window: { exists: false, focused: false, visible: false, minimized: false },
	});

	// The vocabulary stays closed: a partial window object would let the
	// renderer's assumptions about which fields the backend reads drift silently.
	for (const bad of [
		{
			op: "sessions.presence",
			subscriptionId: "c".repeat(32),
			canNotify: true,
		},
		{
			op: "sessions.presence",
			subscriptionId: "c".repeat(32),
			canNotify: true,
			canNotifyKinds: ["complete"],
			sessionId,
			window: { exists: true, focused: true, visible: true },
		},
		{
			op: "sessions.presence",
			subscriptionId: "c".repeat(32),
			canNotify: true,
			// A kind the feed cannot compose is not a kind this app may claim.
			canNotifyKinds: ["complete", "ask"],
			sessionId,
			window: { exists: true, focused: true, visible: true, minimized: false },
		},
	]) {
		const refused = await requestDesktop(bad, url, token);
		assert.equal(
			refused.status,
			422,
			`${JSON.stringify(bad)} must not reach HTTP`,
		);
	}
	assert.equal(
		seen.length,
		count + 2,
		"no malformed presence beat reached the network",
	);
});

test("sessions.move reaches the working-directory route with the path, on the control budget", async () => {
	// The op that moves a live session. Two things it must not do: take the
	// MESSAGE budget (a 4 KB path is not prose, and the message tier is the wider
	// one an untrusted renderer gets), and carry anything beyond the two fields
	// the route's own model declares.
	const sessionId = "123456abcdef";
	assert.equal(
		desktopRequestByteBudget("sessions.move"),
		desktopRequestByteBudget("capabilities"),
		"the move op takes the control budget, so it must not be a MESSAGE_OPS member",
	);
	const count = seen.length;
	const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
	const response = await requestDesktop(
		{ op: "sessions.move", sessionId, requestId, cwd: "/Users/me/moved" },
		url,
		token,
	);
	assert.equal(response.status, 200);
	assert.equal(seen.length, count + 1, "exactly one request reached HTTP");
	const last = seen.at(-1);
	assert.equal(
		last.path,
		`/v1/desktop/sessions/${sessionId}/working-directory`,
	);
	assert.equal(last.method, "POST");
	assert.equal(last.authorization, `Bearer ${token}`);
	// The path goes over AS TYPED. Resolving `~` and a relative path is the
	// backend's job, because the base for a relative path is the SESSION's
	// directory - a rule the renderer cannot apply without owning the session.
	assert.deepEqual(JSON.parse(last.body), {
		request_id: requestId,
		cwd: "/Users/me/moved",
	});

	// The declared ceiling is payable rather than aspirational: a path at the
	// schema's own 4096-character bound reaches the network instead of being
	// refused by the renderer's pre-flight for a body the schema promised.
	const longest = "a".repeat(4096);
	const atBound = await requestDesktop(
		{ op: "sessions.move", sessionId, requestId, cwd: longest },
		url,
		token,
	);
	assert.equal(
		atBound.status,
		200,
		"a path at the schema's bound must fit the control budget",
	);
	assert.equal(JSON.parse(seen.at(-1).body).cwd, longest);

	// The closed vocabulary still refuses a move that cannot mean anything.
	for (const bad of [
		{ op: "sessions.move", sessionId, requestId },
		{ op: "sessions.move", sessionId, requestId, cwd: "" },
		{ op: "sessions.move", sessionId, requestId, cwd: "x".repeat(4097) },
		{ op: "sessions.move", sessionId, cwd: "/tmp/x" },
		{
			op: "sessions.move",
			sessionId,
			requestId,
			cwd: "/tmp/x",
			text: "smuggled",
		},
	]) {
		const refused = await requestDesktop(bad, url, token);
		assert.equal(
			refused.status,
			422,
			`${JSON.stringify(bad)} must not reach HTTP`,
		);
	}
	assert.equal(seen.length, count + 2, "no malformed move reached the network");
});

// The deadline table, and the one failure that used to be indistinguishable
// from a dead backend.
//
// WHY A TABLE. One 20 s literal applied to every op, and for `analytics.get`
// that was not a bound on the request — it was a bound on how long the app
// would wait for an answer the daemon was still producing. Measured against one
// isolated backend and one copy of the ledger: 12.1-17.8 s warm for the 30-day
// window, 39.6 s cold, 5.6-11.8 s for 7 days. Every read of a cold ledger was
// therefore abandoned mid-scan, the app's retry put a second scan on the daemon,
// and the user was told the backend "could not complete this request".
test("long-budget reads get a budget sized for what makes them slow, and controls keep the short one", () => {
	// The ledger reads: sized by the worst cold read measured (39.6 s) rather
	// than by the request.
	assert.equal(desktopRequestDeadlineMs("analytics.get"), 90000);
	assert.equal(desktopRequestDeadlineMs("sessions.report"), 90000);
	// `usage.get` shares the long budget for a DIFFERENT reason, and the comment
	// here used to state the wrong one: it is not a local scan at all (review
	// round 1, R1). `/v1/desktop/usage` answers from the provider controller's
	// cache or from a live fan-out to each provider's quota endpoint, so its cost
	// is the network's and the backend's per-account retries. What the two shapes
	// have in common is only that neither is bounded by the request.
	assert.equal(desktopRequestDeadlineMs("usage.get"), 90000);
	// Everything else answers from state already in memory, so twenty seconds of
	// silence is a failure and must stay one. `info.get` and `sessions.failovers`
	// are deliberately NOT on the long budget: one is a host snapshot whose slow
	// part is a child process, the other is routing state.
	for (const op of [
		"config.get",
		"capabilities",
		"info.get",
		"sessions.failovers",
		"sessions.message",
	])
		assert.equal(desktopRequestDeadlineMs(op), 20000, op);
	// The sentence names the budget it ran out of, and says what the read can be
	// done about; asserting on the number keeps the copy and the constant from
	// drifting apart, which is the failure mode this whole table exists to
	// remove. The NEGATIVE assertion is the real property (review round 1, N1):
	// what the old sentence got wrong was inviting a second attempt at work the
	// daemon was still doing, so a rewording that keeps that out passes and one
	// that reads it back in fails.
	const ledger = desktopRequestDeadlineDetail("analytics.get", 90000);
	assert.equal(ledger.code, DESKTOP_DEADLINE_EXCEEDED_CODE);
	assert.match(ledger.message, /90 seconds/);
	assert.match(ledger.message, /reopen the panel/);
	assert.match(ledger.message, /Nothing was read/);
	assert.doesNotMatch(ledger.message, /try again/);
	// A WRITE gets no claim about what the server did with the request: the app
	// aborted a fetch, it did not observe the outcome (design round 1, D1).
	const write = desktopRequestDeadlineDetail("sessions.message", 20000);
	assert.equal(write.code, DESKTOP_DEADLINE_EXCEEDED_CODE);
	assert.match(write.message, /20 seconds/);
	assert.match(write.message, /may or may not have reached the server/);
	assert.doesNotMatch(write.message, /Nothing was changed/);
	// And a control READ keeps the flat assurance, which is knowable for it.
	const control = desktopRequestDeadlineDetail("config.get", 20000);
	assert.equal(control.code, DESKTOP_DEADLINE_EXCEEDED_CODE);
	assert.match(control.message, /20 seconds/);
	assert.match(control.message, /Nothing was read/);
});

// The real path, against a real socket that accepts and never answers: what an
// expired read now returns, and that it is NOT what a dead backend returns.
//
// It waits out the control budget for real (20 s). That is the point - the
// expired path is a clock, and the only honest fixture for it is a listener that
// stalls - and it is the same trade `desktop-renderer-transport.test.mjs`
// already makes for the renderer's 30 s deadline.
test("a request that runs out of its budget answers 504 with its own code, not an unreachable 503", async () => {
	const stall = createServer(() => {});
	await new Promise((resolve) => stall.listen(0, "127.0.0.1", resolve));
	const stallUrl = `http://127.0.0.1:${stall.address().port}`;
	try {
		const started = Date.now();
		const outcome = await requestDesktopOutcome(
			{ op: "config.get" },
			stallUrl,
			token,
		);
		const elapsed = Date.now() - started;
		assert.equal(outcome.response.status, 504);
		assert.equal(
			outcome.response.body.detail.code,
			DESKTOP_DEADLINE_EXCEEDED_CODE,
		);
		// Liveness: a timeout that never got a response is not an answered
		// request, so the daemon state machine must not read it as one. This is
		// the same distinction the 503 carries, and it is why the flag is left
		// alone by the branch above.
		assert.equal(outcome.answered, false);
		assert.ok(
			elapsed >= 19000 && elapsed < 40000,
			`the control budget is 20 s; this took ${elapsed}ms`,
		);
	} finally {
		await new Promise((resolve) => stall.close(resolve));
	}
});

// The transport's ACTUAL signal for a ledger op, which no assertion on the table
// can bind (review round 1, R2).
//
// The table test above reads `desktopRequestDeadlineMs`, and the renderer test
// derives its own bound from the same function — so both pass for every op and
// would keep passing if the transport handed `fetch` a second literal, grew an
// attempt loop, or sized its signal off the byte budget instead. This one holds
// a real socket for longer than the OLD control budget and asks for a ledger
// read: an answered 200 is proof that the signal `fetch` received is the long
// one, because at 20 s the same request used to come back 504.
test("a ledger read outlives the old control budget and still answers", async () => {
	const HOLD_MS = 22_000;
	const stall = createServer((_req, res) => {
		setTimeout(() => {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ result: { data: {} } }));
		}, HOLD_MS);
	});
	await new Promise((resolve) => stall.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${stall.address().port}`;
	try {
		const started = Date.now();
		const outcome = await requestDesktopOutcome(
			{ op: "analytics.get", days: 7 },
			url,
			token,
		);
		const elapsed = Date.now() - started;
		assert.equal(
			outcome.response.status,
			200,
			`a ledger read was abandoned at the control budget (returned in ${elapsed}ms)`,
		);
		assert.equal(outcome.answered, true);
		assert.ok(
			elapsed >= HOLD_MS,
			`the socket held ${HOLD_MS}ms; this returned in ${elapsed}ms`,
		);
	} finally {
		await new Promise((resolve) => stall.close(resolve));
	}
});

test("a pin press sends the desired state to the session's own route", async () => {
	const sessionId = "123456abcdef";
	const count = seen.length;
	const response = await requestDesktop(
		{ op: "sessions.pin", sessionId, pinned: true },
		url,
		token,
	);
	assert.equal(response.status, 200);
	assert.equal(seen.length, count + 1, "one press is one request");
	assert.equal(seen.at(-1).path, `/v1/desktop/sessions/${sessionId}/pin`);
	assert.equal(seen.at(-1).method, "POST");
	/*
	 * The DESIRED STATE is the body, and that is the whole point of the op: there
	 * is no `toggle` verb whose retry flips the pin back. The route makes a repeat
	 * a no-op rather than putting the call on the receipt ladder, which is why a
	 * retried press here is harmless by construction.
	 */
	assert.deepEqual(JSON.parse(seen.at(-1).body), { pinned: true });
	assert.deepEqual(
		rendererDesktopEndpoint({
			op: "sessions.pin",
			sessionId,
			pinned: false,
		}),
		{
			path: `/v1/desktop/sessions/${sessionId}/pin`,
			method: "POST",
			body: { pinned: false },
		},
	);
	/*
	 * `pinned` is required, not defaulted. A schema that let it default would make
	 * a malformed press silently mean one of the two directions - and the direction
	 * it guessed would be the one nobody was told about.
	 */
	for (const bad of [
		{ op: "sessions.pin", sessionId },
		{ op: "sessions.pin", sessionId, pinned: "true" },
		{ op: "sessions.pin", sessionId, pinned: true, reorder: true },
		{ op: "sessions.pin", sessionId: "../../etc", pinned: true },
		{ op: "sessions.pin", sessionId: "zzzzzzzzzzzz", pinned: true },
	]) {
		const refused = await requestDesktop(bad, url, token);
		assert.equal(
			refused.status,
			422,
			`${JSON.stringify(bad)} must not reach HTTP`,
		);
	}
	assert.equal(seen.length, count + 1, "no malformed pin reached the network");
});

test("session_pins is its own feature key, and its absence closes the feature", () => {
	/*
	 * Its own key rather than a bump of `session_catalogue`, on the rule that file
	 * states: the catalogue is a surface that works perfectly well without pins, so
	 * gating the LIST on the pin store's version would hide a working list behind an
	 * update it does not need.
	 */
	assert.equal(
		desktopFeatureEnabled(
			{
				desktop_available: true,
				features: { session_catalogue: 3, session_pins: 1 },
			},
			"session_pins",
		),
		true,
	);
	/*
	 * ...and absent means CLOSED, which the renderer reads as "mount no pin at all"
	 * rather than "mount a disabled one": a reserved slot with nothing behind it
	 * advertises a feature the user cannot get.
	 */
	assert.equal(
		desktopFeatureEnabled(
			{ desktop_available: true, features: { session_catalogue: 3 } },
			"session_pins",
		),
		false,
	);
	assert.equal(
		desktopFeatureEnabled(
			{ desktop_available: false, features: { session_pins: 1 } },
			"session_pins",
		),
		false,
	);
	assert.equal(desktopFeatureEnabled(undefined, "session_pins"), false);
});
