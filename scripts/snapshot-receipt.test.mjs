import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { build } from "esbuild";

// Bundle the shipping relay/helper, not a transcription of their timing math.
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/main/desktop-stream"; export * from "./src/shared/snapshot-receipt";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	DesktopStreamRelay,
	stampSnapshotSend,
	enterSnapshotRenderer,
	deliverSnapshot,
	formatSnapshotReceipt,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const SESSION = "123456abcdef";
const fields = (line) =>
	Object.fromEntries(
		line
			.split(" ")
			.slice(1)
			.map((part) => part.split("=")),
	);

// A deterministic monotonic clock lets negative controls isolate one stage,
// rather than turn host load into a timing assertion. Fetch still uses a real
// loopback socket and SSE records, including a tiny open and later snapshots.
async function relayRun(observerDelay, tracing = true) {
	let now = 0;
	const original = globalThis.performance;
	globalThis.performance = { timeOrigin: 1_000, now: () => now };
	const frames = [
		JSON.stringify({ type: "open" }),
		JSON.stringify({
			type: "snapshot",
			history: ["synthetic private payload"],
			seq: 1,
		}),
		JSON.stringify({ type: "snapshot", seq: 2 }),
		JSON.stringify({ type: "heartbeat" }),
	];
	const server = createServer((_req, res) => {
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		res.end(frames.map((frame) => `data: ${frame}\n\n`).join(""));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const relay = new DesktopStreamRelay(
		`http://127.0.0.1:${server.address().port}`,
		"synthetic-test-credential",
	);
	relay.observe((_session, data) => {
		const parsed = JSON.parse(data);
		if (parsed.type === "snapshot") {
			now += observerDelay;
			if (tracing) return true;
		}
	});
	const events = [];
	try {
		await new Promise((resolve, reject) => {
			relay.subscribe({ sessionId: SESSION }, (event) => {
				events.push(event);
				if (event.kind === "error") reject(new Error(event.detail));
				if (event.kind === "end") resolve();
			});
		});
		assert.deepEqual(
			events.filter((e) => e.kind === "data").map((e) => e.data),
			frames,
		);
		return events;
	} finally {
		relay.dispose();
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
		globalThis.performance = original;
	}
}

test("real SSE relay preserves raw frames with tracing on/off; only first snapshot gets a receipt", async () => {
	const off = await relayRun(0, false);
	const on = await relayRun(0);
	assert.deepEqual(
		on.map((e) => [e.kind, e.data]),
		off.map((e) => [e.kind, e.data]),
	);
	assert.equal(off.filter((e) => e.receipt).length, 0);
	assert.equal(on.filter((e) => e.receipt).length, 1);
	assert.equal(
		on[0].receipt,
		undefined,
		"tiny open is a negative control, not a snapshot",
	);
	assert.equal(on[1].receipt.chars, on[1].data.length);
	assert.equal(on[1].receipt.streamId, on[1].streamId);
	assert.equal(on[1].receipt.sessionId, SESSION);
});

test("delaying the real observer shifts only its own local span", async () => {
	const control = (await relayRun(0))[1].receipt;
	const delayed = (await relayRun(40))[1].receipt;
	assert.equal(delayed.mainObserverMs - control.mainObserverMs, 40);
	for (const key of ["mainFoldMs", "mainEmitMs", "mainRecordEpochMs"])
		assert.equal(delayed[key], control[key]);
});

test("local delivery/parse spans and approximate bridges stay separate and payload-free", () => {
	const original = globalThis.performance;
	let now = 100;
	globalThis.performance = { timeOrigin: 1_000, now: () => now };
	try {
		const receipt = {
			streamId: "stream_1",
			sessionId: SESSION,
			chars: 90,
			mainRecordEpochMs: 1_000,
			mainFoldMs: 1,
			mainObserverMs: 40,
			mainEmitMs: 0,
		};
		stampSnapshotSend(receipt);
		receipt.preloadReceiptEpochMs = 1_125;
		receipt.preloadReadyMs = 5;
		now = 135;
		enterSnapshotRenderer(receipt);
		receipt.bufferedAt = 135;
		now = 155;
		deliverSnapshot(receipt, "replay");
		const control = fields(formatSnapshotReceipt(receipt, 7, 157, 160));
		const delayedParse = fields(formatSnapshotReceipt(receipt, 7, 157, 190));
		assert.equal(control.ipcApproxMs, "25.000");
		assert.equal(control.bridgeApproxMs, "5.000");
		assert.equal(control.bufferMs, "20.000");
		assert.equal(control.deliveryToParseMs, "2.000");
		assert.equal(control.parseMs, "3.000");
		assert.deepEqual({ ...delayedParse, parseMs: control.parseMs }, control);
		assert.equal(delayedParse.parseMs, "33.000");
		const line = formatSnapshotReceipt(
			{
				...receipt,
				sessionId: "private title?token=secret",
				streamId: "https://private/?token=secret",
			},
			7,
			157,
			160,
		);
		assert.ok(!/private|secret|https|synthetic/.test(line));
		assert.match(line, /session=\? streamId=\?/);
		console.log(`EXPECTED ${formatSnapshotReceipt(receipt, 7, 157, 160)}`);
	} finally {
		globalThis.performance = original;
	}
});

// Execute the real preload listener against an Electron boundary fixture. This
// specifically distinguishes IPC receipt from the subscription-id promise wait.
const ipc = new EventEmitter();
const pending = [];
ipc.invoke = (channel) =>
	channel === "desktop-stream-subscribe"
		? new Promise((resolve) => pending.push(resolve))
		: Promise.resolve(null);
ipc.send = () => {};
ipc.sendSync = () => undefined;
globalThis.__receiptIpc = ipc;
process.contextIsolated = true;
const preloadBundle = await build({
	stdin: {
		contents: 'import "./src/preload/index";',
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
					loader: "js",
					contents: `
			export const ipcRenderer = globalThis.__receiptIpc;
			export const contextBridge = { exposeInMainWorld: (key, value) => { if (key === "api") globalThis.__receiptApi = value; } };
			export const webFrame = { insertCSS: () => "", removeInsertedCSS: () => {}, setZoomFactor: () => {}, setVisualZoomLevelLimits: async () => {} };
			export const webUtils = { getPathForFile: () => "" };
			export default { ipcRenderer, contextBridge, webFrame, webUtils };
		`,
				}));
			},
		},
	],
});
await import(
	`data:text/javascript;base64,${Buffer.from(preloadBundle.outputFiles[0].text).toString("base64")}`
);

