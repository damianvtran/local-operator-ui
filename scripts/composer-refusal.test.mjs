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

test("every path that mutates the composer or submits it answers to the refusal", () => {
	/*
	 * THE COVERAGE THE COMMENT USED TO CLAIM (review round 1, MAJOR 2; design
	 * round 1, D3; UX round 1, U2). `readOnly` closes exactly one path - the
	 * textarea's own edit - and every OTHER way into the box is a separate
	 * handler that had no notion of the refusal: a press on a `type="submit"`
	 * control (`handleSubmit`, the form's, which a click reaches with no keydown
	 * to refuse), the slash popup's pick (`applyPlan`), the dictation button and
	 * the speech-to-text manager's own gate (both `setNewMessage`), and paste -
	 * which `readOnly` newly made REACHABLE, because a read-only textarea is
	 * still a paste target and neither branch below is an edit the attribute can
	 * suppress.
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
