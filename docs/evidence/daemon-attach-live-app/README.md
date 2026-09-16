# The attach work, in the app the operator actually runs

Six frames of the BUILT app, driven by this PR's own rig
(`scripts/attach-frame-evidence.mjs`): `headless` window mode, its own
`--user-data-dir`, an isolated HOME and config dir, no window ever shown, and
the operator's focus never taken. Nothing here is a Storybook still, because the
states are MAIN's and the renderer's together - a capability answer, the daemon
status, the catalogue store - and a story can stub only one side of that.

**Re-shot at `3aac67e6e`, after the rebase onto main's #235 head.** Every frame
below was produced by this rig on the tree this PR now carries (`--scene all`,
headless, its own profile, no window shown, no notifications). The relative-time
text in the rows is what moved: measured against the frames committed before,
every other pixel band is unchanged - the rail is byte-identical (`y 60-180`,
`x 0-460`, same md5), and the differences sit at `x 600-1000 / y 1300-1612`,
which is the rows' own timestamps. That is also the answer to design round 2's
D14/D15, recorded in the section below.

## What each frame is

| frame | tree | state it photographs |
| --- | --- | --- |
| `after-attached.png` | this branch | the app attached to a real `lop serve` v0.55.6 with a seeded conversation (the `attached` scene) |
| `after-daemon-absent.png` | this branch | the same launch with nothing answering: the renderer's banner and main's `detached` snapshot, read from the same page. Re-shot on `c546a8ccf` (QA round 2, Q-7): the pane carries its own sentence at device y 828-853 and its `Retry` at 888-912, where the frame this file used to hold was a pre-pane-fix capture showing the pane empty. The rig writes this scene to `after-absent.png`; the frame is declared here under its committed name, so a re-shoot either renames it or is committed as this one |
| `after-gate-open.png` | this branch | the catalogue gate OPEN against the rig's stub backend: agents, teams and the seeded conversation all listed. It is also the flap scene's BEFORE frame - the same state is the starting point of both cells |
| `after-gate-withdrawn.png` | this branch | **the cell the operator reported**: the backend's answer stops opening the desktop plane while the app is running, and NOBODY touches anything. The rows are still there, at full ink, and the condition is stated once - by the full-bleed band - rather than by the sidebar as well |
| `after-flap-during.png` | this branch | the list holding through a probe-budget flap: every probe expires inside its 2 s budget while every read still answers |
| `after-flap-before.png` | this branch | the same scene before the flap: the list with the daemon's `degraded` marker already answered, so the Active section carries its own sentence instead of claiming an idle machine (design round 2, D11) |

## What is NOT in this directory, and why

- **No `before-attached.png`.** The committed pair used to contain one and it was
  byte-identical to its `after` (md5 `c717636c…`), so it could not be read as a
  before of anything (design round 1, D8). The before side of the attach cell is
  captured on the base tree by the manager-level rig
  (`scripts/attach-robustness-evidence.mjs`, cell 3 and cell 4 of the PR's own
  before/after table), which reproduces the base behaviour by command and
  output rather than by pixels. Re-running the live-app rig on a base worktree
  would need a second checkout with its own `node_modules`; that was not run in
  this round under the machine hold, and this note is the honest substitute.
- **The D14/D15 symptoms do not reproduce on the re-shot set.** Design round 2
  measured two of six frames painting the Active line in `ink-muted` where the
  head paints that `<p>` in `ink-dim` (D14), and frames predating the `\u2318N` cap
  on the New chat row (D15). Re-shot from this head, the frames are the ones the
  code paints: measured, the change against the previously committed files is the
  rows' relative-time text and nothing else - the rail region is byte-identical
  between old and new, and the caption row is unchanged. Either the two frames D14
  names were already current when it was measured, or what it saw is not in this
  set; the frames are now produced by the head under review either way, and the
  designer's re-read is the check that matters. Stated here rather than claimed as
  a fix this round did not have to make.
- **No separate "poked" frame.** The rig captures one - the operator coming back
  to the window, which is the only path the base tree has - and on this head it
  is byte-identical to `after-gate-withdrawn.png` (md5 `525f78e7…`), because the
  app has already re-negotiated on its own cadence by then. Two identical files
  are not a pair; the fact that they are identical is the result, and it is
  recorded here instead. The rig's own summary carries the mechanism: the
  capabilities ask count rises from 5 to 6 to 8 across the withdrawal with no
  input at all (`capabilities_asked_*` in `after-frames.json`).

## Reproducing them

```
node_modules/.bin/dotenv -e ../.env -- pnpm build
node scripts/attach-frame-evidence.mjs --out /tmp/frames --label after --scene withdrawn
node scripts/attach-frame-evidence.mjs --out /tmp/frames --label after --scene flap
```

The rig reaps what it starts: each scene owns its child's process group and
kills anything still holding its own scratch profile in a `finally`, so a
finished run leaves no `Electron.app` behind.
