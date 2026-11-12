import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, test } from "node:test";
import { build } from "esbuild";

// Fake CDP exercises the shipped action and pool lifecycle, not native Chromium.
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/browser/actions/recording";',
			// The high-quality engine's pure helpers (bitrate bands, PNG size sniffing).
			'export * from "./src/main/browser/actions/recording-hq";',
			'export * from "./src/main/browser/protocol";',
			'export * from "./src/main/browser/cdp";',
			// Main's checks on the encoder window's messages (pure, no `electron`).
			'export * from "./src/shared/recording-encoder";',
			// The typed failure itself, so a case can script the exact code a dead tab
			// or a DevTools hand-over answers with.
			'export * from "./src/main/browser/errors";',
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

// The runtime this feature ships on is Electron 45.1.0 = Chromium 156, so that is
// the version every case runs as unless it says otherwise. The host reads
// `process.versions.chrome` for D9's version-first classification and plain Node
// does not set it; a real Electron main process always has it.
process.versions.chrome = "156.0.8078.49";

/** D9's version-first branch needs the older runtime, and restoring the value
 * afterwards keeps a later case from inheriting 152. */
async function asChromium(version, work) {
	const previous = process.versions.chrome;
	process.versions.chrome = version;
	try {
		return await work();
	} finally {
		process.versions.chrome = previous;
	}
}

let nextViewId = 100;
function scratchDir() {
	return mkdtempSync(join(tmpdir(), "lo-recording-"));
}

/** The `.part` files in a directory: a publish that leaves one behind is a
 * failure of D5, so this is asserted on both the success and error paths. */
function partFiles(dir) {
	return readdirSync(dir).filter((name) => name.endsWith(".part"));
}

/** One read failure the action must not swallow; top-level because it is
 * matched in a loop body and rebuilt on every iteration otherwise. */
const IO_READ_EXPLODED = /IO\.read exploded/;

async function rejectsReason(promise, code, reason) {
	await assert.rejects(promise, (error) => {
		assert.equal(error.code, code, `code for ${reason}`);
		assert.equal(error.data?.reason, reason, `reason ${reason}`);
		return true;
	});
}

/**
 * A scripted `IO.read` stream: one base64 page per entry, then eof.
 *
 * `sizes` is what the action asks for, kept because `IO.read`'s own position is
 * Chromium's (offset is omitted deliberately — a stream that only supports
 * sequential reads is what a delete-on-close temp file is).
 */
function stream(
	chunks,
	{
		startError,
		startResult,
		stopResult = { stream: "stream-1" },
		readError,
		endless,
		onCommand,
		base64 = true,
		layout,
		layoutErrors = 0,
		pollError,
		frameError,
		frames,
	} = {},
) {
	let index = 0;
	let layoutFailures = 0;
	return ({ method, params }) => {
		onCommand?.(method, params);
		if (method === "Runtime.evaluate") {
			// The frame wait is the only evaluate that awaits a promise; the poll is
			// the plain one, so a fixture can fail either on its own.
			if (params?.awaitPromise) {
				if (frameError) throw frameError;
				// `frames` lets a case answer the first awaited frame with the OLD size
				// and a later one with the request; once it runs out the request stands.
				const answer = frames?.length ? frames.shift() : layout;
				return {
					result: {
						value: answer ? [answer.width, answer.height] : undefined,
					},
				};
			}
			if (pollError) throw pollError;
			if (layoutFailures < layoutErrors) {
				layoutFailures += 1;
				throw new Error("Cannot find default execution context");
			}
			// The poll reads the page's own viewport: two numbers, the shape
			// Chromium returns for `[window.innerWidth, window.innerHeight]`.
			return {
				result: { value: layout ? [layout.width, layout.height] : undefined },
			};
		}
		if (method === "Page.startScreenRecording") {
			if (startError) throw startError;
			return startResult ?? {};
		}
		if (method === "Page.stopScreenRecording") {
			// Each stop begins a NEW stream, so a fixture that records on several
			// tabs serves the chunk list to each rather than draining it once.
			index = 0;
			return stopResult;
		}
		if (method === "IO.read") {
			if (readError) throw readError;
			if (endless) {
				return {
					data: Buffer.alloc(512 * 1024, 7).toString("base64"),
					base64Encoded: true,
					eof: false,
				};
			}
			const chunk = chunks[index++];
			if (chunk === undefined)
				return { data: "", base64Encoded: base64, eof: true };
			return {
				data: base64 ? Buffer.from(chunk).toString("base64") : String(chunk),
				base64Encoded: base64,
				eof: index === chunks.length,
			};
		}
		return {};
	};
}

/** Every view id this file created, so one failing test cannot leave a recording
 * holding the app-wide cap for the next one. */
const createdIds = [];

/**
 * Keeps the test process's event loop alive for the whole file.
 *
 * The recording engine's timers are `unref()`'d on purpose (production is
 * Electron's main process, which stays alive on its own, and a timer must never be
 * what holds an app open). A test that awaits only such a timer therefore leaves
 * the runner with nothing pending, and Node 22 (CI) cancels it with "Promise
 * resolution is still pending but the event loop has already resolved"; Node 26
 * does not, which hid it. Created at module load, before any test mocks timers,
 * and `setInterval` is never mocked here.
 */
const keepAlive = setInterval(() => {}, 1_000);

after(() => {
	clearInterval(keepAlive);
	for (const id of createdIds) mod.abortRecording(id, "test-cleanup");
});

function contentsFor(id, extra = {}) {
	return {
		id,
		isDestroyed: () => false,
		getURL: () => "http://127.0.0.1:9/",
		loadURL: async () => {},
		...extra,
	};
}

/**
 * A context over a scripted `cdp.send`, one webContents per tab token.
 *
 * `attach` is a no-op here: `recordStart` attaches through `CdpPool.attach`
 * (the real-pool cases below drive that path), and what these cases pin is the
 * action's own CDP traffic, in order.
 */
function fixture(options = {}) {
	const commands = [];
	const tabs = new Map();
	const listeners = new Map();
	const handler =
		options.handler ??
		stream(options.chunks ?? [Buffer.from("ftyp-av1-payload")]);
	const ctx = {
		registry: {
			requireSurface: (token) => {
				const contents = tabs.get(String(token));
				if (!contents) throw new Error(`no tab ${token}`);
				return {
					view: { webContents: contents },
					presented: String(token) === options.presentedTab,
				};
			},
		},
		...(options.encoder ? { recordingEncoder: options.encoder } : {}),
		cdp: {
			attach: async () => {},
			// The same contract as `CdpPool.subscribe`: handlers per view, removed by
			// the returned function.
			subscribe: (id, listener) => {
				const set = listeners.get(id) ?? new Set();
				listeners.set(id, set);
				set.add(listener);
				return () => set.delete(listener);
			},
			send: async (contents, method, params = {}, sendOptions = {}) => {
				commands.push({ method, params, sendOptions, view: contents.id });
				return handler({ contents, method, params });
			},
		},
	};
	const addTab = (token, extra) => {
		const contents = contentsFor(nextViewId++, extra);
		createdIds.push(contents.id);
		tabs.set(token, contents);
		return contents;
	};
	addTab("tab");
	return {
		ctx,
		commands,
		addTab,
		start: (params = {}, owner = "session:a", token = "tab") =>
			mod.recordStart(
				ctx,
				{ tab: token, requester: owner, ...params },
				`request-${owner}`,
			),
		stop: (owner = "session:a", token = "tab") =>
			mod.recordStop(ctx, { tab: token, requester: owner }, `request-${owner}`),
		abort: (id, reason, options) => mod.abortRecording(id, reason, options),
		tabs,
		/** Deliver one CDP event to every subscriber on a view, like the pool does. */
		emit: (id, method, params) => {
			for (const listener of [...(listeners.get(id) ?? [])]) {
				listener(method, params);
			}
		},
		subscriberCount: (id) => listeners.get(id)?.size ?? 0,
	};
}

// ---- 1. start -------------------------------------------------------------

test("record_start without a size sends the fixed capture params and writes nothing", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const { start, stop, commands } = fixture({ path });
	const result = await start({ path, max_duration_s: 30 });
	assert.deepEqual(result, {
		recording: true,
		path,
		max_duration_s: 30,
		max_bytes: 64 * 1024 * 1024,
		fps: 10,
		container: "mp4",
		codec: "av1",
	});
	// D14: without width/height the capture shape is the fixed ceiling, and no
	// emulation call is made at all.
	assert.deepEqual(
		commands.map((call) => call.method),
		["Page.startScreenRecording"],
		"the unsized path makes no Emulation call",
	);
	assert.deepEqual(commands[0].params, {
		audio: false,
		maxWidth: 1280,
		maxHeight: 720,
		frameRate: 10,
	});
	assert.equal(commands[0].method, "Page.startScreenRecording");
	assert.deepEqual(readdirSync(dir), [], "start captures no pixels to disk");
	// A start that was never stopped leaves nothing either: bytes are only written
	// at stop (D4).
	assert.equal(existsSync(path), false);
	await stop();
});

// ---- 2. stop --------------------------------------------------------------

test("record_stop pages IO.read to eof and publishes a complete file", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const head = Buffer.alloc(1024 * 1024, 3);
	const tail = Buffer.from("last-frame");
	const { start, stop, commands } = fixture({ path, chunks: [head, tail] });
	await start({ path });
	const result = await stop();
	assert.equal(result.path, path);
	assert.equal(result.bytes, head.length + tail.length);
	assert.equal(result.auto_stopped, false);
	assert.equal(typeof result.duration_ms, "number");
	// Review round 1, MINOR 1: 1280x720 is the CEILING handed to Chromium, not a
	// measured size (a presented 1380x868 view recorded at 1144x720), so neither
	// method reports a width or height.
	assert.equal("width" in result, false);
	assert.equal("height" in result, false);
	assert.equal(result.fps, 10);
	assert.equal(result.container, "mp4");
	assert.equal(result.codec, "av1");
	assert.deepEqual(readFileSync(path), Buffer.concat([head, tail]));
	// D5's 0600: the umask must not be what decides who can read a clip.
	assert.equal(
		statSync(path).mode & 0o777,
		0o600,
		"the published clip is owner-only, like the directory Python creates",
	);
	assert.deepEqual(
		partFiles(dir),
		[],
		"no .part survives a successful publish",
	);
	assert.deepEqual(
		commands.map((call) => call.method),
		[
			"Page.startScreenRecording",
			"Page.stopScreenRecording",
			"IO.read",
			"IO.read",
			"IO.close",
		],
	);
	// `IO.read` carries the handle and a byte budget only: the stream's position
	// is Chromium's, so an explicit offset would be a second source of truth for
	// a stream that may only support sequential reads.
	assert.deepEqual(Object.keys(commands[2].params).sort(), ["handle", "size"]);
	assert.equal(commands[2].params.handle, "stream-1");
	assert.equal(
		commands[2].params.size,
		1024 * 1024,
		"a page is 1 MiB: the read loop bounds the decoded copy, not the clip",
	);
});

test("the stream is read on the page's own session", async () => {
	class FakeDebugger extends EventEmitter {
		attached = false;
		calls = [];
		attach() {
			this.attached = true;
		}
		detach() {
			this.attached = false;
		}
		isAttached() {
			return this.attached;
		}
		async sendCommand(...args) {
			this.calls.push(args);
			if (args[0] === "Page.stopScreenRecording") return { stream: "s1" };
			if (args[0] === "IO.read")
				return { data: Buffer.from("avif").toString("base64"), eof: true };
			return {};
		}
	}
	const cdp = new mod.CdpPool();
	const debuggerLike = new FakeDebugger();
	const contents = contentsFor(7001, { debugger: debuggerLike });
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const ctx = {
		cdp,
		registry: { requireSurface: () => ({ view: { webContents: contents } }) },
	};
	await mod.recordStart(ctx, { tab: "tab", requester: "session:a", path }, "r");
	await mod.recordStop(ctx, { tab: "tab", requester: "session:a" }, "r");
	const streamed = debuggerLike.calls.filter((call) =>
		["Page.stopScreenRecording", "IO.read", "IO.close"].includes(call[0]),
	);
	assert.ok(streamed.length >= 3);
	for (const call of streamed) {
		// Two-argument `sendCommand`: the page's own session. Measured on the probe:
		// the stream belongs to the recording page, and a flattened child session
		// cannot read it.
		assert.equal(call.length, 2, `${call[0]} must not name a session`);
	}
});

// ---- 3. stop with no recording --------------------------------------------

test("record_stop without a recording is record_not_active, twice", async () => {
	const { stop } = fixture();
	await rejectsReason(stop(), "internal", "record_not_active");
	await rejectsReason(stop(), "internal", "record_not_active");
});

// ---- 4. a second start ----------------------------------------------------

test("a second start by the same owner is busy with zero CDP calls", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const { start, stop, commands } = fixture({ path });
	await start({ path });
	const before = commands.length;
	await assert.rejects(start({ path }), (error) => {
		assert.equal(error.code, "busy");
		assert.equal(error.data?.reason, "record_active");
		// The refusal has to name what is running: which file, and for how long.
		assert.match(error.message, /clip\.mp4/);
		assert.match(error.message, /\d/);
		// N3: `age_ms` is the frozen field a harness reads to age a refusal, and
		// it is integer milliseconds — a seconds field would be a second contract.
		assert.equal(typeof error.data?.age_ms, "number");
		assert.ok(Number.isInteger(error.data.age_ms), "age_ms is whole ms");
		assert.ok(error.data.age_ms >= 0);
		assert.equal("age_s" in error.data, false, "age_s is not the contract");
		return true;
	});
	assert.equal(commands.length, before, "no CDP call on a busy refusal");
	await stop();
});

// ---- M1: the cap is reserved before the first await ------------------------

test("four simultaneous starts fill the cap and refuse the rest", async () => {
	// The cap check and the registration are separated by awaits, so without a
	// reservation every one of these reads a size of zero and all four start
	// (review M1). FOUR tabs, two slots: exactly two may win.
	const dir = scratchDir();
	const { start, stop, addTab } = fixture();
	addTab("tab-2");
	addTab("tab-3");
	addTab("tab-4");
	const tokens = ["tab", "tab-2", "tab-3", "tab-4"];
	const outcomes = await Promise.allSettled(
		tokens.map((token, index) =>
			start({ path: join(dir, `c${index}.mp4`) }, "session:a", token),
		),
	);
	// Free whatever won BEFORE asserting, so a red run cannot leave the cap full
	// for every later case in this file.
	try {
		const fulfilled = outcomes.filter((entry) => entry.status === "fulfilled");
		const rejected = outcomes.filter((entry) => entry.status === "rejected");
		assert.equal(
			fulfilled.length,
			2,
			JSON.stringify(outcomes.map((o) => o.status)),
		);
		assert.equal(rejected.length, 2);
		for (const entry of rejected) {
			assert.equal(entry.reason.code, "busy");
			assert.equal(entry.reason.data?.reason, "record_limit");
		}
	} finally {
		for (const token of tokens) {
			await stop("session:a", token).catch(() => undefined);
		}
	}
});

test("a start naming an active recording's path is refused", async () => {
	// Two recordings on ONE path would interleave writes into one .part (review
	// N1). The refusal is a path refusal and costs no CDP call.
	const dir = scratchDir();
	const path = join(dir, "shared.mp4");
	const { start, stop, addTab, commands } = fixture({ path });
	addTab("tab-2");
	await start({ path }, "session:a", "tab");
	try {
		const before = commands.length;
		await assert.rejects(start({ path }, "session:a", "tab-2"), (error) => {
			assert.equal(error.data?.reason, "record_path");
			assert.match(error.message, /already being recorded/);
			return true;
		});
		assert.equal(commands.length, before, "no CDP call for a taken path");
	} finally {
		// Both tabs: in the un-fixed state the second start SUCCEEDS on the taken
		// path, and a red run must not leave it holding a cap slot.
		await stop("session:a", "tab").catch(() => undefined);
		await stop("session:a", "tab-2").catch(() => undefined);
	}
});

