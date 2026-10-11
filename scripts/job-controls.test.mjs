import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * The Jobs cancel's pure model (`job-controls-model.ts`): which rows may be
 * cancelled, what a refusal speaks, and the write's retry boundary.
 *
 * The POLICY lives here rather than inside the hook for the repo's own reason
 * (`monitor-controls-model.ts` states it): a verification surface has to be
 * able to CONSTRUCT the rules rather than approximate them, and this module's
 * graph carries no React, so it bundles for `node --test` as-is. The hook's
 * behaviour is driven against the real pane in `job-cancel-panel.test.mjs`.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/components/run-details/job-controls-model";',
			'export { DesktopControlError } from "@shared/api/local-operator/desktop-api";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	external: ["react", "react-dom", "react/jsx-runtime"],
	packages: "external",
	jsx: "automatic",
});
const bundlePath = new URL("._job-controls.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => undefined));
const {
	JOB_CANCEL_NOT_FOUND_COPY,
	VIDEO_JOB_TYPE,
	jobRowCanCancel,
	retryJobWrite,
	DesktopControlError,
} = await import(bundlePath.href);

/** One derived row, with the fields the predicate reads. */
const row = (over = {}) => ({
	id: "job-1",
	label: "Video generation (i2v, 8s, Radient)",
	role: null,
	jobType: "video",
	status: "running",
	elapsedLabel: "2m",
	startSeconds: 0,
	settledSeconds: null,
	contextLabel: null,
	costLabel: null,
	activity: null,
	errorLine: null,
	errorText: null,
	resultText: null,
	childSessionId: null,
	parentJobId: null,
	childCount: 0,
	modelLabel: null,
	brief: null,
	launchMessageId: null,
	launchPrompts: {},
	...over,
});

test("the control rides the video row family only, and only while the row is open", () => {
	assert.equal(VIDEO_JOB_TYPE, "video");
	assert.equal(jobRowCanCancel(row()), true);
	// Every other family and every absent word: the control is withheld rather
	// than guessed onto a row the design did not attach it to.
	assert.equal(jobRowCanCancel(row({ jobType: "bash" })), false);
	assert.equal(jobRowCanCancel(row({ jobType: "task" })), false);
	assert.equal(jobRowCanCancel(row({ jobType: null })), false);
	assert.equal(jobRowCanCancel(row({ jobType: "" })), false);
	// Settled: nothing left to cancel, so nothing to offer.
	assert.equal(jobRowCanCancel(row({ status: "done" })), false);
	assert.equal(jobRowCanCancel(row({ status: "failed" })), false);
	assert.equal(jobRowCanCancel(row({ status: "cancelled" })), false);
	assert.equal(jobRowCanCancel(row({ status: "queued" })), true);
});

test("the refusal fallback is the frozen not_found phrase, em dash and all", () => {
	// The engine's wording map is the source (`tools/image_tool.py`'s
	// `_CANCEL_PHRASES`); a surface may quote it, never paraphrase it. This
	// pins the quote character-for-character.
	assert.equal(
		JOB_CANCEL_NOT_FOUND_COPY,
		"not cancelled — the provider no longer knows the job",
	);
});

test("the write retries exactly once, and only a request that never got an answer", () => {
	const raw = (status, message = "refused") =>
		new DesktopControlError(status, message);
	// No answer (the IPC call rejected or main stayed silent): one re-send,
	// because re-sending is how the outcome is learned.
	assert.equal(retryJobWrite(0, raw(null)), true);
	assert.equal(retryJobWrite(1, raw(null)), false);
	// An ANSWERED refusal is the outcome itself, at any status: the first
	// sentence surfaces, and the same cancel is not sent twice.
	assert.equal(retryJobWrite(0, raw(503)), false);
	assert.equal(retryJobWrite(0, raw(404)), false);
	assert.equal(retryJobWrite(0, raw(409, "already gone")), false);
	// Nothing that is not the transport's error shape is retried either.
	assert.equal(retryJobWrite(0, new Error("boom")), false);
});
