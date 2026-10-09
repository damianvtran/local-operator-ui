import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The wakes control model: which rows may be cancelled, which ask first, which
 * are nobody's to stop — and what one attempt converges either way.
 *
 * The Wakes section draws a control for a route (and withholds one for a family
 * of ids), so the classification has a right answer per (id × session ×
 * capability × status) rather than a look, and the truth table below is that
 * answer written out. Three further things are constructed rather than
 * approximated, for the reasons the monitor family's tests state:
 *
 * - the operation's mapping onto the wire (the DELETE and its path), because
 *   the path is the one place a handle can go wrong;
 * - the retry boundary (`retryWakeWrite`, the pane's own write policy — one
 *   re-send, and only for a request that never got an answer);
 * - the outcome wrapper (`attemptWakeCancel`), whose whole point is that the
 *   canonical re-read fires on BOTH paths — a property of a promise's `finally`,
 *   which no screenshot can carry.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export { desktopEndpoint, desktopRequestSchema, DESKTOP_REFUSAL_CODE } from "./src/shared/desktop-contract";',
			'export { retryWakeWrite } from "./src/renderer/src/features/schedules/scheduled-task-model";',
			'export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
			'export * from "./src/renderer/src/features/chat/components/run-details/wake-controls-model";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
});
const {
	DESKTOP_REFUSAL_CODE,
	desktopEndpoint,
	desktopRequestSchema,
	retryWakeWrite,
	DesktopControlError,
	isManagedWakeId,
	sessionIsChiefOfStaff,
	wakeControlMode,
	wakeConfirmNamesChief,
	wakeConfirmTitle,
	wakeConfirmSentence,
	wakeConfirmActionLabel,
	managedWakeNote,
	managedWakeShortLabel,
	wakeRowKey,
	attemptWakeCancel,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/* ------------------------------------------------------------------ identity */

/** The chief of staff's identity as the app reads it, per axis. */
const aida = (overrides = {}) => ({
	capability: true,
	statusResolved: true,
	sessionId: "s-aida",
	name: "Aida",
	...overrides,
});

const context = (overrides = {}) => ({
	sessionId: "s1",
	wakeIds: ["w1"],
	aida: aida(),
	...overrides,
});

/* ------------------------------------------------------------------ mapping */

/*
 * The DELETE the pane's press sends, over the wake family's own route. One
 * assertion, three facts: the route, both handles in the path, the method the
 * core's route declares (`routes/desktop_wakes.py::delete_wake_route`).
 */
test("the cancel maps onto the wake route as a DELETE, both handles in the path", () => {
	assert.deepEqual(
		desktopEndpoint({
			op: "wakes.remove",
			sessionId: "a1b2c3d4e5f6",
			wakeId: "w2",
		}),
		{ path: "/v1/desktop/wakes/a1b2c3d4e5f6/w2", method: "DELETE" },
	);
});

/*
 * The CLIENT accepts an `aida-` id, deliberately, and this is the assertion
 * that keeps the guard from hiding behind a client-side refusal.
 *
 * The desktop contract's `wakeId` is `z.string().min(1).max(64)` — not the
 * route's `^w\d{1,4}$` pattern — because the route declares that pattern and
 * refuses a malformed handle with a 422 BEFORE any handler (verified against
 * the running daemon: `DELETE .../aida-cadence` answers 422 "The request has
 * invalid fields."). So the id-only guard is a UI rule with its own reason (an
 * engine re-arms those rows), NOT a consequence of a schema the app cannot get
 * past — and the day the route's pattern widens, the guard is still what keeps
 * a doomed request from being sent.
 */
test("the client schema admits an aida- id: the guard is a UI rule, not a schema accident", () => {
	const parsed = desktopRequestSchema.safeParse({
		op: "wakes.remove",
		sessionId: "a1b2c3d4e5f6",
		wakeId: "aida-cadence",
	});
	assert.equal(
		parsed.success,
		true,
		"the client must not be the thing refusing",
	);
});

/* ------------------------------------------------------ the classification */

test("an aida- id is managed on every session, without any identity read", () => {
	const unknowns = [
		context(),
		context({ sessionId: null }),
		context({ sessionId: "s-aida" }),
		context({
			aida: aida({ capability: false, statusResolved: false, sessionId: null }),
		}),
	];
	for (const ctx of unknowns) {
		assert.equal(wakeControlMode("aida-cadence", ctx), "managed");
		assert.equal(wakeControlMode("aida-extra-3", ctx), "managed");
		assert.equal(wakeControlMode("aida-greeting", ctx), "managed");
	}
});

test("the truth table: one verdict per row, in the guard's own order", () => {
	const table = [
		// [wake id, context overrides, expected verdict, why]
		["w1", {}, "one-click", "nothing about this session is hers"],
		["w1", { sessionId: "s-aida" }, "confirm", "the session IS hers (arm 2)"],
		[
			"w1",
			{ wakeIds: ["w1", "aida-cadence"] },
			"confirm",
			"engine rows present in the list (arm 3)",
		],
		[
			"w1",
			{ aida: aida({ statusResolved: false }) },
			"confirm",
			"fail closed while the identity is unknown (arm 4)",
		],
		[
			"w1",
			{ aida: aida({ capability: false, statusResolved: false }) },
			"one-click",
			"no capability means no identity to guard",
		],
		[
			"w1",
			{ sessionId: null, aida: aida({ sessionId: null }) },
			"one-click",
			"a null session is not equal to a null hers",
		],
		[
			"aida-cadence",
			{ sessionId: "s-aida", wakeIds: ["aida-cadence"] },
			"managed",
			"managed outranks every other arm",
		],
	];
	for (const [id, overrides, expected, why] of table) {
		assert.equal(wakeControlMode(id, context(overrides)), expected, why);
	}
});

test("the prefix test is the engine's own boundary", () => {
	assert.equal(isManagedWakeId("aida-cadence"), true);
	assert.equal(
		isManagedWakeId("aida-"),
		true,
		"the bare prefix is under it too",
	);
	assert.equal(isManagedWakeId("w1"), false);
	assert.equal(
		isManagedWakeId("aidax"),
		false,
		"not a prefix match on any id containing it",
	);
	assert.equal(
		isManagedWakeId("AIDA-cadence"),
		false,
		"the engine's ids are lowercase; this is an id test, not a case-folding rule",
	);
});

test("only the resolved identity lets a confirmation name her", () => {
	assert.equal(wakeConfirmNamesChief(context({ sessionId: "s-aida" })), true);
	assert.equal(
		wakeConfirmNamesChief(context({ wakeIds: ["aida-cadence"] })),
		false,
		"engine rows in the list confirm, and claim nothing",
	);
	assert.equal(
		wakeConfirmNamesChief(context({ aida: aida({ statusResolved: false }) })),
		false,
		"an unknown identity is never named",
	);
	assert.equal(sessionIsChiefOfStaff(null, aida({ sessionId: null })), false);
});

/* -------------------------------------------------------------------- copy */

test("the shared copy carries the named and neutral halves, and nothing else", () => {
	assert.equal(wakeConfirmTitle(true, "Aida"), "Cancel Aida's check-in?");
	assert.equal(wakeConfirmTitle(false, "Aida"), "Cancel this wake?");
	assert.equal(wakeConfirmActionLabel(true), "Cancel check-in");
	assert.equal(wakeConfirmActionLabel(false), "Cancel wake");
	assert.equal(
		wakeConfirmSentence({
			named: true,
			name: "Aida",
			head: "4-hourly check-in",
		}),
		"“4-hourly check-in” will not fire again, and nothing re-creates it. Aida's own cadence is unaffected.",
	);
	assert.equal(
		wakeConfirmSentence({ named: false, name: "Aida", head: "" }),
		"This wake will not fire again, and nothing re-creates it. The conversation stays.",
		"a message-less schedule still gets a subject",
	);
});

test("the managed state names the lever that works, in the operator's own words", () => {
	assert.equal(managedWakeShortLabel("Aida"), "managed by Aida");
	const note = managedWakeNote("Aida");
	assert.match(note, /\/aida pause/, "the sentence names the supported stop");
	assert.match(
		note,
		/Aida's own schedule/,
		"and says why there is no cancel here",
	);
	/*
	 * The D6 pins: no fixed pronoun for a configurable name, and none of the
	 * code's own vocabulary. Both were in the first revision's sentence.
	 */
	assert.doesNotMatch(note, /\bher\b|\bhis\b|\btheir\b/);
	assert.doesNotMatch(note, /engine|re-arms|re-arm/);
});

test("a row's mark key is the handle PLUS its creation instant", () => {
	/*
	 * F2 / Q1's whole mechanism in one function: the backend re-mints the lowest
	 * free handle, so `w1` is not an identity. A re-armed successor must produce a
	 * DIFFERENT key, and the fallback (`?`) must match only another fallback.
	 */
	const first = { id: "w1", createdAt: 1_700_000_000_000 };
	const successor = { id: "w1", createdAt: 1_700_000_500_000 };
	assert.notEqual(wakeRowKey(first), wakeRowKey(successor));
	assert.equal(
		wakeRowKey(first),
		wakeRowKey({ ...first }),
		"stable for one row",
	);
	assert.equal(wakeRowKey({ id: "w1", createdAt: null }), "w1:?");
	assert.notEqual(
		wakeRowKey({ id: "w1", createdAt: null }),
		wakeRowKey(first),
		"a payload with no instant never matches one that has it",
	);
});

/* ------------------------------------------------------------------- write */

/*
 * The retry boundary: the wake family's own policy, one re-send for a request
 * that never got an answer, nothing else. `failureCount < 1` is exactly one
 * retry (TanStack v5 calls the callback first with `failureCount === 0`).
 */
/*
 * The retry boundary, NARROWED in round 1 (F6): one re-send for a request that
 * never got an answer, plus the route's own contention 503 — nothing else. The
 * answered 503s (the three owner refusals) are the outcome itself, exactly the
 * set the monitors' policy excludes, and the first revision's blanket
 * `isServerUnreachable` reading re-sent them. `failureCount < 1` is exactly one
 * retry (TanStack v5 calls the callback first with `failureCount === 0`).
 */
test("the write retries once, and only a request nothing answered", () => {
	const refused = (status, code) =>
		new DesktopControlError(status, "transport", undefined, code);
	assert.equal(
		retryWakeWrite(0, new DesktopControlError(null, "no response")),
		true,
		"a request that never got an answer is retried",
	);
	assert.equal(
		retryWakeWrite(1, new DesktopControlError(null, "no response")),
		false,
		"and only once",
	);
	/* Main's SYNTHESISED no-answer 503: the request never left or never returned. */
	assert.equal(
		retryWakeWrite(0, refused(503, DESKTOP_REFUSAL_CODE.transportFailed)),
		true,
	);
	/* The route's own contention code: nothing was written, retrying is the fix. */
	assert.equal(retryWakeWrite(0, refused(503, "wake_write_busy")), true);
	/* The ANSWERED 503s: the owner refusals, which a re-send cannot repair. */
	assert.equal(retryWakeWrite(0, refused(503, "wake_owner_present")), false);
	assert.equal(retryWakeWrite(0, refused(503, "wake_owner_wedged")), false);
	assert.equal(
		retryWakeWrite(0, refused(503, "wake_owner_unavailable")),
		false,
	);
	assert.equal(
		retryWakeWrite(0, refused(503)),
		false,
		"a bare 503 is an answer",
	);
	assert.equal(
		retryWakeWrite(0, refused(404)),
		false,
		"a refusal is an answer",
	);
	assert.equal(
		retryWakeWrite(0, refused(422)),
		false,
		"and so is a shape refusal",
	);
	assert.equal(retryWakeWrite(0, new Error("boom")), false);
});

/*
 * The outcome wrapper's one promise: the re-read fires on BOTH paths.
 *
 * A refusal can be the face of a write that LANDED (a retried cancel whose
 * first attempt was answered and whose response was lost answers the honest
 * "no wake with id"), so success-only convergence leaves a row the store no
 * longer holds; and a refusal that changed nothing is reconciled by the same
 * re-read at no cost. The counts below are the assertion.
 */
test("one attempt converges the conversation either way, and reports what happened", async () => {
	const resyncs = [];
	const ok = await attemptWakeCancel({
		run: async () => undefined,
		describe: () => "no",
		resync: () => resyncs.push("resync"),
	});
	assert.deepEqual(ok, { ok: true });
	assert.equal(resyncs.length, 1, "success converged once");

	const refused = await attemptWakeCancel({
		run: async () => {
			throw new Error("refused");
		},
		describe: (error) => `said: ${error.message}`,
		resync: () => resyncs.push("resync"),
	});
	assert.deepEqual(refused, { ok: false, detail: "said: refused" });
	assert.equal(resyncs.length, 2, "and so did the refusal");
});