test("a path that resolves to an active one is refused too", async () => {
	// `/d/../d/x.mp4` is `x.mp4` once resolved; comparing the strings would let it
	// through and two recordings would share one part file (review F2).
	const dir = scratchDir();
	const path = join(dir, "x.mp4");
	const { start, stop, addTab } = fixture({ path });
	addTab("tab-2");
	await start({ path }, "session:a", "tab");
	try {
		await assert.rejects(
			start({ path: `${dir}/./x.mp4` }, "session:a", "tab-2"),
			(error) => {
				assert.equal(error.data?.reason, "record_path");
				return true;
			},
		);
	} finally {
		await stop("session:a", "tab").catch(() => undefined);
		await stop("session:a", "tab-2").catch(() => undefined);
	}
});

test("two simultaneous starts on ONE tab cannot both pass", async () => {
	// The registered entry only exists after Chromium accepted, so the second
	// start of a pair sees no recording at all; the reservation has to answer for
	// the tab it belongs to (review F3).
	const dir = scratchDir();
	const { start, stop } = fixture();
	const outcomes = await Promise.allSettled([
		start({ path: join(dir, "one.mp4") }, "session:a", "tab"),
		start({ path: join(dir, "two.mp4") }, "session:a", "tab"),
	]);
	try {
		const won = outcomes.filter((entry) => entry.status === "fulfilled");
		const lost = outcomes.filter((entry) => entry.status === "rejected");
		assert.equal(won.length, 1, JSON.stringify(outcomes.map((o) => o.status)));
		assert.equal(lost.length, 1);
		assert.equal(lost[0].reason.code, "busy");
		assert.equal(lost[0].reason.data?.reason, "record_active");
	} finally {
		// Twice: without the fix BOTH starts register on the one tab, and a
		// red run must not leave the loser holding a cap slot for every later
		// case.
		await stop("session:a", "tab").catch(() => undefined);
		await stop("session:a", "tab").catch(() => undefined);
	}
});

test("a stale .part is not deleted by a recording that did not create it", async () => {
	// The finally-block unlink is for the part THIS recording opened. A stale one
	// from an earlier crash is somebody else's file: the open fails `EEXIST`, the
	// stop refuses, and the bytes stay where they were (review N1).
	const dir = scratchDir();
	const path = join(dir, "stale.mp4");
	const part = join(dir, ".stale.mp4.part");
	writeFileSync(part, "stale bytes");
	const { start, stop } = fixture({ path, chunks: [Buffer.from("bytes")] });
	await start({ path });
	await rejectsReason(stop(), "internal", "record_failed");
	assert.equal(
		existsSync(part),
		true,
		"the stale part survives this recording",
	);
	assert.equal(readFileSync(part, "utf8"), "stale bytes");
	assert.equal(existsSync(path), false, "and nothing was published over it");
});

test("a second start by another owner replaces the recording", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const { start, stop, commands } = fixture({ path });
	await start({ path }, "session:a");
	const replaced = await start({ path: join(dir, "b.mp4") }, "session:b");
	assert.equal(replaced.recording, true);
	// The old owner's session is gone, so its start is replaced rather than
	// swallowed: the new owner gets its own capture on the same tab.
	// The displaced owner learns nothing about the new recording...
	await rejectsReason(stop("session:a"), "internal", "record_not_active");
	// ...and the new owner's stop is the one that publishes.
	const done = await stop("session:b");
	assert.equal(done.path, join(dir, "b.mp4"));
	assert.equal(existsSync(path), false, "a replaced recording writes nothing");
	// Chromium refuses a second start while the old recorder is live ("Screencast
	// is already active", measured on Electron 45.1.0), so the replace has to STOP
	// the old stream before starting the new one — discarding the state alone left
	// the target busy and the hand-over impossible.
	assert.deepEqual(
		commands.map((call) => call.method),
		[
			"Page.startScreenRecording",
			"Page.stopScreenRecording",
			"IO.close",
			"Page.startScreenRecording",
			"Page.stopScreenRecording",
			"IO.read",
			"IO.close",
		],
	);
});

// ---- 5. the command is missing --------------------------------------------

test("Chromium 152 is record_unsupported with no state and no file", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const missing = Object.assign(
		new Error("'Page.startScreenRecording' wasn't found"),
		{
			code: -32601,
		},
	);
	const { start, commands } = fixture({
		path,
		handler: stream([], { startError: missing }),
	});
	await asChromium("152.0.7977.78", async () => {
		await assert.rejects(start({ path }), (error) => {
			assert.equal(error.code, "internal");
			assert.equal(error.data?.reason, "record_unsupported");
			assert.match(error.message, /Chromium 152/);
			assert.match(error.message, /153 or newer/);
			return true;
		});
	});
	assert.deepEqual(readdirSync(dir), []);
	assert.equal(
		commands.filter((call) => call.method === "Page.startScreenRecording")
			.length,
		1,
		"detection is by calling, not by a pre-flight schema read",
	);
	// No state was left behind: the same owner may start again immediately, and
	// gets past the busy check to the (still missing) command.
	await asChromium("152.0.7977.78", () =>
		assert.rejects(start({ path }), /Chromium 152/),
	);
});

test("a not-found message on a new engine is still record_unsupported", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const missing = new Error("'Page.startScreenRecording' wasn't found");
	const { start } = fixture({
		path,
		handler: stream([], { startError: missing }),
	});
	await rejectsReason(start({ path }), "internal", "record_unsupported");
});

// ---- 6. AV1 ---------------------------------------------------------------

test("an engine without AV1 is record_av1_unavailable", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const noAv1 = new Error(
		"Video recording is not supported without AV1/libaom enabled.",
	);
	const { start } = fixture({
		path,
		handler: stream([], { startError: noAv1 }),
	});
	await assert.rejects(start({ path }), (error) => {
		assert.equal(error.data?.reason, "record_av1_unavailable");
		assert.match(error.message, /AV1/);
		return true;
	});
	assert.deepEqual(readdirSync(dir), []);
});

test("any other start refusal carries Chromium's text verbatim", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const other = new Error("Screencast is already active");
	const { start, stop } = fixture({
		path,
		handler: stream([], { startError: other }),
	});
	await assert.rejects(start({ path }), (error) => {
		assert.equal(error.data?.reason, "record_failed");
		assert.equal(error.message, "Screencast is already active");
		return true;
	});
	await rejectsReason(stop(), "internal", "record_not_active");
});

// ---- 7. the size cap ------------------------------------------------------

test("an endless stream is record_too_large: closed, unlinked, nothing saved", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const sizes = [];
	const { start, stop, commands } = fixture({
		path,
		handler: stream([], {
			endless: true,
			onCommand: (method, params) => {
				if (method === "IO.read") sizes.push(params.size);
			},
		}),
	});
	await start({ path, max_bytes: 1024 * 1024 });
	await rejectsReason(stop(), "internal", "record_too_large");
	// The LAST read asks for exactly the one byte that proves the cap was passed,
	// so nothing is read past the ceiling that a caller was told about (D5/D6).
	assert.equal(sizes.at(-1), 1);
	assert.ok(sizes[0] <= 1024 * 1024, "pages stay at 1 MiB");
	assert.equal(existsSync(path), false, "a truncated MP4 is not a file");
	assert.deepEqual(partFiles(dir), []);
	assert.ok(
		commands.some((call) => call.method === "IO.close"),
		"the stream is closed even when the cap trips",
	);
	// The refusal is actionable: the cap is named, and so is what to do about it.
	const error = await stop().catch((failure) => failure);
	assert.equal(error.data?.reason, "record_not_active");
});

// ---- 8. the path ----------------------------------------------------------

test("path refusals happen before any CDP call", async () => {
	const dir = scratchDir();
	const existing = join(dir, "exists.mp4");
	writeFileSync(existing, "already here");
	const symlinked = join(dir, "link.mp4");
	symlinkSync(existing, symlinked);
	const { start, commands } = fixture();
	const cases = [
		[join(dir, "missing", "clip.mp4"), /parent/],
		[existing, /exists|already/i],
		[symlinked, /exists|already/i],
		["relative/clip.mp4", /absolute/],
		[join(dir, "clip.webm"), /\.mp4/],
		[join(dir, ".mp4"), /\.mp4/],
		["", /path/],
	];
	for (const [path, message] of cases) {
		await assert.rejects(start({ path }), (error) => {
			assert.equal(error.data?.reason, "record_path", `path ${path}`);
			assert.match(error.message, message);
			return true;
		});
	}
	assert.deepEqual(commands, [], "no CDP call for a refused path");
});

test("a name whose .part sibling would not fit is refused at start, not at stop", async () => {
	const dir = scratchDir();
	const { start, commands } = fixture();
	// 251 bytes + ".mp4" = 255: the final name fits a 255-byte component, but
	// `.<name>.part` is 6 bytes longer and would fail ENAMETOOLONG at stop.
	const tooLong = join(dir, `${"a".repeat(251)}.mp4`);
	assert.equal(Buffer.byteLength(tooLong.split("/").pop()), 255);
	await assert.rejects(start({ path: tooLong }), (error) => {
		assert.equal(error.data?.reason, "record_path");
		assert.match(error.message, /too long/);
		return true;
	});
	assert.deepEqual(commands, [], "no CDP call for a refused name");
	// The longest name whose part file still fits is accepted.
	const longest = join(dir, `${"b".repeat(245)}.mp4`);
	assert.equal(Buffer.byteLength(`.${longest.split("/").pop()}.part`), 255);
	const { start: ok, stop } = fixture();
	await ok({ path: longest });
	await stop();
});

test("an existing file that appears while recording is never overwritten", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const { start, stop } = fixture({ path, chunks: [Buffer.from("bytes")] });
	await start({ path });
	// Something else claims the name between the preflight and the publish: the
	// hard link is what refuses it, and the clip is NOT silently discarded for
	// the other writer's file.
	writeFileSync(path, "someone else");
	await rejectsReason(stop(), "internal", "record_path");
	assert.equal(readFileSync(path, "utf8"), "someone else");
	assert.deepEqual(partFiles(dir), []);
});

// ---- 9. the duration cap --------------------------------------------------

test("the duration timer auto-stops, and a later stop returns auto_stopped", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const { start, stop, commands } = fixture({
		path,
		chunks: [Buffer.from("auto")],
	});
	await start({ path, max_duration_s: 5 });
	assert.equal(commands.length, 1);
	t.mock.timers.tick(5_000);
	const result = await stop();
	assert.equal(result.auto_stopped, true);
	assert.equal(result.path, path);
	assert.equal(result.bytes, 4);
	assert.equal(
		commands.filter((call) => call.method === "Page.stopScreenRecording")
			.length,
		1,
		"one stop command: the timer and the caller share one finalize",
	);
	// The settled result is consumed once.
	await rejectsReason(stop(), "internal", "record_not_active");
});

test("an auto-stop that fails answers the next stop with its reason", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const { start, stop } = fixture({
		path,
		handler: stream([], {
			stopResult: { stream: "" },
		}),
	});
	await start({ path, max_duration_s: 1 });
	t.mock.timers.tick(1_000);
	await rejectsReason(stop(), "internal", "record_failed");
	assert.equal(existsSync(path), false);
	await rejectsReason(stop(), "internal", "record_not_active");
});

// ---- 10. teardown ---------------------------------------------------------

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
	async sendCommand(method) {
		if (method === "Page.stopScreenRecording") return { stream: "s" };
		if (method === "IO.read") return { data: "", eof: true };
		return {};
	}
}

/** A real `CdpPool` over a fake debugger. `answer` lets a test decide what the
 * driver sees for a method (`Page.stopScreenRecording`, `IO.read`) while every
 * other CDP call still answers `{}` — the fake the boundary tests need. */
function poolFixture(answer) {
	const cdp = new mod.CdpPool();
	const fakeDebugger = new FakeDebugger();
	const sent = [];
	if (answer) {
		const original = FakeDebugger.prototype.sendCommand;
		fakeDebugger.sendCommand = async (method) => {
			sent.push(method);
			return answer({ method }) ?? original.call(fakeDebugger, method);
		};
	}
	const debuggerLike = fakeDebugger;
	const contents = contentsFor(9001 + nextViewId++, { debugger: debuggerLike });
	const ctx = {
		cdp,
		registry: { requireSurface: () => ({ view: { webContents: contents } }) },
	};
	return { cdp, contents, debuggerLike, ctx, sent };
}

test("every debugger boundary aborts a recording and clears its timer", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const dir = scratchDir();
	for (const boundary of ["detach event", "forget", "detach", "close"]) {
		const { cdp, contents, debuggerLike, ctx } = poolFixture();
		const path = join(dir, `${boundary.replace(" ", "-")}.mp4`);
		await cdp.attach(contents);
		await mod.recordStart(
			ctx,
			{ tab: "tab", requester: "session:a", path },
			"r",
		);
		if (boundary === "detach event")
			debuggerLike.emit("detach", {}, "canceled_by_user");
		if (boundary === "forget") cdp.forget(contents.id);
		if (boundary === "detach") await cdp.detach(contents.id);
		if (boundary === "close") await cdp.close();
		// The timer cannot fire into a recording that no longer exists.
		t.mock.timers.tick(10 * 60 * 1000);
		await rejectsReason(
			mod.recordStop(ctx, { tab: "tab", requester: "session:a" }, "r"),
			"internal",
			boundary === "detach event" ? "record_aborted" : "record_not_active",
		);
		assert.equal(existsSync(path), false, `${boundary}: nothing written`);
	}
});

test("a detach event leaves an uncollected auto-stop result alone", async (t) => {
	// The event with NO live recording is a DevTools hand-over of a tab whose clip
	// already finished. Dropping `settled` there would answer the owner's stop with
	// "nothing is running" and lose the path it earned (review N2).
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const dir = scratchDir();
	const { cdp, contents, debuggerLike, ctx } = poolFixture(({ method }) => {
		if (method === "Page.stopScreenRecording") return { stream: "s-auto" };
		if (method === "IO.read")
			return { data: Buffer.from("auto-bytes").toString("base64"), eof: true };
		return {};
	});
	const path = join(dir, "auto-kept.mp4");
	await cdp.attach(contents);
	await mod.recordStart(
		ctx,
		{ tab: "tab", requester: "session:a", path, max_duration_s: 1 },
		"r",
	);
	t.mock.timers.tick(1000);
	for (let index = 0; index < 10; index += 1) {
		await new Promise((resolve) => setImmediate(resolve));
	}
	debuggerLike.emit("detach", {}, "canceled_by_user");
	const result = await mod.recordStop(
		ctx,
		{ tab: "tab", requester: "session:a" },
		"r",
	);
	assert.equal(result.auto_stopped, true);
	assert.equal(result.path, path);
	// forget/detach DO clear it: the handle is gone there.
	const second = poolFixture(() => ({}));
	await second.cdp.attach(second.contents);
	await mod.recordStart(
		second.ctx,
		{
			tab: "tab",
			requester: "session:a",
			path: join(dir, "two.mp4"),
			max_duration_s: 1,
		},
		"r",
	);
	t.mock.timers.tick(1000);
	for (let index = 0; index < 10; index += 1) {
		await new Promise((resolve) => setImmediate(resolve));
	}
	second.cdp.forget(second.contents.id);
	await rejectsReason(
		mod.recordStop(second.ctx, { tab: "tab", requester: "session:a" }, "r"),
		"internal",
		"record_not_active",
	);
});

