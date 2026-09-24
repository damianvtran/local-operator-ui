# `/model` — the desktop model picker, in every state its feedback can be in

The Storybook set for the picker: one directory per state, one `.webp` per
palette. `localOperatorDark` is the app's default and `localOperatorLight` is
where a contrast defect hides, which is why the documented minimum is both.

Everything here is a Storybook story driving the PRODUCTION `ModelPicker` with
the desktop transport stubbed (`window.api.desktop.request`), so the frames are
evidence about the renderer and not about the backend. The eleven states that
carry the earlier feedback findings — `populated`, `hovered`,
`keyboard-highlight`, `busy`, `result`, `persist-checked`, `refresh-pending`,
`loading`, `empty`, `partial-error`, `narrow`, plus the machine-default and
effort pairs — are described in
[`../model-picker-feedback/README.md`](../model-picker-feedback/README.md),
which is the directory that holds their in-app before/after pairs and the
measurements taken behind them.

## The opus frames: the cross-tree half in `../model-picker-live-listing-before/`, the rest here

Added by the change that made the picker list the providers **by itself**. The
operator's report: after signing in to Anthropic, a model their account's own
`/v1/models` answers with — `Opus 5.5`, where lop's shipped registry stops at
`claude-opus-5` — never appeared in the picker. It appeared only if the user
pressed `Refresh from providers` first, on the chance that it would help.

Every frame here is the SAME state of the dialog — open, `opus` typed, the
session on `anthropic/claude-opus-5` — and the set is a difference between two
LISTINGS rather than between two views:

| Frame | Tree | What it shows |
|---|---|---|
| `../model-picker-live-listing-before/registry-only-opus` | `origin/main` = `ffa54512e` | One row, `Claude Opus 5`, and the button reads `Refresh from providers`. This is the reported state: the registry's answer, and nothing has asked the providers. Shot from a detached worktree of the base commit and declared as a `supplementary` set, because a frame of ANOTHER tree cannot be re-captured by a sweep running over this one (review round 1, R1-3). |
| `after-registry-only-opus` | this change | The same one row, with the automatic provider listing OUT: the control reads `⟳ Checking…` and the rows stay painted. This is the half of stale-then-update that a still can carry — the registry paint is not replaced by a spinner while the live read runs. `Checking…` rather than `Refreshing…` is the automatic pass naming itself (design D2, UX U4): a control nobody pressed must not borrow the word the click produces. |
| `after-registry-only-opus-narrow` | this change | The same in-flight state at 560×820, where the toolbar has the least slack. It is the frame design round 1 asked for to measure the row's reflow at a narrow width (D1's open half). |
| `after-live-listing-failed` | this change | The automatic listing FAILING, which is the state review round 1 filed twice (code R1-1, UX U3): the failure is a note above rows that are still there, in the user's terms and naming what to do next, rather than a wall of transport copy where the list used to be. |
| `after-provider-listing-opus` | this change | Three rows: `Claude Opus 5`, `Claude Opus 5.5` and the aggregator route `anthropic/claude-opus-5.5`. **Nothing was clicked** — the control has settled back to `Refresh from providers`. |

The row delta is the whole of it: the two rows the provider lists and the
registry does not are the only difference between the fixtures the two frames
were shot against, so a frame showing three rows is evidence about the LISTING
rather than about a longer fixture.

### What produced these frames

`scripts/capture-evidence.mjs` against Storybook, the repository's own rig —
STORYBOOK rather than the built Electron app, because the subject is a query
that moved and a dialog that is a pure function of it: the two trees differ in
what the picker ASKS FOR, and the stub answers both, whereas the in-app rig
would need a real provider credential and a provider that had released a model
that morning. The two plays assert the states the frames claim (the before half
asserts the ABSENCE of the 5.5 row and the single registry row; the after half
waits for the row to ARRIVE with no click anywhere in the play), so a frame
cannot be taken from a state the story's own assertions rejected.

```sh
# This branch's half, from the worktree under test, against its own Storybook
# (`pnpm exec storybook dev -p 6017 --ci --quiet` — the rig drives a server, it
# does not start one).
node scripts/capture-evidence.mjs http://localhost:6017 --allow-backend \
  --dirs=after-registry-only-opus,after-registry-only-opus-narrow,\
after-provider-listing-opus,after-live-listing-failed,refresh-pending \
  --themes=localOperatorDark,localOperatorLight --theme-settle-ms=180000

# The cross-tree half, from a scratch worktree of the base commit carrying the
# same rig and the same story file:
#   git worktree add ../model-refresh-before-<id> ffa54512e
node scripts/capture-evidence.mjs http://localhost:6018 --allow-backend \
  --dirs=before-registry-only-opus \
  --themes=localOperatorDark,localOperatorLight --theme-settle-ms=180000
```

`--allow-backend` is not decoration and neither is the reason for it: the rig
refuses a partial run while a Local Operator backend answers on
`localhost:1111`, and one does on this machine. These stories stub the whole
desktop transport, so no frame reads it — the picker's rows, its auth state and
its button all come from the story's own bridge. `--theme-settle-ms=180000` is
the knob the rig documents for a boot on a loaded host; at the shipped 10 s
budget the second palette's navigation is not reliably finished, which is how
this pair's first capture died with `Unable to find role="option"`.

