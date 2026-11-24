import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * A QUEUED ASK ANSWERED THROUGH ITS LEGACY MIRROR (operator report, 2026-11-23).
 *
 * The Mac app viewing a remote session drew that session's queued ask in the
 * inline QuestionDock - core's legacy single-slot MIRROR of the head ask, an
 * ask-kind `pending_gate` whose `request_id` is `"<ask_id>.<question_index>"`
 * (`local_operator/asks/store.py` `mirror_request_id`). Answering it showed
 * "Your answer was not sent. Invalid desktop operation.": the dock posts the GATE
 * shape with that id as `requestId`, and the contract's generic `id` grammar
 * refused the dot, so main's own schema answered 422 before a socket opened.
 * Core's runtime routes a parsed mirror id to the ask queue on that same gate
 * path, so the refusal was the app's contract being narrower than the backend's.
 *
 * Two things are pinned here, both through the SHIPPED code rather than a copy:
 * the body `answerGateOption` builds for a mirror gate must pass
 * `desktopRequestSchema` (and only that one extra grammar - the negative cases
 * keep the widening exact), and a never-sent schema refusal of an answer must
 * read as a sentence about the answer, never the transport's bare diagnostic.
 *
 * DOM-free on purpose (the `fleet-asks.test.mjs` shape): every subject is a
 * pure function or an injected-transport call.
 */
