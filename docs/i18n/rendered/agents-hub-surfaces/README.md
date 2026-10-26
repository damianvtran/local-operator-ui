# Agents and hub surfaces: rendered proof

Frames and measurements for PR #1432 (`i18n-agents-pages`): the agents roster,
the agent hub and the org-team rows in the seven shipped non-English locales.
`SHA256SUMS` lists every frame in this directory.

## Method

- The desktop app built from this branch, launched headless through the
  repository's own renderer driver (`--window-mode=headless`), scratch `HOME`,
  config dir and Electron profile, CSS viewport 1380x900, DPR 2 (2760x1800
  frames). Pixels are `webContents.capturePage()`: the app photographing its own
  window; geometry is `getBoundingClientRect()` read from the live renderer.
- Backend: a real isolated `lop serve` fronted by a loopback proxy that rewrites
  only `result.language` in `GET /v1/capabilities`, so the app negotiates the
  locale the way it does in production. Seeded agents are real
  `profiles.install` / `profiles.create` writes.
- **Route-stubbed, not live:** the org hub, the public agent card and
  memberships (`POST /v1/desktop/radient`: `account`, `memberships.list`,
  `agents.list`, `org_agents.list`, `org_teams.list`) are stubbed at the backend
  boundary because the isolated daemon holds no Radient credential. The app,
  transport and components are real; the data is not a live Radient read.
- Frames were captured at two heads, named in the file names where it matters:
  the `BEFORE` frames at `99abae51a8`, the `AFTER` frames from the same rig after
  the catalogue fix. All other frames are from `99abae51a8`, whose catalogue and
  source are unchanged for those surfaces.

## What the frames prove

### 1. The scope control overflowed in two locales (and was fixed)

The roster's four equal segments must fit one well (`w-72` column, `px-4`,
`Button size=sm`, `px-2`, `text-meta`, `font-medium`). Two different bases appear
below and are kept apart on purpose:

- **Overflow** is the measured right edge of the last segment against the well's
  right edge (`532` in the rig's coordinates; the first segment starts at `284`,
  so the available run is 248 px). `+5.21 px` is `537.21 - 532`, read straight
  from `measurements.json` (`overflowPx`).
- **Slack** is the sum of the segments' natural widths (text plus four `px-2`
  pads) against the 246 px the four equal segments are laid out in; a segment
  box sum of `245.99` means the buttons were stretched to fill it.

Mixing them (`253.21 - 246`) gives a different number; the first is what the
user sees clipped.

| locale | before | after | slack |
| --- | --- | --- | --- |
| en (control) | 214.54 px natural, fits | unchanged | 31.46 px |
| es | 246.00 px box, **exact fit** | unchanged | 0 px |
| fr | `Toutes / Créées / Installées / Intégrées` 253.21 px box sum, last edge 537.21 vs 532: **+5.21 px**, well scrolls | `Tout / Créé / Installé / Intégré` **199.59 px** | 46.41 px |
| ru | `Все / Свои / Установленные / Встроенные` 283.90 px box sum, last edge 567.91 vs 532: **+35.91 px**, last chip cut 19.9 px past the sidebar | `Все / Свои / С хаба / Встроенные` **230.24 px** | 15.76 px |
| ur | fits, -2 px inline-start slack | unchanged | n/a |
| zh-CN, vi, hi | 246.00 px, fit | unchanged | n/a |

`fr-roster-BEFORE-overflow-5px.png` / `fr-roster-AFTER-fit.png` and
`ru-roster-BEFORE-overflow-36px.png` / `ru-roster-AFTER-fit.png` are the pairs.
`ru-empty-installed-AFTER.png` shows the empty state following its label.

**A number to distrust.** The es translator and its auditor reported 233.1 px
with 12.9 px of slack, measured with AppKit (`NSFont.systemFont`). The app's own
Chromium layout puts es at 246.00 px: a fit with zero slack. AppKit is not
Chromium; the decision to keep es was right, the margin quoted for it was not.
Fit is only claimed here from the real render.

### 2. One key family, two slots

The same three keys (`ui.agents.pages.scope.builtin|installed|custom`) label the
filter segments **and** the source chip on every roster row **and** an agent's
detail meta line. fr had been feminine plural (`Intégrées`), which reads wrong
beside one agent. `fr-detail-meta-coder-singular.png` shows `Intégré` on a single
agent; the DOM read of the body found no plural form (`pluralHits: []`).

### 3. RTL

`ur-rtl-roster.png`, `ur-rtl-hub-header.png`, `ur-rtl-org-team-dates.png`. `html`
reads `dir=rtl lang=ur`; the roster aside moves from `x=260` (en) to `x=832`
(right edge 1120), the scope well from `276..532` to `848..1104`, segment order
and text direction mirror exactly. Expanded org-team dates render in Urdu with
Latin digits (`18 ستمبر، 2026`).

### 4. Org-team recency and dates

`fr-org-team-dates.png`, `ur-rtl-org-team-dates.png`: absolute dates now format
through the i18n layer (`10 oct. 2026`, not `10 Oct 2026`), and the relative time
comes from the hub's comment-age family.

## English still rendered, by surface (NOT fixed by this PR)

The point of rendering is finding what no catalogue measure can see. In every
non-English locale these still read English, because they are literals that were
never keyed (the next extraction branch routes them):

- Agents page: `Ask for an agent`, its explanatory paragraph, the composer
  placeholders `Describe what you want…` / `Ask for a change…`, `Or add an agent
  by hand`, `Add agent manually`, detail prose `Show all` / `Show less`. (The
  right-hand pane in the frames is this surface.)
- Agent detail meta line: `Delegates`, `Specialist`, beside the localized source
  label.
- Public hub card: `updated 4 days ago`, `Get`; `Try again` at the end of the
  localized viewer-state notice.
- Publish dialog title: `Publish "aida" to the Agent Hub?` (the destination
  select in the same dialog is localized).
- Org-team row recency prefix: the word `updated` before a localized relative
  time (`updated il y a 2 jours`): a concatenated string, so a sentence-shaped
  key with `{when}` is the fix.
- ur only: `ui.hub.pages.header.title` renders `Agent Hub` (an audited decision:
  the page title matches the sidebar entry that opens it); the hub pull action
  reads `pull کریں` (hi: `pull करें`), the kept-English hub verb.
- ru only, out of this PR's scope: `ui.agents.starters.action.all_builtins`
  (`Установить всех встроенных агентов`) is clipped inside the 288 px sidebar.

**Allowed exceptions, named:** agent ids and names (`aida`, `coder`,
`aa-custom`...), seeded fixture descriptions, `QA Account` / `QA Organisation`,
`local-operator`, `v1.2.0`, the `Local Operator` and `Team Bridge` brand tokens,
keycaps, counts and timestamps.

## Not covered

- No live Radient read (see above).
- Headless renders are not a native-window or focus-dependent surface.
- The publish dialog is reachable only through the legacy route
  `/agents/<registry-agent-id>`; the new roster detail pane has no publish
  control, so that frame is of the legacy path.
- Two of 18 boots died with a transient "renderer never painted" and were
  retried; the filed frames are the retries.
