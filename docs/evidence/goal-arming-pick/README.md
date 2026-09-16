# Goal arming — the pick, the two gestures, and the copy that names them

PR #209 turns the `/goal` arming from something a **word in a draft** did into
something the user **chooses** in the slash popup. Round 1 of review found
defects in that change (reviewer F1-F7, UX U1-U6, design D1-D5, QA Q1-Q6). Round
2 found that two of the fixes could only be reached in the harness (UX U1: the
note's honest sentence needed a pane state the page does not produce; UX U2: the
`/loop` row's click line promised a run its click does not perform), plus four
minors. **Round 3 found that one of round 2's two fixes was not in the product
at all**: the free-text row's Enter line was bound to a value the popup cannot
produce in that phase, so the app kept printing `Enter completes the command.`
while this file, the copy table and round 2's UX remediation comment all said the
new sentence had shipped — and this set's own frame was the evidence cited for
that claim. Three frames are re-taken for it: `popup-loop` (the sentence now
renders) and `plain-enter-prose` with its light twin (whose `box` witness row was
read before the send cleared the composer, so it recorded a draft the frame
painted as gone). The frames in `*/<theme>.webp` are what the surfaces render
after those remediations, and `round1/` keeps the frames the four rounds produced
so a reader can see the defect rather than take this file's word for it.

**Round 4 is the convergence with `main`'s #221** (`feat/panels-cache-picker-hover`,
merge `4d2b3f0a6`), which landed its own command-row Enter contract while this PR
was in review — an unambiguous Enter applies AND acts, an ambiguous one grows the
word to the shared prefix — with a footer table pinned by its own tests. The two
contracts compose rather than replace each other, and the composition is what
these frames now show: #221's rule decides the KEY, the pick (`handleSlashPick`)
decides what that apply DOES, and the two frozen sentences this PR owns — the
ARMED row and the free-text row — both read `Enter stages /X; the next Enter runs
it.`, because both end with a line staged rather than run (the arm hoists and
stages; the planned reassembly hoists and stages). Seven frames are re-taken for
it — `popup-goal`, `popup-goal-by-hand`, `popup-loop`, `popup-goal-nosession`,
`plain-enter-prose`, its light twin and `tab-no-arm` — and one is added,
`enter-loop-staged`: the Enter half of the pair `pick-loop-click-staged` already
carries for the pointer, because the sentence above a row is only as good as the
state the key lands in.

## `*/<theme>.webp` — the fixed surfaces, at the remediation head

Every frame is the real `MessageInput`, its real slash popup, the real planner
(`planSlashSubmission` / `planSlashArming`), the real keyboard contract
(`slashKeyIntent`) and the real dispatch contract, rendered in the repository's
own Storybook preview with exactly one stand-in: `window.api.desktop`, mocked
with the REAL command catalogue dumped from the core runtime's
`command_catalogue()` (38 rows; `/goal` = `session.goal`), because a Storybook
page has no backend. `window.electron` and `window.api.backend` are stubbed for
the same reason (see the harness), so a frame is a function of this tree rather
than of whichever backend happens to be listening on the machine. Drafts are
written and keys dispatched as real DOM events on the real textarea; the goal row
is clicked as a real pointer click. The witness rows above the composer (`box`,
`note`, `sent`, `dispatched`, `rect`) are the harness's own reading of the state
that produced the frame, **read after the gesture settles** (two agreeing reads,
bounded at 2 s): a send clears the composer when `onSendMessage` resolves, so a
read taken on the next macrotask records the draft the frame paints as gone (QA
round 3, Q3-2 — before that fix, the two `plain-enter-prose` frames did exactly
that).

`popup-loop`, `plain-enter-prose` and `plain-enter-prose-light` were re-taken in
round 3; round 4 re-took those three plus `popup-goal`, `popup-goal-by-hand`,
`popup-goal-nosession` and `tab-no-arm`, and added `enter-loop-staged`. The
composer pair is unchanged: it is a crop of two frames whose pixels this round
did not move, and the entry in
`docs/evidence/manifest.json` states, string by string, why nothing they render
moved.