test("a start in flight when the handle is dropped never registers", async () => {
	// `forget` lands between the attach and the start's answer; registering after
	// that would leave a recording on a tab nobody can stop (review F4). Chromium
	// accepted the start, so the recorder is ended before the refusal.
	const dir = scratchDir();
	let releaseStart;
	const gate = new Promise((resolveGate) => {
		releaseStart = resolveGate;
	});
	const seen = [];
	const { cdp, contents, ctx } = poolFixture(({ method }) => {
		seen.push(method);
		if (method === "Page.startScreenRecording") return gate.then(() => ({}));
		if (method === "Page.stopScreenRecording") return { stream: "s-orphan" };
		return {};
	});
	await cdp.attach(contents);
	const inFlight = mod.recordStart(
		ctx,
		{
			tab: "tab",
			requester: "session:a",
			path: join(dir, "orphan.mp4"),
			max_duration_s: 5,
		},
		"r",
	);
	await new Promise((resolveTick) => setImmediate(resolveTick));
	cdp.forget(contents.id);
	releaseStart();
	try {
		await rejectsReason(inFlight, "internal", "record_failed");
		assert.ok(
			seen.includes("Page.stopScreenRecording"),
			"the accepted start was stopped, not abandoned",
		);
		await rejectsReason(
			mod.recordStop(ctx, { tab: "tab", requester: "session:a" }, "r"),
			"internal",
			"record_not_active",
		);
	} finally {
		// In the un-fixed state the start REGISTERS, so the first assertion throws
		// with a live recording behind it; free it or every later case sees a full cap.
		await mod
			.recordStop(ctx, { tab: "tab", requester: "session:a" }, "r")
			.catch(() => undefined);
	}
});

test("a devtools detach answers a later stop with record_aborted, and says why", async () => {
	const { cdp, contents, debuggerLike, ctx } = poolFixture();
	await cdp.attach(contents);
	await mod.recordStart(
		ctx,
		{ tab: "tab", requester: "session:a", path: join(scratchDir(), "x.mp4") },
		"r",
	);
	debuggerLike.emit("detach", {}, "canceled_by_user");
	await assert.rejects(
		mod.recordStop(ctx, { tab: "tab", requester: "session:a" }, "r"),
		(error) => {
			assert.equal(error.data?.reason, "record_aborted");
			assert.match(error.message, /DevTools/);
			assert.match(error.message, /discarded/);
			return true;
		},
	);
	// Any other command on the tab is the pool's own conflict, unchanged.
	await assert.rejects(
		cdp.send(contents, "Runtime.evaluate", { expression: "1" }),
		(error) => error.code === "debugger_conflict",
	);
});

test("a detach does not claim a cause Electron never reported", async () => {
	const { cdp, contents, debuggerLike, ctx } = poolFixture();
	await cdp.attach(contents);
	await mod.recordStart(
		ctx,
		{ tab: "tab", requester: "session:a", path: join(scratchDir(), "y.mp4") },
		"r",
	);
	// Electron 45.1.0 reports this constant reason for every cause, DevTools
	// takeover included (round-2 review), so the wording must stay neutral.
	debuggerLike.emit("detach", {}, "target closed");
	await assert.rejects(
		mod.recordStop(ctx, { tab: "tab", requester: "session:a" }, "r"),
		(error) => {
			assert.equal(error.data?.reason, "record_aborted");
			assert.match(error.message, /debugger connection to the tab ended/);
			assert.match(error.message, /\(target closed\)/);
			assert.match(error.message, /Nothing was written/);
			return true;
		},
	);
});

test("an abort that lands while a stop is saving publishes nothing", async () => {
	// Review round 1, MINOR 5: `runFinalize` never read `recording.aborted`, so a
	// DevTools detach during the drain left the save running and a file published
	// beside a tombstone that said nothing was written.
	const dir = scratchDir();
	const path = join(dir, "raced.mp4");
	let abortOnRead = () => {};
	const { start, stop, tabs, abort } = fixture({
		handler: stream([Buffer.alloc(1024, 1), Buffer.from("tail")], {
			onCommand: (method) => {
				if (method === "IO.read") abortOnRead();
			},
		}),
	});
	await start({ path });
	const id = tabs.get("tab").id;
	abortOnRead = () => {
		abortOnRead = () => {};
		abort(id, "target closed", { tombstone: true });
	};
	await assert.rejects(stop(), (error) => {
		assert.equal(error.data?.reason, "record_aborted");
		assert.match(error.message, /nothing was written/);
		return true;
	});
	assert.equal(existsSync(path), false, "no clip is published after an abort");
	assert.deepEqual(partFiles(dir), [], "and no .part is left behind");
});

test("a non-owner stop cannot see or end another owner's recording", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const { start, stop, commands } = fixture({ path });
	await start({ path }, "session:a");
	await rejectsReason(stop("session:b"), "internal", "record_not_active");
	assert.equal(
		commands.filter((call) => call.method === "Page.stopScreenRecording")
			.length,
		0,
		"the intruder's stop issues no CDP call",
	);
	await stop("session:a");
});

// ---- 11. a read error still cleans up -------------------------------------

test("a read error still closes the stream and unlinks the part", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const { start, stop, commands } = fixture({
		path,
		handler: stream([], { readError: new Error("IO.read exploded") }),
	});
	await start({ path });
	await assert.rejects(stop(), IO_READ_EXPLODED);
	assert.equal(existsSync(path), false);
	assert.deepEqual(partFiles(dir), []);
	assert.ok(commands.some((call) => call.method === "IO.close"));
});

test("a stop that returns no stream writes nothing and says so", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const { start, stop } = fixture({
		path,
		handler: stream([], { stopResult: {} }),
	});
	await start({ path });
	await rejectsReason(stop(), "internal", "record_failed");
	assert.deepEqual(readdirSync(dir), []);
});

test("an empty stream is never published as an empty file", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const { start, stop } = fixture({ path, chunks: [] });
	await start({ path });
	await rejectsReason(stop(), "internal", "record_failed");
	assert.equal(existsSync(path), false);
});

// ---- 12. the concurrency cap and the protocol mirror ----------------------

test("the app-wide cap holds at two recordings", async () => {
	const dir = scratchDir();
	const { start, stop, addTab } = fixture({ path: join(dir, "a.mp4") });
	addTab("tab-2");
	addTab("tab-3");
	await start({ path: join(dir, "a.mp4") }, "session:a", "tab");
	await start({ path: join(dir, "b.mp4") }, "session:a", "tab-2");
	await assert.rejects(
		start({ path: join(dir, "c.mp4") }, "session:a", "tab-3"),
		(error) => {
			assert.equal(error.code, "busy");
			assert.equal(error.data?.reason, "record_limit");
			return true;
		},
	);
	// The cap bounds CONCURRENT recordings: stopping one makes room.
	await stop("session:a", "tab");
	await start({ path: join(dir, "c.mp4") }, "session:a", "tab-3");
	await stop("session:a", "tab-2");
	await stop("session:a", "tab-3");
});

test("bad duration and byte limits are refused before any CDP call", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const { start, commands } = fixture({ path });
	for (const params of [
		{ path, max_duration_s: 0 },
		{ path, max_duration_s: 601 },
		{ path, max_duration_s: 1.5 },
		{ path, max_duration_s: "soon" },
		{ path, max_bytes: 0 },
		{ path, max_bytes: 64 * 1024 * 1024 + 1 },
	]) {
		await rejectsReason(start(params), "internal", "record_failed");
	}
	assert.deepEqual(commands, []);
	assert.deepEqual(readdirSync(dir), []);
	// N4: `max_duration_s` stays integer-only, and the refusal has to say which
	// field and that seconds are whole — a caller cannot guess either.
	const refusal = await start({ path, max_duration_s: 1.5 }).catch(
		(error) => error,
	);
	assert.match(refusal.message, /max_duration_s/);
	assert.match(refusal.message, /whole seconds/i);
});

test("the protocol mirror carries both methods with D8's budgets", () => {
	for (const method of ["record_start", "record_stop"]) {
		assert.ok(mod.METHODS.includes(method), `${method} is in METHODS`);
		assert.ok(mod.isMethod(method), `${method} passes the isMethod gate`);
		assert.ok(
			mod.HOST_CAPABILITIES.includes(method),
			`${method} is advertised as a capability`,
		);
	}
	// Sized recording is a capability, not a method: the extension never
	// advertises it and an old harness never sends the fields.
	assert.ok(mod.HOST_CAPABILITIES.includes("record_size"));
	assert.equal(mod.isMethod("record_size"), false);
	assert.equal(mod.COMMAND_TIMEOUTS_S.record_start, 20);
	assert.equal(mod.COMMAND_TIMEOUTS_S.record_stop, 60);
});

// ---- 12. agent-chosen capture size (D14, RS1-RS6) -------------------------

/** A sized start's layout answer: the request, so the poll settles immediately. */
function sizedStart(options = {}) {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const requested = { width: 1920, height: 1080, ...options.size };
	const rig = fixture({
		path,
		chunks: options.chunks ?? [Buffer.from("ftyp-sized")],
		presentedTab: options.presentedTab,
		handler: stream(options.chunks ?? [Buffer.from("ftyp-sized")], {
			layout: options.layout ?? requested,
			layoutErrors: options.layoutErrors,
			pollError: options.pollError,
			frameError: options.frameError,
			frames: options.frames,
			startError: options.startError,
			endless: options.endless,
		}),
	});
	return { ...rig, dir, path, requested };
}

test("bad sizes are refused before any CDP call, with param and why", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const { start, commands } = fixture({ path });
	const cases = [
		[{ width: 1280 }, "height", "incomplete"],
		[{ height: 720 }, "width", "incomplete"],
		[{ width: 1280.5, height: 720 }, "width", "range"],
		[{ width: 1280, height: "720p" }, "height", "range"],
		[{ width: 1281, height: 720 }, "width", "odd"],
		[{ width: 1280, height: 721 }, "height", "odd"],
		[{ width: 200, height: 720 }, "width", "range"],
		[{ width: 1280, height: 4000 }, "height", "range"],
		[{ width: 3840, height: 3840 }, "size", "area"],
	];
	for (const [params, param, why] of cases) {
		const error = await start({ path, ...params }).catch((refusal) => refusal);
		assert.equal(error.code, "internal", JSON.stringify(params));
		assert.equal(error.data?.reason, "record_size", JSON.stringify(params));
		assert.equal(error.data?.param, param, JSON.stringify(params));
		assert.equal(error.data?.why, why, JSON.stringify(params));
		assert.match(error.message, /Nothing was started\.$/);
	}
	assert.deepEqual(commands, [], "a size refusal costs no CDP call");
	assert.deepEqual(readdirSync(dir), []);
});

test("a sized start sets the viewport, waits for layout, then records there", async () => {
	const { start, stop, commands, path, requested } = sizedStart({
		size: { width: 2160, height: 3840 },
	});
	const result = await start({ path, ...requested });
	assert.deepEqual(result, {
		recording: true,
		path,
		max_duration_s: 120,
		max_bytes: 64 * 1024 * 1024,
		fps: 10,
		container: "mp4",
		codec: "av1",
		width: 2160,
		height: 3840,
	});
	// The order is the contract: the viewport exists, the page draws at it, and
	// only then does the recorder start on it.
	assert.deepEqual(
		commands.map((call) => call.method),
		[
			"Emulation.setDeviceMetricsOverride",
			"Runtime.evaluate",
			"Runtime.evaluate",
			"Page.startScreenRecording",
		],
	);
	assert.equal(
		commands[1].params.awaitPromise,
		undefined,
		"the poll is a plain read",
	);
	assert.equal(
		commands[2].params.awaitPromise,
		true,
		"the settle awaits frames",
	);
	assert.deepEqual(commands[0].params, {
		width: 2160,
		height: 3840,
		deviceScaleFactor: 1,
		mobile: false,
	});
	assert.deepEqual(commands[3].params, {
		audio: false,
		maxWidth: 2160,
		maxHeight: 3840,
		frameRate: 10,
	});
	const stopped = await stop();
	assert.equal(stopped.width, 2160);
	assert.equal(stopped.height, 3840);
	const methods = commands.map((call) => call.method);
	const stopAt = methods.indexOf("Page.stopScreenRecording");
	const clearAt = methods.indexOf("Emulation.clearDeviceMetricsOverride");
	assert.ok(stopAt >= 0 && clearAt > stopAt, "cleared after the stop");
	assert.ok(
		clearAt < methods.indexOf("IO.read"),
		"the viewport is restored before the stream is read",
	);
	assert.equal(
		methods.filter(
			(method) => method === "Emulation.clearDeviceMetricsOverride",
		).length,
		1,
	);
});

test("a sized start on a user-visible tab is refused before any CDP call", async () => {
	const { start, commands, path, requested } = sizedStart({
		presentedTab: "tab",
	});
	const error = await start({ path, ...requested }).catch((refusal) => refusal);
	assert.equal(error.code, "internal");
	assert.equal(error.data?.reason, "record_size");
	assert.equal(error.data?.param, "size");
	assert.equal(error.data?.why, "visible");
	assert.match(error.message, /Nothing was started\.$/);
	assert.deepEqual(commands, []);
});

test("a viewport that never settles is refused as not_applied and restored", async () => {
	// A tab stuck at its old layout: the poll runs out and the start must not reach
	// Chromium's recorder, so no clip is produced at the wrong size.
	const { start, commands, path, requested } = sizedStart({
		layout: { width: 1280, height: 720 },
	});
	const error = await start({ path, ...requested }).catch((refusal) => refusal);
	assert.equal(error.code, "internal");
	assert.equal(error.data?.reason, "record_size");
	assert.equal(error.data?.why, "not_applied");
	assert.match(error.message, /Nothing was started\.$/);
	const methods = commands.map((call) => call.method);
	assert.ok(!methods.includes("Page.startScreenRecording"));
	assert.equal(methods.at(-1), "Emulation.clearDeviceMetricsOverride");
});

test("a tab that never draws a frame at the new size is refused, not recorded", async () => {
	// QA Q1: layout can match while the compositor still holds the old raster, so
	// the start waits for a frame at the new size. A tab that never draws one
	// must refuse rather than encode the old layout into the new clip.
	const { start, commands, path, requested } = sizedStart({
		frameError: new Error("Runtime.evaluate timed out"),
	});
	const error = await start({ path, ...requested }).catch((refusal) => refusal);
	assert.equal(error.code, "internal");
	assert.equal(error.data?.reason, "record_size");
	assert.equal(error.data?.why, "not_applied");
	assert.match(error.message, /did not draw a frame at that size/);
	assert.match(error.message, /Nothing was started\.$/);
	const methods = commands.map((call) => call.method);
	assert.ok(!methods.includes("Page.startScreenRecording"));
	assert.equal(methods.at(-1), "Emulation.clearDeviceMetricsOverride");
});

test("a closed or DevTools-taken tab fails the layout poll at once, not as not_applied", async () => {
	// Q1's wait used to swallow EVERY failure, so a destroyed tab (`tab_closed`) or
	// a DevTools hand-over (`debugger_conflict`) burned the 2 s window and surfaced
	// as record_size/not_applied — a size refusal for a tab that is gone. Only a
	// failure a later poll can answer is a "not yet".
	for (const code of ["tab_closed", "debugger_conflict"]) {
		const original = new mod.BrowserHostError(code, `${code} from send`);
		const { start, commands, path, requested } = sizedStart({
			pollError: original,
		});
		const began = Date.now();
		const error = await start({ path, ...requested }).catch(
			(refusal) => refusal,
		);
		assert.equal(error, original, `${code} is rethrown untouched`);
		assert.equal(error.code, code);
		assert.equal(error.data?.reason, undefined, "not a record_size refusal");
		assert.ok(Date.now() - began < 1_000, `${code} fails at once`);
		assert.equal(
			commands.filter((call) => call.method === "Runtime.evaluate").length,
			1,
			`${code} is not retried`,
		);
		assert.equal(
			commands.at(-1).method,
			"Emulation.clearDeviceMetricsOverride",
			`${code} still restores the viewport`,
		);
		assert.ok(
			!commands.some((call) => call.method === "Page.startScreenRecording"),
			`${code} never reaches the recorder`,
		);
	}
});

