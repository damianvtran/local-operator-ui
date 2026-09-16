/**
 * The composer's inline credential capture, as pure functions.
 *
 * This is the desktop port of the TUI's `/credential` gesture
 * (`local_operator/tui/widgets/editor.py`: `CREDENTIAL_ARM`, the typed-capture
 * state machine, `_credential_edit_mirror`, `_mint_typed_credential`,
 * `_cancel_credential_typing`, `_capture_credential`, `generate_credential_key`,
 * `credential_payloads`, `substitute_credentials`, `describe_unstored`, and
 * `app.py`'s `_capture_inline_credentials` / `session_credential_names`). The
 * contract the implementation is held to is
 * `docs/design/composer-credential-capture.md`.
 *
 * WHY IT IS RENDERING-FREE. Everything here is a function of (buffer, caret,
 * held state) and nothing here reads React, the DOM or a store. That is not
 * tidiness for its own sake: the invariants this feature rests on are all
 * statements about a STRING and an OFFSET — "the secret is never in the
 * document", "one mask cell per character of the value", "the citation is the
 * app's own only when the index and the marker text both match" — and a rule
 * that can only be checked by driving a browser is a rule that gets checked by
 * whoever remembered to. `scripts/credential-capture.test.mjs` pins every one
 * of them against these functions.
 *
 * THE LOAD-BEARING INVARIANT, from `editor.py:6172-6177`: while a masked span
 * is open, the buffer text is exactly
 * `<prefix>/credential <MASK x len(value)><suffix>`. The characters of the
 * secret live in {@link Capture.value} and NOWHERE else until Enter mints the
 * marker: the draft store, history, telemetry and the transcript all read the
 * document, so holding the value outside it closes every disclosure seam at
 * once rather than one at a time.
 *
 * Amended by the operator's task: the TUI RE-ARMS after an arrival it never
 * typed through, and one class of text that arrives in the composer (an
 * accepted slash completion that appends the token's trailing space) is an
 * arming route by that design's own §1. Where this port and the design
 * document disagree the document's §7 divergences are the permitted
 * departures; every place this file departs from either is called out in a
 * comment at the code that does it.
 */

/** A half-open span of buffer offsets, `[start, end)`. */
export type Span = { start: number; end: number };

/**
 * What one open capture holds.
 *
 * Three fields rather than a boolean per state, because the TUI's states are
 * genuinely different questions and collapsing any two of them makes the
 * composer say the wrong thing about what the next keystroke means:
 *
 * - `arm` — the latched arming token, or `null`. ARMED is "before the secret
 *   arrives". The latch is not re-derived per keystroke: it survives a
 *   newline, a typed word and a caret move, and ends only when the token is
 *   gone, the capture is taken, the span is cancelled, or a flag-shaped tail
 *   turns the tail into an argument (`editor.py:5862-5990`).
 * - `typingAt` — the buffer offset of the FIRST mask cell, or `null`. TYPING
 *   is "while the secret arrives".
 * - `value` — the held secret. Characters, in the order the operator
 *   confirmed them, and only ever spliced POSITIONALLY (see
 *   {@link maskEdit}).
 */
export type Capture = {
	arm: Span | null;
	typingAt: number | null;
	value: string;
};

/** Nothing captured: the state every composer starts and returns to. */
export const IDLE_CAPTURE: Capture = { arm: null, typingAt: null, value: "" };

/** A minted credential: the held secret and the receipt text that cites it. */
export type CredentialPayload = {
	index: number;
	key: string;
	value: string;
	marker: string;
};

/**
 * How text ARRIVED in the buffer, which is the one thing an arriving value can
 * tell this module that a typed one can also tell it.
 *
 * The distinction is not decoration: `docs/design/composer-credential-capture.md`
 * §2 ("only typing arms") is the rule that keeps a restored draft, a history
 * recall or a seeded value from silently capturing the operator's next paste,
 * and the TUI enforces it by being the only arming route (`_sync_credential_arm`
 * — "This is the ONLY way to arm"). A pure function of `(buffer, caret)` cannot
 * express that rule at all: the same string and the same caret are identical
 * whichever route produced them. So the route is an ARGUMENT, and `"arrival"`
 * is what a value that no keystroke produced passes.
 *
 * There are two powers, not one, and the TUI separates them too:
 *
 * - **ARM** — latch a token at the caret. Typing does it, and so does accepting
 *   a slash row that appends the token's trailing space (the TUI's
 *   `_apply_command`, and §1 of the design document). A caret move does NOT:
 *   a click at the end of a restored draft must not swallow the next paste.
 * - **OPEN** — turn a space after an ALREADY latched token into a masked span.
 *   A caret move DOES (
 *   `test_the_caret_returning_to_the_token_re_opens_the_capture`): the span is
 *   positional, open exactly while the caret is in it, and without the re-open
 *   leaving and coming back leaves an armed token whose next typed character
 *   lands in plaintext.
 *
 * `"arrival"` has neither power. That is the whole of §2's negative case.
 *
 * WHICH POWERS ARE ACTUALLY WIRED, because a docstring that describes four
 * origins reads as four mechanisms and only three have a production call site:
 *
 * - `"typing"` — the textarea's `onChange` mirror in `message-input.tsx`, the
 *   belt for edits the keyboard gate cannot see (Backspace, Delete, a
 *   selection, a drop, an IME commit, a paste that fell through).
 * - `"caret"` — the same file's `onSelect`, which may re-anchor an arm and
 *   re-open a span the caret has returned to, and may never arm.
 * - `"completion"` — `handleSlashPick`, on the buffer a slash row wrote. It is
 *   the second ARMING door (§1: the row inserts `/credential `, and the
 *   trailing space opens the capture, so a hand-typed space and a
 *   picker-accepted one are one rule).
 * - `"arrival"` — NO production call site, deliberately. A whole-buffer
 *   replacement does not arrive INTO the capture; it ENDS it. It is passed by
 *   nothing but the tests that pin that negative case, and the composer's
 *   teardown ({@link IDLE_CAPTURE} on an external write) is where the reference
 *   puts `_abandon_credential_typing("gone")` + `_disarm_credential("gone")`
 *   — `editor.py:7033-7099`. Re-syncing here instead was tried and removed:
 *   it let a latched arm re-anchor onto whatever `/credential` the arriving
 *   text happened to contain, so a recalled prompt that merely MENTIONED the
 *   command swallowed the next ordinary paste as a secret, unrecoverably
 *   (review round 2, R6b/R6c; QA round 2, Q4).
 */
export type Arrival = "typing" | "completion" | "caret" | "arrival";

/** The cell painted in place of each character of a typed secret. */
export const MASK_CELL = "\u2022";

/**
 * The arming predicate, ported verbatim from `editor.py:551`:
 *
 * ```python
 * CREDENTIAL_ARM = re.compile(r"(?:^|(?<=\s))/(?:credential|cred)[ \t]*$", re.IGNORECASE)
 * ```
 *
 * - leading OR mid-prose: `deploy with /credential <value>` is a supported
 *   sentence, and the lookbehind rather than a consuming `\s` is what makes
 *   the match START at the `/` — the token is spliced out when the marker
 *   replaces it, and eating the separating space would glue the marker onto
 *   the previous word;
 * - the token must be the last thing on the CARET'S OWN LINE, so a
 *   `/credential` three lines up cannot arm a capture being typed here. A
 *   newline is not part of the match; trailing spaces and tabs are;
 * - `/cred` is included because the alias completes to `/credential` in the
 *   picker, and an operator who typed the alias and pasted without completing
 *   never went through the picker. `/credentials` is NOT the token: the
 *   `[ \t]*$` partition excludes it, and {@link CREDENTIAL_TOKEN} draws the
 *   same line with a negative lookahead.
 *
 * Applied to the caret's own line, never to the whole buffer — see
 * {@link armSpan}.
 */
export const CREDENTIAL_ARM = /(?:^|(?<=\s))\/(?:credential|cred)[ \t]*$/i;

/**
 * The same token WITHOUT the end-of-line anchor, used only to RE-LOCATE a
 * token that has already armed (`editor.py:81`).
 *
 * Arming itself still asks {@link CREDENTIAL_ARM} and nothing else, so a token
 * that merely arrives in the buffer never arms; this one answers "where did
 * the token I already armed on move to" after the operator kept typing. The
 * negative lookahead is the same partition the arming regex draws, so
 * `/credentials` is not a token here either.
 */
export const CREDENTIAL_TOKEN = /(?:^|(?<=\s))\/(?:credential|cred)(?!\S)/gi;

/**
 * The word at the anchor, for the arm's TYPED-THROUGH rule
 * (`CREDENTIAL_TOKEN_WORD`, `editor.py:603`).
 *
 * Matched at the latched offset ONLY, and that is the whole containment
 * argument: this is not an arming rule, so it can never arm a token that merely
 * arrived in the buffer. It cannot widen the armed set sideways either, because
 * the test {@link relocateArm} applies to it is PREFIX-OF the token:
 * `/credentials` starts with the token but is not a prefix of it, so it fails
 * here exactly as it fails {@link CREDENTIAL_TOKEN}.
 */
