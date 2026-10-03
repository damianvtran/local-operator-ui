# The sidebar notification badge, restyled: before and after frames

The operator's report (2026-09-30, via Aida): the circled number that appears on
the rail's rows — "Aida", "Browser" — "should have more subtle treatment,
borderless, background of the circle slightly contrasted but not as contrasted as
current, and smaller font size on the number and subtler font treatment. It should
look and feel closer to the numbers on the team count lines instead of the janky
bubble that there currently is."

This directory is the frames that claim, taken through the app's own
`capturePage()` in the `headless` window mode: the **browser row** (the nav row
that can carry one, two and three digits) and **Aida's row** (the row the operator
named), each in both brand palettes.

## What changed

One primitive gained a variant, and one call site uses it.

- `Badge` (`src/renderer/src/shared/components/ui/badge.tsx`) gains
  `variant="attentionQuiet"`: **borderless** (`border-0`), a `bg-elevated`
  whisper of a disc instead of the `warning-wash` fill, `text-ink-dim` at
  `font-normal`, and the new `text-meta-sm` (11px) numeral. The bordered
  `attention` mark is unchanged and still worn by the chat header's globe and
  the browser URL bar, where the ring is what separates the mark from
  neighbouring glyphs in a cluster.
- `renderNavItem` (`sidebar-navigation.tsx`) draws the rail badge with
  `attentionQuiet`.
- `--text-meta-sm` (`styles/index.css`) is added to the type ramp and registered
  in `shared/lib/utils.ts`'s `twMerge` map, so it participates in conflict
  resolution like every other step.
- `scripts/contrast-contract.mjs` gains a `rail approval badge (quiet)` row:
  the mark's ink (`ink-dim` on `elevated`, 5.01:1 worst over the fifty-nine
  palettes) clears the 4.5:1 text floor the `CONTROLS` loop applies, and the
  edge is declared away with `edge: false` **and the measurement that justifies
  it** — the `elevated` step spans ΔE00 0.00-11.64 over the four grounds, so on a
  hovered or current row it merges into the ground and the NUMERAL is the whole
  mark. A quiet row draws nothing, so presence is the signal.

The measurement the operator compared, stated in the palettes where the comparison
was made: the old bordered mark's `warningWash` stepped ΔE00 5.22 off `surface` in
the dark brand palette and 5.44 in the light; the new `elevated` fill steps **3.29**
and **2.50**. Same ground, roughly half the separation. (Both pairs are quoted from
`localOperatorDark` / `localOperatorLight` specifically. An earlier revision of this
file paired the brand palettes' 5.22/5.44 with **2.02**, which is the *fleet worst*
— `arcade`'s own step — not the brand palette's; design round 1 D1 caught the
conflation. The worst over the fifty-nine is 2.02, and the row in
`contrast-contract.mjs` states it beside the brand pair.)

## The frames

Every frame is the **built app in `headless` window mode** taken by
`scripts/renderer-driver.mjs --scene approval-badges` (the rail half needs no
backend; the header half is skipped without one, which is why no `chat-header`
claim appears here; QA rounds 1 and 2 between them repaired its
conversation-open step — the disclosure press it threw on has no home in today's
sidebar, and the row it presses has to be WAITED for, then confirmed open, rather
than pressed blind — so a `--backend` run reaches the header half instead of
failing before it) and by the committed
`chat-sidebar-ack-and-selection` rig for Aida's row (a REAL mock-provider
completion, the same path that set's own frames use). PNG, not WebP, on purpose:
`check-evidence.mjs`'s frame walker counts `.webp` only, so a rig-driven set cannot
be mistaken for frames a sweep produced.

| Directory | Tree | What it is |
| --- | --- | --- |
| `before/` | `origin/main` = `ee5611a2e4` (version 0.31.25) | the bordered bubble the operator reported, on the browser row |
| `after/` | this branch, `src/` at `953cde47b9` (`src/` tree `e3e061539`) | the quiet mark, the same states |
| `aida/` | both trees | her row, before and after, one missed-message receipt |
| `alternatives/` | this branch, `bg-transparent` build | the PLAIN-numeral variant the report asked to weigh |

