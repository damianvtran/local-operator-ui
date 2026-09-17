import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * WHERE THE CARET GOES WHEN THE PALETTE CLOSES.
 *
 * The reported defect (the operator's A): `Cmd+K` from the composer, pick
 * another conversation, and the keystrokes afterwards reach nothing. Measured,
 * the destination composer focused ITSELF 8-13 ms before the close-time restore
 * took the caret off it and parked it on the rail's Search button, because the
 * node the palette had captured was left behind in the pane the user had just
 * left and the only question the restore asked was "is that node still in the
 * document".
 *
 * The rule that was missing is here as two pure predicates over observations,
 * so the three orderings of the race are a table rather than three browser
 * runs: the restore can run before the pane commits, after it commits with the
 * incoming composer mounted, or after it commits with nothing mounted yet.
 *
 * WHAT IS DELIBERATELY NOT HERE: `handCaretToComposer`. It reads the document,
 * calls the composer's own registered focus hand-off and reports whether the
 * caret landed - all of it DOM - so it is exercised by the renderer driver's
 * palette scenes and by QA's pass on the real app. A stand-in DOM here would
 * assert the stand-in.
 *
 * Bundled from the shipped module with esbuild, in the shape
 * `scripts/palette-panel-request.test.mjs` uses: the predicates are the app's,
 * not a copy of them.
 */
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/composer-caret";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { caretIsUntouched, closeTimeFocusOutcome } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/* ------------------------------------------------------------------ */
/* The outcome table                                                    */
/* ------------------------------------------------------------------ */

test("a close that moved nothing puts the caret back where it was", () => {
	/*
	 * THE CASE THAT MUST NOT REGRESS, and the one the Escape run measured:
	 * `Cmd+K` from the composer, Escape, `previous.focus()` on the same textarea.
	 * No store write happens, so the pane identity is unchanged and the captured
	 * node is still connected and still in the document.
	 */
	assert.equal(
		closeTimeFocusOutcome({
			viewMoved: false,
			capturedUsable: true,
			caretUntouched: true,
		}),
		"captured",
	);
});

test("a view move whose caret nobody has claimed hands it to the composer", () => {
	/*
	 * The ordering where the pane committed first and its composer has not
	 * mounted yet: the store says the view moved, and the caret is still on the
	 * palette's own field (or nowhere). `composer` is the outcome that asks the
	 * composer for the caret and, failing that, falls through to the rail - never
	 * to `document.body`.
	 */
	assert.equal(
		closeTimeFocusOutcome({
			viewMoved: true,
			capturedUsable: false,
			caretUntouched: true,
		}),
		"composer",
	);
});

test("a view move whose incoming composer already has the caret moves nothing", () => {
	/*
	 * THE MEASURED ONE. The pane committed, the incoming composer focused itself
	 * through its own mount effect, and the restore then found a caret that was
	 * not where it left it. `leave` is the fix: the composer keeps what it
	 * already has, and the 8-13 ms steal cannot happen.
	 */
	assert.equal(
		closeTimeFocusOutcome({
			viewMoved: true,
			capturedUsable: false,
			caretUntouched: false,
		}),
		"leave",
	);
});

test("nothing to restore and nobody holding the caret is the rail's door", () => {
	/*
	 * An unmounted rail button as the captured node (the pane it belonged to is
	 * gone) with the caret still on the palette's own field: nothing is
	 * restorable and the caret is unclaimed, so the fallback is the Search row -
	 * the pre-existing behaviour for this shape.
	 */
	assert.equal(
		closeTimeFocusOutcome({
			viewMoved: false,
			capturedUsable: false,
			caretUntouched: true,
		}),
		"trigger",
	);
});

test("a captured node that is still usable wins over a caret someone else took", () => {
	/*
	 * The ORDER of the arms, pinned because it is a claim rather than a
	 * preference: a close that moved nothing keeps the pre-existing restore even
	 * when something else holds the caret, which is what makes "every close that
	 * did not move the view is unchanged" a fact about the shipped rule rather
	 * than a hope. Changing this ordering would silently change every such close
	 * and no browser run in this repository would say so.
	 */
	assert.equal(
		closeTimeFocusOutcome({
			viewMoved: false,
			capturedUsable: true,
			caretUntouched: false,
		}),
		"captured",
	);
});

/* ------------------------------------------------------------------ */
/* "Is the caret still where the palette left it?"                      */
/* ------------------------------------------------------------------ */

test("nothing focused, and the body, both count as untouched", () => {
	const field = {};
	const body = {};
	assert.equal(caretIsUntouched(field, null, body), true);
	assert.equal(
		caretIsUntouched(field, body, body),
		true,
		"the body is where a removed node's focus goes, so it is nobody's",
	);
});

test("the captured field still holding the caret is untouched", () => {
	const field = {};
	assert.equal(caretIsUntouched(field, field, {}), true);
});

test("another field the user moved to is NOT untouched", () => {
	/*
	 * The negative that makes the predicate worth having: during the flow the
	 * user (or a dialog) moved the caret into some other text field, so this
	 * close has no business moving them - and with the view moved, the outcome
	 * is `leave`.
	 */
	const captured = {};
	const elsewhere = {};
	assert.equal(caretIsUntouched(captured, elsewhere, {}), false);
	/*
	 * A `null` captured field is a palette opened with nothing focused: the
	 * caret can only be untouched there by being nowhere, which is why the
	 * `active === null` / body arms are checked before the identity.
	 */
	assert.equal(caretIsUntouched(null, elsewhere, {}), false);
	assert.equal(caretIsUntouched(null, null, {}), true);
});
