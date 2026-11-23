import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * BRING-YOUR-OWN-KEY VOICE IN MAIN (Groq plan D2/D3/D7 U2): the coordinator's
 * byok path and the app-owned voice page's adapter, driven through the SHIPPED
 * modules with the page, the media relay and the renderer injected as fakes.
 * Nothing here opens a window, a microphone or a socket; real listening,
 * playback and MP3 decoding are a person's to check.
 */
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/voice/byok-voice";',
			'export * from "./src/main/voice/byok-voice-page";',
			'export { QwenVoice, QWEN_CHANNEL } from "./src/main/voice/qwen-voice";',
			'export * from "./src/main/voice/qwen-voice-setting";',
			'export { VOICE_PAGE_CHANNELS } from "./src/voice-page/channels";',
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
const bundlePath = new URL(`./_byok-voice-${process.pid}.mjs`, import.meta.url);
writeFileSync(bundlePath, bundle.outputFiles[0].text);
after(() => rmSync(bundlePath, { force: true }));
const m = await import(bundlePath.href);

const SESSION = "0123456789ab";
const OTHER = "ba9876543210";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const MENTIONS_ELEVENLABS = /ElevenLabs/;
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A WAV that passes the shape check: RIFF....WAVE plus a little body. */
const wav = (n = 64) => {
	const bytes = new Uint8Array(n);
	bytes.set([0x52, 0x49, 0x46, 0x46], 0);
	bytes.set([0x57, 0x41, 0x56, 0x45], 8);
	return bytes;
};
const mp3 = (index) => ({
	status: 200,
	kind: "bytes",
	mimeType: "audio/mpeg",
	data: new Uint8Array([0x49, 0x44, 0x33, index]),
});
const refusal = (status, voiceCode) => ({
	status,
	kind: "error",
	detail: "No.",
	...(voiceCode ? { voiceCode } : {}),
});
const MESSAGE_SOURCE = { kind: "message", messageId: "m1" };

/* ------------------------------------------------------------------------ */
/* ByokVoice: listening, takes, speaking                                      */
/* ------------------------------------------------------------------------ */

/*
 * THE ONE SPEECH PROVIDER. The page listens only for a chosen provider that the
 * backend says is ready; every other answer (none chosen, not ready, not read
 * yet) opens no page and never asks for the microphone. `READY_STATUS` is what
 * `readVoiceProviderStatus` returns for a ready Radient choice, and it is the
 * rig's default so the listening, take and speak cases below stay about those.
 */
const READY = { ready: true, reason: null };
const NO_KEY = { ready: false, reason: "No ElevenLabs API key is stored." };
const READY_STATUS = {
	provider: "radient",
	providers: { radient: READY, elevenlabs: NO_KEY },
};

function byokRig({
	mic = "granted",
	provider = READY_STATUS,
	media = null,
	timers = [],
} = {}) {
	let cleared = false;
	const calls = [];
	const order = [];
	const toRenderer = [];
	const reports = [];
	const gaps = [];
	const mediaCalls = [];
	let ids = 0;
	const page = {
		allowed: true,
		mic,
		open: () => {
			order.push("open");
			calls.push("open");
		},
		close: () => {
			order.push("close");
			calls.push("close");
		},
		play: (message) => calls.push({ play: message }),
		stop: () => calls.push("stop"),
		setMuted: (muted) => calls.push({ muted }),
		prepareMicrophone: async (options = {}) => {
			order.push("mic");
			page.preflight = options;
			return page.mic;
		},
	};
	const byok = new m.ByokVoice({
		page,
		media: async (request, bytes) => {
			mediaCalls.push({ request, bytes });
			return media ? media(request, bytes) : mp3(request.segment ?? 0);
		},
		toRenderer: (channel, payload) => {
			toRenderer.push({ channel, payload });
			return true;
		},
		report: (state, gap) => {
			reports.push(state);
			gaps.push(gap);
		},
		newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
		now: () => Date.parse("2026-11-18T10:00:00.000Z"),
		setTimer: (fn, ms) => {
			const timer = { fn, ms };
			timers.push(timer);
			return timer;
		},
		clearTimer: () => {
			cleared = true;
		},
	});
	if (provider !== null) byok.setProvider(provider);
	const on = (slot = SESSION, muted = false) =>
		byok.apply({ active: slot !== null, slot, muted });
	const channel = (name) =>
		toRenderer.filter((x) => x.channel === name).map((x) => x.payload);
	return {
		byok,
		page,
		calls,
		order,
		timerCleared: () => cleared,
		/** The page's own word that its detector started over a live microphone. */
		ready: () => byok.onVad("ready"),
		fail: () => byok.onVad("failed"),
		toRenderer,
		reports,
		gaps,
		mediaCalls,
		on,
		byokMessages: () => channel("voice.qwen.byok"),
		events: () => channel("voice.qwen.event"),
		played: () => calls.filter((c) => c?.play).map((c) => c.play),
		speechCalls: () =>
			mediaCalls.filter((c) => c.request.op === "voice.speech"),
	};
}

test("LISTEN: the microphone is asked BEFORE the page opens; then the page is open and reported listening", async () => {
	const r = byokRig();
	r.on();
	await settle();
	assert.deepEqual(r.order, ["mic", "open"]);
	assert.equal(r.reports.at(-1), "starting", "open is not proof of hearing");
	r.ready();
	assert.equal(r.reports.at(-1), "listening");
});

test("LISTEN: a denied microphone opens no page and says so; Try again (a new apply) asks again", async () => {
	const r = byokRig({ mic: "denied" });
	r.on();
	await settle();
	assert.deepEqual(r.order, ["mic"]);
	assert.equal(r.reports.at(-1), "mic_denied");
	r.page.mic = "granted";
	r.on();
	await settle();
	assert.deepEqual(r.order, ["mic", "mic", "open"]);
	assert.equal(r.reports.at(-1), "starting", "open is not proof of hearing");
	r.ready();
	assert.equal(r.reports.at(-1), "listening");
});

test("LISTEN: an unanswered prompt is 'prompting'; the OS's later grant opens the page, a denial does not", async () => {
	const r = byokRig({ mic: "prompting" });
	r.on();
	await settle();
	assert.equal(r.reports.at(-1), "mic_prompting");
	assert.equal(r.page.preflight.timeoutMs, 5000);
	r.page.preflight.onSettled("granted");
	assert.deepEqual(r.order, ["mic", "open"]);
	assert.equal(r.reports.at(-1), "starting", "open is not proof of hearing");
	r.ready();
	assert.equal(r.reports.at(-1), "listening");
	const d = byokRig({ mic: "prompting" });
	d.on();
	await settle();
	d.page.preflight.onSettled("denied");
	assert.deepEqual(d.order, ["mic"]);
	assert.equal(d.reports.at(-1), "mic_denied");
});

test("LISTEN: a repeat apply while the prompt is up does not ask twice; one that arrives after off opens nothing", async () => {
	const r = byokRig({ mic: "prompting" });
	r.on();
	r.on();
	await settle();
	assert.equal(r.order.filter((x) => x === "mic").length, 1);
	r.on(null);
	r.page.preflight.onSettled("granted");
	assert.equal(
		r.order.includes("open"),
		false,
		"off before the answer: no page",
	);
});

test("LISTEN: an unknown microphone verdict (not macOS) proceeds; a run that may not create a page says so", async () => {
	const r = byokRig({ mic: "unknown" });
	r.on();
	await settle();
	assert.equal(r.reports.at(-1), "starting", "open is not proof of hearing");
	r.ready();
	assert.equal(r.reports.at(-1), "listening");
	const n = byokRig();
	n.page.allowed = false;
	n.on();
	await settle();
	assert.deepEqual(n.order, []);
	assert.equal(n.reports.at(-1), "no_window");
});

