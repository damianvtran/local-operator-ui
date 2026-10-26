import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Fake CDP exercises the shipped action and pool lifecycle, not native Chromium.
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/browser/actions/network";',
			'export * from "./src/main/browser/protocol";',
			'export * from "./src/main/browser/cdp";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

function fixture() {
	const events = new Set();
	const commands = [];
	const views = new Map([[1, { id: 1 }]]);
	const ctx = {
		registry: { requireSurface: () => ({ view: { webContents: { id: 1 } } }) },
		cdp: {
			send: async (_contents, method) => {
				commands.push(method);
			},
			subscribe: (_id, listener) => {
				events.add(listener);
				return () => events.delete(listener);
			},
		},
	};
	const emit = (method, params) => {
		for (const listener of events) listener(method, params);
	};
	const start = (params = {}) =>
		mod.networkStart(
			ctx,
			{ tab: "tab", requester: "session:a", ...params },
			"request",
		);
	return { ctx, commands, emit, start, views };
}

test("safe URLs retain only query keys and bodies need exact approved scope", async () => {
	assert.equal(
		mod.safeNetworkUrl(
			"https://u:p@example.test/a?token=secret&x=1&x=2#private",
		),
		"https://example.test/a?token&x",
	);
	const { start } = fixture();
	await assert.rejects(
		start({
			include_request_body: true,
			url: "file:///etc/passwd",
			approved: true,
		}),
		/network body capture requires an exact HTTP/,
	);
	// A bare origin is the root path, which is a valid exact scope; it is not a
	// wildcard, and the body test below pins that a sibling path never matches.
	const root = await start({
		include_request_body: true,
		url: "https://root.test",
		approved: true,
	});
	assert.equal(root.active, true);
	await assert.rejects(
		start({
			include_request_body: true,
			url: "https://example.test/a",
			approved: false,
		}),
		/approved=true/,
	);
	const active = await start({
		include_request_body: true,
		url: "https://example.test/a?secret=value",
		approved: true,
	});
	assert.equal(active.active, true);
	assert.equal(active.count, 0);
});

test("metadata captures completion, redirects, failures and no headers", async () => {
	const { ctx, emit, start } = fixture();
	await start();
	emit("Network.requestWillBeSent", {
		requestId: "r",
		request: { url: "https://e.test/first", method: "GET" },
		timestamp: 9,
	});
	emit("Network.requestWillBeSent", {
		requestId: "r",
		request: {
			url: "https://u:p@e.test/x?key=value",
			method: "GET",
			headers: { authorization: "secret" },
		},
		timestamp: 10,
		wallTime: 100,
		type: "Document",
		loaderId: "l",
		frameId: "f",
		redirectRequestId: "r",
		redirectResponse: { status: 302 },
	});
	assert.equal(
		mod.networkRead(ctx, { tab: "tab", requester: "session:a" }, "request")
			.entries[1].status,
		undefined,
		"a redirect hop's own status is unknown until its response arrives",
	);
	emit("Network.responseReceived", {
		requestId: "r",
		response: { status: 200, fromDiskCache: true },
	});
	emit("Network.loadingFinished", {
		requestId: "r",
		timestamp: 10.025,
		encodedDataLength: 42,
	});
	emit("Network.requestWillBeSent", {
		requestId: "failed",
		request: { url: "https://e.test/fail", method: "GET" },
		timestamp: 11,
	});
	emit("Network.loadingFailed", {
		requestId: "failed",
		timestamp: 11.01,
		errorText: "net::ERR",
		canceled: true,
	});
	const result = mod.networkRead(
		ctx,
		{ tab: "tab", requester: "session:a" },
		"request",
	);
	assert.equal(result.count, 3);
	assert.equal(result.entries[0].status, 302);
	assert.equal(result.entries[0].redirect_request_id, "r");
	assert.equal(result.entries[0].redirect_to_id, result.entries[1].id);
	assert.equal(result.entries[1].url, "https://e.test/x?key");
	assert.equal(result.entries[1].duration_ms, 25);
	assert.equal(result.entries[1].status, 200);
	assert.equal(result.entries[1].from_cache, true);
	assert.equal(result.entries[1].redirect_from_id, result.entries[0].id);
	assert.equal(result.entries[1].encoded_data_length, 42);
	assert.equal(result.entries[2].error_text, "net::ERR");
	assert.equal(result.entries[2].canceled, true);
	assert.equal(JSON.stringify(result).includes("secret"), false);
	assert.equal(JSON.stringify(result).includes("authorization"), false);
});

