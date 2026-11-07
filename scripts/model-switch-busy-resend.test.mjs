import assert from "node:assert/strict";
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE MODEL SWITCH THAT LANDS BUT REPORTS FAILURE — the operator's own words for
 * it: "a switch that lands but reports failure is worse than one that fails
 * cleanly."
 *
 * `POST /v1/desktop/sessions/{id}/commands` reaches the owning runtime over the
 * attach socket, which WRITES the frame and then waits out a 15 s ack
 * (`mobile/attach_client.py`). A lost ack is therefore INDETERMINATE, and the
 * daemon says so with `503 {"code": "runtime_busy", "retryable": true,
 * "retry_after_ms": 2000}` plus `Retry-After: 2` — deliberately without inferring
 * success (the backend pins that; it is not changed here).
 *
 * The app already owns the patience for that refusal (`withBusyResends`). What it
 * could not do on THIS route was use it, because the route claims its receipt
 * WITHOUT `retry_safe` (`desktop_receipts.py`: `retry_safe: bool = False`, and
 * `desktop_sessions.py`'s `/commands` passes none): a resend under the SAME
 * request id meets the journal's "Request outcome is indeterminate" 409. The
 * first half of this defect therefore left the route un-retried on purpose, and a
 * previous attempt that wrapped the hook's `run` there measured WORSE copy ("did
 * not run" over a switch that had applied).
 *
 * The fix is one level down: the dispatch mints its own request id, so REPEATING
 * THE DISPATCH is a fresh journal claim rather than a receipt conflict, and
 * re-running `set_model` with the same target is idempotent in effect. What these
 * cases pin:
 *
 * 1. **A busy switch is repeated, each attempt with a FRESH request id, and a
 *    success on a later attempt is CONFIRMED** — the press the operator made
 *    answers as the switch it was, not as an unconfirmed doubt.
 * 2. **Spent attempts keep the honest register**: `unconfirmed: true` and the
 *    warning "The request could not be confirmed.", never a definite "did not
 *    run" claim over a switch that may have applied.
 * 3. **Every other failure fails on the FIRST attempt, untouched**: a 409/422
 *    refusal and a deadline breach are not retried, so the classification at
 *    each call site sees exactly what it saw before this existed.
 * 4. **The repeat is opt-in and only the model switch opts in** — a `/goal`
 *    dispatch on the same busy refusal still goes out exactly once (a fresh id
 *    there would admit a second turn), and the source is pinned so a second
 *    caller cannot quietly inherit the option.
 *
 * The modules are the REAL ones, bundled with esbuild, and the transport is the
 * run's own `send` seam: nothing fakes the retry policy, the classification or
 * the request ids, because a stub of any of them would let a wrong bound or a
 * same-id resend pass.
 */

/*
 * THE STORE COMES IN WITH THE MODULE (the repeat policy is imported from it, not
 * restated), and its module scope touches `localStorage`. The sibling suites stub
 * it the same way and for the same reason: this file measures the switch, not the
 * storage layer.
 */
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};

