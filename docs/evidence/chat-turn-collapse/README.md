# `chat-turn-collapse` — the turn summary's states, and the live receipt episode fold

The swept set of the collapsed turn's own states, photographed from the
turn-collapse stories by `scripts/capture-evidence.mjs` at 1280x900 in the two
`localOperator` palettes. Its live sibling is `../chat-turn-collapse-live/` (the
built app, one scene); the pre-change halves live in
`../chat-turn-collapse-before/`.

This file was written by the LIVE RECEIPT EPISODE pass (2026-10-17, head
`5a1831622674695bcbd7a3fb7d368cc01bcff3ac`) and describes the cells THAT pass
added; the set's earlier generations are recorded in `../manifest.json`
(`turnCollapseEvidenceNote`), not restated here.

## The live receipt episode fold's cells

One story drives one transcript through its own buttons — QA switches stages on
the SAME transcript, then expands through the real summary control — so the four
stage cells are a sequence, not four states of different fixtures:

| cell | stage | what it shows |
| --- | --- | --- |
| `quiet-exchange-before/localOperator{Dark,Light}.webp` | `before` | one received row while the turn waits — the lone opening receipt PAINTS (the bar would replace the reader's only content) |
| `quiet-exchange-during/localOperator{Dark,Light}.webp` | `during` | the exchange's receipts arriving while the turn thinks, condensed into ONE bar — `Peer messages · 2+ · 1+ actions`, no duration clause — the chevron at the line's end, the working line below |
| `quiet-exchange-idle/localOperator{Dark,Light}.webp` | `idle` | settled: the same bar stands alone, no second one |
| `quiet-exchange-expanded/localOperator{Dark,Light}.webp` | `expanded` | the reader's press through the bar's own control: the rows it stands for, revealed in place |
| `lone-actionable-peer-negative/localOperator{Dark,Light}.webp` | — | the negative control: a run that OPENS with a single actionable receipt and a visible answer still being written paints loose — no settled answer precedes it, so no bar may replace it (its two frames were re-shot at `1470f8a6b`; both rows show) |

## What produced them

```sh
node scripts/capture-evidence.mjs http://localhost:6188 \
  --only=chat-turn-collapse--quiet-exchange \
  --themes=localOperatorLight,localOperatorDark \
  --allow-backend --theme-settle-ms=180000
# then, for the control, the same command with
#   --only=chat-turn-collapse--lone-actionable-peer
```

against a Storybook dev server started from this worktree at head
`5a1831622674695bcbd7a3fb7d368cc01bcff3ac`, `TZ` pinned to America/New_York by
the rig. The same states on the base tree are the before half
(`../chat-turn-collapse-before/quiet-exchange-*/`, base `64e1089099`).

**The control was re-shot at `1470f8a6b`** (`20825fe0a`, design review D1): its
answer previously never painted — the fixture opened it with a full
`message_start` carrying the paragraph, and the reducer paints an empty row for
that — so the old pair contradicted its caption. The re-shoot writes the
sentence as the `message_update` delta the stream actually sends; both rows now
show, and the working line one step below reads `responding 0s` where the
answer-less fixture read `thinking 0s`.

**MEASURED, not asserted** (`cmp` over the full files): `during` differs in both
palettes — three loose rows on the base against ONE bar here; `idle` and
`expanded` are byte-identical across the halves in both palettes (the settled
fold and its expansion render exactly as before); `before` is byte-identical in
dark and carries a 188-pixel light delta (x 145–947, y 95–255, max channel delta
161) confined to the working line's animated activity glyph — a capture phase,
proven by the dark half's clean encode, not a rendering difference.

## What these cells do not claim

- **The built app has no receipt-arrival scene.** The fold's transition evidence
  is THIS stage sequence; no live-app frame of a receipt arriving mid-turn exists
  in `../chat-turn-collapse-live/` or here, and adding one is a scene extension of
  its own.
- The fixtures are static wire records that contact no backend (`--allow-backend`
  is the rig's documented exemption for a `--only` run while the operator's daemon
  answers on :1111) — the cells photograph the reducer and components reading
  those records, not a live session.
- The `2+`/`1+ actions` reading is the bar's `N+` partial vocabulary (see
  `docs/branding.md`: a head-cut span states `N+` with no duration) — the cells
  state it rather than hide it.
