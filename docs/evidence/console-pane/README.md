# The console pane, and the capture view it is reconstructed by

Frames for `feat/console-pane` (PR B of `docs/design/ui-console-tab.md`, whose §6
is the pane, §7 retention as the user meets it, §9 the colour model, §12
completion and the blip, §13.2/§13.3 the capture view, §19.2 this set).

**The Storybook frames** (`console-pane/<story>/<theme>.webp`) are captured through
the repo's own `scripts/capture-evidence.mjs`, one frame per story per theme in the
sweep's twelve-theme list. They are the pane at its own default width — **796 px**,
which is the design's 100-column grid at the shipped face's advance (`measureCell`,
0.6 em at `TERMINAL_FONT_SIZE = 13`, i.e. 7.8 px per column) plus the pane's two 8 px
gutters — so a frame of this pane is a frame of the grid the design names. The number
is not typed by hand: the story renders at `DEFAULT_CONSOLE_PANEL_WIDTH` and the
sweep's `CONSOLE_PANE_WIDTH` restatement of it is pinned to the store's own formula
by `scripts/console-pane.test.mjs`. (An earlier revision of this README and of the
PR body said "843 px at `fontSize: 14`", which was neither the shipped default nor
the design's grid — the design round measured those frames at ~108 columns. Both are
corrected here.)

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
  The two capture cells are in it verbatim (`capture geometry`, `offscreen capture`),
  as is `the run never held the operator's frontmost application` — 0/N.
- `displayed-capture.png` — `console_screenshot` with the pane DISPLAYING the
  surface, and the pane is mounted for it: the rig opens the conversation through the
  app's own launch intent, presses the console trigger, and never calls
  `setContentRect` itself, so the rect main crops to is the one the PANE reported.
  `rendered: "displayed"`, 82×45, `theme: "localOperatorDark"`, **47,139 B** at
  **1286×1404**. The arithmetic, because design round 4's D20 caught it printed wrong
  here: the pane's own frame is 659×779.5 CSS, and the CROP is the terminal's box inside
  it — 643×702.5, which is the panel's reported `contentRect` and therefore what the frame
  is of. At the window's device pixel ratio of 2 that is 1286×1405, and the file is
  1286×1404 because the crop floors to whole pixels. What the frame shows is the pane's
  terminal, not a window corner: an earlier revision of this cell photographed the
  window's top-left quadrant and certified it as the pane (design round 3's D17 / QA's Q-5).
- `proof-transcript-unpaired.md` — THE SAME RIG ON A MACHINE THE APP IS NOT PAIRED WITH,
  and it is here because that is a state a reader will meet: QA round 4's Q-10 was exactly
  this run reported as a pass. The pane cells need a conversation the app can READ, which
  needs the pairing; with none, the rig says so —
  `Result: 42 of 42 check(s) passed, 1 BLOCKED`, the blocked cell naming the precondition,
  the other forty-two cells all run, and the process exits **non-zero** so a partial run
  cannot be read as a pass. Nothing is hidden and nothing is guessed: the transcript carries
  the app's own sentence (`This conversation cannot be read here: the app is not paired with
  the running server`) and the four cells that did not run.
- `offscreen-capture.png` — the same call with the pane closed, from that unpaired run: it
  needs no pane and no backend, which is the point of the reconstruction.
  `rendered: "offscreen"`, `renderer: "dom"`, **44,713 B** at **1560×936**, `attempts: 1`.
  The size differs from the paired run's 47,138 B for a reason worth stating rather than
  rounding over: with no pane mounted nothing reports a content rect, so the window is sized
  to the SURFACE's own grid (100×30) rather than to the pane's box. It is a real terminal
  frame — the rig's own
  `printf 'marker-424242\n'` and `stty size` → `30 100` — reconstructed from the
  record by the capture view.

  REFRESHED, NOT RE-CAPTURED IN KIND: these three files were re-run after a runtime
  swap replaced the `lop` install mid-turn and killed the processes of the earlier
  run. The refreshed run is **42 PASS / 0 FAIL**. Byte-identical frames across runs
  are not a property this path claims: the rig's shell echoes a variable number of
  lines before the `printf`, so the byte count moves with the pty's own output.

  ONE FURTHER DISCLOSURE, because it is a limit of the harness rather than of the
  pane: in this never-shown window the compositor's own press does NOT reach the
  page (`how the pane was opened` records `pressTook: false`, with the pointer
  verifiably over the button and the box settled), so the rig opens the pane with the
  element's own `click()`. A REAL press opening the pane is UX round 3's own cell,
  walked in an environment where presses land; what this set adds is that the pane,
  once open, is the thing photographed.

## Gaps this set does not cover

1. **The pane driven in the live app, on a conversation** — now covered for the
   CAPTURE path and still a QA-round cell for the interaction: the rig mounts the pane
   on a conversation (the app's own launch intent, the trigger pressed) and the
   displayed frame is a photograph of it, but walking "run a command with the pane
   closed, reopen, the output is there" needs a person or a QA walk rather than this
   rig, which drives the record through the wire.
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
