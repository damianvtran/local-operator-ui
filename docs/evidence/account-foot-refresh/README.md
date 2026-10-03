# The sidebar account foot, walked through a real re-sign-in

The operator's report (2026-09-27, on the installed app): after the app prompted a
Radient re-sign-in, completing the sign-in did not update the sidebar account foot
(bottom-left; person icon + "Account unavailable" + gear). It kept saying
"Account unavailable", and healed only when a later Settings visit remounted an
observer on the failed query.

The cause was that no sign-in COMPLETION path re-commissioned the account read
(`["radient-user","user"]`): `provider-detail.tsx`'s `refreshProviders` and
`use-radient-session-issue.ts`'s succeeded branch invalidated providers, catalogue,
config and verdict, but never `radientUserKeys`, so the re-read waited for some
other surface to mount an observer — which is what the Settings visit did.

## The pair this set is

| frame | foot | what it shows |
| --- | --- | --- |
| `before/refused.png` | "Account unavailable" | the shared starting frame: the read is refused (`401 radient_credential_refused`) and the composer callout has raised "Radient needs re-authentication" |
| `before/still-unavailable.png` | "Account unavailable" | **the defect**: the same walk on `origin/main` after the sign-in COMPLETED — the callout is gone (the verdict re-read), the foot has not moved, and the cache still holds the pre-prompt refusal (`failureCount: 3`, `updatedAt: 0` — nothing re-commissioned it) |
| `after/refused.png` | "Account unavailable" | the same starting frame on this head |
| `after/checking.png` | "Checking account…" | the fix's new interim: the completed credential write clears the stale class and re-commissions the read, so the foot visibly moves while that read is out |
| `after/ready.png` | "Rig Operator" + the account's email | the read's answer reaches the SAME mounted sidebar — no Settings visit anywhere in the run, no remount |

The pair is one command apart: same rig state, same backend, same scene, same
window size — only the tree under test changes. Every run asserts the app held a
connection to the rig's backend and NONE to the operator's own on 1111, that no
process outlived its boot, and that the sidebar shell, the composer band and the
callout were each actually on screen before any reading (a reading of an absent
callout would prove nothing).

## What produced these frames

```
# rig (fake IdP 54599 + isolated backend 1119 + blanking proxy 8080; own HOME
# and config dir under iso/; runbook in ~/workspace/account-foot-rig/README.md)
bash run.sh

# one tree built against the proxy, one walk
bash build-tree.sh <tree>                    # VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080
FOOT_WT=<tree> FOOT_OUT=<frames> FOOT_EXPECT=<ready|stale> FOOT_WAIT_MS=70000 \
  FOOT_KEEP=1 bash run-walk.sh
```

`before/` is `origin/main` = `a9f4b1d7f4` (this branch's merge-base; the tree was
built from a detached worktree at that commit); `after/` is this head
(`9239fe24e9`, which is this branch's own commit that the set's stamps name).
Both runs are `headless` (asserted in the renderer), 1380x900 dark
(`--window-size 1380x900`), `--seed-onboarding-complete --clean`, and each writes
one log (`~/workspace/account-foot-rig/logs/walk-*.log`) whose `[foot ...]` lines
are the readings quoted in the table above (17 checks in the after walk, 16 in
the before walk, none failed).

The scene (`account-foot`, `~/workspace/account-foot-rig/account-foot-scene.js`)
is appended to the TREE'S OWN `scripts/renderer-driver.mjs` for the run
(`make-driver.py` writes it in and the walk deletes it): it opens a draft, waits
for the composer callout, reads the foot (`[data-sidebar-shell]`'s last child's
row), presses the callout's own `Sign in to Radient`, and reads the foot again
while the rig completes the flow. Two deliberate compressions of the operator's
timeline are named rather than hidden:

- **the press waits 70 s after the starting frame** (`FOOT_WAIT_MS`). The
  refusals that raised the prompt write the store's own 60 s credential backoff
  (`DEFAULT_BLOCK_MS`), and a person completes a re-sign-in minutes after the
  prompt; a walk that presses in seconds would have its completion's read
  decided by that backoff instead of by the code under test. The hold is printed
  in the walk's log.
