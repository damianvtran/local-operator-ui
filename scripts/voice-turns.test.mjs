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
			return () => undefined;
		},
		delayMs: (attempt) => attempt * 100,
		schedule: (run, ms) => {
			delays.push(ms);
			timers.push(run);
			return timers.length;
		},
		cancel: () => undefined,
	};
	const dispose = subscribeVoiceStream(
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
		dispose,
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
	assert.equal(rig.inputs.length, 1);
	rig.dispose();
});
