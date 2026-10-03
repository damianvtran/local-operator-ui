# The load moment: what a switch into a running conversation paints

Two frames and two tables, from the switch harness, measuring the operator's
2026-10-01 report:

> "loading into a new conversation in the UI **jitters** — a preliminary state
> paints first (uncondensed rows / inactive cue), then ~a second later the full
> state re-renders with in-flight actions and the condensation applied."

## The pair

`inflight-settled-before/` and `inflight-settled-after/` are the *same harness*,
the *same fixture* and the *same state*, on two trees:

- **before** — `af6fffa899`, the tree the load-moment pin was written against. It
  is 485 commits behind the after tree below (`gh api
  repos/damianvtran/local-operator-ui/compare/af6fffa899...9946f84f177` →
  `ahead_by 485`), and the split of that distance is not worth stating: it is
  almost all of main's history after #745's merge, which is the point — the base
  is the *cut-point* this lane's pin cites, not a one-change neighbour of the head.
- **after** — the branch's working tree at the state the harness-flag commit
  `9946f84f177` records (post-#745 plus this lane's harness). It is named as the
  harness content rather than as a commit because that is exactly what was served
  when the capture ran.

Both photograph the `settled` state of a switch into `abcdef000024`, a
conversation **whose turn is still running** (a wake receipt, two settled calls
behind it, no closing assistant). What the pair shows is one row, and what moved
is its **idiom**:

- **before**: the settled span is the transcript's own **collapsed trace fold** —
  `> 3 shell · 3 read_file`, a disclosure chevron at its left, the six calls
  behind it, no duration and no rule. No turn-collapse bar is painted at all.
- **after**: the same span is the **turn-collapse bar** — `Took 2s · 6 actions`,
  the full-width rule above it — with the in-flight cycle (the wake receipt,
  `Running · 2 shell · 1 read_file · 6.4s`, `running bash 6s`) drawn in place
  below.

An earlier wording of this paragraph called the base "expanded" with "the
individual calls" on screen. That was wrong, and the frames refuse it: no call
row is on screen in either palette. Round 1's reviewer measured the pair's row
ink and found the transcript below the span displaced by **13 px** — the bar's
block is 13 px taller than the fold row it replaces, where an expanded six-row
span would add ≳100 px. What the `[data-turn-summary]` count reads (0 bars before,
1 bar after) is unaffected, because a trace fold is not a turn-summary bar.

Same conversation, same moment, different first paint. The frames and the tables
below are **separate runs of the same harness**: they agree in shape and in the
ordering of the states, not numerically. Each run's scripted call starts its own
clock, so the elapsed seconds differ between them — the after frame's working line
reads `running bash 6s` and its transcript line `6.4s`; the after table's
`running bash 6s` is another run's; the before table's is `5s`. No figure here is
quoted from a frame into a table or the reverse.

The dark banner ("The Local Operator server is missing auth, settings, …") is a
**rig artifact**: the harness scripts a private owner that answers only the ops
this graph reaches, so the app's capability check reports the rest missing. It is
not a finding, and it is on every frame this harness has ever written.

## The tables

`node scripts/session-switch-latency.mjs --live --switches=3` prints the phase
table **as well as** a line for each **change** in what the pane showed, because
the report is a **sequence**. The lines below are from the two runs the tables
name, recorded 2026-10-03 at load average 4.6–4.9 on 14 cores, with the harness's
configured owner latencies (`sessions.get` 12 ms, `history` 14 ms, `stream`
12 ms).

The tables below were produced by the harness version that sampled on
`lop:transcript:render` **marks**, so one row is one commit; the shipped sampler
records a row per **change** instead (see "What the series is sampled from"
below), which is the same states in the same order under the labels `change N`.
Both versions were run on the head, and the per-change one is the shipped one —
so the two cannot be diffed literally against each other (the shipped printer also
emits the working line's spinner glyph verbatim, which the change signature
normalises away; QA round 2, Q8).

**before (`af6fffa899`), the running conversation (`abcdef000024`):**

| mark | ms | rows | bars | working | placeholder | strip |
| --- | --- | --- | --- | --- | --- | --- |
| 0–5 | +11…+78 | 0 | 0 | – | yes | – |
| 6 (first contentful) | **+115** | 3 | **0** | `running bash 5s` | no | `0.6%/200k $0.120` |
| 7–10 | +122…+131 | 3 | 0 | `running bash 5s` | no | same |
| settled | +218 | 3 | **0** | `running bash 5s` | no | same |

**after (post-#745 + harness), the same conversation:**

| mark | ms | rows | bars | working | placeholder | strip |
| --- | --- | --- | --- | --- | --- | --- |
| 0–4 | +19…+46 | 0 | 0 | – | yes | – |
| 5 (first contentful) | **+158** | 3 | **1** (`Took 2s · 6 actions`) | `running bash 6s` | no | `0.6%/200k $0.120` |
| 6–9 | +165…+175 | 3 | 1 | `running bash 6s` | no | same |
| settled | +191 | 3 | 1 | `running bash 6s` | no | same |

Two things to read from that:

1. **One paint in every sample.** After the contentful change, nothing about the
   pane changes again through `settled` — the rows, the bar, the working line and
   the strip are all present in the sample that first shows content, on both
   trees. There is no uncondensed→condensed step and no inactive→active cue step
   on either; the *content* of that one paint is what the fix moved (0 bars →
   1 bar). **The window this covers is short and worth naming** (QA round 2, Q7):
   the run ends when the composer becomes sendable, which the after runs measure
   0–1 ms after the contentful sample — so the claim is "nothing changed between
   the contentful paint and the run's own end", not "nothing changed for a
   second". Under the change-sampler the settled sample is byte-identical to the
   contentful one in all six cue fields, with only the timestamp moving. The claim is scoped to what the mechanism keeps: the series samples the
   DOM once per frame and records a sample on every **change**, so a state that
   lasts a frame is in here and a transient shorter than one is not.
2. **The cost.** The first contentful sample lands at **50 / 158 / 187 ms** after
   the click on the head (three switches: small warm, the running conversation,
   the 45-row conversation) against **91 / 115 / 139 ms** on the base. The head's
   condensation is computed *for* that first frame, and that is where the extra
   tens of milliseconds go. The operator's bar is < 300 ms and it is met with
   room, but the direction is worth stating rather than hiding inside a median.

Phase medians from the same runs:

| phase | before | after |
| --- | --- | --- |
| click → committed | 0.2 ms | 0.3 ms |
| committed → stream subscribed | 14.9 ms | 14.7 ms |
| committed → snapshot delivered | 68.4 ms | 77.2 ms |
| committed → rows committed | 10.8 ms | 10.6 ms |
| committed → transcript painted | 160.3 ms (106.2–214.3) | 139.7 ms (68.8–210.7) |
| **click → transcript painted** | **160.5 ms** (106.5–214.5) | **140 ms** (69.1–211) |

`n = 2` timed switches per arm plus the three sampled ones; the driver prints the
load average for exactly this reason. This is the Vite dev bundle in a private
headless Chrome, not the packaged Electron app, so absolute milliseconds are an
upper bound and the **pair** is the number to read.

## What the series is sampled from, and why it changed

`Run.commits` used to be pushed by the `lop:transcript:render` mark handler. QA
round 1 (Q3) found the gap that shape leaves: on the 45-row arm the series jumped
`rows 0` straight to `settled rows 45` with **no sample at the contentful change**
— a mark can be delivered, and its `startTime` can fall, before the commit the
store subscription records. The frame loop now samples the pane's cues once per
frame and keeps a sample on every change, so the contentful state is recorded
whatever produced it; the mark is still observed, and it still decides
`firstRowAt` and the phase table's timing. The honest claim is therefore "one
paint in every sample", not "one paint per commit".

## The commands

One vite server, one driver run — the driver launches its own headless Chrome and
reaps it:

```sh
node scripts/session-switch-latency.mjs --live --switches=3            # the tables
node scripts/session-switch-latency.mjs --live --frames=… --states=settled  # the pair
```

`--states=` narrows a capture to the named states (an unknown name, or an empty
value, is refused at parse time — before a browser is launched). The base arm
needs the same harness inside a checkout of `af6fffa899` and its own server
(`--port 5212`, the origin as the driver's positional argument): the three files
that were copied in are `scripts/session-switch.tsx`,
`scripts/session-switch-bridge.ts` and `scripts/session-switch-latency.mjs`, at
the state `9946f84f177` records. Nothing else in the base checkout was touched,
which is what makes the before frame a statement about the app rather than about
the rig.

One environment caveat, recorded because it cost a round: under host swap
pressure the harness's vite server can be killed silently, and a run then fails
as "never became ready" with no error of its own. Check the server is alive
(`curl -s -o /dev/null -w '%{http_code}' http://localhost:5211/session-switch.html`)
before reading such a failure as a finding about the page.

## Not this lane: the `held-press` arm refuses on current main

A full `--frames` sweep aborts at `held-press`, because the composer now states
`Your message will send as soon as the conversation is ready.` and that arm's own
check refuses exactly that sentence (rightly: the state exists to show a press
held in silence). Reusing that sentence is an ask-ui-copy train change, and the
arm's expectation is the switch lane's, not the load-paint lane's — recorded here
because the abort is what a reader of this directory will hit first if they run a
sweep instead of `--states=`.
