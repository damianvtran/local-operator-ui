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
