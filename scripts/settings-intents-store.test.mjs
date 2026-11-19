import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE SETTINGS-INTENT MIRROR'S PURE TRANSITIONS (`features.settings_intents`).
 *
 * WHY THIS FILE EXISTS. Behind the capability a model/effort/fast/cwd pick is
 * a durable server-side intent, and the renderer only mirrors it
 * (`src/renderer/src/shared/store/settings-intents.ts`). Every guarantee the
 * user sees rests on four rules in that module - per-session keying, last-wins
 * by generation, a local pick surviving its own round trip, and a GET baseline
 * that prunes what the server no longer holds - and each one is a pure
 * function, so each is falsified here directly rather than through a store or
 * a component that could hide it.
 */

const bundle = await build({
	stdin: {
		contents: `export * from "./src/renderer/src/shared/store/settings-intents";`,
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	EMPTY_SETTINGS_INTENTS,
	applyIntentFrame,
	applySessionSlots,
	chipIntents,
	failLocalIntent,
	dismissReachesServer,
	hydrateIntents,
	indicatorIntent,
	intentIndicator,
	intentOverride,
	intentWriteMark,
	newlyAppliedCwds,
	noteSupersededOnce,
	paintIntent,
	removeIntent,
	submitFailure,
} = mod;

const A = "aaaaaaaaaaaa";
const B = "bbbbbbbbbbbb";
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const slot = (over) => ({
	kind: "model",
	value: "openai/gpt-6",
	effort: null,
	request_id: uuid(1),
	generation: 1,
	base: "anthropic/claude-opus-5-5",
	state: "pending",
	attempts: 0,
	updated_at: "2026-11-09T12:00:00.000Z",
	error: null,
	...over,
});

test("a pick paints a local pending slot with the next generation", () => {
	const m = paintIntent(
		EMPTY_SETTINGS_INTENTS,
		A,
		{ kind: "model", value: "openai/gpt-6", requestId: uuid(1) },
		0,
	);
	assert.equal(m[A].model.state, "pending");
	assert.equal(m[A].model.local, true);
	assert.equal(m[A].model.generation, 1);
	assert.equal(intentOverride(m[A]).model, "openai/gpt-6");
	assert.equal(intentIndicator(m[A]), "applying");
});

test("coalesce: the newest pick wins and an older reply cannot replace it", () => {
	let m = paintIntent(EMPTY_SETTINGS_INTENTS, A, {
		kind: "model",
		value: "openai/gpt-6",
		requestId: uuid(1),
	});
	m = paintIntent(m, A, {
		kind: "model",
		value: "openai/gpt-7",
		requestId: uuid(2),
	});
	assert.equal(m[A].model.generation, 2);
	// The FIRST POST's reply lands late, at its real generation 1.
	const late = applyIntentFrame(
		m,
		A,
		"model",
		slot({ request_id: uuid(1), generation: 1 }),
	);
	assert.equal(late, m, "an older generation is a no-op (same object)");
	// The second POST's reply replaces the local paint (same request id).
	const replied = applySessionSlots(m, A, {
		model: slot({ value: "openai/gpt-7", request_id: uuid(2), generation: 2 }),
	});
	assert.equal(replied[A].model.local, undefined);
	assert.equal(replied[A].model.value, "openai/gpt-7");
});

test("a local pick survives a prune and a racing pick from another client at its guessed generation", () => {
	const m = paintIntent(EMPTY_SETTINGS_INTENTS, A, {
		kind: "model",
		value: "openai/gpt-6",
		requestId: uuid(1),
	});
	assert.equal(applyIntentFrame(m, A, "model", null), m);
	const racing = applyIntentFrame(
		m,
		A,
		"model",
		slot({ request_id: uuid(9), generation: 1, value: "x/y" }),
	);
	assert.equal(racing, m);
	// A strictly newer server generation does replace it.
	const newer = applyIntentFrame(
		m,
		A,
		"model",
		slot({ request_id: uuid(9), generation: 2, value: "x/y" }),
	);
	assert.equal(newer[A].model.value, "x/y");
});

test("frames walk the state within a generation and never touch another session", () => {
	let m = applyIntentFrame(EMPTY_SETTINGS_INTENTS, A, "model", slot({}));
	m = applyIntentFrame(m, B, "effort", slot({ kind: "effort", value: "high" }));
	const queued = applyIntentFrame(
		m,
		A,
		"model",
		slot({ state: "queued_next_step", updated_at: "2026-11-09T12:00:01.000Z" }),
	);
	assert.equal(queued[A].model.state, "queued_next_step");
	assert.equal(queued[B], m[B], "session B's slots are the same object");
	// A stale frame (earlier updated_at, same generation) loses.
	const stale = applyIntentFrame(
		queued,
		A,
		"model",
		slot({ state: "pending", updated_at: "2026-11-09T11:59:59.000Z" }),
	);
	assert.equal(stale, queued);
	// A prune removes a server slot, and the empty session goes with it.
	const pruned = applyIntentFrame(queued, A, "model", null);
	assert.equal(pruned[A], undefined);
	// A frame whose kind disagrees with its slot is refused.
	assert.equal(applyIntentFrame(m, A, "effort", slot({})), m);
});

test("hydrate: the GET baseline adds, replaces and prunes server slots but keeps local picks", () => {
	let m = applyIntentFrame(EMPTY_SETTINGS_INTENTS, A, "model", slot({}));
	m = paintIntent(m, B, { kind: "effort", value: "low", requestId: uuid(5) });
	const listed = {
		cccccccccccc: {
			cwd: slot({ kind: "cwd", value: "~/x", state: "waiting_idle" }),
		},
	};
	const h = hydrateIntents(m, listed);
	assert.equal(h[A], undefined, "A's slot was pruned during the outage");
	assert.equal(h[B].effort.local, true, "B's unanswered pick stays");
	assert.equal(h.cccccccccccc.cwd.state, "waiting_idle");
	assert.equal(intentIndicator(h.cccccccccccc), "applying");
	// A scoped read touches only its own session.
	const scoped = hydrateIntents(m, {}, B);
	assert.equal(scoped[A], m[A]);
	// An unchanged baseline is a no-op (same object).
	assert.equal(hydrateIntents(m, { [A]: m[A] }, A), m);
});

test("a failed POST keeps the slot as failed (Retry) only for its own request", () => {
	let m = paintIntent(EMPTY_SETTINGS_INTENTS, A, {
		kind: "model",
		value: "openai/gpt-6",
		requestId: uuid(1),
	});
	const error = submitFailure({
		status: 422,
		code: "model_unknown",
		message: "no",
	});
	assert.deepEqual(error, {
		code: "model_unknown",
		message: "no",
		retryable: false,
	});
	assert.equal(failLocalIntent(m, A, "model", uuid(2), error), m);
	m = failLocalIntent(m, A, "model", uuid(1), error);
	assert.equal(m[A].model.state, "failed");
	assert.equal(intentIndicator(m[A]), "failed");
	assert.equal(intentOverride(m[A]).model, null, "a failure paints nothing");
	assert.equal(chipIntents(m[A]).length, 1);
	// A transport failure (no status) is retryable.
	assert.equal(submitFailure({ status: null }).retryable, true);
	assert.equal(submitFailure({ status: null }).code, "runtime_unreachable");
});

test("dismiss is keyed by generation", () => {
	const m = applyIntentFrame(
		EMPTY_SETTINGS_INTENTS,
		A,
		"model",
		slot({ state: "failed", generation: 3 }),
	);
	assert.equal(removeIntent(m, A, "model", 2), m);
	assert.equal(removeIntent(m, A, "model", 3)[A], undefined);
});

test("superseded and applied slots paint and chip nothing; a paired effort overrides effort", () => {
	const sup = applyIntentFrame(
		EMPTY_SETTINGS_INTENTS,
		A,
		"model",
		slot({ state: "superseded" }),
	);
	assert.equal(intentIndicator(sup[A]), null);
	assert.equal(chipIntents(sup[A]).length, 0);
	assert.equal(intentOverride(sup[A]).model, null);
	const paired = applyIntentFrame(
		EMPTY_SETTINGS_INTENTS,
		A,
		"model",
		slot({ effort: "high", state: "applying" }),
	);
	assert.equal(intentOverride(paired[A]).effort, "high");
	// waiting_idle (cwd) keeps the directory in force: no override.
	const waiting = applyIntentFrame(
		EMPTY_SETTINGS_INTENTS,
		A,
		"cwd",
		slot({ kind: "cwd", value: "~/x", state: "waiting_idle" }),
	);
	assert.equal(intentOverride(waiting[A]).cwd, null);
	assert.equal(chipIntents(waiting[A])[0].state, "waiting_idle");
});

test("a burst across sessions keeps each session's slot independent", () => {
	let m = EMPTY_SETTINGS_INTENTS;
	const ids = [
		"111111111111",
		"222222222222",
		"333333333333",
		"444444444444",
		"555555555555",
	];
	ids.forEach((id, n) => {
		m = paintIntent(m, id, {
			kind: "model",
			value: `p/m${n}`,
			requestId: uuid(n),
		});
	});
	ids.forEach((id, n) => {
		assert.equal(intentOverride(m[id]).model, `p/m${n}`);
	});
	m = failLocalIntent(
		m,
		ids[2],
		"model",
		uuid(2),
		submitFailure({ status: null }),
	);
	assert.deepEqual(
		ids.map((id) => intentIndicator(m[id])),
		["applying", "applying", "failed", "applying", "applying"],
	);
});

/* ---- PR #1823 round 1 remediation ---------------------------------------- */

test("M1: a late POST reply never removes another kind's newer slot", () => {
	// The reviewer's repro: pick a model, then an effort; the effort reply
	// lands first, then the model reply taken BEFORE the effort POST reached
	// the server (so it lists only the model).
	let m = paintIntent(EMPTY_SETTINGS_INTENTS, A, {
		kind: "model",
		value: "openai/gpt-6",
		requestId: uuid(1),
	});
	m = paintIntent(m, A, { kind: "effort", value: "high", requestId: uuid(2) });
	m = applySessionSlots(m, A, {
		model: slot({
			request_id: uuid(1),
			state: "applying",
			updated_at: "2026-11-09T12:00:01.000Z",
		}),
		effort: slot({
			kind: "effort",
			value: "high",
			request_id: uuid(2),
			state: "queued_next_step",
		}),
	});
	const late = applySessionSlots(m, A, {
		model: slot({ request_id: uuid(1), state: "pending" }),
	});
	assert.deepEqual(Object.keys(late[A]).sort(), ["effort", "model"]);
	assert.equal(intentOverride(late[A]).effort, "high");
	// The older model state did not walk the slot backwards either.
	assert.equal(late[A].model.state, "applying");
});

test("M1: a GET baseline does not prune a slot written after it left", () => {
	const before = applyIntentFrame(EMPTY_SETTINGS_INTENTS, A, "model", slot({}));
	const mark = intentWriteMark(); // the GET leaves here
	// A frame lands while the GET is in flight: a new waiting cwd slot.
	const m = applyIntentFrame(
		before,
		A,
		"cwd",
		slot({ kind: "cwd", value: "/Users/x/src", state: "waiting_idle" }),
	);
	// The snapshot predates that frame and lists only the model.
	const h = hydrateIntents(m, { [A]: { model: m[A].model } }, undefined, mark);
	assert.equal(h[A].cwd?.state, "waiting_idle", "the newer cwd slot stays");
	// A slot that WAS in the mirror when the GET left, and that the snapshot
	// no longer lists, is still pruned: the baseline keeps its purpose.
	const pruned = hydrateIntents(m, { [A]: {} }, undefined, mark);
	assert.equal(pruned[A].model, undefined);
	assert.equal(pruned[A].cwd?.state, "waiting_idle");
});

test("M2: a cwd slot reaching applied yields its directory exactly once", () => {
	const waiting = applyIntentFrame(
		EMPTY_SETTINGS_INTENTS,
		A,
		"cwd",
		slot({ kind: "cwd", value: "/Users/x/src", state: "waiting_idle" }),
	);
	assert.deepEqual(newlyAppliedCwds(EMPTY_SETTINGS_INTENTS, waiting), []);
	const applied = applyIntentFrame(
		waiting,
		A,
		"cwd",
		slot({
			kind: "cwd",
			value: "/Users/x/src",
			state: "applied",
			updated_at: "2026-11-09T12:00:01.000Z",
		}),
	);
	assert.deepEqual(newlyAppliedCwds(waiting, applied), ["/Users/x/src"]);
	// The same applied slot seen again (a baseline repeating it) adds nothing.
	const again = { ...applied, [A]: { ...applied[A] } };
	assert.deepEqual(newlyAppliedCwds(applied, again), []);
	// An applied MODEL slot is not a directory.
	const model = applyIntentFrame(
		EMPTY_SETTINGS_INTENTS,
		B,
		"model",
		slot({ state: "applied" }),
	);
	assert.deepEqual(newlyAppliedCwds(EMPTY_SETTINGS_INTENTS, model), []);
});

test("M3: dismissing an ambiguous (5xx / no answer) local failure reaches the server", () => {
	const local = paintIntent(EMPTY_SETTINGS_INTENTS, A, {
		kind: "model",
		value: "openai/gpt-6",
		requestId: uuid(1),
	});
	const fail = (status) =>
		failLocalIntent(local, A, "model", uuid(1), submitFailure({ status }))[A]
			.model;
	assert.equal(dismissReachesServer(fail(503)), true, "5xx: may be stored");
	assert.equal(
		dismissReachesServer(fail(null)),
		true,
		"no answer: may be stored",
	);
	assert.equal(dismissReachesServer(fail(422)), false, "4xx: never stored");
	assert.equal(
		dismissReachesServer(slot({ state: "failed" })),
		true,
		"a server slot is always DELETEd",
	);
});

test("N1: a superseded request is noted once per renderer, not once per pane", () => {
	assert.equal(noteSupersededOnce(uuid(77)), true);
	assert.equal(
		noteSupersededOnce(uuid(77)),
		false,
		"a remount repeats nothing",
	);
	assert.equal(noteSupersededOnce(uuid(78)), true);
});

test("U4: the sidebar dot speaks for the failed slot first, else the live one", () => {
	const slots = {
		model: slot({ state: "applying" }),
		cwd: slot({ kind: "cwd", value: "/x", state: "failed" }),
	};
	assert.equal(indicatorIntent(slots), slots.cwd);
	assert.equal(indicatorIntent({ model: slots.model }), slots.model);
	assert.equal(indicatorIntent({ model: slot({ state: "applied" }) }), null);
	assert.equal(indicatorIntent(undefined), null);
});
