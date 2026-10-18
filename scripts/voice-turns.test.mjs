import assert from "node:assert/strict";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * RETRY IS WITHHELD UNLESS THE RIG IS IN ERROR. This used to read the header
 * indicator's ternary; the header's phase word moved into the composer's strip
 * (design spec `voice-composer/SPEC.md`), where the same rule is expressed as
 * the two branches' actions: the exchange-error branch offers none, and the rig
 * error offers "Try again". Pinned here as both halves, so the rule cannot be
 * lost by moving a sentence.
 */
const ERROR_CASE = /case "error":/;
const RETRY_ONLY_FOR_THE_RIG =
	/action: state\.rig\?\.rig === "error" \? "try_again" : null,/;
const RIG_REASON_SHOWN = /const reason = rig\.reason\?\.trim\(\);/;

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
	VOICE_TAKE_ROW_TTL_MS,
	gateOfFrame,
	streamingOfFrame,
	VOICE_DEDUPE_LIMIT,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const event = (payload) => ({ kind: "event", event: payload });
/*
 * A take is keyed by its request_id, and bound by the user message_start the
 * server mints with message.id == that request_id (design V14).
 */
const arm = (id = "take-1") => ({ kind: "armed", requestId: id });
const spoke = (id = "take-1") =>
	event({
		type: "message_start",
		message: { id, role: "user", content: [{ type: "text", text: "Hi." }] },
	});
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
		arm(),
		spoke(),
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
		arm(),
		spoke(),
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
	const { spoken } = run([arm(), spoke(), start, said("m1"), end]);
	assert.deepEqual(spoken, [{ kind: "message", messageId: "m1" }]);
});

test("words sent into a running turn (a steer) are answered by that turn, from its own message on", () => {
	const { spoken } = run([
		{ kind: "streaming", streaming: true },
		start,
		arm(),
		said("m0", "Working on the earlier request."),
		// The steer drains at the next tool boundary: its own message lands here.
		event({ type: "steering_delivered" }),
		spoke(),
		said("m1", "Adjusting as you asked."),
		end,
	]);
	assert.deepEqual(spoken, [{ kind: "message", messageId: "m1" }]);
});

test("R5-M1: a turn already running when the take went out does not bind it", () => {
	// Typed turn running, take armed, typed turn ends WITHOUT the take's message.
	const { spoken, state } = run([
		start,
		arm(),
		said("m-typed", "Typed reply."),
		end,
	]);
	assert.deepEqual(spoken, [], "the running turn never carried the words");
	assert.deepEqual(state.takes, ["take-1"], "the take still waits for its own");
	const answered = run([spoke(), start, said("m-take"), end], state);
	assert.deepEqual(answered.spoken, [{ kind: "message", messageId: "m-take" }]);
});

test("R5-M1: several takes each bind only to their own message", () => {
	const { spoken, state } = run([
		arm("take-a"),
		arm("take-b"),
		// take-b is admitted first (its upload's STT was faster).
		spoke("take-b"),
		start,
		said("m-b"),
		end,
	]);
	assert.deepEqual(spoken, [{ kind: "message", messageId: "m-b" }]);
	assert.deepEqual(state.takes, ["take-a"], "take-a is still its own");
	// A typed turn in between is not take-a's.
	const typed = run([start, said("m-typed"), end], state);
	assert.deepEqual(typed.spoken, []);
	const a = run([spoke("take-a"), start, said("m-a"), end], typed.state);
	assert.deepEqual(a.spoken, [{ kind: "message", messageId: "m-a" }]);
	// A user message that is not one of this window's takes binds nothing.
	const other = run([spoke("someone-else"), start, said("m-x"), end], a.state);
	assert.deepEqual(other.spoken, []);
});

test("a replayed end of a turn that finished BEFORE the send is not the answer", () => {
	// Previous turn completed, then words sent; a stale agent_end must not speak m0.
	const { state } = run([start, said("m0"), end]);
	const after = run([arm(), said("m0"), end], state);
	assert.deepEqual(after.spoken, []);
	assert.deepEqual(after.state.takes, ["take-1"], "still waiting for its own");
	const answered = run([spoke(), start, said("m1"), end], after.state);
	assert.deepEqual(answered.spoken, [{ kind: "message", messageId: "m1" }]);
});

test("reconnect replay: the same message_end/agent_end twice speaks once", () => {
	const first = run([arm(), spoke(), start, said("m1"), end]);
	assert.equal(first.spoken.length, 1);
	// The stream reconnects from an older cursor and re-sends the whole turn,
	// and the operator has already sent the next utterance.
	const replay = run(
		[arm("take-2"), spoke(), start, said("m1"), end],
		first.state,
	);
	assert.deepEqual(replay.spoken, [], "m1 was already spoken");
	assert.deepEqual(replay.state.takes, ["take-2"], "and take-2 is not bound");
});

test("a failed send disarms: the next unrelated turn is not spoken", () => {
	const { spoken, state } = run([
		arm(),
		{ kind: "disarmed", requestId: "take-1" },
		start,
		said("m1"),
		end,
	]);
	assert.deepEqual(spoken, []);
	assert.deepEqual(state.takes, []);
});

test("two takes in one turn are one answer", () => {
	const { spoken, state } = run([
		arm("take-a"),
		spoke("take-a"),
		start,
		arm("take-b"),
		spoke("take-b"),
		said("m1"),
		end,
	]);
	assert.deepEqual(spoken, [{ kind: "message", messageId: "m1" }]);
	assert.deepEqual(state.takes, []);
	assert.equal(state.answering, false);
});

test("an approval is announced once per gate; an ask and a cleared gate are not", () => {
	const approval = { request_id: "g1", kind: "approval" };
	const { spoken } = run([
		arm(),
		spoke(),
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
	const late = run([arm(), { kind: "gate", gate: approval }], other.state);
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
		run([arm(), { kind: "gate", gate: { request_id: "a1", kind: "ask" } }])
			.spoken,
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
		"src/renderer/src/features/voice/qwen-voice-controller.tsx",
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
			arm(),
			spoke(),
			start,
			said("m1", "Partial answer"),
			event(ending),
		]);
		assert.deepEqual(spoken, [], JSON.stringify(ending));
		assert.equal(state.answering, false, "the binding is consumed");
		assert.deepEqual(state.takes, [], "nothing carries to the next turn");
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
	assert.deepEqual(run([arm(), spoke(), start, cut, end]).spoken, []);
});

const KEEPS_DEDUPE = /spoken: state\.spoken,\s*announced: state\.announced/;
const DROPS_TURNS = /turns = null/;

