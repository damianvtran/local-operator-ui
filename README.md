# Team Bridge membership events + v3 members footer — frames

Surface: Storybook iframe, captured with the harness `browser` tool (one tab; Storybook was one instance run with NODE_OPTIONS=--max-old-space-size=1536 and reaped by exact pgid). Pinned TZ is America/New_York, and every capture is 2560x1440 from a 1024x576 viewport.
- after-*: worktree branch fix/team-bridge-member-events (stories `Team Bridge/Member events/*`, `Team Bridge/Add members/Populated`)
- before-*: origin/main fd9798518f0 running the SAME story file copied in. main's list has no `events` prop, so the line is absent there. The footer shows v2.

| frame | what |
|---|---|
| after-single-invite-{light,dark,tokyoNight} | single invite line after message 1 |
| after-rollup-* | two events, same request_id + kind -> "Ben Tran, Sana Ketabchi, and 2 others" |
| after-rollup-tooltip-focus-* | full list Tooltip, opened by KEYBOARD FOCUS (play: Tab), not hover. The browser tool cannot produce CSS :hover |
| after-joins-leaves-removals-* | owner-implicit join ("added their agent"), consented, left, removed, unknown kind -> "Membership changed" |
| after-no-events-field-absent-* | `events` absent: identical to before |
| after-members-footer-* | members dialog footer, invitation_note_v3 (English; translations pending audit) |
| before-single-invite-*, before-joins-leaves-removals-* | origin/main timeline, no event line |
| before-members-footer-* | origin/main footer, v2 copy |
