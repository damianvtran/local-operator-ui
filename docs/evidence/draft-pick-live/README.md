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

## The effort reading, after the backend fix

`sessions.preview` used to answer a spec the first turn did not agree with: the
ladder was empty on a fresh draft, so the chip was hidden and the picker was
unreachable. PR #1110 fixed that, and the released build it produced (0.54.46)
answers the model's own ladder. Observed against the isolated run this set was
re-taken on, for the draft the harness opens:

```
reasoning: true | reasoning_efforts: ['none','low','medium','high','xhigh'] | reasoning_effort: null
```

So the level the first turn will use is now on the pane, from the backend's own
resolution, and the chip can open the effort picker. Nothing in the renderer was
changed to make that happen — the fix was the backend's, which is where the
defect was.

## What is NOT here, and why (this matters more than what is)

- **`model-picked`.** The driver picks catalogue rows in turn and waits for the
  reading to change; on this isolated run none of them changed it, so the driver
  REFUSED to photograph the pane rather than show the default model under a
  picked name. The rows are the app catalogue's own, and the isolated root has
  no provider the resolution will accept, so a pick does not resolve there. It
  needs a backend whose catalogue offers a model it can resolve — the operator's
  own machine has one; an isolated root with `hosting: test` does not. Everything
  downstream of the pick (`effort-picked`, `after-send`, `first-turn`) waits on
  it, and the driver still refuses rather than faking it.
- **The negative control** (`inert` mode, which asserts no picker opens) is
  implemented and not yet run: it needs a backend without `draft_selection`.
