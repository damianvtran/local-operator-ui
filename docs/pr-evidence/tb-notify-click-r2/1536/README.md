# Design review round 2 — #1536, head `d0c452142aa`

Frames and numbers for `### Design review — round 2`. Round 1 required D1 (muted-row
register), D2 (wash too weak), D3 (`fill: both` overrides hover) and D4 (1500 → 1400 ms);
this round re-captures every one of them plus the states round 1 could not see
(all-organizations two-line rows, the 900 px viewport, reduced motion).

## What is real, what is fake

The rig is the QA controlled-transport one (round 1's `../tbns/rig`, copied and extended,
never edited in place) served against `~/local-operator-ui/.worktrees/bridge-notify-sync`:

- **REAL** — `TeamBridgePage`, `TeamBridgeRail`, `AttentionBadge`/`Badge`,
  `useTeamBridgeNavItem`, the shipped singleton `queryClient`, the app stylesheet
  (`styles/index.css` + `themes.generated.css`), React Router, both brand palettes.
- **FAKE** — only the preload surface (`window.api.desktop.*`) answering from an in-memory
  hub whose unread rule mirrors the agent server: `seq > last_read`, not the reader's own
  row, muted excluded from the org/account aggregate.
- The nav badge is the **shipped** `AttentionBadge` wired to the **shipped**
  `useTeamBridgeNavItem` count, drawn in the rig's own two-row shell. The full
  `SidebarNavigation` needs the chat shell and throws outside it (`AGENTS.md`, "What a
  capture may claim"), so the sidebar's chrome is absent — the register is the same code.

## How the frames were taken

Harness `browser` tool, one tab reused for every frame, 1280x720 CSS viewport (the 900 px
frames host the app in an iframe of exactly that size, so its own media queries resolve at
900 px). The arrival band is frozen at a chosen point of **its own keyframes**
(`animation-delay: -<t>ms; animation-play-state: paused`), so "peak" is the instant the
reader sees rather than a race against a screenshot; the page clears the class after
`JUMP_HIGHLIGHT_MS` and the rig re-applies it so a frozen frame stays photographable.

Colour: the screenshot writes Display P3 constants into the PNG, so a saturated pixel is up
to 47/255 from its CSS value. **Every ratio below is computed after a P3 → sRGB transform**,
checked against three colours the page reports as computed styles (`accent rgb(56,201,106)`
captured as `(103,198,116)` → `(56,201,106)`; `surface #2b2721` captured as `(42,39,34)` →
`(43,39,33)`; `elevated #322D22` captured as `(49,45,35)` → `(50,45,34)`). Comparing the
framebuffer values directly made the dark arrival band look 1.5 % stronger than it is.

## The frames

| # | frame | what it shows |
| --- | --- | --- |
| 01/02 | `arrival-band-peak-{dark,light}` | the band at t=0 over the pane: **1.2446:1 dark, 1.1768:1 light** (claim 1.237 / 1.177) |
| 03 | `arrival-band-mid-fade-dark` | the band frozen at 700 of 1400 ms: 1.0072:1 — `ease-out-quart` has spent the cue by then |
| 04 | `arrival-settled-dark` | after the page clears the link: row and pane are the same pixel (1.000:1), no residue |
| 05/06 | `band-over-hover-{dark,light}` | the band with the shipped `bg-row-hover` under it: **1.3571 / 1.2704** — the row's own tint survives under the band |
| 07/08 | `hover-only-{dark,light}` | the hover tint alone (band at 0 opacity): **1.0880 / 1.0837** |
| 09 | `registers-three-kinds-dark` | one frame, three registers: nav accent "2", muted channel quiet "1" + bell, muted DM quiet "2", un-muted DM accent "1" |
| 10/11 | `registers-scoped-{dark,light}` | rail scoped to Acme: nav **2** vs rows accent 1 + quiet 2, muted-at-zero row draws nothing |
| 12/13 | `all-orgs-two-line-rows-{dark,light}` | All organizations: two-line rows with per-row counts, both organizations, accent + quiet in one rail |
| 14/15 | `narrow900-*` | 900 px viewport: badges keep their column, the band wraps with the row |
| 16 | `quiet-numeral-lost-org-aggregate-zero-dark` | **D5**: general (muted, 1 unread) and Pat (muted, 2 unread) draw no numeral at all — the row above each shows the same model values as frame 09, where they do |
| 17 | `band-click-through-avatar-card-dark` | a click on the washed row's avatar opens the person card: the band eats nothing |
| 18 | `band-over-first-in-run-row-dark` | the same band on a first-in-run row (12 px `ink-dim` timestamp visible on the wash) |
| 19 | `reduced-motion-static-band-dark` | the shipped reduced-motion branch (`animation: none`): the band's ground is byte-identical to frame 01; the 232/409 920 sampled pixels that differ anywhere in the frame differ by exactly 1/255, on glyph edges (compositing rasterisation) |
| 20/21 | `hover-under-band-strip-*` | top: band alone. bottom: band over the hover tint — the A/B in one image |
| 22/23 | `org-switcher-per-org-numbers-{dark,light}` | the gap round 1 left open: the switcher menu's per-org numbers in the nav-2 / rail-1 state — All organizations **2**, Acme **1**, Beta **1**, while the rail scoped to Acme can only draw 1 plus the muted row's quiet 2 |
| 24 | `quiet-numeral-present-org-aggregate-one-dark` | the **D5 control**: same seed, same two mutes, only the opened conversation differs from frame 16 — Acme's un-muted aggregate is 1 here, so `Pat` keeps its quiet **2** |

`measurements.json` holds every number with its method; `palette-sweep.txt` is the
59-palette sweep over `themes.generated.css`.

## What this rig could not capture

- **A real pointer hover.** The harness browser's action set has no hover, and a click
  leaves `:hover` matching nothing (control this round: a click on a rail row, then
  `button:hover` → 0 matches). Frames 05/06 put the **shipped `bg-row-hover` utility** on
  the row instead of its `hover:` variant — same declaration, same token, the app's own
  stylesheet; only the trigger is substituted.
- **`prefers-reduced-motion` itself.** No CDP media emulation is exposed. Frame 19
  reproduces the one declaration that media query carries (`animation: none` on the band);
  the media feature firing is unverified.
- **A live hub.** Controlled transport: it proves what the renderer puts on screen for a
  given per-conversation model, not latency, native banner delivery or main's quiet policy.
