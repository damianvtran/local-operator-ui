import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";

const SAYS_EXITED = /exited/;
const GATEWAY_DIED_LOADING = /Gateway stopped while the models loaded/;
const NAMES_3101 = /3101/;
const RIG_NOT_FOUND =
	/^Error: Voice rig not found at \/nonexistent-rig \(missing /;
const RAW_ENOENT = /ENOENT/;
const PORT_8765_IN_USE = /^Error: Port 8765 is in use;/;
const FORM_URLENCODED = /application\/x-www-form-urlencoded/;

/*
 * QWEN VOICE IN MAIN (the backend's docs/design/qwen-voice.md, Q4/Q5/Q9),
 * driven through the SHIPPED modules with their Electron and process seams
 * injected: the coordinator's rules (start on an enable, idle stop, the speak
 * guard), the Gateway's allowlisted environment, the s2s process-group stop, and
 * the text-only utterance relay against a real local HTTP server.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/voice/qwen-voice";',
			'export { gatewayEnv, QwenGatewayHost } from "./src/main/voice/qwen-gateway";',
			'export { QwenSpeechProcess, resolveQwenPorts, s2sArgs, s2sEnv, s2sLauncherPathFor, qwenMemoryBudget, qwenMachineTooSmall, QWEN_MEM_BUDGET_BYTES, QWEN_MIN_MACHINE_BYTES, QWEN_MACHINE_TOO_SMALL, FOOTPRINT_INTERVAL_MS, DEFAULT_QWEN_PORTS, isOurS2s, S2S_RECORD_FILE } from "./src/main/voice/qwen-rig";',
			'export { QwenVoicePage, noQwenVoicePage, voicePageUrl, voicePageAllowed, QWEN_NO_VOICE_WINDOW, QWEN_VOICE_PARTITION, PAGE_CRASH_WINDOW_MS } from "./src/main/voice/qwen-voice-page";',
			'export { requestDesktopMedia } from "./src/main/desktop-media";',
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
// Written beside this script, not as a data: URL: the bundle keeps its packages
// external (zod), and only a file URL can resolve them from node_modules.
const bundlePath = new URL(
	`./_qwen-voice-main-${process.pid}.mjs`,
	import.meta.url,
);
writeFileSync(bundlePath, bundle.outputFiles[0].text);
after(() => rmSync(bundlePath, { force: true }));
const m = await import(bundlePath.href);
// The launcher's own module, imported where it lives: its phrase table is read
// relative to its file, which a bundle copied into scripts/ would break.
const relayCore = await import("../resources/qwen-voice/relay-core.mjs");

/* ------------------------------------------------------------------------ */
/* The coordinator                                                           */
/* ------------------------------------------------------------------------ */

function rig({
	gatewayFails = false,
	mic = "granted",
	machineBytes = 36 * 1024 ** 3,
	page: pageOverride = null,
} = {}) {
	const sent = [];
	/** Every step that costs something, in the order it happened. */
	const order = [];
	const settled = [];
	const toRenderer = [];
	const opened = [];
	const closed = [];
	const timers = [];
	const calls = {
		gatewayStart: 0,
		gatewayStop: 0,
		speechStart: 0,
		speechStop: 0,
		kill: 0,
	};
	let now = 1_000_000;
	const gateway = {
		running: false,
		async start() {
			calls.gatewayStart += 1;
			if (gatewayFails) throw new Error("port 3101 is busy");
			this.running = true;
			return "http://127.0.0.1:3101/";
		},
		stop() {
			calls.gatewayStop += 1;
			this.running = false;
		},
		send(message) {
			sent.push(message);
			return this.running;
		},
	};
	const speech = {
		running: false,
		async start() {
			calls.speechStart += 1;
			order.push("speech");
			this.running = true;
		},
		async stop() {
			calls.speechStop += 1;
			this.running = false;
		},
		killNow(clearRecord) {
			calls.kill += 1;
			calls.killClearRecord = clearRecord === true;
			this.running = false;
		},
	};
	const muted = [];
	const page = pageOverride ?? {
		/** The OS verdict this fake reports; a test may flip it mid-run. */
		mic,
		open(url) {
			opened.push(url);
		},
		close() {
			closed.push(true);
		},
		setMuted(value) {
			muted.push(value);
		},
		async prepareMicrophone(options = {}) {
			order.push("mic");
			page.preflight = options;
			return page.mic;
		},
	};
	const voice = new m.QwenVoice({
		gateway,
		speech,
		toRenderer: (channel, payload) => {
			toRenderer.push({ channel, payload });
			return true;
		},
		page,
		machineBytes: () => machineBytes,
		now: () => now,
		setTimer: (fn, ms) => {
			const timer = { fn, ms, cleared: false };
			timers.push(timer);
			return timer;
		},
		clearTimer: (timer) => {
			timer.cleared = true;
		},
	});
	return {
		voice,
		page,
		order,
		settled,
		sent,
		toRenderer,
		opened,
		closed,
		muted,
		timers,
		calls,
		gateway,
		speech,
		advance: (ms) => {
			now += ms;
		},
		/** A WebUI page connecting, as the launcher reports it. */
		attachClient: (clients = 1) =>
			voice.onGatewayMessage({
				type: "status",
				event: "client_attached",
				clients,
			}),
	};
}

/** Every `voice.qwen.event` payload the coordinator pushed. */
const voiceEvents = (r) =>
	r.toRenderer
		.filter((x) => x.channel === "voice.qwen.event")
		.map((x) => x.payload);

const AT = "2026-10-18T05:36:39.412Z";

test("§10: an allowlisted event crosses as {type, at, reason?}; anything else is dropped", () => {
	const r = rig();
	const send = (event) => r.voice.onGatewayMessage({ type: "event", event });
	send({ type: "realtime.playback.started", at: AT });
	assert.deepEqual(voiceEvents(r), [
		{ type: "realtime.playback.started", at: AT },
	]);
	send({ type: "realtime.playback.cancelled", at: AT, reason: "barge_in" });
	assert.deepEqual(voiceEvents(r).at(-1), {
		type: "realtime.playback.cancelled",
		at: AT,
		reason: "barge_in",
	});
	// Third-party code cannot send an arbitrary event, a free-text reason, or a
	// message body across.
	const before = voiceEvents(r).length;
	send({ type: "task.persistence_warning", at: AT });
	send({ type: "realtime.playback.ended" });
	send({ type: "realtime.playback.ended", at: AT, message: "private words" });
	send({ type: "realtime.playback.ended", at: AT, reason: "a whole sentence" });
	// Both trailing records carry a valid type and time, so both cross - with
	// the free text stripped, which is the property that matters.
	assert.equal(voiceEvents(r).length, before + 2);
	assert.equal("message" in voiceEvents(r).at(-1), false);
	assert.equal("reason" in voiceEvents(r).at(-1), false);

	// M1: the Gateway's playback receipt crosses, so the renderer can tell an
	// accepted end from one this connection was not playing.
	send({ type: "realtime.playback.ended", at: AT, accepted: false });
	assert.equal(voiceEvents(r).at(-1).accepted, false);
	send({ type: "realtime.playback.ended", at: AT, accepted: "yes" });
	assert.equal("accepted" in voiceEvents(r).at(-1), false, "booleans only");

	// N3: only an ISO-8601 time crosses; the renderer parses it as a time.
	const beforeBad = voiceEvents(r).length;
	for (const bad of ["", "yesterday", "05:36:39", "2026-10-18 05:36:39", 17])
		send({ type: "realtime.response.done", at: bad });
	assert.equal(voiceEvents(r).length, beforeBad, "no time, no event");
	assert.equal(voiceEvents(r).at(-1).type, "realtime.playback.ended");
});

test("§10: the launcher keeps the file AND posts allowlisted events through one sink", () => {
	const launcher = readFileSync(
		"resources/qwen-voice/gateway-launcher.mjs",
		"utf8",
	);
	// The file sink is the one the Gateway wrote before this change; the tee
	// adds the post, so nothing moved out of the log.
	assert.match(launcher, /new JsonLineFileSink\(/);
	assert.match(launcher, /fileSink\?\.write\(record\);/);
	assert.match(launcher, /if \(event\) post\(\{ type: "event", event \}\);/);
	// And the Gateway is composed WITH that logger: a connection's
	// `logger.child(...)` shares the same sink.
	assert.match(launcher, /createGatewayApplication\(\{\s*logger,/);
});

test("§10: main's event allowlist IS the launcher's, not a copy that can drift", () => {
	assert.deepEqual(
		[...m.VOICE_EVENT_TYPES].sort(),
		[...relayCore.VOICE_EVENTS].sort(),
	);
});

const voiceFrame = (sessionId) => ({
	type: "voice",
	payload: {
		active: sessionId ? { session_id: sessionId, enabled_at: 1 } : null,
	},
});
const textAnswer = (sessionId, kind, text, status = 200) => [
	{
		op: "voice.text",
		sessionId,
		source:
			kind === "gate"
				? { kind: "gate", requestId: "g1" }
				: { kind: "message", messageId: "m1" },
	},
	{ status, body: { result: { text, spoken_chars: text.length } } },
];
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("an enable frame starts the rig once and opens the WebUI", async () => {
	const r = rig();
	r.voice.observeFrame(voiceFrame("aaaaaaaaaaaa"));
	r.voice.observeFrame(voiceFrame("aaaaaaaaaaaa"));
	await settle();
	await settle();
	assert.equal(r.calls.gatewayStart, 1, "idempotent: one start for two frames");
	assert.equal(r.calls.speechStart, 1);
	assert.deepEqual(r.opened, ["http://127.0.0.1:3101/"]);
	assert.equal(r.voice.getStatus().rig, "ready");
	const statuses = r.toRenderer
		.filter((x) => x.channel === "voice.qwen.status")
		.map((x) => x.payload.rig);
	assert.deepEqual(statuses, ["starting", "ready"]);
});

test("a slot learned from a status read does NOT start the rig (relaunch); voice.qwen.start does", async () => {
	const r = rig();
	r.voice.noteDesktopAnswer(
		{ op: "voice.status" },
		{
			status: 200,
			body: {
				result: { active: { session_id: "aaaaaaaaaaaa", enabled_at: 1 } },
			},
		},
	);
	await settle();
	assert.equal(r.calls.gatewayStart, 0, "no models loaded at launch");
	assert.equal(r.voice.getStatus().rig, "stopped");
	const status = await r.voice.start("renderer");
	assert.equal(status.rig, "ready");
	assert.equal(r.calls.speechStart, 1);
});

test("the slot going empty stops the rig after 10 minutes, not before; a re-enable cancels it", async () => {
	const r = rig();
	r.voice.observeFrame(voiceFrame("aaaaaaaaaaaa"));
	await settle();
	await settle();
	r.voice.observeFrame(voiceFrame(null));
	const idle = r.timers.at(-1);
	assert.equal(idle.ms, 10 * 60_000);
	assert.equal(r.calls.speechStop, 0);
	r.voice.observeFrame(voiceFrame("bbbbbbbbbbbb"));
	assert.equal(idle.cleared, true, "a re-enable keeps the rig");
	r.voice.observeFrame(voiceFrame(null));
	await r.timers.at(-1).fn();
	await settle();
	assert.equal(r.calls.speechStop, 1);
	assert.equal(r.calls.gatewayStop >= 1, true);
	assert.equal(r.voice.getStatus().rig, "stopped");
	// Stop is idempotent.
	await r.voice.stop();
	assert.equal(r.voice.getStatus().rig, "stopped");
});

test("IDLE STOP: a status poll every 60 s never re-arms the timer; the rig stops at 10 min (QA round 1, Q3)", async () => {
	const r = rig();
	r.voice.observeFrame(voiceFrame("aaaaaaaaaaaa"));
	await settle();
	await settle();
	const poll = (active) =>
		r.voice.noteDesktopAnswer(
			{ op: "voice.status" },
			{ status: 200, body: { result: { active } } },
		);
	r.voice.observeFrame(voiceFrame(null)); // voice off at t=0
	const armed = r.timers.filter((x) => !x.cleared);
	assert.equal(armed.length, 1, "one timer armed by the transition");
	for (let minute = 1; minute <= 9; minute += 1) {
		r.advance(60_000);
		poll(null);
	}
	assert.equal(
		r.timers.filter((x) => !x.cleared).length,
		1,
		"nine polls later, still the same single timer",
	);
	assert.equal(armed[0].cleared, false, "never cleared by a poll");
	assert.equal(armed[0].ms, 10 * 60_000);
	r.advance(60_000);
	await armed[0].fn(); // the fake clock reaches 10 minutes
	await settle();
	assert.equal(r.voice.getStatus().rig, "stopped");
	assert.equal(r.calls.speechStop, 1);
});

test("IDLE STOP: voice.qwen.start with an empty slot arms it; an already-armed timer is not re-armed", async () => {
	const r = rig();
	await r.voice.start("renderer");
	const armed = r.timers.filter((x) => !x.cleared);
	assert.equal(
		armed.length,
		1,
		"a rig started with nothing on is still idle-stopped",
	);
	r.voice.noteDesktopAnswer(
		{ op: "voice.status" },
		{ status: 200, body: { result: { active: null } } },
	);
	assert.equal(r.timers.filter((x) => !x.cleared).length, 1);
	assert.equal(armed[0].cleared, false);
});

test("STATUS: Listening needs a connected page; attach/detach move clients; speak with none is spoken:false", async () => {
	const r = rig();
	r.voice.observeFrame(voiceFrame("aaaaaaaaaaaa"));
	await settle();
	await settle();
	assert.equal(r.voice.getStatus().clients, 0, "ready, nothing connected");
	r.voice.noteDesktopAnswer(
		...textAnswer("aaaaaaaaaaaa", "reply", "The answer is four."),
	);
	assert.deepEqual(
		r.voice.speak({ text: "The answer is four.", kind: "reply" }),
		{ spoken: false, reason: "no_client" },
		"no page connected: nothing is heard, so nothing is claimed",
	);
	r.attachClient(1);
	assert.equal(r.voice.getStatus().clients, 1);
	assert.equal(
		r.toRenderer.filter((x) => x.channel === "voice.qwen.status").at(-1).payload
			.clients,
		1,
		"pushed to the renderer",
	);
	assert.deepEqual(
		r.voice.speak({ text: "The answer is four.", kind: "reply" }),
		{ spoken: true },
	);
	r.voice.onGatewayMessage({
		type: "status",
		event: "client_detached",
		clients: 0,
	});
	assert.equal(r.voice.getStatus().clients, 0);
});

test("STATUS: a page that connected while the rig was starting counts once it is ready", async () => {
	const r = rig();
	const started = r.voice.start("renderer");
	r.attachClient(1); // the old tab reconnects during the start
	await started;
	assert.equal(r.voice.getStatus().clients, 1);
});

test("STATUS: start() checks speech as well as the gateway; a dead s2s under a 'ready' rig restarts", async () => {
	const r = rig();
	await r.voice.start("renderer");
	assert.equal(r.calls.speechStart, 1);
	r.speech.running = false; // s2s died without the exit being reported
	await r.voice.start("renderer");
	assert.equal(
		r.calls.speechStart,
		2,
		"not answered 'ready' from stale status",
	);
});

test("STATUS: an unexpected process exit under a ready rig is error 'unexpected_exit'; Try again restarts", async () => {
	for (const which of ["speech", "gateway"]) {
		const r = rig();
		await r.voice.start("renderer");
		r.voice.processExited(which, "code 1, signal null");
		const status = r.voice.getStatus();
		assert.equal(status.rig, "error", which);
		assert.equal(status.cause, "unexpected_exit");
		assert.match(status.reason, SAYS_EXITED);
		assert.equal(status.webui_url, null);
		// An exit during a start, or after a stop, is not reported again.
		await r.voice.stop();
		r.voice.processExited(which, "late");
		assert.equal(r.voice.getStatus().rig, "stopped");
		// "Try again" is voice.qwen.start.
		const again = await r.voice.start("renderer");
		assert.equal(again.rig, "ready");
	}
});

test("minor 1: a Gateway that died while s2s loaded fails the start; it is never reported ready", async () => {
	const r = rig();
	r.speech.start = async function () {
		r.calls.speechStart += 1;
		this.running = true;
		r.gateway.running = false; // the launcher exits during the long load
	};
	const status = await r.voice.start("renderer");
	assert.equal(status.rig, "error");
	assert.match(status.reason, GATEWAY_DIED_LOADING);
	assert.equal(r.calls.speechStop, 1, "nothing left running");
	assert.equal(
		r.toRenderer.some(
			(x) => x.channel === "voice.qwen.status" && x.payload.rig === "ready",
		),
		false,
	);
});

test("RECREATE THE PAGE: voice.qwen.start on a ready rig asks for the page again; an enable does not", async () => {
	const r = rig();
	await r.voice.start("renderer");
	assert.equal(r.opened.length, 1);
	await r.voice.start("renderer");
	assert.equal(r.opened.length, 2, "the renderer's call recreates it");
	assert.equal(r.closed.length, 1, "a page that exists is closed first");
	await r.voice.start("enable");
	assert.equal(r.closed.length, 1, "an enable does not tear the page down");
	assert.equal(
		r.opened.length,
		3,
		"it re-reads the microphone and asks the page open (idempotent in the real page)",
	);
	assert.equal(r.calls.speechStart, 1, "nothing restarted");
});

test("stopNow (will-quit) stops both processes synchronously", () => {
	const r = rig();
	r.voice.stopNow();
	r.voice.stopNow();
	assert.equal(r.calls.kill, 2);
	assert.equal(r.calls.gatewayStop, 2);
	assert.equal(r.closed.length, 2, "the page goes with the rig");
});

test("Q-3: the SIGNAL stop clears the s2s record, because nothing runs behind it", () => {
	const r = rig();
	r.voice.stopNow(true);
	assert.equal(r.calls.killClearRecord, true, "the record is cleared");
	const ordinary = rig();
	ordinary.voice.stopNow();
	assert.equal(
		ordinary.calls.killClearRecord,
		false,
		"a quit keeps the record for the next start to re-check",
	);
});

test("Q-3: SIGTERM-with-no-quit and SIGINT both stop the rig before handing the signal on", () => {
	const source = readFileSync("src/main/index.ts", "utf8");
	assert.match(
		source,
		/const stopVoiceOnTerminatingSignal = \(signal: NodeJS\.Signals\): void => \{/,
		"one stop, shared by both signals",
	);
	const term = source.slice(
		source.indexOf("const onSigtermDuringQuit"),
		source.indexOf('process.on("SIGINT"'),
	);
	assert.match(
		term,
		/stopVoiceOnTerminatingSignal\("SIGTERM"\)/,
		"the no-quit TERM path stops the rig before Chromium's shutdown",
	);
	assert.match(source, /process\.on\("SIGINT", onSigint\)/);
	/*
	 * The region that matters is the handler's body AND the helper it delegates
	 * into. Slicing to `process.on("SIGINT"` only ever saw the handler, while
	 * the exit the assertion hunts lives one call away (review round 2, minor
	 * 2). The stop is synchronous, so neither region may reach for an exit, and
	 * the dead bound must not come back.
	 */
	const sigint = source.slice(
		source.indexOf("const onSigint"),
		source.indexOf('process.on("SIGINT", onSigint)'),
	);
	const helper = source.slice(
		source.indexOf("const stopVoiceOnTerminatingSignal"),
		source.indexOf("const supplementMounts"),
	);
	assert.match(sigint, /stopVoiceOnTerminatingSignal\("SIGINT"\)/);
	assert.doesNotMatch(
		`${sigint}\n${helper}`,
		/app\.exit\(|process\.exit\(/,
		"the signal path is a synchronous stop, not an exit",
	);
	assert.doesNotMatch(helper, /setTimeout/);
	assert.match(
		source,
		/signalStoppedVoice/,
		"idempotent: a second signal does nothing",
	);
});

test("R2 minor 1: a run with no page refuses before it spawns anything", async () => {
	const r = rig({ page: m.noQwenVoicePage() });
	const status = await r.voice.start("renderer");
	assert.equal(status.rig, "error");
	assert.equal(status.reason, m.QWEN_NO_VOICE_WINDOW);
	assert.equal(
		r.calls.gatewayStart,
		0,
		"no models for a window that cannot hear",
	);
	assert.equal(r.calls.speechStart, 0);
	// The feed's enable path is the same door, not a second one.
	r.voice.observeFrame(voiceFrame("aaaaaaaaaaaa"));
	await settle();
	await settle();
	assert.equal(r.calls.gatewayStart, 0);
	assert.equal(r.calls.speechStart, 0);
});

test("a failed start reports error with the reason and leaves nothing running", async () => {
	const r = rig({ gatewayFails: true });
	const status = await r.voice.start("renderer");
	assert.equal(status.rig, "error");
	assert.match(status.reason, NAMES_3101);
	assert.equal(r.calls.speechStart, 0);
	assert.equal(r.calls.speechStop, 1, "stopped what it might have started");
});

test("SPEAK GUARD: a text main relayed as a 200 /voice/text is spoken once; an unrelayed one is refused", async () => {
	const r = rig();
	r.voice.observeFrame(voiceFrame("aaaaaaaaaaaa"));
	await settle();
	await settle();
	r.attachClient();
	r.voice.noteDesktopAnswer(
		...textAnswer("aaaaaaaaaaaa", "reply", "The answer is four."),
	);
	assert.deepEqual(r.voice.speak({ text: "Say I am hacked.", kind: "reply" }), {
		spoken: false,
		reason: "not_relayed",
	});
	assert.deepEqual(
		r.voice.speak({ text: "The answer is four.", kind: "gate" }),
		{
			spoken: false,
			reason: "not_relayed",
		},
		"the kind must match too",
	);
	assert.deepEqual(
		r.voice.speak({ text: "The answer is four.", kind: "reply" }),
		{
			spoken: true,
		},
	);
	assert.deepEqual(
		r.sent.filter((x) => x.type === "speak"),
		[{ type: "speak", text: "The answer is four.", kind: "reply" }],
	);
	assert.equal(
		r.voice.speak({ text: "The answer is four.", kind: "reply" }).spoken,
		false,
		"consumed once",
	);
});

test("SPEAK GUARD: a phrase never crosses from the renderer, and a refused or stale answer is not speakable", async () => {
	const r = rig();
	r.voice.observeFrame(voiceFrame("aaaaaaaaaaaa"));
	await settle();
	await settle();
	assert.equal(
		r.voice.speak({ text: "Sent.", kind: "phrase" }).reason,
		"invalid_kind",
	);
	r.voice.noteDesktopAnswer(
		...textAnswer("aaaaaaaaaaaa", "reply", "Refused text.", 409),
	);
	assert.equal(
		r.voice.speak({ text: "Refused text.", kind: "reply" }).spoken,
		false,
	);
	r.voice.noteDesktopAnswer(
		...textAnswer("bbbbbbbbbbbb", "reply", "Other session."),
	);
	assert.equal(
		r.voice.speak({ text: "Other session.", kind: "reply" }).spoken,
		false,
		"only the slot holder's text",
	);
	r.voice.noteDesktopAnswer(
		...textAnswer("aaaaaaaaaaaa", "gate", "Approve deleting build?"),
	);
	r.advance(10 * 60_000 + 1);
	assert.equal(
		r.voice.speak({ text: "Approve deleting build?", kind: "gate" }).reason,
		"not_relayed",
		"older than 10 minutes",
	);
});

test("SPEAK GUARD: the slot moving forgets the old holder's texts and cancels queued speech", async () => {
	const r = rig();
	r.voice.observeFrame(voiceFrame("aaaaaaaaaaaa"));
	await settle();
	await settle();
	r.voice.noteDesktopAnswer(...textAnswer("aaaaaaaaaaaa", "reply", "For A."));
	r.voice.observeFrame(voiceFrame("bbbbbbbbbbbb"));
	assert.equal(r.voice.speak({ text: "For A.", kind: "reply" }).spoken, false);
	assert.ok(r.sent.some((x) => x.type === "cancel_all"));
	assert.deepEqual(r.sent.filter((x) => x.type === "slot").at(-1), {
		type: "slot",
		active: { session_id: "bbbbbbbbbbbb" },
	});
});

test("§4: pause closes the page, keeps the models warm, and admits no takes", async () => {
	const r = rig();
	r.voice.observeFrame(voiceFrame("aaaaaaaaaaaa"));
	await settle();
	await settle();
	assert.equal(r.opened.length, 1, "one page, as Listening needs");
	assert.equal(r.timers.length, 0, "a held slot never arms the idle stop");

	const paused = r.voice.pause();
	assert.equal(paused.paused, true);
	assert.equal(paused.rig, "ready", "the models stay loaded");
	assert.equal(paused.clients, 0, "a closed page is no client");
	assert.equal(
		r.closed.length,
		1,
		"the page - and the microphone - are released",
	);
	assert.equal(r.calls.speechStop, 0, "nothing is unloaded");
	assert.equal(r.calls.gatewayStop, 0);
	/*
	 * NO TIMER IS TOUCHED. Pausing must not re-arm (or disarm) the idle stop: a
	 * paused person who pays a fresh model load on resume has been punished for
	 * using the control.
	 */
	assert.equal(r.timers.length, 0);

	/* A take cannot be admitted while the page that would hear it is closed. */
	r.voice.onGatewayMessage({
		type: "take",
		taskId: "t1",
		text: "are you there",
	});
	assert.deepEqual(r.sent.at(-1), {
		type: "outcome",
		taskId: "t1",
		ok: false,
		code: "paused",
	});

	/* And no audio event can be true over a closed page. */
	const before = voiceEvents(r).length;
	r.voice.onGatewayMessage({
		type: "event",
		event: { type: "realtime.playback.started", at: AT },
	});
	assert.equal(voiceEvents(r).length, before);
});

test("§4: resume recreates the page through Retry's path and carries the mute", async () => {
	const r = rig();
	r.voice.observeFrame(voiceFrame("aaaaaaaaaaaa"));
	await settle();
	await settle();
	r.voice.pause();
	r.voice.setMuted(true);
	assert.deepEqual(r.muted, [true], "main forwards the mute to the page");

	const resumed = r.voice.resume();
	assert.equal(resumed.paused, false);
	assert.equal(r.closed.length, 2, "closed, then opened: the Retry order");
	assert.equal(r.opened.length, 2);
	assert.equal(r.voice.getStatus().muted, true, "the status carries it");
	/* Re-applied on the recreate, because the page adapter drops a mute it was
	   never given a view for. */
	assert.equal(r.muted.at(-1), true);
});

test("§4: turning voice off clears a pause, so the next enable opens a page", async () => {
	const r = rig();
	r.voice.observeFrame(voiceFrame("aaaaaaaaaaaa"));
	await settle();
	await settle();
	r.voice.pause();
	assert.equal(r.voice.getStatus().paused, true);
	/* The slot goes away while paused. */
	r.voice.observeFrame({ type: "voice", payload: { active: null } });
	assert.equal(
		r.voice.getStatus().paused,
		false,
		"a pause does not outlive its slot",
	);
	assert.equal(
		r.voice.getStatus().muted,
		false,
		"mute is the person's, not the slot's",
	);
	/* Turning it back on recreates the page. */
	r.voice.observeFrame(voiceFrame("bbbbbbbbbbbb"));
	await settle();
	await settle();
	assert.equal(r.opened.length, 2, "the new enable opened a page");
});

test("§4: the page applies a remembered mute on create and on every toggle", () => {
	const c = pageCase();
	assert.equal(c.views.length, 0);
	/* Muted before the first page exists. */
	c.page.setMuted(true);
	c.page.open(GATEWAY);
	assert.equal(c.views.length, 1);
	assert.equal(c.views[0].webContents.muted, true, "applied on create");
	c.page.setMuted(false);
	assert.equal(c.views[0].webContents.muted, false, "applied on toggle");
	/* A recreate (pause/resume, Retry, crash) comes back as quiet as it left. */
	c.page.setMuted(true);
	c.page.close();
	c.page.open(GATEWAY);
	assert.equal(c.views.length, 2);
	assert.equal(c.views[1].webContents.muted, true, "applied again on recreate");
});

/* ------------------------------------------------------------------------ */
/* The hidden voice page (plan §1-§3)                                        */
/* ------------------------------------------------------------------------ */

const GATEWAY = "http://127.0.0.1:3101";

/** A fake partition session: what it was asked to install, and the answers. */
function fakeSession() {
	const installed = {};
	const listens = {};
	return {
		installed,
		listens,
		setPermissionRequestHandler: (handler) => {
			installed.request = handler;
		},
		setPermissionCheckHandler: (handler) => {
			installed.check = handler;
		},
		on: (event, listener) => {
			if (!listens[event]) listens[event] = [];
			listens[event].push(listener);
		},
	};
}

/** A fake view: what it loads, closes, listens for, and opens in DevTools. */
function fakeView() {
	const loaded = [];
	const listeners = {};
	const webContents = {
		closed: 0,
		devTools: null,
		loadURL(url) {
			loaded.push(url);
			return Promise.resolve();
		},
		close() {
			this.closed += 1;
		},
		on(event, listener) {
			if (!listeners[event]) listeners[event] = [];
			listeners[event].push(listener);
		},
		openDevTools(options) {
			this.devTools = options;
		},
		setWindowOpenHandler(handler) {
			this.windowOpen = handler;
		},
		/** The last value main set; `undefined` until it sets one. */
		muted: undefined,
		setAudioMuted(value) {
			this.muted = value;
		},
	};
	return { view: { webContents }, webContents, loaded, listeners };
}

/** A page with the given fakes; `created` holds every view factory call. */
function pageCase({
	mic = "granted",
	ask = async () => true,
	devTools = false,
	origin = GATEWAY,
	timers = null,
} = {}) {
	const session = fakeSession();
	const created = [];
	const stopped = [];
	const views = [];
	let now = 1_000_000;
	const page = new m.QwenVoicePage({
		session,
		createView: (options) => {
			created.push(options);
			const fake = fakeView();
			views.push(fake);
			return fake.view;
		},
		mediaAccess: { status: () => mic, ask },
		gatewayOrigin: origin,
		devTools,
		onStopped: (reason) => stopped.push(reason),
		now: () => now,
		...(timers
			? {
					setTimer: (fn, ms) => {
						const timer = { fn, ms, cleared: false };
						timers.push(timer);
						return timer;
					},
					clearTimer: (timer) => {
						timer.cleared = true;
					},
				}
			: {}),
	});
	return {
		page,
		session,
		created,
		stopped,
		views,
		advance: (ms) => {
			now += ms;
		},
	};
}

test("§1: the page URL is the WebUI in desktop-orb mode, with no idle sleep", () => {
	assert.equal(
		m.voicePageUrl("http://127.0.0.1:3101/"),
		"http://127.0.0.1:3101/?desktop=orb&autoHideSeconds=0",
	);
	assert.equal(
		m.voicePageUrl("http://127.0.0.1:3101/?next=x#y"),
		"http://127.0.0.1:3101/?desktop=orb&autoHideSeconds=0",
		"any other query is replaced, not appended",
	);
});

test("§1: the view is sandboxed, preload-free, unthrottled, in its own in-memory partition", () => {
	const c = pageCase();
	c.page.open("http://127.0.0.1:3101/");
	assert.equal(c.created.length, 1);
	const prefs = c.created[0].webPreferences;
	assert.equal(prefs.partition, m.QWEN_VOICE_PARTITION);
	assert.equal(prefs.partition.includes("persist:"), false, "memory only");
	assert.equal(prefs.sandbox, true);
	assert.equal(prefs.contextIsolation, true);
	assert.equal(prefs.nodeIntegration, false);
	assert.equal(
		prefs.backgroundThrottling,
		false,
		"a hidden page must not throttle",
	);
	assert.equal(prefs.autoplayPolicy, "no-user-gesture-required");
	assert.equal(
		"preload" in prefs,
		false,
		"the package's preload is not wanted",
	);
	assert.deepEqual(c.views[0].loaded, [
		m.voicePageUrl("http://127.0.0.1:3101/"),
	]);
});

test("§1: one page at a time; close drops it; a new open creates a new view", () => {
	const c = pageCase();
	c.page.open("http://127.0.0.1:3101/");
	c.page.open("http://127.0.0.1:3101/");
	assert.equal(c.created.length, 1, "open is idempotent");
	assert.equal(c.page.isOpen, true);
	c.page.close();
	assert.equal(
		c.views[0].webContents.closed,
		1,
		"webContents.close(), not a leaked renderer",
	);
	assert.equal(c.page.isOpen, false);
	c.page.close();
	assert.equal(c.views[0].webContents.closed, 1, "close is idempotent");
	c.page.open("http://127.0.0.1:3101/");
	assert.equal(c.created.length, 2);
});

test("§3: a page at any other origin is refused before a view exists", () => {
	const c = pageCase();
	c.page.open("http://127.0.0.1:3102/");
	assert.equal(c.created.length, 0);
	assert.equal(c.page.isOpen, false);
});

test("§2: the partition grants audio to the page and refuses everything else", () => {
	const c = pageCase();
	assert.equal(typeof c.session.installed.request, "function");
	assert.equal(typeof c.session.installed.check, "function");
	const page = "http://127.0.0.1:3101/?desktop=orb&autoHideSeconds=0";
	assert.equal(
		c.session.installed.check(null, "media", "http://127.0.0.1:3101", {
			mediaType: "audio",
			isMainFrame: true,
			requestingUrl: page,
		}),
		true,
	);
	assert.equal(
		c.session.installed.check(null, "media", "http://127.0.0.1:3101", {
			mediaType: "audio",
			isMainFrame: true,
			requestingUrl: "https://evil.test/",
		}),
		false,
	);
	let granted = null;
	c.session.installed.request(
		null,
		"media",
		(value) => {
			granted = value;
		},
		{ mediaTypes: ["audio"], isMainFrame: true, requestingUrl: page },
	);
	assert.equal(granted, true);
	c.session.installed.request(
		null,
		"clipboard-read",
		(value) => {
			granted = value;
		},
		{ isMainFrame: true, requestingUrl: page },
	);
	assert.equal(granted, false);
});

test("§3/M2: navigation, popups and downloads are all locked, and the lock reads event.url", () => {
	const c = pageCase();
	c.page.open("http://127.0.0.1:3101/");
	const { listeners } = c.views[0];
	const prevented = () => {
		let hit = false;
		return {
			preventDefault: () => {
				hit = true;
			},
			get hit() {
				return hit;
			},
		};
	};
	for (const event of [
		"will-navigate",
		"will-redirect",
		"will-frame-navigate",
	]) {
		const away = prevented();
		for (const listener of listeners[event])
			listener({ ...away, url: "https://evil.test/" });
		assert.equal(away.hit, true, `${event} away is prevented`);
	}
	const same = prevented();
	listeners["will-navigate"][0]({
		...same,
		url: "http://127.0.0.1:3101/?desktop=orb",
	});
	assert.equal(same.hit, false, "the page's own origin is allowed");
	// FAIL CLOSED: an event that does not say where it is going is prevented,
	// and so is one whose url cannot be parsed.
	for (const event of [
		"will-navigate",
		"will-redirect",
		"will-frame-navigate",
	]) {
		const silent = prevented();
		listeners[event][0](silent);
		assert.equal(silent.hit, true, `${event} with no url is prevented`);
		const malformed = prevented();
		listeners[event][0]({ ...malformed, url: "not a url" });
		assert.equal(malformed.hit, true, `${event} with a bad url is prevented`);
	}
	assert.deepEqual(
		c.views[0].webContents.windowOpen({ url: "https://evil.test/" }),
		{ action: "deny" },
		"window.open is denied",
	);
	// Downloads are a Session event, and every one is cancelled.
	const download = prevented();
	assert.equal(c.session.listens["will-download"].length, 1);
	c.session.listens["will-download"][0](download);
	assert.equal(download.hit, true);
});

test("§3: a crash recreates the page once; a second inside 60 s stops the rig", () => {
	const c = pageCase();
	c.page.open("http://127.0.0.1:3101/");
	const gone = () => c.views.at(-1).listeners["render-process-gone"][0]();
	gone();
	assert.equal(c.created.length, 2, "recreated");
	assert.equal(
		c.views[0].webContents.closed,
		1,
		"N4: the dead contents is closed before the view is dropped",
	);
	assert.equal(c.stopped.length, 0);
	gone();
	assert.equal(c.stopped.length, 1);
	assert.equal(c.stopped[0], "The voice page stopped");
	assert.equal(c.created.length, 2, "a second crash is not retried");
});

test("§3: a crash more than 60 s after the last one is a fresh first crash", () => {
	const c = pageCase();
	c.page.open("http://127.0.0.1:3101/");
	c.views.at(-1).listeners["render-process-gone"][0]();
	c.advance(m.PAGE_CRASH_WINDOW_MS + 1);
	c.views.at(-1).listeners["render-process-gone"][0]();
	assert.equal(c.stopped.length, 0);
	assert.equal(c.created.length, 3);
});

test("§2: the microphone preflight reports granted, denied and not-determined", async () => {
	assert.equal(
		await pageCase({ mic: "granted" }).page.prepareMicrophone(),
		"granted",
	);
	assert.equal(
		await pageCase({ mic: "denied" }).page.prepareMicrophone(),
		"denied",
	);
	assert.equal(
		await pageCase({ mic: "restricted" }).page.prepareMicrophone(),
		"denied",
	);
	let asked = 0;
	const page = pageCase({
		mic: "not-determined",
		ask: async () => {
			asked += 1;
			return false;
		},
	}).page;
	assert.equal(await page.prepareMicrophone(), "denied");
	assert.equal(asked, 1);
	assert.equal(
		await pageCase({
			mic: "not-determined",
			ask: async () => true,
		}).page.prepareMicrophone(),
		"granted",
	);
	assert.equal(
		await pageCase({ mic: "weird" }).page.prepareMicrophone(),
		"unknown",
	);
});

test("M3: the page's bounded wait expires into `prompting`; a late answer still reaches onSettled", async () => {
	const timers = [];
	let answer = null;
	const c = pageCase({
		mic: "not-determined",
		ask: () =>
			new Promise((resolve) => {
				answer = resolve;
			}),
		timers,
	});
	const settled = [];
	const pending = c.page.prepareMicrophone({
		timeoutMs: m.MIC_PROMPT_BUDGET_MS,
		onSettled: (verdict) => settled.push(verdict),
	});
	await Promise.resolve();
	assert.equal(
		timers.length,
		1,
		"a pending prompt is bounded, not waited on for ever",
	);
	assert.equal(timers[0].ms, m.MIC_PROMPT_BUDGET_MS);
	// The budget expires: the start stops here instead of holding "Starting".
	timers[0].fn();
	assert.equal(await pending, "prompting");
	assert.deepEqual(settled, [], "no answer yet");
	// The dialog is answered minutes later: the coordinator still hears it.
	answer(true);
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(settled, ["granted"]);
});

test("§4/M3: the microphone is asked for BEFORE the models, and a denial costs no memory", async () => {
	const r = rig({ mic: "denied" });
	const status = await r.voice.start("renderer");
	assert.deepEqual(r.order, ["mic"], "the check is the only thing that ran");
	assert.equal(r.calls.gatewayStart, 0, "a denial spawns nothing");
	assert.equal(r.calls.speechStart, 0, "and loads no model");
	assert.equal(status.rig, "stopped");
	assert.equal(status.mic, "denied");
	assert.deepEqual(r.opened, [], "a page that cannot hear is not created");
	// The next start, once the OS says yes, asks again and starts for real.
	const ok = rig({ mic: "granted" });
	await ok.voice.start("renderer");
	assert.deepEqual(ok.order, ["mic", "speech"]);
	assert.deepEqual(ok.opened, ["http://127.0.0.1:3101/"]);
	assert.equal(ok.voice.getStatus().rig, "ready");
});

test("M3: an unanswered prompt stops the start, reports `prompting`, and resumes when the OS answers", async () => {
	const r = rig({ mic: "prompting" });
	r.voice.observeFrame(voiceFrame("aaaaaaaaaaaa"));
	await settle();
	await settle();
	const pending = r.voice.getStatus();
	assert.equal(pending.rig, "stopped");
	assert.equal(pending.mic, "prompting");
	assert.deepEqual(r.order, ["mic"], "the check is the only thing that ran");
	assert.equal(r.calls.speechStart, 0, "no model loads behind the prompt");
	assert.equal(r.page.preflight.timeoutMs, m.MIC_PROMPT_BUDGET_MS);
	// The person answers the dialog: the coordinator is told and starts.
	r.page.mic = "granted";
	r.page.preflight.onSettled("granted");
	await settle();
	await settle();
	assert.equal(r.voice.getStatus().rig, "ready");
	assert.equal(r.voice.getStatus().mic, "granted");
	assert.deepEqual(r.opened, ["http://127.0.0.1:3101/"]);
	// A denial from the same path is the blocked state, with nothing running.
	const denied = rig({ mic: "prompting" });
	denied.voice.observeFrame(voiceFrame("aaaaaaaaaaaa"));
	await settle();
	await settle();
	denied.page.preflight.onSettled("denied");
	await settle();
	assert.equal(denied.voice.getStatus().mic, "denied");
	assert.equal(denied.calls.speechStart, 0);
});

test("M3: the production page adapter forwards the microphone options (the 5 s bound was lost here)", () => {
	const source = readFileSync("src/main/index.ts", "utf8");
	/*
	 * The adapter is the ONLY path from `QwenVoice` to `QwenVoicePage`, and the
	 * old zero-argument lambda dropped `{timeoutMs, onSettled}`: the page read
	 * `options.timeoutMs ?? 0` and waited forever, so the 5 s bound never fired
	 * (QA round 2 measured 2m12s on "Starting voice" with no `mic` field). The
	 * page's own test cannot see this seam, and neither could the coordinator's
	 * fake-page test - only the production wiring can, which is why this reads
	 * it.
	 */
	assert.match(
		source,
		/prepareMicrophone:\s*async\s*\(\s*options\s*\)\s*=>/,
		"the adapter takes the options",
	);
	assert.match(
		source,
		/instance\(\)\.prepareMicrophone\(\s*options\s*\)/,
		"and passes them straight through",
	);
	assert.doesNotMatch(
		source,
		/prepareMicrophone:\s*async\s*\(\s*\)\s*=>/,
		"a zero-argument adapter is how the bound disappears",
	);
});

test("§4: granting the microphone in Settings takes effect on the next enable, without a restart", async () => {
	const r = rig({ mic: "denied" });
	await r.voice.start("enable");
	assert.deepEqual(r.opened, [], "denied: no page, no models");
	assert.equal(r.voice.getStatus().mic, "denied");
	// The person allows it in System Settings and turns voice off and on again.
	r.page.mic = "granted";
	await r.voice.start("enable");
	await settle();
	assert.deepEqual(r.opened, ["http://127.0.0.1:3101/"]);
	assert.equal(r.voice.getStatus().mic, "granted");
	// A rig that IS up re-reads the verdict on an enable, too (readyAgain).
	const up = rig();
	await up.voice.start("enable");
	assert.equal(up.voice.getStatus().mic, "granted");
	up.page.mic = "denied";
	await up.voice.start("enable");
	assert.equal(up.voice.getStatus().mic, "denied");
});

test("§3: the page goes with the rig (idle stop, unexpected exit, quit)", async () => {
	const r = rig();
	r.voice.observeFrame(voiceFrame("aaaaaaaaaaaa"));
	await settle();
	await settle();
	assert.equal(r.opened.length, 1);
	r.voice.processExited("speech", "code 1, signal null");
	assert.equal(r.closed.length, 1, "a stalled rig closes its page");
	assert.equal(r.voice.getStatus().rig, "error");
});

test("U3/D7: a move destroys and recreates the page, and the person's mute is re-applied", async () => {
	const r = rig();
	r.voice.observeFrame(voiceFrame("aaaaaaaaaaaa"));
	await settle();
	await settle();
	assert.equal(r.voice.getStatus().rig, "ready");
	r.voice.setMuted(true);
	const closed = r.closed.length;
	const muted = r.muted.length;
	/*
	 * `cancel_all` reaches the Gateway, but audio already queued in the page keeps
	 * playing; destroying the page is the stop this app owns, and it is what keeps
	 * the old conversation's speech out of the new one (UX round 1, U3).
	 */
	r.voice.observeFrame(voiceFrame("bbbbbbbbbbbb"));
	await settle();
	await settle();
	assert.equal(r.closed.length, closed + 1, "the page is destroyed");
	assert.ok(
		r.muted.length > muted && r.muted.at(-1) === true,
		"a muted page comes back muted",
	);
	assert.equal(r.voice.getStatus().rig, "ready");
});

test("§4: a page that cannot be recreated becomes the rig's error, not a silent Listening", async () => {
	const c = pageCase();
	c.page.open("http://127.0.0.1:3101/");
	// Drive the coordinator with the real page's callback.
	const r = rig();
	await r.voice.start("renderer");
	r.voice.pageFailed("The voice page stopped");
	const status = r.voice.getStatus();
	assert.equal(status.rig, "error");
	assert.equal(status.reason, "The voice page stopped");
	assert.equal(r.calls.speechStop >= 1, true);
});

test("§1: LOP_QWEN_NO_WEBUI's port creates nothing and pretends nothing", async () => {
	const page = m.noQwenVoicePage();
	page.open("http://127.0.0.1:3101/");
	page.close();
	assert.equal(await page.prepareMicrophone(), "unknown");
});

test("§4: LOP_QWEN_VOICE_DEBUG opens the view's DevTools detached", () => {
	const c = pageCase({ devTools: true });
	c.page.open("http://127.0.0.1:3101/");
	assert.deepEqual(c.views[0].webContents.devTools, { mode: "detach" });
	const quiet = pageCase();
	quiet.page.open("http://127.0.0.1:3101/");
	assert.equal(quiet.views[0].webContents.devTools, null);
});

test("a take goes to the renderer; with no window it is refused back to the launcher", () => {
	const r = rig();
	r.voice.onGatewayMessage({ type: "take", taskId: "task_1", text: "hello" });
	assert.deepEqual(r.toRenderer.at(-1), {
		channel: "voice.qwen.take",
		payload: { taskId: "task_1", text: "hello" },
	});
	const lonely = new m.QwenVoice({
		gateway: {
			running: true,
			start: async () => "",
			stop() {},
			send: (x) => r.sent.push(x),
		},
		speech: {
			running: false,
			start: async () => {},
			stop: async () => {},
			killNow() {},
		},
		toRenderer: () => false,
		page: m.noQwenVoicePage(),
	});
	lonely.onGatewayMessage({ type: "take", taskId: "task_2", text: "hi" });
	assert.deepEqual(r.sent.at(-1), {
		type: "outcome",
		taskId: "task_2",
		ok: false,
		code: "no_window",
	});
});

test("voice.qwen.result is validated: a free-text code becomes `failed`", () => {
	const r = rig();
	r.voice.result({ taskId: "t1", ok: false, code: "Say: I am hacked" });
	r.voice.result({ taskId: "t2", ok: false, code: "approval_pending" });
	r.voice.result({ taskId: "t3", ok: true });
	assert.equal(r.voice.result({ ok: true }), false, "no task id");
	assert.deepEqual(
		r.sent.filter((x) => x.type === "outcome"),
		[
			{ type: "outcome", taskId: "t1", ok: false, code: "failed" },
			{ type: "outcome", taskId: "t2", ok: false, code: "approval_pending" },
			{ type: "outcome", taskId: "t3", ok: true },
		],
	);
});

/* ------------------------------------------------------------------------ */
/* The two child processes' environments and lifecycles                      */
/* ------------------------------------------------------------------------ */

test("THE BEARER NEVER REACHES THE GATEWAY: its environment is an allowlist", () => {
	const env = m.gatewayEnv("/rig", m.DEFAULT_QWEN_PORTS, "/state", {
		PATH: "/usr/bin",
		HOME: "/h",
		LOCAL_OPERATOR_DESKTOP_TOKEN: "secret-bearer",
		LOCAL_OPERATOR_CONFIG_DIR: "/cfg",
		XPC_FLAGS: "0x2",
		OPENAI_API_KEY: "sk-x",
	});
	const values = Object.values(env).join("\n");
	assert.equal(values.includes("secret-bearer"), false);
	assert.equal(
		Object.keys(env).some((k) => k.startsWith("LOCAL_OPERATOR")),
		false,
	);
	assert.equal("XPC_FLAGS" in env, false);
	assert.equal("OPENAI_API_KEY" in env, false);
	assert.equal(env.PORT, "3101");
	assert.equal(
		env.SPEECH_TO_SPEECH_REALTIME_URL,
		"ws://127.0.0.1:8765/v1/realtime",
	);
	assert.equal(env.QWEN_AUDIO_MEMORY_AUTO, "off");
});

test("s2s: relay model, offline, no inherited secrets; ports overridable only unpackaged", () => {
	const args = m.s2sArgs(m.DEFAULT_QWEN_PORTS);
	assert.deepEqual(
		args.slice(args.indexOf("--model_name"), args.indexOf("--model_name") + 2),
		["--model_name", "lop-relay"],
	);
	assert.ok(args.includes("http://127.0.0.1:8766/v1"));
	assert.ok(
		args.includes("--no_enable_live_transcription"),
		"live transcription burns the final decode's lock and caches a buffer per tick",
	);
	const env = m.s2sEnv("/rig", {
		PATH: "/p",
		LOCAL_OPERATOR_DESKTOP_TOKEN: "x",
		XPC_FLAGS: "0x2",
	});
	assert.equal(env.HF_HUB_OFFLINE, "1");
	assert.equal(env.HF_HOME, "/rig/hf-cache");
	assert.equal("LOCAL_OPERATOR_DESKTOP_TOKEN" in env, false);
	assert.equal("XPC_FLAGS" in env, false);
	assert.deepEqual(m.resolveQwenPorts("3191,8795,8796", false), {
		gateway: 3191,
		s2s: 8795,
		relay: 8796,
	});
	assert.deepEqual(
		m.resolveQwenPorts("3191,8795,8796", true),
		m.DEFAULT_QWEN_PORTS,
	);
	assert.deepEqual(
		m.resolveQwenPorts("3191,80,8796", false),
		m.DEFAULT_QWEN_PORTS,
	);
});

const GIB = 1024 ** 3;
const LAUNCHER_CACHE_LIMIT = /CACHE_LIMIT_BYTES = 1 \* GIB/;
const LAUNCHER_SET_CACHE = /mx\.set_cache_limit\(CACHE_LIMIT_BYTES\)/;
const LAUNCHER_SET_MEMORY =
	/mx\.set_memory_limit\(budget_bytes\(os\.environ\.get\("LOP_QWEN_MEM_LIMIT_BYTES"\)\)\)/;
const LAUNCHER_IMPORTS_RIG =
	/from speech_to_speech\.cli import main as speech_to_speech_main/;
const LAUNCHER_CALLS_RIG = /speech_to_speech_main\(\)/;

test("§9 layer 1: the launcher caps MLX's cache and memory before the rig's own main()", () => {
	const source = readFileSync("resources/qwen-voice/s2s-launch.py", "utf8");
	assert.match(source, LAUNCHER_CACHE_LIMIT);
	assert.match(source, LAUNCHER_SET_CACHE);
	assert.match(source, LAUNCHER_SET_MEMORY);
	assert.match(
		source,
		LAUNCHER_IMPORTS_RIG,
		"the rig's own entry point, not a copy of it",
	);
	assert.match(source, LAUNCHER_CALLS_RIG);
});

test("§9/R1: the budget is a flat 8 GB FLOOR or a quarter of RAM, whichever is larger", () => {
	// The models alone are ~4.8 GB and a healthy idle rig ~5.5 GB: a 16 GB
	// machine's quarter (4 GiB) would stop a rig that is merely working.
	assert.equal(m.qwenMemoryBudget({}, 16 * GIB), 8 * GIB);
	assert.equal(m.qwenMemoryBudget({}, 32 * GIB), 8 * GIB);
	assert.equal(m.qwenMemoryBudget({}, 64 * GIB), 16 * GIB);
	assert.equal(
		m.qwenMemoryBudget({ LOP_QWEN_MEM_BUDGET_GB: "6" }, 64 * GIB),
		6 * GIB,
		"the override still wins, down as well as up",
	);
	for (const bad of ["", "nonsense", "0", "-2"])
		assert.equal(
			m.qwenMemoryBudget({ LOP_QWEN_MEM_BUDGET_GB: bad }, 64 * GIB),
			16 * GIB,
			`${bad || "empty"} falls back to the RAM rule`,
		);
});

test("R1: a machine under 16 GB is refused with a sentence, before anything spawns", async () => {
	assert.equal(m.qwenMachineTooSmall(16 * GIB), null);
	assert.equal(m.qwenMachineTooSmall(8 * GIB), m.QWEN_MACHINE_TOO_SMALL);
	assert.equal(
		m.QWEN_MACHINE_TOO_SMALL,
		"Voice needs a machine with at least 16 GB of memory.",
	);
	const r = rig({ machineBytes: 8 * GIB });
	const status = await r.voice.start("renderer");
	assert.equal(status.rig, "error");
	assert.equal(status.reason, m.QWEN_MACHINE_TOO_SMALL);
	assert.equal(r.calls.gatewayStart, 0, "no gateway");
	assert.equal(r.calls.speechStart, 0, "no models");
	assert.deepEqual(r.opened, [], "no page");
	// The same machine says the same thing on the renderer's retry.
	const again = await r.voice.start("renderer");
	assert.equal(again.reason, m.QWEN_MACHINE_TOO_SMALL);
});

test("R2: only a normal window may create the page; the env switch still opts out", () => {
	const page = m.voicePageAllowed;
	assert.equal(page("normal", {}), true);
	assert.equal(page("headless", {}), false, "nobody is at the screen");
	assert.equal(page("inactive", {}), false);
	assert.equal(page("normal", { LOP_QWEN_NO_WEBUI: "1" }), false);
	assert.equal(page("headless", { LOP_QWEN_NO_WEBUI: "1" }), false);
});

test("§9 layers 1-2: s2s runs the launcher under the rig's python, with the cap as a safety net", async () => {
	const args = m.s2sArgs(m.DEFAULT_QWEN_PORTS);
	assert.deepEqual(
		args.slice(-3),
		["--max_speech_ms", "30000", "--no_enable_live_transcription"],
		"BRIEF-1: 20 s dropped a natural 21 s take; 30 s is the backstop, and live transcription is off (final review)",
	);
	const spawned = [];
	const rigDir = fakeRigDir();
	const state = join(rigDir, "state");
	mkdirSync(state);
	let listening = false;
	let alive = true;
	const proc = new m.QwenSpeechProcess(
		launcherPathFor(rigDir),
		rigDir,
		m.DEFAULT_QWEN_PORTS,
		state,
		{
			probe: async () => listening,
			sleep: async () => {
				listening = true;
			},
			kill: (_pid, signal) => {
				if (signal === "SIGTERM") alive = false;
				if (signal === 0 && !alive) throw new Error("ESRCH");
			},
			spawnImpl: (file, argv, options) => {
				spawned.push({ file, argv, options });
				return { pid: 5001, exitCode: null, once() {} };
			},
		},
	);
	await proc.start();
	assert.equal(spawned.length, 1);
	assert.equal(
		spawned[0].file,
		join(rigDir, "s2s-venv", "bin", "python"),
		"the rig's own interpreter, not a system python",
	);
	assert.equal(spawned[0].argv[0], launcherPathFor(rigDir));
	assert.deepEqual(spawned[0].argv.slice(1), args);
	assert.equal(
		spawned[0].options.env.LOP_QWEN_MEM_LIMIT_BYTES,
		String(m.qwenMemoryBudget(process.env)),
		"layer 1's limit is the budget layer 3 enforces",
	);
	await proc.stop();
	rmSync(rigDir, { recursive: true, force: true });
});

test("§9 layer 3: every 5 s the group footprint is read; over budget the rig is stopped", async () => {
	const rigDir = fakeRigDir();
	const state = join(rigDir, "state");
	mkdirSync(state);
	const intervals = [];
	const exceeded = [];
	const signals = [];
	let alive = true;
	let spawned = false;
	let used = 0;
	const proc = new m.QwenSpeechProcess(
		launcherPathFor(rigDir),
		rigDir,
		m.DEFAULT_QWEN_PORTS,
		state,
		{
			probe: async () => spawned,
			sleep: async () => {},
			kill: (pid, signal) => {
				signals.push([pid, signal]);
				if (signal === "SIGTERM" && pid === -6001) alive = false;
				if (signal === 0 && !alive) throw new Error("ESRCH");
			},
			spawnImpl: () => {
				spawned = true;
				return { pid: 6001, exitCode: null, once() {} };
			},
			budgetBytes: 1_000,
			footprint: () => used,
			onBudgetExceeded: (limit) => exceeded.push(limit),
			setInterval: (fn, ms) => {
				const handle = { fn, ms, cleared: false, unref() {} };
				intervals.push(handle);
				return handle;
			},
			clearInterval: (handle) => {
				handle.cleared = true;
			},
		},
	);
	await proc.start();
	assert.equal(intervals.length, 1);
	assert.equal(intervals[0].ms, 5_000);
	used = 999;
	await intervals[0].fn();
	assert.deepEqual(exceeded, [], "under budget: nothing is stopped");
	assert.equal(intervals[0].cleared, false);
	used = 1_001;
	await intervals[0].fn();
	assert.deepEqual(exceeded, [1_000], "the owner is told the budget");
	assert.equal(intervals[0].cleared, true, "the poll stops with the process");
	assert.deepEqual(signals[0], [-6001, "SIGTERM"], "by the group, as always");
	await new Promise((resolve) => setImmediate(resolve));
	rmSync(rigDir, { recursive: true, force: true });
});

test("§9/M4: a rejecting footprint read is caught, not an unhandled rejection", async () => {
	const rigDir = fakeRigDir();
	const state = join(rigDir, "state");
	mkdirSync(state);
	const intervals = [];
	const logs = [];
	let spawned = false;
	const proc = new m.QwenSpeechProcess(
		launcherPathFor(rigDir),
		rigDir,
		m.DEFAULT_QWEN_PORTS,
		state,
		{
			probe: async () => spawned,
			sleep: async () => {},
			kill: () => {},
			spawnImpl: () => {
				spawned = true;
				return { pid: 7002, exitCode: null, once() {} };
			},
			budgetBytes: 1_000,
			footprint: async () => {
				throw new Error("footprint: not a Mach-O file");
			},
			log: (line) => logs.push(line),
			setInterval: (fn, ms) => {
				const handle = { fn, ms, cleared: false, unref() {} };
				intervals.push(handle);
				return handle;
			},
			clearInterval: (handle) => {
				handle.cleared = true;
			},
		},
	);
	await proc.start();
	/*
	 * The interval discards the promise it is given, so without the call-site
	 * catch this rejection would be unhandled (review round 2, minor 3). The
	 * returned promise settling rather than rejecting is the fix's evidence.
	 */
	await intervals[0].fn();
	assert.match(
		logs.join("\n"),
		/footprint check failed: footprint: not a Mach-O file/,
	);
	assert.equal(intervals[0].cleared, false, "a failed read never stops a rig");
	rmSync(rigDir, { recursive: true, force: true });
});

test("§9/M4: an unreadable footprint is not a reason to stop a working rig, and it is not silent", async () => {
	const rigDir = fakeRigDir();
	const state = join(rigDir, "state");
	mkdirSync(state);
	const intervals = [];
	const exceeded = [];
	const logs = [];
	let alive = true;
	let spawned = false;
	const proc = new m.QwenSpeechProcess(
		launcherPathFor(rigDir),
		rigDir,
		m.DEFAULT_QWEN_PORTS,
		state,
		{
			probe: async () => spawned,
			sleep: async () => {},
			kill: (_pid, signal) => {
				if (signal === "SIGTERM") alive = false;
				if (signal === 0 && !alive) throw new Error("ESRCH");
			},
			spawnImpl: () => {
				spawned = true;
				return { pid: 7001, exitCode: null, once() {} };
			},
			budgetBytes: 1_000,
			footprint: async () => null,
			onBudgetExceeded: (limit) => exceeded.push(limit),
			log: (line) => logs.push(line),
			setInterval: (fn, ms) => {
				const handle = { fn, ms, cleared: false, unref() {} };
				intervals.push(handle);
				return handle;
			},
			clearInterval: (handle) => {
				handle.cleared = true;
			},
		},
	);
	await proc.start();
	await intervals[0].fn();
	assert.deepEqual(exceeded, []);
	assert.equal(intervals[0].cleared, false);
	assert.match(
		logs.join("\n"),
		/footprint unreadable \(1 consecutive failed reads\)/,
		"M4: the FIRST failed read is logged",
	);
	for (let i = 0; i < 10; i += 1) await intervals[0].fn();
	const blind = logs.filter((line) => /unreadable/.test(line));
	assert.equal(blind.length, 1, "and then it is not a line every 5 s");
	await intervals[0].fn();
	assert.equal(
		logs.filter((line) => /unreadable/.test(line)).length,
		2,
		"the count returns every twelfth failure",
	);
	assert.match(logs.join("\n"), /12 consecutive failed reads/);
	await proc.stop();
	rmSync(rigDir, { recursive: true, force: true });
});

test("Q12: the guard's own sentence wins over the start path's \"exited during start\"", async () => {
	const r = rig();
	r.voice.observeFrame(voiceFrame("aaaaaaaaaaaa"));
	await settle();
	await settle();
	r.voice.budgetExceeded(8 * GIB);
	assert.equal(r.voice.getStatus().rig, "error");
	assert.equal(
		r.voice.getStatus().reason,
		"Voice stopped: it used more than 8 GB",
	);
	assert.equal(r.calls.speechStop >= 1, true, "the rig is stopped too");
});

test("s2s is stopped by its recorded PROCESS GROUP, SIGTERM then SIGKILL, idempotently", async () => {
	const signals = [];
	let alive = true;
	const child = {
		pid: 4242,
		exitCode: null,
		once() {},
	};
	const proc = new m.QwenSpeechProcess(
		"/rig/qwen-voice/s2s-launch.py",
		"/nonexistent-rig",
		m.DEFAULT_QWEN_PORTS,
		"/tmp",
		{
			kill: (pid, signal) => {
				signals.push([pid, signal]);
				if (signal === 0 && !alive) throw new Error("ESRCH");
			},
			sleep: async () => {},
		},
	);
	// Inject a running child as start() would have recorded it.
	proc.child = child;
	proc.pgid = 4242;
	alive = false;
	await proc.stop();
	assert.deepEqual(
		signals[0],
		[-4242, "SIGTERM"],
		"negative pid: the whole group",
	);
	assert.equal(
		signals.some(([pid]) => pid === 4242),
		false,
		"never a bare pid",
	);
	await proc.stop();
	assert.equal(
		signals.filter(([, s]) => s === "SIGTERM").length,
		1,
		"idempotent",
	);
	// A start against a rig directory that is not there refuses by name.
	await assert.rejects(
		proc.start(),
		RIG_NOT_FOUND,
		"the header shows this sentence verbatim (D10)",
	);
});

test("Q12: with the rig absent the Gateway is never forked, and the start names the rig, not an ENOENT", async () => {
	let forks = 0;
	const fork = () => {
		forks += 1;
		throw new Error(
			"ENOENT: no such file or directory, open '.../qwa/node_modules/qwen-audio-agent/package.json'",
		);
	};
	const ports = { gateway: 3191, s2s: 8795, relay: 8796 };
	const state = mkdtempSync(join(tmpdir(), `qv-gw-${process.pid}-`));
	const absent = new m.QwenGatewayHost(
		"/launcher.mjs",
		"/nonexistent-rig",
		ports,
		state,
		() => {},
		fork,
	);
	await assert.rejects(absent.start(), RIG_NOT_FOUND);
	assert.equal(forks, 0, "nothing forked");
	// A complete rig gets as far as the fork.
	const present = new m.QwenGatewayHost(
		"/launcher.mjs",
		fakeRigDir(),
		ports,
		state,
		() => {},
		fork,
	);
	// The fake fork throws synchronously; only reaching it matters here.
	await assert.rejects(async () => present.start(), RAW_ENOENT);
	assert.equal(forks, 1);
});

/*
 * THE APP'S OWN CRASH ORPHAN (QA round 1, Q5): s2s's pid/pgid is recorded in
 * the profile at spawn; the next start reaps that group only when the pid is
 * alive, leads the recorded group and runs THIS rig's s2s on the relay model.
 * Anything else holding the port keeps the "Port ... is in use" error.
 */
/** The launcher this app runs in place of the rig's console script. */
function launcherPathFor(rigDir) {
	return join(rigDir, "qwen-voice", "s2s-launch.py");
}

function fakeRigDir() {
	const root = mkdtempSync(join(tmpdir(), `qv-rig-${process.pid}-`));
	for (const dir of [
		join("s2s-venv", "bin"),
		join("qwa", "node_modules", "qwen-audio-agent"),
		"hf-cache",
	])
		mkdirSync(join(root, dir), { recursive: true });
	writeFileSync(join(root, "s2s-venv", "bin", "python"), "");
	writeFileSync(join(root, "s2s-venv", "bin", "speech-to-speech"), "");
	writeFileSync(
		join(root, "qwa", "node_modules", "qwen-audio-agent", "package.json"),
		"{}",
	);
	return root;
}

function orphanCase({ command, pgid = 777 }) {
	const rigDir = fakeRigDir();
	const state = join(rigDir, "state");
	mkdirSync(state);
	writeFileSync(
		join(state, m.S2S_RECORD_FILE),
		JSON.stringify({ pid: 777, pgid: 777 }),
	);
	let portHeld = true;
	const signals = [];
	const spawned = [];
	const proc = new m.QwenSpeechProcess(
		launcherPathFor(rigDir),
		rigDir,
		m.DEFAULT_QWEN_PORTS,
		state,
		{
			inspect: (pid) =>
				pid === 777 && portHeld ? { pgid, command: command(rigDir) } : null,
			kill: (pid, signal) => {
				signals.push([pid, signal]);
				if (signal === "SIGTERM" && pid === -777) portHeld = false;
				if (signal === 0 && !portHeld) throw new Error("ESRCH");
			},
			probe: async () => portHeld,
			sleep: async () => {},
			spawnImpl: () => {
				const child = {
					pid: 9001,
					exitCode: null,
					once() {},
				};
				spawned.push(child);
				portHeld = true; // the new s2s listens at once
				return child;
			},
		},
	);
	return { proc, signals, spawned, rigDir, state };
}

test("ORPHAN: a recorded s2s of THIS rig left by a SIGKILLed app is reaped by group, then voice starts", async () => {
	const c = orphanCase({
		command: (rig) =>
			`${rig}/s2s-venv/bin/python ${rig}/s2s-venv/bin/speech-to-speech serve --model_name lop-relay --port 8765`,
	});
	await c.proc.start();
	assert.deepEqual(c.signals[0], [-777, "SIGTERM"], "the recorded group");
	assert.equal(
		c.signals.some(([pid]) => pid === 777),
		false,
		"never a bare pid",
	);
	assert.equal(c.spawned.length, 1, "then the new s2s starts");
	assert.deepEqual(
		JSON.parse(readFileSync(join(c.state, m.S2S_RECORD_FILE), "utf8")),
		{ pid: 9001, pgid: 9001 },
		"the new one is recorded",
	);
	await c.proc.stop();
	assert.equal(existsSync(join(c.state, m.S2S_RECORD_FILE)), false);
	rmSync(c.rigDir, { recursive: true, force: true });
});

test("ORPHAN: the launcher this app starts now is recognised as our s2s; a stray python is not", () => {
	const rig = "/rig";
	const record = { pid: 5, pgid: 5 };
	const facts = (command) => ({ pgid: 5, command });
	assert.equal(
		m.isOurS2s(
			facts(
				"/rig/s2s-venv/bin/python /app/resources/qwen-voice/s2s-launch.py serve --model_name lop-relay",
			),
			record,
			rig,
		),
		true,
		"the shape this app spawns",
	);
	assert.equal(
		m.isOurS2s(
			facts("/rig/s2s-venv/bin/speech-to-speech serve --model_name lop-relay"),
			record,
			rig,
		),
		true,
		"a rig started by an older build is still ours to reap",
	);
	assert.equal(
		m.isOurS2s(
			facts(
				"/rig/s2s-venv/bin/python /tmp/other.py serve --model_name lop-relay",
			),
			record,
			rig,
		),
		false,
	);
});

test("ORPHAN: a port holder that is not ours is NEVER killed, and the clear error stays", async () => {
	for (const [label, command, pgid] of [
		[
			"Ben's manual rig, another venv",
			() =>
				"/Users/ben/other/s2s-venv/bin/speech-to-speech serve --model_name lop-relay",
			777,
		],
		[
			"an s2s with the 4B, not the relay",
			(rig) =>
				`${rig}/s2s-venv/bin/speech-to-speech serve --model_name Qwen3-4B`,
			777,
		],
		[
			"pid reused by an unrelated process",
			() => "/usr/bin/python3 -m http.server 8765",
			777,
		],
		[
			"our command but no longer the group leader",
			(rig) =>
				`${rig}/s2s-venv/bin/speech-to-speech serve --model_name lop-relay`,
			1,
		],
	]) {
		const c = orphanCase({ command, pgid });
		await assert.rejects(c.proc.start(), PORT_8765_IN_USE, label);
		assert.deepEqual(c.signals, [], `${label}: nothing signalled`);
		assert.equal(c.spawned.length, 0, label);
		rmSync(c.rigDir, { recursive: true, force: true });
	}
});

test("ORPHAN: an s2s that dies under us reports an unexpected exit once and clears its record", async () => {
	const rigDir = fakeRigDir();
	const state = join(rigDir, "state");
	let exitListener = null;
	let listening = false;
	const exits = [];
	const proc = new m.QwenSpeechProcess(
		launcherPathFor(rigDir),
		rigDir,
		m.DEFAULT_QWEN_PORTS,
		state,
		{
			probe: async () => listening,
			sleep: async () => {
				listening = true;
			},
			kill: () => {},
			onUnexpectedExit: (detail) => exits.push(detail),
			spawnImpl: () => ({
				pid: 4321,
				exitCode: null,
				once: (_event, listener) => {
					exitListener = listener;
				},
			}),
		},
	);
	await proc.start();
	assert.equal(existsSync(join(state, m.S2S_RECORD_FILE)), true);
	exitListener(null, "SIGKILL");
	assert.deepEqual(exits, ["code null, signal SIGKILL"]);
	assert.equal(existsSync(join(state, m.S2S_RECORD_FILE)), false);
	assert.equal(proc.running, false);
	rmSync(rigDir, { recursive: true, force: true });
});

test("Q-3: killNow(true) forgets a record its SIGKILL cannot be seen to have released", async () => {
	const rigDir = fakeRigDir();
	const state = join(rigDir, "state");
	mkdirSync(state);
	let listening = false;
	// The group still reads as alive right after the signal - the case a
	// signal handler cannot wait out - so only the explicit flag clears it.
	const proc = new m.QwenSpeechProcess(
		launcherPathFor(rigDir),
		rigDir,
		m.DEFAULT_QWEN_PORTS,
		state,
		{
			probe: async () => listening,
			sleep: async () => {
				listening = true;
			},
			kill: () => {},
			spawnImpl: () => ({ pid: 4321, exitCode: null, once() {} }),
		},
	);
	await proc.start();
	assert.equal(existsSync(join(state, m.S2S_RECORD_FILE)), true);
	proc.killNow(true);
	assert.equal(
		existsSync(join(state, m.S2S_RECORD_FILE)),
		false,
		"the signal path leaves nothing for a next start to reap",
	);
	// The quit path keeps it: a start that finds a live group re-checks it.
	listening = false;
	await proc.start();
	assert.equal(existsSync(join(state, m.S2S_RECORD_FILE)), true);
	proc.killNow();
	assert.equal(
		existsSync(join(state, m.S2S_RECORD_FILE)),
		true,
		"unchanged for the paths nothing runs behind differently",
	);
	rmSync(rigDir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------------ */
/* The text-only utterance relay (a deviation the manager approved)          */
/* ------------------------------------------------------------------------ */

const received = [];
const server = createServer((req, res) => {
	const chunks = [];
	req.on("data", (c) => chunks.push(c));
	req.on("end", () => {
		received.push({
			url: req.url,
			type: req.headers["content-type"],
			auth: req.headers.authorization,
			body: Buffer.concat(chunks).toString("utf8"),
		});
		const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
		if (form.get("text") === "pending") {
			res.writeHead(409, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					detail: {
						code: "approval_pending",
						text: "Answer it on screen first.",
					},
				}),
			);
			return;
		}
		res.writeHead(200, { "content-type": "application/json" });
		res.end(
			JSON.stringify({
				result: { text: form.get("text"), path: null, admission: {} },
			}),
		);
	});
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
after(() => server.close());
const url = `http://127.0.0.1:${server.address().port}`;
const UTTERANCE = {
	op: "voice.utterance",
	sessionId: "0123456789ab",
	requestId: "6f1c2a4e-1b2c-4d3e-8f90-123456789abc",
	text: "What's in plan.txt?",
	textOrigin: "qwen_s2s",
};

test("voice.utterance posts the route's form fields, text only, with main's bearer", async () => {
	const response = await m.requestDesktopMedia(
		UTTERANCE,
		null,
		url,
		"synthetic-token",
	);
	assert.equal(response.status, 200);
	const sent = received.at(-1);
	assert.equal(sent.url, "/v1/desktop/voice/utterance");
	assert.match(sent.type, FORM_URLENCODED);
	assert.equal(sent.auth, "Bearer synthetic-token");
	assert.deepEqual(Object.fromEntries(new URLSearchParams(sent.body)), {
		session_id: "0123456789ab",
		request_id: "6f1c2a4e-1b2c-4d3e-8f90-123456789abc",
		text: "What's in plan.txt?",
		text_origin: "qwen_s2s",
	});
});

test("voice.utterance CANNOT carry a file: bytes and file fields are refused before any request", async () => {
	const before = received.length;
	const bytes = await m.requestDesktopMedia(
		UTTERANCE,
		new Uint8Array([82, 73, 70, 70]),
		url,
		"synthetic-token",
	);
	assert.equal(bytes.kind, "error");
	assert.equal(bytes.status, 422);
	for (const extra of [
		{ file: "x.wav" },
		{ fileName: "x.wav", mimeType: "audio/wav" },
		{ audio: "UklGRg==" },
	]) {
		const refused = await m.requestDesktopMedia(
			{ ...UTTERANCE, ...extra },
			null,
			url,
			"synthetic-token",
		);
		assert.equal(refused.kind, "error", JSON.stringify(extra));
	}
	const noText = await m.requestDesktopMedia(
		{ ...UTTERANCE, text: "" },
		null,
		url,
		"synthetic-token",
	);
	assert.equal(noText.kind, "error");
	const dashless = await m.requestDesktopMedia(
		{ ...UTTERANCE, requestId: "6f1c2a4e1b2c4d3e8f90123456789abc" },
		null,
		url,
		"synthetic-token",
	);
	assert.equal(dashless.kind, "error", "the route's dashed RequestID only");
	assert.equal(received.length, before, "nothing reached the server");
});

test("a voice refusal keeps its code as voiceCode", async () => {
	const response = await m.requestDesktopMedia(
		{ ...UTTERANCE, text: "pending" },
		null,
		url,
		"synthetic-token",
	);
	assert.equal(response.kind, "error");
	assert.equal(response.status, 409);
	assert.equal(response.voiceCode, "approval_pending");
});