const CREDENTIAL_TOKEN_WORD = /^\/[A-Za-z]*/;

/**
 * The shortest spelling that still reads as the token (`CREDENTIAL_TOKEN_FLOOR`,
 * `editor.py:606`). Below it the word at the anchor is a deletion rather than a
 * gesture in progress: shortening past `/cred` is the operator visibly
 * withdrawing the gesture.
 */
const CREDENTIAL_TOKEN_FLOOR = "/cred";

/** The full spelling the typed-through window walks toward (`editor.py:610`). */
const CREDENTIAL_TOKEN_FULL = "/credential";

/**
 * What DISARMS a latched capture: a flag-shaped argument on the token's own
 * line (`editor.py:630`).
 *
 * The reference matches it with `re.match`, i.e. ANCHORED AT THE START of that
 * tail (`editor.py:5916`), and the anchor is the rule rather than an
 * implementation detail: the flag has to be the FIRST thing after the token's
 * blanks to be the command. Unanchored, a `-` anywhere later in the tail
 * (`/credential the prod-key name`, a prose mention) disarmed the gesture, and
 * the operator's next paste then landed in the document — the false-negative
 * direction, which no keystroke undoes.
 *
 * `CREDENTIAL_ARGUMENT = re.compile(r"[ \t]+-")`, matched against the text
 * between the token's end and the end of that line. A LEADING `-` is the one
 * continuation that is unambiguously the COMMAND rather than a description,
 * and it is unambiguous by construction: the credential verbs are flag-shaped
 * (`--forget`, `--forget-all`) precisely so they can never collide with a key,
 * because keys normalize to `[A-Z0-9_]` and cannot begin with `-`. So
 * `/credential --forget-all` stays the command it looks like, while
 * `deploy with /credential the prod key` stays armed.
 */
export const CREDENTIAL_ARGUMENT = /^[ \t]+-/;

/** The character that opens a masked span, and is NOT part of the secret. */
export const CREDENTIAL_OPEN_SPACE = " ";

/**
 * The token's trailing blanks, which the armed span consumes.
 *
 * Top level rather than inline because the matcher runs on every keystroke of
 * every draft (`editor.py:5935-5945`: the span consumes the token's trailing
 * spaces so the marker's own trailing space cannot leave the operator's behind
 * as a second, meaningless one).
 */
const LEADING_BLANKS = /^[ \t]*/;

/**
 * The marker grammar, and the ONLY thing that makes a citation the app's own.
 *
 * `[Credential #<index>, <chars> chars]`, byte-for-byte the TUI's
 * (`_capture_credential`, `editor.py:6095`). `#<index>` is a COMPOSER-local
 * counter starting at 1 — it resets every submit, which is why the submit path
 * rewrites it into a name the model can use (§9) — and `<chars>` is
 * `Array.from(value).length`, CHARACTERS and never lines (`_credential_label`,
 * `editor.py:523-540`): the length is the operator's integrity check, and a
 * line count is the weakest form of it exactly where truncation hides, as in a
 * PEM block.
 */
export const CREDENTIAL_MARKER = /\[Credential #(\d+), (\d+) chars\]/g;

/**
 * One run of the buffer the overlay paints, and how it paints it.
 *
 * `"pill"` is a marker the buffer cites, `"mask"` is the masked span while it is
 * open, `"armed"` is the token the capture is latched to, and `"plain"` is
 * everything else — the text the textarea paints and the overlay must not.
 */
export type PaintSegment = {
	kind: "plain" | "pill" | "mask" | "armed";
	text: string;
};

/**
 * What the composer's overlay paints, in order, covering the whole buffer.
 *
 * The markers are located by {@link citationSpan}, which is the same predicate the
 * submit path stores by — so what the operator sees chipped and what reaches the
 * model cannot disagree, and a hand-typed lookalike is painted as the prose it is.
 *
 * The masked span is painted too, with the pill's own treatment: the bullets are
 * already painted by the textarea, and the wash behind them is what makes "these
 * characters are being held" visible as a STATE rather than as odd text. One
 * role, one meaning — this region is a credential — and the notice line carries
 * which of the three states it is in, exactly as the TUI's notice row does.
 *
 * THE ARMED TOKEN IS PAINTED TOO, and it is the port's second channel for a
 * state that otherwise had only a sentence (design round 1, D2). The TUI marks
 * it twice over (`local_operator.tui.local_operator.tcss:624`: the amber token
 * run AND the chevron glyph swap, because "the glyph is the one that survives
 * `NO_COLOR`"), and the port can carry neither of those two: a textarea has no
 * per-run colour and no glyph to swap. What it does have is this mirror, so the
 * token the capture is latched to gets the warning wash under it — the same
 * technique the pill uses, on the same element, with no layout of its own. It
 * is painted for the whole LATCH (armed and masked alike), because that is what
 * the arm means: the token is still the one the next space or paste lands in.
 *
 * Overlapping citations cannot happen (indices are unique and markers are
 * distinct), but a span that overlapped would be skipped rather than painted
 * twice; the walk is monotonic by construction. The arm is the one run that CAN
 * overlap — `arm.end` is the token's end and the masked span starts there —
 * which is why the mask wins that boundary: the mask is pushed after the arm and
 * the walk's `span.start < at` skip drops the overlap.
 */
export function paintPlan(
	buffer: string,
	payloads: Iterable<CredentialPayload>,
	capture: Capture = IDLE_CAPTURE,
): PaintSegment[] {
	const ranges: { span: Span; kind: "pill" | "mask" | "armed" }[] = [];
	for (const payload of payloads) {
		const span = citationSpan(buffer, payload);
		if (span) ranges.push({ span, kind: "pill" });
	}
	if (capture.arm && capture.arm.end > capture.arm.start)
		ranges.push({ span: capture.arm, kind: "armed" });
	const masked = maskSpan(capture);
	if (masked && masked.end > masked.start)
		ranges.push({ span: masked, kind: "mask" });
	ranges.sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end);

	const out: PaintSegment[] = [];
	let at = 0;
	for (const { span, kind } of ranges) {
		if (span.start < at) continue;
		if (span.start > at)
			out.push({ kind: "plain", text: buffer.slice(at, span.start) });
		out.push({ kind, text: buffer.slice(span.start, span.end) });
		at = span.end;
	}
	if (at < buffer.length) out.push({ kind: "plain", text: buffer.slice(at) });
	return out;
}

/** Whether anything in the plan needs the overlay at all (§7.1). */
export const planPaintsAnything = (plan: PaintSegment[]): boolean =>
	plan.some((segment) => segment.kind !== "plain");

/**
 * How long the submit seam will wait for one inline-credential store to answer.
 *
 * A live round-trip is milliseconds (an in-memory store write behind a loopback
 * socket), so anything that takes this long is a hung or dead connection — and
 * because this wait sits on the submit seam, the honest answer to a hung one is
 * the loud degrade, not a parked composer. The TUI's own number (`app.py`
 * `CREDENTIAL_STORE_TIMEOUT_S`), kept identical so the two products give up at
 * the same moment.
 */
export const CREDENTIAL_STORE_TIMEOUT_MS = 5000;

/**
 * Random-name alphabet, ported exactly (`editor.py:182`): Crockford-ish base32
 * WITHOUT the letters that read as digits, and without `U` (which `V` and `2`
 * are misread as). THIRTY symbols, not the 31 the design document's §8 states
 * — the exclusions are `O`, `I`, `L`, `U`, `0` and `1` against base32's own 32
 * — so eight characters is **39.3 bits**, not the 40 that counting the
 * described alphabet would give. The document's number is wrong and its
 * alphabet is right; the alphabet is what is copied here, and the test asserts
 * the 39.3-bit reading rather than restating either.
 *
 * The name is quoted back to the operator in a notice and may be typed into a
 * shell by hand, which is what the lookalike exclusions are worth.
 */
export const CREDENTIAL_KEY_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

/** The name's prefix, from `docs/design/secret-store.md` §11 (`editor.py:188`). */
export const CREDENTIAL_KEY_PREFIX = "LOP_SECRET_";

/**
 * The backend's own name pattern (`variables.normalize_credential_key`), and
 * the bound it enforces on the name's length.
 *
 * Asserted by the test rather than trusted: a name the store renormalises would
 * advertise one key to the model and hold another, and the mismatch would look
 * exactly like a store that worked.
 */
export const CREDENTIAL_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const CREDENTIAL_KEY_MAX_LENGTH = 128;

