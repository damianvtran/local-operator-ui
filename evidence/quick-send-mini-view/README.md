# Quick send mini view — scene frames (PR evidence, not committed to main)

These are the `--scene mini-view` frames for the Quick send PR
(`feat/global-hotkey-quick-send`, #631), attached to the pull request from this
standalone branch so the PR's own diff carries no binaries.

Command (from the worktree, on the built tree):

```sh
pnpm build   # with the four VITE_* build vars the repo's plugin requires
node scripts/renderer-driver.mjs --scene mini-view --out <dir>
```

The run that produced these: 33 PASS / 0 FAIL, every frame captured at
1280x336 device px (640x168 CSS at dpr 2) from MAIN via `capturePage`, with
the window created `show: false` and never shown or focused (asserted per
frame). The `sending` and `sent` states are NOT here and are not reachable by
this rig: the send path runs through the desktop plane, whose gate admits by
frame, and the window a scene builds is not one the app created — so the live
pair belongs to the QA pass against the app's own window (stated in the PR).

- `mini-view-empty.png` — the resting state, Send disabled, ⌘⌥Space keycap.
- `mini-view-typing.png` — a draft, focus ring on the box, Send enabled.
- `mini-view-long.png` — a five-line draft scrolled at the fixed height.
- `mini-view-dictating.png` — recording (fake recorder), stop control.
- `mini-view-error.png` — the refusal with the draft kept and Retry.
