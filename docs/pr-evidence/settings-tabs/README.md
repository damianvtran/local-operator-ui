# PR evidence: desktop Settings rail tabs (one panel at a time)

Before/after of the desktop Settings route. `before-*` is the base tree — PR1's
merge, `origin/main` at `78536d4b01` — photographed by PR1's own
`--scene settings-close` at the same 1380x900 viewport and copied here; every
`settings-tabs-*` frame is this branch, rebuilt and photographed by
`scripts/renderer-driver.mjs --scene settings-tabs` against an isolated daemon
that run owned.

## What the frames show

| Frame | Claim |
|---|---|
| `before-long-page-dark` / `before-long-page-light` | the base tree: one long document — the rail scroll-spies a page that never ends |
| `settings-tabs-appearance-dark` / `...-light` | `?section=appearance` shows ONE panel; the rail marks Appearance current; the other eleven panels are mounted and hidden |
| `settings-tabs-radient-dark` | a rail press moved the panel, the URL (`?section=radient`) and `aria-current` together |
| `settings-tabs-search-landing-dark` | Cmd+F for a page row in another tab revealed that tab and landed on the row (`appearance.glass` focused, wash painted) |
| `settings-tabs-narrow-900-dark` | at 900 CSS px the rail is its 48px icon column and the panel behaves the same |
| `settings-tabs-rtl-probe-dark` | document `dir=rtl`: the rail sits on the inline-end side and the panel mirrors (a DIRECTION probe — see limits) |
| `settings-tabs-tour-appearance-dark` | the onboarding tour's Appearance step, with its panel the one on screen |

## The scene's own output

**78 PASS, 0 FAIL**, `rc=0`. The measurements behind the frames:

- `?section=appearance`: `shown=["appearance"]`, `current=["appearance"]`,
  panels `11`, rail rows `11` — the Agent messages panel is absent on this
  daemon's surface answer (`RFC §5.6`), so eleven is the honest count here; the
  source scan pins twelve in `scripts/settings-tabs.test.mjs`.
- Rail presses speech → backend → radient → appearance: each reported exactly
  one shown panel, one current row, and a URL naming that tab.
- Search: query `theme` returned the registry row and the page row
  (`Translucent window · In Appearance`); Enter revealed the Appearance tab and
  focused the row (`data-search-row="appearance.glass"`). Starting tab was
  Backend — i.e. the jump crossed tabs.
- Scroll memory: Appearance scrolled to `420`; the never-visited Imports tab
  opened at `0`; browser Back returned to Appearance at `420` (six-pixel
  tolerance, measured within 1).
- Esc from the Updates tab left `/settings` (PR1's scope intact after the
  search field was cleared — the field owns Escape while it holds text).
- At 900 CSS px the rail row measures ≤48px and every tab check still passes.
- Tour: forward reached `general-settings`, `appearance-settings`,
  `radient-account-settings`, `application-updates-settings`, each spotlighting
  its own panel; Back from the last of them returned through radient and
  appearance to `general-settings`, its panel showing.

## Limits, stated rather than implied

- **The RTL frame is a direction probe, not a locale switch.** The picker lists
  Urdu and the commit round-trips, but this daemon's capabilities answer falls
  back to English, so `document.documentElement.dir` never flips (measured:
  `{"rtl":false}` after the commit, i.e. the same limit PR1's scene documents in
  its own code path). The layout claim is measured with `dir="rtl"` set on
  `<html>` and is labelled as such in the scene's notes and in the file name.
- **"Voice" does not demonstrate a cross-tab jump on this daemon.** Querying
  `voice` returns ten REGISTRY rows whose hint is "In Backend settings", and a
  registry key truthfully lands on Backend. The page row that belongs to another
  tab is entered in PR3 (Theme/Voice/Update check row ids); until then `theme`
  is the query that proves the mechanism.
- **The tour's gear step can close Settings it opened.** In this rig the tour
  reached `navigate-settings` while the page was already open; PR1's gear is a
  toggle and `tourGearNeedsClick` reads `aria-current`, so the click closed the
  page (`{"wasAt":"#/chat"}`). The rig reopened Settings through the same
  control and the four settings steps then passed; the toggle behaviour itself
  is PR1's, not this change's, and is reported as a finding rather than fixed
  here.
- **The frames are emulated viewports** (`Emulation.setDeviceMetricsOverride`),
  the same instrument PR1's evidence used.
- **What no frame shows:** the loading and config-error states (they render no
  panels by design) and the keyboard walk through a hidden panel (asserted in
  `scripts/settings-tabs.test.mjs` and `scripts/settings-search-jump.test.mjs`).

## How it was run

```
# 1. Isolated daemon (HOME and config under the rig root), port 18941.
cd <rig> && HOME=$PWD/home LOCAL_OPERATOR_CONFIG_DIR=$PWD/config lop serve --port 18941
# 2. The renderer, built against that port (3072 MB heap; OAuth ids any non-empty
#    value, they are unused by this scene).
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18941 \
VITE_RADIENT_SERVER_BASE_URL=https://api.radienthq.com \
VITE_GOOGLE_CLIENT_ID=rig-unused VITE_GOOGLE_CLIENT_SECRET=rig-unused \
VITE_MICROSOFT_CLIENT_ID=rig-unused VITE_MICROSOFT_TENANT_ID=rig-unused \
VITE_DISABLE_BACKEND_MANAGER=true LOCAL_OPERATOR_UI_TELEMETRY=off \
LOCAL_OPERATOR_UI_NO_BYTECODE=true ./node_modules/.bin/electron-vite build
# 3. The scene.
LOCAL_OPERATOR_DESKTOP_TOKEN=<daemon access_token> node scripts/renderer-driver.mjs \
  --scene settings-tabs --backend http://127.0.0.1:18941 \
  --backend-records <rig>/config/run/serve --out <frames> --seed-onboarding-complete
```

The daemon was stopped by its recorded pid after the run; no process outlived
it (the driver's own `[PASS] no process from this run outlived its boot`).
