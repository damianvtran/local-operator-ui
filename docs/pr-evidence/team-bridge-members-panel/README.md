# Team Bridge — members panel from the header count

Frames of the shipped components rendered by Storybook (`Team Bridge/Members panel`
and `Team Bridge/Page`), captured headless. This is Storybook evidence, not
native-Electron evidence; the page stories are transport-free.

- Driver: `harness/capture.mjs`, run as
  `REPO=$PWD OUT=<this dir> LABEL=<before|after> SHOTS=harness/shots-<label>.json node scripts/with-storybook.mjs -- node <this dir>/harness/capture.mjs`,
  wrapped in `~/local-operator/scripts/run_bounded.py` with `NODE_OPTIONS=--max-old-space-size=3072`.
  Private `--headless=new` Chrome (scratch profile, `--use-mock-keychain` via
  `scripts/chrome-keychain.mjs`), raw CDP, process group reaped by exact pid;
  Storybook owned and torn down by `with-storybook.mjs`.
- `*__before.png` = a separate `git worktree` at `origin/main` (a70a761), same
  driver and story (`team-bridge-page--channel-selected`); `*__after.png` = this branch.
- `after-log.json` / `before-log.json` record, per frame, the DOM facts read at the
  shutter: theme, focused element, whether the panel is mounted, the count
  button's accessible name, the panel row count and any open dialog title.

| Frame | What it shows |
| --- | --- |
| `header-count*__before` | main: the count is inert text; hovering changes nothing |
| `header-count*__after` | the count is a button named "View 2 active members, 1 invited"; quiet text at rest, hover adds the `row-hover` fill plus an ink step (round 1, D1); keyboard focus paints the outline ring |
| `page-panel-docked__*` | 1440px: panel docked in the thread pane's slot, ground step, no border |
| `page-panel-takeover-900__*` | 900px: panel takes over the conversation region (thread pane geometry) |
| `panel-populated__{localOperatorDark,localOperatorLight,dracula,tokyoNight}` | owner viewer; Owner as quiet text after the name (round 1, D4), Invited / Pending approval chips. Light and dark recaptured in round 1; dracula/tokyoNight are round 0 (chip shown) |
| `panel-row-hover__*` | row hover fill + revealed remove action. Light recaptured in round 1: `surface` step on the canvas ground (D2); dark is round 0 |
| `panel-many-members__*`, `panel-search-with-query__*`, `panel-search-no-match__*` | 23 rows, search visible past 8; filtered; no-match state |
| `panel-non-owner-viewer__*` | plain member: no removes, Leave on own row only |
| `panel-leave-confirm-open__*` | confirm names member and conversation (round 0 frame; leave body copy changed in round 1, not recaptured) |
| `panel-action-refused__*` | server refusal stated inline |
| `panel-builtin-general__*`, `panel-builtin-agents__*` | quiet explanatory line; no remove (Leave only on #agents). Round 0 frames (English copy unchanged in meaning) |
| `panel-builtin-general-ur__localOperatorLight` | round 1, UR-M3: the channel arrives as `{channel}` wrapped in U+2066…U+2069 (DOM codepoints read at the shutter). Storybook sets no `<html dir>` (QA N2), so this frame's paragraph is LTR; the RTL reorder proof is `fribidi --rtl`: literal → `general#`, isolated → `#general` |
| `panel-remove-confirm-open__*` | round 1 copy: "They’ll stop getting this conversation’s messages…" (N3/D5) |

## Round 3 (post-#1668) — convergence frames

`r3-*__after.png` frames come from the merge head that integrates origin/main c58127c (#1668 restyle, #1625, 0.48.16). They were captured through the harness browser tool against `with-storybook.mjs` on port 6871, with Storybook reaped by exact pid afterwards. These are Storybook frames, not native Electron.

| Frame | What it shows |
| --- | --- |
| `r3-header-count__{localOperatorDark,localOperatorLight}` | #1668's one-line header: name │ count button │ topic. The count is the button ("View 2 active members, 1 invited", `aria-expanded=false` read from the a11y tree) and stays quiet `ink-muted` text at rest |
| `r3-header-count-hover__*` | the D1 hover fill, now `surface` on the pane's `canvas` ground (#1668 moved the conversation pane to canvas), plus an ink step. Light measures surface/canvas 1.070:1 |
| `r3-page-panel-docked__localOperatorDark` | panel docked in the thread slot at 1440px |
| `r3-panel-populated__{localOperatorDark,localOperatorLight}` | the panel on `surface` with the `PanelEdge` seam, matching the thread pane after #1668 (R4); round `TeamBridgeAvatar` wash plates |
| `r3-panel-row-hover__localOperatorLight` | row hover is now `elevated` on `surface` (the thread's compact-row step): 1.072:1 in localOperatorLight, min 1.062:1 across 59 palettes (cyberpunk), light min 1.065:1 (mintLight) |
