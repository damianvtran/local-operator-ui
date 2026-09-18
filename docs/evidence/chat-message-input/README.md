# Composer states for cold-send review

Eight inherited Storybook frames: four states at 1024 x 300, each in
`localOperatorDark` and `localOperatorLight`.

| State | Visible placeholder |
| --- | --- |
| `idle` | Ask me for help |
| `awaiting-reply` | Waiting for the agent |
| `awaiting-reply-transport-down` | Ask me for help (wait claim withdrawn) |
| `awaiting-answer` | Answer the question above |
| `conversation-gone` | This conversation is gone |

These files were produced by the earlier interrupted coder's legacy repository
capture harness and were untracked at the handoff on `7550bf1ae`; the inherited
manifest records that narrowed pass. The finishing Astra coder preserved and
visually inspected all eight, but **did not produce these with the browser tool**
and does not re-label their provenance. The transport-down story is a controlled
presentation fixture, not a live disconnect test. Focus rings belong to the
focused, editable composer; Send remains unavailable when the fixture is busy.

The current code still contains these Storybook surfaces. The subsequent
completion-anchor fix does not change their non-failure inputs or styling.
New real-browser full-pane evidence (including the composer, pending question,
recovery and before/after failure) is in
[`../chat-cold-send-browser/README.md`](../chat-cold-send-browser/README.md).
That separate evidence, rather than these legacy images, carries the new live
validation claim. D3's previously missing committed state pictures are now here.

`conversation-gone` is the one state added to this set after the inherited pass:
the band's own gone-state row (`scripts/capture-evidence.mjs`, the D3 region)
now names this set's story at 1024 x 300 rather than the retired
`chat-composer-states` sheet, so the sweep writes
`docs/evidence/chat-message-input/conversation-gone/`. The frames land on the
next full sweep; the id rather than the pixels is what that change carries.

## The inline credential capture's seven states

Eighty-four frames the eight above do not account for: seven states of the
composer's inline `/credential` gesture (`docs/design/composer-credential-capture.md`), each
in all twelve themes, at the same 1024 width — the five gesture states round 1
took, plus the two round 3 added (a capture beside a live working-directory chip
and the session's readings, and the shipped small-view rung with the capture
open).

The exact command that wrote them, from the tree this branch commits:

```
npx storybook dev -p 6018 --host 127.0.0.1 --no-open --disable-telemetry
node scripts/capture-evidence.mjs --only=chat-message-input--credential \
  --allow-backend http://127.0.0.1:6018
```

6018 and not the default 6017: a sibling worktree's Storybook already held the
default. `--allow-backend`
is the flag a narrowed run needs because the operator's own app is listening on
1111, and no surface here talks to it. The run was narrowed to these five stories
and to this surface's directory; `manifest.json`'s `partialCapture` and the
branch's own `credentialCapture` record the pass.

### Round 5: the reservation becomes a grace window

The composer's right-hand cluster changed again, and for a reason that is the
operator's rather than the code's: the reservation UX round 1's U1 and QA's Q1
required - an invisible box holding the Stop control's place for as long as the
backend negotiated `session_interrupt` - left a standing gap between the dictation
control and Send, which the operator then reported as a defect of its own. The box
is now held only while a turn runs and for a 500 ms grace window after it ends
(`src/renderer/src/features/chat/interrupt-slot-grace.ts`), so an idle composer is
`[dictation][Send]` adjacent and the row the turn runs with is unchanged.

The two stories that declared the reservation (`StopSlotReserved`,
`StopSlotReservedSmallView`) declared a state that no longer renders on mount, so
they are RENAMED to what they now show - `stop-slot-settled` and
`stop-slot-settled-small-view`, captioned "idle between turns, session_interrupt
negotiated: dictation sits beside Send, no box held" - and their twenty-four
frames re-taken with the repo's own rig rather than by hand:

```
npx storybook dev -p 6131 --host 127.0.0.1 --no-open --disable-telemetry
node scripts/capture-evidence.mjs --only=stop-slot-settled http://127.0.0.1:6131
```

