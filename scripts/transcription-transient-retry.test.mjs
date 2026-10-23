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
		// A coded 503 is the desktop plane's, and the code is what saves it - see
		// the refusal table below.
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
		new TranscriptionRequestError(
			503,
			"The Local Operator server did not answer this request.",
			DESKTOP_REFUSAL_CODE.transportFailed,
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

test("the transient sentence names the fault as temporary and names the action", () => {
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
	 * A 5xx WITH NO WORDS still names its class. "The server gave no reason" is
	 * the fallback for a body that says nothing, and it sends the reader to the
	 * log - the wrong door for a fault whose action is the control.
	 */
	assert.equal(
		transcriptionFailureMessage(new TranscriptionRequestError(503, "")),
		"Dictation failed: the transcription service had a temporary fault. Try again.",
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

	const canvas = await readFile(
		"src/renderer/src/features/chat/components/canvas/inline-edit.tsx",
		"utf8",
	);
	assert.ok(
		canvas.includes("TranscriptionApi.createTranscriptionWithRetry("),
		"the canvas's dictation takes the same retry, so the shared sentence is true there too",
	);
});

test("no translation work is owed: the row reuses audited copy", async () => {
	/*
	 * THE LEDGER DECIDES THE COPY (deliberate, and worth stating because the first
	 * cut of this row did the opposite). `check-i18n:catalogues` requires every new
	 * English key to exist in EVERY shipped locale, with an independent auditor's
	 * receipt per file - so two new keys are eight translated files and eight
	 * audits, a translation workstream of its own. The row therefore shows the
	 * failure SENTENCE the shared mapper already choses (all dictation copy is
	 * English-only today, which is why the toasts carry it) and a control labelled
	 * with `ui.common.actions.retry`, a key every locale already ships and has had
	 * audited. Nothing new to translate, and the sentence stays in one place.
	 */
	const catalogue = JSON.parse(
		await readFile("src/i18n/catalogues/en/ui.chat.composer.json", "utf8"),
	);
	assert.equal(
		catalogue["ui.chat.composer.dictation_take_kept"],
		undefined,
		"the withdrawn keys must not linger in the catalogue",
	);
	const common = JSON.parse(
		await readFile("src/i18n/catalogues/en/ui.common.actions.json", "utf8"),
	);
	assert.equal(common["ui.common.actions.retry"], "Retry");
});