| frame | state | what it settles |
| --- | --- | --- |
| `popup-goal/localOperatorDark.webp` (re-taken, round 4) | popup open on the `/goal` row over `I approve spend /goal`, no arrow pressed | review F2 / QA Q5 / UX U2 / design D1-D2, in the composed contract: the row's two lines read `Enter stages /goal; the next Enter runs it.` / `Click stages /goal.` — Enter's line is what the key does on the row the popup is showing, and the line below it names the pointer's own path. Round 3's `Enter sends this draft as prose.` described a rule #221 replaced: an unambiguous Enter ACTS on the row, and on this row the act is the arm |
| `popup-goal-by-hand/localOperatorDark.webp` (re-taken, round 4) | the same intent after a bare `/` and arrows onto the `/goal` row | the hand-made state reads the SAME sentence as the typed one — `Enter stages /goal; the next Enter runs it.` — because the round-4 composition dropped the gate that made the two states differ: the popup's own visible line names the effect now, so a choice by hand and a typed word both arm. What the frame still pins is that this state is REACHED the way the app offers it: a bare `/` lists the whole catalogue and arrowing to `/goal` is a move, while a query of `/goal` matches a single row and a clamped arrow is not a choice (review F2) |
| `popup-loop/localOperatorDark.webp` (re-taken, round 4) | the popup on the `/loop` row (control, caret on the word), draft `please run /loop` | UX U2/U3, in the composed contract: the free-text row says `Enter stages /loop; the next Enter runs it.` and `Click stages /loop.` — the same two sentences the armed row gets, because the pick does the same thing to a draft that survives (hoist it, stage it, run nothing). Round 3's `Enter completes /loop; the next Enter stages this draft behind it.` was true of the keyboard rule it was written under; #221's rule makes the FIRST Enter the staging one, and `enter-loop-staged` is the frame that shows it |
| `enter-loop-staged/localOperatorDark.webp` (new, round 4) | `please run /loop`, then Enter on the `/loop` row | the sentence above that row, measured: the box becomes `/loop please run`, the note reads `Staged /loop please run. Enter again runs it.`, and `sent` and `dispatched` are both EMPTY. The Enter half of the pair `pick-loop-click-staged` carries for the pointer — a row whose line claims a staging owes the reader the state it lands in, which is the gap QA round 3 filed against the other half |
| `plain-enter-prose/localOperatorDark.webp` (re-taken, round 4) | `I approve spend /goal`, then Escape (the list closed), then Enter | UX U1 / design D2, the half of the operator's report that survives the round-4 composition: with no row to act on, `sent` is the draft, verbatim and in its own order, no note, nothing staged — nothing arms from a draft ALONE. Round 4 moved the recipe by one key rather than rewording the claim: with the popup OPEN the composed rule arms this draft deliberately (that is the operator's own gesture, and `popup-goal` is the frame for it), so the frame carrying the no-inference half has the list closed. Its `box` row reads `""` beside the empty box the frame paints, which is the same state read after the send settled (QA round 3, Q3-2) |
| `plain-enter-prose-light/localOperatorLight.webp` (re-taken, round 4) | the same state, light theme | the same claim on the second palette |
| `tab-no-arm/localOperatorDark.webp` (re-taken, round 4) | the same draft, Tab with the popup open | UX U3 with #221's own Tab rule: Tab COMPLETES the word and closes the list — its `box` row reads `I approve spend /goal ` with the completion's own trailing space, which the pixels cannot show — and it does not arm: `note`, `sent` and `dispatched` are all empty. The arm rides the ACTING key (`disposition.run`, which Tab never carries), so the accept-and-keep-typing key cannot turn a sentence into a staged line |
| `pick-arms-click/localOperatorDark.webp` | the goal row CLICKED | the pointer gesture: the line is hoisted to the front, staged, and the note says what the next Enter will do |
| `pick-arms-hand/localOperatorDark.webp` | the by-hand state above, then Enter | the keyboard gesture, unchanged by the round-4 composition: the same staged line, reached by ENTER on the row the arrows chose. The gate this row used to be described by is gone — the arm rides the acting key now — and Tab in the same state completes the word and stages nothing, which is what `tab-no-arm` photographs |
| `pick-arms-multiline/localOperatorDark.webp` | review F1 / QA Q4's draft (`Please fix the flaky test and` / `then run the release.` / `/goal`) clicked | the staged line is ONE line, so the next Enter is the whole-draft form that runs: the goal is set and the text sent, rather than the literal `/goal …` reaching the model |
| `pick-arms-nosession/localOperatorDark.webp` | the same pick on a pane whose props are a real New chat pane (`sessionStatus` from the preview with `draft: true`, `conversationId` the pane's identity, `paneHasSession=false`) | UX U1: the note says what the pane can do (`Needs an open conversation; start one first.`) instead of promising a goal it will refuse one keystroke later — in a state the SHIPPING page produces, which is the half round 1 could only reach by forcing `sessionStatus={undefined}` |
| `popup-goal-nosession/localOperatorDark.webp` (re-taken, round 4) | the by-hand state on that same draft pane | design D3 / UX U1, in the composed sentence: `Enter stages /goal; this pane needs an open conversation to run it.` The staging is real on this pane — it is local — and the RUN the next Enter would take is what the dispatcher refuses, so the clause that says so replaces the promise rather than sitting beside it |
| `pick-loop-click-staged/localOperatorDark.webp` | the `/loop` row CLICKED, draft `please run /loop` | UX U2, measured off the pick: the box becomes `/loop please run`, the note says it staged, and `sent` and `dispatched` are both EMPTY — the wire call the old `Click runs /loop.` promised does not happen |
| `composer-armed/localOperatorDark.webp` | the composer box after a pick | design N1: compared against… |
| `composer-hand-typed/localOperatorDark.webp` | the composer box holding `/goal I approve spend` typed by hand | …this one: `magick compare -metric AE` over the box's own rect reports **0 of 530,944 pixels** different (1952x272 at `24,346,976,136@2`), so the armed state stays indistinguishable from the whole-draft form it lands the user in — no badge, no restyle |

`composer-armed` and `composer-hand-typed` are crops of two full frames at the
rect the harness reports for the composer box (`rect` above, `24,346,976,136@2`),
so the pair compares the box alone: the note row beneath it belongs to the arming
and would otherwise be the only difference. Round 2's design nit (D5) was that
the two committed files were the same file, which makes the comparison
self-referential; these are two captures, and the identity above is measured from
them.

What the committed files can and cannot show, stated because round 3 measured it
(QA Q3-2): the two crop files are **byte-identical** (sha256 `cef7db54…` for
both, 1952x272 = 530,944 pixels each) — a lossless encoding of identical pixels
is identical bytes — so the "two captures" provenance above is how the crops
were MADE and not something a reader can re-derive from the artefacts. What a
reader can check is the one thing the pair exists for, and the two files carry
it directly: `magick compare -metric AE composer-armed/localOperatorDark.webp
composer-hand-typed/localOperatorDark.webp null:` reports `0 (0)` over those
530,944 pixels, which is the number in the row above. The source shas an earlier
version of this file quoted for the pair (`59a1f965e0…` / `f58889f389…`) were
not the bytes shipped and are gone with it, as is the claim that the two files
"differ in container bytes".

## `round1/*.png` — the reviewed head, kept as the "before"

The frames the four review rounds produced in their own scratch rigs at the head
they reviewed. They are PNGs of two different rigs (design's CDP rig, QA's
Storybook harness) at the reviewed head `055772394`, which this branch's rebase
rewrote, so they carry no `capturedAtHead` citation — the head is named here
instead, and in the PR's round-1 comments. PNGs are not `.webp`, so they enter
neither the sweep's arithmetic nor the theme-ground predicate; they are declared
as `pngArtifacts` on the manifest entry.

| frame | round | what it shows |
| --- | --- | --- |
| `round1/design-popup-goal.png` | design D1 | the falsified footer — `Enter completes the command.` / `Click runs /goal.` — on the row whose Enter hoists and stages |
| `round1/design-popup-loop.png` | design D1 | the control row, where that same sentence is honest |
| `round1/design-pick-arms.png` | design D2 (and UX U1) | the pick's receipt as it read before remediation: `Armed /goal I approve spend. …` |
| `round1/design-pick-arms-composer.png` | design N1 | the composer box after a pick, before remediation |
| `round1/design-hand-typed-composer.png` | design N1 | the same box typed by hand — the 0-of-94,528-pixel pair the design round measured |
| `round1/qa-popup-goal-row.png` | QA Q5 | the live popup's two lines, from QA's Storybook harness |
| `round1/qa-armed.png` | QA D2 | the armed state reached by Enter (before the gate) |
| `round1/qa-click-armed.png` | QA D4 | the armed state reached by a click |
| `round1/qa-base-staged.png` | QA D6 | the BASE behaviour (`64c3283cb`): the operator's gesture moved his sentence and sent nothing |
| `round1/qa-head-prose-sent.png` | QA D7 | the head behaviour this PR exists for: the same draft sent as prose |

## How to regenerate the `*/<theme>.webp` frames

In a scratch worktree of this branch (`git worktree add --detach /tmp/ev209 HEAD`,
with `node_modules` from a checkout of the same tree):

1. copy `harness/ev209-goal-arming.stories.tsx` into
   `src/renderer/src/features/chat/components/` (untracked: the repository's own
   `.storybook` config picks it up) and replace the `COMMANDS` placeholder with
   the catalogue the desktop app receives — a `commands.list` dump, e.g. from a
   core checkout's
   `local_operator.server.utils.desktop_commands.command_catalogue()`;
2. `pnpm exec storybook dev -p 6021 --no-open`, then open
   `http://localhost:6021/iframe.html?id=ev209-goal-arming--composer&viewMode=story`
   (append `&args=theme:localOperatorLight` for the light frame) in the harness
   browser tool and let the story settle — the first load compiles it;
3. drive the labelled controls (`data-ev-action`) and screenshot after each, **after
   the witness rows have stopped changing** — the harness writes them when the
   gesture settles, and a screenshot taken first shows a frame whose own `box`
   row describes another state (QA round 3, Q3-2; a settle is ~200 ms). The last
   two controls before the screenshot are always `scroll to the top` and `read`:
   `rect` is a READING of where the composer sits, the preview's own scroll can
   drift between the gesture and the capture, and a reading taken at one scroll
   beside pixels at another is a row that disagrees with its frame (round 4 found
   it: the reading said `-23,202` while the box's pixels sat at `24,346`). Then:
   `type-sentence` → `popup-goal`; `choose-goal-by-hand` (a bare `/` lists the
   whole catalogue and the arrows walk the marker onto `/goal`, which is what
   makes it a choice — a query of `/goal` matches one row, and one press per
   timer tick, never per rAF: this runs in a background tab, where frames are
   paused) → `popup-goal-by-hand`; `enter` → `pick-arms-hand`; `escape`,
   `type-sentence`, `click-goal` → `pick-arms-click`; `escape`, `type-multiline`,
   `click-goal` → `pick-arms-multiline`; `escape`, `type-loop-token` →
   `popup-loop`; `escape`, `type-loop-token`, `enter` → `enter-loop-staged`;
   `click-loop` → `pick-loop-click-staged`; `escape`, `type-sentence`, `escape`,
   `enter` → `plain-enter-prose` (the SECOND `escape` is round 4's: with the list
   open, the composed rule arms this draft deliberately); `escape`,
   `type-sentence`, `tab` → `tab-no-arm`; `escape`, `type-whole` →
   `composer-hand-typed`; `escape`, `type-sentence`, `click-goal` →
   `composer-armed`; `toggle-session`, `escape`, `type-sentence`, `click-goal` →
   `pick-arms-nosession`; `toggle-session`, `choose-goal-by-hand` →
   `popup-goal-nosession`; `&args=theme:localOperatorLight`, `type-sentence`,
   `escape`, `enter` → `plain-enter-prose-light`;
4. crop the two composer frames to the `rect` the page reports times
   `window.devicePixelRatio` (the harness viewport is 1280x720 at DPR 2, so the
   frames are 2560x1440 and the crop is `rect × 2` — `+48+692`), and write every
   frame out as **lossless** WebP in a directory named for the state, with the
   file named for the theme — `check-evidence.mjs` reads the theme off the file
   name and checks the frame's dominant colour against that theme's ground.

Round 3 re-took three of the frames — `popup-loop`, `plain-enter-prose` and
`plain-enter-prose-light` — because the code that renders them changed; it did
**not** re-take the composer pair, whose claims were corrected instead (see
above). Round 4 re-took those three plus four more (`popup-goal`,
`popup-goal-by-hand`, `popup-goal-nosession`, `tab-no-arm`) and added
`enter-loop-staged`, all because the composition with #221 changed what the keys
do and therefore what the copy may say; it too left the composer pair alone, and
their claims stand because their pixels did not move. A test that changes what a
frame shows owes that frame a re-take in the same commit; a claim that outlives
its bytes owes the reader the correction.

`round1/` is not regenerable: those rigs are scratch and the copy they render no
longer exists in the tree. The design round's own rig recipe is in its round-1
comment; the QA rig is in QA's.
