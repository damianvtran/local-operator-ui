import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The change-back affordance on a recorded-but-UNDELIVERED answer — design §10
 * (amendment 2026-10-03) and issue #1936, asserted against the SHIPPED modules.
 *
 * What is checked here, and why each of these is a property a screenshot cannot
 * prove and a future edit could break silently:
 *
 * 1. **A revision is its OWN op and it carries the WHOLE ask map.** §10 rules out
 *    the per-question amend POST in as many words, and it rules out inferring the
 *    intent from the values: equal values are not a retry marker and different
 *    values are not a revision. So the body is asserted key by key — `revise: true`
 *    plus every question — through the REAL `desktopRequestSchema` and the REAL
 *    endpoint mapper, which is what makes a change to either that broke this op
 *    fail here rather than in QA.
 *
 * 2. **The FIRST-answer body does not grow a `revise` key.** The two doors share
 *    one payload shape, so the only thing that distinguishes them on the wire is
 *    the field; a body that carried `revise: false` on every ordinary submit would
 *    be asserting an intent it does not have. Asserted as the ABSENCE of the key,
 *    not as `false`.
 *
 * 3. **The two contradictions the schema refuses are refused CLIENT-side.** A
 *    decline and a revision cannot both settle one ask, and a revision with no
 *    `ask_id` would be silently ignored on the gate shape — the class of no-op §10
 *    rules out. Both are the backend's own rules restated, so the user is told here
 *    rather than by a 422 on a body the app composed itself.
 *
 * 4. **The change form is seeded from the log, and it is the whole map that
 *    leaves.** `askRevisionDraft` + `askAnswerMap` are asserted together: changing
 *    one question of a two-question ask must still post BOTH, because the queue
 *    refuses a partial map and a surface that forgot a key would lose that question
 *    for good.
 *
 * 5. **The control exists exactly while the window is open.** Rendered from the
 *    PRODUCTION `AskPanel`, three states are told apart: answered-and-undelivered
 *    offers `Change answer`, a DELIVERED `answered` ask offers nothing (the model
 *    has been told; the row pins what it was told), and an open ask offers its own
 *    first-answer controls and no change control. The gate is the wire's `delivered`
 *    flag, never the status alone and never a value comparison.
 *
 * 6. **The chip cannot call a changeable queue settled.** A queue whose only row is
 *    answered-but-undelivered used to take `All asks settled`, which contradicts the
 *    panel the chip opens; the count clause is asserted in all three of its states.
 *
 * ## Why the markup is rendered rather than the element tree walked
 *
 * `AskRow` reads the change form's own state (`useState`) and memoises its
 * completeness (`useMemo`), so it cannot be CALLED as a plain function the way
 * `AskOptions` can — a hook call outside React is the failure, and there is no
 * jsdom in this repo's tree. `renderToStaticMarkup` runs the real dispatcher, so
 * the markup below is what the shipped component paints. What it cannot do is
 * dispatch a click; that half is exercised for real against the live route in the
 * PR's behavioural matrix, which POSTs exactly the body `desktopEndpoint` builds
 * here.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export { AskPanel } from "./src/renderer/src/features/chat/components/asks/ask-panel";',
			'export { askQueueView, askChipCountClause, askRevisionDraft, askAnswerMap, presentAsk, askStatusText } from "./src/renderer/src/features/chat/ask-queue";',
			'export { reviseQueuedAsk, answerQueuedAsk, createSendLock } from "./src/renderer/src/features/chat/ask-answer";',
			'export { desktopRequestSchema, desktopEndpoint } from "./src/shared/desktop-contract";',
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
	/*
	 * React stays external so the bundle and this file share ONE copy: the component
	 * must be rendered by the same dispatcher this file imports. The
	 * `import.meta.env` define is what `ask-options.test.mjs` bakes for the same
	 * reason — a module in this graph reads it at module scope, and nothing here
	 * reads a VITE_ variable.
	 */
	define: { "import.meta.env": "{}" },
	/*
	 * `react-dom` and its server entry stay external for the same reason `react`
	 * does — the sibling `ask-options.test.mjs` records the measurement: bundled,
	 * `react-dom/server`'s CJS build reaches for a dynamic `require("stream")` that
	 * esbuild's ESM output cannot satisfy. `@tanstack/react-query` is external so the
	 * `useQuery` inside the bundle finds the provider this file wraps the render in.
	 */
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});

const bundlePath = new URL("./_ask-revise.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const {
	AskPanel,
	askQueueView,
	askChipCountClause,
	askRevisionDraft,
	askAnswerMap,
	presentAsk,
	askStatusText,
	reviseQueuedAsk,
	answerQueuedAsk,
	createSendLock,
	desktopRequestSchema,
	desktopEndpoint,
} = await import(bundlePath.href);
await unlink(bundlePath);

/* The wire's session id shape: 12 lowercase hex digits (`sessionIdPattern`). */
const SESSION = "0f9c1e2d3a4b";
const NOW = 1_700_000_000_000;

