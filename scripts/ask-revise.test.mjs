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
 * 5. **The control exists exactly while §10's window is open.** Rendered from the
 *    PRODUCTION `AskPanel`, the states are told apart: answered-and-undelivered and
 *    LATE-and-undelivered each offer `Change answer` (the engine admits a revision
 *    for both — `asks/queue.py::_revision_decision`), a DELIVERED ask of either
 *    status offers nothing (the model has been told; the row pins what it was told),
 *    and an open ask offers its own first-answer controls and no change control. The
 *    gate is the wire's own recorded-and-undelivered reading, never the status alone
 *    and never a value comparison.
 *
 * 6. **An owner refusal closes the door and travels with the row.** The reference
 *    sequence is: press `Change answer` while the wire still says undelivered, and
 *    have the response row exist by the time the press lands — the row is what
 *    refuses it, so the ask has already left `pending` for the settled section. The
 *    sentence must therefore be painted on the dropped-to-one-line row rather than
 *    measured once and lost (UX round 1, U1 = design round 1, D1), and the card must
 *    not keep re-offering the door the sentence just refused. The settled-row half is
 *    drawn inside the section's own disclosure — which paints no children while it is
 *    collapsed — so it is proven in the DOM by `scripts/ask-change-window-evidence.mjs`
 *    (case 4) and only the state split is asserted here.
 *
 * 7. **A change that LANDED leaves a receipt.** The wire cannot mark an accepted
 *    revision (the fold keeps the first `answered`'s status, stamp and attribution),
 *    so the record of it is this surface's own — without it a deliberate change and
 *    the answer it replaced render identically (design round 1, D3; UX round 1, U3).
 *
 * 8. **The chip cannot call a changeable queue settled, and it names the door.** A
 *    queue whose only row is answered-but-undelivered used to take `All asks
 *    settled`, which contradicts the panel the chip opens; the count clause is
 *    asserted in all three of its states.
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
			'export { askQueueView, askChipCountClause, askRevisionDraft, askAnswerMap, presentAsk, askStatusText, askStatusWord } from "./src/renderer/src/features/chat/ask-queue";',
			'export { ASK_LATE_UNDELIVERED_TEXT, askRefusalIsOwner, askRefusalSentence, askScopeLine } from "./src/renderer/src/features/chat/ask-queue";',
			'export { DesktopControlError, desktopResult } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
			'export { DESKTOP_LOST_SIGHT_CODE, DESKTOP_MACHINE_DETAIL, DESKTOP_REFUSAL_CODE, DESKTOP_REFUSAL_SENTENCE, RUNTIME_BUSY_CODE, desktopRequestDeadlineDetail } from "./src/shared/desktop-contract";',
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
	askStatusWord,
	ASK_LATE_UNDELIVERED_TEXT,
	askRefusalIsOwner,
	askRefusalSentence,
	askScopeLine,
	DesktopControlError,
	desktopResult,
	DESKTOP_LOST_SIGHT_CODE,
	DESKTOP_MACHINE_DETAIL,
	DESKTOP_REFUSAL_CODE,
	DESKTOP_REFUSAL_SENTENCE,
	RUNTIME_BUSY_CODE,
	desktopRequestDeadlineDetail,
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

/**
 * §10's LATE half: an answer recorded AFTER the deadline, still undelivered.
 *
 * `answered_at` after `expires_at` is what makes the status `late`, and
 * `delivered: false` is what keeps it inside the window. Both halves matter: the
 * engine's rule is `answered`/`late` with no `ask-response-<ask_id>` row, and the
 * first cut of the panel's flag read `answered` alone (agent review round 1 MAJOR).
 */
const lateNotDelivered = (overrides = {}) =>
	twoQuestionAsk({
		ask_id: "a-late-window",
		expires_at: NOW - 120_000,
		status: "late",
		answered_at: NOW - 60_000,
		answered_by: { surface: "desktop" },
		answers: { q1: ["staging"], q2: ["yes"] },
		...overrides,
	});

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

/*
 * The revise press's own body, so the transport under test sees the request the
 * product sends (the `sessions.answer` op with the whole map and the intent flag).
 */
const REVISE_REQUEST = {
	op: "sessions.answer",
	sessionId: SESSION,
	askId: "a-revise",
	answers: { q1: ["staging"] },
	revise: true,
};

/**
 * Drive the SHIPPED transport over one stubbed reply from main, and hand back the
 * error it threw.
 *
 * `desktopRequest` reads the real IPC channel off `window.api.desktop.request`, so
 * stubbing exactly that is the whole seam: `desktopResult` parses the envelope
 * below and throws the SHIPPED `DesktopControlError` — no error shape is written by
 * this test. That is the point of the round-3 finding: the first cut built its
 * transport case as `new Error("socket closed")`, a shape this product never
 * throws, so the assertion passed while the door it was meant to guard was shut on
 * every real failure.
 */
async function refusalFromTheWire(reply) {
	const hadWindow = "window" in globalThis;
	const previous = globalThis.window;
	globalThis.window = {
		api: {
			desktop: {
				request: async () => {
					if (reply instanceof Error) throw reply;
					return reply;
				},
			},
		},
	};
	let error;
	try {
		await desktopResult(REVISE_REQUEST);
	} catch (caught) {
		error = caught;
	} finally {
		if (hadWindow) globalThis.window = previous;
		// `Reflect` rather than the `delete` operator: this puts the global back the
		// way it was found (node has no `window`), which `biome`'s `noDelete` rule
		// refuses the operator for.
		else Reflect.deleteProperty(globalThis, "window");
	}
	if (error === undefined) throw new Error("the transport did not refuse");
	return error;
}

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

test("§10's LATE half draws the same door, and a delivered one draws nothing", () => {
	const late = lateNotDelivered();
	// The engine admits a revision for BOTH recorded statuses — "an ask that already
	// carries an answer (`answered`/`late`) with no `ask-response-<ask_id>` row yet" —
	// so a door that only ever opened for `answered` left this half of §10's window
	// unreachable from this surface (agent review round 1 MAJOR = design round 1 D2),
	// which no fixture covered.
	assert.equal(presentAsk(late).delivering, true);
	const markup = panelMarkup(late);
	assert.ok(
		markup.includes("Change answer"),
		"a late-but-undelivered answer is still the user's to change",
	);
	// It is a RECORDED answer, so it carries none of the first-answer controls.
	assert.equal(markup.includes("Send answer"), false);

	// DELIVERED, either status: history, and no control.
	const deliveredLate = lateNotDelivered({ delivered: true });
	assert.equal(presentAsk(deliveredLate).delivering, false);
	assert.equal(panelMarkup(deliveredLate).includes("Change answer"), false);
});

test("an owner refusal closes the door and travels with the row", () => {
	const refused = {
		sending: false,
		refused: "already delivered — send a new message",
		/*
		 * THE CLASSIFICATION THAT SHUTS THE DOOR (agent review round 2, minor): a refusal
		 * that reached nothing keeps its sentence but NOT this flag, and the card keeps
		 * its affordance.
		 */
		refusedByOwner: true,
	};
	/*
	 * PENDING (the wire has not caught up): the card is still drawn from a frame that
	 * says undelivered, and the door whose only possible outcome is the sentence above
	 * it is WITHDRAWN rather than re-offered. This is the finding's first half — a
	 * second press could only reproduce the refusal.
	 */
	const pending = panelMarkup(answeredNotDelivered(), {
		outcomes: { "a-revise": refused },
	});
	assert.equal(pending.includes("Change answer"), false);
	assert.ok(
		pending.includes("already delivered — send a new message"),
		"the refusal is rendered in place",
	);
	/*
	 * SETTLED (the frame caught up — the reachable path the finding measured): the ask
	 * has dropped to its one-line history row, and the owner's sentence has to travel
	 * WITH it. A collapsed row that painted nothing left the refusal on screen for one
	 * frame and then gone, which §10 calls the worse failure than the refusal itself
	 * ("a silent no-op would be the worse failure").
	 */
	const settled = panelMarkup(answeredDelivered(), {
		outcomes: { "a-revise": refused },
	});
	assert.ok(settled.includes("Settled"), "the ask is drawn as settled history");
	assert.equal(settled.includes("Change answer"), false);
	/*
	 * THE ROW-SUMMARY HALF IS NOT ASSERTABLE FROM HERE, and saying so is better than a
	 * passing assertion that proves nothing: a `Disclosure` paints no children while it
	 * is collapsed, and the settled ROWS live inside the section's own disclosure — so
	 * static markup of the section shows its header and none of its rows. That claim is
	 * proven in the DOM instead, by `scripts/ask-change-window-evidence.mjs` (case 4),
	 * which mounts the shipped panel, opens `[data-lo-ask-settled]` with a real click and
	 * reads the row's own summary. What this file can assert is the split: the ask is no
	 * longer a pending card and offers no door.
	 */
});

test("a transport failure leaves the door open; only the owner's verdict shuts it", () => {
	/*
	 * Agent review round 2's minor. The first cut closed the door on ANY refusal, and
	 * the outcome record is never cleared - so one press that never reached the backend
	 * left an answered-undelivered ask with NO affordance at all until the mount
	 * changed. The card withdraws the door only on a refusal that is the OWNER's own
	 * statement about the window (design round 1, D1 = UX round 1, U1); a request that
	 * reached nothing is not such a statement, and the sentence is still painted.
	 */
	const transport =
		"This server did not answer the request for its desktop controls.";
	const failed = panelMarkup(answeredNotDelivered(), {
		outcomes: { "a-revise": { sending: false, refused: transport } },
	});
	assert.ok(
		failed.includes("Change answer"),
		"a refusal that reached nothing does not withdraw the affordance",
	);
	assert.ok(failed.includes(transport), "and its sentence is still on the row");

	// THE OWNER'S VERDICT DOES SHUT IT, and it is the flag the caller records - the
	// card never re-derives the window from the sentence's text.
	const owned = panelMarkup(answeredNotDelivered(), {
		outcomes: {
			"a-revise": {
				sending: false,
				refused: "already delivered — send a new message",
				refusedByOwner: true,
			},
		},
	});
	assert.equal(owned.includes("Change answer"), false);
});

test("the refusal verdict is the classification, not the sentence's spelling", async () => {
	/*
	 * EVERY CASE IS THE SHIPPED TRANSPORT'S OWN ERROR over the envelope the named
	 * layer really produces (agent review round 3, BLOCKER). The first cut asserted
	 * `new Error("socket closed")` here - a shape the transport never throws - so it
	 * passed while `refusedByOwner` was `true` for every one of these, and the door
	 * shut for the life of the mount.
	 */

	// A. the renderer's own catch: the IPC call rejected, so no status exists. The
	// error is the SHIPPED class with a `null` status, not a hand-built `Error`.
	const ipcRejected = await refusalFromTheWire(new Error("invoke rejected"));
	assert.ok(ipcRejected instanceof DesktopControlError);
	assert.equal(ipcRejected.status, null);
	assert.equal(askRefusalIsOwner(ipcRejected), false);
	// B. main could not complete the request (a 503 envelope carrying an AUTHORED
	// detail sentence AND a status). The status is non-null, which is why the verdict
	// cannot be a status check alone - and why the sentence must stay main's own.
	const transportFailed = await refusalFromTheWire({
		status: 503,
		body: {
			detail: {
				code: DESKTOP_REFUSAL_CODE.transportFailed,
				message: DESKTOP_MACHINE_DETAIL.transportFailed,
			},
		},
	});
	assert.equal(askRefusalIsOwner(transportFailed), false);
	assert.equal(
		askRefusalSentence(transportFailed),
		DESKTOP_REFUSAL_SENTENCE[DESKTOP_REFUSAL_CODE.transportFailed],
	);
	// C. main's own deadline fired: a 504 `deadline_exceeded`, which is nobody's
	// verdict on this ask - the request may still be running.
	assert.equal(
		askRefusalIsOwner(
			await refusalFromTheWire({
				status: 504,
				body: {
					detail: desktopRequestDeadlineDetail("sessions.answer", 165_000),
				},
			}),
		),
		false,
	);
	// D. the daemon could not reach the owner, and E. the owner is busy: both are the
	// transport's own register and both may be repeated.
	assert.equal(
		askRefusalIsOwner(
			await refusalFromTheWire({
				status: 503,
				body: { detail: { code: DESKTOP_LOST_SIGHT_CODE.runtimeUnreachable } },
			}),
		),
		false,
	);
	assert.equal(
		askRefusalIsOwner(
			await refusalFromTheWire({
				status: 503,
				body: { detail: { code: RUNTIME_BUSY_CODE } },
			}),
		),
		false,
	);
	// F. a 404 answers about a different subject, so it is not a statement about this
	// ask's window however its body is worded.
	assert.equal(
		askRefusalIsOwner(
			await refusalFromTheWire({
				status: 404,
				body: { detail: "No session with that id." },
			}),
		),
		false,
	);
	// G. THE OWNER'S REFUSAL, in the shape the backend sends it: a 409 whose body is
	// its own sentence (the route's `HTTPException(409, "This question or approval is
	// no longer pending")`).
	const ownerRefusal = await refusalFromTheWire({
		status: 409,
		body: { detail: "This question or approval is no longer pending" },
	});
	assert.equal(askRefusalIsOwner(ownerRefusal), true);
	assert.equal(
		askRefusalSentence(ownerRefusal),
		"This question or approval is no longer pending",
	);
	// H. the same refusal with no sentence of its own: the status IS the verdict, and
	// the app says the state it can substantiate.
	const settledWithoutWords = await refusalFromTheWire({
		status: 409,
		body: { detail: { code: "already_answered" } },
	});
	assert.equal(askRefusalIsOwner(settledWithoutWords), true);
	// I. expiry, the other state the app substantiates.
	assert.equal(
		askRefusalIsOwner(
			await refusalFromTheWire({ status: 410, body: { detail: "Too old." } }),
		),
		true,
	);
	// J. a thrown value that is not a DesktopControlError at all - a runtime
	// exception, or the app's own diagnosis - is never the owner's sentence.
	assert.equal(askRefusalIsOwner(new Error("TypeError: fetch failed")), false);
});

test("the view's delivering count drops a row the owner refused, and the chip stops advertising it", () => {
	const rows = { asks: [answeredNotDelivered()], asks_open: 0 };
	// No outcomes: the wire's own reading, unchanged.
	assert.equal(askQueueView(rows).delivering, 1);
	// A transport failure leaves the answer the user's: still counted, door open.
	assert.equal(
		askQueueView(rows, {
			"a-revise": { sending: false, refused: "transport" },
		}).delivering,
		1,
	);
	// The owner's verdict: the door is shut, so the count must not advertise it. With a
	// second, still-changeable answer beside it the count is about the OPEN door alone.
	const refused = {
		sending: false,
		refused: "already delivered — send a new message",
		refusedByOwner: true,
	};
	assert.equal(askQueueView(rows, { "a-revise": refused }).delivering, 0);
	assert.equal(
		askQueueView(
			{ asks: [answeredNotDelivered(), lateNotDelivered()], asks_open: 0 },
			{ "a-revise": refused },
		).delivering,
		1,
	);
	assert.equal(
		askChipCountClause(
			askQueueView(
				{ asks: [answeredNotDelivered(), lateNotDelivered()], asks_open: 0 },
				{ "a-revise": refused },
			),
		),
		"1 answer not yet delivered — you can still change it",
	);
	/*
	 * A queue whose ONLY undelivered answer was refused therefore reports settled - and
	 * that is the owner's own statement, not a second contradiction: the card still
	 * drawn from the stale frame carries the owner's sentence, which says the same
	 * thing ("already delivered"). What the clause must never do is the thing this
	 * finding measured: say the door is open where the card refuses it.
	 */
	assert.equal(
		askChipCountClause(askQueueView(rows, { "a-revise": refused })),
		"All asks settled",
	);
	/*
	 * AND THE DRAWER CHROME'S OWN LINE, which is the string that sits directly above the
	 * card: it is the scope subject plus the drawer's count clause, so the same exclusion
	 * reaches the surface the finding measured.
	 */
	assert.equal(
		askScopeLine(
			"session",
			askQueueView(
				{ asks: [answeredNotDelivered(), lateNotDelivered()], asks_open: 0 },
				{ "a-revise": refused },
			),
		),
		"This conversation · 1 answer not yet delivered — you can still change it",
	);
	assert.equal(
		askScopeLine("session", askQueueView(rows, { "a-revise": refused })),
		"This conversation · All asks settled",
	);
});

test("a late-undelivered row does not claim the agent was told", () => {
	/*
	 * Design round 2, D7 = UX round 2, U6, second half: the contract's `late` sentence
	 * ends "the agent was told", which is the fact that makes a late answer TERMINAL -
	 * and it was false for exactly the window the card carries a change door for, so the
	 * row read "Answered late — the agent was told" beside its own "not yet delivered —
	 * you can still change it".
	 */
	assert.equal(
		askStatusText(lateNotDelivered(), NOW),
		ASK_LATE_UNDELIVERED_TEXT,
	);
	assert.equal(ASK_LATE_UNDELIVERED_TEXT, "Answered late — not yet delivered");
	const markup = panelMarkup(lateNotDelivered());
	assert.ok(markup.includes("Answered late — not yet delivered"));
	assert.equal(
		markup.includes("the agent was told"),
		false,
		"the card must not claim a delivery the wire has not made",
	);
	// A DELIVERED late row keeps the contract's own words: the settled section's one-line
	// WORD (`Answered late`) is what tells it from a plain `Answered`, and that word is
	// still read from the contract.
	assert.equal(
		askStatusText(lateNotDelivered({ delivered: true }), NOW),
		"Answered late — the agent was told",
	);
	assert.equal(askStatusWord("late"), "Answered late");
});

test("a change that landed leaves a receipt the first-answer frame does not", () => {
	const markup = panelMarkup(answeredNotDelivered(), {
		outcomes: {
			"a-revise": { sending: false, refused: null, changed: true },
		},
	});
	// The wire cannot mark an accepted revision (the fold keeps the FIRST `answered`'s
	// status, stamp and attribution), so this line is the only evidence on the artefact
	// that a deliberate change happened rather than that an answer was given
	// (design round 1, D3; UX round 1, U3).
	assert.ok(
		markup.includes("Changed — the agent has not been handed it yet."),
		"the receipt for a landed change",
	);
	// The door stays open: a revision is free while the answer is undelivered, so a
	// second change is still one press away.
	assert.ok(markup.includes("Change answer"));
	// An untouched card carries no such line.
	assert.equal(
		panelMarkup(answeredNotDelivered()).includes("Changed —"),
		false,
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
	// `All asks settled` here would be the chip contradicting the panel it opens, and
	// the clause names the door rather than only the wire's condition (UX round 1, U4).
	assert.equal(
		askChipCountClause(view),
		"1 answer not yet delivered — you can still change it",
	);

	// The plural is a clause of its own: one count, two recorded answers.
	assert.equal(
		askChipCountClause(
			askQueueView({
				asks: [answeredNotDelivered(), lateNotDelivered()],
				asks_open: 0,
			}),
		),
		"2 answers not yet delivered — you can still change them",
	);

	// A DELIVERED answered ask keeps today's sentence.
	assert.equal(
		askChipCountClause(
			askQueueView({ asks: [answeredDelivered()], asks_open: 0 }),
		),
		"All asks settled",
	);
	assert.equal(presentAsk(answeredDelivered()).delivering, false);
});
