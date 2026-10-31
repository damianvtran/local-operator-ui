# Design review round 3 — #1536, head `8b5499f5e90`

Scope `d0c452142aa..8b5499f5e90` (round-2 remediation). Only the remediated surfaces and their
direct neighbours were re-captured: D5 (muted counts vs the org aggregate), D6 (washed-row
metadata ink), the arrival > row-current > hover hierarchy, D7 (mute glyph on person/chief
rows) and D3 (band intercepts nothing, hover tint shows underneath).

## Rig

Round 2's design rig (`?design=paint|registers`), copied, never edited in place, served
against `~/local-operator-ui/.worktrees/bridge-notify-sync` at `8b5499f5e90`. REAL:
`TeamBridgePage`, `TeamBridgeRail`, `AttentionBadge`, `useTeamBridgeNavItem`, the shipped
`queryClient`, the app stylesheet and `themes.generated.css`. FAKE: only the preload surface
(`window.api.desktop.*`), an in-memory hub whose unread rule mirrors the agent server
(`seq > last_read`, not own, muted EXCLUDED from the org/account aggregate).

Three probes were added this round, each named in the rig source:

- `?palette=<ThemeName>` — paint any of the 59 palettes (D6 sweep frames).
- `?chiefn=<n>` — give the muted chief-of-staff DM its own unread, so the chief row's bell is
  judged beside a quiet numeral and not only at zero.
- `?forcehover=person|chief` — the harness browser has no hover action, so one row gets exactly
  the declarations its shipped `group-hover/row` variants carry (badge `visibility:hidden`,
  row menu `opacity:1`, `bg-row-hover`). Same declarations, substituted trigger.

The D5 "before" frame (04, left half of 01) is the same rig and URL served against a source-only
`git archive d0c452142aa` extract (renderer + `src/shared` + `src/i18n` + `i18n/languages.json`;
no package or lockfile change in the range, shared `node_modules`).

Harness `browser` tool, one tab reused for every frame, 1280x720 CSS (900 px frames host the app
in an iframe of exactly that width). Colour ratios are computed AFTER the P3 -> sRGB transform
round 2 validated (same `measure_frames.py`); the washed-row ink pixel matches the computed style
to within 1/255 in every palette (e.g. dark computed `rgb(194,188,175)`, pixel `(194,188,176)`).

## Frames

| # | frame | what it shows |
| --- | --- | --- |
| 01 | `d5-before-d0c4-vs-after-8b54-agg0-dark` | **D5 A/B, same seed, same URL**: left `d0c452142aa` — `general`, `Pat`, `Pat's agent` muted with 1/2/3 unread draw **no numeral** (rowSum 0); right `8b5499f5e90` — quiet **1 / 2 / 3** beside the bell; nav **1** both sides |
| 02 | `d5-after-org-aggregate-zero-dark` | round-2 frame-16 state on the new head (Launch opened, Acme's unmuted aggregate 0): quiet 1 + 2 present, nav 1 (= Beta) |
| 03 | `d5-control-org-aggregate-one-dark` | round-2 frame-24 control (Pat's agent opened, Launch keeps 1): quiet 1 + 2 + accent 1, nav 2 = 1 + Beta 1 |
| 04 | `d5-before-d0c4-same-seed-dark` | the full `d0c452142aa` frame behind 01's left half |
| 05/06 | `d6-band-peak-{dark,light}` | band frozen at t=0 over a first-in-run row: timestamp ink on the band **6.311 / 6.958**; band vs pane **1.2446 / 1.1768** (unchanged from round 2) |
| 07-10 | `d6-band-peak-{cyberpunk,obsidian,rosepine,nightfox}` | the three worst round-2 failures plus the claimed floor: **5.419 / 5.752 / 5.844 / 5.189** (pixels) |
| 11/12 | `hover-only-{dark,light}` | shipped `bg-row-hover` alone: **1.0880 / 1.0837**; rail row-current in the same frame **1.1270 / 1.1325** |
| 13/14 | `d3-band-over-hover-{dark,light}` | band over the hover tint: **1.3571 / 1.2704** vs band alone 1.2446 / 1.1768 — the row's tint is still there |
| 15 | `d3-click-through-avatar-card-dark` | a real click on the washed row's avatar opens Rob's profile card |
| 16/17 | `d7-mute-glyph-rows-1280-{dark,light}` | bell beside the quiet numeral on channel, person (`Pat` 2) and chief (`Pat's agent` 3) rows |
| 18/18b | `d7-person-hovered-1280-dark` (+crop) | person row hovered: count yields, `…` takes its slot, bell holds; bell x 400-412, menu box x 414-438 |
| 19 | `d7-mute-glyph-rows-900-dark` | same rail at 900 px: rail rows keep 280 px, identical glyph/badge x |
| 20/20b | `d7-chief-hovered-900-dark` (+crop) | chief row hovered at 900 px: bell + `…`, no overlap |
| 21 | `d9-band-at-1400ms-ink-lifted-dark` | band at the end of its keyframes (ground == pane, 1.000) with the class still on: timestamp still `ink-muted`, **7.855:1** |
| 22 | `d9-after-clear-ink-stepped-back-dark` | one frame after the page clears the class: timestamp `ink-dim`, **5.700:1** — a 1.378 luminance step with `transition-duration: 0s`; only pixels differing are the header line (CSS bbox 469,603 → 598,637) |

`measurements.json` holds every number with its source.

## Not captured

- **A real pointer hover** — no hover action in the harness browser; frames 11-14, 18, 20
  substitute the trigger, not the paint.
- **`prefers-reduced-motion` firing** — unchanged since round 2 and outside this delta.
- **A live hub** — controlled transport.