test("LISTEN: no holder or voice off closes the page at once (privacy) and a repeat does not re-report", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.on(null);
	assert.equal(r.order.at(-1), "close");
	assert.equal(r.reports.at(-1), "idle");
	const count = r.reports.length;
	r.on(null);
	assert.equal(r.reports.length, count);
});

test("PROVIDER: none chosen opens no page and the microphone is never asked", async () => {
	const r = byokRig({ provider: { provider: null, providers: null } });
	r.on();
	await settle();
	assert.deepEqual(r.order, [], "no mic question, no page");
	assert.equal(r.reports.at(-1), "provider_unset");
});

test("PROVIDER: an older backend's answer (neither field) reads as none chosen", async () => {
	const r = byokRig({ provider: { provider: null, providers: null } });
	r.on();
	await settle();
	assert.equal(r.reports.at(-1), "provider_unset");
	assert.equal(
		r.page.preflight,
		undefined,
		"the microphone was never prepared",
	);
});

test("PROVIDER: chosen but not ready opens no page and carries the backend's own reason", async () => {
	const r = byokRig({
		provider: {
			provider: "elevenlabs",
			providers: { radient: READY, elevenlabs: NO_KEY },
		},
	});
	r.on();
	await settle();
	assert.deepEqual(r.order, []);
	assert.equal(r.reports.at(-1), "provider_not_ready");
	assert.deepEqual(r.gaps.at(-1), {
		provider: "elevenlabs",
		reason: "No ElevenLabs API key is stored.",
	});
});

test("PROVIDER: another provider being ready does not stand in for the chosen one", async () => {
	// Radient is ready, ElevenLabs is chosen and is not: nothing listens.
	const r = byokRig({
		provider: {
			provider: "elevenlabs",
			providers: { radient: READY, elevenlabs: NO_KEY },
		},
	});
	r.on();
	await settle();
	assert.equal(r.page.preflight, undefined);
	assert.notEqual(r.reports.at(-1), "listening");
});

test("PROVIDER: not read yet waits - no page, no microphone question, 'checking' - and the answer decides", async () => {
	const r = byokRig({ provider: null });
	r.on();
	await settle();
	assert.deepEqual(r.order, []);
	assert.equal(r.reports.at(-1), "checking");
	r.byok.setProvider(READY_STATUS);
	await settle();
	assert.deepEqual(r.order, ["mic", "open"]);
	assert.equal(r.reports.at(-1), "starting", "open is not proof of hearing");
	r.ready();
	assert.equal(r.reports.at(-1), "listening");
});

test("PROVIDER: the choice arriving opens the page; losing it closes the page", async () => {
	const r = byokRig({ provider: { provider: null, providers: null } });
	r.on();
	await settle();
	r.byok.setProvider(READY_STATUS);
	await settle();
	assert.deepEqual(r.order, ["mic", "open"]);
	assert.equal(r.reports.at(-1), "starting", "open is not proof of hearing");
	r.ready();
	assert.equal(r.reports.at(-1), "listening");
	r.byok.setProvider({
		provider: "radient",
		providers: {
			radient: {
				ready: false,
				reason:
					"Your Radient credit balance is too low for speech. Add credits in the Radient Console to continue.",
			},
			elevenlabs: NO_KEY,
		},
	});
	assert.equal(r.order.at(-1), "close");
	assert.equal(r.reports.at(-1), "provider_not_ready");
	r.byok.setProvider({ provider: null, providers: null });
	assert.equal(r.reports.at(-1), "provider_unset");
});

test("PROVIDER: moving between two ready providers keeps the same page, with no new question", async () => {
	const r = byokRig({
		provider: {
			provider: "radient",
			providers: { radient: READY, elevenlabs: READY },
		},
	});
	r.on();
	await settle();
	r.byok.setProvider({
		provider: "elevenlabs",
		providers: { radient: READY, elevenlabs: READY },
	});
	await settle();
	assert.deepEqual(r.order, ["mic", "open"]);
	assert.equal(r.reports.at(-1), "starting", "open is not proof of hearing");
	r.ready();
	assert.equal(r.reports.at(-1), "listening");
});

test("PROVIDER: an unset answer that arrives while voice is off changes nothing until voice is on", async () => {
	const r = byokRig({ provider: null });
	r.byok.setProvider({ provider: null, providers: null });
	assert.deepEqual(r.order, []);
	assert.deepEqual(r.reports, []);
});

test("MUTE: the person's mute is handed to the page, on every apply that changes it", async () => {
	const r = byokRig();
	r.on(SESSION, true);
	await settle();
	assert.deepEqual(
		r.calls.filter((c) => c?.muted !== undefined),
		[{ muted: true }],
	);
	r.on(SESSION, false);
	assert.deepEqual(
		r.calls.filter((c) => c?.muted !== undefined),
		[{ muted: true }, { muted: false }],
	);
});

/*
 * LISTENING IS THE PAGE'S WORD (review round 1, finding 1): opening the page is
 * "starting"; `ready` (the detector started over a live microphone) is the only
 * thing that says "listening"; `failed` closes the page and says page_failed.
 */
test("READY: an opened page is 'starting' until the page says ready, and a repeat ready does not re-report", async () => {
	const r = byokRig();
	r.on();
	await settle();
	assert.equal(r.reports.at(-1), "starting");
	r.ready();
	assert.equal(r.reports.at(-1), "listening");
	const count = r.reports.length;
	r.ready();
	r.on();
	await settle();
	assert.equal(r.reports.length, count);
	assert.equal(r.reports.at(-1), "listening");
});

test("READY: a ready that arrives with no page open (voice off, closed) says nothing", async () => {
	const r = byokRig();
	r.ready();
	assert.deepEqual(r.reports, []);
	r.on();
	await settle();
	r.on(null);
	const before = r.reports.length;
	r.ready();
	assert.equal(r.reports.length, before);
	assert.equal(r.reports.at(-1), "idle");
});

test("FAILED: the page's failed (model, WASM or microphone lost) closes the page, says page_failed and a repeat AUTOMATIC apply does not reopen it", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.ready();
	r.fail();
	assert.equal(r.order.at(-1), "close", "the microphone is released");
	assert.equal(r.reports.at(-1), "page_failed");
	// Every automatic caller (a slot move, a provider re-read) is an apply: only
	// an explicit retry may reopen, or a broken page would loop open/fail.
	r.on();
	r.on();
	await settle();
	assert.deepEqual(r.order, ["mic", "open", "close"], "no loop");
	r.on(null);
	r.on();
	await settle();
	assert.equal(r.reports.at(-1), "starting");
	r.ready();
	assert.equal(r.reports.at(-1), "listening");
});

test("RETRY: Try again after a failed page reopens it and reaches starting; a second failure can be retried too, one click per attempt", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.ready();
	r.fail();
	assert.equal(r.reports.at(-1), "page_failed");
	r.byok.retry();
	r.on();
	await settle();
	assert.deepEqual(r.order, ["mic", "open", "close", "mic", "open"]);
	assert.equal(r.reports.at(-1), "starting");
	// It fails again: still failed, and an automatic apply still does not loop.
	r.fail();
	assert.equal(r.reports.at(-1), "page_failed");
	r.on();
	await settle();
	assert.deepEqual(r.order, ["mic", "open", "close", "mic", "open", "close"]);
	// A new click is a new attempt.
	r.byok.retry();
	r.on();
	await settle();
	assert.equal(r.order.filter((x) => x === "open").length, 3);
	assert.equal(r.reports.at(-1), "starting");
	r.ready();
	assert.equal(r.reports.at(-1), "listening");
});

