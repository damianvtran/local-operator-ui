import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE INDETERMINATE OUTCOME, END TO END ON THE CLIENT — the operator's report
 * that a queued ask was answered but they were told "The request could not be
 * confirmed.", and that answering asks often fails.
 *
 * The backend is not the defect and is not changed here: both of its busy arms
 * answer the retryable `503 {"code": "runtime_busy", "retryable": true,
 * "retry_after_ms": 2000}` and say a resend under the same request is safe. The
 * defect was on this side — `answerQueuedAsk` sent ONCE, so a lost
 * acknowledgement was reported to a user whose answer had landed.
 *
 * What these cases pin, and why none of them is a happy path:
 *
 * 1. **A busy press is repeated with the SAME request, and a success on the
 *    repeat is `sent`.** Same object, not merely an equal body: `withBusyResends`
 *    reuses the caller's request whole because the backend's receipt journal
 *    fingerprints the body (and, on `/answers`, the ask log's settle is keyed on
 *    it), so a resend that differed in one field would be a second intent.
 *
 * 2. **Exhausting the repeats reports the outcome as NOT CONFIRMED.** This is
 *    the copy half of the same bug: the backend's busy body carries the
 *    UNREACHABLE sentence ("Reconnect and reconcile before retrying"), which
 *    names the wire's noun, offers no control on this screen and tells the user
 *    to retry what the app has just retried three times. The classifier now
 *    speaks first on that arm and says the answer "isn't confirmed yet" — never
 *    that it "was not sent", which nothing establishes once the frame may have
 *    been written.
 *
 * 3. **A genuine refusal still fails on the FIRST attempt, untouched.** A 409
 *    "already answered by the phone" is the owner's verdict: repeating it would
 *    earn the same answer and would break the one-answer-in-flight rule's
 *    meaning. Asserted as the same error OBJECT (identity), so a classifier that
 *    wrapped or rewrote it would fail here too.
 *
 * 4. **The command path is deliberately NOT wrapped, and that is pinned.** See
 *    the note above `COMMAND_PATH` below: on `/v1/desktop/sessions/{id}/commands`
 *    a busy leaves the receipt claim unfinished and the route does not pass
 *    `retry_safe`, so a same-id resend is answered 409 "Request outcome is
 *    indeterminate" rather than replayed — and `useSessionCommand` classifies a
 *    bare 409 as a DEFINITE error, which would replace the honest warning with a
 *    claim that the switch did not run. Measured on the shipped journal (see the
 *    pull request); the source assertion is the guard, because the behaviour it
 *    forbids is a retry that looks reasonable in a diff.
 *
 * The modules are the REAL ones, bundled with esbuild; nothing here fakes a
 * classifier, a lock or the resend policy, because a stub of any of them would
 * let a wrong bound or a wrong disposition pass.
 */
const bundle = await build({
	stdin: {
		contents: [
			'export { answerQueuedAsk, createSendLock, answerOwnerIsBusy, ANSWER_BUSY_MESSAGE } from "./src/renderer/src/features/chat/ask-answer";',
			'export { askRefusalSentence } from "./src/renderer/src/features/chat/ask-queue";',
			'export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	loader: { ".css": "empty" },
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	/*
	 * React and the query client stay external for the reason the siblings record:
	 * the graph reaches both, and bundling `react-dom/server` makes esbuild's ESM
	 * output reach for a dynamic `require("stream")` it cannot satisfy.
	 */
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});

const bundlePath = new URL(
	`./_ask-busy-resend-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
/*
 * The bundle is removed even when it FAILS TO LOAD: the sibling suite records the
 * incident where a broken alias left the artifact sitting in `scripts/`.
 */
let shipped;
try {
	shipped = await import(bundlePath.href);
} finally {
	await unlink(bundlePath);
}
const {
	answerQueuedAsk,
	createSendLock,
	answerOwnerIsBusy,
	ANSWER_BUSY_MESSAGE,
	askRefusalSentence,
	DesktopControlError,
} = shipped;

const SESSION = "4f2a9c1e8b7d";
const ASK = "a-7039";

/**
 * The backend's busy body, built the way the wire builds it: 503, the code, and
 * the `retry_after_ms` hint. The hint is ZEROED here rather than the wait being
 * stubbed, which is what the shipped suite's fast cases do — the loop's own
 * `setTimeout` is then still real, at 0 ms, so a future change that ignored the
 * hint would show up as a slow test rather than a false pass.
 */
const busy = (retryAfterMs = 0) =>
	new DesktopControlError(
		503,
		"Session owner is unavailable. Reconnect and reconcile before retrying.",
		undefined,
		"runtime_busy",
		retryAfterMs,
		{ code: "runtime_busy", retryable: true, retry_after_ms: retryAfterMs },
	);

const deps = (lock) => ({
	taskId: ASK,
	answers: { "q-1": ["Ship it"] },
	sessionId: SESSION,
	lock,
});

/* ------------------------------------------- 1. the repeat, and its success */

test("a busy answer press is repeated with the SAME request, and the repeat can land", async () => {
	const lock = createSendLock();
	const sent = [];
	let attempt = 0;
	const outcome = await answerQueuedAsk(deps(lock), async (request) => {
		sent.push(request);
		attempt += 1;
		/*
		 * THE LOCK IS HELD ACROSS THE RESENDS, asserted at the one moment that can
		 * tell: a second acquire succeeding while an attempt is in flight would mean
		 * the lock was released between attempts, and a second press could then race
		 * this one through the retry waits (review R1-1). A successful grab is
		 * released at once, so a regression fails on the assertion rather than by
		 * poisoning the rest of the case.
		 */
		const grabbed = lock.tryAcquire();
		if (grabbed) lock.release();
		assert.equal(
			grabbed,
			false,
			`the one-answer lock stays held during attempt ${attempt}`,
		);
		if (attempt === 1) throw busy();
		return { status: "sent" };
	});

	assert.equal(outcome.status, "sent");
	assert.equal(
		sent.length,
		2,
		"the press must be repeated once the first attempt is refused busy",
	);
	// IDENTITY, not deep equality: the loop hands the caller's own request back in.
	assert.equal(
		sent[0],
		sent[1],
		"a repeat must reuse the request object whole",
	);
	assert.deepEqual(sent[0], {
		op: "sessions.answer",
		sessionId: SESSION,
		askId: ASK,
		answers: { "q-1": ["Ship it"] },
	});
	assert.equal(
		lock.held,
		false,
		"the one-answer lock is released after the repeat",
	);
});

/* ------------------------------------- 2. the exhausted bound and its copy */

test("exhausting the repeats reports the answer as not confirmed, never as not sent", async () => {
	const lock = createSendLock();
	let attempts = 0;
	const outcome = await answerQueuedAsk(deps(lock), async () => {
		attempts += 1;
		throw busy();
	});

	// BUSY_RESENDS is 3, so the press spends four attempts in total.
	assert.equal(attempts, 4);
	assert.equal(outcome.status, "failed");
	assert.equal(lock.held, false);
	assert.ok(
		answerOwnerIsBusy(outcome.error),
		"the refusal that escapes is the busy one",
	);

	const sentence = askRefusalSentence(outcome.error);
	assert.equal(sentence, ANSWER_BUSY_MESSAGE);
	assert.ok(
		sentence.includes("isn't confirmed yet"),
		`the sentence must state the disposition, got: ${sentence}`,
	);
	for (const claim of ["wasn't sent", "was not sent", "not sent"]) {
		assert.ok(
			!sentence.toLowerCase().includes(claim),
			`a busy outcome is indeterminate and must not claim "${claim}": ${sentence}`,
		);
	}
	assert.ok(
		!sentence.includes("Reconnect and reconcile"),
		`the backend's unreachable remedy must not be painted on this arm: ${sentence}`,
	);
});

