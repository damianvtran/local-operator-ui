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
 *     follows the tile's own predicate, and a queued card states how many
 *     requests are ahead only when a count exists.
 *
 * The module is bundled rather than imported raw so the test runs against the
 * same TS the app compiles, the way `tool-row.test.mjs` bundles its model.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/canonical/image-gen-card-model";',
			'export * from "./src/renderer/src/features/chat/canonical/sound-batch-model";',
			'export { preferProgressDetails } from "./src/renderer/src/features/chat/components/trace/tool-row-model";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	alias: { "@shared": "./src/renderer/src/shared" },
	write: false,
});
const {
	IMAGE_GEN_TOOL_NAMES,
	imageGenCardControls,
	imageGenCardMountActions,
	imageGenCardView,
	imageGenMaterial,
	imageGenMaterialNoun,
	isImageGenTool,
	isVideoGenTool,
	preferProgressDetails,
	soundBatchItems,
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

test("the detection set is the four frozen tool names, and the material fact derives from them", () => {
	/*
	 * The set grew by the sound phase's two members (2026-10-17): the audio
	 * tools are ordinary interruptible tool calls, so they ride this card's
	 * whole six-state machine and this set is the one edit that routes them.
	 */
	assert.deepEqual([...IMAGE_GEN_TOOL_NAMES].sort(), [
		"generate_image",
		"generate_sound_effect",
		"generate_video",
		"generate_voiceover",
	]);
	assert.equal(isImageGenTool("generate_image"), true);
	assert.equal(isImageGenTool("generate_video"), true);
	assert.equal(isImageGenTool("generate_voiceover"), true);
	assert.equal(isImageGenTool("generate_sound_effect"), true);
	// The image-to-image edit rides `source_image_path` on the SAME tool; the
	// second image name was frozen away before it ever had a producer. The video
	// phase adds exactly one member, and only one spelling of it.
	assert.equal(isImageGenTool("generate_altered_image"), false);
	assert.equal(isImageGenTool("bash"), false);
	// Exact match only — a case or spelling drift must not silently detect.
	assert.equal(isImageGenTool("Generate_Image"), false);
	assert.equal(isImageGenTool("generate_image "), false);
	assert.equal(isImageGenTool("Generate_Voiceover"), false);
	assert.equal(isImageGenTool(""), false);
	// The material fact is derived once, from the call's own name — and the
	// noun it steers is spelled once, beside it, so the three strings cannot
	// come to name one material two ways.
	assert.equal(isVideoGenTool("generate_video"), true);
	assert.equal(isVideoGenTool("generate_image"), false);
	assert.equal(imageGenMaterial("generate_video"), "video");
	assert.equal(imageGenMaterial("generate_image"), "image");
	assert.equal(imageGenMaterial("generate_voiceover"), "voiceover");
	assert.equal(imageGenMaterial("generate_sound_effect"), "sound-effect");
	assert.equal(imageGenMaterial("bash"), "image");
	assert.equal(imageGenMaterialNoun("video"), "video");
	assert.equal(imageGenMaterialNoun("image"), "image");
	assert.equal(imageGenMaterialNoun("voiceover"), "voiceover");
	assert.equal(imageGenMaterialNoun("sound-effect"), "sound effect");
});

test("a dictated or waiting call maps to queued, with the byte count it has", () => {
	assert.deepEqual(
		imageGenCardView(tool({ phase: "composing", argumentBytes: 2458 })),
		{
			state: "queued",
			material: "image",
			composing: true,
			argumentBytes: 2458,
			queuePosition: null,
		},
	);
	assert.deepEqual(
		imageGenCardView(tool({ phase: "queued", argumentBytes: 2458 })),
		{
			state: "queued",
			material: "image",
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
			material: "image",
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
		material: "image",
		message: "out of credits",
		errorType: null,
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
		material: "image",
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
		material: "image",
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
		{ state: "cancelled", generating: false, message: "Cancelled" },
	);
	// An error-shaped result with no canonical payload keeps the old read.
	assert.deepEqual(imageGenCardView(tool({ isError: true, output: "boom" })), {
		state: "failed",
		material: "image",
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
		material: "image",
		message: "This generation failed before producing output.",
		// The frozen `error_type` lives in the record's `details` carrier; a
		// record that states none carries null, and the read stays in this module.
		errorType: null,
	});
	// An error frame that carried no text states none — the card's absence
	// sentence is the card's, and nothing here invents a detail.
	assert.deepEqual(imageGenCardView(tool({ isError: true, output: null })), {
		state: "failed",
		material: "image",
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
		material: "image",
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
		/*
		 * The fixture states no `startedAt` and no output, so the stop is a QUEUED
		 * one with no detail: `generating: false` is what picks the no-charge
		 * sentence at the card, and `message: null` is what leaves it to fall
		 * back rather than to claim a detail the record never had.
		 */
		generating: false,
		message: null,
	});
	// A stop on a call that HAD started: the in-flight split.
	const startedStop = imageGenCardView(
		tool({ stopped: true, startedAt: 1_000, output: "stopped by the reader" }),
	);
	assert.equal(startedStop.state, "cancelled");
	assert.equal(startedStop.generating, true);
	assert.equal(startedStop.message, "stopped by the reader");
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
		contents: `export { ImageGenCard } from "./src/renderer/src/features/chat/canonical/image-gen-card";
 export { useSoundStopGate } from "./src/renderer/src/features/chat/canonical/sound-stop-confirmation";
 export { useAudioEngineStore } from "./src/renderer/src/shared/store/audio-engine-store";
 export { useInterruptOnEscape } from "./src/renderer/src/features/chat/hooks/use-interrupt-on-escape";`,
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
let useAudioEngineStore;
let ImageGenCard;
let useSoundStopGate;
let useInterruptOnEscape;
try {
	({
		ImageGenCard,
		useSoundStopGate,
		useInterruptOnEscape,
		useAudioEngineStore,
	} = await import(componentBundlePath.href));
} finally {
	await unlink(componentBundlePath);
}

/** The card rendered the way the app renders it, absent attachment scope. */
const markupOf = (view, actions, scope = null) =>
	renderToStaticMarkup(h(ImageGenCard, { view, scope, actions }));

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
	/*
	 * THE LINE IS THE SECURITY ROUND'S, NOT "Cancelling…" (2026-10-17): a stop
	 * pressed before the provider was called is the one case that may claim no
	 * charge, and the sentence says exactly that.
	 */
	assert.equal(
		neverGenerated.includes(
			"Stopped before the provider was called; you will not be charged.",
		),
		true,
	);
	assert.equal(neverGenerated.includes("Cancelling…"), false);

	const wasGenerating = markupOf({
		state: "cancelling",
		generating: true,
		startedAtMs: 5000,
		progress: NO_PROGRESS,
	});
	assert.equal(wasGenerating.includes("data-imagegen-tile"), true);
	// No fraction, no bar — the same rule the running pin below carries.
	assert.equal(wasGenerating.includes('role="progressbar"'), false);
	/*
	 * AND THE OTHER SENTENCE for an in-flight stop: a REQUEST, with its billing
	 * consequence, and the settlement check that follows it. The no-charge line
	 * must NOT appear here — that is the inversion the split exists to prevent.
	 */
	assert.equal(wasGenerating.includes("Stop requested."), true);
	assert.equal(wasGenerating.includes("Checking for settlement."), true);
	assert.equal(
		wasGenerating.includes(
			"Stopped before the provider was called; you will not be charged.",
		),
		false,
	);

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
test("a queued card states how many are ahead only when a count exists (Q-1)", () => {
	const withPosition = markupOf({
		state: "queued",
		composing: false,
		argumentBytes: 1900,
		queuePosition: 2,
	});
	// The field counts requests AHEAD, so the copy says so: "2 ahead", never
	// "position 2" (which would read one off — the TUI's D3 ruling).
	// Anchored on the datum span's own edges (`>` ... `<`): a bare substring
	// would also pass for "12 ahead".
	assert.equal(withPosition.includes(">· 2 ahead<"), true);
	assert.equal(withPosition.includes("position"), false);

	// Zero is a real reading (nothing ahead), not an absent field.
	const nothingAhead = markupOf({
		state: "queued",
		composing: false,
		argumentBytes: 1900,
		queuePosition: 0,
	});
	assert.equal(nothingAhead.includes(">· 0 ahead<"), true);

	const without = markupOf({
		state: "queued",
		composing: false,
		argumentBytes: 1900,
		queuePosition: null,
	});
	assert.equal(without.includes("ahead"), false);
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
	/*
	 * The affordance is called "Stop" now, and its hint is the contract in one
	 * line: an in-flight press REQUESTS a stop the provider may ignore (and
	 * bill for), which is why the label is not "Cancel".
	 */
	assert.equal(note.includes(">Stop<"), true);
	assert.equal(
		note.includes("Requests a stop; the provider may finish anyway."),
		true,
	);

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
	assert.equal(recovered.includes(">Stop<"), true);
});

/*
 * ---------------------------------------------------------------------------
 * THE VIDEO LANE (the design spec's desktop deltas, V2/V3/V4 and the player
 * seam). The video tool rides this card's whole six-state machine; what these
 * pins hold is that the ONLY strings that move are the three material nouns,
 * that the material fact is derived from the record's own name rather than
 * re-spelled anywhere, and that the mount passes a video card no Cancel (R4,
 * contract §4.2).
 */

test("a video call maps through the same machine, with the material fact derived once", () => {
	const video = (over = {}) => tool({ toolName: "generate_video", ...over });

	// Running (V2's state): the same arm, the material fact beside the clock.
	const running = imageGenCardView(
		video({ phase: "running", startedAt: 1234 }),
	);
	assert.equal(running.state, "running");
	assert.equal(running.material, "video");
	assert.equal(running.startedAtMs, 1234); // unchanged by material

	// Done (V3's state): the receipt arm, unchanged but for the noun.
	const images = [
		{
			id: "tool:1:0",
			data: null,
			attachment: "a".repeat(32),
			mimeType: "video/mp4",
			kind: "video",
		},
	];
	const done = imageGenCardView(video({ phase: "done", durationS: 8, images }));
	assert.equal(done.state, "done");
	assert.equal(done.material, "video");
	assert.equal(done.durationS, 8);
	assert.equal(done.images, images);

	// Failed (V4's state): the fact rides the arm the absent-text fallback reads.
	const failed = imageGenCardView(video({ isError: true, output: null }));
	assert.equal(failed.state, "failed");
	assert.equal(failed.material, "video");

	// The conflict receipt is material-free ("Already finished."), but the arm
	// still carries the fact — one derivation, every arm that can name an
	// artifact.
	const conflict = imageGenCardView(
		video({
			isError: true,
			details: canonical({ error_type: "media_already_completed" }),
		}),
	);
	assert.equal(conflict.state, "done");
	assert.equal(conflict.material, "video");
	assert.equal(conflict.receipt, "already-finished");
});

test("the mount passes a video card no Cancel, and an image card the pane's interrupt (R4)", () => {
	const interrupt = () => {};
	// Video: NO actions, even with the interrupt wired — an in-turn press
	// cannot cancel a detached job (contract §4.2).
	assert.equal(
		imageGenCardMountActions("generate_video", interrupt),
		undefined,
	);
	// Image: the same press it always had.
	assert.deepEqual(imageGenCardMountActions("generate_image", interrupt), {
		onCancel: interrupt,
	});
	/*
	 * The audio calls keep the pane's interrupt, and that is the ONLY cancel
	 * affordance they draw: the frozen tool schema marks both `interruptible`,
	 * so the press really reaches the call - while a per-job "stop the vendor"
	 * control would lie (cancellation is best-effort once the vendor is
	 * mid-flight; contract §"cancellation is best-effort").
	 */
	assert.deepEqual(imageGenCardMountActions("generate_voiceover", interrupt), {
		onCancel: interrupt,
	});
	assert.deepEqual(
		imageGenCardMountActions("generate_sound_effect", interrupt),
		{
			onCancel: interrupt,
		},
	);
	// And a mount with no interrupt wired passes nothing either way.
	assert.equal(
		imageGenCardMountActions("generate_image", undefined),
		undefined,
	);
	assert.equal(
		imageGenCardMountActions("generate_voiceover", undefined),
		undefined,
	);
});

test("the material noun reaches the three strings, and only those strings move (V2/V3/V4)", () => {
	const running = markupOf({
		state: "running",
		material: "video",
		startedAtMs: null,
		progress: NO_PROGRESS,
	});
	assert.equal(running.includes("Generating video…"), true);
	assert.equal(running.includes("Generating image"), false);

	const done = markupOf({
		state: "done",
		material: "video",
		images: [],
		durationS: null,
		receipt: "generated",
	});
	assert.equal(done.includes("Generated video"), true);
	assert.equal(done.includes("Generated image"), false);

	const failed = markupOf({
		state: "failed",
		material: "video",
		message: null,
		errorType: null,
	});
	assert.equal(failed.includes("The video could not be generated."), true);
	assert.equal(failed.includes("could not be generated."), true);

	/*
	 * THE SOUND ARMS (2026-10-17): the same three strings, steered by the same
	 * `material` fact - `voiceover` and `sound effect` are the only words that
	 * move, and the failure fallback spells the noun the state line does.
	 */
	const voiceoverRunning = markupOf({
		state: "running",
		material: "voiceover",
		startedAtMs: null,
		progress: NO_PROGRESS,
	});
	assert.equal(voiceoverRunning.includes("Generating voiceover…"), true);
	assert.equal(voiceoverRunning.includes("Generating image"), false);
	const soundEffectRunning = markupOf({
		state: "running",
		material: "sound-effect",
		startedAtMs: null,
		progress: NO_PROGRESS,
	});
	assert.equal(soundEffectRunning.includes("Generating sound effect…"), true);
	const voiceoverDone = markupOf({
		state: "done",
		material: "voiceover",
		images: [],
		durationS: 12.5,
		receipt: "generated",
	});
	assert.equal(voiceoverDone.includes("Generated voiceover"), true);
	assert.equal(voiceoverDone.includes("Generated image"), false);
	const soundEffectFailed = markupOf({
		state: "failed",
		material: "sound-effect",
		message: null,
		errorType: null,
	});
	assert.equal(
		soundEffectFailed.includes("The sound effect could not be generated."),
		true,
	);

	// The image rendering is byte-identical to what it always was: same views,
	// `material: "image"`.
	const imageRunning = markupOf({
		state: "running",
		material: "image",
		startedAtMs: null,
		progress: NO_PROGRESS,
	});
	assert.equal(imageRunning.includes("Generating image…"), true);
	const imageFailed = markupOf({
		state: "failed",
		material: "image",
		message: null,
		errorType: null,
	});
	assert.equal(imageFailed.includes("The image could not be generated."), true);
});

test("a done card mounts a video ref through the player, never through an img", () => {
	const scope = { sessionId: "session-1", childId: null };
	// A LIVE ref (inline base64) resolves synchronously: the player mounts, at
	// the image ledger's own ceiling, with an accessible name rather than a
	// blob URL.
	const live = {
		id: "v1",
		data: "AAAA",
		attachment: null,
		mimeType: "video/mp4",
		kind: "video",
		durationS: 6.5,
		width: null,
		height: null,
	};
	const ready = markupOf({
		state: "done",
		material: "video",
		images: [live],
		durationS: 6.5,
		receipt: "generated",
	});
	assert.equal(ready.includes("<video"), true);
	assert.equal(ready.includes('preload="metadata"'), true);
	assert.equal(ready.includes('aria-label="Generated video"'), true);
	assert.equal(ready.includes("max-h-[240px]"), true);
	assert.equal(ready.includes("<img"), false);

	// A DURABLE ref (digest) with a scope reserves the box — no spinner, no
	// receipt — while the bytes travel; the marker is the state hook the rigs
	// read, the same one the image path's reserved box carries.
	const durable = { ...live, id: "v2", data: null, attachment: "b".repeat(32) };
	const resolving = markupOf(
		{
			state: "done",
			material: "video",
			images: [durable],
			durationS: null,
			receipt: "generated",
		},
		undefined,
		scope,
	);
	assert.equal(resolving.includes("data-attachment-reserved"), true);
	assert.equal(resolving.includes("<video"), false);
});

test("a done card mounts a sound ref through the player, never through an img", () => {
	/*
	 * The audio arm of the player seam: a voiceover's artifact is `kind:
	 * "audio"`, and the card mounts it through `CanonicalAudio` -> the shared
	 * `SoundPlayer` (never an `<img>`, which cannot decode it, and never the
	 * `<video>` player, which would paint a blank frame). The label reads the
	 * CARD's material noun, because the ref only knows it is audio.
	 */
	const scope = { sessionId: "session-1", childId: null };
	const live = {
		id: "a1",
		data: "AAAA",
		attachment: null,
		mimeType: "audio/mpeg",
		kind: "audio",
		durationS: 12.5,
		width: null,
		height: null,
	};
	const ready = markupOf(
		{
			state: "done",
			material: "voiceover",
			images: [live],
			durationS: 12.5,
			receipt: "generated",
		},
		undefined,
		scope,
	);
	assert.equal(ready.includes('data-sound-player="full"'), true);
	assert.equal(ready.includes('role="slider"'), true);
	assert.equal(
		ready.includes('aria-label="Generated voiceover position"'),
		true,
		"the slider names the card's material, not the wire's bare kind",
	);
	assert.equal(ready.includes("<img"), false);
	assert.equal(ready.includes("<video"), false);

	// A DURABLE ref (digest) with a scope reserves the box while the bytes
	// travel — the same state hook the picture and video paths carry.
	const durable = { ...live, id: "a2", data: null, attachment: "c".repeat(32) };
	const resolving = markupOf(
		{
			state: "done",
			material: "sound-effect",
			images: [durable],
			durationS: null,
			receipt: "generated",
		},
		undefined,
		scope,
	);
	assert.equal(resolving.includes("data-attachment-reserved"), true);
	assert.equal(resolving.includes('data-sound-player="full"'), false);
});

/**
 * THE STORY FIXTURE'S OWN BYTES. The video stories' tiny MP4 is a base64
 * literal, and a literal that silently decodes to less than it says photographs
 * a player that never loads: measured 2026-10-10, the first spelling wrapped it
 * across adjacent string literals - which JavaScript does NOT concatenate (ASI
 * ends the statement, the lines become dead expression statements) - so the
 * `video-done` capture ran to its 60 s shutter bound with a 57-byte "mp4". No
 * typecheck and no render-only assertion can see that; this one decodes the
 * literal out of the story source and checks it is a real MP4.
 */
const TINY_MP4_LITERAL = /const TINY_MP4_B64 =\n\t"([^"]+)";/;

test("the video stories' embedded MP4 decodes to a real, whole file", async () => {
	const { readFileSync } = await import("node:fs");
	const source = readFileSync(
		"src/renderer/src/features/chat/canonical/image-gen-card.stories.tsx",
		"utf8",
	);
	const match = source.match(TINY_MP4_LITERAL);
	assert.ok(match, "the literal is spelled as ONE line");
	const bytes = Buffer.from(match[1], "base64");
	/*
	 * WALK THE TOP-LEVEL BOX CHAIN TO THE EXACT END. The first spelling of
	 * this pin (`ftyp` present, `>1000` bytes, first box fits) accepted a
	 * literal truncated mid-file: a cut at, say, 1200 bytes still opens with
	 * a whole `ftyp`, still clears 1000, and its first box still fits — while
	 * the last box overruns or the chain stops short (agent review round 1,
	 * F6). The walk below is the ISO BMFF contract itself: every box opens
	 * with a 32-bit big-endian size and a four-character type; size 1 defers
	 * to a 64-bit largesize, size 0 (a final box only) extends to EOF.
	 */
	let offset = 0;
	const boxes = [];
	while (offset < bytes.length) {
		assert.ok(
			offset + 8 <= bytes.length,
			`box header at ${offset} fits the file`,
		);
		const size = bytes.readUInt32BE(offset);
		const type = bytes.subarray(offset + 4, offset + 8).toString("latin1");
		if (size === 0) {
			boxes.push(`${type}:eof`);
			offset = bytes.length;
			break;
		}
		let end;
		if (size === 1) {
			assert.ok(
				offset + 16 <= bytes.length,
				`largesize header at ${offset} fits the file`,
			);
			end = offset + Number(bytes.readBigUInt64BE(offset + 8));
		} else {
			assert.ok(
				size >= 8,
				`box ${type} at ${offset} carries a size (got ${size})`,
			);
			end = offset + size;
		}
		assert.ok(end <= bytes.length, `box ${type} at ${offset} fits the file`);
		boxes.push(type);
		offset = end;
	}
	assert.equal(
		offset,
		bytes.length,
		"the box chain ends exactly at the file's end",
	);
	assert.equal(boxes[0], "ftyp", "the bytes open with an ftyp box");
	assert.ok(boxes.includes("moov"), "the movie box is present");
	assert.ok(boxes.includes("mdat"), "the media payload is present");
});

/*
 * THE CANCEL WORDING, PINNED (security round 1, 2026-10-17; server follow-up on
 * PR #139). Stop is a REQUEST, and only a stop pressed before the provider was
 * called may claim no charge. These two sentences are product copy reviewed as
 * such, so they are asserted byte-for-byte, and the inversion — the no-charge
 * line on an in-flight stop — is asserted absent from the running frame.
 */
test("the cancel copy is the security round's queued/running split, byte for byte", () => {
	const QUEUED =
		"Stopped before the provider was called; you will not be charged.";
	const RUNNING =
		"Stop requested. The provider has no cancellation endpoint; the generation continues and will be charged if it produces audio. Checking for settlement.";

	const queuedFrame = markupOf(
		{
			state: "cancelling",
			generating: false,
			startedAtMs: null,
			progress: NO_PROGRESS,
		},
		{ onCancel: () => {} },
	);
	assert.equal(
		queuedFrame.includes(QUEUED),
		true,
		"a queued stop states the guarantee it can keep",
	);
	assert.equal(
		queuedFrame.includes(RUNNING),
		false,
		"and never the in-flight sentence",
	);

	const runningFrame = markupOf(
		{
			state: "cancelling",
			generating: true,
			startedAtMs: 1000,
			progress: NO_PROGRESS,
		},
		{ onCancel: () => {} },
	);
	assert.equal(
		runningFrame.includes(RUNNING),
		true,
		"an in-flight stop states the request, its cost consequence and the settlement check",
	);
	assert.equal(
		runningFrame.includes(QUEUED),
		false,
		"and NEVER the no-charge line",
	);

	/*
	 * THE SETTLED RECEIPT follows the same split, and prefers the tool/server
	 * detail when the record carries one: the wire's own words outrank either
	 * canned sentence.
	 */
	const settledQueued = markupOf({
		state: "cancelled",
		generating: false,
		message: null,
	});
	assert.equal(settledQueued.includes(QUEUED), true);
	const settledRunning = markupOf({
		state: "cancelled",
		generating: true,
		message: null,
	});
	assert.equal(settledRunning.includes(RUNNING), true);
	assert.equal(settledRunning.includes(QUEUED), false);
	const settledWithDetail = markupOf({
		state: "cancelled",
		generating: true,
		message: "stopped after the provider answered; billed 0.12 USD",
	});
	assert.equal(
		settledWithDetail.includes(
			"stopped after the provider answered; billed 0.12 USD",
		),
		true,
		"the server's settlement detail is the receipt",
	);
	assert.equal(settledWithDetail.includes(RUNNING), false);

	/*
	 * THE AFFORDANCE NEVER PROMISES A GUARANTEED STOP: it is called "Stop", and
	 * the queued frame's hint is the only one that says the press is final.
	 */
	assert.equal(queuedFrame.includes(">Stop<"), true);
	assert.equal(
		queuedFrame.includes("Stops before the provider is called."),
		true,
	);
	assert.equal(runningFrame.includes(">Stop<"), true);
	assert.equal(
		runningFrame.includes("Requests a stop; the provider may finish anyway."),
		true,
	);
	assert.equal(
		runningFrame.includes("Stops before the provider is called."),
		false,
	);
});

/*
 * THE RATE-LIMITED STATE (sound phase, 2026-10-17). `audio_rate_limited` is a
 * retryable error whose reader sentence the server authors; the card renders
 * the tool result's message when it has one and the fixed copy when only the
 * type survives — never a control that promises the next call will succeed.
 */
test("a rate-limited call states the server's sentence, preferring the result's own text", () => {
	const onlyType = imageGenCardView(
		tool({
			toolName: "generate_sound_effect",
			isError: true,
			output: null,
			details: canonical({ error_type: "audio_rate_limited" }),
		}),
	);
	assert.equal(onlyType.state, "failed");
	assert.equal(onlyType.errorType, "Audio rate limited");
	assert.equal(
		onlyType.message,
		"Audio generation is busy right now. Wait a moment and try again.",
	);

	// A result that stated its own sentence WINS over the type's fixed copy.
	const withResult = imageGenCardView(
		tool({
			toolName: "generate_sound_effect",
			isError: true,
			output: "the provider's own words",
			details: canonical({ error_type: "audio_rate_limited" }),
		}),
	);
	assert.equal(withResult.message, "the provider's own words");

	const markup = markupOf(onlyType);
	assert.equal(
		markup.includes(
			"Audio generation is busy right now. Wait a moment and try again.",
		),
		true,
	);
	// The card's own failure line: no retry control unless a mount wires one,
	// and no promise about the next call.
	assert.equal(markup.includes(">Stop<"), false);
	assert.equal(markup.includes(">Retry<"), false);
});

test("sound receipts retain billed/estimated provenance and never turn quotes into charges", () => {
	for (const [amount, basis] of [
		[0.002, "billed"],
		[0.001, "estimated"],
		[0.0216, "billed"],
	]) {
		const view = imageGenCardView(
			tool({
				toolName: "generate_sound_effect",
				details: { cost_usd: amount, billing_basis: basis },
			}),
		);
		assert.equal(
			view.costCaption,
			`Cost $${Number(amount.toFixed(4))} (${basis}).`,
		);
	}
	for (const details of [
		{ cost_usd: null, billing_basis: "billed" },
		{ cost_usd: 0.0216, billing_basis: "quote" },
		{ cost_usd: 0.002 },
	]) {
		assert.equal(imageGenCardView(tool({ details })).costCaption, null);
	}
	const pending = imageGenCardView(
		tool({
			stopped: true,
			toolName: "generate_voiceover",
			details: { settled: null, cost_usd: null, cost: { basis: "quote" } },
		}),
	);
	assert.equal(
		pending.settlementCaption,
		"Settlement pending — the final charge will appear once the provider reports it.",
	);
	/*
	 * SUB-CENT CHARGES (review round 2, MINOR): four decimals is the receipt's
	 * precision, and trimming it is what keeps `$0.002` from reading as
	 * `$0.0020`. An amount below half a unit of that precision must therefore
	 * state the BOUND instead of rounding to `$0`: a charged call printing as an
	 * uncharged one is the one thing this receipt line exists to prevent.
	 */
	const subCent = (cost_usd) =>
		imageGenCardView(
			tool({
				toolName: "generate_voiceover",
				details: { cost_usd, billing_basis: "billed" },
			}),
		).costCaption;
	assert.equal(subCent(0.00004), "Cost <$0.0001 (billed).");
	assert.equal(subCent(0.000049), "Cost <$0.0001 (billed).");
	assert.equal(subCent(0.00005), "Cost $0.0001 (billed).");
	assert.equal(subCent(0), "Cost $0 (billed).");
});

test("audio result details survive reducer retention and settlement revisions", () => {
	const billed = { cost_usd: 0.002, billing_basis: "billed" };
	assert.equal(preferProgressDetails(billed, null), billed);
	assert.equal(preferProgressDetails({ ...billed }, billed), billed);
	const estimated = { ...billed, billing_basis: "estimated" };
	assert.equal(preferProgressDetails(estimated, billed), estimated);
	const revised = { ...billed, cost_usd: 0.0216 };
	assert.equal(preferProgressDetails(revised, billed), revised);
	const pending = { settled: null, cost_usd: null, cost: { basis: "quote" } };
	assert.equal(preferProgressDetails(pending, billed), pending);
	assert.equal(
		preferProgressDetails(structuredClone(pending), pending),
		pending,
	);
	assert.equal(preferProgressDetails(null, pending), pending);
	const settled = {
		...pending,
		settled: true,
		cost_usd: 0.0216,
		billing_basis: "billed",
		cost: { basis: "billed" },
	};
	assert.equal(preferProgressDetails(settled, pending), settled);
});

test("the sound card shows result costs and the agent's refusal class above its exact body", () => {
	const billed = imageGenCardView(
		tool({
			toolName: "generate_voiceover",
			details: { cost_usd: 0.002, billing_basis: "billed" },
		}),
	);
	assert.ok(markupOf(billed).includes("Cost $0.002 (billed)."));
	const old = imageGenCardView(
		tool({
			toolName: "generate_voiceover",
			output: "Generated audio. Cost $0.002 (billed).",
		}),
	);
	assert.equal(old.costCaption, "Cost $0.002 (billed).");
	const body =
		'{"code":"audio_rejected","error":"This audio request could not be accepted."}';
	const refusal = imageGenCardView(
		tool({
			toolName: "generate_voiceover",
			notRunKind: "invalid_arguments",
			notRunReason: body,
		}),
	);
	const html = markupOf(refusal);
	assert.ok(html.indexOf("Invalid arguments") < html.indexOf("audio_rejected"));
	assert.equal(refusal.message, body);
});

test("a running sound stop warns before invoking the real action handler", async () => {
	const { JSDOM } = await import("jsdom");
	const { createRoot } = await import("react-dom/client");
	const { act } = await import("react");
	const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
	const previous = {
		window: globalThis.window,
		document: globalThis.document,
		HTMLElement: globalThis.HTMLElement,
	};
	Object.assign(globalThis, {
		window: dom.window,
		document: dom.window.document,
		HTMLElement: dom.window.HTMLElement,
		IS_REACT_ACT_ENVIRONMENT: true,
	});
	const root = createRoot(dom.window.document.getElementById("root"));
	let calls = 0;
	const view = imageGenCardView(
		tool({
			toolName: "generate_voiceover",
			phase: "running",
			startedAt: Date.now(),
		}),
	);
	try {
		await act(async () =>
			root.render(
				h(ImageGenCard, {
					view,
					scope: null,
					actions: { onCancel: () => calls++ },
				}),
			),
		);
		const press = async (label) => {
			const button = [...dom.window.document.querySelectorAll("button")].find(
				(b) => b.textContent === label,
			);
			assert.ok(button, `button ${label} exists`);
			await act(async () => button.click());
		};
		await press("Stop");
		assert.equal(calls, 0);
		assert.equal(dom.window.document.activeElement.textContent, "Keep waiting");
		assert.equal(
			dom.window.document.querySelector("[aria-live=polite]").textContent,
			"Stop this generation?",
		);
		assert.ok(
			dom.window.document.body.textContent.includes(
				"The provider has no cancellation endpoint. The generation continues and will be charged if it produces audio.",
			),
		);
		await act(async () =>
			dom.window.document.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			),
		);
		assert.equal(calls, 0);
		assert.equal(dom.window.document.activeElement.textContent, "Stop");
		await press("Stop");
		await press("Keep waiting");
		assert.equal(dom.window.document.activeElement.textContent, "Stop");
		assert.equal(calls, 0);
		await press("Stop");
		await press("Request stop");
		assert.equal(calls, 1);
	} finally {
		await act(async () => root.unmount());
		dom.window.close();
		Object.assign(globalThis, previous);
		globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
	}
});

test("sound failure labels are human, scoped, and do not repeat a sentence opening", () => {
	for (const toolName of ["generate_image", "generate_video"]) {
		const view = imageGenCardView(
			tool({
				toolName,
				isError: true,
				details: {
					error_type: "insufficient_credits",
					error: "out of credits",
				},
			}),
		);
		assert.equal(view.errorType, null);
		assert.equal(
			markupOf({ ...view, errorType: "insufficient_credits" }).includes(
				"insufficient_credits",
			),
			false,
		);
		const done = imageGenCardView(
			tool({
				toolName,
				output: "Cost $0.002 (billed).",
				details: { cost_usd: 0.002, billing_basis: "billed" },
			}),
		);
		assert.equal(done.costCaption, null);
	}
	const view = imageGenCardView(
		tool({
			toolName: "generate_voiceover",
			isError: true,
			details: {
				error_type: "invalid_arguments",
				error: "Invalid arguments: duration is required.",
			},
		}),
	);
	assert.equal(view.errorType, null);
	assert.equal(view.message, "Invalid arguments: duration is required.");
});

test("cancelled sound receipts retain explicit pending and completed billing facts", () => {
	// Canonical #2588 cancel fields and the completed observer's billed fields:
	// these are contract fixtures, not a claim that a provider was called here.
	const cancelled = {
		settled: null,
		cost_usd: null,
		cost: {
			v: 1,
			amount_usd: 0.0216,
			basis: "quote",
			units: 540,
			unit: "char",
			unit_price_usd: 4e-5,
			provider: "radient",
			model: "radient/voiceover-flash",
			tool_type: "speech_generation",
			usage_record_id: "fixture-audio-usage",
			price_version: "audio-rates@2026-10-17",
		},
		cancellation: {
			requested: true,
			vendor_stopped: false,
			reason: "provider_has_no_cancel_api",
			detail:
				"The provider has no cancellation endpoint. The generation continues and will be charged if it produces audio.",
		},
		note: "Cancellation is best-effort: the request settles at its terminal outcome. A completed generation is charged normally.",
	};
	const record = tool({
		toolName: "generate_voiceover",
		stopped: true,
		details: cancelled,
	});
	assert.ok(
		imageGenCardView(record).settlementCaption.startsWith("Settlement pending"),
	);
	const settled = imageGenCardView({
		...record,
		details: { settled: true, cost_usd: 0.0021, billing_basis: "billed" },
	});
	assert.equal(settled.settlementCaption, "Cost $0.0021 (billed).");
	assert.ok(markupOf(settled).includes("Cost $0.0021 (billed)."));
	/*
	 * ONE FACT, ONE ROW (design D7, UX U8/U9). The settlement row below the line
	 * IS the answer to "Checking for settlement", so keeping the clause above it
	 * repeats the fact in the pending state and contradicts it once billed. Both
	 * arms retire the clause; the rest of the sentence is untouched.
	 */
	assert.equal(
		markupOf(imageGenCardView(record)).includes("Checking for settlement"),
		false,
	);
	assert.ok(markupOf(imageGenCardView(record)).includes("Settlement pending"));
	assert.equal(markupOf(settled).includes("Checking for settlement"), false);
	/*
	 * THE SAME RETIREMENT WHEN THE SETTLEMENT IS ITS OWN ROW: a terminal
	 * `audio_settle_v1` journal row follows the call instead of amending its
	 * details, which is how the harness actually delivers this state. The
	 * transcript links the row to the call by order and passes `settled`; the
	 * call's line must then stop asking, without printing a second receipt.
	 */
	const settledElsewhere = imageGenCardView(
		tool({
			toolName: "generate_voiceover",
			stopped: true,
			startedAt: 1_760_000_000_000,
			output: "Stop requested. Checking for settlement.",
		}),
		{ settled: true },
	);
	assert.equal(settledElsewhere.settled, true);
	const settledElsewhereMarkup = markupOf(settledElsewhere);
	assert.ok(settledElsewhereMarkup.includes("Stop requested."));
	assert.equal(
		settledElsewhereMarkup.includes("Checking for settlement"),
		false,
	);
	assert.equal(settledElsewhereMarkup.includes("Cost $"), false);
	for (const details of [
		{ settled: true, cost_usd: null, billing_basis: "billed" },
		{ settled: null, cost_usd: null },
		{ settled: null, cost_usd: 0.2, cost: { basis: "quote" } },
	])
		assert.equal(
			imageGenCardView({ ...record, details }).settlementCaption,
			undefined,
		);
});

test("pane Stop and the production Escape accelerator share sound charge admission", async () => {
	const { JSDOM } = await import("jsdom");
	const { createRoot } = await import("react-dom/client");
	const { act } = await import("react");
	const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
	const previous = {
		window: globalThis.window,
		document: globalThis.document,
		HTMLElement: globalThis.HTMLElement,
		IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
	};
	Object.assign(globalThis, {
		window: dom.window,
		document: dom.window.document,
		HTMLElement: dom.window.HTMLElement,
		IS_REACT_ACT_ENVIRONMENT: true,
	});
	const root = createRoot(document.getElementById("root"));
	let calls = 0;
	const dispatch = () => calls++;
	const restore = () => document.querySelector("textarea").focus();
	const Pane = ({
		sound = true,
		available = true,
		sessionId = "[redacted]-sound-pane",
	}) => {
		const { paneRef, stop, confirmation } = useSoundStopGate({
			sessionId,
			runningSound: sound,
			available,
			onInterrupt: dispatch,
			onRestoreFocus: restore,
		});
		useInterruptOnEscape({
			sessionId,
			turnAlive: true,
			available,
			onInterrupt: stop,
		});
		return h(
			"div",
			{ ref: paneRef, "data-chat-pane": "" },
			sound
				? h(ImageGenCard, {
						scope: null,
						view: imageGenCardView(
							tool({
								toolName: "generate_voiceover",
								phase: "running",
								startedAt: Date.now(),
							}),
						),
						actions: { onCancel: dispatch },
					})
				: null,
			confirmation,
			h("textarea"),
			h("button", { type: "button", onClick: stop }, "Pane stop"),
		);
	};
	const press = async (label) => {
		const button = [...document.querySelectorAll("button")].find(
			(b) => b.textContent === label,
		);
		assert.ok(button);
		await act(async () => button.click());
	};
	const pressEscape = async () => {
		await act(async () =>
			document.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			),
		);
	};
	try {
		await act(async () => root.render(h(Pane)));
		await press("Stop");
		await press("Pane stop");
		assert.equal(document.querySelectorAll("fieldset").length, 1);
		assert.equal(calls, 0);
		await pressEscape();
		assert.equal(document.activeElement.textContent, "Stop");
		await press("Pane stop");
		await press("Stop");
		assert.equal(document.querySelectorAll("fieldset").length, 1);
		assert.equal(calls, 0);
		await pressEscape();
		await press("Pane stop");
		assert.equal(calls, 0);
		assert.equal(document.activeElement.textContent, "Keep waiting");
		await press("Pane stop");
		assert.equal(document.querySelectorAll("fieldset").length, 1);
		assert.equal(calls, 0);
		await pressEscape();
		assert.equal(calls, 0);
		assert.equal(document.activeElement.tagName, "TEXTAREA");
		assert.equal(document.querySelector("fieldset"), null);
		await pressEscape();
		assert.equal(calls, 0);
		assert.ok(document.querySelector("fieldset"));
		await pressEscape();
		assert.equal(calls, 0);
		assert.equal(document.querySelector("fieldset"), null);
		await press("Pane stop");
		await press("Keep waiting");
		assert.equal(calls, 0);
		await press("Pane stop");
		await press("Request stop");
		assert.equal(calls, 1);
		/*
		 * THE QUESTION'S SUBJECT SETTLED UNDER IT (review round 2, NIT): the safe
		 * choice that holds focus unmounts with the open question, so the gate must
		 * restore the composer rather than leave the keyboard on `<body>`.
		 */
		await press("Pane stop");
		assert.ok(document.querySelector("fieldset"));
		await act(async () => root.render(h(Pane, { sound: false })));
		assert.equal(document.querySelector("fieldset"), null);
		assert.equal(
			document.activeElement.tagName,
			"TEXTAREA",
			"a sound call settling mid-question restores the pane composer",
		);
		assert.equal(calls, 1);
		await act(async () => root.render(h(Pane)));
		await press("Stop");
		await act(async () => root.render(h(Pane, { sound: false })));
		assert.equal(
			document.activeElement.tagName,
			"TEXTAREA",
			"removing a confirming card restores its own pane composer",
		);
		await press("Pane stop");
		assert.equal(calls, 2, "ordinary turn interrupt remains immediate");
		await pressEscape();
		assert.equal(calls, 3);
		await act(async () =>
			root.render(h(Pane, { sound: true, available: false })),
		);
		await press("Pane stop");
		await pressEscape();
		assert.equal(calls, 3, "capability denial remains authoritative");
	} finally {
		await act(async () => root.unmount());
		dom.window.close();
		Object.assign(globalThis, previous);
	}
});

