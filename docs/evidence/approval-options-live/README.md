# Live proof: the approval card's options, against a real approval gate

Three arms of the shipped renderer — served over Vite with `desktopProxyPlugin`
— talking to an **isolated** `local-operator` backend on a scratch port that is
holding a pending approval gate. The gate is opened by the owner's own
`ServingSessionHandle._approval_gate` — the same closure `_install_gates`
registers in production — armed with the arguments the loop's tier gate passes
for a shell call: `tool_name="bash"` and the tool's own `describe_approval`
output, `run: rm -rf ./dist`. No model and no mock is involved. The operator's
live backend on `127.0.0.1:1111` was never touched; the rig runs with its own
config root, its own 32-byte token and an OS-assigned port.

## What each frame shows

| frame | what it is |
| --- | --- |
| `before-click/localOperatorDark.webp` | **The card, live, on the build this branch ships.** A real pending approval in the shipped renderer: the callout names the tool (`bash`) and the action (`run: rm -rf ./dist`), and beneath it the two options this change adds — `1. Approve` and `2. Deny`, each with its consequence line, on the transcript's own ground with the standard control triple. The hint below names all three exits: the buttons, the composer's words (yes/no and the `1`/`2` the card prints), and Escape. |
| `after-click/localOperatorDark.webp` | **The resolution of a press on Approve.** The same run, after a real `Input.dispatchMouseEvent` press and release at the option's hit-tested centre (`x 960, y 622`, `elementFromPoint` resolving to the option itself). The card is **gone** — the gate cleared rather than the page failing — and the composer is ready again. |
| `deny-click/before-click/localOperatorDark.webp`, `deny-click/after-click/localOperatorDark.webp` | **Deny rides the identical route with the other boolean.** The press resolves the gate the same way and the card clears; what the owner kept is `{"approved": false}`. The two options differ in nothing but that boolean, which is why this arm's evidence is the record rather than the pair of stills. |
| `refused-card/before-click/localOperatorDark.webp`, `refused-card/after-click/localOperatorDark.webp` | **A refusal, rendered on the card.** A run whose answer route refuses with a bare 409 — the sentence the route itself produces for an answer naming no pending gate ("This question or approval is no longer pending") — so the gate stays pending and the card stays UP: both options disabled, "Your answer was not sent." carrying the refusal under them, where the press was made, and the hint above them swapped off the dead buttons onto the composer, the control that still reaches the gate (remediation round 1, U2/U3). |

**The records are what say so, not the prose.** Each arm's own
`click-result.json` carries the resolution (`resolved`, `gateCleared`), the aim
point and its hit test, the route's own answer (`status`, and the refusal's
sentence where there was one), and the boolean the owner received
(`ownerAnswer`) — and each frame directory holds the two frames the record
names, taken after a press that was dispatched at painted pixels rather than
synthesised. `owner-answer.json` beside this file is the cleared arm's own
result file, as the harness wrote it.

**The BEFORE half of the pair is the story this change retires.** Until this
branch, the same card rendered with a yes/no hint and NO options at all; those
frames are still on `main` under
`docs/evidence/chat-ask-options/approval-unchanged/` (the story the two
`chat-ask-options/approval*` stories replace), and the swept half's own before
and after are the diff between that directory and this branch's
`chat-ask-options/approval/`.

Each record's `tree` also names the trees the frames were taken from
(`srcTree`/`head`, with `srcDirty` there to catch a run on an uncommitted
tree): this set's are `aabd6719b1` / `1249f8ebc3` — the folded tip this
branch ships at (the arms are re-run on the folded tree, because #521's
sidebar is painted in every one of them).

## Reproduction, from the repository

Everything is in the tree — the harness, the Vite config and
`scripts/click-proof.mjs` — and `harness/run-rig.sh` wires the pieces together,
drives one press and tears everything down by exact pid:

```sh
# 1. The default arm: Approve is pressed and the gate clears.
CLICK_PROOF_TARGET=Approve bash docs/evidence/approval-options-live/harness/run-rig.sh \
  docs/evidence/approval-options-live silent 0 - cleared

# 2. Deny: the same route, the other boolean.
CLICK_PROOF_TARGET=Deny bash docs/evidence/approval-options-live/harness/run-rig.sh \
  docs/evidence/approval-options-live/deny-click silent 0 - cleared

# 3. The refusal arm: the route refuses, and the card keeps the sentence.
CLICK_PROOF_TARGET=Approve bash docs/evidence/approval-options-live/harness/run-rig.sh \
  docs/evidence/approval-options-live/refused-card card-refusal 0 - refused \
  --reject-answers "This question or approval is no longer pending"
```

`RIG_PORT` (default 5302) and `RIG_SCRATCH_DIR` (default
`/tmp/approval-gate-rig`, the path painted in the frames' own chips) move the
run off a port or a scratch root a sibling session is holding.

This set is the ask set's rig ported to the approval gate, deliberately rather
than reinvented: `docs/evidence/ask-options-live/harness/` holds the original
harness, the driver's vocabulary contract and the two stand-ins the app needs
to boot in a plain browser (the preload shim, and the onboarding completion the
banner modal is settled with) — read that set's README for them; nothing here
changes what they do. What this set adds is the approval half of the gate: the
`_approval_gate` arm, the strict-boolean body `--pre-answer`/`--reject-answers`
speak, and records whose `ownerAnswer` is a verdict rather than a label.
