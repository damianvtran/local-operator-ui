# Closing or dismissing a console surface, per tab (#754)

Frames, readings and a full transcript for the per-surface close path: the
`console-close-surface` channel in main, `closeSurface` in the preload, and the
row's own close control in the strip. The instrument is the repository's own rig,
`scripts/console-host-proof.mjs`, which is committed and re-runnable.

## What ran, and against what

A BUILT app in the documented `headless` window mode (never shown, never
frontmost — the run's own cell asserts the app was never the frontmost
application while it ran), driving the real `/rpc` wire over a scratch profile,
paired to a REAL `lop serve` daemon this run starts and owns: scratch home,
scratch config dir, its own port (47391) and its own desktop token. The pane
cells mount the seeded conversation through the app's own renderer and press its
own controls.

```sh
# the daemon the run pairs with (its own config root and port)
lop serve --host 127.0.0.1 --port 47391 --config-dir "$SCRATCH/config" &

# the app, built against the same tree, launched by the rig itself
node scripts/console-host-proof.mjs --pair 47391 --keep \
  --out "$PWD/docs/evidence/console-surface-close"
```

`proof.md` is that run's own transcript, printed by the rig: 82 checks — every
#754 cell passing — with the two cells named under "Known red on this host"
below.

## The frames, and what each one is evidence of

All eight `close-*.png` are the app's own window (CDP `Page.captureScreenshot` of
the built app), full-window at 2760x1800 (1380x900 at dpr 2), captured by the
rig while the state under test is on screen. The first five carried round 1's
review; the reveal's two arms and the empty state are round 1's remediation,
and every frame after the hover cells holds a strip nobody is pointing at (the
rig parks the pointer off the rows and asserts EVERY inactive control's resting
opacity). Round 1's remediation also carried a separate keyboard-handoff frame;
round 2 (design D6 / QA Q-1) measured it as the same state twice — its ring
never painted — and it is gone: the close is now driven by real Enter keys, so
the landing's ring is on naturally and the assertion below carries it, with
`close-closed.png` showing it.

| frame | the state | what it shows |
| --- | --- | --- |
| `close-affordance.png` | the strip at rest, a running user surface selected | the row's close control, revealed on the active row and named for its terminal AND its tablist position (`Close zsh, tab 1 of 4` — UX round 1's U4); every inactive row's control waits at opacity 0 |
| `close-hover-reveal.png` | an inactive row's × under the pointer | the reveal's HOVER arm: the hidden control steps to opacity 1 under a real pointer move through Chromium's own input pipeline — this host DOES deliver `Input.dispatchMouseEvent` moves to the never-shown window (measured `hovered: true, opacity: "1"`), even though a press is not delivered |
| `close-focus-ring.png` | the same control, keyboard-focused | the reveal's FOCUS arm: `focus-within` reveals it and the 2px ring sits 3px beyond the 28px button, measured against the strip's overflow clip — ring top 73 / bottom 107 in a clip spanning 72–109: it fits by 1px and nothing is trimmed (`fits: true`) |
| `close-question.png` | the confirmation over the pane | "Close this terminal?" / "This ends the program running here and removes its tab." / "Its output is kept." — the last said only where the pending row's own `retain` says the history persists (UX round 1's U6) — buttons Cancel and **Close terminal**; the surface is still running while it stands |
| `close-closed.png` | after Confirm — a surface **killed while running** | the killed surface is gone from the strip; the selection has moved to a neighbour, not to a dead lens; and the ring on the surviving row is the KEYBOARD'S LANDING: the close (the row's control AND the dialog's confirm) was activated by real Enter key events through Chromium's own input pipeline, so the app's handoff write carries the keyboard heuristic — the landing cell asserts focus, `:focus-visible` and the ring's fit (outer box 72–108 in the strip's 72–109 clip: flush at the top, nothing trimmed) |
| `close-dismissed.png` | after the ended surface's **dismissal** | the ended surface is gone; nothing asked, because there was no process left to protect |
| `close-relaunch.png` | after an app relaunch | the surface closed while RUNNING is restored as an ended row (design 7.3), and the dismissed one did NOT come back (#754's own restart repro) |
| `close-empty.png` | after every restored row was dismissed from the strip | the last dismissal removes the strip and the pane falls to `ConsoleEmpty`; the keyboard lands on its own `New console` (UX round 1's U1, the empty arm) |

The remediation's live cells (UX rounds 1-2), with the readings `proof.md`
carries: the question WITHDRAWS when its surface exits under it — the run ends a
surface through the bridge while its question stands and reads the dialog gone,
the row still listed and ended, and the keyboard back on that row's own control;
the strip's accessible names are read live and asserted duplicate-free, each with
its tab position; the reveal's two arms are the two frames above; and the close
path runs as a KEYBOARD'S OWN — the row's control and the dialog's confirm are
activated by real Enter key events (a key reaches the never-shown window where a
press does not; Chromium fires the platform's own activation on the focused
button), which is what makes the landing's ring a genuine keyboard landing and
closes QA round 2's "Enter/Space activation is not simulated" gap for this path.
The refusal path (U3) is the render suite's, not the rig's — a refusal needs the
bridge to say no, which the scripted bridge in `console-pane-render.test.mjs`
can do and a real, healthy host cannot be asked for.

`console-con_1_*.png` are the pane's screenshot cells from the same run
(`console_screenshot`): the displayed capture cropped to the pane's rect, and
the offscreen reconstruction of the same record.

## Why a live run, and what only it could settle

The acceptance clauses are about process lifetime and persistence, which no unit
test can observe: that `console_close` with `kill: true` really ends the pty's
process group (`exited 1` observed in the app's own log; the status refuses by
name afterwards), that a retained surface's bytes stay on disk for the NEXT
launch (`restored N retained surface(s) from history`), and that a dismissal with
`retain: false` removes the registry row AND its history file. Each of those
facts is read from the app's own listing, the app's own log, and the run's own
scratch config — never from a mock.

The rig cells also drive the two acceptance clauses a screenshot cannot carry:
the control is a real `button` — its activation, like the dialog's confirm, is a
real Enter key event through Chromium's input pipeline (round 2: a key reaches
the never-shown window where a press does not, and the platform activates the
focused button itself; Space is the same platform behaviour and is not
dispatched separately) — and the close control is a SIBLING of the tab, so
pressing it leaves the other row's selection alone while the pane's own
`Close console` — pressed first, on the same surface — still closes the PANE and
leaves the surface running (design 6.4).

## Known red on this host (not this change)

Two cells fail on this machine in three consecutive runs, including runs where
no other agent's rig was up, and neither is on a path this change touches:

- `a large record is captured five times, none refused, all five the same frame
  (Q-13)`: five captures of one 4 MB-record surface come back as five different
  frames, all `rendered: "offscreen"`, none refused — the record is still being
  parsed while the captures race it. The cell's own history says the blank-frame
  defect was the refusal, which does not reproduce.
- `a 8 MiB flood with retention ON leaves main answering (§19.1 P3)`: the
  measured median round trip is ~1.05 s against a 100 ms ceiling, but the cell's
  BASELINE (taken before the flood, in the same run) is ~1.05 s too — every
  `/rpc` call cost about a second in that window, flood or not. The ceilings were
  calibrated at 5 ms / 158 ms on a quieter machine.

Both need a quiet host (or a rig-level fix of their own) to be read; they are
recorded here so a reader of this set knows the red cells were seen and named,
not skipped.