- **the completion's read is held 4 s** by the rig's proxy (a file-driven knob in
  `proxy.py`), because against a local fake the read answers in milliseconds and
  "Checking account…" is a state a still can only catch if it is genuinely on
  screen for a moment. The same technique the rigs' `complete.py` records for
  the callback leg.

The rig is the session-issue round's own, with four additions this walk needed
(all rig-side, none in the product tree): the backend is a detached worktree of
`local-operator` at `32fafec38` carrying ONE rig-only patch (its `radient`
`base_url` reads `RADIENT_API_BASE_URL`, so the account read addresses the fake
IdP's `/me` instead of the real hub — without it the walk's read hits the real
API with a synthetic token); the fake IdP answers `GET /me` with the account the
frames show; `publish-record.sh` selects the record of the LISTENING backend by
`instance_id` (newest-mtime picked a dead daemon's record and the app rendered
its own "not paired" banner over every frame — measured, then fixed) and is
re-run every 10 s through the walk so the record's heartbeat cannot go stale
during the hold; and the proxy relays `text/event-stream` responses live (an
app whose feed cannot open through a buffering proxy renders "Not connected to
the backend — showing the last known state" beside the foot).

## The frames' hashes

```
ee16d80936f4f59397fa86c6478a6e0be53772beb5daf9cf5985e0dae443c090  after/checking.png
2adbfac331b9796794ce369dce0657a56f22d642cc85ce597ceae7fb379039d4  after/ready.png
720476d263134427716ee33f8a49ec0c335bd95fdca33946a0624446024531f3  after/refused.png
4e1864ef261730167d23f765ff75c7f6f01729870bb1065ede89505dfecadbdb  before/refused.png
f6f53e197218806c062b47ea3bcb04462a2e28b7426fa0eaff082825c6c143b4  before/still-unavailable.png
```

## What this set does NOT claim

- **Only the composer-callout path is walked.** The other credential-write
  completions (`provider-detail.tsx`'s `refreshProviders`: the settings grid's
  Radient row, the connect dialog, the onboarding step, `RadientAuthButtons`) and
  the callout's own commission are pinned by source in
  `scripts/picker-feedback.test.mjs`, exercised against the shipped hook in
  `scripts/settings-account-gate.test.mjs` (including the no-remount property and
  the interim), and asserted for the callout's succeeded branch in
  `scripts/radient-session-issue.test.mjs` — not re-photographed here.
- **The interim frame is the held read, not a spinner's animation.** No spinner
  is drawn in the foot; "Checking account…" is the row's own state label while
  the read is out, and the 4 s hold is what makes it a stable still.
- **The 60 s credential backoff is not part of the claim, and the class is
  NAMED here rather than left implicit** (round 1 asked for both halves). The
  shape, measured by QA and the UX walk on this head: a completion whose read
  lands inside the store's `DEFAULT_BLOCK_MS` window (a press within 60 s of a
  refused attempt) is answered `502 radient_upstream_failed` /
  `credential_unavailable` -- the store short-circuits before upstream, so
  `GET /me` is never hit (3 x 502, zero upstream calls, until the window
  passes) -- the recorded class re-arms after the retry chain, and the foot
  returns to "Account unavailable" until some later natural re-read. The root
  is backend-side: `upsert_credential` drops the row's tombstone markers but
  clears no `auth_credential_blocks`, so an interactive write does not lift the
  refusal its own predecessor wrote. That is `local-operator`'s `AuthStore`
  policy and is deliberately NOT changed from the renderer; it is recorded as a
  deferred finding on the PR (round 1, U1) rather than papered over with a UI
  timer that would re-spell the store's window. It is also why every walk in
  this set waits the window out before pressing -- the operator's own timeline
  (minutes between prompt and completion) is past it.
- **No Storybook sweep ran for this branch.** No committed swept frame renders
  the foot's account states; `manifest.json`'s counts (`frames`, `surfaces`,
  `themes`) are re-derived for the tree these walks ship in, and the note beside
  them says so.

## Design round 1 re-renders (the D1 fix, photographed)

