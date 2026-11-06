# Radient callout: no terminal advice, and the `not-cleared` state

Storybook frames of `chat/radient-session-issue` (the shipped
`RadientSessionIssueCallout`), captured through the harness browser against
`storybook dev -p 6391` on this branch. Viewport 1280x720 at 2x; the callout
sits top-left in its story frame (720 px, or 440 px for the narrow story).

- `before-needs-sign-in.png` - origin/main's component in the same story: the
  hard-coded English line "If signing in does not clear this, run lop login
  radient in a terminal." under the action.
- `after-needs-sign-in.png` - this branch: the line is gone.
- `after-not-cleared.png`, `after-not-cleared-narrow.png` - the new state after
  a completed sign-in the backend could not heal: in-app next steps only
  (Settings, under Providers; Open Radient console) plus the retry.
- `after-signing-in.png`, `after-failed.png` - unchanged neighbours, for
  regression comparison.
