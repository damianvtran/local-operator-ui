# The child reader's follow-the-tail control, and the scroll behaviour around it

Two arms of one rig, seven-plus states each, in the two brand palettes — the run
pane's child reader while a child streams, measured and photographed from the
shipped component.

```
<arm>/<state>/<theme>.webp      e.g. after/scrolled-up/localOperatorDark.webp
<arm>/<state>/<theme>.webp      the palette sweep: after/ring/<twelve palettes>
```

Arms: `before` (the reader at this branch's base, no control anywhere in the
pane), `after` (the reader with the control, its band, and the threshold the
paging policy already used), and `prev` (the band WITHOUT this round's clip fix,
shot by the same rig at `ccd6f4b55` in the two foot states the clip pair
needs - see "The clip, and the pair that proves it").

## What produced them — the arms are a script, and each arm is checked

```sh
node scripts/child-reader-scroll-evidence-arms.mjs before origin/main -- --frames \
  --themes=localOperatorDark,localOperatorLight \
  --json=docs/evidence/child-reader-tail-follow/before-readings.json
node scripts/child-reader-scroll-evidence-arms.mjs after -- --frames \
  --themes=localOperatorDark,localOperatorLight \
  --json=docs/evidence/child-reader-tail-follow/after-readings.json
node scripts/child-reader-scroll-evidence.mjs --arm=after --frames --only=ring \
  --themes=localOperatorDark,localOperatorLight,dracula,dune,sage,monokai,tokyoNight,iceberg,radient,neon,obsidian,synth \
  --json=docs/evidence/child-reader-tail-follow/after-ring-readings.json
node scripts/child-reader-scroll-evidence-arms.mjs prev ccd6f4b55 -- --frames --only=foot \
  --themes=localOperatorDark,localOperatorLight \
  --json=docs/evidence/child-reader-tail-follow/prev-foot-readings.json
node scripts/child-reader-scroll-evidence.mjs --arm=after --frames --only=foot \
  --themes=localOperatorDark,localOperatorLight \
  --json=docs/evidence/child-reader-tail-follow/after-foot-readings.json
```

**The tree must be still while a run is in flight.** The rig's Vite server
watches it; a write anywhere under the repository mid-run makes the page reload
between steps and the step it lands in fails for the rig's own reason - measured
twice while this pass's runs were being written. Commit, then run.

**The recipe is a script because the hand-run one could not reproduce.** The
first version of this README told a reader to run `git stash push -- <the
reader>` and then the rig with `--arm=before`; on any branch carrying the change
that stash prints "No local changes to save", exits 0, and the rig then labels
AFTER bytes as `before` (review round 1, R1-1 — the reviewer followed the shipped
recipe and got exactly that). `scripts/child-reader-scroll-evidence-arms.mjs`
swaps the module, asserts the swap by digest, hands that digest to the rig as
`--expect-digest`, restores from git and prints `restored=identical`; the rig
refuses to run an arm whose module digest disagrees with the flag, and refuses a
`before` report that found a control at all.

Each run also prints the MD5 of every module it measures, and every reading row
names its palette, so a frame can be tied to the bytes and the palette it is a
picture of:

| module | before arm | after arm |
|---|---|---|
| `run-child-reader.tsx` (the arm's module) | `8c68061ca3ab` | `148a2a6e6a14` |
| `canonical-transcript.tsx` | `8a590b414a9c` | `8a590b414a9c` |
| `use-scroll-paging.ts` | `042ae70a3c22` | `042ae70a3c22` |
| `scroll-paging.ts` | `4e32a82e085c` | `4e32a82e085c` |

Row one is the arm; rows two to four are the scroll machinery, identical in both
arms, which is this branch's claim that it does not touch them.

## What is real, and what is not

**Real**: `RunChildReader` and everything under it — `useChildTranscript`'s tail
read and its pulse cadence, `applyHistoryPage`, `CanonicalTranscript`,
`useScrollPaging`, `useScrollToBottom` and the shipped `ScrollToBottomButton`, the
app stylesheet, `desktopResult` → `desktopRequest` → its same-origin
`POST /__desktop` branch, and the browser's own `column-reverse` overflow anchor.

**Scripted**: the BACKEND behind `/__desktop`
(`child-reader-scroll-evidence.vite.mjs` answers one op, `subagents.transcript`,
from a list the driver grows a batch at a time), and the row the pane would derive
from the parent's roster — the roster is the parent's, and the parent has no
backend here. A batch is written to the scripted child and THEN the `pulse` prop
is bumped, which is the wire's own order, so rows reach the pane through the
shipped read path rather than through its state.

**Not covered here**: the wire itself — a real child process writing a real file
and relaying `subagent_progress`. That half is
`docs/evidence/chat-run-panel-live/`'s subject. The parent surface is not mounted
in this rig either; the parent's own control is its composer-band instance, and
what this branch shares with it is the hook and the component, which the readings
below name.

## The readings

Both arms, `localOperatorDark`, 900x900, one run of the rig per arm. `top` is
`scrollTop`, `fromTail` is `|scrollTop|` (this scroller is `column-reverse`, so
the origin is the tail), `cut` is how many pixels of the NEWEST row fall below the
viewport's bottom edge, `cover` is how many pixels of a VISIBLE row the control's
box covers, `band` is the reserved band's height, `tab` is the control's index in
the page's tab order, and `button` is read from computed style rather than from
the prop. The `after` arm's foot states live in their own readings file
(`after-foot-readings.json`), and the `prev` arm's two states in
(`prev-foot-readings.json`); the `G0`/`G1` pair is the fade frozen and released
(see "The fade, frozen").

| step | arm | top | fromTail | cut | cover | band | tab | button | reads |
|---|---|---|---|---|---|---|---|---|---|
| A0 at the tail | before | 0 | 0 | 0.0 | - | - | - | absent | 28 |
| A0 at the tail | after | 0 | 0 | 0.0 | 0.0 | 48 | - | off/inert | 29 |
| A1 after a batch | before | 0 | 0 | 0.0 | - | - | - | absent | 31 |
| A1 after a batch | after | 0 | 0 | 0.0 | 0.0 | 48 | - | off/inert | 31 |
| A2 after a batch | before | 0 | 0 | 0.0 | - | - | - | absent | 34 |
| A2 after a batch | after | 0 | 0 | 0.0 | 0.0 | 48 | - | off/inert | 34 |
| A3 after a batch | before | 0 | 0 | 0.0 | - | - | - | absent | 36 |
| A3 after a batch | after | 0 | 0 | 0.0 | 0.0 | 48 | - | off/inert | 37 |
| B0 scrolled up | before | -600 | 600 | 558.6 | - | - | - | absent | 36 |
| B0 scrolled up | after | -600 | 600 | 558.6 | 0.0 | 48 | - | on | 37 |
| B1 after a batch | before | -868 | 868 | 826.6 | - | - | - | absent | 39 |
| B1 after a batch | after | -868 | 868 | 826.6 | 0.0 | 48 | - | on | 40 |
| B2 after a batch | before | -1114 | 1114 | 1072.6 | - | - | - | absent | 42 |
| B2 after a batch | after | -1114 | 1114 | 1072.6 | 0.0 | 48 | - | on | 43 |
| C0 scrolled up | before | -1114 | 1114 | 1072.6 | - | - | - | absent | 42 |
| C0 scrolled up | after | -1114 | 1114 | 1072.6 | 0.0 | 48 | - | on | 43 |
| C1 back at the tail | before | 0 | 0 | 0.0 | - | - | - | absent | 42 |
| C1 back at the tail | after | 0 | 0 | 0.0 | 0.0 | 48 | - | off/inert | 43 |
| E0 3px off the tail | before | -3 | 3 | 0.0 | - | - | - | absent | 42 |
| E0 3px off the tail | after | -3 | 3 | 0.0 | 0.0 | 48 | - | off/inert | 43 |
| E1 after a batch | before | -3 | 3 | 0.0 | - | - | - | absent | 45 |
| E1 after a batch | after | -3 | 3 | 0.0 | 0.0 | 48 | - | off/inert | 46 |
| E2 after a second batch | before | -3 | 3 | 0.0 | - | - | - | absent | 47 |
| E2 after a second batch | after | -3 | 3 | 0.0 | 0.0 | 48 | - | off/inert | 48 |
| D0 settled | before | -3 | 3 | 0.0 | - | - | - | absent | 48 |
| D0 settled | after | -3 | 3 | 0.0 | 0.0 | 48 | - | off/inert | 49 |
| D1 eleven seconds later | before | -3 | 3 | 0.0 | - | - | - | absent | 48 |
| D1 eleven seconds later | after | -3 | 3 | 0.0 | 0.0 | 48 | - | off/inert | 49 |
| F0 40px off the tail | before | -40 | 40 | 0.0 | - | - | - | absent | 48 |
| F0 40px off the tail | after | -40 | 40 | 0.0 | 0.0 | 48 | - | on | 49 |
| F1 after a batch | before | -40 | 40 | 0.0 | - | - | - | absent | 48 |
| F1 after a batch | after | -40 | 40 | 0.0 | 0.0 | 48 | - | on | 49 |
| G0 the control appearing (fade frozen at 40%) | before | -600 | 600 | 558.6 | - | - | - | absent | 48 |
| G0 the control appearing (fade frozen at 40%) | after | -600 | 600 | 558.6 | 0.0 | 48 | - | on | 49 |
| G1 the control settled (fade released) | before | -600 | 600 | 558.6 | - | - | - | absent | 48 |
| G1 the control settled (fade released) | after | -600 | 600 | 558.6 | 0.0 | 48 | - | on | 49 |
| G2 hover | after | -600 | 600 | 558.6 | 0.0 | 48 | - | on/hover | 49 |
| G3 focus (21 tabs) | after | -147 | 147 | 105.6 | 0.0 | 48 | 0/22 | on/hover/focus | 49 |
| G4 after the press | after | 0 | 0 | 0.0 | 0.0 | 48 | - | off/inert/focus | 49 |
| H0 a failed child, scrolled up | before | -1284 | 1284 | 1268.0 | - | - | - | absent | 48 |
| H0 a failed child, scrolled up | after | -635 | 635 | 619.0 | - | - | - | absent | 49 |
| H1 a child with no session id | before | - | - | - | - | - | - | absent | 48 |
| H1 a child with no session id | after | - | - | - | - | - | - | absent | 49 |

Read these ways:

- **At the tail, the reader stays at the tail and nothing is painted under it.**
  `A0`-`A3` hold `top` 0 and `cut` 0.0 across three consecutive arrivals, and the
  control is `off/inert` — hidden AND not a hit target.
- **A scrolled-up reader is not yanked.** `B0`-`B2`: the anchored row keeps its
  place while the extent grows under it, and the control shows.
- **The control does not cover the rows.** The first cut put it at the
  transcript's own `p-4` inset, which is where the rows' TEXT is: that is what
  the previous head measured at 32.0px of cover — the chip sitting on a line of
  prose by its full height. The band makes it 0.0px in every state where the
  control is shown, which is the number this round exists for (QA Q1, UX U1).
- **A reader 40px off the tail is offered the way back** (`F0`), and still is
  after an arrival moves the tail away (`F1`). The paging policy calls a reader
  past `TAIL_EPS_PX` (24px) *not following the tail*, so the control's own
  threshold of 50 left 24-50px as the one band where a reader was being left
  behind with nothing on screen (UX U3).
- **A settled child is quiet.** `D0` → `D1`: the read count is unchanged across
  six seconds, so no timer survives a child that has stopped.
- **The gate holds.** `H0` (a failed child, scrolled up) and `H1` (no session id)
  paint neither the control nor its band — no `cover`, no `band` — because the
  band would sit under the exception text (design D3, QA Q2), and a session-less
  child has no scroller at all.
- **Keyboard**: the control is index 0 of
  22 in the page's tab order (UX U4: as
  the last element in the pane it was the last tabbable in the pane and in the
  app, reached only after tabbing through the whole conversation), and `Enter` or
  a press returns the reader to the tail.

