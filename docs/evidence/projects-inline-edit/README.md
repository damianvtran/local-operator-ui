# The project detail page, edited in place: the inline-edit scene's frames

**Status: captured.** The eighteen PNGs (nine states x two brand palettes,
`dark/` = `localOperatorDark`, `light/` = `localOperatorLight`, 1380x900
through the app's own `capturePage()` in the `headless` window mode) are
committed beside this file: `dark/project-inline-1380x900-local-operator-dark-<state>.png`
and the `light/` siblings, for `hover`, `editing`, `dirty`, `saved`,
`description`, `saving`, `refused-key`, `refused-status` and `conflict`.
The run printed **54 PASS lines and 0 FAIL per palette and `ALL CHECKS
PASSED`**, and its last check — no process from this run outlived its boot —
passed. The seed, the command and the check list below are the record.

## Round 1 remediation re-capture

These frames are the REMEDIATION head's, re-taken for design review round 1
(D1-D5), UX round 1 (U1-U4) and QA round 1 (Q1-Q3). The states whose LOOK
changed, and why:

- `editing-*` - the clean focused field now shows NO check/x (D2: § 2.2's
  dirty-gate; the chrome used to appear the moment a field was clicked).
- `refused-status-*` - the status editor opens in the chip's own slot with its
  x/✓ hugging the control and the actions cluster pinned (D1), and the
  done-gate sentence speaks the app's crafted prose (D4).
- `saved-*`, `description-*` - the acknowledgement lands in a fixed-height
  slot that is present whether or not something is showing, so a commit never
  reflows the rows below (D3).
- `dirty-*`, `saving-*`, `refused-key-*`, `conflict-*` - unchanged look; the
  slot's hit areas are now disjoint (D5) and the pencil's target is 32x32
  (U2), both pointer facts a still cannot carry.
- `hover-*` - unchanged look; the fixed-height slot is present at rest (D3).

The scene grew seven checks in the same round: the fixed-height slot, the
chip's-slot opening, the dirty-gate, the input-time title cap, the local key
refusal, the x/✓ adjacency, and - exercising UX round 1's U1 / QA round 1's
Q1 on the real path - the `Use theirs` door (focus hand-back, slot to rest,
record adopted). 54 per palette, from 47.

One correction to the round-1 record, from QA round 2's live reading: the
description's cap is NOT a `maxlength`. Past 240 the counter turns the danger
role and the check dims and refuses the send - the disabled-check behaviour
UX round 1's U3 settled - while the title, key and owner/team caps ARE
enforced at input (their `maxLength`s, the wire's own bounds).

## What the frames are evidence for, and what they are not

The change this set evidences retired the modal `Edit project` sheet: every
field on the detail is now edited in place, per the app's one editing contract
(`docs/design/agents-inplace-shared-composer.md` § 2, PR #725). The claims are
about behaviour across the WINDOW, the KEYBOARD and the DAEMON, so the scene
asserts each one and photographs the state it leaves:

- every save is read back from the daemon's own route — the frame is the UI
  half, and a frame alone would only prove the window's echo;
- the refusal cases go through the REAL wire (a 409 `project_name_exists` from
  the store, the done-gate 422 from the milestone check), not a stubbed bridge;
- the conflict case's out-of-band write is made by the script's own Node
  process against the daemon route, never through the window — a change driven
  through the window would be the same author the never-clobber rule is about
  holding;
- the saving state is held by pausing the run's OWN daemon process (SIGSTOP /
  SIGCONT by exact pid, from the serve record), so the spinner is an in-flight
  write rather than a photographed fabrication.

The scene closes its own app and leaves nothing behind — its last check is
`no process from this run outlived its boot`.

## The run, exactly

```sh
# 1. the app, built against the backend this run owns
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 \
  VITE_GOOGLE_CLIENT_ID=rig VITE_GOOGLE_CLIENT_SECRET=rig \
  VITE_MICROSOFT_CLIENT_ID=rig VITE_MICROSOFT_TENANT_ID=rig \
  pnpm build

# 2. the daemon: a scratch config root, and the HOSTING written into it.
#    (A fresh config root holds no hosting, and every turn dies in
#    `HostingNotConfiguredError` without this file - see docs/agent-driver.md.)
#    token.hex is this run's own bearer written beside seed.py; both go with the
#    scratch root - neither is committed.
mkdir -p "$ROOT" && printf 'values:\n  hosting: test\n  model_name: mock-model\n' > "$ROOT/config.yml"
LOCAL_OPERATOR_CONFIG_DIR="$ROOT" LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat token.hex)" \
  local-operator serve --port 8080 --hosting test --model mock-model

# 3. the seed: `rig-inline` (title, owner, start date, one incomplete
#    milestone, no team/estimate/tags) and `rig-inline-other`.
python3 seed.py

# 4. the scene, once per palette (`--theme`), with the daemon's own record on
#    the run's scratch config root and the frames written where they live:
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat token.hex)" \
node scripts/renderer-driver.mjs --scene project-inline-edit \
  --backend http://127.0.0.1:8080 \
  --backend-records "$ROOT/run/serve" \
  --project rig-inline \
  --out "$LOCAL_OPERATOR_SCRATCHPAD/frames" \
  --seed-onboarding-complete --window-size 1380x900 \
  --theme localOperatorDark
# ... and the LIGHT pass: RE-RUN THE SEED FIRST - `python3 seed.py` deletes
# both rows and recreates them - then the same command with
# `--theme localOperatorLight`. The re-seed is required, not hygiene: the
# scene mutates the record and is not idempotent, and the second pass's
# status pick is a no-op without it (the editor sticks open and the run
# never reaches its frames).
```

`--backend-records` is not optional for this scene: the saving frame exists
only because the run can pause the daemon it owns by exact pid (the same
reading `--scene mini-view` uses; the operator's own daemon on 1111 is refused
by construction).

## The states, and what each frame shows, with its "before"

| Frame | State | Meaningful before? |
| --- | --- | --- |
| `hover-*` | the pointer over the title: the pencil revealed at `opacity` 1 after starting at 0 | no — the modal had no per-field affordance; this row has no before |
| `editing-*` | the title as an in-place input, focused, with the x and the check beside it | the modal's open state showed every field at once, in a dialog; no per-field before |
| `dirty-*` | a typed draft that is not yet saved, the field marked as the user's | no — the modal tracked no per-field dirty state |
| `saved-*` | the committed title back in the read view with the transient acknowledgement beside it (and the pane's one live region carrying the same words) | the modal's save closed the dialog behind a toast; no before of this shape |
| `description-*` | the description open as a textarea with the Write/Preview toggle and the `n/240` counter, a two-line draft inside it | `docs/evidence/projects-tab/edit-dialog/` shows the modal's own description field — the before for the field's chrome, not for its inline placement |
| `saving-*` | a write in flight with the daemon paused: the spinner in the check's slot | the modal showed a button spinner; the before for this state is `docs/evidence/projects-tab/edit-dialog/` |
| `refused-key-*` | a duplicate key refused by the store (409 `project_name_exists`), the attempted value held in the field with the app's sentence under it | the modal's refusal banner (same set) — the before for the copy, not for its placement |
| `refused-status-*` | the done-gate refusal re-spoken beside the status control | the modal's refusal banner (same set) |
| `conflict-*` | the Start date held: the record moved out-of-band while the draft was dirty, with `Keep mine` / `Use theirs` on screen | no — the modal had no conflict concept; a save was last-writer-wins |

## The scene's own checks

The scene prints one PASS/FAIL line per check and exits non-zero on any FAIL.
**The run recorded `ALL CHECKS PASSED` on both palettes (54 PASS lines each,
0 FAIL)** - the full list it printed, in order (the boot block's own checks
first - the pinned Electron, the scratch port, the armed launch, the backend
isolation pair, the headless window - then the seed preconditions and the
lifecycle):

```
the harness is driving the Electron this branch pins
the scratch backend port is dead
the armed launch said so on stdout
the app's logs went to this run's scratch tree, not the operator's
the app holds a connection to this run's backend (http://127.0.0.1:8080)
the app holds NO connection to the operator's own backend (http://localhost:1111)
the window is the headless launch, not a raised one
the daemon holds the seeded project
the seed has a title and a start date (the conflict case needs both)
the seed holds a second project, for the duplicate-key refusal
the seed holds an incomplete milestone (the done-gate arm)
the title's pencil is hidden at rest and the pointer's hover reveals it
focus alone reveals the key row's pencil (the keyboard door)
the title editor opens focused
the editor holds the draft
Esc reverts the field: stored title restored, no write sent
double-clicking the title value opens its editor
Enter accepts a single-line field, and the transient saved caption shows
the daemon holds the accepted title
the pane's one live region carries the acknowledgement
the x cancels: the stored start date stands, nothing was written
the saved caption lands inside the fixed-height slot: the row does not move
the check accepts: the daemon holds the new start date
blur on a dirty, valid field commits it
Enter in the description is a newline: still editing, the text grew a line
no write was sent for the still-open draft
the Write/Preview toggle renders the draft as markdown
Cmd+Enter accepts the description
the status editor opens in the chip's own slot: no header reflow
a clean status edit draws no accept/cancel chrome (the 2.2 dirty-gate)
the status select commits from the menu
the done gate's refusal speaks the app's sentence, not the daemon's register
the status check/x hug the control in the chip's own slot
the refused status move wrote nothing
x reverts the refused status to the stored value
a duplicate key is refused in-field with the app's crafted sentence
the refused key keeps the attempted value in the editor (§ 2.3)
x on the refused key restores the record's name
the over-long title is stopped at input: the field holds at most 80 characters
a grammar-invalid key is refused locally, with the daemon untouched
the out-of-band write landed (this process, the daemon's own route)
a field that moved out-of-band holds the commit, draft intact
Keep mine commits the draft over the out-of-band value
Use theirs closes the field, hands focus back and adopts the record
the run's own daemon is identifiable by pid (never 1111)
the saving state holds while the daemon answers nothing
the same write completes once the daemon resumes
a missing field is born inline from the + Add menu
an estimate can be born from none (round 1, M1)
tags can be born from none
the out-of-band tags write landed
a clean tags draft adopts the moved record and cannot revert it
a blur on the adopted (clean) tags draft writes nothing
no process from this run outlived its boot
```

## What the scene covers, and what only the unit lane covers

The scene's reach was widened in review round 1 to the two reproduced
data-integrity defects: an estimate BORN from none (M1 — the directional
draft identity is what makes the born draft dirty) and the tags rows (M2 —
born from none; a clean draft adopting an out-of-band move). The remaining
rule-level cases are pinned in `scripts/projects-inline-edit.test.mjs` rather
than photographed, because they are pure: the estimate's unit-only change,
the estimate's NO-CLEAR rule, the trimmed identity of every string field, the
keyboard contract's chord-from-chrome case, and the never-clobber comparison
driven through the machine for tags.

## The seed

`seed.py` (the script the run used, reproduced here for a later round) creates
both rows and the incomplete milestone, and deliberately leaves Team, Estimate
and Tags unset so the `+ Add` menu has fields to open. See the file beside this
README.
