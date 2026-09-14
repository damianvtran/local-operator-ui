# Panel remediation — browser evidence, round 3

## What this pass proves

Source milestone: `642e6934d9e7c566ddaf3dd220381c557f2bb2f4`.
Capture base: `ef4f76905c202c2f10e3e8d43bbe6c093016434e`, with uncommitted
D14/D15/D17 edits. **These were dirty-working-tree captures, not captures of a
clean ref.** The interaction and real-wire stories were added after the 96
existing-story captures; they do not change those existing story renders. The
final `replaceAll` → `split/join` spelling only restores the supported TypeScript
target and has identical output for the pictured scope value.

All new page navigation, interaction and screenshots used the Local Operator
`browser` tool against the existing Storybook preview at `http://localhost:6051`.
No raw CDP, Playwright, private Chromium, Electron scripting, or
`capture-evidence.mjs` was run for this pass. The local preview disables docgen
in the pre-existing untracked `.storybook-local` config; no production behavior
is mocked by that setting. Theme selection uses `args=theme:<theme>`, not globals.

The browser's actual PNG dimensions are **2880 × 1634**. They are preserved
without resizing/cropping in the lossless WebPs. These replace historical
smaller-viewport frames only for the explicitly listed changed surfaces. They
are not evidence at the old capturer's viewport dimensions. In particular, the
historical `panels-failovers/narrow/*` frames are retained as narrow-layout
evidence at their original revision; their old scope copy is not a claim about
the new revision. Current copy is evidenced by the five retaken failover states
in every theme.

| Finding | Captures and actual result |
|---|---|
| D14 | `panels-settings/usage-chart-{tokens,credits}/*.webp`: 24 frames, all twelve themes. Both the production settings page and story now mount `SettingsUsageChart`, including `formatTokens`, `h-62`, Y width 48, unit, name and active-dot props. Tokens show `1.8M / 1.4M / 900k / 450k / 0`, not `1800k / 0k`. The chart contract test executes the real component's returned props. |
| D15 | `panels-info/dense/*.webp`: 12 frames, Environment and Could not be read visible. The full credential-name list, failed MCP rows and three diagnostic rows distinguish Dense from ManySessions. |
| D17 | `panels-failovers/{populated,failover-in-force,empty-chain,no-chains,dense}/*.webp`: 60 frames, all twelve themes. Meta says `configured defaults · not live routing state`. |
| D16 | `panels-live/wire-environment/localOperatorDark.webp`: real production InfoPanel over an actual isolated backend HTTP response. `Guides and skills` shows `11 guides · —`; `Approval mode` shows `—`. See the real-wire boundary below. |
| Interaction gap | `analytics-scoped-spend/localOperatorDark.webp` and `analytics-reopened/localOperatorDark.webp`: actual control clicks in the stateful `panels-analytics--interactive` story. 30 days → Spend → This session only changes the headings/selected controls; Close → Open analytics resets 7 days/Tokens/all sessions. This is presentation-flow evidence, not transport/slash-dispatch evidence. |

The before-frame in `settings-before/localOperatorDark.webp` was captured before
the production-chart extraction, through the same browser and viewport. The
corresponding after-frame is `../panels-settings/usage-chart-tokens/localOperatorDark.webp`.
The browser-visible before/after frames were actually viewed, as were both brand
palettes of the corrected chart, Dense Info, failover scope, the real-wire Info
frame and the Analytics control-transition frame. The capture index lists all
96 replaced story frames, URLs, source PNG hashes and actual dimensions.

## The real-wire boundary (D16)

The backend is the production diagnostic router from backend PR #1117 at
`bb90ab88bf0c0d03da9c7f41dd6a1acec29129e6`, on a disposable HOME/config root.
It is not the operator's backend or store. `serve-wire.py` next to the native
frames is a reproducible runner. From that backend checkout:

```sh
.venv/bin/python -c 'import runpy; runpy.run_path("<ui-checkout>/docs/evidence/panels-live/serve-wire.py", run_name="__main__")'
```

Open (with the browser tool):

```text
http://localhost:6051/iframe.html?id=panels-info--wire-environment&viewMode=story&args=theme:localOperatorDark
```

The adapter fetches `http://127.0.0.1:6052/v1/desktop/info` with a public synthetic
test bearer. The isolated backend explicitly allowlists only the preview's
origin and applies CORS for that origin. The first browser request was correctly
refused with 403 before that explicit allowlist was configured; no origin guard
was bypassed. The successful response is HTTP 200, with `env.guides = 11`,
`env.skills = null`, `env.approval_mode = null`, and an empty credential-key list.
The actual production InfoPanel renders that response, not a copied JSON fixture.

**This is a browser HTTP adapter, not native Electron, preload IPC, the assembled
app's session routing, or slash-dispatch coverage.** The original ten native-app
PNGs remain untouched for those earlier claims. Each now has a lossless
`<state>/localOperatorDark.webp` companion, with decoded RGBA bytes checked equal
to its PNG. Conversion does not change its original capture date or source.

## R8 — inventory and prior provenance

