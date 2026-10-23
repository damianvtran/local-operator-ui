# A team's New chat must never open a deleted conversation

The operator's report (2026-10-22): pressing a **team** in the sidebar to start a
new chat rendered a transcript that said *"This conversation is no longer on this
machine"* with the composer replaced by *"This conversation is gone"* — under a
header that said **"New chat with \<team\>"**.

The screenshots are the same scene (`--scene stale-team-draft`) run against the
same isolated daemon and the same provider state, on two source trees.

| frame | source | reading |
| --- | --- | --- |
| `before.png` | `origin/main` | header *New chat with minerva-development* / device chip *On this device*; body *This conversation is no longer on this machine…*; composer *This conversation is gone*, `readOnly: true`; stored `sessionId` still `deadbeef0001` |
| `after.png` | `fix/team-new-chat-stale-draft` | same title, device chip now *New on this device* (the chip reads the conversation state too); **no notice**; an editable composer holding the message the failed send was carrying (*"Can you pick up where we left off?"*) |
| `control.png` | same branch, same daemon, **no seeded draft** | the app's own empty new chat: no notice, editable composer. It is the control for the after frame — the toolbar's model chip reads "Retry" on the seeded row (a team target the run-owned daemon does not have, so its model could not be resolved) and "Choose a model" here. Neither is a leftover of this defect: QA round 1 measured the chip's `aria-label` (`Model: this conversation's model was not resolved. Retry.`) and pressed it — nothing changed |

The scene seeds the persisted pair that produces the screen — the team's stable
`draft:team:<name>` row carrying the `sessionId` its create wrote, `activeDraftKey`
naming that row, and a tombstone for the id — then reloads, which is how the
store meets the pair on a relaunch. The press itself is not driven because a
run-owned daemon has no authored team for the sidebar to list; the press's own
rule (`stageDraft` never reuses a conversation-bound row for a New-chat press) is
covered by `scripts/team-new-chat-stale-draft.test.mjs`, which drives the store
directly — and independently by QA's own scene, which authored a team through the
daemon's routes and pressed the real `[aria-label="New chat with …"]` button.

## Reproducing the pair

Both runs used an isolated daemon started from the installed runtime, a scratch
`LOCAL_OPERATOR_CONFIG_DIR`, a fresh `LOCAL_OPERATOR_DESKTOP_TOKEN`, and a free
loopback port — never the operator's own backend on 1111. The renderer was built
against the same URL:

```bash
VITE_GOOGLE_CLIENT_ID=… VITE_GOOGLE_CLIENT_SECRET=… \
VITE_MICROSOFT_CLIENT_ID=… VITE_MICROSOFT_TENANT_ID=… \
VITE_LOCAL_OPERATOR_API_URL="http://127.0.0.1:<port>" \
VITE_DISABLE_BACKEND_MANAGER=true pnpm build

LOCAL_OPERATOR_DESKTOP_TOKEN=<token> node scripts/renderer-driver.mjs \
  --scene stale-team-draft --seed-onboarding-complete \
  --backend "http://127.0.0.1:<port>" --out <dir>
```

The before run's own checks record the defect:

```
[PASS] the header names the press's own act: a NEW chat with the team
[FAIL] the terminal 'no longer on this machine' notice is NOT rendered
[FAIL] a working composer is on screen, which is what one click must always end with
        {"value":"","disabled":false,"readOnly":true}
[FAIL] and the dead pointer was retired before the first paint
        {"sessionId":"deadbeef0001","pending":false}
```

The after run passes all four (and the control leg), and writes
`stale-team-draft.png` / `stale-team-draft-control.png`.

## The header rule has no frame of its own

`resolveChatTitle`'s session-bound branch (the header naming the conversation a
staged draft already created) is exercised by `scripts/chat-title.test.mjs`: a
named live conversation, a deleted conversation's remembered name, and the
first-send window where the create has answered but no name exists yet (it keeps
the target's name rather than falling to "Untitled chat", design review round 1's
D1). A rendered frame of that state needs a NAMED conversation with a staged draft
bound to it, which a run-owned daemon can only reach by sending a message and
forcing the acknowledgement to fail; the rule's three inputs are pinned by the
suite instead, and this is stated rather than implied.