test("request bodies are double opt-in, exact origin-path scoped and capped", async () => {
	const { ctx, emit, start } = fixture();
	await start({
		include_request_body: true,
		url: "https://e.test/api?ignored=yes",
		approved: true,
	});
	emit("Network.requestWillBeSent", {
		requestId: "yes",
		request: {
			url: "https://e.test/api?other=query",
			method: "POST",
			postData: "private-body",
		},
	});
	emit("Network.requestWillBeSent", {
		requestId: "no",
		request: {
			url: "https://e.test/other",
			method: "POST",
			postData: "must-not-capture",
		},
	});
	let result = mod.networkRead(
		ctx,
		{ tab: "tab", requester: "session:a" },
		"request",
	);
	assert.equal("request_body_base64" in result.entries[0], false);
	assert.throws(
		() =>
			mod.networkRead(
				ctx,
				{
					tab: "tab",
					requester: "session:a",
					include_request_body: true,
					url: "https://e.test/api",
					approved: false,
				},
				"request",
			),
		/approved=true/,
	);
	result = mod.networkRead(
		ctx,
		{
			tab: "tab",
			requester: "session:a",
			include_request_body: true,
			url: "https://e.test/api?q=different",
			approved: true,
		},
		"request",
	);
	assert.equal(
		Buffer.from(result.entries[0].request_body_base64, "base64").toString(),
		"private-body",
	);
	assert.equal("request_body_base64" in result.entries[1], false);
	assert.throws(
		() =>
			mod.networkRead(
				ctx,
				{
					tab: "tab",
					requester: "session:a",
					include_request_body: true,
					url: "https://e.test/other",
					approved: true,
				},
				"request",
			),
		/not captured/,
	);
});

test("filters, after_id, clear and replacement preserve owner isolation", async () => {
	const { ctx, emit, start } = fixture();
	await start();
	for (let i = 0; i < 3; i++)
		emit("Network.requestWillBeSent", {
			requestId: `r${i}`,
			request: { url: `https://e.test/${i}`, method: i === 1 ? "POST" : "GET" },
		});
	let result = mod.networkRead(
		ctx,
		{
			tab: "tab",
			requester: "session:a",
			after_id: 1,
			method: "post",
			limit: 1,
		},
		"request",
	);
	assert.deepEqual(
		result.entries.map((entry) => entry.request_id),
		["r1"],
	);
	assert.throws(
		() =>
			mod.networkRead(
				ctx,
				{ tab: "tab", requester: "session:a", limit: 201 },
				"request",
			),
		/limit/,
	);
	assert.throws(
		() =>
			mod.networkRead(
				ctx,
				{ tab: "tab", requester: "session:a", url: "not a url" },
				"request",
			),
		/url filter must be an http/,
	);
	await assert.rejects(
		mod.networkStop(ctx, { tab: "tab", requester: "session:b" }, "request"),
		/another requester/,
	);
	result = mod.networkClear(
		ctx,
		{ tab: "tab", requester: "session:a" },
		"request",
	);
	assert.equal(result.count, 0);
	await start();
	emit("Network.requestWillBeSent", {
		requestId: "new",
		request: { url: "https://e.test/new", method: "GET" },
	});
	assert.equal(
		mod.networkRead(ctx, { tab: "tab", requester: "session:a" }, "request")
			.entries[0].request_id,
		"new",
	);
	await mod.networkStop(ctx, { tab: "tab", requester: "session:a" }, "request");
	assert.equal(
		mod.networkRead(ctx, { tab: "tab", requester: "session:a" }, "request")
			.active,
		false,
	);
});