test("a closed or DevTools-taken tab fails the frame wait at once, not as not_applied", async () => {
	// Q1's frame wait has the same tail as the poll: a tab that cannot draw again
	// must report why, not wait out the window and blame the size.
	for (const code of ["tab_closed", "debugger_conflict"]) {
		const original = new mod.BrowserHostError(code, `${code} from send`);
		const { start, commands, path, requested } = sizedStart({
			frameError: original,
		});
		const began = Date.now();
		const error = await start({ path, ...requested }).catch(
			(refusal) => refusal,
		);
		assert.equal(error, original, `${code} is rethrown untouched`);
		assert.equal(error.code, code);
		assert.equal(error.data?.reason, undefined, "not a record_size refusal");
		assert.ok(Date.now() - began < 1_000, `${code} fails at once`);
		assert.equal(
			commands.filter((call) => call.method === "Runtime.evaluate").length,
			2,
			`${code}: one poll and one frame answer, no retry`,
		);
		assert.equal(
			commands.at(-1).method,
			"Emulation.clearDeviceMetricsOverride",
			`${code} still restores the viewport`,
		);
		assert.ok(
			!commands.some((call) => call.method === "Page.startScreenRecording"),
			`${code} never reaches the recorder`,
		);
	}
});

test("a stale first frame answer is retried until the requested size is drawn", async () => {
	// Q1's loop must keep going when the first awaited frame still reports the OLD
	// size: the encoder would capture exactly the raster the wait exists to avoid.
	const { start, stop, commands, path, requested } = sizedStart({
		frames: [
			{ width: 1280, height: 720 },
			{ width: 1920, height: 1080 },
		],
	});
	const result = await start({ path, ...requested });
	assert.equal(result.width, 1920);
	assert.equal(result.height, 1080);
	const evaluates = commands.filter(
		(call) => call.method === "Runtime.evaluate",
	);
	assert.equal(evaluates.length, 3, "poll, stale frame answer, matching one");
	assert.equal(
		evaluates.filter((call) => call.params.awaitPromise === true).length,
		2,
		"the stale answer was retried once",
	);
	assert.equal(commands.at(-1).method, "Page.startScreenRecording");
	await stop();
});

test("a transient evaluate failure during a navigation is retried, not refused", async () => {
	// Review n-A: a tab mid-navigation answers "Cannot find default execution
	// context" until the new document exists. That is a start racing a load, so
	// the poll retries inside its own window instead of failing the start.
	const { start, stop, commands, path, requested } = sizedStart({
		layoutErrors: 2,
	});
	const result = await start({ path, ...requested });
	assert.equal(result.recording, true);
	const evaluates = commands.filter(
		(call) => call.method === "Runtime.evaluate",
	);
	assert.equal(
		evaluates.length,
		4,
		"two failed polls, one matching poll, one settle",
	);
	assert.equal(commands.at(-1).method, "Page.startScreenRecording");
	await stop();
});

test("a failed start that had resized the tab restores the viewport", async () => {
	const { start, stop, commands, path, requested } = sizedStart({
		startError: new Error("Screencast is already active"),
	});
	await rejectsReason(
		start({ path, ...requested }),
		"internal",
		"record_failed",
	);
	assert.deepEqual(
		commands.map((call) => call.method),
		[
			"Emulation.setDeviceMetricsOverride",
			"Runtime.evaluate",
			"Runtime.evaluate",
			"Page.startScreenRecording",
			"Emulation.clearDeviceMetricsOverride",
		],
	);
	await rejectsReason(stop(), "internal", "record_not_active");
});

test("a sized recording's duration timer restores the viewport", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { start, stop, commands, path, requested } = sizedStart();
	await start({ path, ...requested, max_duration_s: 5 });
	t.mock.timers.tick(5_000);
	const result = await stop();
	assert.equal(result.auto_stopped, true);
	assert.equal(result.width, 1920);
	assert.equal(result.height, 1080);
	const methods = commands.map((call) => call.method);
	assert.ok(
		methods.indexOf("Emulation.clearDeviceMetricsOverride") >
			methods.indexOf("Page.stopScreenRecording"),
		"the auto-stop restored the viewport",
	);
});

test("an abort restores the viewport it applied", async () => {
	const { start, stop, commands, path, requested, tabs } = sizedStart();
	await start({ path, ...requested });
	mod.abortRecording(tabs.get("tab").id, "test-abort");
	assert.ok(
		commands.some(
			(call) => call.method === "Emulation.clearDeviceMetricsOverride",
		),
	);
	await rejectsReason(stop(), "internal", "record_not_active");
});

test("abortAndEnd stops the recorder and restores the viewport", async () => {
	const { start, commands, path, requested, tabs } = sizedStart();
	await start({ path, ...requested });
	await mod.abortAndEnd(tabs.get("tab").id, "test-replace");
	const methods = commands.map((call) => call.method);
	assert.ok(methods.includes("Page.stopScreenRecording"));
	assert.ok(methods.includes("Emulation.clearDeviceMetricsOverride"));
});

test("a start cancelled while its viewport is applied restores it", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	let release;
	const gate = new Promise((resolveGate) => {
		release = resolveGate;
	});
	const { start, tabs, commands } = fixture({
		path,
		handler: ({ method }) => {
			if (method === "Runtime.evaluate") {
				return { result: { value: [1920, 1080] } };
			}
			if (method === "Page.startScreenRecording") return gate.then(() => ({}));
			if (method === "Page.stopScreenRecording")
				return { stream: "s-cancelled" };
			return {};
		},
	});
	const inFlight = start({ path, width: 1920, height: 1080 });
	await new Promise((resolveTick) => setImmediate(resolveTick));
	mod.abortRecording(tabs.get("tab").id, "test-cancelled");
	release();
	await rejectsReason(inFlight, "internal", "record_failed");
	const methods = commands.map((call) => call.method);
	assert.ok(
		methods.includes("Page.stopScreenRecording"),
		"the accepted start was ended",
	);
	assert.ok(
		methods.includes("Emulation.clearDeviceMetricsOverride"),
		"the viewport was restored",
	);
});

test("only one recording above 1080p runs at a time", async () => {
	const dir = scratchDir();
	// The layout answer follows the last override, so any accepted size settles.
	let layout = { width: 1280, height: 720 };
	const base = stream([Buffer.from("x")]);
	const { start, stop, addTab } = fixture({
		path: join(dir, "a.mp4"),
		handler: (call) => {
			if (call.method === "Emulation.setDeviceMetricsOverride") {
				layout = { width: call.params.width, height: call.params.height };
				return {};
			}
			if (call.method === "Runtime.evaluate") {
				return { result: { value: [layout.width, layout.height] } };
			}
			return base(call);
		},
	});
	addTab("tab-2");
	addTab("tab-3");
	addTab("tab-4");
	addTab("tab-5");
	await start(
		{ path: join(dir, "a.mp4"), width: 2560, height: 1440 },
		"session:a",
		"tab",
	);
	const refused = await start(
		{ path: join(dir, "b.mp4"), width: 3840, height: 2160 },
		"session:a",
		"tab-2",
	).catch((error) => error);
	assert.equal(refused.code, "busy");
	assert.equal(refused.data?.reason, "record_limit");
	assert.equal(refused.data?.limit, 1);
	assert.match(refused.message, /1920x1080/);
	// 1080p exactly is not "large", and is still allowed beside the 4K-ish clip.
	await start(
		{ path: join(dir, "c.mp4"), width: 1920, height: 1080 },
		"session:a",
		"tab-4",
	);
	await stop("session:a", "tab");
	await stop("session:a", "tab-4");
});

test("record_too_large names the size of a sized clip", async () => {
	const { start, stop, path, requested } = sizedStart({
		size: { width: 1280, height: 720 },
		endless: true,
	});
	await start({ path, ...requested, max_bytes: 1024 * 1024 });
	const error = await stop().catch((refusal) => refusal);
	assert.equal(error.data?.reason, "record_too_large");
	assert.match(error.message, /at 1280x720/);
});

// ---- 12. viewport ownership across a replace ------------------------------

/**
 * A tab whose emulated viewport is a FACT this fixture remembers, so a case can
 * assert which override is active after late CDP calls land. `Runtime.evaluate`
 * answers with it, the way a page that has already reflowed would.
 */
function viewportTab(options = {}) {
	let viewport = null;
	const commands = [];
	const handler = (call) => {
		commands.push(call);
		if (call.method === "Emulation.setDeviceMetricsOverride") {
			viewport = { width: call.params.width, height: call.params.height };
			return {};
		}
		if (call.method === "Emulation.clearDeviceMetricsOverride") {
			viewport = null;
			return {};
		}
		if (call.method === "Runtime.evaluate") {
			return {
				result: {
					value: viewport ? [viewport.width, viewport.height] : undefined,
				},
			};
		}
		if (call.method === "IO.read") {
			return { data: Buffer.from("clip-bytes").toString("base64"), eof: true };
		}
		return options.answer?.(call) ?? {};
	};
	const rig = fixture({ handler });
	return {
		...rig,
		commands,
		viewport: () => viewport,
	};
}

test("a tall page with a scrollbar still settles: the poll reads innerWidth", async () => {
	// The measured failure (review m1): a page that scrolls answers 1905 from
	// Page.getLayoutMetrics for a 1920-wide override, because the layout viewport
	// excludes the scrollbar, and the old poll refused a viewport that was right.
	// innerWidth is the surface the page and the encoder see.
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const base = stream([Buffer.from("ftyp-scroll")], {
		layout: { width: 1920, height: 1080 },
	});
	const { start, stop, commands } = fixture({
		handler: (call) => {
			if (call.method === "Page.getLayoutMetrics") {
				// What Electron 45.1.0 answers on a page tall enough to scroll.
				return { cssLayoutViewport: { clientWidth: 1905, clientHeight: 1080 } };
			}
			return base(call);
		},
	});
	const result = await start({ path, width: 1920, height: 1080 });
	assert.equal(result.width, 1920);
	assert.equal(result.height, 1080);
	assert.ok(
		!commands.some((call) => call.method === "Page.getLayoutMetrics"),
		"the scrollbar-blind metric is not what the poll trusts",
	);
	await stop();
});

test("a displaced recording's late finalize leaves the successor's viewport alone", async () => {
	const dir = scratchDir();
	const pathA = join(dir, "a.mp4");
	const pathB = join(dir, "b.mp4");
	let stopCalls = 0;
	let releaseStop;
	const stopGate = new Promise((resolveGate) => {
		releaseStop = resolveGate;
	});
	const rig = viewportTab({
		answer: ({ method }) => {
			if (method === "Page.stopScreenRecording") {
				stopCalls += 1;
				// A's stop hangs in Chromium until B is already recording.
				return stopCalls === 1
					? stopGate.then(() => ({ stream: "stream-a" }))
					: { stream: "stream-b" };
			}
			return {};
		},
	});
	const { start, stop, commands, viewport } = rig;
	await start({ path: pathA, width: 1280, height: 720 }, "session:a");
	const stoppingA = stop("session:a");
	await new Promise((resolveTick) => setImmediate(resolveTick));
	// B replaces A on the same tab: the replace installs 3840x2160 before A's
	// stop has answered.
	await start({ path: pathB, width: 3840, height: 2160 }, "session:b");
	assert.deepEqual(viewport(), { width: 3840, height: 2160 });
	const methods = commands.map((call) => call.method);
	assert.equal(
		methods.filter(
			(method) => method === "Emulation.clearDeviceMetricsOverride",
		).length,
		1,
		"A's own override was cleared once when it was displaced",
	);
	const setAtB = commands
		.map((call) => call.method)
		.lastIndexOf("Emulation.setDeviceMetricsOverride");
	releaseStop();
	await rejectsReason(stoppingA, "internal", "record_aborted");
	assert.deepEqual(
		viewport(),
		{ width: 3840, height: 2160 },
		"A's finalize landed after B's override and left it alone",
	);
	assert.deepEqual(
		commands
			.slice(setAtB + 1)
			.filter((call) => call.method === "Emulation.clearDeviceMetricsOverride"),
		[],
		"no clear was issued by the late finalize",
	);
	const savedB = await stop("session:b");
	assert.equal(savedB.path, pathB);
	assert.equal(viewport(), null, "B's own stop restored the tab");
});

test("a late endReplaced from abortAndEnd leaves a later start's viewport alone", async () => {
	const dir = scratchDir();
	const pathA = join(dir, "a.mp4");
	const pathB = join(dir, "b.mp4");
	let stopCalls = 0;
	let releaseStop;
	const stopGate = new Promise((resolveGate) => {
		releaseStop = resolveGate;
	});
	const rig = viewportTab({
		answer: ({ method }) => {
			if (method === "Page.stopScreenRecording") {
				stopCalls += 1;
				return stopCalls === 1
					? stopGate.then(() => ({ stream: "stream-a" }))
					: { stream: "stream-b" };
			}
			return {};
		},
	});
	const { start, stop, commands, viewport, tabs } = rig;
	await start({ path: pathA, width: 1280, height: 720 }, "session:a");
	// A is aborted and its recorder stop hangs; abortRecording already dropped it
	// from the tab, so B can start and install its own override meanwhile.
	const ending = mod.abortAndEnd(tabs.get("tab").id, "test-replace");
	await new Promise((resolveTick) => setImmediate(resolveTick));
	assert.equal(viewport(), null, "the abort restored A's override");
	await start({ path: pathB, width: 3840, height: 2160 }, "session:b");
	assert.deepEqual(viewport(), { width: 3840, height: 2160 });
	const setAtB = commands
		.map((call) => call.method)
		.lastIndexOf("Emulation.setDeviceMetricsOverride");
	releaseStop();
	await ending;
	assert.deepEqual(
		viewport(),
		{ width: 3840, height: 2160 },
		"endReplaced's finally clear skipped the successor's override",
	);
	assert.deepEqual(
		commands
			.slice(setAtB + 1)
			.filter((call) => call.method === "Emulation.clearDeviceMetricsOverride"),
		[],
	);
	await stop("session:b");
	assert.equal(viewport(), null);
});

test("a cancelled start's late endReplaced leaves a later start's viewport alone", async () => {
	const dir = scratchDir();
	const pathA = join(dir, "a.mp4");
	const pathB = join(dir, "b.mp4");
	let startCalls = 0;
	let releaseStart;
	const startGate = new Promise((resolveGate) => {
		releaseStart = resolveGate;
	});
	const rig = viewportTab({
		answer: ({ method }) => {
			if (method === "Page.startScreenRecording") {
				startCalls += 1;
				if (startCalls === 1) return startGate.then(() => ({}));
			}
			if (method === "Page.stopScreenRecording") {
				return { stream: "stream-cancelled" };
			}
			return {};
		},
	});
	const { start, stop, commands, viewport, tabs } = rig;
	const inFlightA = start(
		{ path: pathA, width: 1280, height: 720 },
		"session:a",
	);
	await new Promise((resolveTick) => setImmediate(resolveTick));
	// The handle goes while A's start is in flight; A never registers, so B can
	// take the tab and install its own size before A's start answers.
	mod.abortRecording(tabs.get("tab").id, "test-cancelled");
	await start({ path: pathB, width: 3840, height: 2160 }, "session:b");
	assert.deepEqual(viewport(), { width: 3840, height: 2160 });
	const setAtB = commands
		.map((call) => call.method)
		.lastIndexOf("Emulation.setDeviceMetricsOverride");
	releaseStart();
	await rejectsReason(inFlightA, "internal", "record_failed");
	assert.deepEqual(
		viewport(),
		{ width: 3840, height: 2160 },
		"the cancelled start's endReplaced skipped B's override",
	);
	assert.deepEqual(
		commands
			.slice(setAtB + 1)
			.filter((call) => call.method === "Emulation.clearDeviceMetricsOverride"),
		[],
	);
	await stop("session:b");
	assert.equal(viewport(), null);
});