6131 rather than 6017 or 6018 for the reason 6018 was not 6017: sibling worktrees
held both when this ran, and the default port answered with THEIR story index.
The frames the old ids named (`stop-slot-reserved*`) are deleted rather than left
beside the new ones, `scripts/capture-evidence.mjs` registers the new ids (its
`STORIES` list is what `surfaces` counts), and `manifest.json`'s `partialCapture`
records the pass: `refreshedStories` gains the two new ids, `addedSurfaces` the two
new directories, and `frames` is re-derived from the tree rather than adjusted -
the 24 added and the 24 the deleted directories held cancel, which is why the
swept count returns to the number it was.

What these frames CANNOT show is the window itself: a Storybook story mounts a
component in one state, and the window opens on the TRANSITION a turn's own end
produces (a freshly mounted composer renders no reservation, by design). That
transition is measured in the real app instead, in the frames and record beside
this set under [`../interrupt-live/`](../interrupt-live/README.md): the same row
photographed 74 ms after the composer's flip (box still held, a press there
starting nothing at 161-170 ms) and 1776 ms after it (box gone, the two controls
adjacent, and a
press at the dictation control's own centre starting a recording). It also carries
the three dictation-in-flight frames - a recording running across a turn's end,
which is the shape where a release would otherwise move the recording's own
controls under a press - and the whole run's row-transition timeline.

### Round 2: the notice moves, and the leaked frames are re-taken

The round-2 remediation changed the composer's own layout again — the notice
moved out of the band it reserved above the textarea and onto the control row the
composer already has (§7.5) — so the whole surface was re-taken once more: all
SEVENTEEN states, twelve themes, 204 frames.

```
npx storybook dev -p 6055 --host 127.0.0.1 --no-open --disable-telemetry
node scripts/capture-evidence.mjs --only=chat-message-input \
  --allow-backend http://127.0.0.1:6055
```

Every frame of `chat-message-input` was rewritten by that run, for two
independent reasons, and which frames changed for WHICH reason matters:

| Frames | Why they were re-taken |
| --- | --- |
| `credential-armed`, `credential-masked`, `credential-escaped` | The notice moved onto the control row, so the textarea sits **31.5px higher** (its `y` is 78.39 where round 1 left it at 109.89) and carries no reserved line of its own. **Round 3 moved it again — out of the composer entirely, to a full-width line above the box; see the round-3 section below, which is what these frames now show.** |
| `idle`, `credential-pill-mid-prose`, `credential-pill-at-line-start`, `awaiting-*`, `stop-*`, `interrupt-*` | The standing reservation is gone: the composer's ring bottom returns to its round-1 predecessor's **210.58 -> 179.08**, and the typed line to **78.39** (round 1: 109.89). **The claim that this made the `idle` frame "geometrically the frame that was captured before this feature existed" was FALSE as written, and round 3 corrected it:** the composer box at that head measured `61.4..179.1` (117.7px) against live `origin/main`'s `61.4..173.4` (112.0px) at the same story, decorator and viewport, because the overlay's wrapper left the field an inline-block in a line box (39.7px around a 34px field). All three archive claims that said otherwise are corrected in round 3's section below, and the frames were re-taken again with the fix. |
| `interrupt-left-work-running`, `stop-slot-settled`, `stop-slot-settled-small-view`, `interrupt-left-children-only`, `interrupt-left-jobs-only`, `interrupt-unavailable-old-backend` | Both of the above, **and** the leaked escaped canary is gone: these six are the frames design round 2 photographed holding a secret they have nothing to do with (D1). The pair the reservation's stories carried is renamed in round 5 (below): `stop-slot-reserved`/`-small-view` were the same two stories under ids that no longer describe what they render. |

The last six are the ones the round-2 review could not sign off, and the fix that
removed the leak is the capture's own (the draft store is cleared per frame), not
a change to any story.

### Round 3: the sentence leaves the composer, and the composer returns to `main`

Round 3's four streams converged on one area — the notice's placement inside the
composer and the geometry the capture's own wrapper had introduced — so the
remediation is one change to that area and the surface was re-taken once more:
all NINETEEN states, twelve themes, 228 frames.

```
npx storybook dev -p 6188 --host 127.0.0.1 --no-open --disable-telemetry
node scripts/capture-evidence.mjs --only=chat-message-input \
  --allow-backend http://127.0.0.1:6188
```

| Frames | Why they were re-taken |
| --- | --- |
| `credential-armed`, `credential-masked`, `credential-escaped` | The sentence left the control row and the box entirely: it is now a full-width line **above** the composer box (§7.5), so the composer's own ring sits at rows **85..204** in these frames, one sentence's height below the idle frame's, where round 2 had the sentence inside the row at the composer's own position. The box's height is unchanged (the ring rows are 119 apart in both the idle and the armed frame), and the sentence's line is the composer's width — never the ribbon design round 3 measured at 1380/950/800. |
| `idle`, `credential-pill-mid-prose`, `credential-pill-at-line-start`, `awaiting-*`, `stop-*`, `interrupt-*` | Nothing at all, and that is the point: the field now declares `block`, so the line box the overlay's wrapper had introduced is gone and the composer is `origin/main`'s again. Measured on the committed pixels — accent ring rows, counted as rows with more than 200 accent pixels — the `idle` frame is **57/58..175/176**, which is exactly the pre-wrapper frame's (`a8b056aa7`: 57/58..175/176); the round-3 head's idle frame was 57/58..**181/182**, the 6px the extra line box cost. Across the twelve non-credential states **all 144 frames** are pictures of the pre-wrapper geometry, measured against the copy at `492bcecf1^` rather than argued: **0 of 144 are byte-identical** (a WebP re-encode is not byte-stable), **128 of 144 have no pixel differing at all at a 5% fuzz**, the remaining **16 differ in exactly one pixel** each, and at a **10% fuzz all 144 are identical** — the largest per-channel difference anywhere in the set is **28/255** (`interrupt-left-jobs-only/neon`), with the per-frame peaks at 10-28/255, which is the encoder's own re-encode noise on frames whose geometry did not move. **The "142 bit-exact" this section claimed does not reproduce in any baseline** and is replaced by the sentence above (design round 4, D4; code review round 4, NIT 1; QA round 4, Q3 — all three measured it independently and got the same 128/16 split). And the live app agrees: the composer box measures **112.00px** on this head and on `origin/main` at 1380, and 124.00px on both at 950, 800 and 440, with the field's `y` and height equal. |
| `credential-masked-session-pane`, `credential-masked-small-view` | **New stories**, both asked for by round 3 (D3, D4). The first photographs the sentence with the two neighbours that used to decide its wrapping — a live working-directory chip and the session's readings — sharing the row (1024px). The second photographs the shipped small-view rung (a 440px column with `isSmallView`) with the capture open, in which round 2's "at most 7.5px" bound had measured 11px. |

What this round does NOT change, and a reader should not look for here: the
masked cells, the pill's wash and edge, the minted marker text, the Esc restore
and the notice's own sentences are round 1's and round 2's, and their frames
agree with the ones those rounds committed wherever the sentence's position is
not in the picture.

### Round 4: the register's own frame, after the fold onto `origin/main`

Round 4 filed three findings against this surface — design D1 (the slash popup's
anchor had moved to the COLUMN), D2/U17 (the not-stored register was carried by
hue alone) and D3 (that register had no frame at all, on a surface whose evidence
IS frames) — so the surface was re-taken once more: all TWENTY states, twelve
themes, 240 frames, at the head this branch commits.

```
npx storybook dev -p 6188 --host 127.0.0.1 --no-open --disable-telemetry
node scripts/capture-evidence.mjs --only=chat-message-input \
  --allow-backend http://127.0.0.1:6188
```

| Frames | Why they were re-taken |
| --- | --- |
| `credential-pill-unbacked` | **New state**, and the one design D3 asked for: a marker a restored draft cites whose payload did not survive — the live pill's own sentence with the value gone — painted in the warning register with the **dashed** edge round 4 added, so the register is legible without relying on hue (D2/U17; code review MINOR 2). Nothing backed its paint before this frame except a test case and a row of `scripts/contrast-contract.mjs`. |
| the other nineteen | **Nothing at all.** The re-take is the fold's and the re-stamp's: the popup's anchor regained the composer's measure (D1), which changes no committed frame here — the list is not open in any state this surface captures — and the register's dash paints only on the new state. Measured against the previous head's copies (`4684e1017`): **1 of 227 frames differs at all** (`credential-masked-small-view/localOperatorLight`, one pixel) and **none differs at a 5% fuzz**, which is the reproducibility claim the round-3 section makes, re-earned on a tree that had also folded nineteen commits of `origin/main` in. |

The re-take is narrowed to this surface, so `manifest.json`'s `partialCapture`
carries the pass (`refreshedStories`, `refreshedFrames`) rather than the whole
swept set. The two record corrections round 4 asked for are in this file: the
bit-exact count above, restated as measured, and the round-3 section's citation
of the pre-wrapper copies, which now names the commit each comparison ran
against.

### Round 1: the WHOLE surface, re-taken

A frame is evidence about a tree, and this branch's round-1 remediation changed
the composer's own layout in every state — the notice line held its space above
the textarea whether or not it had a sentence (a decision round 2 reversed; see
§7.5 of the design record), so the textarea sat at the same `y` idle, armed,
masked and minted. That was a change to the ordinary composer as much as to the
gesture, so all SEVENTEEN states in this directory were re-taken rather than the
five credential ones: 204 frames, twelve themes each.

```
npx storybook dev -p 6041 --host 127.0.0.1 --no-open --disable-telemetry
node scripts/capture-evidence.mjs --only=chat-message-input \
  --allow-backend http://127.0.0.1:6041
```

`--only` matches the story ID PREFIX, so one run covers the surface; the port is
again not the default because a sibling worktree held it. The pass is recorded in
`manifest.json` under `partialCapture` (`refreshedFrames`, `refreshedAtHead`),
which is what a reader follows to tell a narrowed re-take from a sweep.

| Frame (`<theme>.webp`) | State, and what the frame is for |
| --- | --- |
| `credential-armed/` | `/credential` typed and no space after it, so the next space opens the capture. The notice line says so — the TUI's own sentence — which is what makes the state legible instead of looking like ordinary prose. |
| `credential-masked/` | The space has opened the span and every character since is ONE MASK CELL. Nineteen cells against a nineteen-character value: the length is the receipt the pill will carry, and it is the operator's only integrity check once the value can never be displayed again. |
| `credential-pill-mid-prose/` | Enter minted the pill rather than sending, and the sentence continues after it — the gesture's whole shape ("hand over a secret, then describe it"). |
| `credential-pill-at-line-start/` | The same pill at the head of the line. The token was consumed at mint time, so this is prose and not a slash command: the leading-slash path cannot fire on it. |
| `credential-escaped/` | Esc cancelled and the characters came back as ORDINARY TEXT — the one exit that leaves a secret in the composer, with the warning sentence that says so. The canary reads `sk-live-CANARY-4417`. |

**These frames are driven by real keystrokes**, not by a prop that fakes the
state: each story's `play` types into the shipped composer with `userEvent.type`
and fails (taking no frame) if its state did not arrive. That matters here more
than for a colour change, because every rule this feature rests on lives in the
keyboard path — the mask, the positional mirror, the mint, the Escape restore.
`credential-escaped` is the ONE frame that holds the canary, and it holds it
because the operator asked for it with Esc; the other credential states keep the
value outside the document.

**That last sentence was FALSE in the round-1 frame set, and the frames were
re-taken because of it** (design round 2, D1). §6 persists the Esc-restored
characters on purpose — by then they are the operator's prose — so the escaped
canary sat in `conversation-input-store`, which is `persist`ed and therefore
outlives the document; the six stories captured after `credential-escaped` in the
committed order restored that draft and were photographed with the canary in the
composer. Seventy-two frames, measured: against the escaped row's own template
they scored a mean absolute difference of 1.1–2.0 where every other state in the
directory scores ≥ 12, and the round-1 copy of the same six frames scored
16.8–23.0, so the leak was introduced by that re-take and not inherited. The
capture now CLEARS the draft store for every frame
(`scripts/capture-evidence.mjs`, beside the theme seed), so each frame starts from
the draft state its own story declares — the same rule the theme already
followed. No frame is ordered, moved or captioned around it any more.

### What these frames do NOT prove

- **Not the store, and not the model's prompt.** The frames end at the composer.
  What reaches the session's credential store, what the citation says to the
  model, and the notice the operator hears are asserted by
  `scripts/credential-capture.test.mjs` (the pure module, 57 cases) and
  `scripts/credential-composer.test.mjs` (the shipped component's React wiring
  under jsdom, 13 cases), and are the QA round's business on the running app.
- **Not the paste route.** No frame here pastes; the paste capture, the
  append-into-a-span case and the blank-paste fall-through are the test file's.
- **Not the LAYOUT rule the re-take is about.** A still shows where the text
  sits; it cannot show that it sits in the same place in the state next to it.
  The notice's home is pinned structurally by `credential-composer.test.mjs`
  (it sits on the composer's own control row, with no reserved line box of its
  own) and the geometry by the design round's own measurements — the textarea's
  `y` in idle, armed, masked and minted, and the composer's ring against the
  pre-change composer's. Round 1 pinned the opposite rule (a reserved line above
  the textarea), and round 2 measured what it cost: 4px of reflow on arming and
  a composer 38px taller in every state, idle included (design round 2,
  D3/D4).
