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
integration parent's initial read-only runtime finding was `team_bridge.session`
absent. Aida subsequently reported that manual designation plus cache expiry
produced `agent_name='Aida'` after 320 seconds, with endpoint label unchanged;
no restart was needed. That does not prove recipient wake or cross-user delivery.
This UI slice does not designate a session or modify runtime/production data.

No merge, release, feature flags, issues, reviewer requests or tags authorized.

## Actual light regression execution

Command, run on the newly written regressions before implementation, then after:

```sh
node --test scripts/team-bridge-model.test.mjs
```

Budget: one process tree, 1 GB, 120 seconds. Before: **34 pass / 5 fail**,
including expected four members versus actual one, and expected one self-agent
candidate versus actual zero. After: **39 pass / 0 fail**, 145.119375 ms.
Complete actual output: `model-before.txt`, `model-after.txt`.

Assertions cover four current memberships (no aggregate), left/removed exclusion,
stale aggregate avoidance, self endpoint with own name / empty name / owner-name
fallback, unchanged human-self marker, kind-qualified keys, explicit endpoint
serialization, and self-agent selection not adding a self-human recipient.

## Rendered validation on the granted serial slot

Normal pre-push hooks passed (changed-file script/src lint and both serial
TypeScript projects). The hook initially caught a story non-null assertion;
an explicit endpoint guard fixed it without bypass.

One capped Storybook dev server on 127.0.0.1:6017 served real React components.
No install, desktop launch or substitute browser was used. The browser tool
captured the baseline by temporarily restoring **only** model/page to base
`2f5d8e3239`, keeping identical production-shaped story data. Then both files
were restored exactly to committed head `2babb573ac` (verified with git diff).

Observed before: 1 member; self endpoint absent from rail and picker.
Observed after: 4 members, 1 active · 3 invited; named self endpoint offered as
Aida (Damian Tran), selected into exactly one agent chip while human remains
Damian Tran (you). The controlled story enables real select/remove transitions.
Header geometry: 1280×720 CSS viewport; rail 288px; thread header 992×44px.
Two consecutive count frames have identical SHA-256: no observed settle reflow.

**Dependency still open:** fallback-name endpoint is now offered, but renders
Damian Tran (Damian Tran) on this branch alone. This captured limitation is not
called fixed; #1334 must land first and a combined naming regression must pass
before the full user request is considered integrated. No combined-tree claim.

Frames are retained under ignored `docs/evidence-frames/tb-members-self-cos/`,
not committed binaries. `frames.json` binds actual filenames/bytes/hash. Source
and locale reviews are independent; QA independently exercised the running
stories. Review comments record their actual bounds. English rendered coverage
is not an all-locale layout or real backend delivery claim.
