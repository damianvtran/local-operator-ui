/**
 * The live composite of an overlay-suppressed browser page: main's controller
 * (`src/main/browser/composite-bridge.ts`), its registry seam (subscribe BEFORE
 * the view is detached), the owner-gated IPC replies, and the renderer's
 * draw/clear rule (`src/renderer/src/features/browser/model/composite-sink.ts`).
 *
 * Pure units with fake webContents: a real frame stream needs a SHOWN window
 * (a never-shown window composites nothing), which is native QA's lane.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/browser/composite-bridge";',
			'export * from "./src/main/browser/registry";',
			'export * from "./src/main/browser/ipc";',
			'export { ipcMain } from "electron";',
			'export * from "./src/renderer/src/features/browser/model/composite-sink";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	alias: {
		electron: join(process.cwd(), "scripts/browser-electron-stub.ts"),
	},
});
const {
	CompositeBridge,
	BROWSER_COMPOSITE_FRAME,
	BROWSER_COMPOSITE_CLEAR,
	TabRegistry,
	registerBrowserIpc,
	unregisterBrowserIpc,
	BROWSER_IPC_CHANNELS,
	ipcMain,
	CompositeSink,
	bgraToRgba,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** A webContents with a controllable frame subscription. */
function fakeSource(id = 7) {
	const listeners = new Map();
	const source = {
		id,
		destroyed: false,
		subscribed: null,
		onlyDirty: null,
		begins: 0,
		ends: 0,
		invalidations: 0,
		isDestroyed: () => source.destroyed,
		beginFrameSubscription(onlyDirty, callback) {
			source.begins += 1;
			source.onlyDirty = onlyDirty;
			source.subscribed = callback;
		},
		endFrameSubscription() {
			source.ends += 1;
			source.subscribed = null;
		},
		invalidate() {
			source.invalidations += 1;
		},
		on(event, listener) {
			if (!listeners.has(event)) listeners.set(event, new Set());
			listeners.get(event).add(listener);
		},
		removeListener(event, listener) {
			listeners.get(event)?.delete(listener);
		},
		emit(event, ...args) {
			for (const listener of [...(listeners.get(event) ?? [])])
				listener(...args);
		},
		listenerCount: (event) => listeners.get(event)?.size ?? 0,
		/** Deliver one full frame of a single colour byte. */
		paint(fill = 1, width = 4, height = 2) {
			source.subscribed?.({
				isEmpty: () => false,
				getSize: () => ({ width, height }),
				toBitmap: () => new Uint8Array(width * height * 4).fill(fill),
			});
		},
	};
	return source;
}

function fakeTarget() {
	const target = {
		sent: [],
		destroyed: false,
		isDestroyed: () => target.destroyed,
		send: (channel, payload) => target.sent.push({ channel, payload }),
		frames: () =>
			target.sent
				.filter((m) => m.channel === BROWSER_COMPOSITE_FRAME)
				.map((m) => m.payload),
		clears: () =>
			target.sent
				.filter((m) => m.channel === BROWSER_COMPOSITE_CLEAR)
				.map((m) => m.payload),
	};
	return target;
}

const CANNOT_USE = /cannot use/;
const MUST_BE_BOOLEAN = /boolean/;

const RECT = { x: 0, y: 40, width: 800, height: 450 };

function rig() {
	const source = fakeSource();
	const target = fakeTarget();
	const world = {
		eligible: { tabId: 3, source, documentEpoch: 0, rect: RECT },
	};
	const bridge = new CompositeBridge({
		eligible: () => world.eligible,
		target: () => target,
	});
	return { source, target, world, bridge };
}

test("subscribes to FULL frames only and asks for a first repaint", () => {
	const { source, bridge } = rig();
	bridge.sync();
	assert.equal(source.begins, 1);
	assert.equal(
		source.onlyDirty,
		false,
		"dirty-rect patches would corrupt the picture once one is dropped",
	);
	assert.equal(source.invalidations, 1);
	bridge.sync();
	assert.equal(source.begins, 1, "an unchanged state is a no-op");
});

