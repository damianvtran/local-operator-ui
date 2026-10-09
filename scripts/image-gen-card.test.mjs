import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/*
 * The image-gen card's one adapter module (`image-gen-card-model.ts`), asserted
 * where it is cheapest to be wrong:
 *
 *   - the DETECTION SET is the frozen single tool name, and a near-miss does
 *     not detect;
 *   - every record arm maps to the frozen state vocabulary, and the arms that
 *     settle first (an interrupt over a running call, a verdict over a phase)
 *     win in that order;
 *   - ABSENCE IS RENDERED AS ABSENCE: a record whose canonical payload states
 *     nothing (or carries none) yields null/empty values the card reduces to,
 *     never an invented zero or placeholder line;
 *   - the CANONICAL PAYLOAD reads field by field (harness PR #2089): position,
 *     logs, fraction, the error pair, the mid-walk failure, the
 *     `media_already_completed` receipt and a plain cancel's stage;
 *   - the affordance gating: only wired handlers draw controls, and only in
 *     states that can act on them;
 *   - the RENDER-level rules the model cannot see, against the real component
 *     server-rendered at the end of this file: the cancelling card's bar
 *     follows the tile's own predicate, and a queued card states its queue
 *     position only when one exists.
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
	details: null,
	...over,
});

/** The canonical payload as the wire emits it: every key present. */
const canonical = (over = {}) => ({
	tool_name: "generate_image",
	stage: null,
	queue_position: null,
	progress_fraction: null,
	log_lines: null,
	error: null,
	error_type: null,
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
		{
			state: "queued",
			composing: true,
			argumentBytes: 2458,
			queuePosition: null,
		},
	);
	assert.deepEqual(
		imageGenCardView(tool({ phase: "queued", argumentBytes: 2458 })),
		{
			state: "queued",
			composing: false,
			argumentBytes: 2458,
			queuePosition: null,
		},
	);
	// A frame with no canonical payload states the absence; the render's
	// presence path is driven by the read below (and the SSR pins).
});

test("a running call carries the call's own clock, and progress reports absence rather than guessing", () => {
	const view = imageGenCardView(tool({ phase: "running", startedAt: 1234 }));
	assert.equal(view.state, "running");
	assert.equal(view.startedAtMs, 1234);
	// The frame stated none of the three: every absence stays an absence, so
	// the card reduces instead of inventing.
	assert.equal(view.progress.fraction, null);
	assert.deepEqual(view.progress.logs, []);
	assert.equal(view.progress.queuePosition, null);
	// A running frame that stated no start (a legacy producer) has no clock —
	// not a zero, which would claim the call just began.
	const noClock = imageGenCardView(tool({ phase: "running", startedAt: null }));
	assert.equal(noClock.startedAtMs, null);
});

test("the canonical payload reads into the frozen slots, field by field", () => {
	// A queued frame's stated position renders on the queued state.
	assert.deepEqual(
		imageGenCardView(
			tool({
				phase: "queued",
				details: canonical({ stage: "queued", queue_position: 2 }),
			}),
		),
		{
			state: "queued",
			composing: false,
			argumentBytes: 0,
			queuePosition: 2,
		},
	);
	// A running frame's log lines come through in order, and its fraction —
	// still null on every real frame — is carried without synthesis.
	const running = imageGenCardView(
		tool({
			phase: "running",
			startedAt: 7,
			details: canonical({
				stage: "in_progress",
				log_lines: [
					{ message: "step 1 of 4", timestamp: 1 },
					{ message: "step 2 of 4", timestamp: 2 },
				],
			}),
		}),
	);
	assert.equal(running.state, "running");
	assert.deepEqual(running.progress.logs, ["step 1 of 4", "step 2 of 4"]);
	assert.equal(running.progress.fraction, null);
	// A frame that DOES carry a fraction (story-only until a provider reports
	// one) passes it through untouched.
	const fraction = imageGenCardView(
		tool({ phase: "running", details: canonical({ progress_fraction: 0.5 }) }),
	);
	assert.equal(fraction.progress.fraction, 0.5);
	// Absence on every branch: no payload, an unshaped object, or a non-object
	// reads exactly as no frame at all (the reducer's shape gate documents why
	// a stray `kind`-only object must not be interpreted as progress).
	for (const details of [null, undefined, { kind: "something" }, []]) {
		const view = imageGenCardView(tool({ phase: "running", details }));
		assert.equal(view.progress.fraction, null);
		assert.deepEqual(view.progress.logs, []);
		assert.equal(view.progress.queuePosition, null);
	}
	// Malformed log entries are dropped, not guessed at.
	const malformed = imageGenCardView(
		tool({
			phase: "running",
			details: canonical({
				log_lines: [{ message: 7 }, {}, "nope", { message: "ok" }],
			}),
		}),
	);
	assert.deepEqual(malformed.progress.logs, ["ok"]);
	// A non-integer position is not a position.
	const fractional = imageGenCardView(
		tool({ phase: "queued", details: canonical({ queue_position: 1.5 }) }),
	);
	assert.equal(fractional.queuePosition, null);
});