test("RETRY: a retry after the page could not be brought back (a second crash) reopens it, and a retry with nothing failed does nothing", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.byok.retry();
	r.on();
	await settle();
	assert.deepEqual(
		r.order,
		["mic", "open"],
		"nothing failed: nothing reopened",
	);
	r.byok.pageStopped("The voice page stopped");
	r.byok.retry();
	r.on();
	await settle();
	assert.deepEqual(r.order.slice(-2), ["mic", "open"]);
	assert.equal(r.reports.at(-1), "starting");
});

test("FAILED: a page that never says ready is a page failure after the start budget, not a Listening that never ends", async () => {
	const timers = [];
	const r = byokRig({ timers });
	r.on();
	await settle();
	assert.equal(r.reports.at(-1), "starting");
	assert.equal(timers.length, 1, "one start budget armed");
	timers[0].fn();
	assert.equal(r.reports.at(-1), "page_failed");
	assert.equal(r.order.at(-1), "close");
	// A ready that beats the budget disarms it.
	const q = byokRig({ timers: [] });
	q.on();
	await settle();
	q.ready();
	assert.equal(q.timerCleared(), true);
});

test("READY: a page that was recreated after a first crash is 'starting' again until it says ready", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.ready();
	r.byok.pageRestarted();
	assert.equal(r.reports.at(-1), "starting");
	r.ready();
	assert.equal(r.reports.at(-1), "listening");
});

test("READY: a crash mid-utterance leaves no 'hearing' or utterance slot behind", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.ready();
	r.byok.onVad("speech_start");
	r.byok.pageRestarted();
	const before = r.events().length;
	r.byok.onVad("speech_cancel");
	assert.equal(r.events().length, before, "no stray speech_stopped");
	// The slot the dead page's utterance began under is forgotten too.
	r.byok.onVad("speech_start");
	r.byok.pageRestarted();
	r.on(OTHER);
	await settle();
	r.byok.onTake(wav());
	await settle();
	assert.equal(
		r.mediaCalls[0]?.request.sessionId,
		OTHER,
		"a take under the new holder is not dropped by a dead page's slot",
	);
});

test("VAD: only the page's own detector words are accepted (junk and objects are ignored)", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.byok.onVad({ kind: "ready" });
	r.byok.onVad("READY");
	assert.equal(r.reports.at(-1), "starting");
});

test("PAGE FAILED: a page that cannot be brought back is reported once and not reopened until voice is switched", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.byok.pageStopped("The voice page stopped");
	assert.equal(r.reports.at(-1), "page_failed");
	r.on();
	await settle();
	assert.deepEqual(r.order, ["mic", "open"], "no loop");
	r.on(null);
	r.on();
	await settle();
	assert.deepEqual(r.order, ["mic", "open", "close", "mic", "open"]);
});

/* ---- takes ---- */

test("TAKE: WAV bytes go to voice.utterance with no provider field (the setting decides), with a fresh dashed id, and the renderer is told start then words", async () => {
	const r = byokRig({
		media: async () => ({
			status: 200,
			kind: "json",
			body: {
				result: { text: "What is in plan.txt?", path: "stt", admission: {} },
			},
		}),
	});
	r.on();
	await settle();
	r.byok.onTake(wav());
	r.byok.onTake(wav());
	await settle();
	const [a, b] = r.mediaCalls;
	assert.equal(a.request.op, "voice.utterance");
	assert.equal(a.request.sessionId, SESSION);
	assert.equal(
		"provider" in a.request,
		false,
		"the backend reads speech.provider; nothing is pinned from here",
	);
	assert.match(a.request.requestId, UUID);
	assert.notEqual(a.request.requestId, b.request.requestId);
	assert.equal(a.request.text, undefined, "a recording, not text");
	assert.equal(a.bytes.byteLength, 64);
	assert.deepEqual(
		r
			.byokMessages()
			.slice(0, 2)
			.map((x) => x.kind),
		["take_start", "take_start"],
	);
	const done = r.byokMessages().filter((x) => x.kind === "take_done");
	assert.equal(done.length, 2);
	assert.deepEqual(done[0], {
		kind: "take_done",
		sessionId: SESSION,
		requestId: a.request.requestId,
		text: "What is in plan.txt?",
	});
});

test("TAKE: it is announced BEFORE it is sent, so the renderer can arm the binding first", async () => {
	const seen = [];
	const r = byokRig({
		media: async () => {
			seen.push(r.byokMessages().map((x) => x.kind));
			return { status: 200, kind: "json", body: { result: { text: "hi" } } };
		},
	});
	r.on();
	await settle();
	r.byok.onTake(wav());
	await settle();
	assert.deepEqual(seen, [["take_start"]]);
});

test("TAKE (privacy): with the slot empty or voice off, a take is dropped - no request, nothing relayed", async () => {
	const r = byokRig();
	r.byok.onTake(wav());
	r.on();
	await settle();
	r.on(null);
	r.byok.onTake(wav());
	await settle();
	assert.deepEqual(r.mediaCalls, []);
	assert.deepEqual(r.byokMessages(), []);
});

test("TAKE: a malformed, oversize or non-WAV payload from the page is dropped", async () => {
	const r = byokRig();
	r.on();
	await settle();
	for (const bad of [
		null,
		"RIFF",
		{ length: 64 },
		new Uint8Array(0),
		new Uint8Array(16),
		new Uint8Array(64),
		wav(44), // a header and no samples holds no audio
		wav(16 * 1024 * 1024 + 1),
	]) {
		r.byok.onTake(bad);
	}
	await settle();
	assert.deepEqual(r.mediaCalls, []);
	assert.deepEqual(r.byokMessages(), []);
});

test("TAKE: an ArrayBuffer-backed copy is sent, and a 16 MiB take is the limit", async () => {
	const r = byokRig({
		media: async () => ({
			status: 200,
			kind: "json",
			body: { result: { text: "x" } },
		}),
	});
	r.on();
	await settle();
	r.byok.onTake(wav(16 * 1024 * 1024));
	await settle();
	assert.equal(r.mediaCalls.length, 1);
	assert.ok(r.mediaCalls[0].bytes.buffer instanceof ArrayBuffer);
});

test("TAKE: each refusal reaches the renderer as a take_failed with its declared code and status", async () => {
	for (const [status, code, expected] of [
		[422, "empty_transcript", "empty_transcript"],
		[429, "voice_rate_limited", "voice_rate_limited"],
		[409, "stt_unavailable", "stt_unavailable"],
		[409, "approval_pending", "approval_pending"],
		[409, "voice_not_enabled", "voice_not_enabled"],
		[502, undefined, "failed"],
	]) {
		const r = byokRig({ media: async () => refusal(status, code) });
		r.on();
		await settle();
		r.byok.onTake(wav());
		await settle();
		const failed = r.byokMessages().find((x) => x.kind === "take_failed");
		assert.equal(failed.code, expected, `${status} ${code}`);
		assert.equal(failed.status, status);
		assert.equal(failed.sessionId, SESSION);
		assert.match(failed.requestId, UUID);
	}
});

/*
 * A PINNED PROVIDER'S FAILURE IS THE PROVIDER'S OWN WORDS ("Your Radient credit
 * balance is too low for speech...", "Not signed in to Radient.", "No ElevenLabs
 * API key is stored."). They ride the refusal's `detail`; the renderer shows
 * them as written, so main passes the sentence through for the codes that carry
 * one - and never the transport's own generic "The media request failed.".
 */
const PROVIDER_WORDS = [
	[
		402,
		"voice_unavailable",
		"Your Radient credit balance is too low for speech. Add credits in the Radient Console to continue.",
	],
	[409, "stt_unavailable", "Not signed in to Radient."],
	[409, "voice_unavailable", "No ElevenLabs API key is stored."],
	[
		409,
		"voice_provider_unset",
		"Choose a speech provider first: Radient or your own ElevenLabs key. Voice mode uses only the one you pick.",
	],
];

