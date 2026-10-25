import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE DESKTOP DISMISS DOOR, pinned against the SHIPPED modules.
 *
 * Harness PR #2833 added a fourth shape to `POST .../answers`:
 * `{ask_id, dismiss: true, reason?}`. This file holds the three facts that a
 * frame cannot prove and a future edit could break silently:
 *
 * 1. **The body is the wire's shape, and only the wire's.** The constructor and
 *    the real schema are asserted together, because a body the app composed
 *    itself would otherwise come back as a 422 the user reads as "your press
 *    failed" — and a dismissal carries no answers, no decline and no epoch.
 * 2. **The door is gated on the capability.** A backend without
 *    `features.ask_dismiss` refuses the field (`Answer` is `extra="forbid"`), so
 *    the caller leaves `onDismiss` undefined and the card must draw no button —
 *    the dead-affordance defect this panel refuses elsewhere.
 * 3. **The card states the conversation's movement, and the receipt states the
 *    reason.** `user_messages_since` renders only above zero and only while the
 *    ask is still open; a dismissal folds the ask into the settled half, so its
 *    reason has to survive on the settled one-line row.
 *
 * The markup is `renderToStaticMarkup` of the PRODUCTION `AskPanel` — the same
 * rig `ask-revise.test.mjs` uses for the change form, for the same reason: the
 * card owns `useState`/`useMemo`, so it cannot be called as a plain function.
 * A click is not dispatched here; the live path (the POST and its refusal) is
 * covered by the PR's behavioural matrix and the QA matrix.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export { AskPanel } from "./src/renderer/src/features/chat/components/asks/ask-panel";',
			'export { askQueueView, askDismissRequest, askResponseSummary, presentAsk } from "./src/renderer/src/features/chat/ask-queue";',
			'export { dismissQueuedAsk, createSendLock } from "./src/renderer/src/features/chat/ask-answer";',
			'export { desktopRequestSchema, desktopEndpoint } from "./src/shared/desktop-contract";',
			'export { desktopFeatureEnabled } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";',
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
	 * must be rendered by the same dispatcher this file imports. `react-dom/server`
	 * stays external for the measurement `ask-options.test.mjs` records (its CJS
	 * build reaches for a dynamic `require("stream")` that an ESM bundle cannot
	 * satisfy), and `@tanstack/react-query` so the modules' `useQuery` finds the one
	 * the app provides.
	 */
	define: { "import.meta.env": "{}" },
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});

const bundlePath = new URL("./_ask-dismiss.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const {
	AskPanel,
	askQueueView,
	askDismissRequest,
	askResponseSummary,
	dismissQueuedAsk,
	createSendLock,
	desktopRequestSchema,
	desktopEndpoint,
	desktopFeatureEnabled,
} = await import(bundlePath.href);
await unlink(bundlePath);

/* The wire's session id shape: 12 lowercase hex digits (`sessionIdPattern`). */
const SESSION = "0f9c1e2d3a4b";
/*
 * Source pins for the two gate sites (agent review M2), at module scope so the lint's
 * per-call regex rule stays quiet.
 */
const DISMISS_GATE =
	/desktopFeatureEnabled\(\s*capabilities\.data,\s*"ask_dismiss",?\s*\)/;
const SESSION_DOOR =
	/onDismissAsk: desktopFeatureEnabled\([\s\S]{0,120}?\? \(taskId: string, reason: AskDismissReason\) =>/;
const NOW = 1_700_000_000_000;

function openAsk(overrides = {}) {
	return {
		ask_id: "a-dismiss",
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
		],
		...overrides,
	};
}

const panelMarkup = (ask, extra = {}) =>
	renderToStaticMarkup(
		createElement(AskPanel, {
			view: askQueueView({
				asks: [ask],
				asks_open: ask.status === "open" || ask.status === "timed_out" ? 1 : 0,
			}),
			nowMs: NOW,
			answering: false,
			drafts: {},
			onDraftChange: () => undefined,
			onAnswer: () => undefined,
			onDecline: () => undefined,
			...extra,
		}),
	);

