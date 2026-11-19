# Team Bridge — leave and return restores where you were

Frames of the shipped `TeamBridgePage`, captured from the Storybook story
`Team Bridge/Leave and return (live flow)`
(`src/renderer/src/features/team-bridge/team-bridge-view-restore.stories.tsx`).
The page mounts under a real `<Routes>`: "Go to chat" unmounts it the way the
app router does, "Back to Team Bridge" mounts a fresh one, and "Restart" also
clears the shipped QueryClient so only `localStorage` survives. Only the desktop
preload is controlled (two organizations, Minerva and Northwind). This is not
native-Electron evidence.

- Driver: `harness/capture.mjs`, run as
  `REPO=$PWD OUT=<dir> LABEL=<before|after> node scripts/with-storybook.mjs -- node <path>/capture.mjs`.
  A private `--headless=new` Chrome (scratch profile, `--use-mock-keychain`
  through `scripts/chrome-keychain.mjs`), raw CDP, reaped by exact pid; the
  Storybook is owned and torn down by `with-storybook.mjs`. Viewport 1280×800.
- `before-*` = `origin/main`'s `team-bridge-page.tsx` swapped into the same tree
  and the same story; `after-*` = this branch. Same driver, same steps.
- `*-log.json` records the selection read from the DOM at each frame, plus
  `returnSamples` / `restartSamples`: the selected row sampled on EVERY
  animation frame from the moment of return, so a one-frame #general flash would
  appear in the list.

| Step | before (main) | after (this branch) |
| --- | --- | --- |
| 02 select the DM with Ben (Minerva) | `person:acct_ben` | `person:acct_ben` |
| 04 go to chat, come back | **#general** | **ben** — samples `[null, person:acct_ben]`, no #general frame |
| 05 restart (only localStorage kept) | **#general** | **ben** |
| 06 switch to Northwind, pick #ops | `ops` | `ops` |
| 07 switch back to Minerva | **#general** | **ben** |
| 08 switch back to Northwind | **#general** | **#ops** |