test("TAKE: a provider's own sentence reaches the renderer with its refusal; a generic one does not", async () => {
	for (const [status, code, sentence] of PROVIDER_WORDS) {
		const r = byokRig({
			media: async () => ({
				status,
				kind: "error",
				detail: sentence,
				voiceCode: code,
			}),
		});
		r.on();
		await settle();
		r.byok.onTake(wav());
		await settle();
		const failed = r.byokMessages().find((x) => x.kind === "take_failed");
		assert.equal(failed.detail, sentence, `${status} ${code}`);
	}
	const generic = byokRig({
		media: async () => ({
			status: 409,
			kind: "error",
			detail: "The media request failed.",
			voiceCode: "stt_unavailable",
		}),
	});
	generic.on();
	await settle();
	generic.byok.onTake(wav());
	await settle();
	assert.equal(
		"detail" in generic.byokMessages().find((x) => x.kind === "take_failed"),
		false,
		"no sentence is invented for a refusal that had none",
	);
});

test("SPEAK failure: a provider's own sentence reaches the renderer with the failure", async () => {
	for (const [status, code, sentence] of PROVIDER_WORDS) {
		const r = byokRig({
			media: async () => ({
				status,
				kind: "error",
				detail: sentence,
				voiceCode: code,
			}),
		});
		r.on();
		await settle();
		r.byok.speak(ENTRY(1));
		await settle();
		const failed = r.byokMessages().at(-1);
		assert.equal(failed.kind, "speech_failed");
		assert.equal(failed.detail, sentence, `${status} ${code}`);
	}
});

test("TAKE: a slot that moved while the request was out still reports for the session it was sent to", async () => {
	let release;
	const r = byokRig({
		media: () =>
			new Promise((resolve) => {
				release = () =>
					resolve({
						status: 200,
						kind: "json",
						body: { result: { text: "hello" } },
					});
			}),
	});
	r.on();
	await settle();
	r.byok.onTake(wav());
	await settle();
	r.on(OTHER);
	release();
	await settle();
	assert.equal(r.byokMessages().at(-1).sessionId, SESSION);
});

test("TAKE (slot): an utterance that began under one conversation is not uploaded to the next", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.byok.onVad("speech_start");
	r.on(OTHER);
	await settle();
	r.byok.onVad("speech_end");
	r.byok.onTake(wav());
	await settle();
	assert.deepEqual(r.mediaCalls, [], "dropped, not misdelivered");
	assert.deepEqual(r.byokMessages(), []);
	// The next utterance, begun under the new holder, goes to it.
	r.byok.onVad("speech_start");
	r.byok.onVad("speech_end");
	r.byok.onTake(wav());
	await settle();
	assert.equal(r.mediaCalls.length, 1);
	assert.equal(r.mediaCalls[0].request.sessionId, OTHER);
});

test("TAKE (slot): a take that follows its own speech_start in the same conversation is sent, once", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.byok.onVad("speech_start");
	r.byok.onVad("speech_end");
	r.byok.onTake(wav());
	r.byok.onTake(wav());
	await settle();
	assert.equal(
		r.mediaCalls.length,
		2,
		"a take with no pending start uses the slot now",
	);
	assert.equal(r.mediaCalls[0].request.sessionId, SESSION);
});

/* ---- vad ---- */

test("VAD: speech_start and speech_end become the allowlisted hearing events, in the ISO shape the renderer parses", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.byok.onVad("speech_start");
	r.byok.onVad("speech_end");
	r.byok.onVad("nonsense");
	r.byok.onVad({ kind: "speech_start" });
	const events = r.events();
	assert.deepEqual(
		events.map((e) => e.type),
		["realtime.provider.speech_started", "realtime.provider.speech_stopped"],
	);
	for (const e of events) assert.match(e.at, ISO);
});

test("VAD: speech_cancel clears 'Hearing you' for a start main heard, and says nothing otherwise", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.byok.onVad("speech_cancel");
	assert.deepEqual(r.events(), [], "nothing was heard: nothing to clear");
	r.byok.onVad("speech_start");
	r.byok.onVad("speech_cancel");
	r.byok.onVad("speech_cancel");
	assert.deepEqual(
		r.events().map((e) => e.type),
		["realtime.provider.speech_started", "realtime.provider.speech_stopped"],
	);
});

test("VAD: a cancelled start does not leave the utterance's slot pinned", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.byok.onVad("speech_start");
	r.byok.onVad("speech_cancel");
	r.on(OTHER);
	await settle();
	r.byok.onTake(wav());
	await settle();
	assert.equal(r.mediaCalls[0].request.sessionId, OTHER);
});

test("VAD: nothing is said while voice is off or the slot is empty", async () => {
	const r = byokRig();
	r.byok.onVad("speech_start");
	r.on();
	await settle();
	r.on(null);
	r.byok.onVad("speech_start");
	assert.deepEqual(r.events(), []);
});

/* ---- speaking ---- */

const ENTRY = (segments = 3, sessionId = SESSION) => ({
	sessionId,
	kind: "reply",
	source: MESSAGE_SOURCE,
	segments,
});

test("SPEAK: segment 0 is fetched and pushed; segment i+1 only once i has STARTED (one ahead); the last is marked", async () => {
	const r = byokRig();
	r.on();
	await settle();
	assert.deepEqual(r.byok.speak(ENTRY(3)), { spoken: true });
	await settle();
	assert.equal(r.speechCalls().length, 1);
	assert.deepEqual(r.speechCalls()[0].request, {
		op: "voice.speech",
		sessionId: SESSION,
		source: MESSAGE_SOURCE,
		segment: 0,
	});
	const [first] = r.played();
	assert.equal(first.id.index, 0);
	assert.match(first.id.replyId, UUID);
	assert.deepEqual(
		[...first.bytes],
		[0x49, 0x44, 0x33, 0],
		"the MP3 is passed through untouched",
	);
	assert.notEqual(first.last, true);
	await settle();
	assert.equal(
		r.speechCalls().length,
		1,
		"nothing more until segment 0 begins",
	);
	const { replyId } = first.id;
	r.byok.onProgress({ kind: "segment_start", replyId, index: 0 });
	await settle();
	assert.equal(r.speechCalls().length, 2);
	assert.equal(r.played()[1].id.index, 1);
	r.byok.onProgress({ kind: "segment_start", replyId, index: 1 });
	await settle();
	assert.equal(r.speechCalls().length, 3);
	const last = r.played()[2];
	assert.equal(last.id.index, 2);
	assert.equal(last.last, true);
	assert.equal(last.id.replyId, replyId);
});

test("SPEAK: a one-segment reply is one request, marked last", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.byok.speak(ENTRY(1));
	await settle();
	assert.equal(r.speechCalls().length, 1);
	assert.equal(r.played()[0].last, true);
});

test("SPEAK: a gate source and a phrase-free reference are passed as given; the renderer never supplies words", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.byok.speak({
		sessionId: SESSION,
		kind: "gate",
		source: { kind: "gate", requestId: "g1" },
		segments: 1,
	});
	await settle();
	assert.deepEqual(r.speechCalls()[0].request.source, {
		kind: "gate",
		requestId: "g1",
	});
	assert.equal(
		JSON.stringify(r.speechCalls()[0].request).includes("text"),
		false,
	);
});

test("SPEAK: Speaking is the page's own word - started on the first segment's start, ended on drain", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.byok.speak(ENTRY(1));
	await settle();
	assert.deepEqual(r.events(), []);
	const { replyId } = r.played()[0].id;
	r.byok.onProgress({ kind: "segment_start", replyId, index: 0 });
	r.byok.onProgress({ kind: "drained", replyId });
	const events = r.events();
	assert.deepEqual(
		events.map((e) => e.type),
		["realtime.playback.started", "realtime.playback.ended"],
	);
	assert.equal(events[1].accepted, true);
	for (const e of events) assert.match(e.at, ISO);
});

