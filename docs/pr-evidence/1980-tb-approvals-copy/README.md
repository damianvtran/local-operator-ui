# PR #1980 — Team Bridge approvals, device-neutral copy: before/after frames

Every frame is a `Team Bridge/Requests` Storybook story (English, `localOperatorDark`,
2560×1440), captured through the harness browser: one tab, one Storybook booted by
`scripts/with-storybook.mjs` on port 6391 and reaped by process group. `before-*` is
origin/main 1fb3d656c3 catalogues; `after-*` is this branch. These stories are
presentational. They are not the live daemon path.

| Story | Before | After |
|---|---|---|
| Populated | intro says "Each decision is confirmed with Touch ID."; the no-card row says "this Mac" | intro has no confirmation claim; the no-card row says "this computer" |
| Empty | same intro claim | intro has no confirmation claim |
| Authorizing | "Waiting for Touch ID…" | "Checking your decisions…" (with v0.107.2+ no prompt appears) |
| PresenceRequired | "Touch ID isn't available on this Mac…" | "This computer can't confirm decisions with your device password or biometrics…" (older backends only) |
| Cooldown | "Touch ID was just dismissed…" | "The confirmation prompt was just dismissed…" (older backends only) |
| ForeignPromptTrace | "A Touch ID check not started in this window…" | "A confirmation prompt not started in this window…" (older backends only) |
| PromptNoticeOwn / PromptNoticeForeign | "Touch ID is asking you to confirm N decisions" | "Your computer is asking for your device password or biometrics to confirm N decisions" (older backends only) |
