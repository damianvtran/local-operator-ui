import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * THE APP-OWNED VOICE PAGE, pure parts (Groq plan D2/D3/D7 U1): the WAV
 * encoder, the segment scheduler, the VAD wrapper over a fake detector, the
 * page CSP, and the guards. Nothing here opens a window, a microphone or a
 * socket.
 */
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/voice-page/wav";',
			'export * from "./src/voice-page/scheduler";',
			'export * from "./src/voice-page/vad";',
			'export * from "./src/voice-page/csp";',
			'export * from "./src/voice-page/vad-assets";',
			'export * from "./src/voice-page/channels";',
			'export * from "./src/voice-page/reply-inbox";',
			'export { appVoicePagePermissionVerdict } from "./src/main/window-guards";',
			'export { appVoicePageUrl, isAppVoicePageUrl, appVoicePageVerdict } from "./src/main/voice/qwen-voice-page";',
		].join("\n"),
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	write: false,
});
const bundlePath = new URL(`./_voice-page-${process.pid}.mjs`, import.meta.url);
writeFileSync(bundlePath, bundle.outputFiles[0].text);
after(() => rmSync(bundlePath, { force: true }));
const m = await import(bundlePath.href);

/* ------------------------------ WAV encoder ------------------------------ */

test("WAV: 44-byte header, 16 kHz mono 16-bit PCM, sizes consistent", () => {
	const wav = m.encodeWav(new Float32Array([0, 0.5, -0.5, 1]));
	const v = new DataView(wav.buffer);
	const tag = (o) => String.fromCharCode(...wav.slice(o, o + 4));
	assert.equal(wav.length, 44 + 8);
	assert.equal(tag(0), "RIFF");
	assert.equal(v.getUint32(4, true), wav.length - 8);
	assert.equal(tag(8), "WAVE");
	assert.equal(tag(12), "fmt ");
	assert.equal(v.getUint32(16, true), 16);
	assert.equal(v.getUint16(20, true), 1, "PCM");
	assert.equal(v.getUint16(22, true), 1, "mono");
	assert.equal(v.getUint32(24, true), 16000);
	assert.equal(v.getUint32(28, true), 32000, "byte rate");
	assert.equal(v.getUint16(32, true), 2, "block align");
	assert.equal(v.getUint16(34, true), 16);
	assert.equal(tag(36), "data");
	assert.equal(v.getUint32(40, true), 8);
});

test("WAV: samples are little-endian and clip instead of wrapping", () => {
	const v = new DataView(
		m.encodeWav(new Float32Array([0.5, -1, 3, -3])).buffer,
	);
	assert.equal(v.getInt16(44, true), 16384);
	assert.equal(v.getInt16(46, true), -32767);
	assert.equal(v.getInt16(48, true), 32767, "+3 clips high");
	assert.equal(v.getInt16(50, true), -32767, "-3 clips low");
});

test("WAV: an empty take is a valid header-only file", () => {
	const wav = m.encodeWav(new Float32Array(0));
	assert.equal(wav.length, 44);
	assert.equal(new DataView(wav.buffer).getUint32(40, true), 0);
});

/* --------------------------- Segment scheduler --------------------------- */

function schedulerRig({ durations, segments = durations.length } = {}) {
	let clock = 10;
	const started = [];
	const stopped = [];
	const fetchCalls = [];
	const waits = [];
	const events = [];
	const fetchGates = [];
	const audio = {
		get currentTime() {
			return clock;
		},
		async decode(bytes) {
			return { duration: durations[bytes[0]], buffer: bytes[0] };
		},
		start(buffer, when) {
			started.push({ buffer, when });
			events.push(`start${buffer}`);
			return { stop: () => stopped.push(buffer) };
		},
		waitUntil(time, signal) {
			return new Promise((resolve, reject) => {
				const w = { time, resolve, reject };
				waits.push(w);
				signal.addEventListener("abort", () => reject(new Error("aborted")));
			});
		},
	};
	const sched = new m.SegmentScheduler({
		audio,
		fetchSegment: (index, signal) => {
			fetchCalls.push(index);
			events.push(`fetch${index}`);
			if (index >= segments) return Promise.resolve(null);
			return new Promise((resolve) => {
				fetchGates.push({
					index,
					signal,
					resolve: () => resolve(new Uint8Array([index])),
				});
				signal.addEventListener("abort", () => resolve(null));
			});
		},
		onDrained: () => events.push("drained"),
		onError: (e) => events.push(`error:${e.message}`),
	});
	const tick = () => new Promise((r) => setImmediate(r));
	return {
		sched,
		started,
		stopped,
		fetchCalls,
		waits,
		events,
		fetchGates,
		tick,
		setClock: (t) => {
			clock = t;
		},
	};
}

