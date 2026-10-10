import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The waveform indicator's microphone session, through the REAL module.
 *
 * WHY THIS FILE EXISTS. The operator's report (issue #930, read from
 * `origin/main` @ bb095dca2): the indicator's own mic stream could resolve
 * AFTER the effect that asked for it had been cleaned up - Escape, a
 * push-to-talk release shorter than `MIN_DICTATION_CLIP_MS`, or a
 * conversation switch inside the `getUserMedia` window - and the old
 * resolution arm stored it in a ref nothing would ever release again. The
 * microphone stayed open for the life of the window while no recording
 * showed. The fix moves the acquisition/release ordering into
 * `audio-meter-stream.ts`, where the arrival orderings can be driven
 * directly: every test here settles the acquisition around `stop()`, which a
 * React effect test cannot do faithfully and which is exactly what the defect
 * was made of.
 *
 * WHAT THIS FILE COVERS: the session lifecycle - what leaves the seams when
 * the acquisition settles, what `stop()` releases, what a late resolution and
 * a late refusal do, and that two sessions cannot release each other's
 * stream.
 *
 * WHAT IT DELIBERATELY DOES NOT COVER: the component's canvas drawing and its
 * animation loop, and the live wiring (a real device, a real AudioContext).
 * Those live in `audio-recording-indicator.tsx` and stay covered by the app's
 * own frames; this file pins the lifecycle the defect was made of.
 *
 * The module under test is the REAL one, bundled rather than imported because
 * it is a TypeScript module in the renderer tree - the pattern
 * `audio-recording-levels.test.mjs` established.
 */

