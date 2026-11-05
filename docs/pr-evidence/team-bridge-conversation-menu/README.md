# Team Bridge — conversation menu on sidebar rows and header

**Rendered evidence captured (2026-11-04).** All 4 before frames from base
`7345dcbf238`, all 26 original after frames, and 2 extra #agents confirms from
source `129897358386` are present. All 32 were visually inspected in eight
four-frame contact sheets; none is a placeholder. `before-log.json` and
`after-log.json` record the Storybook states and browser snapshots. These are
component/page-fixture frames, not proof of live Team Bridge backend writes.

## Harness

The committed PNGs use **one reused Local Operator `browser` tool tab** against a
static Storybook build, not a private browser. The build narrowed `stories` to
`team-bridge-conversation-menu.stories.tsx` and `team-bridge-page.stories.tsx` in a
temporary config that reused `.storybook/main.ts`, `preview.tsx` and
`preview-head.html`; no product source was modified. It completed in 349.5 s
with `NODE_OPTIONS=--max-old-space-size=1536`, a 3000 MiB process-group ceiling,
and `scripts/run_bounded.py`. The browser host captured 2560×1440 PNGs.

The static server uses Python's `ThreadingHTTPServer` with
`request_queue_size = 128`. A plain `python3 -m http.server` initially dropped
parallel CSS/module connections with its small accept backlog; the files existed
and returned HTTP 200 when checked individually. Increasing only the backlog
made the same static build render successfully.

Reusable capture-host artifacts (session-local; not a shipped app):

```sh
python3 docs/pr-evidence/team-bridge-conversation-menu/harness/serve.py \
  ~/.local-operator/sessions/0bebcd0bcbc3/scratchpad/pr1681/sb-after 51882
# browser tool URL:
# http://127.0.0.1:51882/iframe.html?id=<story-id>&viewMode=story&args=theme:localOperatorDark
```

`harness/shots-after.json` is the frame/story manifest. Hover and focus frames
use the browser's `hover` and `press` actions (Shift+Tab then Tab, starting on the
row). The two `row-right-click` frames use the existing
`team-bridge-conversation-menu--row-right-click` story's `play`, which dispatches
`contextMenu` on the real row component. They show the resulting menu, **not a
physical right-click input test**. The browser tool currently exposes no
right-click input action. For the #agents confirm: open
`team-bridge-page--conversation-menu-header`, press Escape, click **More actions
for agents**, then **Leave channel**. Both themes show: “You’ll stop getting its
messages. Your agent stays in #agents; pause it to take it out.”

Method disclosure: an initial legacy `harness/capture.mjs` raw-CDP attempt
captured one frame before failing to load a module on the second story. Its
private headless Chrome used `--use-mock-keychain` and was reaped by exact pid.
That first frame was overwritten by a fresh browser-tool capture; no committed
frame relies on the private Chrome run. Subsequent capture followed the
harness-browser policy. The agent began on anthropic/claude-opus-5-5 and the
runtime fell back to openai/gpt-6.1-sol after a provider quota failure.

The before static build exceeded the 3000 MiB group ceiling while rendering
chunks. A second attempt with minification/compression-size reporting disabled
was externally SIGKILLed before producing `iframe.html`. One bounded narrowed
**Storybook dev** fallback (base `7345dcbf238`, only `team-bridge-page.stories.tsx`,
1536 MiB Node heap / 2200 MiB group ceiling) then rendered successfully; the same
browser-tool tab captured all four before frames. No real-app fallback or live
account/session data was needed. The base worktree and all owned server/browser
processes were cleaned up after capture.

## Frame inventory

`shots-before.json` (temporary detached base worktree at `7345dcbf238`), 4 frames:

| Frame | Story | Shows |
| --- | --- | --- |
| `header-menu__{localOperatorDark,localOperatorLight}__before` | `team-bridge-page--agent-wake-menu` | today's header menu: Mute, levels, Wake your agent for; no Leave, no Members |
| `row-hover__{…}__before` | `team-bridge-page--channel-selected` + hover | a plain rail row (no "…" unless archivable) |

`shots-after.json` (this branch), the original 26 frames plus 2 #agents confirms:

| Frame | Story | Shows |
| --- | --- | --- |
| `header-menu__{dark,light}` | `team-bridge-page--conversation-menu-header` | same room as the before frame: View members, Add members…, levels, wake group, Remove Aida, Leave group |
| `row-menu-channel__{dark,light,dracula}` | `team-bridge-conversation-menu--row-menu-channel` | row "…" open on #launch, same items |
| `row-menu-general__{dark,light}` | `…--row-menu-general` | Leave disabled: "Everyone in the organization is a member — mute it instead" |
| `row-menu-agents__{dark,light}` | `…--row-menu-agents` | Remove Aida disabled: "Pause your agent to take it out of #agents" |
| `rows-at-rest__{dark,light}`, `row-hover__{dark,light,dracula}`, `row-focus__{dark,light}` | `…--rows-at-rest` | trigger hidden at rest; on hover/focus it takes the count/bell slot, label unmoved |
| `row-right-click__{dark,light}` | `…--rows-at-rest` + `context:` | right-click opens the same menu |
| `leave-confirm__{dark,light}`, `remove-agent-confirm__{dark,light}`, `remove-agent-not-in-general__{dark,light}` | confirm stories | confirm copy; the #general 404 stated plainly |
| `partial-leave__{dark,light}` | `team-bridge-page--conversation-menu-partial-leave` | "You left #launch. Your agent is still in this conversation." + Remove my agent / Dismiss |
| `leave-confirm-agents__{dark,light}` | `team-bridge-page--conversation-menu-header` + Escape → agents row menu → Leave | Agent explicitly stays in #agents; pause it to take it out |
