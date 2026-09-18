# The composer's `@` mention layer

Frames of the composer's `@` file mentions: the chip drawn behind the sentence,
and the list that inserts its token.

Each state is reached by **typing its draft into the production composer** in a
story's `play` — real keystrokes through `@storybook/test`'s `userEvent`, into
the real `MessageInput` — and the frame is only taken once that state's own
precondition holds (the chip exists, the list has rows, the notice row is up). So
a frame cannot show a state the composer would not produce: the picker's debounce,
the listing round trip and the chip's re-measure after every keystroke all have
to happen for one to exist.

`node scripts/capture-evidence.mjs --only=chat-mention-chips --allow-backend`
(the `--allow-backend` is this repo's own opt-in for a narrowed set that captures
no surface which talks to a backend; the composer here reaches only the three
channels below), plus one narrowed run for
`--only=chat-mention-chips--picker-many-rows` when the row-budget entry was added.
The pass this set ships from ran at
`90373bc6030c4ce3ebaa4bbb9b98b3a067bbed5b`, twelve themes: **288 frames over 24
directories** — the 276 over 23 the reviewed round carried, plus the 12 frames of
`quoted-mention`, the state review round 2 named as the one frame this surface was
still missing. The head is cited in the spelling this branch ships, and it is the
head the frames were TAKEN at rather than the one they ship in: the manifest's own
ancestry rule requires its `head` to be an ancestor of `HEAD`, and a capture can
only be stamped from a tree that is already committed, so a set always lands in a
commit after the tree it photographed.

**And this set was folded onto a moved `main` after that pass — five times — so
read the head above as the spelling the folds gave it.** The manifest's
`srcTree`/`scriptsTree` describe the tree the frames SHIP in, so a fold invalidates
them whatever the branch's own delta is, and both are re-derived on the merged tree
each time. The eighth fold (`main` at `318cbb75e`) moved 35 commits and 738 files —
40 under `src/`, 19 under `scripts/` — and left the pictures alone, and that was
measured rather than argued: this set's own narrowed run re-took all **288 frames on
the merged tree** and 19 came back with different bytes — **0 pixels differing above
a 4% fuzz in every one of them**, RMSE at most 0.0011, against 1,407 pixels over the
threshold at this set's smallest redrawn change — so the encoding-level bytes were
reverted and that fold's diff carries no `.webp` at all. The file-level argument
agreed there: none of the files this band renders was among the moved ones, and the
two `features/chat` files upstream did move (`pickers/destination-pickers.tsx`,
`components/run-details/run-detail-wakes.tsx`) render in the slash destination and
run-detail surfaces rather than in this one.

