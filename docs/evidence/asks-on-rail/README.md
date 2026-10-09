# The Asks door moves onto the panel rail (#896)

The issue, in the operator's words: *"Move the Asks button onto the right-edge
panel rail with Run details, Browser, Console and Canvas; it opens the same side
slot but stayed in the header."* Since #872 / PR #885 the four panel triggers
live on the 44px rail at the window's trailing edge, while the Asks trigger kept
its place in the chat header beside the `…` menu - and because the drawer then
held the slot with no rail item to light, an open asks surface was the one pane
the rail could not name ("NO item is lit", `panel-rail.tsx`'s pre-#896 note).

This set is the before/after pair for the move, shot through the real renderer -
the real stores, the real router, the real rail, the real header, one Python
daemon holding two real `Session`s under a scratch config root - and it is also
the re-measurement the PR's "not covered" list promised: the door's home, the
rail's lit contract, and the `…` menu's panel rows, as numbers read off the page
rather than off the pixels.

**The claim, as the one reading every case carries.** The ask door is the same
element in both arms (`data-tour-tag="ask-pane-trigger"` - it is the drawer's
focus-return anchor and did not change), so what moved is its ANCESTOR:

| | door's home | rail's items | menu panel rows (of the menu's total) |
| --- | --- | --- | --- |
| `main` (before) | `header` | `run, browser, console, canvas` (4) | 4 (of 8) |
| this branch (after) | `rail` (second item) | `run, ask, browser, console, canvas` (5) | **5** (of 9) |

And the lit contract, which is the issue's own defect: with the asks drawer
holding the slot, `main` lights **0** rail items (`swap` and `ask-open` both read
`lit=[]`), while this branch lights **`ask`** (`lit=["ask"]`) and leaves the
borrowed pane unlit (`browser` `aria-pressed="false"` after the swap). Both
palettes read the same structure; every number below is in the four
`run-*.json` records beside this README.

## The two arms

| | AFTER | BEFORE |
| --- | --- | --- |
| renderer tree | this branch - the frames were shot at head **`f5dd12d41e9`** (the code commit; the evidence commit that follows adds only this set and the manifest entry) | `origin/main` @ **`bb095dca28c`** (the branch's merge-base; #916's 0.33.11 release line) |
| served from | this checkout | a throwaway worktree of `origin/main` (`SLOT_RIG_BEFORE_REPO`), with this checkout's `node_modules` symlinked in by absolute path |
| backend | the rig's daemon, TWO owner processes: A `Deploy checklist` (`aaaa11112222` - a live but ORDINARY empty queue: the serving layer installs its ask gate by default, so the door is offered on it and its settled paint is wire-faithful; round-1 Q3) and B `Review notes` (`bbbb11112222`, the same engine plus the seed the pending ask is raised on) | the same daemon, the same two owners |
| what differs | the asks trigger (header → rail, as `PanelRailItem` id `ask`), the rail's `PANEL_RAIL_ORDER` and lit contract (five items, `ask` lit while the drawer holds the slot), the `…` menu's asks row, `ASK_HEADER_ITEM_SELECTOR` → `ASK_RAIL_ITEM_SELECTOR` (naming only; the tag value is unchanged) | - |

`drive-asks.mjs` refuses to drive both arms in one invocation, and each arm is
shot on a rig stood up for it (`run-passes.sh` wipes and restarts the whole rig):
the `ask-open` case ENQUEUES a pending ask onto B's queue, and `fleet-draft`'s
drawer lists every session's outstanding asks - so a second arm (or a second
palette) driven over the same backend would photograph a queue the first pass
already wrote, and the two stills would differ by something that is not the tree
or the theme. **Four passes, four stand-ups.**

Frame-naming: `docs/evidence/asks-on-rail/<case>/<arm>/<palette>.webp` - 7 cases
× 2 arms × 2 palettes = **28 frames**. Both brand palettes for every case; the
frame's file name IS its palette, so the evidence guard judges each still against
the theme it claims. The zone is pinned (`scripts/evidence-tz.mjs`) and the rig's
Chrome argv routes through `scripts/chrome-keychain.mjs`, so a re-shoot on
another host stays byte-comparable and never reaches Keychain Services.

## The claim → frame → numbers table

Read every pair LEFT = before (`main`), RIGHT = after (this branch). Geometry is
CSS px at 1380×900 unless the case names a size. "lit" is the rail's own
`aria-pressed` reading (`[data-panel-rail-item]`), "door" is where the
`ask-pane-trigger` element sits, and "drawer" is `[data-lo-ask-surfaces]` with
its `data-ask-drawer` scope - all read off the page at the shutter by
`drive-asks.mjs`'s `doorSource` and the shared probe (`run-*.json`); none is
inferred from the pixels.

| case | frame | `main` (before) | this branch (after) |
| --- | --- | --- | --- |
| **rail-closed** | `rail-closed` | B with nothing up: **door in the `header`** (bubble trigger beside `…`), rail items `[run, browser, console, canvas]`, rail lit `[]`, no badge | **door in the `rail`**, second item: rail items `[run, ask, browser, console, canvas]`, lit `[]`, no badge |
| **pane-open** | `pane-open` | Browser pane holds the slot: `railLit=["browser"]`, drawer down, door in the `header` | identical lit reading (`["browser"]`), drawer down, **door in the `rail`** |
| **menu-open** | `menu-open` | the `…` menu's panel rows: `Run details`, `Open browser`, `Open console`, `Open canvas` - **4 rows** of 8 menu items | **five**: `Run details`, `Open asks`, `Open browser`, `Open console`, `Open canvas` - 5 of 9 |
| **menu-open-1024** | `menu-open-1024` | the same menu at 1024×900: 4 panel rows of 8 | 5 of 9 (the row count is a property of the menu, not the width) |
| **swap** | `swap` | browser open, then the ask door: drawer up (session scope, `[data-lo-ask-surfaces]`), **rail lit `[]`** - the drawer holds the slot and the rail names nothing | drawer up (session scope), **rail lit `["ask"]`**, `browser` unlit - the item that opened it says so |
| **ask-open** | `ask-open` | a pending ask raised during the view (badge `1` in the header), the door pressed: drawer up, **rail lit `[]`** | badge `1` on the rail item, door pressed: drawer up, **rail lit `["ask"]`** |
| **fleet-draft** | `fleet-draft` | New chat: the door reports `data-ask-scope="fleet"` (in the header), the fleet drawer opens (`data-ask-drawer="fleet"`), rail lit `[]`, rail items `[browser, canvas]` | door on the rail, scope `fleet`, fleet drawer opens, **rail lit `["ask"]`**, rail items `[ask, browser, canvas]` |

Two readings inside those cells are worth naming because they are the app's own
facts rather than the pixels':

- **The pitch of the drawer's press is checked, not assumed** (`ask-open`'s
  pacing). An ask that existed before a view began opens the drawer BY ITSELF,
  once (the open policy, `ask-open-policy.ts`), so the case raises its ask 6 s
  after B's view is up - outside the policy's 5 s arrival skew - and the reading
  taken immediately before the press (`arrived`) asserts `drawer.up === false`
  on both arms. A raise that landed inside the skew would make the door's press
  a toggle that CLOSES the drawer; the case fails loudly instead of
  photographing the wrong claim.
