# LOH-11 — real before frames

Captured through the harness browser from the existing real ChatSidebar in Storybook at `http://localhost:6006`. Baseline: `76dda0304bfa4b54ebd42cccd32bbd05841ca4a3`. The sections **evidence harness** is an evidence-only story patch archived at [`../harness/`](../harness/README.md); it is not applied in this docs-only PR and lands with the UI implementation PR. Production sidebar source is unchanged in both. The archived patch is what makes these frames and measurements reproducible from this head.

All captures: **1280×720 CSS viewport, DPR 2, PNG 2560×1440**. Themes are story args `theme:localOperatorLight` / `theme:localOperatorDark`. Example iframe URL: `/iframe.html?id=chat-sidebar-sections--evidence-tags-220&viewMode=story&args=theme:localOperatorDark`.

| Files | Story ID | Panel width |
|---|---|---:|
| `220-{light,dark}.png` | `chat-sidebar-sections--evidence-tags-220` | 220 |
| `260-{light,dark}.png` | `chat-sidebar-sections--evidence-tags-260` | 260 |
| `320-{light,dark}.png` | `chat-sidebar-sections--evidence-tags-320` | 320 |
| `{220,260,320}-dark-acts.png` | `chat-sidebar-sections--evidence-tags-acts-{220,260,320}` | named width |
| `view-options-{light,dark}.png` | `chat-sidebar-view-menu--popover-open` | existing story |

## Actual measurements (CSS px)

Harness `browser.styles` selectors: `nav`, `[data-session-row]`, `[data-session-title]`, `[data-session-row] [data-chat-row] > span:nth-child(2)`, `[data-session-pin]`; action readings also use `[data-session-control-pair]`, `[data-session-archive]`, `[data-session-pin-grip]`. Full responses: `measurements.json`, `action-measurements.json`.

| Metric | 220 | 260 | 320 |
|---|---:|---:|---:|
| Row | 180×32 | 220×32 | 280×32 |
| First pinned title, rest | 46.98 | 86.98 | 146.98 |
| Running title, rest | 101.39 | 141.39 | 201.39 |
| First pinned title, seeded actions | 17.39 | 57.39 | 117.39 |
| Running title, seeded full pair | 45.39 | 85.39 | 145.39 |
| Unpinned pair | 52×24 | 52×24 | 52×24 |
| Pinned cluster with grip | 80×24 | 80×24 | 80×24 |

Title font: system-ui family, 13px/20px. Status slot 16×16; locality cell14; row button gap4 and side padding4. Pair52 + outergap4 =56. Pinned cluster80 + outergap4 =84; resting pin already costs28. Timestamp withdrawal explains why the pinned title's net loss is29.59 rather than56.

The base fixture lacks archive capability and omits `pinned:false` on unpinned rows. **Action stories only** enable archive and normalize the false pin field, then seed the real hover-intent attribute in their render host. These prove actual rendered layout-state geometry, not physical pointer-dwell gestures or successful writes. An early incomplete payload produced only a24px archive control; that reading is not the final action-pair evidence.

The View options screenshot readout says `box240×640 · bottom682/720 · content638`: **682/720 is bottom/viewport, not content height**. Source: `panelGeometry()` in `chat-sidebar-view-menu.stories.tsx`. The base interior is638; a40px Tags insertion therefore implies content678 and40px scroll at the same clamp. Proposed-after sheets reproduce that arithmetic, not a shipped popover.

Historical `sidebar-row-space.md` tables predate this head and must not replace these measurements. Tiny per-theme glyph differences remain in raw records. No screenshots here imply that tags are implemented.