const bundle = await build({
	stdin: {
		contents: [
			'export { runSessionCommand } from "./src/renderer/src/features/chat/pickers/use-picker-backend";',
			'export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
			'export { RUNTIME_BUSY_CODE } from "./src/shared/desktop-contract";',
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
	`./_model-switch-busy-resend-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
/*
 * THE ARTIFACT IS ALSO REAPED ON EXIT. The `finally` below only runs if this
 * process gets as far as the import; a run that fails to build, or one killed
 * between the write and the import (a bounded harness, a cancelled QA lane),
 * leaves `scripts/_<name>-<pid>.mjs` in the worktree — measured, and the reason
 * this handler exists rather than the `finally` alone.
 */
process.once("exit", () => {
	try {
		rmSync(bundlePath, { force: true });
	} catch {
		/* An exit path must not mask the failure it is running past. */
	}
});

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
const { runSessionCommand, DesktopControlError } = shipped;

/*
 * Top-level literals only (biome's `useTopLevelRegex`): the loop below runs them
 * once per attempt, and a per-call literal is the shape that rule exists for.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DID_NOT_RUN = /did not run/i;
const UNCONFIRMED = /unconfirmed|could not be confirmed/i;
const MODULE_FILE = /\.(ts|tsx)$/;

const SESSION = "4f2a9c1e8b7d";
const TARGET = "deepseek/deepseek-flash";
const NO_REPLY =
	"Session owner is unavailable. Reconnect and reconcile before retrying.";

/**
 * The backend's busy body, built the way the wire builds it.
 *
 * `retry_after_ms` is ZERO so the loop's own `setTimeout` is real and immediate:
 * the shipped value is 2 s, and a future change that ignored the hint would show
 * up here as a slow test rather than a false pass.
 */
const busy = () =>
	new DesktopControlError(503, NO_REPLY, undefined, "runtime_busy", 0, {
		code: "runtime_busy",
		retryable: true,
		retry_after_ms: 0,
	});

/** The runtime's own acknowledgement of a switch that landed. */
const switched = {
	command: "model",
	result: {
		kind: "notice",
		text: "Model set to deepseek/deepseek-flash",
		style: "success",
		data: {},
	},
};

const dispatchInput = (overrides = {}) => ({
	sessionId: SESSION,
	command: "model",
	args: TARGET,
	resendWhileBusy: true,
	...overrides,
});

/* --------------------- 1. the repeat, a fresh id per attempt, a confirmed end */

test("a busy model switch is repeated with a FRESH request id, and a later attempt is confirmed", async () => {
	const requests = [];
	let attempt = 0;
	const outcome = await runSessionCommand(dispatchInput(), async (request) => {
		requests.push(request);
		attempt += 1;
		if (attempt < 3) throw busy();
		return switched;
	});

	assert.equal(requests.length, 3, "the press is repeated until it lands");
	/*
	 * THE CRUX, ASSERTED AS OBSERVED TRAFFIC. The route's receipt is claimed
	 * `retry_safe=False`, so a repeat under the same id is the journal's
	 * "outcome is indeterminate" 409 — a definite failure reported over a switch
	 * that may have applied, which is the defect. Distinct ids are what make the
	 * repeat a fresh claim instead.
	 */
	const ids = requests.map((request) => request.requestId);
	assert.equal(
		new Set(ids).size,
		ids.length,
		"each dispatch claims its own receipt",
	);
	for (const id of ids) {
		assert.match(id, UUID, "the id is a minted uuid, not a reused one");
	}
	/*
	 * The same INTENT every time: same session, command and target. Only the id
	 * moves, which is what keeps the repeat an idempotent `set_model` rather than
	 * a second, different request.
	 */
	for (const request of requests) {
		assert.equal(request.op, "sessions.command");
		assert.equal(request.sessionId, SESSION);
		assert.equal(request.command, "model");
		assert.equal(request.args, TARGET);
	}
	assert.deepEqual(
		outcome.outcome,
		switched.result,
		"the landed switch is the answer",
	);
	assert.equal(outcome.result.tone, "success");
	assert.equal(
		outcome.unconfirmed,
		undefined,
		"a switch that landed on a repeat is confirmed, not a doubt",
	);
});

/* ---------------------------------- 2. spent attempts keep the honest register */

test("an exhausted repeat says the switch may or may not have taken effect, never that it did not run", async () => {
	const requests = [];
	let outcome;
	try {
		outcome = await runSessionCommand(dispatchInput(), async (request) => {
			requests.push(request);
			throw busy();
		});
	} catch (error) {
		assert.fail(`the run must classify, not throw: ${error}`);
	}

	/*
	 * ONE DISPATCH PLUS `BUSY_RESENDS` REPEATS. The bound lives in the store
	 * (`BUSY_RESENDS = 3`) and is deliberately not restated in shipped code; it is
	 * restated HERE as the user-facing patience this route now spends, so moving it
	 * fails this test and the number is re-read rather than quietly drifting.
	 */
	assert.equal(
		requests.length,
		4,
		"three repeats, then the refusal reaches the caller",
	);
	assert.equal(
		new Set(requests.map((request) => request.requestId)).size,
		4,
		"an exhausted repeat never falls back to reusing an id",
	);
	assert.equal(outcome.outcome, null);
	assert.equal(outcome.unconfirmed, true);
	assert.equal(outcome.result.tone, "warning", "not a definite error");
	const text = outcome.result.text;
	assert.ok(
		!DID_NOT_RUN.test(text),
		`the exhausted case must not claim the switch did not run: ${text}`,
	);
	assert.ok(
		UNCONFIRMED.test(text),
		`the exhausted case keeps the indeterminate register: ${text}`,
	);
});

/* ------------------------- 3. everything else fails on the first attempt */

test("a non-busy refusal is NOT retried: one attempt, the owner's own verdict", async () => {
	const refusals = [
		// What a same-id replay would have earned, quoted so a regression that
		// reintroduced one is recognisable in the failure output.
		new DesktopControlError(
			409,
			"Request outcome is indeterminate. Reconcile session state before issuing a new request",
			undefined,
			undefined,
			undefined,
			{ code: "receipt_conflict" },
		),
		new DesktopControlError(
			422,
			"unknown model: deepseek/deepseek-flash",
			undefined,
			undefined,
			undefined,
			{
				code: "model_invalid",
			},
		),
	];
	for (const refusal of refusals) {
		const requests = [];
		const outcome = await runSessionCommand(
			dispatchInput({ failure: "The model was not changed" }),
			async (request) => {
				requests.push(request);
				throw refusal;
			},
		);
		assert.equal(
			requests.length,
			1,
			`only a runtime_busy refusal may be repeated (${refusal.status})`,
		);
		assert.equal(
			outcome.unconfirmed,
			false,
			"an acknowledged refusal is a definite answer",
		);
		assert.equal(outcome.result.tone, "error");
		assert.ok(
			outcome.result.text.startsWith("The model was not changed"),
			`the caller's own prefix is kept: ${outcome.result.text}`,
		);
	}
});