test("frames reach the owner shell only after it registers, carrying full identity", () => {
	const { source, target, bridge } = rig();
	bridge.sync();
	source.paint(9);
	assert.equal(target.frames().length, 0, "no consumer, nothing sent");
	bridge.setConsumer(true);
	const [frame] = target.frames();
	assert.ok(frame, "the buffered latest frame is sent on registration");
	assert.deepEqual(
		{ ...frame, pixels: frame.pixels.byteLength },
		{
			generation: 1,
			tabId: 3,
			webContentsId: 7,
			documentEpoch: 0,
			frameSeq: 1,
			width: 4,
			height: 2,
			pixels: 32,
		},
	);
});

test("backpressure: one in flight, one replaceable latest; only the matching ACK releases", () => {
	const { source, target, bridge } = rig();
	bridge.setConsumer(true);
	bridge.sync();
	source.paint(1);
	source.paint(2);
	source.paint(3);
	assert.equal(
		target.frames().length,
		1,
		"never queues behind an unacked frame",
	);
	assert.equal(
		bridge.ack({ generation: 1, frameSeq: 2 }),
		false,
		"not in flight",
	);
	assert.equal(
		bridge.ack({ generation: 99, frameSeq: 1 }),
		false,
		"forged generation",
	);
	assert.equal(bridge.ack("1:1"), false, "malformed");
	assert.equal(bridge.ack({ generation: 1, frameSeq: 1 }), true);
	const frames = target.frames();
	assert.equal(frames.length, 2);
	assert.equal(frames[1].frameSeq, 3, "the LATEST frame, intermediate dropped");
	assert.equal(frames[1].pixels[0], 3);
	assert.equal(
		bridge.ack({ generation: 1, frameSeq: 1 }),
		false,
		"duplicate ACK",
	);
	assert.equal(bridge.ack({ generation: 1, frameSeq: 3 }), true);
	assert.equal(target.frames().length, 2, "nothing newer, nothing sent");
	source.paint(4);
	assert.equal(target.frames().length, 3, "idle pipe sends immediately");
});

test("eligibility loss, tab/rect/epoch change each end the generation with a CLEAR", () => {
	const { source, target, world, bridge } = rig();
	bridge.setConsumer(true);
	bridge.sync();
	source.paint();
	world.eligible = { ...world.eligible, rect: { ...RECT, width: 700 } };
	bridge.sync();
	assert.deepEqual(target.clears().at(-1), {
		generation: 1,
		reason: "changed",
	});
	assert.equal(source.ends, 1);
	assert.equal(bridge.activeGeneration, 2);
	assert.equal(
		bridge.ack({ generation: 1, frameSeq: 1 }),
		false,
		"a late ACK from the ended generation is refused",
	);
	world.eligible = { ...world.eligible, documentEpoch: 1 };
	bridge.sync();
	assert.equal(bridge.activeGeneration, 3);
	const other = fakeSource(8);
	world.eligible = { ...world.eligible, tabId: 4, source: other };
	bridge.sync();
	assert.equal(bridge.activeGeneration, 4);
	assert.equal(other.begins, 1);
	world.eligible = null; // overlay closed
	bridge.sync();
	assert.equal(bridge.activeGeneration, null);
	assert.deepEqual(target.clears().at(-1), {
		generation: 4,
		reason: "ineligible",
	});
	assert.equal(other.subscribed, null);
	assert.equal(
		other.listenerCount("did-start-navigation"),
		0,
		"listeners detached",
	);
	other.paint();
	assert.equal(target.frames().length, 1, "no frame after the stream ended");
});

