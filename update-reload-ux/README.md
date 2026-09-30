# Update indicator and reload picker — round 1 frames

Frames for the drain cluster **#672** (quiet update indicator + per-segment
following) and **#679** (the reload picker closes on success).

This directory is on its own branch (`pr-evidence-update-reload-ux-0929`) and is
**not part of `main`**. The branch is an orphan, mirroring
`pr-evidence-hub-update-indicators-0929`: one top-level directory of frames, no
shared history with the product tree.

## Naming and the two trees

`<area>--<state>--<theme>.png`, under `before/` and `after/`, both caught at
1280x800, dpr 1, headless.

- **`before/`** is the **base tree**, `origin/main` = `89684a3f20`.
- **`after/`** is the PR's head at capture time, `d2a8ab3eca`.

Both sets come from Storybook driven over raw CDP by a private headless Chromium
(`--use-mock-keychain`, scratch `--user-data-dir`, reaped on exit) — the same
discipline `scripts/capture-evidence.mjs` uses. The stories are the shipped
components; nothing here is a hand-drawn mock of the change.

## What the frames are of

| Story | Before | After |
| --- | --- | --- |
| `common-updatenotification--update-available` | the offer CARD, as the app painted it for its own periodic news | the same card — now reachable only from an explicit check or a press on the band |
| `common-updatequietindicator--at-rest` | — | nothing at all: no row, no height, no pixels |
| `common-updatequietindicator--app-update` | — | the quiet band, one surface |
| `common-updatequietindicator--both-surfaces` | — | both surfaces, in the order the band lists them |
| `common-updatequietindicator--below-followed-segment` | — | nothing: a patch release to a surface following majors only |
| `common-updatequietindicator--long-version` | — | a long version string, which does not make the band taller |
| `common-updatequietindicator--drawing-both-controls` | — | the band's two controls, gate bypassed |
| `settings-updatefollowing--default` | — | the new control, shipped default |
| `settings-updatefollowing--mixed-segments` | — | app follows majors, server follows every release |
| `settings-updatefollowing--majors-only` | — | the quietest card the control forms |
| `settings-app-updates-section--server-update-offered` | the section with no notification preference, the card over its content | the same section with the preference, the same press answering with the card |
| `common-updatenotification--downloaded` | ready to install | unchanged — an in-flight state, deliberately not gated |
| `common-updatenotification--install-in-flight` | install running | unchanged |

## States that need the LIVE app (for QA / the UX walk)

- **The reload picker's two frames (#679).** Storybook has no desktop bridge, so
  a *successful* reload cannot be performed there: `desktopResult` reaches
  `window.api.desktop.request`, and a stubbed bridge would be photographing the
  stub. The pair the issue asks for — **dialog open with its receipt** (before)
  and **dialog gone with the receipt as a toast** (after) — is therefore a
  live-app capture. The behaviour itself is proven, not asserted: the shipped
  picker is driven through its own submit control in `scripts/reload-picker-close.test.mjs`,
  which fails on the old shape.
- **The band inside the real shell.** The indicator frames put the band on the
  shell's own ground at the bottom edge; the live app is what shows it under the
  sidebar and a real transcript.
- **A hover on the band** (`:hover` is browser state, not story state).

## What a frame cannot say

Nothing here is a contrast or spacing measurement. `pnpm check-themes` holds the
floors (`action`/`accent` ink on `surface`, the focus outline), and
`scripts/update-indicator-segments.test.mjs` holds the gate.