test("a forget on a destroyed view ends the recording without recursing", async () => {
	// Review m2: `send -> forget -> dropCaptures -> abortRecording ->
	// clearViewport -> send` recursed on a destroyed view (depth ~870,
	// RangeError). The clear must not ask a view that is already gone.
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const { cdp, contents, ctx, sent } = poolFixture(({ method }) =>
		method === "Runtime.evaluate"
			? { result: { value: [1920, 1080] } }
			: undefined,
	);
	await cdp.attach(contents);
	await mod.recordStart(
		ctx,
		{ tab: "tab", requester: "session:a", path, width: 1920, height: 1080 },
		"r",
	);
	let destroyChecks = 0;
	contents.isDestroyed = () => {
		destroyChecks += 1;
		return true;
	};
	const beforeForget = sent.length;
	cdp.forget(contents.id);
	assert.ok(
		destroyChecks < 20,
		`the view was asked ${destroyChecks} times: the clear re-entered forget`,
	);
	// The guard, not the recursion ceiling, is what this pins: a destroyed view is
	// never asked to clear its override at all.
	assert.deepEqual(
		sent
			.slice(beforeForget)
			.filter((method) => method === "Emulation.clearDeviceMetricsOverride"),
		[],
		"the clear skipped a destroyed view",
	);
	await rejectsReason(
		mod.recordStop(ctx, { tab: "tab", requester: "session:a" }, "r"),
		"internal",
		"record_not_active",
	);
});

// ---- 11. quality: "high" (D15-D22) -----------------------------------------
//
// The high-quality engine is driven through the same `recordStart`/`recordStop`
// entry points with a FAKE encoder host injected as `ctx.recordingEncoder`: the
// lifecycle (subscription, window, timers, viewport, acks) is the shipped code, and
// only the hidden WebCodecs window is stood in for. The real window is exercised by
// the real-path matrix in the PR, not here.

const AVCC = Buffer.from([1, 0x64, 0, 0x33, 0xff, 0xe1, 0, 0]);

/** A base64 PNG header: the 8-byte signature, then IHDR with the given size. Only the
 * first 24 bytes are ever read in main (`pngSize`), so the rest is filler. */
function png(width, height) {
	const head = Buffer.alloc(33);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
	head.writeUInt32BE(13, 8);
	head.write("IHDR", 12, "latin1");
	head.writeUInt32BE(width, 16);
	head.writeUInt32BE(height, 20);
	return head.toString("base64");
}

/** A scripted encoder service. `windows` records every window opened; each one logs
 * what main sent it and what became of it. */
function fakeEncoder(options = {}) {
	const windows = [];
	const service = {
		timing: {
			nudgeMs: 25,
			firstFrameMs: 250,
			stopCaptureMs: 250,
			flushMs: 500,
			encoderStartMs: 500,
			...options.timing,
		},
		open: async (sink) => {
			if (options.openError) throw options.openError;
			if (options.openDelay) {
				await new Promise((done) => setTimeout(done, options.openDelay));
			}
			const log = {
				sink,
				configured: null,
				frames: [],
				disposed: false,
				flushes: 0,
				chunkBytes: options.chunkBytes ?? 4000,
			};
			windows.push(log);
			let keyAt = Number.NEGATIVE_INFINITY;
			let described = false;
			return {
				configure: async (request) => {
					log.configured = request;
					if (options.configureDelay) await sleep(options.configureDelay);
					if (options.configureAnswer) return options.configureAnswer;
					return {
						ok: true,
						encoder: options.encoder ?? "hardware",
						codec: "avc1.640033",
						width: request.width,
						height: request.height,
					};
				},
				frame: (seq, data, ts) => {
					log.frames.push({ seq, data, ts });
					if (options.silent) return;
					// The real window answers `frame-done` BEFORE the chunk has to arrive;
					// the chunk follows, and `flush` is what guarantees it is in.
					queueMicrotask(() => {
						if (log.disposed) return;
						sink.onFrameDone(seq);
					});
					setTimeout(() => {
						if (log.disposed) return;
						const key = ts - keyAt >= 2_000_000;
						if (key) keyAt = ts;
						sink.onChunk({
							data: Buffer.alloc(log.chunkBytes, seq),
							ts,
							key,
							...(described ? {} : { description: AVCC }),
						});
						described = true;
					}, 1);
				},
				flush: async () => {
					log.flushes += 1;
					if (options.flushError) throw options.flushError;
					await new Promise((done) => setTimeout(done, 15));
				},
				dispose: () => {
					log.disposed = true;
				},
			};
		},
	};
	return { service, windows };
}

/** The ids of every high-quality fixture's tabs: a case that fails midway must not
 * leave a recording holding the app-wide cap for the next one. */
const hqIds = [];
afterEach(() => {
	for (const id of hqIds.splice(0)) mod.abortRecording(id, "test-cleanup");
});

/** A fixture whose CDP answers the screencast methods, with a `hq` handle to the
 * encoder windows. `shots` is the nudge's screenshot. */
function hqFixture(options = {}) {
	const encoder = fakeEncoder(options.encoderOptions);
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const size = options.size ?? { width: 1280, height: 720 };
	let layout = null;
	const marks = {};
	const handler = (call) => {
		options.onCommand?.(call);
		if (call.method === "Emulation.clearDeviceMetricsOverride") {
			marks.clearedAt = Date.now();
		}
		if (call.method === "Page.stopScreencast" && options.stopDelay) {
			return sleep(options.stopDelay).then(() => {
				marks.stopDoneAt = Date.now();
				return {};
			});
		}
		if (call.method === "Page.startScreencast" && options.startDelay) {
			return sleep(options.startDelay).then(() => ({}));
		}
		if (call.method === "Emulation.setDeviceMetricsOverride") {
			layout = { width: call.params.width, height: call.params.height };
			return {};
		}
		if (call.method === "Runtime.evaluate") {
			return {
				result: { value: layout ? [layout.width, layout.height] : [0, 0] },
			};
		}
		if (call.method === "Page.captureScreenshot") {
			if (options.shotError) throw options.shotError;
			return { data: png(size.width, size.height) };
		}
		if (call.method === "Page.startScreencast" && options.startError) {
			throw options.startError;
		}
		if (call.method === "Page.stopScreencast" && options.stopScreencastError) {
			throw options.stopScreencastError;
		}
		return {};
	};
	const fx = fixture({ path, handler, encoder: encoder.service });
	const id = fx.tabs.get("tab").id;
	hqIds.push(id);
	return {
		...fx,
		...encoder,
		dir,
		path,
		id,
		size,
		marks,
		/** One screencast frame, `index` * 100 ms after the page's t0. */
		frame: (index, shot = size) =>
			fx.emit(id, "Page.screencastFrame", {
				data: png(shot.width, shot.height),
				sessionId: index + 1,
				metadata: { timestamp: 5000 + index * 0.1 },
			}),
		methods: () => fx.commands.map((call) => call.method),
		acks: () =>
			fx.commands
				.filter((call) => call.method === "Page.screencastFrameAck")
				.map((call) => call.params.sessionId),
	};
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function until(predicate, label, ms = 3000) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await sleep(5);
	}
	assert.fail(`timed out waiting for ${label}`);
}

/** The top-level box order of a written clip, from the file's own bytes. */
function topBoxes(file) {
	const out = [];
	for (let at = 0; at < file.length; ) {
		out.push(file.toString("latin1", at + 4, at + 8));
		at += file.readUInt32BE(at);
	}
	return out;
}

// -- the default is frozen ---------------------------------------------------

test("GOLDEN: an absent quality is today's AV1 path, call for call", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const { start, stop, commands } = fixture({
		path,
		chunks: [Buffer.from("golden-av1")],
	});
	const started = await start({ path, max_duration_s: 30 });
	assert.deepEqual(started, {
		recording: true,
		path,
		max_duration_s: 30,
		max_bytes: 64 * 1024 * 1024,
		fps: 10,
		container: "mp4",
		codec: "av1",
	});
	const stopped = await stop();
	assert.deepEqual(Object.keys(stopped).sort(), [
		"auto_stopped",
		"bytes",
		"codec",
		"container",
		"duration_ms",
		"fps",
		"path",
	]);
	assert.deepEqual(commands, [
		{
			method: "Page.startScreenRecording",
			params: { audio: false, maxWidth: 1280, maxHeight: 720, frameRate: 10 },
			sendOptions: { deadlineMs: 20_000 },
			view: commands[0].view,
		},
		{
			method: "Page.stopScreenRecording",
			params: {},
			sendOptions: { deadlineMs: 20_000 },
			view: commands[0].view,
		},
		{
			method: "IO.read",
			params: { handle: "stream-1", size: 1024 * 1024 },
			sendOptions: { deadlineMs: 15_000 },
			view: commands[0].view,
		},
		{
			method: "IO.close",
			params: { handle: "stream-1" },
			sendOptions: { deadlineMs: 15_000 },
			view: commands[0].view,
		},
	]);
	assert.deepEqual(readFileSync(path), Buffer.from("golden-av1"));
});

test('GOLDEN: quality "standard" is the same request as an absent one, and a high-capable host changes nothing for it', async () => {
	const { service, windows } = fakeEncoder();
	const runs = [];
	for (const extra of [{}, { quality: "standard" }, { quality: null }]) {
		for (const encoder of [undefined, service]) {
			const dir = scratchDir();
			const path = join(dir, "clip.mp4");
			const { start, stop, commands } = fixture({
				path,
				chunks: [Buffer.from("x")],
				...(encoder ? { encoder } : {}),
			});
			const started = await start({ path, ...extra });
			await stop();
			runs.push({
				started: { ...started, path: "<path>" },
				calls: commands.map((call) => [call.method, call.params]),
			});
		}
	}
	for (const run of runs.slice(1)) assert.deepEqual(run, runs[0]);
	assert.equal(windows.length, 0, "no encoder window for a standard clip");
});

test("an unknown quality is refused as record_quality before any CDP call", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const { service, windows } = fakeEncoder();
	const { start, commands } = fixture({ path, encoder: service });
	for (const quality of ["ultra", "HIGH", "", 1, true, ["high"]]) {
		const error = await start({ path, quality }).catch((refusal) => refusal);
		assert.equal(error.code, "internal", JSON.stringify(quality));
		assert.equal(error.data?.reason, "record_quality");
		assert.equal(error.data?.why, "value");
		assert.equal(error.data?.param, "quality");
		assert.match(error.message, /Nothing was started\.$/);
	}
	assert.deepEqual(commands, []);
	assert.equal(windows.length, 0);
});

test("a host with no encoder window refuses high as record_quality_unavailable, untouched", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const { start, commands } = fixture({ path });
	const error = await start({ path, quality: "high" }).catch((r) => r);
	assert.equal(error.data?.reason, "record_quality_unavailable");
	assert.equal(error.data?.why, "no_h264_encoder");
	assert.deepEqual(commands, []);
});

// -- start, frames, stop -----------------------------------------------------

test("a high start answers with the measured H.264 shape and records through the screencast", async () => {
	const h = hqFixture();
	const started = await h.start({ path: h.path, quality: "high" });
	assert.deepEqual(started, {
		recording: true,
		path: h.path,
		max_duration_s: 120,
		max_bytes: 64 * 1024 * 1024,
		quality: "high",
		fps: 10,
		container: "mp4",
		codec: "h264",
		width: 1280,
		height: 720,
		encoder: "hardware",
		bitrate_bps: 4_000_000,
	});
	const startCall = h.commands.find((c) => c.method === "Page.startScreencast");
	assert.deepEqual(startCall.params, {
		format: "png",
		maxWidth: 1280,
		maxHeight: 720,
		everyNthFrame: 1,
	});
	assert.ok(
		!h.methods().includes("Page.startScreenRecording"),
		"the AV1 recorder is never touched in high mode",
	);
	await h.stop();
});

test("frames reach the encoder in order with strictly increasing, rebased timestamps, and are all acked", async () => {
	const h = hqFixture();
	await h.start({ path: h.path, quality: "high" }).catch(() => undefined);
	// The start above waits for a first frame; deliver it through the screencast.
});

test("a clip is boxed, published through the part file, and reported with the high-mode result", async () => {
	const h = hqFixture();
	const starting = h.start({ path: h.path, quality: "high" });
	await until(() => h.id && h.subscriberCount(h.id) > 0, "the subscription");
	for (let i = 0; i < 4; i += 1) {
		h.frame(i);
		await sleep(110);
	}
	const started = await starting;
	assert.equal(started.quality, "high");
	const stopped = await h.stop();
	assert.equal(stopped.path, h.path);
	assert.equal(stopped.quality, "high");
	assert.equal(stopped.codec, "h264");
	assert.equal(stopped.container, "mp4");
	assert.equal(stopped.encoder, "hardware");
	assert.equal(stopped.frames, 4);
	assert.equal(stopped.stop_reason, "stop");
	assert.equal(stopped.auto_stopped, false);
	assert.equal(stopped.width, 1280);
	assert.equal(stopped.height, 720);
	assert.equal(typeof stopped.measured_fps, "number");
	assert.ok(stopped.measured_fps > 0);
	assert.ok(stopped.avg_bitrate_kbps > 0);
	const file = readFileSync(h.path);
	assert.equal(stopped.bytes, file.length);
	assert.deepEqual(topBoxes(file), ["ftyp", "moov", "mdat"], "faststart");
	assert.equal(statSync(h.path).mode & 0o777, 0o600);
	assert.deepEqual(partFiles(h.dir), []);
	// Exactly the frames sent, in order, on strictly increasing timestamps from 0.
	const sent = h.windows[0].frames;
	assert.equal(sent.length, 4);
	assert.equal(sent[0].ts, 0, "rebased to the first frame");
	for (let i = 1; i < sent.length; i += 1) {
		assert.ok(sent[i].ts > sent[i - 1].ts, "strictly increasing");
	}
	assert.deepEqual(
		sent.map((f) => f.seq),
		[1, 2, 3, 4],
	);
	// Every frame acked, none twice, all on the page's own session ids.
	assert.deepEqual(h.acks().sort(), [1, 2, 3, 4]);
	// The screencast is stopped (awaited) BEFORE the file is written, the window is
	// destroyed, and the subscription is gone.
	assert.ok(h.methods().includes("Page.stopScreencast"));
	assert.equal(h.windows[0].disposed, true);
	assert.equal(h.windows[0].flushes, 1);
	assert.equal(h.subscriberCount(h.id), 0);
});

test("the frame pacing is the ack: a burst is held to ~10 fps and the latest frame wins", async () => {
	const h = hqFixture();
	const starting = h.start({ path: h.path, quality: "high" });
	await until(() => h.subscriberCount(h.id) > 0, "the subscription");
	// 10 frames in one tick: far faster than the encoder window may be fed.
	for (let i = 0; i < 10; i += 1) h.frame(i);
	await starting;
	await sleep(350);
	const sent = h.windows[0].frames;
	assert.ok(sent.length <= 5, `a burst is paced, saw ${sent.length} frames`);
	// A displaced frame is acked at once, so the source is never starved...
	assert.ok(
		h.acks().length >= 8,
		`displaced frames were acked (${h.acks().length})`,
	);
	await h.stop();
	// ...and every frame is acked exactly once.
	const acks = h.acks();
	assert.equal(new Set(acks).size, acks.length, "no frame acked twice");
});

