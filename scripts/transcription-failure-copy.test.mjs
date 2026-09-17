import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * One failure, one sentence: the dictation refusals a person actually hits.
 *
 * QA note on shape. The two call sites used to pass a single literal to
 * `showErrorToast` whatever the server said, so the assertions here are about the
 * SHIPPED functions rather than about a restatement of their logic: the map and
 * the error type are bundled from `src/` and CALLED, and the two call sites are
 * read to prove they route through the map instead of inlining a second copy.
 *
 * The end-to-end leg matters as much as the strings. The relay's failure reaches
 * a call site as a thrown error, and the sentence depends on BOTH halves the
 * relay saw - the status (a 402 is Radient's own refusal) and the body (the
 * upstream provider's words). So the client itself is driven with a stubbed
 * `window.api.desktop.media`, which is the seam the real relay answers through,
 * and the mapper is handed what the client actually throws.
 */
const bundle = await build({
	stdin: {
		contents: `
			export { TranscriptionApi } from "./src/renderer/src/shared/api/local-operator/transcription-api";
			export { transcriptionFailureMessage, TranscriptionRequestError } from "./src/renderer/src/shared/api/local-operator/transcription-failure";
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
	transcriptionFailureMessage,
	TranscriptionRequestError,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The copy the app shipped before this change, in both call sites' words. */
const OLD_LITERAL = "Error transcribing audio. Please try again.";

/** The operator's own incident, relayed by the daemon verbatim. */
const OPENAI_QUOTA =
	"OpenAI API error (insufficient_quota): You have no credits remaining. Visit https://platform.openai.com/account/billing to add credits.";

/**
 * Drive the shipped client against a stubbed relay, and map what it throws.
 *
 * `media` is the whole contract the preload bridge exposes for this op, so the
 * client's own `result.kind !== "json"` branch - the one that turns a refusal
 * into a throw - is the code under test rather than a hand-built error.
 */
async function throughTheClient(result) {
	const previous = globalThis.window;
	globalThis.window = { api: { desktop: { media: async () => result } } };
	try {
		await TranscriptionApi.createTranscription("http://127.0.0.1:1", {
			file: new File([new Uint8Array([1, 2, 3])], "recording.webm", {
				type: "audio/webm",
			}),
		});
		assert.fail("the stubbed relay refusal was not thrown");
	} catch (error) {
		// The raw server message must survive for the console, and the status must
		// survive for the sentence: the two halves travel on one error.
		assert.ok(
			error instanceof TranscriptionRequestError,
			`expected a TranscriptionRequestError, got ${error}`,
		);
		assert.equal(error.message, result.detail);
		assert.equal(error.status, result.status);
		return transcriptionFailureMessage(error);
	} finally {
		globalThis.window = previous;
	}
}

test("an out-of-credits provider is named, per status and per body", async () => {
	// Radient's own billing refusal: the reader's own account is the one to top
	// up, and the sentence uses the words the app's own low-credits surface
	// already uses ("Running low on Radient credits?" / "Get more credits").
	assert.equal(
		await throughTheClient({
			status: 402,
			kind: "error",
			detail: "Payment Required",
		}),
		"Dictation failed: you're out of Radient credits. Get more credits, then try dictating again.",
	);

	// The upstream provider's refusal, with the provider named by its own error
	// text and the destination it gave - the operator's case, and the sentence
	// that would have saved the day. The account is named as the one BEHIND
	// dictation rather than as the reader's own: the relay holds the bearer, so
	// an app that does not know whose account it is must not imply one.
	assert.equal(
		await throughTheClient({
			status: 500,
			kind: "error",
			detail: OPENAI_QUOTA,
		}),
		"Dictation failed: the OpenAI account behind dictation is out of credits. Top it up at platform.openai.com/account/billing, then try again.",
	);

	// The same family with no destination to give: the account-neutral sentence.
	// "Top it up" is the only action available when the body names no surface.
	assert.equal(
		transcriptionFailureMessage(
			new TranscriptionRequestError(
				500,
				"insufficient_quota: no credits remaining",
			),
		),
		"Dictation failed: the account behind dictation is out of credits. Top it up, then try again.",
	);

	// A destination too long to show is not named: half a URL is not an address.
	assert.equal(
		transcriptionFailureMessage(
			new TranscriptionRequestError(
				500,
				"insufficient_quota: top up at https://billing.example-provider-with-a-long-host.invalid/accounts/12345/credits",
			),
		),
		"Dictation failed: the account behind dictation is out of credits. Top it up, then try again.",
	);
});

/**
 * The precedence between the two BODY families, pinned by a case that matches
 * both (review round 1, R5).
 *
 * The mapper's order is the precedence, and before this case no assertion
discriminated it: swapping the credits and sign-in checks left the whole suite
 * green, so a body like `Unauthorized: no credits remaining` could flip the
 * remedy from "top the account up" to "sign in again" - a sign-in that would
 * not help - without a test noticing. The winner is the credits family: it names
 * a cause and a cure, while "unauthorized" is the wrapper nearly every upstream
 * refusal arrives in.
 */
test("a body matching both families is answered by the credits family", () => {
	const both =
		"Unauthorized: no credits remaining. Visit https://platform.openai.com/account/billing to add credits.";
	assert.equal(
		transcriptionFailureMessage(new TranscriptionRequestError(500, both)),
		"Dictation failed: the account behind dictation is out of credits. Top it up at platform.openai.com/account/billing, then try again.",
		"a body matching both families must keep the credits remedy",
	);

	// And the status arm outranks both: a 402 whose body says "Unauthorized" is
	// still Radient refusing to pay for the request.
	assert.equal(
		transcriptionFailureMessage(
			new TranscriptionRequestError(
				402,
				"Unauthorized: invalid api key, insufficient_quota",
			),
		),
		"Dictation failed: you're out of Radient credits. Get more credits, then try dictating again.",
	);
});

test("a refused credential is a sign-in, not a retry", async () => {
	const expected =
		"Dictation failed: your Radient sign-in was refused. Sign in to Radient again, then try again.";
	for (const status of [401, 403]) {
		assert.equal(
			await throughTheClient({ status, kind: "error", detail: "Forbidden" }),
			expected,
		);
	}
	// The relay layer's own status can be a 200-shaped body from a proxy, so the
	// body is consulted too - the same remedy either way.
	assert.equal(
		transcriptionFailureMessage(
			new TranscriptionRequestError(500, "Unauthorized: invalid api key"),
		),
		expected,
	);
});

test("anything else quotes the server's reason, then says what to do", async () => {
	assert.equal(
		transcriptionFailureMessage(
			new TranscriptionRequestError(500, "Could not decode the audio file."),
		),
		"Dictation failed: Could not decode the audio file. Try again, or report it with the console detail.",
	);

	// The shape the task warned about: a URL, the relay's own verb and status,
	// and a whole JSON document. The reason inside the document is what a person
	// can act on, and it is now what the toast shows - not the scaffolding around
	// it, which is what review round 1 measured as four lines ending mid-phrase
	// (D2) and had no next step in it.
	const long = `POST https://api.example.com/v1/audio/transcriptions returned 400\n{"error":{"message":"The audio could not be decoded: unsupported codec 'opus' in a webm container without a duration header, and the request was retried three times before the provider gave up on the segment.","type":"invalid_request_error"}}`;
	const clipped = transcriptionFailureMessage(
		new TranscriptionRequestError(500, long),
	);
	assert.ok(
		clipped.length <= 150,
		`the toast is ${clipped.length} characters, which is a document rather than a sentence: ${clipped}`,
	);
	assert.ok(
		clipped.startsWith("Dictation failed: The audio could not be decoded"),
		`the reason must lead, and be the provider's own words: ${clipped}`,
	);
	assert.ok(
		clipped.includes("'opus'"),
		`the clip must not hide the token a bug report needs: ${clipped}`,
	);
	assert.ok(
		clipped.endsWith("Try again, or report it with the console detail."),
		`every unnamed cause must end with an action: ${clipped}`,
	);
	assert.ok(
		clipped.includes("…"),
		`a clipped sentence must show it was clipped: ${clipped}`,
	);
	assert.ok(!clipped.includes("\n"), "the sentence must be one line");
	for (const scaffolding of ["https://", '{"error"', '"type"', "returned 400"])
		assert.ok(
			!clipped.includes(scaffolding),
			`the toast still carries ${scaffolding}: ${clipped}`,
		);

	// A short detail is NOT clipped and gets no ellipsis.
	assert.equal(
		transcriptionFailureMessage(
			new TranscriptionRequestError(500, "Bad audio."),
		),
		"Dictation failed: Bad audio. Try again, or report it with the console detail.",
	);

	// A JSON body whose reason is short keeps every word of it, wrapper removed.
	assert.equal(
		transcriptionFailureMessage(
			new TranscriptionRequestError(
				400,
				'{"error":{"message":"Unsupported sample rate."}}',
			),
		),
		"Dictation failed: Unsupported sample rate. Try again, or report it with the console detail.",
	);

	// A prose body with the relay's own wrapper still reads as the server's
	// sentence rather than as a request line.
	assert.equal(
		transcriptionFailureMessage(
			new TranscriptionRequestError(
				400,
				"POST https://api.example.com/v1/audio/transcriptions returned 400 The audio was empty.",
			),
		),
		"Dictation failed: The audio was empty. Try again, or report it with the console detail.",
	);
});

test("an absent reason states the absence rather than inventing a cause", () => {
	for (const nothing of [
		new TranscriptionRequestError(503, ""),
		new TranscriptionRequestError(503, "   "),
		new Error(""),
		"a string, not an error",
		undefined,
		null,
	]) {
		assert.equal(
			transcriptionFailureMessage(nothing),
			"Dictation failed, and the server gave no reason. Try again, or report it with the console detail.",
			`${String(nothing)} produced an invented cause`,
		);
	}
	// Not the sentence this change deletes, and not a near-clone of it either:
	// "try again" as the whole advice is what cost the operator a day.
	assert.notEqual(
		transcriptionFailureMessage(new Error("")),
		"Error transcribing audio. Please try again.",
	);
});

test("no case still says the old generic line", async () => {
	// The literal is the defect: it told the operator to try again against an
	// account with no credits.
	const cases = [
		{ status: 402, detail: "Payment Required" },
		{ status: 401, detail: "Forbidden" },
		{ status: 500, detail: OPENAI_QUOTA },
		{ status: 500, detail: "Could not decode the audio file." },
		{ status: 500, detail: "" },
	];
	for (const one of cases) {
		const sentence = await throughTheClient({ ...one, kind: "error" });
		assert.notEqual(
			sentence,
			OLD_LITERAL,
			`status ${one.status} kept the old line`,
		);
		/*
		 * The product calls this feature DICTATION everywhere else (both call sites
		 * already show "Dictation is not available on this device."), so every
		 * sentence opens with its name and never with "Transcription" - a user
		 * reading two names for one action seconds apart is the defect here (review
		 * round 1, D6).
		 */
		assert.match(
			sentence,
			/^Dictation failed[.:,]/,
			`"${sentence}" does not open with the feature's own name and what failed`,
		);
	}
});

test("both call sites render the shared sentence and keep the raw error", async () => {
	// Two call sites, one map. A re-inlined literal here is how the next cause
	// reaches the user as "please try again".
	for (const file of [
		"src/renderer/src/features/chat/components/message-input.tsx",
		"src/renderer/src/features/chat/components/canvas/inline-edit.tsx",
	]) {
		const source = await readFile(file, "utf8");
		assert.ok(
			source.includes("showErrorToast(transcriptionFailureMessage(error))"),
			`${file} does not route its toast through the shared map`,
		);
		assert.ok(
			source.includes('console.error("Error transcribing audio:", error)'),
			`${file} no longer logs the raw failure, which is the only place the server's own words survive`,
		);
		assert.ok(
			!source.includes(OLD_LITERAL),
			`${file} still inlines the generic sentence`,
		);
	}
});
