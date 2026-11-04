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

The unread state is visible in every rail frame: `launch` has 3 unread and
`Ada's agent` has 2. Both rows are semibold and both carry the accent count.
SPEC §3.2 asks for weight-only plain-channel unread, with the badge reserved for
mentions and DMs. That is NOT implemented: the conversation contract carries no
mention count, so dropping a channel's count would also hide a channel
@-mention. The count register is `origin/main`'s `unreadRegister`, unchanged
here. See Deviations in the PR body (UX round 1, U3).

Themes: localOperatorDark, radient, localOperatorLight, dracula, nord.

### Round-1 remediation frames

All `__after` frames above were re-captured on the round-1 remediation head:
every plate is now the one `accent-alt-wash` disc (D1), Send is a ghost glyph at
rest (D3), the header shows the user-set topic (D2), and empty-section lines are
one truncated line (D4). Added:

- `r1-sticky-pill-grouped-runs__<theme>.webp`: Team Bridge/Page ›
  MultiDayGroupedRuns at 1380×360, scrolled to the newest. "Yesterday" is the one
  stuck pill; Monday's pill has been pushed off with its day (Q2). Measured: pill
  y = −103 / 56 / 111 for Monday / Yesterday / Today against a timeline top of 48,
  identical in all five themes. Continuation rows are 24.4px tall, down from 38.8,
  because the hover clock no longer wraps (U1).
- `r1-u2-tucked__radient.webp`: Team Bridge/Reactions › ToolbarAtScrollTop. The
  hovered row starts 5.9px under its scroller's top, and its toolbar sits 4px
  inside the edge (`data-tucked`) instead of at −16px, where it was clipped. A
  hovered row lower in the list keeps the resting −16px (U2).

M2 was checked with `hit_test` on RealRowReactions: while the toolbar is hidden,
the point in its box above the row (540, 98) hits the list (`ol`), not the
wrapper. On hover the toolbar's own button is the topmost hit.

## Identity plate wash lifts (design round 1, D1)

The plate is borderless `accentAltWash` on every Team Bridge identity, people and
agents alike. Its extent is the `team bridge identity plate wash` row in
`PERCEPTIBLE`: ΔE00 ≥ 3.0 off canvas, surface, elevated and rowHover. Eight
palettes failed it and were lifted on `L*` alone, with hue and chroma held:

| palette | mode | wash | L* | min ΔE00 before | min ΔE00 after (ground) | accentAlt on it |
|---|---|---|---|---|---|---|
| cyberpunk | dark | `#271E32` → `#332A3E` | 13.17 → 18.83 | 1.24 | 3.08 (`elevated`) | 5.28:1 |
| kanagawaWave | dark | `#27222F` → `#2A2432` | 14.29 → 15.40 | 2.75 | 3.47 (`surface`) | 5.39:1 |
| oneLight | light | `#E9E5E8` → `#FBF6F9` | 91.32 → 97.33 | 1.84 | 3.22 (`surface`) | 5.72:1 |
| palenight | dark | `#161D30` → `#30364B` | 11.01 → 22.91 | 1.90 | 3.07 (`elevated`) | 5.21:1 |
| radient | dark | `#212330` → `#323341` | 14.05 → 21.68 | 1.78 | 3.19 (`rowHover`) | 8.75:1 |
| rosePine | dark | `#2a2431` → `#362F3D` | 15.36 → 20.65 | 2.27 | 3.20 (`rowHover`) | 6.15:1 |
| rosePineMoon | dark | `#2C2534` → `#352D3D` | 16.04 → 19.93 | 2.17 | 3.16 (`rowHover`) | 6.29:1 |
| synthwave | dark | `#27223E` → `#342E4C` | 15.08 → 20.85 | 1.52 | 3.13 (`elevated`) | 4.85:1 |

Fleet after the lifts: the minimum is 3.07 (palenight, `elevated`). The inks on
the wash, worst case: `accentAlt` 4.53:1 (ayuLight), `accent` 4.58:1 (duskfox),
`inkMuted` 5.65:1 (kanagawaLotus).

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
