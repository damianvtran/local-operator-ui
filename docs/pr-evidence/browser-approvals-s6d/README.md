# S6d evidence: approvals corner popup by default, grants kept reachable

**Current evidence, consolidated.** ~3.2 MiB / 90 files. Older duplicate frames,
per-cell superseded JSON and raw test logs were pruned; every PR-comment citation
was checked to still resolve. Where a removed file carried a claim, the summary
that supersedes it is named below.

## What is retained and why

### `app/` — app-level frames (historical, not a current whole-app smoke)
- `app/after/` — cited by design round 1: `w1160-dark-approvals-populated.png`,
  `w800-dark-approvals-populated.png` (dialog focus/width fix), `w600-light-toolbar-badge.png`
  (toolbar badge), `actions-after-revoke-all.png` (grants side effect).
- `app/before/w1160-dark-toolbar-badge.png` — origin/main control cited by design round 1.
- `app/kill-switch/` — three frames proving the DOM band/dock fallback still mounts
  when `LOCAL_OPERATOR_UI_BROWSER_APPROVALS_OVERLAY_DISABLE=1` (requirement: keep dock as fallback).

### `card/` — round-1 D1 reproduce-then-fix (cited by remediation round 1)
- `card/before-{264,900}-{dark,light}-stale-error.png` — origin/main controller:
  "Ne pas autoriser" / "Don't allow" cut by the sticky footer (overdraw 15.17).
- `card/after-{264,900}-{dark,light}-stale-error.png` — fixed: all four decisions
  above the error line and footer.
- `card/after-264-dark-hover-dont-allow.png`, `card/after-900-light-hover-dont-allow.png`,
  `card/after-264-light-long-requester-stale-error.png` — cited individually in remediation round 1.
- `card/after-{264,900}-{dark,light}-normal-request.png`,
  `card/after-264-{dark,light}-review-all-list.png` — normal and Review-all views.
  Review-all here predates the R3-1 CSS-visibility fix (see `round-3/`).

### `probe/` — numeric facts backing the frames above
- `probe/after-{264,900}-{dark,light}.json` — round-1 D1/Q1 geometry rows
  (cited as `probe/after-*.json`).
- `probe/capture-default.json`, `probe/capture-kill.json` — dock/band absence and
  presence, grants side effects, focus-on-open per cell (cited).
- `probe/q1-control-reservation-disabled-900-dark.json` — negative control proving
  the Q1 hover fix discriminates (cited).
- Superseded `probe/before-*.json` (origin/main controller dumps) and
  `probe/capture-before-origin-main.json` were dropped; their before/after claim
  lives in the D1 table of the round-1 remediation comment and in `card/before-*`
  frames plus `round-2/facts/before-*.json`.

### `round-2/` — current native card + controller matrix
- `sheets/after-{264,900}-{en,fr,es,ru}-{dark,light}.png` — 16 labelled contact
  sheets (normal, stale, hover, long-requester). These are the frames the design
  round-2/3 reviews cite. `sheets/before-stale-six-cells.png` is the translated
  clipping reproduction.
- `frames/before-264-{fr,es,ru}-{dark,light}-stale-error.png` — full-resolution
  before reproductions (distinct evidence, not duplicated by sheets).
- Individual `round-2/frames/after-*.png` were dropped: each was an exact panel
  of its contact sheet; the sheet is the retained artifact.
- `facts/after-*.json` (16 cells) and `facts/before-264-*.json` (6 cells) — the
  numeric rows behind every geometry claim (304 PASS / 0 FAIL / 16 BLOCKED).
- `r2-card-build-receipt.json`, `r2-before-artifacts.json`, `r2-matrix-summary.json`,
  `validation-receipt.json`, `geometry-table.md`, `card-only-build.mjs`,
  `card-only-build.log` — provenance, artifact hashes, exact commands.
- Raw `source-tests.log` / `source-controls-*.log` were dropped; the pass/fail
  counts and discriminating control results are stated in the round-2 remediation
  comment and `validation-receipt.json`.

### `round-3/` — source-only repair (R3-1/R3-2), native QA pending
- `README.md` — the two fixes, the executed source tests, and the explicit
  "prepared, not executed" native acceptance rows.
- `source-tests.log`, `source-control-before.log`, `document-tests-first-run.log` —
  65 pass / 0 fail suite, the failing pre-repair control, and the first document
  test run. Retained because round-3 has no frames yet.

## Limits carried forward

Native composite/transparency, ring hit-routing, VoiceOver and OS-level focus are
still BLOCKED. `app/` and `card/` frames are historical (round-1); `round-2/` is a
card + controller producer-bound rig, not a whole-app artifact; `round-3/` is
source-only with native proof pending the final build.
