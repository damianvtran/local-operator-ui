# The ask-count badge — the top clip, and the quiet register

**What these are.** Ten hand-driven frames from the committed harness in
`harness/` (`capture.mjs`): the clip pair's two stories at both themes (four
render states), once `before` and once `after`, plus the `both-marks` state's
`after` half — a state the pre-fix tree never had.

| state | frames |
| --- | --- |
| `chat-header-cluster--asks-waiting` (`asksCount=3`, session scope) | `frames/before|after/asks-waiting-localOperator{Dark,Light}.png` |
| `chat-header-cluster--asks-fleet` (`asksCount=11`) | `frames/before|after/asks-fleet-localOperator{Dark,Light}.png` |
| `chat-header-cluster--both-marks` (`asksCount=3` with `count=1`) | `frames/after/both-marks-localOperator{Dark,Light}.png` — after half only |

`before/` is the unmodified checkout, frozen history. `after/` is the fix's
tree, **re-captured for the round-1 remediation** — the reserve the mark now
earns widens the cluster, so its pixels differ from the first push's. The new
`both-marks` state has no before half: the state did not exist before the
remediation, so there is no pre-fix tree to photograph and the pair argument
does not apply to it. Each PNG carries its own `.readout.json` — the page's own
measurements, verbatim. PNGs, by the `read-ack-skew` precedent: `check-evidence.mjs`'s
walker judges a frame whenever its NAME claims a theme — every `.webp`, plus any
file whose stem IS a palette id, in whatever container it is packed — and these
frames' stems are the state names, not palette ids, so the walker judges none of
them, and the set is declared: the frames are accounted as unjudged frames
inside a declared set rather than read as undeclared sweep output.

**The defect (operator report, 2026-10-05).** The ask-count badge in the
conversation header's action row was clipped at the top — the screenshot the
report arrived with showed the "3" cut by its container — and the badge was to
join the other counts' quieter register (the sidebar's own ask for a borderless,
slightly-contrasted, smaller count).

**The numbers the fix is judged on, read from the readouts:**

| | before | after |
| --- | --- | --- |
| badge box top vs the band's top edge | **-2.3px** (above it — the clipped sliver) | **+2px** (inside) |
| ring extent (box-shadow) | **-4.3px** — the canvas colour painted over the canvas ground, never visible ink | none — the ring is gone; the box is the painted edge |
| register | `attention` — bordered pill, `warningWash`, `ring-2 ring-canvas` | `attentionQuiet` — borderless, `elevated` fill, `inkDim`, `text-meta-sm` |
| numeral | 12px (`text-meta`) | 11px (`text-meta-sm`) |
| header / trigger boxes | 560x40 / 32x32 at top 4 | same tops and heights — the band does not move; the ask trigger's left edge is 12px further left (380 vs 392), the room the mark now earns |

**Where the +2px lives (design round 1, D5).** The box top sits inside the band
because the wrapper's own offset puts it there: `-top-0.5` on a `flex` wrapper
that shrink-wraps the mark, so the offset IS the placement and no line box
contributes. The first cut landed at +2 by borrowing ~4px of the trigger's
inherited line box while the wrapper's box itself started 2px above the band —
a typography change on the trigger could have moved the mark; the remediation
made the offset the whole story, and the readouts carry the result (box top
`2`; the wrapper's box is exactly the badge's 16px box now, not the 21.7px line
box of the first cut).

**The room the mark costs (design round 1, D1).** The mark's box ends 10px out
from the asks trigger's corner; at the ordinary 8px step it entered the browser
trigger's hover target by 2px (box right 434 against the neighbour's 432 — the
rightmost two columns visually belonged to the mark but pressed the browser
control). The cluster now pays its 12px step while the mark is drawn — the same
reservation the browser mark earns — so the trigger moves left in the after
readouts, and the mark's box now ends at 422 — 2px before the neighbour's box
at 424 (the trigger's right edge 412 plus the cluster's committed 12px step).

**Why the quiet register.** It is the same composition the sidebar rail's
notification count and the team avatar mark wear — `badgeVariants({ variant:
"attentionQuiet", shape: "pill", size: "count" })`, the operator's 2026-09-30
ask — so the counts agree instead of one being a heavier variant. The contrast
pairs are that register's own row in `scripts/contrast-contract.mjs` (`inkDim`
on `elevated`; the header's ground is that row's `canvas`). The browser trigger
KEEPS the bordered mark: its ring separates it from neighbouring icons and its
wash is the feature's "an agent is blocked on you" meaning — the cluster wears
the two registers on purpose rather than by drift, and the `both-marks` frames
are where that pair is one picture: the two marks on neighbouring controls,
which the before/after pair structurally cannot show (the same control at two
times is not two registers side by side; design round 1, D2).

**How to re-run.** From the worktree:

```sh
node_modules/.bin/storybook dev -p 6017 --no-open --ci --quiet &
node docs/evidence/ask-badge-quiet/harness/capture.mjs http://localhost:6017 docs/evidence/ask-badge-quiet/frames/after
```

The harness reads the story's own Storybook (`chat-header-cluster.stories.tsx`)
directly and needs nothing else: no backend is in its loop, and the only network
endpoints it touches are the Storybook origin and Chrome's own auto-selected
debug port (`--remote-debugging-port=0`). The `before` half is frozen history;
re-running it takes the unmodified tree (a detached worktree of the base, never
a stash) and the harness as it stood at the first push — today's `STORIES` list
includes `both-marks`, a state the pre-fix tree cannot render.

**Bounds.** These are Storybook renders of the production `ChatHeader` in its
production band, not live-app screenshots: the operator's own screenshot was not
addressable as a file (relayed 2026-10-05), so the before frame is this
harness's reproduction of the same state — the same render path the after frame
diffs against (and a reproduction is the better before-frame for a diff, because
it is the same renderer). The clip's mechanism is the badge's box starting above
the band's top edge (-2.3px — the clipped edge; the box-shadow ring's -4.3px was
the canvas colour over the canvas ground and never visible ink), which the
readouts carry as numbers; the fix makes the question moot — the whole box sits
inside the band. The empty state cannot be driven by `args=asksCount:0` on this
story — it pins the prop and declares no arg, so Storybook drops the URL arg
(QA round 1, Q1); the covered empty state is the suite's own no-badge states
(`AsksQuiet`, `NoApproval`). Two themes are filed (the brand pair); the
register's full-palette contrast claim rides the existing `rail approval badge
(quiet)` row in `scripts/contrast-contract.mjs`, not these frames.
