import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The archive control's repeat-press guard.
 *
 * Why this file exists at all, when the pin's control has no such file: archiving
 * REMOVES the row from the list where pinning MOVES it. A double-click on the
 * reveal - or any second press from a hand that has not moved - therefore lands on
 * whatever row slid up into the vacated slot, with the pointer already inside that
 * row's own reveal, so one gesture archives two conversations and the second is
 * one the user never chose. The pin work measured the same class of defect as its
 * U3; this module is the rule that closes it here, and a rule that decides whether
 * a press happens is exactly the kind that must be tested rather than reasoned
 * about.
 *
 * The rule is IDENTITY plus a small radius, expired by the pointer's own path, and
 * each clause is asserted below with the gesture it protects or the gesture it
 * must not swallow.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/chat-archive-press";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { ARCHIVE_PRESS_SLOP_PX, archivePressExpired, archivePressOutcome } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);

const ROW_A = "aaaaaaaaaaaa";
const ROW_B = "bbbbbbbbbbbb";
const at = (x, y) => ({ x, y });

test("a press on the same conversation is always the user's own", () => {
	// Identity: the control is under their finger, and a repeat there is the
	// gesture a user makes when they want it twice - on the same conversation.
	const first = archivePressOutcome(null, at(100, 100), ROW_A);
	assert.equal(first.drop, false);
	assert.deepEqual(first.record, { x: 100, y: 100, sessionId: ROW_A });

	const repeat = archivePressOutcome(first.record, at(100, 100), ROW_A);
	assert.equal(repeat.drop, false, "the same row twice is not a stray press");
});

test("a stationary press that lands on a DIFFERENT conversation is dropped", () => {
	const first = archivePressOutcome(null, at(100, 100), ROW_A);
	const second = archivePressOutcome(first.record, at(100, 100), ROW_B);
	assert.equal(
		second.drop,
		true,
		"the listener fires the click with the event's own `currentTarget`, which after the row left the list is the new row the section moved up",
	);
	/*
	 * AND THE RECORD DOES NOT ADVANCE. The row under a parked pointer is not the
	 * row the gesture was aimed at and the hand has still not moved, so recording
	 * the dropped row would let the hazard through on the very next click of the
	 * same gesture instead of refusing it for the whole gesture.
	 */
	assert.deepEqual(second.record, first.record);
});

test("a press within the slop is the same gesture; beyond it, a new one", () => {
	const first = archivePressOutcome(null, at(100, 100), ROW_A);
	// A wobble of a few pixels is a hand, not a decision.
	assert.equal(
		archivePressOutcome(
			first.record,
			at(100 + ARCHIVE_PRESS_SLOP_PX, 100),
			ROW_B,
		).drop,
		true,
	);
	assert.equal(
		archivePressOutcome(
			first.record,
			at(100 + ARCHIVE_PRESS_SLOP_PX + 1, 100),
			ROW_B,
		).drop,
		false,
		"one pixel past the slop is the reader having chosen another row",
	);
	// And a real move always records, so the NEXT press is judged against where the
	// hand actually is rather than against the gesture two moves ago.
	const moved = archivePressOutcome(first.record, at(180, 240), ROW_B);
	assert.equal(moved.drop, false);
	assert.deepEqual(moved.record, { x: 180, y: 240, sessionId: ROW_B });
});

test("the keyboard carries no position, and is never dropped", () => {
	const first = archivePressOutcome(null, at(100, 100), ROW_A);
	/*
	 * A click synthesised from Enter or Space has `detail === 0` and the caller
	 * passes `null`: it acts on the row that has FOCUS, which is by construction the
	 * row the user is on, so there is nothing to discriminate.
	 */
	const keyboard = archivePressOutcome(first.record, null, ROW_B);
	assert.equal(keyboard.drop, false);
	/*
	 * ...AND IT DOES NOT CLEAR THE RECORD. A keyboard press re-orders the list
	 * exactly as a pointer press does, so the pointer is left parked over a
	 * different conversation by it too - clearing here would disarm the guard for
	 * the one press it exists for, the pointer's.
	 */
	assert.deepEqual(keyboard.record, first.record);
});

test("the record expires on the pointer's own path, not on a clock", () => {
	const record = { x: 100, y: 100, sessionId: ROW_A };
	assert.equal(
		archivePressExpired(null, at(100, 100)),
		false,
		"nothing to expire",
	);
	assert.equal(archivePressExpired(record, at(102, 100)), false);
	assert.equal(
		archivePressExpired(record, at(100 + ARCHIVE_PRESS_SLOP_PX, 100)),
		false,
	);
	assert.equal(
		archivePressExpired(record, at(100 + ARCHIVE_PRESS_SLOP_PX + 1, 100)),
		true,
		"a hand that moved away and came back has made a NEW gesture",
	);
});

/*
 * THE DIALOG'S OWN GESTURE (2026-09-30). Archiving asks first now, so a press opens a
 * dialog instead of removing the row - and the two questions that raises are about the
 * guard's RECORD, which is the only state the press leaves behind:
 *
 *   - a CANCELLED confirmation must not swallow a deliberate re-press, and
 *   - the second click of a double-click must not be able to archive.
 *
 * Both are answered by the same property, and it is why the rule did not have to change:
 * the record is expired by the POINTER'S OWN PATH, and reaching the dialog's buttons and
 * coming back to the row is a journey far beyond the slop. So the next press is a new
 * gesture whatever row it lands on - including the row the first press was about.
 */
test("a gesture that carried on into the dialog expires, so a re-press after a cancel acts", () => {
	const press = archivePressOutcome(null, at(100, 200), ROW_A);
	assert.equal(press.drop, false);
	assert.equal(press.record.sessionId, ROW_A);
	/*
	 * The reader travels to the dialog to answer it. The component's pointer path calls
	 * `archivePressExpired` on every move and clears the record when it is true - so by the
	 * time the pointer is back on a row, the gesture that opened the dialog is over.
	 */
	const backAtTheRow = at(100 + ARCHIVE_PRESS_SLOP_PX + 1, 200);
	assert.equal(
		archivePressExpired(press.record, backAtTheRow),
		true,
		"a journey to the dialog is a move, and a move ends the gesture",
	);
	// With the record cleared (which is what the component does), the deliberate re-press
	// acts - on the SAME row and on any other one.
	assert.deepEqual(archivePressOutcome(null, backAtTheRow, ROW_A), {
		drop: false,
		record: { x: backAtTheRow.x, y: backAtTheRow.y, sessionId: ROW_A },
	});
	assert.deepEqual(archivePressOutcome(null, backAtTheRow, ROW_B), {
		drop: false,
		record: { x: backAtTheRow.x, y: backAtTheRow.y, sessionId: ROW_B },
	});
});

test("a dropped press still does not advance the record, so the reflex stays refused", () => {
	/*
	 * The other half of the dialog question, and it is the guard's original clause read
	 * again with the dialog in it: when the reveal is NOT answered - a dropped second
	 * click - the record must keep describing the FIRST press, or the row the reflex
	 * landed on becomes the row the guard protects on the next click, and the gesture
	 * archives after all.
	 */
	const first = archivePressOutcome(null, at(100, 200), ROW_A);
	const second = archivePressOutcome(first.record, at(101, 200), ROW_B);
	assert.equal(second.drop, true);
	assert.deepEqual(
		second.record,
		first.record,
		"a dropped press must leave the record on the row the gesture was aimed at",
	);
	// And a third click of the same reflex is still refused rather than accepted.
	assert.equal(
		archivePressOutcome(second.record, at(101, 200), ROW_B).drop,
		true,
	);
});