/**
 * The names a `sessions.credential` `action: "list"` answer holds.
 *
 * ONE reading of that payload, because it is read in two places that must agree
 * and disagreed once: the mint's collision guard (§8, which needs the names) and
 * `CredentialPicker` (which renders them). The runtime answers
 * `{"ok": true, "credentials": [{"key": "LOP_SECRET_…", "source": "command"}]}`
 * (`local_operator/session/credential_ops.py:59-64`), and reading it as
 * `string[]` cost both halves: the picker rendered an OBJECT as a React child
 * and crashed the renderer (React #31), and the guard's `taken` set could never
 * contain a name the session already held, so the collision guard was inert
 * while §8 claimed it was "consulted rather than trusted to probability"
 * (QA round 1, Q3).
 *
 * A bare string row is still honoured. The object shape is what the runtime
 * sends and what this pins; accepting the older spelling too means an older
 * runtime narrows the guard rather than crashing a panel, which is the same
 * trade the caller makes when the list cannot be fetched at all.
 *
 * Deliberately total: `unknown` in, strings out, nothing thrown. This runs on a
 * desktop-bridge answer, which is untrusted by construction (the previous
 * reading's type assertion is what made the crash a render-time error instead
 * of an empty list).
 */
export function credentialNamesFrom(answer: unknown): string[] {
	const rows = (answer as { data?: { credentials?: unknown } } | null | undefined)
		?.data?.credentials;
	if (!Array.isArray(rows)) return [];
	const names: string[] = [];
	for (const row of rows) {
		if (typeof row === "string") {
			if (row) names.push(row);
			continue;
		}
		const key = (row as { key?: unknown } | null | undefined)?.key;
		if (typeof key === "string" && key) names.push(key);
	}
	return names;
}

/** How many characters one string holds, counted as code points. */
export const charsOf = (value: string): string[] => Array.from(value);

/** The code-point length of `value`, which is the unit every count here uses. */
const charCount = (text: string): number => charsOf(text).length;

const clamp = (n: number, low: number, high: number): number =>
	Math.min(Math.max(n, low), high);

/**
 * The arming span at `caret`, or `null`.
 *
 * The predicate is asked about the caret's OWN LINE, which is the whole of what
 * `CREDENTIAL_ARM`'s `$` means: `caret` is where the operator is typing, so the
 * text that can arm is the text between the last newline before the caret and
 * the caret itself. Asking the whole buffer instead would let a `/credential`
 * on another line arm a capture here.
 */
export function armSpan(buffer: string, caret: number): Span | null {
	const at = clamp(caret, 0, buffer.length);
	const before = buffer.slice(0, at);
	const lineStart = before.lastIndexOf("\n") + 1;
	const match = CREDENTIAL_ARM.exec(before.slice(lineStart));
	if (match === null) return null;
	return { start: lineStart + match.index, end: at };
}

/**
 * Every `/credential` / `/cred` token in `buffer`, in document order.
 *
 * The re-anchor's vocabulary, never the arming rule: {@link CREDENTIAL_TOKEN}
 * has no end-of-line anchor, so a token it finds is not (yet) a gesture.
 */
export function tokenSpans(buffer: string): Span[] {
	const out: Span[] = [];
	// A module-level regex with `g` carries `lastIndex` between calls, so both
	// ends of the walk are reset: a caller that returned early would otherwise
	// leave the next call starting mid-buffer.
	CREDENTIAL_TOKEN.lastIndex = 0;
	for (
		let m = CREDENTIAL_TOKEN.exec(buffer);
		m !== null;
		m = CREDENTIAL_TOKEN.exec(buffer)
	) {
		// Both alternatives are zero-width (`^`, and the `\s` lookbehind), so the
		// match's own text is the token and its index is the token's start.
		out.push({ start: m.index, end: m.index + m[0].length });
	}
	CREDENTIAL_TOKEN.lastIndex = 0;
	return out;
}

/**
 * The word at the latched offset when it is this token MID-TYPING
 * (`_token_being_typed_at`, `editor.py:6013`), else `null`.
 *
 * Asked by {@link relocateArm} BEFORE any tie-break, and the reason is a
 * one-way migration the round that added it measured (UX round 2, U6): while
 * the operator types the token out — `/cred` → `/crede` → … → `/credential` —
 * the middle spellings match neither {@link CREDENTIAL_TOKEN} nor
 * {@link CREDENTIAL_ARM}, so the latched arm found nothing at its own anchor
 * and the nearest-match tie-break below moved it onto a DIFFERENT token
 * earlier in the line. That migration is one-way: the anchor travelled with
 * it, so "nearest" kept choosing the earlier token and the arm never came home
 * — and the operator's next secret was typed into the document in plaintext.
 */
function tokenBeingTypedAt(buffer: string, anchor: number): Span | null {
	// The reference's own lookbehind, restated for a slice: a word starts a
	// token run only at the buffer's start or after whitespace.
	if (anchor > 0 && !/\s/.test(buffer[anchor - 1] ?? " ")) return null;
	const match = CREDENTIAL_TOKEN_WORD.exec(buffer.slice(anchor));
	if (match === null) return null;
	const word = match[0].toLowerCase();
	if (word.length < CREDENTIAL_TOKEN_FLOOR.length) return null;
	if (!CREDENTIAL_TOKEN_FULL.startsWith(word)) return null;
	return { start: anchor, end: anchor + match[0].length };
}

/**
 * Where the token that armed is NOW, or `null` if it is gone.
 *
 * Rule 0 is the TYPED-THROUGH case: the operator's own word at the latched
 * offset, when it is a prefix of the token and at or above the `/cred` floor,
 * wins before any tie-break runs. Rule 1 is the anchor's own word, which is the
 * answer in every ordinary keystroke. Rule 2 is the single-match case: when the
 * buffer holds exactly one token there is no ambiguity — it is the token that
 * armed, however far the text before it moved — and returning it regardless of
 * distance is what keeps a block edit above the token from silently disarming.
 * Rule 3 is a TIE-BREAK among two or more tokens, never a distance test: a
 * distance bound of any size has a cliff, and past that cliff the token reads
 * as "gone" and the arm is dropped, which fails in the one direction that
 * cannot be undone — the next paste lands in plaintext (`editor.py:5930-5985`:
 * measured at exactly N=64 on the line above, N=63 still capturing).
 */
export function relocateArm(buffer: string, arm: Span): Span | null {
	const typedThrough = tokenBeingTypedAt(buffer, arm.start);
	if (typedThrough) return typedThrough;
	const spans = tokenSpans(buffer);
	const atAnchor = spans.find((span) => span.start === arm.start);
	if (atAnchor) return atAnchor;
	if (spans.length === 1) return spans[0];
	if (spans.length === 0) return null;
	let nearest = spans[0];
	let best = Math.abs(nearest.start - arm.start);
	for (const span of spans.slice(1)) {
		const distance = Math.abs(span.start - arm.start);
		if (distance < best) {
			nearest = span;
			best = distance;
		}
	}
	return nearest;
}

/**
 * Re-derive the capture after a buffer mutation, on the rule that a mutation
 * cannot arm.
 *
 * Three questions, in the order that makes each one cheap — the TUI's own order
 * (`_sync_credential_arm`):
 *
 * 1. Nothing latched, and the text was TYPED? Ask {@link armSpan} at the caret.
 *    This is the ONLY way to arm. An arrival (`"arrival"`) never arms, and
 *    never opens a span either, which is the desktop half of §2's rule and the
 *    reason a restored draft that happens to end in `/credential ` cannot
 *    swallow the operator's next paste.
 * 2. Latched, but the token is gone from the buffer? Disarm.
 * 3. Latched, token still there, and a flag-shaped argument now follows it on
 *    its own line? Disarm.
 *
 * Everything else KEEPS the arm — a newline, a typed word, a caret move — and
 * that is the point: those are the edits that used to disarm silently and land
 * the secret in plaintext, with nothing on screen having changed.
 *
 * It also opens the masked span, on the space that {@link CREDENTIAL_OPEN_SPACE}
 * documents: the arm's own end IS the offset after the space (the span consumes
 * the token's trailing whitespace), so "the space was the character the caret
 * just passed" and "the caret is at the arm's end" are one test. Stated about
 * the BUFFER rather than as a flag at the call site, because the two routes
 * that reach it — a hand-typed space and the trailing space a completion
 * appends — are the same character at the same offset, and two flags would be
 * two rules that drift until one route silently stopped masking.
 *
 * The caret moving OUT of an open span ends the TYPING state without
 * disclosing anything (`editor.py:2035`, "a caret move is not a request for the
 * plaintext back"), and the mask cells stay where they are as inert text; the
 * value is dropped with the state, so the two can never disagree about a
 * secret. Returning to the token re-opens the span on the next typed
 * character, which is the positional rule the alternative — leaving the
 * capture open with the caret elsewhere — gets wrong by design: it would
 * append to the value in one place while inserting its cell in another.
 */
