import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE CARD'S HALF of the operator-confirmed ask answer (`src/main/ask-attest.ts` is
 * main's half, `scripts/ask-attest.test.mjs` its tests). What this guards:
 *
 *  - `confirmQueuedAsk` sends ONLY `asks.attestedAnswer` (schema-valid, the whole
 *    answer map, `revise: true` only from the change form), under the shared
 *    one-answer-in-flight lock; a cancelled sheet is `refused` (nothing sent) and
 *    main's refusal is `failed` - never a fallback to the plain `sessions.answer`.
 *  - main's keyed refusals become the reader's sentence (`askAttestRefusalSentence`,
 *    through the shared `askRefusalSentence`), and none of them is an owner verdict
 *    that could shut the change door.
 *  - the card draws "Confirm and send…" beside Send answer ONLY where a surface
 *    wires `onConfirm`, and plain Send answer is unchanged beside it.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export { AskPanel, askConfirmChangeWithheld } from "./src/renderer/src/features/chat/components/asks/ask-panel";',
			'export { askQueueView, askRefusalSentence, askRefusalIsOwner, askAttestRefusalSentence } from "./src/renderer/src/features/chat/ask-queue";',
			'export { confirmQueuedAsk, createSendLock } from "./src/renderer/src/features/chat/ask-answer";',
			'export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
			'export { desktopRequestSchema } from "./src/shared/desktop-contract";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	loader: { ".css": "empty" },
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	// One React for the bundle and this file (see `ask-dismiss.test.mjs`).
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});
const bundlePath = new URL(
	`./_ask-attest-card-${process.pid}.bundle.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const {
	AskPanel,
	askQueueView,
	askConfirmChangeWithheld,
	askRefusalSentence,
	askRefusalIsOwner,
	askAttestRefusalSentence,
	confirmQueuedAsk,
	createSendLock,
	DesktopControlError,
	desktopRequestSchema,
} = await import(bundlePath.href);
await unlink(bundlePath);

const SESSION = "0f9c1e2d3a4b";
const NOW = 1_700_000_000_000;
const CONFIRM_LABEL = "Confirm and send…";
const HINT =
	"Only a confirmed answer counts as your approval for deleting or moving files.";

const openAsk = (overrides = {}) => ({
	ask_id: "a-attest",
	created_at: NOW - 60_000,
	expires_at: NOW + 600_000,
	timeout_s: 900,
	urgent: false,
	status: "open",
	delivered: false,
	questions: [
		{
			id: "q1",
			question: "Delete ~/workspace/old-exports?",
			options: [{ label: "Yes, delete it" }, { label: "No, keep it" }],
		},
	],
	...overrides,
});

const panelMarkup = (extra = {}) =>
	renderToStaticMarkup(
		createElement(AskPanel, {
			view: askQueueView({ asks: [openAsk()], asks_open: 1 }),
			nowMs: NOW,
			answering: false,
			drafts: {},
			onDraftChange: () => undefined,
			onAnswer: () => undefined,
			onDecline: () => undefined,
			...extra,
		}),
	);

/** main's 403 for a refused confirmation, as `desktopResult` throws it. */
const refusal = (reason) =>
	new DesktopControlError(
		403,
		`This app could not confirm the answer as yours (${reason}).`,
		undefined,
		"ask_attest_refused",
		undefined,
		{ code: "ask_attest_refused", reason, message: "diagnostic" },
	);

/* ------------------------------------------------------------- the door ---- */

test("confirmQueuedAsk sends only asks.attestedAnswer, schema-valid, under the lock", async () => {
	const sent = [];
	const lock = createSendLock();
	const answers = { q1: ["Yes, delete it"] };
	const outcome = await confirmQueuedAsk(
		{ taskId: "a-attest", answers, sessionId: SESSION, lock },
		async (request) => {
			assert.equal(
				lock.held,
				true,
				"the lock is held while main's sheet is up",
			);
			sent.push(request);
			return { status: "answered" };
		},
	);
	assert.equal(outcome.status, "sent");
	assert.deepEqual(sent, [
		{
			op: "asks.attestedAnswer",
			sessionId: SESSION,
			askId: "a-attest",
			answers,
		},
	]);
	assert.equal(desktopRequestSchema.safeParse(sent[0]).success, true);
	assert.equal(lock.held, false);

	const revised = [];
	await confirmQueuedAsk(
		{ taskId: "a-attest", answers, sessionId: SESSION, revise: true, lock },
		async (request) => {
			revised.push(request);
			return {};
		},
	);
	assert.equal(revised[0].revise, true);
	assert.equal(desktopRequestSchema.safeParse(revised[0]).success, true);
});

test("a cancelled sheet is refused (nothing sent); main's refusal is failed, never a plain send", async () => {
	const lock = createSendLock();
	const answers = { q1: ["No, keep it"] };
	const cancelled = await confirmQueuedAsk(
		{ taskId: "a-attest", answers, sessionId: SESSION, lock },
		async () => ({ cancelled: true }),
	);
	assert.equal(cancelled.status, "refused");
	const sent = [];
	const failed = await confirmQueuedAsk(
		{ taskId: "a-attest", answers, sessionId: SESSION, lock },
		async (request) => {
			sent.push(request.op);
			throw refusal("listener_unavailable");
		},
	);
	assert.equal(failed.status, "failed");
	assert.deepEqual(
		sent,
		["asks.attestedAnswer"],
		"no fallback to sessions.answer",
	);
	assert.equal(lock.held, false);
});

test("nothing is sent without a session, an ask, answers, or the lock", async () => {
	const lock = createSendLock();
	let calls = 0;
	const send = async () => {
		calls += 1;
		return {};
	};
	const answers = { q1: ["x"] };
	for (const deps of [
		{ taskId: "a-attest", answers, sessionId: null, lock },
		{ taskId: "", answers, sessionId: SESSION, lock },
		{ taskId: "a-attest", answers: {}, sessionId: SESSION, lock },
	])
		assert.equal((await confirmQueuedAsk(deps, send)).status, "refused");
	assert.equal(lock.tryAcquire(), true);
	assert.equal(
		(
			await confirmQueuedAsk(
				{ taskId: "a-attest", answers, sessionId: SESSION, lock },
				send,
			)
		).status,
		"refused",
	);
	assert.equal(calls, 0);
});

/* --------------------------------------------------------- the sentence ---- */

test("main's refusals read as keyed copy, never as an owner verdict", () => {
	// Each sentence LEADS with the route that works (D2/U3); where it mentions the
	// unconfirmed send it says that send won't count as approval.
	const cases = [
		[
			"listener_unavailable",
			/^Open the conversation, then confirm again\..*won't count as your approval\.$/,
		],
		[
			"listener_refused",
			/^Confirm again\..*didn't accept the confirmation.*won't count as your approval\.$/,
		],
		["frame_refused", /^Confirm again\./],
		["timeout", /^Confirm again\./],
		[
			"not_packaged",
			/^To give your approval, answer in the terminal running this conversation\./,
		],
		["dev_flag", /^To give your approval, answer in the terminal/],
		["window_mode", /^To give your approval, answer in the terminal/],
		["devtools_open", /^Close DevTools, then confirm again\.$/],
		["debugger_attached", /^Close DevTools, then confirm again\.$/],
		["window_not_focused", /Bring this window to the front/],
		["ask_changed", /changed or closed/],
		["ask_closed", /changed or closed/],
		[
			"expired",
			/^This question expired before you confirmed, so nothing was sent\. It can't be answered any more\.$/,
		],
		["sheet_open", /^Finish the confirmation that is already open\.$/],
		["secret_answer", /hidden value can't be confirmed/],
		["answer_too_long", /too long to show in full/],
		[
			"answer_unconfirmed",
			/sent without confirming, so changing it can't make it count.*Confirm and send\.$/,
		],
		[
			"not_consent_bearing",
			/^Your answer was sent, but it wasn't confirmed as yours/,
		],
		["ask_read_failed", /^The answer wasn't confirmed\. Try again\.$/],
	];
	for (const [reason, sentence] of cases) {
		const error = refusal(reason);
		assert.match(askAttestRefusalSentence(error), sentence, reason);
		assert.equal(askRefusalSentence(error), askAttestRefusalSentence(error));
		assert.equal(
			askRefusalIsOwner(error),
			false,
			`${reason} keeps the change door open`,
		);
		assert.doesNotMatch(
			askRefusalSentence(error),
			/diagnostic|could not confirm/,
		);
	}
	// Any other error is not this vocabulary.
	assert.equal(askAttestRefusalSentence(new Error("boom")), null);
});

/* ------------------------------------------------------------- the card ---- */

test("the card offers Confirm and send… only where a surface wires onConfirm", () => {
	const without = panelMarkup();
	assert.equal(without.includes(CONFIRM_LABEL), false);
	assert.match(without, /Send answer/);
	const withConfirm = panelMarkup({ onConfirm: () => undefined });
	assert.equal(withConfirm.includes(CONFIRM_LABEL), true);
	assert.match(withConfirm, /Send answer/, "plain Send answer stays beside it");
});

test("both ask surfaces wire the confirm door", () => {
	const page = readFileSync(
		join(
			process.cwd(),
			"src/renderer/src/features/chat/components/chat-page.tsx",
		),
		"utf8",
	);
	assert.match(page, /onConfirmAsk: \(/);
	const content = readFileSync(
		join(
			process.cwd(),
			"src/renderer/src/features/chat/components/chat-content.tsx",
		),
		"utf8",
	);
	assert.match(content, /onConfirm=\{canonical\?\.onConfirmAsk\}/);
	const fleet = readFileSync(
		join(
			process.cwd(),
			"src/renderer/src/features/chat/components/asks/fleet-ask-drawer.tsx",
		),
		"utf8",
	);
	assert.match(fleet, /onConfirm=\{onConfirm\}/);
	assert.match(fleet, /confirmQueuedAsk\(/);
});

/* ------------------------------------------------ round 1 remediation (U/D/Q) */

test("U5: a busy runtime on the confirm door says confirm again, and stays a busy outcome", async () => {
	const busy = new DesktopControlError(
		409,
		"busy",
		undefined,
		"runtime_busy",
		1500,
		{ code: "runtime_busy", retry_after_ms: 1500 },
	);
	const outcome = await confirmQueuedAsk(
		{
			taskId: "a-attest",
			answers: { q1: ["Yes, delete it"] },
			sessionId: SESSION,
			lock: createSendLock(),
		},
		async () => {
			throw busy;
		},
	);
	assert.equal(outcome.status, "failed");
	assert.equal(
		outcome.error.code,
		"runtime_busy",
		"muted ink and refresh still read the code",
	);
	assert.equal(outcome.error.retryAfterMs, 1500);
	assert.equal(
		askRefusalSentence(outcome.error),
		"The agent was busy and didn't take your answer. Confirm again in a moment.",
	);
	// The plain door's busy refusal keeps the plain sentence.
	assert.notEqual(askRefusalSentence(busy), askRefusalSentence(outcome.error));
	assert.equal(askAttestRefusalSentence(busy), null);
});

test("D1/U2: the approval hint sits under the row only where Confirm is drawn", () => {
	assert.equal(panelMarkup().includes(HINT), false);
	const markup = panelMarkup({ onConfirm: () => undefined });
	assert.equal(markup.includes(HINT), true);
	assert.doesNotMatch(markup, /operator/i, "the card never says 'operator'");
});

test("D6: the confirm label reserves the in-flight width, so the row does not shift", () => {
	const markup = panelMarkup({ onConfirm: () => undefined });
	// Both words are laid out in one grid cell; the one not shown is invisible.
	assert.match(
		markup,
		/<span class="col-start-1 row-start-1 invisible" aria-hidden="true">Confirming…<\/span>/,
	);
});

test("Q1: Confirm change is withheld only when the recorded answer's stamp is known untrusted", () => {
	for (const surface of ["unverified", "remote", "chat"])
		assert.equal(
			askConfirmChangeWithheld(openAsk({ answered_by: { surface } })),
			true,
			surface,
		);
	for (const surface of ["desktop", "tui", "terminal", "mirror"])
		assert.equal(
			askConfirmChangeWithheld(openAsk({ answered_by: { surface } })),
			false,
			surface,
		);
	// Unknown: the control stays, and main (which reads the row itself) decides.
	assert.equal(askConfirmChangeWithheld(openAsk()), false);
	assert.equal(askConfirmChangeWithheld(openAsk({ answered_by: null })), false);
});
