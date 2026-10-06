# The asks drawer, stuck open over a conversation with no asks

The operator's report: *"If you have the asks canvas open and switch to a chat
that doesn't have any asks, the canvas empties out and gets 'stuck' and you have no
way to close it."* The drawer's chrome rendered nothing on that frame — no bar, no
dismiss, no chip, no header trigger — while its slot kept holding the right side of
the window, and it stayed that way until an Escape pressed with the composer box
under focus (which the switch itself takes away).

## The defect, as a number

`live-before-switch-void/` is the reported path: the drawer is opened on a
conversation with a pending queued ask, and the app is switched to one with none.
Read off the page at the shutter (`harness/drive-asks.mjs`'s `PROBE`, recorded in
`live-run-before.json`):

```
slotPresent: true
slotBox: { x: 820, y: 0, w: 560, h: 900 }   // the pane slot, still claimed
slotText: ""                                // ...and empty
drawers: 0   closeAsks: 0   askSurfaces: 0  // no chrome, no dismiss, no surface
```

Six seconds of sampling (`report.timeline`) read the same at every step, and the
two Escape arms read it too. The slot is claimed by the MOUNT, not by anything the
drawer draws, which is why a component that renders `null` does not release it.

## The fix, on the same path

`live-after-switch/` is that path on the fixed tree, driven by the same harness
(`live-run-after.json`):

```
slotPresent: false   slotBox: null
drawers: 0   closeAsks: 0   askSurfaces: 0
```

Nothing is left holding the slot, so there is nothing to close. The drawer also
closes itself on the mount that used to strand it — see `src/renderer/src/features/chat/components/asks/ask-drawer.tsx`'s
auto-close effect and its three conditions: an unresolved frame closes nothing, a mount
the user's own door opened (the fleet trigger is offered at zero outstanding asks) is
not closed by it, and a rowless frame that still carries a live tally is not "nothing
to show" either (remediation round 1, R1 — closing over it would release the slot and
leave those asks unreachable, which is this defect with the sign flipped).

The after record carries a second delta of the remediation round, and it is the
capability read rather than the slot: conversation B is a **live-but-empty** queue
(`asks` absent, `asks_open: 0`), and it now offers its own asks door
(`headerTrigger: 1`; the before record reads `0`), because the wire contract's
capability is the presence of `asks` OR `asks_open` (remediation round 1, R3/Q1).

## The frames

Two sources, and the split is stated rather than implied: the live rig photographs
the reported path in the running app; a scratch Storybook run photographs the
states no switch reaches on demand.

| directory | what it is |
| --- | --- |
| `live-populated/` | the conversation WITH a pending ask: the composer's asks chip, before the drawer is opened |
| `live-drawer-open/` | the drawer opened from that chip — the 40px bar, the scope line, and the `Close asks` dismiss |
| `live-before-switch-void/` | **the defect**: after the switch, the same window with a 560x900 empty slot and no chrome at all |
| `live-after-switch/` | **the fix**: the same switch, with no slot |
| `live-after-new-chat-draft/` | the round-1 draft route (remediation round 1, UX U1): the session drawer opened on a conversation, then the sidebar's `New chat` row pressed — the draft paints no asks pane at all (`drawers: 0`, `slotPresent: false`), because the session mount is the conversation's own and a draft has no conversation |
| `story-empty-wire/` | the frame the wire fix made: a live queued engine with nothing outstanding (`asks` absent, `asks_open: 0`) now draws the bar, the dismiss and the panel's empty sentence |
| `story-unread/` | an unresolved frame (`frontend === null`): the bar, the dismiss, and `Reading the asks…` — the state that must not close (the read has not answered) and must not trap. The bar carries NO clause here: the body names that fact once (design round 1, D5) |
| `story-unsupported/` | a runtime that publishes no queued asks at all: its own state (`This conversation · Asks unavailable` / `This runtime doesn't publish queued asks.`) rather than the in-flight copy, which for this frame is a claim that can never complete (design round 1, D1) |
| `story-clipped-rows/` | the wire bound's own frame (remediation round 1, R1): a live tally with the row list dropped (`{asks: null, asks_open: 4, asks_truncated: true}`) draws `4 outstanding` in the bar and states in the body which half of the frame it has — and does NOT auto-close over four answerable asks |

The four `live-*` frames are 1380x900 (the window the rig drives). The eight
`story-*` frames are 1280x800 in both brand palettes, the set's own convention.
The four story states exist as the shipped stories `Chat/Asks/Queued asks ->
Empty wire frame / Unread frame / Unsupported backend / Clipped rows frame`, so each
frame can be opened by hand at the same URL the rigs used
(`<storybook>/iframe.html?id=chat-asks-queued-asks--unread-frame&args=theme:localOperatorLight`).

## Re-deriving the frames

Everything is in `harness/` — the rig, its Vite config, the owner-process shim and
both drivers — and it resolves the repository from its own location, so a clone can
re-take these frames. The live arm:

```
# 1. stand the rig up (routes daemon + one owner process per session + Vite)
ASKS_RIG_PORT=5314 RIG_SCRATCH="$(mktemp -d)" \
  bash docs/evidence/ask-drawer-stuck/harness/rig-up.sh      # prints the scratch root and the port
# 2. drive the reported path and photograph it (steps 1-6 are the reported path and
#    its two Escape arms; step 7 presses the sidebar's New chat row with the drawer
#    open on A, which is the draft route `live-after-new-chat-draft/` photographs)
node docs/evidence/ask-drawer-stuck/harness/drive-asks.mjs http://localhost:5314 <out-dir>
# 3. stop it BY EXACT PID (never by name)
RIG_SCRATCH=<the printed scratch root> \
  bash docs/evidence/ask-drawer-stuck/harness/rig-down.sh
```

