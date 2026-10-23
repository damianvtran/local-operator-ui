# Default-on Team Bridge — rendered evidence

**Follow-up:** [D1/D2 full-container RED → GREEN remediation](D1-remediation.md) supersedes the earlier post-off verification limitation; earlier artifacts and preparation notes below remain historical records.

PR #1333, integration/evidence capture on 2026-10-23. **Browser-rendered Storybook evidence, not native Electron or live-hub QA.** The real browser tool drove one background tab and a single Storybook server on port 6013. Every frame was inspected, including the five contact sheets below. No screenshots came from jsdom, an HTML mockup, a scripted browser engine or Electron.

## Frame storage correction (CI remediation)

Image bytes live locally in **`docs/evidence-frames/default-on-banner/`**, ignored as required by the repository evidence runbook. They are not tracked in the current tree. `frame-index.json` records all 73 filenames, byte counts, SHA-256 hashes and accessible historical raw URLs at reviewed head `2df48707a9`; migration verified every byte. The historical URL is an old-head artifact, not a claim that the current branch tracks frames. Geometry, snapshots, source manifest and this README remain tracked here. No gate was suppressed. The previous forced image commit caused both Evidence Structure and the entry-point release-script test to fail; both share this one cause.

## Source and setup

- After: code head `4558eb9a36` (merge `4abc6fc42d`, integrating main `19f094810fcc26757efc2bf456f8a4b5437bb984`), plus the story-only change giving the Settings board a real `h-dvh overflow-y-auto` scroll container. Production banner/settings/page code did not change during capture.
- Before: **genuine pre-feature main source `19f094810fcc26757efc2bf456f8a4b5437bb984`**, loaded by a separate, subsequent server run. `historical-source-manifest.json` records SHA-256 hashes of all 26 overlaid source files, and their restored bytes. Existing main Settings and Page stories rendered without importing the new feature story. Main and the worktree share the same lockfile/dependency tree. No installs. All overlaid files and the original Storybook configuration were restored and verified after teardown.
- The shared `origin/main` ref moved concurrently while preparing the overlay. The successful baseline was pinned to the full SHA above, not the moving ref; an incomplete first overlay was restored before the pinned run. No screenshots from the failed attempt are presented as evidence.
- Viewport: **1280 × 720 CSS px**, screenshots 2560 × 1440 device pixels. Themes are the real `localOperatorLight` and `localOperatorDark` preview args. The app's CSS, fonts, providers and components are loaded.
- Temporary capture configuration narrowed story discovery to the two relevant files and disabled docgen only. The first all-repo startup exceeded the 1536 MiB RSS ceiling and was reaped. Disabling dependency discovery produced a CommonJS export error, so that setting was removed; successful captures used normal dependency optimization, `GOMAXPROCS=2` and `RAYON_NUM_THREADS=2`. No failed/blank startup frame is used as a UI result.
- One server at a time, `NODE_OPTIONS=--max-old-space-size=2048`, with an OS process-group watchdog polling RSS/disk every second: start at >=5 GiB, kill at >1536 MiB RSS or <4 GiB free. The successful after server peaked at 1317 MiB. Both browser tabs were closed and server process groups reaped after their capture phase. No server is left running.

## Authoritative disclosure text

`scripts/fixtures/team-bridge-consent-v2.json` is extracted verbatim from agent-server `internal/bridge/texts.go:ConsentTextV2`, not translated or paraphrased by the UI. It contains **2035 ASCII bytes**, SHA-256:

`dba2eb359f299a07d65676f2a088124903fb280196b54488c7913da4f9517f7d`

The registered 26-test banner lane now reads this same fixture and pins its byte length/hash. Its existing rendered-text assertion checks byte equality, and its version-mismatch negative controls remain green. The expanded frames show the full v2 disclosure; the v1 compatibility controls retain the old served fixture.

## State matrix and URLs

All after stories are in `src/renderer/src/features/agent-messages/default-on-banner.stories.tsx`.

URL pattern (server intentionally stopped after capture):

`http://127.0.0.1:6013/iframe.html?id=team-bridge-default-on--<surface>-<state>&viewMode=story&args=theme:localOperatorLight`

Use `localOperatorDark` for dark. Surfaces: `settings`, `page`. States: `pending`, `expanded`, `dismissed`, `off`, `failed`, `v-1`, `loading` (**Storybook spells the v1 id `v-1`**).

- Each of the 28 after states has `<surface>-<state>-<theme>-initial.png` and `-settled.png`, a `.snapshot.txt` accessibility reading and a `.geometry.json` measurement. Artifact filenames use `v1` rather than `v-1`.
- `initial` means the first capture **after the story's target state was observed**, not the initial app boot/loading paint. `settled` follows at least 750 ms later. No startup reflow claim is made.
- The `before-*` stories also registered in the new story file are explicitly **compatibility controls**, not historical source. They are not used as historical evidence here.

### Viewed after contact sheets

