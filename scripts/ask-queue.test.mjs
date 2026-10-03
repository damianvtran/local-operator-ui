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

test("the view separates the asks still waiting from the ones the agent moved on from", () => {
	/*
	 * THE AUDIT'S FIRST FINDING, pinned. `open` and `timed_out` are both
	 * outstanding on the wire (a late answer still lands), so the bar used to
	 * count both as "questions waiting" - telling the operator the agent was
	 * waiting on an ask whose deadline had passed and which the agent had walked
	 * past.
	 */
	const view = queue.askQueueView({
		asks: [
			single({ ask_id: "a-open", status: "open", created_at: TS + 10 }),
			single({ ask_id: "a-late", status: "timed_out", created_at: TS }),
		],
	});
	assert.equal(
		view.open,
		2,
		"both are outstanding, which is the backend's own set",
	);
	assert.equal(view.waiting, 1);
	assert.equal(view.movedOn, 1);
	assert.equal(
		queue.askCountLabel(view.waiting, view.movedOn),
		"1 question waiting · 1 moved on",
	);
	/*
	 * And the HEAD does not claim waiting for a timed-out ask: the moved-on row is
	 * OLDER here, and the head still names the waiting one. The bar's sentence and
	 * the question it names have to be about the same ask, or the bar answers the
	 * operator's "is it waiting on me" with one ask's count and another's text.
	 */
	assert.equal(view.head?.ask.ask_id, "a-open");
	assert.equal(
		queue.askBarText(view),
		"1 question waiting · 1 moved on — Which environment?",
	);
});

test("a queue of nothing but timed-out asks says the agent moved on", () => {
	/*
	 * The single-set case the split exists for: every ask has passed its deadline,
	 * the agent is waiting on none of them, and a late answer still reaches it. The
	 * old copy stated the opposite ("1 question waiting").
	 */
	const one = queue.askQueueView({
		asks: [single({ ask_id: "a-1", status: "timed_out" })],
	});
	assert.equal(one.waiting, 0);
	assert.equal(one.movedOn, 1);
	assert.equal(
		queue.askBarText(one),
		"1 question moved on — Which environment?",
	);

	const three = queue.askQueueView({
		asks: [
			single({ ask_id: "a-1", status: "timed_out" }),
			single({ ask_id: "a-2", status: "timed_out" }),
		],
	});
	assert.equal(
		queue.askBarText(three),
		"2 questions moved on — Which environment?",
	);
});

test("the bar reads the SOONEST waiting deadline, and never a moved-on one", () => {
	/*
	 * The collapsed bar's triage number (the audit's third finding). Scoped to the
	 * waiting asks: a timed-out ask's deadline is in the past, so surfacing it would
	 * print "expiring now" for the one state where the clock is no longer the
	 * question.
	 */
	const view = queue.askQueueView({
		asks: [
			ask({ ask_id: "a-far", status: "open", expires_at: TS + 3_600_000 }),
			ask({ ask_id: "a-soon", status: "open", expires_at: TS + 600_000 }),
			ask({ ask_id: "a-gone", status: "timed_out", expires_at: TS - 60_000 }),
		],
	});
	assert.equal(view.soonestExpiryMs, TS + 600_000);
	assert.equal(
		queue.askDeadlineText(view.soonestExpiryMs, TS),
		"expires in 10m",
	);
	// Nothing waiting: no reading, rather than a stale one from the moved-on row.
	assert.equal(
		queue.askQueueView({ asks: [ask({ status: "timed_out" })] })
			.soonestExpiryMs,
		null,
	);
	// An unreadable deadline is absent rather than zero.
	assert.equal(
		queue.askQueueView({ asks: [ask({ expires_at: undefined })] })
			.soonestExpiryMs,
		null,
	);
});

test("the wire's `urgent` flag reaches the view, and only while it is outstanding", () => {
	/*
	 * Urgency was carried on the wire and kept by the receipt fold, and NO desktop
	 * component painted it (the audit's second finding). The view now states it for
	 * the surfaces to spend, scoped to the rows someone can still act on.
	 */
	const urgentOpen = queue.askQueueView({ asks: [ask({ urgent: true })] });
	assert.equal(urgentOpen.urgent, true);
	assert.equal(
		queue.askQueueView({ asks: [ask({ urgent: false })] }).urgent,
		false,
	);
	/*
	 * WAITING, NOT OUTSTANDING (UX round 1's U1, design round 1's D1). A timed-out
	 * ask is still answerable and still counted, but its window has closed - amber
	 * for it spent the bar's one warning ink on the ask the operator can no longer
	 * catch.
	 */
	assert.equal(
		queue.askQueueView({ asks: [ask({ urgent: true, status: "timed_out" })] })
			.urgent,
		false,
		"a moved-on ask's stale urgency is not the bar's cue",
	);
	assert.equal(
		queue.askQueueView({ asks: [ask({ urgent: true, status: "answered" })] })
			.urgent,
		false,
		"a settled row's stale urgency is not a state anyone can act on",
	);
});