test("SCHEDULER: start times are contiguous - each begins at the previous end", async () => {
	const r = schedulerRig({ durations: [2, 3, 1.5] });
	const done = r.sched.play();
	for (let i = 0; i < 3; i += 1) {
		await r.tick();
		r.fetchGates[i].resolve();
		await r.tick();
		r.waits.at(-1).resolve(); // that segment has begun
	}
	await r.tick();
	r.waits.at(-1).resolve(); // the last one has finished
	await done;
	assert.deepEqual(
		r.started.map((s) => s.when),
		[10, 12, 15],
		"10, then +2, then +3 - no gap and no overlap",
	);
	assert.equal(r.events.at(-1), "drained");
});

test("SCHEDULER: one request ahead - segment n+1 is not fetched until n has begun", async () => {
	const r = schedulerRig({ durations: [2, 2, 2] });
	void r.sched.play();
	await r.tick();
	assert.deepEqual(r.fetchCalls, [0]);
	r.fetchGates[0].resolve();
	await r.tick();
	assert.deepEqual(r.fetchCalls, [0], "0 is scheduled but has not begun");
	r.waits.at(-1).resolve();
	await r.tick();
	assert.deepEqual(r.fetchCalls, [0, 1], "now, and only now, one ahead");
	assert.equal(r.fetchCalls.includes(2), false, "never two ahead");
	r.sched.stop();
});

test("SCHEDULER: a queue that ran dry restarts at now, not in the past", async () => {
	const r = schedulerRig({ durations: [1, 1] });
	void r.sched.play();
	await r.tick();
	r.fetchGates[0].resolve();
	await r.tick();
	r.waits.at(-1).resolve();
	await r.tick();
	r.setClock(50); // segment 1 arrives long after segment 0 ended (t=11)
	r.fetchGates[1].resolve();
	await r.tick();
	assert.deepEqual(
		r.started.map((s) => s.when),
		[10, 50],
	);
	r.sched.stop();
});

test("SCHEDULER: stop clears everything - sources, in-flight fetch, schedule - and nothing more is fetched", async () => {
	const r = schedulerRig({ durations: [2, 2, 2] });
	const done = r.sched.play();
	await r.tick();
	r.fetchGates[0].resolve();
	await r.tick();
	r.waits.at(-1).resolve();
	await r.tick(); // segment 1's fetch is now in flight
	assert.equal(r.sched.playing, true);
	r.sched.stop();
	await done;
	assert.equal(r.fetchGates[1].signal.aborted, true, "in-flight fetch aborted");
	assert.deepEqual(r.stopped, [0], "the playing source was stopped");
	assert.equal(r.sched.playing, false);
	assert.deepEqual(r.sched.startTimes, [], "schedule dropped");
	assert.deepEqual(r.fetchCalls, [0, 1], "no request after the stop");
	assert.equal(r.events.includes("drained"), false);
	r.sched.stop(); // idempotent
});

test("SCHEDULER: a fetch error stops, clears and reports once", async () => {
	const events = [];
	const sched = new m.SegmentScheduler({
		audio: {
			currentTime: 0,
			decode: async () => ({ duration: 1, buffer: 0 }),
			start: () => ({ stop() {} }),
			waitUntil: async () => {},
		},
		fetchSegment: async () => {
			throw new Error("429");
		},
		onError: (e) => events.push(e.message),
	});
	await sched.play();
	assert.deepEqual(events, ["429"]);
	assert.equal(sched.playing, false);
});

/* ------------------------------- VAD wrapper ------------------------------ */

function vadRig({ playing = false } = {}) {
	const out = { vad: [], takes: [], stops: 0, destroyed: 0, started: 0 };
	let cb = null;
	const state = { playing };
	const ctl = new m.VadController({
		createVad: async (callbacks) => {
			cb = callbacks;
			return {
				start: async () => {
					out.started += 1;
				},
				pause() {},
				destroy: async () => {
					out.destroyed += 1;
				},
			};
		},
		sendTake: (wav) => out.takes.push(wav),
		sendVad: (k) => out.vad.push(k),
		isPlaying: () => state.playing,
		stopPlayback: () => {
			out.stops += 1;
		},
	});
	return { ctl, out, state, fire: () => cb };
}