const bundle = await build({
	stdin: {
		contents: `
			export { acquireAudioMeterStream } from "./src/renderer/src/features/chat/components/audio-meter-stream";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});

const { acquireAudioMeterStream } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** Let every already-settled continuation run before asserting. */
const settleMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

const createTrack = () => ({
	stopCalls: 0,
	stop() {
		this.stopCalls += 1;
	},
});

const createStream = () => {
	const tracks = [createTrack(), createTrack()];
	return { tracks, getTracks: () => tracks };
};

const createContext = () => ({
	state: "running",
	closeCalls: 0,
	close() {
		this.closeCalls += 1;
		this.state = "closed";
		return Promise.resolve();
	},
	createAnalyser() {
		return { fftSize: 0 };
	},
	createMediaStreamSource() {
		return { connect() {} };
	},
});

/** A `getUserMedia` whose settlement the test controls. */
const deferred = () => {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

/**
 * One session under test: its seams faked, every interaction recorded.
 *
 * `createAudioContext` is overridable so a case can fail the wiring without
 * losing the recording - an override's result is still pushed into `contexts`
 * (a factory that throws pushes nothing, which is its point), and both arms
 * are what the release assertions read.
 */
const startSession = (overrides = {}) => {
	const gate = deferred();
	const contexts = [];
	const analysers = [];
	const errors = [];
	const constraintCalls = [];
	const handle = acquireAudioMeterStream({
		getUserMedia: (constraints) => {
			constraintCalls.push(constraints);
			return gate.promise;
		},
		createAudioContext: () => {
			const context = overrides.createAudioContext
				? overrides.createAudioContext()
				: createContext();
			contexts.push(context);
			return context;
		},
		onAnalyser: (analyser) => {
			analysers.push(analyser);
		},
		onError: (error) => {
			errors.push(error);
		},
	});
	return { handle, gate, contexts, analysers, errors, constraintCalls };
};

const stopCalls = (stream) => stream.tracks.map((track) => track.stopCalls);

test("a stream resolving after release is stopped on arrival, before any context exists", async () => {
	const session = startSession();
	const stream = createStream();

	/*
	 * The take ends inside the acquisition window - Escape, a short
	 * push-to-talk release, a conversation switch: the effect's cleanup runs
	 * with nothing acquired yet. The stream then arrives.
	 */
	session.handle.stop();
	session.gate.resolve(stream);
	await settleMicrotasks();

	assert.deepEqual(
		stopCalls(stream),
		[1, 1],
		`every track of a stream that arrives after release must be stopped at once - this is the microphone that used to stay open for the life of the window (issue #930), got ${JSON.stringify(stopCalls(stream))}`,
	);
	assert.equal(
		session.contexts.length,
		0,
		"a released session must not stand an AudioContext up for a stream it can no longer own",
	);
	assert.equal(
		session.analysers.length,
		0,
		"the late stream must not be wired into the meter after release",
	);
});

test("the live session hands the analyser over; release stops its tracks and closes the context", async () => {
	const session = startSession();
	const stream = createStream();
	session.gate.resolve(stream);
	await settleMicrotasks();

	assert.deepEqual(
		session.constraintCalls,
		[{ audio: true }],
		"the acquisition is the indicator's own mic request",
	);
	assert.equal(
		session.analysers.length,
		1,
		"the wired session must hand its analyser over exactly once",
	);
	assert.equal(
		session.analysers[0].fftSize,
		1024,
		"the time-domain window must keep the shipped size",
	);
	assert.deepEqual(
		stopCalls(stream),
		[0, 0],
		"nothing is stopped while the take is live",
	);
	assert.equal(session.contexts.length, 1);
	assert.equal(session.contexts[0].state, "running");

	session.handle.stop();

	assert.deepEqual(
		stopCalls(stream),
		[1, 1],
		"release stops every track the session acquired",
	);
	assert.equal(
		session.contexts[0].closeCalls,
		1,
		"release closes the session's AudioContext",
	);
	assert.equal(session.contexts[0].state, "closed");
});

test("stop() is idempotent, in both arrival orderings", async () => {
	// Released after it was live: the second stop repeats nothing.
	const live = startSession();
	const liveStream = createStream();
	live.gate.resolve(liveStream);
	await settleMicrotasks();
	live.handle.stop();
	live.handle.stop();
	assert.deepEqual(
		stopCalls(liveStream),
		[1, 1],
		"a second stop must not stop the tracks again",
	);
	assert.equal(
		live.contexts[0].closeCalls,
		1,
		"a second stop must not close the context again",
	);

	// Released while still in flight: the arriving stream is stopped once.
	const flight = startSession();
	const lateStream = createStream();
	flight.handle.stop();
	flight.handle.stop();
	flight.gate.resolve(lateStream);
	await settleMicrotasks();
	assert.deepEqual(
		stopCalls(lateStream),
		[1, 1],
		"each track is stopped exactly once, however many releases are asked for",
	);
	assert.equal(flight.contexts.length, 0);
});

test("a refusal after release is silent; a refusal while live reaches the fallback", async () => {
	const refusal = new Error("getUserMedia refused");

	const live = startSession();
	live.gate.reject(refusal);
	await settleMicrotasks();
	assert.equal(live.errors.length, 1, "a live refusal must reach the fallback");
	assert.equal(live.errors[0], refusal);

	const released = startSession();
	released.handle.stop();
	released.gate.reject(refusal);
	await settleMicrotasks();
	assert.equal(
		released.errors.length,
		0,
		"a refusal on a released session must not reach the fallback - its loop would start after the cleanup that cancels it",
	);
});

test("a session releases only the stream it acquired", async () => {
	const first = startSession();
	const second = startSession();
	const firstStream = createStream();
	const secondStream = createStream();

	first.handle.stop();
	first.gate.resolve(firstStream);
	second.gate.resolve(secondStream);
	await settleMicrotasks();

	assert.deepEqual(
		stopCalls(firstStream),
		[1, 1],
		"the released session's late stream is stopped",
	);
	assert.deepEqual(
		stopCalls(secondStream),
		[0, 0],
		"the live session's stream must not be touched by the other session's release",
	);
	assert.equal(
		second.contexts[0].state,
		"running",
		"the live session's context must not be closed by the other session's release",
	);

	second.handle.stop();
	assert.deepEqual(
		stopCalls(secondStream),
		[1, 1],
		"its own release still works",
	);
	assert.equal(second.contexts[0].closeCalls, 1);
});

test("a wiring failure while live reaches the fallback, and stop() still releases the stream", async () => {
	// The context factory itself refuses: no context exists and no analyser is
	// wired, and the acquired stream is still the session's to release.
	const factoryRefusal = new Error("AudioContext unavailable");
	const factoryFailure = startSession({
		createAudioContext: () => {
			throw factoryRefusal;
		},
	});
	const factoryStream = createStream();
	factoryFailure.gate.resolve(factoryStream);
	await settleMicrotasks();

	assert.equal(
		factoryFailure.errors[0],
		factoryRefusal,
		"a factory failure must reach the fallback rather than vanish",
	);
	assert.equal(
		factoryFailure.analysers.length,
		0,
		"nothing was wired, so no analyser may be handed over",
	);
	assert.deepEqual(
		stopCalls(factoryStream),
		[0, 0],
		"the fallback paints for a live take: nothing is stopped before release",
	);
	factoryFailure.handle.stop();
	assert.deepEqual(
		stopCalls(factoryStream),
		[1, 1],
		"stop() must still stop the acquired tracks, exactly once",
	);

	// The context exists but the source wiring refuses: the context the session
	// created must be closed by the same release that stops the stream, and not
	// a moment earlier.
	const sourceRefusal = new Error("source refused");
	const wiringFailure = startSession({
		createAudioContext: () => {
			const context = createContext();
			context.createMediaStreamSource = () => {
				throw sourceRefusal;
			};
			return context;
		},
	});
	const wiringStream = createStream();
	wiringFailure.gate.resolve(wiringStream);
	await settleMicrotasks();

	assert.equal(
		wiringFailure.errors[0],
		sourceRefusal,
		"the wiring failure must reach the fallback",
	);
	assert.equal(
		wiringFailure.contexts.length,
		1,
		"the created context is the session's - the failure must not drop it",
	);
	assert.equal(
		wiringFailure.contexts[0].state,
		"running",
		"the live session still owns its context before any release",
	);
	wiringFailure.handle.stop();
	assert.deepEqual(
		stopCalls(wiringStream),
		[1, 1],
		"stop() stops the acquired tracks exactly once",
	);
	assert.equal(
		wiringFailure.contexts[0].closeCalls,
		1,
		"stop() closes the context the failed wiring created",
	);
	assert.equal(wiringFailure.contexts[0].state, "closed");
});