/* --------------------------------------------------------------- the body ---- */

test("the dismissal body is the ask id, the flag and the reason — and no epoch", () => {
	const request = askDismissRequest(openAsk(), SESSION, "moot");
	assert.deepEqual(request, {
		op: "sessions.answer",
		sessionId: SESSION,
		askId: "a-dismiss",
		dismiss: true,
		reason: "moot",
	});
	// A queued ask outlives the owner epoch that raised it; an epoch here would
	// suggest a comparison the route deliberately does not make.
	assert.equal("epoch" in request, false);

	const answeredInChat = askDismissRequest(
		openAsk(),
		SESSION,
		"answered_in_chat",
	);
	assert.equal(answeredInChat.reason, "answered_in_chat");
});

test("the real schema accepts a dismissal and refuses the shapes that contradict it", () => {
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "sessions.answer",
			sessionId: SESSION,
			askId: "a-dismiss",
			dismiss: true,
			reason: "moot",
		}).success,
		true,
	);
	// The reason is optional: absent, the ask log records `moot`.
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "sessions.answer",
			sessionId: SESSION,
			askId: "a-dismiss",
			dismiss: true,
		}).success,
		true,
	);
	// A reason without the flag is a no-op field, refused rather than dropped.
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "sessions.answer",
			sessionId: SESSION,
			askId: "a-dismiss",
			reason: "moot",
		}).success,
		false,
	);
	// One ask cannot be answered and dismissed in one body.
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "sessions.answer",
			sessionId: SESSION,
			askId: "a-dismiss",
			dismiss: true,
			answers: { q1: ["staging"] },
		}).success,
		false,
	);
	// A gate has no ask to put away.
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "sessions.answer",
			sessionId: SESSION,
			epoch: "owner-epoch",
			requestId: "gate-id",
			dismiss: true,
		}).success,
		false,
	);
	/*
	 * `dismiss: false` is the same statement as omitting the key (the backend's
	 * own words), so the gate shape accepts it rather than inventing a stricter
	 * rule than the route that answers it.
	 */
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "sessions.answer",
			sessionId: SESSION,
			epoch: "owner-epoch",
			requestId: "gate-id",
			approved: true,
			dismiss: false,
		}).success,
		true,
	);
});

test("the transport sends the dismissal as ask_id + dismiss + reason", () => {
	const mapped = desktopEndpoint({
		op: "sessions.answer",
		sessionId: SESSION,
		askId: "a-dismiss",
		dismiss: true,
		reason: "answered_in_chat",
	});
	assert.equal(mapped.path, `/v1/desktop/sessions/${SESSION}/answers`);
	assert.equal(mapped.method, "POST");
	/*
	 * THE BODY AS THE WIRE CARRIES IT: the mapper's object keeps absent fields as
	 * `undefined` for the ordinary answer arms, and JSON is what crosses the IPC
	 * channel — so the assertion is on the serialized shape, exactly as the live
	 * transport sends it.
	 */
	assert.deepEqual(JSON.parse(JSON.stringify(mapped.body)), {
		ask_id: "a-dismiss",
		dismiss: true,
		reason: "answered_in_chat",
	});
	/*
	 * AN ORDINARY ANSWER MUST NOT CARRY THE FIELD: an older harness refuses the
	 * whole body (`extra="forbid"`), so a first answer that always sent
	 * `dismiss: false` would 422 on every runtime that predates the feature.
	 */
	const answer = desktopEndpoint({
		op: "sessions.answer",
		sessionId: SESSION,
		askId: "a-dismiss",
		answers: { q1: ["staging"] },
	});
	assert.equal("dismiss" in answer.body, false);
	assert.equal("reason" in answer.body, false);
});

