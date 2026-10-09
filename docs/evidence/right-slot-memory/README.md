# The right slot's per-conversation memory (#894)

The operator's report: *"Remember the open right-side panel per session ... When a
user switches from one session to another, whatever panel was open follows them."*
The four durable right-slot flags (`isCanvasOpen`, `isRunPanelOpen`,
`isBrowserPaneOpen`, `isConsolePaneOpen`) were the window's, so a canvas opened for
one conversation sat beside the next one; and because they were persisted, a
relaunch came back with the wrong conversation's panel on screen.

This set is the before/after pair for the inversion that makes each conversation
remember its own occupant, and it is shot through the real renderer — the real
stores, the real router, the real rail, the real transcript, one Python daemon
holding two real `Session`s under a scratch config root.

**The claim, in one number.** The pane the reader left behind must never paint over
the conversation they moved to. Sampled on EVERY animation frame of the hop
(`probe-hop-after-localOperatorDark.json`):

| | frames on the destination | carrying any pane | carrying the pane left behind |
| --- | --- | --- | --- |
| `main` (before) | 350 | **350** | **350** |
| this branch (after) | 350 | **0** | **0** |

(The light pass sampled its own burst and read the same shape — 350 destination
frames on `main`, every one carrying the pane, and 351 on this branch carrying
none — because the number is a count of frames, not a constant: it is whatever the
browser painted in the window.)

The same hop, the same window, the same backend: on `main` the canvas is mounted
over the destination conversation on every single painted frame; here it is mounted
on none, and the destination's column takes the room back (516 → 1076 px).

## The two arms