test("SPEAK: progress for any other reply is ignored", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.byok.speak(ENTRY(2));
	await settle();
	r.byok.onProgress({
		kind: "segment_start",
		replyId: "someone-else",
		index: 0,
	});
	r.byok.onProgress({ kind: "drained", replyId: "someone-else" });
	r.byok.onProgress({
		kind: "segment_start",
		replyId: r.played()[0].id.replyId,
		index: -1,
	});
	r.byok.onProgress("junk");
	await settle();
	assert.equal(r.speechCalls().length, 1);
	assert.deepEqual(r.events(), []);
});

test("BARGE-IN: speech_start mid-reply stops the page, fetches nothing more and reports the playback cancelled", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.byok.speak(ENTRY(3));
	await settle();
	const { replyId } = r.played()[0].id;
	r.byok.onProgress({ kind: "segment_start", replyId, index: 0 });
	await settle();
	assert.equal(r.speechCalls().length, 2);
	r.byok.onVad("speech_start");
	assert.equal(r.calls.at(-1), "stop");
	r.byok.onProgress({ kind: "segment_start", replyId, index: 1 });
	await settle();
	assert.equal(
		r.speechCalls().length,
		2,
		"no third request after the interruption",
	);
	assert.deepEqual(
		r.events().map((e) => e.type),
		[
			"realtime.playback.started",
			"realtime.provider.speech_started",
			"realtime.playback.cancelled",
		],
	);
});

test("BARGE-IN: a speech_start with no reply does not stop the page", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.byok.onVad("speech_start");
	assert.equal(r.calls.includes("stop"), false);
});

test("STOP: the slot moving, voice going off and the page closing each end the reply", async () => {
	for (const end of [
		(r) => r.on(OTHER),
		(r) => r.on(null),
		(r) => r.byok.pageStopped("The voice page stopped"),
	]) {
		const r = byokRig();
		r.on();
		await settle();
		r.byok.speak(ENTRY(3));
		await settle();
		const { replyId } = r.played()[0].id;
		end(r);
		r.byok.onProgress({ kind: "segment_start", replyId, index: 0 });
		await settle();
		assert.equal(r.speechCalls().length, 1);
	}
});

test("STOP: a new reply replaces the old: the page is stopped and the first reply fetches no more", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.byok.speak(ENTRY(3));
	await settle();
	const first = r.played()[0].id.replyId;
	r.byok.speak(ENTRY(2));
	await settle();
	assert.ok(r.calls.includes("stop"));
	const second = r.played().at(-1).id.replyId;
	assert.notEqual(first, second);
	r.byok.onProgress({ kind: "segment_start", replyId: first, index: 0 });
	await settle();
	assert.equal(
		r.speechCalls().length,
		2,
		"only the new reply's segment 0 was fetched",
	);
});

test("SPEAK refused: no page, voice off, another session, no segments", async () => {
	const r = byokRig();
	assert.deepEqual(r.byok.speak(ENTRY(1)), {
		spoken: false,
		reason: "not_active",
	});
	r.on();
	await settle();
	assert.deepEqual(r.byok.speak(ENTRY(1, OTHER)), {
		spoken: false,
		reason: "not_active",
	});
	assert.deepEqual(r.byok.speak(ENTRY(0)), {
		spoken: false,
		reason: "no_segments",
	});
	r.byok.pageStopped("x");
	assert.deepEqual(r.byok.speak(ENTRY(1)), {
		spoken: false,
		reason: "no_client",
	});
	assert.deepEqual(r.speechCalls(), []);
});

test("SPEAK failure: a 429 tells the renderer and plays nothing; so does a non-audio answer", async () => {
	const limited = byokRig({
		media: async () => refusal(429, "voice_rate_limited"),
	});
	limited.on();
	await settle();
	limited.byok.speak(ENTRY(2));
	await settle();
	assert.deepEqual(limited.byokMessages().at(-1), {
		kind: "speech_failed",
		sessionId: SESSION,
		code: "voice_rate_limited",
	});
	assert.deepEqual(limited.played(), []);
	const json = byokRig({
		media: async () => ({ status: 200, kind: "json", body: {} }),
	});
	json.on();
	await settle();
	json.byok.speak(ENTRY(1));
	await settle();
	assert.equal(json.byokMessages().at(-1).code, "failed");
	assert.deepEqual(json.played(), []);
	const unavailable = byokRig({
		media: async () => refusal(409, "voice_unavailable"),
	});
	unavailable.on();
	await settle();
	unavailable.byok.speak(ENTRY(1));
	await settle();
	assert.equal(unavailable.byokMessages().at(-1).code, "voice_unavailable");
});

test("SPEAK failure: a page that could not decode a segment fails the reply - the renderer is told and main stops waiting", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.byok.speak(ENTRY(3));
	await settle();
	const { replyId } = r.played()[0].id;
	r.byok.onProgress({ kind: "failed", replyId });
	await settle();
	assert.deepEqual(
		r.byokMessages().filter((x) => x.kind === "speech_failed"),
		[{ kind: "speech_failed", sessionId: SESSION, code: "failed" }],
	);
	assert.equal(r.speechCalls().length, 1, "no segment 1 is fetched");
	// A late failure for a reply that is gone is ignored.
	r.byok.onProgress({ kind: "failed", replyId });
	assert.equal(
		r.byokMessages().filter((x) => x.kind === "speech_failed").length,
		1,
	);
});

test("SPEAK failure: another reply's failed report is ignored", async () => {
	const r = byokRig();
	r.on();
	await settle();
	r.byok.speak(ENTRY(3));
	await settle();
	r.byok.onProgress({ kind: "failed", replyId: "someone-else" });
	assert.deepEqual(
		r.byokMessages().filter((x) => x.kind === "speech_failed"),
		[],
	);
});

test("SPEAK failure mid-reply: the cut is reported, and the Speaking state is released", async () => {
	let n = 0;
	const r = byokRig({
		media: async (_request) =>
			n++ === 0 ? mp3(0) : refusal(429, "voice_rate_limited"),
	});
	r.on();
	await settle();
	r.byok.speak(ENTRY(3));
	await settle();
	const { replyId } = r.played()[0].id;
	r.byok.onProgress({ kind: "segment_start", replyId, index: 0 });
	await settle();
	assert.equal(r.byokMessages().at(-1).kind, "speech_failed");
	assert.equal(r.events().at(-1).type, "realtime.playback.cancelled");
});

/* ------------------------------------------------------------------------ */
/* QwenVoice: the byok engine through the coordinator                          */
/* ------------------------------------------------------------------------ */