/** Same attachment refs as the canonical reducer, deliberately reverse ordered. */
const batchFixture = (count, failed = -1) => {
	const artifacts = Array.from({ length: count }, (_, index) => ({
		name: index < 2 ? "Rain on glass" : `Sound ${index + 1}`,
		digest: index === failed ? null : `batch-${index}`,
		path: index === failed ? null : `/fixture/sound-${index}.wav`,
		duration_s: 2 + index,
		format: "wav",
		cost_usd: index === failed ? 0 : (index + 1) / 1000,
		cost: {
			amount_usd: index === failed ? 0 : (index + 1) / 1000,
			basis: index % 2 ? "estimated" : "billed",
		},
		status: index === failed ? "failed" : "completed",
		request_id: `fixture-${index}`,
		error:
			index === failed
				? "audio_rejected: server returned 400 — invalid duration"
				: null,
	}));
	const images = artifacts
		.flatMap((item) =>
			item.error
				? []
				: [
						{
							id: item.digest,
							attachment: item.digest,
							kind: "audio",
							data: "AAAA",
							mimeType: "audio/wav",
							durationS: item.duration_s,
							name: item.name,
						},
					],
		)
		.reverse();
	return { artifacts, images };
};

test("batch receipts preserve duplicate names, attachment identity and billing basis", () => {
	const { artifacts, images } = batchFixture(4, 1);
	const items = soundBatchItems({ artifacts, cost_complete: true }, images);
	assert.equal(items.length, 4);
	assert.deepEqual(
		items.map((item) => item.label),
		["Rain on glass", "Rain on glass (2)", "Sound 3", "Sound 4"],
	);
	assert.equal(
		items[1].name,
		"Rain on glass",
		"backend identity remains verbatim",
	);
	assert.equal(items[0].audio, images[2], "match digest, not completion order");
	assert.equal(items[1].audio, null);
	assert.ok(
		items[1].error.includes("audio_rejected") && items[1].error.includes("400"),
	);
	assert.equal(items[0].costCaption, "Cost $0.001 (billed).");
	assert.equal(items[3].costCaption, "Cost $0.004 (estimated).");
});