/** The two-question ask the whole-ask rule exists for. */
function twoQuestionAsk(overrides = {}) {
	return {
		ask_id: "a-revise",
		created_at: NOW - 60_000,
		expires_at: NOW + 600_000,
		timeout_s: 900,
		urgent: false,
		status: "open",
		delivered: false,
		questions: [
			{
				id: "q1",
				question: "Which environment?",
				options: [{ label: "staging" }, { label: "production" }],
			},
			{
				id: "q2",
				question: "Freeze the deploy window?",
				options: [{ label: "yes" }, { label: "no" }],
			},
		],
		...overrides,
	};
}

const answeredNotDelivered = () =>
	twoQuestionAsk({
		status: "answered",
		answered_at: NOW - 30_000,
		answered_by: { surface: "desktop" },
		answers: { q1: ["staging"], q2: ["yes"] },
	});

const answeredDelivered = () =>
	twoQuestionAsk({
		status: "answered",
		delivered: true,
		answered_at: NOW - 30_000,
		answered_by: { surface: "desktop" },
		answers: { q1: ["staging"], q2: ["yes"] },
	});

const openAsk = () => twoQuestionAsk();

const panelMarkup = (ask, extra = {}) =>
	renderToStaticMarkup(
		createElement(AskPanel, {
			view: askQueueView({
				asks: [ask],
				asks_open: ask.status === "open" ? 1 : 0,
			}),
			nowMs: NOW,
			answering: false,
			drafts: {},
			onDraftChange: () => undefined,
			onAnswer: () => undefined,
			onDecline: () => undefined,
			onRevise: () => undefined,
			...extra,
		}),
	);

test("a revision posts the WHOLE ask map on the queued-ask body, with the intent stated", async () => {
	const answers = { q1: ["staging"], q2: ["yes"] };
	const sent = [];
	const outcome = await reviseQueuedAsk(
		{ taskId: "a-revise", answers, sessionId: SESSION, lock: createSendLock() },
		async (request) => {
			sent.push(request);
		},
	);
	assert.equal(outcome.status, "sent");
	assert.equal(sent.length, 1);
	const [request] = sent;

	// The REAL schema first: a body this app composes must not come back 422.
	const parsed = desktopRequestSchema.safeParse(request);
	assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
	assert.equal(parsed.data.revise, true);
	// The WHOLE map, every question — never a per-question amend.
	assert.deepEqual(parsed.data.answers, answers);
	// A queued ask carries no epoch, deliberately (it outlives the owner that
	// raised it), so the request must not smuggle one in.
	assert.equal("epoch" in request, false);
	assert.equal("requestId" in request, false);

	const endpoint = desktopEndpoint(request);
	assert.equal(endpoint.method, "POST");
	assert.equal(endpoint.path, `/v1/desktop/sessions/${SESSION}/answers`);
	assert.equal(endpoint.body.ask_id, "a-revise");
	assert.deepEqual(endpoint.body.answers, answers);
	assert.equal(endpoint.body.revise, true);
	// The decline is not sent at all rather than sent as `false`: the backend's
	// validator reads a `false` decline as absent, and a body asserting both
	// intents is the contradiction the schema refuses.
	assert.equal(endpoint.body.decline, undefined);
});

test("the first-answer body is unchanged: the same shape with NO revise key", async () => {
	const answers = { q1: ["staging"], q2: ["yes"] };
	const sent = [];
	await answerQueuedAsk(
		{ taskId: "a-revise", answers, sessionId: SESSION, lock: createSendLock() },
		async (request) => {
			sent.push(request);
		},
	);
	assert.equal(sent.length, 1);
	const endpoint = desktopEndpoint(sent[0]);
	assert.equal(endpoint.body.ask_id, "a-revise");
	assert.deepEqual(endpoint.body.answers, answers);
	// ABSENT, not false: an ordinary submit states no intent it does not have.
	assert.equal("revise" in endpoint.body, false);
	assert.equal(desktopRequestSchema.safeParse(sent[0]).success, true);
});

test("the two contradictory shapes are refused client-side, in the backend's own words", () => {
	const both = desktopRequestSchema.safeParse({
		op: "sessions.answer",
		sessionId: SESSION,
		askId: "a-revise",
		answers: { q1: ["staging"] },
		decline: true,
		revise: true,
	});
	assert.equal(both.success, false);
	// The backend's own ordering puts the answers/decline contradiction first
	// (`Answer.one_answer`), so this client reports the same sentence it would get
	// back — one rule, restated where the user is told rather than by a 422.
	assert.ok(
		both.error.issues.some((issue) =>
			issue.message.includes("Supply either answers or decline"),
		),
		JSON.stringify(both.error.issues),
	);

	const gateShaped = desktopRequestSchema.safeParse({
		op: "sessions.answer",
		sessionId: SESSION,
		epoch: "e-1",
		requestId: "r-1",
		value: "staging",
		questionIndex: 0,
		revise: true,
	});
	assert.equal(gateShaped.success, false);
	assert.ok(
		gateShaped.error.issues.some((issue) =>
			issue.message.includes("revise applies to a queued ask"),
		),
		JSON.stringify(gateShaped.error.issues),
	);
});