/* ----------------------------------- 3. a genuine refusal is not repeated */

test("a refused answer fails on the FIRST attempt and keeps the error untouched", async () => {
	const lock = createSendLock();
	/*
	 * The owner's own verdict: the ask was settled by another surface. A repeat
	 * would be refused identically, so the loop must not spend one.
	 */
	const refusal = new DesktopControlError(
		409,
		"That ask was already answered by the phone.",
		undefined,
		"ask_already_settled",
		undefined,
		{ code: "ask_already_settled", status: "answered" },
	);
	let attempts = 0;
	const outcome = await answerQueuedAsk(deps(lock), async () => {
		attempts += 1;
		throw refusal;
	});

	assert.equal(attempts, 1, "only a runtime_busy refusal may be repeated");
	assert.equal(outcome.status, "failed");
	assert.equal(
		outcome.error,
		refusal,
		"the classifier must see the error the send threw, untouched",
	);
	assert.equal(askRefusalSentence(outcome.error), refusal.message);
	assert.equal(lock.held, false);
});

/* ------------------------------- 4. the command path stays unwrapped, on purpose */

test("the picker command path is not wrapped in the busy loop, for the measured reason", async () => {
	/*
	 * WHY THIS IS AN ASSERTION RATHER THAN NOTHING. Wrapping `useSessionCommand`'s
	 * `run` looks like the same fix one file over, and it is not:
	 * `/v1/desktop/sessions/{id}/commands` claims its receipt WITHOUT
	 * `retry_safe`, so a busy refusal (which leaves that claim's row unfinished)
	 * makes the same-id resend answer 409 "Request outcome is indeterminate.
	 * Reconcile session state before issuing a new request" — and this hook paints
	 * a bare 409 as a definite error. The retry would therefore replace the
	 * warning about an indeterminate switch with the claim that it did not run,
	 * over a switch that may well have applied. (`/messages` passes
	 * `retry_safe=True`, which is why the send path's `withBusyResends` does work;
	 * `/answers` has no receipt journal at all.) A later edit that adds the wrap
	 * here must read that measurement first, so it fails here with the reason.
	 */
	const source = readFileSync(
		"src/renderer/src/features/chat/pickers/use-picker-backend.ts",
		"utf8",
	);
	/*
	 * THE `run` BODY, not the whole file (review R1-3): a later, legitimate use of
	 * the loop elsewhere in this module - a read, a different op - must not fail
	 * this guard. The two markers are asserted first, so a rename that moves the
	 * body fails here instead of passing on an empty slice.
	 */
	const start = source.indexOf("const run = useCallback(");
	const end = source.indexOf("[sessionId],", start);
	assert.ok(
		start !== -1 && end > start,
		"the `run` body is findable, so the guard below measures something",
	);
	const runBody = source.slice(start, end);
	assert.ok(
		!runBody.includes("withBusyResends"),
		"the command route refuses a same-id resend with a receipt conflict; do not retry it in `run`",
	);
});