The frames were re-shot on the folded head after this branch folded `origin/main`
(`dad1778e14`, #615 + #712), and the browser-row frames came back **byte
identical** to the pre-fold capture: the fold touched no file on the badge's
rendering path (only `styles/index.css` overlapped, merged with this change's
`--text-meta-sm` block intact), which is the trees' own answer to "did the fold
move the pixels". The round-1 remediation re-shot them again and every frame but
the new three-digit pair came back byte-identical for the same reason — that pass
changed comments, the instrument and this file, not the mark.

A second fold (`origin/main` at `4ea16359` — the mesh-canvas train and the 0.31.26
release) landed after round 2. **No frame was re-taken and none moved**, and that is
measured rather than assumed: the fold's whole reach into the badge's path is
additive (`styles/index.css` +41, `themes.generated.css` +60, both new
`hairlineStrong` variables), the brand palettes' own roles are byte-for-byte what
they were (`elevated` `#322D22`/`#fefdfa`, `inkDim` `#a6a091`/`#656056`, and the
steps this change quotes — 3.29 / 2.50, 2.19 / 7.00 — re-measured unchanged), and a
fresh scene run on the merged tree reproduces **all 14 frames byte-identical** at
34 PASS / 0 FAIL per palette. The manifest's stamps were re-derived to the merged
tree.

### The states (`before/` and `after/`, `-dark` and `-light`)

| Frame | State |
| --- | --- |
| `approval-badges-none-*` | nothing pending — neither surface draws a badge |
| `approval-badges-two-three-*` | two live requests, expanded rail |
| `approval-badges-collapsed-*` | the same count in the 56px strip |
| `approval-badges-collapsed-tooltip-*` | the strip's tooltip open on the row |
| `approval-badges-collapsed-two-digits-*` | twelve live requests — a two-digit count |
| `approval-badges-rail-current-*` | the browser row is the current destination (`row-selected`) |
| `approval-badges-three-digits-*` | **128** pending, staged through the seam (below) — a three-digit count |

The counts are the no-backend run's, which is what these frames are: without
`--backend` the scene raises the two requests no conversation owns and ten more for
the crowded state. An earlier revision of this file described the with-backend
counts (three and thirteen) under frames that show two and twelve — QA round 1 Q2.
With a backend the same scene runs at three and thirteen and additionally opens a
conversation for the header half (verified after the round-2 repair: 47 PASS / 0
FAIL against the stub backend, the header badge reading 1 of 3 live).

### What the scene measured, on this head

Read from the app's own computed style in the collapsed two-digit state:

```
{"borderTopWidth":"0px","boxShadow":"none","backgroundColor":"rgb(50, 45, 34)",
 "color":"rgb(166, 160, 145)","fontSize":"11px","fontWeight":"400"}
```

`rgb(50,45,34)` is `localOperatorDark`'s `elevated`, `rgb(166,160,145)` is its
`ink-dim`, `borderTopWidth: 0` and `boxShadow: none` are the removed border and
ring. The two-digit pill sits `clearance: 5` inside the rail's right edge.

**The same scene is the instrument for both trees, and it is why the `before/`
run is the proof.** On `before/` it fails exactly the two claims that describe
the change —

- `the mark is borderless and ringless: its box is its whole boundary` — FAIL
- `the numeral is the count family's: 11px, weight 400, ink-dim on elevated` — FAIL

— while every geometry claim (row height, rail width, label position, rail-edge
clearance) PASSES on both trees, because the restyle moves nothing. The `after/`
run reports 0 FAIL in each theme (the check total is 32 in the dark theme and 31 in
the light — the extra is `no process from this run outlived its boot`, which
degrades to a note when the probe cannot measure; QA round 1 Q3). The staged
three-digit step adds two more checks to each theme's run.

The scene's rail readings were **re-derived in this change** because the scene
had outlived its tree: it read the rail's container with `closest('nav')`, which
matches nothing on today's sidebar (it renders `[data-sidebar-shell]` docked and
`[data-sidebar-strip]` collapsed), so `railWidth`/`railEdge` were `null` and the
clearance claims compared against nothing; and it pinned a 48px strip and a 32px
row that are 56px and 30px now. The claims are unchanged; the readings describe
the tree the frames are of.

### The three-digit state, and why it needs a seam

The operator asked to see the mark at one, two and three digits. One and two are
live states; three is **not reachable on this control** — the consent queue caps at
16 — so the scene stages it through the armed dev driver's `stageLiveConsents` verb:
pending requests published through the store's own path, granting and deciding
nothing, with the numeral, the mark's geometry and the row's accessible name all the
shipped code. It is disclosed because it is the one state a real run cannot produce
(QA round 1, Q1: the verb had no caller, so an earlier revision of this file claimed
a three-digit frame the instrument could not take). At 128 the count renders uncapped
and the mark stays inside the rail's right edge.

### The selected row, deliberately

On `row-selected` the disc's prominence is not the same in both palettes: measured
ΔE00 2.19 (dark) against 7.00 (light) from the tokens, 2.21 against 6.41 in the
frames. That asymmetry is **a decision rather than a side effect** (design round 1,
D2): the numeral carries the mark in both (the `ink-dim` floor is 5.01:1 fleet-wide),
the light palette shows *more* mark than the dark and never less, and evening it up
would need a per-ground fill the role system does not have — re-shooting the whole
set to trade one theme's subtlety for another's. The chosen direction keeps it: a
whisper on the dark selected row, a soft chip on the light one.

### The alternative (`alternatives/`)

The report asked for the plain-numeral reading to be weighed too. `plain-*.png`
is the same state with the fill removed (`bg-transparent`) — a bare muted numeral
with no disc at all. It is the closest reading to the team-count lines, which
carry no disc; the chosen direction keeps the disc because the report asked for
"background of the circle slightly contrasted", and on the light palette the
subtle disc is what keeps the numeral from reading as loose label text. The design
round owns this call and its frames are here for it.

## The runs, exactly

```sh
# the browser row, one theme per launch
node scripts/renderer-driver.mjs --scene approval-badges \
  --theme localOperatorDark --out docs/evidence/nav-badge-restyle/after

# Aida's row, through the committed ack rig (real mock-provider completion)
SCRATCH=<scratch> ACK_THEME=localOperatorDark BACKEND_PORT=<free> CDP_PORT=<free> \
  bash docs/evidence/chat-sidebar-ack-and-selection/harness/run-aida.sh <tree> after-dark
```

`before/` was built in the same worktree with the visual change stashed (the
driver and the seam kept, so ONE instrument ran on both trees), and its frames
are the same scene run against `origin/main`.
