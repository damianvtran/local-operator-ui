# Historical draft-pane captures — partial evidence only

These three PNGs show a draft strip and an open model picker, not a successful
model/effort pick or first message. They predate the PR #154 recovery and have
not been recaptured. A live API response proves backend resolution; it does not
prove that a user can activate the picker or that the resulting state renders.
The missing browser interaction and rendered states remain a merge gate.

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
`e444c44a2` (rebased equivalent `5a65d4af7`). The exact capture timestamps and
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
  invalid-input refusals. This is backend/transport execution, **not UI click
  proof**: see PR #154's `QA report — round 1` for commands and actual responses.
- **Effort first on a fresh default-resolved draft**, model first then effort,
  rejected-pick preservation, another draft/settings remaining unchanged, and
  the capability-off negative control all still need the real browser-tool flow.
  QA's origin approval request expired without user approval; no alternative
  browser driver was used and no new screenshot is claimed.
- **Design scope:** round 2 is terminal only for its viewed strip remediation and
  supplied populated model-picker layout. The missing picked/effort/after-send
  surfaces, including loading/empty/refusal/populated and consecutive frames,
  remain **BLOCKED / unreviewed**. Existing pixels do not establish these states
  on the changed picker code or the upstream-changed whole app.
