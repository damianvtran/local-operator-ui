# An ended console must not look alive, and opening with nothing live must start one

Before/after frames and readings for the operator's report (2026-10-21): an
exited console still painted a prompt-shaped caret after the restored prompt, the
right rail's console item stayed lit with "0 live", and opening the console when
nothing was live landed on the dead history instead of a usable shell. The exit
status was also missing after the app itself closed the terminal.

The instrument is `scripts/console-ended-proof.mjs`, committed and re-runnable.
It boots the BUILT app in the documented `headless` window mode, drives a REAL
`lop serve` daemon it starts and owns (scratch HOME, config dir and profile, its
own port 47391), seeds a conversation through that daemon, and photographs the
app's own window with `Page.captureScreenshot`. No window is ever shown and no
`pixel` is produced by `screencapture`.

## What ran, against what

Two trees, one command each, the same rig bytes:

- **before** = `origin/main` at `a08d47b032` (the base commit), built fresh;
- **after** = this branch's tree with the fix, built fresh.

Both builds were made against the pairing address the run uses:

```sh
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:47391 pnpm build
node scripts/console-ended-proof.mjs --pair 47391 --out <dir> --keep
```

`readings.json` beside the frames is the run's own report: every cell names what
was read, and the frames below are full-window 2760x1800 PNGs (1380x900 at dpr 2)
taken while the state under test was on screen. The set is PNG-only, which is why
its manifest `frames` term is 0 — the evidence sweep counts WebP files.

## The frames, and what each one is evidence of

| before | after | the state | what the pair shows |
| --- | --- | --- | --- |
| `before-live-opened.png` | `after-live-opened.png` | a running console in the pane | Control for every pair below: both trees paint the same live terminal, a blinking accent cursor (`background: rgb(56, 201, 106)`, `color: rgb(43, 39, 33)`, `blink: true`), an editable textarea (`readOnly: false`), and the rail item lit (`aria-pressed="true"`) while 1 process is live. Nothing in the ended treatment leaks into the live state. |
| `before-ended-pane-open.png` | `after-ended-pane-open.png` | the process has exited, pane open and focused | Before: the terminal cell after the restored prompt still carries `.xterm-cursor` with the LIVE cursor paint (`background: rgb(56, 201, 106)`, `blink: true`) and the textarea is still editable (`readOnly: false`); the rail item is `aria-pressed="true"` at `0 live of 128 in the app`. After: the cursor cell is painted as the terminal ground (`background: rgb(29, 27, 25)`, same as `color`, `blink: false`), the textarea is `readOnly: true`, the marker band reads "End of history" / "This terminal is read-only. Select text to copy it.", and the rail item is `aria-pressed="false"` with an unchanged label (`Console (⌘J)`) — unlit. |
| `before-ended-key.png` | `after-ended-key.png` | one real key (`a`) delivered into the ended terminal through Chromium's input pipeline | Before: nothing anywhere says the key was refused; the terminal still holds the live cursor paint and an editable textarea. After: the pane's live region (`role=status`, `aria-live=polite`) carries "This terminal has ended, so that key was not sent. Open a new console to type again.", and the same sentence is visible in the marker band. The choice is stated in `console-pane.tsx`: a key on history is swallowed and announced rather than spawning a shell from a scroll or a copy reflex. |
| `before-rail-zero-live.png` | `after-rail-zero-live.png` | the rail with 0 live and the pane open on history | Before: the console item is the active one (`aria-pressed="true"`). After: no active treatment (`aria-pressed="false"`); the unseen dot is a separate mark, painted only for a completion nobody has looked at (see the last pair). |
| `before-reopen-nothing-live.png` | `after-reopen-nothing-live.png` | close the pane, then the user's open with nothing live | Before: the surface count and the running set are unchanged (`created: false`); the pane reopens on the ended recording. After: a new surface exists and is the one selected (`created: true`, one running), the active element is the terminal's textarea, the marker is gone and the caret is live — a shell ready to type in, with no empty state and no `+` in between. |
| — (the base never reaches it) | `after-one-live-one-ended.png` | one live surface and one ended, then the user's open | After: the surface count is unchanged (`[2, 2]`), the selected tab is the RUNNING surface (`con:2:…`, `readOnly: false`, the live accent cursor), and the ended sibling keeps its history as a clickable row. The open focuses the live terminal instead of creating a third. |
| — (the base cannot produce it) | `after-two-ended-open.png` | two ended surfaces, then the user's open | After: `surfacesBefore` is two, both `running: false`; `surfacesAfter` is three, the third running and selected. The base tree has no cell for this state because its open never creates, so a second ended surface cannot be made by the same sequence; the after reading is the claim. |
| — (not reached on the base) | `after-ended-row-looked-at.png` | a console that ended while the pane was closed, then its ended row clicked | After: while closed, the rail reads `Console (⌘J), 1 finished since you looked` with the dot present and `aria-pressed="false"`; clicking the ended row shows the history (marker present, `readOnly: true`) and the dot is gone. The mark is cleared by looking at the surface it names, and it never reads as a live count. |
| `before-relaunch-restored.png` | `after-relaunch-restored.png` | quit with a live surface, relaunch, select the restored surface | Before: the sidecar carries `exit_code: null` with no end reason, and the pane says "exit code not observed". After: the sidecar carries `exit_code: 1` (observed during quit) and the pane says "exit code 1". The restored surface is `live: false` in both and its history is the same bytes. |

