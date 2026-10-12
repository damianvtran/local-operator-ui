import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/shared/journal-order-query"; export * from "./src/shared/desktop-contract"; export * from "./src/main/desktop-stream";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const R = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const rendererBundle = await build({
	stdin: {
		contents:
			'export { subscribeDesktopStream } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	write: false,
});
const renderer = await import(
	`data:text/javascript;base64,${Buffer.from(rendererBundle.outputFiles[0].text).toString("base64")}`
);
const sessionId = "aaaaaaaaaaaa";
const cases = [
	["UUID", (i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`],
	["max ASCII", (i) => "a".repeat(125) + String(i).padStart(3, "0")],
	["max Unicode", (i) => "漢".repeat(125) + String(i).padStart(3, "0")],
	[
		"escaped punctuation",
		(i) => "?:/%&+".repeat(20) + String(i).padStart(3, "0"),
	],
];

/** A real 8 KiB HTTP parser discriminates byte-safe URLs from count-only ones.
 * The browser seam captures the shipped EventSource URL, NOT browser scheduling;
 * native exercises the production relay's actual fetch/SSE read. Core/proxy E2E
 * is separate evidence, not asserted by this tiny transport peer. */
test("GET/history/browser/native targets fit real HTTP parsing and use the same encoded budget", async () => {
	const received = [];
	const server = createServer({ maxHeaderSize: 8192 }, (req, res) => {
		const url = new URL(req.url, "http://peer");
		received.push({ path: req.url, ids: url.searchParams.getAll("order_ids") });
		if (url.pathname.endsWith("/events")) {
			res.writeHead(200, { "Content-Type": "text/event-stream" });
			res.end('data: {"type":"heartbeat"}\n\n');
		} else {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ids: url.searchParams.getAll("order_ids") }));
		}
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	const previousWindow = globalThis.window;
	const previousEventSource = globalThis.EventSource;
	let browserPath;
	globalThis.window = {};
	globalThis.EventSource = class {
		constructor(path) {
			browserPath = path;
		}
		close() {}
	};
	try {
		for (const [name, makeId] of cases) {
			const orderIds = Array.from({ length: 512 }, (_, i) => makeId(i));
			for (const request of [
				{ op: "sessions.get", sessionId, journalOrder: true, orderIds },
				{
					op: "sessions.history",
					sessionId,
					journalOrder: true,
					orderIds,
					beforeId: "漢".repeat(128),
					limit: 500,
					openFrame: true,
				},
			]) {
				const { path } = R.desktopEndpoint(request);
				assert.ok(Buffer.byteLength(path) <= R.JOURNAL_ORDER_QUERY_BYTES, name);
				const response = await fetch(origin + path);
				assert.equal(response.status, 200, `${name} ${request.op}`);
				const carried = (await response.json()).ids;
				assert.ok(carried.length > 0 && carried.length < 512);
				assert.deepEqual(carried, orderIds.slice(0, carried.length));
			}
			const dispose = renderer.subscribeDesktopStream(
				{
					sessionId,
					epoch: "e".repeat(128),
					afterSeq: 999999,
					openFrame: true,
					journalOrder: true,
					orderIds,
				},
				() => {},
			);
			assert.ok(Buffer.byteLength(browserPath) <= R.JOURNAL_ORDER_QUERY_BYTES);
			const response = await fetch(origin + browserPath);
			assert.equal(response.status, 200, `${name} browser URL`);
			const browserIds = (await response.json()).ids;
			assert.deepEqual(browserIds, orderIds.slice(0, browserIds.length));
			dispose();

			const relay = new R.DesktopStreamRelay(origin, "synthetic-peer-token");
			const events = [];
			try {
				await new Promise((resolve, reject) => {
					const timer = setTimeout(
						() => reject(new Error(`${name} relay did not end`)),
						5000,
					);
					relay.subscribe(
						{
							sessionId,
							epoch: "e".repeat(128),
							afterSeq: 999999,
							openFrame: true,
							journalOrder: true,
							orderIds,
						},
						(event) => {
							events.push(event);
							if (event.kind === "end") {
								clearTimeout(timer);
								resolve();
							}
						},
					);
				});
				assert.ok(
					events.some((event) => event.kind === "data"),
					`${name} actual native SSE data`,
				);
				assert.ok(
					!events.some((event) => event.kind === "error"),
					JSON.stringify(events),
				);
				const native = received.at(-1);
				assert.ok(
					Buffer.byteLength(native.path) <= R.JOURNAL_ORDER_QUERY_BYTES,
				);
				assert.deepEqual(native.ids, orderIds.slice(0, native.ids.length));
			} finally {
				relay.dispose();
			}
		}
	} finally {
		globalThis.window = previousWindow;
		globalThis.EventSource = previousEventSource;
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
});
