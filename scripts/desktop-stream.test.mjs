import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * The authenticated session relay's silence watchdog, and the refusal code it
 * carries.
 *
 * WHY THE WATCHDOG IS WORTH A TEST OF ITS OWN. A half-open socket after a
 * sleep/wake reports no error, no end and no data — `reader.read()` simply never
 * resolves. Without the watchdog the renderer sits on "live" while nothing can
 * reach it: no completion banner, no unseen mark, no reconnect. Nothing else in
 * the system can notice that state, because from every other surface the app
 * looks connected.
 *
 * The 45 s silence bound is derived from the backend's own 15 s heartbeat, so
 * the timings are injectable: a bound only a 45-second test can reach is a bound
 * nobody runs.
 */
const bundle = await build({
	stdin: {
		// The notice vocabulary comes along so the watchdog's own detail is
		// asserted against the shared list rather than against a copy of a string:
		// #144 moved these sentences into `desktop-stream-notice.ts` as the ONE
		// authority, and a test that hard-codes one would stop noticing when the
		// relay and the vocabulary disagree.
		contents:
			'export * from "./src/main/desktop-stream"; export { DESKTOP_STREAM_DETAIL } from "./src/shared/desktop-stream-notice";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { DesktopStreamRelay, DESKTOP_STREAM_DETAIL } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const SESSION = "123456abcdef";

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A controllable SSE body that honours the abort signal, as a real fetch does. */
function sseSource(signal) {
	let controller;
	const stream = new ReadableStream({
		start(next) {
			controller = next;
		},
	});
	signal?.addEventListener("abort", () => {
		try {
			controller.error(new Error("aborted"));
		} catch {
			// Already finished; an ordinary race in a test.
		}
	});
	const encoder = new TextEncoder();
	return {
		response: new Response(stream, { status: 200 }),
		push: (frame) => {
			controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
		},
		// Raw bytes, so a case can hand the relay framing this backend's own
		// encoder never writes: another line ending, a split read, a folded field.
		pushRaw: (text) => controller.enqueue(encoder.encode(text)),
		finish: () => controller.close(),
	};
}

test("a silent socket is reported as an error, not waited on forever", async () => {
	const original = globalThis.fetch;
	const source = { current: null };
	globalThis.fetch = async (_url, init) => {
		source.current = sseSource(init?.signal);
		return source.current.response;
	};
	// The silence bound is generous relative to the pacing below, not tight
	// against it: this file runs inside a suite of several hundred tests under a
	// concurrency cap, so a bound that only holds on an idle machine is a flaky
	// test rather than a finding.
	const relay = new DesktopStreamRelay("http://127.0.0.1:9/", "token", {
		silenceTimeoutMs: 400,
		watchdogTickMs: 30,
	});
	const events = [];
	relay.subscribe({ sessionId: SESSION }, (event) => events.push(event));
	await sleep(60);
	// One frame proves the socket is live before it goes quiet, so the test is
	// about SILENCE rather than about a connection that never worked.
	source.current.push({ type: "heartbeat", session_id: SESSION });
	await sleep(60);
	assert.equal(
		events.filter((event) => event.kind === "data").length,
		1,
		"the live frame arrived",
	);
	// Now nothing at all. The watchdog must say so, and it must end the read.
	await sleep(900);
	const errors = events.filter((event) => event.kind === "error");
	assert.equal(errors.length, 1, JSON.stringify(events));
	// The relay names silence with the vocabulary's OWN sentence for a stream that
	// ended: from the reader's side there is one distinction that matters («the
	// connection is gone»), and inventing a second string for it here is what
	// #144 removed.
	assert.equal(errors[0].detail, DESKTOP_STREAM_DETAIL.ended);
	assert.equal(
		events.at(-1).kind,
		"end",
		"the read ended, so the caller's error path can reconnect",
	);
	relay.dispose();
	globalThis.fetch = original;
});

test("an activity reset keeps a busy stream alive", async () => {
	const original = globalThis.fetch;
	const source = { current: null };
	globalThis.fetch = async (_url, init) => {
		source.current = sseSource(init?.signal);
		return source.current.response;
	};
	const relay = new DesktopStreamRelay("http://127.0.0.1:9/", "token", {
		silenceTimeoutMs: 400,
		watchdogTickMs: 30,
	});
	const events = [];
	relay.subscribe({ sessionId: SESSION }, (event) => events.push(event));
	await sleep(60);
	// ANY byte counts as activity, not only a heartbeat: a stream carrying a turn
	// is alive by definition, and a watchdog that only accepted heartbeat records
	// would tear down the busiest socket in the app.
	for (let index = 0; index < 6; index += 1) {
		source.current.push({ type: "event", session_id: SESSION, payload: {} });
		// Paced on purpose: the watchdog is the thing being watched.
		await sleep(60);
	}
	assert.deepEqual(
		events.filter((event) => event.kind === "error"),
		[],
		"a stream that keeps talking is never torn down",
	);
	relay.dispose();
	globalThis.fetch = original;
});

test("a refused stream carries the status, which is how a 404 is tellable apart", async () => {
	const original = globalThis.fetch;
	globalThis.fetch = async () => new Response(null, { status: 404 });
	const relay = new DesktopStreamRelay("http://127.0.0.1:9/", "token");
	const events = [];
	relay.subscribe({ sessionId: SESSION }, (event) => events.push(event));
	await sleep(60);
	assert.deepEqual(events, [
		{
			streamId: events[0].streamId,
			kind: "error",
			detail: DESKTOP_STREAM_DETAIL.refused(404),
			// The renderer needs this to land on the transcript's named
			// "no longer on this machine" state instead of printing transport text
			// for a conversation that simply is not there (M6).
			status: 404,
		},
	]);
	relay.dispose();
	globalThis.fetch = original;
});

test("unsubscribe is validated, so a garbage id cannot abort another stream", () => {
	const relay = new DesktopStreamRelay("http://127.0.0.1:9/", "token");
	// Nothing is bound to these, and neither may throw: the renderer's teardown
	// path runs on unmount, where an exception would take the panel down.
	relay.unsubscribe("not-a-stream-id");
	relay.unsubscribe("0".repeat(32));
	relay.dispose();
});

/*
 * THE RELAY'S FRAMING, against the wire format rather than against this
 * backend's own encoder.
 *
 * The desktop stream's records arrive as `data: {json}` terminated by a blank
 * line, and the relay used to recognise exactly one spelling of both: `\n\n` as
 * the terminator and one `data:` line as the whole record. Neither is the
 * contract. The spec allows `CRLF`, `LF` or a bare `CR` as a line ending, so a
 * proxy between this app and its backend that rewrites line endings made the
 * buffer never match — records piled up until the 8 MB cap refused the stream,
 * which reads to the user as a conversation that simply stops. And a multi-line
 * `data:` field is ONE value: a relay that emits each line as its own frame hands
 * the renderer a fragment `JSON.parse` cannot read.
 */
test("CRLF frames, split terminators and folded data fields all parse", async () => {
	const original = globalThis.fetch;
	const source = { current: null };
	globalThis.fetch = async (_url, init) => {
		source.current = sseSource(init?.signal);
		return source.current.response;
	};
	const relay = new DesktopStreamRelay("http://127.0.0.1:9/", "token");
	const events = [];
	const observed = [];
	relay.observe((sessionId, data) => observed.push({ sessionId, data }));
	relay.subscribe({ sessionId: SESSION }, (event) => events.push(event));
	await sleep(60);

	// 1. A record terminated CRLF — the spelling a line-ending-rewriting proxy
	//    produces, and the one the old parser could not see.
	source.current.pushRaw('data: {"type":"heartbeat"}\r\n\r\n');
	// 2. The same, with the terminator SPLIT across two reads: `\r` ends one
	//    chunk, `\n\r\n` starts the next.
	source.current.pushRaw('data: {"type":"event"}\r');
	source.current.pushRaw("\n\r\n");
	// 3. One record whose value is folded from TWO `data:` lines, as SSE defines
	//    the field. Joined with a newline: the two halves parse as one JSON object
	//    and neither half parses alone.
	source.current.pushRaw('data: {"type":"fold",\ndata: "n":1}\n\n');
	// 4. A record carrying `event:` and a comment beside its data: both are
	//    transport metadata with no consumer here, and the data still arrives.
	source.current.pushRaw(
		': keepalive\nevent: message\ndata: {"type":"tagged"}\n\n',
	);
	// 5. A record split in the middle of its payload, so the parser cannot lean on
	//    a record arriving whole.
	source.current.pushRaw('data: {"type":"half"');
	source.current.pushRaw("}\n\n");
	await sleep(60);

	const frames = events
		.filter((event) => event.kind === "data")
		.map((event) => JSON.parse(event.data));
	assert.deepEqual(
		frames,
		[
			{ type: "heartbeat" },
			{ type: "event" },
			{ type: "fold", n: 1 },
			{ type: "tagged" },
			{ type: "half" },
		],
		"every record arrives once, whole, in order",
	);
	assert.deepEqual(
		observed.map((entry) => entry.sessionId),
		Array(5).fill(SESSION),
		"and main's own observer sees the same records the renderer does",
	);
	assert.deepEqual(
		observed.map((entry) => JSON.parse(entry.data)),
		frames,
		"the observer is handed the folded payload, not one fragment per line",
	);
	relay.dispose();
	globalThis.fetch = original;
});
