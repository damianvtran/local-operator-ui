import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * WHAT A FAILED DICTATION MAY OFFER - one table, every status class.
 *
 * THE DEFECT THIS PINS. Three things answered one failure in three places: the
 * row under the composer, the toast raised beside it, and the sentence whose own
 * words name the controls. The row offered Retry for the transient class and
 * nothing for everything else, so a recording the app's own plane refused before
 * sending it (HTTP 413, over the 16 MiB upload cap) or a request the server
 * rejected outright (HTTP 422) was told to "try again" by copy that had no
 * control behind it - and the bytes stayed in state with no surface able to
 * reach them, which is the same stranding #1087 fixed for the transient class,
 * one refusal over.
 *
 * THE CLAIMS HELD HERE:
 *   1. Retry exists for the transient class and for NOTHING else.
 *   2. A kept take gets a row with Discard whenever an action on the bytes
 *      exists - the transient class, 413, and 422 - so no recording is stranded.
 *   3. Every decision-shaped refusal (402/401/403, the credit families, the
 *      desktop plane's pairing codes, an upstream 4xx inside a 5xx) keeps the
 *      toast and gets no row: a control beside a decision that reproduces it is
 *      the "try again" lie the copy module exists to delete.
 *   4. The row's sentence and the toast's sentence come from the same field, so
 *      the two surfaces cannot describe one failure differently.
 *   5. The composer asks this function rather than deriving the class itself.
 *
 * The policy is imported through a real bundle of the shipped module, not
 * restated here; the English expectations read the copy the app renders, and a
 * copy change that keeps the meaning keeps this file green.
 */
const bundle = await build({
	stdin: {
		contents: `
			export {
				retakeOfferFor,
				isTransientTranscriptionFailure,
				transcriptionFailureMessage,
				TranscriptionRequestError,
			} from "./src/renderer/src/shared/api/local-operator/transcription-failure";
			export {
				DESKTOP_REFUSAL_CODE,
				DESKTOP_MACHINE_DETAIL,
			} from "./src/shared/desktop-contract";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: { "@shared": "./src/renderer/src/shared" },
	write: false,
});
const {
	retakeOfferFor,
	isTransientTranscriptionFailure,
	transcriptionFailureMessage,
	TranscriptionRequestError,
	DESKTOP_REFUSAL_CODE,
	DESKTOP_MACHINE_DETAIL,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** A coded refusal the desktop plane composed, as `mediaError` builds it. */
const coded = (status, detail, code) =>
	new TranscriptionRequestError(status, detail, code);

/** One row of the policy table: a failure, and what the app may offer for it. */
const CASES = [
	{
		name: "the upstream 5xx the client already retried (#1087)",
		error: () =>
			new TranscriptionRequestError(
				502,
				'Transcription failed upstream. Upstream responded 500: {"error":"failed to check billing account"}',
			),
		retry: true,
		keepRow: true,
	},
	{
		name: "a gateway 503 that sent no words",
		error: () => new TranscriptionRequestError(503, ""),
		retry: true,
		keepRow: true,
	},
	{
		name: "a 500 that names its own cause",
		error: () =>
			new TranscriptionRequestError(500, "Could not decode the audio file."),
		retry: true,
		keepRow: true,
	},
	{
		name: "a transport failure the plane could not complete",
		error: () =>
			coded(
				503,
				DESKTOP_MACHINE_DETAIL.transportFailed,
				DESKTOP_REFUSAL_CODE.transportFailed,
			),
		retry: true,
		keepRow: true,
	},
	{
		name: "the plane's own 413, refused before anything was sent",
		error: () => new TranscriptionRequestError(413, "This file is too large."),
		retry: false,
		keepRow: true,
	},
	{
		name: "the server's 422 for a request it rejected",
		error: () =>
			new TranscriptionRequestError(422, "The audio track is missing."),
		retry: false,
		keepRow: true,
	},
	{
		name: "a 422 whose body says nothing",
		error: () => new TranscriptionRequestError(422, ""),
		retry: false,
		keepRow: false,
	},
	{
		name: "Radient refused to fund the request",
		error: () => new TranscriptionRequestError(402, "Payment Required"),
		retry: false,
		keepRow: false,
	},
	{
		name: "a refused credential",
		error: () => new TranscriptionRequestError(401, "Unauthorized"),
		retry: false,
		keepRow: false,
	},
	{
		name: "a forbidden credential",
		error: () => new TranscriptionRequestError(403, "Forbidden"),
		retry: false,
		keepRow: false,
	},
	{
		name: "the provider's own out-of-credits refusal",
		error: () =>
			new TranscriptionRequestError(
				500,
				"OpenAI API error (insufficient_quota): You have no credits remaining. Visit https://platform.openai.com/account/billing to add credits.",
			),
		retry: false,
		keepRow: false,
	},
	{
		name: "an upstream 4xx relayed through a 502",
		error: () =>
			new TranscriptionRequestError(
				502,
				"The transcription request was refused upstream (HTTP 400)",
			),
		retry: false,
		keepRow: false,
	},
	{
		name: "the plane holds no credential for this app",
		error: () =>
			coded(
				503,
				DESKTOP_MACHINE_DETAIL.noCredential,
				DESKTOP_REFUSAL_CODE.noCredential,
			),
		retry: false,
		keepRow: false,
	},
	{
		name: "the daemon refused this app's bearer",
		error: () =>
			coded(
				503,
				"The daemon refused this app's credential.",
				DESKTOP_REFUSAL_CODE.refused,
			),
		retry: false,
		keepRow: false,
	},
	{
		name: "the daemon's desktop plane is shut",
		error: () =>
			coded(
				503,
				"Desktop controls require a backend started by the desktop app.",
				DESKTOP_REFUSAL_CODE.planeClosed,
			),
		retry: false,
		keepRow: false,
	},
	{
		name: "the daemon is reloading itself",
		error: () =>
			coded(
				503,
				DESKTOP_MACHINE_DETAIL.serverUpdating,
				DESKTOP_REFUSAL_CODE.serverUpdating,
			),
		retry: false,
		keepRow: false,
	},
	{
		name: "a failure that is not a request error at all",
		error: () => new Error("Could not read the recording."),
		retry: false,
		keepRow: false,
	},
];

test("the policy table: retry only for the transient class, a row whenever the take has an action", () => {
	for (const one of CASES) {
		const error = one.error();
		const offer = retakeOfferFor(error);
		assert.equal(offer.retry, one.retry, `${one.name}: retry is ${one.retry}`);
		assert.equal(
			offer.keepRow,
			one.keepRow,
			`${one.name}: keepRow is ${one.keepRow}`,
		);
		/*
		 * RETRY AND THE TRANSIENT CLASS ARE ONE FACT, and this is the assertion that
		 * keeps a later edit from widening the control past the class the client
		 * actually re-sends: every retryable offer is transient, and every transient
		 * failure is retryable.
		 */
		assert.equal(
			offer.retry,
			isTransientTranscriptionFailure(error),
			`${one.name}: Retry exists exactly where the client retries`,
		);
	}
});

test("retry is offered by exactly one arm of the table", () => {
	const retried = CASES.filter((one) => retakeOfferFor(one.error()).retry);
	assert.deepEqual(
		retried.map((one) => one.name),
		[
			"the upstream 5xx the client already retried (#1087)",
			"a gateway 503 that sent no words",
			"a 500 that names its own cause",
			"a transport failure the plane could not complete",
		],
		"the retried rows are the 5xx band, and nothing beside it",
	);
	/*
	 * THE SERVER-UPDATING CODE IS DELIBERATELY NOT RETRIED HERE, and it is stated
	 * rather than left as a surprise: `isTransientTranscriptionFailure` excludes
	 * every coded refusal but `transport.failed`, so the reload fence arrives as a
	 * decision-shaped answer. Whether it should be retried is a question about that
	 * classifier and every surface that reads it (the canvas editor and Team Bridge
	 * included), not about this policy - so it is pinned as it is, and a change to
	 * it has to move this line.
	 */
	const updating = CASES.find(
		(one) => one.name === "the daemon is reloading itself",
	);
	assert.equal(
		retakeOfferFor(updating.error()).keepRow,
		false,
		"the reload fence keeps the toast path it has today",
	);
});

test("a row never repeats the toast's imperative, and a toast is the toast's own sentence", () => {
	for (const one of CASES) {
		const error = one.error();
		const offer = retakeOfferFor(error);
		assert.ok(
			offer.message.length > 0,
			`${one.name}: an offer always says why`,
		);
		if (!offer.keepRow) {
			assert.equal(
				offer.message,
				transcriptionFailureMessage(error),
				`${one.name}: without a row, the sentence is the toast's own`,
			);
			continue;
		}
		/*
		 * A ROW NAMES THE CONTROL BESIDE IT, not the one somewhere else: "Try again"
		 * under a Retry control names the action twice, and under a row with no Retry
		 * it points at a control that is not there.
		 */
		assert.doesNotMatch(
			offer.message,
			/Try again, or report/,
			`${one.name}: the row does not borrow the toast's imperative`,
		);
	}
});