const bundle = await build({
	stdin: {
		contents: [
			'export { answerGateOption, createSendLock, unsentAnswerMessage, answerReport } from "./src/renderer/src/features/chat/ask-answer";',
			'export { askRefusalSentence } from "./src/renderer/src/features/chat/ask-queue";',
			'export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
			'export { desktopRequestSchema, desktopEndpoint, DESKTOP_CONTRACT_REFUSAL_DETAIL, ASK_MIRROR_REQUEST_ID_PATTERN } from "./src/shared/desktop-contract";',
			'export { requestDesktopOutcome } from "./src/main/desktop-transport";',
		].join("\n"),
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	loader: { ".css": "empty" },
	define: { "import.meta.env": "{}" },
	external: ["electron"],
	logLevel: "silent",
});
const {
	answerGateOption,
	createSendLock,
	unsentAnswerMessage,
	answerReport,
	askRefusalSentence,
	DesktopControlError,
	desktopRequestSchema,
	desktopEndpoint,
	DESKTOP_CONTRACT_REFUSAL_DETAIL,
	ASK_MIRROR_REQUEST_ID_PATTERN,
	requestDesktopOutcome,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

// Synthetic ids in the shapes the operator's session carried: a 12-hex session
// id, a uuid-hex owner epoch, and core's mirror id for question 0 of `a-06d8`.
const SESSION = "0a1b2c3d4e5f";
const EPOCH = "9f3c2b1a0d4e4f6a8b7c6d5e4f3a2b1c";
const MIRROR = "a-06d8.0";
const BARE_DIAGNOSTIC = /Invalid desktop operation/;
const NEVER_SENT = /nothing left this device/;
const BACKEND_WORDS = /question_index out of range/;

/** The body the dock sends for one option press, via the real builder. */
const dockBody = async (requestId) => {
	const sent = [];
	const outcome = await answerGateOption(
		{
			gate: { kind: "ask", request_id: requestId, question_index: 0 },
			sessionId: SESSION,
			epoch: EPOCH,
			label: "Yes",
			lock: createSendLock(),
		},
		async (request) => void sent.push(request),
	);
	assert.equal(outcome.status, "sent");
	assert.equal(sent.length, 1);
	return sent[0];
};

test("the dock's answer to a mirrored queued ask passes main's own schema", async () => {
	const body = await dockBody(MIRROR);
	assert.equal(body.requestId, MIRROR);
	const parsed = desktopRequestSchema.safeParse(body);
	assert.equal(
		parsed.success,
		true,
		`schema refused the mirror answer: ${JSON.stringify(parsed.error?.issues)}`,
	);
	// And the id reaches the route verbatim, on the gate body core parses.
	const endpoint = desktopEndpoint(parsed.data);
	// One path, three bodies: the gate shape posts to `/answers` too.
	assert.equal(endpoint.path, `/v1/desktop/sessions/${SESSION}/answers`);
	assert.equal(endpoint.body.request_id, MIRROR);
	assert.equal(endpoint.body.epoch, EPOCH);
});

test("every grammar the mirror id can take is accepted, and nothing near it", async () => {
	for (const ok of ["a-06d8.0", "a-ffff.12", "a-0000.9999", "a-06d8a1.3"]) {
		const parsed = desktopRequestSchema.safeParse(await dockBody(ok));
		assert.equal(parsed.success, true, `refused ${ok}`);
	}
	for (const bad of [
		"a-06d8.x",
		"../x",
		"a-06d8.0.1",
		"a-06d8 .0",
		"a-06d8. 0",
		" a-06d8.0",
		"x-06d8.0",
		"a-06D8.0",
		"a-.0",
		"a-06d.0",
		"a-06d8.",
		"a-06d8.00000",
		`a-${"0".repeat(200)}.0`,
		"a-06d8.0\n",
	]) {
		const parsed = desktopRequestSchema.safeParse(await dockBody(bad));
		assert.equal(parsed.success, false, `accepted ${JSON.stringify(bad)}`);
	}
	// The widening is the ANSWER's request id only: the epoch keeps `id`.
	const body = await dockBody(MIRROR);
	assert.equal(
		desktopRequestSchema.safeParse({ ...body, epoch: "a-06d8.0" }).success,
		false,
	);
	// The pattern itself is anchored (a `.test` with no anchors would pass these).
	assert.equal(ASK_MIRROR_REQUEST_ID_PATTERN.test("za-06d8.0"), false);
	assert.equal(ASK_MIRROR_REQUEST_ID_PATTERN.test("a-06d8.0z"), false);
});

test("an ordinary gate request id still passes, unchanged", async () => {
	const body = await dockBody("7c1e9a0b3d2f4e65");
	assert.equal(desktopRequestSchema.safeParse(body).success, true);
});

test("main's never-sent refusal is the one diagnostic the renderer recognises", async () => {
	// Through the REAL transport, with a body the schema refuses: the refusal is
	// answered before any socket opens, so no backend URL is ever dialled.
	const outcome = await requestDesktopOutcome(
		{
			op: "sessions.answer",
			sessionId: SESSION,
			epoch: EPOCH,
			requestId: "../x",
			value: "Yes",
			questionIndex: 0,
		},
		"http://127.0.0.1:9",
		"token",
	);
	assert.equal(outcome.answered, false);
	assert.equal(outcome.response.status, 422);
	assert.equal(outcome.response.body.detail, DESKTOP_CONTRACT_REFUSAL_DETAIL);
});

test("a never-sent schema refusal of an answer reads as a sentence about the answer", () => {
	const refusal = new DesktopControlError(422, DESKTOP_CONTRACT_REFUSAL_DETAIL);
	const sentence = unsentAnswerMessage(refusal);
	assert.doesNotMatch(sentence, BARE_DIAGNOSTIC);
	assert.equal(
		sentence,
		"Your answer was not sent. The app could not put it in a form this session accepts, so nothing left this device.",
	);
	// The same sentence on the press-report path the dock takes.
	const report = answerReport(
		{ status: "failed", request: {}, error: refusal },
		{
			pressedGateKey: "g",
			liveGateKey: "g",
			sentEpoch: EPOCH,
			liveEpoch: EPOCH,
			cardOnScreen: true,
		},
	);
	assert.match(JSON.stringify(report), NEVER_SENT);
	assert.doesNotMatch(JSON.stringify(report), BARE_DIAGNOSTIC);
	// The queued-ask row (the Asks panel) paints the same sentence.
	assert.equal(askRefusalSentence(refusal), sentence);
	// A BACKEND 422 keeps its own words: only main's own refusal is translated.
	const backend = new DesktopControlError(422, "question_index out of range");
	assert.match(unsentAnswerMessage(backend), BACKEND_WORDS);
	assert.equal(askRefusalSentence(backend), "question_index out of range");
});
