# Team Bridge — conversation menu on sidebar rows and header

**Frames pending: host memory.** The capture host could not hold a Storybook
dev server for this PR (2026-11-04): three attempts were ended by the machine's
memory guard (two full-tree, one narrowed to the two story files), with free
memory at 38–47%. No frame in this directory has been captured yet; nothing
below is claimed as rendered evidence until the PNGs exist and have been looked
at.

## Harness

Copied from `docs/pr-evidence/team-bridge-members-panel/harness/` (#1670) with
two additions: a `context:<css>` action (a real right-click through CDP, so
Chrome dispatches `contextmenu`), and per-frame `menu` (item labels, disabled
ones prefixed) and `partial` facts in the log.

```
REPO=$PWD OUT=<this dir> LABEL=<before|after> SHOTS=harness/shots-<label>.json \
  node scripts/with-storybook.mjs -- node <this dir>/harness/capture.mjs
```

wrapped in `~/local-operator/scripts/run_bounded.py` with
`NODE_OPTIONS=--max-old-space-size=2048`. Private `--headless=new` Chrome
(scratch profile, `--use-mock-keychain`), process group reaped by exact pid.

## Frames to capture

`shots-before.json` (a worktree at `origin/main`), 4 frames:

| Frame | Story | Shows |
| --- | --- | --- |
| `header-menu__{localOperatorDark,localOperatorLight}__before` | `team-bridge-page--agent-wake-menu` | today's header menu: Mute, levels, Wake your agent for; no Leave, no Members |
| `row-hover__{…}__before` | `team-bridge-page--channel-selected` + hover | a plain rail row (no "…" unless archivable) |

`shots-after.json` (this branch), 26 frames:

| Frame | Story | Shows |
| --- | --- | --- |
| `header-menu__{dark,light}` | `team-bridge-page--conversation-menu-header` | same room as the before frame: View members, Add members…, levels, wake group, Remove Aida, Leave channel |
| `row-menu-channel__{dark,light,dracula}` | `team-bridge-conversation-menu--row-menu-channel` | row "…" open on #launch, same items |
| `row-menu-general__{dark,light}` | `…--row-menu-general` | Leave disabled: "Everyone in the organization is a member — mute it instead" |
| `row-menu-agents__{dark,light}` | `…--row-menu-agents` | Remove Aida disabled: "Pause your agent to take it out of #agents" |
| `rows-at-rest__{dark,light}`, `row-hover__{dark,light,dracula}`, `row-focus__{dark,light}` | `…--rows-at-rest` | trigger hidden at rest; on hover/focus it takes the count/bell slot, label unmoved |
| `row-right-click__{dark,light}` | `…--rows-at-rest` + `context:` | right-click opens the same menu |
| `leave-confirm__{dark,light}`, `remove-agent-confirm__{dark,light}`, `remove-agent-not-in-general__{dark,light}` | confirm stories | confirm copy; the #general 404 stated plainly |
| `partial-leave__{dark,light}` | `team-bridge-page--conversation-menu-partial-leave` | "You left #launch. Your agent is still in this conversation." + Remove my agent / Dismiss |
