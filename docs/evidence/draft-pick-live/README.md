# Historical draft-pane captures — partial evidence only

These three PNGs show a draft strip and an open model picker, not a successful
model/effort pick or first message. They predate the PR #154 recovery and have
not been recaptured. A live API response proves backend resolution; it does not
prove that a user can activate the picker or that the resulting state renders.

**The browser interaction and rendered states this file used to call a merge gate
exist, and are not in this directory.** QA round 3 drove the whole flow with the
harness browser tool on `localhost:5204` against a real isolated backend and
recorded a passing cell for every state this set lacks — effort-first pick, model
pick, picked pair before send, send, first turn, sibling draft, and the
capability-off negative control on a genuine pre-`draft_selection` backend — with
frames kept outside the repository at `/tmp/qa-ui154-r3/evidence/20`-`41`. Design
round 3 signed those states off on the same head, and its disposition table marks
this set's D5 as fixed in documentation. Nothing in this directory changed for
that: the pixels here stay historical, and the frames that carry the interaction
claim are the ones QA drove.

**That is no longer the whole record, and nothing here is blocked by tooling.**
An earlier revision of this file said the states this delta's own rounds changed
- the pending and the failed resolution rows - had "no frame anywhere". They do
now: QA round 7 ran the live click pass with the harness browser tool on the
pre-rebase head `f6ba4c712` (26 frames, out of tree at `/tmp/qa-ui154-r7/frames/`
with `MATRIX.md` and `wire.log` beside them) and design round 7 judged those
pixels as rendered and signed the rendered gate off, terminal, on that head. The
rebase that followed moved the head without moving any product or pixel content,
which is why the sign-off still describes this branch. The frames remain outside
the repository by this branch's convention, and **nothing in this directory owes
a re-capture** for any of it.

Historical method (not permission to repeat it): `scripts/draft-pick-evidence.vite.mjs`
serves this page under Vite with `desktopProxyPlugin()` — the same plugin
`electron.vite.config.js` registers — so the shipped `desktopRequest` takes its
same-origin `/__desktop` branch, and behind that proxy is a real
`local-operator serve` on an isolated `HOME`/config dir with a synthetic
`LOCAL_OPERATOR_DESKTOP_TOKEN`. `scripts/draft-pick-evidence.mjs` drives a private
Chrome over raw CDP (a `mktemp`-scoped profile, killed and swept at the end).
That setup used the shipped page/store/proxy with an isolated backend. It did
not establish a successful selection: the row activation in the driver is wrong
(see below). New interactions and screenshots in this recovery must use the
approved browser tool only; do not run the historical Chrome/CDP driver.

The initial capture report named backend PR #1110 at `ee8d41fba`; a later pass
reported the released 0.54.46 backend and committed the current PNGs in
`e444c44a2` (rebased equivalent `301ae2d9d`). The exact capture timestamps and
per-frame DOM measurements were not retained. The manifest cites the historical
frame-carrying commit, not a fresh capture or current-head visual equivalence.
Backend #1110 is merged at `1296cda41` and released in 0.54.46; its availability
is not a blocker. The historical report recorded these capabilities:

```json
{"desktop_contract":1,"features":{"auth":1,"settings":1,"commands":1,"catalogues":1,"draft_preview":1,"draft_selection":1,...}}
```

## What is in this directory

| Frame | What it shows |
| --- | --- |
| `draft-no-model.png` | A generic New chat pane whose strip visibly reads `gpt-5` and `auto`, beside the empty context ring. The filename is historical and misleading: this is **not** an unresolved/Choose a model state. |
| `draft-at-rest.png` | A New chat with architect pane, also reading `gpt-5` and `auto`, with focus in the composer. This still does not prove a successful pick. |
| `picker-open.png` | A populated model dialog over that architect draft, with the first-message explanation and search focus. No row-selection result is captured. |

## Two things this directory must not be read as

**The committed frames are pre-delta.** The round-4 remediation changes copy and
state handling only - no image blob in this repository moved with it - so every
committed frame that shows the draft chips' sentences, and the three PNGs here,
render the **previous** wording. The copy they show is history; the sentences the
code now prints are in `destination-pickers.tsx` and `session-status-strip.tsx`,
and the states the delta adds (the pending and failed resolution rows) have no
frame *in this directory* - they were driven out of tree by QA round 7 on the
pre-rebase head, cited above, which is a gap here rather than a tooling block.

**The after-send pair is one frame.** `29-after-send-immediate.png` and
`30-after-send-settled.png` in QA round 3's out-of-repo set (see above) are
byte-identical - `sha256 f7db10911b77aa15...`, zero differing pixels - so the pair
proves nothing about settling and the no-shift claim rests on `28` against a
single post-send state, which design round 3 measured and confirmed. That set is
not in this directory, and design D8's ask - drop one file, or capture a genuinely
distinct settled frame - is discharged out of tree rather than here: QA round 7's
`16`/`17` are distinct after-send states, which design round 7 measured as 88,868
differing pixels between them in the transcript column. The round-3 pair stays
what it always was - one frame stored twice, historical, not a settling claim -
and nothing in this directory was re-captured for it.