test("batch adapter leaves absent, malformed and single-result receipts on the approved path", () => {
	const { artifacts, images } = batchFixture(1);
	for (const details of [null, {}, { artifacts }, { artifacts: [null, {}] }]) {
		assert.equal(soundBatchItems(details, images), null);
	}
});

test("4, 5 and 10 item batches render the existing players and honest partial failures", () => {
	for (const count of [4, 5, 10]) {
		const { artifacts, images } = batchFixture(count, count === 4 ? 1 : -1);
		const view = imageGenCardView(
			tool({
				toolName: "generate_sound_effect",
				details: {
					artifacts,
					cost_usd: 0.008,
					cost: { basis: "billed" },
					cost_complete: true,
				},
				images,
			}),
		);
		const html = markupOf(view);
		assert.equal(html.split("data-sound-batch-item=").length - 1, count);
		assert.equal(html.split("data-sound-player=").length - 1, images.length);
		assert.ok(html.includes("Rain on glass (2)"));
		assert.ok(html.includes("Total cost $0.008 (billed)"));
		assert.ok(html.includes("Cost $0.003 (billed)"));
		if (count === 4) {
			assert.ok(html.includes("3 completed · 1 failed"));
			assert.ok(html.includes("audio_rejected: server returned 400"));
		}
	}
});