test("a dismissal posts once and takes the shared one-answer-in-flight lock", async () => {
	const lock = createSendLock();
	const seen = [];
	const outcome = await dismissQueuedAsk(
		{ taskId: "a-dismiss", reason: "moot", sessionId: SESSION, lock },
		async (request) => {
			seen.push(request);
		},
	);
	assert.equal(outcome.status, "sent");
	assert.deepEqual(seen, [
		{
			op: "sessions.answer",
			sessionId: SESSION,
			askId: "a-dismiss",
			dismiss: true,
			reason: "moot",
		},
	]);
	assert.equal(lock.held, false);

	// While another answer holds the lock, a dismissal is refused before it sends.
	const held = createSendLock();
	assert.equal(held.tryAcquire(), true);
	const refused = await dismissQueuedAsk(
		{ taskId: "a-dismiss", reason: "moot", sessionId: SESSION, lock: held },
		async () => {
			throw new Error("must not send");
		},
	);
	assert.equal(refused.status, "refused");
	held.release();
	// A missing address is refused rather than posted to the wrong place.
	assert.equal(
		(
			await dismissQueuedAsk(
				{ taskId: "", reason: "moot", sessionId: SESSION, lock },
				async () => undefined,
			)
		).status,
		"refused",
	);
});

/* --------------------------------------------------------------- the copy ---- */

test("a dismissed receipt is the harness's sentence, with the surface and the reason", () => {
	assert.equal(
		askResponseSummary({
			askId: "a-1",
			status: "dismissed",
			by: { surface: "desktop" },
			reason: "moot",
		}),
		"Dismissed by you (desktop) — no longer needed (ask a-1)",
	);
	assert.equal(
		askResponseSummary({
			askId: "a-1",
			status: "dismissed",
			by: { surface: "remote" },
			reason: "answered_in_chat",
		}),
		"Dismissed by you (phone) — settled in chat (ask a-1)",
	);
	// An older row names neither: the sentence still reads, without inventing a
	// surface or a reason the record does not hold.
	assert.equal(
		askResponseSummary({ askId: "a-1", status: "dismissed" }),
		"Dismissed by you — no longer needed (ask a-1)",
	);
});

/* -------------------------------------------------------------- the panel ---- */

test("the dismiss door exists only where the caller offers it (the capability gate)", () => {
	const without = panelMarkup(openAsk());
	assert.equal(without.includes("Dismiss"), false);

	const withDoor = panelMarkup(openAsk(), { onDismiss: () => undefined });
	assert.equal(withDoor.includes("Dismiss…"), true);
});

test("a lapsed ask offers no dismiss door even when the surface has one", () => {
	// D10: a timed-out ask is read-only on every surface. The trigger is gated on
	// `canAnswer` (status open), not on the prop alone.
	const lapsed = openAsk({ status: "timed_out", expires_at: NOW - 1000 });
	const markup = panelMarkup(lapsed, { onDismiss: () => undefined });
	assert.equal(markup.includes("Dismiss this ask"), false);
});

test("the card states the conversation's movement, and only above zero", () => {
	const quiet = panelMarkup(openAsk(), { onDismiss: () => undefined });
	assert.equal(quiet.includes("since this was asked"), false);

	const moved = panelMarkup(
		openAsk({
			user_messages_since: 3,
			last_user_message_at: NOW - 20 * 60_000,
		}),
		{ onDismiss: () => undefined },
	);
	assert.equal(
		moved.includes("3 messages from you since this was asked (last "),
		true,
	);

	// A settled ask's wait is over, so the line does not follow it there.
	const settled = panelMarkup(
		openAsk({
			status: "declined",
			user_messages_since: 3,
			last_user_message_at: NOW - 20 * 60_000,
		}),
	);
	assert.equal(settled.includes("since this was asked"), false);
});

