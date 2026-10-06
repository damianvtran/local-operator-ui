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
auto-close effect and its two conditions: an unresolved frame closes nothing, and a
mount the user's own door opened (the fleet trigger is offered at zero outstanding
asks) is not closed by it.

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
| `story-empty-wire/` | the frame the wire fix made: a live queued engine with nothing outstanding (`asks` absent, `asks_open: 0`) now draws the bar, the dismiss and the panel's empty sentence |
| `story-unread/` | an unresolved frame (`frontend === null`): the bar, the dismiss, and `Reading the asks…` — the state that must not close (the read has not answered) and must not trap |
| `story-unsupported/` | a runtime that publishes no queued asks at all: the same bar and dismiss, and the same line rather than a count it cannot substantiate |

The four `live-*` frames are 1380x900 (the window the rig drives). The six
`story-*` frames are 1280x800 in both brand palettes, the set's own convention.
The three story states exist as the shipped stories `Chat/Asks/Queued asks ->
Empty wire frame / Unread frame / Unsupported backend`, so each frame can be
opened by hand at the same URL the rigs used
(`<storybook>/iframe.html?id=chat-asks-queued-asks--unread-frame&args=theme:localOperatorLight`).

## Re-deriving the frames

Everything is in `harness/` — the rig, its Vite config, the owner-process shim and
both drivers — and it resolves the repository from its own location, so a clone can
re-take these frames. The live arm:

```
# 1. stand the rig up (routes daemon + one owner process per session + Vite)
ASKS_RIG_PORT=5314 RIG_SCRATCH="$(mktemp -d)" \
  bash docs/evidence/ask-drawer-stuck/harness/rig-up.sh      # prints the scratch root and the port
# 2. drive the reported path and photograph it
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

Both drivers launch ONE private headless Chrome through `scripts/chrome-keychain.mjs`
(so it never reaches Keychain Services under a scratch profile), drive it over raw
CDP, and reap it by exact pid. The rig never addresses the operator's own backend:
the owner processes get their own config root, their own bearer and OS-assigned
ports, and the provider stream is never called.

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