test("batch detail carrier accepts receipts and preserves equal replay identity without hiding edits", () => {
	const details = { artifacts: batchFixture(4, 1).artifacts };
	assert.equal(preferProgressDetails(details, null), details);
	assert.equal(
		preferProgressDetails(structuredClone(details), details),
		details,
	);
	for (const [field, changed] of [
		["name", "New name"],
		["error", "audio_rejected: new server reason"],
		["cost_usd", 0.25],
		["digest", "another-digest"],
	]) {
		const next = structuredClone(details);
		next.artifacts[0][field] = changed;
		assert.equal(
			preferProgressDetails(next, details),
			next,
			`${field} must invalidate the receipt`,
		);
	}
});

test("byte-identical named requests retain separate rows, players and costs", () => {
	const { artifacts, images } = batchFixture(2);
	artifacts[1].name = "Different request, identical bytes";
	artifacts[1].digest = artifacts[0].digest;
	artifacts[1].request_id = artifacts[0].request_id;
	const items = soundBatchItems({ artifacts, cost_complete: true }, [
		images[1],
	]);
	assert.equal(items.length, 2);
	assert.equal(items[0].audio, items[1].audio);
	assert.notEqual(items[0].id, items[1].id);
	assert.equal(items[1].name, "Different request, identical bytes");
	const html = markupOf(
		imageGenCardView(
			tool({
				toolName: "generate_sound_effect",
				details: { artifacts, cost_complete: true },
				images: [images[1]],
			}),
		),
	);
	assert.equal(html.split("data-sound-player=").length - 1, 2);
	assert.ok(html.includes("Cost $0.001 (billed)."));
	assert.ok(html.includes("Cost $0.002 (estimated)."));
});

