import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
			'export * from "./src/main/desktop-transport"; export * from "./src/main/desktop-ipc"; export * from "./src/main/picker-directory"; export {desktopRequestByteBudget, MAX_DESKTOP_REQUEST_BYTES, MAX_DESKTOP_ENVELOPE_BYTES, MAX_DESKTOP_ENVELOPE_OVERHEAD_BYTES, DESKTOP_REQUEST_TOO_LARGE_DETAIL} from "./src/shared/desktop-contract";',
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
	requestDesktop,
	trustedDesktopFrame,
	registerDesktopIPC,
	guardForegroundReceipts,
	rememberPickedDirectory,
	withRememberedDirectory,
	desktopRequestByteBudget,
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
		{ op: "subagents.transcript", sessionId, childId, beforeId: "e".repeat(129) },
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
		{ op: "sessions.variables.update", sessionId, key: "a/b", value: "1", type: "int" },
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
		withRememberedDirectory("picker-test-file", { defaultPath: "/elsewhere" }, fallback)
			.defaultPath,
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
	const returned = withRememberedDirectory("picker-test-file", options, fallback);
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
			'export * from "./src/renderer/src/shared/api/local-operator/session-variables-api"; export { desktopRequestSchema, desktopEndpoint, isWritableVariableKey } from "./src/shared/desktop-contract";',
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
		"sessions.variables.update": {
			status: 200,
			message: "ok",
			result: { data: { state: "ok", variable: VARIABLE }, replayed: false },
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
	assert.equal(updated.value, "1234.5");
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
		assert.equal(isWritableVariableKey(key), false, `${key} must not be addressable`);
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
		assert.equal(isWritableVariableKey(key), true, `${key} must stay addressable`);
		const { path } = rendererDesktopEndpoint({
			op: "sessions.variables.delete",
			sessionId: SESSION,
			key,
		});
		assert.equal(new URL(path, "http://127.0.0.1:1111").pathname, `/v1/desktop/sessions/${SESSION}/variables/${encodeURIComponent(key)}`);
	}
});
