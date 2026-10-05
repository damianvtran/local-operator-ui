# The ask-count badge — the top clip, and the quiet register

**What these are.** Eight hand-driven frames from the committed harness in
`harness/` (`capture.mjs`), four states twice:

| state | frames |
| --- | --- |
| `chat-header-cluster--asks-waiting` (`asksCount=3`, session scope) | `frames/before|after/asks-waiting-localOperator{Dark,Light}.png` |
| `chat-header-cluster--asks-fleet` (`asksCount=11`) | `frames/before|after/asks-fleet-localOperator{Dark,Light}.png` |

`before/` is the unmodified checkout; `after/` is the fix's tree. Each PNG
carries its own `.readout.json` — the page's own measurements, verbatim. PNG
rather than WebP on purpose: `check-evidence.mjs`'s frame walker counts `.webp`
only, so a hand-driven set cannot be mistaken for sweep output (the
`read-ack-skew` precedent).

**The defect (operator report, 2026-10-05).** The ask-count badge in the
conversation header's action row was clipped at the top — the screenshot the
report arrived with showed the "3" cut by its container — and the badge was to
join the other counts' quieter register (the sidebar's own ask for a borderless,
slightly-contrasted, smaller count).

**The numbers the fix is judged on, read from the readouts:**

| | before | after |
| --- | --- | --- |
| badge box top vs the band's top edge | **-2.3px** (above it — the clipped sliver) | **+2px** (inside) |
| painted top (ring included) | **-4.3px** | +2px — no ring; the box is the painted edge |
| register | `attention` — bordered pill, `warningWash`, `ring-2 ring-canvas` | `attentionQuiet` — borderless, `elevated` fill, `inkDim`, `text-meta-sm` |
| numeral | 12px (`text-meta`) | 11px (`text-meta-sm`) |
| header / trigger boxes | 560x40 / 32px at top 4 | **identical** — the row's height does not move |

**Why the quiet register.** It is the same composition the sidebar rail's
notification count and the team avatar mark wear — `badgeVariants({ variant:
"attentionQuiet", shape: "pill", size: "count" })`, the operator's 2026-09-30
ask — so the counts agree instead of one being a heavier variant. The contrast
pairs are that register's own row in `scripts/contrast-contract.mjs` (`inkDim`
on `elevated`; the header's ground is that row's `canvas`). The browser trigger
KEEPS the bordered mark: its ring separates it from neighbouring icons and its
wash is the feature's "an agent is blocked on you" meaning — the cluster wears
the two registers on purpose rather than by drift.

**How to re-run.** From the worktree the range names:

```sh
node_modules/.bin/storybook dev -p 6017 --no-open --ci --quiet &
node docs/evidence/ask-badge-quiet/harness/capture.mjs http://localhost:6017 docs/evidence/ask-badge-quiet/frames/before
# ...apply the fix; Storybook picks it up...
node docs/evidence/ask-badge-quiet/harness/capture.mjs http://localhost:6017 docs/evidence/ask-badge-quiet/frames/after
```

The harness needs the story's own storybook (`chat-header-cluster.stories.tsx`)
and a FREE backend port: it renders the story directly, so — unlike the sweep —
it does not require the operator's backend to be down. The `before` run is the
unmodified tree (a detached worktree of the base, never a stash).

**Bounds.** These are Storybook renders of the production `ChatHeader` in its
production band, not live-app screenshots: the operator's own screenshot was not
addressable as a file (relayed 2026-10-05), so the before frame is this
harness's reproduction of the same state — the same render path the after frame
diffs against (and a reproduction is the better before-frame for a diff, because
it is the same renderer). The clip's mechanism is the badge's box starting above
the band's top edge (-2.3px; ring to -4.3px), which the readouts carry as
numbers; the fix makes the question moot — the whole box sits inside the band.
Two themes are filed (the brand pair); the register's full-palette contrast
claim rides the existing `rail approval badge (quiet)` row in
`scripts/contrast-contract.mjs`, not these frames.