test("413 says the recording is too long and names the fix, never 'try again'", () => {
	const offer = retakeOfferFor(
		new TranscriptionRequestError(413, "This file is too large."),
	);
	assert.match(offer.message, /too long to send/i, "the limit is stated");
	assert.match(offer.message, /shorter/i, "and the fix is a shorter take");
	assert.doesNotMatch(offer.message, /try again/i, "the wrong instruction");
	assert.doesNotMatch(
		offer.message,
		/file is too large/i,
		"the plane's machine sentence is not the reader's copy",
	);
});

test("422 quotes the server's own reason, offers no retry, and says where the detail goes", () => {
	const offer = retakeOfferFor(
		new TranscriptionRequestError(422, "The audio track is missing."),
	);
	assert.match(
		offer.message,
		/the audio track is missing/i,
		"the refusal's reason travels, as the 5xx family quotes its own",
	);
	assert.match(offer.message, /Report|report/, "the app's log is still named");
	assert.doesNotMatch(offer.message, /try again/i, "no retry is offered");
});

test("a clipped 422 reason takes a space, not a full stop after an ellipsis", () => {
	const long = `${"a".repeat(70)} ${"b".repeat(40)}`;
	const offer = retakeOfferFor(new TranscriptionRequestError(422, long));
	assert.match(offer.message, /…/, "the clip is visible, not silent");
	assert.doesNotMatch(
		offer.message,
		/…\.\s/,
		"`.` after `…` is a rendering artefact, not a sentence boundary",
	);
});