There is **no `numbers.json` in this committed directory**. No per-frame DOM
geometry or event trace is claimed. Design D3's unresolved Choose a model entry
is shown only by the existing Storybook `chat-session-status-strip/draft-actionable`
board, not by these live PNGs. The WebP image sweep does not validate PNGs; the
manifest declares zero swept WebP frames here and explicitly records the three
historical PNG artifacts outside that count.

## The effort reading, after the backend fix

`sessions.preview` used to answer a spec the first turn did not agree with: the
ladder was empty on a fresh draft, so the chip was hidden and the picker was
unreachable. PR #1110 fixed that, and the released build it produced (0.54.46)
answers the model's own ladder. Observed against the isolated run this set was
re-taken on, for the draft the harness opens:

```
reasoning: true | reasoning_efforts: ['none','low','medium','high','xhigh'] | reasoning_effort: null
```

This is the historical backend-reading report, not an effort-picker interaction
or first-turn proof. The viewed PNGs show `auto`; none shows an open effort picker
or a picked effort. No renderer fallback or fabricated ladder is justified by
that earlier backend defect.

## Source reuse in the round-2 remediation

No PNG or WebP was recaptured or modified. Following the unchanged-surface
convention in `../run-details/README.md`, the manifest's current-tree stamps can
be reconciled without calling old pixels new captures, with this measured scope:

- Against frozen `b79c3eb80`, the only changed renderer file is
  `destination-pickers.tsx`. Comparing its named declaration blocks gives
  **25 identical blocks** (including `useDraftPick` and `ModelPicker`); only
  `EffortPicker` changes. Its changes are the effective-first spec and the
  resolved-default candidate fallback, not styles or shared picker markup.
- A real esbuild import-graph walk over **all 28 story files** reaches that
  module from **only `model-picker.stories.tsx`**, which renders the unchanged
  `ModelPicker`. No story, stylesheet, strip component, or sweep-capture script
  changed. Thus the changed effort path is not represented by the existing
  swept stories; the sweep's old pixels are not new effort-path evidence.
- The script-tree changes are behavioral regression tests and the historical
  driver's warning comment; the capture implementation remains unchanged.
- The historical `capturedAt`, frame-carrying commit citation and PNG bytes stay
  put. Updating current-tree stamps does **not** claim that the whole live app
  matches its historical capture: upstream changed that app, and the changed
  effort flow still needs approved browser interaction and new stills.

Local audit artifacts are `/tmp/ui154-recovery/rendering-scope-proof.json` and
`story-import-proof.json`; the declaration comparison and esbuild graph are
reproducible from the code, and these local files are not published attachments.

## What is NOT here, and why (this matters more than what is)

- **`model-picked`, an open effort picker, `effort-picked`, `after-send`, and
  `first-turn`: absent.** The old driver called `HTMLElement.click()` on at most
  six option rows, while `PickerRow` selects on `onMouseDown`. No mousedown meant
  no selection was submitted. Its unchanged-reading observation therefore does
  **not** show a catalogue, provider-credential or backend-resolution failure.
  The previous explanation that no catalogue row resolves is withdrawn.
- **Independent QA's API matrix** on frozen UI `b79c3eb80` found 617 catalogue
  rows, 447 connected, and successfully previewed and created a chosen
  model/effort; a real first turn answered `QA154-PONG`. It also verified auth and
  invalid-input refusals. This is backend/transport execution, now SUPERSEDED as
  the reachability argument by the browser round below rather than left as the
  only evidence: see PR #154's `QA report — round 1` for commands and actual
  responses, and `QA report — round 3` for the UI cells it could not reach.
- **The interaction cells are covered, outside this directory.** QA round 3 drove
  them with real pointer events through the shipped browser transport: the
effort-first pick on a fresh draft and on a chosen model, the model pick with its
confirmation, the picked pair before send, the send, the first turn served by the
picked pair, a sibling draft left on the machine default, and the capability-off
negative control at rest and on click. The frames are QA's, at
`/tmp/qa-ui154-r3/evidence/`; the round's disclosures bound them — the browser
transport rather than Electron IPC, and no captured outbound provider body.
- **The delta's own states are covered too, by later rounds, and also outside
  this directory.** QA round 7's live click pass on the pre-rebase head
`f6ba4c712` (`/tmp/qa-ui154-r7/frames/`, 26 frames with `MATRIX.md` and
`wire.log`) drove the pending, refused and failed resolution rows the strip
gained beside the pick-before-send, carry, clear-and-say and capability-off
cells, and design round 7 signed the rendered gate off on those pixels. Both
sets are out of tree; what is missing from THIS directory is historical pixels,
not a permission.
- **Design scope:** design round 3 is terminal on its head for the live picker,
  picked, after-send and inert states, and design round 7 is the terminal
  rendered round for this delta's own states - no blocker and no major on either,
  with D2 pinned and D6/D8/D25-D27 recorded as follow-ups or satisfied. Design
  round 3's three unrendered items stay unrendered: the longest catalogue
  selector, the in-dialog refusal (unreachable by product design), and the
  mid-transition frames for D6. Existing pixels in THIS directory still do not
  establish any of it.
