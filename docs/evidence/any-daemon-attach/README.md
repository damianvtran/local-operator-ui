# Any-daemon attach — the app as a client of a server it did not start

Two scenes and one narrow re-shoot, run by `scripts/attach-frame-evidence.mjs`
(isolated `HOME`, isolated `LOCAL_OPERATOR_CONFIG_DIR`, a `--user-data-dir` and a
WORKING DIRECTORY of its own per boot, an allowlisted environment,
`--window-mode=headless`). The design record is `docs/design/any-daemon-attach.md`,
whose § 12 records what the review rounds corrected.

## How this set was produced — and the identity of the build it depicts

```sh
pnpm build                     # FIRST: the frames must depict the code under review
PATH="$HOME/.local/bin:$PATH" \
  node scripts/attach-frame-evidence.mjs --out docs/evidence/any-daemon-attach \
       --label after --scene any-daemon
PATH="$HOME/.local/bin:$PATH" \
  node scripts/attach-frame-evidence.mjs --out docs/evidence/any-daemon-attach \
       --label after --scene other-principal
ATTACH_FRAME_WIDTH=760 ATTACH_FRAME_HEIGHT=868 PATH="$HOME/.local/bin:$PATH" \
  node scripts/attach-frame-evidence.mjs --out docs/evidence/any-daemon-attach \
       --label narrow --scene other-principal
```

**The bundle identity is the renderer entry chunk and the compiled main bytecode**,
recorded in every scene's record (`bundle`). The first version of this record quoted
`out/main/index.js` — a 72-byte bytecode stub whose sha256 is identical across every
build on this machine, including builds predating the fix — so it could not
discriminate, and "a grep of the bundle finds no occurrence of X" was vacuously true
of 72 bytes (review round 3, D18). What changes between builds is what is recorded
now:

- `out/renderer/assets/index-CaQSxb2x.js`, sha256 `3b0871e091e4caaf…`, built `2026-09-19T16:01:15.786Z`;
- `out/main/index.jsc`, sha256 `dadcbbcff3a20a4f…`;
- newest source at capture: `backend-settings-section.tsx`, `2026-09-19T15:58:10.438Z`,
  against the build above.

EVERY SCENE IN THIS SET NAMES THAT ONE BUILD, and each scene carries it on its own
entry rather than inheriting it from whichever run wrote the combined file (review
round 4, D26/D27): the set was shot in three runs from a single `pnpm build`, and
`after-frames.json`, `after-frames-any-daemon.json`, `after-frames-other-principal.json`
and `narrow-frames-other-principal.json` all report the chunk and hash above. The
values published here are read from those records, not remembered from an earlier
build - the round-4 draft quoted a chunk two builds back.

And the rig now **refuses to run** when any file under `src/` is newer than the
build: a rig that photographs whatever happens to be in `out/` is how the round-1
"re-shot" frames came to be byte-identical to the frames they claimed to replace.

**Which address each boot was configured for** is read from the app's OWN log and
asserted, not taken from the launcher's environment (`config.ts` folds a `.env`
from `process.cwd()` with `override: true`; review round 1, QA Q-1). Each scene's
record carries `configured: {port, url}`.

## `after-any-daemon-*.png` — R1: a real `lop serve` the app did not start

- the app's log carries `Claimed the desktop plane on http://127.0.0.1:46140.`;
- the **daemon's** own serve record reports `desktop: true` with the `claim_key` it
  now accepts, its `instance_id`, its `version` and pid;
- the daemon's own access log carries `POST /v1/desktop/claim` → `200`.

`after-any-daemon-attached.png`: the chat list populated from that daemon's own
store, `pairing: {available: true, cause: null}`, no band.

`...-swap-during.png`: the app after the daemon is gone and before the successor
exists — waited for rather than sampled. `...-swap-after.png`: the app after it
re-paired **on its own** (the second `Claimed the desktop plane on …`), with the
old "Not connected to the backend" line gone — the line whose feed relay was bound
to the address and not to the credential (QA round 1 Q-2 / design D3).

## `after-other-principal-*.png` — the governed screen, and its narrow re-shoot

A daemon this app may not drive: the stub publishes the governed record
(`desktop: true`, `claim_key: ""`) and the app's status derives
`pairing: {available: false, cause: "governed-elsewhere"}`.

**Both surfaces are read, each from its own vocabulary** (review round 3, D19; guard
made live in round 4, D28). The record's `bandSentence` is read from the frame's own
recorded lines and says so (`bandSentenceSource: "first_lines"`), and the scene fails
if `page.pane.sentence` equals that line: the round-2 version of this probe had one
mixed list and took the last DOM match, so this scene's `page.pane` held the band's
sentence with the band's geometry (`text-body-sm`, w1062, y80) while the pane was
really saying something else. The guard used to compare against a field the probe
never returned, so it could not fire at all. In this scene the pane says
`cannot be read here` with the pane's own geometry — no conversation is open, so the
pane cannot compose a sentence and says so rather than falling silent.

**What the prose guard can and cannot show.** The rig publishes
`desktopRoutesServed`, which is **0**: main's capability answer closes the gated
surfaces before any of them can call a desktop route, so the daemon's prose could
not appear in this frame whatever the fix did. The assertion is therefore an
ABSENCE, published beside its own count, and the record does not claim the sentence
reached the app and was suppressed (a round-1 draft published
`daemonProseReachedApp: true`, which had no field behind it; review rounds 2–3,
D4/D15).

`after-other-principal-narrow.png` (`--label narrow`, 800×868) is the same state at a
narrow viewport, which round 1 deferred and round 3 measured to be one env var away.
The frame is 800 wide because that is the app's own floor: the earlier 760 request was
clamped by the window manager (`760x868 clamped to 800x868 (floor 800x600)`, in the
app's own log), so the published size and the file name of the round-3 attempt named a
viewport that was never rendered (review round 4, D30).

### What the operator's own screen was (corrected attribution)

The prose *"Desktop controls require a backend started by the desktop app."* is
written only for a plane that is CLOSED. A plane governed by another principal
answers 401/403. So the operator's 503 came from a closed plane this app held no
claimable credential for, and the governed screen is the neighbouring state (design
round 1, D5; design record § 12.1).

## What this set does NOT cover

- **A frame of the daemon's prose being refused at the surface that photographed
  it** — see the guard's note above; the class is covered where it is decidable, by
  the transport, routing and store tests.
- **A light-theme frame** (round 1 D10): deferred, and no theme role is introduced
  by this change.
- **A `before` arm.** The only honest `before` is the operator's screenshot.
