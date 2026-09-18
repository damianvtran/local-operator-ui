# The composer's inline credential capture

Status: **agreed interface** (this file is the contract the implementation and its
review rounds are held to; it is not a proposal).

## What a user gets

The TUI already has a gesture for handing the agent a secret without the secret
ever becoming transcript text: type `/credential`, a space, then the value. The
desktop app has only a modal form (`CredentialPicker`, reached from the slash
row). This document ports the TUI gesture to the composer, so that:

1. typing `/credential ` (leading or **mid-prose**) arms a capture;
2. every character typed after the space is **masked** — one `•` per character,
   and the characters themselves never enter the buffer;
3. **Enter** ends the secret and turns it into an inline **pill** in the middle
   of the typed text, with the caret left after it so prose continues inline;
4. **Esc** cancels: the typed characters come back as ordinary plain text, and
   the app says so (they are plaintext now);
5. **paste** while armed captures the pasted content as the credential in one
   step, again leaving a pill;
6. on send, the value is stored in the **session credential store on the
   runtime** (the same store, the same verb, and the same injection into `bash`
   as the TUI uses). The model sees a citation naming the credential — never
   the bytes.

The normative reference for every sub-behaviour below is the TUI implementation
in `~/local-operator`: `local_operator/tui/widgets/editor.py` (the state
machine, `_capture_credential`, `_mint_typed_credential`,
`_cancel_credential_typing`, `generate_credential_key`, `substitute_credentials`,
`describe_unstored`) and `local_operator/tui/app.py`
(`_capture_inline_credentials`, `_store_inline_credentials`,
`session_credential_names`). **Read that code before implementing**; where this
document and that code disagree, that code wins and the divergence is a defect
in this document to be reported, not worked around. Where the port deliberately
diverges (there are three places, §7), the divergence is documented in the code
comment and in the PR.

## 1. The gesture is composer-local

The capture is a **composer** capability, not a slash-command execution. It arms
mid-prose exactly as it does in the TUI (`deploy with /credential <value>` is a
supported sentence), and the `/credential` token is **consumed** when the value
is chipped: the buffer afterwards holds the pill where the token was.

Two Enters, separated by **state** and never by timing — mirror the TUI's split:

- the slash suggestion popup is open and `/credential` is the highlighted row →
  Enter accepts the row (existing behaviour, unchanged). Accepting it inserts
  `/credential `, and that trailing space **opens the capture** (the TUI gets
  this from `_apply_command`, so a hand-typed space and a picker-accepted space
  are one rule);
- the masked span is open and holds at least one character → Enter **mints the
  pill** (§4);
- otherwise → submit, unchanged. In particular `/credential` with an empty span
  submits and the existing picker opens, which is how the store, the list and
  the forget verbs stay reachable.

## 2. Arming

The TUI's predicate, ported verbatim (`editor.py:551`):

```python
CREDENTIAL_ARM = re.compile(r"(?:^|(?<=\s))/(?:credential|cred)[ \t]*$", re.IGNORECASE)
```

- Leading **or** mid-prose; the token must start at line start or after
  whitespace, and must be the last thing on the caret's **own line** up to the
  caret. Trailing spaces and tabs are part of the match; a newline is not.