test("VAD: speech end sends one WAV take of the samples, after the vad event", async () => {
	const r = vadRig();
	await r.ctl.start();
	assert.equal(r.out.started, 1);
	r.fire().onSpeechEnd(new Float32Array([0.1, 0.2]));
	assert.deepEqual(r.out.vad, ["ready", "speech_end"]);
	assert.equal(r.out.takes.length, 1);
	assert.equal(r.out.takes[0].length, 44 + 4);
	assert.equal(r.out.stops, 0);
});

test("VAD: speech start while playing is barge-in - playback stops, then the event goes up", async () => {
	const r = vadRig({ playing: true });
	await r.ctl.start();
	r.fire().onSpeechStart();
	assert.equal(r.out.stops, 1);
	assert.deepEqual(r.out.vad, ["ready", "speech_start"]);
});

test("VAD: speech start while idle sends the event and stops nothing", async () => {
	const r = vadRig({ playing: false });
	await r.ctl.start();
	r.fire().onSpeechStart();
	assert.equal(r.out.stops, 0);
	assert.deepEqual(r.out.vad, ["ready", "speech_start"]);
});

test("VAD: after close the detector is destroyed and a late event sends nothing", async () => {
	const r = vadRig({ playing: true });
	await r.ctl.start();
	const callbacks = r.fire();
	await r.ctl.close();
	assert.equal(r.out.destroyed, 1);
	callbacks.onSpeechStart();
	callbacks.onSpeechEnd(new Float32Array(10));
	assert.deepEqual(r.out.vad, ["ready"], "only what went up before close");
	assert.deepEqual(r.out.takes, []);
	assert.equal(r.out.stops, 0);
	await r.ctl.start();
	assert.equal(r.out.started, 1, "a closed controller does not restart");
});

test("VAD: closing while the detector is still being built destroys it and never starts it", async () => {
	let release;
	const out = { destroyed: 0, started: 0 };
	const ctl = new m.VadController({
		createVad: () =>
			new Promise((resolve) => {
				release = () =>
					resolve({
						start: async () => {
							out.started += 1;
						},
						pause() {},
						destroy: async () => {
							out.destroyed += 1;
						},
					});
			}),
		sendTake() {},
		sendVad() {},
		isPlaying: () => false,
		stopPlayback() {},
	});
	const starting = ctl.start();
	await ctl.close();
	release();
	await starting;
	assert.deepEqual(out, { destroyed: 1, started: 0 });
});

/*
 * LISTENING IS PROVEN, NOT ASSUMED (review round 1, finding 1): the page tells
 * main `ready` only once the detector has started, and `failed` when it never
 * does or loses the microphone afterwards. Main shows "Listening" on `ready`.
 */
test("VAD: `ready` goes up only after the detector has actually started", async () => {
	const out = [];
	let finishStart;
	const ctl = new m.VadController({
		createVad: async () => ({
			start: () =>
				new Promise((resolve) => {
					finishStart = resolve;
				}),
			pause() {},
			destroy: async () => {},
		}),
		sendTake() {},
		sendVad: (k) => out.push(k),
		isPlaying: () => false,
		stopPlayback() {},
	});
	const starting = ctl.start();
	await new Promise((r) => setImmediate(r));
	assert.deepEqual(out, [], "constructed but not started: nothing claimed");
	finishStart();
	await starting;
	assert.deepEqual(out, ["ready"]);
});

test("VAD: a start that rejects (model, WASM or microphone) reports `failed`, never `ready`, and still rejects", async () => {
	const out = [];
	const ctl = new m.VadController({
		createVad: async () => ({
			start: async () => {
				throw new Error("NotAllowedError");
			},
			pause() {},
			destroy: async () => {},
		}),
		sendTake() {},
		sendVad: (k) => out.push(k),
		isPlaying: () => false,
		stopPlayback() {},
	});
	await assert.rejects(ctl.start(), /NotAllowedError/);
	assert.deepEqual(out, ["failed"]);
	const building = new m.VadController({
		createVad: async () => {
			throw new Error("model did not load");
		},
		sendTake() {},
		sendVad: (k) => out.push(k),
		isPlaying: () => false,
		stopPlayback() {},
	});
	await assert.rejects(building.start(), /model did not load/);
	assert.deepEqual(out, ["failed", "failed"]);
});

