# Thread row: before/after Storybook frames

Re-captured 2026-11-04 (design round 1 remediation, D1) with the harness `browser` tool (the operator's app browser host), through the
tokened Storybook manager URL `/?path=/story/team-bridge-thread-row--<story>&args=theme:<theme>&full=1`.

- `before-*`: origin/main `a70a761ae47`, with an uncommitted copy of the four `List*` stories
  (same fixtures, rendered through the real `TeamBridgeMessageList` on the channel column's real `bg-surface` ground, so the old pill is drawn).
- `after-*`: this branch, stories in `src/renderer/src/features/team-bridge/team-bridge-thread-row.stories.tsx`.

| State | Story | Dark | Light |
|---|---|---|---|
| No replies (row absent) | `list-no-replies` | before/after `-no-replies-dark.png` | `-no-replies-light.png` |
| Read thread | `list-read` | `-read-dark.png` | `-read-light.png` |
| Unread (12 of 18) | `list-unread` | `-unread-dark.png` | `-unread-light.png` |
| Many participants (5, 3 shown, one agent) | `list-many-participants` | `-many-participants-dark.png` | `-many-participants-light.png` |

Themes: `localOperatorDark`, `localOperatorLight`. Fixture data is synthetic (no hub involved).

Extra after-frames (round 1 remediation):

- `after-unread-hover-dark.png`: pointer over the row; the row takes `sunken` inside the message row's `row-hover` (D1/D2).
- `after-over-cap-dark.png`: 150 unread → `99+ unread` (Q2).
- `after-narrow-old-reply-light.png`: 360px column; the "Last reply" prefix drops and the date with its year stays (D3).
- `after-thread-pane-host-dark.png`: the thread pane's `canvas` host, with the facepile ring following it (D1).

Each Storybook ran alone under `scripts/with-storybook.mjs` from its own tree (`NODE_OPTIONS=--max-old-space-size=1024`), and was reaped before the next started.

Convergence with #1668 (2026-11-04): the channel timeline is now `canvas` and the thread pane `surface`, so the stories moved
to those grounds and these after-frames were re-captured: `after-{read,unread}-{dark,light}.png`, `after-unread-hover-dark.png`,
`after-thread-pane-host-dark.png`. Measured on `list-unread` (LO dark): row background transparent, facepile ring `#1d1b17`
(= canvas), height 32px. The before frames and the other after frames are unchanged (they predate #1668's grounds; the
before set is origin/main `a70a761` as recorded above).

Round 3 (D6): `after-mentioned-unread-{dark,light}.png` - story `list-mentioned-unread`, a thread root that mentions the reader (#1668 accent-wash). Measured in LO dark: facepile ring `#13241A` = `--lo-accent-wash`.
