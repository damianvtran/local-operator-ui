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