function coordinator({ rig = false } = {}) {
	const toRenderer = [];
	const gateway = {
		running: false,
		starts: 0,
		async start() {
			this.starts += 1;
			this.running = true;
			return "http://127.0.0.1:3101/";
		},
		stop() {
			this.running = false;
		},
		send: () => false,
	};
	const speech = {
		running: false,
		starts: 0,
		async start() {
			this.starts += 1;
			this.running = true;
		},
		async stop() {
			this.running = false;
		},
		killNow() {},
	};
	const applied = [];
	const spoken = [];
	const providers = [];
	let speakAnswer = { spoken: true };
	const byok = {
		apply: (state) => applied.push(state),
		setProvider: (status) => providers.push(status),
		speak: (entry) => {
			spoken.push(entry);
			return speakAnswer;
		},
		stop: () => applied.push("stop"),
		retry: () => applied.push("retry"),
	};
	const voice = new m.QwenVoice({
		gateway,
		speech,
		toRenderer: (channel, payload) => {
			toRenderer.push({ channel, payload });
			return true;
		},
		page: {
			allowed: true,
			open: () => {},
			close: () => {},
			setMuted: () => {},
			prepareMicrophone: async () => "granted",
		},
		byok,
		// The Qwen rig is opt-in code the app never opts into; a case that wants
		// to prove it still never starts leaves this off, as index.ts does.
		...(rig ? { rig: true } : {}),
		now: () => 1_000_000,
	});
	void voice.setEnabled(true);
	return {
		voice,
		gateway,
		speech,
		applied,
		spoken,
		providers,
		toRenderer,
		setSpeakAnswer: (a) => {
			speakAnswer = a;
		},
		lastApply: () =>
			applied.filter((a) => a !== "stop" && a !== "retry").at(-1),
		statuses: () =>
			toRenderer
				.filter((x) => x.channel === "voice.qwen.status")
				.map((x) => x.payload),
		ready: async () => {},
	};
}
const frame = (sessionId) => ({
	type: "voice",
	payload: {
		active: sessionId ? { session_id: sessionId, enabled_at: 1 } : null,
	},
});
const statusAnswer = (sessionId, extra = {}) => [
	{ op: "voice.status" },
	{
		status: 200,
		body: {
			result: {
				active: sessionId ? { session_id: sessionId, enabled_at: 1 } : null,
				...extra,
			},
		},
	},
];
const relay = (sessionId, text, segments, kind = "message") => [
	{
		op: "voice.text",
		sessionId,
		source:
			kind === "gate"
				? { kind: "gate", requestId: "g1" }
				: { kind: "message", messageId: "m1" },
	},
	{
		status: 200,
		body: { result: { text, spoken_chars: text.length, segments } },
	},
];

test("COORDINATOR: an enable frame listens through the app's own page and starts no rig", async () => {
	const c = coordinator();
	c.voice.observeFrame(frame(SESSION));
	await settle();
	assert.deepEqual(c.lastApply(), {
		active: true,
		slot: SESSION,
		muted: false,
	});
	assert.equal(c.gateway.starts + c.speech.starts, 0);
});

test("COORDINATOR: the Qwen rig never starts - not for an enable frame, not for the renderer's start, whatever voice-setting.json once said", async () => {
	const c = coordinator();
	c.voice.observeFrame(frame(SESSION));
	await c.voice.start("renderer");
	await c.voice.start("enable");
	await settle();
	assert.equal(c.gateway.starts, 0, "no gateway");
	assert.equal(c.speech.starts, 0, "no speech models");
	assert.equal(c.gateway.running || c.speech.running, false);
	// The shipped setting module no longer reads or writes an engine at all.
	assert.equal(m.readQwenVoiceEngine, undefined);
	assert.equal(m.writeQwenVoiceEngine, undefined);
	assert.equal("engine" in c.voice.getStatus(), false);
	assert.equal(typeof c.voice.setEngine, "undefined");
});

test("COORDINATOR: a slot only LEARNED from a status read does not open the microphone; the renderer's start does", async () => {
	const c = coordinator();
	c.voice.noteDesktopAnswer(...statusAnswer(SESSION));
	assert.equal(c.lastApply()?.active ?? false, false);
	await c.voice.start("renderer");
	assert.deepEqual(c.lastApply(), {
		active: true,
		slot: SESSION,
		muted: false,
	});
	c.voice.noteDesktopAnswer(...statusAnswer(null));
	assert.equal(c.lastApply().active, false, "an empty slot closes it");
	c.voice.noteDesktopAnswer(...statusAnswer(SESSION));
	assert.equal(
		c.lastApply().active,
		false,
		"and a later learned slot does not reopen it",
	);
});

test("COORDINATOR: switching voice off ends listening", async () => {
	const c = coordinator();
	c.voice.observeFrame(frame(SESSION));
	await c.voice.setEnabled(false);
	assert.equal(c.lastApply().active, false);
	await c.voice.setEnabled(true);
	c.voice.observeFrame(frame(SESSION));
	assert.equal(c.lastApply().active, true);
});

test("COORDINATOR: a run that opted into the rig never touches the page half", async () => {
	const c = coordinator({ rig: true });
	c.voice.observeFrame(frame(SESSION));
	await settle();
	assert.deepEqual(
		c.applied.filter((a) => a !== "stop" && a.active),
		[],
	);
});

test("COORDINATOR: pause releases the microphone and keeps the strip 'ready, nobody connected'; resume listens again", async () => {
	const c = coordinator();
	c.voice.observeFrame(frame(SESSION));
	c.voice.byokReport("listening");
	assert.equal(c.voice.getStatus().rig, "ready");
	assert.equal(c.voice.getStatus().clients, 1);
	c.voice.pause();
	assert.equal(c.lastApply().active, false);
	c.voice.byokReport("idle");
	const paused = c.voice.getStatus();
	assert.equal(paused.paused, true);
	assert.equal(paused.rig, "ready");
	assert.equal(paused.clients, 0);
	c.voice.resume();
	assert.deepEqual(c.lastApply(), {
		active: true,
		slot: SESSION,
		muted: false,
	});
});

test("COORDINATOR: mute reaches the page through apply and is mirrored in the status", async () => {
	const c = coordinator();
	c.voice.observeFrame(frame(SESSION));
	c.voice.setMuted(true);
	assert.equal(c.lastApply().muted, true);
	assert.equal(c.voice.getStatus().muted, true);
});

test("STATUS: each page state is the strip's own vocabulary - listening, checking, no provider, provider not ready, mic denied, mic prompting, page failed", async () => {
	const c = coordinator();
	c.voice.observeFrame(frame(SESSION));
	c.voice.byokReport("listening");
	let s = c.voice.getStatus();
	assert.deepEqual([s.rig, s.clients, s.webui_url], ["ready", 1, null]);
	c.voice.byokReport("checking");
	s = c.voice.getStatus();
	assert.equal(s.rig, "starting", "the first answer has not arrived");
	c.voice.byokReport("provider_unset");
	s = c.voice.getStatus();
	assert.equal(s.rig, "error");
	assert.equal(s.cause, "provider_unset");
	assert.equal(s.provider ?? null, null);
	assert.match(s.reason, /provider/i);
	c.voice.byokReport("provider_not_ready", {
		provider: "elevenlabs",
		reason: "No ElevenLabs API key is stored.",
	});
	s = c.voice.getStatus();
	assert.equal(s.rig, "error");
	assert.equal(s.cause, "provider_not_ready");
	assert.equal(s.provider, "elevenlabs", "the strip links to that provider");
	assert.equal(
		s.reason,
		"No ElevenLabs API key is stored.",
		"the backend's sentence, as written",
	);
	c.voice.byokReport("mic_denied");
	s = c.voice.getStatus();
	assert.deepEqual([s.rig, s.mic], ["stopped", "denied"]);
	assert.equal(s.cause ?? null, null);
	c.voice.byokReport("mic_prompting");
	assert.equal(c.voice.getStatus().mic, "prompting");
	c.voice.byokReport("page_failed");
	s = c.voice.getStatus();
	assert.deepEqual([s.rig, s.reason], ["error", "The voice page stopped"]);
	assert.equal(
		s.cause,
		"page_failed",
		"the strip keys it; the reason is a log line",
	);
	c.voice.byokReport("idle");
	assert.deepEqual(
		[c.voice.getStatus().rig, c.voice.getStatus().mic],
		["stopped", undefined],
	);
});