The story arm needs a Storybook and the repository's own headless-Chrome switch:

```
node_modules/.bin/storybook dev -p 5313 --no-open --ci --quiet &
node docs/evidence/ask-drawer-stuck/harness/shoot-stories.mjs http://localhost:5313 <out-dir>
```

And the bound on the close, off the same rig (see the section below):

```
node docs/evidence/ask-drawer-stuck/harness/probe-switch-flash.mjs http://localhost:5314
```

Both drivers launch ONE private headless Chrome through `scripts/chrome-keychain.mjs`
(so it never reaches Keychain Services under a scratch profile), drive it over raw
CDP, and reap it by exact pid. The rig never addresses the operator's own backend:
the owner processes get their own config root, their own bearer and OS-assigned
ports, and the provider stream is never called. `rig-down.sh` is not optional in the
recipe: the rig's Vite holds the port with `--strictPort`, so a run that leaves it up
makes the next `rig-up.sh` report the port as taken instead of standing a fresh one.

## The bound on the auto-close, measured frame by frame

The close CANNOT be instantaneous, and the number matters because the obvious way to
read a stuck drawer is to assume any chrome over the wrong conversation is the bug
returning. `harness/probe-switch-flash.mjs` samples on EVERY animation frame from the
switch until 1.5 s have passed and records, per frame, whether the ask surface and
its slot are present, what the bar says, and the composer's own rect (the run's own
record is `switch-close-bound.json`, beside this README):

```
framesSampled                         92
framesOnNewConversationWithSurface     6    // painted frames on the new conversation that still carry the drawer
first marks on the new conversation:
  t=50 ms   surface=True  rows=0  scope='This conversation'  composer={x:284,w:432}
  t=62 ms   surface=True  rows=0  scope='This conversation'  composer={x:284,w:432}
  t=66 ms   surface=True  rows=0  scope='This conversation'  composer={x:284,w:432}
  t=79 ms   surface=True  rows=0  scope='This conversation'  composer={x:284,w:432}
  t=98 ms   surface=True  rows=0  scope='This conversation'  composer={x:284,w:448}
  t=117 ms  surface=True  rows=0  scope='This conversation'  composer={x:284,w:474}
  t=145 ms  surface=False ...     // closed, composer={x:415,w:810}
```

**THIS IS A READING, NOT A CONSTANT** (design/QA round 1, Q4). The close waits for the
read to answer, so the count is a function of the machine and the load it ran on: 4
frames at fleet load ~30 and 6-8 at load ~58, all gone inside ~200 ms. What does NOT
vary is the state of those frames - every one is the **unread** state (the bar carries
no clause, the body reads `Reading the asks…`), never a populated or empty verdict
about the conversation being entered.

The marks also carry the reflow the window costs (design round 1, D3), which presence
alone could not say: while the slot claims the column the composer is painted at
`{x:284, w:432}` and settles at `{x:415, w:810}` - 378px narrower and 131px further
left, for the length of the read.

THAT WINDOW IS NOT CLOSED ON, DELIBERATELY, and the sampler is what told us a layout
effect could not close it: the wait is for the READ, not for the paint. When the
drawer mounts over the new conversation, that conversation's frame has not landed yet
(`frontend === null`), and an unresolved frame must close nothing - because a switch
to a conversation that DOES have asks looks identical for exactly that interval, and
there the surface has to stay up and show them. Closing on the unread state would fix
the flash by breaking the case the drawer exists for. It was tried the other way as
well: as a `useLayoutEffect` the close does land before paint, and the measurement
showed the same window (the bound is the read), while the change introduced a real
hazard - a layout close declared above the entry effect reads the door latch before
that effect sets it, so it shuts the surface the user had just pressed a door to open.
The passive effect, in its original place, is what ships.

## What these frames do NOT claim

- **No fleet-scope frame.** The fleet trigger is the door this fix's guard is
  about, but opening it over an empty fleet needs every conversation empty, which
  this rig's session A is not (it is the session the ask lives on). The guard
  itself is exercised in `scripts/ask-draft-swap.test.mjs`, which mounts the drawer
  with focus on the header door.
- **No Electron window.** The renderer, the components, the answer path and the
  `/__desktop` bridge are the shipping ones; the Electron IPC/preload channel and a
  packaged native window are not exercised here.
- **No pre-fix re-shoot from the fixed harness.** The before frames came from the
  session that reproduced the bug on the unfixed tree; they are committed because
  the pair is the claim, not because the harness can produce them.
- **The `clipped-rows` and `unsupported` states are STORY frames, not live walks.**
  The rig's owners always publish a queue (B is live-but-empty), so neither a runtime
  with no engine at all nor a frame whose rows the wire bound dropped is reachable in
  it. Their claims are asserted in `scripts/ask-queue.test.mjs` (the read model) and
  `scripts/ask-draft-swap.test.mjs` (the render), and photographed from the shipped
  stories.
- **The draft frame carries one press, with one retry.** Step 7 presses the composer
  chip to open the drawer on A; a press that misses its target is a rig flake rather
  than a finding, so the step retries once and records the chip's own `aria-expanded`
  either way. Nothing about the draft's own fleet door is claimed beyond the probe's
  `headerTrigger` count.
- **No frame narrower than the app's own minimum window.** The drawer's dismiss falls
  off a 560px viewport (UX round 1, U4), which is below `WINDOW_MIN_WIDTH = 800` and
  therefore outside the shipping envelope; the number is recorded so it is not
  rediscovered as a bug.
