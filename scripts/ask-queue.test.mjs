import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE QUEUED-ASK READ MODEL, pinned.
 *
 * Why this file exists: the whole asks surface shipped with no rig reaching it
 * (agent review F4, QA round 1's note). Every suite the PR cited predated these
 * modules - `composer-queued-send.test.mjs` is about the SEND queue - so the
 * largest surface of the feature, and the module the composer's routing reads
 * for its decisions, could have regressed without a single CI signal.
 *
 * What it CAN answer: the pure decisions. Presence-vs-emptiness, the legacy
 * mirror rule, the status classification (the one that decides whether a card
 * offers live controls), the whole-ask body, and every sentence the copy
 * contract publishes.
 *
 * What it can NOT answer, deliberately: anything about the render. The class
 * list, the affordance of a mark, whether the box moves - those are the frame
 * rig's and `ask-draft-swap.test.mjs`'s business, and a DOM-free test asserting
 * them would be asserting a string, not a fact.
 */

const bundle = await build({
	stdin: {
		contents: `
			/*
			 * ask-queue ALONE. The component modules import the @shared aliases and
			 * lucide-react, which a node-side bundle would carry as externals - and the
			 * copy this file asserts lives in the contract module precisely so it can be
			 * read without a DOM (see askBarText's own note).
			 */
			export * from "./src/renderer/src/features/chat/ask-queue";
			export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";
		`,
		loader: "tsx",
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	// The renderer's own alias: `ask-queue` reaches `userFacingMessage` through
	// `@shared/api/...` now that the refusal sentence is composed there, and a
	// node-side bundle has no idea what `@shared` means without this.
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	write: false,
	logLevel: "silent",
});
const bundlePath = new URL(`./_ask-queue-${process.pid}.mjs`, import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
/*
 * The bundle is removed even when it FAILS TO LOAD: an earlier version unlinked
 * only after a successful import, so a broken alias left `_ask-queue-<pid>.mjs`
 * sitting in `scripts/` - repo scratch that a `git add -A` would have committed.
 */
let queue;
try {
	queue = await import(bundlePath.href);
} finally {
	await unlink(bundlePath).catch(() => {});
}

const TS = 1_760_000_000_000;

const ask = (over) => ({
	ask_id: "a-1",
	created_at: TS,
	expires_at: TS + 3_600_000,
	timeout_s: 3600,
	urgent: false,
	status: "open",
	delivered: false,
	questions: [],
	...over,
});

const single = (over = {}) =>
	ask({
		questions: [
			{
				id: "target",
				question: "Which environment?",
				options: [
					{ label: "staging", recommended: true },
					{ label: "production" },
				],
				multi: false,
			},
		],
		...over,
	});

/* ------------------------------------------------------------- presence ---- */

test("an absent `asks` field is NOT an empty queue", () => {
	// The backend publishes the field only while its flag is on, so absence means
	// "this backend does not do queued asks" - the one reading a surface must not
	// collapse, because an old backend would otherwise grow an affordance that can
	// never be satisfied.
	assert.equal(queue.sessionAsks(null), null);
	assert.equal(queue.sessionAsks(undefined), null);
	assert.equal(queue.sessionAsks({}), null);
	assert.equal(queue.sessionAsks({ asks: null }), null);
	// A published empty list is the other state, and it is a real one.
	assert.deepEqual(queue.sessionAsks({ asks: [] }), []);
});

test("the legacy mirror is suppressed only when it actually is one", () => {
	const asks = [single()];
	// Present asks + an ask-shaped gate: the gate is the mirror of a row we already
	// hold, so drawing both would show one question twice.
	assert.equal(
		queue.legacyAskMirrorSuppressed({
			asks,
			pending_gate: { kind: "ask", request_id: "r" },
		}),
		true,
	);
	// An APPROVAL is never a mirror: approvals have no queue to appear in.
	assert.equal(
		queue.legacyAskMirrorSuppressed({
			asks,
			pending_gate: { kind: "approval", request_id: "r" },
		}),
		false,
	);
	// No asks published: the gate is the only carrier and must be drawn.
	assert.equal(
		queue.legacyAskMirrorSuppressed({
			asks: null,
			pending_gate: { kind: "ask", request_id: "r" },
		}),
		false,
	);
	assert.equal(
		queue.legacyAskMirrorSuppressed({ asks, pending_gate: null }),
		false,
	);
});

/* ------------------------------------------------------- classification ---- */

test("`late` is terminal and `timed_out` is still answerable", () => {
	// This is the pair the design warns about and the one a reader is most likely
	// to get wrong, because both are about a deadline. `late` means the answer
	// LANDED (after the deadline) and the model was told, so its card must offer
	// nothing; `timed_out` means nobody answered, and a late answer still reaches
	// the model - which is the whole point of the late path.
	const late = queue.presentAsk(
		ask({ status: "late", answers: { target: ["staging"] } }),
	);
	assert.equal(late.canAnswer, false);
	assert.equal(late.canDecline, false);
	assert.equal(late.open, false);

	const timedOut = queue.presentAsk(ask({ status: "timed_out" }));
	assert.equal(timedOut.canAnswer, true, "a timed-out ask is answerable");
	assert.equal(timedOut.canDecline, true);

	for (const status of ["answered", "declined", "dismissed", "expired"]) {
		const settled = queue.presentAsk(ask({ status }));
		assert.equal(settled.canAnswer, false, `${status} is terminal`);
		assert.equal(settled.canDecline, false, `${status} is terminal`);
	}
});

test("an unknown status is its own case, never coerced into `open`", () => {
	const unknown = queue.presentAsk(ask({ status: "something_new" }));
	assert.equal(unknown.status, "unknown");
	assert.equal(unknown.canAnswer, false);
});

test("`delivering` is only the answered-but-not-yet-delivered reading", () => {
	assert.equal(
		queue.presentAsk(ask({ status: "answered", delivered: false })).delivering,
		true,
	);
	assert.equal(
		queue.presentAsk(ask({ status: "answered", delivered: true })).delivering,
		false,
	);
	assert.equal(
		queue.presentAsk(ask({ status: "late", delivered: true })).delivering,
		false,
	);
});

/* ------------------------------------------------------------- the view ---- */

test("the queue view counts OPEN asks and orders open before settled", () => {
	const view = queue.askQueueView({
		asks: [
			ask({ ask_id: "a-settled", status: "late" }),
			ask({ ask_id: "a-open-2", status: "open", created_at: TS + 10 }),
			ask({ ask_id: "a-open-1", status: "open", created_at: TS + 20 }),
		],
	});
	assert.equal(view.rows.length, 3);
	assert.equal(view.open, 2);
	assert.equal(view.total, 3);
	/*
	 * OLDEST open first, ahead of anything settled - the backend's own rule for the
	 * mirrored card (`_sync_pending` names the OLDEST open ask), inherited so the bar
	 * and the list cannot disagree about what "the head" is. A card that jumped to
	 * each new arrival would move under a user's finger mid-tap.
	 */
	assert.deepEqual(
		view.rows.map((row) => row.ask.ask_id),
		["a-open-2", "a-open-1", "a-settled"],
	);
	assert.equal(view.head?.ask.ask_id, "a-open-2");
	// The head is the head OPEN ask even when a settled row sorts first by nothing:
	// `head` is what the composer's routing reads for `canAnswer`.
	assert.equal(view.head?.canAnswer, true);
});

test("a view over an absent field is empty AND unsupported", () => {
	const view = queue.askQueueView(null);
	assert.equal(view.asks, null);
	assert.equal(view.rows.length, 0);
	assert.equal(view.head, null);
	assert.equal(view.open, 0);
});

/* --------------------------------------------------------- the answer ---- */

test("the whole-ask body is built only from a COMPLETE draft", () => {
	const two = ask({
		ask_id: "a-two",
		questions: [
			{ id: "env", question: "Which environment?" },
			{ id: "when", question: "When?" },
		],
	});
	// Partial: the wire refuses a partial map, so a body that could only be refused
	// must not be built at all - that is what keeps Submit honest rather than
	// merely disabled-looking.
	assert.equal(queue.askAnswerMap(two, { env: ["staging"] }), null);
	const full = queue.askAnswerMap(two, { env: ["staging"], when: ["now"] });
	assert.deepEqual(full, { env: ["staging"], when: ["now"] });
	// Every answer is a LIST, so the server never branches on the value's shape.
	assert.ok(Array.isArray(full.env));
});

test("a secret answer travels as the typed value and is required", () => {
	const secret = ask({
		ask_id: "a-sec",
		questions: [
			{ id: "DEPLOY_TOKEN", question: "Paste the token.", secret: true },
			{ id: "env", question: "Which environment?" },
		],
	});
	// The secret is not optional: a submit that omitted it would hand the model an
	// ask answered without the one thing it asked for.
	assert.equal(queue.askAnswerMap(secret, { env: ["staging"] }, {}), null);
	const answers = queue.askAnswerMap(
		secret,
		{ env: ["staging"] },
		{
			DEPLOY_TOKEN: "hunter2",
		},
	);
	// The VALUE rides the body; the backend is what substitutes the key name before
	// anything durable is written (`session.respond_ask`), and withholding it here
	// would give the model an answer it could never act on.
	assert.deepEqual(answers, { env: ["staging"], DEPLOY_TOKEN: ["hunter2"] });
});

test("blank answers do not count as answers", () => {
	const one = single();
	assert.equal(queue.askAnswerMap(one, { target: ["   "] }), null);
	assert.deepEqual(queue.askAnswerMap(one, { target: [" staging "] }), {
		target: [" staging "],
	});
});

test("the decline body is a shape of its own, with no epoch and no answers", () => {
	const request = queue.askDeclineRequest(
		single({ ask_id: "a-91be" }),
		"sess-1",
	);
	assert.deepEqual(request, {
		op: "sessions.answer",
		sessionId: "sess-1",
		askId: "a-91be",
		decline: true,
	});
	// A queued ask outlives the owner epoch that raised it, so this shape must never
	// carry one: the route skips the comparison, and sending an epoch would suggest
	// a check that does not happen.
	assert.equal("epoch" in request, false);
});

test("the answer request is addressed by ask id and carries no epoch", () => {
	const request = queue.askAnswerRequest(
		single({ ask_id: "a-7f3c" }),
		{ target: ["staging"] },
		"sess-1",
	);
	assert.deepEqual(request, {
		op: "sessions.answer",
		sessionId: "sess-1",
		askId: "a-7f3c",
		answers: { target: ["staging"] },
	});
	assert.equal(queue.askAnswerRequest(single(), {}, "sess-1"), null);
});

/* ------------------------------------------------------------- the copy ---- */

test("the copy contract mirrors the backend's own sentences", () => {
	// These strings are the TUI's and the phone fold's, from `harness/rows.py`; a
	// desktop paraphrase would make one event read three ways.
	assert.equal(
		queue.askResponseSummary({ askId: "a-1", status: "answered" }),
		"Answered — delivering (ask a-1)",
	);
	assert.equal(
		queue.askResponseSummary({ askId: "a-1", status: "late" }),
		"Answered late — the agent was told (ask a-1)",
	);
	assert.equal(
		queue.askResponseSummary({ askId: "a-1", status: "declined" }),
		"Ask a-1 declined — the agent was told",
	);
	assert.equal(
		queue.askTimeoutSummary({ askId: "a-1", waitedS: 900 }),
		"Timed out after 15m — the agent moved on; you can still answer (ask a-1)",
	);
});

test("the wait is reported as the wait that happened", () => {
	assert.equal(queue.askWaitedText(0), "a while");
	assert.equal(queue.askWaitedText(Number.NaN), "a while");
	assert.equal(queue.askWaitedText(45), "45s");
	assert.equal(queue.askWaitedText(900), "15m");
	assert.equal(queue.askWaitedText(7200), "2h");
	// One unit spelling across the feature, which is what the design round asked
	// for: the TUI this mirrors writes `42m`, not `42 m`.
	assert.equal(queue.askWaitedText(60), "1m");
});

test("the bar's sentence and its accessible name agree at every count", () => {
	const two = queue.askQueueView({
		asks: [single({ ask_id: "a-1" }), single({ ask_id: "a-2" })],
	});
	assert.equal(
		queue.askBarText(two),
		"2 questions waiting — Which environment?",
	);

	// ONLY SETTLED: the visible line switches to the settled count, so the spoken
	// one must too. They used to disagree - the bar drew "1 settled" beside a name
	// that announced "No asks outstanding" (agent review F6, UX U3).
	const settled = queue.askQueueView({
		asks: [single({ ask_id: "a-1", status: "late" })],
	});
	assert.equal(
		queue.askBarText(settled),
		"1 settled — Which environment?",
		"the accessible name must describe what is drawn",
	);
	// And at genuinely zero open there IS no settled line to describe.
	assert.equal(
		queue.askBarText(queue.askQueueView(null)),
		"No asks outstanding",
	);
});

test("the settled frame keeps the question ID, so two identical texts cannot collide", () => {
	const two = ask({
		ask_id: "a-dup",
		questions: [
			{ id: "first", question: "Same text" },
			{ id: "second", question: "Same text" },
		],
		answers: { first: ["yes"] },
		status: "answered",
	});
	const rows = queue.askSettledAnswers(two);
	assert.deepEqual(
		rows.map((row) => row.id),
		["first", "second"],
	);
	assert.deepEqual(rows[0].answers, ["yes"]);
	// A question nobody answered is present with an EMPTY list, which is the
	// caller's cue to say so rather than to leave a gap.
	assert.deepEqual(rows[1].answers, []);
});

/* ------------------------------------------------------- refusal sentences ---- */

test("the app's own refusal sentence is chosen by the state, and both constants are named", () => {
	// QA round 2, Q-2: neither constant was reachable, and nothing in the repo
	// named either - which is how a green suite sat beside a dead branch. These
	// assertions are the rig that names them.
	assert.equal(
		queue.askRefusalFallback({ status: 410 }),
		queue.ASK_EXPIRED_MESSAGE,
	);
	assert.equal(
		queue.askRefusalFallback({ code: "expired" }),
		queue.ASK_EXPIRED_MESSAGE,
	);
	assert.equal(
		queue.askRefusalFallback({ status: 409 }),
		queue.ASK_ALREADY_SETTLED_MESSAGE,
	);
	// NULL is a real answer: a transport failure (no status) and a 404 ("no ask
	// with that id") are states neither constant describes, and inventing one would
	// be the app asserting a fact it does not have.
	assert.equal(queue.askRefusalFallback({}), null);
	assert.equal(queue.askRefusalFallback({ status: 404 }), null);
	assert.equal(queue.askRefusalFallback(new Error("offline")), null);
});

test("a refusal WITH the owner's sentence keeps it; without one, the app says the state", () => {
	// The owner's words cross the wire as `detail` plus the message.
	const authored = new queue.DesktopControlError(
		409,
		"That ask was already answered by the phone.",
		undefined,
		"ask_settled",
		undefined,
		{ status: "answered" },
	);
	assert.equal(
		queue.askRefusalSentence(authored),
		"That ask was already answered by the phone.",
	);

	// NO SENTENCE: the message is the transport's placeholder, which describes the
	// transport rather than what happened - the defect this selection exists to fix
	// (round 1's version passed the choice as `userFacingMessage`'s FALLBACK
	// argument, which that helper never consults for a DesktopControlError).
	const bare = new queue.DesktopControlError(
		409,
		"This server did not answer the request for its desktop controls.",
	);
	assert.equal(
		queue.askRefusalSentence(bare),
		queue.ASK_ALREADY_SETTLED_MESSAGE,
	);
	const expired = new queue.DesktopControlError(
		410,
		"This server did not answer the request for its desktop controls.",
	);
	assert.equal(queue.askRefusalSentence(expired), queue.ASK_EXPIRED_MESSAGE);
	// And an error the app cannot classify keeps the transport's own sentence
	// rather than borrowing one.
	assert.equal(
		queue.askRefusalSentence(new Error("socket closed")),
		"socket closed",
	);
});

test("the bar's announced name does not double a full stop", () => {
	const questionEndingInStop = queue.askQueueView({
		asks: [
			single({
				questions: [{ id: "k", question: "Paste the API key.", multi: false }],
			}),
		],
	});
	assert.equal(
		queue.askBarLabel(questionEndingInStop, false),
		"1 question waiting — Paste the API key. Expand to answer.",
	);
	// A `?` is one too - the case round 1's frame happened to carry, which is why
	// the doubling reached a release candidate unremarked (QA round 2, Q-3).
	assert.equal(
		queue.askBarLabel(questionEndingInStop, true),
		"1 question waiting — Paste the API key. Collapse.",
	);
	// A head with no question text: `askHeadline` supplies its own fallback, and the
	// assertion is about the STOP, not about that sentence.
	const questionless = queue.askQueueView({ asks: [ask({ questions: [] })] });
	const headless = queue.askBarLabel(questionless, false);
	assert.ok(headless.endsWith(". Expand to answer."), headless);
	assert.ok(!headless.includes(".."), headless);
});
