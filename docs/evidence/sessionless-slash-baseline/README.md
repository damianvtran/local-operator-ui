# The sessionless slash rows — the base tree's half (`origin/main` @ `ff34fb8ecc`)

The same five gestures (`⌘N` new chat, then `/help`, `/theme`, `/login`,
`/logout`, `/resume` + Enter) on the base tree, captured by the same scene
bytes as the head half with `--slash-expect refused`: each gesture is answered
by the dispatcher's refusal sentence and no picker mounts. The head half is
`../sessionless-slash/`.

## The rig

    node scripts/renderer-driver.mjs --scene sessionless-slash \
      --slash-expect refused --theme localOperatorDark \
      --backend http://127.0.0.1:8080 \
      --backend-records <daemon config>/run/serve \
      --seed-onboarding-complete --out <dir>

in a detached worktree at `origin/main` `ff34fb8ecc` (the base this branch is
cut from), with the branch's own `scripts/renderer-driver.mjs` copied in so the
tree difference is the only difference — same daemon shape, same two launches,
same `cwebp -q 90` conversions of the runs' PNGs (2760x1800, 1380x900 at dpr 2
on Electron 44.3.0). `/theme` needs the same complete/close/submit press
sequence here as on the head tree (the inline list predates this change), and
the scene asserts it the same way.

The live half is deliberately not run here: it asserts the session-ful path,
which this half is not about, and the scene's own log says so ("live half
skipped").

## What each frame is

| State | Gesture | What it shows |
| --- | --- | --- |
| `help/` | `/help` + Enter | `/help needs an open conversation. Start one first.` |
| `theme/` | `/theme` + Enter (complete/close/submit) | `/theme needs an open conversation. Start one first.` |
| `login/` | `/login` + Enter | `/login needs an open conversation. Start one first.` |
| `logout/` | `/logout` + Enter | `/logout needs an open conversation. Start one first.` |
| `resume/` | `/resume` + Enter | `/resume needs an open conversation. Start one first.` |

No picker mounts in any frame, and the scene asserts that too (the refusal
check requires `picker === null`). The refusal notes accumulate in the
transcript as the gestures run — each frame shows the note of its own gesture
plus the earlier ones, which is what the pane really looks like after five
refusals. `before-dark-run.log` / `before-light-run.log` are the raw logs:
**27 PASS / 0 FAIL each** (`ALL CHECKS PASSED`).

## Isolation

Same shape as the head half: this pass owned its daemon (scratch config/home,
reaped by exact pid), its profile (driver scratch tree, `--use-mock-keychain`,
`--clean`), and its port.
