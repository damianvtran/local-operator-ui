# A team's New chat must never open a deleted conversation

The operator's report (2026-10-22): pressing a **team** in the sidebar to start a
new chat rendered a transcript that said *"This conversation is no longer on this
machine"* with the composer replaced by *"This conversation is gone"* — under a
header that said **"New chat with \<team\>"**.

The screenshots are the same scene (`--scene stale-team-draft`) run against the
same isolated daemon, on two source trees.

| frame | source | reading |
| --- | --- | --- |
| `before.png` | `origin/main` | header *New chat with minerva-development*, body *This conversation is no longer on this machine…*, composer *This conversation is gone* (`readOnly: true`) |
| `after.png` | `fix/team-new-chat-stale-draft` | same header, no notice, an enabled composer (*"Ask anything. @ adds files, / runs commands"*) |

The scene seeds the persisted pair that produces the screen — the team's stable
`draft:team:<name>` row carrying the `sessionId` its create wrote, `activeDraftKey`
naming that row, and a tombstone for the id — then reloads, which is how the
store meets the pair on a relaunch. The press itself is not driven because a
run-owned daemon has no authored team for the sidebar to list; the press's own
rule (`stageDraft` never reuses a conversation-bound row) is covered by
`scripts/team-new-chat-stale-draft.test.mjs`, which drives the store directly.

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
[FAIL] and the dead pointer was retired before the first paint
        {"sessionId":"deadbeef0001","pending":false}
```

The after run passes all four, and `frames: stale-team-draft.png` in both.
