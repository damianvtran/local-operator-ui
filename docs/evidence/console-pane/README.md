# The console pane, and the capture view it is reconstructed by

Frames for `feat/console-pane` (PR B of `docs/design/ui-console-tab.md`, whose §6
is the pane, §7 retention as the user meets it, §9 the colour model, §12
completion and the blip, §13.2/§13.3 the capture view, §19.2 this set).

**The Storybook frames** (`console-pane/<story>/<theme>.webp`) are captured through
the repo's own `scripts/capture-evidence.mjs`, one frame per story per theme in the
sweep's twelve-theme list. They are the pane at its own default width — **843 px**,
which is the design's 100-column grid at the shipped face's measured advance
(8.425 px per column at `fontSize: 14`) plus the pane's chrome — so a frame of this
pane is a frame of the grid the design names.

What they are: the real component, reading a **stubbed projection** of the same
shape main publishes (the pane's only input is that projection, so a story that
does not answer the bridge can only photograph the unavailable state — see the
stories file's own note). What they are NOT: proof that a program runs. No frame
here has ever spawned a shell; that is the live set below.

| story | the state it shows |
|---|---|
| `populated` | one running surface, at 100×30: the header, the list, and a grid painted with the sixteen ANSI colours, a box-drawing frame, CJK (double-width), bold/dim/underline/reverse, and a 24-bit line |
| `two-surfaces` | the lens with two rows, one opened by an agent (the provenance marker of §6.5) |
| `empty` | no surface in this conversation, and the `+` control that creates the first one |
| `draft-conversation` | a draft: a console runs in a conversation's directory, so there is nowhere to put one yet |
| `loading` | before the first read answers |
| `unavailable` | the console off, or its native module absent: §15's copy, including the machine line a bug report would quote |
| `ended` | a process that exited, over its recorded history, with the code it was observed to carry |
| `restored` | a surface restored after a relaunch: nothing is running and nothing will be |
| `secure` | secure input on: the surface still paints, nothing is recorded |
| `blip-pulsing` | a completion nobody has looked at, with its mark still fresh: `accent`, pulsing |
| `blip-resting` | the same mark after its pulse: the dot rests in `ink-muted` (§12.2's two states, and the difference is the clock rather than two hand-picked colours) |
| `other-conversation-mark` | **a negative claim**: another conversation's mark does NOT appear on this pane's rows, which is what the header's dot depends on too |

**The live set** (`console-pane-live/`) is `scripts/console-host-proof.mjs`, run
against the BUILT app headless, and it is the other half of the evidence:

- `proof-transcript.md` — the full run: a real pty forked through the app's own main
  process, the real `/rpc` driven with real requests, and every cell's actual output.
  It includes the app's own log line for the capture:
  `[console] captured surface … offscreen at 94x25 (dom renderer, 39182 B, attempt 1)`,
  and `the run never held the operator's frontmost application` — 0/N.
- `displayed-capture.png` — `console_screenshot` with the pane displaying the
  surface: `rendered: "displayed"`, a photograph of the app's own window cropped to
  the pane's rect.
- `offscreen-capture.png` — the same call with the pane closed: `rendered:
  "offscreen"`, `renderer: "dom"`, non-blank (37,491 B against the design's measured
  9,866 B stale frame), one attempt. It is a real terminal frame — the rig's own
  `printf 'marker-424242\n'` and `stty size` → `30 100` — reconstructed from the
  record by the capture view.

  REFRESHED, NOT RE-CAPTURED IN KIND: these three files were re-run after a runtime
  swap replaced the `lop` install mid-turn and killed the processes of the earlier
  run. The refreshed run is 31 PASS / 0 FAIL with the same cells, and its frame is
  37,491 B where the first was 39,182 B — the difference is the pty's own output
  (the rig's shell echoes a variable number of lines before the `printf`), not the
  capture path, and a byte-identical frame across runs is not a property this path
  claims. The log line it quotes is
  `[console] captured surface … offscreen at 94x25 (dom renderer, 37491 B, attempt 1)`.

## Gaps this set does not cover

1. **The pane driven in the live app, on a conversation.** The pane lives in the
   chat route, which needs a backend session; this machine's rigs run offline, so
   the pane's frames are Storybook's and the live frames are the capture view's.
   Walking "run a command with the pane closed, reopen, the output is there" is a
   QA-round cell, not a rig this set carries.
2. **The blip and the notification click.** The mark's two states are photographed
   (above); the native banner and its click landing on the right session and surface
   are a live-app walk (the click is a renderer path with no window beside it in a
   headless run).
3. **The twelve-theme frames are captured with `--allow-backend`**, which the rig
   permits for a narrowed run only and which this set needs because `lop`'s own
   daemon answers on `127.0.0.1:1111` on this machine. The stories in this set stub
   the console bridge and call no backend, so no frame here shows a server's replies;
   the flag is disclosed rather than assumed away.
4. **Truecolor.** The contract measures the role palette; a program's own
   `\x1b[38;2;…m` passes through untouched, and the frames show it is not mangled —
   which is all a role table can claim.
