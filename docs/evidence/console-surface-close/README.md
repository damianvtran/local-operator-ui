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

`proof.md` is that run's own transcript, printed by the rig: 71 checks, all of
the #754 cells passing, and the two cells named under "Known red on this host"
below.

## The frames, and what each one is evidence of

All five are the app's own window (CDP `Page.captureScreenshot` of the built
app), full-window at 2760x1800 (1380x900 at dpr 2), captured by the rig while
the state under test is on screen.

| frame | the state | what it shows |
| --- | --- | --- |
| `close-affordance.png` | the strip, a running user surface selected | the row's close control, revealed on the active row and named for its terminal (`Close zsh`); an inactive row's control waits at opacity 0 |
| `close-question.png` | the confirmation over the pane | "Close this terminal?" / "This ends the program running here and removes its tab.", Cancel and Close; the surface is still running while it stands |
| `close-closed.png` | after Confirm | the killed surface is gone from the strip; the selection has moved to a neighbour, not to a dead lens |
| `close-dismissed.png` | after the ended surface's dismissal | the ended surface is gone; nothing asked, because there was no process left to protect |
| `close-relaunch.png` | after an app relaunch | the surface closed while RUNNING is restored as an ended row (design 7.3), and the dismissed one did NOT come back (#754's own restart repro) |

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
the control is a real `button` (tab order; Enter/Space activation is the
platform's own behaviour), and the close control is a SIBLING of the tab, so
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
