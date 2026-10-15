# Finder Files — real headless app evidence

## Source and isolation

- After source: `7a8e27a269fdbc8c8be8da794f2ae06a422a3b94`; documentation/evidence-only commits may follow.
- Before: fresh `origin/main` at `1d7df9c71` (the generated-artifact PR #1054 was still open).
- Backend: #2393 `feat/session-files-index` checkout, read initially at `82d6d7491`; real `local-operator serve`, not a reimplemented index. The captured `/files` capability was **1**.
- Both apps: built Electron app, owned isolated HOME/config/profile, inherited CMUX variables removed by the shipped renderer driver, telemetry/notifications off. Facts in every report: **headless, visible:false, focused:false**. Each capture command reaped its app before returning.
- Dependencies: existing lockfile-matching pnpm tree shared by symlink. No dependency reinstall or browser engine.

`seed.py` builds 5,000 real path-backed outputs (PNG/video/Markdown/CSV), one parent `cache_media` image, and one rostered-child `cache_media` image: **5,002 indexed rows**. The first PNG is 2,000×1,200, a downscaling control; two real supplement callouts promote it and a summary to Highlights. The clip is the owned two-second ffmpeg fixture from the Stage-A capture; supply it at `$LOCAL_OPERATOR_SCRATCHPAD/rig/teaser.mp4`. The other video paths hardlink that synthetic fixture (not dependency trees or user files).

## Actual before/after and scale

Images/reports under `before/` and `after/` are the corrected captures only.

| Surface | Wide | Narrow |
|---|---:|---:|
| Window |1380×900|1184×800|
| Dock measured by rendered DOM |560×868|**400×768**|
| Mounted file nodes, top/middle/end |26 /8 /39|16 /10 /36|
| List tab stops, top/middle/end |1 /1 /1|1 /1 /1|
| Original thumbnail reads after top→middle→end |13|7|
| Decodes /peak concurrent reads |13 /4|7 /4|
| Last row bottom /scroller bottom |892 /900|792 /800|

Both palettes repeat these readings. `scrollWidth == clientWidth`: no horizontal overflow. Wide JS heap is Chromium's coarse **53.5 MB** reading, stable top/middle/end; it is not an independently measured RSS number. Raw counters and DOM geometry are in `after/ready-*/report-*.json`. Offscreen overscan nodes intentionally extend beyond the visible rectangle; that is not a clipped final row.

The baseline renders 1,248/1,298 scanned path rows in these timed captures (and no generated artifacts), rather than the entire 5,002-row authoritative inventory. Its exact partial count depends on the legacy scanner's page budget/timing; the report is the observation, not a deterministic count assertion.

## State matrix (wide +400px, light +dark)

- Populated: real `/files` response, real images, complete 5,002-row pagination; `after/ready-*`.
- Empty: a separate real isolated session, result `ready`, total0; `after/empty-*`.
- Loading/backfill: **controlled eight-second delay** on `/files` only. Dedicated `finder-*-loading-*.png` frames show the loading receipt; some light frames intentionally show real partial rows while the next page is in flight. `after/loading-*`.
- Error: **controlled HTTP503**, no scanner fallback; `after/error-*`.
- Building: **controlled `state:building` partial three-row page** with progress fields, to make the state deterministic; `after/building-*`. The real service's first cold GET was separately observed as `building`, 4,415 partial total, 200 rows and a cursor before completing.

`gateway.py` forwards every other route to the real owned daemon. First attempt buffered SSE to EOF and left chat hydration loading while Files itself worked. That fixture flaw was identified, repaired to stream SSE, and **all committed normal/state frames were re-captured**. The rejected first attempt stays only in session scratch. No UI code was changed to hide it.

## Real flows /negative controls

- Child family query returned `child-portrait.png` with `session.role:subagent`, `child_id:b1f1de000003`; children attachment route returned **HTTP200, image/png,268 bytes**. The real list thumbnail and canvas viewer both decoded **80×120**, captured under `after/child/`. This is not source-only child-scope proof.
- Real child path action: rendered **Copy file path** invoked backend materialisation only on selection. The resulting confined scratchpad file exists,268 bytes, byte-identical to the attachment and a different inode (copy, not link). Clipboard was intercepted in the renderer, so no OS clipboard claim. `materialise-proof.json`.
- Keyboard real app: Arrow Down reaches the summary, then Working files; Right expands it; Down reaches Images then its first file; Right reaches the next tile. Shift+F10 opens the shipped menu containing **Expand image**. Escape closes it; slash reaches the labelled search. `after/keyboard/report-keyboard.json` and its menu frame contain actual output. No ARIA-grid role is claimed.
- Genuine provider output: read-only session `48968d63f896` journal contains the manager's real Radient generation, digest `8e8f5f4c23b0ea33a8e6952aec2c771e`,512×512. Fresh-main **real extractor** returns0 represented artifact rows; backend #2393's real `FileScan`, reading that same live journal, derives1 generated-image record. `live-baseline-scanner.json` /`live-session-index.txt`. No live session was edited, cloned as a mutable app fixture or used as a writer. This live-journal check is **extractor/index-derivation proof**, not a claim that the installed live app already uses the new index.
- Targeted automated gate: **192 tests /192 pass /0 fail**, comprising Finder layout/wire/child adapter/revision-reset controls, real preference persist/rehydrate, artifact regressions and locale gates. Main +renderer typechecks and touched-source/script lint also pass. No local full desktop suite: CI supplies that gate.

## Reproduction commands

The token is a generated one-off rig value; never print it or pass it as argv. Set `LOCAL_OPERATOR_DESKTOP_TOKEN` in the child environment. The backend/Python imports must resolve to the #2393 checkout, not a global install.

```bash
# isolated HOME/config; source #2393 venv already exists
HOME="$rig/home" LOCAL_OPERATOR_CONFIG_DIR="$rig/home/.local-operator" \
  "$backend/.venv/bin/python" docs/evidence/finder-files/seed.py
# serve the owned backend on127.0.0.1:18735 with hosting=test/model=mock-model;
# gateway.py listens18736 and reads its owned sibling index-mode file.
node docs/evidence/finder-files/capture-finder.mjs \
  --backend http://127.0.0.1:18736 --session b1f1de000001 \
  --out "$frames" --window-size 1184x800 --label dock400 --scale
# --child-flow /--keyboard-flow add the real UI assertions.
# modes ready,error,building,loading; empty uses session b1f1de000002.
```

## Deliberately not claimed

- No native OS-app/Finder-opening or real OS clipboard/save-dialog smoke was run (those actions can interrupt the operator); shared action logic regressions ran, and independent QA remains required.
- Video bands avoid fetching thousands of whole clips for decorative posters. They reserve full-width geometry and open the existing player explicitly. No poster endpoint or large-clip/32MiB relay repair is claimed.
- Mobile/TUI rendered parity is not implemented here; the service-reuse boundary is documented in `docs/design/session-files-parity.md`.
- No merge, release, version bump, reviewer request or person tag.
