# Cold index generations — Q4 / U7 remediation

## Change and tradeoff

The real hook now privately assembles **every** cursor/backfill pass. Only a
complete `state: ready` generation with no next cursor publishes membership.
The first pass renders loading/building and loaded/total metadata, with no file
rows/thumbnails. Refresh retains the prior complete generation until replacement.
This deliberately waits for full pagination rather than painting early files:
client sorting must not prepend each new page, remount thumbnail viewports, and
finally snap late Highlights above the provisional list. Sort remains client-only.

## Native reproduction and passing delta

Real backend #2393 checkout `30815ed17`, isolated author-owned HOME/config and
synthetic family `b1f1de000001`: 5,002 indexed rows (2 Highlights, 5,000 Working).
The committed `delayed-page-proxy.py` forwards the real API unchanged, delaying
**every `/files` page 250 ms** and counting actual requests. It is not an index
implementation. Fresh headless app/profile/cache for every row below; pointer
outside list during the cold phase. CDP DOM/resources sampled every250ms.

| Compiled candidate / palette / actual pane | `/files` pages | loading samples | distinct first content rows | Finder reads while loading / final | peak reads | first painted section |
|---|---:|---:|---:|---:|---:|---|
| d096 control / dark /560 |26|28|26|353 /354|4|Images (not Highlights)|
| d096 control / light /560 |26|27|26|360 /361|4|Images (not Highlights)|
| atomic candidate / dark /560 |26|29|1|0 /1|1|Highlights2, Working5,000|
| atomic candidate / light /560 |26|29|1|0 /1|1|Highlights2, Working5,000|
| atomic candidate / light /340 overlay |26|29|1|0 /1|1|Highlights2, Working5,000|
| atomic candidate / light /400 dock |26|29|1|0 /1|1|Highlights2, Working5,000|

All29 loading samples in each after run have **0 mounted file rows, 0 list `<img>`
and0 Finder thumbnail reads**. Final content has2 mounted rows, with Highlights
present from its first sampled content paint; no subsequent first-row change.
The before numbers were reproduced here, not copied from independent QA's report.
The counters are Finder's real thumbnail queue, not all transcript image traffic.

At340/400 the head's `scrollWidth == clientWidth ==340/400` in every loading
sample. Progress reads e.g. `1,000 of 5,002 loaded`, unclipped in the viewed frame.
Both narrow runs additionally focus the shipped Sort trigger, activate Size via
real keyboard events, park the pointer over the list, then sample10 frames:
rows `[2,2,2,2,2,2,2,2,2,2]`, page count26→26. No false empty / repagination.

Each directory contains first/progress/final PNGs and `report.json` with actual
window facts, sampled text/geometry/resources and request count. Author viewed
before-dark progress, after-light progress, after-dark final and after340 progress.
The prior broad layout/video/scroll/empty/error evidence is retained: no layout,
thumbnail, menu, preferences, CSS or keyboard implementation changed in this delta.
The new metadata span and its narrow fit are captured here, not inferred.

## Source / build identity and moved-main disclosure

Source base: `d096e4272684921dbf3959d81d2e416d4bc69505`. Before uses the existing
compiled production bundle from the preceding remediation; that bundle's source
identity is recorded in `../remediation/README.md` (the previous changed-source
fingerprint `2b441b4e…`). Both before runs completed before overwriting `out/`.

**ONE author build**, after narrow gates passed: `electron-vite build` via the
existing `build-finder.sh`, exit0,12.24s. SHA256 over sorted changed source paths
plus bytes at build time:
`8d1114526eb71763ffd1572128d3402b3d6f1b0a1cdd1c828d7f9fe6b4690101`.
Those four source paths are `src/i18n/catalogues/en/ui.canvas.json`,
`src/i18n/keys.gen.ts`, `canonical/use-session-files.ts` and
`components/canvas/finder-files-view.tsx` under the chat feature for the last two.

While capturing, GitHub marked d096 DIRTY against main `8179f2956`. Main changed
only three `chat/pickers/usage-view*` source files, two fixture scripts, release
version and its own evidence. A no-commit main fold preserved the author's entire
hook/progress/test patch **byte-identically** (`cmp` of pre/post authored diff).
No Finder/hook/layout/style/i18n/contract source overlaps. The single remediation
commit also resolves that dirty-base convergence; no authored version bump.
**The captures are not a full-tree native run of the converged head:** upstream
usage-view code was not in the compiled bundle. Scoped Finder bytes match; its
unchanged pixels can retain the existing evidence. The two imported test files
were run (91/91). Independent review must check convergence semantics and the
cold-generation delta; it must not infer whole-tree compiled equality.

## Targeted execution and negative controls

- `node scripts/run-desktop-tests.mjs scripts/session-files-hook.test.mjs`:
  **7/7 passed**. Real hook, scripted IPC only; delayed cold page + late Highlight,
  9 changing building revisions, retained3→4 refresh including a building slice,
  client-only presentation control, cursor restart, capable draft.
- SAME harness with `SESSION_FILES_HOOK_REF=d096e4272`: **4 pass /3 fail**, exactly
  the newly discriminating publication assertions: building rows painted before
  ready, first ready cursor page published3 rows, refresh building slice replaced
  the prior complete3 rows with1. This is not a copied algorithm test.
- Index/layout/keyboard/typed-i18n direct neighbors: **31/31**.
- Imported main `chat-link-affordances.test.mjs` + `usage-view.test.mjs`: **91/91**.
- Both serial typechecks and affected source/script lint passed before build;
  pre-push rechecks the final converged head. No full local suite (CI owns it).

The existing presentation-only hook test remains an acknowledged weak test
(code round2 m4); real narrow native Sort is the interaction evidence here.

## Reuse / ownership

`capture-cold.mjs --backend http://127.0.0.1:18736 --out <owned-output>
--window-size 1380x900 --label <label> --theme localOperatorDark` drives the real
compiled app through the shipped `renderer-driver.mjs`; add `--expect-old` only
for the deliberately failing before control and `--sort-control` for the real
keyboard/pointer sort neighbor. Driver creates isolated HOME/user-data, mock
keychain, no telemetry/notifications, and reaps exact app trees. Never show a
window or reinstall dependencies. All facts report visible=false/focused=false.

Use the existing owned seeded finder-rig HOME; declared backend entry point is
`.venv/bin/lop serve --host 127.0.0.1 --port 18735`. `PYTHONPATH` must point at backend checkout30815ed17; capability is
`/v1/capabilities` and was observed `session_files:1`. Put the proxy beside an
owned `index-mode` file containing `ready`; it listens only on loopback18736,
forwards to18735, and exposes `/__cold_reset` / `/__cold_stats`. The session token
is supplied via environment from the owned token file, never logged or committed.

Setup recovered from an absent historical worktree path, unsupported
`python -m local_operator` and a capability404 **before any app dispatch**.
Failed module child was reaped; actual owned daemon/proxy tree4 processes was
terminated and waited after captures (remaining0). All6 headless app runs reaped.
The compiled Finder candidate remains in the author's worktree `out/` for QA/UX.

No provider generation, native OS dialog/app/clipboard, mobile/TUI rendering,
SVG-artifact delivery or global scrollbar fade timing is newly claimed. Pending
independent QA/UX delta sign-off is not replaced by this author matrix.
