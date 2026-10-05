# The read-receipt skew — frames and the live pairing

**What these are.** Two kinds of capture, and the difference matters:

- `frames/readack-skew-before.png` and `frames/readack-skew-after.png` are
  **drawn** frames from the committed harness in `harness/`, run against the
  unmodified checkout and this branch respectively, in a private headless
  Chrome. PNG rather than WebP on purpose: `check-evidence.mjs`'s frame walker
  counts `.webp` only, so a hand-driven set cannot be mistaken for frames a
  sweep produced (the `read-ack-notice` set's precedent). Each frame's companion
  `.readout.json` is the page's own readout, verbatim.
- `frames/live-app-*.png` are **live** frames from the two-daemon rig's built
  app: the draft placed on `cloud-node-1` through the shipped device chip, the
  sidebar row with a real completion's unseen mark, and the peer conversation
  open in the pane.

**The defect, and the bytes.** The operator hit the popup live on 2026-10-05
(verbatim in the report): an unread mark for `d7c2d1e7b496` living on
`cloud-node-1`, a peer whose build predates the receipt op
(`net_session_receipt`), refused by their A-side daemon and painted as an error
toast carrying the owner's raw refusal — an internal op name and a remedy
("Click the chat to try again.") that cannot succeed. The rig reproduced it on a
real pairing: daemon A at `origin/main` (`62c7bc272`, including #2004's composed
409), daemon B pre-#1994 core (`f42c8b03d`, which refuses the op). The same
receipt request, captured twice:

| capture | daemon A | body |
| --- | --- | --- |
| `rig/seen-409-raw.txt` | pre-#2004 core | `{"code":"session_is_remote","message":"…could not be cleared there right now: 'net_session_receipt' is not an operation this build dispatches."}` — the operator's popup, verbatim |
| `rig/seen-409.txt` | `origin/main` | `{"code":"session_is_remote","cause":"owner_build_behind","message":"…cloud-node-1 runs an older build, and the mark clears when that device updates."}` |

**The fix's A/B, on the shipped components.** `harness/readack-skew.tsx` mounts
the shipped `ThemedToastContainer`, `readAckNoticeSentence` and `readAckCopy`,
carries either capture into a `DesktopControlError` byte-for-byte, and runs the
sidebar's own announcement condition (`kind !== "unsettled"` returns early). The
two frames are the two builds answering the same refusal:

- `before`: the toast is drawn at the bottom-right with the operator's sentence
  exactly (`…'net_session_receipt' is not an operation this build dispatches.
  The unread mark was not cleared. Click the chat to try again.`), and the
  readout shows the row copy that came with it (`click the chat to try again`).
- `after`: **no toast** (`toasts: []` in the readout), the refusal classifies as
  the skew deferral (`cause: owner_build_behind` read, code fallback intact),
  the notice kind is `remote` (the quiet kind the loop publishes), and the row
  copy is the quiet clause — `lives on cloud-node-1, and it clears when that
  device updates` — with the unnamed fallback beside it. Nothing offers an
  action that cannot succeed, and no internal op name survives anywhere in the
  frame.

**The second half of the tolerance, at the wire: the owner's update settles it.**
The rig then restarted daemon B on `origin/main` (which dispatches the op) and
re-sent the *identical* request — same route, session, token:

- `rig/settle-200.txt`: `200` with `"unseen": false` — the mark cleared.
- `rig/owner-store.txt`: the owner's attention store holds the completions
  (all previously unseen, including the operator's own `d7c2d1e7b496`); after
  the settle, its `receipts` row records the acknowledgement. A later ack
  settling the mark is not a hope; it is in the owner's own store.

**The live pairing, and what each piece is.** `rig/runlo.sh` (per-root CLI with
an isolated `HOME`), `rig/rundesk.sh` (the A-side desktop daemon on :41241),
`rig/drive.mjs` (CDP driver: `--phase=create2` takes a draft through the device
chip onto `cloud-node-1`, `--phase=dig` opens a peer conversation and watches),
and `rig/make-rig-app.mjs` (builds a rig app dir from a worktree's `out/`; see
the disclosure below). `rig/desk-excerpts.txt` is the daemon's own access log
around the decisive calls: the app's create landing, its immediate readbacks and
message inside the peer-catalogue TTL window (404 — an adjacent defect, below),
the rig's re-sent admission (200), the `POST …/seen → 409`, and later the
`seen → 200`.

**WHAT THIS SET DOES NOT SHOW, and why** — the bounds, in the register the
`read-ack-notice` set uses:

- **The notice is staged through the shipped components, not published by the
  built app.** Two walls, both measured on this rig: (1) main's read-receipt
  foreground gate refuses `sessions.seen` from a window that is not visible,
  unminimised and focused, and a headless rig may not focus a window (it would
  steal the operator's focus); the rig's app ran with the gate lifted in its
  cloned bundle (`rig/make-rig-app.mjs` records the exact one-line edit) *and*
  still could not cross wall (2): a peer-placed session's row exists in the app
  only when the app itself minted it, and the app's create path fires its own
  readbacks inside the peer catalogue's 20 s TTL window, so the daemon 404s the
  fresh id and the app correctly concludes the session is missing and forgets
  the row (`confirmSessionMissing`). The wiring from the refusal to the class,
  the copy and the silence is therefore proven where this repo proves it — the
  composed sentence and the row copy in `scripts/mark-all-read-control.test.mjs`
  cases, against these exact bodies — and the frames stage the same states on
  the shipped components.
- **The row flyout is not painted in this set.** The quiet clause's strings are
  the after-frame readout (and the flyout case in the test file asserts the
  `· lives on cloud-node-1…` suffix on the row); the sidebar row itself is
  live-photographed with a mark in `frames/live-app-marked-row.png`, but with
  no notice on it (no live path can hold one — the wall above). A design round
  that wants the flyout's pixels should ask, and it is a storybook-scale build.
- **The app-side apply of the settle is pinned by tests, not a frame.** The
  wire settle and the owner's store are live (`rig/settle-200.txt`,
  `rig/owner-store.txt`); the client applying a receipt answer to clear the row
  mark is the existing landed behavior and is not re-photographed here.
- **Adjacent defects, recorded but not addressed** (they are outside this
  fix's slice): the app's create-on-peer path races the peer catalogue's TTL
  (the 404s in `rig/desk-excerpts.txt`), and a peer conversation opened cold
  shows the header chip reading "On this device" over a remote session
  (`frames/live-app-peer-open.png`).

**How the two drawn frames were made**, so a reviewer can re-run them:

```sh
# after, from this worktree:
node docs/evidence/read-ack-skew/harness/readack-skew.mjs --state=after
# before, from a clean checkout at origin/main with the harness/ directory copied in:
node docs/evidence/read-ack-skew/harness/readack-skew.mjs --state=before \
  --out=<this-set>/frames
```

The harness is `scripts/toast-close-geometry.mjs`'s pattern: raw CDP against a
private headless Chrome (`--use-mock-keychain`, a fresh profile under `$TMPDIR`,
both processes killed by exact pid on exit), and a vite dev server from the
worktree it is run in — which is what makes `--state=after` render the fix and
`--state=before` render the defect, from one file. The private Chrome on
`127.0.0.1:5447` and its profile are reaped in a `finally`; nothing is left
running.