export function syncCapture(
	capture: Capture,
	buffer: string,
	caret: number,
	arrival: Arrival,
): Capture {
	// The two powers, kept apart because they fail in opposite directions: a
	// false NEGATIVE ("I thought I was armed") puts the secret on screen and in
	// scrollback where no keystroke can undo it, while a false POSITIVE costs one
	// backspace.
	const mayArm = arrival === "typing" || arrival === "completion";
	const mayOpen = mayArm || arrival === "caret";
	if (capture.arm === null) {
		if (capture.typingAt !== null) return IDLE_CAPTURE;
		if (!mayArm) return capture;
		const span = armSpan(buffer, caret);
		if (span === null) return capture;
		return { arm: span, typingAt: null, value: "" };
	}

	const arm = relocateArm(buffer, capture.arm);
	if (arm === null) return IDLE_CAPTURE;

	// The flag rule is asked of the text between the token's end and the end of
	// its own line, because that is the line the command's own arguments live
	// on (`/credential --forget-all`).
	const lineEnd = buffer.indexOf("\n", arm.end);
	const tail = buffer.slice(arm.end, lineEnd === -1 ? buffer.length : lineEnd);
	if (CREDENTIAL_ARGUMENT.test(tail)) return IDLE_CAPTURE;

	/*
	 * The span consumes the token's TRAILING SPACES, which is what the
	 * caret-anchored version got for free by ending at the caret. The marker
	 * replaces the whole span and carries its own trailing space, so stopping
	 * at the token would leave the operator's space behind and the buffer would
	 * read `[Credential #1, 64 chars]  ` — two spaces, one of them theirs and
	 * now meaningless.
	 */
	const trailing = tail.length - tail.replace(LEADING_BLANKS, "").length;
	const extended: Span = { start: arm.start, end: arm.end + trailing };

	const typingAt = capture.typingAt;
	if (typingAt !== null) {
		const end = typingAt + charsOf(capture.value).length;
		// Inside the span, END INCLUSIVE: the caret at the span's end is where
		// typing continues, and a plain `<=` here would close the span on the
		// keystroke that was supposed to be masked.
		if (caret < typingAt || caret > end) {
			// The caret left. The value is dropped WITH the state, so the two can
			// never disagree about a secret; the cells stay in the buffer, inert,
			// because a caret move is not a request to delete what the operator
			// can see.
			return { arm: extended, typingAt: null, value: "" };
		}
		return { arm: extended, typingAt, value: capture.value };
	}

	if (
		mayOpen &&
		caret === extended.end &&
		buffer[caret - 1] === CREDENTIAL_OPEN_SPACE
	) {
		return { arm: extended, typingAt: caret, value: "" };
	}
	return { arm: extended, typingAt: null, value: "" };
}

/** Whether a masked span is open. */
export const isTyping = (capture: Capture): boolean =>
	capture.typingAt !== null;

/** Whether the gesture is armed, whether or not the span is open yet. */
export const isArmed = (capture: Capture): boolean => capture.arm !== null;

/** The buffer offsets the mask cells occupy, or `null` when no span is open. */
export function maskSpan(capture: Capture): Span | null {
	if (capture.typingAt === null) return null;
	return {
		start: capture.typingAt,
		end: capture.typingAt + charsOf(capture.value).length,
	};
}

/** What {@link maskEdit} changed, given the buffer and caret it produced. */
export type MaskedEdit = { capture: Capture; buffer: string; caret: number };

/**
 * Apply ONE buffer edit to the held value, at the index the operator sees.
 *
 * THE HELD VALUE IS A MIRROR OF THE MASK CELLS, and this is the one place the
 * two are kept in step (`_credential_edit_mirror`, `editor.py:6242-6323`). Every
 * buffer mutation funnels through here, so an edit that moves, removes or
 * splits mask cells applies to the value AT THE SAME INDEX — which makes
 * arrow-then-type, Backspace, Delete and select-and-replace all correct by one
 * rule instead of four agreeing key handlers.
 *
 * WHY A MIRROR AND NOT AN APPEND: the mask cell was always inserted at the
 * caret while the value appended to the end, so `ABCDEFGH` + left-left + `xy`
 * stored `ABCDEFGHxy` for an intended `ABCDEFxyGH`, and the chip reported the
 * right LENGTH with the wrong ORDER — the documented integrity check passing on
 * a wrong value that can never be displayed again to catch it. It surfaces days
 * later as an auth failure with nothing tying it to the keystroke.
 *
 * `edit` is the edit as the DOM expressed it: the half-open range `[top,
 * bottom)` of the OLD buffer that the edit replaced, and the text that replaced
 * it (`""` for a deletion). Positions are read from the old buffer because the
 * mapping from a buffer offset to an index in the value only exists while the
 * buffer still holds the cells the value stands for.
 *
 * It returns the buffer too, because the character that was typed must not BE
 * in it: the inserted text is replaced by one mask cell per character, in the
 * same single edit, so the secret never enters the document even transiently.
 * The caller passes the buffer the browser would have produced; this function
 * masks it. One function for both routes (an intercepted keystroke, which never
 * reaches the DOM, and a structural edit the browser applied) because they are
 * one rule about the document.
 *
 * `null` for every edit that cannot touch an open span — no span open, or the
 * edit entirely outside it — so the common keystroke pays one comparison.
 */
export function maskEdit(
	capture: Capture,
	buffer: string,
	caret: number,
	edit: { top: number; bottom: number; inserted: string },
): MaskedEdit | null {
	const span = maskSpan(capture);
	if (span === null) return null;
	const { top, bottom, inserted } = edit;
	// Wholly outside the span, on either side. `>` and `<` rather than `>=` and
	// `<=`: an edit that merely ABUTS the span — a character typed at its end,
	// the commonest keystroke of all — does touch it.
	if (top > span.end || bottom < span.start) return null;

	const held = charsOf(capture.value);
	// Clamped into the span, so an edit STRADDLING its edge — a selection begun
	// in the token and dragged into the secret — removes only the part that was
	// actually held. `top`/`bottom` are offsets in the OLD buffer, which is the
	// only frame in which a cell's index in the value exists.
	const cutFrom = clamp(top - span.start, 0, held.length);
	const cutTo = clamp(bottom - span.start, 0, held.length);
	const insertedChars = charsOf(inserted);
	const value = [
		...held.slice(0, cutFrom),
		...insertedChars,
		...held.slice(cutTo),
	].join("");

	// In the buffer the edit produced, the inserted text occupies
	// `[top, top + inserted.length)` — NOT `[top, bottom)`, which is the range it
	// replaced in the OLD buffer. The two differ for every deletion, and using
	// the old range there removed one more character than the operator did.
	const replacedTo = top + insertedChars.length;
	const masked =
		buffer.slice(0, top) +
		MASK_CELL.repeat(insertedChars.length) +
		buffer.slice(replacedTo);
	// The caret needs almost no adjustment, and the reason is the masking rule
	// itself: ONE CELL REPLACES ONE CHARACTER, so text that is all BMP leaves the
	// buffer the same length it was and the caret where the browser put it. The
	// only delta comes from an astral character, which is one code point and so
	// one cell against two UTF-16 units.
	const delta = insertedChars.length - inserted.length;
	const next = caret >= replacedTo ? caret + delta : caret;
	return { buffer: masked, caret: next, capture: { ...capture, value } };
}

/**
 * Type into an open span, or leave text to land as ordinary text.
 *
 * THREE RULES, and all three are the TUI's, from one key handler
 * (`editor.py:2890-3012`):
 *
 * 1. A LEADING `-` INTO AN EMPTY SPAN IS THE COMMAND, NOT A SECRET, and it must
 *    escape the mask before it is masked. It is the same partition
 *    {@link CREDENTIAL_ARGUMENT} draws for the pasted path, honoured here so the
 *    two agree: the credential verbs are flag-shaped (`--forget`, `--forget-all`)
 *    precisely so they can never collide with a key, because keys normalize to
 *    `[A-Z0-9_]` and cannot begin with `-`. Without it the destructive verbs
 *    became untypable — the opening space starts masking, so
 *    `/credential --forget-all` went in as a masked eight-character "secret" and
 *    Enter minted a chip instead of forgetting anything. The character lands as
 *    PLAINTEXT and the arm then disarms on the flag rule.
 * 2. AN EXPLICIT NEWLINE ENDS THE CAPTURE rather than being masked, and that is
 *    a correctness requirement rather than a preference: the masked span is a
 *    CONTIGUOUS run of cells and the mint splices `[token, span end)`, so a
 *    newline inside it occupies an offset that is not a cell and every character
 *    typed after it puts the computed end further out of step with what is on
 *    screen — measured in the TUI: the splice left an orphaned bullet and
 *    mis-reported the span. It is also the honest reading of the gesture: a
 *    secret is a single-line value, Enter already terminates it, and an operator
 *    pressing shift+enter is composing the prose around the chip. Abandoned
 *    rather than cancelled, for the same reason a caret move is. A MULTI-LINE
 *    secret still works, through the PASTE route, which takes the whole value in
 *    one edit.
 * 3. Everything else printable is masked, spliced positionally, and never
 *    reaches the document.
 *
 * The caller passes the edit: `[selection.start, selection.end)` is replaced
 * with one cell per character of `text`, which is what makes select-and-replace
 * land where the operator sees it. With no span open the text lands as ordinary
 * text, so a caller can route every printable keystroke through here.
 */
