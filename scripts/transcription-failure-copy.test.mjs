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
	// Radient's own billing refusal: the reader's own account is the one to top up.
	assert.equal(
		await throughTheClient({
			status: 402,
			kind: "error",
			detail: "Payment Required",
		}),
		"Transcription failed: you're out of Radient credits. Add credits to continue.",
	);

	// The upstream provider's refusal, with the provider named by its own error
	// text - the operator's case, and the sentence that would have saved the day.
	assert.equal(
		await throughTheClient({
			status: 500,
			kind: "error",
			detail: OPENAI_QUOTA,
		}),
		"Transcription failed: the OpenAI account is out of credits. Add credits to it, then try again.",
	);

	// The same family without a nameable provider: the copy still says where to go.
	assert.equal(
		transcriptionFailureMessage(
			new TranscriptionRequestError(
				500,
				"insufficient_quota: no credits remaining",
			),
		),
		"Transcription failed: the transcription account is out of credits. Add credits to it, then try again.",
	);
});

test("a refused credential is a sign-in, not a retry", async () => {
	const expected =
		"Transcription failed: the server refused this app's sign-in. Sign in to Radient again, then try again.";
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

test("anything else quotes the server, clipped, and never dumps a body", async () => {
	assert.equal(
		transcriptionFailureMessage(
			new TranscriptionRequestError(500, "Could not decode the audio file."),
		),
		"Transcription failed: Could not decode the audio file.",
	);

	// The shape the task warned about: a URL plus a whole JSON document, with the
	// newlines a toast would otherwise render as one run-on line.
	const long = `Transcription failed at https://api.example.com/v1/audio/transcriptions\n{"error":{"message":"${"x".repeat(900)}","type":"invalid_request_error"}}`;
	const clipped = transcriptionFailureMessage(
		new TranscriptionRequestError(500, long),
	);
	assert.ok(
		clipped.length <= 141,
		`the toast is ${clipped.length} characters, which is a document rather than a sentence: ${clipped}`,
	);
	assert.ok(
		clipped.endsWith("…"),
		`a clipped sentence must show it was clipped: ${clipped}`,
	);
	assert.ok(!clipped.includes("\n"), "the sentence must be one line");
	assert.ok(
		!clipped.includes('"type"'),
		`the JSON body leaked into the toast: ${clipped}`,
	);

	// A short detail is NOT clipped and gets no ellipsis.
	assert.equal(
		transcriptionFailureMessage(
			new TranscriptionRequestError(500, "Bad audio."),
		),
		"Transcription failed: Bad audio.",
	);
});

test("an absent reason falls back to a sentence with no invented cause", () => {
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
			"Transcription failed. Please try again.",
			`${String(nothing)} produced an invented cause`,
		);
	}
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
		assert.match(
			sentence,
			/^Transcription failed[.:]/,
			`"${sentence}" does not open with what failed`,
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
