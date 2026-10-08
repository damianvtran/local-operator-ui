# Agents and Teams page polish: before/after frames

Evidence for the PR from `feat/agents-teams-ux-polish`. Frames are the real `AgentsPage`
over a stubbed desktop bridge (stories in `agents-teams.stories.tsx`), captured by one headless
Chrome over CDP at 1024x725 (the operator's window), 1440x900 and 800x700, in `localOperatorDark`
and `localOperatorLight`. File names: `<story>__<WxH>__<dark|light>.webp`.

- `before/` - origin/main c14e07d95b0 plus the story harness only (5485c781bec).
- `after/` - the PR head. Includes composer-state stories that have no before (About set,
  blocked by a dirty edit, running, settled, error with Retry, stop refused, an awkward team).
- `acceptance.md` - the design spec's criteria computed from each frame's geometry JSON.

Stand-ins, stated: the app sidebar rail and OS title lane are not rendered (the page is mounted
alone), so a real window's detail column is narrower than these frames'; "Watch open" is not framed.

## Round 2 (`after-r2/`)

Frames and geometry for the remediation round on PR #884, taken from the branch head after
the remediation commits. The six original stories at 1024x725 dark and light are re-shot;
the rest are the stories whose frame can change, plus new ones for the round's findings:
`team-settled-long` (28-line answer), `team-error-long` (~330-character provider error),
`team-no-count-long-about` (member with no count, long About name, a team with no
description), `team-editing-add-member` (Add member focused by keyboard), `agent-more-actions-open`
(the open menu), `team-composer-unavailable` (backend without `agents_config`; also
`team-composer-unavailable__476pane.png`, the real shell's 476 px pane). `*-focus-ring__1024x725.png`
are 2x crops of the trailing ghost buttons' focus outline against the viewport edge.

- `acceptance-r2.md` - every criterion with the measured value, computed from `accept-r2.json`.
- `n-origin-main-repro.json` / `n-branch-fixed.json` - the U5/U6/U9 probes run on origin/main
  and on the fixed branch.
- Not framed: the Watch list (needs a session transcript stream the stub bridge cannot serve).