test("the failure pair reads verbatim, the conflict is a receipt, and a plain cancel is cancelled", () => {
	// A settled failure: the frozen `error` field is the message (falling back
	// to the result's output when a frame carried none), `error_type` beside it.
	const failed = imageGenCardView(
		tool({
			isError: true,
			output: "the result's own text",
			details: canonical({
				error: "out of credits",
				error_type: "insufficient_credits",
			}),
		}),
	);
	assert.deepEqual(failed, {
		state: "failed",
		message: "out of credits",
		errorType: "insufficient_credits",
	});
	// The mid-walk frame (`stage: null`, the pair present, the call unsettled):
	// the LIVE presentation with the sentence as its interim note (design round
	// 1, D1) — never the settled failed arm — and the next frame's absence
	// swaps the note with no state-level change and no control flicker.
	const midWalk = imageGenCardView(
		tool({
			phase: "running",
			startedAt: 3,
			details: canonical({
				error: "out of credits",
				error_type: "insufficient_credits",
			}),
		}),
	);
	assert.deepEqual(midWalk, {
		state: "running",
		startedAtMs: 3,
		progress: { fraction: null, logs: [], queuePosition: null },
		note: "out of credits",
	});
	const recovered = imageGenCardView(
		tool({
			phase: "running",
			startedAt: 3,
			details: canonical({ stage: "queued", queue_position: 1 }),
		}),
	);
	assert.equal(recovered.state, "running");
	assert.equal(recovered.note, null);
	// The conflict receipt: an error-shaped result whose code makes it the done
	// state's already-finished receipt — a finish, never a failure.
	const conflict = imageGenCardView(
		tool({
			isError: true,
			output: "not cancelled — it had already completed",
			details: canonical({
				stage: "cancelled",
				error:
					"The generation had already completed when the cancel arrived; its result was discarded.",
				error_type: "media_already_completed",
			}),
		}),
	);
	assert.deepEqual(conflict, {
		state: "done",
		images: [],
		durationS: null,
		receipt: "already-finished",
	});
	// A plain cancel's result: stage cancelled, no `error_type` — cancelled.
	assert.deepEqual(
		imageGenCardView(
			tool({
				isError: true,
				output: "Cancelled",
				details: canonical({ stage: "cancelled" }),
			}),
		),
		{ state: "cancelled" },
	);
	// An error-shaped result with no canonical payload keeps the old read.
	assert.deepEqual(imageGenCardView(tool({ isError: true, output: "boom" })), {
		state: "failed",
		message: "boom",
		errorType: null,
	});
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
		// The frozen `error_type` lives in the record's `details` carrier; a
		// record that states none carries null, and the read stays in this module.
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

/*
 * ---------------------------------------------------------------------------
 * THE RENDER-LEVEL PINS. The bar's gate and the queue position are properties
 * of the COMPONENT's output, not of the mapping, so they are asserted against
 * the real card server-rendered — `canonical-notice.test.mjs`'s pattern. A
 * SECOND bundle, component-side, so a component import failure cannot take the
 * model tests above down with it.
 */
const componentBundle = await build({
	stdin: {
		contents: `export { ImageGenCard } from "./src/renderer/src/features/chat/canonical/image-gen-card";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	/*
	 * `{}` for `import.meta.env`, the value `canonical-notice.test.mjs` bakes
	 * for the same reason: the shared config reads it at module scope and a
	 * bare bundle throws before a test runs.
	 */
	define: { "import.meta.env": "{}" },
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
});
/*
 * The component bundle is imported from a FILE, not a data: URL: it keeps
 * `react` external (the renderer below must share this test's React instance),
 * and a data: module cannot resolve a bare specifier at all -
 * `ERR_UNSUPPORTED_RESOLVE_REQUEST` - where a file: URL resolves it through
 * node_modules. `canonical-notice.test.mjs` writes its bundle for the same
 * reason; it is unlinked in the `finally`.
 */
const componentBundlePath = new URL(
	"./_image-gen-card.bundle.mjs",
	import.meta.url,
);
await writeFile(componentBundlePath, componentBundle.outputFiles[0].text);
let ImageGenCard;
try {
	({ ImageGenCard } = await import(componentBundlePath.href));
} finally {
	await unlink(componentBundlePath);
}

/** The card rendered the way the app renders it, absent attachment scope. */
const markupOf = (view, actions) =>
	renderToStaticMarkup(h(ImageGenCard, { view, scope: null, actions }));

/** The live-progress shape with every field negative (nothing on the wire). */
const NO_PROGRESS = { fraction: null, logs: [], queuePosition: null };

/** The byte-count shape `formatBytes` writes, for the composing datum. */
const BYTE_COUNT = /[0-9.]+ KB/;

/*
 * Both spellings of the generating body are pinned against the SAME render:
 * a call that was never generating must show `Cancelling…` with neither the
 * tile nor a `progressbar`; one that was keeps its TILE while the stop is in
 * flight — and draws no bar, because a fraction-less frame draws none (design
 * round 1, D2; the bar's own pins follow). (round-1 review F3.)
 */
test("a cancelling card wears the generating body only when one existed (F3)", () => {
	const neverGenerated = markupOf({
		state: "cancelling",
		generating: false,
		startedAtMs: null,
		progress: NO_PROGRESS,
	});
	assert.equal(neverGenerated.includes('role="progressbar"'), false);
	assert.equal(neverGenerated.includes("data-imagegen-tile"), false);
	// The words are honest either way: the plain state line stays.
	assert.equal(neverGenerated.includes("Cancelling"), true);

	const wasGenerating = markupOf({
		state: "cancelling",
		generating: true,
		startedAtMs: 5000,
		progress: NO_PROGRESS,
	});
	assert.equal(wasGenerating.includes("data-imagegen-tile"), true);
	// No fraction, no bar — the same rule the running pin below carries.
	assert.equal(wasGenerating.includes('role="progressbar"'), false);

	// A running call had a generation by definition, so the tile is there.
	const running = markupOf({
		state: "running",
		startedAtMs: null,
		progress: NO_PROGRESS,
	});
	assert.equal(running.includes("data-imagegen-tile"), true);
	assert.equal(running.includes('role="progressbar"'), false);
});

/*
 * The bar's ONE mode — the determinate fill — and its ONE gate: a fraction
 * must be carried (design round 1, D2). A fraction-less card draws no bar at
 * all (the tile's sweep is the surface's one indefinite element), the
 * determinate fill survives into a cancelling body that was generating and
 * still carries a fraction, and the tile stays wherever the body is.
 */
test("the bar draws only when a fraction is carried, and only determinate (D2)", () => {
	const running = markupOf({
		state: "running",
		startedAtMs: null,
		progress: { fraction: 0.42, logs: [], queuePosition: null },
	});
	assert.equal(running.includes('role="progressbar"'), true);
	assert.equal(running.includes('aria-valuenow="42"'), true);

	const cancelling = markupOf({
		state: "cancelling",
		generating: true,
		startedAtMs: 5000,
		progress: { fraction: 0.42, logs: [], queuePosition: null },
	});
	assert.equal(cancelling.includes('role="progressbar"'), true);
	assert.equal(cancelling.includes('aria-valuenow="42"'), true);

	const noFraction = markupOf({
		state: "running",
		startedAtMs: 42,
		progress: NO_PROGRESS,
	});
	assert.equal(noFraction.includes('role="progressbar"'), false);
	// The tile is the running body's liveness, and stays.
	assert.equal(noFraction.includes("data-imagegen-tile"), true);
});

/*
 * The queued state's datum slot: the position when one exists (the live
 * field's one render — round-1 QA Q-1), the dictation's byte count as the
 * fallback, and NOTHING when neither exists — absence must not become a zero
 * or a placeholder.
 */
test("a queued card states its queue position only when one exists (Q-1)", () => {
	const withPosition = markupOf({
		state: "queued",
		composing: false,
		argumentBytes: 1900,
		queuePosition: 2,
	});
	assert.equal(withPosition.includes("position 2"), true);

	const without = markupOf({
		state: "queued",
		composing: false,
		argumentBytes: 1900,
		queuePosition: null,
	});
	assert.equal(without.includes("position"), false);
	assert.equal(without.includes("Queued"), true);

	// The dictation half still states its byte count.
	const composing = markupOf({
		state: "queued",
		composing: true,
		argumentBytes: 2480,
		queuePosition: null,
	});
	assert.equal(composing.includes("Writing the request"), true);
	assert.match(composing, BYTE_COUNT);
});

/*
 * The mid-walk failure's LIVE presentation (design round 1, D1): the call
 * keeps its body, clock and Cancel while the sentence rides as a note under
 * the live body — and the note's absence on the next frame IS the un-say (no
 * latch, no state-level change, no control flicker).
 */
test("the mid-walk note rides under the live body, and the live affordances stay (D1)", () => {
	const note = markupOf(
		{
			state: "running",
			startedAtMs: 3000,
			progress: NO_PROGRESS,
			note: "out of credits",
		},
		{ onCancel: () => {} },
	);
	assert.equal(note.includes("data-imagegen-tile"), true);
	assert.equal(note.includes("Generating image…"), true);
	assert.equal(note.includes("data-imagegen-note"), true);
	assert.equal(note.includes("out of credits"), true);
	assert.equal(note.includes("Cancel"), true);

	// The recovered frame: same state, the note gone — the control neither
	// leaves nor disables, because no state the wire does not claim was painted.
	const recovered = markupOf(
		{
			state: "running",
			startedAtMs: 3000,
			progress: NO_PROGRESS,
			note: null,
		},
		{ onCancel: () => {} },
	);
	assert.equal(recovered.includes("data-imagegen-note"), false);
	assert.equal(recovered.includes("out of credits"), false);
	assert.equal(recovered.includes("data-imagegen-tile"), true);
	assert.equal(recovered.includes("Cancel"), true);
});