### The request counts these frames carry

The stub counts the catalogue reads it answers, split into `total` and `live`:

- **Before:** ONE read, `live: false`. The released picker asks for the
  registry and nothing else until the button is pressed.
- **After:** TWO reads with no click — `live: false` (the registry paint) then
  `live: true` (the provider listing). The `after-provider-listing-opus` play
  asserts exactly `{ total: 2, live: 1 }`, so the number is a claim the frame's
  own play fails on rather than a reading taken by hand; `refresh-pending`'s
  play asserts `live: 2` for the manual re-ask, which is the click re-listing on
  top of the automatic one.

  Those counts are the ones a listing that ANSWERS produces, which is the
  condition round 2's QA made explicit (Q2-2): a failing live read is asked
  twice — three reads in all, the registry paint, the live read and its one
  retry — because this query inherits the application's default policy
  (`retry: 1`, `src/renderer/src/shared/api/query-client.ts`) rather than
  overriding it. The retry is deliberate and stays: a provider blip is exactly
  what a background convenience read should survive, and a second policy for
  this one query would be a second thing to keep in step with the app's.

### What these frames do NOT prove

- **Nothing about a real provider.** No request left this machine; the rows are
  fixtures shaped like the operator's catalogue. What they show is that a model
  the provider lists and the registry does not is on screen with no click, which
  is the half the renderer owns.
- **Nothing about the backend's cadence.** The 15-minute re-ask is a
  `refetchInterval` on the live query and is asserted in
  `scripts/picker-feedback.test.mjs` as source, not photographed; a still cannot
  show an interval. The companion change that answers that read at the picker's
  TTL rather than from a document up to 24 hours old is a separate PR in
  `damianvtran/local-operator`.
- **The registry paint is asserted only from the in-flight frame.** The stub
  answers the live read immediately, so the in-between state lasts a microtask
  in `after-provider-listing-opus`; `after-registry-only-opus` is where it is
  held still, by withholding the live answer.

### Review round 1's remediation, and what it moved

Four findings were worked in this change's remediation commit, all of them
visible in the frames above:

- **R1-1 / U3 — a failed automatic listing kept nothing.** `keepPreviousData`
  carries the previous key's rows only while the new key is PENDING, so an
  errored live read arrived with `data: undefined` and the picker drew one line
  of error text where the registry paint had been. The picker now draws the
  registry document under the failure and the failure becomes a note above the
  rows (`after-live-listing-failed`), with the query's own sentence in the
  notice's tooltip.
- **U1 / U2 — the arriving rows moved the keyboard.** The highlight is held by
  the row's `value` rather than by its index, so a re-list moves the row and not
  the selection; a row that VANISHES under a highlight the user steered now
  names its replacement in the footer instead of silently re-pointing Enter at
  whatever took the slot.
- **D1 — the toolbar reflowed with no click behind it.** The refresh control's
  slot is width-reserved at 149px, the idle label's own box. Measured in the
  DOM, over the served stories, all three states now lay out identically
  (`Set current model as default` x 308 w 180, control x 496 w 149, in the
  settled, automatic-in-flight and user-clicked states); in the frames the link
  sits at **x 389-551 in flight and settled alike, in both palettes** — round 1
  measured 38px of movement here.
- **D2 / U4 — the automatic pass borrowed the manual trigger's voice.** The pass
  reads `Checking…` while the user's own click reads `Refreshing…`.