test("a truncated frame states the tally instead of splitting a prefix", () => {
	/*
	 * The split is knowable only for the rows a frame carries, and the wire's cap
	 * dropped the rest, so the bar falls back to the backend's OUTSTANDING tally -
	 * a word that claims neither half - with the "showing N of M" clause beside it
	 * saying what is on screen.
	 */
	const view = queue.askQueueView({
		asks: [single({ ask_id: "a-1", status: "open" })],
		asks_open: 9,
		asks_truncated: true,
	});
	assert.equal(view.truncated, true);
	assert.equal(queue.askBarText(view), "9 outstanding — Which environment?");
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
		queue.askBarLabel(questionEndingInStop, false, TS),
		"1 question waiting — Paste the API key. expires in 1h. Expand to answer.",
	);
	// A `?` is one too - the case round 1's frame happened to carry, which is why
	// the doubling reached a release candidate unremarked (QA round 2, Q-3).
	assert.equal(
		queue.askBarLabel(questionEndingInStop, true, TS),
		"1 question waiting — Paste the API key. expires in 1h. Collapse.",
	);
	// A head with no question text: `askHeadline` supplies its own fallback, and the
	// assertion is about the STOP, not about that sentence.
	const questionless = queue.askQueueView({ asks: [ask({ questions: [] })] });
	const headless = queue.askBarLabel(questionless, false, TS);
	assert.ok(headless.endsWith(". Expand to answer."), headless);
	assert.ok(!headless.includes(".."), headless);
});

test("the announced name carries the two facts the paint carries", () => {
	/*
	 * UX round 1's U2 and design round 1's D4, which are one defect: the deadline
	 * span and the amber were added in the JSX alone, so the button announced a
	 * state the screen was not in - the same class this component's own note
	 * records as fixed once already for the count.
	 */
	const urgent = queue.askQueueView({
		asks: [
			single({
				ask_id: "a-u",
				urgent: true,
				expires_at: TS + 18 * 60_000,
				questions: [{ id: "k", question: "Rotate the keys?", multi: false }],
			}),
		],
	});
	assert.equal(
		queue.askBarLabel(urgent, false, TS),
		"1 question waiting — Rotate the keys? expires in 18m. Urgent. Expand to answer.",
	);
	// The urgency WORD and the amber are one predicate, so a queue that paints no
	// amber can carry no urgency word either.
	const calm = queue.askQueueView({
		asks: [
			single({ questions: [{ id: "k", question: "Which?", multi: false }] }),
		],
	});
	assert.ok(!queue.askBarLabel(calm, false, TS).includes("Urgent"));
});

test("the deadline says whose it is, and refuses to when it cannot know", () => {
	/*
	 * DESIGN ROUND 1's D2 AND D6, both about the same habit: the bar prints a
	 * number beside ONE named question, so the number has to belong to it or say
	 * that it does not - and a queue-scope countdown cannot be read off the wire's
	 * cap-20 prefix at all.
	 */
	const one = queue.askQueueView({
		asks: [single({ expires_at: TS + 30 * 60_000 })],
	});
	// One waiting ask: the deadline IS the named ask's, so it is not qualified.
	assert.equal(queue.askBarDeadline(one, TS), "expires in 30m");

	const two = queue.askQueueView({
		asks: [
			single({
				ask_id: "a-a",
				expires_at: TS + 120 * 60_000,
				questions: [
					{ id: "d", question: "Deploy the staging release?", multi: false },
				],
			}),
			single({
				ask_id: "a-b",
				created_at: TS + 60_000,
				expires_at: TS + 12 * 60_000,
				questions: [
					{ id: "k", question: "Rotate the API keys now?", multi: false },
				],
			}),
		],
	});
	// The bar names the OLDER ask and the soonest is the OTHER one's, so the reading
	// is scoped rather than silently attached to the named question.
	assert.equal(
		queue.askBarText(two),
		"2 questions waiting — Deploy the staging release?",
	);
	assert.equal(queue.askBarDeadline(two, TS), "soonest expires in 12m");
	// A frame that carries a PREFIX prints no queue-scope countdown at all (D6);
	// the `showing N of M` clause is the disclosure the bar keeps instead.
	const trunc = queue.askQueueView({
		asks: [single({ expires_at: TS + 30 * 60_000 })],
		asks_open: 47,
		asks_truncated: true,
	});
	assert.equal(queue.askBarDeadline(trunc, TS), null);
	assert.ok(
		!queue.askBarLabel(trunc, false, TS).includes("expires"),
		"and says nothing about it",
	);
});

/* --------------------------------------------------- the composer's mode ---- */