## Twelve palettes, because the boundary is the ring

The control's fill measures 1.07-1.16:1 off the transcript ground in every
palette, so its whole boundary is the 1px `border-control` ring. Design round 1
asked for the other ten palettes (D1). Measured two ways:

- **The tokens**, computed from the palette values (`border-control` against
  `canvas`, WCAG relative luminance, from the palette modules) — floor **3:1**
  (`docs/branding.md` § 3, "component triples: edge against the ground behind"):

| palette | canvas | borderControl | ring:canvas |
|---|---|---|---|
| `localOperatorDark` | `#22201c` | `#837c6d` | 3.93:1 |
| `localOperatorLight` | `#f2ede3` | `#857f70` | 3.42:1 |
| `dracula` | `#282A36` | `#7D8BB4` | 4.22:1 |
| `dune` | `#21201E` | `#8A7D6E` | 4.06:1 |
| `sage` | `#F2EDE0` | `#68865F` | 3.48:1 |
| `monokai` | `#272822` | `#8E8A73` | 4.27:1 |
| `tokyoNight` | `#2A2A35` | `#7A83AF` | 3.84:1 |
| `iceberg` | `#E8E9EC` | `#787D97` | 3.34:1 |
| `radient` | `#1B2027` | `#7A8CA3` | 4.76:1 |
| `neon` | `#1C2029` | `#6F8F99` | 4.71:1 |
| `obsidian` | `#202021` | `#7F7F88` | 4.10:1 |
| `synth` | `#231C32` | `#8A7BA0` | 4.22:1 |

  Twelve palettes, **3.34:1 to
  4.76:1, no palette below the floor.**
