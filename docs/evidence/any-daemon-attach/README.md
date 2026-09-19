# Any-daemon attach — the app as a client of a server it did not start

Two scenes, run by `scripts/attach-frame-evidence.mjs` (the rig the daemon-attach
set already uses: isolated `HOME`, isolated `LOCAL_OPERATOR_CONFIG_DIR`, its own
`--user-data-dir`, an allowlisted environment, `--window-mode=headless`, and one
built app per boot). The design record is `docs/design/any-daemon-attach.md`.

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
`lop` on `PATH` for the real-daemon scene is the machine's own launcher
(`~/.local/bin/lop`); the daemon's own record reports its version, `0.59.7`.

The rig keeps one record per scene (`after-frames-any-daemon.json`,
`after-frames-other-principal.json`) and merges them into `after-frames.json`, so a
reader sees both scenes in one document and re-running one cannot drop the other's.

## `after-any-daemon-*.png` — R1: a real `lop serve` the app did not start

The direct evidence for the operator's first requirement, and the one thing the
earlier frames could not show: the rig's `attached` scene boots against a real
daemon and proves the app RENDERS a list, but it asserts nothing about whether the
app PAIRED with that daemon. Two processes' own words are the instrument, and both
are in `after-frames.json`:

- the app's log (`after-any-daemon-backend-service.log`) carries
  `Claimed the desktop plane on http://127.0.0.1:46140.`;
- the **daemon's** own serve record, read back after the claim, reports
  `desktop: true` with the `claim_key` it now accepts, its `instance_id`, its
  `version` (`0.59.7`) and its pid — i.e. the daemon's own statement that this
  plane is governed;
- the daemon's own access log carries `POST /v1/desktop/claim` → `200`
  (`claimInDaemonLog: true`).

`after-any-daemon-attached.png` is the frame: the chat list populated from the
adopted daemon's own store, `pairing: {available: true, cause: null}` in the app's
status, and no band of any kind.

## `after-any-daemon-swap-*.png` — the post-swap re-pair, with no user action

The daemon is killed and a successor is started on the same port with the same
config directory: a fresh `claim_key` (`successorClaimKeyIsFresh: true`) and a
plane that is shut until somebody claims it, which is what a `lop` build swap
leaves behind. Nothing touches the app.

- `...-swap-during.png` is the app after the daemon is gone and before the
  successor exists — **waited for rather than sampled**, because a frame taken the
  instant the process dies photographs an app that still believes it is attached,
  byte-identical to the repaired frame. This is the state the band exists for
  (`Not connected to a Local Operator server. If one is still running, the app
  reconnects to it on its own. The daemon's process is gone.`), with the list still
  showing what it last knew. **No surface claims the server is old** — that is the
  assertion the scene makes (`assertNoVersionBlame`) and the falsifiable prediction
  of design § 4.
- `...-swap-after.png` is the app after it re-paired **on its own**: the second
  `Claimed the desktop plane on …` line in the app's log, the list back, and no
  band at all.

## `after-other-principal-triple.png` — the photographed triple, re-shot

The state the operator's screenshot was taken in: a daemon that is running,
healthy, and governed by another program, so this app may not drive it. The daemon
is the rig's own stub — the governed state cannot be produced by a second real
`lop`, because the plane's whole contract is that a second claim is refused — and
its refusals are the server's real strings, transcribed from
`local_operator/server/desktop.py`. The stub publishes the record a governed plane
leaves (`desktop: true`, `claim_key: ""`), and the app's own status reports the
cause it derived from it: `pairing: {available: false, cause: "governed-elsewhere"}`.

The frame is the composing one: the **connectivity** band says a server may be
running and this app is not attached to it, and directly under it the
**compatibility** band says which program has the plane and offers **no control** —
the state has no remedy this app may perform, so it is not offered one.

It is asserted, not described: nothing in the frame renders the daemon's own prose
(`rendersDaemonProse: false`) and nothing renders a version blame
(`rendersVersionBlame: false`).

## What this set does NOT cover

- **A rendered frame of the chat pane's own sentence.** The pane states its
  condition only while a conversation is open, and opening one mounts a session
  through the desktop plane — which the governed daemon refuses, measured in this
  very scene (the row click lands; the pane never mounts). The other route to that
  state, the swap, closes within the renderer's own capability poll: the app
  re-pairs on its own, so the pane's gate does not stay closed long enough to
  photograph. The half of the rule that is decidable is pinned by
  `scripts/backend-error-surfaces.test.mjs` — `backendPairingSentence` over every
  cause, and `desktopFeatureState` returning `unpaired` rather than
  `below-version` for a closed plane.
- **The mark-all-read toast.** The operator's third surface was a caught desktop
  error on the sidebar's mark-all-read control. That control is gated on a
  capability this daemon does not advertise, so the toast cannot be reached here at
  all. The class is covered where it is decidable: the refusal codes and the
  translator are driven through the real transport in
  `scripts/desktop-renderer-transport.test.mjs`, and the routing through
  `scripts/mcp-failure-routing.test.mjs`.
- **A `before` arm.** The copy each frame replaces is the operator's screenshot and
  the shipped strings, quoted in the design record (§ 0) and pinned by
  `scripts/backend-error-surfaces.test.mjs`, which asserts that no pairing sentence
  asks a user to change what the app manages and that the banner offers no control
  where no remedy exists.