test("a deadline breach is not retried either, so the repeat cannot compound the renderer's deadline", async () => {
	const requests = [];
	const outcome = await runSessionCommand(dispatchInput(), async (request) => {
		requests.push(request);
		// What `withDeadline` raises: no status, no route-authored code.
		throw new DesktopControlError(null, "The request took too long to answer.");
	});
	assert.equal(requests.length, 1, "a timeout is not a retryable refusal");
	assert.equal(outcome.unconfirmed, true, "no answer is not proof of refusal");
});

/* --------------------------- 4. the repeat is opt-in, and only this caller opts in */

test("a frame that lands during the wait ends the REPEAT, not the press (design D3)", async () => {
	/*
	 * The lost-ack arm where the switch DID land: the authoritative frame arrives
	 * while the first attempt is failing, so a second dispatch would ask the owner
	 * for something it has already done — and the dialog would keep reading
	 * `Switching the model…` over a session already on it (design round 1, D3).
	 *
	 * The stop is observed as traffic: the first dispatch happened, and no second
	 * one follows. The run reports `confirmedByFrame` rather than `unconfirmed`.
	 */
	let landed = false;
	const requests = [];
	const outcome = await runSessionCommand(
		dispatchInput({ landed: () => landed }),
		async (request) => {
			requests.push(request);
			// The owner applies the switch, then loses the ack.
			landed = true;
			throw busy();
		},
	);
	assert.equal(
		requests.length,
		1,
		"no second dispatch once the frame has named it",
	);
	assert.equal(outcome.confirmedByFrame, true, "the frame is the confirmation");
	assert.equal(
		outcome.unconfirmed,
		undefined,
		"not the indeterminate register",
	);
	assert.equal(outcome.outcome, null, "there is no receipt to quote");
});

