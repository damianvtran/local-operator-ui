/*
 * The turn-answer rail's rules (`turn-answer-rail.ts`), exercised through the
 * SHIPPED module - the bundle imports the same file the transcript does.
 *
 * The rail shipped always-on in #708 (a 2px `ink-dim` rule with 6px of padding)
 * and the operator found it ugly and cramped, so it is now the opt-in backend
 * key `display.turn_answer_rail`. Four properties, each one a way an edit breaks
 * it by accident:
 *
 * 1. FAIL-CLOSED READING. Only an explicit boolean `true` turns it on: an absent
 *    key (old backend), a missing payload (failed or unanswered query), and every
 *    non-boolean value stay off.
 * 2. DEFAULT OFF CARRIES NO MARK. With the rail off the elected answer wears
 *    exactly what every other prose row wears.
 * 3. ON IS SUBTLE AND PADDED: a 1px `hairline` rule (not #708's 2px `ink-dim`)
 *    and 12px of inner padding (not 6px).
 * 4. NO LAYOUT SHIFT. The negative margin equals rule + padding, so the prose box
 *    sits where it sits with the rail off; the marked row is auto-width because
 *    a negative margin on a `w-full` block slides it left and shortens the
 *    prose on the right (measured against #708: 802px of 810px).
 *
 * jsdom has no layout engine, so the pixel claim is the before/after frames on
 * the PR; the mounted seam (settings query -> row) is asserted in
 * `turn-collapse-behaviour.test.mjs`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/turn-answer-rail";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { TURN_ANSWER_RAIL_KEY, turnAnswerMarkClass, turnAnswerRailEnabled } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);

const entry = (value) => [{ key: TURN_ANSWER_RAIL_KEY, value }];

test("the registry key is the frozen string the backend declares", () => {
	assert.equal(TURN_ANSWER_RAIL_KEY, "display.turn_answer_rail");
});

test("only an explicit boolean true turns the rail on", () => {
	assert.equal(turnAnswerRailEnabled(entry(true)), true);
	assert.equal(turnAnswerRailEnabled(entry(false)), false);
});

test("anything else fails closed: absent key, no payload, non-boolean values", () => {
	assert.equal(turnAnswerRailEnabled(undefined), false, "query unanswered");
	assert.equal(turnAnswerRailEnabled(null), false);
	assert.equal(turnAnswerRailEnabled([]), false, "an empty registry");
	assert.equal(
		turnAnswerRailEnabled([{ key: "display.hide_cross_session", value: true }]),
		false,
		"a backend that predates the key, with a sibling key on",
	);
	for (const value of ["true", "on", 1, "1", {}, [], null, undefined]) {
		assert.equal(
			turnAnswerRailEnabled(entry(value)),
			false,
			`${JSON.stringify(value)} is not the boolean true`,
		);
	}
});

test("default off: the elected answer wears no mark at all", () => {
	assert.equal(turnAnswerMarkClass(true, false), "w-full");
	assert.equal(
		turnAnswerMarkClass(true, false),
		turnAnswerMarkClass(false, false),
		"the same classes as any other prose row",
	);
	assert.doesNotMatch(turnAnswerMarkClass(true, false), /border|-ml-|pl-/);
});

test("an unelected row never wears it, whatever the setting says", () => {
	assert.equal(turnAnswerMarkClass(false, true), "w-full");
});

test("on: a 1px hairline rule with 12px of padding, not #708's 2px ink-dim at 6px", () => {
	const classes = turnAnswerMarkClass(true, true).split(" ");
	assert.ok(
		classes.includes("border-l"),
		"a 1px rule: border-l, not border-l-2",
	);
	assert.ok(!classes.includes("border-l-2"));
	assert.ok(classes.includes("border-hairline"), "the decorative-rule role");
	assert.ok(!classes.includes("border-ink-dim"), "no longer the louder ink");
	assert.ok(classes.includes("pl-3"), "12px of inner padding");
	assert.ok(!classes.includes("pl-1.5"), "not #708's 6px");
});

test("on: no layout shift - margin equals rule plus padding, and the row is auto-width", () => {
	const classes = turnAnswerMarkClass(true, true).split(" ");
	const margin = classes.find((c) => c.startsWith("-ml-"));
	const padding = classes.find((c) => c.startsWith("pl-"));
	assert.equal(margin, "-ml-[13px]");
	const px = (token) => Number(/(\d+(?:\.\d+)?)/.exec(token)[1]);
	const ruleWidth = 1;
	const paddingPx = px(padding) * 4; // --spacing is 0.25rem = 4px
	assert.equal(px(margin), ruleWidth + paddingPx, "margin nets to zero");
	assert.ok(!classes.includes("w-full"), "auto width keeps the right edge");
});