test("all-failed batch retains its failed state and every server reason", () => {
	const { artifacts } = batchFixture(4);
	for (const item of artifacts) {
		item.error = "audio_rejected: server 400";
		item.status = "failed";
		item.cost_usd = null;
		item.cost = { amount_usd: null, basis: "quote" };
	}
	const view = imageGenCardView(
		tool({
			toolName: "generate_sound_effect",
			isError: true,
			details: {
				artifacts,
				cost_usd: null,
				cost_complete: false,
				cost: { basis: "estimated" },
			},
		}),
	);
	assert.equal(view.state, "failed");
	const html = markupOf(view);
	assert.equal(html.split("data-sound-batch-item=").length - 1, 4);
	assert.equal(html.split("data-sound-player=").length - 1, 0);
	assert.ok(html.includes("0 completed · 4 failed"));
	assert.ok(html.includes("Total cost not yet known."));
});

test("incomplete cost is labelled a known subtotal and never a final charge", () => {
	const { artifacts, images } = batchFixture(4, 1);
	const view = imageGenCardView(
		tool({
			toolName: "generate_sound_effect",
			details: {
				artifacts,
				cost_usd: 0.008,
				cost: { basis: "estimated" },
				cost_complete: false,
			},
			images,
		}),
	);
	assert.equal(
		view.costCaption,
		"Known total cost $0.008 (estimated). Unknown or late charges are not included.",
	);
	const updated = structuredClone({ artifacts });
	updated.artifacts[0].cost.basis = "estimated";
	const previous = { artifacts };
	assert.equal(preferProgressDetails(updated, previous), updated);
	assert.equal(
		preferProgressDetails(structuredClone(previous), previous),
		previous,
	);
});