test("a landed dismissal keeps its reason on the settled one-line row", () => {
	const markup = panelMarkup(openAsk({ status: "dismissed" }), {
		onDismiss: () => undefined,
		outcomes: {
			"a-dismiss": {
				sending: false,
				refused: null,
				dismissed: "answered_in_chat",
			},
		},
	});
	assert.equal(markup.includes("Dismissed — settled in chat"), true);
	// The card itself must offer nothing once the ask is settled.
	assert.equal(markup.includes("Dismiss this ask"), false);
});

test("a relay refusal is drawn inline on the card, not swallowed", () => {
	/*
	 * The harness refuses a relayed ask's dismissal in ITS own sentence
	 * (`asks/render.py`'s relay copy), and the panel's refusal band is the one
	 * place that sentence can land: the card is where the press was made, and a
	 * toast would lose it. This asserts the shipped outcome line, not a new one.
	 */
	const sentence =
		"this ask is relayed from another session — answer it there, or dismiss it here";
	const markup = panelMarkup(openAsk(), {
		onDismiss: () => undefined,
		outcomes: {
			"a-dismiss": { sending: false, refused: sentence, refusedByOwner: true },
		},
	});
	assert.equal(markup.includes(sentence), true);
});

test("both dismiss gate sites read features.ask_dismiss, and the helper fails closed", async () => {
	/*
	 * Agent review M2. The panel's own test proves "no prop, no button"; the gap was
	 * the two containers that RESOLVE the prop from the negotiated capabilities. They
	 * share one predicate, so this exercises it against the three capability shapes
	 * that matter and pins the expression at both sites (the chat page cannot be
	 * mounted in a node test - the repo pins its call site by source for the same
	 * reason, `ask-open-render.test.mjs`).
	 */
	const caps = (features, available = true) => ({
		desktop_available: available,
		features,
	});
	assert.equal(
		desktopFeatureEnabled(caps({ ask_dismiss: 1 }), "ask_dismiss"),
		true,
	);
	assert.equal(desktopFeatureEnabled(caps({}), "ask_dismiss"), false);
	assert.equal(desktopFeatureEnabled(null, "ask_dismiss"), false);
	assert.equal(
		desktopFeatureEnabled(caps({ ask_dismiss: 1 }, false), "ask_dismiss"),
		false,
		"an unpaired backend offers nothing, whatever its feature list says",
	);
	const chat = await readFile(
		"src/renderer/src/features/chat/components/chat-page.tsx",
		"utf8",
	);
	const fleet = await readFile(
		"src/renderer/src/features/chat/components/asks/fleet-ask-drawer.tsx",
		"utf8",
	);
	assert.match(
		chat,
		DISMISS_GATE,
		"the session drawer resolves the capability",
	);
	assert.match(fleet, DISMISS_GATE, "the fleet pane resolves the capability");
	assert.equal(
		fleet.includes("onDismiss={dismissEnabled ? onDismiss : undefined}"),
		true,
		"the fleet pane passes the door only when enabled",
	);
	assert.match(
		chat,
		SESSION_DOOR,
		"the session drawer passes the door only when enabled",
	);
});

test("a send that throws is a FAILURE carrying the request, and the lock is free again", async () => {
	/*
	 * Agent review M3. The refusal path (lock taken, no session) and the success path
	 * were pinned; the transport failure was correct by reading only. It is the one
	 * outcome that must not invent a sentence: the error is what the panel turns into
	 * the route's words (`askRefusalSentence`), and it must carry the request so the
	 * caller can say what was attempted. A lock left held after a throw would disable
	 * every later press in the mount.
	 */
	const lock = createSendLock();
	const outcome = await dismissQueuedAsk(
		{
			taskId: "a-dismiss",
			reason: "moot",
			sessionId: SESSION,
			lock,
		},
		async () => {
			throw new Error("boom");
		},
	);
	assert.equal(outcome.status, "failed");
	assert.equal(outcome.request.dismiss, true);
	assert.equal(outcome.request.askId, "a-dismiss");
	assert.equal(outcome.error.message, "boom");
	assert.equal(lock.held, false, "the lock is released on the failure path");
});