test("a revision with no answers, or no session, is refused before the lock is claimed", async () => {
	const empty = await reviseQueuedAsk(
		{
			taskId: "a-revise",
			answers: {},
			sessionId: SESSION,
			lock: createSendLock(),
		},
		async () => {
			throw new Error("nothing may be sent");
		},
	);
	assert.equal(empty.status, "refused");
	const orphan = await reviseQueuedAsk(
		{
			taskId: "a-revise",
			answers: { q1: ["staging"] },
			sessionId: null,
			lock: createSendLock(),
		},
		async () => {
			throw new Error("nothing may be sent");
		},
	);
	assert.equal(orphan.status, "refused");
});

test("the change form is seeded from the log, and the whole map leaves", () => {
	const ask = answeredNotDelivered();
	const draft = askRevisionDraft(ask);
	// Both questions, from the recorded answers.
	assert.deepEqual(draft, { q1: ["staging"], q2: ["yes"] });
	// Changing one answer still posts the WHOLE ask: the queue refuses a partial
	// map, so a per-question shape here is a control that could only ever 409.
	const edited = { ...draft, q1: ["production"] };
	assert.deepEqual(askAnswerMap(ask, edited), {
		q1: ["production"],
		q2: ["yes"],
	});
});

test("a SECRET question is never seeded with its key name", () => {
	const ask = twoQuestionAsk({
		status: "answered",
		answers: { q1: ["staging"], q2: ["[my-token]"] },
		questions: [
			{
				id: "q1",
				question: "Which environment?",
				options: [{ label: "staging" }],
			},
			{ id: "q2", question: "Paste the token", secret: true },
		],
	});
	const draft = askRevisionDraft(ask);
	// The value never leaves the session's memory store, so there is nothing to
	// seed the masked field WITH — and seeding `[my-token]` would post the key
	// name back as the new secret.
	assert.deepEqual(draft, { q1: ["staging"] });
	// Which is why the submit is gated on a retyped value, by the FIRST-answer
	// completeness rule rather than a revision-specific one.
	assert.equal(askAnswerMap(ask, draft, {}), null);
	assert.deepEqual(askAnswerMap(ask, draft, { q2: "s3cret" }), {
		q1: ["staging"],
		q2: ["s3cret"],
	});
});

test("the card offers Change answer exactly while the wire says undelivered", () => {
	const undelivered = panelMarkup(answeredNotDelivered());
	assert.ok(
		undelivered.includes("Change answer"),
		"expected the change control",
	);
	// It is not a first-answer card any more: the answer is already recorded.
	assert.equal(undelivered.includes("Send answer"), false);
	assert.equal(undelivered.includes(">Decline<"), false);
	// And the copy contract's own sentence for the state, not a bare `Answered`.
	assert.ok(
		askStatusText(answeredNotDelivered(), NOW).startsWith(
			"Answered — delivering",
		),
		askStatusText(answeredNotDelivered(), NOW),
	);

	const delivered = panelMarkup(answeredDelivered());
	assert.equal(
		delivered.includes("Change answer"),
		false,
		"a delivered answer is history and takes no control",
	);

	const open = panelMarkup(openAsk());
	assert.equal(open.includes("Change answer"), false);
	assert.ok(
		open.includes("Send answer"),
		"the open ask keeps its first-answer door",
	);
});

test("the card offers no change control where no surface can revise", () => {
	// A read-only mount (a story, a surface with no revise door) must not draw a
	// control nothing can act on — the same rule `onAnswer`'s absence already has.
	const markup = renderToStaticMarkup(
		createElement(AskPanel, {
			view: askQueueView({ asks: [answeredNotDelivered()], asks_open: 0 }),
			nowMs: NOW,
			answering: false,
			drafts: {},
			onDraftChange: () => undefined,
			onAnswer: () => undefined,
			onDecline: () => undefined,
		}),
	);
	assert.equal(markup.includes("Change answer"), false);
});

test("an undelivered answer is a PENDING card, and the chip says so", () => {
	const view = askQueueView({
		asks: [answeredNotDelivered()],
		asks_open: 0,
	});
	const presentation = presentAsk(answeredNotDelivered());
	// `open` is the backend's outstanding set and stays false: the agent is not
	// waiting. `delivering` is the wire's own flag and is what the card reads.
	assert.equal(presentation.open, false);
	assert.equal(presentation.delivering, true);
	// `All asks settled` here would be the chip contradicting the panel it opens.
	assert.equal(askChipCountClause(view), "1 answer not yet delivered");

	// A DELIVERED answered ask keeps today's sentence.
	assert.equal(
		askChipCountClause(
			askQueueView({ asks: [answeredDelivered()], asks_open: 0 }),
		),
		"All asks settled",
	);
	assert.equal(presentAsk(answeredDelivered()).delivering, false);
});