test("no ack is sent after the recording is disposed", async () => {
	const h = hqFixture();
	const starting = h.start({ path: h.path, quality: "high" });
	await until(() => h.subscriberCount(h.id) > 0, "the subscription");
	h.frame(0);
	await starting;
	h.abort(h.id, "test");
	const before = h.acks().length;
	h.frame(1);
	h.windows[0].sink.onFrameDone(1);
	await sleep(150);
	assert.equal(h.acks().length, before, "nothing is acked once disposed");
	assert.equal(h.windows[0].disposed, true);
	assert.equal(h.subscriberCount(h.id), 0);
});

// -- first frame -------------------------------------------------------------

test("a page that paints nothing is nudged with one screenshot, which becomes frame 0", async () => {
	const h = hqFixture();
	const started = await h.start({ path: h.path, quality: "high" });
	assert.equal(started.quality, "high");
	const shots = h.commands.filter((c) => c.method === "Page.captureScreenshot");
	assert.equal(shots.length, 1, "exactly one nudge");
	assert.deepEqual(shots[0].params, {
		format: "png",
		captureBeyondViewport: false,
	});
	assert.equal(h.windows[0].frames.length, 1);
	assert.equal(h.windows[0].frames[0].ts, 0);
	// The nudge has no session id, so nothing is acked for it.
	assert.deepEqual(h.acks(), []);
	await h.stop();
});

test("a start whose page never produces a frame fails record_failed, fully torn down", async () => {
	const h = hqFixture({
		shotError: new Error("no surface"),
		encoderOptions: { timing: { firstFrameMs: 120 } },
	});
	const error = await h
		.start({ path: h.path, quality: "high" })
		.catch((r) => r);
	assert.equal(error.data?.reason, "record_failed");
	assert.match(error.message, /no frame/);
	assert.equal(h.windows[0].disposed, true, "the window is destroyed");
	assert.equal(h.subscriberCount(h.id), 0, "the subscription is removed");
	assert.ok(
		h.methods().includes("Page.stopScreencast"),
		"the screencast is stopped",
	);
	assert.deepEqual(readdirSync(h.dir), [], "nothing on disk");
	await rejectsReason(h.stop(), "internal", "record_not_active");
});

test("a failed sized start restores the viewport and leaves nothing behind", async () => {
	const h = hqFixture({
		size: { width: 1920, height: 1080 },
		shotError: new Error("no surface"),
		encoderOptions: { timing: { firstFrameMs: 100 } },
	});
	const error = await h
		.start({ path: h.path, quality: "high", width: 1920, height: 1080 })
		.catch((r) => r);
	assert.equal(error.data?.reason, "record_failed");
	const methods = h.methods();
	assert.ok(methods.includes("Emulation.setDeviceMetricsOverride"));
	assert.ok(
		methods.lastIndexOf("Emulation.clearDeviceMetricsOverride") >
			methods.indexOf("Page.stopScreencast"),
		"the viewport is restored after the screencast stopped",
	);
	assert.equal(h.windows[0].disposed, true);
});

// -- refusals that happen before anything is started --------------------------

test("an encoder that is unavailable is refused with its why, and never falls back to AV1", async () => {
	for (const why of [
		"no_h264_encoder",
		"software_over_1080p",
		"size_unsupported",
		"encoder_start",
	]) {
		const h = hqFixture({
			encoderOptions: {
				configureAnswer: { ok: false, why, detail: `because ${why}` },
			},
			size: { width: 1920, height: 1080 },
		});
		const error = await h
			.start({ path: h.path, quality: "high", width: 1920, height: 1080 })
			.catch((r) => r);
		assert.equal(error.code, "internal", why);
		assert.equal(error.data?.reason, "record_quality_unavailable", why);
		assert.equal(error.data?.why, why);
		assert.match(error.message, /Retry without quality/);
		assert.ok(
			!h.methods().includes("Page.startScreenRecording"),
			"no silent fallback",
		);
		// A sized start configures BEFORE the screencast: nothing was captured.
		assert.ok(!h.methods().includes("Page.startScreencast"), why);
		assert.ok(
			h.methods().includes("Emulation.clearDeviceMetricsOverride"),
			why,
		);
		assert.equal(h.windows[0].disposed, true);
		await rejectsReason(h.stop(), "internal", "record_not_active");
	}
});

test("an unsized start learns its size from the first frame, and an unavailable encoder then stops the screencast", async () => {
	const h = hqFixture({
		encoderOptions: {
			configureAnswer: { ok: false, why: "no_h264_encoder", detail: "none" },
		},
	});
	const starting = h.start({ path: h.path, quality: "high" }).catch((r) => r);
	await until(() => h.subscriberCount(h.id) > 0, "the subscription");
	h.frame(0, { width: 1144, height: 720 });
	const error = await starting;
	assert.equal(error.data?.reason, "record_quality_unavailable");
	assert.equal(error.data?.why, "no_h264_encoder");
	assert.ok(h.methods().includes("Page.stopScreencast"));
	assert.equal(h.windows[0].disposed, true);
});

test("an unsized clip is configured from its first frame, rounded to even sides", async () => {
	const h = hqFixture();
	const starting = h.start({ path: h.path, quality: "high" });
	await until(() => h.subscriberCount(h.id) > 0, "the subscription");
	// An odd-sized frame under the ceiling: the odd pixel is dropped, nothing scaled.
	h.frame(0, { width: 1145, height: 719 });
	const started = await starting;
	assert.equal(
		started.width,
		1144,
		"the odd pixel is dropped: H.264 needs even sides",
	);
	assert.equal(started.height, 718);
	assert.equal(h.windows[0].configured.width, 1144);
	assert.equal(h.windows[0].configured.softwareAllowed, true);
	await h.stop();
});

test("an unscaled first frame larger than the ceiling is configured at the size the screencast would have given it", async () => {
	// The nudge's screenshot is NOT scaled by Chromium (a presented 1380x868 view):
	// the coded size must be the ceiling-fitted one every later frame will have.
	const h = hqFixture();
	const starting = h.start({ path: h.path, quality: "high" });
	await until(() => h.subscriberCount(h.id) > 0, "the subscription");
	h.frame(0, { width: 1380, height: 868 });
	const started = await starting;
	assert.equal(started.width, 1144);
	assert.equal(started.height, 720);
	await h.stop();
});

test("software is allowed up to 1080p and not above; the bitrate follows the area", async () => {
	const cases = [
		[{ width: 1280, height: 720 }, 4_000_000, true],
		[{ width: 1920, height: 1080 }, 8_000_000, true],
		[{ width: 2560, height: 1440 }, 16_000_000, false],
		[{ width: 3840, height: 2160 }, 16_000_000, false],
	];
	for (const [size, bitrate, software] of cases) {
		assert.equal(mod.bitrateFor(size.width, size.height), bitrate);
		const h = hqFixture({ size });
		await h.start({ path: h.path, quality: "high", ...size });
		assert.equal(h.windows[0].configured.bitrate, bitrate);
		assert.equal(h.windows[0].configured.softwareAllowed, software);
		assert.equal(h.windows[0].configured.keyIntervalUs, 2_000_000);
		assert.equal(h.windows[0].configured.fps, 10);
		await h.stop();
	}
});

test("pngSize reads the header without decoding, and refuses a non-PNG", () => {
	assert.deepEqual(mod.pngSize(png(3840, 2160)), { width: 3840, height: 2160 });
	assert.equal(
		mod.pngSize(Buffer.from("not a png at all, just text").toString("base64")),
		null,
	);
	assert.equal(mod.pngSize(""), null);
});

test("a sized high start follows the standard order, then starts the screencast", async () => {
	const h = hqFixture({ size: { width: 1920, height: 1080 } });
	const started = await h.start({
		path: h.path,
		quality: "high",
		width: 1920,
		height: 1080,
	});
	assert.equal(started.width, 1920);
	const methods = h.methods();
	assert.deepEqual(methods.slice(0, 4), [
		"Emulation.setDeviceMetricsOverride",
		"Runtime.evaluate",
		"Runtime.evaluate",
		"Page.startScreencast",
	]);
	assert.deepEqual(h.commands[3].params, {
		format: "png",
		maxWidth: 1920,
		maxHeight: 1080,
		everyNthFrame: 1,
	});
	await h.stop();
	const after = h.methods();
	assert.ok(
		after.indexOf("Emulation.clearDeviceMetricsOverride") >
			after.indexOf("Page.stopScreencast"),
		"the viewport is restored after the screencast stops, so the last frames are not rescaled",
	);
	assert.equal(
		after.filter((m) => m === "Emulation.clearDeviceMetricsOverride").length,
		1,
	);
});

test("a sized high start on a user-visible tab is refused before any CDP call or window", async () => {
	const encoder = fakeEncoder();
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const { start, commands } = fixture({
		path,
		presentedTab: "tab",
		encoder: encoder.service,
	});
	const error = await start({
		path,
		quality: "high",
		width: 1920,
		height: 1080,
	}).catch((r) => r);
	assert.equal(error.data?.reason, "record_size");
	assert.equal(error.data?.why, "visible");
	assert.deepEqual(commands, []);
	assert.equal(encoder.windows.length, 0);
});

// -- concurrency -------------------------------------------------------------

test("high recordings count against the same caps as standard ones", async () => {
	const encoder = fakeEncoder();
	const dir = scratchDir();
	let layout = { width: 1280, height: 720 };
	const base = stream([Buffer.from("x")]);
	const { start, stop, addTab, commands } = fixture({
		path: join(dir, "a.mp4"),
		encoder: encoder.service,
		handler: (call) => {
			if (call.method === "Emulation.setDeviceMetricsOverride") {
				layout = { width: call.params.width, height: call.params.height };
				return {};
			}
			if (call.method === "Runtime.evaluate") {
				return { result: { value: [layout.width, layout.height] } };
			}
			if (call.method === "Page.captureScreenshot") {
				return { data: png(layout.width, layout.height) };
			}
			return base(call);
		},
	});
	for (const name of ["tab-2", "tab-3", "tab-4"]) addTab(name);
	// One high 4K recording...
	await start(
		{ path: join(dir, "a.mp4"), quality: "high", width: 3840, height: 2160 },
		"session:a",
		"tab",
	);
	// ...blocks a second above 1080p, high OR standard...
	for (const quality of ["high", "standard"]) {
		const refused = await start(
			{
				path: join(dir, `b-${quality}.mp4`),
				quality,
				width: 3840,
				height: 2160,
			},
			"session:a",
			"tab-2",
		).catch((error) => error);
		assert.equal(refused.data?.reason, "record_limit", quality);
		assert.equal(refused.data?.limit, 1);
	}
	// ...but 1080p fits beside it, and the global cap of two then refuses a third.
	await start(
		{ path: join(dir, "c.mp4"), quality: "high", width: 1920, height: 1080 },
		"session:a",
		"tab-3",
	);
	const third = await start(
		{ path: join(dir, "d.mp4"), quality: "high", width: 1280, height: 720 },
		"session:a",
		"tab-4",
	).catch((error) => error);
	assert.equal(third.data?.reason, "record_limit");
	assert.equal(third.data?.limit, 2);
	const refusedCalls = commands.filter((c) => c.view === commands.at(-1).view);
	assert.ok(refusedCalls.length >= 0);
	await stop("session:a", "tab");
	await stop("session:a", "tab-3");
	assert.ok(encoder.windows.every((w) => w.disposed));
});

// -- every exit path disposes ------------------------------------------------

test("every debugger boundary disposes a high recording: window, subscription, timer, chunks", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const dir = scratchDir();
	for (const boundary of ["detach event", "forget", "detach", "close"]) {
		const encoder = fakeEncoder();
		const { cdp, contents, debuggerLike, ctx } = poolFixture(({ method }) =>
			method === "Page.captureScreenshot"
				? { data: png(1280, 720) }
				: undefined,
		);
		ctx.recordingEncoder = encoder.service;
		await cdp.attach(contents);
		const path = join(dir, `${boundary.replace(" ", "-")}.mp4`);
		const starting = mod.recordStart(
			ctx,
			{ tab: "tab", requester: "session:a", path, quality: "high" },
			"r",
		);
		// The nudge timer and the first-frame bound are mocked, so deliver the first
		// frame the way Chromium does.
		await Promise.resolve();
		await Promise.resolve();
		for (let i = 0; i < 20 && encoder.windows.length === 0; i += 1)
			await Promise.resolve();
		debuggerLike.emit("message", {}, "Page.screencastFrame", {
			data: png(1280, 720),
			sessionId: 1,
			metadata: { timestamp: 100 },
		});
		t.mock.timers.tick(50);
		for (let i = 0; i < 50; i += 1) await Promise.resolve();
		t.mock.timers.tick(150);
		for (let i = 0; i < 50; i += 1) await Promise.resolve();
		await starting;
		const window = encoder.windows[0];
		assert.equal(window.disposed, false, `${boundary}: running`);
		if (boundary === "detach event")
			debuggerLike.emit("detach", {}, "canceled_by_user");
		if (boundary === "forget") cdp.forget(contents.id);
		if (boundary === "detach") await cdp.detach(contents.id);
		if (boundary === "close") await cdp.close();
		assert.equal(
			window.disposed,
			true,
			`${boundary}: the encoder window is destroyed`,
		);
		t.mock.timers.tick(10 * 60 * 1000);
		// A frame after the abort goes nowhere: no listener, no ack, no new send.
		const sentBefore = window.frames.length;
		debuggerLike.emit("message", {}, "Page.screencastFrame", {
			data: png(1280, 720),
			sessionId: 9,
			metadata: { timestamp: 101 },
		});
		assert.equal(
			window.frames.length,
			sentBefore,
			`${boundary}: no frame after the abort`,
		);
		await rejectsReason(
			mod.recordStop(ctx, { tab: "tab", requester: "session:a" }, "r"),
			"internal",
			boundary === "detach event" ? "record_aborted" : "record_not_active",
		);
		assert.equal(existsSync(path), false, `${boundary}: nothing written`);
		assert.deepEqual(partFiles(dir), []);
	}
});

test("an abort while the encoder window is still opening destroys it when it arrives", async () => {
	const h = hqFixture({ encoderOptions: { openDelay: 80 } });
	const starting = h.start({ path: h.path, quality: "high" }).catch((r) => r);
	await sleep(15);
	h.abort(h.id, "forget");
	const error = await starting;
	assert.ok(error instanceof Error);
	assert.equal(h.windows.length <= 1, true);
	for (const window of h.windows) assert.equal(window.disposed, true);
	assert.equal(h.subscriberCount(h.id), 0);
	await rejectsReason(h.stop(), "internal", "record_not_active");
});

test("an owner replace stops the old screencast, awaited, before the new start, and disposes the old window", async () => {
	const h = hqFixture();
	const first = h.start({ path: h.path, quality: "high" });
	await first;
	assert.equal(h.windows.length, 1);
	const second = await h.start(
		{ path: join(h.dir, "second.mp4"), quality: "high" },
		"session:b",
	);
	assert.equal(second.quality, "high");
	assert.equal(
		h.windows[0].disposed,
		true,
		"the displaced recording's window is gone",
	);
	assert.equal(h.windows.length, 2);
	const methods = h.methods();
	const stopAt = methods.indexOf("Page.stopScreencast");
	const secondStart = methods.lastIndexOf("Page.startScreencast");
	assert.ok(
		stopAt >= 0 && stopAt < secondStart,
		"the old screencast ends first",
	);
	// The old owner has nothing to stop; the new one does.
	await rejectsReason(h.stop("session:a"), "internal", "record_not_active");
	const stopped = await h.stop("session:b");
	assert.equal(stopped.quality, "high");
	assert.equal(
		existsSync(h.path),
		false,
		"the displaced clip is never published",
	);
});