**The ninth fold (`main` at `44cb3af3c`) is the one that moved this band, so that
file-level argument does not carry it.** `main` moved 60 commits and 226 files under
this branch (the 0.26.6 through 0.26.9 windows, the composer mic's stop-slot grace
window, #307's store-refusal retry hint), 17 of them under `src/` and 26 under
`scripts/`, and **`message-input.tsx`, `chat-page.tsx` and `chat-content.tsx` are
now among them**. The case is therefore made on frames rather than on filenames:
every composer-band state BOTH trees hold is byte-identical across this window,
twelve frames each, base-to-`44cb3af3c` AND this branch to `44cb3af3c` —
`chat-message-input/{idle,awaiting-answer,awaiting-reply,stop-control-while-streaming,stop-control-without-capability,credential-armed}`.
The instrument is calibrated in the same run by the pair that DID move: the renamed
`stop-slot-reserved` -> `stop-slot-settled` sets differ in all twelve frames. And
the mention stories render an idle composer with no session status and no alert, so
the two changed paths — the store-refusal alert, and the Stop slot's grace window —
are on no frame of this set's render path. No frame was re-taken for this fold.

**The tenth fold (`main` at `09acb156a`) moved this band again, and this time it
moved the file the band is written in.** `main` moved 30 commits and 75 files under
this branch (the 0.26.10 release window, #322's release-attach recovery, #323's
composer story ids, #312's phantom compose rows, and #308's composer focus and
refusal flow), 19 of them under `src/` and 15 under `scripts/`, and
**`message-input.tsx` and `chat-page.tsx` are among them** — and
`message-input.tsx` is where this layer lives. The case is made on the source this
time rather than on a frame comparison, and the reason is that the change is
narrower than the ninth fold's: #308 changes exactly one painted thing in this
band, the textarea's ink while it REFUSES input, where the `disabled:` pair it used
to fire on becomes a `read-only:` pair with `disabled:` kept BESIDE it (both
stepping to `text-ink-disabled`, so the refusal still paints the same ink), and
**every story in this set renders `isLoading={false}` with no `currentJobId` and no
`unavailable`**, so `isInputDisabled` is false on all 24 of them and no frame here
is a picture of a refused composer. The window's other composer change is a
`pointerdown` suppression on the Send, attach and dictation controls and on the
suggestion chips, which keeps the caret on a press and is not a painted state. The
mention layer's own rendering did not move at all: `at-picker.tsx`,
`at-mention-overlay.tsx`, `at-token.ts`, `at-contract.ts`, `at-rank.ts`,
`use-at-resolution.ts` and `composer-tip.tsx` are byte-identical to this branch's
after the fold. **No frame was re-taken for this fold**, and the head above reads
in the spelling the fold gave it.

**The eleventh fold (`main` at `33373f748`) landed minutes after the tenth, and it
does not touch this band either.** `main` moved 8 commits and 77 files under this
branch (the change-scope CI classifier and its `ci-scope.test.mjs`, #318's
update-check fix, and their stories and evidence), 6 under `src/` and 6 under
`scripts/`, and none of them renders here: the `src/` half is the preload surface,
the update-notification component, the app-updates section and its stories, the
dev-driver and the update service. The window's 56 new frames are main's own
`settings-app-updates-section` set. `message-input.tsx`'s blob is `4af66278` on
BOTH heads — `09acb156a` and `33373f748` — so the fold before this one's resolution
of the textarea's aria fold is untouched rather than re-made, and the mention
layer's own files are byte-identical again. **No frame was re-taken for this
fold.**

**The twelfth fold (`main` at `3a5b66c54`) is the third in the same session, and it
does not touch this band either.** `main` moved 15 commits and 38 files under this
branch (the canonical transcript's momentum paging, `scroll-paging.ts` and
`use-scroll-paging.ts`, its scroll-paging evidence set and the rigs that drive it),
2 under `src/` and the rest evidence and scripts. `message-input.tsx`'s blob is
`4af66278` on all three heads now — `09acb156a`, `33373f748` and `3a5b66c54` — so
the aria fold's resolution is untouched for a second fold running. **No frame was
re-taken for this fold**, and the window is the one case where the counts below do
NOT move: its 24 new frames all land inside the already-declared
`transcript-scroll-paging` set, which main re-captured in the same window, and a
declared set's frames are out of the swept count by construction.

The counts in the manifest next to this file are the merged tree's own (`frames`
6,009 outside the 77 declared sets, `surfaces` 638), re-derived by the same walker
`check-evidence.mjs` uses.

**What moved in this pass, measured.** 170 of the 288 frames differ from the
reviewed set, and the three groups below are exhaustive of them. The first is the
states a round-2 finding named (`chip-needs-approval`, `mentions-at-the-edges`,
`harness-cannot-expand`, `no-rows-enter`) — together with `wrapped-mention`, whose
12 frames carry U13's footer copy and belong in this group rather than beside it:
`Esc closes` becomes `Nothing to insert · Esc closes` across 2,970 pixels above
4/255, 702 of them above 20/255, every one of those inside rows 316..328 — the
picker's footer line, left of the field's own text — with a maximum channel delta
of 159 and nothing above 20/255 anywhere else in the frame. This sentence used to
leave that state out and to call the groups "three ... and no others", which the
pixels falsify (design round 3, D10). The second group is the picker states (the
fixture gained the long name Q-5's own assertion needs, so every count and footer
in those frames moved with it). The third is the ambient tip row's rotating entry,
and it is the only group bounded by pixel count — `before-no-mentions`,
`mention-at-rest`, `atomic-delete`, `scrolled-draft` and `small-view-mention`
differ by 180-2,639 pixels, at most 36 of 1,203,360 each, all inside the tip band
below the composer.

**Provenance, stated because it is not a full sweep.** `frames` is re-derived from
the tree the way `check-evidence.mjs` derives it — every `.webp` under
`docs/evidence` outside a declared supplementary set — so the number is the sweep
count with this set's 288 added, and `surfaces` is the capturer's own story list
count. Both are written by the rig, and the commit that carries these frames is the
one `srcTree`/`scriptsTree` name: re-deriving them while the change is still in the
working tree is how a set comes to describe a tree it does not sit on, which is
what review round 1's M3 found here — this README described a head and a count that
the manifest next to it did not have. The same paragraph now names the head the
frames were taken at, and the numbers above are the rig's, not a paraphrase.

