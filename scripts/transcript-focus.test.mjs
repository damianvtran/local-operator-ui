/**
 * The transcript blank-space click's rule, as a table (issue #661).
 *
 *     node --test scripts/transcript-focus.test.mjs
 *
 * WHY THIS FILE EXISTS. `canonical-transcript.tsx` drives the rule through the
 * real DOM, but a mounted click can only say FOCUS or NO FOCUS - it cannot say
 * WHICH guard answered, and the guard that answered is the part a later edit
 * moves silently (widening the control selector, dropping the press-time
 * selection read, letting the wheel window drift). The rule is pure
 * (`transcript-focus.ts`, no imports), so every guard is pinned here as its own
 * row, and the two facts that are DOM reads have their readers' contracts
 * pinned beside them.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/transcript-focus";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	TRANSCRIPT_CONTROL_SELECTOR,
	TRANSCRIPT_DRAG_SLOP_PX,
	TRANSCRIPT_MODAL_SELECTOR,
	TRANSCRIPT_WHEEL_GUARD_MS,
	clickTargetIsControl,
	modalIsOpen,
	transcriptClickVerdict,
	wheelWithinGuard,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** All guards clear: the state a click on genuinely blank space is in. */
const blank = {
	controlPress: false,
	modalOpen: false,
	pressHadSelection: false,
	selectionNotCollapsed: false,
	shiftExtends: false,
	dragged: false,
	scrolledRecently: false,
};

test("a click on blank space focuses the composer", () => {
	assert.equal(transcriptClickVerdict(blank), "focus");
});

test("each guard answers by name, one fact at a time", () => {
	assert.equal(
		transcriptClickVerdict({ ...blank, controlPress: true }),
		"control",
	);
	assert.equal(transcriptClickVerdict({ ...blank, modalOpen: true }), "modal");
	assert.equal(
		transcriptClickVerdict({ ...blank, pressHadSelection: true }),
		"selection",
	);
	assert.equal(
		transcriptClickVerdict({ ...blank, selectionNotCollapsed: true }),
		"selection",
	);
	/* A click carrying Shift answers the selection guard even with no selection
	 * readable yet: it IS the extension gesture (design round 2, U1). */
	assert.equal(
		transcriptClickVerdict({ ...blank, shiftExtends: true }),
		"selection",
	);
	assert.equal(transcriptClickVerdict({ ...blank, dragged: true }), "drag");
	assert.equal(
		transcriptClickVerdict({ ...blank, scrolledRecently: true }),
		"scroll",
	);
});

test("the control's own press outranks every other guard", () => {
	/* The order a click on a control-covered selection (or during a scroll)
	 * resolves to: the control's activation was the gesture, whatever else was
	 * true, and a caret moved beside it is the defect this guard names. */
	assert.equal(
		transcriptClickVerdict({
			controlPress: true,
			modalOpen: true,
			pressHadSelection: true,
			selectionNotCollapsed: true,
			shiftExtends: true,
			dragged: true,
			scrolledRecently: true,
		}),
		"control",
	);
});

test("a selection or a drag outranks a scroll, a modal outranks both", () => {
	assert.equal(
		transcriptClickVerdict({
			...blank,
			pressHadSelection: true,
			scrolledRecently: true,
		}),
		"selection",
	);
	assert.equal(
		transcriptClickVerdict({ ...blank, dragged: true, scrolledRecently: true }),
		"drag",
	);
	assert.equal(
		transcriptClickVerdict({
			...blank,
			modalOpen: true,
			pressHadSelection: true,
			dragged: true,
		}),
		"modal",
	);
});

test("the wheel guard is a window around the click, not a lockout", () => {
	assert.equal(TRANSCRIPT_WHEEL_GUARD_MS, 200);
	/* A notch in the same tick, and one just inside the window, suppress. */
	assert.equal(wheelWithinGuard(1_000, 1_000), true);
	assert.equal(
		wheelWithinGuard(1_000, 1_000 + TRANSCRIPT_WHEEL_GUARD_MS - 1),
		true,
	);
	/* The window's edge does not: a deliberate click after the scroll keeps
	 * the caret hand-off. */
	assert.equal(
		wheelWithinGuard(1_000, 1_000 + TRANSCRIPT_WHEEL_GUARD_MS),
		false,
	);
	/* No notch has ever arrived (the component's sentinel): any click passes. */
	assert.equal(wheelWithinGuard(Number.NEGATIVE_INFINITY, 1_000), false);
});

test("the drag slop is the hand's tremor, matching mesh-drag's threshold", () => {
	assert.equal(TRANSCRIPT_DRAG_SLOP_PX, 4);
});

test("the control selector is the vocabulary the rule names", () => {
	assert.equal(TRANSCRIPT_CONTROL_SELECTOR.includes("button"), true);
	assert.equal(TRANSCRIPT_CONTROL_SELECTOR.includes("a"), true);
	assert.equal(TRANSCRIPT_CONTROL_SELECTOR.includes("input"), true);
	assert.equal(TRANSCRIPT_CONTROL_SELECTOR.includes("textarea"), true);
	assert.equal(TRANSCRIPT_CONTROL_SELECTOR.includes('[role="button"]'), true);
	assert.equal(TRANSCRIPT_CONTROL_SELECTOR.includes("[contenteditable]"), true);
});

test("an unreadable target is treated as a control, not as blank space", () => {
	/* The failure direction that costs the reader something is stealing the
	 * caret, so a target whose nature cannot be read vetoes the focus. */
	assert.equal(clickTargetIsControl(null), true);
	assert.equal(clickTargetIsControl(/** @type {EventTarget} */ ({})), true);
	/* A duck-typed `closest`, the shape `keyboard-scopes.ts` uses for the same
	 * reason: this module must stay importable without a DOM. */
	assert.equal(
		clickTargetIsControl({
			closest: (selector) =>
				selector === TRANSCRIPT_CONTROL_SELECTOR ? {} : null,
		}),
		true,
	);
	assert.equal(
		clickTargetIsControl({
			closest: (selector) =>
				selector === TRANSCRIPT_CONTROL_SELECTOR ? null : {},
		}),
		false,
	);
});

test("an open dialog or sheet is read from the DOM, closed ones do not count", () => {
	assert.equal(
		TRANSCRIPT_MODAL_SELECTOR.indexOf('[role="dialog"][data-state="open"]'),
		0,
	);
	/* The reader's contract: `querySelector` decides, and a closed dialog has
	 * no node for it to find. */
	assert.equal(
		modalIsOpen({
			querySelector: (selector) =>
				selector === TRANSCRIPT_MODAL_SELECTOR ? {} : null,
		}),
		true,
	);
	assert.equal(modalIsOpen({ querySelector: () => null }), false);
});