test("the composer asks the policy, and the two other dictation surfaces keep their own row", async () => {
	const composer = await readFile(
		"src/renderer/src/shared/components/composer/message-input.tsx",
		"utf8",
	);
	assert.match(
		composer,
		/retakeOfferFor\(error\)/,
		"the composer's failure path decides through the policy function",
	);
	assert.doesNotMatch(
		composer,
		/isTransientTranscriptionFailure\(/,
		"and does not re-derive the class beside it - the shape this change removes",
	);
	assert.doesNotMatch(
		composer,
		/transcriptionFailureRowMessage\(/,
		"nor keeps a second entry point for the row's sentence",
	);
	assert.match(
		composer,
		/offer\.keepRow\s*\?\s*\{ message: offer\.message, retry: offer\.retry \}\s*:\s*null/,
		"the row renders the offer's own fields",
	);
	assert.match(
		composer,
		/onDiscard=\{discardDictation\}/,
		"and the row is handed a Discard",
	);

	/*
	 * THE OTHER TWO SURFACES ARE STATED, NOT SILENTLY CHANGED. The canvas's inline
	 * editor and Team Bridge's dictation keep the transient-only row they shipped
	 * with: neither has a control set for a kept take, and giving them one is a
	 * change to those surfaces rather than to this policy. What they do NOT get is
	 * the 413/422 row. Pinned here so a later edit has to say which it is doing.
	 */
	for (const path of [
		"src/renderer/src/features/chat/components/canvas/inline-edit.tsx",
		"src/renderer/src/features/team-bridge/use-team-bridge-dictation.ts",
	]) {
		const source = await readFile(path, "utf8");
		assert.match(
			source,
			/isTransientTranscriptionFailure\(error\)/,
			`${path}: keeps the transient gate it shipped with`,
		);
		assert.doesNotMatch(
			source,
			/retakeOfferFor\(/,
			`${path}: does not adopt a row policy its surface cannot render`,
		);
	}
});
