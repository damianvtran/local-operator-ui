# Any-daemon attach — the app as a client of a server it did not start

Two scenes, run by `scripts/attach-frame-evidence.mjs` (isolated `HOME`, isolated
`LOCAL_OPERATOR_CONFIG_DIR`, a `--user-data-dir` and a WORKING DIRECTORY of its
own per boot, an allowlisted environment, `--window-mode=headless`). The design
record is `docs/design/any-daemon-attach.md`, whose § 12 records what review
rounds 1 and 2 corrected.

## How this set was produced — and which BUNDLE it depicts

```sh
pnpm build                     # FIRST: the frames must depict the code under review
PATH="$HOME/.local/bin:$PATH" \
  node scripts/attach-frame-evidence.mjs --out docs/evidence/any-daemon-attach \
       --label after --scene any-daemon
PATH="$HOME/.local/bin:$PATH" \
  node scripts/attach-frame-evidence.mjs --out docs/evidence/any-daemon-attach \
       --label after --scene other-principal
```

**Bundle identity**, recorded because a stale `out/` is exactly how round 1's
"re-shot" frames came to be byte-identical to the frames they claimed to replace
(review round 2, D13): the rig boots `out/`, and these frames were taken from the
build made at **2026-09-19 00:35** (`out/main/index.js`, sha256
`9a0e2c5478d7c4b8…`). A grep of that bundle finds **zero** occurrences of
`Restart the app so it can start its own server.`, the sentence round 2 removed
(UX U2) — so a reader can tell from the artifact alone that the app they are
looking at is the one under review.

**Which address each boot was configured for** is read from the app's OWN log and
asserted, not taken from the launcher's environment: `src/main/backend/config.ts`
folds a `.env` from `process.cwd()` with `override: true`, so a boot whose cwd is
the checkout is configured against whatever that file pins (review round 1, QA
Q-1). Each scene's record carries `configured: {port, url}`.

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

`...-swap-during.png` is the app after that daemon is gone and before the
successor exists — waited for rather than sampled. It carries the connectivity
band with the list still showing what it last knew, and no version blame.

`...-swap-after.png` is the app after it re-paired **on its own**: the second
`Claimed the desktop plane on …` in the app's log, the list back, no band, and the
sidebar's "Not connected to the backend" line gone — the line whose relay was
bound to the address and not to the credential, which is why it used to persist
for ever after a re-pair (QA round 1 Q-2 / design D3).

## `after-other-principal-triple.png` — the governed screen

A daemon this app may not drive: the stub publishes the record a governed plane
leaves (`desktop: true`, `claim_key: ""`), and the app's status reports the cause
it derived from it — `pairing: {available: false, cause: "governed-elsewhere"}`.
The frame carries the compatibility band naming which program has the plane, with
**no control**, and no version blame anywhere.

**What the record claims, and what it does not.** The rig publishes
`desktopRoutesServed` for this scene, and it is **0**: main's capability answer
closes the gated surfaces before any of them can call a desktop route, so the
daemon's prose cannot appear in this frame for a reason that has nothing to do
with this change. The guard is therefore an assertion of ABSENCE and nothing
stronger, and the record says so rather than implying the sentence reached the app
and was suppressed. (A round-1 draft published `daemonProseReachedApp: true` — no
such field exists in the tree, and the claim was wrong; review round 2, D15.) The
class is covered where it is decidable, by the transport and routing tests, and
the frame-level guard is deferred with that measurement.

### What the operator's own screen was (corrected attribution)

The prose *"Desktop controls require a backend started by the desktop app."* is
written only for a plane that is CLOSED: unclaimed, with no environment token. A
plane governed by another principal answers 401/403 instead. So the operator's 503
came from a closed plane this app held no claimable credential for, and the
governed screen is the neighbouring state, photographed here because it is the one
this branch's sentence and withheld control are for (design round 1, D5; design
record § 12.1).

## What this set does NOT cover

- **A rendered frame of the chat pane's own sentence.** Opening a conversation
  needs a desktop read the governed daemon refuses, and the swap window closes as
  the app re-pairs. Pinned by `scripts/backend-error-surfaces.test.mjs`
  (`backendPaneSentence`, `desktopFeatureState`) and, for the sidebar's own copy,
  by `scripts/mark-all-read-control.test.mjs`.
- **A frame of the daemon's prose being refused at the surface that photographs
  it** (the caught desktop error behind a control): the drive was attempted and
  measured to come back successful through the app's own IPC, and this scene
  serves no desktop route at all — see the note above.
- **A narrow-viewport and a light-theme frame** of the governed state, and **a
  story** for the compatibility band's control states (design round 1 D10/D11,
  round 2 D17): deferred. The geometry is measured (the S2 line to x 1100 of a
  1380 px window; the pane wrapping at 832 px) and no theme role is introduced by
  this change, but a rig knob for window size and theme plus a re-shoot is its own
  slice.
- **A `before` arm.** The only honest `before` is the operator's screenshot; the
  replaced copy is quoted in the design record § 0 and pinned by the tests that
  assert no pairing sentence asks a user to change what the app manages.