- **No focus ring and no caret.** A headless capture cannot show a caret, and the
  composer's `:focus-visible` ring belongs to the box, unchanged by this feature.
- **The pill's geometry was not restated here, and now it is a separate rig.** A
  frame shows the chip and the marker text in their real positions, but a still
  cannot say by HOW MUCH one covers the other — the operator's requirement is
  that the chip covers the marker run's box exactly, and a couple of pixels of
  drift reads as a chip sitting slightly off its characters in a picture nobody
  can measure by eye. That pair of rects is printed by
  `scripts/credential-chip-geometry.mjs`, which is also the only place the
  chip's own content is compared against the box it was given (a clipped label
  and a short one look the same in a still). The box model that keeps the mirror
  and the textarea aligned is still shared by construction (`composerTextBox`).

---

## The rebase onto PR #308's base

`origin/main` moved to `09acb156a` (`fix/composer-focus-flow`) while this branch
was in review, and PR #308 rewrote the composer's caret and refusal paths — one
of them `message-input.tsx`, which this branch also rewrites. The rebase
conflicted in one field of one file (`manifest.json`'s `srcTree`/`scriptsTree`,
re-derived from the fused tree, both sides' prose and records kept), and TWO OF
THIS FEATURE'S DECISIONS HAD TO FOLLOW THE NEW BASE rather than be carried across
it:

- **The chip's `x` refuses with the composer.** The refused composer is
  `readOnly` now, not `disabled`, so the box stays focusable and a control painted
  OVER the textarea is newly PRESSABLE while every writer is refused. The clear
  writes into the buffer and discards a payload, so it carries the same
  `isInputDisabled` predicate every other writer carries, and the layer draws no
  control at all while the composer refuses rather than an `x` whose verb cannot
  run. Pinned in `scripts/composer-refusal.test.mjs`, which is where that file's
  own rule says a newly added path has to be declared.
- **Focus goes back through `focusInput`.** `composer-field.ts` now names the
  composer's registered hand-off the single place focus is given, flag reset
  included; a second `.focus()` call site leaves `composerPointerTouched` set and
  suppresses the ask gate's next automatic hand-off. The clear's focus return
  uses the door.

Nothing else in the credential path moved — `credential-capture.ts` has zero
removed lines against the base, and `credential-overlay.ts`,
`markdown-renderer.tsx` and `message-item/message-content.tsx` are untouched by
#308 at all.

**Both narrowed runs were re-taken at this head, and compared frame by frame.**
The transcript set reproduced 36/36 byte-identical. The composer set reproduced
100 of 120 byte-identical; seven differ only below a 5% per-channel fuzz (the
masked run's blinking caret, the phenomenon the round-3 section above already
records), and the twelve `credential-pill-cleared` frames differ because the
MINTED KEY NAME is random per run — the toast sentence the story photographs
carries it, `LOP_SECRET_7PKRK7FT` in the earlier capture against
`LOP_SECRET_9K7KCGRB` here. Those twenty frames are committed from this run, so
every frame in the set is a picture of this branch's own head; the box numbers
were re-derived at the same head by `scripts/credential-chip-geometry.mjs` and
are unchanged (157.33 x 17 at 1024, 147.67 x 16 at 440, all four deltas zero).

**The second rebase moved none of this under the composer.** `origin/main`
moved again to `3a5b66c54` (PR #314, `fix/transcript-paging-momentum`, and the
commits folded with it), and that range moves no file in the composer's paint
path at all — `message-input.tsx`, `credential-overlay.ts`,
`credential-capture.ts`, `composer-field.ts` and `composer-caret.ts` are
byte-identical between `09acb156a` and `3a5b66c54` — so this set was re-captured
rather than argued about: the 120 frames came back with 100 byte-identical, 8
differing only below a 20% threshold at all (the masked run's blinking caret;
seven of them are 0 pixels at a 5% fuzz), and the 12 `credential-pill-cleared`
frames differing only inside the toast sentence, whose minted key name is random
per run (`LOP_SECRET_9KF23QXN` this time). Those 20 are committed from this run.

---

## Operator report, 2026-09-17: the pill becomes a chip, and the transcript
## keeps it

Two frames the operator's own screenshot named, and the pair that answers them.
The pill was a wash painted behind the literal marker text `[Credential #1, 19
chars]`, which reads as a TUI-style square-bracketed marker rather than as a
component; and a message SENT with a pasted secret printed the whole citation
sentence in the reader's own turn. The composer's pill is now a real chip (key
glyph, `#1`, `· 19 chars`, an `x` that clears the reference) painted OVER the
marker run, and the transcript renders the same chip in the same two registers.

TEN STATES on this surface now, twelve themes, 120 frames — the eight the
gesture already had plus `credential-pill-small-view` (the same minted reference
at the shipped compact rung, where the run's box is narrower) and
`credential-pill-cleared` (the `x` pressed, driven by a real `userEvent.click` on
the control):

```
npx storybook dev -p 6018 --host 127.0.0.1 --no-open --disable-telemetry
node scripts/capture-evidence.mjs --only=chat-message-input--credential \
  --allow-backend http://127.0.0.1:6018
```

THE BEFORE HALF is `../chat-message-input-credential-before/`: the three states
this change repaints, on unmodified `origin/main` at `a42bf4739`, same fixtures,
same 1024x300 viewports, same twelve themes. That set carries no README of its
own — its recipe, its frame count and its `why` are the `manifest.json`
`supplementary` entry that declares it, which is where a reader with a question
about the set's provenance should look. **That half was RE-VERIFIED when the
branch was rebased onto `09acb156a` (PR #308), not re-declared:** the three
states were captured again with the moved base's own `message-input.tsx` over
this branch's story file, and 31 of the 36 frames came back byte-identical with
the other five differing only by the WebP encoder's noise (0 pixels at a 5%
fuzz). See the rebase section below and the `supplementary` entry's own note. The
other five states are not in it deliberately — the pre-change run reproduced 93
of their 96 frames byte-for-byte.

WHAT THE CHIP'S FRAMES CANNOT SAY, and where each is said instead: the box
algebra (run box against chip box, and the chip's content against its own
client width) is `scripts/credential-chip-geometry.mjs`, quoted in the design
record's §7.1; that the cleared payload is really GONE is
`scripts/credential-capture.test.mjs` (`clearCitedCredential` and the
`citedPayloads`/`substituteCredentials` outcome beside it); and that the cleared
chip's `x` is reachable by a pointer is the `credential-pill-cleared` story's own
play function, which throws rather than releasing the shutter if the click did
not land.

---

## Round 1's remediation: the chip follows the field, and the four states the round had no frame for

PR #337's four review rounds (code, QA, design, UX) found one blocker, four
majors and a batch of minors. They are fixed in one code commit (`a5227de6c`),
and every frame this round touched was re-captured from that tree, one state per
run, twelve themes each.

**The blocker, and the frame that holds it.** In any message long enough to
scroll, the chip sat exactly `fieldScrollTop` px from its marker — an opaque
ground, and a live `x`, over unrelated prose — because the measurement added the
mirror's own scroll to a rect that is already viewport-relative. The two terms
are gone. `credential-pill-scrolled` is the state that could not be photographed
before: a fifteen-line message with the reference minted at its end, the field
scrolled, and the chip over its own glyphs. Its play function measures the pair,
and `scripts/credential-chip-geometry.mjs` reports the same pair at a middle and
an end position as well:

```
chat-message-input--credential-pill-scrolled  @ 1024x300
  -- as painted                 delta {"left":0,"top":0,"width":0,"height":0}
  -- scrolled to its middle (scrollTop 113)   delta {"left":0,"top":0,"width":0,"height":0}
  -- scrolled to its end (scrollTop 225)      delta {"left":0,"top":0,"width":0,"height":0}
```

The same rig now narrows the composer's OWN box (a viewport resize proves nothing
here — every story pins its column width, and the first version of that phase
measured exactly that) and asserts the deltas stay zero: `866 -> 584px` at the
1024 story, `374 -> 194px` at the compact one. That is code review R1-3's resize
case, which no story can drive.

**Three more states, each one finding's own frame.** `credential-pill-hover` is
design D3's: the rig moves the REAL pointer onto the control (a synthetic event
leaves no `:hover`), so the ink step and its `elevated` ground are in the
picture. `credential-pill-focused` is D2's: real Tab presses walk to the control
and the dense `outline-offset-1` ring is visible around a 16x16 target — 16x16
being as far as a 17px run box allows, recorded as a WCAG 2.2 SC 2.5.8 deviation
rather than left silent. `credential-pill-cleared-undone` is UX U2's: the toast's
`Undo`, clicked for real, with the play function requiring the buffer to come
back byte-identical and the chip to be painted again on its run.