test("stopped batches retain successes, cancelled items and known subtotal warnings", () => {
	const { artifacts, images } = batchFixture(4, 1);
	artifacts[1].status = "cancelled";
	artifacts[1].error = "Stop requested; provider outcome unknown";
	artifacts[1].cost_usd = null;
	artifacts[1].cost = { basis: "quote" };
	const view = imageGenCardView(
		tool({
			toolName: "generate_sound_effect",
			stopped: true,
			details: {
				artifacts,
				cost_usd: 0.008,
				cost: { basis: "estimated" },
				cost_complete: false,
			},
			images,
		}),
	);
	assert.equal(view.state, "cancelled");
	const html = markupOf(view);
	assert.equal(html.split("data-sound-player=").length - 1, 3);
	assert.ok(html.includes("1 cancelled/stopped"));
	assert.ok(html.includes("Unknown or late charges are not included."));
});

test("duplicate display suffixes never steal a literal backend name", () => {
	const { artifacts, images } = batchFixture(4);
	artifacts[0].name = "Rain";
	artifacts[1].name = "Rain";
	artifacts[2].name = "Rain (2)";
	const items = soundBatchItems({ artifacts, cost_complete: true }, images);
	assert.equal(new Set(items.map((item) => item.label)).size, 4);
	assert.equal(items[2].label, "Rain (2)");
});

