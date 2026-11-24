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
| `settings-tabs-search-landing-dark` | Cmd+F for a page row in another tab revealed that tab and landed on the row (`appearance.glass` focused, wash painted) **with the column above the panel where it was** (round 1 D1) |
| `settings-tabs-width-keyboard-dark` / `...-imports-dark` | a scrolling tab and a short one keep the same content width (round 1 D2) |
| `settings-tabs-narrow-900-dark` | at 900 CSS px the rail is its 48px icon column and the panel behaves the same |
| `settings-tabs-rtl-probe-dark` | document `dir=rtl`: the rail sits on the inline-end side and the panel mirrors (a DIRECTION probe — see limits) |
| `settings-tabs-rtl-tooltip-dark` | at the 48px rail in RTL the tooltip opens toward the CONTENT (round 1 D4) |
| `settings-tabs-tour-appearance-dark` | the onboarding tour's Appearance step, with its panel the one on screen |
| `settings-tabs-rail-focus-dark` | the state a KEYBOARD rail press creates (round 3, U1): Enter on the Speech row leaves `document.activeElement` on the Speech panel, which draws no outline ring (round 4, MAJOR 1 — `outline-style: none`) |

## The scene's own output

**89 PASS, 0 FAIL**, `rc=0`. The measurements behind the frames:

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
- **D1, the ancestor walk**: the column above the panel read
  `{"scrollTop":0,"closeTop":64}` before Enter was pressed and the same after
  the landing (round 2, MINOR 3: the "before" reading is taken before the key,
  not after it). The same landing measured `closeTop: 48` before the fix,
  because `scrollIntoView` also scrolled the `panel-flush` wrapper.
- **D2, the width step**: Keyboard and Imports at the same viewport both read
  `clientWidth 892 / offsetWidth 900 / search field right edge 1316`. Before the
  fix the short tab read `clientWidth 900` and a search-field edge of `1324` —
  an 8px jump on every switch between them.
- **D4, the RTL tooltip — what this rig can and cannot show (round 2).** The
  tooltip's side now comes from the LOCALE (`useTextDirection`), not from
  `<html dir>`, because the attribute is written by App's layout effect after
  its children render (one render behind on a locale switch). This daemon's
  capabilities answer carries no `language` and no `features.i18n`, so the
  store always resolves to the English device locale and a locale-driven RTL
  render cannot be produced here — measured three ways (`Emulation.setLocaleOverride`
  leaves `navigator.language` at `en-US`; a pre-document `navigator.language`
  override reaches `navigator.language` but not a backend answer, and the
  capabilities answer still resolves the store to English; the picker's Urdu
  commit round-trips and is then replaced). The frame therefore proves the
  property this round changed: at 900px with the forced `dir=rtl` layout probe,
  the Speech row is `600..632` while its tooltip reads `data-side="right"` at
  `638..740` — the side did NOT follow the attribute. The mapping itself
  (`ur-PK -> rtl`, `en -> ltr`, an unshipped tag -> ltr) and the source that
  applies it are pinned in `scripts/settings-tabs.test.mjs`.
- Esc from the Updates tab left `/settings` (PR1's scope intact after the
  search field was cleared — the field owns Escape while it holds text).
- At 900 CSS px the rail row measures ≤48px and every tab check still passes.
- Tour: forward reached `general-settings`, `appearance-settings`,
  `radient-account-settings`, `application-updates-settings`, each spotlighting
  its own panel; Back from the last of them returned through radient and
  appearance to `general-settings`, its panel showing. The gear step's own Next
  recorded `#/agents` before the click and `#/settings` after it.

## Limits, stated rather than implied

- **The RTL frame is a direction probe, not a locale switch.** The picker lists
  Urdu and the commit round-trips, but this daemon's capabilities answer falls
  back to English, so `document.documentElement.dir` never flips (measured:
  `{"rtl":false}` after the commit). The layout claim is measured with
  `dir="rtl"` set on `<html>` and is labelled as such in the scene's notes and in
  the file name.
- **"Voice" does not demonstrate a cross-tab jump on this daemon.** Querying
  `voice` returns ten REGISTRY rows whose hint is "In Backend settings", and a
  registry key truthfully lands on Backend. The page row that belongs to another
  tab is entered in PR3 (Theme/Voice/Update check row ids); until then `theme`
  is the query that proves the mechanism.
- **The tour's gear step does not close anything** (corrected in round 1). Its
  Next is open-only (`tour-steps.ts`: the gear is clicked only when it is not
  current). An earlier probe read the route on ARRIVAL, before that step's
  click, and mislabelled the previous steps' route as a closed page; the probe
  now records the route AFTER the click: `#/agents` -> `#/settings`. The same
  round found the scene's tour clicks landing on a hidden earlier step's button
  (Shepherd keeps every step element in the DOM); they are scoped to
  `.shepherd-element:not([hidden])`, which is what makes the walk advance.
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

`out/` was rebuilt once for this round from `df1060c4e9` (3072 MB heap, one
process); the UX round's hand-edited port 18973 is gone from
`out/renderer/index.html`. The daemon was stopped by its recorded pid after the
run; no process outlived it (the driver's own `[PASS] no process from this run
outlived its boot`).