- **The before arm's door reports `aria-expanded`, the after arm's reports
  `aria-pressed`** - the two idioms the header control and the rail item
  respectively carry, recorded per frame (`door.ariaExpanded` /
  `door.ariaPressed` in `run-*.json`). The moved tag kept its value; the
  control's state attribute changed with its family.

## The commands

Everything is committed under `harness/` and resolves the repository from its own
location, so a clone can re-take these frames. ONE PASS PER INVOCATION - each
invocation starts its own daemon, owners, ONE Vite and ONE Chrome, and reaps them
all by exact pid in an `EXIT` trap before it returns; nothing is left resident:

```sh
# The BEFORE arm needs a checkout of origin/main. A throwaway worktree, NOT the
# working checkout, and this checkout's node_modules symlinked in by absolute path
# (the same lockfile, so nothing is installed):
REPO=~/local-operator-ui-worktrees/asks-rail-896
BEFORE="$LOCAL_OPERATOR_SCRATCHPAD/asks-before-896"
git -C "$REPO" worktree add --detach "$BEFORE" bb095dca28c
ln -s "$REPO/node_modules" "$BEFORE/node_modules"

D=docs/evidence/asks-on-rail
REC="$LOCAL_OPERATOR_SCRATCHPAD/asks-records"   # records land here; frames go to docs/evidence
FR="$LOCAL_OPERATOR_SCRATCHPAD/asks-frames"

# Four passes: AFTER x {dark, light}, BEFORE x {dark, light}. Ports 5341/5342 -
# distinct from the #894 rig's 5321/5322, which other lanes may hold.
SLOT_RIG_PORT=5341 SLOT_RIG_BEFORE_PORT=5342 bash $D/harness/run-passes.sh "$FR" "$REC" after localOperatorDark
SLOT_RIG_PORT=5341 SLOT_RIG_BEFORE_PORT=5342 bash $D/harness/run-passes.sh "$FR" "$REC" after localOperatorLight
SLOT_RIG_PORT=5341 SLOT_RIG_BEFORE_PORT=5342 SLOT_RIG_BEFORE_REPO="$BEFORE" \
  bash $D/harness/run-passes.sh "$FR" "$REC" before localOperatorDark
SLOT_RIG_PORT=5341 SLOT_RIG_BEFORE_PORT=5342 SLOT_RIG_BEFORE_REPO="$BEFORE" \
  bash $D/harness/run-passes.sh "$FR" "$REC" before localOperatorLight

for d in "$FR"/*/; do cp -R "${d%/}" $D/; done   # the case directories
cp "$FR"/run-*.json $D/ && cp "$REC"/security-calls-*.log $D/

# And the worktree goes away when the frames are in hand:
git -C "$REPO" worktree remove --force "$BEFORE"
```