test("VAD: losing the microphone after it started reports `failed` once; after close nothing is sent", async () => {
	const r = vadRig();
	await r.ctl.start();
	assert.deepEqual(r.out.vad, ["ready"]);
	r.fire().onMicrophoneLost();
	r.fire().onMicrophoneLost();
	assert.deepEqual(
		r.out.vad,
		["ready", "failed"],
		"once, however often it ends",
	);
	const q = vadRig();
	await q.ctl.start();
	await q.ctl.close();
	q.fire().onMicrophoneLost();
	assert.deepEqual(q.out.vad, ["ready"]);
});

/*
 * A FALSE TRIGGER MUST NOT CUT A REPLY (finding 2): vad-web's `onSpeechStart`
 * fires on the first positive frame and a misfire follows when the segment
 * proves too short; the factory hands the controller `onSpeechRealStart`
 * instead, and a misfire after an announced start clears main's "Hearing you".
 */
test("VAD: a misfire that never became real speech sends nothing and does not touch playback", async () => {
	const r = vadRig({ playing: true });
	await r.ctl.start();
	r.fire().onMisfire();
	assert.deepEqual(r.out.vad, ["ready"]);
	assert.equal(r.out.stops, 0);
});

test("VAD: a misfire after an announced speech_start cancels it, once", async () => {
	const r = vadRig();
	await r.ctl.start();
	r.fire().onSpeechStart();
	r.fire().onMisfire();
	r.fire().onMisfire();
	assert.deepEqual(r.out.vad, ["ready", "speech_start", "speech_cancel"]);
	r.fire().onSpeechStart();
	r.fire().onSpeechEnd(new Float32Array(4));
	r.fire().onMisfire();
	assert.deepEqual(r.out.vad.slice(3), ["speech_start", "speech_end"]);
});

test("VAD factory: barge-in and speech_start come from vad-web's onSpeechRealStart, and a misfire is passed through", () => {
	const factory = readFileSync("src/voice-page/vad-factory.ts", "utf8");
	assert.match(
		factory,
		/onSpeechRealStart:\s*\(\)\s*=>\s*callbacks\.onSpeechStart\(\)/,
	);
	assert.equal(
		/\bonSpeechStart:/.test(factory),
		false,
		"the first-frame event is unused",
	);
	assert.match(
		factory,
		/onVADMisfire:\s*\(\)\s*=>\s*callbacks\.onMisfire\?\.\(\)/,
	);
	assert.match(factory, /callbacks\.onMicrophoneLost\(\)/);
});

/* --------------------------- CSP, URL and verdict -------------------------- */