test("one-item batch keeps its name and nested cost without changing legacy singles", () => {
	const { artifacts, images } = batchFixture(1);
	const batch = imageGenCardView(
		tool({
			toolName: "generate_sound_effect",
			details: {
				artifacts,
				completed: 1,
				failed: 0,
				cancelled: 0,
				cost_complete: true,
				cost_usd: 0.001,
				cost: { basis: "billed" },
			},
			images,
		}),
	);
	assert.equal(batch.batch.length, 1);
	const html = markupOf(batch);
	assert.ok(html.includes("Rain on glass"));
	assert.ok(html.includes("Total cost $0.001 (billed)."));
	assert.ok(html.includes("Cost $0.001 (billed)."));
	assert.equal(html.split("data-sound-player=").length - 1, 1);
	const legacy = imageGenCardView(
		tool({
			toolName: "generate_sound_effect",
			details: { artifacts, cost_usd: 0.001, billing_basis: "billed" },
			images,
		}),
	);
	assert.equal(legacy.batch, null);
	assert.equal(legacy.costCaption, "Cost $0.001 (billed).");
});

test("batch summary uses server counters and attention names, never fabricates completion", () => {
	const { artifacts, images } = batchFixture(4, 1);
	artifacts[2].status = "future_status";
	const view = imageGenCardView(
		tool({
			toolName: "generate_sound_effect",
			details: {
				artifacts,
				completed: 2,
				failed: 1,
				cancelled: 0,
				cost_complete: false,
			},
			images,
		}),
	);
	assert.equal(view.batch[2].status, "unknown");
	assert.equal(
		view.batchSummary,
		"2 completed · 1 failed · 1 status unknown. Needs attention: Rain on glass (2); Sound 3",
	);
	const html = markupOf(view);
	assert.ok(html.includes("Rain on glass (2) · Failed"));
	assert.ok(html.includes("Status unknown"));
	assert.ok(
		!view.batchSummary.includes("Sound 4"),
		"completed names stay in their rows, not the index",
	);
	const next = {
		artifacts,
		completed: 3,
		failed: 1,
		cancelled: 0,
		cost_complete: false,
	};
	const previous = { ...next, completed: 2 };
	assert.equal(preferProgressDetails(next, previous), next);
});

test("batch cause and class survive failed and stopped receipt presentation", () => {
	const { artifacts } = batchFixture(2, 0);
	const view = imageGenCardView(
		tool({
			toolName: "generate_sound_effect",
			isError: true,
			output:
				"Sound effects: 0 completed. Batch time budget reached. In-flight stop is best-effort.\n1/2 Rain: failed",
			details: {
				artifacts,
				cost_complete: false,
				error_type: "audio_rejected",
			},
		}),
	);
	assert.equal(view.errorType, "Audio rejected");
	assert.ok(view.message.includes("Batch time budget reached"));
	assert.equal(
		view.batchNote,
		"Batch time budget reached. In-flight stop is best-effort.",
	);
	const html = markupOf(view);
	assert.ok(html.includes("Audio rejected"));
	assert.ok(html.includes("Batch time budget reached"));
});

test("batch failure zero is not presented as an estimated charge", () => {
	const { artifacts } = batchFixture(2, 0);
	artifacts[0].cost.basis = "estimated";
	let items = soundBatchItems({ artifacts, cost_complete: true }, []);
	assert.equal(
		items[0].costCaption,
		"Estimated cost $0; final charge not confirmed.",
	);
	artifacts[0].cost.basis = "billed";
	items = soundBatchItems({ artifacts, cost_complete: true }, []);
	assert.equal(items[0].costCaption, "No charge.");
});

test("running batch states request count and latest item without inventing completion", () => {
	const details = { item: 3, total: 10, name: "Rain" };
	assert.equal(preferProgressDetails(details, null), details);
	const view = imageGenCardView(
		tool({ toolName: "generate_sound_effect", phase: "running", details }),
	);
	const html = markupOf(view);
	assert.ok(html.includes("Generating 10 sound effects…"));
	assert.ok(html.includes("Latest update: Rain (item 3 of 10)."));
	assert.ok(!html.includes("3 of 10 done"));
	const requested = imageGenCardView(
		tool({
			toolName: "generate_sound_effect",
			phase: "running",
			args: { sounds: [{ name: "Rain" }] },
		}),
	);
	assert.ok(markupOf(requested).includes("Generating 1 sound effect…"));
});