The four failures in `/tmp/panels-ce3.log` were real, not contention:
wrong source stamp, 251 rather than 215 capture-list surfaces, ten declared
native PNGs invisible to the WebP walker, and 1562 rather than 1812 sweep frames.
The manifest now uses the shared exported `frames` walker and the gate's story
list parser. Before the required convergence rebase, the measured inventory is
2051 WebPs: **1812 outside supplementary sets + 239 supplementary**. The original
ten PNGs remain in addition to this inventory, not secretly counted by it.

The older 756-frame pass committed at `2f2d111ec` ran against the dirty stylesheet
import correction later committed as `ef4f76905`; it was not a clean capture at
`74316ba98`. `git diff 74316ba98..ef4f76905 -- src` shows that one import-depth
change. Only the 96 explicitly retaken frames are newly captured here. The other
frames retain their earlier provenance and limitations. `capturedAt` still names
the previous full sweep, and the old partial-capture/head-note records are kept
under `previousPartialCapture`/`previousHeadNote`, explicitly historical rather
than current claims. No whole-theme/full-surface sweep was run.

The checker itself is unchanged. The full gate result and convergence accounting
are recorded with the evidence commit/PR remediation, not inferred from the
cheap inventory check.


## The full evidence gate, its real first result, and how it was answered

`pnpm check-evidence` was run in full at head `0c3591791` (`MAGICK_THREAD_LIMIT=1`,
`nice -n 10`, one run at a time) and **failed: 27 of 2,279 frames**. All 27 were
this round's own defects, and none of the checks was weakened to clear them:

1. **25 frames were "a ground with nothing on it" (98.70-98.73% one colour,
   ceiling 98.50%).** The browser tool captures the whole 2880x1634 viewport, and
   the settings story's subject occupies only its top ~35%, so the frames were
   mostly bare canvas. This is the design round's D18 in its extreme form, and the
   fix is the one D18 asks for: each shipped frame is now the **rendered content
   region** of its capture — a deterministic crop at the content bounding box
   (rows/columns carrying more than 1% non-ground pixels) plus a 24px margin.
   Nothing was resampled, rescaled or recoloured; every one of the 25 was
   re-checked with the gate's own exported `assertFramePaints` (**25 checked, 0
   failures**); and every full-viewport source PNG is retained under
   `originals/` with its sha256 and crop box in `crop-index.json`. The originals
   are `.png`, which the walker deliberately does not enumerate.
2. **`supplementary[panels-remediation]` had no `capturedAt`** — a real omission
   in a set declared this round. It now carries the pass's capture window
   (`2026-09-14T19:36:59Z`-`19:49:41Z`), read from the source screenshots.
3. **`partialCapture.refreshedFrames` said 96 against a measured 290.** The field
   is one-sided and measures every non-supplementary `.webp` that moved between
   the pass start and this tree; reconciling this branch onto `main` folded
   `main`'s own evidence passes into that same range. It is now the measured
   **290**, with the decomposition stated: **96** retaken by this pass and **194**
   that arrived with `main`'s `chat-ask-options`, `chat-composer-status-row` and
   `chat-run-panel` sets, which this branch neither captured nor modified.

No frame was deleted, no ceiling relaxed, and no check edited.
The re-run on the corrected head **`00b45363a`** held: `Evidence holds: 2279 frames are pictures of their own theme (worst ΔE00 18.1, docs/evidence/chat-model-picker/busy/localOperatorLight.webp).`

## Conflict-only convergence and history-preserving publication

GitHub reported the PR conflicting. The saved pre-convergence evidence head is
`bcc27879e` on the published `evidence/panels-before-convergence-20260914` ref;
this preserves the actual capture/source citations. The current main fetched
while this was in progress advanced to `8d019993e`, which is the exact base used
by the completed candidate, not the earlier observed `915928a18`.

`convergence.json` records the proof: **821 nonconflicting files byte-identical**,
with added/deleted line multisets identical for all files except the manifest
and package.json. Source remediation `642e6934d` → `2f33db239` is `=` in
`git range-diff`. The manifest preserves a path-keyed union of 29 supplementary
sets and the complete upstream record. Package.json keeps main's **0.22.3** and
all upstream test entries; this branch adds only the panel chart test. The
capture-list and contrast-contract patches are unchanged. No gate was weakened.

The integrated shared walker counts **2279 total = 1928 sweep + 351 supplementary**
WebPs, with **228 capture-list entries**. These replace the pre-convergence
inventory above, not its capture timestamp. Upstream's shared CSS/utility change
only introduces `pulse-visible`, which none of these panel captures uses;
palettes and branch-authored panel/chart files are unchanged. The attempted
optional post-convergence browser sample hit two 20-second screenshot timeouts;
there is no claim of a newly captured convergence frame. Existing captures keep
their pre-convergence provenance and the exact-source proof is stated separately.

To avoid any force push, the reconciled candidate is kept on a safety ref, then
the original published feature lineage is integrated as an additional merge
parent without changing that candidate's tree. Publication is an ordinary
fast-forward push of the existing PR branch. Both histories survive; this is
not a PR merge or release. The final PR comment records ancestry/tree checks.