- **The rendered frames**: `after/ring/<palette>.webp`, one scrolled-up state per
  palette, where the ring is read off the pixels. A 1px antialiased stroke reads
  below its token ratio on any screenshot (the design round measured ≈2.8-3.0:1 in
  light off the old frame), which is why both numbers are here: the tokens are the
  contract, the frames are what the eye gets.

## The clip, and the pair that proves it (design round 2, D6)

The band extends the scroller's clip; the scroller's own focus ring then painted
its bottom segment ACROSS the foot - a full-width accent rule 2px into the
reserved band, with nothing under it to focus. Design round 2 read it off the
frames and asked for the scroller's box to clip its ring instead. The fix is a
wrapper at the scroller's own box (`data-child-transcript-clip`): the clip moves
off the scroller, and the scroller's backdrop draws the ring the way it does
everywhere else `CanonicalTranscript` is mounted.

The pair is committed, one module apart, both photographed by the same rig, same
sequence, same two brand palettes:

| | `prev` - `ccd6f4b55` | `after` - this head |
|---|---|---|
| frames | `child-reader-tail-follow/prev/<state>/<theme>.webp` | `child-reader-tail-follow/after/<state>/<theme>.webp` |
| module (`run-child-reader.tsx`) | `a08da51c2349` | `148a2a6e6a14` |
| the ring, read by walk | bottom **755.609** against a clip bottom of **800.609** - `contained: true` | bottom **755.609** against **752.609** - `contained: false` |
| the rule, read off the pixels | rows 754-757 carry a 2px accent core; **418 px** of ink on each core row (755, 756) | the same rows, and the band's own rows, carry **zero** ink outside the chip |

`ringClip` is the rig's own walk: up from the scroller to the nearest ancestor
whose computed `overflow` hides the vertical axis, then the arithmetic above. It
is read in every step and asserted in the `foot` group, so a regression fails the
run rather than the eye. The arithmetic before this round read `contained: true`
because the BODY was the clip; the walk is deliberately ancestor-based, so it
kept answering "contained" while the segment still painted inside the wrapper -
which is why the pixels, not the boolean, are the finding.

**What this set does not fix**: the scroller shows no ring at all under this fix,
which is `CanonicalTranscript`'s behaviour at every other mount. The wrapper
drawing the ring is the honest end state and is deferred - see "Deferred".

## What the fold walked, and what it left alone

The set's capture head is `aefa9c918`; the branch has moved twice since - the fold
onto `origin/main` (`3c3919c891`, 375 commits) and the chip remount (`b74b9f0b93`).
The fold's own walk for these stories, taken live at the tip (design round 3,
with QA round 3's own cell agreeing):

