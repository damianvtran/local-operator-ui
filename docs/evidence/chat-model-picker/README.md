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

## The opus pair: `before-registry-only-opus/`, `after-registry-only-opus/`, `after-provider-listing-opus/`

Added by the change that made the picker list the providers **by itself**. The
operator's report: after signing in to Anthropic, a model their account's own
`/v1/models` answers with — `Opus 5.5`, where lop's shipped registry stops at
`claude-opus-5` — never appeared in the picker. It appeared only if the user
pressed `Refresh from providers` first, on the chance that it would help.

All three frames are the SAME state of the dialog — open, `opus` typed, the
session on `anthropic/claude-opus-5` — and the pair is a difference between two
LISTINGS rather than between two views:

| Frame | Tree | What it shows |
|---|---|---|
| `before-registry-only-opus` | `origin/main` = `ffa54512e` | One row, `Claude Opus 5`, and the button reads `Refresh from providers`. This is the reported state: the registry's answer, and nothing has asked the providers. |
| `after-registry-only-opus` | this change | The same one row, with the automatic provider listing OUT: the button reads `Refreshing…` and the rows stay painted. This is the half of stale-then-update that a still can carry — the registry paint is not replaced by a spinner while the live read runs. |
| `after-provider-listing-opus` | this change | Three rows: `Claude Opus 5`, `Claude Opus 5.5` and the aggregator route `anthropic/claude-opus-5.5`. **Nothing was clicked** — the button has settled back to `Refresh from providers`. |

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
# This branch's half (the two `after-` directories), from the worktree under test.
node scripts/capture-evidence.mjs http://localhost:6017 --allow-backend \
  --dirs=after-registry-only-opus,after-provider-listing-opus \
  --themes=localOperatorDark,localOperatorLight --theme-settle-ms=180000

# The `before-` half, from a scratch worktree of the base commit carrying the
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

### The existing frames of this surface were not re-taken, and that was measured

A change that wires the query differently could repaint every state above it,
so the two most representative were re-captured at this head and compared
against the committed bytes: `populated` and `refresh-pending`, both palettes,
came back **byte-identical** — the automatic listing answers with the same rows
the registry did in these fixtures and settles before the shutter, so nothing in
the eleven earlier frames moves. `refresh-pending` is the interesting one: its
frame is now reached by a different sequence (the automatic listing settles, and
the click's read is the one held pending) and is the same picture, which is what
`liveOnce` in the story file exists to arrange.

That comparison is a measurement with a caveat worth stating: it was taken by a
narrowed run over `--dirs=populated,refresh-pending`, and `--dirs` matches the
directory name across EVERY surface, so the same command also re-captured five
unrelated `panels-*` states. Those ten frames were restored from `HEAD` rather
than committed — this branch's diff carries no frame outside
`chat-model-picker/`, and that is checkable in the commit itself.
