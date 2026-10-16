import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { after, test } from "node:test";
import { build } from "esbuild";

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
			'export { QwenSpeechProcess, resolveQwenPorts, s2sArgs, s2sEnv, DEFAULT_QWEN_PORTS } from "./src/main/voice/qwen-rig";',
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

/* ------------------------------------------------------------------------ */
/* The coordinator                                                           */
/* ------------------------------------------------------------------------ */

function rig({ gatewayFails = false } = {}) {
	const sent = [];
	const toRenderer = [];
	const opened = [];
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
			this.running = true;
		},
		async stop() {
			calls.speechStop += 1;
			this.running = false;
		},
		killNow() {
			calls.kill += 1;
			this.running = false;
		},
	};
	const voice = new m.QwenVoice({
		gateway,
		speech,
		toRenderer: (channel, payload) => {
			toRenderer.push({ channel, payload });
			return true;
		},
		openWebUi: (url) => opened.push(url),
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
		sent,
		toRenderer,
		opened,
		timers,
		calls,
		advance: (ms) => {
			now += ms;
		},
	};
}

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

test("stopNow (will-quit) stops both processes synchronously", () => {
	const r = rig();
	r.voice.stopNow();
	r.voice.stopNow();
	assert.equal(r.calls.kill, 2);
	assert.equal(r.calls.gatewayStop, 2);
});

test("a failed start reports error with the reason and leaves nothing running", async () => {
	const r = rig({ gatewayFails: true });
	const status = await r.voice.start("renderer");
	assert.equal(status.rig, "error");
	assert.match(status.reason, /3101/);
	assert.equal(r.calls.speechStart, 0);
	assert.equal(r.calls.speechStop, 1, "stopped what it might have started");
});

test("SPEAK GUARD: a text main relayed as a 200 /voice/text is spoken once; an unrelayed one is refused", async () => {
	const r = rig();
	r.voice.observeFrame(voiceFrame("aaaaaaaaaaaa"));
	await settle();
	await settle();
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
		openWebUi: () => {},
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

test("s2s is stopped by its recorded PROCESS GROUP, SIGTERM then SIGKILL, idempotently", async () => {
	const signals = [];
	let alive = true;
	const child = {
		pid: 4242,
		exitCode: null,
		once() {},
	};
	const proc = new m.QwenSpeechProcess(
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
	await assert.rejects(proc.start(), /missing/);
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
	assert.match(sent.type, /application\/x-www-form-urlencoded/);
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