test("a press on the model the session ALREADY names is still sent, exactly once (design round 2, D5)", async () => {
	/*
	 * THE FALLBACK-PIN CASE. With a fallback serving (selected A, effective B),
	 * re-selecting A is the documented way the backend drops the pin
	 * (`session.py::_drop_fallback_pin`, "explicit re-selection of the SAME
	 * model"). So `landed` must never suppress the FIRST dispatch: read before
	 * every attempt, it did — nothing went out, the picker marked A as in force,
	 * and B kept serving. That is a false confirmation over a switch that never
	 * happened, the defect this whole change exists to remove.
	 *
	 * A predicate that is true from the start now costs nothing: the first send is
	 * unconditional, and its receipt is the press's answer.
	 */
	const requests = [];
	const outcome = await runSessionCommand(
		dispatchInput({
			// The session already names the target, and says so before the press.
			landed: () => true,
		}),
		async (request) => {
			requests.push(request);
			return switched;
		},
	);
	assert.equal(requests.length, 1, "the press is sent exactly once");
	assert.equal(requests[0].command, "model");
	assert.equal(requests[0].args, TARGET, "the send carries the picked model");
	assert.equal(outcome.outcome, switched.result, "the receipt is the answer");
	assert.equal(
		outcome.confirmedByFrame,
		undefined,
		"a receipted press is not the frame-confirmed arm",
	);
});

test("a caller that does not opt in is dispatched exactly once, even on a busy refusal", async () => {
	/*
	 * `/goal`'s dispatch, with the option absent — the shape every other caller in
	 * this tree still uses. A fresh id here would be a SECOND admitted turn: the
	 * repeat is only safe because a model switch is idempotent in effect, and that
	 * argument does not transfer to a command with an append in it.
	 */
	for (const command of ["goal", "loop", "approve"]) {
		const requests = [];
		const outcome = await runSessionCommand(
			{ sessionId: SESSION, command, args: "x", resendWhileBusy: undefined },
			async (request) => {
				requests.push(request);
				throw busy();
			},
		);
		assert.equal(requests.length, 1, `${command} must not be repeated`);
		assert.equal(outcome.unconfirmed, true);
	}
});

test("only the model switch asks for the repeat, and the id is minted inside the dispatch", () => {
	const root = "src/renderer/src";
	const optedIn = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) {
				walk(path);
				continue;
			}
			if (!MODULE_FILE.test(name)) continue;
			const source = readFileSync(path, "utf8");
			if (source.includes("resendWhileBusy: true")) optedIn.push(path);
		}
	};
	walk(root);
	assert.deepEqual(
		optedIn,
		["src/renderer/src/features/chat/pickers/destination-pickers.tsx"],
		"the repeat is a property of the model switch's call site, not of `sessions.command`",
	);

	/*
	 * AND THE ID MUST BE MINTED INSIDE THE CALLBACK the repeat re-invokes. If it
	 * moved above `withBusyResends`, every attempt would send the same id and the
	 * route would answer the journal's indeterminate 409 — the first half's failure
	 * mode, in one line of code. Behaviour is asserted above; this pins the shape
	 * so the two cannot drift.
	 */
	const source = readFileSync(
		"src/renderer/src/features/chat/pickers/use-picker-backend.ts",
		"utf8",
	);
	const dispatch = source.indexOf("const dispatch = async () => {");
	const id = source.indexOf("requestId: uuidv4()", dispatch);
	const repeat = source.indexOf("withBusyResends(dispatch)", dispatch);
	assert.ok(dispatch !== -1, "the dispatch callback is findable");
	assert.ok(
		id > dispatch && (repeat === -1 || id < repeat),
		"`requestId: uuidv4()` must live inside the callback the retry re-invokes",
	);
	assert.ok(repeat !== -1, "the dispatch is what the busy policy repeats");
});
