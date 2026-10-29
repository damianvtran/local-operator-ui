# Team Bridge composer: before and after

Storybook frames of `Team Bridge/Page` -> `PopulatedDirectMessage`, captured from
two independent trees at 1440x900 through the preview iframe, same story, same
fixtures, same viewport.

- `before/` — `origin/main` at d8ad3e9f3b, the bespoke composer.
- `after/` — `feat/tb-shared-composer`, the shared `MessageInput`.

What the pair shows: the bespoke box offered a placeholder and a send arrow.
The shared band adds the attach control, the speech-to-text microphone, the
chips row and the composer's own `data-glass-region="composer"` band, and takes
the `frame` radius (16px) instead of `rounded-xl`.

Caveat, stated rather than papered over: the fixtures render relative
timestamps, so the two frames are three minutes apart (4:32 vs 4:29). Nothing
else differs — same rows, same members, same unread counts.

The capture also found and fixed a real regression: mounting `MessageInput`
made the page reach `window.electron.ipcRenderer` from a passive effect, which
Storybook's preview does not mock, so all thirty stories in
`team-bridge-page.stories.tsx` died in `commitHookEffectListMount`. The
side-effect import of `story-electron-shim` is that fix.

## State frames (`after/`)

Beyond the populated pair, the branch's own states: `channel-selected`,
`empty-account`, `loading`, `error-state`, `send-failed`,
`sending-disabled-composer`. They exist so a reviewer can judge the composer in
the states the populated fixture cannot show — disabled, failed, empty and
loading — instead of being told they look fine.

## Refreshed after the UX remediation

`after/populated-direct-message`, `after/channel-selected`, `after/send-failed`
and `after/sending-disabled-composer` were re-captured at head `f976d2c89c`,
because that commit changed visible copy: the Enter/Shift+Enter hint is back at
the point of typing, the alert under a failed send names the failure, and the
schedule clock states its reason. The frames above them predate it and would
have shown copy that no longer exists.

`after/empty-account`, `after/loading` and `after/error-state` are unchanged
from the earlier head on purpose: none of them renders a composer, so the copy
change cannot reach them.
