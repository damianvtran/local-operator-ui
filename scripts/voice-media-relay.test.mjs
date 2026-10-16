import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { build } from "esbuild";

/*
 * SESSION VOICE'S MEDIA RELAY, main-process side (`docs/design/session-voice.md`,
 * the frozen contract). The two voice ops ride `desktop-media.ts` because they
 * carry bytes; this file drives the SHIPPED relay (`requestDesktopMediaOutcome`)
 * against a loopback that records what arrives, so the assertions are about the
 * wire the backend reads - the path, the method, the bearer, the multipart fields
 * and the JSON body - not a restatement of the code.
 *
 * What it pins:
 * - `voice.utterance` posts multipart to `/v1/desktop/voice/utterance` with
 *   exactly `session_id`, `request_id` and ONE of `file`/`text`; both or neither
 *   is refused before anything is sent.
 * - `voice.speech` posts a SOURCE REFERENCE in the route's snake_case and has no
 *   way to carry free text (V8): a `text` field is rejected by the schema.
 * - The voice routes' declared refusal codes reach the renderer as `voiceCode`,
 *   and ONLY for voice ops: the same code on another media op is dropped.
 * - Speech bytes come back with the server's own Content-Type (`audio/wav` for
 *   `say`, `audio/mpeg` for ElevenLabs), never an assumed one.
 */