test("navigation start, crash and destruction invalidate; same-document and subframe do not", () => {
	const { source, target, bridge } = rig();
	bridge.setConsumer(true);
	bridge.sync();
	source.emit("did-start-navigation", {
		isMainFrame: true,
		isSameDocument: true,
	});
	source.emit("did-start-navigation", {
		isMainFrame: false,
		isSameDocument: false,
	});
	assert.equal(bridge.activeGeneration, 1);
	source.emit("did-start-navigation", {
		isMainFrame: true,
		isSameDocument: false,
	});
	assert.equal(bridge.activeGeneration, 2, "cleared and restarted");
	assert.equal(target.clears().at(-1).reason, "navigation");
	source.emit("render-process-gone", {});
	assert.equal(target.clears().at(-1).reason, "page-gone");
	source.destroyed = true;
	source.emit("destroyed");
	assert.equal(bridge.activeGeneration, null);
	assert.equal(target.clears().at(-1).reason, "page-destroyed");
});

test("a consumer reset forgets the in-flight frame and resends the latest", () => {
	const { source, target, bridge } = rig();
	bridge.setConsumer(true);
	bridge.sync();
	source.paint(5);
	bridge.setConsumer(false); // shell reloaded: the in-flight frame is never ACKed
	source.paint(6);
	assert.equal(target.frames().length, 1);
	bridge.setConsumer(true);
	assert.equal(target.frames().length, 2);
	assert.equal(target.frames()[1].pixels[0], 6);
});

test("dispose ends the subscription, drops buffers, clears and ignores later calls", () => {
	const { source, target, bridge } = rig();
	bridge.sync();
	source.paint();
	bridge.dispose();
	assert.equal(source.subscribed, null);
	assert.equal(target.clears().at(-1).reason, "disposed");
	bridge.setConsumer(true);
	bridge.sync();
	assert.equal(target.frames().length, 0, "the buffered frame died with it");
	assert.equal(source.begins, 1);
});

test("registry: the composite subscribes BEFORE the view is detached, and only for an overlay hide", () => {
	const order = [];
	let bridge = null;
	const views = new Map();
	const registry = new TabRegistry(
		(_options, tabId) => {
			const source = fakeSource(100 + tabId);
			const view = {
				webContents: source,
				setBounds() {},
				setVisible(visible) {
					order.push(visible ? "show" : "hide");
				},
			};
			views.set(tabId, view);
			return view;
		},
		() => {},
		() => {},
		() => {},
		(_view, presented) => order.push(presented ? "attach" : "detach"),
		() => bridge?.sync(),
	);
	const target = fakeTarget();
	bridge = new CompositeBridge({
		eligible: () => {
			const record = registry.activeTab;
			if (!record || !registry.hiddenByOverlay(record.tabId)) return null;
			const rect = registry.presentationContentRect;
			return rect
				? {
						tabId: record.tabId,
						source: record.view.webContents,
						documentEpoch: record.documentEpoch,
						rect,
					}
				: null;
		},
		target: () => target,
	});
	const { tabId } = registry.create({ owner: "user" });
	registry.setContentRect(RECT);
	const source = views.get(tabId).webContents;
	order.length = 0;
	source.beginFrameSubscription = (_onlyDirty, cb) => {
		order.push("subscribe");
		source.subscribed = cb;
	};
	registry.setViewVisible(false); // an overlay opened
	assert.deepEqual(order.slice(0, 3), ["subscribe", "hide", "detach"]);
	registry.setViewVisible(true); // overlay closed
	assert.equal(bridge.activeGeneration, null);
	assert.equal(target.clears().at(-1).reason, "ineligible");
	registry.setViewVisible(false, true); // the browser's own start page
	assert.equal(
		bridge.activeGeneration,
		null,
		"own-state page is not composited",
	);
	registry.setViewVisible(false);
	assert.equal(bridge.activeGeneration, 2);
	registry.setContentRect(null); // route teardown
	assert.equal(
		bridge.activeGeneration,
		null,
		"route teardown is not composited",
	);
});

