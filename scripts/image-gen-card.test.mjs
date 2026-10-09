import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The image-gen card's one adapter module (`image-gen-card-model.ts`), asserted
 * where it is cheapest to be wrong:
 *
 *   - the DETECTION SET is the frozen single tool name, and a near-miss does
 *     not detect;
 *   - every record arm maps to the frozen state vocabulary, and the arms that
 *     settle first (an interrupt over a running call, a verdict over a phase)
 *     win in that order;
 *   - ABSENCE IS RENDERED AS ABSENCE: with no fraction, no logs and no queue
 *     position on any frame today, the mapping yields null/empty values the
 *     card reduces to, never an invented zero or placeholder line;
 *   - the affordance gating: only wired handlers draw controls, and only in
 *     states that can act on them.
 *
 * The module is bundled rather than imported raw so the test runs against the
 * same TS the app compiles, the way `tool-row.test.mjs` bundles its model.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/canonical/image-gen-card-model";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	IMAGE_GEN_TOOL_NAMES,
	imageGenCardControls,
	imageGenCardView,
	isImageGenTool,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** One `generate_image` record, its fields spelled the way the union declares. */
const tool = (over = {}) => ({
	kind: "tool",
	id: "tool:1",
	ts: 0,
	toolCallId: "call:1",
	toolName: "generate_image",
	intent: null,
	args: null,
	phase: "done",
	argumentBytes: 0,
	notRunReason: null,
	notRunKind: null,
	neverSent: false,
	output: null,
	isError: false,
	durationS: null,
	startedAt: null,
	endedAt: null,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
	...over,
});

const ALL_ACTIONS = {
	onCancel: () => {},
	onRestart: () => {},
	onEditRestart: () => {},
};

test("the detection set is the one frozen tool name", () => {
	assert.deepEqual([...IMAGE_GEN_TOOL_NAMES], ["generate_image"]);
	assert.equal(isImageGenTool("generate_image"), true);
	// The image-to-image edit rides `source_image_path` on the SAME tool; the
	// second name was frozen away before it ever had a producer.
	assert.equal(isImageGenTool("generate_altered_image"), false);
	assert.equal(isImageGenTool("bash"), false);
	// Exact match only — a case or spelling drift must not silently detect.
	assert.equal(isImageGenTool("Generate_Image"), false);
	assert.equal(isImageGenTool("generate_image "), false);
	assert.equal(isImageGenTool(""), false);
});

test("a dictated or waiting call maps to queued, with the byte count it has", () => {
	assert.deepEqual(
		imageGenCardView(tool({ phase: "composing", argumentBytes: 2458 })),
		{ state: "queued", composing: true, argumentBytes: 2458 },
	);
	assert.deepEqual(
		imageGenCardView(tool({ phase: "queued", argumentBytes: 2458 })),
		{ state: "queued", composing: false, argumentBytes: 2458 },
	);
});

test("a running call carries the call's own clock, and progress reports absence rather than guessing", () => {
	const view = imageGenCardView(tool({ phase: "running", startedAt: 1234 }));
	assert.equal(view.state, "running");
	assert.equal(view.startedAtMs, 1234);
	// No frame carries a fraction, a log line or a queue position yet: every
	// absence stays an absence, so the card reduces instead of inventing.
	assert.equal(view.progress.fraction, null);
	assert.deepEqual(view.progress.logs, []);
	assert.equal(view.progress.queuePosition, null);
	// A running frame that stated no start (a legacy producer) has no clock —
	// not a zero, which would claim the call just began.
	const noClock = imageGenCardView(tool({ phase: "running", startedAt: null }));
	assert.equal(noClock.startedAtMs, null);
});

test("a stop in flight folds over an unsettled call, and over nothing else", () => {
	const running = imageGenCardView(tool({ phase: "running", startedAt: 42 }), {
		stopping: true,
	});
	assert.equal(running.state, "cancelling");
	assert.equal(running.generating, true);
	assert.equal(running.startedAtMs, 42);
	const queued = imageGenCardView(tool({ phase: "queued" }), {
		stopping: true,
	});
	assert.equal(queued.state, "cancelling");
	// Nothing was generating yet, so the cancelling step must not grow a tile.
	assert.equal(queued.generating, false);
	// Settled states do not reopen for a late stop fact.
	const done = imageGenCardView(tool({ phase: "done" }), { stopping: true });
	assert.equal(done.state, "done");
});

