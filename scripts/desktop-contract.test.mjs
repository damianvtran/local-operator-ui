import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { build } from "esbuild";

// Bundle in memory so this regression guard uses the shipped TS paths without
// adding a second app build, dependency tree, or permanent generated fixture.
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/main/desktop-transport"; export * from "./src/main/desktop-ipc";',
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
	const key = "API_TOKEN";
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
		[
			{ op: "legacy.agent.variables.list", agentId },
			`/v1/agents/${agentId}/execution-variables`,
			"GET",
		],
		[
			{
				op: "legacy.agent.variables.create",
				agentId,
				variable: { key, value: "v" },
			},
			`/v1/agents/${agentId}/execution-variables`,
			"POST",
			{ key, value: "v" },
		],
		[
			{ op: "legacy.agent.variables.get", agentId, key },
			`/v1/agents/${agentId}/execution-variables/${key}`,
			"GET",
		],
		[
			{
				op: "legacy.agent.variables.update",
				agentId,
				key,
				variable: { value: "w" },
			},
			`/v1/agents/${agentId}/execution-variables/${key}`,
			"PATCH",
			{ value: "w" },
		],
		[
			{ op: "legacy.agent.variables.delete", agentId, key },
			`/v1/agents/${agentId}/execution-variables/${key}`,
			"DELETE",
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

	// The variable key lands in the PATH, so a permissive value would let the
	// renderer address a route it was never given an operation for.
	const count = seen.length;
	for (const input of [
		{
			op: "legacy.agent.variables.get",
			agentId,
			key: "../../../v1/credentials",
		},
		{ op: "legacy.agent.variables.delete", agentId, key: "a/b" },
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
