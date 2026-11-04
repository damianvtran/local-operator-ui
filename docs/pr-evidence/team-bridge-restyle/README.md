# Team Bridge visual restyle — evidence

Storybook (`team-bridge-*` stories), captured through the harness `browser` tool
(one tab, closed after capture). Story frames are 2560×1440 device px stored at 50%,
and the InShell frames are true 1380×900 and 800×700 viewports. `__before` is
`origin/main` @ `34a83080e6a` (before #1658's darker grounds). `__after` is this
branch after merging `origin/main` @ `70ad92c65ca`, which includes #1658, so the after
frames show the restyle on the final grounds and accents. Some of the before/after
difference on dark themes is therefore #1658's, not this PR's.

File name: `<state>__<theme>__<before|after>.webp`.

| State | Story |
|---|---|
| `channel-selected` | Team Bridge/Page › ChannelSelected |
| `populated-dm` | Team Bridge/Page › PopulatedDirectMessage (shows the "N new messages" divider, D10) |
| `hovered-row` | Team Bridge/Page › HoveredMessageRow (inset hover tint + overlay toolbar, D7) |
| `mention-row` | Team Bridge/Message mentions › Dark (C3 bar + wash on rows naming the viewer only) |
| `thread` | Team Bridge/Page › ThreadAtMinimumWindow |
| `thread-pane` | Team Bridge/Thread pane › Populated (`surface` plane + PanelEdge) |
| `reactions` | Team Bridge/Reactions › RealRowReactions (own pill = accent on accent-wash, D11) |
| `composer-focused` | ChannelSelected with the field focused (outline ring) |
| `loading` | Team Bridge/Page › Loading (rail + timeline skeletons) |
| `empty` | Team Bridge/Page › EmptyAccount (glyph, title, line, New message) |
| `error` | Team Bridge/Page › ErrorState (one copy of the failure, one Try again) |
| `in-shell-1380` / `in-shell-800` | Team Bridge/Page › InShellChannelSelected at 1380×900 and 800×700 |

The unread state (bold name, accent badge only for mentions/DMs, `#` channel
unread = weight only) is visible in every rail frame: `launch` has 3 unread and
`Ada's agent` has 2.

Themes: localOperatorDark, radient, localOperatorLight, dracula, nord.

`operator-live-vs-after__radient.webp`: the operator's live radient frame (left;
a DM with production data) beside the after InShell 1380 radient frame (right).
Storybook has no fixture that reproduces the live data, so the composition (shell,
rail, pane, composer) is the comparison here, not the conversation shown.

## Rail selected-row separation on the darker grounds (#1658 design D1)

Measured from `shared/themes/palettes/*.ts` on the merged head with
`scripts/color.mjs` `deltaE`. The rail is `surface`, and the contract floor for
`rowSelected` off it is `FIELD_SEPARATION_FLOOR` ΔE00 2.0, with `rowSelected` vs
`rowHover` at `ROW_PAIR_SEPARATION` 2.0. The last column is the C4 glyph pair,
accent on `rowSelected` (floor 3:1). All 41 dark palettes clear every floor;
the tightest separation is catppuccinMacchiato at 2.85.

| palette | ΔE00 rowSelected↔surface | ΔE00 rowHover↔surface | ΔE00 sel↔hover | accent on rowSelected (C4) |
|---|---|---|---|---|
| catppuccinMacchiato | 2.85 | 4.56 | 6.71 | 6.60:1 |
| solarizedDark | 3.00 | 3.86 | 4.82 | 5.20:1 |
| rosePine | 3.08 | 3.70 | 6.03 | 8.14:1 |
| palenight | 3.09 | 3.75 | 5.95 | 5.58:1 |
| cyberpunk | 3.41 | 3.90 | 6.35 | 12.48:1 |
| nord | 3.41 | 3.12 | 5.38 | 6.33:1 |
| catppuccinFrappe | 3.43 | 3.26 | 5.79 | 5.75:1 |
| outrun | 3.46 | 5.36 | 6.61 | 4.93:1 |
| synthwave | 3.50 | 4.88 | 6.67 | 6.10:1 |
| synth | 3.50 | 5.55 | 3.99 | 5.09:1 |
| tron | 3.63 | 3.27 | 5.55 | 8.55:1 |
| tokyoNight | 3.71 | 4.07 | 5.71 | 5.09:1 |
| vaporwave | 3.73 | 5.26 | 6.22 | 7.14:1 |
| tokyoNightStorm | 3.81 | 4.75 | 6.67 | 5.15:1 |
| autumn | 3.81 | 3.69 | 5.92 | 5.21:1 |
| nightfox | 3.85 | 4.24 | 6.13 | 4.82:1 |
| catppuccinMocha | 3.88 | 4.30 | 6.26 | 6.38:1 |
| dracula | 3.94 | 4.30 | 5.79 | 5.60:1 |
| rosePineMoon | 3.94 | 4.88 | 6.42 | 6.21:1 |
| neon | 3.97 | 3.75 | 5.76 | 9.93:1 |
| desert | 3.99 | 3.61 | 5.51 | 5.55:1 |
| lavender | 4.03 | 4.50 | 6.96 | 6.01:1 |
| forest | 4.08 | 3.96 | 6.66 | 6.20:1 |
| duskfox | 4.11 | 4.71 | 6.48 | 4.43:1 |
| ayuDark | 4.17 | 3.04 | 5.26 | 6.96:1 |
| ocean | 4.20 | 3.86 | 5.96 | 8.30:1 |
| arctic | 4.20 | 4.02 | 5.85 | 7.93:1 |
| radient | 4.30 | 3.76 | 5.56 | 6.00:1 |
| localOperatorDark | 4.37 | 2.25 | 5.37 | 6.61:1 |
| dune | 4.39 | 2.05 | 3.91 | 6.06:1 |
| oneDark | 4.49 | 2.93 | 4.89 | 5.51:1 |
| rosewood | 4.52 | 4.04 | 6.97 | 6.07:1 |
| ayuMirage | 4.54 | 3.56 | 5.77 | 7.25:1 |
| arcade | 4.57 | 2.02 | 3.17 | 9.84:1 |
| kanagawaWave | 4.60 | 3.59 | 6.10 | 4.95:1 |
| matrix | 4.67 | 3.74 | 7.06 | 8.33:1 |
| neonNoir | 4.78 | 2.93 | 5.57 | 6.50:1 |
| monokai | 4.85 | 2.75 | 5.83 | 8.69:1 |
| everforest | 4.87 | 3.09 | 5.45 | 6.17:1 |
| obsidian | 4.93 | 2.32 | 3.23 | 13.06:1 |
| gruvbox | 5.00 | 2.62 | 2.65 | 7.49:1 |