test("STATUS: a not-ready provider with no sentence of its own still says so, without inventing a cause", async () => {
	const c = coordinator();
	c.voice.observeFrame(frame(SESSION));
	c.voice.byokReport("provider_not_ready", {
		provider: "radient",
		reason: null,
	});
	const s = c.voice.getStatus();
	assert.equal(s.rig, "error");
	assert.equal(s.provider, "radient");
	assert.equal(s.cause, "provider_not_ready");
	assert.equal(
		s.reason ?? null,
		null,
		"main writes no English of its own here",
	);
});

test("STATUS: no window is a keyed cause too, not only a sentence", async () => {
	const c = coordinator();
	c.voice.observeFrame(frame(SESSION));
	c.voice.byokReport("no_window");
	const s = c.voice.getStatus();
	assert.deepEqual([s.rig, s.cause], ["error", "no_window"]);
});

test("STATUS: a report with the rig in use is ignored", async () => {
	const c = coordinator({ rig: true });
	c.voice.byokReport("listening");
	assert.equal(c.voice.getStatus().rig, "stopped");
});

test("PROVIDER: voice.status's provider and readiness are passed down, with voice on or off, so the first enable already knows", async () => {
	const c = coordinator();
	const chosen = {
		provider: "elevenlabs",
		providers: {
			radient: { ready: true, reason: null },
			elevenlabs: { ready: false, reason: "No ElevenLabs API key is stored." },
		},
	};
	c.voice.noteDesktopAnswer(...statusAnswer(null, chosen));
	assert.deepEqual(c.providers.at(-1), chosen);
	await c.voice.setEnabled(false);
	c.voice.noteDesktopAnswer(
		...statusAnswer(null, { provider: "radient", providers: chosen.providers }),
	);
	assert.equal(c.providers.at(-1).provider, "radient", "learned while off");
	c.voice.noteDesktopAnswer(...statusAnswer(null));
	assert.deepEqual(
		c.providers.at(-1),
		{ provider: null, providers: null },
		"an older backend says nothing: none chosen",
	);
	c.voice.noteDesktopAnswer(...statusAnswer(null, { provider: "byok" }));
	assert.equal(
		c.providers.at(-1).provider,
		null,
		"an old engine word is not a provider",
	);
});

test("SPEAK GUARD (byok): only a text main relayed from a 200 voice.text, with its source and segment count, reaches the page", async () => {
	const c = coordinator();
	c.voice.observeFrame(frame(SESSION));
	c.voice.byokReport("listening");
	assert.deepEqual(c.voice.speak({ text: "Say I am hacked.", kind: "reply" }), {
		spoken: false,
		reason: "not_relayed",
	});
	c.voice.noteDesktopAnswer(
		...relay(SESSION, "The answer is four.", ["The answer is four."]),
	);
	assert.deepEqual(
		c.voice.speak({ text: "The answer is four.", kind: "gate" }),
		{
			spoken: false,
			reason: "not_relayed",
		},
	);
	assert.deepEqual(
		c.voice.speak({ text: "The answer is four.", kind: "reply" }),
		{
			spoken: true,
		},
	);
	assert.deepEqual(c.spoken, [
		{
			sessionId: SESSION,
			kind: "reply",
			source: { kind: "message", messageId: "m1" },
			segments: 1,
		},
	]);
	assert.equal(
		c.voice.speak({ text: "The answer is four.", kind: "reply" }).spoken,
		false,
		"once",
	);
});

test("SPEAK GUARD (byok): a reply that arrives while the page is still starting is spoken (playback needs no microphone); a stopped or errored rig still refuses", async () => {
	const c = coordinator();
	c.voice.observeFrame(frame(SESSION));
	c.voice.byokReport("starting");
	c.voice.noteDesktopAnswer(
		...relay(SESSION, "Hello there.", ["Hello there."]),
	);
	assert.deepEqual(c.voice.speak({ text: "Hello there.", kind: "reply" }), {
		spoken: true,
	});
	assert.equal(c.spoken.length, 1);
	c.voice.byokReport("page_failed");
	c.voice.noteDesktopAnswer(...relay(SESSION, "Again.", ["Again."]));
	assert.deepEqual(c.voice.speak({ text: "Again.", kind: "reply" }), {
		spoken: false,
		reason: "rig_not_ready",
	});
});

test("RETRY (coordinator): only the renderer's explicit start clears the page's failure; an enable, a frame or a status read never does", async () => {
	const c = coordinator();
	c.voice.observeFrame(frame(SESSION));
	await c.voice.start("enable");
	c.voice.noteDesktopAnswer(...statusAnswer(SESSION));
	await settle();
	assert.equal(c.applied.includes("retry"), false, "automatic callers");
	await c.voice.start("renderer");
	assert.equal(c.applied.filter((a) => a === "retry").length, 1);
	// The retry comes before the apply that acts on it.
	assert.equal(c.applied.at(-2), "retry");
	assert.equal(c.applied.at(-1).active, true);
});

test("SPEAK GUARD (byok): a gate's source is its request id; paused and a moved slot are refused", async () => {
	const c = coordinator();
	c.voice.observeFrame(frame(SESSION));
	c.voice.byokReport("listening");
	c.voice.noteDesktopAnswer(
		...relay(SESSION, "Allow it?", ["Allow it?"], "gate"),
	);
	assert.equal(c.voice.speak({ text: "Allow it?", kind: "gate" }).spoken, true);
	assert.deepEqual(c.spoken[0].source, { kind: "gate", requestId: "g1" });
	c.voice.noteDesktopAnswer(...relay(SESSION, "Later.", ["Later."]));
	c.voice.pause();
	assert.deepEqual(c.voice.speak({ text: "Later.", kind: "reply" }), {
		spoken: false,
		reason: "paused",
	});
	c.voice.resume();
	c.voice.observeFrame(frame(OTHER));
	assert.equal(
		c.voice.speak({ text: "Later.", kind: "reply" }).spoken,
		false,
		"forgotten when the slot moved",
	);
});

test("SPEAK GUARD (byok): the page's own refusal is the answer, and a text with no segments is not speakable", async () => {
	const c = coordinator();
	c.voice.observeFrame(frame(SESSION));
	c.voice.byokReport("listening");
	c.setSpeakAnswer({ spoken: false, reason: "no_client" });
	c.voice.noteDesktopAnswer(
		...relay(SESSION, "Hello there.", ["Hello there."]),
	);
	assert.deepEqual(c.voice.speak({ text: "Hello there.", kind: "reply" }), {
		spoken: false,
		reason: "no_client",
	});
	c.voice.noteDesktopAnswer(...relay(SESSION, "No segments.", []));
	c.setSpeakAnswer({ spoken: false, reason: "no_segments" });
	assert.equal(
		c.voice.speak({ text: "No segments.", kind: "reply" }).spoken,
		false,
	);
	assert.equal(c.spoken.at(-1).segments, 0);
});

/* ------------------------------------------------------------------------ */
/* The app-owned page's adapter                                                */
/* ------------------------------------------------------------------------ */

const RENDERER = "file:///Applications/App/out/renderer/index.html";
const PAGE_URL = "file:///Applications/App/out/renderer/voice-page.html";

