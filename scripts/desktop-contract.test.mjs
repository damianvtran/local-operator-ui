import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { build } from "esbuild";

// Bundle in memory so this regression guard uses the shipped TS paths without
// adding a second app build, dependency tree, or permanent generated fixture.
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/desktop-transport"; export * from "./src/main/desktop-ipc";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [{ name: "electron-fixture", setup(builder) {
		builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "fixture" }));
		builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
			export const ipcMain = { handle: (name, handler) => globalThis.__desktopHandlers.set(name, handler) };
			export const shell = { openExternal: async (url) => { globalThis.__desktopOpens.push(url); } };
		`, loader: "js" }));
	} }],
});
const { requestDesktop, trustedDesktopFrame, registerDesktopIPC } = await import(
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
		seen.push({ path: req.url, method: req.method, authorization: req.headers.authorization,
			body: Buffer.concat(chunks).toString() });
		if (req.url === "/v1/settings/redirect") {
			res.writeHead(302, { Location: `${url}/stolen` });
			res.end();
			return;
		}
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify({ result: req.url === "/v1/capabilities" ? {
			desktop_available: true, features: { auth: 1, settings: 1 },
		} : { saved: true } }));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
	await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("real HTTP receives only allowlisted route and main-owned bearer", async () => {
	const response = await requestDesktop({ op: "auth.key", provider: "openai", value: "synthetic-provider-key" }, url, token);
	assert.equal(response.status, 200);
	const last = seen.at(-1);
	assert.equal(last.path, "/v1/auth/providers/openai/key");
	assert.equal(last.method, "PUT");
	assert.equal(last.authorization, `Bearer ${token}`);
	assert.deepEqual(JSON.parse(last.body), { value: "synthetic-provider-key" });
	assert.ok(!JSON.stringify(response).includes(token));
});

test("unpaired desktop fails closed but public negotiation explains unavailable controls", async () => {
	assert.equal((await requestDesktop({ op: "settings.list" }, url, null)).status, 503);
	const response = await requestDesktop({ op: "capabilities" }, url, null);
	assert.equal(response.body.result.desktop_available, false);
});

test("arbitrary URL, injected headers, path traversal and wrong body types never reach HTTP", async () => {
	const count = seen.length;
	for (const request of [
		{ op: "fetch", url: "https://evil.example" },
		{ op: "auth.key", provider: "../config", value: "secret" },
		{ op: "auth.key", provider: "openai", value: "secret", headers: { Authorization: "bad" } },
		{ op: "config.update", value: { arbitrary_secret: "not-allowed" } },
		{ op: "auth.input", id: "id", value: "secret" },
	]) {
		const response = await requestDesktop(request, url, token);
		assert.equal(response.status, 422);
		assert.ok(!JSON.stringify(response).includes("secret"));
	}
	assert.equal(seen.length, count);
});

test("redirect cannot forward the main capability", async () => {
	const response = await requestDesktop({ op: "settings.edit", key: "redirect", value: true }, url, token);
	assert.equal(response.status, 503);
	assert.ok(!seen.some((request) => request.path === "/stolen"));
});

test("sender URL allows only packaged file or exact dev origin", () => {
	assert.ok(trustedDesktopFrame("file:///app/index.html#/settings", "file:///app/index.html"));
	assert.ok(!trustedDesktopFrame("file:///app/other.html", "file:///app/index.html"));
	assert.ok(!trustedDesktopFrame("https://evil.example", "http://localhost:5187"));
	assert.ok(!trustedDesktopFrame("http://localhost:5188", "http://localhost:5187"));
});

test("IPC rejects other frames and opens only backend-returned authorization once", async () => {
	globalThis.__desktopHandlers = new Map();
	globalThis.__desktopOpens = [];
	const frame = { url: "file:///app/index.html" };
	const contents = { mainFrame: frame };
	const owner = { webContents: contents, isDestroyed: () => false };
	const calls = [];
	registerDesktopIPC(() => owner, "file:///app/index.html", async (request) => {
		calls.push(request);
		return { status: 200, body: { result: { auth_url: "https://provider.example/authorize?state=test" } } };
	});
	const invoke = globalThis.__desktopHandlers.get("desktop-request");
	assert.throws(() => invoke({ sender: {}, senderFrame: frame }, { op: "settings.list" }));
	assert.throws(() => invoke({ sender: contents, senderFrame: { url: frame.url } }, { op: "settings.list" }));
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