test("entry ring drops oldest and detach destroys all capture state", async () => {
	const { ctx, emit, start } = fixture();
	await start();
	for (let i = 0; i < 505; i++)
		emit("Network.requestWillBeSent", {
			requestId: `r${i}`,
			request: { url: `https://e.test/${i}`, method: "GET" },
		});
	const result = mod.networkRead(
		ctx,
		{ tab: "tab", requester: "session:a", limit: 200 },
		"request",
	);
	assert.equal(result.count, 500);
	assert.equal(result.dropped_entries, 5);
	assert.equal(result.entries[0].request_id, "r5");
	mod.stopNetworkCapture(1);
	assert.throws(
		() =>
			mod.networkRead(ctx, { tab: "tab", requester: "session:a" }, "request"),
		/has not started/,
	);
});

test("body ring evicts oldest bodies and reports their dropped count", async () => {
	const { ctx, emit, start } = fixture();
	await start({
		include_request_body: true,
		url: "https://e.test/api",
		approved: true,
	});
	for (let i = 0; i < 5; i++) {
		emit("Network.requestWillBeSent", {
			requestId: `r${i}`,
			request: {
				url: "https://e.test/api",
				method: "POST",
				postData: "x".repeat(64 * 1024),
			},
		});
	}
	emit("Network.requestWillBeSent", {
		requestId: "large",
		request: {
			url: "https://e.test/api",
			method: "POST",
			postData: "x".repeat(64 * 1024 + 1),
		},
	});
	const result = mod.networkRead(
		ctx,
		{
			tab: "tab",
			requester: "session:a",
			include_request_body: true,
			url: "https://e.test/api",
			approved: true,
			limit: 200,
		},
		"request",
	);
	assert.equal(result.body_count, 4);
	assert.equal(result.body_bytes, 256 * 1024);
	assert.equal(result.dropped_bodies, 2);
	assert.equal("request_body_base64" in result.entries[0], false);
});

test("a real CDP pool detach event forgets the capture and its events", async () => {
	const { EventEmitter } = await import("node:events");
	class FakeDebugger extends EventEmitter {
		attached = false;
		attach() {
			this.attached = true;
		}
		detach() {
			this.attached = false;
		}
		isAttached() {
			return this.attached;
		}
		async sendCommand() {
			return {};
		}
	}
	const cdp = new mod.CdpPool();
	const contents = {
		id: 9001,
		debugger: new FakeDebugger(),
		isDestroyed: () => false,
		getURL: () => "https://e.test/",
		loadURL: async () => {},
	};
	const ctx = {
		cdp,
		registry: { requireSurface: () => ({ view: { webContents: contents } }) },
	};
	await cdp.attach(contents);
	await mod.networkStart(
		ctx,
		{ tab: "tab", requester: "session:a" },
		"request",
	);
	contents.debugger.emit("message", {}, "Network.requestWillBeSent", {
		requestId: "r",
		request: { url: "https://e.test/private", method: "GET" },
	});
	assert.equal(
		mod.networkRead(ctx, { tab: "tab", requester: "session:a" }, "request")
			.count,
		1,
	);
	contents.debugger.emit("detach", {}, "canceled_by_user");
	assert.throws(
		() =>
			mod.networkRead(ctx, { tab: "tab", requester: "session:a" }, "request"),
		/has not started/,
	);
});

test("the metadata byte cap binds before the entry cap when URLs are long", async () => {
	const { ctx, emit, start } = fixture();
	await start();
	const longPath = "x".repeat(2000);
	for (let i = 0; i < 505; i++) {
		emit("Network.requestWillBeSent", {
			requestId: `r${i}`,
			request: { url: `https://e.test/${longPath}/${i}`, method: "GET" },
		});
	}
	const result = mod.networkRead(
		ctx,
		{ tab: "tab", requester: "session:a", limit: 0 },
		"request",
	);
	assert.ok(
		result.count < 500,
		`the 1 MiB ceiling bound first (${result.count})`,
	);
	assert.ok(result.dropped_entries > 5);
});

test("protocol exposes desktop methods and budgets", () => {
	for (const method of [
		"network_start",
		"network_stop",
		"network_read",
		"network_clear",
	]) {
		assert.equal(mod.isMethod(method), true);
		assert.equal(mod.COMMAND_TIMEOUTS_S[method], 20);
	}
});
