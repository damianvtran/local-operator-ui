# A draft pane's pick, in the real app against a real backend

The other half of the composer's readings set. Storybook can show that a draft's
model reading is a control; only a live backend can show what the control DOES,
because both halves of the claim are back-end facts: `sessions.preview` answers
the window and the ladder for the CHOSEN model, and `sessions.create` births the
first turn on it.

Method, and it is the sibling sets' method: `scripts/draft-pick-evidence.vite.mjs`
serves this page under Vite with `desktopProxyPlugin()` — the same plugin
`electron.vite.config.js` registers — so the shipped `desktopRequest` takes its
same-origin `/__desktop` branch, and behind that proxy is a real
`local-operator serve` on an isolated `HOME`/config dir with a synthetic
`LOCAL_OPERATOR_DESKTOP_TOKEN`. `scripts/draft-pick-evidence.mjs` drives a private
Chrome over raw CDP (a `mktemp`-scoped profile, killed and swept at the end).
Nothing is stubbed: `ChatPage`, the canonical sessions store, the proxy, the
backend and the SSE stream are all real.

Backend for these frames: `~/local-operator` PR #1110, branch
`feat/draft-model-effort`, head `ee8d41fba`, read-only, run from its own `.venv`
with `--no-sync` semantics (no writes into that worktree). Capabilities observed
in the run:

```json
{"desktop_contract":1,"features":{"auth":1,"settings":1,"commands":1,"catalogues":1,"draft_preview":1,"draft_selection":1,...}}
```

## What is in this directory

| Frame | What it shows |
| --- | --- |
| `draft-no-model.png` | A NEW conversation with nothing chosen yet. The backend's resolution names no model, so the reading offered is the pick itself, in the actionable register (design D3). |
| `draft-at-rest.png` | The same pane once the resolution names a model: the model reading is a control with the hover step a control has, and the inert context ring sits beside it. |
| `picker-open.png` | The model reading clicked: the SAME dialog a session's reading opens, on a pane with no session behind it. |

`numbers.json` carries, per frame, the pane's readings by `aria-label`, their
geometry and whether the backend advertised `draft_selection` — read out of the
live DOM at shutter time rather than restated here.

## What is NOT here, and why (this matters more than what is)

- **`model-picked`.** The driver picks a catalogue row and waits for the reading
  to change; on this isolated backend it never did, so the driver REFUSED to
  photograph the pane (a frame there would show the default model under a picked
  name). The observed cause is in the backend's own log for the run: every row
  this backend lists is credential-less (`openai, no credential`), and the
  preview answers for those models do not resolve, so the pick is refused and the
  reading correctly stays. With a credentialed provider — the operator's real
  machine — the same click is expected to resolve; that cell needs a backend
  whose catalogue offers a model it can actually resolve.
- **`effort-picker-open` / `effort-picked`.** Not merely uncaptured: on this
  backend head the effort reading is ABSENT on a draft, by design of the code
  under review. `sessions.preview` skips the account-metadata step a cold
  session runs, so the spec it answers carries `reasoning: false`,
  `reasoning_effort: null`, `reasoning_efforts: []`, `context_metadata_resolved:
  false` — observed directly against the running backend for both `model_name:
  mock` and `model_name: gpt-5`. `session-model.ts`'s `effortState` then takes
  its `metadataAbsent` branch (`knownLadder: false`), the strip's chip gate
  (`{effort && (!draft || effort.levelKnown) && …`) hides the chip, and
  `openEffort`'s `knownLadder` gate leaves the picker unreachable. That is a
  backend defect in this feature — the preview answering a specification the
  first turn does not agree with — and it is being fixed in PR #1110. No
  renderer-side gate, fallback or default rung was added to make a reading
  appear, because a fabricated level is worse than an absent one (R19/R21).
  The verification to re-run once the fix lands: a fresh draft renders an effort
  LEVEL from the preview's own ladder, the chip opens the effort picker, and a
  picked rung is followed by the pane's own reading.
- **`after-send` / `first-turn`.** Both depend on a successful pick, so they wait
  on the two cells above.

### The negative control is still owed

The same page against a backend WITHOUT `draft_selection` (the shell's inert
state) is specified in the driver (`inert` mode, which asserts no picker opens)
and runnable with `DRAFT_PICK_EVIDENCE_PORT=5205` against any pre-#1110 backend;
it was not run in this pass. The capability-off render is pinned by tests
(`composer-readings.test.mjs`), but tests are not the photograph the design round
asked for.