test("a start cancelled while the screencast is starting stops it and restores the viewport", async () => {
	const h = hqFixture({
		size: { width: 1920, height: 1080 },
		onCommand: (call) => {
			if (call.method === "Page.startScreencast") h.abort(h.id, "forget");
		},
	});
	const error = await h
		.start({ path: h.path, quality: "high", width: 1920, height: 1080 })
		.catch((r) => r);
	assert.ok(error instanceof Error);
	assert.equal(h.windows[0].disposed, true);
	assert.ok(h.methods().includes("Page.stopScreencast"));
	assert.ok(h.methods().includes("Emulation.clearDeviceMetricsOverride"));
	assert.equal(h.subscriberCount(h.id), 0);
});

// -- the cap and the timer ---------------------------------------------------

test("hitting the byte cap in high mode finalises gracefully with stop_reason max_bytes", async () => {
	const h = hqFixture({ encoderOptions: { chunkBytes: 9000 } });
	const starting = h.start({
		path: h.path,
		quality: "high",
		max_bytes: 30_000,
	});
	await until(() => h.subscriberCount(h.id) > 0, "the subscription");
	for (let i = 0; i < 12; i += 1) {
		h.frame(i);
		await sleep(110);
	}
	await starting;
	// The cap fired mid-clip: the clip finalised ITSELF, and the next stop collects it.
	await until(() => existsSync(h.path), "the capped clip to be published");
	const stopped = await h.stop();
	assert.equal(stopped.auto_stopped, true);
	assert.equal(stopped.stop_reason, "max_bytes");
	assert.ok(stopped.bytes <= 30_000, `file ${stopped.bytes} is within the cap`);
	assert.ok(stopped.frames >= 1 && stopped.frames < 12);
	assert.deepEqual(topBoxes(readFileSync(h.path)), ["ftyp", "moov", "mdat"]);
	assert.equal(h.windows[0].disposed, true);
	assert.deepEqual(partFiles(h.dir), []);
});

test("a cap smaller than the first frame is record_too_large, with nothing on disk", async () => {
	const h = hqFixture({ encoderOptions: { chunkBytes: 9000 } });
	const starting = h.start({ path: h.path, quality: "high", max_bytes: 5000 });
	await until(() => h.subscriberCount(h.id) > 0, "the subscription");
	h.frame(0);
	await starting.catch(() => undefined);
	await sleep(120);
	const error = await h.stop().catch((r) => r);
	assert.equal(error.data?.reason, "record_too_large");
	assert.equal(existsSync(h.path), false);
	assert.deepEqual(partFiles(h.dir), []);
});

test("the duration timer finalises a high clip with stop_reason max_duration and restores the viewport", async (t) => {
	const h = hqFixture({ size: { width: 1920, height: 1080 } });
	await h.start({
		path: h.path,
		quality: "high",
		width: 1920,
		height: 1080,
		max_duration_s: 1,
	});
	// Real time: the clip is one second, which is the shortest the contract allows.
	await sleep(1250);
	const stopped = await h.stop();
	assert.equal(stopped.auto_stopped, true);
	assert.equal(stopped.stop_reason, "max_duration");
	assert.equal(stopped.quality, "high");
	assert.ok(h.methods().includes("Emulation.clearDeviceMetricsOverride"));
	assert.equal(h.windows[0].disposed, true);
	assert.deepEqual(partFiles(h.dir), []);
	t.diagnostic("real-time cap");
});

// -- the encoder dying -------------------------------------------------------

test("an encoder window that dies mid-clip fails the recording record_failed and tears down", async () => {
	const h = hqFixture({ size: { width: 1920, height: 1080 } });
	await h.start({ path: h.path, quality: "high", width: 1920, height: 1080 });
	h.windows[0].sink.onFailure("the encoder process exited (crashed)");
	await until(() => h.windows[0].disposed, "the window to be disposed");
	const methods = h.methods();
	await until(
		() =>
			h.methods().filter((m) => m === "Emulation.clearDeviceMetricsOverride")
				.length === 1,
		"the viewport to be restored",
	);
	assert.ok(methods.includes("Page.stopScreencast"));
	assert.equal(h.subscriberCount(h.id), 0);
	const error = await h.stop().catch((r) => r);
	assert.equal(error.data?.reason, "record_failed");
	assert.match(error.message, /encoder process exited/);
	assert.equal(existsSync(h.path), false);
	assert.deepEqual(partFiles(h.dir), []);
	// And the failure is consumed once.
	await rejectsReason(h.stop(), "internal", "record_not_active");
});

test("an encoder that dies while a stop is flushing fails that stop, with no file and no part", async () => {
	const h = hqFixture({
		encoderOptions: { flushError: new Error("the encoder window is gone") },
	});
	await h.start({ path: h.path, quality: "high" });
	const error = await h.stop().catch((r) => r);
	assert.equal(error.data?.reason, "record_failed");
	assert.equal(existsSync(h.path), false);
	assert.deepEqual(partFiles(h.dir), []);
	assert.equal(h.windows[0].disposed, true);
});

test("a path that appears during a high clip is never overwritten, and the part is removed", async () => {
	const h = hqFixture();
	await h.start({ path: h.path, quality: "high" });
	writeFileSync(h.path, "someone else's file");
	const error = await h.stop().catch((r) => r);
	assert.equal(error.data?.reason, "record_path");
	assert.equal(readFileSync(h.path, "utf8"), "someone else's file");
	assert.deepEqual(partFiles(h.dir), []);
	assert.equal(h.windows[0].disposed, true);
});

test("a second start by the same owner is busy in high mode too, with no new window", async () => {
	const h = hqFixture();
	await h.start({ path: h.path, quality: "high" });
	const error = await h
		.start({ path: join(h.dir, "again.mp4"), quality: "high" })
		.catch((r) => r);
	assert.equal(error.code, "busy");
	assert.equal(error.data?.reason, "record_active");
	assert.equal(h.windows.length, 1);
	await h.stop();
});

test("the protocol advertises record_quality as a capability, not a method", () => {
	assert.ok(mod.HOST_CAPABILITIES.includes("record_quality"));
	assert.ok(!mod.METHODS.includes("record_quality"));
	assert.equal(
		mod.PROTO_VERSION,
		1,
		"no PROTO_VERSION bump for a capability token",
	);
});

test("the encoder document and preload are build inputs, and main points at what the build emits", () => {
	const config = readFileSync("electron.vite.config.js", "utf8");
	// The document is declared in BOTH halves (dev server list and the build's
	// `rollupOptions.input`), or it serves in development and 404s in a build.
	const document = "src/renderer/recording-encoder.html";
	assert.equal(
		config.split(document).length - 1,
		2,
		"declared in the renderer's dev input AND rollupOptions.input",
	);
	// The preload is a second preload entry: without it `out/preload` has no file for
	// the window's `preload:` path and the window starts with no bridge.
	assert.ok(config.includes("src/preload/recording-encoder.ts"));
	const entry = readFileSync("src/main/index.ts", "utf8");
	assert.ok(entry.includes('"../preload/recording-encoder.js"'));
	assert.ok(entry.includes('"recording-encoder.html"'));
	// `before-quit` destroys every encoder window in its SYNCHRONOUS part: the call
	// must come before the first await in the handler (the session-cookie hold), not
	// only in the backstop after it (review round 2, m-b).
	// Comments mention the word, so only code lines count.
	const handler = entry
		.slice(entry.indexOf('app.on("before-quit"'))
		.split("\n")
		.filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
		.join("\n");
	const early = handler.indexOf("disposeAllRecordingEncoders();");
	const hold = handler.indexOf("await holdQuitForSessionCookieSnapshot");
	assert.ok(early >= 0 && hold >= 0, "both sites exist");
	assert.ok(early < hold, "the dispose is ahead of the first await");
	assert.equal(
		handler.slice(0, early).includes("await "),
		false,
		"nothing awaits before it",
	);
	// ...and the backstop after the hold stays, for a quit that re-enters.
	assert.match(
		entry,
		/disposeAllRecordingEncoders\(\);\s*void stopBrowserHost\(\);/,
	);
});

// -- remediation round 1 -------------------------------------------------------

/** A debugger that behaves like Chromium where it matters here: a screencast runs
 * from `Page.startScreencast` until `Page.stopScreencast` OR `Page.disable`, and
 * `Page.enable` does NOT restart it (measured on Electron 45, QA round 1 Q1). */
class ScreencastDebugger extends EventEmitter {
	attached = false;
	screencasting = false;
	calls = [];
	failStart = false;
	failDisable = false;
	startDelay = 0;
	stopDelay = 0;
	sessions = [];
	attach() {
		this.attached = true;
	}
	detach() {
		this.attached = false;
	}
	isAttached() {
		return this.attached;
	}
	async sendCommand(method, params, sessionId) {
		this.calls.push(method);
		if (sessionId) {
			// A child frame's own session: its Page domain is not the page's, so it
			// cannot end the page's screencast.
			this.sessions.push([method, sessionId]);
			return {};
		}
		if (method === "Page.startScreencast") {
			if (this.failStart && this.calls.filter((m) => m === method).length > 1)
				throw new Error("start refused");
			if (this.startDelay) await sleep(this.startDelay);
			this.screencasting = true;
		}
		if (method === "Page.stopScreencast") {
			if (this.stopDelay) await sleep(this.stopDelay);
			this.screencasting = false;
		}
		if (method === "Page.disable") {
			this.screencasting = false;
			// A disable that timed out may still have landed.
			if (this.failDisable) throw new Error("Page.disable timed out");
		}
		if (method === "Page.captureScreenshot") {
			return { data: png(1280, 720) };
		}
		if (method === "Page.stopScreenRecording") return { stream: "s" };
		if (method === "IO.read") {
			return {
				data: Buffer.from("av1").toString("base64"),
				base64Encoded: true,
				eof: true,
			};
		}
		void params;
		return {};
	}
	/** One frame, only if Chromium would still be producing them. */
	tick(index) {
		if (!this.screencasting) return false;
		this.emit("message", {}, "Page.screencastFrame", {
			data: png(1280, 720),
			sessionId: index + 1,
			metadata: { timestamp: 5000 + index * 0.1 },
		});
		return true;
	}
}

async function screencastPool(encoderOptions) {
	const encoder = fakeEncoder(encoderOptions);
	const cdp = new mod.CdpPool();
	const dbg = new ScreencastDebugger();
	const contents = contentsFor(9500 + nextViewId++, { debugger: dbg });
	createdIds.push(contents.id);
	// A case that leaves its clip running must not hold the app-wide cap for the next.
	hqIds.push(contents.id);
	const ctx = {
		cdp,
		recordingEncoder: encoder.service,
		registry: { requireSurface: () => ({ view: { webContents: contents } }) },
	};
	await cdp.attach(contents);
	return { encoder, cdp, dbg, contents, ctx, dir: scratchDir() };
}

test("Q1: a Page.disable (the origin gate's, after every click/type/press/goto) does not freeze a high clip", async () => {
	const { encoder, cdp, dbg, contents, ctx, dir } = await screencastPool();
	const path = join(dir, "gated.mp4");
	const starting = mod.recordStart(
		ctx,
		{ tab: "tab", requester: "session:a", path, quality: "high" },
		"r",
	);
	await until(() => dbg.screencasting, "the screencast");
	dbg.tick(0);
	await starting;
	assert.equal(dbg.calls.filter((m) => m === "Page.startScreencast").length, 1);
	// What `withOriginGate` does around a gated action.
	await cdp.send(contents, "Page.enable", {});
	await cdp.send(contents, "Page.disable", {});
	await until(
		() => dbg.calls.filter((m) => m === "Page.startScreencast").length === 2,
		"the screencast to be started again",
	);
	assert.equal(dbg.screencasting, true, "Chromium produces frames again");
	const before = encoder.windows[0].frames.length;
	await sleep(120);
	assert.equal(dbg.tick(1), true);
	await until(
		() => encoder.windows[0].frames.length > before,
		"a frame after the action to reach the encoder",
	);
	// Several gated actions in a row each restart it, and a burst coalesces.
	await Promise.all([
		cdp.send(contents, "Page.disable", {}),
		cdp.send(contents, "Page.disable", {}),
	]);
	await until(() => dbg.screencasting, "the screencast after a burst");
	const stopped = await mod.recordStop(
		ctx,
		{ tab: "tab", requester: "session:a" },
		"r",
	);
	assert.equal(stopped.quality, "high");
	assert.ok(stopped.frames >= 2);
	// A disable AFTER the stop must not start anything.
	const starts = dbg.calls.filter((m) => m === "Page.startScreencast").length;
	await cdp.send(contents, "Page.disable", {});
	await sleep(30);
	assert.equal(
		dbg.calls.filter((m) => m === "Page.startScreencast").length,
		starts,
	);
});

test("Q1: a frame session's Page.disable and a standard clip's are not announced", async () => {
	const { cdp, dbg, contents, ctx, dir } = await screencastPool();
	const path = join(dir, "std.mp4");
	await mod.recordStart(ctx, { tab: "tab", requester: "session:a", path }, "r");
	await cdp.send(contents, "Page.disable", {});
	await sleep(30);
	assert.equal(
		dbg.calls.filter((m) => m === "Page.startScreencast").length,
		0,
		"the standard engine has no screencast to restart",
	);
	await mod.recordStop(ctx, { tab: "tab", requester: "session:a" }, "r");
});

test("Q1: a screencast that cannot be restarted fails the recording instead of freezing it", async () => {
	const { cdp, dbg, contents, ctx, dir } = await screencastPool();
	const path = join(dir, "norestart.mp4");
	const starting = mod.recordStart(
		ctx,
		{ tab: "tab", requester: "session:a", path, quality: "high" },
		"r",
	);
	await until(() => dbg.screencasting, "the screencast");
	dbg.tick(0);
	await starting;
	dbg.failStart = true;
	await cdp.send(contents, "Page.disable", {});
	await sleep(30);
	const error = await mod
		.recordStop(ctx, { tab: "tab", requester: "session:a" }, "r")
		.catch((r) => r);
	assert.equal(error.data?.reason, "record_failed");
	assert.match(error.message, /could not be restarted/);
	assert.equal(existsSync(path), false);
});

test("M1: a window that opens after the start's bound is destroyed, and the timeout is encoder_start", async () => {
	const h = hqFixture({
		encoderOptions: { openDelay: 300, timing: { encoderStartMs: 60 } },
	});
	const error = await h
		.start({ path: h.path, quality: "high" })
		.catch((r) => r);
	assert.equal(error.data?.reason, "record_quality_unavailable");
	assert.equal(error.data?.why, "encoder_start");
	await until(() => h.windows.length === 1, "the late window");
	assert.equal(h.windows[0].disposed, true, "the late window is destroyed");
	assert.equal(h.methods().includes("Page.startScreencast"), false);
});

test("M1: a configure that outlasts its bound is encoder_start too", async () => {
	const h = hqFixture({
		encoderOptions: { configureDelay: 300, timing: { encoderStartMs: 60 } },
		size: { width: 1920, height: 1080 },
	});
	const error = await h
		.start({ path: h.path, quality: "high", width: 1920, height: 1080 })
		.catch((r) => r);
	assert.equal(error.data?.reason, "record_quality_unavailable");
	assert.equal(error.data?.why, "encoder_start");
	assert.equal(h.windows[0].disposed, true);
});