- **Only a typed arrival arms — plus the one completion that IS a typed
  arrival.** Text that arrives some other way — a restored draft, a history
  recall, seeded content, a programmatic `setValue` — never arms. The TUI
  enforces this by being the only arming route (`_sync_credential_arm`, "This is
  the ONLY way to arm"), and it is pinned there by
  `test_a_mention_of_the_command_in_text_never_typed_through_the_arm_does_not_arm`.
  This matters: `docs/design/...` prose that mentions the command, and a draft
  restored from a previous session, must not silently capture the next paste.
  The picker-accepted token (§1) is the second door and it is not an exception:
  accepting the row writes the token's own trailing space, and the TUI gets it
  from `_apply_command`, so a hand-typed space and a picker-accepted space are
  one rule. This port had the door described and not built, which meant the paste
  that followed the accepted row landed verbatim in the document (code round 1,
  MAJOR 2); the completion now syncs through the module's `"completion"` origin,
  which carries the arming power and nothing else.
- The arm is **latched**, not re-derived per paste, and survives a newline, a
  typed word, a caret move, and an Esc that closes the popup. It ends only when
  the token is gone, the capture is taken, the span is cancelled, a flag-shaped
  tail makes the tail an argument rather than a secret (`--…`: the first
  character typed into the span being `-` abandons the capture and leaves that
  `-` as plain text, which is how `/credential --forget-all` stays reachable in
  the TUI — `editor.py:2960-2983`), or the buffer is replaced wholesale (§3).
- **Re-anchoring has a typed-through rule** (`_token_being_typed_at`,
  `editor.py:6013-6045`), and the port needed it for the same measured reason
  the TUI did: while the operator re-types the token over the latched one —
  `/cred` → `/crede` → … → `/credential` — the middle spellings match neither
  the token regex nor the arm regex, so a nearest-match tie-break hands the arm
  to a DIFFERENT token earlier in the line. That migration is one-way: the
  anchor travels with it, the opener space then never opens a span, and the next
  secret is typed into the document in plaintext. So before either tie-break,
  ask whether the word at the latched offset is this token mid-typing (the
  word's own `/cred`-floor prefix match), and keep the arm there if it is
  (code round 1, MAJOR 1).
- **The disarm flag is anchored** (`/^[ \t]+-/` against the token's tail), not a
  `.test` against the whole tail: the flag has to be the FIRST thing after the
  token's blanks to be a command, and an unanchored search disarmed the gesture
  on a `-` anywhere later in the line — the operator's next paste then landed in
  the document (code round 1, MINOR-2).

## 3. Masking while typing

- One `•` (U+2022) per typed character, inserted through the composer's normal
  change path so selection, undo and the draft mirror behave as they do for any
  other text. One cell per character, never a wide glyph: the span's width and
  the pill's reported count have to agree.
- **The characters never enter the buffer.** This is the TUI's load-bearing
  invariant (`editor.py:6172-6177`, "BETWEEN (2) AND (4) THE SECRET IS NEVER IN
  THE DOCUMENT") and it is what makes every disclosure seam safe at once: the
  draft store, history, telemetry and the transcript all read the document.
  The value lives in a ref (§6).
- The gate is **printable characters**, never key names. The TUI documents the
  measured leak this fixes (`editor.py:2948-2959`: punctuation arrives spelled
  as words, and keying on names leaked a canary). Intercept the printable text
  the key would insert, not the key.
- Edits inside the span are applied **positionally to the held value**, so
  arrow-then-type, Backspace, Delete and select-and-replace land where the
  operator sees them land (`_credential_edit_mirror`, `editor.py:6242-6323`; the
  TUI lost a review round to exactly this, U1). The document invariant that
  makes this checkable: **while the span is open the buffer text is exactly
  `<prefix>/credential <• × len(value)><suffix>`**.
- A space typed inside the span is part of the secret (the delimiting space is
  not — it is the opener, and it is not counted in the length).
- The caret leaving the span ends the *typing* state without disclosing
  anything; returning to the token re-opens it (`test_the_caret_leaving_the_span_ends_the_capture_without_disclosing`,
  `test_the_caret_returning_to_the_token_re_opens_the_capture`).
- **A whole-buffer replacement ends a live capture, both halves of it**
  (`Editor.load_text`, `editor.py:7033-7099`: `_abandon_credential_typing("gone")`
  **and** `_disarm_credential("gone")`, named against "a history recall, a
  restored draft, a `/reload` hand-back, a sidebar session switch"). The port
  reaches the same states through a conversation switch, a recalled prompt, an
  adopted draft, a transcription, a slash plan and a submit's own clear, and
  without the teardown the buffer, the mask and the value stop describing the
  same thing silently: the capture keeps reporting TYPING, the operator's next
  characters are masked into the STALE value, and Enter mints a pill over a
  prompt they still had on screen — deleting it — with the stale secret then
  stored into whichever conversation is current (code round 1, BLOCKER 1).
  **Dropped, never re-synced onto the arriving text**: routing it through an
  arrival re-anchors the arm onto whatever `/credential` the new buffer happens
  to mention, which is the migration the TUI's own R6b/R6c removed because a
  recalled prompt that merely mentioned the command swallowed the next ordinary
  paste, unrecoverably. The payload map is retired with the capture, and a
  conversation switch retires it too — a marker minted in conversation A must
  not be substituted against conversation B.
- **Text that arrives INTO an open span is refused, not mirrored**
  (`editor.py:6312-6323`: "leave the value untouched rather than silently
  corrupting it"). A drop, an IME commit or a paste that fell through the gate
  used to be appended to the held value while the cells stayed where they were,
  so the secret silently gained characters the operator never saw masked. The
  port's order is the reference's plus one step: end the typing state (keeping
  the arm — the gesture is one space away again) with the value dropped, and let
  the arriving text land where the browser put it (code round 1, MINOR-3).

## 4. Enter mints the pill

Read the TUI's `_mint_typed_credential` (`editor.py:6365-6417`) and mirror it:

- the token, the delimiting space and **every mask cell** are consumed in **one**
  edit — one undoable step, never an intermediate state holding a partly
  revealed secret;
- the replacement is `marker + " "`, and the caret lands after it, so typing
  continues inline and mid-prose;
- marker text, byte-for-byte the TUI's (`_capture_credential`, `editor.py:6095`):

  ```
  [Credential #<index>, <chars> chars]
  ```

  where `<index>` is a composer-local counter starting at 1 and `<chars>` is
  `Array.from(value).length` — **characters, never lines** (`_credential_label`,
  `editor.py:523-540`: the length is the operator's integrity check, and a line
  count is the weakest form of it exactly where truncation hides, as in a PEM
  block);
- an **empty** span mints nothing and the capture stays open;
- **the Send button takes the same answer Enter does**, because a masked capture
  is a mode and a mode cannot mean one thing to the keyboard and another to the
  pointer. Clicking Send with a masked span open used to submit the MASK CELLS as
  the message — the secret unreachable, the model handed a citation nothing
  backed, the notice still claiming to mask a box that was now empty — and with
  an EMPTY span it reached the dispatcher, which refused `/credential` and left
  the screen exactly as it was, a silent no-op on the app's primary control
  (design round 1, D1; QA round 1, Q4). Both gestures now read ONE function: a
  non-empty span mints and does not send; an empty span falls through to the
  planner, so `/credential ` + Send reaches the picker, which is the door §1
  keeps open for the list, the store and the forget verbs; nothing open is an
  ordinary send. Never: mask cells, a half-captured secret, or silence;
- the marker is *not* distinguishable from a plain paste/image marker by its
  grammar alone, which is deliberate: `Marked = Attachment | PastedText | PastedCredential`
  in the TUI, and a citation counts as the app's own only when the marker text
  matches the payload's own recorded marker **and** the index matches. A
  hand-typed lookalike is prose and must never be stored, substituted or
  stripped. **The index half has to be reachable** (code round 1, MINOR-1): every
  payload the app builds carries the two in agreement, so the index only ever
  says no about a marker whose tail was edited by hand — which is the case that
  matters, and which is why it is pinned with a mismatched pair rather than
  dismissed as decoration.

## 5. Paste, and Esc

**Paste while armed** (`Editor._on_paste`, `editor.py:5194-5261`) — the credential
gate is the *first* branch, ahead of every size and whitespace rule:

- paste with an **open non-empty span** appends into the same secret through the
  same masking path;
- paste with an **open empty span** closes the span and then captures (so the
  §4 gesture still works after a stray space);
- otherwise the pasted text is captured directly: `value = pasted.trim()`, an
  **empty or whitespace-only paste captures nothing** and falls through to the
  ordinary paste (a zero-length credential would advertise a key that can never
  hold anything, and the store refuses a blank anyway);
- the capture is instant in one edit — never masked character by character — and
  **disarms**, so a second paste means retyping the token; the first marker stays
  cited and its payload untouched ("It is not a replacement").

**Esc** depends on which sub-state you are in, and only one of them disarms:

- **typing** (the space was typed: open span, empty or not) → **cancel**: the
  held characters are written back into the buffer **as ordinary text** — the
  only route by which a typed secret enters the document — the arm ends, and the
  operator is told, in the TUI's words, that the characters are now plain text
  and Enter will expose them (`CREDENTIAL_UNREDACTED_NOTICE`, "… characters are
  now PLAIN TEXT in the composer — Enter will expose them"). The `/credential `
  token is left behind as inert literal text. With no characters to restore the
  cancel still ends the mode (the TUI's R1/U2 regression: it used to re-arm
  itself and capture the prose that followed).
- **The cancel's own edit is suspended from the sync** (`_cancel_credential_typing`,
  `editor.py:6452`), and the port needs the equivalent for the EMPTY sub-state: a
  cancel that restores nothing produces no buffer change, so an edit the cancel
  posts cannot be seen by the change handler that would re-arm from it. Two round
  trips through this: the empty-span cancel left the caret one position behind
  its own buffer, and every following character was inserted BEFORE the previous
  one — measured as `/credential ` + Esc + `hello there` → `/credential ello
  thereh`, in prose as well as at the start (UX round 1, U1; the reference lost
  the same round twice).
- **After a cancel, the token is inert to SUBMIT as well.** The notice promises
  "Enter will expose them", and Enter used to do the opposite: it reached the
  dispatcher, which read the leading `/credential` as the COMMAND, opened the
  picker and — mid-prose — stripped the restored characters out of the
  operator's sentence. The composer therefore remembers the token it just
  cancelled (its exact run and arrival offset) and submits prose while that run
  is still there; any edit that moves the token ends the exception, and the case
  the dispatcher exists for is untouched — `/credential <args>` submitted with no
  capture still strips its arguments, so a secret can never land in command text
  (QA round 1, Q2).
  **This holds for the EMPTY-span cancel too, and round 2 is why that had to be
  said** (UX round 2, U9). The run used to be reported only by a cancel that
  restored characters — sound about the NOTICE, which is suppressed when nothing
  was restored, and wrong about the SUBMIT: `/credential ` + Esc + `mysecretname`
  + Enter dispatched the command, consumed the operator's words as its argument
  and left the box holding `deploy with`, sending nothing and saying nothing,
  while the SAME visible sentence with characters in the span sent as prose. One
  buffer, opposite outcomes, and the losing one silent. What the cancel actually
  promises is that the GESTURE is over; the token is how the submit is told. The
  run survives the operator's own typing either way, because a restored
  character and a typed one both land AFTER it (the mask span starts at the
  token's end).
- **armed, no space yet** → Esc does **not** disarm. With the popup open it
  closes the popup; otherwise it keeps its existing meaning. The arm survives.
- The Escape restore must not re-arm: the TUI nests the restore in
  `_suspend_credential_sync = True` for exactly this reason.
- **One shape of that promise is unmet, measured, and deliberately NOT repaired
  in round 3** (QA round 3, Q3). With the whole box being `/credential <the
  restored characters>` — the token at offset 0 with the unredacted text after it
  — Enter is a silent no-op while the sentence above the box says "Enter will
  expose them": the dispatcher refuses the command's arguments and the draft is
  put back, so nothing is sent, nothing is stored, and the box keeps the
  characters and the sentence. Reproduced byte-identically on the round-3 BASE
  (`aaa9e70e7` — the tree the round's four comments scope as `aaa9e70e7..0e3415668f`,
  i.e. before that round's remediation; this said "the round-3 reviewed head", which
  sent a reader chasing the Q3 reproduction to the wrong end of the range — code
  review round 4, MINOR 4), so this change neither introduced nor fixed it;
  it is recorded as a deferred follow-up on PR #238 rather than repaired inside a
  round whose scope is the composer's own layout. What it is not: no leak and no
  loss — the characters survive in the box, no key is invented, and no secret
  reaches the transcript.
  **THE DEFERRAL CARRIES THE CONSEQUENCE QA NAMED IN ROUND 4** (QA round 4, Q1;
  its own recommendation, one sentence rather than a second deferred defect): in
  the branch of this gesture where the buffer SURVIVES the Enter, the same
  submit also takes the notice DOWN and persists `unredactedChars: 0`, so a reload
  brings the plaintext back with no warning at all — the characters are still the
  buffer the disclosure was defined over (`disclosureOver`), and the restore the
  warning was for is the state that loses it. A repair that keeps this deferral
  honest has two candidates: retire the notice only on an operator edit rather
  than on an app-initiated restore, or narrow §5's promise to the states the
  notice can actually hold over. Neither is in this round's scope, and QA measured
  the gesture's outcome as unstable between runs of the same keys, so the shape to
  fix is not yet pinned by a reproduction either.
- **The disclosure the cancel raises is about ONE buffer, and any edit retires
  it** (UX round 3, U12; code review round 3, MINOR 1). The sentence says how many
  characters are now plain text *in the composer*, and round 2 made it durable by
  persisting a count beside the draft. A count is not the text it describes: four
  backspaces after `/credential BACKSPACE-1` left the sentence claiming eleven
  characters over a seven-character remnant, and a cleared box that was retyped
  with ordinary prose re-persisted the stale seven — which a reload then rendered
  as a sentence about nothing, and which could ride a minted marker. So the
  disclosure is held as the count **and the buffer it is about**, and it stands
  only while the box still holds that buffer: the rendered sentence comes down on
  the first edit (it is a derivation, so it cannot lag), and the write that edit
  makes carries 0 (the store's own rule zeroes it for an empty value, and this is
  the half that covers every other edit). The durable half round 2 added
  survives untouched for the case it was written for — an Esc, then a reload with
  no edit in between still restores the characters *and* the warning.

## 6. Where the value lives, and what is persisted

- The value lives in a **ref-held map keyed by index**, alongside the minted key
  and the marker text: `{ index, key, value, marker }`. It is never React state
  that is serialised, never in the draft value, and never in
  `conversation-input-store` — that store is `persist`ed to localStorage, and
  any value routed through the draft buffer or `attachments` lands on disk
  (see `shared/store/conversation-input-store.ts`).
- **The draft is not written while a masked capture is open.** The persisted
  draft keeps the last non-capturing value; a half-typed secret is in-flight
  state, and persisting `••••` with no value behind it would restore dead text
  the operator cannot use. This is a rule about the MASKED window only, and it
  is enforced at the capture's own writes as well as at `handleChange`: a write
  gated on the render-time `draftHeld` flag alone missed the mint, which lands
  in the same tick while the mask is still open (QA round 1, Q1).
- **What IS persisted, in every state the capture ends in.** The marker text
  (it holds no secret), and — deliberately — the **Esc-restored plaintext**. The
  unredact turns the characters back into the operator's prose, and prose is
  what a draft keeps; leaving it out kept a secret off disk but made a crash or
  a quit come back holding the inert `/credential ` the operator had just
  cancelled, with their line gone (UX round 1, U4). §5's own words for that
  state are the answer: after the unredact it is not a credential.
  **The disclosure is persisted WITH those characters and re-raised when they
  come back** — the count, never the value and never the sentence. §5 says the
  unredacted state must never be silent, and once §6 decided to keep the
  plaintext, a reload was reaching that state with no notice, no arm and no pill:
  the previous session had warned that the next Enter would expose these
  characters, and the new one said nothing (design round 2, D2). The count rides
  in the draft store as `unredactedChars`, written with the draft on every write
  the composer or its hook makes, and an empty draft discloses nothing — enforced
  at the one place the pair is written rather than at each caller.
  **And the count is only ever written with the text it DESCRIBES** (UX round 3,
  U12; code review round 3, MINOR 1). A count on its own can outlive its
  characters: four backspaces after `/credential BACKSPACE-1` left the sentence
  claiming eleven characters over a seven-character remnant, and a cleared box
  retyped with ordinary prose re-persisted the stale seven under text that is not
  plaintext secret characters at all — a reload then rendered a sentence about
  nothing. So the disclosure is held as the count AND the buffer it is about, and
  it stands only while the box still holds that buffer: the rendered sentence is
  a DERIVATION, so it comes down on the first edit, and the write that edit makes
  carries 0. An edit therefore retires the disclosure; an Esc followed by a
  reload with no edit in between still restores the characters and the warning,
  which is the case this durability exists for.
- **A marker no payload backs repaints its pill and is rewritten at submit.** A
  restored draft's marker has no value behind it — the map is a ref, so a new
  document starts empty and a conversation switch retires it on purpose — and it
  is now painted by the same rule as a cited one and rewritten by the same rule,
  so the two can never disagree. Round 1 claimed both and had neither: the marker
  painted as ordinary prose and a submit sent it **verbatim**, so the model
  received a composer-local `[Credential #1, 19 chars]` naming a key nothing
  holds (design round 2, D2; UX round 2, U11; code review round 2, MAJOR 1). §9
  states the rewrite.
  - **The disclosure is persisted WITH the characters it describes**, and re-raised
  when they come back. §5 says the unredacted state must never be silent, and
  after §6's decision to persist the plaintext, a reload was reaching that state
  with no notice, no arm and no pill — one Enter away from exposing the
  characters the previous session had warned about. The count (never the value,
  never the sentence) travels in the draft store as `unredactedChars`, and the
  composer raises the same `unredactedNotice` from it on arrival — but only over
  the text the store itself names as that draft, and only until the operator
  edits it (round 3 above); an empty draft discloses nothing, enforced at the one
  place the pair is written.
  - **And the raised chip says the value is GONE, before the send** (UX round 3,
  U13). The story above is about the model's citation; the operator's half is that
  a marker with no payload used to be painted exactly like a live pill — same
  wash, same edge — so the only way to learn the value had not survived was the
  citation in the message they had already sent. The unbacked marker now takes the
  WARNING register the unredacted sentence already uses — `bg-warning-wash` with a
  `warning-border` 1px outline; an on-screen register rather than an existing one,
  because the design's not-stored state is the TRANSCRIPT citation, so a chip had
  to be invented either way (code review round 4, NIT 3) — and **its outline is
  DASHED**, which is round 4's second half (design round 4, D2; code review round
  4, MINOR 2; UX round 4, U17). The dash is not decoration: measured over the
  twelve palettes, `warningWash` against the pill's `infoWash` is a fill contrast
  of **1.01-1.11** (ten of the twelve at or below 1.06), the two edges are
  **1.00-1.72**, and a greyscale reading of the two fills is **34 vs 35 of 255** —
  so hue was carrying the whole distinction for a reader who cannot separate a warm
  brown from a cool blue, in the state that raises no sentence and costs one Enter.
  Both kinds still come from the same location rule (`markerSpans`), so the paint
  and the submit rewrite cannot drift apart; what differs is the role AND the
  edge's style.
- Clearing the composer, submitting successfully, and disarming all clear or
  drop the map; a **failed send keeps it**, because the operator's unsent draft
  must not lose the value behind a pill they can see.
- **The map is retired WITH the buffer, never ahead of it.** The submit requests
  the retirement and a commit performs it, once nothing left in the box cites a
  payload. Clearing the map first left a window in which the raw
  `[Credential #1, 19 chars]` painted without its pill and an Enter inside that
  window sent a citation no map entry backed (code round 1, MINOR-5).
- **A conversation switch retires both halves**, the map included: a payload
  minted in conversation A must not be cited by conversation B's restored draft
  because the two happen to contain the same marker text.

## 7. The deliberate divergences from the TUI

THIS LIST IS THE WHOLE OF THEM, and it is kept true to the code: each entry is a
thing this port does differently on purpose, with the reason, and anything not
here is intended to be the TUI's behaviour rather than an accident of the port.

1. **Pill rendering, and the two cues the port cannot have.** The composer is a
   plain `<textarea>` over a plain string draft, so there are no styled nodes to
   hang a chip on. The marker's treatment is therefore drawn in TWO LAYERS behind
   and over the field, and the split is what the operator's report of 2026-09-17
   turned on:

   - a **background-only overlay**: a mirror element behind the textarea, with the
     same box model and typography (`whitespace-pre-wrap`, same font, size,
     line-height, letter-spacing, padding, border-box width), that paints the
     chip's ground under each marker span and **no text at all**. The textarea
     keeps painting every glyph, so a failure of this layer can never make the
     user's text invisible, and the marker text and the chip's ground can never
     disagree. It is mounted whenever the buffer has anything to paint — a marker,
     a mask run, or the armed token — so the ordinary composer keeps exactly
     today's render path. Scroll offset is synchronised when the textarea scrolls
     internally (it only does so past `max-h`).
   - an **opaque chip painted OVER the marker run** (`credential-chip-layer.tsx`),
     because a wash behind the literal characters `[Credential #1, 19 chars]`
     still reads as a TUI-style square-bracketed marker: it IS those characters.
     The chip carries a key glyph, the reference's own label, its count and a
     clear control, and it is positioned from the MIRROR's rects — measured with
     `getClientRects()` in a layout effect, because a textarea exposes no
     per-run geometry and the mirror is the only element that knows where the
     field's text has been scrolled to. `scripts/credential-chip-geometry.mjs`
     prints the pair: at the composer's 1024 rung the run box is
     **157.33 x 17 (left 188.98, top 86.39)** and the chip's box is identical, so
     the four deltas are 0,0,0,0; at the compact rung (a 440px column) the pair is
     **147.67 x 16**, also 0,0,0,0.
     **THE MEASUREMENT ADDS NO SCROLL OFFSET, and that was round 1's blocker**
     (UX round 1, U1). `getClientRects()` is viewport-relative and the layer is
     `absolute inset-0` in the same wrapper as the field, so subtracting the
     layer's own frame already lands the rect in the layer's coordinates; the
     contribution used to add the MIRROR's own `scrollLeft`/`scrollTop` on top,
     re-applying the scroll the rect had accounted for. In any message long enough
     to scroll, the chip therefore sat exactly `fieldScrollTop` px from its marker
     — an opaque ground, and a live `x`, over unrelated prose — with `deltaTop`
     measured at 0 / 60 / 117 for `scrollTop` 0 / 60 / 117. The subscription is
     what makes the rects track the scroll; the offset was cancelling it, and the
     rig now measures a scrolled field as well as a resting one: the same story
     reads **delta 0,0,0,0 at `scrollTop` 0, at 113 (its middle) and at 225 (its
     end)**.
     **THE LAYERS RE-DERIVE ON A RESIZE** (code review round 1, R1-3). The field
     is `w-full`, so a pane resize re-wraps it with no React render at all: the
     mirror would keep its inline `width = field.clientWidth` px and the chip the
     rect it measured before — an opaque ground over the wrong glyphs. Both layers
     register a `ResizeObserver` on the field, and the rig proves it by narrowing
     the composer's own box (a viewport change proves nothing here: every story
     pins its column width, and the first version of that phase measured exactly
     that) and requiring the four deltas to stay at zero, asserted rather than
     printed.
     **The label is the index alone (`#1`), and the measurement is why**: the
     run's box is 157.33px there while the words `Credential #1` plus
     `· 19 chars`, a glyph, a control, their paddings and three gaps measure
     **191.3px** in the same frame. A chip that wide cannot be drawn over the run
     — its ground is opaque, so the 34px it overhangs would cover the first word
     of the sentence after the reference, or the chip would truncate its own name
     to `Credenti…`. `#1` with the count measures **126px**, which fits with 31px
     to spare, and the count keeps its unit because it is the half of the pair the
     operator cannot recover from anywhere else (`editor.py:523-540`).
     **The box's own slack is divided across the chip's gaps, not parked
     anywhere** (design round 1, D1; round 8, D19): the box is 157.33px because the
     MARKER is 26 characters while the chip's face is ~123px, and a count that took
     the slack parked 44px of empty fill (28% of the box; 34px at the 440 rung)
     between `#1` and `· 19 chars`, which read as two stranded clusters with an
     orphaned leader-dot. The root is now `justify-between gap-1.5 px-3` — the app's
     own chip step — so the slack lands in the gaps the chip actually has: three of
     10.69 / 10.68 / 10.69 on the backed chip at the 1024 rung (9.05 / 9.04 / 9.04 at
     440), and two of 22.03 / 22.01 on the unbacked one, which carries no control to
     spread them towards. That wider pair is that register's own shape rather than a
     residue of the old one, and re-grouping the items to tighten it would take the
     backed chip's 10.7px band to about 20px.
     **The control is 16x16, and that number is a measured trade** (design round
     1, D2; UX round 1, U5). It was a bare 12x12 glyph — the smallest control in
     the composer and the only one whose click destroys a held secret, against the
     app's own chip-prune precedent of 18x18 and `icon-sm`'s 28x28. Four pixels of
     padding is as far as this chip allows: the run box is 17px tall at the 1024
     rung and 16px at the 440 rung, so a 24x24 target (WCAG 2.2 SC 2.5.8) would
     put the chip's own ground over the lines above and below and swallow their
     clicks. The deviation is recorded rather than silent — 16x16 against the
     24x24 minimum, bounded by the line box — and the focus ring takes the button
     primitive's DENSE offset (`outline-offset-1`, with the `!` the primitive
     needs) instead of the global 2px, which bled 3px past a control this small
     and out over the chip's own edge.
     **Its pointer step is the INK** (design round 1, D3): `ink-muted` at rest and
     `ink` on hover, with `hover:bg-elevated active:bg-sunken` (the primitive's
     ghost pair) beside it and `cursor-pointer` added. The old step was
     ground-only (`hover:bg-elevated` against the chip's own fill) and measured
     1.00-1.33:1 across the palettes — sixteen of fifty-nine at or under 1.05:1,
     `obsidian` at ΔE00 0.77 and the default theme greyscale-identical — which is
     the same hue-only separation the dash rule rejected for the two registers.
     The two new triples (`ink-muted` on each wash) are rows in
     `scripts/contrast-contract.mjs`.
     **A run that WRAPS keeps the wash and draws no chip**, and it is a
     documented fallback rather than an oversight: a wrapped marker reports more
     than one rect, so there is no single box to cover, and the mirror's
     `box-decoration-clone` ground is the treatment such a run already had. The
     same fallback covers a run the marker grammar does not parse, because a chip
     with the wrong label is worse than the wash it replaces.
     **The clear control is the composer's alone.** Clicking `x` splices the
     marker and its trailing space out of the buffer in ONE edit through the same
     door the mint uses, holds the payload, and tells the operator that the value
     is gone and only they can supply it again (`clearedNotice`). IT TELLS THEM
     TWICE, and that is round 1's U2: the sentence used to live only in a sonner
     toast, which retires in 3.5-6.5s, while the composer's notice line — the
     channel carrying every other credential-fate sentence in this flow — stayed
     blank and `Cmd+Z` restored nothing. The words are now on BOTH: the notice
     line keeps them until the next edit (the disclosure's own retirement rule,
     compared against the buffer the sentence describes), and the toast carries an
     `Undo` — the shape `composer-status-row.tsx` gives the cleared goal — which
     puts the marker back at the offset it was removed from and leaves the payload
     in place, so the restored reference is a backed chip rather than the warning
     register. The payload is held until that toast retires, and the undo refuses
     once the buffer has moved on, because an insert at a stale offset would
     corrupt prose the operator has written since. An UNBACKED marker gets no control: nothing is behind it
     to clear, and a disabled-looking `x` would promise a verb the state cannot
     honour. So does a chip on a composer that is REFUSING input (a conversation
     this machine does not have, or a turn already running): the refusal on this
     base is `readOnly` rather than `disabled`, so the box stays focusable and a
     control painted over it stays pressable, and this path writes into the buffer
     and discards a value — it carries the same predicate every other writer
     carries, and the chart is not drawn rather than drawn inert. The caret goes
     back through `focusInput`, the composer's single focus door, so the press
     cannot leave `composerPointerTouched` set and suppress the ask gate's next
     hand-off (see `composer-field.ts`). In the TRANSCRIPT there is no `x` at all,
     and that is deliberate: a
     sent message cannot be un-sent, so the only two meanings such a control
     could have are both wrong — deleting a line from a record the model has
     already read, or deleting the key from the session's store, which would
     break a `bash` call the agent may be about to make from another pane. It
     would need a verb that withdraws the credential from the store AND reports
     what the model has already read, i.e. a conversation-store change.
   **The transcript renders the same chip, for the same reference.** A sent
   message carries the citation (`credentialCitation`, §9), and the operator's
   report is that a reader met a wall of technical text there two seconds after
   the composer had shown them a chip. A user turn's body now renders every
   citation in place as that chip — the key's name and its count, with the full
   sentence in the native `title`, which is what keeps the agent-facing words
   reachable without printing them. This is a RENDER-ONLY transform: the text
   the model is given and the text the transcript stores do not change by one
   byte. It runs as a remark plugin over the mdast `text` nodes
   (`credential-citation-remark.ts`), gated on an explicit `credentialCitations`
   prop that only the two user-turn render paths set, so agent output — which
   mentions these sentences as prose about a credential rather than as a receipt
   the app issued — is untouched. Three rules are load-bearing and pinned: only
   the whole sentence with **its two names agreeing** is a citation (a hand-typed
   lookalike stays prose), nothing inside `code`/`inlineCode` is ever touched (a
   citation the operator quoted in a fence is source, not a reference), and the
   chip's fill/edge/ink are the same roles as the composer's, in the two
   registers the composer already distinguishes. THREE MORE RULES CAME OUT OF
   ROUND 1, and each is pinned in `scripts/credential-capture.test.mjs`:
   **provenance** — a link is a citation only when its own VISIBLE TEXT is the
   citation its URL names, because a URL's shape alone was satisfied by a
   hand-typed `[sneaky](#lo-credential/…)` and a chip is a claim that the app
   wrote the receipt (code review round 1, Q1; `citationFromLink`); **the
   citation pass can veto the math pass** — every citation carries one `$`, so
   `containsLatex`'s `$…$` matched ACROSS two citations on one line, `remark-math`
   is a micromark SYNTAX extension and split them at PARSE time, before any remark
   plugin sees a tree, and the operator's own sentence was typeset as a formula
   with neither reference chipped (code review round 1, R1-1; `markdown-math.ts`).
   The rule now: when a citation is present and the document holds any other
   pairable `$`, the CITATION WINS and the formula renders as its own source — a
   formula the operator wrote is still on screen in their words, where a citation
   that fails to chip is invisible. And **the sentence stays in the accessibility
   tree**: it was rendered text before this change, and a `title` on a
   non-focusable span made it pointer-only, so the chip carries it in a visually
   hidden element beside the words it displays (design round 1, D5 / UX round 1,
   U4) — nothing stored or sent changes with any of the three.
   **The armed run, measured** (design round 2; the figure below is recomputed
   from all twelve palettes the set then held rather than quoted, and it corrects
   the range round 1 recorded, whose low end was sage's 3.99 where the minimum is
   `localOperatorLight`'s **3.69**): `warningWash` against `canvas` runs
   **ΔE00 3.69** (`localOperatorLight`) to **13.79** (`neon`), and against
   `surface` **5.37** (`obsidian`) to **15.86** (`neon`) — three to seven times
   §3's observed "about 2" step for a wash, so the token is a state mark rather
   than a tint, in every theme. Ink over that wash (`ink` on `warningWash`, the
   pair the textarea's own glyphs make) is **8.39:1** at its worst
   (`tokyoNight`), clear of the 4.5 floor. The pill's own edge is the tightest
   pair in the table — sage's `infoBorder` on `canvas` at **3.09:1** against a
   3:1 floor — and both pairs are now named in the record rather than assumed
   (design round 2, D5/D6); the contract's own row (`credential pill`) carries
   the pin line.
   **Channels actually available here, stated because the TUI has two and this
   has one.** The TUI marks the armed token on two independent channels: an
   amber token run and a glyph swap, of which the glyph is the one that survives
   `NO_COLOR` and a monochrome terminal (`local_operator.tcss:624`). A
   `<textarea>` carries no per-run colour and has no glyph to swap, so the port
   has one channel for the token — a background wash — and it spends
   that channel on the armed token (`bg-warning-wash`, the role the TUI's amber
   names), on the mask run, and (since round 3) on the NOT-STORED register: a
   marker no payload backs (a restored draft) takes
   `bg-warning-wash`, so the one state where the value behind a citation is gone
   says so in the box rather than only in the citation the model receives (UX
   round 3, U13). Three states, three treatments, and the contract's `CONTROLS`
   carries a row per component triple (`credential pill`, `credential pill
   (unbacked)` for the wash, `credential chip`, `credential chip (unbacked)` for
   the chip painted over it since 2026-09-17).
   **THE TOKEN AND THE MASK STILL HAVE THAT ONE CHANNEL; THE CHIP HAS TWO MORE**,
   which the operator's report bought and which is worth stating against the TUI
   comparison above: because the chip is a real element painted over the run, it
   carries A GLYPH — a key for a live reference, a triangle for one nothing backs
   — and A CONTROL. So the port now marks the two chipped registers exactly the
   way the TUI marks its armed token, while the armed token and the in-progress
   mask keep the wash alone (neither is chipped: one is a word the operator is
   still typing, the other a run whose length changes on every keystroke). The
   glyph is also what the not-stored chip relies on once hue has failed, which is
   the second half of the dash argument below.
   **AND THE WASH ALONE WAS NOT ENOUGH FOR TWO OF THOSE THREE, so round 4 spends
   a second channel: the outline's STYLE** (design round 4, D2; code review round
   4, MINOR 2; UX round 4, U17). The warning wash against the pill's info wash is
   a fill contrast of **1.01-1.11** over the twelve palettes — ten of the twelve
   at or below 1.06, edges **1.00-1.72**, and a greyscale reading of the two fills
   **34 vs 35 of 255** — so for a reader who cannot separate a warm brown from a
   cool blue the not-stored chip and a live pill were the same patch with the same
   glyphs. The chip's edge is therefore `outline-dashed`: it needs no new token,
   it survives monochrome, and it is a channel the other two states cannot claim —
   the armed token has no edge at all, and the pill's is solid. The TUI gets its
   second channel from a glyph swap; this port has no glyphs of its own to swap,
   so the DASH is the equivalent, and it is the same argument that made the glyph
   the load-bearing half there. Nothing in this port survives `NO_COLOR`; the
   notice sentence is the half that does, which is why it is not optional.
2. **Key minting reads names asynchronously.** TUI mints synchronously from
   `session_credential_names()`. Here the taken names come from the desktop
   contract's `sessions.credential` / `list` call (which answers objects, not
   strings — one shared reader turns one into the other), so the names are
   fetched when the capture **arms** and cached; minting then stays synchronous
   at Enter. A failed or still-running fetch must not block minting — mint
   against what is cached, always including this composer's own in-flight keys.
   On a NEW-CHAT pane there is no session to ask, so the guard is weaker there
   by construction: it sees this composer's in-flight keys and knows of no
   session names at all (§9).
3. **Draft persistence while typing**, as §6 states: the masked window is not
   written, and every state the capture ENDS in is — the marker text and the
   Esc-restored plaintext included.
4. **The submit seam for a first message (added in round 1).** The TUI's session
   always exists, so storing a cited credential before the send is always
   possible. Here a draft pane has no session until the send creates one, so
   sending calls back into the host (`beforeAdmission`) once the id exists and
   before the message is admitted, and what leaves is what that callback
   returns. Without it the most likely first use — a brand-new chat whose first
   message hands over an API key — silently degraded to the not-stored citation
   (UX round 1, U2).
5. **The notice sits ABOVE the composer box, in the band's own flow.** It is a
   second line of prose the TUI keeps in its notice row; here it is a full-width
   `<output>` line on the composer's own measure, immediately above the box, and
   that is round 3's placement (design D1; UX U14; code review MAJOR 1; QA
   Q1/Q2).
   ROUNDS 1 AND 2 BOTH KEPT IT INSIDE THE COMPOSER, and both paid the same
   currency: the composer's own height changed when the sentence arrived, so the
   line the operator was typing moved under their caret. Round 1 reserved a band
   above the textarea (4px of reflow on arming, and 38px of standing height in
   every state); round 2 moved the sentence onto the composer's control row, on
   the argument that a row sized by its icon buttons absorbs a 19.5px line.
   Round 3 measured where that ends: the row has 296.55px of free space at 1380
   against a 353.86px sentence, so it wrapped to two lines and grew the row
   32 -> 39px; at 950 it became a 168x78 block and squeezed the working-directory
   chip's label from 236px to 96px; at 800 - this app's own `WINDOW_MIN_WIDTH` -
   it was a 76.7px-wide ribbon 175.5px tall with the row tripled. A row that also
   holds a chip, a readings strip and three controls cannot carry a sentence of
   this length at any of them.
   **What a line costs on each side of the box** decides the new home, measured
   on the app with the same rig, viewport and state on both trees (populated
   pane, 1380x868, `getBoundingClientRect`, dpr 2; the injected line is 20px of
   the same width as the box):
   | what | `textarea.y` | composer box |
   | --- | --- | --- |
   | idle | 757.00 | 740.25..852.00 (112.00) |
   | a 20px line injected ABOVE the box | **757.00** | 740.25..852.00 (112.00) |
   | a 20px line injected BELOW the box | 737.00 | 720.25..832.00 (112.00) |
   | armed, masked and unredacted (the real sentence, above the box) | 757.00 | 740.25..852.00 (112.00) |
   The band pins the box's BOTTOM edge, so anything added under the box pushes
   the typed line up by its full height and anything added over it pushes the
   TRANSCRIPT instead. The sentence therefore costs the typed line nothing, and it
   takes the composer's own width (832px at 1380) rather than the row's
   leftovers, which is what stops the ribbon.
   **The four states are one geometry.** At 1380, 950 and 800 the textarea's `y`,
   its height and the box's height are identical in idle, armed, masked and
   unredacted (1380: 757.00 / 34.00 / 112.00; 950 and 800: 755.00 / 28.00 /
   118.00), and the cwd chip's width is untouched in every state at every width
   (260 / 244 / 96 / 44px). **The composer is `origin/main`'s, state for state,**
   measured on both trees with the same rig and the same viewport: field `y`
   402.25 / 408.00 / 411.00 / 411.00 and field height 34.00 / 34.00 / 28.00 /
   28.00 at 1380 / 950 / 800 / 440, with the box 112.00 at 1380 and 124.00 (fresh)
   / 118.00 (after an edit) at the three narrow rungs — the same two numbers on
   the same tree on both sides of the diff. (The fresh/after-edit pair is the
   field's own rows-based height following its line box once it has held a value:
   27.5px of content at the small rung against 33.7 at the wide one. It is not a
   difference between the trees — that was the one state round 3's own numbers
   were taken in, and it is named here rather than left to look like one.) Where
   the field is taller than one line — a secret long enough to wrap in a 172px
   box at 440 — the box grows by exactly that difference and no more: 118 + (47 -
   28) = 137 and 118 + (67 - 28) = 157, i.e. the sentence contributes 0px at every
   width.
   **THE EMPTY CHAT WAS THE ONE PANE WHERE THAT DID NOT HOLD, and round 4 fixed
   it rather than disclosing it** (UX round 4, U16). The band takes `grow` +
   `justify-center` there and centres the composer instead of pinning it, so a
   line above the box moved the GROUP by half its height: measured on the running
   app, `textarea.y` 402.25 idle -> 416.00 armed — and back, TWICE while one
   command was typed (`/cred` 416.00, `/crede` 402.25, `/credential` 416.00) —
   where live `origin/main` holds 402.25 through all eleven keystrokes. That is
   the pane the app OPENS on, so the movement was a defect rather than a
   disclosed cost.
   **THE SAME INSTRUMENT, BEFORE AND AFTER** (the band rig, `chat-composer-band`
   at 1380x872, `getBoundingClientRect` on the field, the box and the tip row, the
   reviewing round's own probe):
   | | field `y` | composer box | tip row |
   | --- | --- | --- | --- |
   | idle, before AND after | 393.40 | 376.40..488.40 | 500.4 |
   | capture open, **before** (`4684e1017`) | **407.20** | 390.20..502.20 | 514.2 |
   | capture open, **after** | **393.40** | 376.40..488.40 | 500.4 |
   So the sentence moved the composer AND the tip row by **13.80px** on the
   reviewed head and moves them by **0.00px** now, with the sentence landing at
   348.90..376.40 — directly above the box, gap 0, and `noticeCollisions`/`boxCollisions`
   empty in both states. On the app itself the round-4 UX walk measured the same
   movement as **13.75px** at 1380 (`textarea.y` 402.25 idle -> 416.00 armed, the
   pane's own longer transcript shifting the whole band), and `origin/main` holds
   402.25 through all eleven keystrokes.
   **The device is a MIRROR, not a reservation and not an out-of-flow line.** A
   second, invisible copy of the sentence renders at the end of the composer's
   group on that band only, so the group grows by the sentence's line on BOTH
   sides of the box and the centring shift cancels for everything between them:
   the box, the status row, the tip row and the chips all sit at their idle `y`,
   and the sentence paints in the space the group's own top vacates. The two
   halves share one class list (`credentialNoticeLine`), because the device is
   arithmetic — two class lists would be two definitions of the line's height.
   The clearance is structural rather than tuned: the greeting above yields
   exactly one line, so the sentence's top is always the idle gap below the
   greeting's bottom (the splash's `gap-6` plus the form's `pt-2`), whatever the
   sentence's height or the column's width.
   The two devices it is NOT, and why, because both look cheaper: taking the
   sentence OUT of the flow adds no height, but on this band the completion list
   is `absolute bottom-full` above it in the same wrapper, so the list would
   resolve to the sentence's own strip and paint over it — and that sentence is
   the only thing that says what Enter will do; RESERVING the line while the
   sentence is absent moves the IDLE composer, which is `origin/main`'s to the
   pixel (402.25 on both trees at 1380). It is confined to this band because a
   mirror below a bottom-anchored band would grow the band downward and push the
   typed line up by the line's full height — the defect design D1/U14 removed.
   **And the slash popup clears it rather than covering it.** The list is
   `absolute bottom-full` and now anchors to the same wrapper the sentence lives
   in, so the armed state's completion list (830x108, measured on the running app)
   sits above the sentence instead of over it.
   **AND THAT WRAPPER CARRIES THE SHARED MEASURE, which round 4 had to add**
   (design round 4, D1 — the round's only MAJOR). A wrapper is a containing block:
   moving the anchor off the composer box (which carries `CHAT_MEASURE`) onto a
   `w-full` wrapper silently re-pointed the list's `left-0 right-0` at the COLUMN.
   Measured on the same story and the same viewport against live `origin/main`:
   the list was **x 63..961 (w 898)** on `main` and **x 48..976 (w 928)** at the
   round-3 head — the box itself measuring 62..962 (900) on both — and in a 1332px
   column **241..1139 (898)** became **48..1332 (1284)**, a **192px** overhang on
   each side, from the first `/` anyone types. The wrapper now carries
   `CHAT_MEASURE` and the list spans the composer again — measured on the same
   instrument, `chat-message-input--idle` with `/l` typed: **62..962 (w 900)** at
   the 1024 measure and **240..1140 (w 900)** in a 1332px column, i.e. flush with
   the box's own frame where `main` sat 1px inside it (898, because there the
   BOX was the list's containing block and its 1px border was the inset). The
   field's own x is unchanged across the two trees (79..945 and 257..1123), so
   nothing but the list moved.
   **And the sentence says what Enter will actually do in the state the operator
   is in** (UX round 2, U10; UX round 3, U15). With an EMPTY span Enter does not
   mint: it falls through to the dispatcher, which opens the credential picker in
   a session and, on a pane with no session yet, answers that the command needs an
   open conversation. So there are three sentences, not two: armed;
   masking-and-filled; masking-and-empty (in a session, or on a draft pane) - and
   the draft one now says what Enter DOES ("runs /credential, which needs an open
   conversation") instead of what it cannot do, because U8's repair made the old
   wording false about the pane: this pane stores the credential fine once a
   character arrives.
Everything else — the regex, the mask cell, the marker format, the citation
phrases, the naming convention, the disarm rules, the whole-buffer teardown
(§3), the typed-through re-anchor (§2) — is ported exactly, because those are
the parts whose behaviour the model and the session store depend on.

## 8. Naming the credential

Ported exactly (`editor.py:680-722`), because the name is the env var the model
must use and the store must not be silently clobbered:

- prefix `LOP_SECRET_`, then 8 symbols from `ABCDEFGHJKMNPQRSTVWXYZ23456789`
  (**30** symbols, no lookalikes) — 39.3 bits;
  **The alphabet is 30, not 31, and this document said the wrong number until
  round 1** (code review round 1). The string is twenty-two letters — no `I`,
  `L` or `O` — plus the eight digits `2`-`9`: 22 + 8 = 30, and 8 characters over
  30 symbols is 39.26 bits, which is the figure this document's own reasoning
  already gave. The TUI's docstring repeats the same miscount over the same
  string (`local_operator/tui/widgets/editor.py:680-722` says 31), so the error
  was inherited rather than invented here: correcting it in the port without
  naming the source would leave the next reader filing the same bug twice.
- drawn from a **cryptographic** source (`crypto.getRandomValues`), never
  `Math.random`: a predictable name lets anything that can read the model's
  context guess the env var to look for;
- `taken` is the **union** of the session store's names and this composer's
  in-flight keys; a collision silently *replaces* a live credential
  (`store_credential` overwrites), so this is consulted rather than trusted to
  probability. Bounded retries (16) then a widened 16-symbol name, so it can
  never spin;
- the name must satisfy the backend's own pattern
  (`^[A-Za-z_][A-Za-z0-9_]*$`, ≤128) and round-trip the store's normaliser
  unchanged.

## 9. Sending: store, then substitute

At submit, with the TUI's `_capture_inline_credentials` as the reference:

1. **cited payloads, in citation order** — only markers still present in the
   buffer whose marker text matches the payload's own marker. A marker the user
   backspaced away is not cited, so its secret is never stored (the same rule
   that drops an uncited image).
2. store each one: `desktopResult({ op: "sessions.credential", sessionId,
   action: "store", key, value })` — the existing op and the existing route
   (`POST /v1/desktop/sessions/{id}/credentials`), which reaches the session's
   `credential_op` and therefore the same `VariableStore` the TUI writes and the
   same injection into `bash`. **No contract change and no backend change is
   needed or wanted**; if one starts to look necessary, stop and report it.
3. rewrite **every** citation, whether it stored or not, so the model is never
   handed a name it cannot use:
   - stored:
     `[credential LOP_SECRET_K3RQ7WZM (64 chars) — available to bash and eval as $LOP_SECRET_K3RQ7WZM; its value cannot be read]`
   - refused or unreachable: the TUI's `describe_unstored` sentence for the
     cause that actually applied (`null` → the session could not be reached;
     `empty-key` → the store rejected its name; otherwise the value did not
     survive, so ask the operator to paste it again). One authority for these
     phrases, shared by every path that writes one.
   - **an UNBACKED marker** — a marker in the buffer that no payload backs, which
     is what a restored draft holds — takes the same "the value did not survive"
     sentence, and this is a round-2 correction rather than a new case: leaving it
     verbatim was the silent failure this whole step exists to remove, and the
     shape cannot be told apart from the app's own receipt after a reload, so the
     rule applies to the shape (design round 2, D2; UX round 2, U11; code review
     round 2, MAJOR 1). It also means the early return — "nothing is cited, so
     there is nothing to rewrite" — is no longer right: a message can cite nothing
     and still need substituting.
4. tell the operator, per outcome: on success the TUI's notice — *"Stored
   <keys>. Injected into every bash command as an environment variable; the
   agent cannot read the value."* — and on failure a warning naming the retry
   that actually works ("Paste the value again after `/credential`"), because
   there is no other gesture that retries a store. The existing toast helpers
   (`@shared/utils/toast-manager`) are the surface.
5. clear the map once the store holds the values, and **only once the buffer
   stops citing them**: the retirement is requested by the submit and performed
   by a commit, so the pill and the value behind it disappear together (§6).
6. **a cited credential in a conversation's FIRST message has to be storable**,
   and this is the one place the port cannot copy the TUI. The TUI's session
   always exists; here a new-chat pane has an id only after `sessions.create`,
   and the create happens INSIDE the send — after the composer has decided what
   to send and before the transport leaves. So the send carries a seam
   (`beforeAdmission`) that the host calls with the id it resolved and before the
   message is admitted, and stores there: the composer hands it the payload with
   its markers, and the text that leaves is what the seam returns. Without it the
   operator's most likely first use — a brand-new chat whose first message hands
   over an API key — silently degraded to the not-stored citation, which is the
   inversion of §9's whole point (UX round 1, U2). **No backend change and no
   desktop-contract change**: the seam is a callback the composer already had a
   place for (the send's own optimistic echo sits in the same window), and a host
   that cannot offer the window simply ignores it.
   **Round 2 found the seam present and unreachable in the app** (UX round 2, U8;
   QA round 2, Q5): the composer decided whether it had a session by testing the
   page's `sessionStatus` object for truthiness, and a New-chat pane is handed one
   — built from `sessions.preview`, `draft: true` — because the status strip
   renders the draft's own readings from it. So the pane the feature is most likely
   to be used from took the "I have a session" branch, stored against the pane's
   own non-session id, and the transport refused it locally with a 422 that never
   reached the wire; the operator saw a warning toast after the fact and the model
   received the not-stored citation, while an established session's identical
   gesture stored correctly. The predicate is the page's own `draft` flag, and the
   suite now mounts the composer with the props the real pane passes.
7. **The list answer is read in ONE place.** The runtime answers
   `[{"key", "source"}]`, not `string[]`; the collision guard and the credential
   picker both need the names, so one reader (`credentialNamesFrom`) turns that
   payload into them. Read as strings the guard's `taken` set was always empty —
   the collision rule was inert — and the picker crashed the renderer on its
   first successful list, React error #31 (QA round 1, Q3).

The `/credential` argument must stay stripped from any command dispatch
(`slash-dispatch.ts`: `/credential` is refused so a secret can never land in
command text) — that guarantee is now stronger, not weaker, because the value
never enters the text at all. A message whose text cites a marker is a **normal
message**, not a slash command, even when the pill sits at the start of the
line: the token was consumed at mint time, so the leading-slash plan cannot fire
on a minted pill.

## 10. Acceptance criteria

- Leading **and** mid-prose gestures both work, and the pill sits inline in the
  surrounding text with the caret and the prose continuing after it.
- Typed characters are never in the buffer, the persisted draft, localStorage,
  the transcript, any log, or any telemetry payload; a canary secret must be
  greppable nowhere after a full store-and-send cycle.
- Enter/Esc/paste behave as §3-§5; the masked, armed, chipped and escaped states
  are each visible and each explained to the operator.
- A stored credential is reachable by the agent's `bash` tool as `$LOP_SECRET_…`
  in the same session, and the model's prompt contains the citation and never
  the bytes.
- A store that fails produces the honest citation and a notice, never a key
  nothing holds.
- The pill and the masked span are legible in **every theme** (contrast
  floors from the branding contract), not only the two brand palettes.
- **The chip covers the marker's own box, at both rungs.** The claim is a pair of
  rects and not a description: `scripts/credential-chip-geometry.mjs` prints the
  run's box and the chip's box per story and viewport, and all four deltas are
  zero (157.33 x 17 at 1024, 147.67 x 16 at 440, measured on the committed
  stories). A run that WRAPS has no single box and keeps the wash, with no chip.
- **The chip's content fits the box it is given.** Its words are the label, the
  count's unit and the control; the natural width of the full `Credential #1`
  wording is 191.3px against a 157.33px run, which is why the label is the index
  (§7.1) and why the rig reports `content` against `client` — a chip that clipped
  its own count would look exactly like one that fits.
- **The clear control destroys the reference and says so.** One edit, marker and
  trailing space, the payload dropped, the sentence the operator reads naming the
  key and where the value went; an unbacked marker offers no control at all; the
  composer's focus returns to the field through `focusInput`, so the keystroke
  after the click is not lost; and a composer that is REFUSING input offers no
  control either, because the clear is a write into the box and the refusal
  gates every write (`isInputDisabled`, the predicate the textarea, the submit
  path, paste, dictation and the slash pick all read).
- **The transcript renders the same chip for the same citation**, on both render
  paths (canonical and legacy), with the citation's text unchanged in everything
  that is stored, sent or logged: a `git diff` of the message text across the
  change is empty, and only the user's own turn opts in (agent output, the
  streaming path and reasoning are unaffected).

## 11. Out of scope

- Changing the backend, the desktop contract, or the session store.
- Reworking the existing `CredentialPicker` (it stays, and stays the way the
  list/store/forget verbs are reached).
- Expanding a pill back into the buffer: the TUI refuses this for a credential
  (`ctrl+r` refuses; `action_expand_paste`), and so does this port.
- Multiple simultaneous captures (one span at a time).

## 12. The fold onto `3cb1eea3c` (2026-09-18)

This branch was rebased onto `origin/main` three times; the last one is the only
one that moved code this document describes, so the contract's implementation
notes changed with it and the earlier ones did not.

- `#302` (`fix(composer): a credential typed mid-sentence plans as the command,
  not as prose`) owns the same composer files and the same `/credential`
  vocabulary. Two things it changed are load-bearing here. First, the
  command-lock is DERIVED (`lockedRunOf(buffer, caret)`) rather than stored, so
  §7.1's clear control — which splices a MARKER, not a `/credential` token — has
  no lock state to maintain and cannot leave one stale. Second, the
  unredacted-draft notice now carries the command's name as a second argument,
  and the composer's notice line therefore has an order: the unredacted sentence
  (a secret still in the buffer, about to be exposed) outranks the cleared
  sentence (a value already gone).
- `#311` (`feat/chat-link-affordances`) gave the renderer an anchor of its own
  (`MarkdownAnchor`, reached through `LINK_URL_TRANSFORM`), which is now the one
  link implementation in the app. §7.1's transcript override is therefore a
  FACTORY the renderer calls once at module scope with its own anchor, and every
  link that is not a citation renders through that anchor — a second `<a>` in the
  citation module would be the "second implementation of one thing" the
  renderer's own comment refuses. The citation URL survives the new transform
  because `classifyHref` answers `other` for a `#`-fragment (its URL branch is
  http-only, its file branch is `file://` or a `/`-rooted path), so
  `defaultUrlTransform` passes it verbatim; the three transcript states were
  re-captured and came back byte-identical, which is the end-to-end proof rather
  than the reading.
- The renderer's plugin selection now answers three questions (math, linkify,
  citations) out of eight hoisted arrays selected by one table, because
  react-markdown memoises against array IDENTITY and a builder would miss that
  memo on every render. The hook keeps main's name (`useMathPipeline`): a third
  spelling of the same function for no behaviour is not a change worth making in
  a conflict resolution.
- The frames: sixteen credential states re-captured from the rebased tree;
  141 of 162 byte-identical to the committed set, twenty sub-threshold (0–4 px
  at a 5% fuzz), and the twelve `credential-pill-cleared` frames differing only
  inside the sentence's own minted key name, which is random per run. Nothing in
  the treatment moved, and the chip's geometry rig re-derives the same boxes on
  this base (157.33 × 17 at 1024, 147.67 × 16 at 440, four deltas 0 at every
  rung, 0,0,0,0 scrolled, 0 after the composer's own box narrows).
