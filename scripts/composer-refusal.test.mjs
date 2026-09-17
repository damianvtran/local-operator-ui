import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * THE REFUSAL CONTRACT: a composer that will not take input must refuse the
 * KEYSTROKE without dropping the caret, and it must refuse the keystroke itself
 * rather than trusting the attribute to.
 *
 * `readOnly={isInputDisabled}` is what stops the edit: a browser applies no edit
 * to a read-only field and fires no `input` event, so `onChange` never runs.
 * What it does NOT stop is `keydown` - so without the guard at the top of
 * `handleComposerKeyDown`, Enter submits from a box the app has just told the
 * user refuses input, and on the `unavailable` arm it submits a message for a
 * conversation this machine does not have. That pairing is the whole change, and
 * the source scan below is what keeps the two halves from being separated by a
 * later edit that looks like a tidy-up.
 *
 * WHY A SOURCE SCAN AND NOT A BROWSER RUN: the browser half is not assertable
 * here and is not this file's business. jsdom provably cannot see the defect -
 * it reports no blur when a focused control becomes `disabled`, so the focus
 * loss this change removes is invisible to it - and the behaviour that matters
 * (a refused box keeps the caret, its selection and its text) needs a real
 * engine: the renderer driver's scenes and QA's pass on the built app.
 * `scripts/credential-composer.test.mjs` carries what jsdom CAN prove - the
 * attributes on the mounted composer, and the refused Enter.
 */

const read = (path) => readFileSync(path, "utf8");

/** The source with its comments blanked, so prose about a token is not the token. */
const code = (path) =>
	read(path)
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const COMPOSER = "src/renderer/src/features/chat/components/message-input.tsx";
const CONTRAST = "scripts/contrast-contract.mjs";

/* ------------------------------------------------------------------ */
/* The refusal contract                                                 */
/* ------------------------------------------------------------------ */

test("the composer's textarea refuses input with `readOnly`, never `disabled`", () => {
	const source = code(COMPOSER);
	assert.match(
		source,
		/readOnly=\{isInputDisabled\}/,
		"the refusal attribute: a disabled control cannot refuse a keystroke without dropping the caret, and on the unavailable arm it never gets it back",
	);
	assert.doesNotMatch(
		source,
		/disabled=\{isInputDisabled\}/,
		"`disabled` on the composer is the defect: it blurs the field on the way in and makes the reader's own words unselectable",
	);
	assert.match(
		source,
		/aria-disabled=\{isInputDisabled \|\| undefined\}/,
		"with the native attribute gone, the refusal has to reach a screen reader another way - and absent, not `false`, while the box works",
	);
});

test("the refused state still steps colour, in the read-only variant", () => {
	const source = code(COMPOSER);
	assert.match(
		source,
		/read-only:text-ink-disabled read-only:placeholder:text-ink-disabled/,
		"branding § 6: a control that refuses changes COLOUR, never opacity",
	);
});

test("the key handler refuses the keystroke BEFORE its Enter branch", () => {
	const source = code(COMPOSER);
	const from = source.indexOf("const handleComposerKeyDown = useCallback(");
	assert.ok(from > -1, "the composer's key handler is gone");
	const bodyEnd = source.indexOf("handleKeyDown(event);", from);
	const body = source.slice(from, bodyEnd);
	const guard = body.indexOf("if (isInputDisabled) return;");
	const enter = body.indexOf('event.key === "Enter"');
	assert.notEqual(
		guard,
		-1,
		"a readOnly textarea still fires keydown, so without this guard Enter submits from a box the app says refuses input",
	);
	assert.ok(
		enter > -1 && guard < enter,
		"the guard has to come first: after the Enter branch it is dead code",
	);
	/*
	 * And the guard's predicate is a DEPENDENCY of the handler, so a state change
	 * rebuilds it: a guard reading a value captured at first render refuses on the
	 * panel's first state and never again.
	 */
	const deps = source.slice(bodyEnd, source.indexOf("const ", bodyEnd));
	assert.match(deps, /isInputDisabled,/);
});

test("the refusal predicate is declared before the handler whose deps name it", () => {
	/*
	 * A dependency array is evaluated DURING the render that builds the handler,
	 * so a `const` declared below it is in the temporal dead zone and the whole
	 * component throws. The predicate is therefore hoisted deliberately, and a
	 * later tidy that moves it back beside the render that paints it has to
	 * come here.
	 */
	const source = code(COMPOSER);
	const declared = source.indexOf(
		"const isInputDisabled = unavailable || isBusy;",
	);
	const handler = source.indexOf("const handleComposerKeyDown = useCallback(");
	assert.ok(declared > -1 && handler > -1);
	assert.ok(
		declared < handler,
		"`isInputDisabled` must be declared above the handler that lists it",
	);
});

test("the contrast contract knows this state exists", () => {
	/*
	 * `AGENTS.md`: green output about a component nobody listed is not evidence
	 * about that component. So the row is pinned, AND the exemption the row
	 * depends on is pinned in the loop that consumes it - a listed row that
	 * silently asserts nothing is the same defect one level down.
	 */
	const source = code(CONTRAST);
	assert.match(
		source,
		/name: "composer \(read-only\)"/,
		"the read-only composer needs its own CONTROLS row",
	);
	assert.match(
		source,
		/name: "composer \(read-only\)"[\s\S]{0,400}?ink: "inkDisabled"/,
		"the row's ink is the floor-exempt disabled role - the state has to READ as a refusal",
	);
	assert.match(
		source,
		/!EXEMPT_INK\.has\(c\.ink\)/,
		"the CONTROLS loop has to honour the exempt ink, or the row above asserts nothing",
	);
});
