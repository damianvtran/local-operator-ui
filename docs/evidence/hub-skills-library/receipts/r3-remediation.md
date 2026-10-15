# R3 unified remediation: keyboard continuity and truthful backend reasons

Implementer/model: `anthropic/claude-sonnet-5-5`. Product input: base `be25940359` plus the seven-file dirty remediation, frozen before the ONE actual candidate build. `r3-preflight.json` pins1373 source/build inputs; `r3-compiled-identity.json` pins all172 compiled files after the explicitly recorded CSP-only rig edit. No source changed during build/boots; original74 PNGs are byte-identical. App real; daemon, version advertisement, Hub policy API and public origin are **stubs**, not delivered backend functionality.

## Product delta / dispositions

- **UX U1 fixed:** an ordinary `isFetching` refetch no longer disables a control backed by the existing verified, non-placeholder, non-error CURRENT MAIN snapshot. No new identity cache/engine, global health/poll edit or focus-restoration loop. Initial/placeholder/negative/error data remains blocked. Dispatch-time `guardHubMutation` is byte-unchanged (SHA256 `e172a4f7db3ac190b7b56fc3538cb1d6c7234c2e6f1c146db26d10144ae33df3`): fresh MAIN pull, newer-push precedence and expected identity remain mandatory.
- **Agent R2-1 / UX U2 fixed:** initial/placeholder status says Checking, disconnected/error says Reconnect, attached incompatible/unknown/prerelease says Update the Local Operator **backend** to a published release0.72.1 or newer. All copy is keyed under `ui.hub`, with contexts and generated types; `t()` resolves at invocation/render time. Initial cold-load copy is covered by the actual-component SSR unit, not a fabricated native transient still.
- **UX U3 fixed:** a blocked Enable now has its keyed reason **inside** consent; Cancel/close stay enabled.
- **D40 fixed; U4 partial:** while writes are blocked, neither Subscribe's description nor its OFF hint promises manual actions. Compatible-core incoming preference is described as **off**, not paused. The broader Auto-push paused/reason taxonomy remains deferred; the existing Private-row generic sentence remains visible in these frames.
- **R2-2 fixed:** convergence prose now distinguishes28 changed paths inside1157 from33 total `src/` changes and lists the five outside the graph.
- **U5/U6 deferred:** retain native disabled semantics; no new accessibility/focus contract in this bounded regression fix. Escape/Cancel returning focus to BODY is pre-existing and no restore-focus loop was requested. No follow-up issue created.

## Exact native execution (macOS headless, no visible/focused window)

All times UTC. END below is the raw log's last-write observation, not an invented in-script timestamp. Node22.13.1/shared lock `fd0310…0ba`, no install; heap4096MiB plus repository max(footprint,RSS) watchdog6144MiB/keeper. Each lease was atomic `wait0`; no overlap/control rebuild/full67-frame matrix.

| Run | START / observed END | Actual evidence | Result |
|---|---|---|---|
| 1 fixed dark1380 |09:16:53.532 /09:17:53.882|Each Subscribe and Enable holds11.5s/460 samples, `firstLostAtMs:null`, active and enabled; Space confirms Subscribe OFF; consent opens/Enable focused.|**9 PASS/0 FAIL; EXIT124 bound with valid evidence**, not a completed run. Two stills retained. Enter/loss/geometry were not reached.|
| 2 fixed light800 |09:25:16.269 /09:25:58.546|Enter yields exactly one `PATCH /v1/desktop/hub/links/link-public-agent ->200`; Auto-push is checked only after answer. Backend loss shows Reconnect inside dialog; Enable disabled, Cancel usable. Actual CSP violation refuses undeclared loopback8139; all observed renderer HTTP intents are stub or that denied control.|**19 PASS/0 FAIL/exit0**|
| 3 old0.71.5 dark1380 |09:25:58.989 /09:26:35.558|All five write controls disabled, zero PATCH; actionable published-backend requirement; no manual-availability promise.|**14 PASS/0 FAIL/exit0**|
| 4 prerelease0.72.2-dev light800 |09:26:35.975 /09:27:12.672|Same fail-closed boundary, zero PATCH, narrow wrapped backend copy; no false outdated-desktop claim.|**15 PASS/0 FAIL/exit0**|

The parent explicitly released the last three boots after run1's bound, reusing its successful focus evidence rather than repeating the holds. **One actual build, four native boots total.** No further dispatch occurred.

### Frames personally viewed

Paths below are under `../frames/`:

| Frame | Actual observation |
|---|---|
|`R3-fixed-focus-wide/r3-fixed-switch-held.png`|Dark wide reviewer; Public Subscribe ON with green focus ring; Private incoming hint says off; no supported-backend upgrade warning.|
|`R3-fixed-focus-wide/r3-fixed-dialog-held.png`|Centered Public consent; Enable has a clear green focus ring; background Public Subscribe is OFF after Space; labels/body fit.|
|`R3-fixed-short-narrow-light/r3-fixed-policy-confirmed.png`|Light800 responsive rail; Public Auto-push visibly ON after the200; incoming/publication columns remain legible, Private off/paused distinction retained.|
|`R3-fixed-short-narrow-light/r3-disconnected-narrow-light.png`|Reconnect/backend0.72.1 sentence is INSIDE the dialog, wrapping naturally above controls; Cancel is focused/enabled, Enable grey; no apparent text clipping.|
|`R3-old-wide/r3-old-wide.png`|Gold actionable backend-update explanation per group; disabled switches/actions; Subscribe description no longer promises manual pull; old generic Private paused reason intentionally remains.|
|`R3-prerelease-narrow-light/r3-prerelease-narrow-light.png`|Backend-update sentence wraps to two lines at800; controls stay disabled; no horizontal clipping. Lower content scrolls vertically by design.|

Also re-viewed the existing R-K before frame: it says generic core minimum plus contradictory manual availability while disabled. The new old-core still removes that contradiction. Both use1380×900; scroll offsets differ, so this is a content comparison, **not** a controlled pixel diff.

### Geometry / teardown / resource evidence

`frames/R3-*/geometry.json` records actual measured painted boxes (not display:contents ratios). Wide viewport1380×900/DPR2: row764×350.18, scroller `cw=sw=816`; narrow800×900/DPR2: row676×367.58, scroller `cw=sw=728`; loss dialog512×314.40, `cw=sw=510`. Actual geometry helper accepts these and refuses cloned zero-wrapper and horizontal-overflow negatives. Run1 has no geometry JSON and is not represented as one.

`r3-remaining-resources.json`: initial25155368KiB/free-swap1493.81MiB/mem53%; final24982196KiB/free1493.81/mem47%. All start gates re-read disk>=20GiB, mem>=35%, **swap FREE>=500MiB** (used diagnostic only);18GiB native abort. `r3-teardown.json` verifies16 exact own PID leaders absent, own-session Electron/stub command-scope strays0, port8127 empty. This is not a continuous socket audit.

## Preserved setup failures, not product failures

1. Initial wrapper wrongly ran export-only `build-env.mjs`; exit0 did **not** run Vite. Artifact check refused the old output. No app build/native occurred; `r3-cell.log`, `r3-build.log`, `r3-setup-refusal.json` retained.
2. Parent-authorized repair ran the exact shared `electron-vite build` (package script), actual Vite output/new09:11:51 artifact, observed peak2213MiB. Then a global CSP regex incorrectly counted two textual occurrences (one is a comment) and stopped before native. No second build was run.
3. Parent-authorized meta parser preserved the comment byte-for-byte, edited only the real meta's content, refused comment-only input, proved exactly one actual meta/connect-self-and8127. Before HTML `9add3736…` → after `ac4fba5a…`; full hashes in `r3-csp-proof.json`. All172 asset hashes checked before every boot. The scripts and both failure logs remain forensic inputs; do not replay the known no-op/global-regex setup as a successful recipe. `r3-rig-archive-format.json` documents one stripped trailing space in the readable `r3-cell.py` archive; `r3-cell-original.base64` preserves its exact executed bytes/hash. Other rig copies and all raw logs are verbatim.

## Automated gates / remaining boundaries

Canonical serial memory-guarded affected Hub+env group: **129 PASS/0 FAIL/0 CANCEL**,13.33s (`r3-neighbors.log`). New actual-component SSR copy/placement checks use inert UI primitive boundaries, **not** portal/focus proof; native rows above supply that proof. Generate/check passed; ledger3 complete/fresh/audited; affected lint has only seven pre-existing warnings, none added. Canonical fold exit0 derives13999 sweep frames/1728 stories/12 themes and597 inside/841 outside; its citation-ancestry guard stood down for this shallow clone, so no ancestry pass is claimed. No local full suite, STT fix or timeout increase. QA2 independently classified the older supplement cancellation and CI STT red as unchanged environment/timing; their primary report remains authoritative, not these screenshots. CI must still pass on the final pushed head and independent rounds must pin it.

### Reproduction inputs

Run from this worktree with the same shared lock/Node22 and a fresh authorized lease. `r3-env-preflight.mjs` validates exact inert env names/values plus missing-OAuth/enum negatives; apply those env bindings to `./node_modules/.bin/electron-vite build` (**not** `node build-env.mjs`). Require new artifact mtime. Use `r3-csp.py` controls/constrain once, pin outputs, then `r3-bounded.mjs 60 <node22> <scratch>/r3-probe.mjs --mode fixed-short|old|unknown --version <fixture> --window-size <size> --theme <theme> --out <own-directory> --window-mode=headless` as recorded in `r3-remaining.py`. `r3-probe-focus-attempt1.mjs` is the exact first focus source and its combined mode exceeded60; its retained logs are valid partial evidence, **not** a turnkey green recipe. No rerun is authorized by this archival description.
