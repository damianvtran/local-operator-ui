import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
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
