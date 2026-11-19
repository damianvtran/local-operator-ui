import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * A temporary upstream fault is not a refusal: retry it, then say so (#1087).
 *
 * THE DEFECT THIS PINS. The upstream's billing-account check answered HTTP 500,
 * the daemon mapped that to its own 502 (`stt/errors.py`,
 * `failure_status_and_detail`), and the app showed
 *
 *   Dictation failed: transcription failed upstream. Upstream responded 500:
 *   {"error":"failed to check billing accoun… Try again, or report it with the
 *   app's log.
 *
 * - a clipped JSON fragment in a permanent refusal's clothes, with no retry at
 * all, and the recorded take left in a state no control could reach. The three
 * claims held here are the three parts of the fix: the CLASS (only a fault time
 * can fix is retried), the LOOP (bounded, on the bytes already in hand), and the
 * SENTENCE (temporary, and trying again is the action).
 *
 * The client is driven through its real seam - a stubbed
 * `window.api.desktop.media`, which is what the preload bridge answers through -
 * so the code under test is the shipped one and not a restatement of its logic.
 * The call sites are read as source, the way `transcription-failure-copy.test.mjs`
 * reads them, because the wiring is what makes the sentence true on screen.
 */
const bundle = await build({
	stdin: {
		contents: `
			export {
				TranscriptionApi,
				TRANSIENT_TRANSCRIPTION_ATTEMPTS,
				TRANSIENT_TRANSCRIPTION_RETRY_DELAYS_MS,
				planTranscriptionRetry,
			} from "./src/renderer/src/shared/api/local-operator/transcription-api";
			export {
				isTransientTranscriptionFailure,
				transcriptionFailureMessage,
				transcriptionFailureRowMessage,
				TranscriptionRequestError,
			} from "./src/renderer/src/shared/api/local-operator/transcription-failure";
			export { DESKTOP_REFUSAL_CODE } from "./src/shared/desktop-contract";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The renderer's `@shared` alias is a tsconfig path, not a node resolution.
	alias: { "@shared": "./src/renderer/src/shared" },
	write: false,
});
const {
	TranscriptionApi,
	TRANSIENT_TRANSCRIPTION_ATTEMPTS,
	TRANSIENT_TRANSCRIPTION_RETRY_DELAYS_MS,
	planTranscriptionRetry,
	isTransientTranscriptionFailure,
	transcriptionFailureMessage,
	transcriptionFailureRowMessage,
	TranscriptionRequestError,
	DESKTOP_REFUSAL_CODE,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The operator's own failure, verbatim as the daemon relayed it. */
const UPSTREAM_500_DETAIL =
	'Transcription failed upstream. Upstream responded 500: {"error":"failed to check billing account"}';

/** The daemon's 502 envelope, as the relay hands it to the renderer. */
const ENVELOPE_502 = {
	status: 502,
	kind: "error",
	detail: UPSTREAM_500_DETAIL,
};

/** One successful transcription. */
const SUCCESS = {
	status: 200,
	kind: "json",
	body: { result: { text: "hello there" } },
};

/**
 * The composer's row condition, which must also require the retained bytes (F5):
 * `dictationFailure !== null` alone leaves a dead Retry after a new take aborts.
 */
const ROW_OFFER_CONDITION =
	/dictationFailure !== null &&[\s\S]{0,160}audioBlob !== null/;

/** What the retained-take row's English must say (design round 1, D1). */
const ROW_SAYS_TAKE_KEPT = /kept/;
const ROW_NAMES_CONTROL = /Retry/;

/** A take, in the shape the composer hands the client. */
function take() {
	return {
		file: new File([new Uint8Array([1, 2, 3, 4])], "recording.webm", {
			type: "audio/webm",
		}),
	};
}

/**
 * Stand in for the preload bridge, answering with `results` in order.
 *
 * The LAST result answers every call past the end, so a case can say "transient
 * forever" with one entry and still let the loop run its full length. Every call
 * is recorded WITH its bytes: the premise the retry rests on is that the same
 * recording is re-sent, so the test has to be able to see the bytes rather than
 * take the comment's word for it.
 */
function installRelay(results) {
	const calls = [];
	const previous = globalThis.window;
	globalThis.window = {
		api: {
			desktop: {
				media: async (request, bytes) => {
					calls.push({ request, bytes: Array.from(bytes) });
					return results[Math.min(calls.length - 1, results.length - 1)];
				},
			},
		},
	};
	return {
		calls,
		restore: () => {
			globalThis.window = previous;
		},
	};
}

/** A recording clock, so a bounded loop is measured without waiting it out. */
function recordingSleep(delays) {
	return async (ms) => {
		delays.push(ms);
	};
}

test("only a fault time can fix is transient, and a refusal never is", () => {
	/*
	 * THE TABLE IS THE CONTRACT, per shape the upstream and the daemon actually
	 * send. The status is read first where it can only mean one thing (the relay's
	 * own 502/503/504), and the body decides where it cannot: a 502 is also what
	 * the daemon answers for a provider 4xx it relayed (stt/errors.py), and that is
	 * a decision rather than a fault.
	 */
	const transient = [
		// The operator's case, and the one the whole change exists for.
		new TranscriptionRequestError(502, UPSTREAM_500_DETAIL),
		// The same envelope with nothing quoted: the hop still failed.
		new TranscriptionRequestError(502, "Transcription failed upstream."),
		// A transport failure that never reached the upstream: the daemon maps
		// `status_code is None` to 502 as well, with its own client text.
		new TranscriptionRequestError(502, "Connection refused"),
		// The relay's other two gateway statuses.
		new TranscriptionRequestError(503, "Service unavailable"),
		new TranscriptionRequestError(504, "Gateway timeout"),
		// A 5xx the upstream answered, relayed in the body rather than as the status.
		new TranscriptionRequestError(500, "Upstream responded 502: bad gateway"),
		// The daemon's own internal fault (`stt/errors.py` leaves 500 to it).
		new TranscriptionRequestError(500, "Internal Server Error"),
		/*
		 * THE DESKTOP PLANE'S OWN TRANSPORT FAILURE (#1087 review round 1, F3).
		 * A refused socket or a reset is NOT a pairing condition
		 * (`desktop-contract.ts`, `DESKTOP_REFUSAL_CODE.transportFailed` says so
		 * explicitly: nothing was established about the daemon's plane), so it is
		 * the one coded failure whose own class is "ask again". Excluding the whole
		 * code table used to strand the take here with no attempt and no control.
		 */
		new TranscriptionRequestError(
			503,
			"The Local Operator server did not answer this request.",
			DESKTOP_REFUSAL_CODE.transportFailed,
		),
		// A 5-digit `code` in a relayed body is not a 4xx: the code arm's number
		// boundary, pinned so the F7 match cannot widen into any leading 4.
		new TranscriptionRequestError(
			502,
			'{"error":{"code":4004,"message":"gateway plumbing"}}',
		),
	];
	for (const error of transient) {
		assert.equal(
			isTransientTranscriptionFailure(error),
			true,
			`${error.status} ${JSON.stringify(error.message)} should be retried`,
		);
	}

	const refusals = [
		// The daemon's own 4xx wordings, relayed through its 502.
		new TranscriptionRequestError(
			502,
			"The transcription request was refused upstream (HTTP 400) and the upstream sent no body saying by whom.",
		),
		new TranscriptionRequestError(
			502,
			"Transcription is unavailable: OpenAI refused the API key stored for it (HTTP 401). Check the key for this provider, or replace it and try again.",
		),
		new TranscriptionRequestError(502, "Upstream responded 403: forbidden"),
		// Either refusal family, whatever carried it: a decision does not become
		// temporary by riding a gateway status.
		new TranscriptionRequestError(
			502,
			'{"error":"insufficient_quota: you have no credits remaining"}',
		),
		new TranscriptionRequestError(502, "Unauthorized: invalid api key"),
		/*
		 * THE RELAYED 4xx THAT NAMES NO WORDING (#1087 review round 1, F7). The
		 * provider's refusal arrives re-wrapped as the daemon's 502 and the body
		 * carries the class in its `code` field rather than in prose; this used to
		 * be retried twice because none of the three wordings matched.
		 */
		new TranscriptionRequestError(
			502,
			'{"error":{"code":400,"message":"bad audio"}}',
		),
		// The statuses that are already sentences of their own.
		new TranscriptionRequestError(402, "Payment Required"),
		new TranscriptionRequestError(401, "Unauthorized"),
		new TranscriptionRequestError(403, "Forbidden"),
		new TranscriptionRequestError(400, "The audio was empty."),
		new TranscriptionRequestError(422, "Unprocessable"),
		// A pairing fact wearing a gateway status: the desktop plane wrote it, so
		// its code - not the 503 - is what the policy reads.
		new TranscriptionRequestError(
			503,
			"This app is not paired with the running Local Operator server, so this control is unavailable.",
			DESKTOP_REFUSAL_CODE.noCredential,
		),
		// The other two pairing codes are refusals for the same reason the
		// transport code is not: the plane answered, and the answer is about the
		// link rather than about the request.
		new TranscriptionRequestError(
			503,
			"The server refused this app's credential.",
			DESKTOP_REFUSAL_CODE.refused,
		),
		new TranscriptionRequestError(
			503,
			"The desktop plane is closed.",
			DESKTOP_REFUSAL_CODE.planeClosed,
		),
		// Nothing that is not one of these errors at all.
		new Error("Failed to fetch"),
		undefined,
	];
	for (const error of refusals) {
		assert.equal(
			isTransientTranscriptionFailure(error),
			false,
			`${String(error?.status)} ${JSON.stringify(String(error?.message))} must not be retried`,
		);
	}
});

/*
 * NEVER RETRY A 4xx, swept rather than sampled (review round 1, gap b).
 *
 * The classifier used to name 401/402/403 as its 4xx exclusions, which read as
 * though 404, 409, 413 and the rest fell through to the retry path. They did not:
 * the final line of the predicate is `status >= 500`, so those statuses were
 * already refused by the allow-list, and this sweep passes against the old rule
 * as well as the new one - checked, not assumed. The change is therefore about
 * saying the rule once, as a range, instead of listing three statuses and leaving
 * the real gate seven lines below; a reader who stopped at the exclusion list
 * would believe the opposite of what shipped.
 *
 * The sweep stays because the claim is "no 4xx", and a claim is only held if it
 * is swept: a future edit that retried, say, 429 with a Retry-After would trip
 * this. Each status carries bodies that would otherwise look transient, so the
 * status is the only thing the classifier can be reading.
 */
test("no 4xx is retried, whatever its body says", () => {
	for (let status = 400; status <= 499; status += 1) {
		for (const detail of [
			"",
			"The audio could not be decoded.",
			`Upstream responded 500: {"error":"failed to check billing account"}`,
			"HTTP 500 from the provider",
		]) {
			assert.equal(
				isTransientTranscriptionFailure(
					new TranscriptionRequestError(status, detail),
				),
				false,
				`a ${status} carrying ${JSON.stringify(detail)} must not be retried`,
			);
		}
	}
});
test("the transient sentences name the fault and its action, and the row names the control", () => {
	/*
	 * One sentence, chosen in one place, so the composer and the canvas's inline
	 * editor say the same thing. It must NOT quote the upstream body: the clipped
	 * JSON that used to stand here read as a refusal, which is the defect. The raw
	 * detail still reaches the console on `error.message`.
	 */
	const sentence = transcriptionFailureMessage(
		new TranscriptionRequestError(502, UPSTREAM_500_DETAIL),
	);
	assert.equal(
		sentence,
		"Dictation failed: the transcription service had a temporary fault. Try again.",
	);
	for (const forbidden of [
		"failed to check billing account",
		"Upstream responded",
		"report it with the app's log",
	]) {
		assert.ok(
			!sentence.includes(forbidden),
			`the transient sentence must not carry ${JSON.stringify(forbidden)}`,
		);
	}
	/*
	 * THE ROW HAS ITS OWN SENTENCE (design round 1, D1). The defect was the same
	 * sentence in two vocabularies: an inert "Try again." followed 11px later by
	 * a live control saying the same thing, with nothing on screen saying the take
	 * survived. The row's sentence must differ from the toast's, say the recording
	 * is kept, and name the control that spends it - the toast keeps its own
	 * closing imperative because it has no control to point at.
	 */
	const row = transcriptionFailureRowMessage(
		new TranscriptionRequestError(502, UPSTREAM_500_DETAIL),
	);
	assert.notEqual(
		row,
		sentence,
		"the row must not repeat the toast's sentence",
	);
	for (const required of ["kept", "Retry"]) {
		assert.ok(
			row.includes(required),
			`the row sentence must name ${JSON.stringify(required)}: ${row}`,
		);
	}
	assert.ok(
		!row.includes("Try again."),
		`the row must not repeat the toast's imperative beside a control: ${row}`,
	);
	/*
	 * A refusal has no retained-take offer, so the row function answers with the
	 * toast's own sentence rather than inventing one. Both surfaces gate the row
	 * on the transient class (F2); this keeps a future caller from getting a
	 * sentence that promises a retry the classifier will not make.
	 */
	assert.equal(
		transcriptionFailureRowMessage(
			new TranscriptionRequestError(402, "Payment Required"),
		),
		"Dictation failed: you're out of Radient credits. Get more credits, then try again.",
	);
	// A refusal that arrives inside the same gateway status keeps its own sentence:
	// the precedence is the point, not an accident of ordering.
	assert.equal(
		transcriptionFailureMessage(
			new TranscriptionRequestError(
				502,
				"insufficient_quota: no credits remaining",
			),
		),
		"Dictation failed: the account behind dictation is out of credits. If it's yours, top it up.",
	);
	/*
	 * A 5xx WITH NO WORDS STATES THE ABSENCE. This assertion used to pin the
	 * temporary sentence here, and the invariant it broke is the one
	 * `transcription-failure-copy.test.mjs` already held on main: an absent reason
	 * states the absence rather than inventing a cause. The class is a fact about
	 * retrying, not a diagnosis, so it cannot stand in for a reason that was never
	 * given - only the relay's wrapped-JSON shape, which carries scaffolding and no
	 * sentence, takes the class's own wording. Empty bodies stay out of it. A test
	 * this PR added does not get to overrule a test this PR did not write.
	 */
	assert.equal(
		transcriptionFailureMessage(new TranscriptionRequestError(503, "")),
		"Dictation failed: the server gave no reason. Try again, or report it with the app's log.",
	);
});

test("the retry decision is ONE pure function, and its table is the policy", () => {
	/*
	 * THE DECISION, OUT OF THE LOOP. The loop is the only path a take travels, so
	 * the bound and the waits are asserted here - on the exported function the loop
	 * itself calls - rather than restated from the loop's behaviour. A rule copied
	 * into this file would pass after the app drifted.
	 *
	 * The cases are the three ways the answer is null (bound spent, no delay, not
	 * the transient class) and the two waits the class gets, so every arm of
	 * `planTranscriptionRetry` is pinned individually.
	 */
	const transient = new TranscriptionRequestError(502, UPSTREAM_500_DETAIL);
	assert.deepEqual(planTranscriptionRetry(transient, 1), {
		attempt: 1,
		total: TRANSIENT_TRANSCRIPTION_ATTEMPTS,
		delayMs: 500,
	});
	assert.deepEqual(planTranscriptionRetry(transient, 2), {
		attempt: 2,
		total: TRANSIENT_TRANSCRIPTION_ATTEMPTS,
		delayMs: 1500,
	});
	// The bound: the third failure is the answer, not a fourth request.
	assert.equal(planTranscriptionRetry(transient, 3), null);
	assert.equal(
		planTranscriptionRetry(transient, TRANSIENT_TRANSCRIPTION_ATTEMPTS),
		null,
	);
	// A refusal is never a retry, whatever the attempt number says.
	assert.equal(
		planTranscriptionRetry(
			new TranscriptionRequestError(402, "Payment Required"),
			1,
		),
		null,
	);
	assert.equal(
		planTranscriptionRetry(
			new TranscriptionRequestError(
				503,
				"This app is not paired with the running Local Operator server.",
				DESKTOP_REFUSAL_CODE.noCredential,
			),
			1,
		),
		null,
	);
	// Not a transcription failure at all: the client rethrows what it caught.
	assert.equal(planTranscriptionRetry(new Error("boom"), 1), null);
	assert.equal(planTranscriptionRetry(null, 1), null);
});

test("a transient fault is retried on the SAME bytes, and the loop is bounded", async () => {
	const relay = installRelay([ENVELOPE_502, ENVELOPE_502, SUCCESS]);
	const delays = [];
	const retries = [];
	try {
		const params = take();
		const response = await TranscriptionApi.createTranscriptionWithRetry(
			"http://127.0.0.1:1",
			params,
			{
				sleep: recordingSleep(delays),
				onRetry: (retry) => retries.push(retry),
			},
		);

		assert.equal(
			relay.calls.length,
			3,
			"the third attempt is the one that lands",
		);
		assert.equal(response.result.text, "hello there");
		// The waits, in order: the policy's own numbers, not a test's copy of them.
		assert.deepEqual(delays, [...TRANSIENT_TRANSCRIPTION_RETRY_DELAYS_MS]);
		assert.deepEqual(delays, [500, 1500]);
		assert.equal(delays.length, TRANSIENT_TRANSCRIPTION_ATTEMPTS - 1);
		assert.deepEqual(
			retries.map((retry) => retry.attempt),
			[1, 2],
		);
		assert.ok(
			retries.every(
				(retry) => retry.total === TRANSIENT_TRANSCRIPTION_ATTEMPTS,
			),
			"each retry reports the bound it is inside",
		);
		// THE PREMISE: the same recording, byte for byte, on every attempt.
		for (const call of relay.calls) {
			assert.deepEqual(call.bytes, [1, 2, 3, 4]);
			assert.equal(call.request.op, "transcription.create");
			assert.equal(call.request.fileName, "recording.webm");
		}
	} finally {
		relay.restore();
	}
});

test("a transient fault that never clears is thrown after the bound, not retried forever", async () => {
	const relay = installRelay([ENVELOPE_502]);
	const delays = [];
	try {
		await assert.rejects(
			() =>
				TranscriptionApi.createTranscriptionWithRetry(
					"http://127.0.0.1:1",
					take(),
					{ sleep: recordingSleep(delays) },
				),
			(error) => {
				assert.ok(error instanceof TranscriptionRequestError);
				// The LAST attempt's error is the one the caller sees, so the console
				// and the toast still carry the upstream's own words.
				assert.equal(error.status, 502);
				assert.equal(error.message, UPSTREAM_500_DETAIL);
				return true;
			},
		);
		assert.equal(
			relay.calls.length,
			TRANSIENT_TRANSCRIPTION_ATTEMPTS,
			"exactly the bound, no more",
		);
		assert.deepEqual(delays, [...TRANSIENT_TRANSCRIPTION_RETRY_DELAYS_MS]);
	} finally {
		relay.restore();
	}
});

test("a refusal is thrown on the first attempt, with no wait between", async () => {
	/*
	 * THE HALF THAT MUST NOT REGRESS. Retrying a refusal spends the reader's time
	 * and the account's rate limit on a request that cannot start working, and the
	 * "please try again" sentence this whole family replaced is exactly that lie.
	 */
	const refuse = {
		status: 402,
		kind: "error",
		detail: "Payment Required",
	};
	const relay = installRelay([refuse]);
	const delays = [];
	const retries = [];
	try {
		await assert.rejects(
			() =>
				TranscriptionApi.createTranscriptionWithRetry(
					"http://127.0.0.1:1",
					take(),
					{
						sleep: recordingSleep(delays),
						onRetry: (retry) => retries.push(retry),
					},
				),
			(error) =>
				error instanceof TranscriptionRequestError && error.status === 402,
		);
		assert.equal(relay.calls.length, 1);
		assert.deepEqual(delays, []);
		assert.deepEqual(retries, []);
	} finally {
		relay.restore();
	}
});

test("an aborted burst issues nothing, and an abort during the wait stops the next attempt", async () => {
	/*
	 * THE BURST IS BOUNDED TO THE SURFACE (#1087 review round 1, F4). Closing the
	 * inline editor or navigating away used to leave the remaining attempts to
	 * run and apply their result to state nobody was watching; the caller passes
	 * an AbortSignal, and both checks are asserted here rather than inferred from
	 * the loop's shape: before the first send, and after a wait.
	 */
	const aborted = new AbortController();
	aborted.abort();
	const firstRelay = installRelay([ENVELOPE_502, SUCCESS]);
	const noDelays = [];
	try {
		await assert.rejects(
			() =>
				TranscriptionApi.createTranscriptionWithRetry(
					"http://127.0.0.1:1",
					take(),
					{ signal: aborted.signal, sleep: recordingSleep(noDelays) },
				),
			(error) => error?.name === "AbortError",
		);
		assert.equal(
			firstRelay.calls.length,
			0,
			"a surface that is already gone issues no request at all",
		);
		assert.deepEqual(noDelays, []);
	} finally {
		firstRelay.restore();
	}

	const controller = new AbortController();
	const secondRelay = installRelay([ENVELOPE_502, ENVELOPE_502, SUCCESS]);
	try {
		await assert.rejects(
			() =>
				TranscriptionApi.createTranscriptionWithRetry(
					"http://127.0.0.1:1",
					take(),
					{
						signal: controller.signal,
						sleep: async () => {
							controller.abort();
						},
					},
				),
			(error) => error?.name === "AbortError",
		);
		assert.equal(
			secondRelay.calls.length,
			1,
			"the attempt after the abort is never issued",
		);
	} finally {
		secondRelay.restore();
	}
});

test("a coded 503 is a pairing fact the client carries through, not a retried fault", async () => {
	/*
	 * THE CODE IS LOAD-BEARING (#1087). The desktop plane answers its own refusals
	 * with statuses that overlap the gateway class - a 503 for "this app is not
	 * paired" and for "the server did not answer" - and the daemon answers 503 for
	 * a real outage. Without the code the client cannot tell them apart and would
	 * spend two waits before telling a user to try again something a retry cannot
	 * fix.
	 */
	const refuse = {
		status: 503,
		kind: "error",
		detail: "pairing.no-credential",
		code: DESKTOP_REFUSAL_CODE.noCredential,
	};
	const relay = installRelay([refuse]);
	const delays = [];
	try {
		await assert.rejects(
			() =>
				TranscriptionApi.createTranscriptionWithRetry(
					"http://127.0.0.1:1",
					take(),
					{ sleep: recordingSleep(delays) },
				),
			(error) => {
				assert.ok(error instanceof TranscriptionRequestError);
				assert.equal(error.status, 503);
				assert.equal(error.code, DESKTOP_REFUSAL_CODE.noCredential);
				assert.equal(isTransientTranscriptionFailure(error), false);
				return true;
			},
		);
		assert.equal(relay.calls.length, 1, "a pairing fact is not retried");
		assert.deepEqual(delays, []);
	} finally {
		relay.restore();
	}
});

test("both dictation surfaces take the retrying client, and the composer keeps the take", async () => {
	/*
	 * THE WIRING, read as source. A policy no call site uses is a policy nobody
	 * has. The composer is also checked for the two state pieces its retained-take
	 * offer rests on - the flag the failure sets and the nudge that re-arms the
	 * one auto-send effect - because an offer with no second send path is a button
	 * that does nothing.
	 */
	const composer = await readFile(
		"src/renderer/src/shared/components/composer/message-input.tsx",
		"utf8",
	);
	assert.ok(
		composer.includes("TranscriptionApi.createTranscriptionWithRetry("),
		"the composer sends through the retrying client",
	);
	assert.ok(
		composer.includes("setDictationFailure(") &&
			composer.includes("isTransientTranscriptionFailure(error)"),
		"a transient failure offers the take back; a refusal does not",
	);
	assert.ok(
		composer.includes("[audioBlob, dictationRetry, handleSendAudio]"),
		"the retry nudge re-arms the one auto-send effect",
	);
	assert.ok(
		composer.includes(
			"sentTakeRef.current = { blob: audioBlob, attempt: dictationRetry }",
		),
		"the take is sent once per (blob, nudge) pair, so callback identity churn cannot resend it",
	);
	assert.ok(
		composer.includes('t("ui.common.actions.retry")'),
		"the retry control reuses an audited catalogue key, not an inline label",
	);
	/*
	 * F5: the offer is withdrawn when there is nothing left to spend. Starting a
	 * new recording or aborting one clears `audioBlob` but not the sentence, and
	 * Retry then calls into a `if (!audioBlob) return` - a silent no-op. The row
	 * condition therefore carries the blob check, and the canvas already did.
	 */
	assert.match(
		composer,
		ROW_OFFER_CONDITION,
		"the composer hides the offer once the retained take is gone",
	);

	const canvas = await readFile(
		"src/renderer/src/features/chat/components/canvas/inline-edit.tsx",
		"utf8",
	);
	assert.ok(
		canvas.includes("TranscriptionApi.createTranscriptionWithRetry("),
		"the canvas's dictation takes the same retry, so the shared sentence is true there too",
	);
	/*
	 * F2: the canvas offers the retry THE CLASS allows, not every failure. An
	 * unconditional offer put a Retry beside a 402/401/403 or a pairing 503 that
	 * could only reproduce the refusal - the "try again" lie the composer's own
	 * comment says this copy exists to delete.
	 */
	assert.ok(
		canvas.includes(
			"const transient = isTransientTranscriptionFailure(error);",
		),
		"the canvas asks the classifier before it keeps the failure",
	);
	assert.ok(
		canvas.includes("transient ? transcriptionFailureRowMessage(error) : null"),
		"the canvas keeps only a transient failure's sentence, and keeps the row's own",
	);
	assert.ok(
		canvas.includes("data-dictation-retry"),
		"the canvas renders the Retry control",
	);
	/*
	 * F1 and D4: THE ROW IS ADDITIVE. It used to be the third arm of the same
	 * ternary as the textarea, so any failure replaced the field - the typed
	 * prompt vanished, the editor could not be typed into, and the only exit
	 * unmounted it. The composer renders the row below its input; the canvas must
	 * do the same, and these assertions are about that shape rather than about a
	 * comment claiming it.
	 */
	assert.ok(
		!canvas.includes(": dictationFailure !== null ?"),
		"the failure row is not the ternary arm that replaces the textarea",
	);
	assert.ok(
		canvas.indexOf("<textarea") !== -1 &&
			canvas.indexOf("<textarea") < canvas.indexOf("data-dictation-retry"),
		"the canvas renders the row after the textarea, not in its place",
	);
	assert.ok(
		canvas.includes("[audioBlob, handleSendAudio, dictationRetry]"),
		"the retry nudge re-arms the same auto-send effect rather than adding a second send path",
	);
	/*
	 * F6: THE TAKE SURVIVES A FAILURE, asserted on the branches rather than on the
	 * first textual occurrence of two strings. The old check compared the index of
	 * the first `setAudioBlob(null)` with the index of the failure line, which a
	 * clear placed immediately BEFORE that line - inside the catch - would have
	 * passed: it pinned order of first occurrences, not the success path.
	 */
	const handlerStart = canvas.indexOf("const handleSendAudio");
	assert.ok(
		handlerStart !== -1,
		"the canvas's send path is where the test looks",
	);
	const tryStart = canvas.indexOf("try {", handlerStart);
	const catchStart = canvas.indexOf("} catch (error) {", tryStart);
	const finallyStart = canvas.indexOf("} finally {", catchStart);
	assert.ok(
		tryStart !== -1 && catchStart > tryStart && finallyStart > catchStart,
		"the send path's try/catch/finally are found in order",
	);
	const successArm = canvas.slice(tryStart, catchStart);
	const failureArm = canvas.slice(catchStart, finallyStart);
	assert.ok(
		successArm.includes("setAudioBlob(null)"),
		"the success path retires the take",
	);
	assert.ok(
		!failureArm.includes("setAudioBlob(null)"),
		"the failure arm must not clear the take, wherever in it the clear is written",
	);
	assert.ok(
		canvas.includes('t("ui.common.actions.retry")'),
		"the canvas control reuses the audited catalogue key, not an inline label",
	);
});

test("the retained-take sentences are keyed and translated, not inline English", async () => {
	/*
	 * D5, AND WHY THIS TEST REPLACES ITS PREDECESSOR. The old test asserted that
	 * NO translation was owed - that the row reused audited copy and added no
	 * key. That was the decision, and review round 1 (D5) overturned it: the
	 * control was keyed while the sentence beside it was hardcoded English, so
	 * every non-English locale rendered a translated button under an English
	 * sentence. The sentence is now keyed, and this asserts the thing that used to
	 * be argued from the ledger: both keys exist in English, both exist in every
	 * gated locale, and the module reads them through `t()` rather than carrying
	 * the literals.
	 */
	const en = JSON.parse(
		await readFile("src/i18n/catalogues/en/ui.chat.composer.json", "utf8"),
	);
	const toast = en["ui.chat.composer.dictation_failed_transient"];
	const row = en["ui.chat.composer.dictation_failed_transient_take_kept"];
	assert.equal(
		toast,
		"Dictation failed: the transcription service had a temporary fault. Try again.",
	);
	assert.match(row, ROW_SAYS_TAKE_KEPT);
	assert.match(row, ROW_NAMES_CONTROL);
	const languages = JSON.parse(await readFile("i18n/languages.json", "utf8"));
	const gated = languages.languages.filter(
		(entry) => entry.status === "supported",
	);
	assert.ok(gated.length > 0, "the manifest names gated locales");
	for (const { code } of gated) {
		const target = JSON.parse(
			await readFile(
				`src/i18n/catalogues/${code}/ui.chat.composer.json`,
				"utf8",
			),
		);
		for (const key of [
			"ui.chat.composer.dictation_failed_transient",
			"ui.chat.composer.dictation_failed_transient_take_kept",
		]) {
			assert.equal(
				typeof target[key],
				"string",
				`${code} must carry ${key} (no coverage-allowance entry covers it)`,
			);
			assert.ok(
				target[key].trim() !== "" && target[key] !== en[key],
				`${code} ${key} must be translated, not copied English`,
			);
		}
	}
	const module = await readFile(
		"src/renderer/src/shared/api/local-operator/transcription-failure.ts",
		"utf8",
	);
	assert.ok(
		module.includes('t("ui.chat.composer.dictation_failed_transient")') &&
			module.includes(
				't("ui.chat.composer.dictation_failed_transient_take_kept")',
			),
		"the module reads both sentences from the catalogue",
	);
	const common = JSON.parse(
		await readFile("src/i18n/catalogues/en/ui.common.actions.json", "utf8"),
	);
	assert.equal(common["ui.common.actions.retry"], "Retry");
});