export function typeIntoCapture(
	capture: Capture,
	buffer: string,
	selection: Span,
	text: string,
): MaskedEdit {
	const plain: MaskedEdit = {
		capture,
		buffer:
			buffer.slice(0, selection.start) + text + buffer.slice(selection.end),
		caret: selection.start + text.length,
	};

	const leadingFlag =
		isTyping(capture) && capture.value === "" && text.startsWith("-");
	if (isTyping(capture) && (leadingFlag || text.includes("\n"))) {
		// Both exits ABANDON rather than cancel: the operator moved on, and
		// writing the held characters out here would put a secret in the document
		// behind their back, at a moment they are not looking at the span.
		const abandoned = abandonTyping(capture);
		if (text.includes("\n")) return { ...plain, capture: abandoned };
		// The `-` is plaintext, and the ARM is re-decided from the buffer on the
		// way out: the flag rule (`[ \t]+-` on the token's own line) is what ends
		// the gesture, so the typed and pasted spellings of the command agree.
		return {
			...plain,
			capture: syncCapture(abandoned, plain.buffer, plain.caret, "typing"),
		};
	}

	return (
		maskEdit(capture, plain.buffer, plain.caret, {
			top: selection.start,
			bottom: selection.end,
			inserted: text,
		}) ?? plain
	);
}

/** `typeIntoCapture` from a bare caret, which is every route but a selection. */
export function typeAtCaret(
	capture: Capture,
	buffer: string,
	caret: number,
	text: string,
): MaskedEdit {
	return typeIntoCapture(capture, buffer, { start: caret, end: caret }, text);
}

/**
 * End a typed capture WITHOUT restoring the secret, leaving the cells in place.
 *
 * The exit for the states where the operator has moved on rather than cancelled
 * (`_abandon_credential_typing`, `editor.py:6492`): the caret left the masked
 * span, an explicit newline was typed, a flag-shaped `-` opened the span's
 * arguments, the buffer was replaced, the draft was submitted. Restoring the
 * plaintext there would push a secret into the document behind the operator's
 * back, at a moment they are not looking at the span — the opposite of what Esc
 * does, and deliberately so, because Esc is an explicit request and these are
 * not.
 */
export function abandonTyping(capture: Capture): Capture {
	if (!isTyping(capture)) return capture;
	return { arm: capture.arm, typingAt: null, value: "" };
}

/**
 * The single splice that turns `prev` into `next`, in the OLD buffer's terms.
 *
 * `top`/`bottom` delimit the replaced range of `prev` and `inserted` is what
 * stands there in `next`. Two buffers that differ in several places collapse
 * into one spanning splice, which is the safe reading: an edit this code cannot
 * describe is mirrored as if the operator had replaced the whole changed region.
 *
 * The prefix/suffix walk is what makes an edit REPORTABLE at all from a DOM text
 * control. The DOM hands back a value and a caret; the offsets a positional
 * mirror needs are not in it, and a caller that guessed ("the caret moved one
 * right, so a character was typed") is wrong for every insertion the browser
 * makes on its own — a drop, an IME commit, a spellchecker replacement.
 */
export function spliceBetween(
	prev: string,
	next: string,
): { top: number; bottom: number; inserted: string } {
	let top = 0;
	const max = Math.min(prev.length, next.length);
	while (top < max && prev[top] === next[top]) top++;
	let tailPrev = prev.length;
	let tailNext = next.length;
	while (
		tailPrev > top &&
		tailNext > top &&
		prev[tailPrev - 1] === next[tailNext - 1]
	) {
		tailPrev--;
		tailNext--;
	}
	return { top, bottom: tailPrev, inserted: next.slice(top, tailNext) };
}

/**
 * Apply an edit the DOM has ALREADY made, mirroring it into the held value.
 *
 * ONE entry point for every buffer mutation that reaches the composer as a
 * change — Backspace, Delete, a selection, a drop, an IME commit, and the
 * ordinary paste that falls through — which is what makes the mirror a funnel
 * rather than four agreeing key handlers. The two intercepted routes
 * ({@link typeIntoCapture}, {@link capturePasted}) do not come through here,
 * because they never let the character reach the DOM in the first place; they
 * are still the SAME rule about the document, stated once in {@link maskEdit}.
 *
 * `origin` is passed through to {@link syncCapture}, so a change the operator
 * did not type never arms the gesture (§2).
 *
 * TEXT ARRIVING INTO AN OPEN SPAN IS REFUSED, not mirrored, and that is the
 * reference's own rule (`editor.py:6312-6323`: "Text arriving into an open span
 * that is NOT a mask cell … leave the value untouched rather than silently
 * corrupting it"). Dropping a filename or a snippet onto the composer mid-capture
 * used to be appended to the held value, so the pill's count changed and the
 * secret was wrong — silently, and in the one place the operator cannot read it
 * back to notice. `editor.py` can state the rule as a guard rather than a case
 * because every printable key is masked and every exit closes the capture first;
 * here the DOM route genuinely carries text (a drop, an IME commit, a
 * spellchecker replacement, an autofill), so this is a live case rather than a
 * defensive one.
 *
 * The capture ENDS rather than the value staying put, which is a deliberate
 * divergence in mechanism with the same intent. The reference's `return None`
 * leaves the held value alone and lets `super().edit()` put the real characters
 * in the buffer — safe there only because no route can reach it. Here the
 * document would then hold literal text among the bullets, which is precisely
 * the desynchronised cell run {@link maskEdit} exists to prevent, so the port
 * takes the answer it already takes for the blank-paste-inside-the-span case
 * ({@link pastePassthrough}, which cites this same reference): the capture ends,
 * the arriving text lands as ordinary text the operator can see and redo.
 *
 * Deletions are NOT refused — `inserted === ""` is the operator's own Backspace,
 * Delete or selection, which is what the positional mirror is for.
 */
export function applyDomEdit(
	capture: Capture,
	prev: string,
	next: string,
	caret: number,
	origin: Arrival,
): MaskedEdit {
	const edit = spliceBetween(prev, next);
	const span = maskSpan(capture);
	let out: MaskedEdit = { capture, buffer: next, caret };
	if (
		edit.inserted !== "" &&
		span !== null &&
		edit.top <= span.end &&
		edit.bottom >= span.start
	) {
		out = { capture: abandonTyping(capture), buffer: next, caret };
	} else {
		const masked = maskEdit(capture, next, caret, edit);
		if (masked) {
			out = masked;
		} else if (isTyping(capture) && edit.inserted.includes("\n")) {
			// The same newline rule as the typed route, for the routes that reach the
			// document without a keystroke (an IME commit, a drop of multi-line text):
			// a newline inside the contiguous cell run desynchronises the mint's
			// splice, so the capture ends and the text lands as ordinary text.
			out = { capture: abandonTyping(capture), buffer: next, caret };
		}
	}
	return {
		...out,
		capture: syncCapture(out.capture, out.buffer, out.caret, origin),
	};
}

/** What a mint produced. `minted: false` means Enter must fall through. */
export type MintResult = {
	minted: boolean;
	capture: Capture;
	buffer: string;
	caret: number;
	payload: CredentialPayload | null;
};

/**
 * Enter while TYPING: turn token + masked span into a pill.
 *
 * ENTER ENDS THE SECRET; IT DOES NOT SUBMIT THE MESSAGE. The gesture is "hand
 * over a secret and then describe it" — the operator types `/credential`, the
 * secret, Enter, and then keeps typing prose around the pill. An Enter that
 * also submitted would make that description impossible to write, because the
 * message would leave the moment the secret ended.
 *
 * AN EMPTY SECRET MINTS NOTHING (`_mint_typed_credential`, `editor.py:6396`): a
 * zero-length credential would advertise a key to the model that can never hold
 * anything, and the store refuses a blank value regardless. `minted: false`
 * with the capture UNCHANGED, so Enter falls through to submit — and an
 * operator who simply has not typed yet is not silently disarmed by a stray
 * keypress.
 *
 * ONE EDIT replaces the token, the delimiting space AND every mask cell
 * (`editor.py:6404-6417`), which keeps it a single undoable step and leaves no
 * intermediate document state holding a partly revealed secret. It cannot
 * reveal one in any case: the document never held it.
 *
 * THE CARET LANDS AFTER `marker + " "` here, where the TUI's typed mint lands
 * it immediately after the marker with no space at all
 * (`editor.py:6404-6417` replaces with `marker` alone) while its PASTE route
 * appends one (`_capture_credential` returns `marker + " "`). The design
 * document §4 specifies `marker + " "` for both, and the two routes agreeing is
 * what makes "typing continues inline after a pill" true in the middle of
 * prose; the TUI's own inconsistency is a defect in the TUI rather than a rule
 * to copy. Reported in the pull request as a deliberate divergence.
 */