test("U4: the dedupe sets survive the slot leaving and returning (A -> B -> A)", () => {
	const approval = { request_id: "g1", kind: "approval" };
	const first = run([arm(), spoke(), start, { kind: "gate", gate: approval }]);
	assert.deepEqual(first.spoken, [{ kind: "gate", requestId: "g1" }]);
	// The controller's resetTurnFlight: in-flight state dropped, dedupe kept.
	const back = {
		...initialVoiceTurns(),
		spoken: first.state.spoken,
		announced: first.state.announced,
	};
	// Returning to A re-reads the snapshot, which still names the pending gate.
	const again = run([arm("take-2"), { kind: "gate", gate: approval }], back);
	assert.deepEqual(again.spoken, [], "the same gate is not announced twice");
	const controller = readFileSync(
		"src/renderer/src/features/voice/qwen-voice-controller.tsx",
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
		state = run(
			[arm(`t${i}`), spoke(`t${i}`), start, said(`m${i}`), end],
			state,
		).state;
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
const CALLS_SEND = /sendVoiceTake/;
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
	const verb = driver.slice(driver.indexOf("voiceTake: async"));
	const body = stripComments(verb.slice(0, verb.indexOf("\n\t\t},") + 4));
	assert.match(body, CALLS_SEND, "the verb takes the hold's own path");
	for (const pattern of ANSWERING) {
		assert.doesNotMatch(body, pattern, `voiceTake reaches ${pattern}`);
	}
	// The media ops voice can send are exactly the two that cannot answer.
	const ops = new Set();
	for (const file of files) {
		for (const match of readFileSync(file, "utf8").matchAll(OP_LITERAL))
			ops.add(match[1]);
	}
	assert.deepEqual([...ops].sort(), [
		"voice.control",
		"voice.status",
		"voice.text",
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
		stepVoiceTurns(initialVoiceTurns(), arm()).state,
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
			? [
					evt(6, {
						type: "message_start",
						message: { id: "take-1", role: "user", content: "Hi." },
					}),
					evt(7, { type: "agent_start" }),
					{ kind: "error", status: 503 },
				]
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
	let state = stepVoiceTurns(initialVoiceTurns(), arm()).state;
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
		7,
		"message_start@6, agent_start@7, the 2 replayed, the 3 live",
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
			"src/renderer/src/features/voice/qwen-voice-controller.tsx",
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
const CARD_TOAST = /showCardToast\(/g;
const SHARED_ID_TOAST =
	/showWarningToast\(message, \{\s*id: voiceCardToastId\(sessionId\),/;
const TOAST_ONLY_ELSEWHERE = /if \(viewedSessionId\(\) === sessionId\) return;/;
const RAW_CARD_TOAST =
	/show(Info|Warning|Error)Toast\(\s*t\("ui\.chat\.voice\.(card_pending|approval_waiting)"\)/;
const PENDING_REFUSAL_ROUTED =
	/code === "approval_pending"\) \{[^}]*showCardToast\(sessionId, sentence\)/;

test("D8: the gate announcement and every refused take share one per-session warning toast", () => {
	const controller = stripComments(
		readFileSync(
			"src/renderer/src/features/voice/qwen-voice-controller.tsx",
			"utf8",
		),
	);
	const helper = controller.slice(controller.indexOf("function showCardToast"));
	assert.match(helper.slice(0, helper.indexOf("\n}")), SHARED_ID_TOAST);
	// Round 1, U5/D7: only when Ben is NOT looking at the voice session.
	assert.match(helper.slice(0, helper.indexOf("\n}")), TOAST_ONLY_ELSEWHERE);
	// The announcement, the pre-check and the server's refusal all route through it.
	// Its declaration plus three call sites.
	assert.equal([...controller.matchAll(CARD_TOAST)].length, 4);
	assert.doesNotMatch(
		controller,
		RAW_CARD_TOAST,
		"no approval sentence bypasses the shared id",
	);
	assert.match(
		controller,
		PENDING_REFUSAL_ROUTED,
		"the server's refusal uses the shared id",
	);
});

/*
 * R5-M1 / V14: A TAKE IS BOUND TO THE TURN WHOSE STREAM CARRIES ITS OWN USER
 * MESSAGE, AND TIMING NEVER BINDS. The server mints a take's user message with
 * `message.id == the utterance's request_id` on the prompt path, on a steer
 * drained at a tool boundary, and on a steer drained by the end-of-turn flush,
 * live and on replay (measured against lo-voice b2533239d). So a turn nobody
 * spoke into is never spoken, whatever the stream did around it.
 *
 * A hand-driven transport: each test pushes real-shaped frames onto the CURRENT
 * connection, arms the take at the moment the controller would (`feedTurns`
 * folds `armed` with the take's request_id into the same state the stream
 * feeds), and fires the retry timer itself. State is folded live, in arrival
 * order, exactly as the controller folds it. The letters are the review's case
 * names (round 4: E/F/H/I; round 5: J, K2, L, Q, R, S).
 */
async function liveRig() {
	const { subscribeVoiceStream, VOICE_STREAM_MAX_ATTEMPTS } = await import(
		streamPath.href
	);
	const connections = [];
	const timers = [];
	const statuses = [];
	let state = initialVoiceTurns();
	const spoken = [];
	const fold = (input) => {
		const step = stepVoiceTurns(state, input);
		state = step.state;
		spoken.push(...step.speak);
	};
	const handle = subscribeVoiceStream(
		"a1a1a1a1a1a1",
		fold,
		(status) => statuses.push(status),
		{
			subscribe: (args, onEvent) => {
				connections.push({ args, onEvent });
				return () => undefined;
			},
			delayMs: () => 0,
			schedule: (run) => {
				timers.push(run);
				return timers.length;
			},
			cancel: () => undefined,
		},
	);
	const at = (epoch, seq, type, payload) => ({
		kind: "data",
		data: JSON.stringify({
			session_id: "a1a1a1a1a1a1",
			epoch,
			seq,
			type,
			payload,
		}),
	});
	/*
	 * THE SERVER'S `generation`, as it stamps it (measured in the round-6
	 * capture, scripts/fixtures/voice-absorb-r6.json): +1 on each turn's
	 * `agent_start`, carried by that turn's `agent_start`/`agent_end`, by the
	 * `frontend.update` that flips `streaming`, and by every snapshot. Frames are
	 * built in the order they are pushed, so the counter follows the stream.
	 */
	let generation = 0;
	const stamped = (payload) => {
		if (payload?.type === "agent_start" && payload.generation === undefined) {
			generation += 1;
			return { ...payload, generation };
		}
		if (payload?.type === "agent_end" && payload.generation === undefined)
			return { ...payload, generation };
		return payload;
	};
	const push = (...events) => {
		for (const event of events) connections.at(-1).onEvent(event);
	};
	return {
		connections,
		get state() {
			return state;
		},
		spoken,
		statuses,
		handle,
		/** Arm a take as the controller does at send start, keyed by its id. */
		arm: (requestId = "take-1") => fold({ kind: "armed", requestId }),
		push,
		/** Fire every pending retry timer (each opens one connection). */
		tick: () => {
			while (timers.length) timers.shift()();
		},
		/** Fail every connection until the watcher stops as exhausted. */
		exhaust: () => {
			for (let i = 0; i < VOICE_STREAM_MAX_ATTEMPTS; i += 1) {
				push(DROP);
				while (timers.length) timers.shift()();
			}
		},
		open: (epoch, seq, payload = { gap: false }) =>
			at(epoch, seq, "open", {
				subscription_id: "0123456789abcdef0123456789abcdef",
				...payload,
			}),
		snapshot: (epoch, seq, streaming, historyIds = [], gen = generation) =>
			at(epoch, seq, "snapshot", {
				frontend: {
					snapshot: { pending_gate: null, streaming, generation: gen },
				},
				history: {
					entries: historyIds.map((id) => ({ id, type: "message" })),
				},
				cold: false,
			}),
		update: (epoch, seq, streaming) =>
			at(epoch, seq, "frontend.update", {
				changes: { streaming, generation },
			}),
		gate: (epoch, seq, gate) =>
			at(epoch, seq, "frontend.update", { changes: { pending_gate: gate } }),
		admissionFailed: (epoch, seq, requestId) =>
			at(epoch, seq, "admission.failed", {
				request_id: requestId,
				mode: "prompt",
				status: "failed",
				detail: "The session could not take the message.",
			}),
		event: (epoch, seq, payload) => at(epoch, seq, "event", stamped(payload)),
		/** Skip the counter ahead, as a turn the snapshot absorbed would have. */
		absorbTurn: () => {
			generation += 1;
			return generation;
		},
		/** The take's own user message, as the server mints it (id == request_id). */
		userMessage: (epoch, seq, id = "take-1") =>
			at(epoch, seq, "event", {
				type: "message_start",
				message: {
					id,
					role: "user",
					content: [{ type: "text", text: "Spoken words." }],
					input_mode: null,
				},
			}),
		said: (epoch, seq, id) =>
			at(epoch, seq, "event", {
				type: "message_end",
				message: {
					id,
					role: "assistant",
					content: [{ type: "text", text: `Answer ${id}.` }],
				},
			}),
	};
}

const DROP = { kind: "error", status: 503 };
const TYPED_ANSWER = "m-typed";
const spokeOnly = (id) => [{ kind: "message", messageId: id }];
/** A whole typed turn (nobody spoke into it) on `epoch` from `seq`. */
const typedTurn = (rig, epoch, seq, id = TYPED_ANSWER) => [
	rig.event(epoch, seq, { type: "agent_start" }),
	rig.said(epoch, seq + 1, id),
	rig.event(epoch, seq + 2, { type: "agent_end" }),
];
/** A spoken turn: the take's message, then its answer, then the end. */
const spokenTurn = (rig, epoch, seq, answer, take = "take-1") => [
	rig.userMessage(epoch, seq, take),
	rig.event(epoch, seq + 1, { type: "agent_start" }),
	rig.said(epoch, seq + 2, answer),
	rig.event(epoch, seq + 3, { type: "agent_end" }),
];
const quiet = (rig) => {
	rig.push(rig.open("ep-1", 5, { gap: true }), rig.snapshot("ep-1", 5, false));
};

test("R4-M1 path E: resume with open{gap:true}, empty replay, idle snapshot - the take is dropped, the typed turn is silent", async () => {
	const rig = await liveRig();
	quiet(rig);
	rig.arm();
	rig.push(
		rig.userMessage("ep-1", 6),
		rig.event("ep-1", 7, { type: "agent_start" }),
		DROP,
	);
	rig.tick();
	assert.deepEqual(rig.connections[1].args, {
		sessionId: "a1a1a1a1a1a1",
		epoch: "ep-1",
		afterSeq: 7,
	});
	rig.push(
		rig.open("ep-1", 400, { gap: true }),
		rig.snapshot("ep-1", 400, false),
	);
	assert.equal(rig.state.answering, false, "unbound on the gap");
	assert.deepEqual(rig.state.takes, []);
	rig.push(...typedTurn(rig, "ep-1", 401));
	assert.deepEqual(rig.spoken, []);
	rig.handle.dispose();
});

test("R4-M1 path F (QA Q6): an epoch change drops the take even while the next turn is running", async () => {
	const rig = await liveRig();
	quiet(rig);
	rig.arm();
	rig.push(
		rig.userMessage("ep-1", 6),
		rig.event("ep-1", 7, { type: "agent_start" }),
		DROP,
	);
	rig.tick();
	// New epoch, no gap flag, a typed turn RUNNING at the snapshot.
	rig.push(rig.open("ep-2", 1, {}), rig.snapshot("ep-2", 1, true));
	assert.equal(rig.state.answering, false, "unbound on the new epoch");
	rig.push(
		rig.said("ep-2", 2, TYPED_ANSWER),
		rig.event("ep-2", 3, { type: "agent_end" }),
	);
	assert.deepEqual(rig.spoken, []);
	rig.handle.dispose();
});

test("R4-M1 QA repro: take sent while the watcher is down, its turn ends unseen, new-epoch recovery - silent", async () => {
	const rig = await liveRig();
	rig.push(
		rig.open("ep-1", 1, { gap: true }),
		rig.snapshot("ep-1", 1, false),
		DROP,
	);
	rig.arm();
	rig.tick();
	rig.push(rig.open("ep-2", 1, { gap: true }), rig.snapshot("ep-2", 1, false));
	assert.deepEqual(rig.state.takes, [], "the take's message is among the lost");
	rig.push(...typedTurn(rig, "ep-2", 2));
	assert.deepEqual(rig.spoken, []);
	rig.handle.dispose();
});

test("R4-M1 path H: gap-free resume whose agent_end was absorbed into the snapshot - unbound silently", async () => {
	const rig = await liveRig();
	quiet(rig);
	rig.arm();
	rig.push(
		rig.userMessage("ep-1", 6),
		rig.event("ep-1", 7, { type: "agent_start" }),
		DROP,
	);
	rig.tick();
	// No gap, same epoch: the end exists only as snapshot state.
	rig.push(
		rig.open("ep-1", 10, { gap: false }),
		rig.snapshot("ep-1", 10, false),
	);
	assert.equal(rig.state.answering, false, "unbound by the idle snapshot");
	rig.push(...typedTurn(rig, "ep-1", 11));
	assert.deepEqual(rig.spoken, []);
	rig.handle.dispose();
});

test("R4-M1 path I: exhausted, then retry() on a new epoch - the take does not answer the typed turn", async () => {
	const rig = await liveRig();
	quiet(rig);
	rig.arm();
	rig.push(
		rig.userMessage("ep-1", 6),
		rig.event("ep-1", 7, { type: "agent_start" }),
	);
	rig.exhaust();
	assert.deepEqual(rig.statuses, ["exhausted"]);
	rig.handle.retry();
	rig.push(rig.open("ep-2", 2, { gap: true }), rig.snapshot("ep-2", 2, false));
	rig.push(...typedTurn(rig, "ep-2", 3));
	assert.deepEqual(rig.spoken, []);
	rig.handle.dispose();
});

test("R5-M1 J: the take's whole turn (message, start, end) absorbed into a gap-free snapshot - silent, and the typed turn too", async () => {
	const rig = await liveRig();
	quiet(rig);
	rig.arm();
	rig.push(DROP);
	rig.tick();
	// Cutoff 5, everything 6..9 absorbed: the take's message is in the history.
	rig.push(
		rig.open("ep-1", 5, { gap: false }),
		rig.snapshot("ep-1", 9, false, ["take-1"]),
	);
	assert.deepEqual(rig.state.takes, [], "an absorbed take is settled");
	rig.push(...typedTurn(rig, "ep-1", 10));
	assert.deepEqual(rig.spoken, []);
	rig.handle.dispose();
});

test("R5-M2 K2: exhausted mid-turn, retry while the turn is still running (gap:false) - the answer is spoken", async () => {
	const rig = await liveRig();
	quiet(rig);
	rig.arm();
	rig.push(
		rig.userMessage("ep-1", 6),
		rig.event("ep-1", 7, { type: "agent_start" }),
	);
	rig.exhaust();
	rig.handle.retry();
	rig.push(
		rig.open("ep-1", 7, { gap: false }),
		rig.update("ep-1", 7, true),
		rig.snapshot("ep-1", 7, true, ["take-1"]),
		rig.said("ep-1", 8, "STILL-RUNNING"),
		rig.event("ep-1", 9, { type: "agent_end" }),
	);
	assert.deepEqual(rig.spoken, spokeOnly("STILL-RUNNING"));
	rig.push(...typedTurn(rig, "ep-1", 10));
	assert.deepEqual(
		rig.spoken,
		spokeOnly("STILL-RUNNING"),
		"the typed turn is not",
	);
	rig.handle.dispose();
});

test("R5-M1 K: exhausted mid-turn, gap-free replay carries the answer - spoken once", async () => {
	const rig = await liveRig();
	quiet(rig);
	rig.arm();
	rig.push(
		rig.userMessage("ep-1", 6),
		rig.event("ep-1", 7, { type: "agent_start" }),
	);
	rig.exhaust();
	rig.handle.retry();
	rig.push(
		rig.open("ep-1", 10, { gap: false }),
		rig.said("ep-1", 8, "ANS"),
		rig.event("ep-1", 9, { type: "agent_end" }),
		rig.update("ep-1", 10, false),
		rig.snapshot("ep-1", 10, false, ["take-1"]),
	);
	rig.push(...typedTurn(rig, "ep-1", 11));
	assert.deepEqual(rig.spoken, spokeOnly("ANS"));
	rig.handle.dispose();
});

test("R5-M1 L: words steered into a typed turn while the stream is exhausted - the steer's answer or nothing, never the typed reply", async () => {
	const rig = await liveRig();
	quiet(rig);
	rig.push(
		rig.event("ep-1", 6, { type: "agent_start" }),
		rig.update("ep-1", 7, true),
	);
	rig.exhaust();
	rig.arm();
	rig.handle.retry();
	// Inside the dwell: the replay carries the drained steer and its answer.
	rig.push(
		rig.open("ep-1", 11, { gap: false }),
		rig.event("ep-1", 8, { type: "steering_delivered" }),
		rig.userMessage("ep-1", 9),
		rig.said("ep-1", 10, "STEERED"),
		rig.event("ep-1", 11, { type: "agent_end" }),
		rig.snapshot("ep-1", 11, false, ["take-1"]),
	);
	rig.push(...typedTurn(rig, "ep-1", 12));
	assert.deepEqual(rig.spoken, spokeOnly("STEERED"));
	rig.handle.dispose();
});

test("R5-M1 L2: the same steer, resumed after the dwell (gap:true) - silent", async () => {
	const rig = await liveRig();
	quiet(rig);
	rig.push(
		rig.event("ep-1", 6, { type: "agent_start" }),
		rig.update("ep-1", 7, true),
	);
	rig.exhaust();
	rig.arm();
	rig.handle.retry();
	rig.push(rig.open("ep-2", 1, { gap: true }), rig.snapshot("ep-2", 1, false));
	rig.push(...typedTurn(rig, "ep-2", 2));
	assert.deepEqual(rig.spoken, []);
	rig.handle.dispose();
});

test("R5-M1 Q: a typed turn replayed after a take sent while exhausted is not its answer; the take's own turn is", async () => {
	const rig = await liveRig();
	quiet(rig);
	rig.exhaust();
	rig.arm();
	rig.handle.retry();
	rig.push(
		rig.open("ep-1", 9, { gap: false }),
		...typedTurn(rig, "ep-1", 6, "TYPED-A"),
		rig.update("ep-1", 9, false),
		rig.snapshot("ep-1", 9, false),
	);
	assert.deepEqual(rig.spoken, [], "TYPED-A never carried the take");
	rig.push(...spokenTurn(rig, "ep-1", 10, "TAKE"));
	assert.deepEqual(rig.spoken, spokeOnly("TAKE"));
	rig.handle.dispose();
});

test("R5-M1 R: the same with a transient drop (no exhaustion) - never TYPED-A", async () => {
	const rig = await liveRig();
	rig.push(
		rig.open("ep-1", 5, { gap: true }),
		rig.snapshot("ep-1", 5, false),
		DROP,
	);
	rig.arm();
	rig.tick();
	rig.push(
		rig.open("ep-1", 9, { gap: false }),
		...typedTurn(rig, "ep-1", 6, "TYPED-A"),
		rig.update("ep-1", 9, false),
		rig.snapshot("ep-1", 9, false),
	);
	rig.push(...spokenTurn(rig, "ep-1", 10, "TAKE"));
	assert.deepEqual(rig.spoken, spokeOnly("TAKE"));
	rig.handle.dispose();
});

test("R5-M1 S: live, a typed turn ends while the take uploads, the take becomes its own prompt - only the take's turn speaks", async () => {
	const rig = await liveRig();
	quiet(rig);
	rig.push(
		rig.event("ep-1", 6, { type: "agent_start" }),
		rig.update("ep-1", 7, true),
	);
	rig.arm();
	rig.push(
		rig.said("ep-1", 8, "TYPED-RUNNING"),
		rig.event("ep-1", 9, { type: "agent_end" }),
		rig.update("ep-1", 10, false),
	);
	assert.deepEqual(rig.spoken, [], "the running turn never carried the take");
	rig.push(...spokenTurn(rig, "ep-1", 11, "TAKE"));
	assert.deepEqual(rig.spoken, spokeOnly("TAKE"));
	rig.handle.dispose();
});

test("R5-M1 keeps what must keep working: a fresh take across an idle snapshot, and the R3-M1 gap-free replay, each speak once", async () => {
	const rig = await liveRig();
	quiet(rig);
	// M: a slow model start - an idle update and an idle snapshot before the turn.
	rig.arm("take-a");
	rig.push(rig.update("ep-1", 6, false), DROP);
	rig.tick();
	rig.push(rig.open("ep-1", 6, { gap: false }), rig.snapshot("ep-1", 6, false));
	rig.push(...spokenTurn(rig, "ep-1", 7, "m-fresh", "take-a"));
	assert.deepEqual(rig.spoken, spokeOnly("m-fresh"));
	// R3-M1: a drop inside the dwell, the answer replayed before the snapshot.
	rig.arm("take-b");
	rig.push(
		rig.userMessage("ep-1", 11, "take-b"),
		rig.event("ep-1", 12, { type: "agent_start" }),
		DROP,
	);
	rig.tick();
	rig.push(
		rig.open("ep-1", 15, { gap: false }),
		rig.said("ep-1", 13, "m-replayed"),
		rig.event("ep-1", 14, { type: "agent_end" }),
		rig.snapshot("ep-1", 15, false, ["take-b"]),
	);
	rig.push(...typedTurn(rig, "ep-1", 16));
	assert.deepEqual(rig.spoken, [
		...spokeOnly("m-fresh"),
		...spokeOnly("m-replayed"),
	]);
	rig.handle.dispose();
});

/*
 * R5-m1 / R5-m2: THE HEADER'S PHASE, DRIVEN THROUGH THE SHIPPED CONTROLLER (its
 * `feedTurns` and `sendVoiceUtterance`, with the voice store) rather than read
 * off its source. The upload is held open by a stubbed `desktopMedia` so a fold
 * can land while it is out, which is the window R5-m1 is about.
 */
const CONTROLLER_STUBS = {
	"@shared/api/local-operator/desktop-api":
		"export const desktopMedia=(req)=>new Promise((resolve,reject)=>{globalThis.__voiceUpload={req,resolve,reject};}); export const mediaError=()=>({message:''}); export const desktopResult=async()=>({}); export const subscribeDesktopStream=()=>()=>{};",
	"@shared/hooks/use-desktop-feed": "export const useDesktopFeed=()=>({});",
	"@shared/i18n": "export const t=(k)=>k;",
	"@shared/utils/toast-manager":
		"export const dismissToast=()=>{}; export const showErrorToast=()=>{}; export const showInfoToast=()=>{}; export const showWarningToast=()=>{};",
	"@shared/api/local-operator/desktop-hooks":
		"export const desktopFeatureEnabled=()=>true; export const useDesktopCapabilities=()=>({});",
	"@shared/api/query-client": "export const queryClient={};",
	"@shared/hooks/use-canonical-session":
		"export const streamRetryDelayMs=()=>1;",
};
const SHARED_ALIAS = /^@shared\//;
const ANY_PATH = /.*/;
const DASHED_UUID_HEAD = /^[0-9a-f]{8}-[0-9a-f]{4}-/;
const READS_INPUT_MODE = /input_mode|inputMode/;
const controllerBundle = await build({
	stdin: {
		contents:
			'export { feedTurns, sendVoiceTake, takeIsEcho, isEcho, isQwenPhrase, isQwenPhraseHeard, markPhraseSpoken, PHRASE_ECHO_WINDOW_MS, rememberSpoken, speechMs, viewedSessionId, spokenTruncated, LONG_TAKE_MS, noteSpeechSegment, takeDroppedNotice } from "./src/renderer/src/features/voice/qwen-voice-controller"; export { useVoiceStore, voicePhaseOf, activityOfEvent } from "./src/renderer/src/features/voice/voice-store"; export { scheduleReplyEndTone, playReplyEndTone, END_TONE_HZ, END_NOTE_SECONDS } from "./src/renderer/src/features/voice/voice-earcons";',
		resolveDir: process.cwd(),
		loader: "tsx",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	write: false,
	packages: "external",
	plugins: [
		{
			name: "stub-shared",
			setup(b) {
				b.onResolve({ filter: SHARED_ALIAS }, (a) => ({
					path: a.path,
					namespace: "stub",
				}));
				b.onLoad({ filter: ANY_PATH, namespace: "stub" }, (a) => {
					if (!(a.path in CONTROLLER_STUBS))
						throw new Error(`no stub for ${a.path}`);
					return { contents: CONTROLLER_STUBS[a.path], loader: "js" };
				});
			},
		},
	],
});
const controllerPath = new URL(
	`./_qwen-voice-controller-${process.pid}.mjs`,
	import.meta.url,
);
writeFileSync(controllerPath, controllerBundle.outputFiles[0].text);
after(() => rmSync(controllerPath, { force: true }));

const userStart = (id) => ({
	kind: "event",
	event: {
		type: "message_start",
		message: { id, role: "user", content: [{ type: "text", text: "Hi." }] },
	},
});
const settle = (status = 200) =>
	globalThis.__voiceUpload.resolve({ kind: "json", status, body: {} });

/*
 * The hands-free controller sends a take to whichever session holds the slot
 * (there is no push-to-talk target any more), so the harness puts the slot on the
 * session first, as an enable would. The header's phase is DERIVED
 * (`voicePhaseOf`) from the slot, the rig and the exchange; the rig is `ready`
 * with a page connected here, so a session owed nothing reads `listening`.
 */
async function controller() {
	const mod = await import(controllerPath.href);
	const sendVoiceUtterance = (sessionId, { text }) => {
		mod.useVoiceStore
			.getState()
			.setActive({ session_id: sessionId, enabled_at: 1 });
		return mod.sendVoiceTake(text);
	};
	// Ready with a voice page connected: the state in which the header can
	// truthfully say "Listening" (round 1, D2/U2).
	mod.useVoiceStore
		.getState()
		.setRig({ rig: "ready", webui_url: null, clients: 1 });
	const phase = () => {
		const state = mod.useVoiceStore.getState();
		return mod.voicePhaseOf(state, state.active?.session_id);
	};
	return { ...mod, sendVoiceUtterance, phase };
}

test("R5-m1/R5-m2: the 2xx sets `working` only while an answer is owed, and a silent drop returns the header to rest", async () => {
	const { feedTurns, sendVoiceUtterance, useVoiceStore, phase } =
		await controller();
	// T1: a resume drops the take while the upload is still out -> rest.
	const t1 = sendVoiceUtterance("s1", { text: "hi" });
	assert.equal(phase(), "working", "the take is out");
	feedTurns("s1", { kind: "reset" });
	settle();
	await t1;
	assert.equal(phase(), "listening", "nothing armed is left to move it later");
	// T2: control - the take is still out at the 2xx -> working, then a reset
	// (the take's message lost) returns the header to rest.
	const t2 = sendVoiceUtterance("s2", { text: "hi" });
	settle();
	await t2;
	assert.equal(phase(), "working");
	assert.equal(useVoiceStore.getState().exchange?.sessionId, "s2");
	feedTurns("s2", { kind: "reset" });
	assert.equal(
		phase(),
		"listening",
		"a take dropped in silence ends the exchange",
	);
	// T3: a fast turn bound and ended while the upload was out -> rest, spoken.
	const t3 = sendVoiceUtterance("s3", { text: "hi" });
	const requestId = globalThis.__voiceUpload.req.requestId;
	assert.match(requestId, DASHED_UUID_HEAD);
	feedTurns("s3", userStart(requestId));
	feedTurns("s3", { kind: "event", event: { type: "agent_start" } });
	feedTurns("s3", {
		kind: "event",
		event: { type: "agent_end", aborted: true },
	});
	settle();
	await t3;
	assert.equal(phase(), "listening", "the take was already answered");
	// T4: a bound turn the snapshot shows ended -> rest.
	const t4 = sendVoiceUtterance("s4", { text: "hi" });
	const id4 = globalThis.__voiceUpload.req.requestId;
	settle();
	await t4;
	feedTurns("s4", userStart(id4));
	assert.equal(phase(), "working");
	feedTurns("s4", { kind: "streaming", streaming: false, snapshot: true });
	assert.equal(phase(), "listening");
});

test("V14: the binding never reads input_mode", () => {
	for (const file of [
		"voice-turns.ts",
		"voice-stream.ts",
		"qwen-voice-controller.tsx",
	]) {
		const source = stripComments(
			readFileSync(`src/renderer/src/features/voice/${file}`, "utf8"),
		);
		assert.doesNotMatch(source, READS_INPUT_MODE, file);
	}
});

/*
 * REVIEW ROUND 6. R6-M1 replays the reviewer's REAL capture
 * (`scripts/fixtures/voice-absorb-r6.json`, lo-voice b2533239d, mock provider):
 * the take's turn runs as generation 1, a typed steer is admitted, the stream
 * drops, and the gap-free resume's snapshot@44 says `streaming:true,
 * generation:2` - turn 1's `agent_end` and the typed turn's `agent_start` were
 * both absorbed. The typed turn's answer (seq 61) must not be spoken.
 */
const ABSORB = JSON.parse(
	readFileSync("scripts/fixtures/voice-absorb-r6.json", "utf8"),
);

test("R6-M1: the captured absorb (bound end + next start both absorbed, streaming:true) speaks nothing", async () => {
	const { subscribeVoiceStream } = await import(streamPath.href);
	const connections = [];
	const timers = [];
	let state = stepVoiceTurns(initialVoiceTurns(), {
		kind: "armed",
		requestId: ABSORB.take,
	}).state;
	const spoken = [];
	const handle = subscribeVoiceStream(
		"ff0d7764d2e5",
		(input) => {
			const step = stepVoiceTurns(state, input);
			state = step.state;
			spoken.push(...step.speak);
		},
		() => undefined,
		{
			subscribe: (args, onEvent) => {
				connections.push({ args, onEvent });
				return () => undefined;
			},
			delayMs: () => 0,
			schedule: (run) => timers.push(run),
			cancel: () => undefined,
		},
	);
	const feed = (frames) => {
		for (const frame of frames)
			connections.at(-1).onEvent({ kind: "data", data: JSON.stringify(frame) });
	};
	feed(ABSORB.conn1);
	assert.equal(state.answering, true, "the take bound to its own row");
	assert.equal(state.boundGeneration, 1, "and to generation 1, its turn's");
	connections.at(-1).onEvent({ kind: "error", status: 503 });
	timers.shift()();
	assert.equal(connections.at(-1).args.afterSeq, ABSORB.cut);
	feed(ABSORB.conn2);
	assert.deepEqual(spoken, [], "the typed turn's answer is not spoken");
	assert.equal(state.answering, false, "unbound at the generation-2 snapshot");
	handle.dispose();
});

test("R6-M1: a bound turn still running at a SAME-generation snapshot is answered (K2 shape)", async () => {
	const rig = await liveRig();
	quiet(rig);
	rig.arm();
	rig.push(
		rig.userMessage("ep-1", 6),
		rig.event("ep-1", 7, { type: "agent_start" }),
		rig.update("ep-1", 8, true),
	);
	assert.equal(rig.state.boundGeneration, 1);
	rig.push(DROP);
	rig.tick();
	rig.push(
		rig.open("ep-1", 8, { gap: false }),
		rig.snapshot("ep-1", 8, true, ["take-1"], 1),
		rig.said("ep-1", 9, "SAME-GEN"),
		rig.event("ep-1", 10, { type: "agent_end" }),
	);
	assert.deepEqual(rig.spoken, spokeOnly("SAME-GEN"));
	rig.handle.dispose();
});

test("R6-M1: a bound turn whose generation is still unknown at a running snapshot is dropped (silence is safe)", () => {
	// Bound while idle; the stream dropped before the turn's agent_start.
	const bound = run([
		{ kind: "armed", requestId: "t1" },
		event({
			type: "message_start",
			message: { id: "t1", role: "user", content: "Hi." },
		}),
	]).state;
	assert.equal(bound.answering, true);
	assert.equal(bound.boundGeneration, null);
	const after = run(
		[
			{ kind: "streaming", streaming: true, snapshot: true, generation: 4 },
			said("m-unknown"),
			event({ type: "agent_end", generation: 4 }),
		],
		bound,
	);
	assert.deepEqual(after.spoken, []);
});

test("R6-m1: admission.failed for a take's request_id disarms it; another id does nothing", async () => {
	const rig = await liveRig();
	quiet(rig);
	rig.arm("t-ok");
	rig.arm("t-failed");
	rig.push(rig.admissionFailed("ep-1", 6, "t-failed"));
	assert.deepEqual(rig.state.takes, ["t-ok"]);
	rig.push(rig.admissionFailed("ep-1", 7, "someone-else"));
	assert.deepEqual(rig.state.takes, ["t-ok"]);
	rig.handle.dispose();
});

test("R6-m1 (probe N5b): a take whose row never arrives does not make this window announce a typed turn's approval", async () => {
	const rig = await liveRig();
	quiet(rig);
	rig.arm("lost");
	rig.push(...typedTurn(rig, "ep-1", 6));
	rig.push(
		rig.userMessage("ep-1", 12, "u-typed-2"),
		rig.event("ep-1", 13, { type: "agent_start" }),
		rig.update("ep-1", 14, true),
		rig.gate("ep-1", 15, { request_id: "g2", kind: "approval" }),
	);
	assert.deepEqual(rig.spoken, [], "GATE:g2 is not announced");
	assert.equal(rig.state.pendingApproval, "g2", "but it is still recorded");
	rig.handle.dispose();
});

test("R6-m1: an expired take is dropped unless the server still holds it as a queued steer", () => {
	const armed = run([
		{ kind: "armed", requestId: "a" },
		{ kind: "armed", requestId: "b" },
		{ kind: "queued", requestIds: ["b"] },
	]).state;
	const expired = run(
		[
			{ kind: "expired", requestId: "a" },
			{ kind: "expired", requestId: "b" },
		],
		armed,
	).state;
	assert.deepEqual(expired.takes, ["b"], "a held steer survives");
	const drained = run(
		[
			{ kind: "queued", requestIds: [] },
			{ kind: "expired", requestId: "b" },
		],
		expired,
	).state;
	assert.deepEqual(
		drained.takes,
		[],
		"once released and still rowless, it goes",
	);
	assert.ok(VOICE_TAKE_ROW_TTL_MS >= 120_000, "never shorter than the send");
});

test("R6-m2: a thrown send disarms the take and settles the phase", async () => {
	const { feedTurns, sendVoiceUtterance, phase } = await controller();
	const sent = sendVoiceUtterance("s-throw", { text: "hi" });
	const id = globalThis.__voiceUpload.req.requestId;
	globalThis.__voiceUpload.reject(new TypeError("Failed to fetch"));
	const result = await sent;
	assert.equal(result.ok, false);
	assert.equal(phase(), "error", "not stuck on working");
	// The take is gone: its row arriving later binds nothing.
	feedTurns("s-throw", userStart(id));
	feedTurns("s-throw", { kind: "event", event: { type: "agent_start" } });
	assert.notEqual(phase(), "working");
});

test("I9: while a take's bound turn runs - including after an announced approval - the header settles on working, then idle", async () => {
	const { feedTurns, sendVoiceUtterance, phase } = await controller();
	const sent = sendVoiceUtterance("s-i9", { text: "hi" });
	const id = globalThis.__voiceUpload.req.requestId;
	settle();
	await sent;
	feedTurns("s-i9", userStart(id));
	feedTurns("s-i9", {
		kind: "event",
		event: { type: "agent_start", generation: 1 },
	});
	assert.equal(phase(), "working");
	// The approval is announced and approved on screen; the turn goes on.
	feedTurns("s-i9", {
		kind: "gate",
		gate: { request_id: "g-i9", kind: "approval" },
	});
	feedTurns("s-i9", { kind: "gate", gate: null });
	assert.equal(phase(), "working", "not at rest mid-turn");
	feedTurns("s-i9", {
		kind: "event",
		event: { type: "agent_end", generation: 1, aborted: true },
	});
	assert.equal(phase(), "listening", "rests once owed nothing");
});

test("R6-m1: a take's expiry timer is cleared once the take is settled (no timer outlives it)", async () => {
	const { feedTurns, sendVoiceUtterance } = await controller();
	const real = globalThis.setTimeout;
	const realClear = globalThis.clearTimeout;
	const live = new Set();
	globalThis.setTimeout = (fn, ms, ...rest) => {
		const handle = real(fn, ms, ...rest);
		if (ms === VOICE_TAKE_ROW_TTL_MS) live.add(handle);
		return handle;
	};
	globalThis.clearTimeout = (handle) => {
		live.delete(handle);
		realClear(handle);
	};
	try {
		const sent = sendVoiceUtterance("s-timer", { text: "hi" });
		settle();
		await sent;
		assert.equal(live.size, 1, "one expiry for the outstanding take");
		feedTurns("s-timer", { kind: "reset" });
		assert.equal(live.size, 0, "settled by the reset, the timer is gone");
	} finally {
		for (const handle of live) realClear(handle);
		globalThis.setTimeout = real;
		globalThis.clearTimeout = realClear;
	}
});

/*
 * THE ECHO GUARD (design "Risks", round 1 M1/M2/Q4). The invariant: the rig's
 * own speech never becomes a take, and a real follow-up is never dropped. A
 * take of 6+ words is an echo when ONE CONTIGUOUS run of 6+ words it shares
 * with the spoken text covers 80% of it; a shorter take only when it equals a
 * whole sentence of it. Every Q7 phrase is an echo at any time.
 */
const TRAILING_PERIOD = /\.$/;
const STOPS_AND_COMMAS = /[.,]/g;
const REVIEWER_REPLY =
	"I looked at the repository and found that the test suite fails in three places. The first failure is in the parser, where the tokenizer does not handle empty input. The second is in the config loader, which reads the file twice and then ignores the second result. The third is a flaky timing test in the scheduler that depends on the wall clock. I fixed the parser and the loader, and I left the scheduler test alone because it needs a decision from you about whether to mock the clock or widen the tolerance. All other tests pass now, and the change is ready to commit when you are.";

test("echo guard: the reviewer's real follow-ups are NOT echoes of a long reply", async () => {
	const { isEcho } = await controller();
	for (const take of [
		// The five the old subsequence ratio dropped (review round 1, M1).
		"can you mock the clock",
		"fix the scheduler test now",
		"and the loader is it fixed",
		"what is the clock tolerance",
		"and then the test is run",
		// Short instructions that quote the reply's own words.
		"mock the clock",
		"widen the tolerance",
		"leave the scheduler test alone",
		"fix the parser and the loader",
		// And the ones it already kept.
		"yes go ahead and fix it",
		"please run the tests again",
		"what is the third one",
		"commit it and push the change",
		"go ahead",
		"why did the loader read the file twice",
		"tell me about the clock",
		"what is the status of it",
		"is that the same as the other",
	])
		assert.equal(isEcho(take, REVIEWER_REPLY), false, take);
});

/*
 * QA ROUND 2, Q10: Parakeet does not hear the rig's own phrases back exactly.
 * These are its measured transcripts (r2 matrix rows 19, 22, 23, 25, 60, and
 * the guide walk's "Sand"), and each is the rig's speech, so each is dropped.
 */
const HEARD_BACK = [
	["Voices off for this conversation.", "voice_off"],
	["Voice's off for this conversation", "voice_off"],
	["voice is off for this conversation", "voice_off"],
	["Answer it on screen first", "on_screen_first"],
	["answer on screen first", "on_screen_first"],
	["That did not go through", "failed"],
	["That didn't go through.", "failed"],
	["Switch.", "switched"],
	["switched", "switched"],
];

/* The false-positive bar: real things a person says to the agent. */
const REAL_SHORT_TAKES = [
	"send it",
	"stop",
	"yes",
	"scan the repo",
	"test",
	"next",
	"end",
	"go ahead",
	"switch it off",
	"answer the question",
	"that did it",
	"voice off please",
	"what did you send",
	"is it off",
	// Review round 3, M1: one-word commands within two edits of "switched",
	// kept whenever the rig has not just spoken a phrase. These used to sit
	// near "Sent." too; now a successful take is silent, and nothing but the
	// switch phrase can pull them back into the echo window.
	"send",
	"set",
	"see",
	"seen",
	"sit",
	"sell",
	"sin",
	"sing",
	"sort",
	"shut",
	"sync",
	"sec",
	"sun",
	"scene",
	"sense",
	"spent",
	// "sent" is a real take now (plan §7): it is not a phrase, so no echo rule
	// reaches it, inside the window or outside it.
	"switch",
	"switches",
];

test("Q10/M1: a misheard phrase is dropped only within 10 s of the rig speaking one; outside it, it is the user", async () => {
	const {
		isQwenPhraseHeard,
		takeIsEcho,
		markPhraseSpoken,
		PHRASE_ECHO_WINDOW_MS,
	} = await controller();
	assert.equal(PHRASE_ECHO_WINDOW_MS, 10_000);
	const spokeAt = Date.now() + 20_000_000;
	markPhraseSpoken(spokeAt);
	for (const [heard, phrase] of HEARD_BACK) {
		assert.equal(isQwenPhraseHeard(heard), true, `${heard} (${phrase})`);
		assert.equal(takeIsEcho(heard, spokeAt + 1_500), true, `inside: ${heard}`);
		assert.equal(takeIsEcho(heard, spokeAt + 9_900), true, `inside: ${heard}`);
	}
	// The same mishearings, and the M1 words, outside the window: relayed.
	const outside = spokeAt + PHRASE_ECHO_WINDOW_MS + 1_000;
	for (const take of ["Scent", "Sand", "Voices off for this conversation."])
		assert.equal(takeIsEcho(take, outside), false, `outside: ${take}`);
	// A one-word mishearing of the removed phrase is never held back either.
	for (const [take, at] of [
		["Scent", spokeAt + 1_000],
		["Sent", spokeAt + 1_000],
		["Sand", spokeAt + 1_000],
	])
		assert.equal(takeIsEcho(take, at), false, `inside, no phrase: ${take}`);
	for (const take of ["sync", "sort", "switch", "see", "set", "send", "spent"])
		assert.equal(takeIsEcho(take, outside), false, `outside: ${take}`);
	// The exact phrase stays an echo at any time; "sent" is not one of them.
	assert.equal(takeIsEcho("sent", outside), false);
	assert.equal(takeIsEcho("Switched.", outside), true);
	// Every kept take is relayed outside the window; inside it, only the
	// one-word near-phrases are held back, and none of the brief's examples.
	const nearPhrase = new Set(
		REAL_SHORT_TAKES.filter((take) => isQwenPhraseHeard(take)),
	);
	for (const take of REAL_SHORT_TAKES) {
		assert.equal(takeIsEcho(take, outside), false, `outside: ${take}`);
		if (!nearPhrase.has(take))
			assert.equal(takeIsEcho(take, spokeAt + 1_000), false, `inside: ${take}`);
	}
	for (const take of [
		"send it",
		"stop",
		"yes",
		"scan the repo",
		"test",
		"next",
	])
		assert.equal(nearPhrase.has(take), false, take);
	for (const take of [
		"can you mock the clock",
		"fix the scheduler test now",
		"and the loader is it fixed",
		"what is the clock tolerance",
		"and then the test is run",
		"mock the clock",
		"widen the tolerance",
		"leave the scheduler test alone",
		"fix the parser and the loader",
		"yes go ahead and fix it",
		"please run the tests again",
		"what is the third one",
		"commit it and push the change",
		"go ahead",
		"why did the loader read the file twice",
		"tell me about the clock",
		"what is the status of it",
		"is that the same as the other",
	])
		assert.equal(isQwenPhraseHeard(take), false, `reviewer follow-up: ${take}`);
});

test("m1: a short take must EQUAL a reply sentence; near matches are the user answering it", async () => {
	const { isEcho } = await controller();
	assert.equal(
		isEcho("should I fix the parser", "Should I fix the loader?"),
		false,
	);
	assert.equal(isEcho("fix", "Fixed."), false);
	assert.equal(isEcho("push", "Pushed."), false);
	assert.equal(isEcho("fix it", "Fixed it. Anything else?"), false);
	assert.equal(
		isEcho("Hello from a mock provider", "Hello from the mock provider!"),
		false,
	);
	assert.equal(
		isEcho("should I fix the loader", "Should I fix the loader?"),
		true,
	);
	assert.equal(isEcho("pushed", "Pushed. The branch is up."), true);
});

test("a short reply or gate sentence heard back is its echo; a long sentence's fragment is not", async () => {
	const { isEcho } = await controller();
	assert.equal(
		isEcho("Hello from the mock provider.", "Hello from the mock provider!"),
		true,
	);
	assert.equal(
		isEcho("approval needed bash", "Approval needed: bash. run: sleep 1"),
		true,
		"a gate's short first sentence",
	);
	assert.equal(isEcho("hello", "Hello from the mock provider!"), false);
	assert.equal(isEcho("send it", "Sent. I sent the report."), false);
	assert.equal(isEcho("the third is a flaky test", REVIEWER_REPLY), false);
});

test("minor 2: the echo window is measured from the estimated END of playback", async () => {
	const { takeIsEcho, rememberSpoken, speechMs } = await controller();
	const long = `${"word ".repeat(150).trim()}. And then the summary closes here.`;
	assert.equal(speechMs(long), Math.ceil((156 / 2.5) * 1000));
	const at = Date.now() + 10_000_000;
	rememberSpoken(long, at);
	const sentence = "and then the summary closes here";
	// 60 s after it started the reply is still playing (62.4 s long): an echo.
	assert.equal(takeIsEcho(sentence, at + 60_000), true);
	assert.equal(takeIsEcho(sentence, at + speechMs(long) + 29_000), true);
	assert.equal(takeIsEcho(sentence, at + speechMs(long) + 31_000), false);
});

test("echo guard: the played-back reply IS an echo, whole or a sentence of it", async () => {
	const { isEcho } = await controller();
	// Parakeet's rendering of the reply heard back: case and punctuation differ.
	assert.equal(
		isEcho(
			REVIEWER_REPLY.toLowerCase().replace(STOPS_AND_COMMAS, ""),
			REVIEWER_REPLY,
		),
		true,
	);
	// One sentence of it heard back (the rest lost to barge-in or VAD).
	assert.equal(
		isEcho(
			"the third is a flaky timing test in the scheduler that depends on the wall clock",
			REVIEWER_REPLY,
		),
		true,
	);
	// A short reply heard back whole.
	assert.equal(
		isEcho("Hello from the mock provider.", "Hello from the mock provider!"),
		true,
	);
	const reply =
		"The workspace has three files: notes.md, plan.txt and a folder called src.";
	assert.equal(
		isEcho("the workspace has three files notes md plan txt", reply),
		true,
	);
	assert.equal(
		isEcho("delete the folder called src and the three files", reply),
		false,
		"the same words in another order are an instruction, not an echo",
	);
	// Under 6 words: only a whole sentence counts, never a fragment.
	assert.equal(isEcho("The workspace has three files.", reply), false);
	assert.equal(isEcho("yes", "Yes, I can do that."), false);
	assert.equal(
		isEcho("stop now", "Stop now."),
		true,
		"a whole one-sentence reply",
	);
	assert.equal(isEcho("stop", "Stop now. I will wait."), false);
	assert.equal(isEcho("what is in plan txt", reply), false);
});

test("echo guard: every Q7 phrase heard back is an echo, at any time and any length", async () => {
	const { isQwenPhrase, takeIsEcho } = await controller();
	const phrases = JSON.parse(
		readFileSync(
			new URL("../resources/qwen-voice/phrases.json", import.meta.url),
			"utf8",
		),
	);
	assert.deepEqual(Object.keys(phrases).sort(), [
		"failed",
		"on_screen_first",
		"switched",
		"voice_off",
	]);
	for (const phrase of Object.values(phrases)) {
		assert.equal(isQwenPhrase(phrase), true, phrase);
		// As Parakeet writes it back: lower case, punctuation shifted.
		const heard = phrase.toLowerCase().replace(TRAILING_PERIOD, "");
		assert.equal(takeIsEcho(heard, Date.now() + 3_600_000), true, heard);
	}
	// Not phrases: a sentence that starts like one, and a phrase word in a command.
	assert.equal(isQwenPhrase("Sent the report to Dana."), false);
	// The removed phrase is not one either, at any time (plan §7).
	assert.equal(isQwenPhrase("Sent."), false);
	assert.equal(takeIsEcho("Sent.", Date.now() + 3_600_000), false);
	assert.equal(isQwenPhrase("switched it off"), false);
});

test("echo guard runs BEFORE the card check: the rig's own 'Answer it on screen first.' heard back at a card is a silent echo, not a 409", async () => {
	const { feedTurns, sendVoiceUtterance, useVoiceStore } = await controller();
	useVoiceStore
		.getState()
		.setActive({ session_id: "s-card-echo", enabled_at: 1 });
	feedTurns("s-card-echo", {
		kind: "gate",
		gate: { request_id: "g-echo", kind: "approval" },
	});
	globalThis.__voiceUpload = null;
	// Three rounds, as QA's loop did: each must be dropped as an echo.
	for (let round = 0; round < 3; round += 1) {
		const heard = await sendVoiceUtterance("s-card-echo", {
			text: "answer it on screen first",
		});
		assert.equal(heard.code, "echo", `round ${round}: not approval_pending`);
	}
	assert.equal(globalThis.__voiceUpload, null, "nothing was sent");
	// A real take at the card is still refused by the card, as before (V13).
	const real = await sendVoiceUtterance("s-card-echo", {
		text: "yes go ahead",
	});
	assert.equal(real.code, "approval_pending");
	feedTurns("s-card-echo", { kind: "gate", gate: null });
});

test("paused: a take is refused before it is sent, and the phase says Paused", async () => {
	const { sendVoiceTake, useVoiceStore, voicePhaseOf } = await controller();
	useVoiceStore.getState().setActive({ session_id: "s-paused", enabled_at: 1 });
	useVoiceStore.getState().setRig({
		rig: "ready",
		webui_url: null,
		clients: 0,
		paused: true,
	});
	globalThis.__voiceUpload = undefined;
	const outcome = await sendVoiceTake("are you there");
	assert.equal(outcome.ok, false);
	assert.equal(outcome.code, "paused");
	assert.equal(
		globalThis.__voiceUpload,
		undefined,
		"nothing reached the upload: the page that would hear it is closed",
	);
	assert.equal(
		voicePhaseOf(useVoiceStore.getState(), "s-paused"),
		"paused",
		"the strip's word outranks the ready one",
	);
});

test("echo guard: the rig's 'Voice is off' heard back with the slot empty is an echo, not a voice_not_enabled refusal", async () => {
	const { sendVoiceTake, useVoiceStore } = await controller();
	useVoiceStore.getState().setActive(null);
	const heard = await sendVoiceTake("voice is off for this conversation");
	assert.equal(heard.code, "echo");
	const real = await sendVoiceTake("turn voice on please");
	assert.equal(real.code, "voice_not_enabled");
});

test("U9: a rig error wins over a stale exchange error, so its reason and Try again show", async () => {
	const { useVoiceStore, voicePhaseOf } = await controller();
	const store = useVoiceStore.getState();
	store.setActive({ session_id: "s-u9", enabled_at: 1 });
	store.setExchange("error", "s-u9", "not_sent");
	store.setRig({ rig: "ready", webui_url: null, clients: 1 });
	assert.equal(voicePhaseOf(useVoiceStore.getState(), "s-u9"), "error");
	store.setRig({
		rig: "error",
		webui_url: null,
		reason: "Port 8765 is in use; stop the other voice rig first",
	});
	assert.equal(voicePhaseOf(useVoiceStore.getState(), "s-u9"), "error");
	const indicator = readFileSync(
		"src/renderer/src/features/voice/voice-composer.tsx",
		"utf8",
	);
	// The rig's reason is checked before the exchange's, and Try again is
	// withheld only when the rig is NOT in error.
	const reason = indicator.slice(indicator.indexOf("function errorReason"));
	assert.ok(
		reason.indexOf('rig?.rig === "error"') <
			reason.indexOf('exchange === "not_sent"'),
	);
	/*
	 * THE RULE SURVIVES THE MOVE (a rig error wins, and only it offers Try again):
	 * the strip's error case offers the action on the rig's condition alone, so a
	 * stale "not sent" can never present a restarted rig it does not need.
	 */
	const errorAt = indicator.search(ERROR_CASE);
	assert.ok(errorAt > 0, "the strip's error case is gone");
	assert.match(indicator.slice(errorAt, errorAt + 700), RETRY_ONLY_FOR_THE_RIG);
	// D10: the start failure's own sentence is the visible reason.
	assert.match(reason, RIG_REASON_SHOWN);
	store.setExchange(null, null);
	store.setRig({ rig: "ready", webui_url: null, clients: 1 });
});

test("viewedSessionId reads the HashRouter's chat route", async () => {
	const { viewedSessionId } = await controller();
	assert.equal(viewedSessionId("#/chat/abc123def456"), "abc123def456");
	assert.equal(viewedSessionId("#/chat/abc123def456?x=1"), "abc123def456");
	assert.equal(viewedSessionId("#/chat"), null);
	assert.equal(viewedSessionId("#/settings"), null);
});

test("echo guard: a take matching recent speech is dropped unsent", async () => {
	const { sendVoiceUtterance, takeIsEcho, rememberSpoken } = await controller();
	const reply = "Done. I created plan.txt with the three steps you listed.";
	assert.equal(takeIsEcho(reply), false, "nothing spoken yet");
	rememberSpoken(reply);
	assert.equal(
		takeIsEcho("done I created plan txt with the three steps"),
		true,
	);
	assert.equal(
		takeIsEcho("done I created plan txt", Date.now() + 31_000),
		false,
		"outside the 30 s window",
	);
	globalThis.__voiceUpload = null;
	const dropped = await sendVoiceUtterance("s-echo", {
		text: "Done, I created plan.txt with the three steps you listed.",
	});
	assert.equal(dropped.ok, false);
	assert.equal(dropped.code, "echo");
	assert.equal(globalThis.__voiceUpload, null, "the echo was never sent");
	// A real take right after is still sent.
	const sent = sendVoiceUtterance("s-echo", { text: "now commit it please" });
	assert.notEqual(globalThis.__voiceUpload, null, "an ordinary take is sent");
	settle();
	assert.equal((await sent).ok, true);
});

/* ------------------------------------------------------------------------ */
/* The event path: phases, the end cue, the cut flag (plan §8, §10)          */
/* ------------------------------------------------------------------------ */

test("§8: the Gateway's events drive Hearing you / Speaking and clear on their own end", async () => {
	const { activityOfEvent } = await controller();
	assert.equal(activityOfEvent("realtime.playback.started"), "speaking");
	assert.equal(activityOfEvent("realtime.provider.speech_started"), "hearing");
	for (const type of [
		"realtime.playback.ended",
		"realtime.playback.cancelled",
		"realtime.provider.speech_stopped",
	])
		assert.equal(activityOfEvent(type), "idle", type);
	for (const type of [
		"realtime.response.done",
		"task.running",
		"task.completed",
		"something.else",
	])
		assert.equal(activityOfEvent(type), null, type);
});

test("§8: Speaking beats Working; the slot moving clears it; no activity is Listening", async () => {
	const { useVoiceStore, voicePhaseOf } = await controller();
	const phase = (sessionId) =>
		voicePhaseOf(useVoiceStore.getState(), sessionId);
	useVoiceStore.getState().setActive({ session_id: "s-live", enabled_at: 1 });
	assert.equal(phase("s-live"), "listening");
	useVoiceStore.getState().setExchange("working", "s-live");
	assert.equal(phase("s-live"), "working");
	useVoiceStore.getState().setActivity("speaking");
	assert.equal(phase("s-live"), "speaking", "audio moving wins over working");
	useVoiceStore.getState().setActivity("hearing");
	assert.equal(phase("s-live"), "hearing");
	useVoiceStore.getState().setActivity(null);
	assert.equal(phase("s-live"), "working", "the turn is still out");
	useVoiceStore.getState().setExchange(null, null);
	// A slot move clears the live half; the new holder reads Listening.
	useVoiceStore.getState().setActivity("speaking");
	useVoiceStore.getState().setActive({ session_id: "s-next", enabled_at: 2 });
	assert.equal(useVoiceStore.getState().activity, null);
	assert.equal(phase("s-next"), "listening");
	// A failed take still outranks a hearing state: it is what to act on.
	useVoiceStore.getState().setExchange("error", "s-next", "not_sent");
	useVoiceStore.getState().setActivity("hearing");
	assert.equal(phase("s-next"), "error");
});

test("§8: the end cue is a short falling two-note tone, under VAD's min_speech_ms", async () => {
	const { scheduleReplyEndTone, END_TONE_HZ, END_NOTE_SECONDS } =
		await controller();
	const starts = [];
	const stops = [];
	const ramps = [];
	const audio = {
		currentTime: 10,
		destination: { sink: true },
		createOscillator: () => ({
			type: "",
			frequency: {
				setValueAtTime: (hz, at) => starts.push({ hz, at }),
			},
			connect: () => {},
			start: (at) => starts.push({ at }),
			stop: (at) => stops.push(at),
		}),
		createGain: () => ({
			gain: {
				setValueAtTime: (v, at) => ramps.push(["set", v, at]),
				linearRampToValueAtTime: (v, at) => ramps.push(["lin", v, at]),
				exponentialRampToValueAtTime: (v, at) => ramps.push(["exp", v, at]),
			},
			connect: () => {},
		}),
	};
	const end = scheduleReplyEndTone(audio, 10);
	assert.equal(END_TONE_HZ.length, 2);
	assert.ok(END_TONE_HZ[0] > END_TONE_HZ[1], "it falls");
	assert.equal(stops.length, 2);
	assert.deepEqual(
		stops.map((at) => Number(at.toFixed(3))),
		[10 + END_NOTE_SECONDS, 10 + END_NOTE_SECONDS * 2 + 0.02].map((at) =>
			Number(at.toFixed(3)),
		),
	);
	assert.ok(end - 10 <= 0.384, "under s2s's 384 ms min_speech_ms");
	assert.ok(
		ramps.some(([kind]) => kind === "lin") &&
			ramps.some(([kind]) => kind === "exp"),
		"a fade in and a fast decay, not a click",
	);
});

test("§8: playing the cue is silent where there is no Web Audio", async () => {
	const { playReplyEndTone } = await controller();
	assert.equal(globalThis.AudioContext, undefined);
	await playReplyEndTone();
});

test("§8: the cut flag is read when present and tolerated when absent", async () => {
	const { spokenTruncated } = await controller();
	assert.equal(spokenTruncated({ text: "a", spoken_chars: 1 }), false);
	assert.equal(
		spokenTruncated({ text: "a", spoken_chars: 1, truncated: false }),
		false,
	);
	assert.equal(
		spokenTruncated({ text: "a", spoken_chars: 1, truncated: true }),
		true,
	);
	assert.equal(spokenTruncated(undefined), false);
	assert.equal(spokenTruncated(null), false);
	// And the speak path records it for the panel, and plays the cue only on an
	// ended playback (a cancelled one is an interruption, not an end).
	const source = readFileSync(
		"src/renderer/src/features/voice/qwen-voice-controller.tsx",
		"utf8",
	);
	assert.match(
		source,
		/setLastSpoken\(\{\s*sessionId,\s*text: spoken\.text,\s*truncated: spokenTruncated\(spoken\),\s*at: Date\.now\(\),?\s*\}\)/,
	);
	assert.match(
		source,
		/event\.type === "realtime\.playback\.ended" &&\s*event\.accepted === true/,
		"M1: the cue needs an ACCEPTED receipt, not merely an ended one",
	);
	assert.doesNotMatch(source, /playback\.cancelled"\).*playReplyEndTone/);
});

/*
 * ROUND 1 of the in-app page review (M1, M3) and BRIEF-1: the store's mirror of
 * the rig, the two microphone phases, and the dropped-take notice.
 */

test("M1: activity is cleared when the rig is not ready or no page is connected", async () => {
	const { useVoiceStore } = await controller();
	const store = useVoiceStore.getState();
	store.setActivity("speaking");
	assert.equal(useVoiceStore.getState().activity, "speaking");
	// Still ready with a page: the activity is a live claim and stays.
	store.setRig({ rig: "ready", webui_url: null, clients: 1 });
	assert.equal(useVoiceStore.getState().activity, "speaking");
	// The page dropped: nothing can be playing into it.
	store.setRig({ rig: "ready", webui_url: null, clients: 0 });
	assert.equal(useVoiceStore.getState().activity, null, "clients 0 clears it");
	store.setActivity("hearing");
	store.setRig({ rig: "stopped", webui_url: null, clients: 0 });
	assert.equal(
		useVoiceStore.getState().activity,
		null,
		"a stopped rig clears it",
	);
	store.setActivity("speaking");
	store.setRig({ rig: "error", webui_url: null, reason: "x" });
	assert.equal(useVoiceStore.getState().activity, null, "an error clears it");
});

test("M3: the microphone owns the header's word while it is pending or blocked", async () => {
	const { useVoiceStore, phase } = await controller();
	const store = useVoiceStore.getState();
	store.setActive({ session_id: "s1", enabled_at: 1 });
	// A prompt the OS has not answered: not "Starting voice" for ever.
	store.setRig({ rig: "stopped", webui_url: null, mic: "prompting" });
	assert.equal(phase(), "mic_prompting");
	// Denied, with the rig never started: the thing to fix, not "Start voice".
	store.setRig({ rig: "stopped", webui_url: null, mic: "denied" });
	assert.equal(phase(), "mic_blocked");
	// Granted and ready with a page: back to the ordinary words.
	store.setRig({ rig: "ready", webui_url: null, clients: 1, mic: "granted" });
	assert.equal(phase(), "listening");
	// A rig error still wins: the reason must not be hidden by a mic verdict.
	store.setRig({ rig: "error", webui_url: null, mic: "denied", reason: "x" });
	assert.equal(phase(), "error");
});

test("QA round 3 Q-1: the microphone is app-global; the slot elsewhere must not hide it", async () => {
	const { useVoiceStore, voicePhaseOf } = await controller();
	const phase = (sessionId) =>
		voicePhaseOf(useVoiceStore.getState(), sessionId);
	// A start from a click has not moved the slot yet: with no holder at all the
	// prompt still belongs to the conversation the person is looking at.
	useVoiceStore.getState().setActive(null);
	useVoiceStore
		.getState()
		.setRig({ rig: "stopped", webui_url: null, mic: "prompting" });
	assert.equal(phase("s-clicked"), "mic_prompting");
	useVoiceStore
		.getState()
		.setRig({ rig: "stopped", webui_url: null, mic: "denied" });
	assert.equal(phase("s-clicked"), "mic_blocked");
	// The slot sitting on ANOTHER session does not hide either verdict.
	useVoiceStore.getState().setActive({ session_id: "s-holder", enabled_at: 1 });
	useVoiceStore
		.getState()
		.setRig({ rig: "ready", webui_url: null, clients: 1, mic: "prompting" });
	assert.equal(phase("s-clicked"), "mic_prompting");
	assert.equal(phase("s-holder"), "mic_prompting");
	// With no mic condition, the elsewhere session is still off and the holder
	// still reads the ordinary ready word.
	useVoiceStore
		.getState()
		.setRig({ rig: "ready", webui_url: null, clients: 1 });
	assert.equal(phase("s-clicked"), "off");
	assert.equal(phase("s-holder"), "listening");
});

test("BRIEF-1: a segment at the cap is a dropped take, and the strip has its line", async () => {
	const mod = await controller();
	assert.equal(mod.LONG_TAKE_MS, 30_000);
	const at = Date.parse("2026-10-18T05:00:00.000Z");
	const clock = { startedAt: null };
	assert.equal(
		mod.noteSpeechSegment(clock, "realtime.provider.speech_started", at),
		null,
	);
	// A natural take soft-ends well under the cap: nothing to say.
	assert.equal(
		mod.noteSpeechSegment(
			clock,
			"realtime.provider.speech_stopped",
			at + 10_600,
		),
		null,
	);
	// One that reaches the cap is what the VAD throws away whole.
	assert.equal(
		mod.noteSpeechSegment(clock, "realtime.provider.speech_started", at),
		null,
	);
	assert.equal(
		mod.noteSpeechSegment(
			clock,
			"realtime.provider.speech_stopped",
			at + 31_000,
		),
		at + 31_000,
	);
	// A stop with no start it saw says nothing.
	assert.equal(
		mod.noteSpeechSegment(clock, "realtime.provider.speech_stopped", at),
		null,
	);
	// The clock has an owner (review round 2, nit 1): a remount's clock does not
	// inherit a segment the previous mount opened.
	const remount = { startedAt: null };
	mod.noteSpeechSegment(clock, "realtime.provider.speech_started", at);
	assert.equal(
		mod.noteSpeechSegment(
			remount,
			"realtime.provider.speech_stopped",
			at + 31_000,
		),
		null,
		"a new mount never sees the old listener's start",
	);
	assert.equal(
		mod.noteSpeechSegment(
			clock,
			"realtime.provider.speech_stopped",
			at + 31_000,
		),
		at + 31_000,
	);
	// The line the strip renders, and the store slot it fills.
	assert.equal(mod.takeDroppedNotice(), "ui.chat.voice.take_too_long");
	mod.useVoiceStore.getState().setDroppedTake(at);
	assert.equal(mod.useVoiceStore.getState().droppedTakeAt, at);
});
