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
const STACK =
	"src/renderer/src/features/chat/components/measured-suggestion-stack.tsx";
const CONTRAST = "scripts/contrast-contract.mjs";
const MISSING_NOTICE =
	"src/renderer/src/features/chat/missing-session-notice.ts";
const TRANSCRIPT =
	"src/renderer/src/features/chat/canonical/canonical-transcript.tsx";
const CARET = "src/renderer/src/features/chat/composer-caret.ts";

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
	/*
	 * Two assertions, one per utility, rather than one match on the literal
	 * adjacency of the two (review round 1, NIT 2): the contract is that BOTH
	 * variants carry an ink step, and the string order they happen to be written
	 * in is not part of it. A reordering that keeps both - the shape a formatter
	 * or a class-sorting plugin produces - used to fail a test about a colour that
	 * had not changed.
	 */
	const source = code(COMPOSER);
	assert.match(
		source,
		/read-only:text-ink-disabled/,
		"branding § 6: a control that refuses changes COLOUR, never opacity - the box's own text",
	);
	assert.match(
		source,
		/read-only:placeholder:text-ink-disabled/,
		"and the empty refusal's only sentence is painted at the same step; a placeholder left at the working ink is the loudest thing in the state that has just gone quiet",
	);
});

test("every path that TYPES INTO or SUBMITS the composer answers to the refusal", () => {
	/*
	 * THE COVERAGE THE COMMENT USED TO CLAIM (review round 1, MAJOR 2; design
	 * round 1, D3; UX round 1, U2). `readOnly` closes exactly one path - the
	 * textarea's own edit - and every OTHER path a TYPE or SUBMIT gesture can
	 * reach is a separate handler that had no notion of the refusal: a press on a
	 * `type="submit"` control (`handleSubmit`, the form's, which a click reaches
	 * with no keydown to refuse), the slash popup's pick (`applyPlan`), the
	 * dictation button and the speech-to-text manager's own gate (both
	 * `setNewMessage`), and paste - which `readOnly` newly made REACHABLE,
	 * because a read-only textarea is still a paste target and neither branch
	 * below is an edit the attribute can suppress.
	 *
	 * "TYPES INTO OR SUBMITS" IS DELIBERATELY NARROWER THAN "MUTATES" (review
	 * round 2, MINOR 3). Three writers into this box are NOT covered and must not
	 * be read as covered: the composer alert's Restore and Discard (the reader's
	 * own explicit intent over the words the refusal is holding) and the
	 * store-to-box adoption effect (the draft-identity family the PR excludes by
	 * design). None of the three is a type or submit gesture, none submits, and
	 * a refusal that swallowed them would destroy the text the state exists to
	 * keep - so the claim here is the narrower one, and it is true of every path
	 * it names.
	 *
	 * Each is pinned where it lives, so a later edit that adds a path or drops a
	 * term has to come here and say so.
	 */
	const source = code(COMPOSER);

	const submit = source.slice(
		source.indexOf("const handleSubmit = (e: FormEvent)"),
	);
	assert.match(
		submit.slice(0, submit.indexOf("submitCapture()")),
		/if \(isInputDisabled\) return;/,
		"`handleSubmit` runs `submitCapture`/`applyPlan`/`submitMessage` and has no keydown of its own to refuse: without this guard a click submits for a conversation this machine does not have and clears the reader's sentence",
	);

	const paste = source.slice(
		source.indexOf(
			"const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>)",
		),
	);
	const pasteGuard = paste.indexOf("if (isInputDisabled) return;");
	assert.notEqual(
		pasteGuard,
		-1,
		"a refused box takes no paste - both branches write",
	);
	assert.ok(
		pasteGuard < paste.indexOf("event.clipboardData"),
		"the guard is ahead of the first READ of the payload, because both branches below it write (`applyCapture`, `addAttachment`) and `readOnly` cannot suppress either - it is not an edit to the textarea's value",
	);

	const pick = source.slice(
		source.indexOf("const handleSlashPick = useCallback("),
	);
	const pickGuard = pick.indexOf("if (isInputDisabled) return;");
	assert.notEqual(
		pickGuard,
		-1,
		"the popup is a SIBLING of the textarea, so `readOnly` cannot close it - the click has to refuse for itself",
	);
	assert.ok(
		pickGuard < pick.indexOf("completionFor("),
		"and it refuses before the pick writes the completion anywhere",
	);

	assert.match(
		source,
		/disabled=\{\s*isInputDisabled \|\|\s*isLoading/,
		"the Send control carries the refusal itself, so the band does not offer a live primary action beside a box that takes nothing - and so the first control a refused keyboard user reaches is not the destructive one",
	);
	assert.match(
		source,
		/if \(isInputDisabled \|\| !canEnableRecordingFeature\) return;/,
		"dictation writes a transcript into the box with `setNewMessage`, so it refuses with the same predicate",
	);
	assert.match(
		source,
		/!isInputDisabled &&\s*!isLoading/,
		"and the speech-to-text manager's gate (the hold-Space path) has to refuse too, or the keyboard reaches it around the button",
	);
});

test("every control the refusal disables keeps the caret on a press, and only while it refuses", () => {
	/*
	 * QA round 3, Q-1: the refusal's `disabled` term is on the Send control, the
	 * dictation control and the attach control, and a press on ANY of them takes
	 * the browser's `mousedown` default, which for a control that cannot take focus
	 * is "move the caret to `document.body`". The suppression therefore belongs on
	 * each of them, not on the two a measurement happened to land on: QA measured
	 * the ATTACH control taking the caret to `body` (`attachPress active=body
	 * isComposer=false`, text intact, no message op) while the fix guarded Send and
	 * the mic.
	 *
	 * THE SECOND HALF IS THE ASSERTION THAT MATTERS, and it is the one a later
	 * tidy-up deletes. A BLANKET suppression passes every assertion above it and
	 * breaks a property the refusal never claimed: a press on inert background must
	 * still clear the caret, and a live control has to be exactly what it was. So
	 * the handler's body is pinned as `isInputDisabled`-gated and carrying exactly
	 * one `preventDefault` - the reviewer's four mutations (remove the props, swap
	 * `onPointerDown` for `onMouseDown`, make the handler unconditional) fail here.
	 *
	 * `onPointerDown` RATHER THAN `onMouseDown` is pinned rather than explained: a
	 * disabled form control dispatches no mouse events at all, so the slash rows'
	 * technique fixes nothing on these controls.
	 */
	const source = code(COMPOSER);

	for (const [control, pattern] of [
		[
			"the Send control",
			/type="submit"[\s\S]{0,240}?onPointerDown=\{holdCaretOnRefusedPress\}/,
		],
		[
			"the dictation control",
			/onPointerDown=\{holdCaretOnRefusedPress\}[\s\S]{0,240}?aria-label="Start recording"/,
		],
		[
			"the attach control",
			/onPointerDown=\{holdCaretOnRefusedPress\}[\s\S]{0,240}?aria-label="Attach file"/,
		],
	]) {
		assert.match(
			source,
			pattern,
			`${control} is disabled by the refusal, so its press is one that clears the caret to \`body\``,
		);
	}
	assert.doesNotMatch(
		source,
		/onMouseDown=\{holdCaretOnRefusedPress\}/,
		"a disabled control dispatches no mousedown, so `onMouseDown` is inert here twice over",
	);

	/*
	 * The chips carry the same `isInputDisabled` term inside `suggestionsDisabled`,
	 * and the stack renders on `bandCentred` = `messages.length === 0` - which is
	 * independent of the refusal - so the suppression is WIRED THROUGH rather than
	 * argued unreachable. Guarding the predicate is the decision: QA measured an
	 * empty `controls.chips` on the `view.missing` arm alone, and a guard whose
	 * absence rests on one arm stops guarding the day another arm draws a chip.
	 * The handler is pinned as optional and caller-gated, because a component that
	 * suppressed the press whenever its OWN `disabled` prop was true would silently
	 * widen the refusal to every caller's reason for disabling a chip - including
	 * the composer holding a draft, which is a control disabled for its own reason.
	 */
	assert.match(
		source,
		/onRefusedPress=\{holdCaretOnRefusedPress\}/,
		"the chips are disabled by the same predicate, so the suppression reaches them",
	);
	const stack = code(STACK);
	assert.match(
		stack,
		/onRefusedPress\?: \(event: PointerEvent<HTMLButtonElement>\) => void;/,
		"the stack takes the suppression from its caller instead of deciding for itself",
	);
	assert.match(
		stack,
		/disabled=\{disabled \|\| hidden\}\s*\n\s*onPointerDown=\{onRefusedPress\}/,
		"and puts it on the CHIP: on the stack container it would also swallow an inert press inside the stack, which has to go on clearing the caret",
	);

	const from = source.indexOf("const holdCaretOnRefusedPress = useCallback(");
	assert.ok(from > -1, "the suppression has to still be one `useCallback`");
	const handler = source.slice(
		from,
		source.indexOf("[isInputDisabled],", from),
	);
	assert.match(
		handler,
		/if \(isInputDisabled\) event\.preventDefault\(\);/,
		"the handler's body IS the gate - an unconditional `event.preventDefault()` swallows the inert-background press the refusal does not claim",
	);
	assert.equal(
		(handler.match(/preventDefault/g) ?? []).length,
		1,
		"one `preventDefault`, and it is the gated one: a second, ungated call is the blanket trap",
	);
});

test("the refused box says WHY, by pointing at the pane's own sentence", () => {
	/*
	 * UX round 1, U3: a screen reader in the refused box heard the value and
	 * "read-only, disabled" and never the reason - the pane's statement of the
	 * state is a `<p>` in the transcript with no programmatic tie to the control,
	 * and the placeholder that carries the short form is painted and announced
	 * only while the box is EMPTY, which is exactly the state this PR makes
	 * focusable and filled. The tie is a SHARED CONSTANT, because the two ends
	 * live in components that must not import each other.
	 */
	const source = code(COMPOSER);
	assert.match(
		source,
		/unavailable \? MISSING_SESSION_NOTICE_ID : null/,
		"the composer describes itself with the pane's refusal sentence while the pane is missing",
	);
	assert.match(
		source,
		/credentialNotice \? CREDENTIAL_NOTICE_ID : null/,
		"joined with the credential notice rather than replacing it: the two states can coincide",
	);

	const notice = read(MISSING_NOTICE);
	const named = notice.match(
		/export const MISSING_SESSION_NOTICE_ID = "([^"]+)"/,
	);
	assert.ok(named, "the id has to be named once, in a leaf, for both ends");
	assert.match(
		read(TRANSCRIPT),
		/id=\{MISSING_SESSION_NOTICE_ID\}/,
		"and the transcript has to actually paint it on the sentence, or the reference resolves to nothing",
	);
	assert.ok(
		named[1].startsWith("lo-"),
		`the id stays in the app's namespace: ${named[1]}`,
	);
});

test("a refused box takes the caret from a gesture and not from an unprompted focus grab", () => {
	/*
	 * UX round 1, U4: the caret's destination used to depend on the DOOR - the
	 * palette's close-time restore hands it to the box (deliberately: the box
	 * holds the reader's words), while the composer's own mount self-focus bails
	 * on the refusal. Stated as a rule rather than left accidental: a
	 * GESTURE-DRIVEN restore may land in a box that refuses input, an UNPROMPTED
	 * grab may not. Both halves are pinned, because either one alone is the
	 * door-dependence again.
	 */
	const source = code(COMPOSER);
	assert.match(
		source,
		/if \(!isInputDisabled && !isRecording && !isTranscribing\) \{/,
		"the mount self-focus keeps its refusal gate: pulling the caret into a box the app has just declared inert is the silent steal, and it is what would take the caret out of the transcript when a refusal lands mid-read",
	);
	assert.match(
		read(CARET),
		/if \(!field \|\| field\.disabled\) return false;/,
		"and the gesture's hand-off still refuses only a DISABLED field - `readOnly` is not a bail, or the destination composer of every pick onto a missing conversation would be skipped in favour of the rail",
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
