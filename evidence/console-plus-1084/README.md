# PR #1183 (fixes #1084): console `+` before/after frames

- **head** `8615b262be21ad2b4d2ab0fbe41ccc87a4ed0186` (worktree `lui-console-plus-1084`, built in place with `electron-vite build`)
- **base** `4579fc97ea9173476fccc5d7f55c7ef49733b7a2` (origin/main before the fix; a scratch detached worktree, node_modules symlinked, built the same way, then removed)
- Window: 1440×900 CSS px, DPR 1 (`Emulation.setDeviceMetricsOverride`). Theme: `localOperatorDark` (default; `html.dark`).
- Build: `VITE_GOOGLE_*` / `VITE_MICROSOFT_*` set to the placeholder `qa-local`. OAuth is not exercised, and nothing is drawn from them.
- Lossless WebP (`cwebp -lossless`) made from CDP `Page.captureScreenshot` PNGs.

## Rig
`node frames-rig.mjs <tree> <base|head> <port>`, run with every `CMUX_*`/`LOP_*` variable unset. The script is in the session scratchpad and is derived from the earlier round's `plus-rig.mjs`. It does this:
- runs the built app headless (`--window-mode=headless`) with a scratch HOME, config dir and user-data dir;
- turns telemetry and notifications off;
- starts a private `lop serve --hosting test --model mock-model` on 18761 (base) or 18762 (head);
- uses a seeded 4-row conversation `qa 1084`;
- kills every child's process group by pid, then deletes the scratch dirs.

## Frames (the same names in `base/` and `head/`)
| frame | step | base | head |
|---|---|---|---|
| `a-one-terminal` | one terminal (made through empty-state create), before `+` | selected con:1, caret in console | selected con:1, caret in console |
| `b-after-plus` | right after `+` | **selected = OLD con:1** | **selected = NEW con:2** |
| `c-typed-marker` | after typing `echo QA1183_<label>` | marker went into the **old** surface (console_read: new=false, old=true) | marker went into the **new** surface (new=true, old=false) |
| `d1-empty-state` | every surface closed | empty state; focus on the `+` button | same |
| `d2-after-empty-create` | after the empty-state create | new con:3 selected; **focus stays on the `console-new-surface` button**, not in the terminal | new con:3 selected; **caret in the console** |

For every frame, `results.json` records `sha`, `selected` (the surface id of the `aria-selected` tab), `activeSurface` (where `document.activeElement` sits: `mirror` means the terminal view, otherwise the element's tour tag), `inMirror` and `rows`.

## What a capture may claim
- A frame claims only the screen at that instant. The claims about which surface is selected, where focus is, and where the typed text went come from `results.json`: DOM reads plus `console_read` over the app's RPC, taken in the same step. They do not come from the pixels.
- **Frames (b) and (c) look almost the same on base and head.** Both tabs are labelled `zsh`, and the tab strip puts the selected tab first. Base also reorders the tabs between (b) and (c). So the pixels do not show which terminal is which. The proof of #1084 is `results.json`: the selected id after `+`, and the console_read showing which surface got the marker.
- The (d2) difference (caret in the terminal vs. on the button) shows in the pixels only as a focus/caret difference. `activeSurface` is the evidence.
- Timestamps and the shell prompt (`user@host`) come from the host. They are in the host's local zone (America/New_York) and are not part of the claim.
- Not covered: other themes or sizes, real windowed (non-headless) focus, and keyboard-shortcut entry to `+`.