## What the fixtures stand in for

**The IPC boundary, and only that.** `probe-files` and `list-directory` are
answered from a named tree in the story module (`TREE` and `FILES`). Every
keystroke, every measure and every paint after that boundary is the shipped code.

| fact | what the frame can therefore claim | what it cannot |
| --- | --- | --- |
| a listing's entries | what the picker does with a listing — ranking, the drill, the parent column, the budget | that a particular directory contains those entries |
| a probe's answer | the rule `chip <=> the token resolves`, the two fills, the outside-workspace state | that `stat` agrees, or that the containment test is right (that is `scripts/directory-listing.test.mjs`, against real symlinks) |
| the connected harness's **capabilities** | that the composer's `@` affordance is offered exactly when the shipped `desktopFeatureEnabled` says the harness expands a mention — `harness-cannot-expand` is the state every release carries today — and that the withheld state says WHY in one sentence (UX round 2, U12), which the frame carries | how the capability fetch itself behaves against a live backend (that is main's `/v1/capabilities` path, already exercised by every other gated surface) |

The live half of both is `scripts/renderer-driver.mjs --scene mentions`, written
in this branch and **not run when this set was committed**: the composer only
exists on a pane with a live backend, and on a backend-less run the chat route
paints its offline card with no `textarea[aria-label="Message"]` at all (measured
— that run is what the scene's own refusal message records). It needs
`--backend` / `--backend-records` per `docs/agent-driver.md`, which is the QA
pass's job, not this set's.

**And it now states its two preconditions instead of failing at the first one**
(UX round 2, U14b). It used to throw its "this scene needs a live backend"
refusal while the app was in fact attached to one: `/chat` mounts no composer
without a session or a staged draft, so the scene now presses the app's own ⌘N
chord (the gesture `sceneNewChat` drives) and reaches the field, and it then reads
`/v1/capabilities` and refuses with the rig named in full unless the backend
advertises `features.references` — which no released harness does, so the live half
of this set needs a loopback proxy that injects that one field in front of a live
daemon this run owns (the shape QA round 2 ran). Its notice assertion was also
still checking the pre-remediation copy (`No files match "zzzz".` against a notice
that now names its scope); that is fixed with it.

## The surfaces

| directory | state | viewport |
| --- | --- | --- |
| `before-no-mentions` | the same sentence with the file named as **prose** — what `origin/main` paints. The before half of the pair. | 1380x872 |
| `mention-at-rest` | one chip mid-sentence | 1380x872 |
| `mentions-at-the-edges` | a mention opening the draft and one closing it | 1380x872 |
| `adjacent-mentions` | two mentions on one line | 1380x872 |
| `quoted-mention` | the quoted form `@"my file.txt"`: one fill over a name with a space | 1380x872 |
| `unresolved-stays-prose` | `@src/ap.py` (one character from a real file) beside a resolved one | 1380x872 |
| `chip-needs-approval` | a path outside the workspace beside one inside it | 1380x872 |
| `caret-inside-token` | the caret inside a mention: the list opens on the token | 1380x872 |
| `wrapped-mention` | a token that wraps at a 420px column: two fills, one line gap | 1380x872 |
| `picker-open` | a bare `@`: the working directory, ranked | 1380x768 |
| `picker-drilled` | `@src/`: the drill, with the parent column | 1380x768 |
| `picker-descend` | `@src/com`: a matched directory's children, one level | 1380x768 |
| `picker-no-match` | nothing matches: the notice row, the list still open | 1380x768 |
| `picker-empty-folder` | an empty directory | 1380x768 |
| `picker-unreadable` | a directory that cannot be read | 1380x768 |
| `picker-many-rows` | eleven entries: the budget at 7 rows, and the footer's count saying so | 1380x768 |
| `budget-800x600` | the same story at the design's narrow case: 4 rows | 800x600 |
| `ceiling-1380x872` | the same story at the band's own window: the 8-row ceiling | 1380x872 |
| `floor-768x520` | the same story at the clamp's own window: the 3-row floor binds | 768x520 |
| `harness-cannot-expand` | a harness that advertises no `references`: no list, no chip, one sentence saying why, the path plain | 1380x872 |
| `small-view-mention` | the small view, a 520px column: the fill reaches the field's 6px inset edge | 1380x872 |
| `scrolled-draft` | a draft past `max-h-28`: the fills travel with the field's own scroll | 1380x872 |
| `atomic-delete` | one Backspace at a chip's edge, with real arrow keys onto it | 1380x872 |
| `no-rows-enter` | Enter over a list with no rows: nothing is sent, the list stands | 1380x768 |

## Geometry, read back off the rendered story

Measured against the same stories at the same viewports (the reads behind every
number below; the frames are the picture of them):

| quantity | measured | design's prediction |
| --- | --- | --- |
| composer box, ≥550px column | **900 x 112.0** (`top` 376.44) | 111.7px |
| field inside it | 866 x 34 | — |
| chip fill height | **17.69** | 17.7 |
| chip fill overhang, both sides | **6.00 / 6.00** | 6 each side |
| fill's left/right against its glyph run | **0.00 / 0.00** drift | within 1px |
| first chip at the draft's start | fill left **259.0**, glyphs 265.0 — inside the field's own inset (field left 257) | never reaches the box's padding |
| two adjacent chips | fills **259.0..346.86** and **347.86..449.20**: **3.80px** of clear ground (the whole space advance). Read off the pixels at `localOperatorLight`: the seam is **4 ground-coloured pixels** wide (`345..348`), against **1** (`347`) in the frame this replaces — the 1.00px gap was one antialiased column, which is why it read as a merge | ≈16.5px of clear ground |
| a wrapped token | two fills, fill 1 bottom **381.47**, fill 2 top **385.47**: **4.00px** between the lines | 4px |
| picker shell, 8 rows | **342.78** | 340.8 |
| picker region, 8 / 7 / 4 / 3 rows | **284 / 248.5 / 142 / 106.5** = `budget x 35.5`, the row height the browser lays out | 288 at its ceiling |
| picker gap to the box | **4.00** (`mb-1`) | 4px |
| picker shell, no matches | **90.28** (header + one 36px notice row + footer) | 36px region |
| box top across every picker state | **324.44** at 1380x768, **376.44** at 1380x872 — identical open, filtered, drilled, no-match, empty, unreadable | unchanged |

### The design's four predictions

1. **The fills sit on their glyphs — CONFIRMED.** Every fill's edges are on its
   token's run with **0.00px** of drift against a 6.00px overhang, at the 900px
   measure and at a 372px column. The mirror and the field are styled by one
   exported class string (`composerTextBox`), which is what the check is for.
2. **A wrapped token paints two fills with a 4px gap — CONFIRMED**, and this is
   the one the design called most likely to be wrong: fill 1 spans
   `549.67..838.91` (glyphs `555.67..832.91`) and fill 2 `523.00..593.25`
   (glyphs `529.00..587.25`), with 4.00px of clear line between them. A fill
   measured as the line box (21.7px) instead of the glyph box would have merged
   them; the height came back 17.69.
3. **The band is unchanged with the list open — CONFIRMED, and it is a
   structural fact rather than a number.** The band's rect is identical in every
   state at a given viewport (`top` 34.39, `bottom` the viewport's), and the
   composer box's top is identical across the four picker states. The picker is
   `absolute` and `bottom-full` from the box, so it is out of flow by
   construction; what the frames add is that nothing else in the band moved.
4. **At a short window the picker is not sliced — CONFIRMED.** At 800x600 the
   shell's top edge is at **19.91** (inside the column) and the region shows
   **4 rows (142px)** where the same story at 1380x872 shows **8 (284px)**: the
   budget falls, and the shell is never pushed off the bottom. **And the cap lands
   on a row boundary, which is now asserted rather than argued** (QA round 1,
   Q-1): the story's own play reads the region's inline cap, the row height the
   browser laid out and the visible box off the DOM at every viewport this story is
   captured at, and the capturer stops the sweep if the cap or the visible box is
   not a whole number of rows. The `36` this geometry used to state was a belief
   about the `text-body-sm` line box — 0.8125rem x 1.5 is 19.5px, so a row is
   **35.5** — and it capped the region 4.0px into a ninth row at the ceiling
   (2.5px at 800x600): `budget x 0.5px`, exactly the "a cap cannot be aligned to a
   row by construction" defect the measured budget exists to prevent. The last
   frame below the ceiling is now a whole row.

   **And the region must not spend that cap on a horizontal bar** (QA round 2,
   Q-5). The same check asserts `region.scrollWidth <= region.clientWidth` at every
   viewport, because an `overflow-x` bar takes **8px** off the region's CLIENT box:
   measured at 800x600, the cap was right to the half pixel and the painted region
   was still four rows plus 28px of a fifth while the footer counted five. The
   fixture's own 58-character name is what makes that measurable in a frame rather
   than in an argument, and the row's name is the column that yields — it is the
   thing being scanned, so it keeps every pixel until the row cannot fit at all and
   only then ellipsises.

### One prediction the frames falsify, and the fix that came out of it

The design's prediction 10 is that two adjacent mentions leave **≈16.5px** of
clear ground between their fills: "the space's own advance — about 4.5px at 14px
— plus 12px of overhang". The arithmetic is inverted: the overhangs are taken
OUT of the ground, not added to it, so 12px of overhang over a 3.8px space is
**8.2px of overlap**, and the two same-coloured fills merge into one rectangle
covering both tokens and the separator — the one thing the same paragraph's rule
forbids ("the fill covers the token and never the separator").

Measured on this field, the space's advance is **3.8px**, not 4.5px. The first
correction clamped an overhang to half the clear ground on that side, which left
**1.00px** of separator — a value that exists in the DOM and not in the pixels:
read off the frames this set shipped then, no pixel in that seam came within 4/255
of the ground in `localOperatorLight`, and the dark themes never approached it at
all. A one-pixel gap is not a separator, and the merge it hid was making a claim
rather than merely reading quiet: the quoted form `@"my file.txt"` paints ONE fill
over a space, so two merged chips were indistinguishable from a single token
(design round 1, D2).

A side that **faces another mention keeps a full space's advance of ground
unpainted and splits whatever is left of the ground with the chip it faces**, so at
one space apart the whole 3.8px space is unpainted ground between two fills and the
outer 6px stands on both chips, which is where the container reading lives.
`adjacent-mentions` is the
frame of the result. **The rule has a DISTANCE term, and dropping it was itself a
defect (design round 2, D9):** a facing side now keeps the ground it can see and
splits the rest with the chip it faces, so the overhang ramps from 0 at one space
to the full 6px at 15.8px of ground and stays there. The first correction returned
0 at 3.8px and at 150px alike, which took 5-6px off `mentions-at-the-edges` across
149px of prose and put `chip-needs-approval`'s new 1px edge rule through the first
ink column of its own `@`. Both of those frames are re-captured here, and the
trade the rule cannot fix is recorded in the design record rather than left to be
inferred: three mentions on one line at one space each leave the middle chip flush
at both ends, because the only alternative is painting the space.
The rule and its numbers are asserted in
`scripts/at-mentions.test.mjs` only as far as they are pure (the
reference/directory/space rules); the geometry itself is measured here, and § 5
state 10 of the design record carries the correction rather than the prediction.

## What this set does not cover

- **The harness's own expansion.** Nothing here sends a message: the feature's
  contract with the backend is the *text* it writes, and the harness half is
  `damianvtran/local-operator#1220`. A frame is evidence about the composer.
- **A mid-turn steer's own frame.** The composer now WITHHOLDS the whole
  affordance while the send this draft would make is a steer (no list, no chip, no
  `@` tip AND no sentence, because the backend is not the reason), because the
  harness's steer path bypasses `Session.prompt` and leaves
  an `@path` as inert prose. That decision is exercised by the same gate
  `harness-cannot-expand` photographs — a fixture capability answer — and not by a
  frame of a live mid-turn composer: a story cannot put the app in a live turn, and
  the steer state has no other visual consequence to photograph, since a withheld
  affordance looks exactly like a harness that cannot expand one.
- **The capability fetch against a live backend.** `harness-cannot-expand` proves
  the DECISION (the shipped gate, fed a fixture answer); that main's
  `/v1/capabilities` path delivers the real answer is exercised by every other
  gated surface in the app, and by `pnpm test:desktop`'s transport contract.
- **The outside-workspace fact's real source.** The frames show the fill; the
  containment judgement itself is the main process's and is exercised by
  `scripts/directory-listing.test.mjs` against a real symlinked tree. What the
  fill does NOT cover is the harness's deny list — a `.env` inside the workspace
  chips plainly and still raises a card at submit — and that gap is stated in the
  PR body rather than left to be inferred from a frame (review round 1's N1).
- **The driver scene.** Written in this branch, refused without a backend, and
  named above with the flags a QA pass needs to run it.
