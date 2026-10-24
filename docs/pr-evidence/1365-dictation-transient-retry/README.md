# The dictation failure, before and after the retry (PR #1365, issue #1087)

Rendered stills for the dictation change in PR #1365: a transient upstream
fault during transcription no longer destroys the recorded take, and the
failure sentence carries a `Retry` control that re-arms the same send path.

## What these frames are

Captured by the app's own `capturePage()` against a local stub that answers the
transcription endpoint with `502 Bad Gateway` and an
`Upstream responded 500: {...}` body - the relayed shape described in issue
#1087, and the exact shape this change is about.

| Frame | What it should show |
| --- | --- |
| `before-dictation-failed.png` | `main` before the change: the clipped-JSON failure toast, and no way back to the recording. |
| `after-dictation-failed.png` | The transient sentence in place of the raw JSON, with the `Retry` control in the composer row and the same sentence in the canvas. |
| `after-dictation-recovered.png` | After the control is used: the take is sent, the row is withdrawn and the toast cleared. |

## How they were captured

```
DISPLAY=:99 LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat /tmp/rig/token)" \
  node /tmp/rig/dictation-rig.mjs --mode <before|after> \
  --stub http://127.0.0.1:8988 --out /tmp/frames-1087/<mode> \
  --stub-log /tmp/frames-1087/<mode>/stub.log
```

`before` was captured with the change stashed in the worktree, `after` on the
branch, so the two differ only in this change. Each frame was held until two
consecutive captures agreed - a single capture in the headless launch can be
taken mid-paint.

**The rig is not committed.** `/tmp/rig/dictation-rig.mjs` is a throwaway
harness on the machine that captured these, not a repo script, so the command
above is a record of how the frames were made rather than a reproducer a reader
can run. Re-deriving a frame means writing the rig again; that is a real cost
and it is not hidden here.

## What was verified about the images, and what was not

Verified mechanically at commit time: each file decodes as a 1380x900 PNG, the
`before` and `after` failure frames are byte-different, and all three carry the
full 8-bit value range, i.e. they are real renders rather than blank captures or
solid fills.

**Not verified by the author:** nobody has eyeballed the committed bytes. The
agent that ran the captures could not display images on that host, so the
mapping from "what the table above says" to "what the pixels show" rests on the
capture rig and the assertions it made at shutter time, not on a human read of
these files. A reviewer should look at them rather than take the table as
established.

## Why this is not under `docs/evidence/`

That set is a committed contract with its own manifest and fold window (see
AGENTS.md). These are a per-pull-request before/after pair, which is what
`docs/pr-evidence/` holds - the same call PR #1228 made for its pair.