The two frames this moved besides the new ones are `after-registry-only-opus`
(its label and, before the 149px reserve, its geometry) and `refresh-pending`
(the user's own click now lands in the same reserved slot as the idle control).
`after-provider-listing-opus` and `after-live-listing-failed` came back
**byte-identical** when re-captured after the reserve went in, which is the
measurement behind the claim that every SETTLED frame of this surface — the
eleven earlier states included — is unchanged by this round.

### Review round 2's remediation, and what it moved

Round 2 worked two MAJORs (both about one contract: the row the user sees is the
row Enter acts on), three MINORs and two observations:

- **U2, second attempt — the sentence was computed and then erased.** The
  retarget rule was right and the effect around it was wrong: the placement
  re-runs when it writes `active`, that run finds the survivor in place, and a
  two-state `string | null` had it CLEAR the sentence it had just set. `retargeted`
  is tri-state now — a name sets it, `null` clears it (the user's own typing), and
  `undefined` means this pass has nothing to say. Proven in
  `scripts/picker-host-selection.test.mjs`, which drives the real `PickerHost`:
  the test fails on the two-state rule and passes on the tri-state one.
- **U5 — the mark, the footer, `aria-activedescendant`, the scroll target, the
  click path and `pick` were reading TWO index spaces.** The rows render GROUPED,
  so the rendered order is a permutation of the filtered list, and past the point
  where the orders diverge the marked row and the row Enter sent were different
  models. There is one space now (`ordered`, derived from the grouped list) that
  every index-bearing read uses. Same test file, same discipline: it fails when
  the two spaces are put back and passes with one.
- **R2-1 — the failure note claimed the wrong provenance.** On a same-key refetch
  failure react-query keeps `data`, so the failed cadence tick drew the previous
  PROVIDER listing under a sentence saying the rows were the shipped models. The
  note now follows the document it is drawn over (both sentences are pinned in
  `scripts/picker-feedback.test.mjs`).
- **D6 — the note wrapped the control's own label.** The quoted phrase is one
  unbreakable token now (`\u00a0`), so the note breaks before `Refresh` instead
  of between `from` and `providers`. The pair that shows it is attached to the
  PR: the BEFORE half is the committed frame at this branch's previous head, and
  the AFTER half is a browser capture of this story on this tree
  (`chat-model-picker--live-listing-failed`, dark), because the rig's shutter for
  that state cannot currently be relied on — see the note below.
- **The failed-listing frame here is the previous head's, and that is measured.**
  Re-capturing `after-live-listing-failed` at this head produced a picture of the
  automatic pass IN FLIGHT (`Checking…`, no note) rather than the settled failure
  the file is named for: four attempts, byte-identical each time. It is not this
  diff — the same capture from the ROUND-1 tree (`git checkout 9a87bc2a0^ -- src`)
  produces the same in-flight frame in the same Storybook instance, so the
  difference is the environment the rig runs in, not the code under it — and the
  story's own play does reach the settled state (asserted, and read from the DOM
  in a browser). Until that race is understood the frame stays as the previous
  head's bytes and its sentence is the PRE-FIX copy: the post-fix copy is the
  browser half on the PR. Recorded rather than quietly shipped, because a frame
  named for a state it does not show is the defect the rig's own play guard
  exists to prevent.
- **Q2-3 — the widened play guard is a test.** A story whose play throws is not
  evidence, and the guard that decides that is now an exported constant with the
  cases that widened it driven through it, including the `TypeError` that shipped
  a frame of a state the play never reached, and a source check that the sweep
  reads the constant rather than a copy.
- **D4 / U6 — the dialog's re-centring is NOT fixed here.** It moves 48px when the
  landing changes the row set (design's measurement; UX measured the search field
  49px under the caret, per open and per cadence tick). Both candidate repairs
  change the dialog for every state rather than this one — reserving the list's
  full 420px height leaves dead space in the eleven short states, and top-anchored
  growth moves a dialog that is deliberately centred. Deferred with the numbers
  rather than guessed at; what the user sees meanwhile is the dialog re-centring
  once per open, and once per tick only when the row count actually changes.

### Which of the earlier frames were re-taken, and which were not

A change that wires the query differently could repaint every state above it, so
the states whose SEQUENCES this change moves were re-captured in both palettes
and compared against the committed bytes:

- **Re-taken, and changed:** `after-live-listing-failed` — the note's copy
  (R2-1) and its line break (D6). The BEFORE half is the committed frame at this
  branch's previous head, still readable at
  `https://github.com/damianvtran/local-operator-ui/raw/ffccfe5ab/docs/evidence/chat-model-picker/after-live-listing-failed/localOperatorDark.webp`
  (and `...Light.webp` beside it); the AFTER half is the file here. Both are the
  same state — the picker open with `opus` typed, the live listing failed, ONE
  registry row drawn from the search `anthropic/claude-opus-5` (the play asserts
  exactly one `option` row and that it names Claude Opus 5), with the read counts
  of *The request counts these frames carry* above: the registry paint plus the
  live read, and the live read one is the one that failed — and the only
  difference in them is the sentence and where it breaks: before, `…the shipped models; Refresh from / providers tries
  again.` across two lines with the control's own label split between them;
  after, `…the shipped models; / Refresh from providers tries again.` with the
  phrase whole.
- **Re-taken, byte-identical:** `after-registry-only-opus`,
  `after-registry-only-opus-narrow`, `refresh-pending`, and
  `after-provider-listing-opus` **relative to the round-1 tree** — see the
  measurement below.
- **Not re-taken:** the earlier states, whose sequences this change does not
  reach — `populated`, `keyboard-highlight`, `busy`, `result`, `persist-checked`,
  `hovered`, `narrow`, `empty`, `loading`, and the set-default and effort
  states. Their frames are the committed bytes.

The measurement behind the middle line, because it is the kind of claim that
otherwise reads as a re-run rather than an A/B: `after-provider-listing-opus`
re-captured from THIS tree differs from the committed bytes by 1159 pixels
(`magick compare -metric AE`) — a 1px text-rasterization shift across the
toolbar row, with no geometry change (the dialog's band measures rows 92..527 in
both) and no copy change. Captured again from the same tree, it is byte-stable,
so it is not run noise; captured from the **round-1 tree at `HEAD`** — the
pre-round-2 files, served by the same Storybook, same rig, same command — it is
byte-identical to this round's frame. So the shift is not this change's: the
committed bytes were shot before the two folds this lane took, and the frames
have not reproduced at this base since. Recorded rather than quietly re-taken,
because "the other frames are untouched" is a claim a later reader will want to
be able to check, and at this base the honest form of it is the A/B above rather
than byte-equality with a stale commit.