test("ipc: composite replies are owner-gated and validated", () => {
	const frame = { url: "http://localhost:5173/index.html" };
	const webContents = { id: 1, mainFrame: frame };
	const window = { isDestroyed: () => false, webContents };
	const calls = [];
	ipcMain.reset();
	registerBrowserIpc({
		window: () => window,
		expectedUrl: "http://localhost:5173",
		headless: false,
		host: () => ({}),
		composite: {
			ack: (payload) => {
				calls.push(["ack", payload]);
				return true;
			},
			consumer: (ready) => calls.push(["consumer", ready]),
		},
		log: () => {},
	});
	try {
		assert.ok(BROWSER_IPC_CHANNELS.includes("browser-composite-ack"));
		assert.ok(BROWSER_IPC_CHANNELS.includes("browser-composite-consumer"));
		const ack = ipcMain.handlers.get("browser-composite-ack");
		const consumer = ipcMain.handlers.get("browser-composite-consumer");
		const owner = { sender: webContents, senderFrame: frame };
		for (const intruder of [
			{ sender: {}, senderFrame: frame },
			{ sender: webContents, senderFrame: { ...frame } },
		]) {
			assert.throws(
				() => ack(intruder, { generation: 1, frameSeq: 1 }),
				CANNOT_USE,
			);
			assert.throws(() => consumer(intruder, true), CANNOT_USE);
		}
		assert.deepEqual(calls, [], "a refused sender reaches nothing");
		assert.throws(() => consumer(owner, "yes"), MUST_BE_BOOLEAN);
		assert.equal(ack(owner, { generation: 1, frameSeq: 1 }), true);
		consumer(owner, true);
		assert.deepEqual(calls, [
			["ack", { generation: 1, frameSeq: 1 }],
			["consumer", true],
		]);
	} finally {
		unregisterBrowserIpc();
	}
	assert.equal(ipcMain.handlers.has("browser-composite-ack"), false);
});

const frameOf = (generation, frameSeq, width = 2, height = 1) => ({
	generation,
	frameSeq,
	width,
	height,
	pixels: new Uint8Array(width * height * 4),
});

test("renderer sink: draw-after-clear and stale frames are rejected", () => {
	const sink = new CompositeSink();
	assert.equal(sink.accept(frameOf(1, 1)), true);
	const queued = frameOf(1, 1);
	// The clear arrives while the frame waits for its animation frame.
	assert.equal(sink.clear(1), false, "nothing drawn yet");
	assert.equal(sink.current(queued), false, "draw-time re-check refuses it");
	assert.equal(
		sink.accept(frameOf(1, 2)),
		false,
		"the cleared generation stays dead",
	);
	const next = frameOf(2, 1);
	assert.equal(sink.accept(next), true);
	sink.markDrawn(next);
	assert.equal(sink.hasFrame, true);
	assert.equal(sink.accept(frameOf(2, 1)), false, "duplicate");
	assert.equal(sink.accept(frameOf(2, 2)), true);
	assert.equal(sink.clear(2), true, "a drawn frame must be wiped");
	assert.equal(sink.hasFrame, false);
	assert.equal(
		sink.accept({ ...frameOf(3, 1), pixels: new Uint8Array(3) }),
		false,
	);
	assert.equal(sink.accept(null), false);
	assert.equal(sink.accept({ ...frameOf(3, 1), generation: 0 }), false);
});

test("renderer sink: BGRA bytes become RGBA", () => {
	const source = new Uint8Array([10, 20, 30, 255, 1, 2, 3, 4]);
	const out = new Uint8ClampedArray(8);
	bgraToRgba(source, out);
	assert.deepEqual([...out], [30, 20, 10, 255, 3, 2, 1, 4]);
	const unaligned = new Uint8Array(9).subarray(1);
	unaligned.set(source);
	const out2 = new Uint8ClampedArray(8);
	bgraToRgba(unaligned, out2);
	assert.deepEqual([...out2], [30, 20, 10, 255, 3, 2, 1, 4]);
});