A single pass can also be driven by hand, rig first - `rig-up.sh` prints its
scratch root, and `rig-down.sh` (by exact pid, reaping each pid's tree) is not
optional:

```sh
SLOT_RIG_SCRATCH="$(mktemp -d)" bash $D/harness/rig-up.sh            # after arm only
node $D/harness/drive-asks.mjs --after http://localhost:5341 \
  --scratch "$SLOT_RIG_SCRATCH" --out "$FR" --theme localOperatorDark
SLOT_RIG_SCRATCH="$SLOT_RIG_SCRATCH" bash $D/harness/rig-down.sh
```

`SLOT_RIG_BEFORE_REPO` names the before checkout; `SLOT_RIG_NO_AFTER=1` /
`SLOT_RIG_NO_BEFORE=1` start only one of the two dev servers (a pass drives one
arm, and two dev servers plus a daemon, two owners and a browser is what this
machine's per-command memory ceiling kills - measured, at 3.5 GB).

## What the rig is, and what it deliberately is not

`harness/asks-rig.vite.mjs` serves the SHIPPED renderer (`src/renderer`'s own
`index.html`/`main.tsx` and CSP) with `desktopProxyPlugin` over `/__desktop`, and
a shim for the preload globals the app reads before it can render.
`harness/serve-asks.py` is the two-mode daemon this lane already uses (the real
`local_operator.server.app` for the routes, one owner process per conversation
holding a real `Session` + `AskQueue`), with a command channel the driver uses to
raise the pending ask. The provider is a stub that answers one short text turn
and never calls a tool; the operator's own backend on `127.0.0.1:1111` is never
addressed (the rig has its own config root, its own 32-byte bearer and
OS-assigned ports). Every Python child runs under a scratch `HOME` with a fenced
`security` on its `PATH`; all four passes recorded **0 security calls** - the
four `security-calls-*.log` files committed beside this README are empty, which
is the evidence that nothing reached Keychain Services.

`harness/drive-asks.mjs` drives the seven cases over raw CDP on ONE private
headless Chrome launched through the repository's own
`scripts/chrome-keychain.mjs`, one browser context per case (the drawer's flag
and the panes' flags ride the store's persisted blob, so a shared profile would
hand a case the state before it). `drive-asks.mjs`'s `doorSource` reads the
door's ancestor, its scope attribute and its badge; `menuSource` reads the `…`
menu's items and filters the panel rows out of the full list. `harness/rig-lib.mjs`
carries the shared probe (`drawn`, `railLit`, the boxes, the asks chrome) and its
rail table has the five items - the asks entry reads `null` on the before arm,
which is the honest answer for an item that is ABSENT there rather than "not
pressed".

## What these frames do NOT claim

- **No hover or tooltip pixels.** The moved item's tooltip was not photographed,
  and the tooltip's overlap arithmetic at this geometry (#885's D11, re-derived
  per item by this branch's comment) is not re-measured here. The case that
  would carry it is a pointer-hover state, which this set does not drive.
- **No Windows/Linux caption geometry.** `--chrome-inset-end-h`'s top clearance
  under OS caption buttons is a Windows/Linux layout; this host is macOS, and
  the rail's simulation set (#885) is where that shape lives.
- **The browser pane draws its WEB fallback** ("The browser is only available in
  the desktop app.") - its designed first-run surface needs the Electron host,
  as #894's set also disclosed.
- **`swap`'s drawer comes up over a live-but-EMPTY session queue** (the still
  shows its settled sentence), because `swap` runs BEFORE the raise so the
  policy has nothing to open and the frame's drawer is the press's effect alone.
  The pending-ask still is `ask-open`, and the two cases share nothing else.
  `fleet-draft`'s drawer lists B's ask raised earlier in the same pass - a real
  ask the rig's command channel staged, disclosed there rather than dressed up
  as a fresh arrival.
- **The composer carries its focus ring in stills where no press moved focus**
  (`rail-closed`): the app focuses the composer when a conversation opens, and
  the reading is in the record (`probe.active` names the focused element per
  still). A later press (the door, a rail item) moves focus, which is why some
  stills show the ring and others do not.
- **No Electron window and no preload.** The renderer, the stores, the router,
  the transport validator and the `/__desktop` bridge are the shipping ones, and
  `desktopProxyPlugin` calls the same `requestDesktop` in
  `src/main/desktop-transport.ts` that Electron's IPC handler calls. The Electron
  IPC/preload channel and a packaged native window are NOT exercised. The dev
  driver's bridge (`window.__loDevDriver`) is supplied BY THE RIG - the same
  contract the preload publishes, with the app's own verb table registered
  through `install.ts` - because a page served to a browser has no preload.
- **One palette per pass.** Both palettes are shot, but from two separate rig
  lifetimes, because the ask cases write to the backend (see above).

## The security-calls result, and the records

The four runs' `security-calls-*.log` files are committed (empty); `rig-down.sh`
printed `security calls under the scratch HOME: 0` for each pass, and each
`rig-down-*.log` names the four pids it stopped. The eight record files beside
this README are the driver's own output:

- `run-{after,before}-{localOperatorDark,localOperatorLight}.json` - one per
  pass: every case's frames, its `probe`/`door`/`memory` readings (including the
  pre-press readings `before`/`arrived` that assert the pacing), the menu's
  items, and the enqueued ask's id for `ask-open`.

## Round-1 remediation, and why these frames still stand (commit `2aa64f1ab47e`)

PR #917's round-1 agent-review, QA and design passes were answered by one
remediation commit, `2aa64f1ab47e`, and this note - plus the cast correction to
the backend row above, which belongs to the same round. What that commit moves
against the frames: the rail's focus-return effect now stands down for the asks
pane (`before === "ask"`; F1/Q2 - focus after a chip-opened close returns to the
chip again), the `…` menu's asks row now opens the drawer as a user press (the
scope-carrying `askOpenIntent` request, plus the drawer's bounded claim answering
the menu's own focus teardown; Q1 - the empty state is reachable from that door
and the keyboard lands in the pane), and one copy string changes (the carried
cross-scope tooltip verb reads `Open asks` where its press re-scopes; N1).

NONE OF THE SEVEN PHOTOGRAPHED STATES CHANGES: the frames still render
`f5dd12d41e9`'s surfaces, and the set's `capturedAtHead` stays
`f5dd12d41e950c6a9a436f687528d84ee3a16fce`. The commit edits focus plumbing, the
request signal and comments - no pixel of the captured set moves - so the
round-2 passes verify these same frames on the new head.
