# Team Bridge current memberships and own-agent picker

Base: `2f5d8e3239` (`origin/main` at worktree creation). C1 bounded UI bug fix.

## Contract and cause

- The server database document is not the response contract. Inspected
  `radient-ml/agent-server` `origin/main` at `33bc2fa7d1e6b39535b82698c242459ca719826f`:
  `internal/responses/bridge_conversation.go` publishes `member_count`;
  `internal/services/bridge_conversation_service.go:871-873` derives it from
  active **and invited** participant rows. DB field absence is irrelevant.
- The UI's populated-row `conversationMemberCount` explicitly counted **active only**.
  One active owner plus three invited agents therefore rendered **1 member**.
  The fix derives total current membership from active + invited, excludes
  left/removed, and keeps a separate status breakdown. No permission gate changes.
- `chiefsOfStaff` explicitly excluded the reader by account id. Their human
  identity and their enrolled agent are distinct entities, so that exclusion
  wrongly hid an existing endpoint. The human row remains marked "you" and
  is not auto-added to picker selections.
- Directory agent data comes from `bridgeDirectoryAgent` in server
  `internal/services/bridge_read_service.go`: an existing active/paused CoS
  endpoint is projected. `DisplayAgentName` uses `AgentName`, otherwise endpoint
  `Label`. An absent endpoint `agent_name` can therefore appear as an owner-name
  fallback in directory `agent.name`; it does not prove a publication defect.
- Built-in `#agents` derives active, consent-bound endpoints in
  `internal/services/bridge_conversation_builtin_service.go:180-194`, without
  excluding the signed-in owner's endpoint. This fix changes no built-in
  recipient, endpoint, consent, membership or wake configuration.

## Dependency and non-goals

PR #1334 owns `ChiefLabels`, `composeChiefLabel`, stored-label serialization and
localized unnamed-CoS fallback. This branch deliberately does **not** duplicate
those helpers or their catalogue keys. Integration order is #1334, then this PR.
On the current base, owner-name fallbacks can still compose twice; honest
"Damian's chief of staff" rendering is not independently fixed here.

A configured endpoint does not prove a designated/wake-enabled session. The
integration parent's read-only runtime finding was `team_bridge.session` absent;
this slice does not designate one or modify runtime/production data.

No merge, release, feature flags, issues, reviewer requests or tags authorized.

## Actual light regression execution

Command, run on the newly written regressions before implementation, then after:

```sh
node --test scripts/team-bridge-model.test.mjs
```

Budget: one process tree, 1 GB, 120 seconds. Before: **34 pass / 5 fail**,
including expected four members versus actual one, and expected one self-agent
candidate versus actual zero. After: **39 pass / 0 fail**, 145.119375 ms.
Complete actual output: `model-before.log`, `model-after.log`.

Assertions cover four current memberships (no aggregate), left/removed exclusion,
stale aggregate avoidance, self endpoint with own name / empty name / owner-name
fallback, unchanged human-self marker, kind-qualified keys, explicit endpoint
serialization, and self-agent selection not adding a self-human recipient.

## Validation still pending

Heavy pre-push/typechecks, independent code/QA/design review and real rendered
before/after captures wait for the integration parent's shared validation slot.
Source-only tests are not rendered or end-to-end proof. New stories:
`FourMembersThreeInvited` and `OwnChiefServerFallback` on `TeamBridgePage`.
