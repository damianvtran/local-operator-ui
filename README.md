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

## Round 4 (`after-r4/`)

Frames and geometry for round 3's remediation on PR #884, from head `a3e5f52ca57`. Every
story at 1024x725 and 800x700, dark and light (70 of the 76 are byte-identical in pixels to
`after-r3/` within a 12/765 channel tolerance; the six that differ are the two Add member
frames per theme/size and two one-line antialiasing differences in `team-running` and
`team-stop-refused`). Plus: `cue-rest__*` (the footer cue at rest, six states),
`add-after6__team-editing__1024x725` (Add member after six adds, focused),
`bar-open-tab-route__1024x725` (the discard bar opened by a mouse press on the Agents tab),
`rule-rest__team-editing__1024x725__<palette>` (the footer's top rule in five palettes) and
`placeholder-pane{416,476,540}` (the exact-string pin's measurement). `r4-focus.json`,
`r4-add.json` and `probe-placeholder.json` are the raw numbers; `acceptance-r4.md` computes
each finding's criterion from them. The sweep freezes animations, so the scroll-driven cue is
absent from the `__dark/__light` frames by design: the live frames above are the cue's evidence.