test("a settled success carries the images and the measured duration through untouched", () => {
	const images = [
		{ id: "tool:1:0", data: "AAAA", attachment: null, mimeType: "image/png" },
	];
	const view = imageGenCardView(
		tool({ phase: "done", durationS: 8.6, images }),
	);
	assert.equal(view.state, "done");
	// The SAME array reference: the fold's media counting reads the record's
	// own `images`, so the card cannot disagree with the condensed strip.
	assert.equal(view.images, images);
	assert.equal(view.durationS, 8.6);
	// The ordinary receipt, and the only one a record can reach today:
	// `already-finished` is the frozen `media_already_completed` arm, which no
	// wire field carries yet.
	assert.equal(view.receipt, "generated");
	// A settled success with no duration (a replayed row) states none.
	assert.equal(
		imageGenCardView(tool({ phase: "done", durationS: null })).durationS,
		null,
	);
});

test("a failure carries the error text verbatim, and a verdict keeps its own", () => {
	const provider = imageGenCardView(
		tool({
			isError: true,
			output: "This generation failed before producing output.",
		}),
	);
	assert.deepEqual(provider, {
		state: "failed",
		message: "This generation failed before producing output.",
		// The frozen `error_type` has no home on the wire yet; the view carries
		// the slot so the read stays in this one module when it lands.
		errorType: null,
	});
	// An error frame that carried no text states none — the card's absence
	// sentence is the card's, and nothing here invents a detail.
	assert.deepEqual(imageGenCardView(tool({ isError: true, output: null })), {
		state: "failed",
		message: null,
		errorType: null,
	});
	const harness = imageGenCardView(
		tool({
			phase: "queued",
			neverSent: true,
			notRunKind: "invalid_arguments",
			notRunReason:
				"invalid arguments for generate_image: 'prompt' is required",
		}),
	);
	assert.deepEqual(harness, {
		state: "failed",
		message: "invalid arguments for generate_image: 'prompt' is required",
		errorType: null,
	});
	// A record built by hand carries no `notRunReason` key at all; an absent
	// key must not read as a verdict.
	assert.equal(
		imageGenCardView(
			tool({ isError: true, output: "boom", notRunReason: undefined }),
		).message,
		"boom",
	);
});

test("the interrupted endings map to cancelled, with no text claimed for them", () => {
	assert.deepEqual(imageGenCardView(tool({ stopped: true })), {
		state: "cancelled",
	});
	for (const kind of ["skipped", "aborted"]) {
		assert.equal(
			imageGenCardView(
				tool({
					phase: "queued",
					neverSent: true,
					notRunKind: kind,
					notRunReason: "a verdict the interrupted arm outranks",
				}),
			).state,
			"cancelled",
		);
	}
	// The turn died while the call was still being dictated: no verdict, and
	// still not a failure — nothing ran, so nothing failed.
	assert.equal(
		imageGenCardView(tool({ phase: "composing", neverSent: true })).state,
		"cancelled",
	);
	// A user stop outranks an error on the same record, which is the arm order
	// the module documents: the stop is the fact the user caused.
	assert.equal(
		imageGenCardView(tool({ stopped: true, isError: true })).state,
		"cancelled",
	);
});

test("controls render only where wired and where the state can act", () => {
	const running = {
		state: "running",
		startedAtMs: null,
		progress: { fraction: null, logs: [], queuePosition: null },
	};
	const cancelling = { ...running, state: "cancelling", generating: true };
	const done = { state: "done", images: [], durationS: null };
	const failed = { state: "failed", message: null, errorType: null };
	const cancelled = { state: "cancelled" };

	// Nothing wired, nothing drawn — an absent handler is an absent control.
	assert.deepEqual(imageGenCardControls(running, undefined), []);
	assert.deepEqual(imageGenCardControls(running, {}), []);
	assert.deepEqual(imageGenCardControls(running, { onCancel: () => {} }), [
		{ kind: "cancel", disabled: false },
	]);
	// While the stop is in flight the control is drawn but held.
	assert.deepEqual(imageGenCardControls(cancelling, { onCancel: () => {} }), [
		{ kind: "cancel", disabled: true },
	]);
	// A done card offers nothing: the artifact is there.
	assert.deepEqual(imageGenCardControls(done, ALL_ACTIONS), []);
	// Terminal without an image: the restart slots, in a stable order.
	assert.deepEqual(
		imageGenCardControls(failed, ALL_ACTIONS).map((control) => control.kind),
		["restart", "editRestart"],
	);
	assert.deepEqual(
		imageGenCardControls(cancelled, ALL_ACTIONS).map((control) => control.kind),
		["restart", "editRestart"],
	);
	assert.deepEqual(
		imageGenCardControls(cancelled, { onRestart: () => {} }).map(
			(control) => control.kind,
		),
		["restart"],
	);
	// Cancel is not offered where it cannot act, even when wired.
	assert.deepEqual(imageGenCardControls(failed, { onCancel: () => {} }), []);
});