test("preload stamps receipt before awaiting id and isolates listeners; unsubscribe removes correlations", async () => {
	const original = globalThis.performance;
	let now = 10;
	globalThis.performance = { timeOrigin: 1_000, now: () => now };
	const received = [];
	const unrelated = [];
	const a = globalThis.__receiptApi.desktop.stream.subscribe(
		{ sessionId: SESSION },
		(e) => received.push(e),
	);
	const b = globalThis.__receiptApi.desktop.stream.subscribe(
		{ sessionId: SESSION },
		(e) => unrelated.push(e),
	);
	try {
		const receipt = {
			streamId: "s1",
			sessionId: SESSION,
			chars: 19,
			mainRecordEpochMs: 1_000,
			mainFoldMs: 0,
			mainObserverMs: 0,
			mainEmitMs: 0,
			mainSendEpochMs: 1_005,
		};
		const raw = '{"type":"snapshot"}';
		ipc.emit(
			"desktop-stream-event",
			{},
			{ streamId: "s1", kind: "data", data: raw, receipt },
		);
		assert.equal(received.length, 0);
		now = 50;
		pending.shift()({ streamId: "s1" });
		pending.shift()({ streamId: "s2" });
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(received.length, 1);
		assert.equal(unrelated.length, 0);
		assert.equal(received[0].data, raw);
		assert.equal(received[0].receipt.preloadReceiptEpochMs, 1_010);
		assert.equal(received[0].receipt.preloadReadyMs, 40);
		assert.equal(
			receipt.preloadReceiptEpochMs,
			undefined,
			"other listeners cannot mutate shared IPC receipt",
		);
		const measured = fields(
			formatSnapshotReceipt(received[0].receipt, 1, 60, 65),
		);
		assert.equal(measured.ipcApproxMs, "5.000");
		assert.equal(measured.preloadReadyMs, "40.000");
	} finally {
		a.dispose();
		b.dispose();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(ipc.listenerCount("desktop-stream-event"), 0);
		globalThis.performance = original;
	}
});