test("shared digest rows own separate transport controls and keyboard state", async () => {
	const { JSDOM } = await import("jsdom");
	const { createRoot } = await import("react-dom/client");
	const { act } = await import("react");
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	const keys = [
		"window",
		"document",
		"HTMLElement",
		"HTMLCanvasElement",
		"ResizeObserver",
		"Audio",
		"IS_REACT_ACT_ENVIRONMENT",
		"requestAnimationFrame",
		"cancelAnimationFrame",
	];
	const previous = Object.fromEntries(
		keys.map((key) => [key, globalThis[key]]),
	);
	class SilentAudio {
		currentTime = 0;
		duration = 3;
		src = "";
		volume = 1;
		playbackRate = 1;
		play() {
			return Promise.resolve();
		}
		pause() {}
		load() {}
		removeAttribute() {}
	}
	const frames = new Map();
	let nextFrame = 0;
	// JSDOM has no geometry; keep observation inert, as the player suite does.
	class SilentResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	globalThis.Audio = SilentAudio;
	Object.assign(globalThis, {
		window: dom.window,
		document: dom.window.document,
		HTMLElement: dom.window.HTMLElement,
		HTMLCanvasElement: dom.window.HTMLCanvasElement,
		ResizeObserver: SilentResizeObserver,
		IS_REACT_ACT_ENVIRONMENT: true,
		requestAnimationFrame: (callback) => {
			const id = ++nextFrame;
			frames.set(id, callback);
			return id;
		},
		cancelAnimationFrame: (id) => frames.delete(id),
	});
	dom.window.HTMLCanvasElement.prototype.getContext = () => null;
	const root = createRoot(dom.window.document.querySelector("#root"));
	try {
		const { artifacts, images } = batchFixture(2);
		artifacts[1].digest = artifacts[0].digest;
		const view = imageGenCardView(
			tool({
				toolName: "generate_sound_effect",
				details: { artifacts, cost_complete: true },
				images: [images[1]],
			}),
		);
		await act(async () => root.render(h(ImageGenCard, { view, scope: null })));
		const rows = [
			...dom.window.document.querySelectorAll("[data-sound-batch-item]"),
		];
		const statuses = () =>
			rows.map((row) =>
				row
					.querySelector("[data-sound-player]")
					.getAttribute("data-sound-status"),
			);
		await act(async () => rows[0].querySelector("button").click());
		assert.deepEqual(statuses(), ["playing", "idle"]);
		await act(async () => {
			useAudioEngineStore.getState().element.currentTime = 2;
			const pending = [...frames.values()];
			frames.clear();
			for (const callback of pending) callback(0);
		});
		assert.equal(
			rows[0].querySelector("[role=slider]").getAttribute("aria-valuenow"),
			"2",
		);
		assert.equal(
			rows[1].querySelector("[role=slider]").getAttribute("aria-valuenow"),
			"0",
		);
		await act(async () => rows[1].querySelector("button").click());
		assert.deepEqual(
			statuses(),
			["idle", "playing"],
			"second press starts its own row, not pause the sibling",
		);
		await act(async () =>
			rows[1]
				.querySelector("[role=slider]")
				.dispatchEvent(
					new dom.window.KeyboardEvent("keydown", { key: " ", bubbles: true }),
				),
		);
		assert.deepEqual(statuses(), ["idle", "paused"]);
		assert.equal(
			dom.window.document.querySelectorAll("ul > li[data-sound-batch-item]")
				.length,
			2,
		);
	} finally {
		await act(async () => {
			useAudioEngineStore.getState().stop();
			root.unmount();
		});
		useAudioEngineStore.setState({ element: null });
		dom.window.close();
		Object.assign(globalThis, previous);
	}
});

test("batch title follows its material rather than assuming sound effects", () => {
	const { artifacts, images } = batchFixture(2);
	const view = imageGenCardView(
		tool({
			toolName: "generate_voiceover",
			details: { artifacts, cost_complete: true },
			images,
		}),
	);
	const html = markupOf(view);
	assert.ok(html.includes("Voiceover batch"));
	assert.ok(!html.includes("Sound effect batch"));
});

/*
 * THE SOUND GENERATION'S SEAT (operator requirement, 2026-10-23). A voiceover
 * or sound effect used to wait behind the image card's 240x160 rectangle and
 * shimmer; a sound waits on a WAVEFORM built from the player's own recipe
 * (`BAR_WIDTH` 4, 2px gaps, 2px radius), so the loader and the clip it becomes
 * read as one object. The four states are the card's own and must differ:
 * queued (static, disabled ink), running (pulsing, muted ink), failed (the
 * band collapsed to its base line), stopped (at rest, muted ink) - and only
 * the running one animates, because no vendor exposes a sound's progress.
 */
test("a sound generation waits on a waveform, never on the image rectangle", () => {
	const running = markupOf({
		state: "running",
		material: "voiceover",
		startedAtMs: 3,
		progress: NO_PROGRESS,
	});
	assert.ok(
		running.includes('data-sound-loading="running"'),
		"the running sound card carries the waveform tile",
	);
	assert.equal(
		running.includes("data-imagegen-tile"),
		false,
		"the image rectangle is not the sound's loader",
	);
	// INDETERMINATE: no fraction was carried, so no progressbar and no fill.
	assert.equal(running.includes('role="progressbar"'), false);
	// The player's recipe: a 4px bar and a 2px pitch, not an ad-hoc shape.
	assert.ok(running.includes("width:4px"), "bars use the player's BAR_WIDTH");
	assert.ok(
		running.includes("margin-right:2px"),
		"bars use the player's BAR_GAP",
	);
	assert.ok(
		running.includes("animation-delay"),
		"the pulse is a travelling wave",
	);
	// N2 (round 1): the band is the compact player's own 44px box, so the card
	// does not shrink when the sound settles.
	assert.ok(
		running.includes("height: 44px") || running.includes("height:44px"),
		"the loader is the player's height, not 12px taller",
	);

	const queued = markupOf({
		state: "queued",
		material: "sound-effect",
		progress: NO_PROGRESS,
	});
	assert.ok(queued.includes('data-sound-loading="queued"'));
	assert.equal(
		queued.includes("animation-delay"),
		false,
		"queued is at rest: the provider has not been asked yet",
	);
	assert.notEqual(queued, running, "queued must not look like running");
	// Through the REAL model: a queued voiceover call carries its material, so
	// the queued seat is reachable from the wire's own record, not only from a
	// hand-built view.
	const queuedView = imageGenCardView(
		tool({ toolName: "generate_voiceover", phase: "queued" }),
	);
	assert.equal(queuedView.material, "voiceover");
	assert.ok(markupOf(queuedView).includes('data-sound-loading="queued"'));

	const failed = markupOf({
		state: "failed",
		material: "sound-effect",
		generating: true,
		message: "The sound effect could not be generated.",
		errorType: null,
		progress: NO_PROGRESS,
	});
	assert.ok(failed.includes('data-sound-loading="failed"'));
	assert.ok(
		failed.includes("height:4px"),
		"a failure produced no shape: the band is its base line",
	);

	const stopped = markupOf({
		state: "cancelled",
		material: "sound-effect",
		generating: true,
		message: "Stopped by the operator.",
		progress: NO_PROGRESS,
	});
	assert.ok(stopped.includes('data-sound-loading="stopped"'));
	/*
	 * N1 (round 1): a reduced-motion reader gets the running band parked (the
	 * CSS cap lands on its end keyframe), so RUNNING and STOPPED must differ in
	 * more than motion. They do, by ink: muted vs dim.
	 */
	assert.ok(
		running.includes("bg-ink-muted") && stopped.includes("bg-ink-dim"),
		"the parked running frame and the stopped frame differ by ink",
	);
	assert.ok(
		stopped.includes(
			"provider has no cancellation endpoint; the generation continues and will be charged if it produces audio",
		),
		"the stop receipt's billing sentence is in the card, not only the transcript",
	);
	// And a plain cancelled sound states it ONCE: the receipt must not repeat
	// the state line it already sits under.
	const plain = markupOf({
		state: "cancelled",
		material: "sound-effect",
		generating: true,
		message: null,
		progress: NO_PROGRESS,
	});
	assert.equal(
		(plain.match(/no cancellation endpoint/g) ?? []).length,
		1,
		"the plain cancelled line is the receipt; no duplicate note",
	);
});

test("images and videos keep the rectangular generating tile", () => {
	for (const material of ["image", "video"]) {
		const markup = markupOf({
			state: "running",
			material,
			startedAtMs: 3,
			progress: NO_PROGRESS,
		});
		assert.ok(
			markup.includes("data-imagegen-tile"),
			`${material} keeps the 3:2 rectangle`,
		);
		assert.equal(
			markup.includes("data-sound-loading"),
			false,
			`${material} is not caught by the audio branch`,
		);
	}
});
