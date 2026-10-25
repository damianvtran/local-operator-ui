# The dictation failure, before and after the retry (PR #1365, issue #1087)

Rendered stills for the dictation change in PR #1365: a transient upstream
fault during transcription no longer destroys the recorded take, the failure
sentence carries a `Retry` control that re-arms the same send path, and both
surfaces that dictate - the chat composer and the canvas inline editor - keep
their input editable while the offer stands.

## What these frames are

Captured by the app's own `capturePage()` against a local stub that answers the
transcription endpoint with `502 Bad Gateway` and an
`Upstream responded 500: {...}` body - the relayed shape described in issue
#1087, and the exact shape this change is about.

| Frame | What it shows |
| --- | --- |
| `before-dictation-failed.png` | `main` before the change: the clipped-JSON failure toast, and no way back to the recording. |
| `after-dictation-failed.png` | The transient sentence with the `Retry` control, in the composer row below the still-editable input. The toast is withheld for this class, so the composer's mic and send are not covered. |
| `after-dictation-recovered.png` | After the control is used: the kept take is sent, the transcript lands in the box, the row is withdrawn. |
| `after-dictation-failed-canvas.png` | The canvas inline editor: a prompt typed before dictating ("sharpen this paragraph") is still in the textarea and the field is still editable, with the failure row below it. This is the state F1 was about - the row used to replace the textarea. |
| `after-dictation-recovered-canvas.png` | After the canvas row's `Retry`: the transcript is appended to the typed prompt, the row is gone. |

The two `before`/`after` composer frames are a pair captured from different
trees (see below). The canvas frames have no `before` counterpart: before this
change the canvas had no retained-take state at all, so the state they show did
not exist.

## How they were captured

Two runs, one per surface, each with its own stub instance so the attempt count
starts at zero:

```
# composer
STUB_PORT=8988 STUB_LOG=/tmp/frames-1087-final/composer-stub.log STUB_FAILS=3 \
  node /tmp/rig/stub-1087.mjs &
DISPLAY=:99 LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat /tmp/rig/token)" \
  node /tmp/rig/dictation-rig.mjs --mode after --surface composer \
  --stub http://127.0.0.1:8988 --out /tmp/frames-1087-final/after \
  --stub-log /tmp/frames-1087-final/composer-stub.log

# canvas (fresh stub, fresh attempt counter)
STUB_PORT=8988 STUB_LOG=/tmp/frames-1087-final/canvas-stub.log STUB_FAILS=3 \
  node /tmp/rig/stub-1087.mjs &
DISPLAY=:99 LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat /tmp/rig/token)" \
  node /tmp/rig/dictation-rig.mjs --mode after --surface canvas \
  --stub http://127.0.0.1:8988 --out /tmp/frames-1087-final/canvas \
  --stub-log /tmp/frames-1087-final/canvas-stub.log
```

`before-dictation-failed.png` was captured with the change stashed in the
worktree, `after` on the branch, so the two differ only in this change. Each
frame was held until two consecutive captures agreed - a single capture in the
headless launch can be taken mid-paint.

**The rig is not committed.** `/tmp/rig/dictation-rig.mjs` and
`/tmp/rig/stub-1087.mjs` are a throwaway harness on the machine that captured
these, not repo scripts, so the commands above are a record of how the frames
were made rather than a reproducer a reader can run. Re-deriving a frame means
writing the rig again; that is a real cost and it is not hidden here.

### Two routes the stub answers itself, and why

The stub forwards every request to the lane's daemon unchanged, except:

- `POST /v1/transcriptions` - the fault under test (the daemon's own 502
  envelope, then the success shape once `STUB_FAILS` attempts are spent);
- `GET /health` - the lane's daemon answers this route 500 in this box, so the
  stand-in answers 200 itself; without it main refuses to adopt the daemon and
  the renderer reports the server offline before any UI state is reached;
- `GET /v1/credentials` - the lane's daemon reports an empty credential list in
  this box, and the mic is gated on a Radient key or session
  (`use-credentials.ts`). The stand-in returns the legacy key's NAME, never a
  value; the transcription route above is answered locally anyway, so no
  provider call is ever made with it.

Nothing about the failure, the retry, the bytes or the copy is synthesized: the
attempt count, spacing and byte counts in the rig's `record.json` come from the
stub's own log of what the app sent.

## What was verified about the images, and what was not

Verified mechanically at commit time: each file decodes as a 1380x900 PNG, the
`before` and `after` failure frames are byte-different, and all five carry the
full 8-bit value range, i.e. they are real renders rather than blank captures or
solid fills.

The frames were captured from a build of the remediation commit `63c3d8168`. The
rebase onto `origin/main` (`4f535bfcb`) that follows it changes no file on either
surface: `git diff 63c3d8168 HEAD -- src/renderer/src/shared/components/composer
src/renderer/src/features/chat/components/canvas
src/renderer/src/shared/api/local-operator src/i18n/catalogues` touches only
`ui.browser.*`, the browser pane's copy.

Verified by a person/agent reading these bytes at the remediation commit: all
four `after` frames. The canvas failure frame shows the typed prompt still in
the field, the field still editable, the row below it and no toast. The composer
failure frame shows the row, the control, and the mic and send uncovered.

**Not verified:** no other theme, width or locale was rendered; the frames are
one theme (`localOperatorDark`), one width (1380x900), English. The in-flight
`Processing audio` state, a second failure after the manual retry, keyboard
focus on `Retry` and reduced motion are not in any frame.

## Why this is not under `docs/evidence/`

That set is a committed contract with its own manifest and fold window (see
AGENTS.md). These are a per-pull-request before/after pair plus the canvas
surface this change also touches, which is what `docs/pr-evidence/` holds - the
same call PR #1228 made for its pair.