| Surface | Light | Dark |
|---|---|---|
| Settings: pending, expanded, dismissed, off, failure, v1, loading | [light sheet](https://raw.githubusercontent.com/damianvtran/local-operator-ui/2df48707a9896f06dc6792d8f7347466db97e8f8/docs/evidence/default-on-banner/contact-settings-light.jpg) | [dark sheet](https://raw.githubusercontent.com/damianvtran/local-operator-ui/2df48707a9896f06dc6792d8f7347466db97e8f8/docs/evidence/default-on-banner/contact-settings-dark.jpg) |
| Team Bridge page: same seven states | [light sheet](https://raw.githubusercontent.com/damianvtran/local-operator-ui/2df48707a9896f06dc6792d8f7347466db97e8f8/docs/evidence/default-on-banner/contact-page-light.jpg) | [dark sheet](https://raw.githubusercontent.com/damianvtran/local-operator-ui/2df48707a9896f06dc6792d8f7347466db97e8f8/docs/evidence/default-on-banner/contact-page-dark.jpg) |

Individual full-resolution files are available beside the sheets, particularly [expanded Settings](settings-expanded-light-settled.png), [expanded Page](page-expanded-light-settled.png), [Settings off](settings-off-light-settled.png), and [Page off](page-off-light-settled.png).

### Genuine historical source frames

[Viewed historical sheet](https://raw.githubusercontent.com/damianvtran/local-operator-ui/2df48707a9896f06dc6792d8f7347466db97e8f8/docs/evidence/default-on-banner/contact-historical-main.jpg), with both themes for each:

| Surface | Real main story id | Artifact prefix |
|---|---|---|
| Active Settings before banner | `agent-messages-settings--populated` | `historical-main-settings-` |
| Opt-in Settings negative control | `agent-messages-settings--on-ramp` | `historical-main-settings-on-ramp-` |
| Team Bridge page before notice slot | `team-bridge-page--populated-direct-message` | `historical-main-page-` |

The historical Settings story is the existing section-only board (no outer heading/gutter); the new after board includes the SettingsSection shell and scroll container. This is a disclosed host difference, not a feature geometry change. Historical page and after page reuse the existing populated conversation fixture, whose timestamps are relative to capture time.

## What the interactions actually prove

Expanded/dismissed/off/failed after stories **click the actual banner buttons** using Storybook `play`, with real `DefaultOnBanner`, `useDefaultOnBannerActions` and (on the page) `TeamBridgeDefaultOnBanner`. They are not pictures with a banner manually hidden. The injected transport returns a settings response with `endpoint.state: disabled`, or throws for the failure board. Dismiss calls the injected local dismiss route and the real persisted-store belt hides the notice. Every default-on play checks absence of Enable buttons and dialog/alertdialog roles.

**Important limitation — page after Turn off:** the rendered Page Off board loses its banner but still displays the normal populated conversation composer, with no visible off-state label. It is reached by the real Turn off click and settings-cache update, **but it is not a live status refresh**: the story mounts `TeamBridgePageView` with the banner container, not the network-owning `TeamBridgePage`. The banner invalidates the status query; this fixture has no active status-query observer and keeps its supplied C status. Likewise the Settings board's refresh callback is a no-op, though its own settings response drives the visible plain off state. These frames cannot establish whether the full production page remains stale after an actual runtime status refresh. The independent designer/QA should assess the observation against the required plain-off state; it is not hidden or labelled proof of the complete off path. No send attempt was made from that composer.

## Geometry and settling

All **34 frame pairs** (28 after + 6 historical) have identical measured initial/settled geometry. `settled-pairs.json` records the independent pixel comparison: **30 pairs byte-equivalent in pixels**; only four loading pairs differ, confined to the pulsing skeleton/spinner bounds. This is animation, not measured reflow.

Representative light-theme CSS rectangles (dark has the same layout):

| State | Banner x/y/w/h | Consent block x/y/w/h | Host |
|---|---|---|---|
| Settings pending | 24 / 62.4 / 1217 / 95 | closed | scrollable content height 1423.67 |
| Settings expanded | 24 / 62.4 / 1217 / 341.5 | 59 / 156.4 / 1169 / 238.5 | scrollable content height 1670.17 |
| Settings off | absent | plain off disclosure | content height 470.2 |
| Page pending | 312 / 4 / 944 / 95 | closed | full page 1280 × 720 |
| Page expanded | 312 / 4 / 944 / 419.5 | 347 / 98 / 896 / 316.5 | full page 1280 × 720 |
| Page off | absent | absent | full page remains 1280 × 720; see limitation above |

The Settings scrollbar reserves 15 CSS px on long states (1217 content width vs 1232 on short Off), matching a conventional scroll container. Full v2 text is visible inside the expanded pane at this viewport. No horizontal overflow or action clipping was visible. Expanded Page reduces message viewport height but the composer remains visible. Expanded info glyph stays vertically centered beside the whole band; the independent designer owns any refinement to that existing notice-band grammar.

## Verification and remaining gates

- `node --test --test-concurrency=1 scripts/default-on-banner.test.mjs scripts/team-bridge-channels.test.mjs scripts/team-bridge-threads.test.mjs`: **43/43** (26 banner, 6 channels, 11 thread regressions), PGID watchdog peak 309 MiB.
- Generator freshness, string scan, context parity, coverage and ledger gates: pass; 424 rows independently audited and fresh. No translated bytes changed in this integration/evidence slice.
- Renderer typecheck: pass under documented 2048 MiB RSS allowance (1695 MiB peak). Normal pre-push hook lint + both serial typechecks passed (1832 MiB peak). No hook bypass, no install, no full suite.
- Full CI, independent convergence code review, and independent design/QA of these frames remain separate gates. This record is not their sign-off and does not authorize merge/release/flag changes.