**What changed in the existing frames, measured rather than asserted**
(committed frame against this round's, `magick compare -metric AE -fuzz 5%` over
307,200 px):

| set | frames | difference |
| --- | --- | --- |
| `credential-pill-cleared` | 12/12 | material, 21,992–58,404 px — the sentence is on the notice line now as well as the toast, and the toast carries `Undo` |
| `credential-pill-mid-prose`, `-at-line-start`, `-small-view` | 36/36 | the chip's own face only, 460–532 px — the count beside the ordinal (D1), the 16x16 control with its ink step (D2/D3) |
| `credential-masked`, `-masked-small-view`, `-masked-session-pane` | 5 frames | 0–5 px: caret and encoder noise, committed from this run |
| `chat-canonical-credential-citation/citation-in-code-fence/localOperatorDark` | 1 frame | 0 px at a 5% fuzz: encoder noise. The transcript's rendering does not change — the two rules this round added there (link provenance, the math veto) alter no pixel of these three states |

**The stranded space in the cleared frame is the fixture's own typing, not the
`x`** (design D6). Arming mid-prose takes the space before `/credential`
(`CREDENTIAL_ARM` is anchored to a whitespace boundary), so a sentence whose
continuation starts with a comma leaves `key ,` — the same space a deleted word
would leave, and the app does not rewrite the operator's sentence around a
reference it removed. Recorded, not "fixed": the alternative is editing prose
the operator typed.

### The fold onto `3cb1eea3c`: re-captured, and what moved

Every frame in this directory was re-taken from the rebased tree, because the
composer's own files were rewritten under this branch by `#302` (the credential
command-lock) and the renderer's by `#311` (link affordances). Compared frame by
frame against the committed set: 141 of 162 byte-identical, twenty sub-threshold
(`0–4 px` at a `-fuzz 5%` compare — caret and webp-encoder differences, thirteen
of them `raw` differences with an empty bounding box), and the twelve
`credential-pill-cleared` frames differing only inside the minted key name the
sentence carries (`LOP_SECRET_QHJYN444` in this run; the name is random per
session). Nothing in the treatment changed, and the cleared state still shows
both channels — the sentence on the notice line and the toast with its `Undo`.

`scripts/credential-chip-geometry.mjs` was re-run on this base: the chip's box
matches the marker run's box exactly at both rungs (157.33 × 17 at 1024,
147.67 × 16 at 440), four deltas `0` at every rung, `0,0,0,0` at `scrollTop` 113
and 225 in the scrolled story, and `0` after the composer's own box is narrowed
866 → 584 and 374 → 194.