const bundle = await build({
	stdin: {
		contents:
			'export { requestDesktopMediaOutcome } from "./src/main/desktop-media"; export { VOICE_REFUSAL_CODES } from "./src/shared/desktop-contract";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { requestDesktopMediaOutcome, VOICE_REFUSAL_CODES } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const SESSION = "a1b2c3d4e5f6";
const TOKEN = "synthetic-voice-relay-token";
let server;
let base;
const seen = [];
/** The next answer the loopback gives, per test. */
let answer = () => ({
	status: 200,
	type: "application/json",
	body: JSON.stringify({
		text: "hello",
		path: null,
		admission: { status: "admitted", command_id: "c1", duplicate: false },
	}),
});

before(async () => {
	server = createServer(async (req, res) => {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		const raw = Buffer.concat(chunks);
		let form = null;
		const type = req.headers["content-type"] ?? "";
		if (type.startsWith("multipart/form-data")) {
			// Parse with the platform's own reader: the same one fetch built it with
			// is the honest judge of what a server reading multipart would see.
			form = await new Response(raw, {
				headers: { "content-type": type },
			}).formData();
		}
		seen.push({
			path: req.url,
			method: req.method,
			authorization: req.headers.authorization,
			type,
			json: type.startsWith("application/json")
				? JSON.parse(raw.toString())
				: null,
			form,
		});
		const next = answer();
		res.writeHead(next.status, { "content-type": next.type });
		res.end(next.body);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const relay = (input, bytes = null) =>
	requestDesktopMediaOutcome(input, bytes, base, TOKEN);

test("a text utterance posts multipart session_id/request_id/text with the bearer", async () => {
	seen.length = 0;
	const outcome = await relay({
		op: "voice.utterance",
		sessionId: SESSION,
		requestId: "req1",
		text: "what is on my calendar",
	});
	assert.equal(outcome.answered, true);
	assert.equal(outcome.response.kind, "json");
	assert.equal(outcome.response.body.path, null);
	const [hit] = seen;
	assert.equal(hit.path, "/v1/desktop/voice/utterance");
	assert.equal(hit.method, "POST");
	assert.equal(hit.authorization, `Bearer ${TOKEN}`);
	assert.deepEqual(
		[...hit.form.keys()].sort(),
		["request_id", "session_id", "text"],
		"exactly the route's three fields, no file",
	);
	assert.equal(hit.form.get("session_id"), SESSION);
	assert.equal(hit.form.get("request_id"), "req1");
	assert.equal(hit.form.get("text"), "what is on my calendar");
});

test("an audio utterance posts the take as `file` with its own mime type", async () => {
	seen.length = 0;
	const audio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
	const outcome = await relay(
		{
			op: "voice.utterance",
			sessionId: SESSION,
			requestId: "req2",
			fileName: "utterance.webm",
			mimeType: "audio/webm;codecs=opus",
		},
		audio,
	);
	assert.equal(outcome.response.kind, "json");
	const [hit] = seen;
	assert.deepEqual([...hit.form.keys()].sort(), [
		"file",
		"request_id",
		"session_id",
	]);
	const file = hit.form.get("file");
	assert.equal(file.name, "utterance.webm");
	assert.equal(file.type, "audio/webm;codecs=opus");
	assert.deepEqual(new Uint8Array(await file.arrayBuffer()), audio);
});

test("an utterance with both audio and text, or neither, is refused unsent", async () => {
	seen.length = 0;
	const both = await relay(
		{
			op: "voice.utterance",
			sessionId: SESSION,
			requestId: "req3",
			mimeType: "audio/webm",
			text: "hi",
		},
		new Uint8Array([1, 2, 3]),
	);
	const neither = await relay({
		op: "voice.utterance",
		sessionId: SESSION,
		requestId: "req4",
	});
	const noMime = await relay(
		{ op: "voice.utterance", sessionId: SESSION, requestId: "req5" },
		new Uint8Array([1, 2, 3]),
	);
	for (const outcome of [both, neither, noMime]) {
		assert.equal(outcome.answered, false);
		assert.equal(outcome.response.status, 422);
	}
	assert.equal(seen.length, 0, "nothing reached the backend");
});

test("the schema refuses a non-audio mime type, a bad session id and extra fields", async () => {
	seen.length = 0;
	const cases = [
		{
			op: "voice.utterance",
			sessionId: SESSION,
			requestId: "r",
			mimeType: "text/html",
		},
		{
			op: "voice.utterance",
			sessionId: "../../etc",
			requestId: "r",
			text: "x",
		},
		{
			op: "voice.utterance",
			sessionId: SESSION,
			requestId: "r",
			text: "x",
			mode: "answer",
		},
	];
	for (const input of cases) {
		const outcome = await relay(input, new Uint8Array([1]));
		assert.equal(outcome.answered, false, JSON.stringify(input));
		assert.equal(outcome.response.status, 422);
	}
	assert.equal(seen.length, 0);
});

test("speech posts a source reference in the route's names, and can carry no text (V8)", async () => {
	seen.length = 0;
	answer = () => ({
		status: 200,
		type: "audio/wav",
		body: Buffer.from("RIFF0000WAVEfmt "),
	});
	const message = await relay({
		op: "voice.speech",
		sessionId: SESSION,
		source: { kind: "message", messageId: "0123456789ab" },
	});
	const gate = await relay({
		op: "voice.speech",
		sessionId: SESSION,
		source: { kind: "gate", requestId: "gate-1" },
	});
	assert.equal(message.response.kind, "bytes");
	assert.equal(message.response.mimeType, "audio/wav");
	assert.equal(gate.response.kind, "bytes");
	assert.deepEqual(seen[0].json, {
		session_id: SESSION,
		source: { kind: "message", message_id: "0123456789ab" },
	});
	assert.deepEqual(seen[1].json, {
		session_id: SESSION,
		source: { kind: "gate", request_id: "gate-1" },
	});
	assert.equal(seen[0].path, "/v1/desktop/voice/speech");
	assert.equal(seen[0].method, "POST");

	seen.length = 0;
	const withText = await relay({
		op: "voice.speech",
		sessionId: SESSION,
		source: { kind: "message", messageId: "0123456789ab" },
		text: "words the agent never wrote",
	});
	const textSource = await relay({
		op: "voice.speech",
		sessionId: SESSION,
		source: { kind: "text", text: "words the agent never wrote" },
	});
	assert.equal(withText.answered, false);
	assert.equal(textSource.answered, false);
	assert.equal(seen.length, 0, "free text never reaches the speech route");
});

test("speech keeps the server's Content-Type: mpeg from ElevenLabs is not relabelled", async () => {
	answer = () => ({
		status: 200,
		type: "audio/mpeg",
		body: Buffer.from([0xff, 0xfb, 0x90, 0x00]),
	});
	const outcome = await relay({
		op: "voice.speech",
		sessionId: SESSION,
		source: { kind: "message", messageId: "0123456789ab" },
	});
	assert.equal(outcome.response.kind, "bytes");
	assert.equal(outcome.response.mimeType, "audio/mpeg");
});

test("every voice refusal code reaches the renderer as voiceCode on voice ops only", async () => {
	const statusFor = {
		voice_not_enabled: 409,
		voice_unavailable: 409,
		voice_store_busy: 409,
		stt_unavailable: 409,
		unknown_session: 404,
		unknown_source: 404,
		invalid_voice_request: 422,
		voice_upload_too_large: 413,
		empty_transcript: 422,
	};
	assert.deepEqual(
		[...VOICE_REFUSAL_CODES].sort(),
		Object.keys(statusFor).sort(),
		"the test covers every declared code",
	);
	for (const code of VOICE_REFUSAL_CODES) {
		answer = () => ({
			status: statusFor[code],
			type: "application/json",
			body: JSON.stringify({
				detail: { code, params: {}, text: `refused: ${code}` },
			}),
		});
		const voice = await relay({
			op: "voice.utterance",
			sessionId: SESSION,
			requestId: "r",
			text: "x",
		});
		assert.equal(voice.response.kind, "error");
		assert.equal(voice.response.voiceCode, code);
		assert.equal(voice.response.detail, `refused: ${code}`);
		const other = await relay({
			op: "speech.create",
			request: { input: "x" },
		});
		assert.equal(other.response.kind, "error");
		assert.equal(
			other.response.voiceCode,
			undefined,
			`${code} is not carried for a non-voice op`,
		);
	}
	// A code outside the vocabulary is not carried, even on a voice op.
	answer = () => ({
		status: 409,
		type: "application/json",
		body: JSON.stringify({
			detail: { code: "gate_answered", text: "no" },
		}),
	});
	const stranger = await relay({
		op: "voice.utterance",
		sessionId: SESSION,
		requestId: "r",
		text: "x",
	});
	assert.equal(stranger.response.voiceCode, undefined);
});
