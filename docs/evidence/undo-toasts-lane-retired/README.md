# The sidebar toast lane, retired — rendered evidence

The chat sidebar's three messages — the archive offer, the archive refusal, and
the draft-discard offer — as **ordinary sonner toasts** in the app's one
bottom-right container, photographed in the running app. The change is the
operator's request of 2026-09-27 (*"instead of having a separate sidebar
notification, we should probably just use the normal sonner toast"*), and the
design record it supersedes is `docs/design/sidebar-row-space.md` §10 (D11,
supersession entry at the end of the section).

**BOTH halves of every pair below are committed here, from one generation.** The
design round's D1 (round 1) measured the first after half 8.0 CSS px off the
shipped sidebar: everything from the destinations→band boundary down sat at
`panel top 284` in the committed after frames against `276` on the shipped head
(before run and head both read 276 — control-row glyphs 291.5–304.5). The commit
that moved that boundary is `a453617991` (#598, *"one 16px tier under the
destinations, and an 8px step below a collapsed section"*): it landed on the
shared `origin/main` ref between this session's first after half (taken on
`0f23c76de5` + the change) and its base run, so the pair as first published
paired an `origin/main`-284 "after" with an `origin/main`-276 "before". This
set's remedy is the clean one: **the before half is `origin/main` = `55d7b0a19b`
(the branch's fold base), the after half is that tree plus this change, and both
were re-shot in one pass** — the same scenes, the same window size, one headless
launch per palette — so the published pair is one generation and the boundary
numbers agree by construction (both halves' runs read `panel top 276`).

| state | before (`origin/main` 55d7b0a19b) | after (this change, folded) |
| --- | --- | --- |
| archive offer | [`before-archive-offer`](before-archive-offer/localOperatorDark.webp) | [`after-archive-offer`](after-archive-offer/localOperatorDark.webp) |
| archive refusal + Retry | [`before-archive-refusal`](before-archive-refusal/localOperatorDark.webp) | [`after-archive-refusal`](after-archive-refusal/localOperatorDark.webp) |
| draft-discard offer | [`before-drafts-offer`](before-drafts-offer/localOperatorDark.webp) | [`after-drafts-offer`](after-drafts-offer/localOperatorDark.webp) |
| the discard offer's Undo | [`before-drafts-undo`](before-drafts-undo/localOperatorDark.webp) | [`after-drafts-undo`](after-drafts-undo/localOperatorDark.webp) |
| the offer against the composer | [`before-offer-vs-send`](before-offer-vs-send/localOperatorDark.webp) | [`after-offer-vs-send`](after-offer-vs-send/localOperatorDark.webp) |
| **both offers standing together** (the stack) | — the lane had one seat: three messages, one id, one winner, so this state could not exist | [`after-stacked-offers`](after-stacked-offers/localOperatorDark.webp) (rest: the newer fully drawn, the older peeking) and [`after-stacked-expanded`](after-stacked-expanded/localOperatorDark.webp) (under the pointer: both drawn, disjoint) |

Each directory holds `localOperatorDark.webp` and `localOperatorLight.webp`
(`cwebp -q 90` conversions of the runs' PNGs) **except the two drafts pairs**,
which are **dark only**: the `drafts` scene does not drive the theme switch (its
own committed set carries `themes: 1`), so a `--theme localOperatorLight` launch
of that scene photographs dark pixels and is not committed as light. The
`before-*` frames are the same scenes on the base tree; the lane card they carry
is the state this change retired.

## What the pair shows, state by state

- **archive offer / refusal**: the lane card in the sidebar's own bottom band
  (before) against the app's standard toast in the one bottom-right container
  (after). The refusal keeps its `Retry` in both; the after's card is the
  library's own — same ground, ink, border and corner close × as every other
  toast in the app.
- **draft-discard offer / Undo**: same movement, for the drafts trail.
- **the offer against the composer**: the row-space scene at the 280 panel.
  Before, the card sat inside the panel's own band; after, it is the viewport
  corner — and it covers the composer's `Send`, which is the trade the operator
  re-accepted when asking for the standard toast (design D12's measurement,
  recorded below rather than hidden).
- **both offers standing together**: the state the lane made impossible and the
  design round's D3 asked to see - an archive offer and a discard offer at once,
  sonner's standard stack (at rest the newer fully drawn with the older peeking
  behind it; under the pointer both expand, disjoint), one container, no band, no
  lane class. Driven by the app's own two acts in `--scene undo-toasts-stacked`, a
  scene this change adds, because a claim about *two* messages cannot be
  photographed from a scene that raises one.

## The numbers the frames are of

From `measurements/offer-toast-280-{dark,light}.json` (identical in both
palettes), the offer raised at the 280 panel:

- **one container, one message**: `{"containers": 1, "inPanel": false,
  "overlapsSend": true}` and `toasts {"total": 1, "painted": 1}` — with the
  lane's second container gone, sonner's "a positioned toast is drawn in every
  mounted container" behaviour has exactly one container to draw in;
- **the card**: `x 1000..1356, y 826..876` (356 × 50), anchored to the viewport's
  bottom-right, **outside the panel** (`panel x 0..280`), **no band element
  anywhere** (`band: false`);
- **the D12 trade, measured rather than asserted**: Send is `x 1232..1264,
  y 836..868` — inside the card's box. The scene asserts the boxes are *read*,
  not disjoint (`overlapsSend`/`overlapsForm` echoed), per the operator's
  direction;
- **the stack** (from the `undo-toasts-stacked` runs; the two frames this set
  commits are of these reads, identical in both palettes): at rest the newer
  (discard) offer is `x 1000..1356, y 826..876` with the older (archive) behind
  it at `x 1009..1347, y 813..861` — a 13px peek, its content at the library's
  collapsed opacity — and under the pointer both report `data-expanded="true"`
  and stand disjoint at archive `y 754..804` and discard `y 818..868`, both
  `x 1000..1356`.

## What the runs reported

| scene | before (`origin/main` `55d7b0a19b`) | after (this change, folded) |
| --- | --- | --- |
| `session-archive` (dark, light) | 70 PASS / 0 FAIL | 69 PASS / 0 FAIL (one superseded clause pair merged) |
| `drafts` | 54 PASS / 1 FAIL | 54 PASS / 1 FAIL |
| `row-space` | 48 PASS / 8 FAIL | 48 PASS / 8 FAIL |
| `undo-toasts-stacked` (dark, light) | — (the scene is this change's own) | 16 PASS / 0 FAIL |

**The failures are pre-existing at this base, NOT this change's**, and they are
identical in both trees, which is why both logs are committed: the `drafts`
failure is `and the next step moves past it rather than sticking` (the Arrow ring
past the inapplicable `Clear all`, red on `origin/main` at this head too), and
the `row-space` eight are the pin/width clauses, red on `origin/main` under this
host's conditions in the same run.

## How these frames were taken

`scripts/renderer-driver.mjs` on the built app, `headless` window mode, a scratch
profile, one launch per palette, the app's own Electron and
`webContents.capturePage()`; each scene's committed scratch daemon answers the
catalogue (`docs/evidence/session-archive/harness/stub-daemon.mjs` for
`session-archive` and `undo-toasts-stacked`,
`docs/evidence/sidebar-row-space/harness/stub-daemon.mjs` for `row-space`, the
installed runtime's `lop serve --hosting test --model mock` in an isolated
config dir for `drafts`). The before half ran in a throwaway worktree at
`55d7b0a19b` with a lockfile-identical `node_modules`; the after half in the
change's own worktree, both built at the same `VITE_LOCAL_OPERATOR_API_URL`.
The runs' own logs are committed beside the frames, one per run —
`session-archive-{before,after}-run-{dark,light}.log`,
`drafts-{before,after}-run-dark.log`,
`row-space-{before,after}-run-{dark,light}.log`,
`stacked-after-run-{dark,light}.log` — force-added with `git add -f` past
`.gitignore`'s `*.log`, the precedent `docs/evidence/chat-sidebar-drafts/` set
and `chat-connection-live` set. The exact invocations are in the runs' own
headers and in the sibling sets' READMEs, which these runs followed.

## Earlier citations, kept as history (older generations)

The first version of this set cited other sets' frames for the before half
because they were the lane's own committed states: `session-archive/undo-offer`
and `archive-refused` (the 2026-09-19/20 register-era captures in the older
icon-rail sidebar), `chat-sidebar-drafts/after-drafts-deleted` and
`after-drafts-undo-restored` (current column, but the earlier drafts pass), and
`sidebar-row-space/after/offer-toast-280` (the 2026-09-22 row-space tree). The
design round's D2 asked for like-for-like before frames; the `before-*`
directories above are those, and this note is what the older citations were
superseded by — their sets' own supersession notes still apply to them.

## What could not be reproduced

The operator's *"these don't properly show up"*: every lane-era run in this
session drew its message (the before logs' `undo-offer`/`archive-refused`/
`drafts-deleted` frames all carry the card), so the complaint is recorded as
**not reproduced** rather than demonstrated. What the change does about the class
it names is structural and is in the design record: the raise now lives on
`UndoToasts` in `main.tsx`, mounted for the app's whole life, where it used to
live in `ChatSidebar` — the panel, which unmounts with the collapsed sidebar and
the other region doors.