function pageRig({ mic = "granted", ask = async () => true } = {}) {
	const created = [];
	const views = [];
	const stopped = [];
	const restarted = [];
	const installed = {};
	const sessionListens = {};
	let now = 1_000_000;
	const session = {
		setPermissionRequestHandler: (h) => {
			installed.request = h;
		},
		setPermissionCheckHandler: (h) => {
			installed.check = h;
		},
		on: (event, listener) => {
			sessionListens[event] = [...(sessionListens[event] ?? []), listener];
		},
	};
	const page = new m.ByokVoicePage({
		session,
		createView: (options) => {
			created.push(options);
			const listeners = {};
			const loaded = [];
			const sent = [];
			const webContents = {
				closed: 0,
				listeners,
				loaded,
				sent,
				loadURL: (url) => {
					loaded.push(url);
					return Promise.resolve();
				},
				close() {
					this.closed += 1;
				},
				on: (event, listener) => {
					listeners[event] = [...(listeners[event] ?? []), listener];
				},
				setWindowOpenHandler(handler) {
					this.windowOpen = handler;
				},
				setAudioMuted() {},
				send: (channel, payload) => sent.push({ channel, payload }),
			};
			views.push({ webContents });
			return { webContents };
		},
		rendererUrl: RENDERER,
		preloadPath: "/Applications/App/out/preload/voice-page.js",
		mediaAccess: { status: () => mic, ask },
		onStopped: (reason) => stopped.push(reason),
		onRestarted: () => restarted.push(true),
		now: () => now,
	});
	return {
		restarted,
		page,
		created,
		views,
		stopped,
		installed,
		sessionListens,
		advance: (ms) => {
			now += ms;
		},
	};
}

test("PAGE: it loads the app's own document, in its own in-memory partition, with the voice-page preload and nothing else", () => {
	const c = pageRig();
	c.page.open();
	c.page.open();
	assert.equal(c.created.length, 1, "idempotent");
	const prefs = c.created[0].webPreferences;
	assert.equal(prefs.preload, "/Applications/App/out/preload/voice-page.js");
	assert.equal(prefs.partition.includes("persist:"), false, "memory only");
	assert.notEqual(
		prefs.partition,
		"qwen-voice",
		"not the Gateway page's session",
	);
	assert.equal(prefs.sandbox, true);
	assert.equal(prefs.contextIsolation, true);
	assert.equal(prefs.nodeIntegration, false);
	assert.equal(prefs.backgroundThrottling, false);
	assert.equal(prefs.autoplayPolicy, "no-user-gesture-required");
	assert.equal(prefs.devTools, false);
	assert.deepEqual(c.views[0].webContents.loaded, [PAGE_URL]);
	assert.equal(c.page.isOpen, true);
	c.page.close();
	c.page.close();
	assert.equal(c.views[0].webContents.closed, 1);
	assert.equal(c.page.isOpen, false);
});

test("PAGE: the microphone is granted to its own document's main frame, audio only; everything else is refused", () => {
	const c = pageRig();
	const mine = {
		isMainFrame: true,
		requestingUrl: PAGE_URL,
		mediaTypes: ["audio"],
	};
	const ask = (permission, details) => {
		let granted;
		c.installed.request(
			{},
			permission,
			(g) => {
				granted = g;
			},
			details,
		);
		return granted;
	};
	assert.equal(ask("media", mine), true);
	assert.equal(
		ask("media", { ...mine, mediaTypes: ["audio", "video"] }),
		false,
	);
	assert.equal(ask("media", { ...mine, isMainFrame: false }), false);
	assert.equal(
		ask("media", { ...mine, requestingUrl: "https://evil.example/" }),
		false,
	);
	assert.equal(ask("geolocation", mine), false);
	assert.equal(
		c.installed.check({}, "media", PAGE_URL, {
			mediaType: "audio",
			isMainFrame: true,
			requestingUrl: PAGE_URL,
		}),
		true,
	);
	assert.equal(
		c.installed.check({}, "media", PAGE_URL, {
			mediaType: "video",
			isMainFrame: true,
			requestingUrl: PAGE_URL,
		}),
		false,
	);
});

test("PAGE: it navigates nowhere (only a reload of itself), opens nothing, downloads nothing", () => {
	const c = pageRig();
	c.page.open();
	const { listeners, windowOpen } = c.views[0].webContents;
	const nav = (event, url) => {
		let prevented = false;
		for (const l of listeners[event])
			l({
				url,
				preventDefault: () => {
					prevented = true;
				},
			});
		return prevented;
	};
	for (const event of [
		"will-navigate",
		"will-redirect",
		"will-frame-navigate",
	]) {
		assert.equal(nav(event, PAGE_URL), false, `${event}: itself`);
		assert.equal(
			nav(event, "https://evil.example/"),
			true,
			`${event}: elsewhere`,
		);
		assert.equal(nav(event, undefined), true, `${event}: fail closed`);
	}
	assert.deepEqual(windowOpen({ url: "https://x" }), { action: "deny" });
	let blocked = false;
	c.sessionListens["will-download"][0]({
		preventDefault: () => {
			blocked = true;
		},
	});
	assert.equal(blocked, true);
});

test("PAGE: only its own web contents may speak for it", () => {
	const c = pageRig();
	assert.equal(c.page.owns({}), false, "no page yet");
	c.page.open();
	assert.equal(c.page.owns(c.views[0].webContents), true);
	assert.equal(c.page.owns({}), false);
	assert.equal(c.page.owns(null), false);
	c.page.close();
	assert.equal(
		c.page.owns(c.views[0].webContents),
		false,
		"a closed page speaks for nothing",
	);
});

test("PAGE: play, stop and mute go down the preload's channels", () => {
	const c = pageRig();
	c.page.open();
	const ch = m.VOICE_PAGE_CHANNELS;
	const message = {
		id: { replyId: "r", index: 0 },
		bytes: new Uint8Array([1]),
		last: true,
	};
	c.page.play(message);
	c.page.stop();
	c.page.setMuted(true);
	assert.deepEqual(c.views[0].webContents.sent, [
		{ channel: ch.play, payload: message },
		{ channel: ch.stop, payload: undefined },
		{ channel: ch.mute, payload: true },
	]);
});

test("PAGE: nothing is sent with no page; a mute set before it exists is applied when it loads, and again on a recreate", () => {
	const c = pageRig();
	c.page.play({ id: { replyId: "r", index: 0 }, bytes: new Uint8Array(1) });
	c.page.stop();
	c.page.setMuted(true);
	assert.equal(c.views.length, 0);
	c.page.open();
	for (const l of c.views[0].webContents.listeners["did-finish-load"]) l({});
	assert.deepEqual(c.views[0].webContents.sent, [
		{ channel: m.VOICE_PAGE_CHANNELS.mute, payload: true },
	]);
	c.page.close();
	c.page.open();
	for (const l of c.views[1].webContents.listeners["did-finish-load"]) l({});
	assert.deepEqual(c.views[1].webContents.sent, [
		{ channel: m.VOICE_PAGE_CHANNELS.mute, payload: true },
	]);
});

test("PAGE: unmuted stays silent on load (nothing to re-apply)", () => {
	const c = pageRig();
	c.page.open();
	for (const l of c.views[0].webContents.listeners["did-finish-load"]) l({});
	assert.deepEqual(c.views[0].webContents.sent, []);
});

test("PAGE: a first crash recreates it; a second inside a minute stops it and says so", () => {
	const c = pageRig();
	c.page.open();
	for (const l of c.views[0].webContents.listeners["render-process-gone"])
		l({});
	assert.equal(c.views.length, 2, "recreated");
	assert.deepEqual(c.stopped, []);
	assert.equal(c.restarted.length, 1, "main is told the new page is unproven");
	c.advance(5_000);
	for (const l of c.views[1].webContents.listeners["render-process-gone"])
		l({});
	assert.equal(c.views.length, 2, "not recreated again");
	assert.deepEqual(c.stopped, ["The voice page stopped"]);
	assert.equal(c.restarted.length, 1, "a stopped page is not 'restarted'");
	assert.equal(c.page.isOpen, false);
});

test("PAGE: the microphone question is the OS's, answered the same way as the rig's page", async () => {
	for (const [status, expected] of [
		["granted", "granted"],
		["denied", "denied"],
		["restricted", "denied"],
		["weird", "unknown"],
	]) {
		const c = pageRig({ mic: status });
		assert.equal(await c.page.prepareMicrophone({ timeoutMs: 5000 }), expected);
	}
});