The rail's unseen mark is a dot, not a number, in both trees; the defect was not
the mark's shape but that the item also carried the ACTIVE treatment while no
process existed, and that a completion arriving while the pane was being looked
at could leave a mark behind. `after-ended-row-looked-at.png` is the pair's
clearing half.

## Actual readings, quoted from `readings.json`

Ended, pane open, focused (the operator's frame):

```json
"before": { "caret": { "color": "rgb(43, 39, 33)", "background": "rgb(56, 201, 106)", "blink": true },
            "textareaReadOnly": false, "rail": { "pressed": "true" }, "marker": null }
"after":  { "caret": { "color": "rgb(29, 27, 25)", "background": "rgb(29, 27, 25)", "blink": false },
            "textareaReadOnly": true,  "rail": { "pressed": "false" },
            "marker": "End of history\nThis terminal is read-only. Select text to copy it." }
```

Open with nothing live:

```json
"before": { "created": false, "surfacesAfter": [{ "surface": "con:1:…", "running": false }] }
"after":  { "created": true,  "surfacesAfter": [{ "surface": "con:1:…", "running": false },
                                                 { "surface": "con:2:…", "running": true }] }
```

Quit-time exit status:

```json
"before": { "exit_code": null, "end_reason": null }
"after":  { "exit_code": 1,    "end_reason": null }
```

## What these frames do NOT prove

- They are one machine, one shell (`zsh`), one theme (`localOperatorDark`) and
  one grid (74–46 columns, derived from the pane's measured box). The palette
  claim is a role claim (`inkMuted` for history ink, ground for the cursor) and is
  asserted by `scripts/console-pane.test.mjs`; the other 58 palettes are not
  photographed here.
- The `app_quit` end reason is not exercised in a frame: this host's quit
  observed the exit (`exit_code: 1`) inside the bound, so the honest fallback is
  covered by `scripts/console-host.test.mjs` instead, with a pty that never
  reports an exit.
- The key in `*-ended-key.png` is a real Chromium key event into the focused
  textarea, but the frames do not make a screen reader speak: the live-region
  attribute and its text are read from the DOM, and the announcement itself is a
  browser behaviour no Electron frame can record.
- `document.hasFocus()` was supplied by CDP's focus emulation, which is how a
  never-shown window can produce the focused state a real user has. The window
  was never frontmost; the run's app process group was reaped by pid on exit.

## Re-running

```sh
# the daemon is started BY the rig; only the pairing address has to be built in
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:47391 pnpm build
node scripts/console-ended-proof.mjs --pair 47391 --out /tmp/console-ended --keep
```

`--keep` leaves the scratch tree (home, config, profile, logs) and prints its
path; without it the tree is removed. The run refuses port 1111, strips every
inherited `CMUX_*`/`LOP_*` variable, and kills its daemon and app process groups
before exiting. `readings.json` is written into `--out`.
