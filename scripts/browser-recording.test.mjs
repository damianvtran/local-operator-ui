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
import { after, test } from "node:test";
import { build } from "esbuild";

// Fake CDP exercises the shipped action and pool lifecycle, not native Chromium.
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/browser/actions/recording";',
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
	} = {},
) {
	let index = 0;
	return ({ method, params }) => {
		onCommand?.(method, params);
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

after(() => {
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
	const handler =
		options.handler ??
		stream(options.chunks ?? [Buffer.from("ftyp-av1-payload")]);
	const ctx = {
		registry: {
			requireSurface: (token) => {
				const contents = tabs.get(String(token));
				if (!contents) throw new Error(`no tab ${token}`);
				return { view: { webContents: contents } };
			},
		},
		cdp: {
			attach: async () => {},
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
	};
}

// ---- 1. start -------------------------------------------------------------

test("record_start sends exactly the fixed capture params and writes nothing", async () => {
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
	// D14: the capture shape is fixed and not agent-tunable.
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
	if (answer) {
		const original = FakeDebugger.prototype.sendCommand;
		fakeDebugger.sendCommand = async (method) =>
			answer({ method }) ?? original.call(fakeDebugger, method);
	}
	const debuggerLike = fakeDebugger;
	const contents = contentsFor(9001 + nextViewId++, { debugger: debuggerLike });
	const ctx = {
		cdp,
		registry: { requireSurface: () => ({ view: { webContents: contents } }) },
	};
	return { cdp, contents, debuggerLike, ctx };
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
	assert.equal(mod.COMMAND_TIMEOUTS_S.record_start, 20);
	assert.equal(mod.COMMAND_TIMEOUTS_S.record_stop, 60);
});