The design round's D1 finding was a pre-existing defect ON this branch's
surface: the account row could not shrink below its content, so once a name or
email exceeded the row's text budget the settings gear was pushed out of the
rail and clipped by `[data-sidebar-shell]` (`overflow-hidden`) -- a 31-character
email alone was enough, with the gear painting 0 stroke pixels against 331
where it belongs. The fix is one class, `min-w-0` on the row button in
`user-profile-sidebar.tsx`; these frames are that fix, re-rendered so round 2
can close visually.

They are rendered through the DESIGN round's own named-state kit (a scratch
copy: isolated HOME/config, its own ports, `scripts/renderer-driver.mjs` from
the tree, a scene that boots the app against a backend ALREADY in the state
under test and never presses a sign-in), whose runner bootstraps the state
through the product's own `AuthStore` -- `refused` = the dead grant, `checking`
= a healthy credential with the fake IdP holding every `GET /me` for 4 s,
`ready` = a healthy credential answering. Every frame's own palette assertion
passed (`... draws the light/dark palette its name claims`), every run is
`headless` and asserts a connection to its own backend and none to the
operator's, and each run reaped its own processes by pidfile.

| frame | state, identity | geometry read from the live DOM |
| --- | --- | --- |
| `design/d583-refused-light.png` | the dead grant, light | row 208x48.9 at x=8, gear x=220..252, foot reads "Account unavailable" |
| `design/d583-checking-light.png` | healthy, `GET /me` held 4 s, light | same row/gear boxes, foot reads "Checking account..." while the read is out |
| `design/d583-ready-light.png` | healthy, answered, light | same row/gear boxes, foot reaches the account |
| `design/d583-long-ready-light.png` | 29-char name + 62-char email, light | row w=208, gear x=220..252; name 187 -> 156 px ellipsised, email 378 -> 156 px, `overflowing: true` on both |
| `design/d583-long-ready-dark.png` | same identity, dark | same geometry (gear x=220..252) |
| `design/d583-xlong-ready-light.png` | 37-char name, light | name 237 -> 156 px; the visible prefix truncates to the same text as the long frame, so the two PNGs are byte-identical (same painted pixels, by design, not by accident) |
| `design/d583-med-ready-light.png` | short name + `jonathan.smithson@example.com`, light | name fits (156/156), email 190 -> 156 px ellipsised, gear x=220..252 -- this length hid the gear entirely before the fix |
| `design/d583-lemail-ready-light.png` | short name + 62-char email, light | email ellipsised at 156 px, gear x=220..252 |

WHAT THE FRAMES DO NOT CLAIM: the reviewer's exact long/extra-long strings were
never recorded in their kit, so the identity strings here match their NAMED
lengths (29-char name + 62-char email; 37-char name; the med address is the one
their finding quotes verbatim) rather than byte-for-byte their inputs; the
painted property under review -- both lines ellipsise at the 156 px budget and
the gear keeps its x=220..252 place -- is length-determined and reads
identically. The reviewer's live "fix probe" frame is not re-shot because these
frames ARE the fixed tree (the probe existed to preview a style not yet landed;
that style is landed here). And the frame names keep the design kit's `d583-`
prefix so round 2 can hold them against the originals one-to-one.

```
198b3f5b1c03841f65c474f2f74ab3bcafc0a3ea46c81ee33577fac3cf15d1f4  design/d583-checking-light.png
5944bb92c4f2ee5d595b8b3d472f0f671475d1e2618476c28dc3d501546dd440  design/d583-lemail-ready-light.png
59435ce37515ba85ac332c29a15284b280fd75f57ab2cda1e7278a447e2f6098  design/d583-long-ready-dark.png
c07ad54db858671d477595de5b9c72a5e4abd4094d0609f51b19dd385f4f07dc  design/d583-long-ready-light.png
fc39bbf1ba0b2b6cba128b494816aa3c5123ed660759e4871de7046bc403ba50  design/d583-med-ready-light.png
0abfd0fb22daac5b77df3feb8ee53f90a5d3be02f4ffca0b368bf43cd8b6bd7d  design/d583-ready-light.png
2cb9c2346b19be0cc4695f08754dafaaf385f50bcfdbc710ff3911ae182441f3  design/d583-refused-light.png
c07ad54db858671d477595de5b9c72a5e4abd4094d0609f51b19dd385f4f07dc  design/d583-xlong-ready-light.png
```
