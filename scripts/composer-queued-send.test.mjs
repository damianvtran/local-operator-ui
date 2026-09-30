import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The queued send: a press made while the conversation's read window is still
 * open is HELD and delivered when the page lands - and it is never silent while
 * it waits (task-17, U1/U2).
 *
 * WHAT IS MEASURED WHERE. The behavior itself - a real press in the
 * `Reconnecting`-with-no-page state queues, shows the pending line, and the
 * message is delivered EXACTLY ONCE when a page lands - is measured on the
 * running app, because only a real renderer has a Send control, a draft and a
 * live stream; those runs are recorded on the PR and were re-derived against
 * the shipped build first. What is pinned HERE is the contract that behavior
 * rests on, at the two seams a regression can silently unhook:
 *
 *  1. the copy: the queued press has its OWN sentence, in the muted register,
 *     and it is not a failure sentence - `SEND_FAILURE_COPY.queuedSend`;
 *  2. the WIRING, asserted on the source because the pane cannot be rendered in
 *     isolation (the same argument `composer-readings.test.mjs` makes for the
 *     strip's slot): `chat-page.tsx`'s `send` states the queue BEFORE it awaits
 *     the read window and unlatches the ref in a `finally`, `answerLockedSend`
 *     keeps the queue's sentence while one is held, and `message-input.tsx`
 *     marks the row so a reader (a rig included) can find the queued line
 *     without reading its copy.
 *
 * The muted claim's own lifecycle - held while `admitting`, retired when the
 * flight ends - is `lockAnswerOutlived`'s, and it is already pinned term by
 * term in `composer-send-failure.test.mjs`; this file does not restate it.
 * What it adds is that the queued line is one of those claims, which is what
 * the source assertions below establish.
 */

const bundle = await build({
	stdin: {
		contents:
			'export { SEND_FAILURE_COPY } from "./src/renderer/src/shared/store/canonical-sessions-store";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
});
const module = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const { SEND_FAILURE_COPY } = module;

const chatPage = readFileSync(
	"src/renderer/src/features/chat/components/chat-page.tsx",
	"utf8",
);
const messageInput = readFileSync(
	"src/renderer/src/shared/components/composer/message-input.tsx",
	"utf8",
);

test("the queued press has its own sentence, and it is not a failure's", () => {
	const queued = SEND_FAILURE_COPY.queuedSend;
	assert.equal(typeof queued, "string");
	// The fact and the remedy, in that order: the message is with the app, and
	// the wait ends by itself. "Ready" is the app's own word for this window
	// (`This chat isn't ready yet`), so the two sentences cannot disagree.
	assert.match(queued, /will send as soon as the conversation is ready/);
	// Not the send lock's claim (a DIFFERENT state: the flight is out), and not
	// any failure arm's (nothing failed and nothing needs re-sending).
	assert.notEqual(queued, SEND_FAILURE_COPY.sendLock);
	assert.doesNotMatch(queued, /couldn't|wasn't|was not|failed/i);
});

test("the send states the queue before it awaits the read window, and unlatches it in a finally", () => {
	const sendAt = chatPage.indexOf("const send = async");
	assert.ok(sendAt > 0, "`send` is not where this test expects it");
	const sendBody = chatPage.slice(sendAt, sendAt + 60_000);

	const windowAt = sendBody.indexOf("await awaitWindow()");
	assert.ok(windowAt > 0, "the read-window wait is gone");
	/* The LAST guard before the await is the one that governs it. */
	const guardAt = sendBody.lastIndexOf("isSessionUnvalidated(", windowAt);
	assert.ok(
		guardAt > 0 && guardAt < windowAt,
		"the queue must be stated inside the read-window branch, before the await",
	);

	const branch = sendBody.slice(guardAt, windowAt);
	for (const needed of [
		"queuedSend.current = true;",
		"setSendError(SEND_FAILURE_COPY.queuedSend);",
		"setSendErrorRetry(false);",
		"setSendErrorMuted(true);",
	]) {
		assert.ok(
			branch.includes(needed),
			`the press must state the queue before it waits: \`${needed}\` is missing`,
		);
	}

	// The ref unlatches in a `finally`, so a wait that settles any way - ready,
	// failed, gone, abandoned - cannot leave a second press reading a stale
	// queue. A plain assignment after the await would skip on a throw.
	assert.match(
		sendBody,
		/try\s*\{\s*outcome = await awaitWindow\(\);\s*\}\s*finally\s*\{\s*queuedSend\.current = false;\s*\}/,
	);
});

test("a second press while the queue is held keeps the queue's sentence", () => {
	// The two muted claims answer DIFFERENT states - a flight that is out
	// (`sendLock`) and a press that is waiting for the window (`queuedSend`) -
	// and a second press must be answered by the one that is true, or it would
	// overwrite the visible pending mark with a claim about another state.
	assert.match(
		chatPage,
		/queuedSend\.current\s*\?\s*SEND_FAILURE_COPY\.queuedSend\s*:\s*pressLockCopy\(/,
		"answerLockedSend must prefer the queue's sentence while one is held",
	);
});

test("the notice row carries a marker a reader can find without reading the copy", () => {
	assert.ok(
		messageInput.includes("data-composer-queued={"),
		"the queued line must be addressable by a structural marker, like `data-composer-notice`",
	);
	assert.ok(
		messageInput.includes(
			"sendError?.message === SEND_FAILURE_COPY.queuedSend",
		),
		"the marker is the identity of the sentence, so a reword does not move the handle",
	);
});