test("an ask with a fillable question is the composer's mode; a SECRET-ONLY one is not", () => {
	// Agent review round 3, F3: `askAnswering` asked only `canAnswer`, so a
	// secret-only open ask promised an answer the Enter key cannot send - and,
	// because such an ask is deliberately not the composer's mode, an ordinary box
	// would have been the place a typed credential became a chat message.
	const fillable = queue.askQueueView({
		asks: [
			single({
				questions: [{ id: "t", question: "Which?", options: [{ label: "a" }] }],
			}),
		],
	});
	assert.equal(queue.askComposerAnswers(fillable), true);
	assert.equal(queue.askComposerHoldsSecret(fillable), false);

	const secretOnly = queue.askQueueView({
		asks: [
			single({
				questions: [{ id: "k", question: "Paste the key", secret: true }],
			}),
		],
	});
	assert.equal(
		queue.askComposerAnswers(secretOnly),
		false,
		"a plaintext box cannot fill it",
	);
	assert.equal(
		queue.askComposerHoldsSecret(secretOnly),
		true,
		"so the box must refuse instead",
	);

	// Mixed: the fillable question is what the composer is for; the secret one is
	// the panel's.
	const mixed = queue.askQueueView({
		asks: [
			single({
				questions: [
					{ id: "t", question: "Which?", options: [{ label: "a" }] },
					{ id: "k", question: "Paste the key", secret: true },
				],
			}),
		],
	});
	assert.equal(queue.askComposerAnswers(mixed), true);
	assert.equal(queue.askComposerHoldsSecret(mixed), false);
});

test("the mode STOPS answering when the last open ask settles (the F1 delta)", () => {
	// The defect: the swap keyed on the panel flag while the mode keyed on
	// answerability, so a queue that settled under an OPEN panel flipped the mode
	// without swapping - and the ask-buffer answer went out as a chat message.
	// Both now read THIS predicate, so the transition is one event.
	const open = queue.askQueueView({ asks: [single({ status: "open" })] });
	assert.equal(queue.askComposerAnswers(open), true);
	// Settled from the phone while the panel is open: `late` is terminal.
	const settled = queue.askQueueView({
		asks: [single({ status: "late", answers: { target: ["staging"] } })],
	});
	assert.equal(
		queue.askComposerAnswers(settled),
		false,
		"the mode's transition",
	);
	// An emptied queue reaches the same state.
	assert.equal(
		queue.askComposerAnswers(queue.askQueueView({ asks: [] })),
		false,
	);
	assert.equal(queue.askComposerAnswers(queue.askQueueView(null)), false);
});

/* ------------------------------------------------------------- the claim ---- */

const targetInside = (selector) => ({
	closest: (asked) => (asked === selector ? {} : null),
});
const targetInsideNothing = { closest: () => null };

test("the Escape claim is ours only over the ask surfaces and the composer box", () => {
	const base = { key: "Escape", target: null };
	// A press with no element target is delivered that way when the panel was the
	// only focus stop.
	assert.equal(queue.askClaimsEscape(base), true, "the body is ours");
	assert.equal(
		queue.askClaimsEscape({
			...base,
			target: targetInside(queue.ASK_SURFACE_SELECTOR),
		}),
		true,
		"the ask surfaces are ours",
	);
	assert.equal(
		queue.askClaimsEscape({
			...base,
			target: targetInside(queue.COMPOSER_TEXTAREA_SELECTOR),
		}),
		true,
		"the composer box is ours - it is the box this lane answers from",
	);
	// A deeper owner that cancels on Escape without calling `preventDefault` - the
	// sidebar's search, the directory indicator, the dictation cancel - must not
	// ALSO collapse the ask panel.
	assert.equal(
		queue.askClaimsEscape({ ...base, target: targetInsideNothing }),
		false,
		"another surface's own press is not ours",
	);
});

test("the Escape claim stands down on every signal that says someone else owns it", () => {
	const base = { key: "Escape", target: null };
	assert.equal(queue.askClaimsEscape({ ...base, key: "a" }), false);
	assert.equal(
		queue.askClaimsEscape({ ...base, isComposing: true }),
		false,
		"an IME cancel",
	);
	assert.equal(
		queue.askClaimsEscape({ ...base, defaultPrevented: true }),
		false,
		"already claimed",
	);
	// An open dialog/menu/listbox owns its keys: this is the measured
	// `Cmd-K then Escape` case, where the ask panel collapsed and the palette stayed.
	assert.equal(
		queue.askClaimsEscape({ ...base, target: targetInside('[role="dialog"]') }),
		false,
		"an overlay owns the press",
	);
});

/* ------------------------------------------------- Q-4: the string detail ---- */

test("an owner's sentence survives when the wire sends it as a STRING detail", () => {
	// QA round 3, Q-4: `desktopResult` stores `detail` only for an OBJECT body, so
	// the string shape left the field undefined and the owner's words were replaced
	// by the app's constant.
	const stringDetail = new queue.DesktopControlError(
		409,
		"That ask was already answered by the phone.",
	);
	assert.equal(
		queue.askRefusalSentence(stringDetail),
		"That ask was already answered by the phone.",
		"the string-detail shape keeps the owner's sentence",
	);
	// And the shapes that mean NOTHING crossed still get the app's sentence.
	const placeholder = new queue.DesktopControlError(
		409,
		"This server did not answer the request for its desktop controls.",
	);
	assert.equal(
		queue.askRefusalSentence(placeholder),
		queue.ASK_ALREADY_SETTLED_MESSAGE,
	);
	// A plain Error is a transport failure, not the backend's prose: its own message
	// is kept, never attributed to the server.
	assert.equal(
		queue.askRefusalSentence(new Error("socket closed")),
		"socket closed",
	);
});