| | AFTER | BEFORE |
| --- | --- | --- |
| renderer tree | this branch, head **`fcaf1df0b49`** (round 1's remediation commit; the evidence commit after it changes no renderer code) | `origin/main` @ **`15a7a4ed522`** (#891) |
| served from | this checkout (`RIG_REPO`) | a throwaway worktree of `origin/main` (`SLOT_RIG_BEFORE_REPO`), with this checkout's `node_modules` symlinked in by absolute path |
| backend | the rig's daemon, TWO owner processes: A `Deploy checklist` (`aaaa11112222`, no ask engine) and B `Review notes` (`bbbb11112222`, live queued-ask engine) | the same daemon, the same two owners |
| what differs | `right-slot-memory.ts`, `right-slot-follower.ts`, `ui-preferences-store.ts`'s per-session record and its persist-v3 step, `canvas/index.tsx`'s Escape stand-down (round 1's U2), `main.tsx`'s install, `dev-driver/install.ts`'s two new `state()` fields | — |

`drive-slot.mjs` refuses to drive both arms in one invocation, and each arm is shot
on a rig stood up for it (`run-passes.sh` wipes and restarts the whole rig): two of
the cases WRITE to the shared backend (the draft-admission case is admitted as a new
conversation; the borrow case raises a pending ask), so a second arm — or a second
palette — driven over the same backend would photograph a sidebar with one more
conversation in it and the two stills would differ by something that is not the
tree. For the same reason each (arm, palette) pair is its OWN rig lifetime:
**four passes, four stand-ups**.

Frame-naming: `docs/evidence/right-slot-memory/<case>/<arm>/<palette>.webp` — 30
states × 2 arms × 2 palettes = **120 frames**. Both brand palettes for every case;
the frame's file name IS its palette, so the evidence guard judges each still
against the theme it claims. The zone is pinned (`scripts/evidence-tz.mjs`) and the
rig's Chrome argv route through `scripts/chrome-keychain.mjs`, so a re-shoot on
another host stays byte-comparable and never reaches Keychain Services.

## The claim → frame → numbers table

Read every pair LEFT = before (`main`), RIGHT = after (this branch). All geometry is
CSS px at 1380×900 unless the case names a size; `col` is the conversation column
(`[data-tour-tag="chat-column"]`), `slot` the mounted pane
(`PaneSlot`'s `data-tour-tag`), and every number was read off the page at the
shutter (`run-*.json`) — none is inferred from the pixels.

| case | frame | `main` (before) | this branch (after) |
| --- | --- | --- | --- |
| **s1** switch-restores | `s1-canvas-on-a` | canvas on A: `drawn=[canvas]`, slot 560, col 516 | identical (the control: both arms open a canvas the same way) |
| | `s1-arrival-b` | **the canvas followed into B**: `drawn=[canvas]` at 596 → 560, col 480 | **B is clean**: `drawn=[]`, col 1076, composer 778 |
| | `s1-back-on-a` | canvas 560, col 516 | canvas restored: 560, col 516 |
| | the burst | `hopAtoB` 7 states, all 7 with the canvas drawn | `hopAtoB` **2 states**: canvas+A (t=0), then clean+B (t=218) |
| **s2** restart-on-b | `s2-canvas-on-a` | canvas 560 | identical |
| | `s2-b-before-reload` | canvas 560 beside B | `drawn=[]`, col 1076 |
| | `s2-b-first-paint` | **B comes back WITH the canvas**: `drawn=[canvas]`, col 1076 — the pane is mounted at the right edge (0 px at this read) before its width resolves | **B comes back clean**: `drawn=[]`, col 1076 |
| | `s2-b-settled` | canvas 560 | `drawn=[]`, col 1076 |
| | `s2-a-still-remembers` | canvas 560 | canvas 560 (A's entry survived the reload: `rightSlotMemory=[aaaa11112222:canvas]`) |
| **s3** draft-admission | `s3-a-canvas-open` | canvas 560 on A | identical |
| | `s3-draft-clean` | **the canvas follows onto the New chat draft**: `drawn=[canvas]` 560 | **the draft opens clean**: `drawn=[]`, col 1076, `rightSlotKey=draft:<uuid>`, memory still `[A:canvas]` |
| | `s3-draft-panel-open` | browser pane on the draft: 596, col 480 | identical (596, col 480) — memory now `[A:canvas, draft:<uuid>:browser]` |
| | `s3-after-admission` | browser pane 596 (the global flag survives the flip) | **browser pane still 596**: the entry moved to the new session id in the same step (`[A:canvas, <created>:browser]`) |
| | the burst | 2 states, the pane up throughout | **3 states, the pane up on ALL 298 sampled frames** — no closed frame across the identity flip (the hash flips at t=3618 ms) |
| **s4** asks-borrow | `s4-b-remembers-canvas` | canvas 560 on B | identical (memory `[B:canvas]`) |
| | `s4-ask-arrives-over-the-canvas` | canvas 560 + the asks chip | identical (canvas 560 + chip; memory untouched) |
| | `s4-drawer-borrows-the-slot` | **the drawer borrows**: `drawn=[ask]` 560, **no rail item lit** | identical (`drawn=[ask]` 560, `railLit=[]`) |
| | `s4-canvas-returns` | canvas 560 | canvas 560, **memory untouched** (`[B:canvas]` — the borrow wrote nothing) |
| | `s4-canvas-returns-via-escape` | **Escape takes the canvas with it**: `drawn=[]`, col 1076 — one press closes the drawer AND the canvas (the canvas's window listener double-takes the press the drawer already claimed) | **the canvas comes back**: `drawn=[canvas]` 560, col 516, `railLit=[canvas]`, memory still `[B:canvas]` (round 1's U2: the canvas stands down on a claimed press) |
| **s5a** narrow 1024×900 | `s5a-narrow-1024-canvas-on-a` | canvas 444, col 480, `data-canvas-mode=docked` | identical |
| | `s5a-narrow-1024-arrival-b` | **A's canvas stays beside B**: 444, col 480 | **B is full-width and empty**: `drawn=[]`, col 720, composer 640 — and the sidebar expands to its 260 px rail, the conversation region moving 204 px right |
| | `s5a-narrow-1024-back-on-a` | canvas 444 | canvas restored 444 (the decision record's uniform-restore `[call]`); the sidebar yields to its icon rail again (`col x=56`) — on `main` the sidebar never moves, because a pane is always up |
| **s5b** overlay 800×600 | `s5b-overlay-800-canvas-on-a` | canvas 220, col 480, `data-canvas-mode=overlay` | identical |
| | `s5b-overlay-800-arrival-b` | **A's canvas stays over B**: 220, col 480 | **B is full-width and empty**: `drawn=[]`, col 700, composer 620 |
| | `s5b-overlay-800-back-on-a` | canvas 220 | canvas restored 220 in the app's `overlay` shape |
| **s6** run-frame-arrival | `s6-b-run-panel-open` | run pane 420 on B, col 656 | identical |
| | `s6-on-a` | **the run panel followed to A**: `drawn=[run]` 420 | **A is clean**: `drawn=[]`, col 1076 |
| | `s6-back-first-paint` | `drawn=[]` (the pane's mount is gated on `runDetails`) | `drawn=[]`, col 1076 — the flag is projected, the pane has nothing to draw yet; **the still is the held arrival** (see below) |
| | `s6-back-settled` | run pane 420, col 656 | run pane 420, col 656 (drawn when the canonical frame landed) |
| | the burst | 3 states: pane, empty, pane | **3 states**: clean (t=0), flag `R` with nothing drawn (t=240), pane drawn (t=300) |
| **s7** console-restore | `s7-console-on-b` | console on B: `drawn=[console]`, slot 596, col 480 | identical (memory `[B:console]`) |
| | `s7-arrival-a` | **the console followed into A**: `drawn=[console]` 596, col 480 | **A is clean**: `drawn=[]`, col 1076 |
| | `s7-console-restored` | console 596 (it never left) | console restored: `drawn=[console]` 596, col 480, memory `[B:console]` |

Geometry and store readings for every state — the slot and column widths, the lit
rail item, the overlap, the composer box, the `ui-preferences-storage` byte length
and the store's own `rightSlotKey`/`rightSlotMemory`/flags — are in the eight
records beside this README: `run-{after,before}-{localOperatorDark,localOperatorLight}.json`
(the drive, one per pass) and `probe-hop-{after,before}-{localOperatorDark,localOperatorLight}.json`
(the per-rAF hop probe, one per pass).

Two readings in those records are worth naming because they are the feature's own
state rather than its pixels:

- **The memory is a list of pairs, newest last.** After `s1`'s hop, `main` has no
  such field at all (`rightSlotMemoryAbsent: true` — the tree has no per-conversation
  memory) while this branch reads `rightSlotMemory=[["aaaa11112222","canvas"]]` with
  `rightSlotKey="bbbb11112222"`: B is bound, remembers nothing, and A's entry is
  intact. `s3` shows the ADMISSION carry — `draft:<uuid>` → the new session id in
  the same step as the identity flip — and `s4` shows a borrow that writes nothing.
- **The blob grows by the pairs, not by the panes.** `ui-preferences-storage` is 841
  bytes with A remembering the canvas (842 in light, where the theme name is a byte
  longer) and 868 with the draft's browser pane added;
  the four legacy global flag keys leave persistence entirely (persist version 3),
  so a profile no longer carries one flag per pane.

## What the round-1 review added, and where it shows

- **The `s6` first-paint still is a HELD arrival (design round 1, D1).** A CDP
  screenshot cannot be aimed at the arrival's ~60 ms window — measured while fixing
  this: a capture requested inside the window produced a frame of the DRAWN pane
  while the DOM readings bracketing the request both showed the empty column. So
  the still is taken with the rig's daemon holding the events stream's response
  (`HoldStreamStart` in `serve-slot.py`; the stream's snapshot is what the pane
  waits on, so holding its start holds the state), and the holding run's readings
  bracket the still on both sides (`readings.firstPaint.before/after` in
  `run-*.json`). The timeline numbers beside it are from the UNHELD hop in the same
  case — the sampler marks every animation frame in the page, so it needs no hold
  and reads the app's own timing: flag `R` at t=240 ms with nothing drawn, pane at
  t=300 ms (on `main` the same gap reads t=203 → t=259 ms).
- **The arrival is two steps, and the wide-column phase shows the conversation
  still LOADING (D2).** The column is 1076 px with no pane and the transcript's
  placeholder (`Loading conversation…`) from the bind until the canonical frame
  lands; the pane draws and the column narrows to 656 in the same step the
  transcript paints, ~60 ms later on this loopback rig — the cost the decision
  record accepts. (It is not a transcript re-wrapped mid-air: the transcript and
  the pane arrive together with the frame.)
- **A restored canvas arrives 596 px and eases to 560 (D3, N2), documented, not
  changed.** `probe-hop-*.json`'s `hopBtoA` first samples read `slot 596 / col 480`
  and the last `560 / 516`, seven distinct width states between; `main`'s own first
  open decays the same way (its `s1` timeline: 596 → 581 → 570 → 565 → 562 → 560
  across ~143 ms, t=198–341 in that run's marks). Pre-existing on open; this PR
  makes it once per return. The reload case reads the same shape later in the
  sequence: the UX walk measured the column 540 → 516 on A after a reload, while
  this set's reload records catch the pane pre-layout at `s2-b-first-paint` and the
  settled 560/516 at `s2-b-settled`.
- **At 1024 the sidebar yields with the occupant (D4).** `run-after`'s `s5a` reads
  the conversation region at `x=56` beside the restored canvas, `x=260` on the
  clean destination, and `x=56` again on the return — a 204 px swing each way, per
  hop. On `main` the region never moves (`s5a` `before`: `x=56` throughout), because
  a pane is always up somewhere. The claim table's `s5a` rows now name it.
- **The fail-on-main probe is committed (F3).** `harness/probe-main-failures.mjs`
  bundles the tree it is handed (`node probe-main-failures.mjs <main-worktree>`)
  with its own esbuild, drives the same API cells (A) and (C) need, prints one JSON
  document and EXITS NON-ZERO when the tree shows the old global behaviour — which
  `main` @ `15a7a4ed522` does: cell A, the flag rides the switch onto a
  conversation that never opened a pane; cell C, back on A it still shows the other
  conversation's browser where A's canvas should be. The captured run is
  `probe-main-failures.json` beside this README; against this branch the same probe
  exits 0.
- **The restored console door is photographed; the panes' DESIGNED empty states are
  desktop-host states (D5).** `s7` walks the console door through a hop and back
  (rows in the table above). In this rig the console pane draws its
  browser-reachable fallback ("The console is not available in this app") and the
  browser pane its web fallback, because both panes' designed empty states ("No
  console in this session"; the browser's own first-run surface) need the Electron
  host. The neighbours' sets carry those designed states:
  `console-pane/empty` and `browser-pane/draft-conversation`.

## The commands

Everything is committed under `harness/` and resolves the repository from its own
location, so a clone can re-take these frames. ONE PASS PER INVOCATION — each
invocation starts its own daemon, owners, ONE Vite and ONE Chrome, and reaps them
all by exact pid in an `EXIT` trap before it returns; nothing is left resident:

```sh
# The BEFORE arm needs a checkout of origin/main. A throwaway worktree, NOT the
# working checkout, and this checkout's node_modules symlinked in by absolute path
# (the same lockfile, so nothing is installed):
REPO=~/local-operator-ui-worktrees/per-session-panel-1008
BEFORE="$LOCAL_OPERATOR_SCRATCHPAD/slot-before-1008e"
git -C "$REPO" worktree add --detach "$BEFORE" 15a7a4ed522
ln -s "$REPO/node_modules" "$BEFORE/node_modules"

D=docs/evidence/right-slot-memory
REC="$LOCAL_OPERATOR_SCRATCHPAD/slot-records"   # records land here; frames go to docs/evidence
FR="$LOCAL_OPERATOR_SCRATCHPAD/slot-frames"

# Four passes: AFTER x {dark, light}, BEFORE x {dark, light}.
bash $D/harness/run-passes.sh "$FR" "$REC" after  localOperatorDark
bash $D/harness/run-passes.sh "$FR" "$REC" after  localOperatorLight
SLOT_RIG_BEFORE_REPO="$BEFORE" \
  bash $D/harness/run-passes.sh "$FR" "$REC" before localOperatorDark
SLOT_RIG_BEFORE_REPO="$BEFORE" \
  bash $D/harness/run-passes.sh "$FR" "$REC" before localOperatorLight

cp -R "$FR"/s* $D/ && cp "$FR"/run-*.json $D/ && cp "$REC"/probe-hop-*.json $D/

# And the worktree goes away when the frames are in hand:
git -C "$REPO" worktree remove --force "$BEFORE"
```

A single pass can also be driven by hand, rig first — `rig-up.sh` prints its scratch
root, and `rig-down.sh` (by exact pid, reaping each pid's tree) is not optional:

```sh
SLOT_RIG_SCRATCH="$(mktemp -d)" bash $D/harness/rig-up.sh            # after arm only
node $D/harness/drive-slot.mjs --after http://localhost:5321 \
  --scratch "$SLOT_RIG_SCRATCH" --out "$FR" --theme localOperatorDark
node $D/harness/probe-hop.mjs --after http://localhost:5321 \
  --scratch "$SLOT_RIG_SCRATCH" --out "$REC/probe-hop-after.json"
SLOT_RIG_SCRATCH="$SLOT_RIG_SCRATCH" bash $D/harness/rig-down.sh
```

`SLOT_RIG_BEFORE_REPO` names the before checkout; `SLOT_RIG_NO_AFTER=1` /
`SLOT_RIG_NO_BEFORE=1` start only one of the two dev servers (a pass drives one arm,
and two dev servers plus a daemon, two owners and a browser is what this machine's
per-command memory ceiling kills — measured, at 3.5 GB).

## What the rig is, and what it deliberately is not

`harness/slot-rig.vite.mjs` serves the SHIPPED renderer (`src/renderer`'s own
`index.html`/`main.tsx` and CSP) with `desktopProxyPlugin` over `/__desktop`, and a
shim for the preload globals the app reads before it can render. `harness/serve-slot.py`
is `ask-drawer-stuck`'s two-mode daemon (the real `local_operator.server.app` for the
routes, one owner process per conversation holding a real `Session` + `AskQueue`),
with a command channel the driver uses to raise an ask or seed the run panel's plan.
The provider is a stub that answers one short text turn and never calls a tool; the
operator's own backend on `127.0.0.1:1111` is never addressed (the rig has its own
config root, its own 32-byte bearer and OS-assigned ports). Every Python child runs
under a scratch `HOME` with a fenced `security` on its `PATH`; all four passes
recorded **0 security calls**, which is the evidence that nothing reached Keychain
Services.

## What these frames do NOT claim

- **The same-frame swap is the probe's reading, not the stills'.** A pair of stills
  shows the occupant before and after a hop; only the per-rAF sampler can say that
  no intermediate frame held the wrong pane. That is what `probe-hop-*.json` carries
  (`withAPane: 0 of 350` here, `350 of 350` on `main`), and each case's own per-rAF
  burst is in `run-*.json` (`s1`'s `hopAtoB` reads two distinct states: the pane with
  A, then clean with B).
- **No pending-asks AUTO-open frame.** The auto-open policy is a separate lane (#897,
  not on `main` when this was shot) and is pinned by the branch's own store tests.
  `s4`'s drawer is opened BY HAND, through the composer's chip; its claim is the
  borrow and the give-back.
- **No cross-conversation drawer restore.** The decision record notes that in the
  bound path a close restores from the destination's memory, which fixes the case
  where a drawer opened on A and closed on B put A's pane back. That path is not
  exercised here (a fleet-scope drawer is #897's); the record's note stands on the
  store tests rather than on a still.
- **The run panel's arrival is FRAME-GATED, and that is anticipated rather than a
  defect.** `s6-back-first-paint` shows an empty column even though B remembers the
  run panel, because the pane mounts on `runDetails`, derived from the canonical
  frontend frame: the flag is projected at the bind, the pane draws when its frame
  lands (t=240 ms flag, t=300 ms drawn in that run; the still itself is the HELD
  arrival — see "What the round-1 review added" below). The decision record
  anticipates it — "restored faithfully and drawn when its frame arrives" — and
  #868's drawable check is unchanged.
- **The run panel's plan is a STAGED INPUT.** `serve-slot.py`'s `todos` op seeds a
  phased plan through the runtime's own `restore_todos` + `refresh_frontend_state`,
  so the pane has a body to draw; the plan is the rig's, not a live run's. Disclosed
  here rather than dressed up as a turn.
- **The admitted conversation's reply is the INSTALLED RUNTIME's `mock` provider.**
  A New-chat draft is admitted by the rig's routes process (the daemon answers the
  create), so that conversation's turn is not this rig's stub. `s3` waits for the
  assistant row on DISK rather than for a sentence, so the frame is not coupled to
  one generation's mock copy.
- **No Electron window and no preload.** The renderer, the stores, the router, the
  transport validator and the `/__desktop` bridge are the shipping ones, and
  `desktopProxyPlugin` calls the same `requestDesktop` in
  `src/main/desktop-transport.ts` that Electron's IPC handler calls. The Electron
  IPC/preload channel and a packaged native window are NOT exercised. The dev
  driver's bridge (`window.__loDevDriver`) is supplied BY THE RIG — the same contract
  the preload publishes, with the app's own verb table registered through
  `install.ts` — because a page served to a browser has no preload; `capture()` and
  `facts()` are refused rather than faked, and the driver photographs over CDP.
- **Two flags are not in the verb.** The dev driver's `state()` carries the three
  durable flags plus `rightSlotKey`/`rightSlotMemory`; `consolePaneOpen` and
  `isAskDrawerOpen` are not in it (the records say so in `flagsAbsentFromVerb`), so
  the console and asks panes are read from the DOM instead — the pane hooks, the
  rail's `aria-pressed`, and the chip/drawer counts.
- **One palette per pass.** Both palettes are shot, but from two separate rig
  lifetimes, because two of the cases write to the backend; one case's dark and light
  stills therefore come from two clean backends rather than from one run.
