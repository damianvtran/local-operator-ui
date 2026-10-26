# Team Bridge archive — design review round 1 (PR #1438 @ fe90228b)

Storybook frames, captured with the harness browser tool at 2560x1440 (@2x), theme
`localOperatorDark` unless the file starts with `L` (`localOperatorLight`).

- `00-before-*` = merge base f1aca593 (archived rows sit in the rail); `00-after-*` = PR head.
- 01–12: the PR's own `Team Bridge/Archive` stories (10b/11 typed into the field live).
- 13–17: review-only scratch stories (NOT in the PR) that feed the page the props the
  container produces after an archive, after a delete, a long channel name, and an
  archived channel opened from the Archived view (`messageState: "idle"`, no messages).

The lower band under the panels in every frame is the Storybook host (the same band
appears on the base `Team Bridge/Page` stories), not this PR.