export function mintTypedCredential(args: {
	capture: Capture;
	buffer: string;
	caret: number;
	index: number;
	taken: Iterable<string>;
	draw?: Draw;
}): MintResult {
	const { capture, buffer, caret, index, taken } = args;
	const span = maskSpan(capture);
	if (span === null || capture.value === "") {
		// Nothing to mint, and the state is handed back UNCHANGED so an empty
		// span is not silently disarmed by a stray Enter: the caller falls
		// through to submit, which is what `/credential ` + Enter means (the
		// token that reaches the dispatcher opens the picker).
		return { minted: false, capture, buffer, caret, payload: null };
	}
	// The token is consumed with the span: the gesture is not prose, and
	// leaving it behind would send `deploy with /credential [credential ...]`
	// to the model where an image paste leaves no command word behind. It would
	// also leave a line STARTING with the token, which is the shape the slash
	// dispatcher refuses.
	const start = capture.arm === null ? span.start : capture.arm.start;
	const marker = credentialMarker(index, capture.value);
	const replacement = marker + CREDENTIAL_OPEN_SPACE;
	const next = buffer.slice(0, start) + replacement + buffer.slice(span.end);
	return {
		minted: true,
		capture: IDLE_CAPTURE,
		buffer: next,
		caret: start + replacement.length,
		payload: {
			index,
			key: generateCredentialKey(taken, args.draw),
			value: capture.value,
			marker,
		},
	};
}

/**
 * A token the composer knows it has just cancelled: the exact run, and where it
 * sat when the cancel produced it (`cancelTypedCredential`).
 *
 * The span is the ARRIVAL position, not a live one — see
 * {@link holdsCancelledToken}, which is the only thing that reads it.
 */
export type CancelledToken = { span: Span; text: string };

/** What an Escape cancel produced: the plaintext back, and nothing else. */
export type CancelResult = {
	cancelled: boolean;
	capture: Capture;
	buffer: string;
	caret: number;
	/** How many characters were restored, for the announcement. Never the value. */
	restored: number;
	/**
	 * The inert token run the cancel left in the buffer, or `null` when nothing
	 * was restored.
	 *
	 * Reported only for a cancel that RESTORED characters, and that scoping is
	 * the whole point of it. An empty-span cancel owes no promise — its notice is
	 * suppressed — so `/credential ` + Enter must still reach the dispatcher and
	 * open the picker, which is the route §1 keeps open to the store, the list
	 * and the forget verbs. A cancel that restored characters is the one the
	 * composer has just told the operator "Enter will expose them" about, and
	 * that promise is what a `/credential`-shaped leading token would otherwise
	 * break (QA round 1, Q2).
	 */
	token: CancelledToken | null;
};

/**
 * Esc while TYPING: give the operator their characters back.
 *
 * UNREDACTS RATHER THAN DISCARDS (`_cancel_credential_typing`,
 * `editor.py:6419-6500`). An operator who typed a long secret and pressed Esc
 * because they meant it as prose gets exactly what they typed; an operator who
 * wanted it gone deletes it with the keystrokes they would use for any other
 * text. Discarding silently would be unrecoverable in the one direction that
 * matters — retyping a secret is precisely what an operator cannot do from
 * memory.
 *
 * This is the ONLY route by which a typed secret enters the document, and it is
 * the operator explicitly asking for it: at that point it is their prose, not a
 * credential. The arm ends with it, because leaving the token armed would put
 * the composer in a state where the next paste is still swallowed as a
 * credential after the operator has visibly backed out.
 *
 * THE EMPTY-SPAN CASE IS THE SAME CANCEL and is called out because it is the
 * regression the TUI shipped twice (`editor.py:6146-6155`): with no characters
 * to restore, a cancel that re-entered the arm sync found `/credential ` still
 * ending its own line — still matching the predicate — and RE-ARMED, so Esc was
 * inert and the prose typed next became a credential. The disarm here is
 * unconditional and `restored: 0` owes no announcement.
 *
 * The token and its delimiting space are left behind as inert literal text:
 * they are visible, they are not a mode, and the next typed character makes the
 * line stop matching the arming predicate on its own.
 */
export function cancelTypedCredential(
	capture: Capture,
	buffer: string,
): CancelResult {
	const span = maskSpan(capture);
	if (span === null) {
		return {
			cancelled: false,
			capture,
			buffer,
			caret: 0,
			restored: 0,
			token: null,
		};
	}
	const restoredText = capture.value;
	const next =
		buffer.slice(0, span.start) + restoredText + buffer.slice(span.end);
	const tokenStart = capture.arm === null ? span.start : capture.arm.start;
	return {
		cancelled: true,
		capture: IDLE_CAPTURE,
		buffer: next,
		caret: span.start + restoredText.length,
		restored: charCount(restoredText),
		token:
			restoredText.length > 0 && span.start > tokenStart
				? {
						span: { start: tokenStart, end: span.start },
						text: buffer.slice(tokenStart, span.start),
					}
				: null,
	};
}

/**
 * Whether the buffer still holds the token a cancel just left inert, at the
 * offset the cancel left it at.
 *
 * THE SUBMISSION SEAM'S HALF OF THE CANCEL, and the reason it is a predicate over
 * the ARRIVAL offset rather than a flag the composer toggles: "cleared by any
 * edit that moves it" is exactly `buffer.slice(start, start + text.length) ===
 * text`. An edit that inserts before the token shifts it and this answers
 * `false`, so the token is ordinary text again and the dispatcher may have it; an
 * edit elsewhere in the line — the operator writing the rest of their sentence
 * around the restored characters — leaves it `true`, which is the case that
 * matters, because that is the draft the notice promised Enter would expose.
 *
 * Nothing else has to be cleared by hand, and nothing can go stale: a held
 * offset is only ever read against the buffer it was measured in.
 */
export function holdsCancelledToken(
	buffer: string,
	token: CancelledToken | null,
): boolean {
	if (token === null || token.text.length === 0) return false;
	return buffer.slice(token.span.start, token.span.start + token.text.length) === token.text;
}

/** What a captured paste produced. */
export type PasteCapture = {
	/**
	 * `"masked"` appended into the open span; `"minted"` took a new pill;
	 * `"passthrough"` captured NOTHING (a blank paste) and left the text to land
	 * as ordinary text.
	 */
	kind: "masked" | "minted" | "passthrough";
	capture: Capture;
	buffer: string;
	caret: number;
	payload: CredentialPayload | null;
};

/**
 * Where a pasted BLANK lands, without letting the cells and the value part.
 *
 * The paste captured nothing, so the text is the operator's own and lands as
 * text — which means the masked span has to absorb it without a real character
 * appearing among the cells. Three positions, and the middle one is the case
 * the TUI answers by corrupting the pair:
 *
 * - at or before the span's start (the empty-span case, and a caret at the
 *   run's first cell): the cells SHIFT with the text, so the run stays
 *   contiguous and the value is untouched;
 * - at or after the span's end: contiguous as they were, value untouched;
 * - strictly inside: a plaintext character among the bullets would put the run
 *   out of step with the value, so the capture ENDS rather than the value being
 *   silently corrupted — the mirror's own guard, `editor.py:6312-6323`.
 */
function pastePassthrough(
	capture: Capture,
	buffer: string,
	selection: Span,
	text: string,
): PasteCapture {
	const next =
		buffer.slice(0, selection.start) + text + buffer.slice(selection.end);
	const caret = selection.start + text.length;
	const span = maskSpan(capture);
	if (span === null)
		return { kind: "passthrough", capture, buffer: next, caret, payload: null };
	if (selection.start <= span.start) {
		return {
			kind: "passthrough",
			capture: { ...capture, typingAt: span.start + text.length },
			buffer: next,
			caret,
			payload: null,
		};
	}
	if (selection.start >= span.end) {
		return { kind: "passthrough", capture, buffer: next, caret, payload: null };
	}
	return {
		kind: "passthrough",
		capture: abandonTyping(capture),
		buffer: next,
		caret,
		payload: null,
	};
}

