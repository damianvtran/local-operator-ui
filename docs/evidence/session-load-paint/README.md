# The load moment: what a switch into a running conversation paints

Two frames and two tables, from the switch harness, measuring the operator's
2026-10-01 report:

> "loading into a new conversation in the UI **jitters** — a preliminary state
> paints first (uncondensed rows / inactive cue), then ~a second later the full
> state re-renders with in-flight actions and the condensation applied."

## The pair

`inflight-settled-before/` and `inflight-settled-after/` are the *same harness*,
the *same fixture* and the *same state*, on two trees:

- **before** — the pre-#745 base `af6fffa899` (the tree the load-moment pin was
  written against).
- **after** — the post-#745 head, with this lane's harness.

Both photograph the `settled` state of a switch into `abcdef000024`, a
conversation **whose turn is still running** (a wake receipt, two settled calls
behind it, no closing assistant). What the pair shows is one row:

- **before**: the settled span is drawn **expanded** — `3 shell · 3 read_file` as
  a bare tool row, the reader's eye landing on the individual calls.
- **after**: the same span is **one bar** — `Took 2s · 6 actions`, collapsed, with
  the in-flight cycle (the wake receipt, `Running · 2 shell · 1 read_file · 6.4s`,
  `running bash 6s`) drawn in place below it.

Same conversation, same moment, different first paint. The frames also agree with
the tables below, which is the point of keeping both.

The dark banner ("The Local Operator server is missing auth, settings, …") is a
**rig artifact**: the harness scripts a private owner that answers only the ops
this graph reaches, so the app's capability check reports the rest missing. It is
not a finding, and it is on every frame this harness has ever written.

## The tables

`node scripts/session-switch-latency.mjs --live --switches=3` prints one line per
commit instead of a median, because the report is a **sequence**. The lines below
are from the two runs that produced the pair, recorded 2026-10-03 at load average
4.6–4.9 on 14 cores, with the harness's configured owner latencies
(`sessions.get` 12 ms, `history` 14 ms, `stream` 12 ms).

**before (`af6fffa899`), the running conversation (`abcdef000024`):**

| commit | ms | rows | bars | working | placeholder | strip |
| --- | --- | --- | --- | --- | --- | --- |
| 0–5 | +11…+78 | 0 | 0 | – | yes | – |
| 6 (first contentful) | **+115** | 3 | **0** | `running bash 5s` | no | `0.6%/200k $0.120` |
| 7–10 | +122…+131 | 3 | 0 | `running bash 5s` | no | same |
| settled | +218 | 3 | **0** | `running bash 5s` | no | same |

**after (post-#745 + harness), the same conversation:**

| commit | ms | rows | bars | working | placeholder | strip |
| --- | --- | --- | --- | --- | --- | --- |
| 0–4 | +19…+46 | 0 | 0 | – | yes | – |
| 5 (first contentful) | **+158** | 3 | **1** (`Took 2s · 6 actions`) | `running bash 6s` | no | `0.6%/200k $0.120` |
| 6–9 | +165…+175 | 3 | 1 | `running bash 6s` | no | same |
| settled | +191 | 3 | 1 | `running bash 6s` | no | same |

Two things to read from that:

1. **One paint.** After the contentful commit, nothing about the pane changes
   again through `settled` — the rows, the bar, the working line and the strip
   are all present in the commit that first paints content, on both trees. There
   is no uncondensed→condensed step and no inactive→active cue step on either;
   the *content* of that one paint is what the fix moved (0 bars → 1 bar).
2. **The cost.** The first contentful commit lands at **50 / 158 / 187 ms** after
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

## The commands

One vite server, one driver run — the driver launches its own headless Chrome and
reaps it:

```sh
node scripts/session-switch-latency.mjs --live --switches=3            # the tables
node scripts/session-switch-latency.mjs --live --frames=… --states=settled  # the pair
```

The base arm needs the same harness inside a checkout of `af6fffa899` and its own
server (`--port 5212`, the origin as the driver's positional argument). Both
additions used to reach that base — `--states=` to narrow a capture, and `--live`
in the capture URL so the in-flight page can be photographed at all — are in the
harness change that carries this directory.

## Not this lane: the `held-press` arm refuses on current main

A full `--frames` sweep aborts at `held-press`, because the composer now states
`Your message will send as soon as the conversation is ready.` and that arm's own
check refuses exactly that sentence (rightly: the state exists to show a press
held in silence). Reusing that sentence is an ask-ui-copy train change, and the
arm's expectation is the switch lane's, not the load-paint lane's — recorded here
because the abort is what a reader of this directory will hit first if they run a
sweep instead of `--states=`.