| module | at capture | at the tip |
|---|---|---|
| `run-child-reader.tsx` | `148a2a6e6a14` | `5574724c8ece` (the remount moved this one) |
| `canonical-transcript.tsx` | `8a590b414a9c` | `9722389f68cb` |
| `use-scroll-paging.ts` | `042ae70a3c22` | `a977ac155c9f` |
| `scroll-paging.ts` | `4e32a82e085c` | `f98869453fe9` |

The six foot readings (the chip's rect, `overlapPx` 0, `band` 48, the statement's box,
`ringClip.contained`) come back IDENTICAL to the committed baseline, so the pair's foot
claims are pictures of this tree as well as of the capture's. What the fold moved, and
why this is recorded rather than re-rendered: transcript-side fields only - `extent`
5328 -> 5076, the anchor offsets, the scroller's accessible name
`Conversation transcript` -> `Conversation`; `reads` varies by the cadence itself.
`prev/` is unaffected by construction: it is the `ccd6f4b55` module swapped in for its
own run, and that commit is immutable.

## The fade, frozen (design round 2, D7)

The control fades in; nothing in the previous readings could say a fade was IN
FLIGHT rather than settled, which no still of a 200ms transition can show by
construction. The rig now freezes the animation at 40% of its duration
(`freezeFade`) and reads the computed `opacity` on every step. `G0` is that
frozen state: **0.913982**, a value no other reading in the set produces. `G1`
is the same state with the fade released: **1** (settled). The pair is what
makes an in-flight reading a measurement rather than a claim.


## A failing shape this rig does NOT reproduce, and does not claim to

A bare scroller carrying this scroller's exact declarations — `column-reverse`,
`display: flex`, `overflow: auto`, `scrollbar-gutter: stable both-edges`,
`overflow-anchor: auto`, `padding: 1rem` — DOES lose the tail: at `scrollTop` -3,
appending three rows moved the offset to -147 (and -267 in a repeat with 80px
rows), leaving the newest row 144-268px below the fold, delay-independent. That is
the shape the operator's report described, and it is why the near-tail state `E`
is in this set. **On this tree it does not occur**: at the same offset the
arrivals land on screen (`cut` 0.0). Whatever differs between the two is in the
app's own DOM and is NOT isolated here, so nothing in this set should be read as
an explanation of a report that stopped reproducing after #478.

## Deferred, and why

- **The new-content register** (`hasNewActivity`, the "New activity" label): not
  ported (UX U2, design D5). The parent never sets it — no caller of
  `message-input.tsx` or `chat-content.tsx` does — so porting it would add a
  divergence where the operator asked for parity, and it belongs to the shared
  control rather than to this pane. The design note's `§ 6.2` derives it from the
  reader's own arrivals; that premise is about a parent mount which does not
  derive it, so the note is what needs amending and the register is recorded on
  the pull request.
- **The scroller's own focus indicator.** This round's clip fix restores the base
  behaviour - no visible ring on the scroller - rather than painting one from the
  wrapper. The honest end state is the wrapper-draws-the-ring pattern on the
  SHARED component, with evidence across its mounts; it is recorded on the pull
  request (design round 2, D6) instead of half-done here.
- **The parent's own threshold** (50px against the same `TAIL_EPS_PX` of 24px):
  the same shape as U3 one surface over, left alone here because the parent's band
  is a composer and the change would need its own evidence. Recorded on the pull
  request.

## Provenance

`manifest.json` declares `child-reader-tail-follow/before` and
`child-reader-tail-follow/after` as `supplementary` sets with their own `source`.
They cannot be re-derived by `pnpm capture-evidence`: the subject is a scroller's
behaviour over time, which a story's static fixture cannot produce — the reader's
`previewPage` seam seeds its transcript once and makes no request, so an arrival
cannot be delivered through it.

The scripted child's rows are the story fixtures' own shape
(`run-details.fixtures.ts`'s `entry()`), and its epoch is taken from the run, so
the rows' timestamps and the reader's elapsed label describe the same moment.
