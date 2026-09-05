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
const { requestDesktop, trustedDesktopFrame, registerDesktopIPC } =
	await import(
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
		[{ op: "legacy.agents.list", page: 2, perPage: 25 }, "/v1/agents?page=2&per_page=25", "GET"],
		[
			{ op: "legacy.agents.list", page: 1, perPage: 10, name: "qa", direction: "desc" },
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
			{ op: "legacy.models", provider: "openai", sort: "name", direction: "ascending" },
			"/v1/models?provider=openai&sort=name&direction=ascending",
			"GET",
		],
		[{ op: "auth.probe", provider: "ollama" }, "/v1/auth/providers/ollama/probe", "POST"],
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

test("control catalogues, lifecycle, MCP and Radient use closed main-owned transport", async () => {
	const sessionId = "123456abcdef";
	const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
	for (const [operation, path, method] of [
		[{ op: "legacy.models" }, "/v1/models", "GET"],
		[{ op: "legacy.agent.upload", agentId: "fixture-agent" }, "/v1/agents/fixture-agent/upload", "POST"],
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
