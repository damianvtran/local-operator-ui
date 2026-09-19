# The update verdict, photographed in the running app

Two defects, one root each, both reported by the operator on 2026-09-18:

1. a landed server update was reported as one that never took effect, because
   every "did this install move" reading was taken from the `generations/<id>`
   tree the daemon was launched from, which an install never touches;
2. a stale app-install failure was printed for ever, because nothing retired
   `last-update-install.json` once the version it named was running.

## What produced these frames

```
pnpm build                      # VITE_GOOGLE_CLIENT_ID and the three OAuth ids are
                                # required by electron.vite.config.js; this run built
                                # with placeholder values because no flow it
                                # photographs reads them
node docs/evidence/update-report-accuracy/harness/capture-update-report.mjs \
  --scenario unattended-landing --expect-notice=<absent|present> \
  --out docs/evidence/update-report-accuracy/unattended-<before|after>
```

Run it once in a tree built from the base (`--expect-notice=absent`) and once in
a tree built from the branch (`--expect-notice=present`). Nothing else about the
command changes, which is what makes the pair comparable. The pair committed here
came from `origin/main` = `a17a6b3ba`, the rebase base this branch now sits on,
and from this branch's `a87834921` (the code fix; the round's rig change was
uncommitted in the worktree the run booted, and it only writes frames). Both
halves were re-taken with the fixed rig described below, in the same pass, so
neither is an older run's bytes.

The rig boots the BUILT app in `headless` mode on a scratch `HOME`, scratch
config root and scratch `--user-data-dir`, seeds a marker that a real install
wrote (an older build's spelling: the concrete generation path), and captures
with the app's own `Page.captureScreenshot`. The marker names a synthetic
generation install behind a `current` pointer that has already flipped to the
newer generation, which is the state the operator's machine was in at
`19:39:35`.

| frame | `--expect-notice` | what the app does |
| --- | --- | --- |
| `unattended-before/localOperatorDark.webp` | `absent` | reconciles the record against the frozen generation, concludes "did not move the install", and reports nothing at all - for 30 s of frames. The committed frame is the LAST frame of that window (`probe-59`), taken by the same run that judged the notice absent: with no notice in any of the sixty there is no moment the run could prefer, and the rig now falls back to its last probe for exactly this scenario. Before that fallback a no-notice run committed NOTHING, so every re-take re-encoded the after half and silently kept the before half's older bytes (review round 1, R1-1). The probe PNGs live in the run's scratch tree, which `--keep` retains; they are no longer written into `--out`, because that is a committed directory. |
| `unattended-after/localOperatorDark.webp` | `present` | the same launch reports the landed update: the "Server update completed successfully" notice, 3.0 s into the run |

## What is NOT here, and why

**The Settings card with `last-update-install.json` present vs retired.** The
rig captures that state's *reading* - `get-last-install-attempt` answers the
0.28.3 record on `main` and `null` on the branch, and on the branch the file is
gone from the user data directory and the update log carries `Retired the
recorded install failure for 0.28.3: this app is running 0.29.1, so the target
has been reached...` - but the card's own rows are gated: main fills the settings
registry from a live daemon, so with no backend the page renders its "Your
settings could not be loaded" state and the card is absent on BOTH builds
(measured). Photographing it needs a live isolated backend, and the renderer's
own CSP pins `connect-src` to `1111` and `8080`; on this host `1111` is the
operator's own daemon and `8080` was held by another session's listener for the
whole window, so the run that needs one could not be made here. Run
`--scenario stale-record` with a backend on a free allowed port when that port
is available: the rig asserts the card's sentence when the page rendered and
says so when it did not.

**The press's own failure panel.** `updateBackend` runs only against a daemon the
app has adopted or started, and the whole point of the fix is that a press which
lands must not paint a failure panel - an absence does not photograph. The
press's verdict is driven instead by `scripts/update-robustness.test.mjs`
against a real generation layout on disk: on `main` the same scenario returns
`false` and sends `backend-update-error` with "did not take effect"; on the
branch it returns `true` and sends `backend-update-completed` with
`installVersion: 0.59.7`.