/**
 * The credential gate for a paste — the FIRST branch, ahead of every size and
 * whitespace rule (`Editor._on_paste`, `editor.py:5194-5261`).
 *
 * It is a MODE question ("did the operator just type `/credential` here?"), not
 * a question about the payload: a one-line API key is nowhere near the
 * thresholds the ordinary paste branches ask, so asking them first would insert
 * the secret verbatim and the redaction would never happen at all.
 *
 * - paste with an open NON-EMPTY span appends into the same secret through the
 *   same masking path. Typing a prefix and pasting the rest is an ordinary way
 *   to enter a partly memorised key, and two pills would split one credential
 *   into two values the model cannot recombine;
 * - paste with an open EMPTY span closes the span and then captures, so the
 *   gesture that shipped first — `/credential ` then paste — still mints
 *   instantly in place. Scoped to the EMPTY value on purpose: appending there
 *   would leave the paste masked and unchipped until a further Enter;
 * - otherwise the pasted text is captured directly: `value = pasted.trim()`, an
 *   EMPTY OR WHITESPACE-ONLY paste captures NOTHING and returns `null` so the
 *   caller falls through to the ordinary paste (a zero-length credential would
 *   advertise a key that can never hold anything, and the store refuses a blank
 *   anyway);
 * - the capture is INSTANT in one edit — never masked character by character —
 *   and it DISARMS, so a second paste means retyping the token. The first
 *   marker stays cited and its payload untouched ("It is not a replacement").
 *
 * The arming token is replaced by the marker in the same edit, so one step does
 * both halves of the gesture: the command word disappears and the receipt takes
 * its place, leaving the caret past the trailing space ready for the
 * description.
 */
export function capturePasted(args: {
	capture: Capture;
	buffer: string;
	caret: number;
	selection: Span;
	pasted: string;
	index: number;
	taken: Iterable<string>;
	draw?: Draw;
}): PasteCapture | null {
	const { capture, buffer, caret, pasted } = args;
	if (capture.arm === null) return null;

	if (capture.typingAt !== null && capture.value !== "") {
		if (pasted === "") return null;
		const masked = maskEdit(capture, buffer, caret, {
			top: args.selection.start,
			bottom: args.selection.end,
			inserted: pasted,
		});
		if (masked === null) return null;
		return { kind: "masked", ...masked, payload: null };
	}

	const value = pasted.trim();
	if (!value) {
		// NOTHING IS CAPTURED: a zero-length credential would advertise a key that
		// can never hold anything, and the store refuses a blank anyway. The text
		// lands as the operator's own — see `pastePassthrough`.
		if (pasted === "") return null;
		return pastePassthrough(capture, buffer, args.selection, pasted);
	}

	// An empty open span is CLOSED before the paste mints, so the capture state
	// cannot outlive the pill that supersedes it and leave the composer masking
	// keystrokes after a visible receipt.
	const arm = capture.arm;
	const marker = credentialMarker(args.index, value);
	const replacement = marker + CREDENTIAL_OPEN_SPACE;
	const next = buffer.slice(0, arm.start) + replacement + buffer.slice(arm.end);
	return {
		kind: "minted",
		capture: IDLE_CAPTURE,
		buffer: next,
		caret: arm.start + replacement.length,
		payload: {
			index: args.index,
			key: generateCredentialKey(args.taken, args.draw),
			value,
			marker,
		},
	};
}

/** A credential's receipt tail: ALWAYS `<n> chars`, never `<n> lines`. */
export const credentialLabel = (value: string): string =>
	`${charCount(value)} chars`;

/** The marker text that cites `index`'s payload. */
export const credentialMarker = (index: number, value: string): string =>
	`[Credential #${index}, ${credentialLabel(value)}]`;

/** The marker's own index, or `null` when `marker` is not one of ours. */
export function markerIndex(marker: string): number | null {
	CREDENTIAL_MARKER.lastIndex = 0;
	const match = CREDENTIAL_MARKER.exec(marker);
	CREDENTIAL_MARKER.lastIndex = 0;
	if (match === null || match[0] !== marker) return null;
	return Number.parseInt(match[1], 10);
}

/**
 * The span of the APP's citation of `payload` in `text`, or `null`.
 *
 * A citation counts as the app's own only when the marker text matches the
 * payload's own recorded marker AND the index matches (design §4). Both halves
 * are checked, and the index half is not decoration: the marker's index is what
 * the citation CLAIMS, and a marker whose tail was edited by hand — the one
 * case that can differ from a recorded marker at all — is prose, because
 * nothing in the buffer then says the secret is behind it.
 *
 * THE INDEX HALF IS ASKED FIRST, and it is asked of the PAYLOAD rather than of
 * the buffer. It used to run after the buffer's `indexOf` had already found the
 * marker, which made it dead code for every payload this composer can build —
 * `credentialMarker` writes both halves from one index — so deleting it left the
 * suite green while §4's "index AND marker text" was enforced by the text half
 * alone (code review round 1, MINOR-1). The halves are separable only for a
 * payload whose two fields disagree, which nothing in production builds; the
 * predicate is therefore reachable by the test that builds one by hand, and the
 * two halves stay an AND in the reading order that costs least.
 *
 * HOW THIS DIFFERS FROM THE TUI, deliberately. `cite` (`editor.py:995-1018`)
 * prefers the exact marker text and then FALLS BACK to the first citation of
 * the same NUMBER when no exact match survives, so a credential whose tail the
 * operator edited is still substituted there. The design document's §4 asks for
 * index AND marker text with no fallback, and the strict reading is the safe one
 * for a CREDENTIAL: the fallback's whole purpose is that an image whose tail was
 * edited is not orphaned, and mis-substituting a secret's name is a different
 * class of harm from mis-naming a screenshot. Reported in the pull request.
 */
export function citationSpan(
	text: string,
	payload: CredentialPayload,
): Span | null {
	if (markerIndex(payload.marker) !== payload.index) return null;
	const at = text.indexOf(payload.marker);
	if (at === -1) return null;
	return { start: at, end: at + payload.marker.length };
}

/**
 * The credentials `text` still cites, in CITATION ORDER (design §9.1).
 *
 * A marker the operator backspaced away is not cited, so its secret is never
 * stored — the same rule that drops an uncited image. Order is document order
 * rather than index order, because the citation is what the model reads and the
 * receipt the operator sees is what it describes (`credential_payloads`,
 * `editor.py:725-741`, sorts by the span's start).
 */
export function citedPayloads(
	text: string,
	payloads: Iterable<CredentialPayload>,
): CredentialPayload[] {
	const cited: { at: number; payload: CredentialPayload }[] = [];
	for (const payload of payloads) {
		const span = citationSpan(text, payload);
		if (span === null) continue;
		cited.push({ at: span.start, payload });
	}
	return cited.sort((a, b) => a.at - b.at).map((entry) => entry.payload);
}

/**
 * Why a credential's value did not reach the store.
 *
 * The TUI's `CredentialStoreFailure` vocabulary, narrowed to what this
 * transport can actually distinguish — see {@link describeUnstored}.
 */
export type UnstoredReason = "unreachable" | "rejected-key" | "lost";

/**
 * The citation a credential gets when its value did NOT reach the store.
 *
 * ONE AUTHORITY for these phrases, because two paths write them — the per-key
 * rewrite below and the whole-message degrade — and a model reading two
 * different sentences for one outcome would have to guess whether they mean
 * different things (`describe_unstored`, `editor.py:743-775`).
 *
 * In every form the sentence states the OUTCOME the agent must act on — there is
 * no usable credential here — before it explains the cause, because an agent
 * that reads only the first clause must still not go hunting an env var nobody
 * set. And no form names a privileged process: the failure is stated as what
 * happened, never as a topology the operator is invited to think about.
 *
 * WHICH CAUSE THE DESKTOP CAN NAME, stated exactly because it is narrower than
 * the TUI's. `POST /v1/desktop/sessions/{id}/credentials` collapses every store
 * refusal into one 409 (`server/routes/desktop_lifecycle.py:161-172`): the
 * store's own `reason` never crosses the wire. So this end infers:
 * `"unreachable"` when there is no session to reach or the call did not land,
 * and `"lost"` when the store was reached and said no — which, for a key this
 * composer minted against `CREDENTIAL_KEY_PATTERN`, is a blank VALUE: the key
 * cannot be the problem, so the reachable refusal is the restored draft whose
 * bytes do not survive (§6). `"rejected-key"` is kept in the vocabulary because
 * the phrase is the TUI's and a future transport that reports the reason must
 * not have to invent a fourth sentence; nothing in this port produces it.
 */
export function describeUnstored(reason: UnstoredReason): string {
	if (reason === "unreachable")
		return "[credential NOT stored — the session could not be reached; try again]";
	if (reason === "rejected-key")
		return "[credential NOT stored — the store rejected its name]";
	return "[credential NOT stored — its value did not survive; ask the operator to paste it again]";
}

/** The citation a STORED credential gets: the three facts the agent needs. */
export const credentialCitation = (payload: CredentialPayload): string =>
	`[credential ${payload.key} (${credentialLabel(payload.value)}) — available to ` +
	`bash and eval as $${payload.key}; its value cannot be read]`;

