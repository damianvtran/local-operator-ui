import assert from "node:assert/strict";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * SESSION VOICE'S SPEAK-TRIGGER RULE (`docs/design/session-voice.md`, the frozen
 * contract's turn-trigger bullets), driven through the SHIPPED fold
 * (`features/voice/voice-turns.ts`) frame by frame, plus V7's hard rule read off
 * the voice source itself.
 *
 * The rule: speak the last assistant `message_end` before `agent_end`, for a turn
 * this window sent words to, once per message id across reconnect replays; and
 * announce an approval once per gate, never an ask. V7: nothing in the voice
 * feature can answer a gate.
 */

const bundle = await build({
	stdin: {
		contents: 'export * from "./src/renderer/src/features/voice/voice-turns";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	initialVoiceTurns,
	stepVoiceTurns,
	gateOfFrame,
	streamingOfFrame,
	VOICE_DEDUPE_LIMIT,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const event = (payload) => ({ kind: "event", event: payload });
const start = event({ type: "agent_start" });
const end = event({ type: "agent_end" });
const said = (id, text = "Here is the answer.") =>
	event({
		type: "message_end",
		message: { id, role: "assistant", content: [{ type: "text", text }] },
	});
const toolOnly = (id) =>
	event({
		type: "message_end",
		message: {
			id,
			role: "assistant",
			content: [],
			tool_calls: [{ id: "t1", name: "bash" }],
		},
	});

/** Fold inputs from `state`, returning the end state and every speak request. */
function run(inputs, from = initialVoiceTurns()) {
	let state = from;
	const spoken = [];
	for (const input of inputs) {
		const step = stepVoiceTurns(state, input);
		state = step.state;
		spoken.push(...step.speak);
	}
	return { state, spoken };
}

test("a turn this window sent words to speaks its LAST text message, once", () => {
	const { spoken } = run([
		{ kind: "armed" },
		start,
		said("m1", "Let me check."),
		toolOnly("m2"),
		said("m3", "Your calendar is clear."),
		end,
	]);
	assert.deepEqual(spoken, [{ kind: "message", messageId: "m3" }]);
});

test("a tool-call-only final message does not displace the last text one", () => {
	const { spoken } = run([
		{ kind: "armed" },
		start,
		said("m1"),
		toolOnly("m2"),
		end,
	]);
	assert.deepEqual(spoken, [{ kind: "message", messageId: "m1" }]);
});

test("a turn nobody spoke into (typed, or a wake) is not spoken", () => {
	const { spoken } = run([start, said("m1"), end]);
	assert.deepEqual(spoken, []);
});

test("a fast turn that ends before the upload answers is still spoken (armed at send)", () => {
	// The mock provider can finish the turn before the route's 200 arrives here.
	const { spoken } = run([{ kind: "armed" }, start, said("m1"), end]);
	assert.deepEqual(spoken, [{ kind: "message", messageId: "m1" }]);
});

test("words sent into a running turn (a steer) are answered by that turn", () => {
	const { spoken } = run([
		{ kind: "streaming", streaming: true },
		{ kind: "armed" },
		said("m1", "Adjusting as you asked."),
		end,
	]);
	assert.deepEqual(spoken, [{ kind: "message", messageId: "m1" }]);
});

test("a replayed end of a turn that finished BEFORE the send is not the answer", () => {
	// Previous turn completed, then words sent; a stale agent_end must not speak m0.
	const { state } = run([start, said("m0"), end]);
	const after = run([{ kind: "armed" }, said("m0"), end], state);
	assert.deepEqual(after.spoken, []);
	assert.equal(after.state.armed, 1, "still waiting for its own turn");
	const answered = run([start, said("m1"), end], after.state);
	assert.deepEqual(answered.spoken, [{ kind: "message", messageId: "m1" }]);
});

test("reconnect replay: the same message_end/agent_end twice speaks once", () => {
	const first = run([{ kind: "armed" }, start, said("m1"), end]);
	assert.equal(first.spoken.length, 1);
	// The stream reconnects from an older cursor and re-sends the turn's tail,
	// and the operator has already sent the next utterance.
	const replay = run([{ kind: "armed" }, start, said("m1"), end], first.state);
	assert.deepEqual(replay.spoken, [], "m1 was already spoken");
});

test("a failed send disarms: the next unrelated turn is not spoken", () => {
	const { spoken } = run([
		{ kind: "armed" },
		{ kind: "disarmed" },
		start,
		said("m1"),
		end,
	]);
	assert.deepEqual(spoken, []);
});

test("two takes in one turn are one answer", () => {
	const { spoken, state } = run([
		{ kind: "armed" },
		start,
		{ kind: "armed" },
		said("m1"),
		end,
	]);
	assert.deepEqual(spoken, [{ kind: "message", messageId: "m1" }]);
	assert.equal(state.armed, 0);
});

test("an approval is announced once per gate; an ask and a cleared gate are not", () => {
	const approval = { request_id: "g1", kind: "approval" };
	const { spoken } = run([
		{ kind: "armed" },
		start,
		{ kind: "gate", gate: approval },
		{ kind: "gate", gate: approval },
		{ kind: "gate", gate: null },
		{ kind: "gate", gate: { request_id: "a1", kind: "ask" } },
		{ kind: "gate", gate: { request_id: "g2", kind: "approval" } },
	]);
	assert.deepEqual(spoken, [
		{ kind: "gate", requestId: "g1" },
		{ kind: "gate", requestId: "g2" },
	]);
});

test("U2: only a window with an armed take announces; others record the gate silently", () => {
	const approval = { request_id: "g1", kind: "approval" };
	// A second window on the same slot: nothing armed, so nothing said.
	const other = run([start, { kind: "gate", gate: approval }]);
	assert.deepEqual(other.spoken, []);
	assert.equal(other.state.pendingApproval, "g1");
	// A take armed AFTER the gate was already on screen does not announce it.
	const late = run(
		[{ kind: "armed" }, { kind: "gate", gate: approval }],
		other.state,
	);
	assert.deepEqual(late.spoken, []);
});

test("the pending approval follows the gate frames (for the approval_pending pre-check)", () => {
	const { state } = run([
		{ kind: "gate", gate: { request_id: "g1", kind: "approval" } },
	]);
	assert.equal(state.pendingApproval, "g1");
	assert.equal(
		run([{ kind: "gate", gate: null }], state).state.pendingApproval,
		null,
	);
	assert.equal(
		run([{ kind: "gate", gate: { request_id: "a1", kind: "ask" } }], state)
			.state.pendingApproval,
		null,
		"an ask is not an approval",
	);
});

const CARD_PRECHECK = /if \(voiceCardPending\(sessionId\)\) \{/;

test("R3-m2: ANY parked card - an approval or a blocking ask - is a pending card (the V13 pre-check)", () => {
	const ask = run([{ kind: "gate", gate: { request_id: "a1", kind: "ask" } }]);
	assert.equal(
		ask.state.pendingCard,
		"a1",
		"a blocking ask blocks words, as V13 does",
	);
	assert.equal(
		ask.state.pendingApproval,
		null,
		"but is not announced as an approval",
	);
	assert.deepEqual(
		run([
			{ kind: "armed" },
			{ kind: "gate", gate: { request_id: "a1", kind: "ask" } },
		]).spoken,
		[],
	);
	const approval = run([
		{ kind: "gate", gate: { request_id: "g1", kind: "approval" } },
	]);
	assert.equal(approval.state.pendingCard, "g1");
	assert.equal(
		run([{ kind: "gate", gate: null }], ask.state).state.pendingCard,
		null,
	);
	assert.equal(
		run([{ kind: "stopped" }], approval.state).state.pendingCard,
		null,
	);
	const controller = readFileSync(
		"src/renderer/src/features/voice/voice-controller.tsx",
		"utf8",
	);
	assert.match(
		controller,
		CARD_PRECHECK,
		"push-to-talk reads the card, not only approvals",
	);
});

test("U3: an interrupted turn is not spoken, and the take is consumed", () => {
	for (const ending of [
		{ type: "agent_end", aborted: true },
		{ type: "agent_end", error: "provider failed" },
		{ type: "agent_end", cut_off_cause: "restart" },
	]) {
		const { spoken, state } = run([
			{ kind: "armed" },
			start,
			said("m1", "Partial answer"),
			event(ending),
		]);
		assert.deepEqual(spoken, [], JSON.stringify(ending));
		assert.equal(state.armed, 0, "the take does not carry to the next turn");
		// The next typed turn is still silent.
		assert.deepEqual(run([start, said("m2"), end], state).spoken, []);
	}
	// A message that itself stopped short is not the answer either.
	const cut = event({
		type: "message_end",
		message: {
			id: "m9",
			role: "assistant",
			stop_reason: "aborted",
			content: [{ type: "text", text: "Half a sen" }],
		},
	});
	assert.deepEqual(run([{ kind: "armed" }, start, cut, end]).spoken, []);
});

const KEEPS_DEDUPE = /spoken: state\.spoken,\s*announced: state\.announced/;
const DROPS_TURNS = /turns = null/;

test("U4: the dedupe sets survive the slot leaving and returning (A -> B -> A)", () => {
	const approval = { request_id: "g1", kind: "approval" };
	const first = run([
		{ kind: "armed" },
		start,
		{ kind: "gate", gate: approval },
	]);
	assert.deepEqual(first.spoken, [{ kind: "gate", requestId: "g1" }]);
	// The controller's resetTurnFlight: in-flight state dropped, dedupe kept.
	const back = {
		...initialVoiceTurns(),
		spoken: first.state.spoken,
		announced: first.state.announced,
	};
	// Returning to A re-reads the snapshot, which still names the pending gate.
	const again = run(
		[{ kind: "armed" }, { kind: "gate", gate: approval }],
		back,
	);
	assert.deepEqual(again.spoken, [], "the same gate is not announced twice");
	const controller = readFileSync(
		"src/renderer/src/features/voice/voice-controller.tsx",
		"utf8",
	);
	assert.match(controller, KEEPS_DEDUPE);
	assert.doesNotMatch(
		controller,
		DROPS_TURNS,
		"the slot leaving no longer drops the sets",
	);
});

test("the dedupe sets are bounded", () => {
	let state = initialVoiceTurns();
	for (let i = 0; i < VOICE_DEDUPE_LIMIT + 10; i += 1) {
		state = run([{ kind: "armed" }, start, said(`m${i}`), end], state).state;
	}
	assert.equal(state.spoken.length, VOICE_DEDUPE_LIMIT);
	assert.equal(state.spoken[0], "m10");
});

test("gate and streaming are read off snapshot, update and replace frames", () => {
	const gate = { request_id: "g1", kind: "approval" };
	assert.deepEqual(
		gateOfFrame({
			type: "snapshot",
			payload: {
				frontend: { snapshot: { pending_gate: gate, streaming: true } },
			},
		}),
		gate,
	);
	assert.equal(
		gateOfFrame({
			type: "frontend.update",
			payload: { changes: { pending_gate: null } },
		}),
		null,
		"null is a real answer: the gate cleared",
	);
	assert.equal(
		gateOfFrame({
			type: "frontend.update",
			payload: { changes: { streaming: true } },
		}),
		undefined,
		"an update that does not mention the gate says nothing about it",
	);
	assert.equal(
		streamingOfFrame({
			type: "frontend.replace",
			payload: { frontend: { snapshot: { streaming: false } } },
		}),
		false,
	);
	assert.equal(
		gateOfFrame({ type: "event", payload: { type: "agent_end" } }),
		undefined,
	);
});

/*
 * V7, READ OFF THE SOURCE: nothing in the voice feature, nor the driver verb that
 * drives it, names a route or op that answers a gate. Comments are stripped first
 * so the prose explaining the rule cannot satisfy or break it.
 */
const ANSWERING = [
	/answer_gate/,
	/approvals\.(approve|deny)/,
	/sessions\.answer/,
	/answerGate/,
	/\/answers\b/,
	/\/approve\b/,
	/ask-answer/,
];
const OP_LITERAL = /op: "([a-z_.]+)"/g;
const CALLS_SEND = /sendVoiceUtterance/;
const stripComments = (source) =>
	source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("V7: no voice code path can answer a gate", () => {
	const dir = "src/renderer/src/features/voice";
	const files = readdirSync(dir).map((name) => `${dir}/${name}`);
	assert.ok(files.length >= 6, "the feature folder is where the brief put it");
	for (const file of files) {
		const code = stripComments(readFileSync(file, "utf8"));
		for (const pattern of ANSWERING) {
			assert.doesNotMatch(code, pattern, `${file} reaches ${pattern}`);
		}
	}
	const driver = readFileSync("src/renderer/src/dev-driver/install.ts", "utf8");
	const verb = driver.slice(driver.indexOf("voiceUtterance: async"));
	const body = stripComments(verb.slice(0, verb.indexOf("\n\t\t},") + 4));
	assert.match(body, CALLS_SEND, "the verb takes the hold's own path");
	for (const pattern of ANSWERING) {
		assert.doesNotMatch(body, pattern, `voiceUtterance reaches ${pattern}`);
	}
	// The media ops voice can send are exactly the two that cannot answer.
	const ops = new Set();
	for (const file of files) {
		for (const match of readFileSync(file, "utf8").matchAll(OP_LITERAL))
			ops.add(match[1]);
	}
	assert.deepEqual([...ops].sort(), [
		"voice.control",
		"voice.speech",
		"voice.status",
		"voice.utterance",
	]);
});

/*
 * U5: THE SLOT HOLDER'S STREAM WATCHER RETRIES WITH BACKOFF, BOUNDED, AND STOPS
 * ON A GONE SESSION. Driven through the shipped `voice-stream.ts` with its
 * transport and timers injected, so the retry ladder is observed, not assumed.
 */
const streamBundle = await build({
	stdin: {
		contents:
			'export { subscribeVoiceStream, VOICE_STREAM_MAX_ATTEMPTS } from "./src/renderer/src/features/voice/voice-stream";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	external: ["electron"],
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@renderer": `${process.cwd()}/src/renderer/src`,
	},
	loader: { ".css": "empty" },
	jsx: "automatic",
	packages: "external",
	write: false,
});
const streamPath = new URL(
	`./_voice-stream-${process.pid}.mjs`,
	import.meta.url,
);
writeFileSync(streamPath, streamBundle.outputFiles[0].text);
after(() => rmSync(streamPath, { force: true }));

async function streamRig(answers) {
	const { subscribeVoiceStream, VOICE_STREAM_MAX_ATTEMPTS } = await import(
		streamPath.href
	);
	const opened = [];
	const delays = [];
	const timers = [];
	const stops = [];
	const inputs = [];
	const deps = {
		subscribe: (args, onEvent) => {
			opened.push(args);
			// One answer, or a sequence (a frame, then the connection dropping).
			const next = [answers(opened.length)].flat();
			queueMicrotask(() => {
				for (const event of next) onEvent(event);
			});
			/*
			 * Teardown emits an `end`, as the dev transport's dispose does
			 * (`subscribeDesktopStream`): the watcher must not read its own
			 * teardown as the bridge closing the stream (N1).
			 */
			return () => onEvent({ kind: "end" });
		},
		delayMs: (attempt) => attempt * 100,
		schedule: (run, ms) => {
			delays.push(ms);
			timers.push(run);
			return timers.length;
		},
		cancel: () => undefined,
	};
	const handle = subscribeVoiceStream(
		"a1a1a1a1a1a1",
		(input) => inputs.push(input),
		(reason) => stops.push(reason),
		deps,
	);
	const drain = async () => {
		for (let i = 0; i < 20; i += 1) {
			await new Promise((resolve) => setImmediate(resolve));
			const run = timers.shift();
			if (run) run();
		}
	};
	return {
		opened,
		delays,
		stops,
		inputs,
		dispose: () => handle.dispose(),
		retry: () => handle.retry(),
		drain,
		VOICE_STREAM_MAX_ATTEMPTS,
	};
}

test("U5: a failing stream backs off on a bounded ladder, then stops as exhausted", async () => {
	const rig = await streamRig(() => ({ kind: "error", status: 503 }));
	await rig.drain();
	assert.equal(rig.opened.length, rig.VOICE_STREAM_MAX_ATTEMPTS);
	assert.deepEqual(
		rig.delays,
		Array.from(
			{ length: rig.VOICE_STREAM_MAX_ATTEMPTS - 1 },
			(_, i) => (i + 1) * 100,
		),
		"each retry waits the ladder's next step",
	);
	assert.deepEqual(rig.stops, ["exhausted"]);
	rig.dispose();
});

test("U5: a 404 (unknown_session) stops at once, with no retry", async () => {
	const rig = await streamRig(() => ({ kind: "error", status: 404 }));
	await rig.drain();
	assert.equal(rig.opened.length, 1);
	assert.deepEqual(rig.delays, []);
	assert.deepEqual(rig.stops, ["gone"]);
	rig.dispose();
});

test("U5: a frame resets the failure count, and the retry resumes from the cursor", async () => {
	const frame = JSON.stringify({
		type: "event",
		epoch: "e1",
		seq: 7,
		payload: { type: "agent_start" },
	});
	const rig = await streamRig((n) =>
		n === 2
			? [
					{ kind: "data", data: frame },
					{ kind: "error", status: 503 },
				]
			: { kind: "error", status: 503 },
	);
	await rig.drain();
	// 1 failure, a frame (count reset to 0), then a full fresh ladder: 1 + 6.
	assert.equal(rig.opened.length, 1 + rig.VOICE_STREAM_MAX_ATTEMPTS);
	assert.deepEqual(rig.stops, ["exhausted"]);
	assert.deepEqual(rig.opened[2], {
		sessionId: "a1a1a1a1a1a1",
		epoch: "e1",
		afterSeq: 7,
	});
	assert.equal(rig.inputs.filter((i) => i.kind === "event").length, 1);
	assert.equal(rig.inputs.at(-1).kind, "stopped", "giving up folds `stopped`");
	rig.dispose();
});

test("N1: an unrequested end is a failure: retried on the ladder, then exhausted", async () => {
	const rig = await streamRig(() => ({ kind: "end" }));
	await rig.drain();
	assert.equal(rig.opened.length, rig.VOICE_STREAM_MAX_ATTEMPTS);
	assert.deepEqual(rig.stops, ["exhausted"]);
	rig.dispose();
});

test("N1: the end its own teardown provokes is ignored (no retry, no stop)", async () => {
	const live = JSON.stringify({
		type: "event",
		epoch: "e1",
		seq: 1,
		payload: { type: "agent_start" },
	});
	const rig = await streamRig(() => ({ kind: "data", data: live }));
	await rig.drain();
	rig.dispose();
	await rig.drain();
	assert.equal(rig.opened.length, 1, "dispose's own end did not reopen");
	assert.deepEqual(rig.delays, []);
	assert.deepEqual(rig.stops, []);
});

test("N1: retry() after exhausted starts a fresh ladder; it is a no-op while live or gone", async () => {
	const rig = await streamRig(() => ({ kind: "error", status: 503 }));
	await rig.drain();
	assert.deepEqual(rig.stops, ["exhausted"]);
	const before = rig.opened.length;
	rig.retry();
	await rig.drain();
	assert.equal(
		rig.opened.length,
		before + rig.VOICE_STREAM_MAX_ATTEMPTS,
		"a whole new ladder",
	);
	assert.deepEqual(rig.stops, ["exhausted", "exhausted"]);
	rig.dispose();
	rig.retry();
	await rig.drain();
	assert.equal(
		rig.opened.length,
		before + rig.VOICE_STREAM_MAX_ATTEMPTS,
		"no retry after dispose",
	);

	const gone = await streamRig(() => ({ kind: "error", status: 404 }));
	await gone.drain();
	gone.retry();
	await gone.drain();
	assert.equal(gone.opened.length, 1, "a gone session is not retried");
});

test("N1: every stop folds `stopped`, which clears the pending approval and the streaming flag", async () => {
	const parked = JSON.stringify({
		type: "frontend.update",
		epoch: "e1",
		seq: 3,
		payload: {
			epoch: "e1",
			sequence: 3,
			changes: {
				streaming: true,
				pending_gate: { request_id: "g1", kind: "approval" },
			},
		},
	});
	for (const [label, answer, end] of [
		[
			"exhausted",
			(n) =>
				n === 1
					? [
							{ kind: "data", data: parked },
							{ kind: "error", status: 503 },
						]
					: { kind: "error", status: 503 },
			null,
		],
		[
			"gone",
			(n) =>
				n === 1
					? [
							{ kind: "data", data: parked },
							{ kind: "error", status: 404 },
						]
					: null,
			null,
		],
		["disposed", () => ({ kind: "data", data: parked }), "dispose"],
	]) {
		const rig = await streamRig(answer);
		await rig.drain();
		if (end === "dispose") rig.dispose();
		let state = initialVoiceTurns();
		for (const input of rig.inputs) state = stepVoiceTurns(state, input).state;
		assert.equal(rig.inputs.at(-1).kind, "stopped", label);
		assert.equal(state.pendingApproval, null, `${label}: no stale gate`);
		assert.equal(state.pendingCard, null, `${label}: no stale card`);
		assert.equal(state.inFlight, false, `${label}: no stale turn`);
		rig.dispose();
	}
});

/*
 * Q4, WITH REAL-SHAPED FRAMES. Measured on the backend at 5c3cdc102: the
 * subscription's `open` and the `snapshot` after it carry the SAME (epoch, seq),
 * here 292. The snapshot names a card that was parked before the slot arrived.
 */
const OPEN_292 = JSON.stringify({
	session_id: "a1a1a1a1a1a1",
	epoch: "ep-7",
	seq: 292,
	type: "open",
	payload: { subscription_id: "0123456789abcdef0123456789abcdef", gap: true },
});
const SNAPSHOT_292 = JSON.stringify({
	session_id: "a1a1a1a1a1a1",
	epoch: "ep-7",
	seq: 292,
	type: "snapshot",
	payload: {
		frontend: {
			snapshot: {
				streaming: true,
				pending_gate: {
					request_id: "gate-parked",
					kind: "approval",
					title: "Run bash",
				},
			},
		},
		history: {},
		cold: false,
	},
});

test("Q4: a snapshot sharing the open's seq is folded as state - gate pending, turn streaming, nothing spoken", async () => {
	const rig = await streamRig(() => [
		{ kind: "data", data: OPEN_292 },
		{ kind: "data", data: SNAPSHOT_292 },
	]);
	await rig.drain();
	let state = initialVoiceTurns();
	const spoken = [];
	for (const input of rig.inputs) {
		const step = stepVoiceTurns(state, input);
		state = step.state;
		spoken.push(...step.speak);
	}
	assert.equal(
		state.pendingApproval,
		"gate-parked",
		"the parked card is known",
	);
	assert.equal(
		state.inFlight,
		true,
		"the subscribe-time streaming flag came through",
	);
	assert.deepEqual(spoken, [], "a snapshot is never spoken");
	// Even with a take armed, a snapshot's gate is state, not news.
	const armed = stepVoiceTurns(
		stepVoiceTurns(initialVoiceTurns(), { kind: "armed" }).state,
		rig.inputs.find((i) => i.kind === "gate"),
	);
	assert.deepEqual(armed.speak, []);
	rig.dispose();
});

/*
 * R3-M1: THE SERVER'S REAL RESUME ORDER (`desktop_sessions.py`'s stream
 * generator): `open` stamped with the cutoff, THEN the replayed frames
 * (after_seq < seq <= cutoff), THEN `snapshot@cutoff`. A cursor that moved on
 * `open` dropped the whole replay: the spoken turn's answer was lost, the take
 * stayed armed, and the next - typed - turn was read aloud instead.
 */
const frame = (seq, type, payload) =>
	JSON.stringify({
		session_id: "a1a1a1a1a1a1",
		epoch: "ep-9",
		seq,
		type,
		payload,
	});
const evt = (seq, payload) => ({
	kind: "data",
	data: frame(seq, "event", payload),
});

test("R3-M1: a resume replays the spoken turn's answer once; a later typed turn is not spoken", async () => {
	const rig = await streamRig((n) =>
		n === 1
			? [evt(7, { type: "agent_start" }), { kind: "error", status: 503 }]
			: [
					{
						kind: "data",
						data: frame(10, "open", {
							subscription_id: "0123456789abcdef0123456789abcdef",
							gap: false,
						}),
					},
					evt(8, {
						type: "message_end",
						message: {
							id: "m-answer",
							role: "assistant",
							content: [{ type: "text", text: "Your calendar is clear." }],
						},
					}),
					evt(9, { type: "agent_end" }),
					{
						kind: "data",
						data: frame(10, "snapshot", {
							frontend: { snapshot: { pending_gate: null, streaming: false } },
							history: {},
							cold: false,
						}),
					},
					// Live, after the resume: a TYPED turn.
					evt(11, { type: "agent_start" }),
					evt(12, {
						type: "message_end",
						message: {
							id: "m-typed",
							role: "assistant",
							content: [{ type: "text", text: "Typed reply." }],
						},
					}),
					evt(13, { type: "agent_end" }),
				],
	);
	// The take was armed before the turn started (the controller arms at send).
	let state = stepVoiceTurns(initialVoiceTurns(), { kind: "armed" }).state;
	await rig.drain();
	assert.deepEqual(
		rig.opened[1],
		{ sessionId: "a1a1a1a1a1a1", epoch: "ep-9", afterSeq: 7 },
		"resumed from the last folded frame",
	);
	const spoken = [];
	for (const input of rig.inputs) {
		const step = stepVoiceTurns(state, input);
		state = step.state;
		spoken.push(...step.speak);
	}
	assert.deepEqual(
		spoken,
		[{ kind: "message", messageId: "m-answer" }],
		"the answer, once; never the typed reply",
	);
	assert.equal(
		rig.inputs.filter((i) => i.kind === "event").length,
		6,
		"agent_start@7, the 2 replayed, the 3 live",
	);
	rig.dispose();
});

test("R3-M1: a true duplicate (at or below the client's own after_seq) is still dropped", async () => {
	const rig = await streamRig((n) =>
		n === 1
			? [evt(7, { type: "agent_start" }), { kind: "error", status: 503 }]
			: [
					{
						kind: "data",
						data: frame(10, "open", {
							subscription_id: "0123456789abcdef0123456789abcdef",
							gap: false,
						}),
					},
					// A server that re-sends what the client already holds.
					evt(6, { type: "agent_end" }),
					evt(7, { type: "agent_start" }),
					evt(8, { type: "agent_end" }),
				],
	);
	await rig.drain();
	const events = rig.inputs
		.filter((i) => i.kind === "event")
		.map((i) => i.event.type);
	assert.deepEqual(
		events,
		["agent_start", "agent_end"],
		"6 and 7 dropped, 8 folded",
	);
	rig.dispose();
});

test("R3-m1: the first frame after a retry reports recovered, once", async () => {
	const live = frame(20, "event", { type: "agent_start" });
	let healthy = false;
	const rig = await streamRig(() =>
		healthy
			? [
					{ kind: "data", data: live },
					{ kind: "data", data: live },
				]
			: { kind: "error", status: 503 },
	);
	await rig.drain();
	assert.deepEqual(rig.stops, ["exhausted"]);
	healthy = true;
	rig.retry();
	await rig.drain();
	assert.deepEqual(
		rig.stops,
		["exhausted", "recovered"],
		"one recovered, on the first frame",
	);
	rig.dispose();
	// A first connection that was never exhausted reports nothing.
	const fresh = await streamRig(() => ({ kind: "data", data: live }));
	await fresh.drain();
	assert.deepEqual(fresh.stops, []);
	fresh.dispose();
});

test("R3-m1: the controller dismisses the lost notice on recovered", () => {
	const controller = stripComments(
		readFileSync(
			"src/renderer/src/features/voice/voice-controller.tsx",
			"utf8",
		),
	);
	assert.match(controller, DISMISS_ON_RECOVERED);
	assert.match(controller, RECONNECT_ACTION);
});

const DISMISS_ON_RECOVERED =
	/status === "recovered"\) \{\s*dismissToast\(lostToastId\);/;
const RECONNECT_ACTION =
	/id: lostToastId,[\s\S]*?onClick: \(\) => handle\.retry\(\)/;
const APPROVAL_TOAST = /showApprovalToast\(/g;
const SHARED_ID_TOAST =
	/showWarningToast\(message, \{ id: voiceApprovalToastId\(sessionId\) \}\)/;
const RAW_APPROVAL_TOAST =
	/show(Info|Warning|Error)Toast\(\s*t\("ui\.chat\.voice\.(card_pending|approval_waiting)"\)/;
const PENDING_REFUSAL_ROUTED =
	/voiceCode === "approval_pending"\) \{[^}]*showApprovalToast\(sessionId, sentence\)/;

test("D8: the gate announcement and every refused take share one per-session warning toast", () => {
	const controller = stripComments(
		readFileSync(
			"src/renderer/src/features/voice/voice-controller.tsx",
			"utf8",
		),
	);
	const helper = controller.slice(
		controller.indexOf("function showApprovalToast"),
	);
	assert.match(helper.slice(0, helper.indexOf("\n}")), SHARED_ID_TOAST);
	// The announcement, the pre-check and the server's refusal all route through it.
	// Its declaration plus three call sites.
	assert.equal([...controller.matchAll(APPROVAL_TOAST)].length, 4);
	assert.doesNotMatch(
		controller,
		RAW_APPROVAL_TOAST,
		"no approval sentence bypasses the shared id",
	);
	assert.match(
		controller,
		PENDING_REFUSAL_ROUTED,
		"the server's refusal uses the shared id",
	);
});
