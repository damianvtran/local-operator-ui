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
			 * read without a DOM (see the chip clause's own note).
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
				/* THE WIRE'S REAL KEY SET: an option is exactly `{label, description}` and
				 * the recommendation is a QUESTION-level index into `options` as carried.
				 * The per-option `recommended: true` this fixture used to carry is residue
				 * of the defect `ask-recommended.tsx` records - a key no producer writes. */
				options: [{ label: "staging" }, { label: "production" }],
				recommended: 0,
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

test("a timed-out ask is LAPSED: still outstanding to the backend, read-only on this surface (D10, D11)", () => {
	// The pair the surfaces have to keep apart: the BACKEND's outstanding set folds
	// `timed_out` in (the tally and the chat path still count it), but the agent is no
	// longer WAITING on it and no surface offers a late answer any more (D10) - so the
	// row is `lapsed`: no answer, no decline.
	const open = queue.presentAsk(ask({ status: "open" }));
	assert.equal(open.waiting, true);
	assert.equal(open.movedOn, false);
	assert.equal(open.lapsed, false);
	assert.equal(open.canAnswer, true);
	assert.equal(open.canDecline, true);

	const timedOut = queue.presentAsk(ask({ status: "timed_out" }));
	assert.equal(
		timedOut.waiting,
		false,
		"the deadline passed; the agent moved on",
	);
	assert.equal(timedOut.movedOn, true);
	assert.equal(
		timedOut.open,
		true,
		"still in the backend's outstanding set: `asks_open` counts it (D10)",
	);
	assert.equal(timedOut.lapsed, true);
	assert.equal(timedOut.canAnswer, false, "a lapsed ask takes no late answer");
	assert.equal(timedOut.canDecline, false, "nor a decline");

	// Every terminal state is neither waiting nor moved on, and none is lapsed.
	for (const status of [
		"answered",
		"declined",
		"late",
		"dismissed",
		"expired",
	]) {
		const settled = queue.presentAsk(ask({ status }));
		assert.equal(settled.waiting, false, `${status} is settled`);
		assert.equal(settled.movedOn, false, `${status} is settled`);
		assert.equal(settled.lapsed, false, `${status} is settled, not lapsed`);
	}

	// `late` means the answer LANDED after the deadline and the model was told, so
	// its row must offer nothing - the reading this pair is most often confused with.
	const late = queue.presentAsk(
		ask({ status: "late", answers: { target: ["staging"] } }),
	);
	assert.equal(late.canAnswer, false);
	assert.equal(late.canDecline, false);
	assert.equal(late.open, false);
});

test("the queue view counts waiting and moved-on apart from the outstanding tally", () => {
	const view = queue.askQueueView({
		asks: [
			single({ ask_id: "a-open" }),
			single({ ask_id: "a-moved", status: "timed_out" }),
			single({ ask_id: "a-done", status: "answered" }),
		],
	});
	assert.equal(view.rows.length, 3);
	assert.equal(view.waiting, 1);
	assert.equal(view.movedOn, 1);
	// `open` stays the backend's OUTSTANDING set, which folds the moved-on half in -
	// the reason the split exists as its own pair of counts.
	assert.equal(view.open, 2);

	// A published tally wins over the derived count; the SPLIT is still the rows'.
	const truncated = queue.askQueueView({
		asks: [single({ ask_id: "a-open" })],
		asks_open: 5,
		asks_truncated: true,
	});
	assert.equal(truncated.open, 5);
	assert.equal(truncated.waiting, 1);
	assert.equal(truncated.movedOn, 0);
});

test("an unknown status is its own case, never coerced into `open`", () => {
	const unknown = queue.presentAsk(ask({ status: "something_new" }));
	assert.equal(unknown.status, "unknown");
	assert.equal(unknown.canAnswer, false);
	assert.equal(unknown.lapsed, false);
});

test("`delivering` is the recorded-and-undelivered reading, `answered` OR `late`", () => {
	assert.equal(
		queue.presentAsk(ask({ status: "answered", delivered: false })).delivering,
		true,
	);
	assert.equal(
		queue.presentAsk(ask({ status: "answered", delivered: true })).delivering,
		false,
	);
	/*
	 * THE `late` HALF IS §10's WINDOW TOO (agent review round 1 MAJOR = design round 1
	 * D2): the engine admits a revision for `answered` OR `late` with no response row
	 * (`asks/queue.py::_revision_decision`), so a flag that read `answered` alone filed a
	 * late-undelivered answer as settled history and hid the door on a revision §10
	 * accepts. DELIVERED is still history for both statuses.
	 */
	assert.equal(
		queue.presentAsk(ask({ status: "late", delivered: false })).delivering,
		true,
	);
	assert.equal(
		queue.presentAsk(ask({ status: "late", delivered: true })).delivering,
		false,
	);
	// A status with no recorded answer at all is neither, however the hint reads.
	assert.equal(
		queue.presentAsk(ask({ status: "open", delivered: false })).delivering,
		false,
	);
	assert.equal(
		queue.presentAsk(ask({ status: "timed_out", delivered: false })).delivering,
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
	// An absent FRAME is not a capable one: the surface must be able to tell "nobody
	// has answered yet" from "this runtime has no queued engine" (see the predicate's
	// own test below).
	assert.equal(view.published, false);
	// And the frame itself is UNREAD, which is a third fact again (remediation round
	// 1, D1): the resolved frame that publishes no engine carries `unread: false`,
	// and only this one is a progress state that will resolve.
	assert.equal(view.unread, true);
	const resolved = queue.askQueueView({ asks: null, asks_open: null });
	assert.equal(resolved.published, false);
	assert.equal(
		resolved.unread,
		false,
		"a runtime that answered with `no engine` is not a frame nobody has read",
	);
});

/*
 * THE WIRE FIX'S CAPABILITY READ, pinned where the whole lane reads it.
 *
 * Why this test exists: the drawer, the panel and the drawer's own auto-close all key
 * on this predicate now, and the rule it replaces (`sessionAsks(...) !== null`) is the
 * one that looked obviously correct - it WAS correct until the runtime started
 * publishing a live-but-empty queue as `asks` ABSENT with `asks_open: 0` present. A
 * regression to that reading is invisible in every populated test and turns a live,
 * empty engine into a dead one, which is the stuck-slot defect itself.
 */
test("the capability read is the presence of `asks` OR `asks_open`", () => {
	// A row list, however short.
	assert.equal(
		queue.askQueuePublished({ asks: [ask({ ask_id: "a-1" })] }),
		true,
	);
	// THE case the fix exists for: rows absent, tally present - and zero is a VALUE.
	assert.equal(queue.askQueuePublished({ asks: null, asks_open: 0 }), true);
	assert.equal(queue.askQueuePublished({ asks: null, asks_open: 3 }), true);
	// A frame that says neither: this runtime cannot answer at all.
	assert.equal(queue.askQueuePublished({ asks: null, asks_open: null }), false);
	// An unread frame cannot be a capable one either.
	assert.equal(queue.askQueuePublished(null), false);
	assert.equal(queue.askQueuePublished(undefined), false);
	/*
	 * A MALFORMED `asks` IS NOT A CAPABILITY, and the array check is what keeps the
	 * old read's conservatism: a frame that carried a string where rows belong must
	 * not be able to turn an unreadable frame into an affordance.
	 */
	assert.equal(queue.askQueuePublished({ asks: "nope" }), false);
});

/*
 * AND THE VIEW CARRIES IT, because the drawer's chrome reads the VIEW rather than the
 * frame: the count clause must not compose `All asks settled` over a queue nobody has
 * read, and the empty-but-live queue must fall through to it because for it the
 * verdict is true.
 */
test("a live-but-empty queue is a published zero, not an unread frame", () => {
	const live = queue.askQueueView({
		asks: null,
		asks_open: 0,
		asks_truncated: false,
	});
	assert.equal(
		live.published,
		true,
		"asks absent + asks_open present is a live engine",
	);
	assert.equal(
		live.asks,
		null,
		"the rows stay absent: there is nothing in the queue",
	);
	assert.equal(live.rows.length, 0);
	assert.equal(live.head, null);
	assert.equal(live.open, 0);
	assert.equal(queue.askDrawerCountClause(live), "All asks settled");

	// A published tally with no rows still states the backend's own count - the
	// lagging-frame case the chip's clause was fixed for, readable now that the
	// absent-asks branch no longer hard-codes zero.
	const lagging = queue.askQueueView({ asks: null, asks_open: 4 });
	assert.equal(lagging.published, true);
	assert.equal(lagging.open, 4);

	// And an unread frame is neither: no count, no verdict.
	const unread = queue.askQueueView(null);
	assert.equal(unread.unread, true);
	assert.equal(
		queue.askDrawerCountClause(unread),
		"",
		"the bar drops its clause while unresolved: the body names that fact once (D5)",
	);
	assert.equal(
		queue.askScopeLine("session", unread),
		"This conversation",
		"and the separator goes with the clause rather than dangling",
	);
});

/*
 * THE ROLLESS FRAME WITH A SURVIVING TALLY (remediation round 1, R1).
 *
 * `{asks: null, asks_open: N > 0}` is reachable and the runtime documents it as
 * deliberate: `_bound_asks_in_place` pops the whole row list (`asks` and
 * `asks_truncated`) and keeps `asks_open`, "the rows are absent, the capability signal
 * rides", on both the snapshot and the delta route. Every reader in the lane had to be
 * checked against it, because the frame is not empty and must not be treated as one:
 * the old code hard-coded `truncated: false` in this branch, rendered `No asks
 * outstanding` over the count, and CLOSED the drawer over answerable asks.
 */
test("a rowless frame with a surviving tally is neither empty nor truncated-free (R1)", () => {
	const clipped = queue.askQueueView({
		asks: null,
		asks_open: 4,
		asks_truncated: true,
	});
	assert.equal(
		clipped.published,
		true,
		"the tally is the capability, and it is here",
	);
	assert.equal(
		clipped.unread,
		false,
		"the runtime answered; this is not a pending read",
	);
	assert.equal(
		clipped.rows.length,
		0,
		"the rows are what the wire bound dropped",
	);
	assert.equal(
		clipped.open,
		4,
		"the tally is the statement of record for this frame",
	);
	assert.equal(
		clipped.truncated,
		true,
		"the frame's own truncation flag must survive the null branch, not be hard-coded false",
	);
	/*
	 * AND THE CLAUSE IS THE COUNT. `askChipCountClause` states the backend's tally when
	 * the split is unknowable - which it is here, there are no rows to split - so the bar
	 * and the panel's line cannot contradict one another about how many asks are out.
	 */
	assert.equal(queue.askDrawerCountClause(clipped), "4 outstanding");
	assert.equal(
		queue.askScopeLine("session", clipped),
		"This conversation · 4 outstanding",
	);

	// The same frame WITHOUT the flag is a different fact about the wire, and the flag
	// is carried rather than inferred.
	const untruncated = queue.askQueueView({ asks: null, asks_open: 4 });
	assert.equal(untruncated.truncated, false);

	// A live-but-EMPTY queue beside it: tally zero, nothing outstanding, and the settled
	// verdict IS this frame's to wear.
	const empty = queue.askQueueView({ asks: null, asks_open: 0 });
	assert.equal(queue.askDrawerCountClause(empty), "All asks settled");

	/*
	 * AND THE FLAG'S ONE LIVE EFFECT IS HERE (agent review round 2, R6). For a rowless
	 * frame with a NONZERO tally, `askSplitIsKnowable` is false whichever way this flag
	 * reads (`open` exceeds `waiting + movedOn` by the whole count), so the clause is `N
	 * outstanding` either way - the flag cannot change it. What it does change is a
	 * rowless frame with a ZERO tally: `0 outstanding` says the count is what this frame
	 * carries and its list is not, where `All asks settled` would claim the queue was
	 * read. Both are consistent with the untruncated frame above; this is the pair the
	 * comment in `askQueueView` now names.
	 */
	const clippedEmpty = queue.askQueueView({
		asks: null,
		asks_open: 0,
		asks_truncated: true,
	});
	assert.equal(clippedEmpty.truncated, true);
	assert.equal(
		queue.askDrawerCountClause(clippedEmpty),
		"0 outstanding",
		"a truncated zero-tally frame states its count rather than the settled verdict",
	);
	assert.equal(queue.askDrawerCountClause(empty), "All asks settled");
});

/*
 * THE THREE UNRESOLVED-LOOKING STATES ARE THREE FACTS (design round 1, D1).
 *
 * They share "no rows", and before this round two of them shared their COPY: a runtime
 * that publishes no queued engine rendered byte-for-byte as the in-flight read, so it
 * wore a progress claim that could never complete. (The path to that state is an OPEN
 * FLAG INHERITED from a runtime that does publish asks - agent review round 2, R7: the
 * header door's gate is `published`, which is false here, so no door in the app offers
 * it; an earlier version of this comment said the door was offered, which described the
 * live-but-EMPTY frame instead.) The copy is pinned here rather than in a frame because
 * this is the only instrument in CI that can hold the three side by side.
 */
test("unread, unavailable and empty are named apart, and none borrows another's clause", () => {
	const unread = queue.askQueueView(null);
	const unavailable = queue.askQueueView({ asks: null, asks_open: null });
	const empty = queue.askQueueView({ asks: null, asks_open: 0 });

	assert.equal(queue.askDrawerCountClause(unread), "");
	assert.equal(
		queue.askDrawerCountClause(unavailable),
		queue.ASK_DRAWER_UNAVAILABLE_CLAUSE,
	);
	assert.equal(queue.askDrawerCountClause(empty), "All asks settled");

	// The two unpublishable frames must not share a word: the first is a read in flight,
	// the second is a terminal answer about the runtime.
	assert.notEqual(
		queue.ASK_DRAWER_UNAVAILABLE_LINE,
		queue.ASK_DRAWER_UNREAD_LINE,
	);
	assert.equal(
		queue.askScopeLine("fleet", unavailable),
		"All conversations · Asks unavailable",
	);
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

test("a secret answer travels as the typed value, and an empty field is a skip", () => {
	const secret = ask({
		ask_id: "a-sec",
		questions: [
			{ id: "DEPLOY_TOKEN", question: "Paste the token.", secret: true },
			{ id: "env", question: "Which environment?" },
		],
	});
	// An EMPTY field is the user skipping the secret (the TUI's field skips on Esc):
	// the id still rides the body, as the backend's own spelling of a skip - an EMPTY
	// LIST - because a map missing a question id is refused whole, and a blank string
	// would be a value. The backend reports it to the model as `<not provided>`.
	assert.deepEqual(queue.askAnswerMap(secret, { env: ["staging"] }, {}), {
		env: ["staging"],
		DEPLOY_TOKEN: [],
	});
	assert.deepEqual(
		queue.askAnswerMap(secret, { env: ["staging"] }, { DEPLOY_TOKEN: "   " }),
		{ env: ["staging"], DEPLOY_TOKEN: [] },
		"whitespace is not a value either",
	);
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
	// Skipping the secret does not make the OTHER questions optional.
	assert.equal(queue.askAnswerMap(secret, {}, {}), null);
});

test("an Other answer beside an empty optional secret can be sent (the operator's ask)", () => {
	// Regression: the reported card - a choice answered through Other plus a secret
	// whose prompt says "otherwise skip" - kept Send disabled, because every secret
	// was mandatory.
	const voice = ask({
		ask_id: "a-voice",
		questions: [
			{
				id: "voice",
				question: "How should the POC prove the voice path?",
				options: [
					{ label: "Skip voice for now" },
					{ label: "I'll provide a DashScope key" },
				],
			},
			{
				id: "DASHSCOPE_API_KEY",
				question: "Paste the key here (otherwise skip).",
				secret: true,
			},
		],
	});
	assert.deepEqual(
		queue.askAnswerMap(voice, { voice: ["Look at alternatives"] }, {}),
		{ voice: ["Look at alternatives"], DASHSCOPE_API_KEY: [] },
	);
	assert.equal(
		queue.askDraftIsComplete(voice, { voice: ["Look at alternatives"] }, {}),
		true,
	);
	// The pending-empty-Other rule is unchanged by the skip: an Other that is open
	// but blank still holds its question open.
	assert.equal(queue.askAnswerMap(voice, { voice: [""] }, {}), null);
});

test("an ask of only secrets, all left empty, is not sendable (Decline says that)", () => {
	const keys = ask({
		ask_id: "a-keys",
		questions: [
			{ id: "A_KEY", question: "Paste A.", secret: true },
			{ id: "B_KEY", question: "Paste B.", secret: true },
		],
	});
	assert.equal(queue.askAnswerMap(keys, {}, {}), null);
	assert.equal(queue.askDraftIsComplete(keys, {}, {}), false);
	// One typed value is a real answer; the other secret is then a skip.
	assert.deepEqual(queue.askAnswerMap(keys, {}, { B_KEY: "v" }), {
		A_KEY: [],
		B_KEY: ["v"],
	});
});

test("the secret field offers a skip only where leaving it empty could still send", () => {
	const key = { id: "K", question: "Paste the key.", secret: true };
	const other = { id: "L", question: "Paste the other key.", secret: true };
	const choice = { id: "env", question: "Which environment?" };
	const placeholder = (questions, recorded) =>
		queue.askSecretPlaceholder(ask({ questions }), key, recorded);
	assert.equal(placeholder([choice, key]), queue.ASK_SECRET_SKIP_PLACEHOLDER);
	// Another SECRET can carry the one real answer, so this one may be skipped.
	assert.equal(placeholder([key, other]), queue.ASK_SECRET_SKIP_PLACEHOLDER);
	// Alone, an empty field can never send: main's copy, and Decline is the way out.
	assert.equal(placeholder([key]), queue.ASK_SECRET_PLAIN_PLACEHOLDER);
	assert.equal(
		placeholder([key], { K: ["<not provided>"] }),
		queue.ASK_SECRET_PLAIN_PLACEHOLDER,
		"the change form of a secret-only ask recorded as a skip",
	);
	// Over a stored key the requirement wins, whatever else is on the ask.
	assert.equal(
		placeholder([choice, key], { env: ["staging"], K: ["K"] }),
		queue.ASK_SECRET_RETYPE_PLACEHOLDER,
	);
});

test("the change form keeps a stored secret: retype it unless the recorded answer was a skip", () => {
	const secret = ask({
		ask_id: "a-rev",
		questions: [
			{ id: "env", question: "Which environment?" },
			{ id: "DEPLOY_TOKEN", question: "Paste the token.", secret: true },
		],
	});
	const draft = { env: ["production"] };
	// RECORDED AS A STORED KEY: an empty field here is the user editing another answer,
	// not skipping - sending `[]` would turn the stored key into `<not provided>` - so
	// the value has to be typed again, as it always had to.
	const stored = { env: ["staging"], DEPLOY_TOKEN: ["DEPLOY_TOKEN"] };
	assert.equal(queue.askSecretIsSkippable(secret.questions[1], stored), false);
	assert.equal(queue.askAnswerMap(secret, draft, {}, stored), null);
	assert.equal(
		queue.askQuestionIsAnswered(secret.questions[1], draft, {}, stored),
		false,
		"Enter's next-unanswered walk lands on it",
	);
	assert.deepEqual(
		queue.askAnswerMap(secret, draft, { DEPLOY_TOKEN: "new" }, stored),
		{
			env: ["production"],
			DEPLOY_TOKEN: ["new"],
		},
	);
	// RECORDED AS A SKIP (an empty cell, or the backend's `<not provided>`): it may stay
	// skipped, so changing the other answer needs nothing typed into the secret.
	for (const skipped of [[], [queue.ASK_SECRET_NOT_PROVIDED]]) {
		const recorded = { env: ["staging"], DEPLOY_TOKEN: skipped };
		assert.equal(
			queue.askSecretIsSkippable(secret.questions[1], recorded),
			true,
		);
		assert.deepEqual(queue.askAnswerMap(secret, draft, {}, recorded), {
			env: ["production"],
			DEPLOY_TOKEN: [],
		});
	}
	// A recorded map with NO cell for the question is not evidence of a skip.
	assert.equal(queue.askSecretIsSkippable(secret.questions[1], {}), false);
	// The first answer has nothing recorded to keep.
	assert.equal(queue.askSecretIsSkippable(secret.questions[1]), true);
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
		"Timed out after 15m — the agent goes ahead without your answer (ask a-1)",
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

test("the status-row item's clause reads one state at a time", () => {
	/*
	 * THE COUNT HALF, asserted alone. What the chip PAINTS is this half plus the
	 * countdown (`askChipClause`), which is the next test's subject and the reason
	 * these assertions moved to `askChipCountClause`: one test, one fact.
	 */
	// ONE WAITING: the attention register - the only state that steps the ink.
	const one = queue.askQueueView({ asks: [single({ ask_id: "a-1" })] });
	assert.equal(queue.askChipCountClause(one), "1 question waiting");

	// The `N` form, which has to sit beside `2 wakes armed` without shouting.
	const two = queue.askQueueView({
		asks: [single({ ask_id: "a-1" }), single({ ask_id: "a-2" })],
	});
	assert.equal(queue.askChipCountClause(two), "2 questions waiting");

	// TIMED OUT: quiet, and the badge's own word (design round 1 on #1116, D2): the
	// agent is not waiting on it and no surface answers it.
	const moved = queue.askQueueView({
		asks: [single({ ask_id: "a-1", status: "timed_out" })],
	});
	assert.equal(queue.askChipCountClause(moved), "1 question timed out");
	assert.equal(
		queue.askChipCountClause(
			queue.askQueueView({
				asks: [
					single({ ask_id: "a-1", status: "timed_out" }),
					single({ ask_id: "a-2", status: "timed_out" }),
				],
			}),
		),
		"2 questions timed out",
	);
	// An answer still being delivered is the user's to change, so it outranks a
	// timed-out ask nobody can act on (the clause's own "actionable first" order).
	assert.equal(
		queue.askChipCountClause(
			queue.askQueueView({
				asks: [
					single({ ask_id: "a-1", status: "timed_out" }),
					single({ ask_id: "a-2", status: "answered" }),
				],
			}),
		),
		"1 answer not yet delivered — you can still change it",
	);

	// SETTLED: the queue is finished, and it stays on screen like a resolved plan.
	// `delivered: true` is what makes it finished: the response row exists, so the
	// agent has been handed the answer and the row is pinned (#1936, §10).
	const settled = queue.askQueueView({
		asks: [single({ ask_id: "a-1", status: "answered", delivered: true })],
	});
	assert.equal(queue.askChipCountClause(settled), "All asks settled");

	// ANSWERED BUT NOT DELIVERED: the user answered and the agent has NOT been
	// handed it, so the row still carries the change affordance — which makes
	// `All asks settled` the one sentence this queue must not take, because it
	// would contradict the panel the chip opens (§10, #1936).
	const delivering = queue.askQueueView({
		asks: [single({ ask_id: "a-1", status: "answered" })],
	});
	assert.equal(
		queue.askChipCountClause(delivering),
		"1 answer not yet delivered — you can still change it",
	);

	// TRUNCATED: the backend's own outstanding tally, never a prefix's split.
	const truncated = queue.askQueueView({
		asks: [single({ ask_id: "a-1" })],
		asks_open: 12,
		asks_truncated: true,
	});
	assert.equal(queue.askChipCountClause(truncated), "12 outstanding");
});

test("the item's clause never claims a split the frame cannot know", () => {
	/*
	 * A LAGGING TALLY (agent review round 1, F2). `view.open` is the backend's own
	 * count - the number the sidebar's outstanding chip reads - and a frame may carry
	 * fewer rows than it says, without the `truncated` flag. Reading only the rows let
	 * this clause say `All asks settled` beside a sidebar reading `2 outstanding`,
	 * which is the one thing the module's own header forbids two surfaces doing.
	 */
	const lagging = queue.askQueueView({
		asks: [single({ ask_id: "a-1", status: "answered" })],
		asks_open: 2,
	});
	assert.equal(queue.askChipCountClause(lagging), "2 outstanding");
	assert.equal(
		queue.askChipLabel(lagging, false, TS),
		"Expand this conversation's asks — 2 outstanding",
	);

	// The same rule over a MIXED frame: the split is not stated when the tally is
	// louder, and the announced name carries the tally instead of the split.
	const mixedLagging = queue.askQueueView({
		asks: [
			single({ ask_id: "a-1" }),
			single({ ask_id: "a-2", status: "timed_out" }),
		],
		asks_open: 5,
	});
	assert.equal(queue.askChipCountClause(mixedLagging), "5 outstanding");
	assert.equal(
		queue.askChipLabel(mixedLagging, false, TS),
		"Expand this conversation's asks — 5 outstanding",
	);

	// A tally that matches the rows changes nothing: the split is stated as before.
	const exact = queue.askQueueView({
		asks: [
			single({ ask_id: "a-1" }),
			single({ ask_id: "a-2", status: "timed_out" }),
		],
		tasks_open: 2,
	});
	assert.equal(queue.askChipCountClause(exact), "1 question waiting");
	assert.equal(
		queue.askChipLabel(exact, false, TS),
		"Expand this conversation's asks — 1 question waiting · expires in 1h · 1 timed out",
	);

	/*
	 * AN UNDELIVERED ANSWER BESIDE A TIMED-OUT ASK (QA round 2 on #1116, Q-2): the chip
	 * leads with the delivering clause, and the announced name still carries the
	 * timed-out tail rather than dropping the row a screen-reader user cannot see.
	 */
	const deliveringBeside = queue.askQueueView({
		asks: [
			single({ ask_id: "a-1", status: "answered", delivered: false }),
			single({ ask_id: "a-2", status: "timed_out" }),
		],
	});
	assert.equal(
		queue.askChipLabel(deliveringBeside, false, TS),
		"Expand this conversation's asks — 1 answer not yet delivered — you can still change it · 1 timed out",
	);
});

/*
 * THE DOOR'S OWN NAME (QA round 2, Q2-1; the rail's since #896, renamed with the
 * ASK_RAIL_ITEM_SELECTOR move so no export keeps naming a place the control left).
 * It was composed inline in
 * `chat-header.tsx`, so the promise this lane makes about it - no two asks controls can
 * be one string (UX round 1, U3) - had no CI instrument; the only `Open asks` under
 * `scripts/` was a stand-in's `textContent`. The four shapes below are the contract now,
 * including the one the promise is about: the quiet state still carries its scope, which
 * is what keeps it distinct from the drawer's own dismiss. The rail prints this string
 * as its tooltip (`panel-rail-model.ts`'s `askRailLabels`), which is why the sentence
 * must stay a single derivation rather than a copy.
 */
test("the rail door's name carries its verb, its scope and the count it stands for", () => {
	assert.equal(
		queue.askRailToggleLabel({ open: false, scope: "session", count: 1 }),
		"Open asks \u2014 This conversation, 1 waiting",
	);
	assert.equal(
		queue.askRailToggleLabel({ open: true, scope: "fleet", count: 2 }),
		"Close asks \u2014 All conversations, 2 waiting",
	);
	/*
	 * AT ZERO IT STILL NAMES ITS SCOPE, which is the U3 remediation stated as a string:
	 * the bare `Close asks` it used to fall back to is the drawer's own dismiss' name,
	 * two controls for two different acts.
	 */
	assert.equal(
		queue.askRailToggleLabel({ open: false, scope: "session", count: 0 }),
		"Open asks \u2014 This conversation",
	);
	assert.equal(
		queue.askRailToggleLabel({ open: true, scope: "fleet", count: 0 }),
		"Close asks \u2014 All conversations",
	);
	assert.notEqual(
		queue.askRailToggleLabel({ open: true, scope: "session", count: 0 }),
		"Close asks",
		"the rail door must never be the same string as the pane's own dismiss",
	);
});

test("the item's announced name leads with its action and carries the whole clause", () => {
	const one = queue.askQueueView({ asks: [single({ ask_id: "a-1" })] });
	assert.equal(
		queue.askChipLabel(one, false, TS),
		"Expand this conversation's asks — 1 question waiting · expires in 1h",
	);
	assert.equal(
		queue.askChipLabel(one, true, TS),
		"Collapse this conversation's asks — 1 question waiting · expires in 1h",
	);

	/*
	 * A MIXED queue is the one case where the announced name says MORE than the
	 * chip: the visible text stays the short waiting clause (a chip is a register),
	 * and the split a mixed queue needs is spelled in the name alone. The visible
	 * text must remain a substring of the name, which is what keeps the two readers
	 * describing one state.
	 */
	const mixed = queue.askQueueView({
		asks: [
			single({ ask_id: "a-1" }),
			single({ ask_id: "a-2", status: "timed_out" }),
		],
	});
	assert.equal(
		queue.askChipClause(mixed, TS),
		"1 question waiting · expires in 1h",
	);
	assert.equal(
		queue.askChipLabel(mixed, false, TS),
		"Expand this conversation's asks — 1 question waiting · expires in 1h · 1 timed out",
	);
	/*
	 * THE COUNTDOWNS DO NOT BREAK THE ONE-SENTENCE RULE: the name appends the
	 * moved-on half AFTER the visible clause rather than inserting it between the
	 * counts, so the visible text is still a prefix of the announced one - with the
	 * deadline in it - in the case where the two readers differ most.
	 */
	assert.ok(
		queue
			.askChipLabel(mixed, false, TS)
			.includes(queue.askChipClause(mixed, TS)),
	);

	// The split is NOT stated over a truncated frame, where it is a prefix's.
	const mixedTruncated = queue.askQueueView({
		asks: [
			single({ ask_id: "a-1" }),
			single({ ask_id: "a-2", status: "timed_out" }),
		],
		asks_open: 7,
		asks_truncated: true,
	});
	assert.equal(
		queue.askChipLabel(mixedTruncated, false, TS),
		"Expand this conversation's asks — 7 outstanding",
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

test("only a transport failure earns a Retry; a pairing refusal does not (U2)", () => {
	/*
	 * THE CLASSIFICATION AND THE RETRY DECISION MUST AGREE. UX review round 2's U2
	 * measured the failure row pairing "the server does not accept this app's desktop
	 * controls" with an ENABLED Retry: a 503 on /v1/desktop/ is `pairing.plane-closed`
	 * in the contract, so the sentence and the control contradicted each other.
	 *
	 * BOTH SIDES ARE PINNED. Suppressing Retry on every refusal code would take the
	 * one state that HAS a working next action (`transport.failed` - main could not
	 * complete the request, so nothing was learned about the plane) and give it none.
	 */
	const refused = (code, message) =>
		new queue.DesktopControlError(503, message, undefined, code);
	for (const code of [
		"pairing.plane-closed",
		"pairing.refused",
		"pairing.no-credential",
	])
		assert.equal(
			queue.askFailureEarnsRetry(refused(code, "refused")),
			false,
			`${code} is a pairing condition, so the sentence is the whole answer`,
		);
	assert.equal(
		queue.askFailureEarnsRetry(
			refused(
				"transport.failed",
				"The backend could not complete this request. Check its connection and try again.",
			),
		),
		true,
		"a transport failure is the press a Retry repairs",
	);
	/* No code at all: the renderer's own catch (the request never left), and a plain
	 * 404 ("no ask with that id"). Neither is a statement about the plane. */
	assert.equal(queue.askFailureEarnsRetry(new Error("socket closed")), true);
	assert.equal(queue.askFailureEarnsRetry({ status: 404 }), true);
	/* And the owner's own verdict stays final, as it was before this change. */
	assert.equal(
		queue.askFailureEarnsRetry(
			new queue.DesktopControlError(
				409,
				"That ask was already answered by the phone.",
			),
		),
		false,
	);
});

test("the item's name never doubles a mark, and its clause is the model's one spelling", () => {
	// The name is composed from the model's own clause, so what the chip PAINTS and
	// what a screen reader is told cannot be two different sentences - the defect the
	// bar's version of this test was written for.
	const questionless = queue.askQueueView({ asks: [ask({ questions: [] })] });
	const name = queue.askChipLabel(questionless, false, TS);
	assert.equal(
		name,
		"Expand this conversation's asks — 1 question waiting · expires in 1h",
	);
	assert.ok(!name.includes(".."), name);
	// And the visible text is always inside the announced one.
	assert.ok(name.includes(queue.askChipClause(questionless, TS)));
});

/* ------------------------------------------- the composer and a secret ask ---- */

test("a SECRET-ONLY ask refuses the main box; any fillable question leaves it ordinary", () => {
	// A credential-safety rule, not routing (the routing is retired - the main box is
	// an ordinary chat box in every state; `ask-composer-no-routing.test.mjs`). With a
	// secret-only ask open, an ordinary box is where a typed credential would become a
	// chat message, so the box refuses instead and the panel's masked field is the only
	// door for the value.
	const fillable = queue.askQueueView({
		asks: [
			single({
				questions: [{ id: "t", question: "Which?", options: [{ label: "a" }] }],
			}),
		],
	});
	assert.equal(queue.askComposerHoldsSecret(fillable), false);

	const secretOnly = queue.askQueueView({
		asks: [
			single({
				questions: [{ id: "k", question: "Paste the key", secret: true }],
			}),
		],
	});
	assert.equal(
		queue.askComposerHoldsSecret(secretOnly),
		true,
		"the box shows the notice and guards the send",
	);

	// Mixed: the secret question has its own masked field in the panel; the box
	// stays ordinary because the ask has a fillable question the user can answer
	// without it.
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
	assert.equal(queue.askComposerHoldsSecret(mixed), false);

	// A settled ask has nothing left to protect, and an emptied queue never refuses.
	const settled = queue.askQueueView({
		asks: [
			single({
				status: "late",
				delivered: true,
				answers: { target: ["staging"] },
				questions: [{ id: "k", question: "Paste the key", secret: true }],
			}),
		],
	});
	assert.equal(queue.askComposerHoldsSecret(settled), false);
	assert.equal(
		queue.askComposerHoldsSecret(queue.askQueueView({ asks: [] })),
		false,
	);
	assert.equal(queue.askComposerHoldsSecret(queue.askQueueView(null)), false);
});

/* ------------------------------------------------------------- the claim ---- */

const targetInside = (selector) => ({
	closest: (asked) => (asked === selector ? {} : null),
});
const targetInsideNothing = { closest: () => null };

test("the Escape claim is ours over the ask panel, the item that opens it, and the composer box", () => {
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
		"the ask panel is ours",
	);
	/*
	 * AND THE TRIGGER, as its own clause (UX round 1, U3): the item no longer carries
	 * `data-lo-ask-surfaces` - that marker is the panel's, so a rig can trust it as an
	 * "is the panel open?" probe - and an Escape with the keyboard on the chip must
	 * still collapse what the chip opened.
	 */
	assert.notEqual(
		queue.ASK_SURFACE_SELECTOR,
		queue.ASK_ITEM_SELECTOR,
		"the panel's marker and the trigger's handle are two handles",
	);
	assert.equal(
		queue.askClaimsEscape({
			...base,
			target: targetInside(queue.ASK_ITEM_SELECTOR),
		}),
		true,
		"the row item that expands the panel is ours",
	);
	assert.equal(
		queue.askClaimsEscape({
			...base,
			target: targetInside(queue.COMPOSER_TEXTAREA_SELECTOR),
		}),
		true,
		"the composer box is ours - Escape there collapses the drawer rather than falling through to the turn's interrupt",
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

test("the item states the soonest WAITING deadline, and refuses when the split is not knowable", () => {
	/*
	 * THE OPERATOR'S OWN QUESTION OF THE SURFACE - "when will it time out?" - and the
	 * audit's third item. The strip this item replaced answered it on its collapsed
	 * face; the move into the status row lost the answer, and this is the rehome.
	 */
	const one = queue.askQueueView({
		asks: [single({ expires_at: TS + 30 * 60_000 })],
	});
	assert.equal(queue.askChipDeadline(one, TS), "expires in 30m");
	assert.equal(
		queue.askChipClause(one, TS),
		"1 question waiting · expires in 30m",
	);

	/*
	 * TWO WINDOWS, ONE NUMBER: with more than one waiting ask the bare reading names
	 * no subject and would be read as whichever ask the reader had in mind, so it is
	 * qualified (design round 1's D2, re-expressed for a chip that names no ask). The
	 * number is the soonest one's, not the older one's the panel lists first.
	 */
	const two = queue.askQueueView({
		asks: [
			single({ ask_id: "a-a", expires_at: TS + 120 * 60_000 }),
			single({
				ask_id: "a-b",
				created_at: TS + 60_000,
				expires_at: TS + 12 * 60_000,
			}),
		],
	});
	assert.equal(queue.askChipDeadline(two, TS), "soonest ask expires in 12m");
	/*
	 * THE TWO PIECES THE ROW RENDERS SEPARATELY, pinned here so the yield order cannot
	 * drift from the string a DOM-free rig reads: the number is what the surface exists
	 * to answer and the subject is the unbounded half that drops first at a narrow
	 * column (design round 3's D2). The subject is a HEAD NOUN - `soonest ask`, not a
	 * bare `soonest` - which is what design round 3's D4 asked for.
	 */
	assert.equal(queue.askChipDeadlineText(two, TS), "expires in 12m");
	assert.equal(queue.askChipDeadlineSubject(two), "soonest ask");
	/*
	 * AND THE SAME DEADLINE IN THE NARROW BAND'S FORM (design round 4's MAJOR): the
	 * chip's third tier keeps the VALUE where the sentence cannot fit whole, so the
	 * number a reader triages on is never a `4...` that could be four minutes or
	 * forty-eight. One reading of the clock feeds both spellings - the assertion that
	 * pins that is that they agree on the same instant, in the same unit.
	 */
	assert.equal(queue.askChipDeadlineShort(two, TS), "12m");
	assert.equal(queue.askDeadlineShortText(TS + 30 * 60_000, TS), "30m");
	assert.equal(queue.askDeadlineShortText(TS + 45_000, TS), "45s");
	assert.equal(queue.askDeadlineShortText(TS + 3 * 3_600_000, TS), "3h");
	assert.equal(queue.askDeadlineShortText(TS + 2 * 86_400_000, TS), "2d");
	assert.equal(queue.askDeadlineShortText(TS, TS), "now");
	// The long form and the short form come out of ONE reading: no unit can disagree.
	for (const at of [TS + 45_000, TS + 30 * 60_000, TS + 3 * 3_600_000]) {
		const long = queue.askDeadlineText(at, TS);
		const short = queue.askDeadlineShortText(at, TS);
		assert.equal(long, `expires in ${short}`, "the two spellings disagree");
	}
	// Gated exactly as the sentence is: no value while the split is unknowable.
	// One waiting ask needs no subject: the number is that ask's own.
	assert.equal(queue.askChipDeadlineSubject(one), "");
	assert.equal(
		queue.askChipClause(two, TS),
		"2 questions waiting · soonest ask expires in 12m",
	);

	// MOVED ON ONLY: nothing is waiting, so nothing is counting down.
	const moved = queue.askQueueView({ asks: [single({ status: "timed_out" })] });
	assert.equal(queue.askChipDeadline(moved, TS), null);
	// The value form is gated by the same rule, and says nothing with it.
	assert.equal(queue.askChipDeadlineShort(moved, TS), null);
	// A queue with nothing waiting has no subject to state either.
	assert.equal(queue.askChipDeadlineSubject(moved), "");

	/*
	 * A PREFIX CANNOT STATE A QUEUE-SCOPE COUNTDOWN (design round 1's D6), and the
	 * gate is the count's own: the wire caps the list, so a truncated frame states
	 * the backend's tally and no deadline, and a frame whose rows do not add up to
	 * the published count takes the same gate because its rows are missing rows too.
	 */
	const truncated = queue.askQueueView({
		asks: [single({ expires_at: TS + 30 * 60_000 })],
		asks_open: 12,
		asks_truncated: true,
	});
	assert.equal(queue.askChipDeadline(truncated, TS), null);
	assert.equal(queue.askChipClause(truncated, TS), "12 outstanding");
	const lagging = queue.askQueueView({
		asks: [single({ expires_at: TS + 30 * 60_000 })],
		asks_open: 4,
	});
	assert.equal(queue.askChipDeadline(lagging, TS), null);
});

test("the wire's `urgent` flag reaches the view, and only for the asks the item counts as waiting", () => {
	/*
	 * Urgency has been on the wire since the lane existed - the backend derives it
	 * from the window itself, `timeout <= 900` - and NO desktop surface ever painted
	 * it: a row with ten minutes left looked exactly like one with an hour (the
	 * audit's second item).
	 *
	 * WAITING, NOT OUTSTANDING. `open` deliberately includes `timed_out` (a late
	 * answer still reaches the agent), so scoping the cue to it would let a moved-on
	 * ask's stale urgency spend the row's one warning ink on a question nobody is
	 * waiting on. The predicate is the same set the countdown reads.
	 */
	assert.equal(
		queue.askQueueView({ asks: [ask({ urgent: true })] }).urgent,
		true,
	);
	assert.equal(
		queue.askQueueView({ asks: [ask({ urgent: false })] }).urgent,
		false,
	);
	assert.equal(
		queue.askQueueView({ asks: [ask({ urgent: true, status: "timed_out" })] })
			.urgent,
		false,
		"a moved-on ask's stale urgency is not the item's cue",
	);
	assert.equal(
		queue.askQueueView({ asks: [ask({ urgent: true, status: "answered" })] })
			.urgent,
		false,
	);
	/*
	 * AND THE CUE IS NOT COLOUR-ONLY: the urgency word is APPENDED to the announced
	 * name (design round 3's D5), because this control's `aria-label` overrides its
	 * content, so an `sr-only` span inside it would be announced to nobody. The
	 * visible clause stays a prefix of the name either way.
	 */
	const urgentOne = queue.askQueueView({ asks: [ask({ urgent: true })] });
	assert.equal(
		queue.askChipLabel(urgentOne, false, TS),
		"Expand this conversation's asks — 1 question waiting · expires in 1h · Urgent",
	);
	assert.ok(
		queue
			.askChipLabel(urgentOne, false, TS)
			.includes(queue.askChipClause(urgentOne, TS)),
	);
	// …and a queue with nothing urgent says nothing about urgency.
	assert.ok(
		!queue
			.askChipLabel(queue.askQueueView({ asks: [ask()] }), false, TS)
			.includes("Urgent"),
	);
});

/* ------------------------------------------------------------- the row's word ---- */

/*
 * The plural descriptor helper this block used to pin (`askStatusWords`) is DELETED,
 * with its test, because this PR removed its last production consumer (agent review
 * round 1, N2): the panel now prints one word per ROW on that row's own chip, so a
 * legend composed above the list names twice what the rows already say. What is
 * still worth pinning is the row's word, and the half of the old claim that was
 * load-bearing - that a `timed_out` ask can never reach the settled half at all,
 * which is a fact about the VIEW rather than about the copy.
 */
test("a row's word is the copy contract's, and a lapsed row collapses with the settled half (D11)", () => {
	const view = queue.askQueueView({
		asks: [
			single({ status: "declined" }),
			single({ ask_id: "a-moved", status: "timed_out" }),
			single({ ask_id: "a-answered", status: "answered", delivered: true }),
			single({ ask_id: "a-open", status: "open" }),
		],
	});
	/** The panel's own predicate (`askPanelHalves`): the rows it collapses. */
	const { pending, settled } = queue.askPanelHalves(view.rows);
	assert.deepEqual(
		pending.map((row) => row.ask.ask_id),
		["a-open"],
		"only the answerable ask is a card",
	);
	assert.deepEqual(
		[...new Set(settled.map((row) => queue.askStatusWord(row.status)))].sort(),
		["Answered", "Declined", "Timed out"],
		"the lapsed row wears the `Timed out` word on its collapsed line",
	);
	assert.ok(
		settled.some((row) => row.ask.ask_id === "a-moved"),
		"a `timed_out` row is lapsed, so it sits behind a badge like a declined one",
	);
	assert.equal(
		queue.ASK_STATUS_COPY.timed_out,
		"Timed out — the agent goes ahead without your answer",
		"the sentence no longer promises a late answer no surface offers (D10)",
	);
});

test("the composer's secret guard reads the oldest ANSWERABLE ask, never a lapsed head", () => {
	/*
	 * `head` is what `askComposerHoldsSecret` reads. A lapsed ask is older than any open
	 * one, so a head of "oldest outstanding" would be the lapsed row and its
	 * `canAnswer: false` would release the guard over a secret-only ask that IS open.
	 */
	const view = queue.askQueueView({
		asks: [
			single({ ask_id: "a-lapsed", status: "timed_out", created_at: TS }),
			single({
				ask_id: "a-secret",
				created_at: TS + 10,
				questions: [{ id: "k", question: "Paste the key", secret: true }],
			}),
		],
	});
	assert.equal(view.head?.ask.ask_id, "a-secret");
	assert.equal(queue.askComposerHoldsSecret(view), true);
	const lapsedOnly = queue.askQueueView({
		asks: [
			single({
				status: "timed_out",
				questions: [{ id: "k", question: "Paste the key", secret: true }],
			}),
		],
	});
	assert.equal(lapsedOnly.head, null, "nothing answerable, so no head");
	assert.equal(queue.askComposerHoldsSecret(lapsedOnly), false);
});

/* ------------------------------------------------------- the drawer's bar ---- */

test("the drawer's scope line counts answerable asks only, and still falls through", () => {
	const view = (asks, over = {}) => queue.askQueueView({ asks, ...over });
	// A mixed queue: one the agent waits on, one that timed out. The timed-out ask is a
	// settled row (D11), and settled rows are not in the title (design round 1 on
	// #1116, D2), so the bar says what the Pending half holds.
	const mixed = view([
		single({ status: "open" }),
		single({ ask_id: "a-moved", status: "timed_out" }),
	]);
	assert.equal(queue.askDrawerCountClause(mixed), "1 question waiting");
	assert.equal(
		queue.askScopeLine("session", mixed),
		"This conversation · 1 question waiting",
	);
	// Every single-state queue keeps the chip's own clause, so the two surfaces
	// cannot describe one queue differently when there is nothing to split.
	assert.equal(
		queue.askDrawerCountClause(view([single()])),
		"1 question waiting",
	);
	assert.equal(
		queue.askDrawerCountClause(
			view([single({ status: "answered", delivered: true })]),
		),
		"All asks settled",
	);
	// The undelivered half takes its own clause here too, so the drawer and the
	// chip it was opened from cannot describe one queue differently (§10, #1936).
	assert.equal(
		queue.askDrawerCountClause(view([single({ status: "answered" })])),
		"1 answer not yet delivered — you can still change it",
	);
	// A queue of only timed-out asks is a settled drawer, as the TUI's is.
	assert.equal(
		queue.askDrawerCountClause(view([single({ status: "timed_out" })])),
		"All asks settled",
	);
	// A truncated frame's split is a split of the visible prefix, so the drawer states
	// the backend's own tally exactly as the chip does.
	assert.equal(
		queue.askDrawerCountClause(
			view([single(), single({ ask_id: "a-2" })], {
				asks_open: 12,
				asks_truncated: true,
			}),
		),
		"12 outstanding",
	);
	// And the fleet scope is the same clause behind the other subject.
	assert.equal(
		queue.askScopeLine("fleet", view([single()])),
		"All conversations · 1 question waiting",
	);
});

test("the rail badge counts ANSWERABLE asks when the list is complete, the tally when it is not", () => {
	/*
	 * Complete list: a lapsed ask is read-only (D10), so it pulls no attention and the
	 * badge agrees with the fleet marks (`fleetAsksBySession`).
	 */
	const complete = queue.askQueueView({
		asks: [
			single({ ask_id: "a-open", status: "open" }),
			single({ ask_id: "a-lapsed", status: "timed_out" }),
		],
		asks_open: 2,
	});
	assert.equal(queue.askAttentionCount(complete), 1);
	const lapsedOnly = queue.askQueueView({
		asks: [single({ status: "timed_out" })],
		asks_open: 1,
	});
	assert.equal(
		queue.askAttentionCount(lapsedOnly),
		0,
		"a lapsed-only queue draws no badge",
	);
	/*
	 * Truncated, or a tally above the rows: only the tally is known, and some of the
	 * asks it counts are not in the list - so the badge keeps the tally. Over-counting a
	 * lapsed ask is the safe side of hiding a real open one.
	 */
	const truncated = queue.askQueueView({
		asks: [single({ status: "timed_out" })],
		asks_open: 5,
		asks_truncated: true,
	});
	assert.equal(queue.askAttentionCount(truncated), 5);
	const lagging = queue.askQueueView({
		asks: [single({ status: "timed_out" })],
		asks_open: 3,
	});
	assert.equal(queue.askAttentionCount(lagging), 3);
	assert.equal(queue.askAttentionCount(queue.askQueueView(null)), 0);
});

test("a row that lapses while the panel is mounted is HELD in place until the next mount (UX U1)", () => {
	const rows = (statusOfFirst) =>
		queue.askQueueView({
			asks: [
				single({ ask_id: "a-1", status: statusOfFirst, created_at: TS }),
				single({ ask_id: "a-2", created_at: TS + 10 }),
				single({
					ask_id: "a-old",
					status: "declined",
					created_at: TS - 10,
				}),
			],
		}).rows;
	// The mount saw a-1 answerable; it lapses under the reader's pointer.
	const held = new Set(["a-1", "a-2"]);
	const live = queue.askPanelHalves(rows("timed_out"), held);
	assert.deepEqual(
		live.pending.map((row) => row.ask.ask_id),
		["a-1", "a-2"],
		"the lapsed card keeps its slot above a-2, so a-2's controls do not move into it",
	);
	assert.equal(live.pending[0].canAnswer, false, "held, but read-only");
	assert.deepEqual(
		live.settled.map((row) => row.ask.ask_id),
		["a-old"],
	);
	// The next mount has seen nothing: the lapsed row files with the settled ones.
	const next = queue.askPanelHalves(rows("timed_out"));
	assert.deepEqual(
		next.pending.map((row) => row.ask.ask_id),
		["a-2"],
	);
	assert.deepEqual(
		next.settled.map((row) => row.ask.ask_id),
		["a-1", "a-old"],
	);
	// Only a LAPSED row is held: a settled one moves as it always did.
	const answered = queue.askPanelHalves(rows("declined"), held);
	assert.deepEqual(
		answered.pending.map((row) => row.ask.ask_id),
		["a-2"],
	);
});

/* -------------------------------------- the Put-in-secret-field wiring ---- */

/*
 * "PUT IN SECRET FIELD", AS ONE FUNCTION (agent review round 1, m3).
 *
 * The wiring used to live in two components: `chat-content.tsx` decided which
 * head to fill and built the payload map, `chat-page.tsx` mapped the answer's
 * status to "landed". Neither could be reached by a DOM-free test, and the jsdom
 * rig that mounts the composer mocks `onFill` - so the map shape, the trim, the
 * "the ask changed under the confirm" check and the `sent` mapping had no test
 * at all. `fillSecretField` is that body, extracted: the two components now pass
 * their head and their answer door in, and these cases drive the real thing.
 */

const secretQuestion = (over = {}) => ({
	id: "api_token",
	question: "Paste the API token.",
	options: [],
	multi: false,
	secret: true,
	...over,
});

const secretAskWith = (questions, over = {}) => ask({ questions, ...over });

test("the field a Put would land in is named by the ask AND its question", () => {
	const one = queue.askSecretField(secretAskWith([secretQuestion()]));
	assert.match(one.key, /^a-1:/, "the ask id is in the key");
	assert.match(one.key, /api_token$/, "and so is the question");
	assert.equal(one.questionId, "api_token");

	const two = queue.askSecretField(
		secretAskWith([secretQuestion(), secretQuestion({ id: "db_password" })]),
	);
	assert.equal(
		two.questionId,
		null,
		"two fields, so no single value names one",
	);
	assert.match(
		two.key,
		/\*$/,
		"and the key says so, so a change of shape retires a confirm",
	);

	const plain = queue.askSecretField(
		secretAskWith([secretQuestion({ secret: false })]),
	);
	assert.equal(
		plain.questionId,
		null,
		"a non-secret question is not a secret field",
	);
});

test("a Put posts the question's id, the trimmed value, and reports what happened", async () => {
	const head = { ask: secretAskWith([secretQuestion()]) };
	const key = queue.askSecretField(head.ask).key;
	const calls = [];
	const sent = await queue.fillSecretField(
		head,
		key,
		"  tok_123456789  ",
		async (id, answers) => {
			calls.push([id, answers]);
			return { status: "sent" };
		},
	);
	assert.equal(sent, "sent");
	assert.deepEqual(
		calls,
		[["a-1", { api_token: ["tok_123456789"] }]],
		"the wire body is the panel's own shape, trimmed exactly as `askAnswerMap` trims",
	);

	assert.equal(
		await queue.fillSecretField(head, key, "x1234567", async () => ({
			status: "refused",
		})),
		"refused",
	);
	assert.equal(
		await queue.fillSecretField(head, key, "x1234567", async () => ({
			status: "failed",
		})),
		"refused",
		"a transport failure is a refusal to the composer: the value did not land",
	);
	assert.equal(
		await queue.fillSecretField(head, key, "x1234567", async () => ({
			status: "locked",
		})),
		"locked",
		"and the lock keeps its own reason, so the composer can say which it is",
	);
	assert.equal(
		await queue.fillSecretField(head, key, "x1234567", async () => ({
			status: "unavailable",
		})),
		"unavailable",
	);
	assert.equal(
		await queue.fillSecretField(head, key, "x1234567", async () => undefined),
		"unavailable",
		"an answer door that cannot address the owner posts nothing",
	);
});

test("a Put whose ask changed posts NOTHING (the binding, QA round 1 Q2)", async () => {
	const calls = [];
	const fill = async (...args) => {
		calls.push(args);
		return { status: "sent" };
	};
	const head = { ask: secretAskWith([secretQuestion()], { ask_id: "a-2" }) };
	const armedKey = queue.askSecretField(
		secretAskWith([secretQuestion()], { ask_id: "a-1" }),
	).key;

	assert.equal(
		await queue.fillSecretField(head, armedKey, "tok_123456789", fill),
		"stale",
		"a value typed for one ask is not posted to whatever ask is head now",
	);
	assert.deepEqual(calls, [], "the answer door is never called");
	assert.equal(
		await queue.fillSecretField(null, armedKey, "tok_123456789", fill),
		"stale",
		"an ask that left the queue is the same refusal",
	);
	assert.deepEqual(calls, []);
});

test("a multi-secret ask is refused by the wiring, not guessed at", async () => {
	const calls = [];
	const head = {
		ask: secretAskWith([
			secretQuestion(),
			secretQuestion({ id: "db_password" }),
		]),
	};
	const key = queue.askSecretField(head.ask).key;
	assert.equal(
		await queue.fillSecretField(head, key, "tok_123456789", async (...args) => {
			calls.push(args);
			return { status: "sent" };
		}),
		"multi",
		"one value names no question, so nothing is posted",
	);
	assert.deepEqual(calls, []);
});