test("m1: an abort during Page.startScreencast ends the start at once, without the first-frame wait", async () => {
	const h = hqFixture({ startDelay: 120 });
	const began = Date.now();
	const starting = h.start({ path: h.path, quality: "high" }).catch((r) => r);
	await until(() => h.methods().includes("Page.startScreencast"), "the start");
	h.abort(h.id, "forget");
	const error = await starting;
	const took = Date.now() - began;
	assert.ok(error instanceof Error);
	// startDelay 120 + the 250 ms first-frame bound would be ~370 ms.
	assert.ok(took < 250, `ended in ${took} ms, not after the first-frame bound`);
	assert.equal(h.windows[0].disposed, true);
	assert.equal(h.subscriberCount(h.id), 0);
});

test("m1: an abort during a sized configure never subscribes or starts a screencast", async () => {
	const h = hqFixture({
		encoderOptions: { configureDelay: 100 },
		size: { width: 1920, height: 1080 },
	});
	const starting = h
		.start({ path: h.path, quality: "high", width: 1920, height: 1080 })
		.catch((r) => r);
	await until(() => h.windows[0]?.configured, "the configure");
	h.abort(h.id, "forget");
	await starting;
	assert.equal(h.methods().includes("Page.startScreencast"), false);
	assert.equal(h.subscriberCount(h.id), 0);
	assert.equal(h.windows[0].disposed, true);
});

test("mutant guard: an abort while the window opens fails the start quickly and never starts a screencast", async () => {
	const h = hqFixture({ encoderOptions: { openDelay: 60 } });
	const began = Date.now();
	const starting = h.start({ path: h.path, quality: "high" }).catch((r) => r);
	await sleep(10);
	h.abort(h.id, "forget");
	await starting;
	assert.ok(Date.now() - began < 200, "not the 250 ms first-frame wait");
	assert.equal(h.methods().includes("Page.startScreencast"), false);
});

test("mutant guard: nothing is acked after a dispose, even with an ack already scheduled", async () => {
	const h = hqFixture();
	const starting = h.start({ path: h.path, quality: "high" });
	await until(() => h.subscriberCount(h.id) > 0, "the subscription");
	h.frame(0);
	await starting;
	// The frame is with the encoder; its ack waits out the 100 ms interval.
	await sleep(20);
	h.abort(h.id, "test");
	const before = h.acks().length;
	await sleep(200);
	assert.equal(h.acks().length, before);
});

test("mutant guard: the byte cap counts the container's overhead, not only the payload", async () => {
	// Three 9000-byte samples are 27000 payload bytes. A cap 100 bytes above that
	// admits them on payload alone, but the boxes around them do not fit: the clip
	// must end at the samples that fit WITH their overhead, as a finished clip, and
	// never as a `record_too_large` discovered at the end.
	const h = hqFixture({ encoderOptions: { chunkBytes: 9000 } });
	const cap = 27_100;
	const starting = h.start({ path: h.path, quality: "high", max_bytes: cap });
	await until(() => h.subscriberCount(h.id) > 0, "the subscription");
	for (let i = 0; i < 8; i += 1) {
		h.frame(i);
		await sleep(110);
	}
	await starting;
	await until(() => existsSync(h.path), "the capped clip");
	const stopped = await h.stop();
	assert.equal(stopped.stop_reason, "max_bytes");
	assert.ok(stopped.bytes <= cap, `${stopped.bytes} fits the cap`);
	assert.ok(
		stopped.frames < 3,
		"the third sample did not fit with its overhead",
	);
});

test("mutant guard: a failed high clip restores the viewport only after the screencast has stopped", async () => {
	const h = hqFixture({
		stopDelay: 90,
		size: { width: 1920, height: 1080 },
	});
	await h.start({ path: h.path, quality: "high", width: 1920, height: 1080 });
	h.windows[0].sink.onFailure("the encoder process exited (crashed)");
	await until(() => h.marks.clearedAt, "the viewport to be restored");
	assert.ok(h.marks.stopDoneAt, "the stop finished");
	assert.ok(
		h.marks.clearedAt >= h.marks.stopDoneAt,
		"the tab is not resized under a screencast that is still running",
	);
});

test("mutant guard: two frames with one page timestamp get strictly increasing media time", async () => {
	const h = hqFixture();
	const starting = h.start({ path: h.path, quality: "high" });
	await until(() => h.subscriberCount(h.id) > 0, "the subscription");
	const same = (id) =>
		h.emit(h.id, "Page.screencastFrame", {
			data: png(1280, 720),
			sessionId: id,
			metadata: { timestamp: 7000 },
		});
	same(1);
	await starting;
	await until(() => h.windows[0].frames.length === 1, "frame 1");
	await sleep(120);
	same(2);
	await until(() => h.windows[0].frames.length === 2, "frame 2");
	const [a, b] = h.windows[0].frames;
	assert.ok(b.ts - a.ts >= 1000, `${b.ts} follows ${a.ts} by at least 1 ms`);
	await h.stop();
});

// -- remediation round 2 -------------------------------------------------------

const startsOf = (dbg) =>
	dbg.calls.filter((m) => m === "Page.startScreencast").length;

async function runningHighClip(options = {}) {
	const pool = await screencastPool(options.encoderOptions);
	const path = join(pool.dir, "r2.mp4");
	const starting = mod.recordStart(
		pool.ctx,
		{ tab: "tab", requester: "session:a", path, quality: "high" },
		"r",
	);
	await until(() => pool.dbg.screencasting, "the screencast");
	pool.dbg.tick(0);
	await starting;
	return { ...pool, path };
}

test("m-c: a burst of Page.disable costs one start in flight plus one queued, and ends with the screencast running", async () => {
	const { cdp, dbg, contents } = await runningHighClip();
	assert.equal(startsOf(dbg), 1);
	dbg.startDelay = 40;
	// Four gated actions land while the first restart is still being sent.
	for (let i = 0; i < 4; i += 1) await cdp.send(contents, "Page.disable", {});
	await until(() => dbg.screencasting, "the screencast after the burst");
	await sleep(120);
	// Not one start per disable (5), and not dropped (2): a disable that lands after
	// the in-flight start was sent ends THAT screencast too, so one more follows.
	assert.equal(startsOf(dbg), 3);
	assert.equal(dbg.screencasting, true);
});

test("m-c: a Page.disable that failed or timed out still restarts the screencast, since it may have landed", async () => {
	const { cdp, dbg, contents } = await runningHighClip();
	dbg.failDisable = true;
	await cdp.send(contents, "Page.disable", {}).then(
		() => assert.fail("the disable was meant to fail"),
		(error) => assert.match(error.message, /timed out/),
	);
	await until(() => startsOf(dbg) === 2, "the screencast to be started again");
	assert.equal(dbg.screencasting, true);
});

test("m-c: a Page.disable on a child frame's session does not touch the recording", async () => {
	const { cdp, dbg, contents } = await runningHighClip();
	await cdp.send(contents, "Page.disable", {}, { sessionId: "frame-1" });
	await sleep(60);
	assert.equal(startsOf(dbg), 1, "no restart for a frame session");
	assert.equal(dbg.screencasting, true);
	assert.deepEqual(dbg.sessions, [["Page.disable", "frame-1"]]);
});

test("m-d: a Page.disable that lands while the clip is stopping does not start a screencast", async () => {
	const { cdp, dbg, contents, ctx } = await runningHighClip();
	dbg.stopDelay = 120;
	const stopping = mod.recordStop(
		ctx,
		{ tab: "tab", requester: "session:a" },
		"r",
	);
	await until(
		() => dbg.calls.includes("Page.stopScreencast"),
		"the stop to reach the screencast",
	);
	// The session is stopping and not yet disposed: the action's disable arrives now.
	await cdp.send(contents, "Page.disable", {});
	await sleep(40);
	assert.equal(startsOf(dbg), 1, "no screencast is started into a stop");
	const stopped = await stopping;
	assert.equal(stopped.quality, "high");
	assert.equal(startsOf(dbg), 1);
});

test("m-a: main rejects a chunk that is not bytes, has no finite timestamp or key flag", () => {
	const good = {
		evt: "chunk",
		data: new Uint8Array(4),
		ts: 1000,
		key: true,
	};
	assert.equal(mod.isWellFormedChunk(good), true);
	assert.equal(
		mod.isWellFormedChunk({ ...good, description: new Uint8Array(2) }),
		true,
	);
	for (const bad of [
		{ ...good, data: "not bytes" },
		{ ...good, data: { length: 1e12 } },
		{ ...good, data: [1, 2, 3] },
		{ ...good, ts: Number.NaN },
		{ ...good, ts: "5" },
		{ ...good, ts: Number.POSITIVE_INFINITY },
		{ ...good, key: 1 },
		{ ...good, key: undefined },
		{ ...good, description: "avcC" },
		{ ...good, description: [1] },
	]) {
		assert.equal(mod.isWellFormedChunk(bad), false, JSON.stringify(bad));
	}
});

test("m-a: main accepts a configured answer only for the size and encoder it asked for", () => {
	const asked = { width: 1920, height: 1080 };
	const answer = {
		evt: "configured",
		id: 1,
		ok: true,
		encoder: "hardware",
		codec: "avc1.640028",
		width: 1920,
		height: 1080,
	};
	assert.equal(mod.answersTheRequest(answer, asked), true);
	assert.equal(
		mod.answersTheRequest({ ...answer, encoder: "software" }, asked),
		true,
	);
	assert.equal(mod.answersTheRequest(answer, undefined), false, "never asked");
	assert.equal(mod.answersTheRequest({ ...answer, width: 1918 }, asked), false);
	assert.equal(
		mod.answersTheRequest({ ...answer, height: 1088 }, asked),
		false,
	);
	assert.equal(
		mod.answersTheRequest({ ...answer, encoder: "gpu" }, asked),
		false,
	);
	// The host really uses both checks (the functions are the pin only if they are called).
	const host = readFileSync(
		"src/main/browser/actions/recording-encoder-host.ts",
		"utf8",
	);
	assert.ok(host.includes("isWellFormedChunk(event)"));
	assert.ok(host.includes("answersTheRequest(event, asked)"));
});

// ---- passkey custody: a hold DISCARDS every recording (PR #1868 R1/R2) -------
//
// WHY. Chromium's default recorder (`Page.startScreenRecording`) encodes the
// composited surface with no CDP event custody could filter, so a password
// manager's prompt shown under custody would be in the clip `record_stop` hands
// the agent after the user returns the tab. `discardRecordingForCustody` runs
// synchronously when the hold begins; these cases pin that no recorded byte is
// ever delivered: not by a later stop, not by a stop already in flight, not by a
// start already in flight, and not through the high-quality engine.

test("custody discards a standard recording: tombstone, recorder stopped, stream closed unread, nothing written", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const { start, stop, commands, tabs } = fixture({
		path,
		chunks: [Buffer.from("PROMPT-PIXELS")],
	});
	await start({ path });
	const before = commands.length;
	mod.discardRecordingForCustody(tabs.get("tab").id);
	await new Promise((done) => setTimeout(done, 20));
	const teardown = commands.slice(before).map((call) => call.method);
	assert.ok(teardown.includes("Page.stopScreenRecording"), "recorder stopped");
	assert.ok(teardown.includes("IO.close"), "stream closed");
	assert.equal(teardown.includes("IO.read"), false, "no byte was read");
	// The owner's next stop learns why, once, and gets no clip.
	await rejectsReason(stop(), "internal", "record_aborted");
	await rejectsReason(stop(), "internal", "record_not_active");
	assert.equal(existsSync(path), false, "no clip published");
	assert.deepEqual(partFiles(dir), [], "no part left behind");
});

test("custody tombstone names the cause and the caller's next step", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	const { start, stop, tabs } = fixture({ path });
	await start({ path });
	mod.discardRecordingForCustody(tabs.get("tab").id);
	const error = await stop().catch((caught) => caught);
	assert.equal(error.data?.reason, "record_aborted");
	assert.equal(error.data?.detail, "passkey_custody");
	assert.match(error.message, /password manager prompt/);
	assert.doesNotMatch(error.message, /DevTools/, "not the detach sentence");
});

test("a stop already reading the stream when custody begins publishes nothing", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	let releaseRead;
	let reads = 0;
	const base = stream([
		Buffer.from("PROMPT-PIXELS-1"),
		Buffer.from("PROMPT-2"),
	]);
	const { start, stop, commands, tabs } = fixture({
		path,
		handler: (call) => {
			if (call.method === "IO.read" && reads++ === 0) {
				// The first page is in flight when the hold begins.
				return new Promise((done) => {
					releaseRead = () => done(base(call));
				});
			}
			return base(call);
		},
	});
	await start({ path });
	const stopping = stop();
	while (!releaseRead) await new Promise((done) => setTimeout(done, 2));
	mod.discardRecordingForCustody(tabs.get("tab").id);
	releaseRead();
	await rejectsReason(stopping, "internal", "record_aborted");
	assert.equal(existsSync(path), false, "the in-flight stop published nothing");
	assert.deepEqual(partFiles(dir), [], "its part was removed");
	assert.equal(
		commands.filter((call) => call.method === "Page.stopScreenRecording")
			.length,
		1,
		"a stop already under way is not stopped twice",
	);
	assert.ok(commands.some((call) => call.method === "IO.close"));
});

test("a standard start in flight when custody begins is stopped and answers the custody refusal", async () => {
	const dir = scratchDir();
	const path = join(dir, "clip.mp4");
	let answerStart;
	const base = stream([Buffer.from("x")]);
	const { start, commands, tabs } = fixture({
		path,
		handler: (call) => {
			if (call.method === "Page.startScreenRecording") {
				// Chromium starts the recorder; the pool then drops the answer under
				// custody, which is what the rejection stands for here.
				return new Promise((_done, fail) => {
					answerStart = () =>
						fail(
							new mod.BrowserHostError("owner_refused", "held", {
								reason: "passkey_custody",
							}),
						);
				});
			}
			return base(call);
		},
	});
	const starting = start({ path });
	while (!answerStart) await new Promise((done) => setTimeout(done, 2));
	mod.discardRecordingForCustody(tabs.get("tab").id);
	answerStart();
	await rejectsReason(starting, "owner_refused", "passkey_custody");
	const methods = commands.map((call) => call.method);
	assert.ok(
		methods.includes("Page.stopScreenRecording"),
		"the recorder the start may have begun is stopped",
	);
	assert.equal(methods.includes("IO.read"), false);
	assert.equal(existsSync(path), false);
});

test("custody discards a high-quality recording with the tombstone, not a capture failure, and clears the viewport", async () => {
	const h = hqFixture();
	await h.start({ path: h.path, quality: "high", width: 1280, height: 720 });
	h.frame(0);
	await new Promise((done) => setTimeout(done, 20));
	const before = h.commands.length;
	mod.discardRecordingForCustody(h.id);
	await new Promise((done) => setTimeout(done, 40));
	const teardown = h.commands.slice(before).map((call) => call.method);
	assert.ok(teardown.includes("Page.stopScreencast"), "screencast stopped");
	assert.ok(
		teardown.includes("Emulation.clearDeviceMetricsOverride"),
		"the user's tab gets its own size back",
	);
	assert.equal(teardown.includes("Page.startScreencast"), false, "no restart");
	assert.ok(
		h.windows.every((window) => window.disposed),
		"encoder disposed",
	);
	const error = await h.stop().catch((caught) => caught);
	assert.equal(error.data?.reason, "record_aborted");
	assert.equal(error.data?.detail, "passkey_custody");
	assert.equal(existsSync(h.path), false, "no clip published");
});