test("CSP: the page's policy is the plan's, and the html carries exactly it", () => {
	assert.match(m.VOICE_PAGE_CSP, /script-src 'self' 'wasm-unsafe-eval'/);
	assert.match(m.VOICE_PAGE_CSP, /connect-src 'self'/);
	assert.match(m.VOICE_PAGE_CSP, /default-src 'none'/);
	assert.equal(m.VOICE_PAGE_CSP.includes("unsafe-inline"), false);
	assert.equal(m.VOICE_PAGE_CSP.includes("http"), false, "no remote origin");
	const html = readFileSync("src/renderer/voice-page.html", "utf8");
	const meta = html.match(/Content-Security-Policy"\s+content="([^"]+)"/);
	assert.equal(meta?.[1], m.VOICE_PAGE_CSP);
});

test("CHANNELS: six distinct, namespaced channels", () => {
	const values = Object.values(m.VOICE_PAGE_CHANNELS);
	assert.equal(values.length, 6);
	assert.equal(new Set(values).size, 6);
	for (const v of values) assert.match(v, /^voice-page:/);
});

test("URL: built (file:) and dev (http) renderer URLs both yield the sibling page", () => {
	assert.equal(
		m.appVoicePageUrl("file:///Applications/X/out/renderer/index.html"),
		"file:///Applications/X/out/renderer/voice-page.html",
	);
	assert.equal(
		m.appVoicePageUrl("file:///a/index.html?x=1#y"),
		"file:///a/voice-page.html",
	);
	assert.equal(
		m.appVoicePageUrl("http://localhost:5173/"),
		"http://localhost:5173/voice-page.html",
	);
	assert.equal(
		m.appVoicePageUrl("http://localhost:5173"),
		"http://localhost:5173/voice-page.html",
	);
});

const PAGE_FILE = "file:///app/out/renderer/voice-page.html";
const PAGE_DEV = "http://localhost:5173/voice-page.html";
const q = (over) => ({
	permission: "media",
	mediaTypes: ["audio"],
	isMainFrame: true,
	requestingUrl: PAGE_FILE,
	...over,
});

test("VERDICT: audio, main frame, the page's own URL is granted (file and dev)", () => {
	assert.equal(m.appVoicePagePermissionVerdict(q(), PAGE_FILE), true);
	assert.equal(m.appVoicePageVerdict(q(), PAGE_FILE), true);
	assert.equal(
		m.appVoicePagePermissionVerdict(
			q({ requestingUrl: PAGE_DEV, mediaTypes: undefined, mediaType: "audio" }),
			PAGE_DEV,
		),
		true,
	);
});

test("VERDICT: video, mixed media, unknown and untyped checks are refused", () => {
	for (const over of [
		{ mediaTypes: ["video"] },
		{ mediaTypes: ["audio", "video"] },
		{ mediaTypes: [] },
		{ mediaTypes: undefined, mediaType: "video" },
		{ mediaTypes: undefined, mediaType: "unknown" },
		{ mediaTypes: undefined, mediaType: undefined },
	])
		assert.equal(m.appVoicePagePermissionVerdict(q(over), PAGE_FILE), false);
});

test("VERDICT: a subframe is refused even at the page's URL", () => {
	assert.equal(
		m.appVoicePagePermissionVerdict(q({ isMainFrame: false }), PAGE_FILE),
		false,
	);
});

test("VERDICT: other documents and origins are refused; so are other permissions", () => {
	for (const requestingUrl of [
		"file:///app/out/renderer/index.html",
		"file:///app/out/renderer/mini.html",
		"http://localhost:5173/index.html",
		"https://evil.example/voice-page.html",
		"about:blank",
		"not a url",
	])
		assert.equal(
			m.appVoicePagePermissionVerdict(q({ requestingUrl }), PAGE_FILE),
			false,
			requestingUrl,
		);
	assert.equal(
		m.appVoicePagePermissionVerdict(
			q({ requestingUrl: "http://evil.example:5173/voice-page.html" }),
			PAGE_DEV,
		),
		false,
		"same path, other origin",
	);
	assert.equal(
		m.appVoicePagePermissionVerdict(
			q({ permission: "geolocation" }),
			PAGE_FILE,
		),
		false,
	);
	assert.equal(m.appVoicePagePermissionVerdict(q(), "garbage"), false);
});

test("NAVIGATION: only the page's own URL passes the lock", () => {
	assert.equal(m.isAppVoicePageUrl(PAGE_FILE, PAGE_FILE), true);
	assert.equal(m.isAppVoicePageUrl("https://x.example/", PAGE_FILE), false);
	assert.equal(m.isAppVoicePageUrl("file:///etc/passwd", PAGE_FILE), false);
	assert.equal(m.isAppVoicePageUrl("nope", PAGE_FILE), false);
});

test("BUILD: the page and its preload are declared where the build and the dev server read them", () => {
	const config = readFileSync("electron.vite.config.js", "utf8");
	assert.equal(
		config.split("src/renderer/voice-page.html").length - 1,
		2,
		"renderer dev input AND rollupOptions.input",
	);
	assert.equal(config.includes("src/preload/voice-page.ts"), true);
});

/*
 * PROGRESS (page -> main): without it main cannot keep one segment ahead, show
 * Speaking, or know a reply ended - the page owns the audio clock.
 */
test("PROGRESS: the page names the reply it is playing, and a stop or a drain retires it", () => {
	const inbox = new m.ReplyInbox();
	assert.equal(inbox.current, null);
	inbox.push({ id: { replyId: "r1", index: 0 }, bytes: new Uint8Array(1) });
	assert.equal(inbox.current, "r1");
	inbox.stop();
	assert.equal(inbox.current, null);
	inbox.push({ id: { replyId: "r2", index: 0 }, bytes: new Uint8Array(1) });
	inbox.drained();
	assert.equal(inbox.current, null);
});

test("PROGRESS: preload, bridge and page entry all carry it, by the channel constant", () => {
	const preload = readFileSync("src/preload/voice-page.ts", "utf8");
	assert.ok(preload.includes("sendProgress"));
	assert.ok(preload.includes("C.progress"));
	const bridge = readFileSync("src/voice-page/bridge.ts", "utf8");
	assert.ok(bridge.includes("sendProgress"));
	const entry = readFileSync("src/voice-page/main.ts", "utf8");
	assert.ok(entry.includes('"segment_start"'));
	assert.ok(entry.includes('"drained"'));
	assert.equal(m.VOICE_PAGE_CHANNELS.progress, "voice-page:progress");
});

/* ------------------------- REPLY INBOX (page glue) ------------------------ */

// The page's wiring, reduced to what main.ts does: onPlay -> push -> play,
// onStop -> inbox.stop + scheduler.stop. Segment bytes are [index] so the
// "decoded" first byte says which segment played.
function pageRig() {
	const inbox = new m.ReplyInbox();
	const played = [];
	const tick = () => new Promise((r) => setImmediate(r));
	const sched = new m.SegmentScheduler({
		audio: {
			currentTime: 0,
			async decode(bytes) {
				return { duration: 1, buffer: bytes[1] };
			},
			start(buffer) {
				played.push(buffer);
				return { stop() {} };
			},
			waitUntil(_t, signal) {
				return new Promise((resolve, reject) => {
					setImmediate(resolve);
					signal.addEventListener("abort", () => reject(new Error("x")));
				});
			},
		},
		fetchSegment: (i, s) => inbox.pull(i, s),
		onDrained: () => inbox.drained(),
	});
	const seg = (replyId, index, tag, last) => ({
		id: { replyId, index },
		bytes: new Uint8Array([index, tag]),
		last,
	});
	return {
		played,
		sched,
		inbox,
		tick,
		onPlay(msg) {
			const r = inbox.push(msg);
			if (!r.accepted) return r;
			if (r.fresh || !sched.playing) void sched.play();
			return r;
		},
		onStop() {
			inbox.stop();
			sched.stop();
		},
		seg,
	};
}

test("INBOX (M1): play, stop, play - the second reply plays segment 0 first", async () => {
	const r = pageRig();
	// Reply A starts: the scheduler is parked waiting on segment 0's pull.
	void r.sched.play();
	await r.tick();
	r.onStop(); // aborts the pending pull
	await r.tick();
	r.onPlay(r.seg("B", 0, 20, false));
	r.onPlay(r.seg("B", 1, 21, true));
	for (let i = 0; i < 10; i += 1) await r.tick();
	assert.deepEqual(r.played, [20, 21], "B's segment 0 was not eaten");
});

test("INBOX (M1): barge-in mid-reply, then a new reply - segment 0 plays first", async () => {
	const r = pageRig();
	r.onPlay(r.seg("A", 0, 10, false));
	for (let i = 0; i < 5; i += 1) await r.tick();
	assert.deepEqual(r.played, [10]);
	// The scheduler is now parked pulling A's segment 1; barge-in (stopPlayback).
	r.onStop();
	await r.tick();
	r.onPlay(r.seg("B", 0, 30, false));
	r.onPlay(r.seg("B", 1, 31, true));
	for (let i = 0; i < 10; i += 1) await r.tick();
	assert.deepEqual(r.played, [10, 30, 31], "B starts at its own segment 0");
});

test("INBOX (m1): a stale segment from the old reply after a stop is never played", async () => {
	const r = pageRig();
	r.onPlay(r.seg("A", 0, 10, false));
	for (let i = 0; i < 5; i += 1) await r.tick();
	r.onStop();
	const late = r.onPlay(r.seg("A", 1, 11, true));
	assert.equal(late.accepted, false);
	for (let i = 0; i < 5; i += 1) await r.tick();
	assert.deepEqual(r.played, [10], "A's late segment 1 stayed silent");
	assert.equal(r.sched.playing, false, "and did not restart playback");
});

test("INBOX (m1): a new replyId resets the inbox - the old reply's leftovers are gone", async () => {
	const r = pageRig();
	r.inbox.push(r.seg("A", 3, 13, false)); // out-of-order leftover
	r.onPlay(r.seg("B", 0, 40, true));
	for (let i = 0; i < 10; i += 1) await r.tick();
	assert.deepEqual(r.played, [40]);
});

/*
 * A SEGMENT THAT WILL NOT DECODE (finding 6): the scheduler stops silently, so
 * the page must say the reply failed, or main waits on `reply.waiting` for ever.
 */
test("PLAYBACK FAILURE: a segment that will not decode tells main the reply failed and retires it", async () => {
	const inbox = new m.ReplyInbox();
	const sent = [];
	const sched = new m.SegmentScheduler({
		audio: {
			currentTime: 0,
			async decode() {
				throw new Error("EncodingError");
			},
			start: () => ({ stop() {} }),
			waitUntil: async () => {},
		},
		fetchSegment: (i, s) => inbox.pull(i, s),
		onError: () => m.reportPlaybackFailure(inbox, (msg) => sent.push(msg)),
	});
	inbox.push({ id: { replyId: "r1", index: 0 }, bytes: new Uint8Array([1]) });
	await sched.play();
	assert.deepEqual(sent, [{ kind: "failed", replyId: "r1" }]);
	assert.equal(inbox.current, null, "the reply is retired");
	assert.equal(sched.playing, false);
	const late = inbox.push({
		id: { replyId: "r1", index: 1 },
		bytes: new Uint8Array(1),
	});
	assert.equal(late.accepted, false, "its late segments are refused");
});

test("PLAYBACK FAILURE: with no reply current there is nothing to report", () => {
	const inbox = new m.ReplyInbox();
	const sent = [];
	m.reportPlaybackFailure(inbox, (msg) => sent.push(msg));
	assert.deepEqual(sent, []);
});

test("PLAYBACK FAILURE: the page entry routes the scheduler's onError through it", () => {
	const entry = readFileSync("src/voice-page/main.ts", "utf8");
	assert.match(entry, /onError:[\s\S]{0,200}reportPlaybackFailure\(/);
});

test("INBOX (nit): the retired ids are bounded, and a recent one is still refused", () => {
	const inbox = new m.ReplyInbox();
	const total = m.MAX_RETIRED_REPLIES + 50;
	for (let i = 0; i < total; i += 1) {
		inbox.push({
			id: { replyId: `r${i}`, index: 0 },
			bytes: new Uint8Array(1),
		});
		inbox.stop();
	}
	assert.equal(inbox.retiredCount, m.MAX_RETIRED_REPLIES);
	const recent = inbox.push({
		id: { replyId: `r${total - 1}`, index: 1 },
		bytes: new Uint8Array(1),
	});
	assert.equal(
		recent.accepted,
		false,
		"the latest retired reply stays refused",
	);
});

/*
 * The detector's assets must be emitted by the build and found where the page
 * looks. Reads the shared asset list, the source files it names, and the build
 * config/plugin wiring, so a later change cannot silently drop one. When
 * `out/renderer` exists (after `pnpm build`) it also checks the emitted files.
 */ test("vad assets: list, sources, wiring and CSP agree", async () => {
	const { existsSync, statSync } = await import("node:fs");
	const { createRequire } = await import("node:module");
	const { join } = await import("node:path");
	const req = createRequire(`${process.cwd()}/package.json`);
	const files = m.VAD_ASSETS.map((a) => a.file);
	assert.equal(files.filter((f) => f.endsWith(".onnx")).length, 1, "model");
	assert.equal(files.filter((f) => f.endsWith(".wasm")).length, 1, "ONE wasm");
	assert.ok(files.includes(m.VAD_WORKLET_FILE), "worklet");
	assert.ok(files.includes(m.ORT_MODULE_FILE), "ort loader module");
	// Every source file exists in the installed packages.
	for (const { from } of m.VAD_ASSETS) {
		const parts = from.split("/");
		const pkg = parts.slice(0, from.startsWith("@") ? 2 : 1).join("/");
		const rest = parts.slice(pkg.split("/").length).join("/");
		const root = join(process.cwd(), "node_modules", pkg);
		assert.ok(statSync(join(root, rest)).size > 1000, `${from} exists`);
	}
	assert.match(
		readFileSync("electron.vite.config.js", "utf8"),
		/voicePageVadPlugin\(\)/,
	);
	assert.ok(m.VOICE_PAGE_CSP.includes("'wasm-unsafe-eval'"));
	assert.ok(!m.VOICE_PAGE_CSP.includes("'unsafe-eval'"));
	// After `pnpm build`, the files must sit where the page resolves them.
	const out = join("out/renderer", m.VAD_ASSET_DIR);
	if (existsSync("out/renderer/voice-page.html")) {
		for (const f of files) assert.ok(existsSync(join(out, f)), `built ${f}`);
	}
});