/**
 * `text` with each credential citation rewritten to NAME the credential.
 *
 * The one transformation a credential marker gets on its way to the model, and
 * it is a substitution rather than an expansion: the VALUE is replaced by the
 * store key, never by the secret.
 *
 * WHY THE MARKER IS REWRITTEN AT ALL: `#1` is a COMPOSER-local label that
 * resets every submit, so a model told only `[Credential #1]` learns that a
 * secret exists and has no way to USE it — it cannot name the env var, which is
 * the entire point of the session credential store. Substituting the key turns
 * the marker into the three facts the agent needs while keeping the operator's
 * own description, typed around the marker, exactly where they typed it.
 *
 * EVERY citation is rewritten, whether it stored or not: a marker left alone
 * would send a composer-local `[Credential #1, 52 chars]` that the model cannot
 * use, and a name it cannot use is the silent failure this whole path exists to
 * remove. A refused one gets {@link describeUnstored} instead of the confident
 * form, PER PAYLOAD — one refusal among several successes must not advertise a
 * key nothing holds (`substitute_credentials`, `editor.py:777-834`).
 *
 * Spliced DESCENDING, so an earlier replacement cannot invalidate a later
 * offset. A marker that appears twice in the buffer is rewritten ONCE, at its
 * first occurrence: the citation is the app's own the first time it can be
 * found, and the second copy is text the operator duplicated, which no rule
 * here can tell from prose.
 */
export function substituteCredentials(
	text: string,
	payloads: Iterable<CredentialPayload>,
	refused: Map<number, UnstoredReason> = new Map(),
): string {
	const spans: { span: Span; payload: CredentialPayload }[] = [];
	for (const payload of payloads) {
		const span = citationSpan(text, payload);
		if (span === null) continue;
		spans.push({ span, payload });
	}
	let out = text;
	for (const { span, payload } of spans.sort(
		(a, b) => b.span.start - a.span.start,
	)) {
		const reason = refused.get(payload.index);
		const named =
			reason === undefined
				? credentialCitation(payload)
				: describeUnstored(reason);
		out = out.slice(0, span.start) + named + out.slice(span.end);
	}
	return out;
}

/**
 * The one notice the operator hears when values landed (§9.4), the TUI's own
 * sentence (`app.py:33884`), plural-safe because two pastes while armed capture
 * two credentials.
 *
 * The stored keys are announced to the MODEL by the session side, by the same
 * verb that stored them, so this is the operator's half.
 */
export const storedNotice = (keys: readonly string[]): string =>
	`Stored ${keys.join(", ")}. Injected into every bash command as an environment variable; the agent cannot read the value.`;

/**
 * The notice for a store that refused or could not be reached (§9.4), naming
 * the retry that actually WORKS.
 *
 * It has to be followable, unlike the notice this replaces: typing
 * `/credential <KEY>` cannot reach any store, because the space after the token
 * opens a masked capture and the KEY NAME is minted as a short secret. Arming
 * `/credential` and pasting the value again is the one gesture that retries a
 * store (`app.py:33815-33836`).
 */
export function unstoredNotice(keys: readonly string[]): string {
	const noun = keys.length === 1 ? "credential" : "credentials";
	return `${keys.length} ${noun} could not be stored (${[...keys].sort().join(", ")}); the agent has been told so. Paste the value again after /credential to retry.`;
}

/** Shown while the token is seated and the secret has not started arriving. */
export const CREDENTIAL_ARMED_NOTICE =
	"armed — add a space, then type or paste the secret";

/**
 * Shown once the operator has STARTED TYPING a secret and the composer is
 * masking their keystrokes (`CREDENTIAL_TYPING_NOTICE`, `app.py:2172` — the
 * widest rung of the TUI's overflow ladder, which exists because its notice row
 * ellipsizes while the composer's notice wraps).
 *
 * A separate string from {@link CREDENTIAL_ARMED_NOTICE} because the two states
 * owe different words, and this is the state where the operator most needs
 * them: their keystrokes are producing bullets instead of characters, which is
 * alarming rather than reassuring unless something says it is deliberate AND
 * says how it ends. So it names the mask, the key that finishes the entry and
 * the key that backs out — the three facts that cannot be read off the frame.
 *
 * ONE WORD DIVERGES FROM THE TUI'S COPY, and it is `pill` rather than `chip`
 * (UX round 1, U5). The TUI's "chip" has no competitor in its own box; this
 * composer already has a chip in it — the bordered working-directory control
 * with its own menu (`cwdChipRef`) — so "Enter turns it into a chip" pointed at
 * the wrong object in the one sentence whose job is telling the operator what
 * Enter does. `pill` is what the design record and this module call the marker
 * everywhere else, so the copy and the code now use one word for one thing.
 * The substitution is five characters shorter than the rung it replaces, so the
 * overflow behaviour the comment below describes cannot regress on it.
 */
export const CREDENTIAL_TYPING_NOTICE =
	"masked as you type — Enter turns it into a pill, Esc cancels";

/**
 * Said after Esc unredacts a typed secret back into the composer as plaintext
 * (`CREDENTIAL_UNREDACTED_NOTICE`, `app.py:2203`).
 *
 * The unredact is the only exit that leaves the secret IN the buffer, and the
 * frame cannot say so on its own — the masking notice goes and the composer
 * looks ordinary while holding a credential, and the very next Enter re-commits
 * the exact leak this feature closes (measured in the TUI: byte-identical to
 * the pre-fix base). It names what is true NOW and what the next keystroke does,
 * in that order, because the operator's hand is already moving toward Enter. The
 * length comes from the count and never from the value.
 *
 * "EXPOSE" RATHER THAN "SEND" because the consequence is shape-dependent: a
 * capture mid-prose means Enter genuinely sends the line to the model, while a
 * capture that was the WHOLE line leaves the token that dispatches the picker.
 */
export const unredactedNotice = (length: number): string =>
	`${length} characters are now PLAIN TEXT in the composer — Enter will expose them`;

/** A uniform draw in `[0, bound)`, injectable so the naming rule is testable. */
export type Draw = (bound: number) => number;

/**
 * A uniform draw from `crypto.getRandomValues`, not `Math.random`
 * (`editor.py:211`: "this names a credential, and a predictable name lets
 * anything that can read the model's context guess the env var to look for").
 *
 * Rejection sampling rather than a modulo: `Uint32 % 30` is biased towards the
 * first six symbols of the alphabet, and a biased name is a name an attacker
 * who can read the model's context can guess slightly better. The bias is
 * small; the fix is three lines.
 */
const cryptoDraw: Draw = (bound) => {
	const limit = Math.floor(0x100000000 / bound) * bound;
	const buffer = new Uint32Array(1);
	for (;;) {
		globalThis.crypto.getRandomValues(buffer);
		if (buffer[0] < limit) return buffer[0] % bound;
	}
};

/** How many attempts a fresh name gets before it is widened. */
const KEY_ATTEMPTS = 16;
/** The widened name's length, used only if {@link KEY_ATTEMPTS} all collide. */
const KEY_WIDE_LENGTH = 16;

/**
 * A fresh `LOP_SECRET_XXXXXXXX` name, avoiding `taken`
 * (`generate_credential_key`, `editor.py:689-724`).
 *
 * The operator does not invent a name for an inline capture — that is the point
 * of the gesture — so the store does. 39.3 bits makes a collision negligible,
 * but `taken` is still CONSULTED rather than trusted to probability: a collision
 * would silently REPLACE a live credential (`store_credential` overwrites), and
 * a secret the operator handed over ten minutes ago disappearing is not a
 * failure mode worth a birthday-paradox argument.
 *
 * `taken` MUST include the names the session store already holds, not only the
 * ones this composer is carrying: the composer's map resets on every submit, so
 * a set drawn from it alone cannot see the credential handed over ten minutes
 * ago — which is precisely the live credential this guard exists to protect.
 * The caller unions both sets (§8).
 *
 * Bounded retries, then a widened name, so this can never spin.
 */
export function generateCredentialKey(
	taken: Iterable<string> = [],
	draw: Draw = cryptoDraw,
): string {
	const used = new Set(taken);
	for (let attempt = 0; attempt < KEY_ATTEMPTS; attempt++) {
		const candidate = CREDENTIAL_KEY_PREFIX + randomSuffix(8, draw);
		if (!used.has(candidate)) return candidate;
	}
	// Unreachable in practice (it needs 16 collisions against a set the operator
	// would have had to fill by hand); widening rather than raising keeps a
	// capture that has already taken the secret out of the composer from failing
	// at the naming step.
	return CREDENTIAL_KEY_PREFIX + randomSuffix(KEY_WIDE_LENGTH, draw);
}

const randomSuffix = (length: number, draw: Draw): string => {
	let out = "";
	for (let i = 0; i < length; i++) {
		out += CREDENTIAL_KEY_ALPHABET[draw(CREDENTIAL_KEY_ALPHABET.length)];
	}
	return out;
};

/**
 * Whether a name is one the session store can hold unchanged.
 *
 * Exported so the test asserts the backend's own pattern against names this
 * module mints, rather than restating the alphabet's intent: the name is the env
 * var the model is told to use, and a name the store renormalises would
 * advertise one key and hold another.
 */
export const isStorableCredentialKey = (key: string): boolean =>
	key.length <= CREDENTIAL_KEY_MAX_LENGTH && CREDENTIAL_KEY_PATTERN.test(key);
