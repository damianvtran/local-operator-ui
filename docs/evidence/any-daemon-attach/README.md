# Any-daemon attach — the app as a client of a server it did not start

Two scenes, run by `scripts/attach-frame-evidence.mjs` (isolated `HOME`, isolated
`LOCAL_OPERATOR_CONFIG_DIR`, a `--user-data-dir` and a WORKING DIRECTORY of its
own per boot, an allowlisted environment, `--window-mode=headless`). The design
record is `docs/design/any-daemon-attach.md`, whose § 11 records what review round
1 corrected.

## How this set was produced

```sh
PATH="$HOME/.local/bin:$PATH" \
  node scripts/attach-frame-evidence.mjs --out docs/evidence/any-daemon-attach \
       --label after --scene any-daemon
PATH="$HOME/.local/bin:$PATH" \
  node scripts/attach-frame-evidence.mjs --out docs/evidence/any-daemon-attach \
       --label after --scene other-principal
```

`after` is this branch's head, built with `pnpm build` from the same tree. The
`lop` on `PATH` is the machine's own launcher; the daemon's record reports its own
version.

**Which address each boot was configured for** is read from the app's OWN log, not
taken from the launcher's environment, and the run fails if it is not the scene's
address. That check exists because it was false once: `src/main/backend/config.ts`
folds a `.env` from `process.cwd()` with `override: true`, so a boot whose cwd was
the checkout was configured against the operator's live daemon on :1111 whatever
the launcher passed (review round 1, QA Q-1). Each scene's record carries
`configured: {port, url}`.

The rig keeps one record per scene (`after-frames-any-daemon.json`,
`after-frames-other-principal.json`) and merges them into `after-frames.json`.

## `after-any-daemon-*.png` — R1: a real `lop serve` the app did not start

- the app's log carries `Claimed the desktop plane on http://127.0.0.1:46140.`;
- the **daemon's** own serve record, read after the claim, reports `desktop: true`
  with the `claim_key` it now accepts, its `instance_id`, its `version` and pid;
- the daemon's own access log carries `POST /v1/desktop/claim` → `200`
  (`claimInDaemonLog: true`).

`after-any-daemon-attached.png` is the frame: the chat list populated from the
adopted daemon's own store, `pairing: {available: true, cause: null}`, no band.

`...-swap-during.png` is the app after that daemon is gone and before the successor
exists — waited for rather than sampled, because a frame taken the instant the
process dies photographs an app that still believes it is attached. It carries the
connectivity band (`The daemon's process is gone.`) with the list still showing
what it last knew, and no version blame.

`...-swap-after.png` is the app after it re-paired **on its own**: the second
`Claimed the desktop plane on …` in the app's log, the list back, no band, and the
sidebar's own "Not connected to the backend" line gone. That line is in this set
because it was a defect: the feed relay took its bearer at construction, so a
re-pair on the same port left it refused forever and the line never cleared while
main reported the app attached and paired (review round 1, QA Q-2 / design D3).

## `after-other-principal-triple.png` — the governed screen, and the guard that can fail

A daemon this app may not drive: the stub publishes the record a governed plane
leaves (`desktop: true`, `claim_key: ""`), and the app's status reports the cause
it derived from it — `pairing: {available: false, cause: "governed-elsewhere"}`.
The frame carries the compatibility band naming which program has the plane, with
**no control**, and no version blame anywhere.

The daemon's own prose is not merely absent from the pixels: it is ASKED FOR. The
scene drives `window.api.desktop.request({op: "sessions.list"})` through the app's
own transport to this stub, which answers with the sentence transcribed from
`local_operator/server/desktop.py`; the run records
`planeRefusal: {status, daemonProseReachedApp: true, daemonProseReachedScreen:
false}` and fails if either half is wrong. The first version of this guard asked
the same question of a scene whose stub had served zero desktop requests, so it
was true whatever the change did (review round 1, design D4).

### What the operator's own screen was (corrected attribution)

The prose above — *"Desktop controls require a backend started by the desktop
app."* — is written only for a plane that is CLOSED: unclaimed, with no
environment token. A plane governed by another principal answers 401/403 instead.
So the operator's 503 came from a closed plane this app held no claimable
credential for, and the governed screen is the neighbouring state, photographed
here because it is the one this branch's sentence and withheld control are for
(review round 1, design D5; design record § 11.1).

## What this set does NOT cover

- **A rendered frame of the chat pane's own sentence.** Opening a conversation
  needs a desktop read the governed daemon refuses, and the swap window closes
  within the renderer's capability poll. Pinned by
  `scripts/backend-error-surfaces.test.mjs` (`backendPaneSentence` and
  `desktopFeatureState`).
- **A `before` arm.** The copy each frame replaces is the operator's screenshot
  and the shipped strings, quoted in the design record § 0 and pinned by the test
  that asserts no pairing sentence asks a user to change what the app manages.
- **A narrow-viewport or light-theme frame** of the governed state, and **a story**
  for the compatibility band's control states (review round 1, D10/D11): deferred
  to a follow-up, recorded rather than implied — the band's S2 line measures to
  x 1100 of a 1380 px window and the pane's wraps at 832 px, and no theme role is
  introduced by this change.
